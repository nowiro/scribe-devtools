// cli.mjs — the pure argv parser of `bi` (DESIGN.md §3.1): two entrances, one grammar.
//
//   bi <config.json> [--stamp X] [--only n] [--parallel N] [--fresh] [--junit f] [--fail-on-incomplete] [--no-daemon]
//   bi <command> [args] [--session NAME] [--out DIR] [--soft]      — a session step from the STEPS table
//   bi script <file> [--out DIR] [--no-daemon]
//   bi up | status | stop | doctor | help [command] | export <flow.json> [--session NAME] [--force] | lint-config <config>
//
// Nothing here touches the disk or the environment: the result says what to do and the client
// does it. A typo fails HERE, in the client, with the help line of the step — never as a
// `ref not found` from the keeper. `CliError.exit` is 2 for every parsing failure.

import {
  ALL_SPELLINGS,
  STEPS,
  helpFor,
  parseFieldType,
  resolveStepName,
  stepNames,
  validateSteps,
} from './steps.schema.mjs';

/** Run stamp form, the same as scribe's `read-runtime`: `YYYY-MM-DD_HH-MM`. */
export const STAMP_PATTERN = /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}$/u;

export class CliError extends Error {
  /** @param {string} message @param {number} [exit] */
  constructor(message, exit = 2) {
    super(message);
    this.name = 'CliError';
    this.exit = exit;
  }
}

export const CONTROL_COMMANDS = Object.freeze(['up', 'status', 'stop', 'doctor']);

const BATCH_FLAGS = Object.freeze({
  stamp: 'string',
  only: 'list+',
  parallel: 'int',
  fresh: 'bool',
  junit: 'string',
  'fail-on-incomplete': 'bool',
  'no-daemon': 'bool',
});
const SESSION_FLAGS = Object.freeze({ session: 'string', out: 'string', soft: 'bool' });
const SCRIPT_FLAGS = Object.freeze({ out: 'string', 'no-daemon': 'bool' });
const EXPORT_FLAGS = Object.freeze({ session: 'string', force: 'bool' });

const STAMP_FORMAT = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Warsaw',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/**
 * `Date` → `YYYY-MM-DD_HH-MM` in Europe/Warsaw — the directory name of a run when `--stamp` is absent.
 * @param {Date} date
 * @returns {string}
 */
export function formatStamp(date) {
  const parts = new Map(STAMP_FORMAT.formatToParts(date).map((part) => [part.type, part.value]));
  const hour = parts.get('hour') === '24' ? '00' : (parts.get('hour') ?? '00');
  return `${parts.get('year') ?? '1970'}-${parts.get('month') ?? '01'}-${parts.get('day') ?? '01'}_${hour}-${parts.get('minute') ?? '00'}`;
}

/**
 * Levenshtein for "did you mean": two edits away is a typo, more is a different word.
 * @param {string} a @param {string} b
 */
function distance(a, b) {
  const rows = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j += 1) rows[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      rows[i][j] = Math.min(
        rows[i - 1][j] + 1,
        rows[i][j - 1] + 1,
        rows[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
  }
  return rows[a.length][b.length];
}

/**
 * @param {string} word
 * @param {readonly string[]} candidates
 * @returns {string | undefined}
 */
export function suggest(word, candidates) {
  let best;
  let bestDistance = 3;
  for (const candidate of candidates) {
    const d = distance(word.toLowerCase(), candidate.toLowerCase());
    if (d < bestDistance) {
      best = candidate;
      bestDistance = d;
    }
  }
  return best;
}

/**
 * Generic `--flag value` / `--flag=value` / `--bool` parser over a spec of field types (`list+` =
 * repeatable). Positionals keep their order; `--` ends flag parsing; a lone negative number is a
 * positional (`mouse wheel -100`), anything else starting with `-` is a flag.
 * @param {readonly string[]} args
 * @param {Readonly<Record<string, string>>} spec
 * @param {string} scope for messages: `click`, `batch`, `script`
 * @returns {{ positionals: string[], flags: Record<string, any> }}
 */
export function splitFlags(args, spec, scope) {
  const positionals = [];
  /** @type {Record<string, any>} */
  const flags = {};
  const known = Object.keys(spec);
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--') {
      positionals.push(...args.slice(i + 1));
      break;
    }
    if (!arg.startsWith('-') || /^-\d/u.test(arg)) {
      positionals.push(arg);
      continue;
    }
    if (!arg.startsWith('--'))
      throw new CliError(`unknown flag ${JSON.stringify(arg)} — ${scope} takes ${flagList(spec)}`);
    const eq = arg.indexOf('=');
    const name = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
    const inline = eq === -1 ? undefined : arg.slice(eq + 1);
    if (!Object.hasOwn(spec, name)) {
      const hint = suggest(name, known);
      throw new CliError(
        `unknown flag --${name}${hint ? ` (did you mean --${hint}?)` : ''} — ${scope} takes ${flagList(spec)}`,
      );
    }
    const type = spec[name];
    if (type === 'bool') {
      if (inline !== undefined && inline !== 'true' && inline !== 'false') {
        throw new CliError(`--${name} is a switch and takes no value (got ${JSON.stringify(inline)})`);
      }
      flags[name] = inline !== 'false';
      continue;
    }
    let raw = inline;
    if (raw === undefined) {
      const next = args[i + 1];
      // `--stamp --junit out.xml` is a forgotten stamp, not a stamp named `--junit`.
      if (next === undefined || (next.startsWith('--') && next !== '--')) {
        throw new CliError(`--${name} requires a value — none was given`);
      }
      raw = next;
      i += 1;
    }
    flags[name] = coerceFlag(raw, type, name, spec[name] === 'list+' ? flags[name] : undefined);
  }
  return { positionals, flags };
}

