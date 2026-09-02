// bi-run.mjs — the `bi` side of the benchmark: every variant of DESIGN.md §9 as REAL child
// processes of `bin/bi.mjs`, timed from `spawn` to exit, with the tokens the agent would pay
// (the instruction block, the command, stdout, the files it reads) and the `timing.mode` of every
// run validated — a `first` or `fallback` run in a warm column invalidates the measurement, and
// the report says so instead of averaging it in.
//
// `INSTRUCTION` is the fixed cost of the `bi` side and must equal the blockquote in AGENTS.md
// character for character (`scripts/check-instruction-sync.mjs` in `npm run verify`).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { APP_URL, INPUT, SNAPSHOT_NAME, biConfig, checkFindings } from './task.mjs';
import {
  BIN,
  REPO,
  chromeDescendants,
  chromeProcesses,
  isAlive,
  makeStamp,
  readJson,
  sleep,
  spawnBi,
  stats,
  waitForChromeGone,
} from './time-run.mjs';
import { measure } from './tokens.mjs';

export const INSTRUCTION =
  'Przeglądarka: `bi <config.json> [--stamp X]` wykonuje flow, wynik w `<outputDir>/<stamp>/<snapshot>/report.md` (nagłówek, `## errors`, `## values`; `## steps` tylko przy FAIL); nieudany krok = wynik, exit 0. Sesja: `bi open <url>`, `bi find <tekst>` / `bi snap` dają refy `eN`; `bi click|fill|form|press|select|wait|shot|eval|console|net …` drukują jedną linię (exit 1 = FAIL); `bi export flow.json` zapisuje sesję jako config.';

/** What the agent types for the batch — the bench itself passes the absolute config path and a stamp. */
export const COMMAND = 'bi read.config.json';
/** The same command in a project that reaches `bi` through a package script (README, app-factory). */
export const COMMAND_PNPM = 'pnpm bi read.config.json';

export const CI_VARS = [
  'CI',
  'GITHUB_ACTIONS',
  'GITLAB_CI',
  'TF_BUILD',
  'JENKINS_URL',
  'TEAMCITY_VERSION',
  'BUILDKITE',
  'CIRCLECI',
];

/**
 * @typedef {object} BenchContext
 * @property {NodeJS.ProcessEnv} env
 * @property {string} cwd
 * @property {string} outDir
 * @property {string} configPath
 * @property {(line: string) => void} log
 */

/**
 * A pipe/socket name nobody else uses — two agents running the bench and the smoke gate at the
 * same time must not share a keeper.
 * @param {string} id
 * @param {string} tmpdir
 */
export function pipeNameFor(id, tmpdir) {
  return process.platform === 'win32' ? `\\\\.\\pipe\\${id}` : path.join(tmpdir, `${id}.sock`);
}

/**
 * The environment every `bi` of the bench runs in: the developer's `BI_*` and CI variables are
 * dropped (a `CI=true` in the shell would silently turn every keeper run into `no-daemon`), the
 * keeper is enabled explicitly, its files live under the bench output, and the channel is pinned
 * through the environment so that `bi up`, `bi stop`, the session commands and the batch share
 * ONE identity hash (a config with an explicit `browser.channel` hashes differently from no config).
 * @param {string} outDir
 * @param {{ id?: string }} [options]
 */
export function benchEnv(outDir, options = {}) {
  const tmpdir = path.join(outDir, 'tmp');
  fs.mkdirSync(tmpdir, { recursive: true });
  const id = options.id ?? `bi-bench-${String(process.pid)}-${Math.random().toString(36).slice(2, 8)}`;
  /** @type {NodeJS.ProcessEnv} */
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith('BI_') || CI_VARS.includes(key)) continue;
    env[key] = value;
  }
  Object.assign(env, {
    BI_DAEMON: '1',
    BI_SOCKET: pipeNameFor(id, tmpdir),
    BI_TMPDIR: tmpdir,
    BI_CHANNEL: 'chrome',
    // Long enough that no idle timer fires between two variants of one bench run.
    BI_IDLE_MS: '900000',
  });
  return env;
}

