// cli.mjs — the pure argv parser. Nothing here touches the disk or the environment: the result
// says what to do and `verbs.run.mjs` does it.
//
// A typo fails HERE, as ONE `FAIL` line in the shape of every other answer, and never as an empty
// result from a graph query — `nx-angular-inspector projcts` must not read a 1,4 MB file before
// saying it does not know that word. The line names the verb's `help` instead of printing it: the
// full table after a missing argument cost ~150 tokens per mistake. `CliError.exit` is 2 for every
// parsing failure, so an agent can tell "you typed it wrong" (2) from "the answer is no" (1).
import { findVerb, GLOBAL_FLAGS, usage, VERB_NAMES } from './verbs.schema.mjs';

export class CliError extends Error {
  /** @param {string} message @param {number} [exit] */
  constructor(message, exit = 2) {
    super(message);
    this.name = 'CliError';
    this.exit = exit;
  }
}

/** Flags that take a value; everything else in the tables is a boolean. */
const VALUED = Object.freeze(new Set(['--root', '--out', '--base', '--ready', '--timeout']));

/**
 * @typedef {object} Parsed
 * @property {'help' | 'version' | 'run'} mode
 * @property {string} verb '' in help/version mode
 * @property {string[]} args positional arguments after the verb
 * @property {{ root?: string, out?: string, base?: string, ready?: string, timeout?: string, fresh?: boolean, reverse?: boolean }} flags
 */

/**
 * @param {readonly string[]} argv `process.argv.slice(2)`
 * @returns {Parsed}
 */
export function parseArgs(argv) {
  const first = argv[0];
  if (first === undefined || first === 'help' || first === '--help' || first === '-h') {
    return { mode: 'help', verb: argv[1] ?? '', args: [], flags: {} };
  }
  if (first === 'version' || first === '--version' || first === '-v') {
    return { mode: 'version', verb: '', args: [], flags: {} };
  }

  const verb = findVerb(first);
  if (verb === undefined) {
    throw new CliError(`FAIL ${first} · nieznana komenda · znane: ${VERB_NAMES.join(', ')}`);
  }

  /** @type {string[]} */
  const args = [];
  /** @type {Record<string, string | boolean>} */
  const flags = {};
  const allowed = new Set([...GLOBAL_FLAGS, ...verb.flags]);

  for (let i = 1; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      args.push(token);
      continue;
    }
    const eq = token.indexOf('=');
    const name = eq === -1 ? token : token.slice(0, eq);
    if (!allowed.has(name)) {
      throw new CliError(`FAIL ${verb.name} · nieznana flaga ${name} · dozwolone: ${[...allowed].join(' ')}`);
    }
    if (!VALUED.has(name)) {
      if (eq !== -1) throw new CliError(`FAIL ${verb.name} · flaga ${name} nie przyjmuje wartości`);
      flags[name.slice(2)] = true;
      continue;
    }
    const value = eq === -1 ? argv[i + 1] : token.slice(eq + 1);
    // A flag is never a value. `--root --deep` used to set root to the string `--deep` and then
    // silently drop `--deep` — two wrong things from one typo, neither of them reported.
    if (value === undefined || value === '' || (eq === -1 && value.startsWith('--'))) {
      throw new CliError(`FAIL ${verb.name} · flaga ${name} wymaga wartości`);
    }
    if (eq === -1) i += 1;
    flags[name.slice(2)] = value;
  }

  // The arity comes from the `args` string in the table rather than a second field: two places to
  // state the same thing is two places to disagree, and the help text is generated from that string
  // anyway. `<foo>` is required, `[foo]` is not, and a token with no space in it counts as one
  // argument (`<projekt>:<target>` is one word the caller types).
  const tokens = verb.args.split(/\s+/u).filter((token) => token !== '');
  const required = tokens.filter((token) => token.startsWith('<')).length;
  const help = `nx-angular-inspector help ${verb.name}`;
  if (args.length > tokens.length) {
    throw new CliError(`FAIL ${verb.name} · za dużo argumentów (${String(args.length)}) · ${help}`);
  }
  if (args.length < required) {
    throw new CliError(`FAIL ${verb.name} · brakuje argumentu ${verb.args} · ${help}`);
  }

  return { mode: 'run', verb: verb.name, args, flags };
}
