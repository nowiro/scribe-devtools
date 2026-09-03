// cli.mjs — the pure argv parser. Nothing here touches the disk or the environment: the result
// says what to do and `verbs.run.mjs` does it.
//
// A typo fails HERE, with the help line of the verb, and never as an empty result from a graph
// query — `nx-angular-inspector projcts` must not read a 1,4 MB file before saying it does not know
// that word. `CliError.exit` is 2 for every parsing failure, so an agent can tell "you typed it
// wrong" (2) from "the answer is no" (1).
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
const VALUED = Object.freeze(new Set(['--root', '--out']));

/**
 * @typedef {object} Parsed
 * @property {'help' | 'version' | 'run'} mode
 * @property {string} verb '' in help/version mode
 * @property {string[]} args positional arguments after the verb
 * @property {{ root?: string, out?: string, fresh?: boolean, reverse?: boolean }} flags
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
    throw new CliError(`nieznana komenda: ${first} — znane: ${VERB_NAMES.join(', ')}`);
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
      throw new CliError(`${verb.name}: nieznana flaga ${name} — dozwolone: ${[...allowed].join(' ')}`);
    }
    if (!VALUED.has(name)) {
      if (eq !== -1) throw new CliError(`${verb.name}: flaga ${name} nie przyjmuje wartości`);
      flags[name.slice(2)] = true;
      continue;
    }
    const value = eq === -1 ? argv[++i] : token.slice(eq + 1);
    if (value === undefined || value === '') throw new CliError(`${verb.name}: flaga ${name} wymaga wartości`);
    flags[name.slice(2)] = value;
  }

  const maxArgs = verb.args === '' ? 0 : 1;
  if (args.length > maxArgs) {
    throw new CliError(`${verb.name}: za dużo argumentów (${String(args.length)})\n\n${usage(verb.name)}`);
  }
  if (verb.args.startsWith('<') && args.length === 0) {
    throw new CliError(`${verb.name}: brakuje argumentu ${verb.args}\n\n${usage(verb.name)}`);
  }

  return { mode: 'run', verb: verb.name, args, flags };
}