/**
 * The pid file of the keeper on this env's pipe, if one exists.
 * @param {NodeJS.ProcessEnv} env
 * @returns {{ pid: number, pipe: string, listeningAt?: number, processStartAt?: number } | undefined}
 */
export function readKeeperInfo(env) {
  const tmpdir = env.BI_TMPDIR ?? os.tmpdir();
  if (!fs.existsSync(tmpdir)) return undefined;
  for (const name of fs.readdirSync(tmpdir)) {
    if (!name.startsWith('bi-') || !name.endsWith('.json')) continue;
    try {
      const info = JSON.parse(fs.readFileSync(path.join(tmpdir, name), 'utf8'));
      if (info.pipe === env.BI_SOCKET) return info;
    } catch {
      // Half-written or stale — not ours.
    }
  }
  return undefined;
}

/**
 * `bi stop`, then wait until the keeper's pid AND its Chrome are gone (DESIGN.md §9: `bi-cold`
 * and `bi-first` start from nothing). Kills a keeper that ignores `stop` — a leaked keeper would
 * make the next "cold" run warm.
 * @param {BenchContext} ctx
 */
export async function stopKeeper(ctx) {
  const info = readKeeperInfo(ctx.env);
  await spawnBi(['stop'], ctx).catch(() => undefined);
  if (!info) return { ms: 0, clean: true };
  const gone = await waitForChromeGone([info.pid], 5000);
  if (!gone.clean) {
    for (const pid of [info.pid, ...(gone.lingering ?? [])]) {
      try {
        process.kill(pid);
      } catch {
        // Already gone.
      }
    }
    await waitForChromeGone([info.pid], 2000);
  }
  return gone;
}

/**
 * Write the task config next to the output it will produce. No `browser` block on purpose —
 * see `benchEnv` (identity hash) — the channel comes from `BI_CHANNEL`.
 * @param {string} dir
 * @param {{ url?: string }} [options]
 */
export function prepareBatchConfig(dir, options = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const config = /** @type {Record<string, unknown>} */ (biConfig({ outputDir: './runs', url: options.url }));
  delete config.browser;
  const configPath = path.join(dir, 'read.config.json');
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  return { configPath, runsDir: path.join(dir, 'runs') };
}

/**
 * The facts the gate checks, read from `report.json` the way an agent would read `report.md`.
 * @param {any} report
 */
export function findingsFromReport(report) {
  const extracts = report?.extracts ?? {};
  const value = (/** @type {string} */ name) => extracts[name]?.value ?? extracts[name];
  return {
    ticketId: value('numer-zgloszenia'),
    category: value('kategoria'),
    priority: value('priorytet'),
    emailError: value('blad-email'),
    // ALL errors, not the first: the first is usually the browser's own line
    // ("Failed to load resource: 404"), the application's error sits below it.
    consoleError: (report?.console?.entries ?? [])
      .filter((/** @type {{ type: string }} */ entry) => entry.type === 'error')
      .map((/** @type {{ text: string }} */ entry) => entry.text)
      .join('\n'),
    screenshots: (report?.screenshots ?? []).filter((/** @type {string} */ file) => file !== 'final.png').length,
  };
}

/**
 * @typedef {object} BatchSample
 * @property {number} wallMs spawn → exit of the client
 * @property {number} code
 * @property {string} stdout
 * @property {string} stamp
 * @property {string} dir snapshot directory
 * @property {any} timing `report.json.timing`
 * @property {any} manifestTiming `_manifest.json.timing` (mode, keeperStartMs?, launchMs?, clientMs)
 * @property {string} mode `timing.mode`
 * @property {boolean} completed
 * @property {string[]} problems gate findings
 * @property {number} pid
 * @property {string[]} extraArgs
 * @property {number} [chromeGoneMs] `bi-cold`: how long the wait for the client's Chrome took
 * @property {boolean} [chromeGoneClean] `bi-cold`: false when the wait gave up
 * @property {any} [report]
 * @property {string} [reportMd]
 * @property {any} [manifest]
 */

