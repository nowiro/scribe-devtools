// keeper.requests.mjs — what ONE request is and what it does (DESIGN.md §2.5, §3, §5).
//
// The protocol vocabulary (`PROTOCOL_VERSION`, the `done` line, `EngineUnavailableError`) plus the
// dispatch and the four job handlers: `batch`, `session`, `script`, `export`. Everything here runs
// on the `KeeperContext` the daemon (`keeper.mjs`) builds, which is why the socket server and the
// `--no-daemon` / fallback path share ONE handler and there is no second code path.
//
// Kept out of `keeper.mjs` so the process (lock, listen, pid file, engine loading, spawn) and the
// work (a request → a done line) are two files, not one. The dependency runs
// one way: the daemon imports the requests, never the other way round.
//
// The engine is reached through `ctx.engine()` and the small interface of `docs/handoff/WP5.md` —
// nothing here imports `engine.mjs`, so a fake engine drives every test on a real pipe.

import fs from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { E_AUTH, ensureSession, storageStateFor } from './auth.mjs';
import { CliError, formatStamp, parseArgs } from './cli.mjs';
import { ConfigError, loadConfig } from './config.mjs';
import { DEFAULT_OUTPUT_DIR } from './paths.mjs';
import { planLanes } from './schedule.mjs';
import { formatMs, relPath } from './print.mjs';
import { redact } from './redact.mjs';
import { buildManifest, failureOf, renderJUnit, writeArtifacts } from './report.mjs';

/** @typedef {import('./types.js').KeeperRequest} KeeperRequest */
/** @typedef {import('./types.js').KeeperDone} KeeperDone */
/** @typedef {import('./types.js').KeeperProgress} KeeperProgress */
/** @typedef {import('./types.js').TimingMode} TimingMode */
/** @typedef {import('./types.js').Report} Report */
/** @typedef {import('./keeper.mjs').KeeperContext} KeeperContext */
/** @typedef {import('./keeper.mjs').FlowResult} FlowResult */
/** @typedef {import('./keeper.mjs').JobResult} JobResult */

export const PROTOCOL_VERSION = 1;

/** @param {unknown} error */
export const messageOf = (error) => (error instanceof Error ? error.message : String(error));

/**
 * The engine could not be loaded or launched (`E_BROWSER_MISSING`, a missing module, a crash in
 * `createEngine`). An EXCEPTION, not a done line: `runJob` is called from inside handlers that
 * build their own answer from the job's value, and a `KeeperDone` in that slot was what turned
 * a missing Chrome into `Cannot read properties of undefined` and a client that never exits.
 */
export class EngineUnavailableError extends Error {
  /** @param {unknown} cause */
  constructor(cause) {
    super(messageOf(cause));
    this.name = 'EngineUnavailableError';
    /** The engine's own code when it has one (`E_BROWSER_MISSING`), else `E_ENGINE`. */
    this.code = typeof (/** @type {any} */ (cause)?.code) === 'string' ? /** @type {any} */ (cause).code : 'E_ENGINE';
    this.cause = cause;
  }
}

/** `FAIL <code>: <message>` without the code twice when the message already starts with it. */
const failLine = (/** @type {string} */ code, /** @type {string} */ message) =>
  `FAIL ${code}: ${message.startsWith(`${code}: `) ? message.slice(code.length + 2) : message}`;

// ── Request handler ──────────────────────────────────────────────────────────

/** The engine's counters under either name; `{}` for an engine that reports nothing. */
export const statusOf = (/** @type {import('./keeper.mjs').EngineLike} */ eng) => eng.status?.() ?? eng.stats?.() ?? {};

/** @param {number} exit @param {string[]} lines @returns {KeeperDone} */
export const done = (exit, lines, files = [], extra = {}) => ({ done: true, exit, lines, files, ...extra });

/**
 * A job whose engine never came up answers exit 2 with the reason instead of rejecting — for the
 * session, script and export handlers, whose done line is the job's value.
 * @param {Promise<KeeperDone>} job
 * @returns {Promise<KeeperDone>}
 */
const engineOr = (job) =>
  job.catch((error) => {
    if (error instanceof EngineUnavailableError) return done(2, [`FAIL keeper: engine unavailable: ${error.message}`]);
    throw error;
  });

