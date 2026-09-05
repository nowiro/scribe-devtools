// client.mjs — the process the agent actually runs (DESIGN.md §2.4): parse, resolve, connect, print.
//
// Budget 72 ms, so the imports are `node:*` plus the pure modules only — never playwright-core,
// never engine.mjs, never steps.run.mjs (the `client-imports` test guards it where the suite is
// checked out; without it, review the import lists by hand). Three things
// happen HERE and nowhere else, for reasons that are about trust, not speed:
//
//   1. `valueFromEnv` / `--env NAME` / `@{NAME}` are resolved from THIS process's environment. The
//      protocol carries no `env`: a keeper started by another shell has another environment and a
//      malicious page has no way to make the keeper read one. A missing variable is named and
//      fails with exit 2 before anything is sent.
//   2. Files (`upload`, `eval --file`, `route --file`, `state load`, `script`) are read relative to
//      THIS cwd. The keeper may sit in another cwd with other rights.
//   3. The fallback: a batch runs in-process when no keeper answers within 3 s (`timing.mode =
//      "fallback"`). A session command never falls back — an in-process `browser-inspector open` would close the
//      browser on exit and `browser-inspector click e5` would lie about a ref it never had (exit 2 instead).

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

import { CliError, parseArgs, parseSessionCommand, usage } from './cli.mjs';
import { ConfigError, lintConfig, loadConfig } from './config.mjs';
import {
  collectIdentity,
  daemonEnabled,
  fnv1a,
  identityHash,
  packageVersion as versionOf,
  pidFile,
  pipeName,
} from './paths.mjs';
import { KEEPER_UNAVAILABLE, formatDoctor, formatMs } from './print.mjs';

/** @typedef {import('./types.js').KeeperRequest} KeeperRequest */
/** @typedef {import('./types.js').KeeperDone} KeeperDone */
/** @typedef {import('./types.js').KeeperFile} KeeperFile */
/** @typedef {import('./types.js').TimingMode} TimingMode */
/** @typedef {import('./cli.mjs').ParsedArgs} ParsedArgs */

const PACKAGE_DIR = fileURLToPath(new URL('..', import.meta.url));
const BIN_PATH = path.join(PACKAGE_DIR, 'bin', 'browser-inspector.mjs');
const KEEPER_MODULE = fileURLToPath(new URL('./keeper.mjs', import.meta.url));

/** Inline file content up to this size; above it the keeper gets an absolute path. */
export const INLINE_FILE_MAX = 1024 * 1024;
export const CONNECT_TIMEOUT_MS = 3000;
export const CONNECT_RETRY_MS = 25;
/**
 * A request with no line from the keeper for this long is abandoned (`BROWSER_INSPECTOR_REQUEST_TIMEOUT_MS`).
 * Generous — a 6-flow app-factory batch with `networkidle` waits is a minute, not ten — because
 * its only job is to make a wedged keeper impossible to hang an agent's shell on: progress lines
 * reset it, so a long batch that is still reporting snapshots is never cut.
 */
export const REQUEST_TIMEOUT_MS = 10 * 60 * 1000;
/**
 * `status` / `stop` are answered from the keeper's event loop without touching the browser, so they
 * get a ping's deadline: the one keeper an agent cannot diagnose is the one whose diagnosis hangs.
 */
export const CONTROL_TIMEOUT_MS = 500;
/** `doctor`'s `open`/`close` drive a real browser (warm ≈ 470 ms, a cold lane seconds) — not a ping. */
export const DOCTOR_JOB_TIMEOUT_MS = 30 * 1000;

/** @param {unknown} error */
const messageOf = (error) => (error instanceof Error ? error.message : String(error));

/** Thrown when no keeper answers: batch falls back, a session prints KEEPER_UNAVAILABLE and exits 2. */
export class KeeperUnavailableError extends Error {
  /**
   * @param {string} reason
   * @param {'connect' | 'request'} [stage] `connect`: nothing was there. `request`: it connected and
   *   then went silent — the process is alive, so "not running" would be a lie and the wrong remedy.
   */
  constructor(reason, stage = 'connect') {
    super(`keeper unavailable: ${reason}`);
    this.name = 'KeeperUnavailableError';
    this.reason = reason;
    this.stage = stage;
  }
}

/** @returns {string} */
export function packageVersion() {
  return versionOf(PACKAGE_DIR, '0.0.0');
}

