// lanes.mjs — the browser and its lanes: launch, `scratch[0..N-1]`, the scrub, health, recycling
// (DESIGN.md §2.2, §2.3).
//
// Kept out of `engine.mjs` so the pool is one readable unit: it launches the system Chrome/Edge
// (chrome → msedge, `E_BROWSER_MISSING` with every attempt named), keeps `scratch[0..N-1]` lanes —
// each a persistent context with ONE persistent tab that is scrubbed IN PLACE between runs
// (DOMStorage.clear + generation script + clearDataForOrigin + context resets +
// resetNavigationHistory, 12–35 ms measured) instead of a new tab (renderer dies with the tab:
// +160 ms on the next goto) — a prewarmed `spare` context+page pair for the runs that must be
// fresh (auth, video, `isolation: "fresh"`, `--fresh`), and the health rules: a disconnected
// browser is fatal, a crashed renderer rebuilds the lane's tab at the next scrub,
// `BROWSER_INSPECTOR_MAX_JOBS` / `BROWSER_INSPECTOR_MAX_RSS_MB` recycle the browser BETWEEN jobs.
//
// `createLanePool` owns every piece of that state; `engine.mjs` composes it with the flow half
// (`flow.mjs`) and the session half (`session.mjs`) and keeps the three hooks the pool cannot know
// about: `isClosed` (the engine is shutting down), `onDisconnected` (the engine's listeners) and
// `beforeClose` (a session cannot outlive its browser).
//
// playwright-core is imported lazily inside `launchBrowser`: the unit tests hand the engine a fake
// browser and never pay the 270 ms import, and the keeper listens on its pipe BEFORE it imports.

import { readFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';

import { isDeadline, withDeadline } from './deadline.mjs';
import { DEFAULT_VIEWPORT, GEN_SCRIPT, scrubPlan } from './isolation.mjs';
import { attachRecorder, errorMessage, originOf } from './recorder.mjs';

/** @typedef {import('./types.js').PageLike} PageLike */
/** @typedef {import('./types.js').ContextLike} ContextLike */
/** @typedef {import('./types.js').CdpLike} CdpLike */
/** @typedef {import('./recorder.mjs').Recorder} Recorder */
/** @typedef {import('./types.js').LaneState} LaneState */
/** @typedef {import('./types.js').ScrubOp} ScrubOp */

export const E_BROWSER_MISSING = 'E_BROWSER_MISSING';
/**
 * Headless flags on by default; `fastHeadless: false` turns them off. The first two: click 45–58 →
 * 25–54 ms measured. `--disable-gpu-compositing`: one second after every `load`, a delayed task
 * from blink's `widget_base.cc` releases the renderer's LayerTreeFrameSink (`ProxyMain::Stop`,
 * then `SetLayerTreeFrameSink` on the next paint) and the GPU-process round trip blocks the
 * renderer main thread for 80–490 ms (Chrome 152 headless, Windows, trace in
 * docs/handoff/FINAL.md). A warm run that starts 300 ms after the previous one lands exactly on
 * it — the bench's `browser-inspector-warm` was 746 ms against 355 ms for `browser-inspector-warm-tight`. Software compositing
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
export const DEFAULT_TIMEOUT_MS = 30_000;
/** In-page storage clear of the scrub — the page is still on its origin, so this is ~1 ms. */
const STORAGE_CLEAR_EXPRESSION =
  '(() => { try { sessionStorage.clear(); } catch (e) {} try { localStorage.clear(); } catch (e) {} return true; })()';
const execFileAsync = promisify(execFile);
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
        'Install Google Chrome or Microsoft Edge, or point browser.executablePath / BROWSER_INSPECTOR_BROWSER_PATH at a Chromium binary.',
    );
    this.name = 'BrowserMissingError';
    this.code = E_BROWSER_MISSING;
    this.attempts = attempts;
  }
}

/**
 * What `launchBrowser` will try, in order — pure, so the order and the env overrides are a unit
 * test: `BROWSER_INSPECTOR_BROWSER_PATH` / `executablePath` win outright, `BROWSER_INSPECTOR_CHANNEL` / `channel` narrow the list,
 * `BROWSER_INSPECTOR_BROWSER_ARGS` REPLACES the flags entirely (a container needs `--no-sandbox` and nothing else).
 * @param {BrowserOptions} [browser]
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {{ attempts: { channel?: string, executablePath?: string }[], headless: boolean, args: string[] }}
 */
