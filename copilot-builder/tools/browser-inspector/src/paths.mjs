// paths.mjs — where the keeper lives and whether it lives at all (DESIGN.md §2.5).
//
// Imported by the CLIENT, so: `node:fs`, `node:os`, `node:path` only, FNV-1a in JS instead of
// `node:crypto`, no playwright-core. Every function that decides something takes its inputs as
// arguments (`env`, `platform`, `tmpdir`) so the tests can pin the behaviour without touching the
// real environment.

import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** The eight CI variables — any one of them means "no keeper" (BUILD_ID is not on the list on purpose). */
export const CI_VARS = Object.freeze([
  'CI',
  'GITHUB_ACTIONS',
  'GITLAB_CI',
  'TF_BUILD',
  'JENKINS_URL',
  'TEAMCITY_VERSION',
  'BUILDKITE',
  'CIRCLECI',
]);

export const DEFAULT_OUTPUT_DIR = './.browser-inspector';

/** Marker written by `scripts/portable-zip.mjs` next to the package.json of an unpacked zip. */
export const PORTABLE_MARKER = 'PORTABLE';

/**
 * 32-bit FNV-1a as eight lowercase hex digits. Not a security hash — it only has to make two
 * different identities land on two different pipe names.
 * @param {string} text
 * @returns {string}
 */
export function fnv1a(text) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    // Multiply by the FNV prime 16777619 in 32-bit arithmetic without BigInt.
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/**
 * @typedef {object} IdentityParts
 * @property {string} pkgVersion `browser-inspector` version
 * @property {string} pwVersion `playwright-core` version
 * @property {number | string} nodeMajor
 * @property {string} [channel] `chrome` | `msedge` | '' (auto)
 * @property {string} [executablePath]
 * @property {boolean} [headless]
 * @property {readonly string[]} [args] browser args from the config
 * @property {boolean} [fastHeadless] `browser.fastHeadless` — the headless launch flags
 * @property {'no-preference' | 'reduce' | string} [motion] `browser.motion` — `reducedMotion` of every context
 * @property {string} [browserArgsEnv] `BROWSER_INSPECTOR_BROWSER_ARGS`
 * @property {string} [httpProxy] `HTTP_PROXY`
 * @property {string} [httpsProxy] `HTTPS_PROXY`
 * @property {string} [noProxy] `NO_PROXY`
 * @property {string} binRealpath `realpath(bin/browser-inspector.mjs)` — two checkouts get two keepers
 * @property {string | number} [srcStamp] max mtime of `src/**` ('' in a portable zip)
 * @property {boolean} [unsafe] `BROWSER_INSPECTOR_UNSAFE=1` — an unsafe keeper is a separate identity
 */

/**
 * The identity hash: two clients hit the same keeper only when EVERYTHING that shapes the browser
 * and the code driving it is equal. A stale keeper (old `src/`, other checkout, other Node) is
 * simply not addressed any more and dies of idleness.
 * @param {IdentityParts} parts
 * @returns {string} 8 hex digits
 */
export function identityHash(parts) {
  const text = [
    parts.pkgVersion,
    parts.pwVersion,
    String(parts.nodeMajor),
    parts.channel ?? '',
    parts.executablePath ?? '',
    parts.headless === undefined ? 'true' : String(parts.headless),
    (parts.args ?? []).join(' '),
    // Normalized, not raw: `fastHeadless` decides the launch flags and `motion` the `reducedMotion`
    // of every context, so a config that turns either off is a DIFFERENT browser and needs its own
    // keeper — but the defaults must keep hashing like a config that never mentioned them.
    parts.fastHeadless === false ? 'no-fast-headless' : '',
    parts.motion === 'reduce' ? 'reduce' : '',
    parts.browserArgsEnv ?? '',
    parts.httpProxy ?? '',
    parts.httpsProxy ?? '',
    parts.noProxy ?? '',
    parts.binRealpath,
    parts.srcStamp === undefined ? '' : String(parts.srcStamp),
    // `BROWSER_INSPECTOR_UNSAFE=1` is part of WHO the keeper is: `browser-inspector run --file` is gated on the keeper's env,
    // so a client without the variable must never reach a keeper that has it (or the reverse).
    parts.unsafe === true ? 'unsafe' : '',
  ].join('|');
  return fnv1a(text);
}

/**
 * Newest mtime (integer ms) under `dir`, recursively — the `srcStamp`. Editing any file in `src/`
 * changes the hash, so a keeper running yesterday's code is never hit by today's client.
 * @param {string} dir
 * @returns {number}
 */