/**
 * One request → one done line (progress lines go through `onProgress`). Both the socket server and
 * the in-process path call this — the same dispatch, the same engine calls, no second code path.
 * @param {KeeperRequest} request
 * @param {KeeperContext & { onProgress?: (p: KeeperProgress['progress']) => void, stop?: () => void, releaseFiles?: () => void }} ctx
 * @returns {Promise<KeeperDone>}
 */
export async function handleRequest(request, ctx) {
  if (!request || request.v !== PROTOCOL_VERSION || !Array.isArray(request.argv) || typeof request.cwd !== 'string') {
    return done(2, ['FAIL keeper: malformed request (expected { v: 1, cwd, argv, … })']);
  }
  if ('env' in request) return done(2, ['FAIL keeper: the protocol carries no env — resolve values in the client']);
  const secretValues = Array.isArray(request.secretValues)
    ? request.secretValues.filter((v) => typeof v === 'string')
    : [];
  ctx.noteSecrets(secretValues);
  const command = request.argv[0] ?? 'help';
  ctx.log(`request ${command} from ${request.cwd}`);

  let parsed;
  try {
    parsed = parseArgs(request.argv);
  } catch (error) {
    return done(error instanceof CliError ? error.exit : 2, [messageOf(error)]);
  }

  switch (parsed.mode) {
    case 'up': {
      try {
        await ctx.engine();
      } catch (error) {
        return done(2, [`FAIL keeper: engine unavailable: ${messageOf(error)}`]);
      }
      ctx.armIdle();
      return done(0, [statusHeadline(ctx, 'up')]);
    }
    case 'status':
    case 'doctor':
      return done(0, await statusLines(ctx));
    case 'stop': {
      // The pid and lock files go BEFORE the answer: a `status` issued right after `stop` returns
      // must not call the file of a keeper that is exiting cleanly stale.
      ctx.releaseFiles?.();
      const line = `ok keeper stopping · pid ${String(ctx.info.pid ?? process.pid)}`;
      queueMicrotask(() => ctx.stop?.());
      return done(0, [line]);
    }
    case 'batch':
      return runBatch(parsed, request, ctx, secretValues);
    case 'session':
      return runSession(parsed, request, ctx, secretValues);
    case 'script':
      return runScript(parsed, request, ctx, secretValues);
    case 'export':
      return runExport(parsed, request, ctx);
    default:
      return done(2, [`FAIL keeper: "${parsed.mode}" is handled by the client, not the keeper`]);
  }
}

/** @param {KeeperContext} ctx @param {string} what */
function statusHeadline(ctx, what) {
  const info = ctx.info;
  return [
    `ok keeper ${what}`,
    `pid ${String(info.pid ?? process.pid)}`,
    `hash ${String(info.hash ?? '?')}`,
    String(info.pipe ?? ''),
  ].join(' · ');
}

