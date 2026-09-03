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
 * Run `nx <args>` and report HOW IT ENDED, without touching its stdout.
 *
 * Most Nx commands do not print JSON at all — `nx graph --file=…` prints a notice and writes a
 * file — so the one caller here (`fromCli` in `workspace.mjs`) only ever needs the exit status and
 * the file it wrote. An earlier version of this function also tried to `JSON.parse` stdout and
 * report a parsed payload; that made every successful run of a non-JSON command look like a parse
 * failure, and — the part that mattered — made a genuine non-zero exit indistinguishable from
 * success, because the parse-failure branch fired first regardless of the exit code.
 * @param {string} root
 * @param {readonly string[]} args
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {{ ok: boolean, status: number, stdout: string, error: string }}
 */
export function nxRun(root, args, env = process.env) {
  const bin = nxBin(root);
  if (!existsSync(bin))
    return { ok: false, status: -1, stdout: '', error: 'nx nie jest zainstalowany w tym workspace' };
  const result = spawnSync(process.execPath, [bin, ...args], {
    cwd: root,
    shell: false,
    windowsHide: true,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    timeout: CLI_TIMEOUT_MS,
    env: { ...env, NX_TUI: 'false', FORCE_COLOR: '0', NO_COLOR: '1' },
  });
  if (result.error)
    return { ok: false, status: -1, stdout: result.stdout ?? '', error: firstLine(String(result.error.message)) };
  // `result.status` is `null`, not a number, when the process was killed by a signal — reporting
  // that as `-1` would read as a real (if unusual) exit code rather than what actually happened.
  const stderr = firstLine(result.stderr ?? '');
  const error = stderr !== '' ? stderr : result.status === null ? `nx zabite sygnałem ${String(result.signal)}` : '';
  return { ok: result.status === 0, status: result.status ?? -1, stdout: result.stdout ?? '', error };
}

/**
 * The first line that SAYS something.
 *
 * Nx, ng and jest all begin their stderr with a blank line, so taking line zero produced an empty
 * string every time — and an empty message then read as "no error at all", swallowing the reason.
 * @param {string} text
 * @returns {string}
 */
function firstLine(text) {
  return (
    text
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line !== '') ?? ''
  );
}
