// main.mjs — parse, locate, gate, dispatch. Returns the line instead of printing it, so a test can
// assert the exact contract without capturing stdout.
//
// The order matters and is the whole design in five steps:
//   1. parse argv           — a typo fails before anything is read
//   2. find the root        — walking up, because the agent runs from wherever it is
//   3. detect + threshold   — ONCE, before any command runs
//   4. run the verb
//   5. one line, one exit code
//
// Step 3 never degrades quietly. `nx 21.3.11` gets `FAIL env · nx 21.3.11 · wymagane nx >= 23`,
// not a best-effort answer: pretending to work on an unsupported version is the failure class this
// tool exists to replace.
import { CliError, parseArgs } from './cli.mjs';
import { detect, versionParts } from './detect.mjs';
import { findRoot, outDir as defaultOutDir } from './paths.mjs';
import { formatFail, truncate } from './print.mjs';
import { findVerb, usage } from './verbs.schema.mjs';
import { RUNNERS } from './verbs.run.mjs';

/**
 * @param {readonly string[]} argv
 * @param {object} [options]
 * @param {string} [options.cwd]
 * @param {NodeJS.ProcessEnv} [options.env]
 * @param {number} [options.now]
 * @param {string} [options.version] the package version, for `version`
 * @returns {{ line: string, exit: number }}
 */
export function main(argv, { cwd = process.cwd(), env = process.env, now = Date.now(), version = '' } = {}) {
  /** @type {import('./cli.mjs').Parsed} */
  let parsed;
  try {
    parsed = parseArgs(argv);
  } catch (error) {
    if (error instanceof CliError) return { line: error.message, exit: error.exit };
    throw error;
  }

  if (parsed.mode === 'help') {
    // `help projcts` is the same typo as `projcts` and gets the same code. Answering 0 to one and 2
    // to the other makes the exit code useless for telling "you typed it wrong" from "it worked".
    const unknown = parsed.verb !== '' && findVerb(parsed.verb) === undefined;
    return { line: usage(parsed.verb === '' ? undefined : parsed.verb), exit: unknown ? 2 : 0 };
  }
  if (parsed.mode === 'version') return { line: version, exit: 0 };

  const root = parsed.flags.root === undefined ? findRoot(cwd) : findRoot(parsed.flags.root);
  const detected = detect(root);
  if (!detected.supported) {
    // The version parts come first so the line names what it found before what it wants — the
    // reader's first question is always "what did it see?".
    return {
      line: formatFail(parsed.verb, detected.reason ?? 'brak wsparcia', versionParts(detected)),
      exit: 1,
    };
  }

  const outDir =
    parsed.flags.out === undefined
      ? defaultOutDir(root, env)
      : defaultOutDir(root, { ...env, NX_ANGULAR_INSPECTOR_OUT: parsed.flags.out });

  const runner = RUNNERS[/** @type {keyof typeof RUNNERS} */ (parsed.verb)];
  try {
    return runner({ root, cwd, outDir, args: parsed.args, flags: parsed.flags, detected, env, now });
  } catch (error) {
    // An unexpected failure is still one line: the agent's parser must never need a second shape.
    // The stack goes nowhere — it would be the largest thing this tool ever printed.
    const reason = error instanceof Error ? error.message : String(error);
    return { line: formatFail(parsed.verb, truncate(reason, 80)), exit: 1 };
  }
}
