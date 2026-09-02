// keeper.mjs — the warm browser's process (DESIGN.md §2.5), and the one request handler that the
// `--no-daemon` / fallback path runs in-process without a socket.
//
// Order of start matters more than anything else here: lock → listen → write pid file → THEN
// import the engine and launch Chrome. A client sees the pipe 45 ms after spawn and queues its job
// behind `browserReady`; a keeper that imported playwright-core first would make every first call
// race a 300 ms launch against the client's 3 s connect deadline. The lock is `O_EXCL` with the
// pid inside: the second keeper of the same identity finds it (or `EADDRINUSE`) and exits 0 —
// there is nothing to report, the first one is doing the work. Stale files (a keeper killed with
// its shell) are cleaned HERE after `kill(pid, 0)`, never by a client: a client that unlinked a
// socket could unlink a live keeper's.
//
// The engine is reached through a small interface (`docs/handoff/WP5.md`) so a fake engine can
// drive every test on a real pipe without a browser: `BROWSER_INSPECTOR_ENGINE_MODULE` names the module.

import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { EngineUnavailableError, done, handleRequest, messageOf, statusOf } from './keeper.requests.mjs';
import { DEFAULT_OUTPUT_DIR, lockFile, logFile, packageVersion, pidFile } from './paths.mjs';
import { formatMs } from './print.mjs';
import { redact } from './redact.mjs';

/** 30 min — an agent↔human loop has long pauses; 5 min turned most "second" calls into cold ones. */
export const IDLE_MS_DEFAULT = 30 * 60 * 1000;
/** An open session keeps the keeper for an hour after its last command. */
export const SESSION_TTL_MS_DEFAULT = 60 * 60 * 1000;
export const MAX_JOBS_DEFAULT = 200;
export const MAX_RSS_MB_DEFAULT = 1024;
/** The browser's RSS is sampled in the background every N jobs (`tasklist` costs 70 ms on Windows). */
export const RSS_CHECK_EVERY = 10;
/** The log is a diagnostic, not an archive: at 1 MB it starts over. */
export const LOG_MAX_BYTES = 1024 * 1024;
/**
 * A lock or pid file younger than this is trusted as is — its keeper may still be between `lock`
 * and `listen`. Older, with a "live" pid that does not answer on the pipe, it is stale: `%TEMP%`
 * survives reboots on Windows and pids are recycled, so `kill(pid, 0)` alone proves nothing.
 */
export const LOCK_YOUNG_MS = 5000;
export const PROBE_TIMEOUT_MS = 200;
export const DEFAULT_ENGINE_MODULE = './engine.mjs';
/** The keeper's own module path — what the client spawns. */
export const KEEPER_PATH = fileURLToPath(import.meta.url);

const PACKAGE_DIR = fileURLToPath(new URL('..', import.meta.url));

/** @typedef {import('./types.js').KeeperRequest} KeeperRequest */
/** @typedef {import('./types.js').KeeperDone} KeeperDone */
/** @typedef {import('./types.js').KeeperProgress} KeeperProgress */
/** @typedef {import('./types.js').TimingMode} TimingMode */

/**
 * The engine interface the keeper drives — `docs/handoff/WP5.md` is the contract, this is the type.
 * The module exports `createEngine(options)` with `{ browser, env, log, onDisconnected }` (the shape
 * `src/engine.mjs` already has); everything optional is probed with `?.` so a partial engine (a
 * fake, or WP2 before WP6 adds the session half) still works.
 * @typedef {object} EngineLike
 * @property {Promise<unknown>} [ready] resolves when the browser is launched (jobs wait for it), or
 * @property {() => Promise<unknown>} [warm] a launch to await once, right after listen
 * @property {(snapshot: Record<string, any>, dir: string, laneOpts: Record<string, any>) => Promise<Report | FlowResult>} runFlow
 * @property {(session: string, step: Record<string, any>, ctx: Record<string, any>) => Promise<JobResult>} [runCommand]
 * @property {(lines: string[], ctx: Record<string, any>) => Promise<JobResult>} [runScript]
 * @property {(session: string, opts: Record<string, any>) => Promise<JobResult>} [exportFlow]
 * @property {(name: string) => unknown} [session] the session's state, `undefined` when not open
 * @property {(name: string) => Promise<void> | void} [closeSession]
 * @property {() => Record<string, any>} [status] `{ launches, launchMs, lanes, routes, browser, rssMb, … }`, or
 * @property {() => Record<string, any>} [stats] the same under the engine's own name
 * @property {Record<string, string>} [versions] `{ 'browser-inspector', 'playwright-core' }`
 * @property {() => Promise<void> | void} [recycle] `browser.close()` + launch, between jobs
 * @property {() => Promise<unknown>} [sampleRss] sample the browser's RSS in the background (cached for `status`)
 * @property {(lane: number) => Promise<unknown>} [scrubIfDirty] the post-response scrub of a batch lane
 * @property {(lane: number) => Promise<unknown>} [scrub] the same, unconditional (older engines)
 * @property {() => Promise<void> | void} close
 */