/** @param {Readonly<Record<string, string>>} spec */
function flagList(spec) {
  const names = Object.keys(spec).map((n) => `--${n}`);
  return names.length > 0 ? names.join(', ') : 'no flags';
}

/**
 * @param {string} raw @param {string} type @param {string} name @param {string[] | undefined} previous
 * @returns {any}
 */
function coerceFlag(raw, type, name, previous) {
  const spec = parseFieldType(type === 'list+' ? 'list' : type);
  switch (spec.base) {
    case 'int': {
      const n = Number(raw);
      if (!Number.isInteger(n)) throw new CliError(`--${name} expects an integer, got ${JSON.stringify(raw)}`);
      return n;
    }
    case 'number': {
      const n = Number(raw);
      if (!Number.isFinite(n)) throw new CliError(`--${name} expects a number, got ${JSON.stringify(raw)}`);
      return n;
    }
    case 'list': {
      const items = raw
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s !== '');
      return type === 'list+' ? [...(previous ?? []), ...items] : items;
    }
    case 'enum':
      if (!(spec.values ?? []).includes(raw)) {
        throw new CliError(`--${name} expects ${(spec.values ?? []).join('|')}, got ${JSON.stringify(raw)}`);
      }
      return raw;
    default:
      return raw;
  }
}

/**
 * Bind positionals to the step's `argv` names: `name` required, `name?` optional, `name...` rest.
 * @param {readonly string[] | string[]} positionals
 * @param {readonly string[]} argvSpec
 * @param {string} command
 * @param {string} help
 * @returns {Record<string, any>}
 */
export function bindPositionals(positionals, argvSpec, command, help) {
  /** @type {Record<string, any>} */
  const bound = {};
  let index = 0;
  for (const spec of argvSpec) {
    if (spec.endsWith('...')) {
      bound[spec.slice(0, -3)] = positionals.slice(index);
      index = positionals.length;
      continue;
    }
    const optional = spec.endsWith('?');
    const name = optional ? spec.slice(0, -1) : spec;
    if (index < positionals.length) {
      bound[name] = positionals[index];
      index += 1;
    } else if (!optional) {
      throw new CliError(`${command}: missing <${name}> — usage: bi ${help}`);
    }
  }
  if (index < positionals.length) {
    throw new CliError(`${command}: unexpected argument ${JSON.stringify(positionals[index])} — usage: bi ${help}`);
  }
  return bound;
}

/**
 * Build the config-shaped step from a session command line. The row's `fromArgv` maps
 * positionals and flags; a row without one gets the generic mapping (same-named config fields).
 * @param {string} command as typed (name or alias)
 * @param {readonly string[]} args everything after the command
 * @param {Readonly<Record<string, import('./types.js').StepDef>>} steps
 * @returns {{ name: string, step: Record<string, unknown>, options: Record<string, any> }}
 */
