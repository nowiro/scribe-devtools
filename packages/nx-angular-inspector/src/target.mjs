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

/**
 * A line that is genuinely a compiler or runner reporting a failure.
 *
 * Written as a list of SHAPES rather than a list of words. The word-based version matched every
 * sentence containing "error" or "failed", which on a realistic `nx run <p>:test` log meant the
 * names of PASSING tests (`✔ handles error responses gracefully`) and the summary line
 * (`Tests: 1 failed, 127 passed`) filled the five slots and pushed the one real failure out of the
 * answer entirely.
 */
const ERROR_SHAPES = [
  /\berror\s+TS\d{2,5}\b/u, //            tsc:      error TS2322: …
  /^[^\s(]+\(\d+,\d+\)\s*:/u, //          tsc/ng:   src/main.ts(12,5): …
  /^[^\s:]+:\d+:\d+\s*-\s*error\b/u, //   esbuild:  src/main.ts:1:1 - error TS2304
  /\bERR!/u, //                             npm
  /^Error\b\s*:/u, //                       a thrown error, at the start of a line
  /^\s*(?:✖|×|✗|✘)\s/u, //                  vitest / jest markers
  /^FAIL\s+\S/u, //                         jest/vitest: FAIL path/to/file.spec.ts
  /^NX\s+.*\b(?:failed|error)\b/iu, //      the Nx runner's own banner
];

/**
 * Lines that LOOK like failures and carry no information: summaries, counters and the names of
 * tests that passed. Checked first, so a summary can never occupy a slot.
 */
const ERROR_NOISE = [
  /^\s*(?:✓|✔|√|·|PASS)\s/u, //                    a passing test
  /^\s*(?:Test Suites|Tests|Snapshots|Time|Ran all)\s*:/u, //   jest's tail
  /\b\d+\s+(?:failed|passed|skipped|todo)\b/u, //             "1 failed, 127 passed"
  /^\s*(?:NX\s+)?(?:Ran target|Successfully ran|View (?:structured|logs)|Failed tasks|Failed to)/iu,
];

/**
 * ANSI, spelled with \u escapes rather than the literal control characters: an ESC byte in a
 * source file is invisible in a diff and does not survive every editor and every copy-paste.
 * OSC is a title or a hyperlink (ESC ] ... BEL, or ESC ] ... ESC backslash); CSI is colour and
 * cursor movement. Together they are 45-51 % of the tokens in a coloured build log.
 *
 * The OSC body forbids ESC, BEL and newline. With `[^]*?` a single UNTERMINATED `ESC ]` — one
 * truncated hyperlink is enough — swallowed everything up to the next BEL anywhere in the log,
 * compiler errors included, and `run` then reported a failure with zero errors found.
 */
// oxlint-disable-next-line no-control-regex -- matching ESC and BEL is what these two expressions are for
const OSC = /\u001B\][^\u0007\u001B\n]*(?:\u0007|\u001B\u005C)/gu;
// oxlint-disable-next-line no-control-regex -- as above
const CSI = /\u001B[@-Z\u005C-_]|\u001B\[[0-?]*[ -/]*[@-~]/gu;

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
 * The error lines in a log: the first `max` of them, and how many there are in TOTAL.
 *
 * The two numbers are different and the difference matters. The line used to print
 * `errors.length` from a list that was already capped at five, so a build with 147 errors reported
 * "5 błędów" — a number small enough that an agent decides not to open the file.
 * @param {string} log already ANSI-stripped
 * @param {number} [max]
 * @returns {{ shown: string[], total: number }}
 */
export function errorSummary(log, max = 5) {
  /** @type {string[]} */
  const shown = [];
  /** @type {Set<string>} */
  const seen = new Set();
  let total = 0;
  for (const raw of log.split('\n')) {
    const line = raw.trim();
    if (line === '') continue;
    if (ERROR_NOISE.some((pattern) => pattern.test(line))) continue;
    if (!ERROR_SHAPES.some((pattern) => pattern.test(line))) continue;
    if (seen.has(line)) continue;
    seen.add(line);
    total += 1;
    if (shown.length < max) shown.push(line);
  }
  return { shown, total };
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
 * @param {number} [timeoutMs] overridable so tests can trigger a REAL `ETIMEDOUT` in milliseconds
 *   instead of waiting out the real 30-minute budget.
 * @returns {{ status: number, log: string, error: string }}
 */
export function runTarget(root, project, target, env = process.env, timeoutMs = RUN_TIMEOUT_MS) {
  const bin = nxBin(root);
  if (!existsSync(bin)) return { status: 1, log: '', error: 'nx nie jest zainstalowany w tym workspace' };
  const result = spawnSync(process.execPath, [bin, 'run', `${project}:${target}`], {
    cwd: root,
    shell: false,
    windowsHide: true,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    timeout: timeoutMs,
    env: { ...env, NX_TUI: 'false', FORCE_COLOR: '0', NO_COLOR: '1' },
  });
  // A newline between them: without it the last unterminated line of stdout fused with the first
  // line of stderr, which is exactly where a compiler puts its error.
  const parts = [result.stdout ?? '', result.stderr ?? ''].filter((part) => part !== '');
  const log = stripAnsi(parts.join('\n'));
  if (result.error) {
    // Three different events used to share one message. `ENOBUFS` in particular means the target
    // RAN, produced more than `maxBuffer`, and was cut off — reporting that as "nx nie wystartowało"
    // sends the reader to look for an installation problem that does not exist, while 64 MB of its
    // output sits on disk unread.
    const code = /** @type {NodeJS.ErrnoException} */ (result.error).code;
    const error =
      code === 'ETIMEDOUT'
        ? `target przekroczył budżet czasu (${String(timeoutMs)} ms) — log jest ucięty`
        : code === 'ENOBUFS'
          ? 'wyjście przekroczyło 64 MB — log jest ucięty'
          : 'nx nie wystartowało';
    return { status: 1, log, error };
  }
  return { status: result.status ?? 1, log, error: '' };
}