/**
 * What a `runFlow` may return instead of a full `Report` (a fake engine, or an engine that writes
 * its own artifacts): the keeper then skips `writeArtifacts` and builds the manifest from `timing`.
 * @typedef {object} FlowResult
 * @property {boolean} completed
 * @property {number} [ms]
 * @property {string[]} [files] absolute paths written
 * @property {Record<string, any>} [timing]
 * @property {string} [failure] first failed step / navigation error, one line
 */

/** @typedef {import('./types.js').Report} Report */

/**
 * @typedef {object} JobResult
 * @property {number} exit
 * @property {string[]} lines
 * @property {string[]} [files]
 * @property {Record<string, any>} [timing]
 */

/** @param {NodeJS.ProcessEnv} env @param {string} name @param {number} fallback */
function intEnv(env, name, fallback) {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/** `kill(pid, 0)`: alive, or alive-but-not-ours (EPERM) — only ESRCH means gone. */
export function isAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return /** @type {NodeJS.ErrnoException} */ (error).code === 'EPERM';
  }
}

/** @param {string} file @returns {number | undefined} */
function readPidFrom(file) {
  try {
    const text = fs.readFileSync(file, 'utf8').trim();
    const parsed = text.startsWith('{') ? JSON.parse(text).pid : Number(text);
    return Number.isInteger(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Does a keeper answer on `pipe`? `connect` alone is the proof (the request needs a token, the
 * connection does not); ENOENT / ECONNREFUSED / a silent 200 ms mean nobody is there.
 * @param {string} pipe
 * @param {number} [timeoutMs]
 * @returns {Promise<boolean>}
 */
export function probePipe(pipe, timeoutMs = PROBE_TIMEOUT_MS) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (/** @type {boolean} */ answer) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(answer);
    };
    const socket = net.connect({ path: pipe });
    const timer = setTimeout(() => finish(false), timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}

/** Age of a file in ms; `Infinity` when it cannot be read (gone — nothing to trust). @param {string} file */
function ageOf(file) {
  try {
    return Date.now() - fs.statSync(file).mtimeMs;
  } catch {
    return Infinity;
  }
}

/**
 * Create `<lock>` with the pid inside in ONE step: the content goes to a private temp file and
 * `link()` publishes it — `EEXIST` when the lock is there, and never an empty lock another keeper
 * could read as "no holder" between `open` and `write`. Falls back to `O_EXCL` where hard links
 * are not available.
 * @param {string} lockPath @param {number} pid
 * @returns {boolean} false on EEXIST
 */
function publishLock(lockPath, pid) {
  const tmp = `${lockPath}.${String(pid)}.tmp`;
  try {
    fs.writeFileSync(tmp, String(pid), { mode: 0o600 });
    try {
      fs.linkSync(tmp, lockPath);
      return true;
    } catch (error) {
      const code = /** @type {NodeJS.ErrnoException} */ (error).code;
      if (code === 'EEXIST') return false;
      // No hard links here (an exotic tmpfs): the two-step create is the best this filesystem can do.
      const fd = fs.openSync(lockPath, 'wx', 0o600);
      fs.writeSync(fd, String(pid));
      fs.closeSync(fd);
      return true;
    } finally {
      try {
        fs.unlinkSync(tmp);
      } catch {
        // Already gone.
      }
    }
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code === 'EEXIST') return false;
    throw error;
  }
}

/**
 * Is the holder of `<lock>` / `<pid file>` really a keeper? Dead pid → stale. Live pid: a file
 * younger than `LOCK_YOUNG_MS` is trusted (its keeper may not listen yet); older, the pipe
 * decides — a pid that `kill(pid, 0)` accepts but that does not answer is a recycled pid after a
 * reboot or a keeper killed with its shell. Unparseable content is stale once it is old.
 * @param {string} file
 * @param {number | undefined} holder
 * @param {{ pipe?: string, probe?: (pipe: string) => Promise<boolean> }} options
 * @returns {Promise<boolean>} true when a live keeper holds it
 */
export async function holderAnswers(file, holder, options = {}) {
  const young = ageOf(file) < LOCK_YOUNG_MS;
  if (holder === undefined) return young;
  if (!isAlive(holder)) return false;
  if (young || !options.pipe) return true;
  return (options.probe ?? probePipe)(options.pipe);
}

/**
 * Take `<lock>`. `EEXIST` with a holder that does not answer is stale (a keeper killed with its
 * shell, a reboot with a recycled pid): unlink and try once more. `EEXIST` with a live holder means
 * "not us" → `false`.
 * @param {string} lockPath
 * @param {number} pid
 * @param {{ pipe?: string, probe?: (pipe: string) => Promise<boolean> }} [options] how to ask the holder
 * @returns {Promise<boolean>}
 */
export async function acquireLock(lockPath, pid, options = {}) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (publishLock(lockPath, pid)) return true;
    const holder = readPidFrom(lockPath);
    if (holder === pid) return true;
    if (await holderAnswers(lockPath, holder, options)) return false;
    try {
      fs.unlinkSync(lockPath);
    } catch {
      // Somebody else cleaned it first — the retry decides.
    }
  }
  return false;
}

