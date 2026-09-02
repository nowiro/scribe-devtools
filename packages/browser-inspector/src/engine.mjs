// engine.mjs — ONE engine on playwright-core for both entrances (DESIGN.md §2.2, §2.3, §5, §6).
//
// The batch half (WP2): launch the system Chrome/Edge (chrome → msedge, `E_BROWSER_MISSING`
// with every attempt named), keep `scratch[0..N-1]` lanes — each a persistent context with ONE
// persistent tab that is scrubbed IN PLACE between runs (DOMStorage.clear + generation script +
// clearDataForOrigin + context resets + resetNavigationHistory, 12–35 ms measured) instead of a
// new tab (renderer dies with the tab: +160 ms on the next goto) — a prewarmed `spare`
// context+page pair for the runs that must be fresh (auth, video, `isolation: "fresh"`, `--fresh`),
// `runFlow` (navigation, steps under a deadline, final evidence, report.json/md + manifest on disk)
// and the health rules: a disconnected browser is fatal, a crashed renderer rebuilds the lane's
// tab at the next scrub, `BI_MAX_JOBS` / `BI_MAX_RSS_MB` recycle the browser BETWEEN jobs.
//
// The keeper (`keeper.mjs`) drives this through `createEngine(browserOpts, { log, env })`,
// `ready`, `runFlow`, `finishRun`, `status`, `recycle`, `on('disconnected')`, `close` — the same
// engine the `--no-daemon` path creates in-process. The session half (`runCommand`, `session`,
// `runScript`, `exportFlow`) is WP6's — it builds on `makeStepContext`, `resolveSelector`,
// `navigate`, `runStep` and `getLane` exported below, the same code batch steps run on.
//
// playwright-core is imported lazily inside `launchBrowser`: the unit tests hand the engine a fake
// browser and never pay the 270 ms import, and the keeper listens on its pipe BEFORE it imports.