export function srcStamp(dir) {
  let newest = 0;
  if (!existsSync(dir)) return newest;
  for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const file = path.join(entry.parentPath ?? dir, entry.name);
    try {
      newest = Math.max(newest, Math.floor(statSync(file).mtimeMs));
    } catch {
      // A file deleted between readdir and stat is not part of the stamp.
    }
  }
  return newest;
}

/**
 * The `version` field of `dir/package.json`, `fallback` when unreadable. The one reader in the
 * package: the identity hash wants `''` for "no such package", the engine and the keeper report
 * `'0.0.0'` — the difference is the argument, not a second copy of the try/catch.
 * @param {string} dir
 * @param {string} [fallback]
 * @returns {string}
 */
export function packageVersion(dir, fallback = '') {
  try {
    const parsed = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'));
    return typeof parsed.version === 'string' ? parsed.version : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Locate `node_modules/playwright-core` by walking up from the package — the version is read from
 * its package.json with `fs`, never by importing it (the client budget forbids the import).
 * @param {string} packageDir
 * @returns {string}
 */
export function playwrightCoreVersion(packageDir) {
  let dir = packageDir;
  for (let depth = 0; depth < 8; depth += 1) {
    const candidate = path.join(dir, 'node_modules', 'playwright-core');
    if (existsSync(path.join(candidate, 'package.json'))) return packageVersion(candidate);
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return '';
}

/**
 * Collect the identity parts from the real tree and environment. `srcStamp` is skipped when the
 * `PORTABLE` marker sits in the package directory (an unpacked zip has meaningless mtimes and no
 * one edits its `src/`).
 * @param {{ packageDir: string, env?: NodeJS.ProcessEnv, browser?: { channel?: string, executablePath?: string, headless?: boolean, args?: readonly string[], fastHeadless?: boolean, motion?: string }, nodeMajor?: number }} input
 * @returns {IdentityParts}
 */
export function collectIdentity(input) {
  const env = input.env ?? process.env;
  const browser = input.browser ?? {};
  const packageDir = input.packageDir;
  const binFile = path.join(packageDir, 'bin', 'browser-inspector.mjs');
  let binRealpath = binFile;
  try {
    binRealpath = realpathSync(binFile);
  } catch {
    // Before WP5 lands bin/browser-inspector.mjs the path is still a stable identity input.
  }
  const portable = existsSync(path.join(packageDir, PORTABLE_MARKER));
  return {
    pkgVersion: packageVersion(packageDir),
    pwVersion: playwrightCoreVersion(packageDir),
    nodeMajor: input.nodeMajor ?? Number(process.versions.node.split('.')[0]),
    // `||`, not `??`, and the same for the flags below: this is the one place that must read the
    // environment exactly as `launchPlan` does, and there an EMPTY variable is not an override. A
    // CI job exporting `BROWSER_INSPECTOR_CHANNEL=` with an empty input otherwise dropped
    // `browser.channel` from the identity while the browser still launched from the config —
    // and two configs naming two different browsers hashed into one keeper.
    channel: env.BROWSER_INSPECTOR_CHANNEL || browser.channel || '',
    executablePath: env.BROWSER_INSPECTOR_BROWSER_PATH || browser.executablePath || '',
    headless: browser.headless !== false,
    args: browser.args ?? [],
    fastHeadless: browser.fastHeadless !== false,
    motion: browser.motion === 'reduce' ? 'reduce' : 'no-preference',
    browserArgsEnv: (env.BROWSER_INSPECTOR_BROWSER_ARGS ?? '').split(/\s+/u).filter(Boolean).join(' '),
    httpProxy: env.HTTP_PROXY ?? env.http_proxy ?? '',
    httpsProxy: env.HTTPS_PROXY ?? env.https_proxy ?? '',
    noProxy: env.NO_PROXY ?? env.no_proxy ?? '',
    binRealpath: binRealpath.replaceAll('\\', '/'),
    srcStamp: portable ? '' : srcStamp(path.join(packageDir, 'src')),
    unsafe: env.BROWSER_INSPECTOR_UNSAFE === '1',
  };
}

/** Pipe/socket names must be plain: a user name with a space or a backslash (`DOMAIN\user`) is not. */
const safeName = (/** @type {string} */ name) => name.replace(/[^A-Za-z0-9_-]/gu, '_') || 'user';

/**
 * Where the keeper listens. `BROWSER_INSPECTOR_SOCKET` wins (two agents, two keepers). Windows: a named pipe
 * `\\.\pipe\browser-inspector-<user>-<hash>`; elsewhere `$XDG_RUNTIME_DIR` (or the tmpdir) `/browser-inspector-<uid>-<hash>.sock`.
 * @param {string} hash
 * @param {{ platform?: NodeJS.Platform, env?: NodeJS.ProcessEnv, user?: string, uid?: number | string, tmpdir?: string }} [options]
 * @returns {string}
 */
export function pipeName(hash, options = {}) {
  const env = options.env ?? process.env;
  if (env.BROWSER_INSPECTOR_SOCKET) return env.BROWSER_INSPECTOR_SOCKET;
  const platform = options.platform ?? process.platform;
  if (platform === 'win32') {
    const user = options.user ?? userName();
    return `\\\\.\\pipe\\browser-inspector-${safeName(user)}-${hash}`;
  }
  const uid = options.uid ?? (typeof process.getuid === 'function' ? process.getuid() : 'u');
  const dir = env.XDG_RUNTIME_DIR && env.XDG_RUNTIME_DIR !== '' ? env.XDG_RUNTIME_DIR : (options.tmpdir ?? os.tmpdir());
  return path.join(dir, `browser-inspector-${String(uid)}-${hash}.sock`);
}

/** @returns {string} */
function userName() {
  try {
    return os.userInfo().username;
  } catch {
    return process.env.USERNAME ?? process.env.USER ?? 'user';
  }
}

/** `<tmpdir>/browser-inspector-<hash>.json` — `{ pid, pipe, token, version, startedAt, binPath }`, written by the keeper. */
export const pidFile = (/** @type {string} */ hash, tmpdir = os.tmpdir()) =>
  path.join(tmpdir, `browser-inspector-${hash}.json`);
/** `<tmpdir>/browser-inspector-<hash>.lock` — taken with `O_EXCL` by the keeper; the second keeper exits 0. */
export const lockFile = (/** @type {string} */ hash, tmpdir = os.tmpdir()) =>
  path.join(tmpdir, `browser-inspector-${hash}.lock`);
/** `<tmpdir>/browser-inspector-<hash>.log` — truncated at 1 MB, never a secret value. */
export const logFile = (/** @type {string} */ hash, tmpdir = os.tmpdir()) =>
  path.join(tmpdir, `browser-inspector-${hash}.log`);

/**
 * `<out>/session/<name>` — the session directory (snap.md, journal.jsonl, shots/, …).
 * @param {string} out
 * @param {string} [name]
 */
export const sessionDir = (out, name = 'default') => path.join(out, 'session', name);

/**
 * The output directory of a config, resolved like the ALM tool does: relative to the CONFIG FILE, not
 * the cwd — so a config in the repo root writes to `<repo>/.browser-inspector` from anywhere.
 * @param {string | undefined} outputDir
 * @param {string} baseDir directory of the config file (or the cwd for a session)
 * @returns {string}
 */
export function resolveOutputDir(outputDir, baseDir) {
  return path.resolve(baseDir, outputDir && outputDir !== '' ? outputDir : DEFAULT_OUTPUT_DIR);
}

/**
 * "Is this a CI runner?" — a pure list check, never `isTTY` (the Bash of an agent is not a TTY
 * either, and that is precisely where the keeper must live).
 * @param {NodeJS.ProcessEnv} env
 * @returns {boolean}
 */
export function isCI(env) {
  return CI_VARS.some((name) => {
    const value = env[name];
    return value !== undefined && value !== '' && value !== '0' && value.toLowerCase() !== 'false';
  });
}

/**
 * Whether a client should talk to (and start) the keeper. `BROWSER_INSPECTOR_DAEMON=1` wins over CI detection —
 * the explicit way to get the warm path on a runner; `BROWSER_INSPECTOR_DAEMON=0` and `--no-daemon` win over
 * everything else.
 * @param {NodeJS.ProcessEnv} env
 * @param {{ noDaemon?: boolean }} [options]
 * @returns {boolean}
 */
export function daemonEnabled(env, options = {}) {
  if (options.noDaemon === true) return false;
  const flag = env.BROWSER_INSPECTOR_DAEMON;
  if (flag === '0' || flag === 'false') return false;
  if (flag === '1' || flag === 'true') return true;
  return !isCI(env);
}
