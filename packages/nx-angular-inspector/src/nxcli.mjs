// nxcli.mjs — the fallback, and the only place this tool starts another process.
//
// Always `spawnSync(process.execPath, [<workspace>/node_modules/nx/bin/nx.js, …])` with
// `shell: false`. Never `npx`, never `cmd /c`, never `shell: true`:
//   * `cmd /c npx` costs ~1 100 ms on an identical binary — measured — which is most of what this
//     tool exists to avoid paying;
//   * a shell makes every argument a parsing question, and project names come from a graph we did
//     not write.
// `windowsHide` keeps a console window from flashing when the agent runs under a GUI host.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { nxBin } from './paths.mjs';

/** A CLI call is a last resort measured in seconds; past this it is a failure, not a slow answer. */
export const CLI_TIMEOUT_MS = 120_000;

/**
 * @typedef {object} CliResult
 * @property {boolean} ok
 * @property {any} json parsed stdout when `ok`, else null
 * @property {string} error one line, empty when `ok`
 */

/**
 * Run `nx <args>` in the workspace and parse its stdout as JSON.
 * @param {string} root
 * @param {readonly string[]} args
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {CliResult}
 */
export function nxJson(root, args, env = process.env) {
  const bin = nxBin(root);
  if (!existsSync(bin)) return { ok: false, json: null, error: 'nx nie jest zainstalowany w tym workspace' };
  const result = spawnSync(process.execPath, [bin, ...args], {
    cwd: root,
    shell: false,
    windowsHide: true,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    timeout: CLI_TIMEOUT_MS,
    // NX_DAEMON is left exactly as the user has it. Turning the daemon off would make us faster to
    // reason about and slower for the user, and turning it on would start a background process the
    // user did not ask for — a read-only tool has no business doing either.
    env: { ...env, NX_TUI: 'false', FORCE_COLOR: '0', NO_COLOR: '1' },
  });
  if (result.error) return { ok: false, json: null, error: firstLine(String(result.error.message)) };
  if (result.status !== 0) {
    const stderr = firstLine(result.stderr ?? '');
    return {
      ok: false,
      json: null,
      error: stderr === '' ? `nx zakończyło się kodem ${String(result.status)}` : stderr,
    };
  }
  try {
    return { ok: true, json: JSON.parse(stripToJson(result.stdout ?? '')), error: '' };
  } catch {
    return { ok: false, json: null, error: 'nx zwróciło wyjście, które nie jest JSON-em' };
  }
}

/**
 * Nx prints notices before the payload often enough that parsing the whole stdout is a coin toss.
 * Cut to the first `{` or `[` and parse from there.
 * @param {string} stdout
 * @returns {string}
 */
export function stripToJson(stdout) {
  const brace = stdout.indexOf('{');
  const bracket = stdout.indexOf('[');
  const start = brace === -1 ? bracket : bracket === -1 ? brace : Math.min(brace, bracket);
  return start <= 0 ? stdout : stdout.slice(start);
}

/** @param {string} text */
function firstLine(text) {
  return text.split('\n')[0].trim();
}
