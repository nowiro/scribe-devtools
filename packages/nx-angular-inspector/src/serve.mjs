// serve.mjs — a dev server the agent starts, waits for, and stops, without ever holding the
// terminal and without ever hanging.
//
// Three properties earn this module its complexity:
//
//   * The child is DETACHED and its output goes straight to a file descriptor we then close. On
//     Windows an inherited pipe keeps the parent alive and an open handle keeps the log locked, so
//     an agent that started a server could neither exit nor read what it wrote.
//   * `wait` ALWAYS terminates. A timeout is a FAIL carrying the last lines of the log and its
//     path — never a process that sits there while the agent's turn expires. A dev server that
//     dies during the wait is noticed too, rather than waited on until the deadline.
//   * `stop` kills the TREE. `nx run <p>:serve` is a parent of the real server; killing only the
//     parent leaves the port held, and the next `serve` then fails for a reason that has nothing to
//     do with what the agent just did.
import { spawn, spawnSync } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { nxBin } from './paths.mjs';

/** How long `wait` looks for the ready line before calling it a failure. */
export const DEFAULT_WAIT_MS = 120_000;

/** How often the log is re-read while waiting. */
const POLL_MS = 100;

/**
 * What counts as "the server is up" when `--ready` is not given. Deliberately broad: Angular, Vite
 * and the Nx runner each announce themselves differently, and a pattern that misses turns a working
 * server into a two-minute timeout.
 */
export const DEFAULT_READY =
  /(Local:|listening|Listening|compiled successfully|ready in|Application bundle generation complete|watch mode enabled)/u;

/** A URL the server printed, so the line can carry it. */
const URL_IN_LOG = /https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?\/?\S*/u;

/**
 * @typedef {object} ServeState
 * @property {number} pid
 * @property {string} project
 * @property {string} target
 * @property {string} log absolute path
 * @property {number} startedAt epoch ms
 */

/** @param {string} outDir @param {string} project @returns {string} */
export function stateFile(outDir, project) {
  return path.join(outDir, 'serve', `${project.replaceAll('/', '-')}.json`);
}

/** @param {string} outDir @param {string} project @returns {string} */
export function logFile(outDir, project) {
  return path.join(outDir, 'serve', `${project.replaceAll('/', '-')}.log`);
}

/**
 * The recorded state, or null when there is none or it is unreadable. Unreadable is treated as
 * absent: a truncated state file must not stop the agent from starting a server.
 * @param {string} outDir
 * @param {string} project
 * @returns {ServeState | null}
 */
export function readState(outDir, project) {
  try {
    const parsed = JSON.parse(readFileSync(stateFile(outDir, project), 'utf8'));
    return typeof parsed?.pid === 'number' ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Is the recorded process still there?
 *
 * `kill(pid, 0)` answers "a process with this id exists", which is NOT the same as "our server".
 * A recycled pid points at a stranger. That is why `stop` refuses to kill a pid whose state file we
 * did not write, and why this returns a plain boolean rather than pretending to be proof.
 * @param {number} pid
 * @returns {boolean}
 */
export function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the process exists and belongs to somebody else — alive, and not ours.
    return /** @type {NodeJS.ErrnoException} */ (error).code === 'EPERM';
  }
}

/**
 * Start `nx run <project>:<target>` detached, with its output going to `log`.
 * @param {object} options
 * @param {string} options.root
 * @param {string} options.outDir
 * @param {string} options.project
 * @param {string} options.target
 * @param {NodeJS.ProcessEnv} [options.env]
 * @returns {{ ok: boolean, state: ServeState | null, error: string }}
 */