/**
 * One batch run of the task through `bi`, timed and read back.
 * @param {BenchContext} ctx
 * @param {{ stamp: string, extraArgs?: string[] }} options
 * @returns {Promise<BatchSample & { report: any, reportMd: string, manifest: any }>}
 */
export async function runBatch(ctx, options) {
  const extraArgs = options.extraArgs ?? [];
  const run = await spawnBi([ctx.configPath, '--stamp', options.stamp, ...extraArgs], ctx);
  const runDir = path.join(path.dirname(ctx.configPath), 'runs', options.stamp);
  const dir = path.join(runDir, SNAPSHOT_NAME);
  if (run.code !== 0 || !fs.existsSync(path.join(dir, 'report.json'))) {
    throw new Error(`bi exited with ${String(run.code)} and no report.json in ${dir}:\n${run.stdout}${run.stderr}`);
  }
  const report = await readJson(path.join(dir, 'report.json'));
  const manifest = await readJson(path.join(runDir, '_manifest.json'));
  const reportMd = fs.readFileSync(path.join(dir, 'report.md'), 'utf8');
  return {
    wallMs: run.wallMs,
    code: run.code,
    stdout: run.stdout,
    stamp: options.stamp,
    dir,
    timing: report.timing,
    manifestTiming: manifest.timing,
    mode: String(report.timing?.mode ?? manifest.timing?.mode ?? '?'),
    completed: report.completed === true,
    problems: checkFindings(findingsFromReport(report)),
    pid: run.pid,
    extraArgs,
    report,
    reportMd,
    manifest,
  };
}

/**
 * The tokens of ONE batch session: the instruction block (fixed), the command, stdout and the
 * whole `report.md` (variable) — the agent reads the file in full, it is targeted by design.
 * @param {{ stdout: string, reportMd: string }} sample
 * @param {{ command?: string }} [options]
 */
export function batchTokens(sample, options = {}) {
  return {
    fixed: [measure('instrukcja w AGENTS.md (blok INSTRUCTION)', INSTRUCTION)],
    variable: [
      measure(`komenda agenta (${options.command ?? COMMAND})`, options.command ?? COMMAND),
      measure('stdout przebiegu', sample.stdout.trimEnd()),
      measure('report.md w całości', sample.reportMd),
    ],
  };
}

/**
 * @param {BatchSample[]} samples
 * @param {string} expectedMode
 */
function summarize(samples, expectedMode) {
  const wall = samples.map((s) => s.wallMs);
  const pick = (/** @type {(s: BatchSample) => number} */ f) => stats(samples.map((s) => Number(f(s)) || 0));
  return {
    n: samples.length,
    stats: stats(wall),
    modes: samples.map((s) => s.mode),
    validModes: samples.every((s) => s.mode === expectedMode),
    expectedMode,
    completed: samples.every((s) => s.completed),
    problems: samples.flatMap((s) => s.problems),
    queuedMs: pick((s) => s.timing?.queuedMs),
    scrubMs: pick((s) => s.timing?.scrubMs),
    gotoMs: pick((s) => s.timing?.gotoMs),
    stepsMs: pick((s) => s.timing?.stepsMs),
    captureMs: pick((s) => s.timing?.captureMs),
    writeMs: pick((s) => s.timing?.writeMs),
    totalMs: pick((s) => s.timing?.totalMs),
    clientMs: pick((s) => s.manifestTiming?.clientMs),
    keeperStartMs: pick((s) => s.manifestTiming?.keeperStartMs),
    launchMs: pick((s) => s.manifestTiming?.launchMs),
    cacheHits: pick((s) => s.timing?.cacheHits),
    cacheHitsDocument: pick((s) => s.timing?.cacheHitsDocument),
    samples: samples.map(strip),
  };
}

/**
 * A sample without the report bodies — `results.json` keeps the numbers, not every report.md.
 * @param {BatchSample} sample
 * @returns {BatchSample}
 */
const strip = ({ report, reportMd, manifest, ...rest }) => rest;

/**
 * `bi-cold` (`--no-daemon`, the CI path): no keeper, every run launches and closes its own Chrome;
 * between runs the bench waits for the client's pid and its `chrome.exe` children to be gone.
 * @param {BenchContext} ctx
 * @param {number} reps
 */