/** @param {KeeperContext} ctx */
async function statusLines(ctx) {
  const info = ctx.info;
  const stats = ctx.stats();
  const rssMb = Math.round(process.memoryUsage().rss / 1048576);
  /** @type {Record<string, any>} */
  let engineStatus = {};
  let engineState = 'loading';
  let pwVersion;
  try {
    const eng = await Promise.race([ctx.engine(), new Promise((resolve) => setTimeout(() => resolve(undefined), 50))]);
    if (eng) {
      engineStatus = statusOf(eng);
      engineState = 'ready';
      pwVersion = eng.versions?.['playwright-core'];
    }
  } catch {
    engineState = `failed: ${ctx.engineError()}`;
  }
  const browserRss = Number(engineStatus.browserRssMb ?? engineStatus.rssMb ?? 0);
  const uptimeMs = Date.now() - Number(info.startedAt ?? Date.now());
  // Four lines, not two: with the full pipe name the headline plus counters passed 160 characters,
  // counters plus versions pass 40 tokens, and the absolute bin path is (like the doctor line) the
  // one thing allowed past the cap — so it stands alone, sharing its budget with nothing.
  const lines = [
    [
      statusHeadline(ctx, 'running'),
      `up ${formatMs(uptimeMs / 1000)} s`,
      `rss ${String(rssMb)} MB${browserRss > 0 ? ` (browser ${String(browserRss)} MB)` : ''}`,
    ].join(' · '),
    [
      `jobs ${String(stats.jobs)}`,
      `lanes ${String(Array.isArray(engineStatus.lanes) ? engineStatus.lanes.length : (engineStatus.lanes ?? 0))}`,
      `routes ${String(engineStatus.routes ?? 0)}`,
      `sessions ${String(ctx.sessions.size)}`,
      `queued ${String(ctx.queues.pending())}`,
    ].join(' · '),
    [
      `browser-inspector ${String(info.version ?? '?')}`,
      `playwright-core ${String(info.pwVersion ?? engineStatus.pwVersion ?? pwVersion ?? '?')}`,
      `node ${process.versions.node}`,
      `browser ${String(engineStatus.browser ?? engineState)}`,
    ].join(' · '),
    String(info.binPath ?? '').replaceAll('\\', '/'),
  ];
  for (const s of ctx.sessions.values()) {
    lines.push(
      `session ${s.name} · cwd ${s.cwd.replaceAll('\\', '/')} · out ${s.out.replaceAll('\\', '/')} · idle ${formatMs((Date.now() - s.lastUsedAt) / 1000)} s`,
    );
  }
  return lines;
}

/**
 * `browser-inspector <config.json>`: the config is loaded HERE too (the client validated it already — cheap), the
 * snapshots are spread over `parallel` lanes by `planLanes` (longest first), each lane is a queue key, so two batches from two
 * shells serialize per lane and report the wait as `queuedMs`.
 * @param {Extract<import('./cli.mjs').ParsedArgs, { mode: 'batch' }>} parsed
 * @param {KeeperRequest} request
 * @param {KeeperContext & { onProgress?: (p: KeeperProgress['progress']) => void }} ctx
 * @param {string[]} secretValues
 * @returns {Promise<KeeperDone>}
 */