export function launchPlan(browser = {}, env = process.env) {
  const headless = browser.headless !== false;
  // An empty (or blank) variable is NOT an override — the identity hashes it as "unset", so
  // honouring it here launched a browser without the fast-headless flags under a hash that promised
  // them, and two such clients shared one keeper.
  const envArgs = (env.BROWSER_INSPECTOR_BROWSER_ARGS ?? '').split(/\s+/u).filter(Boolean);
  const args =
    envArgs.length > 0
      ? envArgs
      : [...(headless && browser.fastHeadless !== false ? FAST_HEADLESS_ARGS : []), ...(browser.args ?? [])];
  const executablePath = env.BROWSER_INSPECTOR_BROWSER_PATH || browser.executablePath;
  if (executablePath) return { attempts: [{ executablePath }], headless, args };
  const channel = env.BROWSER_INSPECTOR_CHANNEL || browser.channel;
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
 * The pool of one browser and its lanes. Every knob is read here (`options` first, then the
 * environment) so the engine does not have to restate them.
 * @param {{
 *   options: Record<string, any>,
 *   env: NodeJS.ProcessEnv,
 *   log: (line: string) => void,
 *   isClosed: () => boolean,
 *   onDisconnected: () => void,
 * }} input
 */
export function createLanePool(input) {
  const { options, env, log, isClosed, onDisconnected } = input;
  const browserOpts = options.browser ?? {};
  const laneIdleMs = options.laneIdleMs ?? (Number(env.BROWSER_INSPECTOR_LANE_IDLE_MS) || LANE_IDLE_MS_DEFAULT);
  const scrubOpMs = options.scrubOpMs ?? (Number(env.BROWSER_INSPECTOR_SCRUB_OP_MS) || SCRUB_OP_MS_DEFAULT);
  /** @type {'no-preference' | 'reduce'} */
  const motion = browserOpts.motion === 'reduce' ? 'reduce' : 'no-preference';
  /** Closing the sessions before the browser goes away — `engine.mjs` wires it after creation. */
  let beforeClose = async () => {};

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
  /** The last RSS sample (MB) and its pids — `status()` reads the cache, never a process list. */
  let browserRssMb = 0;
  /** @type {number[]} */
  let browserPids = [];
  /** @type {any} */
  let browserCdp = null;
  /** @type {Promise<number> | null} */
  let sampling = null;

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
      if (!isClosed()) onDisconnected();
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
        const context = await browser.newContext({
          viewport: { ...DEFAULT_VIEWPORT },
          serviceWorkers: 'allow',
          ...(motion === 'reduce' ? { reducedMotion: 'reduce' } : {}),
        });
        const page = await context.newPage();
        if (connected && !isClosed()) spare = { context, page };
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
      // `browser.motion` shapes EVERY context, not only the lanes: without it here a session, an
      // auth run and every `isolation: "fresh"` snapshot ran with animations while the report
      // header still printed `motion=reduce`.
      ...(motion === 'reduce' ? { reducedMotion: 'reduce' } : {}),
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
            // `null` goes to the browser as `no-override`, which drops the CONTEXT option too
            // instead of falling back to it — so a plain reset turned `browser.motion: "reduce"`
            // off for the rest of the tab's life while the report kept saying `motion=reduce`.
            lane.page.emulateMedia({
              colorScheme: null,
              reducedMotion: motion === 'reduce' ? 'reduce' : null,
              media: null,
            }),
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
    // A session cannot outlive its browser: an agent's `browser-inspector click` after a recycle must hear "no
    // open session", not "Target closed" from a context that no longer exists.
    await beforeClose();
    browser = null;
    connected = false;
    lanes.clear();
    spare = null;
    browserCdp = null;
    if (old) await old.close().catch(() => {});
  }

  /** One more job on a lane — the counters the recycling rule and `timing.mode` read. */
  function noteJob(/** @type {Lane} */ lane) {
    jobs += 1;
    jobsSinceLaunch += 1;
    lane.jobs += 1;
    lane.lastUsedAt = Date.now();
  }

  return {
    ensureBrowser,
    browserLabel,
    prewarmSpare,
    freshContext,
    getLane,
    applyScrub,
    laneState,
    scrub,
    scrubIfDirty,
    reapIdleLanes,
    sampleRss,
    recycle,
    closeBrowser,
    noteJob,
    motion,
    /** @param {() => Promise<void>} fn */
    setBeforeClose: (fn) => {
      beforeClose = fn;
    },
    get browser() {
      return browser;
    },
    get connected() {
      return connected;
    },
    get channel() {
      return channel;
    },
    get flags() {
      return flags;
    },
    get launches() {
      return launches;
    },
    get launchMs() {
      return launchMs;
    },
    get jobs() {
      return jobs;
    },
    get jobsSinceLaunch() {
      return jobsSinceLaunch;
    },
    get scrubs() {
      return scrubs;
    },
    get lanes() {
      return lanes;
    },
    get spare() {
      return spare;
    },
    get rssMb() {
      return browserRssMb;
    },
    get pids() {
      return browserPids;
    },
  };
}

/** @typedef {ReturnType<typeof createLanePool>} LanePool */