// ── Identity ─────────────────────────────────────────────────────────────────

/**
 * @typedef {object} Identity
 * @property {string} hash
 * @property {string} pipe
 * @property {string} key pid/lock/log file key — the hash, plus a suffix when `BROWSER_INSPECTOR_SOCKET` overrides the pipe
 * @property {string} tmpdir
 * @property {Record<string, any>} browserOpts what the keeper launches with
 * @property {string} pwVersion
 * @property {string} binPath
 * @property {string} version
 */

/**
 * Hash + pipe + file key for this client. With `BROWSER_INSPECTOR_SOCKET` two agents share the hash but not the
 * keeper, so the pid/lock files get a suffix of the socket name — otherwise the second keeper
 * would find the first one's lock and exit 0 while its client waits on an empty pipe.
 * @param {{ env: NodeJS.ProcessEnv, browser?: Record<string, any>, packageDir?: string }} input
 * @returns {Identity}
 */
export function computeIdentity(input) {
  const env = input.env;
  const parts = collectIdentity({ packageDir: input.packageDir ?? PACKAGE_DIR, env, browser: input.browser ?? {} });
  const hash = identityHash(parts);
  const pipe = pipeName(hash, { env });
  const key = env.BROWSER_INSPECTOR_SOCKET ? `${hash}-${fnv1a(env.BROWSER_INSPECTOR_SOCKET)}` : hash;
  return {
    hash,
    pipe,
    key,
    tmpdir:
      env.BROWSER_INSPECTOR_TMPDIR && env.BROWSER_INSPECTOR_TMPDIR !== '' ? env.BROWSER_INSPECTOR_TMPDIR : os.tmpdir(),
    // Everything the engine reads out of `browser` has to be here: this object IS the browser
    // config on both paths (`--browser` argv for the keeper, `identity.browserOpts` in-process),
    // and a field left out is a config that silently did nothing.
    browserOpts: {
      ...(parts.channel ? { channel: parts.channel } : {}),
      ...(parts.executablePath ? { executablePath: parts.executablePath } : {}),
      headless: parts.headless !== false,
      args: [...(parts.args ?? [])],
      ...(parts.fastHeadless === false ? { fastHeadless: false } : {}),
      ...(parts.motion === 'reduce' ? { motion: 'reduce' } : {}),
    },
    pwVersion: parts.pwVersion,
    binPath: parts.binRealpath,
    version: parts.pkgVersion,
  };
}

// ── Values and files ─────────────────────────────────────────────────────────

/**
 * Split one line of a `browser-inspector script` file into argv the way a POSIX shell would for the simple
 * cases: whitespace separates, `"…"` and `'…'` group, `\"` escapes inside double quotes.
 * The engine (`runScript`) must split with THIS function so the value addresses match.
 * @param {string} line
 * @returns {string[]}
 */
export function splitCommandLine(line) {
  /** @type {string[]} */
  const out = [];
  let current = '';
  let quote = '';
  let has = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quote) {
      if (ch === quote) {
        quote = '';
      } else if (ch === '\\' && quote === '"' && i + 1 < line.length && (line[i + 1] === '"' || line[i + 1] === '\\')) {
        current += line[i + 1];
        i += 1;
      } else current += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      has = true;
      continue;
    }
    if (/\s/u.test(ch)) {
      if (has || current !== '') out.push(current);
      current = '';
      has = false;
      continue;
    }
    current += ch;
    has = true;
  }
  if (has || current !== '') out.push(current);
  return out;
}

/** A script line that is not a command. */
export const isScriptComment = (/** @type {string} */ line) => line.trim() === '' || line.trim().startsWith('#');

/**
 * Read one file for the protocol: inline base64 up to INLINE_FILE_MAX, an absolute path above.
 * `bases` are tried in order (cwd first — the old runner resolved uploads against the cwd — then
 * the config's directory).
 * @param {string} file as written in the step
 * @param {string[]} bases
 * @param {string} where for the error message
 * @returns {KeeperFile}
 */
export function readFileEntry(file, bases, where) {
  for (const base of bases) {
    const abs = path.resolve(base, file);
    let stat;
    try {
      stat = fs.statSync(abs);
    } catch {
      continue;
    }
    if (!stat.isFile()) continue;
    if (stat.size > INLINE_FILE_MAX) return { path: abs, size: stat.size };
    return { base64: fs.readFileSync(abs).toString('base64'), size: stat.size };
  }
  throw new CliError(
    `${where}: cannot read ${file} (looked in ${bases.map((b) => b.replaceAll('\\', '/')).join(', ')})`,
  );
}