// ── Queues ───────────────────────────────────────────────────────────────────

/**
 * One promise chain per key (`lane:<n>`, `session:<name>`): jobs on the same key run one after
 * another, different keys run concurrently. `queuedMs` is how long a job waited for its
 * predecessor — the scrub of the previous run lands there for a client that connects < 15 ms
 * after the previous answer (`browser-inspector-warm-tight`).
 */
export function createQueues() {
  /** @type {Map<string, Promise<unknown>>} */
  const tails = new Map();
  /** @type {Map<string, number>} */
  const counts = new Map();
  let active = 0;
  /** @type {(() => void)[]} */
  let idleWaiters = [];

  const notify = () => {
    if (active > 0 || counts.size > 0) return;
    const waiters = idleWaiters;
    idleWaiters = [];
    for (const cb of waiters) cb();
  };

  return {
    /**
     * @template T
     * @param {string} key
     * @param {(info: { queuedMs: number }) => Promise<T>} fn
     * @returns {Promise<T>}
     */
    enqueue(key, fn) {
      const enqueuedAt = performance.now();
      counts.set(key, (counts.get(key) ?? 0) + 1);
      const previous = tails.get(key) ?? Promise.resolve();
      const run = previous
        .catch(() => undefined)
        .then(async () => {
          active += 1;
          try {
            return await fn({ queuedMs: Math.round(performance.now() - enqueuedAt) });
          } finally {
            active -= 1;
            const left = (counts.get(key) ?? 1) - 1;
            if (left <= 0) counts.delete(key);
            else counts.set(key, left);
            if (tails.get(key) === run) tails.delete(key);
            notify();
          }
        });
      tails.set(key, run);
      return run;
    },
    /** @param {string} key */
    size: (key) => counts.get(key) ?? 0,
    pending: () => [...counts.values()].reduce((a, b) => a + b, 0),
    active: () => active,
    isIdle: () => active === 0 && counts.size === 0,
    /** @returns {Promise<void>} */
    onceIdle: () =>
      new Promise((resolve) => {
        if (active === 0 && counts.size === 0) resolve();
        else idleWaiters.push(resolve);
      }),
    keys: () => [...counts.keys()],
  };
}

// ── Engine loading ───────────────────────────────────────────────────────────

/**
 * Resolve `BROWSER_INSPECTOR_ENGINE_MODULE` (a relative path is relative to `src/`, an absolute path is a file, a
 * bare name is a package), call its `createEngine({ browser, env, log, onDisconnected })` and wait
 * for the browser: `ready` when the engine exposes one, else one `warm()` — the launch runs while
 * the first client is already connected and queued, that is the whole point of listen-first.
 * @param {string | undefined} spec
 * @param {Record<string, any>} browserOpts
 * @param {{ log: (line: string) => void, env: NodeJS.ProcessEnv, onDisconnected?: () => void }} hooks
 * @returns {Promise<EngineLike>}
 */
export async function loadEngine(spec, browserOpts, hooks) {
  const name = spec === undefined || spec === '' ? DEFAULT_ENGINE_MODULE : spec;
  let url;
  if (name.startsWith('./') || name.startsWith('../')) url = new URL(name, import.meta.url).href;
  else if (path.isAbsolute(name) || /^[a-zA-Z]:[\\/]/u.test(name)) url = pathToFileURL(name).href;
  else url = name;
  const mod = await import(url);
  if (typeof mod.createEngine !== 'function') throw new Error(`${name} does not export createEngine()`);
  /** @type {EngineLike} */
  const engine = await mod.createEngine({
    browser: browserOpts,
    env: hooks.env,
    log: hooks.log,
    onDisconnected: hooks.onDisconnected,
  });
  if (engine.ready) await engine.ready;
  else if (engine.warm) await engine.warm();
  return engine;
}

