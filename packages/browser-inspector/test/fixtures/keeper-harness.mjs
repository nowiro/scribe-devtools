// keeper-harness.mjs — spawn the real bin/browser-inspector.mjs against a real pipe with the fake engine.
//
// Every test gets its own pipe name, its own tmpdir for pid/lock/log (BROWSER_INSPECTOR_TMPDIR) and its own
// fake-engine log, so concurrent test files never share a keeper. `stopKeeper` is the safety net:
// `browser-inspector stop`, then wait for the pid file to go, then `kill` whatever is left — a keeper leaked by
// a failing test must not survive the run.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PACKAGE_DIR = fileURLToPath(new URL('../..', import.meta.url));
export const BIN = path.join(PACKAGE_DIR, 'bin', 'browser-inspector.mjs');
export const KEEPER = path.join(PACKAGE_DIR, 'src', 'keeper.mjs');
export const FAKE_ENGINE = path.join(PACKAGE_DIR, 'test', 'fixtures', 'fake-engine.mjs');

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const rand = () => Math.random().toString(36).slice(2, 10);

/** A pipe name nobody else uses. */
export function uniquePipe(tmpdir) {
  const id = `browser-inspector-test-${String(process.pid)}-${rand()}`;
  return process.platform === 'win32' ? `\\\\.\\pipe\\${id}` : path.join(tmpdir, `${id}.sock`);
}

/**
 * A fresh environment: the developer's BROWSER_INSPECTOR_* and CI variables are dropped, the keeper is enabled
 * explicitly, the fake engine is wired in.
 */
export function makeEnv(overrides = {}) {
  const tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), 'browser-inspector-test-'));
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith('BROWSER_INSPECTOR_')) continue;
    if (['CI', 'GITHUB_ACTIONS', 'GITLAB_CI', 'TF_BUILD', 'JENKINS_URL', 'TEAMCITY_VERSION', 'BUILDKITE', 'CIRCLECI'].includes(key)) continue;
    env[key] = value;
  }
  Object.assign(env, {
    BROWSER_INSPECTOR_DAEMON: '1',
    BROWSER_INSPECTOR_SOCKET: uniquePipe(tmpdir),
    BROWSER_INSPECTOR_TMPDIR: tmpdir,
    BROWSER_INSPECTOR_ENGINE_MODULE: FAKE_ENGINE,
    BROWSER_INSPECTOR_FAKE_LOG: path.join(tmpdir, 'fake.jsonl'),
    ...overrides,
  });
  const cwd = path.join(tmpdir, 'cwd');
  fs.mkdirSync(cwd, { recursive: true });
  return { env, tmpdir, cwd, pipe: env.BROWSER_INSPECTOR_SOCKET };
}

/**
 * Run `node bin/browser-inspector.mjs …` and collect everything.
 * @returns {Promise<{ code: number, stdout: string, stderr: string, lines: string[], ms: number }>}
 */
export function runBrowserInspector(args, { env, cwd }, options = {}) {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const child = spawn(process.execPath, [...(options.nodeArgs ?? []), BIN, ...args], {
      env,
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('close', (code) =>
      resolve({
        code: code ?? -1,
        stdout,
        stderr,
        lines: stdout.split(/\r?\n/u).filter((l) => l !== ''),
        ms: Math.round(performance.now() - t0),
      }),
    );
  });
}

/** Spawn `src/keeper.mjs` directly (the second-keeper tests). Resolves with the exit code. */
export function spawnKeeperDirect(args, { env }) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [KEEPER, ...args], { env, stdio: 'ignore', windowsHide: true });
    child.on('close', (code) => resolve(code ?? -1));
    child.on('error', () => resolve(-1));
  });
}

/** The pid file the client and keeper share for this env. */
export function pidFilePath({ env }) {
  const files = fs.existsSync(env.BROWSER_INSPECTOR_TMPDIR) ? fs.readdirSync(env.BROWSER_INSPECTOR_TMPDIR) : [];
  const name = files.find((f) => f.startsWith('browser-inspector-') && f.endsWith('.json'));
  return name ? path.join(env.BROWSER_INSPECTOR_TMPDIR, name) : undefined;
}