async function runBatch(parsed, request, ctx, secretValues) {
  const cwd = request.cwd;
  const configPath = path.resolve(cwd, parsed.configPath);
  /** @type {Record<string, any>} */
  let config;
  try {
    config = loadConfig(configPath, cwd);
  } catch (error) {
    if (error instanceof ConfigError)
      return done(
        2,
        error.errors.map((e) => `config: ${e}`),
      );
    return done(2, [`config: ${messageOf(error)}`]);
  }
  const stamp = parsed.options.stamp ?? formatStamp(new Date());
  const runDir = path.join(config.outputDir, stamp);
  const only = parsed.options.only;
  const selected = config.snapshots
    .map((/** @type {Record<string, any>} */ snapshot, /** @type {number} */ index) => ({ snapshot, index }))
    .filter(
      (/** @type {{ snapshot: Record<string, any> }} */ s) => only.length === 0 || only.includes(s.snapshot.name),
    );
  if (selected.length === 0) {
    return done(2, [
      `--only: no snapshot named ${only.join(', ')} (config has ${config.snapshots.map((s) => s.name).join(', ')})`,
    ]);
  }
  const parallel = Math.max(1, Math.min(parsed.options.parallel ?? config.parallel ?? 1, selected.length));
  const values = request.values ?? {};
  const files = request.files ?? {};
  const redactor = (/** @type {string} */ text) => redact(text, secretValues);
  const startedAt = performance.now();
  const startedIso = new Date().toISOString();
  /** @type {TimingMode | undefined} */
  let runMode;
  /** @type {{ code?: string, message: string }[]} */
  const fatal = [];

  // `auth`: ONE login (or the state file) before the lanes, then `storageStateFor` per snapshot —
  // a config that validates its `auth` block and then runs anonymously would report
  // `completed: true` on a login screen. A failure here is the run's failure: `FAIL E_AUTH: …`.
  /** @type {import('./auth.mjs').SessionInfo | undefined} */
  let authSession;
  if (config.auth) {
    try {
      const engine = await ctx.engine().catch((error) => {
        throw new EngineUnavailableError(error);
      });
      authSession = await ensureSession(config.auth, {
        engine: /** @type {any} */ (engine),
        baseDir: path.dirname(configPath),
        values,
        secretValues,
        log: ctx.log,
      });
    } catch (error) {
      // An `AuthError` and anything else the login threw (a step's TypeError, a network error)
      // are the same thing to the run: no session, no run — under the auth code.
      const code = error instanceof EngineUnavailableError ? error.code : E_AUTH;
      ctx.log(`auth failed: ${redactor(messageOf(error))}`);
      return done(2, [redactor(failLine(code, messageOf(error)))]);
    }
  }

  // Lane numbers from the planner (`schedule.mjs`), not `k % parallel`: the assignment follows the
  // estimated cost, the ORDER of results and of everything built from them stays the config's.
  const plan = planLanes(
    selected.map((s) => s.snapshot),
    parallel,
  );
  const results = await Promise.all(
    selected.map(({ snapshot, index }, k) => {
      const lane = plan[k];
      const key = `lane:${String(lane)}`;
      return ctx
        .runJob(key, async ({ queuedMs, engine, mode }) => {
          runMode ??= mode;
          const dir = path.join(runDir, snapshot.name);
          const laneOpts = {
            lane,
            mode,
            queuedMs,
            fresh: parsed.options.fresh,
            values,
            secretValues,
            files,
            cwd,
            stamp,
            runDir,
            config,
            configPath,
            auth: config.auth,
            storageState: storageStateFor(snapshot, authSession),
            snapshotIndex: index,
            address: `snapshots[${String(index)}]`,
            index: k,
            total: selected.length,
            redact: redactor,
            log: ctx.log,
          };
          const t0 = performance.now();
          /** @type {FlowOutcome} */
          let result;
          try {
            const r = await engine.runFlow(snapshot, dir, laneOpts);
            result = await settleFlow(r, { snapshot, dir, stamp, version: String(ctx.info.version ?? ''), redactor });
            result.ms ??= Math.round(performance.now() - t0);
          } catch (error) {
            const code = /** @type {{ code?: string }} */ (error).code;
            const message = messageOf(error);
            ctx.log(`runFlow ${snapshot.name} threw: ${message}`);
            if (code === 'E_BROWSER_MISSING' || code === 'E_CONFIG') fatal.push({ code, message });
            const ms = Math.round(performance.now() - t0);
            result = {
              name: snapshot.name,
              dir,
              completed: false,
              failure: message,
              files: [],
              ms,
              manifestReport: manifestReportOf(false, { lane, queuedMs, totalMs: ms }),
            };
          }
          // The lane's scrub goes to the lane queue NOW — after this answer, before the next
          // client on the lane (§2.3): its cost is the next caller's `queuedMs`, never this run's
          // `totalMs`. A fresh-context run left no lane dirty; a fake engine has no scrub; an
          // in-process run closes the browser right after the answer and has nobody to scrub for.
          const scrubber = engine.scrubIfDirty ?? engine.scrub;
          if (ctx.persistent && scrubber && result.timing?.ctx !== 'fresh') {
            ctx.afterAnswer(key, engine, () => scrubber(lane));
          }
          ctx.onProgress?.({
            snapshot: snapshot.name,
            completed: result.completed,
            ms: result.ms ?? 0,
            index: k,
            total: selected.length,
          });
          return result;
        })
        .catch((error) => {
          if (!(error instanceof EngineUnavailableError)) throw error;
          fatal.push({ code: error.code, message: error.message });
          return undefined;
        });
    }),
  );

  if (fatal.length > 0) {
    const seen = new Set();
    return done(
      2,
      fatal.map((f) => failLine(f.code ?? 'E_FATAL', f.message)).filter((line) => !seen.has(line) && seen.add(line)),
    );
  }
  const flows = /** @type {FlowOutcome[]} */ (results);
  const totalMs = Math.round(performance.now() - startedAt);
  const mode = runMode ?? 'warm';
  const written = flows.flatMap((r) => r.files);
  /** @type {string[]} */
  const lines = [];

  // The run-level manifest and JUnit are the keeper's, not the engine's: the engine knows one
  // snapshot at a time, the keeper knows the run (`_manifest.json` is what WP9's budget reads).
  // Both are written asynchronously and in parallel — they must land before the done line (the
  // gate reads them right after), but a Defender scan on one must not serialize the other.
  try {
    const engineStatus = statusOf(await ctx.engine());
    const manifest = buildManifest(
      {
        stamp,
        config: configPath,
        version: String(ctx.info.version ?? ''),
        startedAt: startedIso,
        timing: {
          mode,
          ...(mode === 'first' && ctx.info.keeperStartMs !== undefined
            ? { keeperStartMs: ctx.info.keeperStartMs }
            : {}),
          ...(Number(engineStatus.launchMs) > 0 ? { launchMs: Number(engineStatus.launchMs) } : {}),
          clientMs: totalMs,
        },
      },
      flows.map((r) => ({ name: r.name, report: r.manifestReport, dir: r.dir })),
    );
    for (const [i, entry] of manifest.snapshots.entries()) {
      if (flows[i]?.failure !== undefined && !flows[i].completed) entry.failure = flows[i].failure;
    }
    const manifestPath = path.join(runDir, '_manifest.json');
    const writes = [
      mkdir(runDir, { recursive: true }).then(() =>
        writeFile(manifestPath, redactor(`${JSON.stringify(manifest, null, 2)}\n`), 'utf8'),
      ),
    ];
    written.push(manifestPath);
    if (parsed.options.junit !== undefined) {
      const junitPath = path.resolve(cwd, parsed.options.junit);
      writes.push(
        mkdir(path.dirname(junitPath), { recursive: true }).then(() =>
          writeFile(
            junitPath,
            renderJUnit(path.basename(configPath), manifest.snapshots, { redact: redactor }),
            'utf8',
          ),
        ),
      );
      written.push(junitPath);
    }
    await Promise.all(writes);
  } catch (error) {
    lines.push(`FAIL run manifest: ${messageOf(error)}`);
  }

  const completed = flows.filter((r) => r.completed).length;
  lines.push(
    `${completed === flows.length ? 'ok' : 'FAIL'} ${String(completed)}/${String(flows.length)} completed · ${formatMs(totalMs)} ms · ${mode} · ${relPath(runDir, cwd)}`,
  );
  for (const r of flows) {
    if (!r.completed)
      lines.push(`FAIL ${r.name}${r.failure ? ` · ${redactor(r.failure)}` : ''} · ${relPath(r.dir, cwd)}/report.md`);
  }
  const exit = parsed.options.failOnIncomplete && completed < flows.length ? 1 : 0;
  return done(exit, lines.map(redactor), written, {
    mode,
    timing: { mode, totalMs, queuedMs: flows[0]?.timing?.queuedMs ?? 0 },
  });
}