export async function timeCold(ctx, reps) {
  await stopKeeper(ctx);
  /** @type {BatchSample[]} */
  const samples = [];
  for (let rep = 0; rep < reps; rep += 1) {
    const sample = await runBatch(ctx, {
      stamp: makeStamp(rep, new Date(2000, 0, 1, 0, 0)),
      extraArgs: ['--no-daemon'],
    });
    const gone = await waitForChromeGone([sample.pid], 2000);
    ctx.log(
      `bi-cold #${String(rep + 1)}: ${String(sample.wallMs)} ms · mode ${sample.mode} · chrome gone in ${String(gone.ms)} ms`,
    );
    samples.push({ ...strip(sample), chromeGoneMs: gone.ms, chromeGoneClean: gone.clean });
  }
  return { name: 'bi-cold', ...summarize(samples, 'no-daemon') };
}

/**
 * `bi-first`: the keeper is stopped, then ONE call — the keeper starts INSIDE the stopwatch.
 * The very first call of the whole bench session is "first-ever" (Defender on a fresh chrome.exe,
 * cold disk cache) and is recorded separately, outside every ratio; the steady-state median comes
 * from the `reps` calls after it.
 * @param {BenchContext} ctx
 * @param {number} reps
 */
export async function timeFirst(ctx, reps) {
  /** @type {BatchSample[]} */
  const samples = [];
  let firstEver;
  for (let rep = 0; rep <= reps; rep += 1) {
    await stopKeeper(ctx);
    const sample = await runBatch(ctx, { stamp: makeStamp(rep, new Date(2000, 0, 2, 0, 0)) });
    ctx.log(
      `bi-first #${String(rep)}${rep === 0 ? ' (first-ever)' : ''}: ${String(sample.wallMs)} ms · mode ${sample.mode}`,
    );
    if (rep === 0) firstEver = strip(sample);
    else samples.push(strip(sample));
  }
  return { name: 'bi-first', firstEver, ...summarize(samples, 'first') };
}

/**
 * The warm family: the keeper and the tab are warm from `bi-first`; `n` calls with `gapMs` between
 * them (`bi-warm`: 300 ms, `bi-warm-tight`: 0 — the scrub of the previous run then lands in the
 * next one's stopwatch), optionally with `--fresh` (`bi-warm-fresh`).
 * @param {BenchContext} ctx
 * @param {{ name: string, n: number, gapMs: number, extraArgs?: string[], day: number }} options
 */
export async function timeWarm(ctx, options) {
  /** @type {BatchSample[]} */
  const samples = [];
  for (let rep = 0; rep < options.n; rep += 1) {
    if (rep > 0 && options.gapMs > 0) await sleep(options.gapMs);
    const sample = await runBatch(ctx, {
      stamp: makeStamp(rep, new Date(2000, 0, options.day, 0, 0)),
      extraArgs: options.extraArgs,
    });
    ctx.log(
      `${options.name} #${String(rep + 1)}: ${String(sample.wallMs)} ms · mode ${sample.mode} · ctx ${String(sample.timing?.ctx)} · queued ${String(sample.timing?.queuedMs)} · scrub ${String(sample.timing?.scrubMs)}`,
    );
    samples.push(strip(sample));
  }
  return {
    name: options.name,
    gapMs: options.gapMs,
    extraArgs: options.extraArgs ?? [],
    ...summarize(samples, 'warm'),
  };
}

// ── Interactive session ──────────────────────────────────────────────────────

/**
 * Refs from `bi snap` / `bi find` output: `e28 button "Wyślij zgłoszenie" [data-testid=submit]`.
 * @param {string} text
 * @returns {{ ref: string, role: string, name: string }[]}
 */
export function parseRefs(text) {
  const refs = [];
  for (const line of text.split(/\r?\n/u)) {
    const m = /^((?:f\d+)?e\d+) (\S+) "([^"]*)"/u.exec(line);
    if (m) refs.push({ ref: m[1], role: m[2], name: m[3] });
  }
  return refs;
}