export function readPid({ env }) {
  const file = pidFilePath({ env });
  if (!file) return undefined;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return undefined;
  }
}

export function lockFilePath({ env }) {
  const files = fs.existsSync(env.BROWSER_INSPECTOR_TMPDIR) ? fs.readdirSync(env.BROWSER_INSPECTOR_TMPDIR) : [];
  const name = files.find((f) => f.startsWith('browser-inspector-') && f.endsWith('.lock'));
  return name ? path.join(env.BROWSER_INSPECTOR_TMPDIR, name) : undefined;
}

export function keeperLog({ env }) {
  const files = fs.existsSync(env.BROWSER_INSPECTOR_TMPDIR) ? fs.readdirSync(env.BROWSER_INSPECTOR_TMPDIR) : [];
  return files
    .filter((f) => f.startsWith('browser-inspector-') && f.endsWith('.log'))
    .map((f) => fs.readFileSync(path.join(env.BROWSER_INSPECTOR_TMPDIR, f), 'utf8'))
    .join('\n');
}

export function fakeLog({ env }) {
  try {
    return fs
      .readFileSync(env.BROWSER_INSPECTOR_FAKE_LOG, 'utf8')
      .split('\n')
      .filter((l) => l !== '')
      .map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}

export function isAlive(pid) {
  if (!Number.isInteger(pid)) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return /** @type {NodeJS.ErrnoException} */ (error).code === 'EPERM';
  }
}

/** Wait until `fn()` is truthy or the timeout passes. */
export async function until(fn, timeoutMs = 3000, stepMs = 25) {
  const deadline = performance.now() + timeoutMs;
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (performance.now() > deadline) return value;
    await sleep(stepMs);
  }
}

/**
 * Talk to the keeper directly over the pipe: one request line in, all NDJSON lines out.
 * @param {ReturnType<typeof makeEnv>} harness
 * @param {Record<string, any>} request
 * @param {{ token?: string }} [options] a token other than the pid file's (the bad-token test)
 */
export function rawRequest(harness, request, { token } = {}) {
  const info = readPid(harness);
  const tok = token ?? info?.token ?? '';
  return new Promise((resolve, reject) => {
    const socket = net.connect({ path: harness.pipe });
    const lines = [];
    let buffer = '';
    socket.on('connect', () => {
      socket.write(
        `${JSON.stringify({ v: 1, token: tok, cwd: harness.cwd, values: {}, secretValues: [], files: {}, ...request })}\n`,
      );
    });
    socket.on('data', (chunk) => {
      buffer += chunk;
      let index;
      while ((index = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 1);
        if (line !== '') lines.push(JSON.parse(line));
      }
    });
    socket.on('error', reject);
    socket.on('close', () => resolve({ lines, done: lines.find((l) => l.done === true), progress: lines.filter((l) => l.progress) }));
  });
}

/** `browser-inspector stop`, wait for the pid file to vanish, kill whatever is left. */
export async function stopKeeper(harness) {
  const info = readPid(harness);
  if (!info) return;
  // A pid file written by an in-process fake keeper (client.test.mjs) names THIS process: killing
  // it would take the vitest worker down with it. The fake's server is closed by its own test.
  if (info.pid === process.pid) {
    const own = pidFilePath(harness);
    if (own) fs.rmSync(own, { force: true });
    return;
  }
  await runBrowserInspector(['stop'], harness).catch(() => undefined);
  await until(() => !isAlive(info.pid), 3000);
  if (isAlive(info.pid)) {
    try {
      process.kill(info.pid);
    } catch {
      // Gone in the meantime.
    }
  }
  const file = pidFilePath(harness);
  if (file) {
    try {
      fs.unlinkSync(file);
    } catch {
      // Cleaned by the keeper.
    }
  }
}

/** Remove the harness tmpdir (best effort — Windows keeps a log open for a moment). */
export function cleanup(harness) {
  try {
    fs.rmSync(harness.tmpdir, { recursive: true, force: true, maxRetries: 3 });
  } catch {
    // Left for the OS.
  }
}