/**
 * @typedef {object} FlowOutcome
 * @property {string} name
 * @property {string} dir
 * @property {boolean} completed
 * @property {number} [ms]
 * @property {string[]} files absolute paths written for this snapshot
 * @property {Record<string, any>} [timing]
 * @property {string} [failure]
 * @property {ManifestReport} manifestReport what the run manifest reads
 */

/** @typedef {import('./types.js').Timing} Timing */
/** @typedef {Pick<Report, 'completed' | 'navigationError' | 'steps' | 'timing'>} ManifestReport */

/**
 * The part of a report the run manifest reads, for a flow that returned a summary (a fake engine)
 * or none at all (`runFlow` threw): the timing gets every field so a budget reader never sees
 * `undefined`, and the missing measurements are honest zeros, not guesses.
 * @param {boolean} completed
 * @param {Record<string, any>} [timing]
 * @returns {ManifestReport}
 */
function manifestReportOf(completed, timing = {}) {
  /** @type {Timing} */
  const full = {
    mode: 'warm',
    ctx: 'reused',
    tab: 'kept',
    lane: 0,
    queuedMs: 0,
    scrubMs: 0,
    gotoMs: 0,
    stepsMs: 0,
    captureMs: 0,
    writeMs: 0,
    totalMs: 0,
    cacheHits: 0,
    cacheHitsDocument: 0,
    ...timing,
  };
  return { completed, steps: [], timing: full };
}