// ── Context: everything the handler needs, with or without a socket ──────────

/**
 * @typedef {object} ContextOptions
 * @property {NodeJS.ProcessEnv} [env]
 * @property {Record<string, any>} [browserOpts]
 * @property {string} [engineModule]
 * @property {EngineLike | Promise<EngineLike>} [engine] an already created engine (tests, fallback)
 * @property {TimingMode} [mode] a fixed mode (`fallback` / `no-daemon`); the keeper computes `warm|first`
 * @property {(line: string) => void} [log]
 * @property {Record<string, any>} [info] `{ pid, hash, pipe, binPath, version, key, startedAt }`
 * @property {number} [idleMs]
 * @property {number} [sessionTtlMs]
 * @property {number} [maxJobs]
 * @property {number} [maxRssMb]
 * @property {(reason: string) => void} [onIdle] arms the idle timer when given (keeper only)
 */

/**
 * @param {ContextOptions} options
 */
export function createContext(options = {}) {
  const env = options.env ?? process.env;
  const log = options.log ?? (() => {});
  const queues = createQueues();
  /** @type {Map<string, { name: string, cwd: string, out: string, openedAt: number, lastUsedAt: number }>} */
  const sessions = new Map();
  /** Every secret ever seen by this process — the log is redacted against all of them. */
  const secrets = new Set();
  const idleMs = options.idleMs ?? intEnv(env, 'BROWSER_INSPECTOR_IDLE_MS', IDLE_MS_DEFAULT);
  const sessionTtlMs = options.sessionTtlMs ?? intEnv(env, 'BROWSER_INSPECTOR_SESSION_TTL_MS', SESSION_TTL_MS_DEFAULT);
  const maxJobs = options.maxJobs ?? intEnv(env, 'BROWSER_INSPECTOR_MAX_JOBS', MAX_JOBS_DEFAULT);
  const maxRssMb = options.maxRssMb ?? intEnv(env, 'BROWSER_INSPECTOR_MAX_RSS_MB', MAX_RSS_MB_DEFAULT);

  /** @type {Promise<EngineLike> | undefined} */
  let enginePromise = options.engine ? Promise.resolve(options.engine) : undefined;
  let engineError = '';
  let launchesSeen = -1;
  let jobs = 0;
  let lastJobEndedAt = Date.now();
  /** @type {Promise<void>} */
  let recycling = Promise.resolve();
  /** @type {NodeJS.Timeout | undefined} */
  let idleTimer;
  /** @type {NodeJS.Timeout | undefined} */
  let ttlTimer;
  let stopping = false;

  const engine = () => {
    if (enginePromise === undefined) {
      enginePromise = loadEngine(
        options.engineModule ?? env.BROWSER_INSPECTOR_ENGINE_MODULE,
        options.browserOpts ?? {},
        {
          log,
          env,
          // A browser that died under the keeper (killed, crashed, closed by hand) is not something to
          // hide behind a relaunch: the keeper exits 1 and the next client starts a fresh one (§2.2).
          onDisconnected: () => {
            log('browser disconnected — exiting 1');
            options.onIdle?.('disconnected');
          },
        },
      );
      enginePromise.then(
        () => log('engine ready'),
        (error) => {
          engineError = messageOf(error);
          log(`engine failed: ${engineError}`);
        },
      );
    }
    return enginePromise;
  };

  /** `first` when the engine launched (or relaunched) since the previous job, `warm` otherwise. */
  const modeFor = (/** @type {EngineLike} */ eng) => {
    if (options.mode) return options.mode;
    const launches = Number(statusOf(eng).launches ?? 1);
    const first = launches !== launchesSeen;
    launchesSeen = launches;
    return first ? 'first' : 'warm';
  };

  const armIdle = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = undefined;
    if (!options.onIdle || stopping) return;
    if (!queues.isIdle() || sessions.size > 0) return;
    idleTimer = setTimeout(() => options.onIdle?.('idle'), idleMs);
  };

  const sweepSessions = async () => {
    const now = Date.now();
    let expired = 0;
    for (const [name, s] of [...sessions]) {
      if (now - s.lastUsedAt < sessionTtlMs) continue;
      sessions.delete(name);
      expired += 1;
      log(`session ${name} expired after ${formatMs(sessionTtlMs)} ms`);
      try {
        await (await engine()).closeSession?.(name);
      } catch (error) {
        log(`closeSession ${name}: ${messageOf(error)}`);
      }
    }
    // ONLY when this sweep changed something. `armIdle` restarts the countdown from zero, and the
    // sweep runs every `min(sessionTtlMs / 2, 30 s)` — with the defaults that is every 30 s against
    // an idle budget of 30 min, so an unconditional call here pushed the deadline forever and the
    // keeper never exited (probe: with sweep 100 ms against idle 500 ms, `onIdle` never fires; with
    // sweep 30 s it fires at 513 ms). A sweep that expired nothing is not activity.
    if (expired > 0) armIdle();
  };

  if (options.onIdle) {
    ttlTimer = setInterval(() => void sweepSessions(), Math.max(50, Math.min(sessionTtlMs / 2, 30_000)));
    armIdle();
  }

  /** A recycle that was due but had to wait (a session open, a lane busy) is kept until it can run. */
  let recycleDue = false;
  let lastRssSampleJob = 0;

  /** Any lane the engine reports as busy — a recycle now would close the browser under it. */
  const laneBusy = (/** @type {EngineLike} */ eng) => {
    const lanes = statusOf(eng).lanes;
    return Array.isArray(lanes) && lanes.some((l) => l && typeof l === 'object' && l.busy === true);
  };

  /**
   * Recycle ONLY between jobs, with nothing in the queues, no session open and no lane busy: a
   * `browser.close()` under an agent's session would turn every following `browser-inspector click` into
   * "Target closed" while `browser-inspector status` still listed the session. When it cannot run now it stays
   * due and is re-checked after the next job.
   */
  const maybeRecycle = (/** @type {EngineLike} */ eng) => {
    if (!eng.recycle) return;
    const status = statusOf(eng);
    const rss = Number(status.browserRssMb ?? status.rssMb ?? 0);
    if ((maxJobs > 0 && jobs > 0 && jobs % maxJobs === 0) || (maxRssMb > 0 && rss > maxRssMb)) recycleDue = true;
    if (!recycleDue || !queues.isIdle()) return;
    if (sessions.size > 0 || laneBusy(eng)) {
      log(`recycle deferred: ${String(sessions.size)} sessions open`);
      return;
    }
    recycleDue = false;
    log(`recycle after ${String(jobs)} jobs, rss ${String(rss)} MB`);
    recycling = Promise.resolve(eng.recycle()).catch((error) => log(`recycle failed: ${messageOf(error)}`));
  };

  /**
   * The RSS sample is off the job path by design (§2.2: `tasklist` is 70 ms — three of them per
   * call would be the whole 5× margin): every `RSS_CHECK_EVERY` jobs, after the answer, cached in
   * the engine for the next `maybeRecycle` and for `browser-inspector status`.
   */
  const maybeSampleRss = (/** @type {EngineLike} */ eng) => {
    if (!eng.sampleRss || jobs - lastRssSampleJob < RSS_CHECK_EVERY) return;
    lastRssSampleJob = jobs;
    Promise.resolve(eng.sampleRss()).catch((error) => log(`rss sample: ${messageOf(error)}`));
  };

  /** What every job does once its queue slot is released: sample, recycle, re-arm idle. */
  const afterJob = (/** @type {EngineLike | undefined} */ eng) => {
    if (eng) {
      maybeSampleRss(eng);
      maybeRecycle(eng);
    }
    armIdle();
  };

  return {
    env,
    log,
    queues,
    sessions,
    info: options.info ?? {},
    /** A keeper outlives the request; the in-process path (`fallback` / `no-daemon`) does not. */
    persistent: options.mode === undefined,
    engine,
    engineError: () => engineError,
    stats: () => ({ jobs, lastJobEndedAt, idleMs, sessionTtlMs, maxJobs, maxRssMb, recycleDue }),
    noteSecrets: (/** @type {string[]} */ values) => {
      for (const v of values) if (typeof v === 'string' && v !== '') secrets.add(v);
    },
    redactAll: (/** @type {string} */ text) => redact(text, [...secrets]),
    /**
     * Run `fn` on the queue `key` once the engine is ready; counts the job, arms idle, recycles.
     * Rejects with `EngineUnavailableError` when there is no engine — the caller turns that into
     * its own `FAIL` line (a batch: `E_BROWSER_MISSING` with the attempts list).
     * @template T
     * @param {string} key
     * @param {(info: { queuedMs: number, engine: EngineLike, mode: TimingMode }) => Promise<T>} fn
     * @returns {Promise<T>}
     */
    runJob(key, fn) {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = undefined;
      /** @type {EngineLike | undefined} */
      let used;
      const job = queues.enqueue(key, async ({ queuedMs }) => {
        /** @type {EngineLike} */
        let eng;
        try {
          await recycling;
          eng = await engine();
        } catch (error) {
          throw new EngineUnavailableError(error);
        }
        used = eng;
        const mode = modeFor(eng);
        try {
          return await fn({ queuedMs, engine: eng, mode });
        } finally {
          jobs += 1;
          lastJobEndedAt = Date.now();
        }
      });
      // After the queue has released the slot (its own `finally` runs before this settles) — only
      // then can `isIdle()` be true, and only then may the idle timer or a recycle start.
      const after = () => afterJob(used);
      job.then(after, after);
      return job;
    },
    /**
     * Work that belongs to a job but not to its answer — the lane scrub after a batch snapshot.
     * Queued on the same key from INSIDE the job, so the next client on that key waits for it
     * (and reports the wait as `queuedMs`, §6) while this client already has its done line.
     * @param {string} key
     * @param {EngineLike} eng
     * @param {() => Promise<unknown>} fn
     */
    afterAnswer(key, eng, fn) {
      const work = queues.enqueue(key, () => fn().catch((error) => log(`${key}: ${messageOf(error)}`)));
      // The queue is idle only once this settles: the idle timer and a due recycle wait for it.
      const after = () => afterJob(eng);
      work.then(after, after);
    },
    /** @param {string} name @param {{ cwd: string, out?: string }} where */
    touchSession(name, where) {
      const existing = sessions.get(name);
      const out = where.out ?? existing?.out ?? path.resolve(where.cwd, DEFAULT_OUTPUT_DIR);
      const now = Date.now();
      const entry = { name, cwd: where.cwd, out, openedAt: existing?.openedAt ?? now, lastUsedAt: now };
      sessions.set(name, entry);
      return entry;
    },
    /** @param {string} name */
    dropSession(name) {
      sessions.delete(name);
      armIdle();
    },
    armIdle,
    async close() {
      stopping = true;
      if (idleTimer) clearTimeout(idleTimer);
      if (ttlTimer) clearInterval(ttlTimer);
      if (enginePromise === undefined) return;
      try {
        await (await enginePromise).close();
      } catch {
        // A browser that is already gone is the goal of close().
      }
    },
  };
}