export function parseSessionCommand(command, args, steps = STEPS) {
  const name = resolveStepName(command);
  if (name === undefined || !Object.hasOwn(steps, name)) {
    const hint = suggest(command, ALL_SPELLINGS);
    throw new CliError(
      `unknown command ${JSON.stringify(command)}${hint ? ` — did you mean "${hint}"?` : ''} (bi help lists the commands)`,
    );
  }
  const def = steps[name];
  if (!def.session) throw new CliError(`"${name}" is a config step, not a session command (bi help)`);
  const { positionals, flags } = splitFlags(args, { ...def.flags, ...SESSION_FLAGS }, command);
  /** @type {Record<string, any>} */
  const options = {};
  for (const key of Object.keys(SESSION_FLAGS)) {
    if (flags[key] !== undefined) {
      options[key] = flags[key];
      delete flags[key];
    }
  }
  const bound = bindPositionals(positionals, def.argv, command, def.help);
  /** @type {Record<string, unknown>} */
  let fields;
  try {
    fields = def.fromArgv ? def.fromArgv(bound, flags) : genericFromArgv(bound, flags, def);
  } catch (error) {
    throw new CliError(`${command}: ${error instanceof Error ? error.message : String(error)} — usage: bi ${def.help}`);
  }
  /** @type {Record<string, unknown> & { do: string }} */
  const step = { do: name, ...fields };
  // `--soft` belongs to the step when the step knows it (verify), to the options otherwise.
  if (options.soft === true && Object.hasOwn(def.config, 'soft')) step.soft = true;
  const errors = validateSteps([step], `bi ${command}`, { mode: 'session' });
  if (errors.length > 0) throw new CliError(`${errors.join('\n')}\nusage: bi ${def.help}`);
  return { name, step, options };
}

/**
 * @param {Record<string, any>} bound
 * @param {Record<string, any>} flags
 * @param {import('./types.js').StepDef} def
 */
function genericFromArgv(bound, flags, def) {
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const [key, value] of Object.entries(bound)) if (Object.hasOwn(def.config, key)) out[key] = value;
  for (const [key, value] of Object.entries(flags)) if (Object.hasOwn(def.config, key)) out[key] = value;
  return out;
}

/**
 * @typedef {{ mode: 'help', command?: string }
 *   | { mode: 'version' }
 *   | { mode: 'up' | 'status' | 'stop' | 'doctor', options: Record<string, never> }
 *   | { mode: 'batch', configPath: string, options: { stamp?: string, only: string[], parallel?: number, fresh: boolean, junit?: string, failOnIncomplete: boolean, noDaemon: boolean } }
 *   | { mode: 'session', command: string, alias: string, step: Record<string, unknown>, options: { session?: string, out?: string, soft: boolean } }
 *   | { mode: 'script', file: string, options: { out?: string, noDaemon: boolean } }
 *   | { mode: 'export', file: string, options: { session?: string, force: boolean } }
 *   | { mode: 'lint-config', configPath: string }} ParsedArgs
 */

/**
 * The parser. `argv` is `process.argv.slice(2)`.
 * @param {readonly string[]} argv
 * @param {Readonly<Record<string, import('./types.js').StepDef>>} [steps]
 * @returns {ParsedArgs}
 */
export function parseArgs(argv, steps = STEPS) {
  const args = [...argv];
  const first = args[0];
  if (first === undefined || first === 'help' || first === '--help' || first === '-h') {
    const command = args[1];
    if (command !== undefined && resolveStepName(command) === undefined && !isBuiltin(command)) {
      const hint = suggest(command, ALL_SPELLINGS);
      throw new CliError(`help: unknown command ${JSON.stringify(command)}${hint ? ` — did you mean "${hint}"?` : ''}`);
    }
    return command === undefined ? { mode: 'help' } : { mode: 'help', command };
  }
  if (first === '--version' || first === 'version' || first === '-v') return { mode: 'version' };
  if (CONTROL_COMMANDS.includes(first)) {
    if (args.length > 1) throw new CliError(`${first} takes no arguments (got ${JSON.stringify(args[1])})`);
    return { mode: /** @type {'up' | 'status' | 'stop' | 'doctor'} */ (first), options: {} };
  }
  if (first === 'script') return parseScript(args.slice(1));
  if (first === 'export') return parseExport(args.slice(1));
  if (first === 'lint-config') {
    const { positionals, flags } = splitFlags(args.slice(1), {}, 'lint-config');
    void flags;
    if (positionals.length !== 1) throw new CliError('lint-config takes exactly one <config.json>');
    return { mode: 'lint-config', configPath: positionals[0] };
  }
  if (looksLikeBatch(args)) return parseBatch(first === 'run' ? args.slice(1) : args);
  const { name, step, options } = parseSessionCommand(first, args.slice(1), steps);
  return {
    mode: 'session',
    command: name,
    alias: first,
    step,
    options: {
      ...(options.session !== undefined ? { session: options.session } : {}),
      ...(options.out !== undefined ? { out: options.out } : {}),
      soft: options.soft === true,
    },
  };
}

/** @param {string} word */
const isBuiltin = (word) => ['script', 'export', 'lint-config', 'run', 'help', ...CONTROL_COMMANDS].includes(word);

