// smoke-gate.test.mjs — the drop-in guarantee for the app-factory gate (AC-1, AC-2, AC-17).
//
// `tools/scripts/smoke-browser.mjs` in app-factory serves four static Angular builds, spawns
// `node <pipeline> <config> --stamp X` and reads `<outputDir>/X/<name>/report.json` with
// `evaluateReports()`. This file repeats EXACTLY that path against `bin/bi.mjs`: the same config
// (the fixture is a verbatim copy of `read.config.browser-inspector.json`, only the ports are
// rewritten to this package's range 4571–4574), a copy of `serveStatic` (SPA fallback and a MIME
// table where `.js` is `text/javascript` — served as octet-stream, an Angular module is never
// executed), and a verbatim copy of `evaluateReports()` — if app-factory's reading of the report
// ever disagrees with what `bi` writes, this test goes red before the PR does.
//
// Three modes, because they are three code paths that must produce one result:
//   --no-daemon      the CI path (`CI=true` in the gate): engine in the client process;
//   keeper, twice    the local path: the second run proves the scrub between runs AND between
//                    snapshots — `dziennik-uczen` sees the anonymous dashboard after the teacher
//                    logged in, `nowiro-jezyk` reads the Polish heading after the previous run
//                    switched the language to English (DESIGN.md §2.3);
//   --parallel 3     three persistent lanes, the same `completed` set.
// report.json from all three is identical modulo `timing` / `engine` (and per-step milliseconds).
//
// Needs the app-factory builds next to this repository (`../app-factory/dist/apps/*/browser`,
// or `APP_FACTORY_DIR`) and a Chrome/Edge — without them the file skips and says why.
import { spawn } from 'node:child_process';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PACKAGE_DIR, bi, cleanup, makeEnv, stopKeeper } from '../fixtures/keeper-harness.mjs';

const REPO_ROOT = path.resolve(PACKAGE_DIR, '..', '..');
const APP_FACTORY = path.resolve(process.env.APP_FACTORY_DIR ?? path.join(REPO_ROOT, '..', 'app-factory'));
const FIXTURE_CONFIG = path.join(PACKAGE_DIR, 'fixtures', 'app-factory.config.json');

/** The app-factory port table (`APPS` in smoke-browser.mjs) mapped onto this package's range. */
const APPS = [
  { name: 'nowiro', gatePort: 4311, port: 4571 },
  { name: 'business-wizard', gatePort: 4312, port: 4572 },
  { name: 'bookstore', gatePort: 4313, port: 4573 },
  { name: 'school-journal', gatePort: 4314, port: 4574 },
];
/** A port nobody listens on — the navigation-error case. */
const DEAD_PORT = 4579;

const buildDir = (/** @type {string} */ app) => path.join(APP_FACTORY, 'dist', 'apps', app, 'browser');
const buildsPresent = APPS.every((app) => existsSync(path.join(buildDir(app.name), 'index.html')));
const skipSmoke = process.env.BI_SKIP_SMOKE === '1' || process.env.BI_SKIP_SMOKE === 'true';
const skip = skipSmoke || !buildsPresent;
if (!buildsPresent && !skipSmoke) {
  console.warn(`[smoke-gate] app-factory builds not found under ${APP_FACTORY}/dist/apps — compat gate skipped`);
}

// ---------------------------------------------------------------------------------------------
// Copied from D:/github/app-factory/tools/scripts/smoke-browser.mjs — the gate's own reading of
// report.json. Kept verbatim (comments included) so a diff against the original is empty.
// ---------------------------------------------------------------------------------------------

/**
 * Ocena raportow po przebiegu — czysta funkcja, przypieta specem obok. Brama pada,
 * gdy snapshotu brakuje albo gdy raport mowi `completed: false`; powod idzie do
 * wyjscia, zeby czlowiek nie musial otwierac plikow, zeby wiedziec CO pekl.
 */