/**
 * Resolve every `valueFromEnv` to a value under the step's ADDRESS (`snapshots[3].steps[4].value`,
 * `argv.fill.value`, `script[2].fields[1].value`), collect the secrets, read the files. Pure
 * apart from `env` and the disk; throws `CliError` (exit 2) with the address of what is missing.
 * @param {ParsedArgs} parsed
 * @param {{ env: NodeJS.ProcessEnv, cwd: string, config?: Record<string, any> }} input
 * @returns {{ values: Record<string, string>, secretValues: string[], files: Record<string, KeeperFile> }}
 */
export function resolveValues(parsed, input) {
  const { env, cwd, config } = input;
  /** @type {Record<string, string>} */
  const values = {};
  /** @type {Set<string>} */
  const secrets = new Set();
  /** @type {Record<string, KeeperFile>} */
  const files = {};

  const need = (/** @type {string} */ name, /** @type {string} */ where) => {
    const value = env[name];
    if (value === undefined) throw new CliError(`${where}: environment variable ${name} is not set`);
    secrets.add(value);
    return value;
  };
  const addFile = (/** @type {string} */ file, /** @type {string[]} */ bases, /** @type {string} */ where) => {
    if (!Object.hasOwn(files, file)) files[file] = readFileEntry(file, bases, where);
  };
  const walkStep = (
    /** @type {Record<string, any>} */ step,
    /** @type {string} */ address,
    /** @type {string[]} */ bases,
  ) => {
    if (!step || typeof step !== 'object') return;
    if (typeof step.valueFromEnv === 'string')
      values[`${address}.value`] = need(step.valueFromEnv, `${address}.valueFromEnv`);
    if (Array.isArray(step.fields)) {
      step.fields.forEach((/** @type {any} */ field, /** @type {number} */ k) => {
        if (field && typeof field.valueFromEnv === 'string') {
          const at = `${address}.fields[${String(k)}]`;
          values[`${at}.value`] = need(field.valueFromEnv, `${at}.valueFromEnv`);
        }
      });
    }
    if (step.do === 'upload' && Array.isArray(step.files)) {
      step.files.forEach((/** @type {string} */ f, /** @type {number} */ m) =>
        addFile(f, bases, `${address}.files[${String(m)}]`),
      );
    }
    const wantsFile =
      ((step.do === 'evaluate' || step.do === 'route' || step.do === 'run') && typeof step.file === 'string') ||
      (step.do === 'state' && step.op === 'load' && typeof step.file === 'string');
    if (wantsFile) addFile(step.file, bases, `${address}.file`);
  };

  if (parsed.mode === 'batch' && config) {
    const configDir = path.dirname(config.configPath ?? path.resolve(cwd, parsed.configPath));
    const bases = cwd === configDir ? [cwd] : [cwd, configDir];
    // `--only` narrows what has to EXIST: a run of one flow must not demand the variables and the
    // fixture files of the flows it will not run (`runBatch` filters by the same `snapshot.name`).
    // Skipped, never renumbered — the keeper addresses values with the config's own index.
    const only = parsed.options.only;
    config.snapshots.forEach((/** @type {Record<string, any>} */ snapshot, /** @type {number} */ i) => {
      if (only.length > 0 && !only.includes(snapshot.name)) return;
      (snapshot.steps ?? []).forEach((/** @type {any} */ step, /** @type {number} */ j) =>
        walkStep(step, `snapshots[${String(i)}].steps[${String(j)}]`, bases),
      );
      (snapshot.routes ?? []).forEach((/** @type {any} */ route, /** @type {number} */ r) => {
        if (route && typeof route.file === 'string')
          addFile(route.file, bases, `snapshots[${String(i)}].routes[${String(r)}].file`);
      });
    });
    const auth = config.auth;
    if (auth?.login?.steps) {
      auth.login.steps.forEach((/** @type {any} */ step, /** @type {number} */ j) =>
        walkStep(step, `auth.login.steps[${String(j)}]`, bases),
      );
    }
    if (auth?.oauth && typeof auth.oauth === 'object') {
      for (const [key, name] of Object.entries(auth.oauth)) {
        if (key.endsWith('FromEnv') && typeof name === 'string') {
          values[`auth.oauth.${key.slice(0, -'FromEnv'.length)}`] = need(name, `auth.oauth.${key}`);
        }
      }
    }
  } else if (parsed.mode === 'session') {
    walkStep(parsed.step, `argv.${parsed.command}`, [cwd]);
  } else if (parsed.mode === 'script') {
    addFile(parsed.file, [cwd], 'script');
    const entry = files[parsed.file];
    const text =
      entry.base64 !== undefined
        ? Buffer.from(entry.base64, 'base64').toString('utf8')
        : fs.readFileSync(/** @type {string} */ (entry.path), 'utf8');
    text.split(/\r?\n/u).forEach((line, i) => {
      if (isScriptComment(line)) return;
      const argv = splitCommandLine(line);
      try {
        const { step } = parseSessionCommand(argv[0], argv.slice(1));
        walkStep(step, `script[${String(i)}]`, [cwd]);
      } catch (error) {
        throw new CliError(`${parsed.file}:${String(i + 1)}: ${messageOf(error)}`);
      }
    });
  }
  return { values, secretValues: [...secrets], files };
}