/**
 * The first argument ending in `.json` is a batch (the app-factory gate calls `node <pipeline>
 * <config> --stamp X` and must keep working unchanged); `run <config>` is the explicit alias;
 * flags before the config (`--stamp X cfg.json`) are accepted too.
 * @param {readonly string[]} args
 */
function looksLikeBatch(args) {
  const first = args[0];
  // `run` is also a session step (`bi run --file s.mjs`): only `run <config.json>` is the batch alias.
  if (first === 'run') return args.slice(1).some((a) => !a.startsWith('-') && a.endsWith('.json'));
  if (first.endsWith('.json')) return true;
  return first.startsWith('--') && args.some((a) => !a.startsWith('-') && a.endsWith('.json'));
}

/** @param {readonly string[]} args @returns {ParsedArgs} */
function parseBatch(args) {
  const { positionals, flags } = splitFlags(args, BATCH_FLAGS, 'batch (bi <config.json>)');
  if (positionals.length !== 1 || !positionals[0].endsWith('.json')) {
    throw new CliError(
      `batch takes exactly one <config.json>${positionals.length > 1 ? ` (got ${positionals.map((p) => JSON.stringify(p)).join(', ')})` : ''}`,
    );
  }
  if (flags.stamp !== undefined && !STAMP_PATTERN.test(flags.stamp)) {
    throw new CliError(`invalid stamp ${JSON.stringify(flags.stamp)} — expected YYYY-MM-DD_HH-MM`);
  }
  if (flags.parallel !== undefined && flags.parallel < 1) throw new CliError('--parallel expects N ≥ 1');
  return {
    mode: 'batch',
    configPath: positionals[0],
    options: {
      ...(flags.stamp !== undefined ? { stamp: flags.stamp } : {}),
      only: flags.only ?? [],
      ...(flags.parallel !== undefined ? { parallel: flags.parallel } : {}),
      fresh: flags.fresh === true,
      ...(flags.junit !== undefined ? { junit: flags.junit } : {}),
      failOnIncomplete: flags['fail-on-incomplete'] === true,
      noDaemon: flags['no-daemon'] === true,
    },
  };
}

/** @param {readonly string[]} args @returns {ParsedArgs} */
function parseScript(args) {
  const { positionals, flags } = splitFlags(args, SCRIPT_FLAGS, 'script');
  if (positionals.length !== 1) throw new CliError('script takes exactly one <file> with one session command per line');
  return {
    mode: 'script',
    file: positionals[0],
    options: { ...(flags.out !== undefined ? { out: flags.out } : {}), noDaemon: flags['no-daemon'] === true },
  };
}

/** @param {readonly string[]} args @returns {ParsedArgs} */
function parseExport(args) {
  const { positionals, flags } = splitFlags(args, EXPORT_FLAGS, 'export');
  if (positionals.length !== 1 || !positionals[0].endsWith('.json')) {
    throw new CliError('export takes exactly one <flow.json> to write');
  }
  return {
    mode: 'export',
    file: positionals[0],
    options: { ...(flags.session !== undefined ? { session: flags.session } : {}), force: flags.force === true },
  };
}

/**
 * `bi help` — the whole grammar on one screen; `bi help <command>` — one row of the table.
 * @param {string} [command]
 * @returns {string}
 */
export function usage(command) {
  if (command !== undefined) {
    const specific = helpFor(command);
    if (specific !== undefined) return specific;
  }
  const session = stepNames({ session: true });
  const byKind = (/** @type {string} */ kind) => session.filter((n) => STEPS[n].kind === kind);
  const spell = (/** @type {string} */ n) => [n, ...STEPS[n].aliases].join('|');
  return [
    'bi <config.json> [--stamp YYYY-MM-DD_HH-MM] [--only name]… [--parallel N] [--fresh] [--junit f.xml] [--fail-on-incomplete] [--no-daemon]',
    'bi <command> [args] [--session NAME] [--out DIR] [--soft]        (session — needs the keeper; exit 1 = FAIL)',
    'bi script <file> [--out DIR] [--no-daemon]                        (session commands, one per line, one process)',
    'bi up | status | stop | doctor | help [command] | export <flow.json> [--session NAME] [--force] | lint-config <config.json>',
    '',
    `actions:  ${byKind('action').map(spell).join(' ')}`,
    `queries:  ${byKind('query').map(spell).join(' ')}`,
    `control:  ${byKind('control').map(spell).join(' ')}`,
    '',
    'bi help <command> shows the arguments; docs/STEPS.md lists the config fields of every step.',
  ].join('\n');
}