/**
 * @param {{ ref: string, role: string, name: string }[]} refs
 * @param {string} role
 * @param {RegExp} name
 */
export function refOf(refs, role, name) {
  const hit = refs.find((r) => r.role === role && name.test(r.name));
  if (!hit) throw new Error(`no ${role} ${String(name)} in the snapshot (${String(refs.length)} refs)`);
  return hit.ref;
}

/**
 * @typedef {object} SessionCommand
 * @property {string[]} argv
 * @property {string} command what the agent typed (`bi …`)
 * @property {string} stdout
 * @property {number} code
 * @property {number} ms spawn → exit
 */

/**
 * `bi-interactive`: the task as an agent would do it at the keyboard — every command is its own
 * `node bin/bi.mjs` process through the keeper. Two variants (DESIGN.md §9):
 *   - `naive` — the agent looks first: a bare `bi snap` for the refs, then acts on refs;
 *   - `lean`  — the agent finds the button with `bi find` and knows the ids of the fields.
 * Both look again after the first click (`snap --diff`). The tokens are the commands plus their
 * stdout: nothing else enters the context (screenshots are files the agent does not read).
 * @param {'naive' | 'lean'} kind
 * @param {BenchContext} ctx
 */
export async function runInteractive(kind, ctx) {
  const cwd = path.join(ctx.outDir, `interactive-${kind}`);
  fs.mkdirSync(cwd, { recursive: true });
  const env = { ...ctx.env, BI_SESSION: `bench-${kind}` };
  /** @type {SessionCommand[]} */
  const commands = [];
  const bi = async (/** @type {string[]} */ argv) => {
    const run = await spawnBi(argv, { env, cwd });
    const command = `bi ${argv.map((a) => (/\s/u.test(a) ? `"${a}"` : a)).join(' ')}`;
    commands.push({ argv, command, stdout: run.stdout.trimEnd(), code: run.code, ms: run.wallMs });
    ctx.log(`bi-interactive-${kind}: ${command} → exit ${String(run.code)} · ${String(run.wallMs)} ms`);
    if (run.code !== 0) throw new Error(`${command} failed (exit ${String(run.code)}):\n${run.stdout}${run.stderr}`);
    return run.stdout;
  };
  const t0 = performance.now();
  let submit;
  let fields;
  await bi(['open', APP_URL]);
  if (kind === 'naive') {
    const refs = parseRefs(await bi(['snap']));
    submit = refOf(refs, 'button', /^Wyślij/u);
    fields = {
      name: refOf(refs, 'textbox', /^Imię/u),
      email: refOf(refs, 'textbox', /^E-mail/u),
      description: refOf(refs, 'textbox', /^Opis/u),
      category: refOf(refs, 'combobox', /^Kategoria/u),
      priority: refOf(refs, 'radio', /^Krytyczny/u),
      consent: refOf(refs, 'checkbox', /^Zgadzam/u),
    };
  } else {
    const refs = parseRefs(await bi(['find', 'Wyślij']));
    submit = refOf(refs, 'button', /^Wyślij/u);
    // Attribute selectors carry `=`, which `form` splits on — the ids of the fields are the
    // selectors an agent who knows the page would use.
    fields = {
      name: '#name',
      email: '#email',
      description: '#description',
      category: '#category',
      priority: '[data-testid=priority-krytyczny]',
      consent: '#consent',
    };
  }
  await bi(['click', submit]);
  await bi(['snap', '--diff']);
  const emailError = await bi(['get', '[data-testid=error-email]']);
  await bi(['shot', 'walidacja']);
  await bi([
    'form',
    `${fields.name}=${INPUT.name}`,
    `${fields.email}=${INPUT.email}`,
    `${fields.description}=${INPUT.description}`,
  ]);
  await bi(['select', fields.category, INPUT.category]);
  await bi(['click', fields.priority]);
  await bi(['click', fields.consent]);
  await bi(['click', submit]);
  await bi(['wait', '--sel', '[data-testid=confirmation]']);
  const ticketId = await bi(['get', '[data-testid=ticket-id]']);
  const category = await bi(['get', '[data-testid=ticket-category]']);
  const priority = await bi(['get', '[data-testid=ticket-priority]']);
  const consoleError = await bi(['console', '--errors']);
  await bi(['shot', 'potwierdzenie']);
  const wallMs = Math.round(performance.now() - t0);
  // Cleanup, not part of the task the agent pays for.
  await spawnBi(['close'], { env, cwd }).catch(() => undefined);

  const findings = {
    ticketId: ticketId.trim(),
    category: category.trim(),
    priority: priority.trim(),
    emailError: emailError.trim(),
    consoleError,
    screenshots: commands.filter((c) => c.argv[0] === 'shot' && c.code === 0).length,
  };
  return {
    name: `bi-interactive-${kind}`,
    kind,
    commands,
    wallMs,
    commandMs: stats(commands.map((c) => c.ms)),
    findings,
    problems: checkFindings(findings),
    tokens: {
      fixed: [measure('instrukcja w AGENTS.md (blok INSTRUCTION)', INSTRUCTION)],
      variable: commands.flatMap((c) => [
        measure(`→ ${c.command}`, c.command),
        measure(`← ${c.argv[0]} stdout`, c.stdout),
      ]),
    },
  };
}