// ── Transport ────────────────────────────────────────────────────────────────

/**
 * @param {string} file
 * @returns {{ pid: number, pipe: string, token: string, listeningAt?: number, processStartAt?: number, startedAt?: number, binPath?: string, version?: string } | undefined}
 */
export function readPidFile(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (typeof parsed?.token === 'string' && Number.isInteger(parsed.pid)) return parsed;
  } catch {
    // Absent or half-written — the caller retries.
  }
  return undefined;
}

/**
 * @param {string} pipe
 * @returns {Promise<net.Socket>}
 */
export function connectOnce(pipe) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ path: pipe });
    socket.setNoDelay?.(true);
    socket.once('connect', () => resolve(socket));
    socket.once('error', (error) => reject(error));
  });
}

/**
 * Spawn a detached keeper (DESIGN.md §2.5): never unlinks anything, never waits for it. The keeper
 * takes the lock and listens; this process just retries the connect.
 * @param {Identity} identity
 * @param {NodeJS.ProcessEnv} env
 * @returns {number | undefined}
 */
export function spawnKeeper(identity, env) {
  const args = [
    KEEPER_MODULE,
    '--hash',
    identity.hash,
    '--pipe',
    identity.pipe,
    '--key',
    identity.key,
    '--browser',
    JSON.stringify(identity.browserOpts),
    '--bin',
    identity.binPath,
    '--pw',
    identity.pwVersion,
  ];
  const child = spawn(process.execPath, args, { detached: true, stdio: 'ignore', windowsHide: true, env });
  child.on('error', () => {});
  child.unref();
  return child.pid;
}

