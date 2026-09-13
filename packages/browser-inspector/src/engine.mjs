// engine.mjs — ONE engine on playwright-core for both entrances (DESIGN.md §2.2, §2.3, §5, §6).
//
// This file is the composition root, nothing else: it normalizes the two spellings of
// `createEngine`, wires four parts together and hands out ONE object that both entrances drive.
//
//   `lanes.mjs`      the browser and its lanes — launch, `scratch[0..N-1]`, the scrub, RSS, recycling
//   `steps.ctx.mjs`  the step context and `runStep` — what every runner in `steps.run.mjs` sees
//   `flow.mjs`       the batch half (WP2): `runFlow`, `runBatch`, `finishRun`
//   `session.mjs`    the session half (WP6): `runCommand`, `runScript`, `exportFlow`
//
// The halves share the pool and the step context and nothing else, which is the point: a batch
// `click` and `browser-inspector click` are the same runner on the same context. Three things only
// the engine can know stay here and are injected downwards: `closed` (this engine is shutting
// down), the `on('disconnected')` listeners, and the rule that a session cannot outlive its
// browser (`pool.setBeforeClose`).
//
// The keeper (`keeper.mjs`) drives this through `createEngine(browserOpts, { log, env })`,
// `ready`, `runFlow`, `finishRun`, `status`, `recycle`, `on('disconnected')`, `close` — the same
// engine the `--no-daemon` path creates in-process.
//
// playwright-core is imported lazily inside `launchBrowser` (`lanes.mjs`): the unit tests hand the
// engine a fake browser and never pay the 270 ms import, and the keeper listens on its pipe BEFORE
// it imports.

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createFlowRunner } from './flow.mjs';
import { MAX_JOBS_DEFAULT, MAX_RSS_MB_DEFAULT, createLanePool } from './lanes.mjs';
import { packageVersion, playwrightCoreVersion } from './paths.mjs';
import { errorMessage } from './recorder.mjs';
import { createSessions } from './session.mjs';
import { makeStepContext, navigate, resolveSelector, runStep, writeSnapshotFiles } from './steps.ctx.mjs';
import { RUNNERS } from './steps.run.mjs';

/** @typedef {import('./types.js').Step} Step */
/** @typedef {import('./lanes.mjs').BrowserOptions} BrowserOptions */
/** @typedef {import('./flow.mjs').FlowResult} FlowResult */
/** @typedef {import('./flow.mjs').LaneOptions} LaneOptions */
/** @typedef {import('./session.mjs').CommandContext} CommandContext */

const PACKAGE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

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
  const maxJobs = options.maxJobs ?? (Number(env.BROWSER_INSPECTOR_MAX_JOBS) || MAX_JOBS_DEFAULT);
  const maxRssMb = options.maxRssMb ?? (Number(env.BROWSER_INSPECTOR_MAX_RSS_MB) || MAX_RSS_MB_DEFAULT);
  const log = options.log ?? (() => {});
  const versions = {
    'browser-inspector': packageVersion(PACKAGE_DIR, '0.0.0'),
    'playwright-core': playwrightCoreVersion(PACKAGE_DIR),
  };

  let closed = false;
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

  const isClosed = () => closed;
  const pool = createLanePool({
    options,
    env,
    log,
    isClosed,
    onDisconnected: () => {
      options.onDisconnected?.();
      emit('disconnected');
    },
  });
  const session = createSessions({ pool, env, log, isClosed });
  const flow = createFlowRunner({ pool, versions, env, log, isClosed, getEngine: () => self });
  // A session cannot outlive its browser: an agent's `browser-inspector click` after a recycle must
  // hear "no open session", not "Target closed" from a context that no longer exists.
  pool.setBeforeClose(session.closeAll);

  /**
   * What `browser-inspector status` prints and what the keeper's recycling and `warm|first` rule read. Cheap by
   * contract: `modeFor()` calls it at the start of EVERY job, so nothing here may spawn a process
   * — the RSS is the last `sampleRss()` result.
   */
  function status() {
    return {
      connected: pool.connected,
      channel: pool.channel,
      browser: pool.browser ? pool.browserLabel() : undefined,
      browserRssMb: pool.rssMb,
      rssMb: pool.rssMb,
      pwVersion: versions['playwright-core'],
      pid: pool.pids[0],
      pids: [...pool.pids],
      launches: pool.launches,
      launchMs: pool.launchMs,
      jobs: pool.jobs,
      jobsSinceLaunch: pool.jobsSinceLaunch,
      scrubs: pool.scrubs,
      maxJobs,
      maxRssMb,
      routes: [...session.sessions.values()].reduce((sum, s) => sum + s.ctx.routes.length, 0),
      sessions: [...session.sessions.values()].map((s) => ({
        name: s.name,
        cwd: s.cwd,
        out: s.out,
        dir: s.dir,
        commands: s.commands,
        tabs: s.context.pages?.().length ?? 1,
        openedAt: s.openedAt,
        lastUsedAt: s.lastUsedAt,
      })),
      spare: pool.spare !== null,
      lanes: [...pool.lanes.values()].map((lane) => ({
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

  async function close() {
    closed = true;
    await session.closeAll();
    await pool.closeBrowser();
  }

  // The keeper awaits `ready` before its first job; the launch failure (E_BROWSER_MISSING) surfaces
  // there. The side handler keeps a never-awaited rejection from crashing a test process.
  const ready = options.prelaunch === false ? Promise.resolve() : pool.ensureBrowser().then(() => undefined);
  ready.catch(() => {});

  const self = {
    ready,
    versions,
    warm: () => pool.ensureBrowser().then(() => undefined),
    runFlow: flow.runFlow,
    finishRun: flow.finishRun,
    runBatch: flow.runBatch,
    scrub: pool.scrub,
    scrubIfDirty: pool.scrubIfDirty,
    sampleRss: pool.sampleRss,
    applyScrub: pool.applyScrub,
    laneState: pool.laneState,
    getLane: pool.getLane,
    freshContext: pool.freshContext,
    makeStepContext,
    resolveSelector,
    navigate,
    runStep,
    writeSnapshotFiles,
    // session half (WP6) — the keeper probes these with `?.`
    runCommand: (/** @type {string} */ name, /** @type {Step} */ step, /** @type {CommandContext} */ cmd) =>
      session.runCommand(name, step, cmd),
    runScript: session.runScript,
    exportFlow: session.exportSession,
    session: (/** @type {string} */ name) => session.sessions.get(name),
    closeSession: (/** @type {string} */ name) => session.endSession(name).then(() => undefined),
    openSession: session.openSession,
    recycle: pool.recycle,
    status,
    stats: status,
    close,
    /** @param {string} event @param {(...args: any[]) => void} cb */
    on: (event, cb) => {
      listeners.set(event, [...(listeners.get(event) ?? []), cb]);
    },
    get browser() {
      return pool.browser;
    },
    get lanes() {
      return pool.lanes;
    },
    RUNNERS,
  };
  return self;
}

/** @typedef {ReturnType<typeof createEngine>} Engine */