// ── keeper-survives-shell ────────────────────────────────────────────────────

/**
 * The shells a host might run `bi` from. Each gets its own pipe so the probes never touch the
 * bench keeper or each other.
 */
function shells() {
  /** @param {NodeJS.ProcessEnv} env */
  const opts = (env) => ({ env, stdio: /** @type {const} */ ('ignore'), windowsHide: true });
  /** @type {{ name: string, spawn: (cmdline: string, env: NodeJS.ProcessEnv) => import('node:child_process').ChildProcess }[]} */
  const list = [
    { name: 'bash', spawn: (cmdline, env) => spawn('bash', ['-c', cmdline], opts(env)) },
    {
      name: 'pwsh',
      spawn: (cmdline, env) => spawn('pwsh', ['-NoProfile', '-NonInteractive', '-Command', `& ${cmdline}`], opts(env)),
    },
  ];
  if (process.platform === 'win32') {
    list.unshift({
      name: 'cmd',
      spawn: (cmdline, env) =>
        spawn('cmd.exe', ['/d', '/s', '/c', `"${cmdline}"`], { ...opts(env), windowsVerbatimArguments: true }),
    });
  } else {
    list.unshift({ name: 'sh', spawn: (cmdline, env) => spawn('sh', ['-c', cmdline], opts(env)) });
  }
  return list;
}

/**
 * `keeper-survives-shell`: `bi up` inside a shell subprocess, the shell exits, `bi status` from
 * THIS process — does the keeper spawned in there still answer? (Job Objects and some hosts kill
 * the tree; then every call is cold and the agent should know — that is what `bi doctor` prints.)
 * @param {BenchContext} ctx
 */
export async function keeperSurvivesShell(ctx) {
  const results = [];
  for (const shell of shells()) {
    const env = {
      ...ctx.env,
      BI_SOCKET: pipeNameFor(`bi-bench-shell-${shell.name}-${String(process.pid)}`, ctx.env.BI_TMPDIR ?? os.tmpdir()),
      BI_IDLE_MS: '120000',
    };
    const probe = { ...ctx, env };
    const cmdline = `"${process.execPath}" "${BIN}" up`;
    const t0 = performance.now();
    /** @type {{ name: string, available: boolean, survives: boolean, shellMs: number, statusMs: number, note?: string }} */
    const result = { name: shell.name, available: true, survives: false, shellMs: 0, statusMs: 0 };
    try {
      const child = shell.spawn(cmdline, env);
      await new Promise((resolve, reject) => {
        child.on('error', reject);
        child.on('exit', resolve);
        setTimeout(() => resolve(undefined), 30_000).unref();
      });
      result.shellMs = Math.round(performance.now() - t0);
      const t1 = performance.now();
      const status = await spawnBi(['status'], probe);
      result.statusMs = Math.round(performance.now() - t1);
      result.survives = status.code === 0 && /keeper running/u.test(status.stdout);
      if (!result.survives) result.note = status.lines[0] ?? status.stderr.split('\n')[0];
    } catch (error) {
      result.available = false;
      result.note = error instanceof Error ? error.message : String(error);
    }
    await stopKeeper(probe);
    ctx.log(`keeper-survives-shell ${shell.name}: ${result.available ? (result.survives ? 'yes' : 'no') : 'n/a'}`);
    results.push(result);
  }
  return results;
}