/** A `runFlow` result that is a full report (the real engine) rather than a summary (a fake). */
const isReport = (/** @type {Report | FlowResult} */ r) =>
  Array.isArray(/** @type {Report} */ (r).steps) && /** @type {Report} */ (r).timing !== undefined;

/**
 * Turn what `runFlow` returned into one outcome: a `Report` is written to disk here (report.json,
 * report.md, elements.md, text.txt, `_manifest.json` — the artifact order `writeArtifacts` fixes),
 * a `FlowResult` is taken as is with a minimal report synthesized for the run manifest.
 * @param {Report | FlowResult} r
 * @param {{ snapshot: Record<string, any>, dir: string, stamp: string, version: string, redactor: (t: string) => string }} input
 * @returns {Promise<FlowOutcome>}
 */
async function settleFlow(r, input) {
  const { snapshot, dir, stamp, version, redactor } = input;
  if (isReport(r)) {
    const report = /** @type {Report} */ (r);
    const { written } = await writeArtifacts(
      dir,
      report,
      {},
      {
        render: snapshot.render,
        redact: redactor,
        manifest: { type: snapshot.type, url: snapshot.url, stamp, version, render: snapshot.render },
      },
    );
    return {
      name: snapshot.name,
      dir,
      completed: report.completed,
      ms: report.timing.totalMs,
      files: written.map((f) => path.join(dir, f)),
      timing: report.timing,
      failure: failureOf(report),
      manifestReport: report,
    };
  }
  const summary = /** @type {FlowResult} */ (r);
  const manifestReport = manifestReportOf(summary.completed, { totalMs: summary.ms ?? 0, ...(summary.timing ?? {}) });
  return {
    name: snapshot.name,
    dir,
    completed: summary.completed,
    ms: summary.ms,
    files: summary.files ?? [],
    timing: manifestReport.timing,
    failure: summary.failure,
    manifestReport,
  };
}

/** @param {KeeperRequest} request @param {{ session?: string, out?: string }} options */
const sessionName = (request, options) => request.session ?? options.session ?? 'default';

/**
 * @param {Extract<import('./cli.mjs').ParsedArgs, { mode: 'session' }>} parsed
 * @param {KeeperRequest} request
 * @param {KeeperContext} ctx
 * @param {string[]} secretValues
 * @returns {Promise<KeeperDone>}
 */
async function runSession(parsed, request, ctx, secretValues) {
  const name = sessionName(request, parsed.options);
  const cwd = request.cwd;
  // Every secret this process has seen, not this request's list (§2.6, per session): the value
  // filled three commands ago is still `***` in this command's `get --value` line.
  const redactor = ctx.redactAll;
  const job = ctx.runJob(`session:${name}`, async ({ queuedMs, engine, mode }) => {
    if (!engine.runCommand) return done(2, ['FAIL keeper: this engine has no session commands (runCommand)']);
    const outFlag = request.out ?? parsed.options.out;
    const entry = ctx.touchSession(name, {
      cwd,
      ...(outFlag !== undefined ? { out: path.resolve(cwd, outFlag) } : {}),
    });
    const t0 = performance.now();
    /** @type {JobResult} */
    let result;
    try {
      result = await engine.runCommand(name, parsed.step, {
        command: parsed.command,
        alias: parsed.alias,
        options: parsed.options,
        cwd,
        out: entry.out,
        values: request.values ?? {},
        secretValues,
        files: request.files ?? {},
        mode,
        queuedMs,
        redact: redactor,
        log: ctx.log,
      });
    } catch (error) {
      ctx.log(`runCommand ${parsed.command} threw: ${messageOf(error)}`);
      result = { exit: 2, lines: [`FAIL ${parsed.alias} · ${redactor(messageOf(error).split('\n')[0])}`] };
    }
    // The registry follows the engine: a session the engine no longer has (closed, never opened)
    // must not keep the keeper alive for an hour.
    const open = engine.session ? engine.session(name) !== undefined : parsed.command !== 'close';
    if (!open) ctx.dropSession(name);
    const exit = parsed.options.soft && result.exit === 1 ? 0 : result.exit;
    return done(exit, (result.lines ?? []).map(redactor), result.files ?? [], {
      mode,
      timing: { ...(result.timing ?? {}), mode, queuedMs, totalMs: Math.round(performance.now() - t0) },
    });
  });
  return engineOr(job);
}