const sleep = (/** @type {number} */ ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * connect → (ENOENT | ECONNREFUSED) → spawn once → retry every 25 ms up to the deadline.
 * @param {Identity} identity
 * @param {{ env: NodeJS.ProcessEnv, spawn?: boolean, timeoutMs?: number }} options
 * @returns {Promise<{ socket: net.Socket, token: string, spawned: boolean, pid: number }>}
 */
export async function ensureKeeper(identity, options) {
  const env = options.env;
  const allowSpawn = options.spawn !== false;
  const timeoutMs = options.timeoutMs ?? Number(env.BROWSER_INSPECTOR_CONNECT_TIMEOUT_MS ?? CONNECT_TIMEOUT_MS);
  const pidPath = pidFile(identity.key, identity.tmpdir);
  const deadline = performance.now() + timeoutMs;
  let spawned = false;
  let lastError = 'no pid file';
  for (;;) {
    const info = readPidFile(pidPath);
    if (info) {
      try {
        const socket = await connectOnce(identity.pipe);
        return { socket, token: info.token, spawned, pid: info.pid };
      } catch (error) {
        lastError = /** @type {NodeJS.ErrnoException} */ (error).code ?? messageOf(error);
      }
    }
    // The pipe is not repeated in the reason: `browser-inspector status` prints it, and a full pipe
    // name would push the FAIL line past 160 characters.
    if (!allowSpawn)
      throw new KeeperUnavailableError(info ? `${lastError} on the pipe (stale pid file?)` : 'not running');
    if (!spawned) {
      spawnKeeper(identity, env);
      spawned = true;
    }
    if (performance.now() >= deadline) {
      throw new KeeperUnavailableError(`no keeper after ${formatMs(timeoutMs)} ms (${lastError})`);
    }
    await sleep(CONNECT_RETRY_MS);
  }
}

/**
 * One request, N progress lines, one done line — or `KeeperUnavailableError` when the keeper goes
 * silent for `timeoutMs` (a batch then runs in-process; a session command exits 2 with the reason).
 * @param {net.Socket} socket
 * @param {KeeperRequest} request
 * @param {(progress: import('./types.js').KeeperProgress['progress']) => void} [onProgress]
 * @param {{ timeoutMs?: number }} [options]
 * @returns {Promise<KeeperDone>}
 */
export function exchange(socket, request, onProgress, options = {}) {
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
  return new Promise((resolve, reject) => {
    let settled = false;
    /** @type {NodeJS.Timeout | undefined} */
    let watchdog;
    /** @param {KeeperDone | undefined} result @param {string} [reason] */
    const finish = (result, reason = '') => {
      if (settled) return;
      settled = true;
      if (watchdog) clearTimeout(watchdog);
      socket.destroy();
      if (result) resolve(result);
      else reject(new KeeperUnavailableError(reason, 'request'));
    };
    const arm = () => {
      if (watchdog) clearTimeout(watchdog);
      if (timeoutMs <= 0) return;
      watchdog = setTimeout(
        () =>
          finish(
            undefined,
            `no answer from the keeper within ${formatMs(timeoutMs)} ms (browser-inspector status, browser-inspector stop)`,
          ),
        timeoutMs,
      );
    };
    const rl = createInterface({ input: socket, crlfDelay: Infinity });
    rl.on('line', (line) => {
      /** @type {any} */
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        return;
      }
      arm();
      if (message?.progress && onProgress) onProgress(message.progress);
      if (message?.done === true) finish(message);
    });
    socket.on('error', (error) => finish(undefined, `connection error: ${messageOf(error)}`));
    socket.on('close', () => finish(undefined, 'connection closed before the keeper answered'));
    socket.write(`${JSON.stringify(request)}\n`);
    arm();
  });
}

/**
 * How long one exchange may stay silent. The CALLER's number wins — `status`, `stop` and the
 * doctor's probes pass their own deadline precisely because they must not wait ten minutes on a
 * keeper that connects and then says nothing. `BROWSER_INSPECTOR_REQUEST_TIMEOUT_MS` is next, read like
 * `intEnv` in keeper.mjs: empty or unparsable means "the default", not `Number('') === 0`, which
 * disarmed the watchdog altogether. Only an explicit `0` still means "no watchdog".
 * @param {NodeJS.ProcessEnv} env
 * @param {number} [override] the caller's deadline
 * @returns {number}
 */
export function requestTimeout(env, override) {
  if (override !== undefined) return override;
  const raw = env.BROWSER_INSPECTOR_REQUEST_TIMEOUT_MS;
  if (raw === undefined || raw.trim() === '') return REQUEST_TIMEOUT_MS;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : REQUEST_TIMEOUT_MS;
}

/**
 * Connect (spawning if needed), send, collect.
 * @param {KeeperRequest} request `token` is filled in here
 * @param {{ identity: Identity, env: NodeJS.ProcessEnv, spawn?: boolean, timeoutMs?: number, onProgress?: (p: any) => void }} options `timeoutMs` is the deadline for BOTH legs
 * @returns {Promise<KeeperDone>}
 */
export async function runViaKeeper(request, options) {
  const { socket, token } = await ensureKeeper(options.identity, options);
  return exchange(socket, { ...request, token }, options.onProgress, {
    timeoutMs: requestTimeout(options.env, options.timeoutMs),
  });
}

/**
 * The same handler as the keeper's, without the socket: `--no-daemon`, CI and the fallback.
 * The keeper's two modules and the engine are imported HERE, dynamically — the client's static
 * graph stays small.
 * @param {KeeperRequest} request
 * @param {{ mode: TimingMode, identity: Identity, env: NodeJS.ProcessEnv, onProgress?: (p: any) => void }} options
 * @returns {Promise<KeeperDone>}
 */
