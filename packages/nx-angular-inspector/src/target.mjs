// target.mjs — running one target and reporting it in one line.
//
// The whole output goes to a file; the line carries the count of errors and the FIRST error, because
// that is what decides what to do next. Two properties earn their keep:
//
//   * ANSI is stripped before anything is written. Escape sequences are 45-51 % of the tokens in a
//     coloured build log — the agent pays for them on every read and cannot see a single colour.
//   * at most five error lines are extracted. A failing TypeScript build prints hundreds and they
//     are almost always the same mistake; the file is one read away when they are not.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { nxBin } from './paths.mjs';

/** How long a target may take before we call it a failure rather than a slow build. */
export const RUN_TIMEOUT_MS = 30 * 60_000;

/** Lines that look like a compiler or runner saying something went wrong. */
const ERROR_LINE =
  /(^|\s)(error|ERR!|FAIL|failed|Error:)\b|\bTS\d{4}\b|^\s*✖|^\s*×|^[^\s(]+\(\d+,\d+\):|^\s*NX\s+.*(failed|error)/iu;

/**
 * ANSI, spelled with \u escapes rather than the literal control characters: an ESC byte in a
 * source file is invisible in a diff and does not survive every editor and every copy-paste.
 * OSC is a title or a hyperlink (ESC ] ... BEL, or ESC ] ... ESC backslash); CSI is colour and
 * cursor movement. Together they are 45-51 % of the tokens in a coloured build log.
 */
const OSC = /\u001B\][^]*?(?:\u0007|\u001B\u005C)/gu;
const CSI = /\u001B[@-Z\u005C-_]|\u001B\[[0-?]*[ -/]*[@-~]/gu;

/** Noise that matches ERROR_LINE but says nothing: summary banners printed after the real errors. */
const ERROR_NOISE = /^\s*(NX\s+)?(Ran target|Successfully ran|View (structured|logs)|Failed tasks:)/iu;

/**
 * Remove ANSI escape sequences (colour, cursor moves, OSC hyperlinks) and normalise line endings.
 *
 * Written out rather than pulled from a package because the package would be a runtime dependency,
 * and this tool has none — the whole point is that it costs one `node` start and nothing else.
 * @param {string} text
 * @returns {string}
 */
export function stripAnsi(text) {
  return text.replaceAll('\r\n', '\n').replace(OSC, '').replace(CSI, '').replace(/\r/gu, '');
}

/**
 * Up to `max` distinct error lines from a log, in the order they appeared.
 * @param {string} log already ANSI-stripped
 * @param {number} [max]
 * @returns {string[]}
 */
export function errorLines(log, max = 5) {
  /** @type {string[]} */
  const found = [];
  /** @type {Set<string>} */
  const seen = new Set();
  for (const raw of log.split('\n')) {
    const line = raw.trim();
    if (line === '' || ERROR_NOISE.test(line) || !ERROR_LINE.test(line)) continue;
    if (seen.has(line)) continue;
    seen.add(line);
    found.push(line);
    if (found.length >= max) break;
  }
  return found;
}

/**
 * `portal:build` → the two halves, or null. A configuration (`portal:build:production`) is kept on
 * the target side and passed through to Nx untouched.
 * @param {string} spec
 * @returns {{ project: string, target: string } | null}
 */
export function parseTargetSpec(spec) {
  const at = spec.indexOf(':');
  if (at <= 0 || at === spec.length - 1) return null;
  return { project: spec.slice(0, at), target: spec.slice(at + 1) };
}

/**
 * Run `nx run <project>:<target>` and return the stripped log plus the exit code.
 *
 * Always `spawnSync(process.execPath, [nx.js, …], { shell: false })`. Never `npx` (~1 100 ms on an
 * identical binary, measured), never `cmd /c`, never a shell — project and target names come from a
 * graph this tool did not write, and a shell would make each of them a parsing question.
 * @param {string} root
 * @param {string} project
 * @param {string} target
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {{ status: number, log: string, error: string }}
 */
export function runTarget(root, project, target, env = process.env) {
  const bin = nxBin(root);
  if (!existsSync(bin)) return { status: 1, log: '', error: 'nx nie jest zainstalowany w tym workspace' };
  const result = spawnSync(process.execPath, [bin, 'run', `${project}:${target}`], {
    cwd: root,
    shell: false,
    windowsHide: true,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    timeout: RUN_TIMEOUT_MS,
    env: { ...env, NX_TUI: 'false', FORCE_COLOR: '0', NO_COLOR: '1' },
  });
  const log = stripAnsi(`${result.stdout ?? ''}${result.stderr ?? ''}`);
  if (result.error) {
    const timedOut = /** @type {NodeJS.ErrnoException} */ (result.error).code === 'ETIMEDOUT';
    return {
      status: 1,
      log,
      error: timedOut ? `target przekroczył ${String(RUN_TIMEOUT_MS / 60_000)} min` : 'nx nie wystartowało',
    };
  }
  return { status: result.status ?? 1, log, error: '' };
}