/** @typedef {ReturnType<typeof createContext>} KeeperContext */

// ── The daemon ───────────────────────────────────────────────────────────────

/**
 * @typedef {object} KeeperOptions
 * @property {string} hash identity hash (the client computed it; the keeper trusts it)
 * @property {string} pipe pipe / socket path to listen on
 * @property {string} [key] file key for pid/lock/log (`hash`, or `hash-<fnv(BROWSER_INSPECTOR_SOCKET)>`)
 * @property {Record<string, any>} [browserOpts]
 * @property {NodeJS.ProcessEnv} [env]
 * @property {string} [tmpdir]
 * @property {string} [engineModule]
 * @property {string} [binPath]
 * @property {string} [version]
 * @property {string} [pwVersion]
 * @property {(code: number) => void} [exit] defaults to `process.exit`
 */

/**
 * Start the keeper: lock, listen, pid file, engine — in that order. Resolves with `{ pipe, pid,
 * stop }` once listening, or exits 0 when another keeper of the same identity is already there.
 * @param {KeeperOptions} options
 */
export async function startKeeper(options) {
  const env = options.env ?? process.env;
  const exit = options.exit ?? ((/** @type {number} */ code) => process.exit(code));
  const tmpdir = options.tmpdir ?? env.BROWSER_INSPECTOR_TMPDIR ?? os.tmpdir();
  const key = options.key ?? options.hash;
  const pidPath = pidFile(key, tmpdir);
  const lockPath = lockFile(key, tmpdir);
  const logPath = logFile(key, tmpdir);
  const startedAt = Date.now();
  /** @type {string[]} */
  const secretsForLog = [];

  const log = (/** @type {string} */ line) => {
    try {
      const stat = fs.existsSync(logPath) ? fs.statSync(logPath).size : 0;
      if (stat > LOG_MAX_BYTES) fs.writeFileSync(logPath, '');
      fs.appendFileSync(
        logPath,
        `${new Date().toISOString()} [${String(process.pid)}] ${redact(line, secretsForLog)}\n`,
      );
    } catch {
      // A log that cannot be written must not take the keeper down.
    }
  };

  if (!(await acquireLock(lockPath, process.pid, { pipe: options.pipe }))) {
    log('another keeper holds the lock — exiting 0');
    exit(0);
    return undefined;
  }
  // We own the identity now: whatever pid file / socket is left belongs to a dead keeper — unless
  // its pid is alive AND answers on the pipe (a keeper that lost its lock file but still works).
  const previous = readPidFrom(pidPath);
  if (
    previous !== undefined &&
    previous !== process.pid &&
    (await holderAnswers(pidPath, previous, { pipe: options.pipe }))
  ) {
    log(`pid file names live pid ${String(previous)} without the lock — exiting 0`);
    releaseFiles();
    exit(0);
    return undefined;
  }
  cleanupStale();

  const token = randomBytes(32).toString('hex');
  const server = net.createServer({ allowHalfOpen: false });
  let stopping = false;

  /** @type {KeeperContext} */
  const ctx = createContext({
    env,
    browserOpts: options.browserOpts ?? {},
    engineModule: options.engineModule ?? env.BROWSER_INSPECTOR_ENGINE_MODULE,
    log,
    info: {
      pid: process.pid,
      hash: options.hash,
      key,
      pipe: options.pipe,
      binPath: options.binPath ?? path.join(PACKAGE_DIR, 'bin', 'browser-inspector.mjs'),
      version: options.version ?? packageVersion(PACKAGE_DIR, '0.0.0'),
      pwVersion: options.pwVersion,
      startedAt,
    },
    onIdle: (reason) => void shutdown(reason, reason === 'disconnected' ? 1 : 0),
  });
  const noteSecrets = ctx.noteSecrets;
  ctx.noteSecrets = (values) => {
    for (const v of values) if (typeof v === 'string' && v !== '' && !secretsForLog.includes(v)) secretsForLog.push(v);
    noteSecrets(values);
  };

  function releaseFiles() {
    for (const file of [pidPath, lockPath]) {
      try {
        if (readPidFrom(file) === process.pid) fs.unlinkSync(file);
      } catch {
        // Already gone.
      }
    }
  }

  function cleanupStale() {
    try {
      if (fs.existsSync(pidPath)) fs.unlinkSync(pidPath);
    } catch {
      // Nothing to do.
    }
    if (process.platform !== 'win32' && fs.existsSync(options.pipe)) {
      try {
        fs.unlinkSync(options.pipe);
        log('removed stale socket');
      } catch {
        // Listen will say EADDRINUSE if it really is in use.
      }
    }
  }

  /** @param {string} reason @param {number} code */
  async function shutdown(reason, code) {
    if (stopping) return;
    stopping = true;
    log(`shutdown: ${reason}`);
    server.close();
    try {
      await Promise.race([ctx.close(), new Promise((resolve) => setTimeout(resolve, 5000))]);
    } catch {
      // The browser is closing anyway.
    }
    releaseFiles();
    if (process.platform !== 'win32') {
      try {
        fs.unlinkSync(options.pipe);
      } catch {
        // Gone with the server.
      }
    }
    exit(code);
  }

  server.on('connection', (socket) => {
    socket.setNoDelay?.(true);
    socket.on('error', () => {});
    const rl = createInterface({ input: socket, crlfDelay: Infinity });
    let handled = false;
    rl.on('line', (line) => {
      if (handled) return;
      handled = true;
      void serve(socket, line);
    });
  });

  /** @param {net.Socket} socket @param {string} line */
  async function serve(socket, line) {
    const write = (/** @type {unknown} */ obj) => {
      if (!socket.destroyed) socket.write(`${JSON.stringify(obj)}\n`);
    };
    /** @type {any} */
    let request;
    try {
      request = JSON.parse(line);
    } catch {
      write(done(2, ['FAIL keeper: malformed request line']));
      socket.end();
      return;
    }
    if (typeof request?.token !== 'string' || request.token !== token) {
      log('rejected a request with a bad token');
      write(done(2, ['FAIL keeper: bad token (stale pid file? browser-inspector doctor)']));
      socket.end();
      return;
    }
    // Whatever a handler throws, the client gets a done line and the socket closes: a request
    // without an answer is an agent's shell blocked until someone kills it.
    try {
      const result = await handleRequest(request, {
        ...ctx,
        onProgress: (progress) => write({ progress }),
        stop: () => void shutdown('browser-inspector stop', 0),
        releaseFiles,
      });
      write(result);
    } catch (error) {
      log(`handler failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
      write(done(2, [ctx.redactAll(`FAIL keeper: ${messageOf(error)}`)]));
    } finally {
      socket.end();
    }
  }

  await new Promise((resolve, reject) => {
    server.once('error', (error) => {
      const code = /** @type {NodeJS.ErrnoException} */ (error).code;
      log(`listen failed: ${code ?? messageOf(error)}`);
      releaseFiles();
      if (code === 'EADDRINUSE') {
        exit(0);
        resolve(undefined);
        return;
      }
      reject(error);
    });
    server.listen(options.pipe, () => resolve(undefined));
  });
  if (!server.listening) return undefined;
  if (process.platform !== 'win32') {
    try {
      fs.chmodSync(options.pipe, 0o600);
    } catch {
      // Some filesystems refuse chmod on sockets; the directory ACL protects it then.
    }
  }
  const listeningAt = Date.now();
  // spawn→listen, the number `browser-inspector doctor` and the `first` manifest report (`timing.keeperStartMs`).
  ctx.info.keeperStartMs = Math.max(0, listeningAt - Math.round(performance.timeOrigin));
  fs.writeFileSync(
    pidPath,
    JSON.stringify({
      pid: process.pid,
      pipe: options.pipe,
      token,
      version: ctx.info.version,
      hash: options.hash,
      key,
      startedAt,
      listeningAt,
      processStartAt: Math.round(performance.timeOrigin),
      binPath: ctx.info.binPath,
    }),
    { mode: 0o600 },
  );
  log(`listening on ${options.pipe} (${formatMs(listeningAt - Math.round(performance.timeOrigin))} ms after start)`);

  for (const signal of /** @type {NodeJS.Signals[]} */ (['SIGINT', 'SIGTERM'])) {
    process.on(signal, () => void shutdown(signal, 0));
  }
  process.on('uncaughtException', (error) => {
    log(`uncaught: ${error.stack ?? messageOf(error)}`);
  });
  process.on('unhandledRejection', (reason) => {
    log(`unhandled rejection: ${messageOf(reason)}`);
  });

  // Listen first, THEN the engine: the import of playwright-core and the launch run while the
  // first client is already connected and queued.
  void ctx.engine().catch(() => undefined);

  return { pipe: options.pipe, pid: process.pid, token, stop: () => shutdown('stop()', 0) };
}

/**
 * Spawn a detached keeper — used by the client and by `browser-inspector doctor`. Never unlinks anything.
 * @param {{ hash: string, pipe: string, key?: string, browserOpts?: Record<string, any>, env?: NodeJS.ProcessEnv, engineModule?: string, binPath?: string, pwVersion?: string }} options
 * @returns {number | undefined} the child pid
 */
export function spawnKeeper(options) {
  const args = [KEEPER_PATH, '--hash', options.hash, '--pipe', options.pipe, '--key', options.key ?? options.hash];
  if (options.browserOpts) args.push('--browser', JSON.stringify(options.browserOpts));
  if (options.engineModule) args.push('--engine', options.engineModule);
  if (options.binPath) args.push('--bin', options.binPath);
  if (options.pwVersion) args.push('--pw', options.pwVersion);
  const child = spawn(process.execPath, args, {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    env: options.env ?? process.env,
  });
  child.on('error', () => {});
  child.unref();
  return child.pid;
}

/** @param {string[]} argv */
function parseKeeperArgv(argv) {
  /** @type {Record<string, string>} */
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      out[arg.slice(2)] = argv[i + 1] ?? '';
      i += 1;
    }
  }
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === KEEPER_PATH) {
  // The name a process list shows for the detached keeper — the agent never sees this process otherwise.
  process.title = 'browser-inspector-keeper';
  const args = parseKeeperArgv(process.argv.slice(2));
  if (!args.hash || !args.pipe) {
    process.stderr.write(
      'usage: node keeper.mjs --hash <hash> --pipe <pipe> [--key k] [--browser json] [--engine module]\n',
    );
    process.exit(2);
  }
  /** @type {Record<string, any>} */
  let browserOpts = {};
  try {
    browserOpts = args.browser ? JSON.parse(args.browser) : {};
  } catch {
    browserOpts = {};
  }
  startKeeper({
    hash: args.hash,
    pipe: args.pipe,
    key: args.key || args.hash,
    browserOpts,
    engineModule: args.engine || undefined,
    binPath: args.bin || undefined,
    pwVersion: args.pw || undefined,
  }).catch((error) => {
    process.stderr.write(`keeper failed: ${messageOf(error)}\n`);
    process.exit(1);
  });
}