export async function runInProcess(request, options) {
  const [keeper, requests] = await Promise.all([import('./keeper.mjs'), import('./keeper.requests.mjs')]);
  const ctx = keeper.createContext({
    env: options.env,
    browserOpts: options.identity.browserOpts,
    engineModule: options.env.BROWSER_INSPECTOR_ENGINE_MODULE,
    mode: options.mode,
    info: {
      hash: options.identity.hash,
      pipe: '(in-process)',
      binPath: options.identity.binPath,
      version: options.identity.version,
    },
  });
  try {
    return await requests.handleRequest({ ...request, token: '' }, { ...ctx, onProgress: options.onProgress });
  } finally {
    await ctx.close();
  }
}

// ── Doctor ───────────────────────────────────────────────────────────────────

/** @param {string} pipe @param {string} suffix */
function probePipe(pipe, suffix) {
  if (process.platform === 'win32' || !pipe.endsWith('.sock')) return `${pipe}-${suffix}`;
  return `${pipe.slice(0, -'.sock'.length)}-${suffix}.sock`;
}

/**
 * `browser-inspector doctor`: does a keeper spawned by a client INSIDE A SHELL outlive that shell? Some hosts
 * (VS Code, Job Objects) kill the tree — then every call is cold and the agent should know.
 * The probe keeper has its own pipe (`BROWSER_INSPECTOR_SOCKET`), so the working keeper is untouched.
 * @param {{ env: NodeJS.ProcessEnv, cwd: string, identity: Identity }} input
 * @returns {Promise<{ line: string, survives: boolean, spawnToListenMs: number, firstJobMs: number, warmMs: number }>}
 */
export async function doctor(input) {
  const { env, cwd, identity } = input;
  const suffix = `doctor-${String(process.pid)}-${Math.random().toString(36).slice(2, 8)}`;
  const pipe = probePipe(identity.pipe, suffix);
  const probeEnv = {
    ...env,
    BROWSER_INSPECTOR_SOCKET: pipe,
    BROWSER_INSPECTOR_IDLE_MS: env.BROWSER_INSPECTOR_IDLE_MS ?? '120000',
  };
  const probe = computeIdentity({ env: probeEnv });
  const cmdline = `"${process.execPath}" "${BIN_PATH}" up`;
  const t0 = performance.now();
  const shell =
    process.platform === 'win32'
      ? spawn('cmd.exe', ['/d', '/s', '/c', `"${cmdline}"`], {
          env: probeEnv,
          stdio: 'ignore',
          windowsHide: true,
          windowsVerbatimArguments: true,
        })
      : spawn('sh', ['-c', cmdline], { env: probeEnv, stdio: 'ignore' });
  await new Promise((resolve) => {
    shell.on('exit', resolve);
    shell.on('error', resolve);
  });
  const firstJobMs = Math.round(performance.now() - t0);
  const info = readPidFile(pidFile(probe.key, probe.tmpdir));
  const spawnToListenMs =
    info && info.listeningAt !== undefined && info.processStartAt !== undefined
      ? info.listeningAt - info.processStartAt
      : 0;
  let survives = false;
  let warmMs = 0;
  const base = { v: /** @type {const} */ (1), token: '', cwd, values: {}, secretValues: [], files: {} };
  /** @param {string[]} argv @param {{ session?: string, timeoutMs?: number }} [options] */
  const ask = (argv, options = {}) =>
    runViaKeeper(
      { ...base, argv, ...(options.session !== undefined ? { session: options.session } : {}) },
      { identity: probe, env: probeEnv, spawn: false, timeoutMs: options.timeoutMs ?? CONTROL_TIMEOUT_MS },
    );
  try {
    // Survival is "the keeper spawned inside the shell still answers from THIS process" — any
    // answer proves it, so the probe is `status`, which every engine has. The warm number comes
    // from a real session round trip when the engine has one, else from that status exchange.
    const t1 = performance.now();
    const status = await ask(['status']);
    warmMs = Math.round(performance.now() - t1);
    survives = status.exit === 0;
    const t2 = performance.now();
    // A browser round trip, not a ping: with a control deadline a healthy but ordinary machine
    // would miss `open` by tens of milliseconds and doctor would report "survives: no".
    const job = { session: '__doctor', timeoutMs: DOCTOR_JOB_TIMEOUT_MS };
    const open = await ask(['open', 'about:blank', '--session', '__doctor'], job);
    if (open.exit === 0) {
      warmMs = Math.round(performance.now() - t2);
      await ask(['close', '--session', '__doctor'], job).catch(() => undefined);
    }
  } catch {
    survives = false;
  }
  await ask(['stop']).catch(() => undefined);
  const line = formatDoctor({
    survives,
    spawnToListenMs,
    firstJobMs,
    warmMs,
    hash: identity.hash,
    binPath: identity.binPath,
  });
  return { line, survives, spawnToListenMs, firstJobMs, warmMs };
}