import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { execFile, execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { ensureSession, resolveAuthValues, storageStateFor } from './auth.mjs';
import { finalEvidence } from './capture.mjs';
import { CliError, parseSessionCommand } from './cli.mjs';
import { isScriptComment, splitCommandLine } from './client.mjs';
import { degradeTo, isDeadline, withDeadline } from './deadline.mjs';
import { DEFAULT_VIEWPORT, GEN_SCRIPT, needsFreshContext, scrubPlan } from './isolation.mjs';
import { DEFAULT_OUTPUT_DIR, playwrightCoreVersion, sessionDir } from './paths.mjs';
import {
  formatDeltas,
  formatExport,
  formatFail,
  formatOk,
  formatOpen,
  formatShot,
  relPath,
  truncate,
} from './print.mjs';
import { attachRecorder, errorMessage, originOf, summarize } from './recorder.mjs';
import { maskSnapshotEntries, maskSnapshotValues, redact } from './redact.mjs';
import { buildManifest, buildReport, formatStepError, renderJUnit, writeArtifacts } from './report.mjs';
import {
  ExportError,
  exportFlow,
  formatJournalLine,
  journalLineCount,
  journalPath,
  readJournal,
  writeFlowExport,
} from './session-log.mjs';
import { waitSettled } from './settle.mjs';
import { boxJoin, compactSnapshot, resolveRef, sensitiveRefs, walkInteractive } from './snapshot.mjs';
import { RUNNERS, durableSelector } from './steps.run.mjs';
import { STEPS, describeStep, refFieldsOf, resolveStepName } from './steps.schema.mjs';

/** @typedef {import('./types.js').PageLike} PageLike */
/** @typedef {import('./types.js').ContextLike} ContextLike */
/** @typedef {import('./types.js').CdpLike} CdpLike */
/** @typedef {import('./recorder.mjs').Recorder} Recorder */
/** @typedef {import('./types.js').StepContext} StepContext */
/** @typedef {import('./types.js').Step} Step */
/** @typedef {import('./types.js').StepResult} StepResult */
/** @typedef {import('./types.js').Report} Report */
/** @typedef {import('./types.js').Timing} Timing */
/** @typedef {import('./types.js').TimingMode} TimingMode */
/** @typedef {import('./types.js').ScrubOp} ScrubOp */
/** @typedef {import('./types.js').LaneState} LaneState */

export const E_BROWSER_MISSING = 'E_BROWSER_MISSING';

/**
 * Headless flags on by default; `fastHeadless: false` turns them off. The first two: click 45–58 →
 * 25–54 ms measured. `--disable-gpu-compositing`: one second after every `load`, a delayed task
 * from blink's `widget_base.cc` releases the renderer's LayerTreeFrameSink (`ProxyMain::Stop`,
 * then `SetLayerTreeFrameSink` on the next paint) and the GPU-process round trip blocks the
 * renderer main thread for 80–490 ms (Chrome 152 headless, Windows, trace in
 * docs/handoff/FINAL.md). A warm run that starts 300 ms after the previous one lands exactly on
 * it — the bench's `bi-warm` was 746 ms against 355 ms for `bi-warm-tight`. Software compositing
 * has no frame sink to release; WebGL keeps working (only the layer-tree compositing moves to the
 * CPU), goto/click/screenshot stay at 16–48 ms.
 */
export const FAST_HEADLESS_ARGS = Object.freeze([
  '--disable-frame-rate-limit',
  '--disable-gpu-vsync',
  '--disable-gpu-compositing',
]);
export const MAX_JOBS_DEFAULT = 200;
export const MAX_RSS_MB_DEFAULT = 1024;
export const LANE_IDLE_MS_DEFAULT = 300_000;
/** A step's deadline sits above the Playwright timeout of the action so the action's own message wins. */
export const STEP_GRACE_MS = 2000;
/**
 * The RSS sample spawns a process (`tasklist` is 66–83 ms on Windows) — it runs in the background
 * after the answer, every N jobs, never on a job's own path (`sampleRss()`; the keeper schedules it).
 */
export const RSS_CHECK_EVERY = 10;
/**
 * One scrub op gets this long. A renderer whose main thread a step left spinning answers none of
 * the renderer-side calls (`Page.addScriptToEvaluateOnNewDocument`, `emulateMedia`, viewport) —
 * without a cap the NEXT run on the lane would block forever inside the scrub. On a timeout the
 * lane is treated like a crash: the tab is rebuilt (`page.close()` is browser-side and works).
 */
export const SCRUB_OP_MS_DEFAULT = 2000;
/** Default timeouts restored by the scrub (`resetContext`) — the config's `navTimeoutMs` default. */
const DEFAULT_TIMEOUT_MS = 30_000;
/** In-page storage clear of the scrub — the page is still on its origin, so this is ~1 ms. */
const STORAGE_CLEAR_EXPRESSION =
  '(() => { try { sessionStorage.clear(); } catch (e) {} try { localStorage.clear(); } catch (e) {} return true; })()';

const execFileAsync = promisify(execFile);

const PACKAGE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const now = () => performance.now();
const ms = (/** @type {number} */ from) => Math.round(now() - from);

/**
 * @typedef {object} BrowserOptions
 * @property {'chrome' | 'msedge' | string} [channel]
 * @property {string} [executablePath]
 * @property {boolean} [headless]
 * @property {readonly string[]} [args]
 * @property {boolean} [fastHeadless]
 * @property {'no-preference' | 'reduce'} [motion]
 */

export class BrowserMissingError extends Error {
  /** @param {string[]} attempts */
  constructor(attempts) {
    super(
      `${E_BROWSER_MISSING}: no usable browser.\n${attempts.map((a) => `  tried ${a}`).join('\n')}\n` +
        'Install Google Chrome or Microsoft Edge, or point browser.executablePath / BI_BROWSER_PATH at a Chromium binary.',
    );
    this.name = 'BrowserMissingError';
    this.code = E_BROWSER_MISSING;
    this.attempts = attempts;
  }
}

/**
 * What `launchBrowser` will try, in order — pure, so the order and the env overrides are a unit
 * test: `BI_BROWSER_PATH` / `executablePath` win outright, `BI_CHANNEL` / `channel` narrow the list,
 * `BI_BROWSER_ARGS` REPLACES the flags entirely (a container needs `--no-sandbox` and nothing else).
 * @param {BrowserOptions} [browser]
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {{ attempts: { channel?: string, executablePath?: string }[], headless: boolean, args: string[] }}
 */
export function launchPlan(browser = {}, env = process.env) {
  const headless = browser.headless !== false;
  const envArgs = env.BI_BROWSER_ARGS?.split(/\s+/u).filter(Boolean);
  const args = envArgs ?? [
    ...(headless && browser.fastHeadless !== false ? FAST_HEADLESS_ARGS : []),
    ...(browser.args ?? []),
  ];
  const executablePath = env.BI_BROWSER_PATH || browser.executablePath;
  if (executablePath) return { attempts: [{ executablePath }], headless, args };
  const channel = env.BI_CHANNEL || browser.channel;
  const channels = channel ? [channel] : ['chrome', 'msedge'];
  return { attempts: channels.map((c) => ({ channel: c })), headless, args };
}

/**
 * Launch the system browser. Every attempt and its failure is collected, so `E_BROWSER_MISSING`
 * says what was tried instead of a bare "could not launch".
 * @param {BrowserOptions} [browser]
 * @param {{ env?: NodeJS.ProcessEnv, chromium?: any }} [options] `chromium` injectable for tests
 * @returns {Promise<{ browser: any, channel: string, args: string[], launchMs: number }>}
 */
export async function launchBrowser(browser = {}, options = {}) {
  const plan = launchPlan(browser, options.env ?? process.env);
  const chromium = options.chromium ?? (await import('playwright-core')).chromium;
  const attempts = [];
  const started = now();
  for (const attempt of plan.attempts) {
    try {
      const launched = await chromium.launch({ headless: plan.headless, args: plan.args, ...attempt });
      return {
        browser: launched,
        channel: attempt.channel ?? path.basename(attempt.executablePath ?? 'custom'),
        args: plan.args,
        launchMs: ms(started),
      };
    } catch (error) {
      const label = attempt.channel ? `channel ${attempt.channel}` : `executablePath ${attempt.executablePath}`;
      attempts.push(`${label}: ${errorMessage(error)}`);
    }
  }
  throw new BrowserMissingError(attempts);
}

/** @param {number | number[] | undefined} pids @returns {number[]} */
const pidList = (pids) =>
  /** @type {number[]} */ (
    (Array.isArray(pids) ? pids : [pids]).filter((p) => typeof p === 'number' && Number.isInteger(p) && p > 0)
  );

/**
 * `tasklist /FO CSV /NH` → RSS in KB per pid. ONE call for every pid (a `/FI PID eq` per process
 * would be 70 ms each); the memory cell is the last one, quoted, with thousands separators.
 * @param {string} csv @param {number[]} pids
 */
function rssFromTasklist(csv, pids) {
  const wanted = new Set(pids);
  let kb = 0;
  for (const line of csv.split(/\r?\n/u)) {
    const cells = line.split('","');
    if (cells.length < 5) continue;
    const pid = Number(cells[1]);
    if (!wanted.has(pid)) continue;
    kb += Number((cells.at(-1) ?? '').replace(/[^0-9]/gu, '')) || 0;
  }
  return kb;
}

/** `ps -o rss= -p a,b` → RSS in KB, summed. @param {string} out */
const rssFromPs = (out) =>
  out
    .split(/\r?\n/u)
    .map((l) => Number(l.trim()))
    .filter((n) => Number.isFinite(n))
    .reduce((a, b) => a + b, 0);

/**
 * RSS of the browser's processes in MB, summed, best effort: `/proc` on Linux, `tasklist` on
 * Windows, `ps` elsewhere. `0` when it cannot be read — the recycling rule then rests on `maxJobs`
 * alone. Synchronous — for tools and tests; the engine samples with `processRssMbAsync` off the
 * job path.
 * @param {number | number[] | undefined} pids
 * @returns {number}
 */
export function processRssMb(pids) {
  const list = pidList(pids);
  if (list.length === 0) return 0;
  try {
    if (process.platform === 'linux') return Math.round(procRssKb(list) / 1024);
    if (process.platform === 'win32') {
      const out = execFileSync('tasklist', ['/FO', 'CSV', '/NH'], {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 3000,
      });
      return Math.round(rssFromTasklist(out, list) / 1024);
    }
    const out = execFileSync('ps', ['-o', 'rss=', '-p', list.join(',')], { encoding: 'utf8', timeout: 3000 });
    return Math.round(rssFromPs(out) / 1024);
  } catch {
    return 0;
  }
}

/** @param {number[]} pids */
function procRssKb(pids) {
  let kb = 0;
  for (const pid of pids) {
    try {
      const match = /VmRSS:\s+(\d+)\s+kB/u.exec(readFileSync(`/proc/${String(pid)}/status`, 'utf8'));
      if (match) kb += Number(match[1]);
    } catch {
      // A process that exited between the pid listing and the read.
    }
  }
  return kb;
}

/**
 * The same number without blocking the event loop — the browser keeps answering the lanes while
 * `tasklist` runs.
 * @param {number | number[] | undefined} pids
 * @returns {Promise<number>}
 */
export async function processRssMbAsync(pids) {
  const list = pidList(pids);
  if (list.length === 0) return 0;
  try {
    if (process.platform === 'linux') return Math.round(procRssKb(list) / 1024);
    if (process.platform === 'win32') {
      const { stdout } = await execFileAsync('tasklist', ['/FO', 'CSV', '/NH'], {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 3000,
      });
      return Math.round(rssFromTasklist(stdout, list) / 1024);
    }
    const { stdout } = await execFileAsync('ps', ['-o', 'rss=', '-p', list.join(',')], {
      encoding: 'utf8',
      timeout: 3000,
    });
    return Math.round(rssFromPs(stdout) / 1024);
  } catch {
    return 0;
  }
}

/** @param {string} dir */
function packageVersion(dir) {
  try {
    return String(JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8')).version ?? '0.0.0');
  } catch {
    return '0.0.0';
  }
}

/** `snapshots[3]` → 3; anything else → undefined. */
const indexFromAddress = (/** @type {unknown} */ address) => {
  const match = typeof address === 'string' ? /^snapshots\[(\d+)\]$/u.exec(address) : null;
  return match ? Number(match[1]) : undefined;
};

/**
 * @typedef {object} Lane
 * @property {number} index
 * @property {ContextLike & Record<string, any>} context
 * @property {PageLike} page
 * @property {CdpLike} cdp
 * @property {Recorder} recorder
 * @property {number} generation
 * @property {string | undefined} genScriptId
 * @property {boolean} dirty
 * @property {boolean} busy
 * @property {number} lastUsedAt
 * @property {'kept' | 'new'} tab
 * @property {number} jobs
 * @property {string[]} scrubErrors
 * @property {boolean} fresh
 */

/**
 * @typedef {object} EngineOptions
 * @property {BrowserOptions} [browser]
 * @property {NodeJS.ProcessEnv} [env]
 * @property {() => Promise<any>} [launch] test injection: returns a browser-like object
 * @property {number} [maxJobs]
 * @property {number} [maxRssMb]
 * @property {number} [laneIdleMs]
 * @property {() => void} [onDisconnected]
 * @property {(line: string) => void} [log]
 * @property {boolean} [prewarm] keep a spare context+page ready (default true)
 * @property {boolean} [prelaunch] launch at creation so `ready` covers the browser start (default true)
 * @property {number} [scrubOpMs] deadline of one scrub op (default `SCRUB_OP_MS_DEFAULT`; tests shorten it)
 * @property {(pids: number[]) => Promise<number> | number} [rssOf] RSS sampler in MB, injectable for tests
 */

/**
 * @typedef {object} LaneOptions
 * @property {number} [lane] lane index (default 0)
 * @property {boolean} [fresh] `--fresh`
 * @property {TimingMode} [mode]
 * @property {number} [queuedMs]
 * @property {number} [snapshotIndex] for value addresses `snapshots[i].steps[j]`
 * @property {string} [address] the keeper's spelling of the same: `snapshots[i]`
 * @property {Record<string, string>} [values]
 * @property {string[]} [secretValues]
 * @property {Record<string, { path?: string, base64?: string, size: number }>} [files]
 * @property {string} [cwd]
 * @property {string} [stamp] the run stamp — goes into `_manifest.json`
 * @property {string} [storageState] session file for a fresh context (auth)
 * @property {unknown} [auth] the config-level auth block, for `needsFreshContext`
 * @property {Record<string, any>} [config] the whole normalized config (the keeper sends it; `auth` is read from it)
 * @property {(line: string) => void} [log]
 */

/**
 * @typedef {object} FlowResult
 * @property {string} name
 * @property {string} dir
 * @property {boolean} completed
 * @property {number} ms
 * @property {string[]} files absolute paths written
 * @property {Timing} timing
 * @property {string} [failure]
 * @property {Report} report
 */

const ENGINE_OPTION_KEYS = [
  'browser',
  'env',
  'launch',
  'maxJobs',
  'maxRssMb',
  'laneIdleMs',
  'onDisconnected',
  'log',
  'prewarm',
  'prelaunch',
  'scrubOpMs',
  'rssOf',
];

/**
 * Two spellings reach here: the engine's own `createEngine({ browser, env, log, launch })` and the
 * keeper's `createEngine(browserOpts, { log, env })` (docs/handoff/WP5.md). A first argument that
 * carries none of the engine keys is a browser options block.
 * @param {Record<string, any>} first
 * @param {Record<string, any> | undefined} hooks
 * @returns {EngineOptions}
 */
function normalizeOptions(first, hooks) {
  if (hooks === undefined && ENGINE_OPTION_KEYS.some((key) => key in first)) return first;
  return { browser: first, ...(hooks ?? {}) };
}

/**
 * @param {EngineOptions | BrowserOptions} [first]
 * @param {Partial<EngineOptions>} [hooks] the keeper passes { log, env }; tests may add { launch, prewarm }
 */
export function createEngine(first = {}, hooks = undefined) {
  const options = normalizeOptions(first, hooks);
  const env = options.env ?? process.env;
  const browserOpts = options.browser ?? {};
  const maxJobs = options.maxJobs ?? (Number(env.BI_MAX_JOBS) || MAX_JOBS_DEFAULT);
  const maxRssMb = options.maxRssMb ?? (Number(env.BI_MAX_RSS_MB) || MAX_RSS_MB_DEFAULT);
  const laneIdleMs = options.laneIdleMs ?? (Number(env.BI_LANE_IDLE_MS) || LANE_IDLE_MS_DEFAULT);
  const scrubOpMs = options.scrubOpMs ?? (Number(env.BI_SCRUB_OP_MS) || SCRUB_OP_MS_DEFAULT);
  const log = options.log ?? (() => {});
  const motion = browserOpts.motion === 'reduce' ? 'reduce' : 'no-preference';
  const versions = { bi: packageVersion(PACKAGE_DIR), 'playwright-core': playwrightCoreVersion(PACKAGE_DIR) };

  /** @type {any} */
  let browser = null;
  /** @type {Promise<void> | null} */
  let launching = null;
  let channel = '';
  /** @type {string[]} */
  let flags = [];
  let launchMs = 0;
  let launches = 0;
  let connected = false;
  /** @type {Map<number, Lane>} */
  const lanes = new Map();
  /** @type {{ context: any, page: any } | null} */
  let spare = null;
  /** @type {Promise<void> | null} */
  let prewarming = null;
  let jobs = 0;
  let jobsSinceLaunch = 0;
  let scrubs = 0;
  let closed = false;
  /** The last RSS sample (MB) and its pids — `status()` reads the cache, never a process list. */
  let browserRssMb = 0;
  /** @type {number[]} */
  let browserPids = [];
  /** @type {any} */
  let browserCdp = null;
  /** @type {Promise<number> | null} */
  let sampling = null;
  /** @type {Map<string, ((...args: any[]) => void)[]>} */
  const listeners = new Map();

  /** @param {string} event @param {any[]} args */
  const emit = (event, ...args) => {
    for (const cb of listeners.get(event) ?? []) {
      try {
        cb(...args);
      } catch (error) {
        log(`listener ${event}: ${errorMessage(error)}`);
      }
    }
  };

  // ── Browser lifecycle ──────────────────────────────────────────────────────

  async function launch() {
    launches += 1;
    if (options.launch) {
      const started = now();
      browser = await options.launch();
      channel = browserOpts.channel ?? 'chrome';
      flags = [...launchPlan(browserOpts, env).args];
      launchMs = ms(started);
    } else {
      const result = await launchBrowser(browserOpts, { env });
      browser = result.browser;
      channel = result.channel;
      flags = result.args;
      launchMs = result.launchMs;
    }
    connected = true;
    jobsSinceLaunch = 0;
    browserRssMb = 0;
    browserPids = [];
    browserCdp = null;
    const launched = browser;
    browser.on?.('disconnected', () => {
      // An old browser going away during a recycle is expected; only the live one is fatal.
      if (launched !== browser) return;
      connected = false;
      lanes.clear();
      spare = null;
      browserCdp = null;
      if (!closed) {
        options.onDisconnected?.();
        emit('disconnected');
      }
    });
    log(`browser ${browserLabel()} launched in ${String(launchMs)} ms (${channel})`);
    if (options.prewarm !== false) prewarmSpare();
  }

  /** Launch once; concurrent callers share the same promise. Returns whether THIS call launched. */
  async function ensureBrowser() {
    if (browser && connected && browser.isConnected?.() !== false) return false;
    if (!launching) {
      launching = launch().finally(() => {
        launching = null;
      });
      await launching;
      return true;
    }
    await launching;
    return false;
  }

  function browserLabel() {
    const version = String(browser?.version?.() ?? '');
    const major = version.split('.')[0] || version;
    const name = channel === 'msedge' ? 'Edge' : channel === 'chrome' ? 'Chrome' : 'Chromium';
    return major ? `${name}/${major}` : name;
  }

  function prewarmSpare() {
    if (prewarming || spare || !browser) return;
    prewarming = (async () => {
      try {
        const context = await browser.newContext({ viewport: { ...DEFAULT_VIEWPORT }, serviceWorkers: 'allow' });
        const page = await context.newPage();
        if (connected && !closed) spare = { context, page };
        else await context.close().catch(() => {});
      } catch {
        // No spare is a slower fresh run, not an error.
      } finally {
        prewarming = null;
      }
    })();
  }

  /**
   * A fresh context: the prewarmed spare when nothing must be baked in at creation (storageState,
   * video); otherwise a new context. `serviceWorkers: 'allow'` on purpose — a fresh run must not
   * change the PWA under test (DESIGN.md §2.3 point 7).
   * @param {{ viewport?: { width: number, height: number }, storageState?: string, video?: string }} wanted
   */
  async function freshContext(wanted) {
    if (spare && !wanted.storageState && !wanted.video) {
      const taken = spare;
      spare = null;
      prewarmSpare();
      if (wanted.viewport) await taken.page.setViewportSize(wanted.viewport);
      return taken;
    }
    const context = await browser.newContext({
      viewport: { ...(wanted.viewport ?? DEFAULT_VIEWPORT) },
      serviceWorkers: 'allow',
      ...(wanted.storageState ? { storageState: wanted.storageState } : {}),
      ...(wanted.video ? { recordVideo: { dir: wanted.video } } : {}),
    });
    const page = await context.newPage();
    return { context, page };
  }

  /**
   * A lane's tab gets its CDP session, `Page.enable` (required by the generation script) and the
   * generation script — ONCE per tab. The recorder is attached by the caller, also once per tab.
   * @param {Lane} lane
   * @param {number} generation
   */
  async function armTab(lane, generation) {
    lane.cdp = await lane.context.newCDPSession(lane.page);
    await lane.cdp.send('Page.enable').catch(() => {});
    lane.genScriptId = undefined;
    await setGeneration(lane, generation);
  }

  /**
   * The persistent lane `scratch[index]`: created on first use, scrubbed in place after every run,
   * closed after `laneIdleMs` of idleness (never lane 0).
   * @param {number} index
   * @returns {Promise<Lane>}
   */
  async function getLane(index) {
    const existing = lanes.get(index);
    if (existing) return existing;
    await ensureBrowser();
    const context = await browser.newContext({
      viewport: { ...DEFAULT_VIEWPORT },
      serviceWorkers: 'block',
      ...(motion === 'reduce' ? { reducedMotion: 'reduce' } : {}),
    });
    const page = await context.newPage();
    /** @type {Lane} */
    const lane = {
      index,
      context,
      page,
      cdp: /** @type {CdpLike} */ ({ send: async () => undefined }),
      recorder: attachRecorder(page),
      generation: 0,
      genScriptId: undefined,
      dirty: false,
      busy: false,
      lastUsedAt: Date.now(),
      tab: 'new',
      jobs: 0,
      scrubErrors: [],
      fresh: false,
    };
    await armTab(lane, 1);
    lanes.set(index, lane);
    return lane;
  }

  /**
   * Swap the generation script: the first document of every origin in a new generation clears its
   * sessionStorage — the one store `Storage.clearDataForOrigin` cannot reach.
   * @param {Lane} lane @param {number} generation
   */
  async function setGeneration(lane, generation) {
    if (lane.genScriptId) {
      await lane.cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: lane.genScriptId }).catch(() => {});
    }
    const result = await lane.cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: GEN_SCRIPT(generation) });
    lane.genScriptId = result?.identifier;
    lane.generation = generation;
  }

  /**
   * Execute a scrub plan 1:1 (DESIGN.md §2.3, ops from `scrubPlan`). Every op is guarded AND
   * bounded (`scrubOpMs`): a failed op is logged in `lane.scrubErrors` and the next one still runs
   * — a half-scrubbed lane beats a stuck one, and `clearOrigin` covers the same store. An op that
   * does not answer in time means the renderer is hung: the rest of the plan is dropped, the lane
   * is marked crashed and the plan is recomputed once — `scrubPlan` then says `newTab`, and
   * `page.close()` on a hung renderer works because it is browser-side.
   * @param {Lane} lane
   * @param {ScrubOp[]} plan
   * @param {{ rebuilt?: boolean }} [state]
   * @returns {Promise<{ op: string, ms: number }[]>} per-op cost, for the log and BUDGET.md
   */
  async function applyScrub(lane, plan, state = {}) {
    lane.scrubErrors = [];
    /** @type {{ op: string, ms: number }[]} */
    const costs = [];
    let hung = false;
    const guard = async (/** @type {string} */ label, /** @type {() => Promise<unknown>} */ fn) => {
      if (hung) return;
      const started = now();
      try {
        await withDeadline(fn(), scrubOpMs, `scrub ${label}`);
      } catch (error) {
        lane.scrubErrors.push(`${label}: ${errorMessage(error)}`);
        if (isDeadline(error)) hung = true;
      } finally {
        costs.push({ op: label, ms: ms(started) });
      }
    };
    for (const op of plan) {
      if (hung) break;
      switch (op.op) {
        case 'closePage':
          await guard('closePage', () => /** @type {any} */ (op.page).close());
          break;
        case 'newTab':
          await guard('newTab', async () => {
            await withDeadline(
              lane.page.close().catch(() => {}),
              scrubOpMs,
              'page.close',
            ).catch(() => {});
            lane.page = await lane.context.newPage();
            lane.tab = 'new';
            attachRecorder(lane.page, { into: lane.recorder });
            await armTab(lane, lane.generation);
          });
          break;
        case 'domStorageClear':
          // In-page, not `DOMStorage.clear`: the CDP call was measured stalling for ~500 ms in one
          // scrub out of 3–5 (the domain has to attach to the renderer first); the page is still on
          // the origin, so one `Runtime.evaluate` does the same work in ~1 ms. `clearOrigin` covers
          // localStorage again and the generation script covers sessionStorage on the next document.
          await guard('domStorageClear', () =>
            lane.cdp.send('Runtime.evaluate', {
              expression: STORAGE_CLEAR_EXPRESSION,
              returnByValue: true,
              timeout: Math.min(scrubOpMs, 1000),
            }),
          );
          break;
        case 'setGeneration':
          await guard('setGeneration', () => setGeneration(lane, op.generation));
          break;
        case 'clearOrigin':
          await guard('clearOrigin', () =>
            lane.cdp.send('Storage.clearDataForOrigin', { origin: op.origin, storageTypes: op.storageTypes }),
          );
          break;
        case 'resetContext': {
          const context = lane.context;
          await guard('clearCookies', () => context.clearCookies());
          await guard('clearPermissions', () => context.clearPermissions());
          await guard('unrouteAll', async () => {
            await context.unrouteAll?.({ behavior: 'ignoreErrors' });
            await lane.page.unrouteAll?.({ behavior: 'ignoreErrors' });
          });
          await guard('setOffline', () => context.setOffline(false));
          await guard('setExtraHTTPHeaders', () => context.setExtraHTTPHeaders({}));
          await guard('setGeolocation', () => context.setGeolocation(null));
          await guard('emulateMedia', () =>
            lane.page.emulateMedia({ colorScheme: null, reducedMotion: null, media: null }),
          );
          await guard('viewport', async () => {
            const current = lane.page.viewportSize?.();
            if (!current || current.width !== op.viewport.width || current.height !== op.viewport.height) {
              await lane.page.setViewportSize(op.viewport);
            }
          });
          if (hung) break;
          lane.recorder.dialogPolicy = { action: op.dialogs };
          context.setDefaultTimeout(DEFAULT_TIMEOUT_MS);
          context.setDefaultNavigationTimeout(DEFAULT_TIMEOUT_MS);
          break;
        }
        case 'resetNavigationHistory':
          await guard('resetNavigationHistory', () => lane.cdp.send('Page.resetNavigationHistory'));
          break;
        default:
          lane.scrubErrors.push(`unknown op ${String(/** @type {any} */ (op).op)}`);
      }
    }
    if (hung && !state.rebuilt) {
      log(`lane ${String(lane.index)}: scrub op timed out — rebuilding the tab`);
      lane.recorder.crashed = true;
      const errors = lane.scrubErrors;
      const again = await applyScrub(lane, scrubPlan(laneState(lane)), { rebuilt: true });
      lane.scrubErrors = [...errors, ...lane.scrubErrors];
      return [...costs, ...again];
    }
    return costs;
  }

  /**
   * What the lane knows about itself, in the shape `scrubPlan` decides on.
   * @param {Lane} lane
   * @returns {LaneState}
   */
  function laneState(lane) {
    /** @type {string | null} */
    let url = null;
    try {
      url = lane.page.url();
    } catch {
      // A closed page has no URL: treated as about:blank.
    }
    const pageClosed = lane.page.isClosed?.() === true;
    return {
      pages: lane.context.pages().map((page) => ({ page, isLaneTab: page === lane.page })),
      crashed: lane.recorder.crashed === true || pageClosed,
      currentOrigin: originOf(url),
      visitedOrigins: [...lane.recorder.visitedOrigins],
      generation: lane.generation,
    };
  }

  /**
   * Scrub a lane in place. Returns the plan and its cost — `timing.scrubMs` between the snapshots
   * of one batch, `queuedMs` of the next client when the keeper runs it after the response.
   * @param {number | Lane} which
   */
  async function scrub(which) {
    const lane = typeof which === 'number' ? lanes.get(which) : which;
    if (!lane) return { ms: 0, plan: [], ops: [] };
    const started = now();
    const plan = scrubPlan(laneState(lane));
    const ops = await applyScrub(lane, plan);
    lane.recorder.resetOrigins();
    lane.recorder.reset();
    lane.dirty = false;
    scrubs += 1;
    const total = ms(started);
    // One op that drifted is worth a log line: the budget of §2.3 is 12–35 ms for the whole plan.
    const slow = ops.filter((o) => o.ms > 50);
    if (slow.length > 0) {
      log(
        `lane ${String(lane.index)}: scrub ${String(total)} ms — ${slow.map((o) => `${o.op} ${String(o.ms)} ms`).join(', ')}`,
      );
    }
    return { ms: total, plan, ops };
  }

  /**
   * The keeper's post-response scrub: only a lane a reused run left dirty — a clean lane (or a
   * fresh-context run that never touched one) costs nothing.
   * @param {number} index
   */
  async function scrubIfDirty(index) {
    const lane = lanes.get(index);
    if (!lane || !lane.dirty || lane.busy) return { ms: 0, plan: [], ops: [] };
    return scrub(lane);
  }

  /** Close idle lanes (not lane 0) — `--parallel` lanes are cheap to keep and cheap to drop. */
  async function reapIdleLanes() {
    const cutoff = Date.now() - laneIdleMs;
    for (const [index, lane] of lanes) {
      if (index === 0 || lane.busy || lane.lastUsedAt > cutoff) continue;
      lanes.delete(index);
      await lane.context.close().catch(() => {});
    }
  }

  /**
   * The browser's process ids — the browser process plus its renderers — through a browser-level
   * CDP session (`SystemInfo.getProcessInfo`): playwright-core 1.62 has no `browser.process()`
   * for a launched channel browser, and a lone browser pid would miss where the memory actually
   * lives (the renderers). Cached per launch; `[]` when the browser cannot say.
   * @returns {Promise<number[]>}
   */
  async function findBrowserPids() {
    if (!browser || !connected) return [];
    try {
      if (!browserCdp && typeof browser.newBrowserCDPSession === 'function') {
        browserCdp = await browser.newBrowserCDPSession();
      }
      if (browserCdp) {
        const info = await withDeadline(browserCdp.send('SystemInfo.getProcessInfo'), 2000, 'process info');
        const ids = (info?.processInfo ?? [])
          .filter((/** @type {any} */ p) => p.type === 'browser' || p.type === 'renderer')
          .map((/** @type {any} */ p) => Number(p.id))
          .filter((/** @type {number} */ id) => Number.isInteger(id) && id > 0);
        if (ids.length > 0) return ids;
      }
    } catch (error) {
      log(`process ids: ${errorMessage(error)}`);
    }
    const pid = browser?.process?.()?.pid;
    return Number.isInteger(pid) ? [pid] : [];
  }

  /**
   * Sample the browser's RSS in the background and cache it for `status()` and the keeper's
   * recycling rule. Never on a job's own path: the keeper calls it after the answer, every
   * `RSS_CHECK_EVERY` jobs. Concurrent callers share one sample.
   * @returns {Promise<number>} MB
   */
  function sampleRss() {
    if (sampling) return sampling;
    sampling = (async () => {
      try {
        if (browserPids.length === 0) browserPids = await findBrowserPids();
        const rss = options.rssOf ? await options.rssOf(browserPids) : await processRssMbAsync(browserPids);
        if (Number.isFinite(rss)) browserRssMb = rss;
        return browserRssMb;
      } catch (error) {
        log(`rss sample: ${errorMessage(error)}`);
        return browserRssMb;
      } finally {
        sampling = null;
      }
    })();
    return sampling;
  }

  /**
   * `browser.close()` + launch. The KEEPER decides when (between jobs, with no lane busy and no
   * session open — `docs/handoff/WP5.md`); the engine only does it. Recycling from inside a
   * `runFlow` would close the browser under the other `--parallel` lanes.
   */
  async function recycle() {
    log(`recycle after ${String(jobsSinceLaunch)} jobs`);
    await closeBrowser();
    await ensureBrowser();
  }

  async function closeBrowser() {
    const old = browser;
    // A session cannot outlive its browser: an agent's `bi click` after a recycle must hear "no
    // open session", not "Target closed" from a context that no longer exists.
    for (const name of [...sessions.keys()]) await endSession(name).catch(() => {});
    browser = null;
    connected = false;
    lanes.clear();
    spare = null;
    browserCdp = null;
    if (old) await old.close().catch(() => {});
  }

  // ── Step context ───────────────────────────────────────────────────────────

  /**
   * `ctx.sel(step)`: a ref resolves to `aria-ref=<ref>` literally, after a `count()` precheck and
   * ONE full-snapshot refresh (an element with the same role and name gets the same ref back);
   * still nothing → `RefNotFoundError` at once, no actionability wait (`resolveRef`, WP3). A
   * selector passes through verbatim. `field` narrows the lookup to `ref` or `selector`.
   * @param {StepContext & Record<string, any>} ctx
   * @param {Step} step
   * @param {string} [field]
   * @returns {Promise<string>}
   */
  async function resolveSelector(ctx, step, field) {
    if (step.ref !== undefined && field !== 'selector') {
      const resolved = await resolveRef(ctx.page, String(step.ref));
      if (resolved.refreshed && typeof resolved.snapshot === 'string') {
        ctx.lastSnapshot = { text: resolved.snapshot, at: Date.now() };
      }
      return resolved.selector;
    }
    if (step.selector !== undefined && field !== 'ref') return String(step.selector);
    throw new Error('the step needs a selector or a ref');
  }

  /**
   * Navigate on the lane tab with the snapshot's `waitUntil`: `settled` = `load` + the quiet window
   * counted by the recorder; `networkidle` and the rest 1:1.
   * @param {StepContext & Record<string, any>} ctx
   * @param {string} url
   * @param {string | undefined} waitUntil
   * @param {number} [timeoutMs]
   */
  async function navigate(ctx, url, waitUntil, timeoutMs) {
    const wait = waitUntil ?? ctx.snapshot?.waitUntil ?? 'load';
    await ctx.page.goto(url, {
      waitUntil: wait === 'settled' ? 'load' : wait,
      timeout: timeoutMs ?? ctx.timeoutMs,
    });
    if (wait === 'settled') await ctx.settle();
  }

  /**
   * The snapshot files of DESIGN.md §4.3 / §5, from ONE `ariaSnapshot({ mode: 'ai', boxes: true })`
   * text (WP3's recommended order): `snap.full.yml` raw, `snap.json` the box-joined sidecar,
   * `snap.md` the compact view — sensitive fields and secrets masked in both.
   * @param {StepContext & Record<string, any>} ctx
   * @param {string} text
   * @param {string} base file basename without extension (`snap`, `snap-koszyk`)
   * @returns {Promise<string[]>} files written, relative to `ctx.dir`
   */
  async function writeSnapshotFiles(ctx, text, base) {
    const walk = await degradeTo(
      [],
      ctx.page.evaluate(walkInteractive),
      Math.min(ctx.timeoutMs, 5000),
      'snapshot walk',
    );
    const { entries } = boxJoin(text, Array.isArray(walk) ? walk : []);
    const secretValues = ctx.secretValues;
    const sidecar = maskSnapshotEntries(entries, { secretValues });
    const compact = maskSnapshotValues(compactSnapshot(text, { sidecar: entries }), {
      sensitiveRefs: sensitiveRefs(entries),
      secretValues,
    });
    const files = [`${base}.full.yml`, `${base}.md`, `${base}.json`];
    await mkdir(ctx.dir, { recursive: true });
    await Promise.all([
      writeFile(
        path.join(ctx.dir, files[0]),
        maskSnapshotValues(text, { sensitiveRefs: sensitiveRefs(entries), secretValues }),
        'utf8',
      ),
      writeFile(path.join(ctx.dir, files[1]), compact, 'utf8'),
      writeFile(path.join(ctx.dir, files[2]), `${JSON.stringify(sidecar, null, 2)}\n`, 'utf8'),
    ]);
    // `compact` is what `snap --diff` compares against next time (the session keeps it as
    // `prevCompact` when it prints); it is the masked text, so a diff never leaks a value either.
    ctx.lastSnapshot = { text, entries, compact, at: Date.now() };
    return files;
  }

  /**
   * The ONE context every runner sees (DESIGN.md §8 + the helpers named in docs/handoff/WP2.md).
   * @param {{
   *   page: PageLike, context: ContextLike, cdp: CdpLike, recorder: Recorder,
   *   dir: string, timeoutMs: number, mode: 'batch' | 'session', snapshot?: any, session?: any,
   *   values?: Record<string, string>, secretValues?: string[], files?: Record<string, any>, cwd?: string,
   *   laneTab?: PageLike, snapshotIndex?: number,
   * }} input
   * @returns {StepContext & Record<string, any>}
   */
  function makeStepContext(input) {
    const secretValues = input.secretValues ?? [];
    /** @type {StepContext & Record<string, any>} */
    const ctx = {
      page: input.page,
      context: input.context,
      cdp: input.cdp,
      dir: input.dir,
      timeoutMs: input.timeoutMs,
      capture: { screenshots: [], extracts: {}, verifications: [], pending: [] },
      recorder: input.recorder,
      sel: (step, field) => resolveSelector(ctx, step, field),
      values: input.values ?? {},
      address: '',
      value: (field = 'value', step) => {
        const s = step ?? ctx.step ?? {};
        const sent = ctx.values[`${ctx.address}.${field}`];
        if (sent !== undefined) return sent;
        if (s[field] !== undefined) return String(s[field]);
        const envName = s[`${field}FromEnv`];
        if (typeof envName === 'string') {
          throw new Error(`${field} from env ${envName} was not resolved (is ${envName} set?)`);
        }
        throw new Error(`the step has no ${field}`);
      },
      secretValues,
      redact: (text) => redact(text, secretValues),
      files: input.files ?? {},
      mode: input.mode,
      session: input.session,
      snapshot: input.snapshot,
      lines: input.mode === 'session' ? [] : undefined,
      // ── engine helpers (documented in docs/handoff/WP2.md) ──
      cwd: input.cwd ?? process.cwd(),
      laneTab: input.laneTab ?? input.page,
      snapshotIndex: input.snapshotIndex ?? 0,
      stepIndex: 0,
      step: undefined,
      frame: undefined,
      routes: [],
      written: [],
      lastSnapshot: undefined,
      lastShot: undefined,
      loc: (selector) => (ctx.frame && !selector.startsWith('aria-ref=') ? ctx.frame : ctx.page).locator(selector),
      navigate: (url, waitUntil, timeoutMs) => navigate(ctx, url, waitUntil, timeoutMs),
      settle: () => waitSettled(null, ctx.recorder, { capMs: ctx.snapshot?.settleMs ?? 2000 }),
      artifact: (name, ext) => {
        if (ctx.session) {
          ctx.session.shotSeq = (ctx.session.shotSeq ?? 0) + 1;
          const rel = path.posix.join('shots', `${String(ctx.session.shotSeq).padStart(3, '0')}-${name}.${ext}`);
          return { file: path.join(ctx.dir, rel), rel };
        }
        const rel = `${name}.${ext}`;
        return { file: path.join(ctx.dir, rel), rel };
      },
      writeSnapshot: async (text, step) => {
        const base = !ctx.session && typeof step?.name === 'string' ? `snap-${step.name}` : 'snap';
        const files = await writeSnapshotFiles(ctx, text, base);
        ctx.written.push(...files);
        return files[1];
      },
      setPage: (page) => {
        ctx.page = page;
        ctx.frame = undefined;
      },
      attachPage: (page) => attachRecorder(page, { into: /** @type {Recorder} */ (ctx.recorder) }),
    };
    return ctx;
  }

  /**
   * One step: the runner under a deadline that sits above the action's own timeout (so the
   * Playwright message wins over `timed out`), the result in the report's shape. Never throws.
   * @param {StepContext & Record<string, any>} ctx
   * @param {Step} step
   * @param {number} index
   * @returns {Promise<StepResult>}
   */
  async function runStep(ctx, step, index) {
    const description = describeStep(step);
    const name = resolveStepName(step.do);
    const started = now();
    ctx.step = step;
    ctx.stepIndex = index;
    ctx.recorder.trigger = description;
    try {
      const runner = name ? RUNNERS[name] : undefined;
      if (!runner) throw new Error(`unknown step ${JSON.stringify(step.do)}`);
      const extra = name === 'wait' && typeof step.ms === 'number' ? step.ms : 0;
      const budget = typeof step.timeout === 'number' ? Math.max(step.timeout, ctx.timeoutMs) : ctx.timeoutMs;
      await withDeadline(runner(ctx, step), budget + extra + STEP_GRACE_MS, description);
      return { index, description, ok: true, ms: ms(started) };
    } catch (error) {
      return { index, description, ok: false, ms: ms(started), error: errorMessage(error) };
    } finally {
      ctx.recorder.trigger = undefined;
    }
  }

  // ── runFlow ────────────────────────────────────────────────────────────────

  /**
   * One snapshot (`type: page` or `flow`) → report.json/md, elements.md, text.txt, the screenshots
   * and `_manifest.json` in `dir` (DESIGN.md §5), and the keeper's `FlowResult`. Never throws for a
   * failing page — a failed step or navigation is a result; only `E_BROWSER_MISSING` and a closed
   * engine escape.
   * @param {Record<string, any>} snapshot a normalized snapshot config
   * @param {string} dir the snapshot's output directory
   * @param {LaneOptions} [laneOpts]
   * @returns {Promise<FlowResult>}
   */
  async function runFlow(snapshot, dir, laneOpts = {}) {
    const started = now();
    const startedAt = new Date().toISOString();
    if (closed) throw new Error('engine closed');
    const launchedNow = await ensureBrowser();
    await mkdir(dir, { recursive: true });
    const mode = laneOpts.mode ?? (launchedNow || jobsSinceLaunch === 0 ? 'first' : 'warm');
    const auth = laneOpts.auth ?? laneOpts.config?.auth;
    const fresh = needsFreshContext(snapshot, { fresh: laneOpts.fresh, auth });
    const viewport = snapshot.viewport ?? DEFAULT_VIEWPORT;
    const snapshotIndex = laneOpts.snapshotIndex ?? indexFromAddress(laneOpts.address) ?? 0;

    /** @type {Lane} */
    let lane;
    let scrubMs = 0;
    let videoDir;
    if (fresh) {
      if (snapshot.video === true) videoDir = path.join(dir, '.video');
      const pair = await freshContext({
        viewport,
        storageState: laneOpts.storageState ?? snapshot.storageState,
        video: videoDir,
      });
      lane = {
        index: laneOpts.lane ?? 0,
        context: pair.context,
        page: pair.page,
        cdp: /** @type {CdpLike} */ ({ send: async () => undefined }),
        recorder: attachRecorder(pair.page),
        generation: 0,
        genScriptId: undefined,
        dirty: false,
        busy: true,
        lastUsedAt: Date.now(),
        tab: 'new',
        jobs: 0,
        scrubErrors: [],
        fresh: true,
      };
      lane.cdp = await pair.context.newCDPSession(pair.page);
      await lane.cdp.send('Network.clearBrowserCache').catch(() => {});
    } else {
      lane = await getLane(laneOpts.lane ?? 0);
      lane.busy = true;
      // Normally clean already: the keeper scrubs in the lane queue right after the previous
      // answer (the wait shows as `queuedMs`). This is the safety net — and the in-process
      // `runBatch` path, where the scrub between snapshots is legitimately in the stopwatch (§6).
      if (lane.dirty) scrubMs = (await scrub(lane)).ms;
      const current = lane.page.viewportSize?.();
      if (!current || current.width !== viewport.width || current.height !== viewport.height) {
        await lane.page.setViewportSize(viewport);
      }
    }
    const recorder = lane.recorder;
    recorder.reset();
    recorder.captureBodies = snapshot.captureBodies !== false;
    recorder.dialogPolicy = { action: snapshot.dialogs === 'accept' ? 'accept' : 'dismiss' };
    const tab = lane.tab;
    lane.tab = 'kept';

    const ctx = makeStepContext({
      page: lane.page,
      context: lane.context,
      cdp: lane.cdp,
      recorder,
      dir,
      timeoutMs: snapshot.stepTimeoutMs ?? 10_000,
      mode: 'batch',
      snapshot,
      values: laneOpts.values,
      secretValues: laneOpts.secretValues,
      files: laneOpts.files,
      cwd: laneOpts.cwd,
      laneTab: lane.page,
      snapshotIndex,
    });
    const base = laneOpts.address ?? `snapshots[${String(snapshotIndex)}]`;

    /** @type {StepResult[]} */
    const steps = [];
    let completed = true;
    /** @type {string | undefined} */
    let navigationError;
    let stepsMs = 0;
    let lastStepWasScreenshot = false;
    /** @type {Record<string, string>} */
    const files = {};

    for (const [k, route] of (snapshot.routes ?? []).entries()) {
      ctx.address = `${base}.routes[${String(k)}]`;
      try {
        await RUNNERS.route(ctx, { do: 'route', ...route });
      } catch (error) {
        log(`route ${String(route.url)}: ${errorMessage(error)}`);
      }
    }
    if (snapshot.trace === true) {
      await lane.context.tracing?.start({ screenshots: true, snapshots: true }).catch(() => {});
    }

    const navStarted = now();
    try {
      await navigate(ctx, snapshot.url, snapshot.waitUntil, snapshot.navTimeoutMs ?? DEFAULT_TIMEOUT_MS);
      // The run's history starts HERE: `back` must never reach the previous run's document, which
      // is still the entry before this one on a reused tab (2 ms; a fresh tab has nothing behind).
      if (!fresh) await lane.cdp.send('Page.resetNavigationHistory').catch(() => {});
    } catch (error) {
      navigationError = errorMessage(error);
      completed = false;
    }
    const gotoMs = ms(navStarted);

    const stepList = /** @type {Step[]} */ (snapshot.type === 'flow' ? (snapshot.steps ?? []) : []);
    if (navigationError === undefined) {
      const stepsStarted = now();
      for (const [j, step] of stepList.entries()) {
        ctx.address = `${base}.steps[${String(j)}]`;
        const result = await runStep(ctx, step, j);
        steps.push(result);
        if (!result.ok) {
          // Stop at the first failure: later steps assume the state this one was meant to produce.
          completed = false;
          break;
        }
        lastStepWasScreenshot = resolveStepName(step.do) === 'screenshot';
      }
      stepsMs = ms(stepsStarted);
    }

    if (snapshot.trace === true) {
      await lane.context.tracing
        ?.stop({ path: path.join(dir, 'trace.zip') })
        .then(() => {
          files.trace = 'trace.zip';
        })
        .catch(() => {});
    }

    const captureStarted = now();
    const evidence = await finalEvidence(ctx, snapshot, { dir, completed, lastStepWasScreenshot });
    if (snapshot.captureSnapshot === true && !ctx.lastSnapshot) {
      try {
        const text = await withDeadline(ctx.page.ariaSnapshot({ mode: 'ai', boxes: true }), 5000, 'snapshot');
        await ctx.writeSnapshot(text, {});
      } catch {
        // A page that cannot be snapshotted still gets its report.
      }
    }
    const captureMs = ms(captureStarted);

    // The queued screenshot writes and the recorder's body reads are the `writeMs` of §6; the
    // report files themselves land after the timing is known (a few ms, unmeasured on purpose).
    const writeStarted = now();
    await Promise.allSettled([...(ctx.capture.pending ?? []), ...evidence.pending]);
    await recorder.settle();
    const writeMs = ms(writeStarted);

    const screenshots = [...ctx.capture.screenshots, ...(evidence.screenshot ? [evidence.screenshot] : [])];
    // `report.json.files` maps a kind to a file (WP4): `snapshot` / `snapshot-<name>` → the compact
    // `snap*.md` (the sidecar and the raw YAML sit next to it), `pdf-<name>` → the pdf.
    for (const rel of ctx.written) {
      const snap = /^snap(?:-([a-z0-9-]+))?\.md$/u.exec(rel);
      if (snap) files[snap[1] ? `snapshot-${snap[1]}` : 'snapshot'] = rel;
      else if (rel.endsWith('.pdf')) files[`pdf-${rel.slice(0, -4)}`] = rel;
    }
    const summary = summarize(recorder);
    const lastShot =
      lastStepWasScreenshot && completed && !evidence.screenshot ? ctx.capture.screenshots.at(-1) : undefined;

    /** @type {Timing} */
    const timing = {
      mode,
      ctx: fresh ? 'fresh' : 'reused',
      tab,
      lane: lane.index,
      queuedMs: laneOpts.queuedMs ?? 0,
      scrubMs,
      gotoMs,
      stepsMs,
      captureMs,
      writeMs,
      totalMs: ms(started),
      cacheHits: summary.cacheHits,
      cacheHitsDocument: summary.cacheHitsDocument,
    };

    const built = buildReport({
      name: snapshot.name,
      startUrl: snapshot.url,
      finalUrl: evidence.finalUrl || snapshot.url,
      ...(evidence.title !== undefined ? { title: evidence.title } : {}),
      completed,
      ...(navigationError !== undefined ? { navigationError } : {}),
      steps,
      skipped: stepList.length - steps.length,
      extracts: ctx.capture.extracts,
      verifications: ctx.capture.verifications,
      console: recorder.console,
      consoleTotal: recorder.consoleTotal,
      pageErrors: recorder.pageErrors,
      network: snapshot.captureNetwork === false ? [] : recorder.network,
      networkTotal: snapshot.captureNetwork === false ? 0 : recorder.networkTotal,
      dialogs: summary.dialogs,
      tabs: summary.tabs,
      screenshots,
      text: evidence.text.content,
      elements: evidence.elements?.entries ?? [],
      elementsTotal: evidence.elements?.total ?? 0,
      captureElements: snapshot.captureElements !== false,
      timing,
      engine: {
        bi: versions.bi,
        'playwright-core': versions['playwright-core'],
        browser: browserLabel(),
        flags,
        motion,
        serviceWorkers: fresh ? 'allow' : 'block',
        generation: lane.generation,
      },
      ...(lastShot ? { final: lastShot } : {}),
      ...(!fresh && recorder.serviceWorkerSeen ? { serviceWorkerBlocked: true } : {}),
      files,
    });
    const report = /** @type {Report} */ (built.report);

    jobs += 1;
    jobsSinceLaunch += 1;
    lane.jobs += 1;
    lane.lastUsedAt = Date.now();
    lane.busy = false;
    if (fresh) {
      const video = snapshot.video === true ? lane.page.video?.() : undefined;
      await lane.context.close().catch(() => {});
      if (video) {
        await video
          .saveAs(path.join(dir, 'video.webm'))
          .then(() => video.delete().catch(() => {}))
          .then(() => {
            report.files.video = 'video.webm';
          })
          .catch(() => {});
      }
    } else {
      lane.dirty = true;
      void reapIdleLanes();
    }

    const { written } = await writeArtifacts(dir, report, built.files, {
      render: snapshot.render,
      redact: ctx.redact,
      manifest: {
        type: snapshot.type === 'page' ? 'page' : 'flow',
        url: snapshot.url,
        stamp: laneOpts.stamp,
        version: versions.bi,
        startedAt,
        render: snapshot.render,
      },
    });
    const failed = report.steps.find((s) => !s.ok);
    const failure =
      report.navigationError !== undefined
        ? report.navigationError
        : failed
          ? `step ${String(failed.index + 1)} "${failed.description}" — ${failed.error ?? 'failed'}`
          : undefined;
    return {
      name: snapshot.name,
      dir,
      completed: report.completed,
      ms: ms(started),
      files: [...written, ...screenshots, ...ctx.written].map((rel) => path.join(dir, rel)),
      timing,
      ...(failure !== undefined ? { failure } : {}),
      report,
    };
  }

  /**
   * After every snapshot of a run: `<runDir>/_manifest.json` (and `--junit`). The keeper calls it
   * with the flow results; `runBatch` below does the same in-process.
   * @param {{
   *   runDir: string, stamp: string, configPath?: string, config?: Record<string, any>, cwd?: string,
   *   options?: { junit?: string, [k: string]: any }, results: (Partial<FlowResult> & { name: string, dir: string })[],
   *   mode: TimingMode, totalMs?: number, startedAt?: string,
   * }} run
   * @returns {Promise<{ files: string[], manifest: import('./types.js').Manifest }>}
   */
  async function finishRun(run) {
    const configPath = run.configPath ?? run.config?.configPath ?? '';
    const results = run.results.map((r) => ({ name: r.name, dir: r.dir, report: r.report ?? stubReport(r) }));
    const manifest = buildManifest(
      {
        stamp: run.stamp,
        config: configPath,
        version: versions.bi,
        ...(run.startedAt ? { startedAt: run.startedAt } : {}),
        timing: { mode: run.mode, launchMs, clientMs: run.totalMs ?? 0 },
      },
      results,
    );
    await mkdir(run.runDir, { recursive: true });
    const manifestFile = path.join(run.runDir, '_manifest.json');
    await writeFile(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    const files = [manifestFile];
    if (typeof run.options?.junit === 'string' && run.options.junit !== '') {
      const junitFile = path.resolve(run.cwd ?? process.cwd(), run.options.junit);
      await mkdir(path.dirname(junitFile), { recursive: true });
      await writeFile(junitFile, renderJUnit(path.basename(configPath || 'bi'), manifest.snapshots), 'utf8');
      files.push(junitFile);
    }
    return { files, manifest };
  }

  /**
   * A report-shaped stand-in for a flow whose `runFlow` threw (browser gone mid-run): the manifest
   * still lists the snapshot as incomplete with the reason.
   * @param {Partial<FlowResult> & { name: string }} r
   * @returns {Report}
   */
  function stubReport(r) {
    /** @type {Timing} */
    const timing = {
      mode: 'no-daemon',
      ctx: 'reused',
      tab: 'kept',
      lane: 0,
      queuedMs: 0,
      scrubMs: 0,
      gotoMs: 0,
      stepsMs: 0,
      captureMs: 0,
      writeMs: 0,
      totalMs: r.ms ?? 0,
      cacheHits: 0,
      cacheHitsDocument: 0,
      ...(r.timing ?? {}),
    };
    return {
      name: r.name,
      startUrl: '',
      finalUrl: '',
      completed: false,
      navigationError: formatStepError(r.failure ?? 'engine failure'),
      steps: [],
      skipped: 0,
      extracts: {},
      verifications: [],
      console: { entries: [], total: 0, truncated: false },
      pageErrors: [],
      network: { total: 0, failed: [] },
      failedRequests: { entries: [], truncated: false },
      dialogs: [],
      tabs: [],
      screenshots: [],
      text: { content: '', truncated: false },
      files: {},
      timing,
      engine: {
        bi: versions.bi,
        'playwright-core': versions['playwright-core'],
        browser: browserLabel(),
        flags,
        motion,
        serviceWorkers: 'block',
        generation: 0,
      },
    };
  }

  /**
   * Every snapshot of a config over `parallel` lanes, in-process (the keeper has its own queue per
   * lane and calls `runFlow` + `finishRun` itself). Lanes pull the next snapshot in config order, so
   * `parallel: 3` on six flows costs ≈ max(lane), not sum(flow). Results come back in config order;
   * `onSnapshot` fires as each one finishes.
   * @param {Record<string, any>} config a normalized config (`loadConfig`)
   * @param {{
   *   stamp: string, outputDir?: string, only?: string[], parallel?: number, fresh?: boolean, mode?: TimingMode,
   *   values?: Record<string, string>, secretValues?: string[], files?: Record<string, any>, cwd?: string,
   *   storageState?: string, junit?: string, onSnapshot?: (result: FlowResult & { index: number }) => void | Promise<void>,
   * }} options
   */
  async function runBatch(config, options) {
    const started = now();
    const startedAt = new Date().toISOString();
    const outputDir = options.outputDir ?? config.outputDir;
    const runDir = path.join(outputDir, options.stamp);
    const wanted = /** @type {any[]} */ (config.snapshots).filter(
      (s) => !options.only || options.only.length === 0 || options.only.includes(s.name),
    );
    const laneCount = Math.max(1, Math.min(options.parallel ?? config.parallel ?? 1, wanted.length));
    /** @type {(FlowResult & { index: number })[]} */
    const results = [];
    await ensureBrowser();
    // `auth`: log in ONCE before the lanes (or reuse the state file), then every snapshot that did
    // not opt out (`auth: false`) starts from that state. A direct engine caller may not have
    // resolved the `*FromEnv` values — `env` is the fallback here, never in the keeper (§2.4).
    let secretValues = options.secretValues ?? [];
    /** @type {import('./auth.mjs').SessionInfo | undefined} */
    let authSession;
    if (config.auth && !options.storageState) {
      const resolved = resolveAuthValues(config.auth, { values: options.values, env });
      secretValues = [...new Set([...secretValues, ...resolved.secretValues])];
      authSession = await ensureSession(config.auth, {
        engine: self,
        baseDir: path.dirname(config.configPath ?? path.resolve(options.cwd ?? process.cwd(), 'read.config.json')),
        values: options.values,
        secretValues,
        env,
        log,
      });
    }
    let next = 0;
    const worker = async (/** @type {number} */ laneIndex) => {
      for (;;) {
        const i = next;
        if (i >= wanted.length) return;
        next += 1;
        const snapshot = wanted[i];
        const dir = path.join(runDir, snapshot.name);
        const flow = await runFlow(snapshot, dir, {
          lane: laneIndex,
          fresh: options.fresh,
          mode: options.mode,
          snapshotIndex: config.snapshots.indexOf(snapshot),
          values: options.values,
          secretValues,
          files: options.files,
          cwd: options.cwd,
          stamp: options.stamp,
          storageState: options.storageState ?? storageStateFor(snapshot, authSession),
          auth: config.auth,
        });
        const result = { ...flow, index: i };
        results[i] = result;
        await options.onSnapshot?.(result);
      }
    };
    await Promise.all(Array.from({ length: laneCount }, (_, k) => worker(k)));
    const totalMs = ms(started);
    const finished = await finishRun({
      runDir,
      stamp: options.stamp,
      configPath: config.configPath,
      config,
      cwd: options.cwd,
      options: { junit: options.junit },
      results,
      mode: options.mode ?? (launches > 0 && jobs === results.length ? 'first' : 'warm'),
      totalMs,
      startedAt,
    });
    return {
      stamp: options.stamp,
      runDir,
      snapshots: results,
      manifest: finished.manifest,
      files: finished.files,
      timing: { mode: finished.manifest.timing.mode, launchMs, totalMs },
    };
  }

  // ── Sessions (DESIGN.md §4) ────────────────────────────────────────────────
  //
  // A session is its own context (never a scratch lane — a scrub would kill the agent's refs),
  // one recorder for all its tabs, ONE step context that lives across commands (frame scope,
  // routes, the last snapshot, the shot counter) and a journal on disk. Keyed by NAME only
  // (§4.5): a `cd` in the agent's shell must not open a second session behind its back.

  /**
   * @typedef {object} Session
   * @property {string} name
   * @property {string} dir `<out>/session/<name>`
   * @property {string} cwd cwd of the command that opened it
   * @property {string} out
   * @property {any} context
   * @property {PageLike} laneTab the first tab — `tab close` never closes it
   * @property {Recorder} recorder
   * @property {StepContext & Record<string, any>} ctx
   * @property {Map<any, CdpLike>} cdps one CDP session per tab (screenshots, evaluate)
   * @property {Map<number, { headers: Record<string, string>, postData?: string }>} requestMeta for `net <n> --req`
   * @property {number} shotSeq
   * @property {number} evalSeq
   * @property {number} commands
   * @property {number} docs main-frame documents on the current tab — the `f<seq>` hint after a navigation
   * @property {number} el last known interactive element count (`el a→b`)
   * @property {number} dom last known MutationObserver counter (`dom Δ`)
   * @property {string | undefined} title
   * @property {string | undefined} baseOrigin origin of the first `open` — deltas print paths on it
   * @property {string[] | undefined} prevCompact the compact view `snap --diff` compares against
   * @property {Record<string, number>} cursors since-last cursors of `console` / `net`
   * @property {Record<string, number>} flushed how much of console / net went to the jsonl files
   * @property {Record<string, string | undefined> | undefined} resolving ref → durable selector, per command
   * @property {string | undefined} videoDir
   * @property {number} openedAt
   * @property {number} lastUsedAt
   * @property {() => Promise<{ video?: string }>} end
   * @property {{ action: 'accept' | 'dismiss', text?: string, once?: boolean }} dialogPolicy
   * @property {Set<string>} secretValues every secret any command of this session carried (§2.6: per session, not per request)
   * @property {Promise<unknown>} writes the journal / console / net appends, chained in order and awaited only by `close` / `export`
   * @property {number} journalSeq
   * @property {number} [fetchSeq]
   * @property {number} [runSeq]
   */

  /** @type {Map<string, Session>} */
  const sessions = new Map();
  /** A session step waits this long for an action before it is a FAIL (the config default). */
  const sessionTimeoutMs = Number(env.BI_STEP_TIMEOUT_MS) || 10_000;

  /**
   * Counted by `probe` after every command: the roles an agent can act on. Kept as a selector
   * (one `querySelectorAll`, ~1 ms) rather than the element map of the final evidence, which
   * also serialises names and selectors.
   */
  const INTERACTIVE_SELECTOR =
    'a[href],button,input:not([type=hidden]),select,textarea,summary,[role=button],[role=link],' +
    '[role=checkbox],[role=radio],[role=tab],[role=menuitem],[role=option],[role=switch],[role=combobox],' +
    '[role=textbox],[role=slider],[role=spinbutton],[contenteditable=""],[contenteditable=true]';

  /**
   * The session's init script: a MutationObserver counter every document of the context gets,
   * so `dom Δ` costs one property read instead of a snapshot (§4.2). One global, prefixed.
   */
  const DOM_COUNTER_SCRIPT =
    '(() => { const w = window; w.__bi_dom = 0; try { new MutationObserver((m) => { w.__bi_dom += m.length; })' +
    '.observe(document, { subtree: true, childList: true, attributes: true, characterData: true }); } catch {} })();';

  /**
   * In-page: the after-probe of a command. Named, so a FakePage can recognise it by `fn.name`.
   * @param {string} selector
   */
  function sessionProbe(selector) {
    return {
      el: document.querySelectorAll(selector).length,
      dom: Number(/** @type {any} */ (window).__bi_dom ?? 0),
      title: document.title,
    };
  }

  /** Console errors + page errors — what `err N` and `+N console.error` count. @param {Recorder} recorder */
  const errorCount = (recorder) =>
    recorder.console.filter((e) => e.type === 'error').length + recorder.pageErrors.length;

  /**
   * Every tab of a session gets its CDP session (`Page.enable` for screenshots and evaluate), a
   * popup hook that pulls the popup into the same recorder and arms it too, and a request hook
   * that keeps the request headers the recorder does not (for `net <n> --req`).
   * @param {Session} session @param {PageLike} page
   */
  async function armSessionPage(session, page) {
    if (session.cdps.has(page)) return;
    /** @type {CdpLike} */
    let cdp;
    try {
      cdp = await session.context.newCDPSession(page);
      await cdp.send('Page.enable').catch(() => {});
    } catch (error) {
      log(`session ${session.name}: no CDP session (${errorMessage(error)}) — screenshots via Playwright`);
      cdp = {
        send: async () => {
          throw new Error('no CDP session on this tab');
        },
      };
    }
    session.cdps.set(page, cdp);
    page.on('popup', (popup) => {
      attachRecorder(popup, { into: session.recorder });
      void armSessionPage(session, popup);
    });
    page.on('request', (request) => {
      // The recorder's own listener ran first (same page, registered earlier), so `seq` is this
      // request's id. Capped: the map is a convenience for `--req`, not an archive.
      const headers = typeof request.headers === 'function' ? request.headers() : {};
      const postData = typeof request.postData === 'function' ? (request.postData() ?? undefined) : undefined;
      session.requestMeta.set(session.recorder.seq, { headers, ...(postData ? { postData } : {}) });
      if (session.requestMeta.size > 500) {
        const oldest = session.requestMeta.keys().next().value;
        if (oldest !== undefined) session.requestMeta.delete(oldest);
      }
    });
    page.on('close', () => {
      session.cdps.delete(page);
    });
  }

  /**
   * Create a session on `bi open`: a fresh context (the prewarmed spare, or a recording one for
   * `--video`), the recorder, the step context that every later command reuses.
   * @param {string} name
   * @param {{ cwd: string, out?: string, video?: boolean, secretValues?: string[] }} where
   * @returns {Promise<Session>}
   */
  async function openSession(name, where) {
    if (closed) throw new Error('engine closed');
    await ensureBrowser();
    const out = where.out ?? path.resolve(where.cwd, DEFAULT_OUTPUT_DIR);
    const dir = sessionDir(out, name);
    await mkdir(dir, { recursive: true });
    const videoDir = where.video ? path.join(dir, 'video') : undefined;
    const pair = await freshContext({ video: videoDir });
    const recorder = attachRecorder(pair.page);
    await pair.context.addInitScript?.(DOM_COUNTER_SCRIPT).catch?.(() => {});
    /** @type {Session} */
    const session = {
      name,
      dir,
      cwd: where.cwd,
      out,
      context: pair.context,
      laneTab: pair.page,
      recorder,
      ctx: /** @type {any} */ (undefined),
      cdps: new Map(),
      requestMeta: new Map(),
      shotSeq: 0,
      evalSeq: 0,
      commands: 0,
      docs: 0,
      el: 0,
      dom: 0,
      title: undefined,
      baseOrigin: undefined,
      prevCompact: undefined,
      cursors: {},
      flushed: {},
      resolving: undefined,
      videoDir,
      openedAt: Date.now(),
      lastUsedAt: Date.now(),
      end: () => endSession(name),
      dialogPolicy: recorder.dialogPolicy,
      secretValues: new Set((where.secretValues ?? []).filter((v) => v !== '')),
      writes: Promise.resolve(),
      // A session reopened over yesterday's journal keeps numbering where it stopped.
      journalSeq: journalLineCount(journalPath(dir)),
    };
    await armSessionPage(session, pair.page);
    const ctx = makeStepContext({
      page: pair.page,
      context: pair.context,
      cdp: /** @type {CdpLike} */ (session.cdps.get(pair.page)),
      recorder,
      dir,
      timeoutMs: sessionTimeoutMs,
      mode: 'session',
      session,
      cwd: where.cwd,
      laneTab: pair.page,
      secretValues: [...session.secretValues],
    });
    ctx.unsafe = env.BI_UNSAFE === '1';
    // The durable selector of a ref is captured WHEN the action resolves it (§4.5): the element is
    // there (`count() > 0` just passed) and may be gone right after the click.
    const baseSel = ctx.sel;
    ctx.sel = async (step, field) => {
      const selector = await baseSel(step, field);
      const ref = step.ref;
      if (typeof ref === 'string' && field !== 'selector' && session.resolving && !(ref in session.resolving)) {
        session.resolving[ref] = await durableSelector(ctx, ref);
      }
      return selector;
    };
    session.ctx = ctx;
    sessions.set(name, session);
    log(`session ${name} opened → ${dir}`);
    return session;
  }

  /**
   * End a session: close its context (a recording is complete only then — the video is saved
   * after the close), forget it. Idempotent.
   * @param {string} name
   * @returns {Promise<{ video?: string }>}
   */
  async function endSession(name) {
    const session = sessions.get(name);
    if (!session) return {};
    sessions.delete(name);
    // The journal and the jsonl logs are appended off the answer path — they must be complete
    // before the directory is read as a finished session.
    await session.writes.catch(() => undefined);
    const video = session.videoDir ? session.laneTab.video?.() : undefined;
    await session.context.close().catch(() => {});
    /** @type {{ video?: string }} */
    const result = {};
    if (video) {
      const file = path.join(session.videoDir ?? session.dir, 'session.webm');
      await video
        .saveAs(file)
        .then(() => video.delete().catch(() => {}))
        .then(() => {
          result.video = file;
        })
        .catch((/** @type {unknown} */ error) => log(`session ${name}: video not saved: ${errorMessage(error)}`));
    }
    log(`session ${name} closed after ${String(session.commands)} commands`);
    return result;
  }

  /**
   * The line's head: the command as the agent typed it plus its target (`click e112`, `fill e39`,
   * `open …` — never a fill value; `describeStep` already says `(literal)` / `(from env X)` instead,
   * and that suffix is a report detail, not a stdout one).
   * @param {string} alias @param {Step} step
   */
  function headOf(alias, step) {
    const described = describeStep(step).replace(/ \((?:literal|from env [^)]*|soft)\)/gu, '');
    const space = described.indexOf(' ');
    return space === -1 ? alias : `${alias}${described.slice(space)}`;
  }

  /**
   * What the page looks like after a command — ONE evaluate (~1 ms) with a short cap, so a hung
   * page costs a line without deltas, never a stuck agent.
   * @param {Session} session
   */
  async function probePage(session) {
    const page = session.ctx.page;
    const raw = await degradeTo(
      undefined,
      Promise.resolve()
        .then(() => page.evaluate(sessionProbe, INTERACTIVE_SELECTOR))
        .catch(() => undefined),
      1500,
      'session probe',
    );
    if (raw && typeof raw === 'object') {
      session.el = Number(raw.el ?? session.el);
      session.dom = Number(raw.dom ?? session.dom);
      session.title = typeof raw.title === 'string' ? raw.title : session.title;
    }
    return { el: session.el, dom: session.dom, title: session.title, url: safeUrl(page) };
  }

  /** @param {PageLike} page */
  function safeUrl(page) {
    try {
      return page.url();
    } catch {
      return '';
    }
  }

  /**
   * Append what the recorder saw since the last flush to `console.jsonl` / `net.jsonl` — the
   * session's memory of what scrolled past, redacted, one line per entry.
   * @param {Session} session
   */
  function flushLogs(session) {
    const { recorder, ctx } = session;
    const lines = (/** @type {any[]} */ entries) => entries.map((e) => ctx.redact(JSON.stringify(e))).join('\n');
    const fromConsole = Math.min(session.flushed.console ?? 0, recorder.console.length);
    const fromNet = Math.min(session.flushed.net ?? 0, recorder.network.length);
    const newConsole = recorder.console.slice(fromConsole);
    const newNet = recorder.network.slice(fromNet).map((e) => {
      const { startedAt: _dropped, ...rest } = /** @type {any} */ (e);
      return rest;
    });
    session.flushed.console = recorder.console.length;
    session.flushed.net = recorder.network.length;
    const writes = [];
    if (newConsole.length > 0)
      writes.push(appendFile(path.join(session.dir, 'console.jsonl'), `${lines(newConsole)}\n`));
    if (newNet.length > 0) writes.push(appendFile(path.join(session.dir, 'net.jsonl'), `${lines(newNet)}\n`));
    return Promise.allSettled(writes);
  }

  /**
   * @typedef {object} CommandContext
   * @property {string} [command] canonical name
   * @property {string} [alias] as typed (`open`, `snap`)
   * @property {{ session?: string, out?: string, soft?: boolean }} [options]
   * @property {string} cwd
   * @property {string} [out] absolute output dir (the keeper resolved `--out`)
   * @property {Record<string, string>} [values]
   * @property {string[]} [secretValues]
   * @property {Record<string, any>} [files]
   * @property {TimingMode} [mode]
   * @property {number} [queuedMs]
   * @property {(text: string) => string} [redact]
   * @property {(line: string) => void} [log]
   */

  /**
   * One session command (keeper: `runCommand(name, step, ctx)`, docs/handoff/WP5.md). Returns
   * `{ exit, lines, files, timing }` and never throws for a page problem: a failed step is
   * `FAIL <head> · <reason>` with exit 1; only a missing session, a refused `run` and a closed
   * engine answer differently.
   * @param {string} name session name
   * @param {Step} step the step as the parser built it (config shape)
   * @param {CommandContext} cmd
   * @param {string} [address] value address of the step (`argv.fill`, `script[3]`)
   * @returns {Promise<{ exit: number, lines: string[], files: string[], timing: { totalMs: number, stepMs: number } }>}
   */
  async function runCommand(name, step, cmd, address) {
    const started = now();
    if (closed) throw new Error('engine closed');
    const canonical = resolveStepName(step.do) ?? String(step.do);
    const alias = cmd.alias ?? canonical;
    const def = STEPS[canonical];
    const head = headOf(alias, step);
    /** @type {Session | undefined} */
    let session = sessions.get(name);
    // Secrets are per SESSION (§2.6): a value filled from env three commands ago must still be
    // `***` in this command's `get --value`, `snap`, `eval`, journal and logs — so the redactor
    // reads the session's union, not the request's list.
    const secretsNow = () => (session ? [...session.secretValues] : (cmd.secretValues ?? []).filter((v) => v !== ''));
    const redactor = (/** @type {string} */ t) => {
      const own = redact(t, secretsNow());
      return cmd.redact ? cmd.redact(own) : own;
    };
    /** @param {number} exit @param {string[]} lines @param {string[]} [files] */
    const answer = (exit, lines, files = []) => ({
      exit,
      lines: lines.map(redactor),
      files,
      timing: { totalMs: ms(started), stepMs: 0 },
    });
    if (!def) return answer(2, [formatFail(head, `unknown command ${JSON.stringify(String(step.do))}`)]);

    if (!session) {
      if (canonical !== 'goto') return answer(1, [formatFail(head, `no open session "${name}" → bi open <url>`)]);
      session = await openSession(name, {
        cwd: cmd.cwd,
        out: cmd.out,
        video: step.video === true,
        secretValues: cmd.secretValues,
      });
    } else if (canonical === 'goto' && step.video === true && !session.videoDir) {
      return answer(1, [formatFail(head, 'the session is not recording — bi close, then bi open <url> --video')]);
    }
    if (canonical === 'run' && env.BI_UNSAFE !== '1') {
      // Refused BEFORE anything runs, with exit 2: this is the one RCE-equivalent command (§2.6).
      return answer(2, [
        formatFail(head, 'refused: set BI_UNSAFE=1 (the file runs inside the keeper — RCE-equivalent)'),
      ]);
    }
    for (const v of cmd.secretValues ?? []) if (typeof v === 'string' && v !== '') session.secretValues.add(v);

    const ctx = session.ctx;
    ctx.values = cmd.values ?? {};
    ctx.files = cmd.files ?? {};
    ctx.secretValues = [...session.secretValues];
    ctx.redact = (text) => redact(text, ctx.secretValues);
    ctx.cwd = cmd.cwd;
    ctx.address = address ?? `argv.${canonical}`;
    ctx.lines = [];
    ctx.written = [];
    ctx.capture.screenshots = [];
    ctx.capture.pending = [];
    ctx.capture.extracts = {};
    ctx.capture.verifications = [];
    ctx.unsafe = env.BI_UNSAFE === '1';
    session.lastUsedAt = Date.now();
    session.commands += 1;
    session.resolving = {};
    const recorder = session.recorder;
    const before = {
      url: safeUrl(ctx.page),
      title: session.title,
      el: session.el,
      dom: session.dom,
      consoleErrors: errorCount(recorder),
      netFailed: recorder.failedTotal ?? 0,
      navigations: recorder.navigations,
      dialogs: recorder.dialogs.length,
      page: ctx.page,
    };

    const result = await runStep(ctx, step, session.commands);
    const stepMs = result.ms ?? 0;
    const stillOpen = sessions.get(name) === session;

    if (stillOpen) {
      // `tab new` / `tab <n>` / `tab close` moved `ctx.page`: the CDP session must follow it.
      if (ctx.page !== before.page) {
        await armSessionPage(session, ctx.page);
        ctx.cdp = /** @type {CdpLike} */ (session.cdps.get(ctx.page));
      }
      await Promise.allSettled(ctx.capture.pending ?? []);
    }

    /** @type {string[]} */
    let lines;
    /** @type {ReturnType<typeof formatDeltas>} */
    let deltas = [];
    let after = { url: before.url, title: before.title, el: before.el, dom: before.dom };
    if (stillOpen) {
      after = await probePage(session);
      const navigated = recorder.navigations > before.navigations && canonical !== 'tab';
      if (navigated) session.docs += recorder.navigations - before.navigations;
      if (canonical === 'goto' && !session.baseOrigin) session.baseOrigin = originOf(after.url) ?? undefined;
      deltas = formatDeltas(
        {
          url: before.url,
          title: before.title,
          el: before.el,
          consoleErrors: before.consoleErrors,
          netFailed: before.netFailed,
        },
        {
          url: after.url,
          title: after.title,
          // `el` only when it says something: after a navigation (a new count) or when it moved.
          el: canonical !== 'tab' && (navigated || after.el !== before.el) ? after.el : undefined,
          consoleErrors: errorCount(recorder),
          netFailed: recorder.failedTotal ?? 0,
          navigated,
          frameSeq: Math.max(1, session.docs - 1),
          domChanged: !navigated && after.dom !== before.dom,
          dialogs: /** @type {any[]} */ (recorder.dialogs.slice(before.dialogs)),
        },
        { baseOrigin: session.baseOrigin },
      );
    }

    if (!result.ok) {
      lines = [
        formatFail(
          head,
          result.error ?? 'failed',
          deltas.filter((d) => d.startsWith('dialog ')),
        ),
      ];
    } else if (canonical === 'goto') {
      // `open`: the snapshot files are written now (§4.1), so the next `find`/`click` has a map.
      let snapPath = '';
      try {
        const text = await withDeadline(
          ctx.page.ariaSnapshot({ mode: 'ai', boxes: true }),
          ctx.timeoutMs,
          'open snapshot',
        );
        ctx.lastSnapshot = { text, at: Date.now() };
        const md = await ctx.writeSnapshot(text, {});
        session.prevCompact = String(ctx.lastSnapshot?.compact ?? '')
          .split('\n')
          .filter((l) => l !== '');
        snapPath = relPath(path.join(session.dir, md), cmd.cwd);
      } catch (error) {
        log(`session ${name}: open snapshot failed: ${errorMessage(error)}`);
      }
      lines = [
        formatOpen({
          title: after.title ?? '',
          el: after.el,
          errors: Math.max(0, errorCount(recorder) - before.consoleErrors),
          snapPath,
        }),
      ];
    } else if (canonical === 'screenshot') {
      const shot = ctx.lastShot;
      const file = shot ? relPath(path.join(session.dir, shot.file), cmd.cwd) : '';
      lines = [
        shot?.width !== undefined && shot?.height !== undefined
          ? formatShot(file, shot.width, shot.height)
          : formatOk(`${alias} ${file}`),
      ];
    } else if (canonical === 'pdf') {
      const file = ctx.written.find((f) => f.endsWith('.pdf'));
      lines = [formatOk(`${alias} ${file ? relPath(path.join(session.dir, file), cmd.cwd) : ''}`.trimEnd())];
    } else if (canonical === 'verify') {
      const verdict = ctx.capture.verifications.at(-1);
      lines = [verdict && !verdict.ok ? formatFail(head, `${verdict.detail ?? 'failed'} (soft)`) : formatOk(head)];
    } else if (typeof step.name === 'string' && ctx.capture.extracts[step.name]) {
      lines = [formatOk(head, [truncate(ctx.capture.extracts[step.name].value, 100)])];
    } else if (def.kind === 'query') {
      lines = ctx.lines.length > 0 ? [...ctx.lines] : [formatOk(head)];
    } else if (def.kind === 'action' || canonical === 'tab') {
      lines = [formatOk(head, deltas)];
    } else {
      lines =
        ctx.lines.length > 0
          ? [...ctx.lines]
          : [
              formatOk(
                head,
                deltas.filter((d) => d.startsWith('dialog ')),
              ),
            ];
    }
    lines = lines.map(redactor);

    // The journal: the step as parsed (never a resolved secret), the verdict, the selector the
    // action resolved for its ref(s) — what `bi export` replays tomorrow.
    /** @type {Record<string, string>} */
    const resolved = {};
    let selector;
    for (const field of refFieldsOf(step, def)) {
      const ref = readRefPath(step, field);
      const found = typeof ref === 'string' ? session.resolving?.[ref] : undefined;
      if (typeof found !== 'string') continue;
      if (field === 'ref') selector = found;
      else resolved[field] = found;
    }
    session.resolving = undefined;
    // The appends ride a per-session chain that the answer does not wait for (§6 budgets the
    // whole "writes" phase at 10 ms; a Defender scan on journal.jsonl must not sit in the agent's
    // stopwatch). Order is kept by the chain; `close` and `export` await it.
    session.journalSeq += 1;
    const journalLine = formatJournalLine(
      {
        seq: session.journalSeq,
        command: canonical,
        step,
        ok: result.ok,
        ms: stepMs,
        url: after.url,
        ...(after.title !== undefined ? { title: after.title } : {}),
        ...(selector !== undefined ? { selector } : {}),
        ...(Object.keys(resolved).length > 0 ? { resolved } : {}),
        line: lines[0] ?? '',
        ...(result.ok ? {} : { error: result.error }),
      },
      ctx.secretValues,
    );
    const flushed = stillOpen ? flushLogs(session) : undefined;
    const target = session;
    session.writes = session.writes
      .then(async () => {
        await mkdir(target.dir, { recursive: true });
        await appendFile(journalPath(target.dir), journalLine, 'utf8');
        if (flushed) await flushed;
      })
      .catch((error) => log(`session ${name}: journal: ${errorMessage(error)}`));

    const files = [...ctx.written, ...ctx.capture.screenshots].map((f) => path.join(session.dir, f));
    return {
      exit: result.ok ? 0 : 1,
      lines,
      files,
      timing: { totalMs: ms(started), stepMs },
    };
  }

  /**
   * `fields[1].ref` / `ref` / `from` — the ref a `refFieldsOf` path points at.
   * @param {Step} step @param {string} fieldPath
   */
  function readRefPath(step, fieldPath) {
    const match = /^fields\[(\d+)\]\.ref$/u.exec(fieldPath);
    return match ? /** @type {any} */ (step.fields)?.[Number(match[1])]?.ref : step[fieldPath];
  }

  /**
   * `bi script <file>`: the lines of a session, one command each, run in one process. Values
   * arrive under `script[<line index>]` — split with the client's own `splitCommandLine`, so the
   * addresses agree (docs/handoff/WP5.md). Stops at the first FAIL like an `&&` chain would.
   * @param {string[]} lines every line of the file, comments included (indexes = addresses)
   * @param {CommandContext & { session?: string }} cmd
   */
  async function runScript(lines, cmd) {
    const name = cmd.session ?? 'default';
    /** @type {string[]} */
    const out = [];
    /** @type {string[]} */
    const files = [];
    let exit = 0;
    for (const [i, line] of lines.entries()) {
      if (isScriptComment(line)) continue;
      const argv = splitCommandLine(line);
      let parsed;
      try {
        parsed = parseSessionCommand(argv[0], argv.slice(1));
      } catch (error) {
        out.push(`FAIL script:${String(i + 1)} · ${errorMessage(error)}`);
        exit = error instanceof CliError ? error.exit : 2;
        break;
      }
      const result = await runCommand(
        name,
        /** @type {Step} */ (parsed.step),
        { ...cmd, alias: argv[0], command: parsed.name, options: parsed.options },
        `script[${String(i)}]`,
      );
      out.push(...result.lines);
      files.push(...result.files);
      const soft = parsed.options.soft === true && result.exit === 1;
      if (result.exit !== 0 && !soft) {
        exit = result.exit;
        break;
      }
    }
    return { exit, lines: out, files };
  }

  /**
   * `bi export <flow.json>`: the journal of a session → a batch config (WP4's `exportFlow`).
   * @param {string} name
   * @param {{ file: string, force?: boolean, cwd: string, out?: string, secretValues?: string[] }} opts
   */
  async function exportSession(name, opts) {
    const session = sessions.get(name);
    const dir = session?.dir ?? sessionDir(opts.out ?? path.resolve(opts.cwd, DEFAULT_OUTPUT_DIR), name);
    if (session) await session.writes.catch(() => undefined);
    const entries = readJournal(journalPath(dir));
    try {
      const secretValues = [...new Set([...(opts.secretValues ?? []), ...(session?.secretValues ?? [])])];
      const { config, count } = exportFlow(entries, { file: opts.file, secretValues });
      const written = writeFlowExport(opts.file, config, { force: opts.force === true });
      return { exit: 0, lines: [formatExport(count, relPath(written, opts.cwd))], files: [written] };
    } catch (error) {
      const exit = error instanceof ExportError ? error.exit : 2;
      return { exit, lines: [formatFail('export', errorMessage(error))], files: [] };
    }
  }

  async function close() {
    closed = true;
    for (const name of [...sessions.keys()]) await endSession(name).catch(() => {});
    await closeBrowser();
  }

  /**
   * What `bi status` prints and what the keeper's recycling and `warm|first` rule read. Cheap by
   * contract: `modeFor()` calls it at the start of EVERY job, so nothing here may spawn a process
   * — the RSS is the last `sampleRss()` result.
   */
  function status() {
    return {
      connected,
      channel,
      browser: browser ? browserLabel() : undefined,
      browserRssMb,
      rssMb: browserRssMb,
      pwVersion: versions['playwright-core'],
      pid: browserPids[0],
      pids: [...browserPids],
      launches,
      launchMs,
      jobs,
      jobsSinceLaunch,
      scrubs,
      maxJobs,
      maxRssMb,
      routes: [...sessions.values()].reduce((sum, s) => sum + s.ctx.routes.length, 0),
      sessions: [...sessions.values()].map((s) => ({
        name: s.name,
        cwd: s.cwd,
        out: s.out,
        dir: s.dir,
        commands: s.commands,
        tabs: s.context.pages?.().length ?? 1,
        openedAt: s.openedAt,
        lastUsedAt: s.lastUsedAt,
      })),
      spare: spare !== null,
      lanes: [...lanes.values()].map((lane) => ({
        index: lane.index,
        dirty: lane.dirty,
        busy: lane.busy,
        jobs: lane.jobs,
        generation: lane.generation,
        scrubErrors: lane.scrubErrors,
        lastUsedAt: lane.lastUsedAt,
      })),
    };
  }

  // The keeper awaits `ready` before its first job; the launch failure (E_BROWSER_MISSING) surfaces
  // there. The side handler keeps a never-awaited rejection from crashing a test process.
  const ready = options.prelaunch === false ? Promise.resolve() : ensureBrowser().then(() => undefined);
  ready.catch(() => {});

  const self = {
    ready,
    versions,
    warm: () => ensureBrowser().then(() => undefined),
    runFlow,
    finishRun,
    runBatch,
    scrub,
    scrubIfDirty,
    sampleRss,
    applyScrub,
    laneState,
    getLane,
    freshContext,
    makeStepContext,
    resolveSelector,
    navigate,
    runStep,
    writeSnapshotFiles,
    // session half (WP6) — the keeper probes these with `?.`
    runCommand: (/** @type {string} */ name, /** @type {Step} */ step, /** @type {CommandContext} */ cmd) =>
      runCommand(name, step, cmd),
    runScript,
    exportFlow: exportSession,
    session: (/** @type {string} */ name) => sessions.get(name),
    closeSession: (/** @type {string} */ name) => endSession(name).then(() => undefined),
    openSession,
    recycle,
    status,
    stats: status,
    close,
    /** @param {string} event @param {(...args: any[]) => void} cb */
    on: (event, cb) => {
      listeners.set(event, [...(listeners.get(event) ?? []), cb]);
    },
    get browser() {
      return browser;
    },
    get lanes() {
      return lanes;
    },
    RUNNERS,
  };
  return self;
}

/** @typedef {ReturnType<typeof createEngine>} Engine */

/** Whether the package directory carries the portable marker — informational for `bi status`. */
export const isPortable = () => existsSync(path.join(PACKAGE_DIR, 'PORTABLE'));