// ── app-factory ──────────────────────────────────────────────────────────────

export const APP_FACTORY_APPS = [
  { name: 'nowiro', port: 4311 },
  { name: 'business-wizard', port: 4312 },
  { name: 'bookstore', port: 4313 },
  { name: 'school-journal', port: 4314 },
];

/** Where the app-factory checkout is: `BENCH_APP_FACTORY`, else the sibling directory. */
export function appFactoryDir() {
  return path.resolve(process.env.BENCH_APP_FACTORY ?? path.join(REPO, '..', 'app-factory'));
}

/**
 * The app-factory config and builds, when they exist on this machine; `undefined` otherwise (the
 * variant is then skipped and the report says why).
 */
export function appFactoryFixture() {
  const dir = appFactoryDir();
  const config = path.join(dir, 'read.config.browser-inspector.json');
  const roots = APP_FACTORY_APPS.map((app) => ({ ...app, root: path.join(dir, 'dist', 'apps', app.name, 'browser') }));
  if (!fs.existsSync(config)) return undefined;
  if (!roots.every((app) => fs.existsSync(path.join(app.root, 'index.html')))) return undefined;
  return { dir, config, roots };
}

/**
 * The app-factory config as the bench runs it: a copy with its own output directory, optionally
 * migrated the way `bi lint-config` suggests for `waitUntil` (`networkidle` → `settled`; the
 * `wait ms` steps stay — the lint says those need `waitFor`, which needs a human).
 * @param {string} sourceConfig
 * @param {string} dir
 * @param {{ migrate?: boolean }} [options]
 */
export function prepareAppFactoryConfig(sourceConfig, dir, options = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const config = JSON.parse(fs.readFileSync(sourceConfig, 'utf8'));
  config.outputDir = './runs';
  if (options.migrate) {
    for (const snapshot of config.snapshots ?? []) {
      if (snapshot.waitUntil === 'networkidle') snapshot.waitUntil = 'settled';
    }
  }
  const configPath = path.join(dir, options.migrate ? 'read.config.settled.json' : 'read.config.json');
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  return configPath;
}

/**
 * One app-factory run (6 snapshots) through the keeper with `--parallel N`.
 * @param {BenchContext} ctx
 * @param {{ configPath: string, parallel: number, stamp: string }} options
 */
export async function runAppFactory(ctx, options) {
  const run = await spawnBi(
    [options.configPath, '--stamp', options.stamp, '--parallel', String(options.parallel)],
    ctx,
  );
  const runDir = path.join(path.dirname(options.configPath), 'runs', options.stamp);
  const manifestPath = path.join(runDir, '_manifest.json');
  if (run.code !== 0 || !fs.existsSync(manifestPath)) {
    throw new Error(`bi exited with ${String(run.code)} and no manifest in ${runDir}:\n${run.stdout}${run.stderr}`);
  }
  const manifest = await readJson(manifestPath);
  return {
    wallMs: run.wallMs,
    mode: String(manifest.timing?.mode ?? '?'),
    parallel: options.parallel,
    stdout: run.stdout.trimEnd(),
    snapshots: (manifest.snapshots ?? []).map((/** @type {any} */ s) => ({
      name: s.name,
      completed: s.completed,
      ms: s.ms,
      ctx: s.ctx,
      lane: s.lane,
      queuedMs: s.queuedMs,
      scrubMs: s.scrubMs,
      failure: s.failure,
    })),
  };
}

// Re-exported for bench.mjs so the orchestration imports one module for the bi side.
export { chromeDescendants, chromeProcesses, isAlive };