// ── Main ─────────────────────────────────────────────────────────────────────

/**
 * @typedef {object} MainIO
 * @property {NodeJS.ProcessEnv} [env]
 * @property {string} [cwd]
 * @property {{ write: (text: string) => unknown }} [stdout]
 * @property {{ write: (text: string) => unknown }} [stderr]
 */

/**
 * The client. Returns the exit code (DESIGN.md §3.5); never throws for a user error.
 * @param {readonly string[]} argv `process.argv.slice(2)`
 * @param {MainIO} [io]
 * @returns {Promise<number>}
 */
export async function main(argv, io = {}) {
  const env = io.env ?? process.env;
  const cwd = io.cwd ?? process.cwd();
  const stdout = io.stdout ?? process.stdout;
  const stderr = io.stderr ?? process.stderr;
  const print = (/** @type {string[]} */ lines) => {
    if (lines.length > 0) stdout.write(`${lines.join('\n')}\n`);
  };

  /** @type {ParsedArgs} */
  let parsed;
  try {
    parsed = parseArgs(argv);
  } catch (error) {
    stderr.write(`${messageOf(error)}\n`);
    return error instanceof CliError ? error.exit : 2;
  }

  try {
    switch (parsed.mode) {
      case 'help':
        print([usage(parsed.command)]);
        return 0;
      case 'version':
        print([packageVersion()]);
        return 0;
      case 'lint-config':
        print(lintConfig(loadConfig(parsed.configPath, cwd)).lines);
        return 0;
      case 'up':
      case 'status':
      case 'stop':
        return await control(parsed.mode, { env, cwd, print, argv });
      case 'doctor': {
        const identity = computeIdentity({ env });
        const result = await doctor({ env, cwd, identity });
        print([result.line]);
        return result.survives ? 0 : 1;
      }
      case 'batch':
      case 'script':
        return await runBatchLike(parsed, { env, cwd, print, argv, stdout });
      case 'session':
      case 'export':
        return await runSessionLike(parsed, { env, cwd, print, argv });
      default:
        stderr.write(`browser-inspector: unknown mode\n`);
        return 2;
    }
  } catch (error) {
    if (error instanceof CliError) {
      stderr.write(`${error.message}\n`);
      return error.exit;
    }
    if (error instanceof ConfigError) {
      stderr.write(`${error.errors.map((e) => `config: ${e}`).join('\n')}\n`);
      return 2;
    }
    stderr.write(`browser-inspector: ${messageOf(error)}\n`);
    return 2;
  }
}

/**
 * @param {'up' | 'status' | 'stop'} mode
 * @param {{ env: NodeJS.ProcessEnv, cwd: string, print: (lines: string[]) => void, argv: readonly string[] }} io
 */
async function control(mode, io) {
  const identity = computeIdentity({ env: io.env });
  const request = {
    v: /** @type {const} */ (1),
    token: '',
    cwd: io.cwd,
    argv: [...io.argv],
    values: {},
    secretValues: [],
    files: {},
  };
  try {
    const done = await runViaKeeper(request, {
      identity,
      env: io.env,
      spawn: mode === 'up',
      ...(mode === 'up' ? {} : { timeoutMs: CONTROL_TIMEOUT_MS }),
    });
    io.print(done.lines);
    return done.exit;
  } catch (error) {
    if (!(error instanceof KeeperUnavailableError)) throw error;
    if (mode === 'up') {
      io.print([KEEPER_UNAVAILABLE(error.reason)]);
      return 2;
    }
    const pidPath = pidFile(identity.key, identity.tmpdir);
    // It connected and then said nothing: the process is alive, so "not running" would be a lie and
    // the wrong remedy — the pid is the only thing left to kill.
    if (error.stage === 'request') {
      const info = readPidFile(pidPath);
      const who = info ? `pid ${String(info.pid)} · ` : '';
      io.print([
        `FAIL keeper not answering · no answer from the keeper within ${formatMs(CONTROL_TIMEOUT_MS)} ms · ${who}hash ${identity.hash}`,
      ]);
      return 2;
    }
    // A pid file with nobody behind the pipe is a keeper that died with its shell (or a reboot):
    // the next keeper start removes it itself, but the path is the concrete remedy when it does not.
    // Its own line: with the pipe and a tmpdir path, one line would pass 160 characters.
    const lines = [`${mode === 'stop' ? 'ok ' : ''}keeper not running · hash ${identity.hash} · ${identity.pipe}`];
    if (fs.existsSync(pidPath))
      lines.push(`stale pid file ${pidPath.replaceAll('\\', '/')} — removed on the next start`);
    io.print(lines);
    return 0;
  }
}