export function evaluateReports(expectedNames, reports) {
  const failures = [];
  for (const name of expectedNames) {
    const report = reports.get(name);
    if (!report) {
      failures.push(`${name}: brak report.json — snapshot nie powstal`);
    } else if (report.completed !== true) {
      const step = (report.steps ?? []).find((s) => s.ok === false);
      failures.push(
        `${name}: ${report.navigationError ?? (step ? `krok "${step.description}" — ${step.error ?? ''}` : 'incomplete')}`,
      );
    }
  }
  return { ok: failures.length === 0, failures };
}

const MIME = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript'],
  ['.css', 'text/css'],
  ['.json', 'application/json'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.ico', 'image/x-icon'],
  ['.woff2', 'font/woff2'],
]);

/**
 * `serveStatic` from smoke-browser.mjs with a promise around `listen` and a closable handle: a path
 * without an extension gets `index.html` (client-side routing), everything else its MIME type.
 * @param {string} rootDir
 * @param {number} port
 * @returns {Promise<{ close: () => Promise<void> }>}
 */
function serveStatic(rootDir, port) {
  const server = createServer((req, res) => {
    const clean = decodeURIComponent((req.url ?? '/').split('?')[0]);
    let file = path.join(rootDir, clean);
    if (!path.extname(file)) file = path.join(rootDir, 'index.html');
    if (!file.startsWith(rootDir) || !existsSync(file) || statSync(file).isDirectory()) {
      res.writeHead(404).end('not found');
      return;
    }
    res.writeHead(200, { 'content-type': MIME.get(path.extname(file)) ?? 'application/octet-stream' });
    createReadStream(file).pipe(res);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () =>
      resolve({
        close: () =>
          new Promise((done) => {
            server.closeAllConnections?.();
            server.close(() => done());
          }),
      }),
    );
  });
}

// ---------------------------------------------------------------------------------------------

/**
 * Fields that legitimately differ between two runs of the same flow: timing and engine (the two
 * DESIGN.md names), per-step milliseconds, and the wall-clock stamps the recorder puts on console
 * and network entries. Console WARNINGS are dropped too: the nowiro page compiles WebGL shaders
 * and Chrome's GPU process logs a driver warning (`THREE.WebGLProgram: … X4122`) only on the first
 * compile of a renderer — it depends on whether the tab is fresh, not on which process ran the
 * engine. The same goes for the `favicon.ico` 404 of a build without an icon: Chrome fetches a
 * favicon once per origin and remembers the failure browser-wide, so the console error shows up
 * in whichever run first visits the origin in a given browser. And `text.txt` plus the
 * `mat-option` rows of the element map are read while the Material select overlay of the journal
 * flows is still fading out (the last step is a screenshot, the evidence follows within
 * milliseconds) — whether the fade has finished is animation timing, not engine behaviour, so
 * the page text is compared by length class only and overlay options are dropped. Everything
 * else — completed, steps, extracts, console errors, failed requests, screenshots, the rest of
 * the element map — must be identical whatever process ran the engine.
 * @param {any} report
 */
function comparable(report) {
  const r = JSON.parse(JSON.stringify(report));
  delete r.timing;
  delete r.engine;
  for (const step of r.steps ?? []) delete step.ms;
  if (r.text) r.text = { truncated: r.text.truncated, nonEmpty: String(r.text.content ?? '').length > 0 };
  if (r.elements) {
    r.elements.entries = (r.elements.entries ?? []).filter(
      (/** @type {any} */ e) => !String(e.selector ?? '').includes('mat-option'),
    );
    delete r.elements.total;
  }
  if (r.console) {
    r.console.entries = (r.console.entries ?? []).filter(
      (/** @type {any} */ e) => e.type === 'error' && !String(e.location ?? '').includes('favicon.ico'),
    );
    delete r.console.total;
  }
  for (const entry of r.console?.entries ?? []) delete entry.at;
  for (const entry of r.network?.failed ?? []) {
    delete entry.id;
    delete entry.startedAt;
    delete entry.ms;
  }
  return r;
}