/**
 * `browser-inspector script <file>`: the client read the file (`files[<file>]`), the engine runs the lines in one go.
 * @param {Extract<import('./cli.mjs').ParsedArgs, { mode: 'script' }>} parsed
 * @param {KeeperRequest} request
 * @param {KeeperContext} ctx
 * @param {string[]} secretValues
 * @returns {Promise<KeeperDone>}
 */
async function runScript(parsed, request, ctx, secretValues) {
  const name = sessionName(request, {});
  const cwd = request.cwd;
  const fileEntry = request.files?.[parsed.file];
  if (!fileEntry) return done(2, [`script: the client sent no content for ${parsed.file}`]);
  const text =
    fileEntry.base64 !== undefined
      ? Buffer.from(fileEntry.base64, 'base64').toString('utf8')
      : readFileOr(fileEntry.path);
  if (text === undefined) return done(2, [`script: cannot read ${String(fileEntry.path ?? parsed.file)}`]);
  const lines = text.split(/\r?\n/u);
  const redactor = ctx.redactAll;
  const job = ctx.runJob(`session:${name}`, async ({ queuedMs, engine, mode }) => {
    if (!engine.runScript) return done(2, ['FAIL keeper: this engine has no script runner (runScript)']);
    const outFlag = request.out ?? parsed.options.out;
    // A script's lines are session commands (`open`, `fill`, `close`), so the session it leaves
    // open is the keeper's to hold — exactly like `runSession`. Without this the engine had a
    // session the registry knew nothing about: `status` said `sessions 0`, the idle timer took the
    // browser down after IDLE_MS instead of the session's TTL (§2.5), a due recycle was not
    // deferred under it, and `script` never refreshed the session it was driving. `out` comes from
    // the entry, so a `script` without `--out` cannot overwrite the directory `open --out DIR` set.
    const entry = ctx.touchSession(name, {
      cwd,
      ...(outFlag !== undefined ? { out: path.resolve(cwd, outFlag) } : {}),
    });
    const t0 = performance.now();
    /** @type {JobResult} */
    let result;
    try {
      result = await engine.runScript(lines, {
        session: name,
        cwd,
        out: entry.out,
        values: request.values ?? {},
        secretValues,
        files: request.files ?? {},
        mode,
        queuedMs,
        redact: redactor,
        log: ctx.log,
      });
    } catch (error) {
      result = { exit: 2, lines: [`FAIL script · ${redactor(messageOf(error).split('\n')[0])}`] };
    }
    if (engine.session && engine.session(name) === undefined) ctx.dropSession(name);
    return done(result.exit, (result.lines ?? []).map(redactor), result.files ?? [], {
      mode,
      timing: { ...(result.timing ?? {}), mode, queuedMs, totalMs: Math.round(performance.now() - t0) },
    });
  });
  return engineOr(job);
}

/** @param {string | undefined} file */
function readFileOr(file) {
  if (!file) return undefined;
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return undefined;
  }
}

/**
 * @param {Extract<import('./cli.mjs').ParsedArgs, { mode: 'export' }>} parsed
 * @param {KeeperRequest} request
 * @param {KeeperContext} ctx
 * @returns {Promise<KeeperDone>}
 */
async function runExport(parsed, request, ctx) {
  const name = sessionName(request, parsed.options);
  const cwd = request.cwd;
  const job = ctx.runJob(`session:${name}`, async ({ engine, mode }) => {
    if (!engine.exportFlow) return done(2, ['FAIL keeper: this engine cannot export (exportFlow)']);
    const known = ctx.sessions.get(name);
    try {
      const result = await engine.exportFlow(name, {
        file: path.resolve(cwd, parsed.file),
        force: parsed.options.force,
        cwd,
        out: known?.out ?? path.resolve(cwd, DEFAULT_OUTPUT_DIR),
      });
      return done(result.exit, (result.lines ?? []).map(ctx.redactAll), result.files ?? [], { mode });
    } catch (error) {
      return done(2, [ctx.redactAll(`FAIL export · ${messageOf(error).split('\n')[0]}`)]);
    }
  });
  return engineOr(job);
}