/**
 * Batch and script: keeper when the daemon is enabled, in-process otherwise or when no keeper answers.
 * @param {Extract<ParsedArgs, { mode: 'batch' | 'script' }>} parsed
 * @param {{ env: NodeJS.ProcessEnv, cwd: string, print: (lines: string[]) => void, argv: readonly string[], stdout: { write: (text: string) => unknown } }} io
 */
async function runBatchLike(parsed, io) {
  const { env, cwd } = io;
  const config = parsed.mode === 'batch' ? loadConfig(parsed.configPath, cwd) : undefined;
  const { values, secretValues, files } = resolveValues(parsed, { env, cwd, config });
  const identity = computeIdentity({ env, browser: config?.browser ?? {} });
  /** @type {KeeperRequest} */
  const request = {
    v: 1,
    token: '',
    cwd,
    argv: [...io.argv],
    values,
    secretValues,
    files,
    ...(parsed.mode === 'script' && env.BROWSER_INSPECTOR_SESSION ? { session: env.BROWSER_INSPECTOR_SESSION } : {}),
    ...(parsed.mode === 'script' && parsed.options.out !== undefined ? { out: parsed.options.out } : {}),
  };
  const total = parsed.mode === 'batch' && config ? config.snapshots.length : 0;
  // One line per finished snapshot only when there is more than one — a single-flow run keeps its
  // stdout at the summary line (the token budget of §6 counts every line).
  const onProgress = (/** @type {{ snapshot: string, completed: boolean, ms: number, total: number }} */ p) => {
    if ((p.total ?? total) > 1)
      io.stdout.write(`${p.completed ? 'ok' : 'FAIL'} ${p.snapshot} · ${formatMs(p.ms)} ms\n`);
  };
  /** @type {TimingMode} */
  let mode = 'no-daemon';
  if (daemonEnabled(env, { noDaemon: parsed.options.noDaemon })) {
    try {
      const done = await runViaKeeper(request, { identity, env, onProgress });
      io.print(done.lines);
      return done.exit;
    } catch (error) {
      if (!(error instanceof KeeperUnavailableError)) throw error;
      io.print([`keeper: fallback · ${error.reason}`]);
      mode = 'fallback';
    }
  }
  const done = await runInProcess(request, { mode, identity, env, onProgress });
  io.print(done.lines);
  return done.exit;
}

/**
 * Session commands and export: keeper or exit 2 — never in-process.
 * @param {Extract<ParsedArgs, { mode: 'session' | 'export' }>} parsed
 * @param {{ env: NodeJS.ProcessEnv, cwd: string, print: (lines: string[]) => void, argv: readonly string[] }} io
 */
async function runSessionLike(parsed, io) {
  const { env, cwd } = io;
  const { values, secretValues, files } = resolveValues(parsed, { env, cwd });
  const session =
    parsed.options.session ??
    (env.BROWSER_INSPECTOR_SESSION && env.BROWSER_INSPECTOR_SESSION !== '' ? env.BROWSER_INSPECTOR_SESSION : undefined);
  if (!daemonEnabled(env)) {
    io.print([KEEPER_UNAVAILABLE('disabled (BROWSER_INSPECTOR_DAEMON=0 or CI)')]);
    return 2;
  }
  const identity = computeIdentity({ env });
  /** @type {KeeperRequest} */
  const request = {
    v: 1,
    token: '',
    cwd,
    argv: [...io.argv],
    values,
    secretValues,
    files,
    ...(session !== undefined ? { session } : {}),
    ...(parsed.mode === 'session' && parsed.options.out !== undefined ? { out: parsed.options.out } : {}),
  };
  try {
    const done = await runViaKeeper(request, { identity, env });
    io.print(done.lines);
    return done.exit;
  } catch (error) {
    if (!(error instanceof KeeperUnavailableError)) throw error;
    io.print([KEEPER_UNAVAILABLE(error.reason)]);
    return 2;
  }
}