describe.skipIf(skip)('compat: app-factory gate through bin/bi.mjs', () => {
  /** @type {Array<{ close: () => Promise<void> }>} */
  let servers = [];
  /** @type {ReturnType<typeof makeEnv>} */
  let harness;
  /** @type {string} */
  let work;
  /** @type {string} */
  let configPath;
  /** @type {string} */
  let outDir;
  /** @type {string[]} */
  let expected;
  /** @type {Map<string, Map<string, any>>} stamp → name → report.json */
  const runs = new Map();
  /** @type {Map<string, any>} stamp → _manifest.json of the run */
  const manifests = new Map();

  beforeAll(async () => {
    servers = await Promise.all(APPS.map((app) => serveStatic(buildDir(app.name), app.port)));
    // The real engine: the harness wires the fake one by default (keeper tests), we drop it.
    harness = makeEnv();
    delete harness.env.BI_ENGINE_MODULE;
    delete harness.env.BI_FAKE_LOG;
    work = await mkdtemp(path.join(os.tmpdir(), 'bi-gate-'));
    // The fixture config verbatim, ports rewritten; outputDir relative to the config like the gate's.
    let text = readFileSync(FIXTURE_CONFIG, 'utf8');
    for (const app of APPS)
      text = text.replaceAll(`localhost:${String(app.gatePort)}`, `localhost:${String(app.port)}`);
    const config = JSON.parse(text);
    config.outputDir = './.scribe/browser-inspector';
    expected = config.snapshots.map((/** @type {{ name: string }} */ s) => s.name);
    configPath = path.join(work, 'read.config.browser-inspector.json');
    await writeFile(configPath, JSON.stringify(config, null, 2));
    outDir = path.join(work, '.scribe', 'browser-inspector');
    await mkdir(outDir, { recursive: true });
  }, 60_000);

  afterAll(async () => {
    if (harness) {
      await stopKeeper(harness);
      cleanup(harness);
    }
    await Promise.all(servers.map((s) => s.close()));
    if (work) await rm(work, { recursive: true, force: true, maxRetries: 3 }).catch(() => undefined);
  });

  /**
   * `node bin/bi.mjs <config> --stamp X …` exactly like the gate, then the gate's reading of the
   * reports. Records report.json and _manifest.json of the run for the cross-mode assertions.
   * @param {string} stamp
   * @param {string[]} extra
   */
  async function gate(stamp, extra) {
    const result = await bi([configPath, '--stamp', stamp, ...extra], harness);
    const reports = new Map();
    for (const name of expected) {
      const file = path.join(outDir, stamp, name, 'report.json');
      if (existsSync(file)) reports.set(name, JSON.parse(readFileSync(file, 'utf8')));
    }
    runs.set(stamp, reports);
    const manifestFile = path.join(outDir, stamp, '_manifest.json');
    const manifest = existsSync(manifestFile) ? JSON.parse(readFileSync(manifestFile, 'utf8')) : undefined;
    manifests.set(stamp, manifest);
    const verdict = evaluateReports(expected, reports);
    if (manifest) {
      const per = manifest.snapshots
        .map(
          (/** @type {any} */ s) =>
            `${s.name} ${String(s.ms)} ms (lane ${String(s.lane)}, q ${String(s.queuedMs)}, scrub ${String(s.scrubMs)}, ${s.tab})`,
        )
        .join(' · ');
      console.info(
        `[smoke-gate] ${stamp} ${extra.join(' ') || 'keeper'}: mode ${manifest.timing.mode} · ${String(manifest.timing.clientMs)} ms client · ${String(result.ms)} ms process · ${per}`,
      );
    }
    return { ...result, reports, manifest, verdict };
  }

  it('--no-daemon: 6/6 completed, report.json in the old shape, exit 0', async () => {
    const run = await gate('2026-09-02_10-01', ['--no-daemon']);
    expect(run.stderr).toBe('');
    expect(run.code).toBe(0);
    expect(run.verdict).toEqual({ ok: true, failures: [] });
    expect(run.manifest.timing.mode).toBe('no-daemon');
    for (const name of expected) {
      const report = run.reports.get(name);
      expect(typeof report.completed).toBe('boolean');
      expect(report.completed).toBe(true);
      // The old shape the gate reads: description/ok per executed step, `error` only on failure,
      // navigationError only when the navigation failed — never `undefined` serialized as absence.
      for (const step of report.steps) {
        expect(typeof step.description).toBe('string');
        expect(typeof step.ok).toBe('boolean');
        expect('error' in step).toBe(false);
      }
      expect('navigationError' in report).toBe(false);
      expect(report.timing.mode).toBe('no-daemon');
      expect(existsSync(path.join(outDir, '2026-09-02_10-01', name, 'report.md'))).toBe(true);
    }
    expect(run.reports.get('nowiro-jezyk').extracts['naglowek-pl'].value).toMatch(/[ąćęłńóśźż]/u);
    expect(run.reports.get('nowiro-jezyk').extracts['jezyk-dokumentu'].value).toBe('en');
    expect(run.reports.get('nowiro-strona').screenshots).toEqual(['page.png']);
    expect(run.stdout).toContain('ok 6/6 completed');
  }, 180_000);

  it('keeper, twice in a row: the second run sees a scrubbed tab (anonymous dashboard, Polish heading)', async () => {
    const first = await gate('2026-09-02_10-02', []);
    expect(first.stderr).toBe('');
    expect(first.code).toBe(0);
    expect(first.verdict).toEqual({ ok: true, failures: [] });
    // Auto-started keeper: the first job after launch is `first`, never a fallback into the client.
    expect(first.stdout).not.toContain('keeper: fallback');
    expect(['first', 'warm']).toContain(first.manifest.timing.mode);

    const second = await gate('2026-09-02_10-03', []);
    expect(second.stderr).toBe('');
    expect(second.code).toBe(0);
    expect(second.verdict).toEqual({ ok: true, failures: [] });
    expect(second.manifest.timing.mode).toBe('warm');
    for (const name of expected) expect(second.reports.get(name).timing.mode).toBe('warm');
    // The scrub proof: the previous run left a teacher logged in (localStorage) and the language
    // switched to English — a dirty tab fails `waitFor [data-testid=dashboard-anonymous]` and
    // extracts the English heading.
    expect(second.reports.get('dziennik-uczen').completed).toBe(true);
    expect(second.reports.get('dziennik-nauczyciel').completed).toBe(true);
    expect(second.reports.get('nowiro-jezyk').extracts['naglowek-pl'].value).toMatch(/[ąćęłńóśźż]/u);
    expect(second.reports.get('nowiro-jezyk').extracts['naglowek-pl'].value).not.toMatch(/consulting/iu);
    // Persistent tab, reused context, scrub measured between snapshots on the same lane.
    const kept = second.manifest.snapshots.filter((/** @type {any} */ s) => s.tab === 'kept');
    expect(kept.length).toBeGreaterThanOrEqual(5);
    expect(second.manifest.snapshots.every((/** @type {any} */ s) => s.ctx === 'reused')).toBe(true);
    expect(second.manifest.snapshots.slice(1).every((/** @type {any} */ s) => s.scrubMs > 0)).toBe(true);
  }, 240_000);

  it('--parallel 3 through the keeper: three lanes, the same completed set', async () => {
    const run = await gate('2026-09-02_10-04', ['--parallel', '3']);
    expect(run.stderr).toBe('');
    expect(run.code).toBe(0);
    expect(run.verdict).toEqual({ ok: true, failures: [] });
    const lanes = new Set(run.manifest.snapshots.map((/** @type {any} */ s) => s.lane));
    expect([...lanes].sort()).toEqual([0, 1, 2]);
    const completed = (/** @type {Map<string, any> | undefined} */ reports) =>
      expected.filter((name) => reports?.get(name)?.completed === true).sort();
    expect(completed(run.reports)).toEqual(completed(runs.get('2026-09-02_10-01')));
    expect(completed(run.reports)).toEqual([...expected].sort());
  }, 180_000);

  it('report.json is identical across --no-daemon, keeper and --parallel modulo timing/engine', () => {
    const noDaemon = runs.get('2026-09-02_10-01') ?? new Map();
    for (const stamp of ['2026-09-02_10-02', '2026-09-02_10-03', '2026-09-02_10-04']) {
      const other = runs.get(stamp) ?? new Map();
      expect(other.size, `run ${stamp} missing`).toBe(expected.length);
      for (const name of expected) {
        expect(comparable(other.get(name)), `${stamp}/${name}`).toEqual(comparable(noDaemon.get(name)));
      }
    }
  });

  it('failures are results: `Error: uczen widzi przycisk nauczyciela` in steps[].error, navigationError only when navigation failed', async () => {
    const journal = `http://localhost:${String(APPS[3].port)}/`;
    const negative = {
      outputDir: './.scribe/negative',
      snapshots: [
        {
          name: 'dziennik-uczen-negatyw',
          type: 'flow',
          url: journal,
          steps: [
            { do: 'waitFor', selector: '[data-testid=dashboard-anonymous]' },
            {
              do: 'evaluate',
              name: 'uprawnienia-ucznia',
              expression:
                "(() => { const n = document.querySelectorAll('[data-testid=dashboard-anonymous]').length; if (n !== 0) throw new Error('uczen widzi przycisk nauczyciela'); return 'brak'; })()",
            },
            { do: 'screenshot', name: 'nigdy' },
          ],
        },
        { name: 'martwy-port', type: 'page', url: `http://localhost:${String(DEAD_PORT)}/`, navTimeoutMs: 5000 },
      ],
    };
    const file = path.join(work, 'negative.config.json');
    await writeFile(file, JSON.stringify(negative, null, 2));
    const result = await bi([file, '--stamp', '2026-09-02_10-05', '--no-daemon'], harness);
    expect(result.code).toBe(0); // a failed step is a result, not a crash (DESIGN.md §3.5)
    const dir = path.join(work, '.scribe', 'negative', '2026-09-02_10-05');
    const reports = new Map(
      negative.snapshots.map((s) => [s.name, JSON.parse(readFileSync(path.join(dir, s.name, 'report.json'), 'utf8'))]),
    );
    const verdict = evaluateReports(
      negative.snapshots.map((s) => s.name),
      reports,
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.failures[0]).toBe(
      'dziennik-uczen-negatyw: krok "evaluate uprawnienia-ucznia" — Error: uczen widzi przycisk nauczyciela',
    );
    const failed = reports.get('dziennik-uczen-negatyw');
    expect(failed.completed).toBe(false);
    expect(failed.steps.map((/** @type {any} */ s) => s.ok)).toEqual([true, false]);
    expect(failed.steps[1].error).toBe('Error: uczen widzi przycisk nauczyciela');
    expect(failed.skipped).toBe(1);
    expect('navigationError' in failed).toBe(false);
    expect(failed.screenshots).toEqual(['final.png']);
    expect(existsSync(path.join(dir, 'dziennik-uczen-negatyw', 'final.png'))).toBe(true);
    const dead = reports.get('martwy-port');
    expect(dead.completed).toBe(false);
    expect(typeof dead.navigationError).toBe('string');
    expect(verdict.failures[1]).toContain('martwy-port: ');
    expect(verdict.failures[1]).toContain(dead.navigationError);
    // --fail-on-incomplete is the only way to a non-zero exit for a batch.
    const strict = await bi([file, '--stamp', '2026-09-02_10-06', '--no-daemon', '--fail-on-incomplete'], harness);
    expect(strict.code).toBe(1);
  }, 120_000);

  it('bi lint-config on the gate config prints the three migration hints (AC-16)', async () => {
    const result = await bi(['lint-config', configPath], harness);
    expect(result.code).toBe(0);
    expect(result.lines).toEqual([
      '4× waitUntil "networkidle" → "settled" (−500…−1900 ms każdy; sonda: 666–2056 ms)',
      '7× wait ms (razem 4200 ms snu) → waitFor <selector> / wait --text',
      'parallel: 3 (6 flow → 3 lane)',
    ]);
  });
});