export function startServe({ root, outDir, project, target, env = process.env }) {
  const bin = nxBin(root);
  if (!existsSync(bin)) return { ok: false, state: null, error: 'nx nie jest zainstalowany w tym workspace' };

  const log = logFile(outDir, project);
  mkdirSync(path.dirname(log), { recursive: true });
  // `w`, not `a`: a wait reads this file looking for a ready line, and yesterday's ready line would
  // make it return instantly against a server that never started.
  const fd = openSync(log, 'w');
  try {
    const child = spawn(process.execPath, [bin, 'run', `${project}:${target}`], {
      cwd: root,
      shell: false,
      windowsHide: true,
      detached: true,
      stdio: ['ignore', fd, fd],
      env: { ...env, NX_TUI: 'false', FORCE_COLOR: '0', NO_COLOR: '1' },
    });
    if (child.pid === undefined) return { ok: false, state: null, error: 'nie udało się wystartować procesu' };
    // Both halves matter and neither is obvious: `unref` lets THIS process exit while the server
    // runs, and closing our copy of the descriptor lets the log be read and rotated — on Windows an
    // open handle here is a lock everybody else trips over.
    child.unref();
    /** @type {ServeState} */
    const state = { pid: child.pid, project, target, log, startedAt: Date.now() };
    writeFileSync(stateFile(outDir, project), `${JSON.stringify(state, null, 2)}\n`, 'utf8');
    return { ok: true, state, error: '' };
  } finally {
    closeSync(fd);
  }
}

/**
 * Block until the log shows `ready`, the process dies, or the deadline passes.
 *
 * The sleep is `Atomics.wait` on purpose: every other verb in this tool is synchronous, and making
 * one of them async would put a promise in the middle of a code path whose whole contract is "one
 * line, then exit".
 * @param {object} options
 * @param {ServeState} options.state
 * @param {RegExp} [options.ready]
 * @param {number} [options.timeoutMs]
 * @param {number} [options.pollMs]
 * @returns {{ status: 'ready' | 'timeout' | 'martwy', waitedMs: number, url: string, tail: string[] }}
 */
export function waitForServe({ state, ready = DEFAULT_READY, timeoutMs = DEFAULT_WAIT_MS, pollMs = POLL_MS }) {
  const started = Date.now();
  const sleeper = new Int32Array(new SharedArrayBuffer(4));
  for (;;) {
    const log = tail(state.log, 0);
    if (ready.test(log)) {
      return {
        status: 'ready',
        waitedMs: Date.now() - started,
        url: URL_IN_LOG.exec(log)?.[0] ?? '',
        tail: lastLines(log),
      };
    }
    if (!alive(state.pid)) {
      return { status: 'martwy', waitedMs: Date.now() - started, url: '', tail: lastLines(log) };
    }
    if (Date.now() - started >= timeoutMs) {
      return { status: 'timeout', waitedMs: Date.now() - started, url: '', tail: lastLines(log) };
    }
    Atomics.wait(sleeper, 0, 0, pollMs);
  }
}

/**
 * Kill the recorded process and its children, then drop the state file.
 * @param {object} options
 * @param {string} options.outDir
 * @param {ServeState} options.state
 * @returns {{ ok: boolean, error: string }}
 */
export function stopServe({ outDir, state }) {
  let error = '';
  if (alive(state.pid)) {
    if (process.platform === 'win32') {
      // `/T` is the whole point: `nx run <p>:serve` is a parent of the real server, and killing only
      // the parent leaves the port held by an orphan.
      const killed = spawnSync('taskkill', ['/pid', String(state.pid), '/T', '/F'], {
        shell: false,
        windowsHide: true,
        encoding: 'utf8',
      });
      if (killed.status !== 0 && alive(state.pid))
        error = (killed.stderr ?? '').split('\n')[0].trim() || 'taskkill nie zadziałało';
    } else {
      try {
        // Negative pid = the process GROUP, which `detached: true` gave the child.
        process.kill(-state.pid, 'SIGTERM');
      } catch {
        try {
          process.kill(state.pid, 'SIGTERM');
        } catch {
          error = 'nie udało się zatrzymać procesu';
        }
      }
    }
  }
  rmSync(stateFile(outDir, state.project), { force: true });
  return { ok: error === '', error };
}

/**
 * The log from `offset` bytes on, or '' when it is not there yet.
 * @param {string} file
 * @param {number} offset
 * @returns {string}
 */
export function tail(file, offset) {
  try {
    const text = readFileSync(file, 'utf8');
    return offset > 0 && offset < text.length ? text.slice(offset) : text;
  } catch {
    return '';
  }
}

/**
 * The last non-empty lines, for a failure line that has to say something useful in five lines.
 * @param {string} text
 * @param {number} [count]
 * @returns {string[]}
 */
export function lastLines(text, count = 5) {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .slice(-count);
}

/** Bytes written so far, or 0. @param {string} file */
export function sizeOf(file) {
  try {
    return statSync(file).size;
  } catch {
    return 0;
  }
}
