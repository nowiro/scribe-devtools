// verbs.schema.mjs — the table. What each command takes, what it prints, what it writes.
//
// Declarative and separate from the implementations in `verbs.run.mjs`, with a test asserting the
// two key sets are equal AND in the same order. That pairing is the one from browser-inspector
// (`steps.schema.mjs` ↔ `steps.run.mjs`), and it exists because the failure it prevents is silent:
// a verb documented in the table and missing from the runner would print help for a command that
// does nothing.
//
// `writes` is part of the contract, not a comment: every verb that can produce more than a line
// says where the rest went, and `projects <nazwa>` is the deliberate exception — its answer fits on
// the line, so writing a file would cost the agent a read for nothing.

/**
 * @typedef {object} Verb
 * @property {string} name
 * @property {string} args as they appear in help
 * @property {readonly string[]} flags accepted beyond the global ones
 * @property {string} summary one line, shown in `help`
 * @property {string} writes the `.ws/` path shape, '' when the verb writes nothing
 * @property {boolean} needsGraph whether the verb reads the project graph (and so reports freshness)
 */

/** Flags every verb accepts. */
export const GLOBAL_FLAGS = Object.freeze(['--root', '--out', '--fresh']);

/** @type {readonly Verb[]} */
export const VERBS = Object.freeze([
  {
    name: 'env',
    args: '',
    flags: [],
    summary: 'wersje, świeżość grafu, lista plików inferujących targety',
    writes: '.ws/env.md',
    needsGraph: true,
  },
  {
    name: 'projects',
    args: '[nazwa|glob]',
    flags: [],
    summary: 'wszystkie projekty do pliku; z argumentem — jeden projekt w jednej linii, bez pliku',
    writes: '.ws/projects.md',
    needsGraph: true,
  },
  {
    name: 'graph',
    args: '<projekt>',
    flags: ['--reverse'],
    summary: 'zależności projektu; --reverse odwraca kierunek',
    writes: '.ws/graph-<projekt>.md',
    needsGraph: true,
  },
  {
    name: 'affected',
    args: '',
    flags: ['--base'],
    summary: 'projekty dotknięte zmianami wobec bazy, z domknięciem zależnych',
    writes: '.ws/affected.md',
    needsGraph: true,
  },
  {
    name: 'gen',
    args: '[wzorzec|kolekcja:generator]',
    flags: [],
    summary: 'zainstalowane generatory; z pełną nazwą — opcje jednego generatora',
    writes: '.ws/gen.md',
    needsGraph: false,
  },
  {
    name: 'guide',
    args: '',
    flags: [],
    summary: 'gdzie leżą zasady dla tego workspace i ile kosztuje ich przeczytanie',
    writes: '.ws/guide.md',
    needsGraph: false,
  },
  {
    name: 'run',
    args: '<projekt>:<target>',
    flags: [],
    summary: 'uruchamia target; pełny log bez ANSI na dysk, na linii liczba błędów i pierwszy z nich',
    writes: '.ws/run/<projekt>-<target>.log',
    needsGraph: false,
  },
]);

/** @type {readonly string[]} */
export const VERB_NAMES = Object.freeze(VERBS.map((verb) => verb.name));

/** @param {string} name @returns {Verb | undefined} */
export function findVerb(name) {
  return VERBS.find((verb) => verb.name === name);
}

/**
 * The help text: the whole table when no verb is named, one entry when there is.
 * @param {string} [name]
 * @returns {string}
 */
export function usage(name) {
  const verb = name === undefined ? undefined : findVerb(name);
  if (name !== undefined && verb === undefined) return `nieznana komenda: ${name}\n\n${usage()}`;
  const rows = (verb ? [verb] : VERBS).map((entry) => {
    const invocation = `nx-angular-inspector ${entry.name}${entry.args === '' ? '' : ` ${entry.args}`}`;
    const flags = entry.flags.length === 0 ? '' : ` [${entry.flags.join('] [')}]`;
    const writes = entry.writes === '' ? 'nie zapisuje pliku — linia jest odpowiedzią' : `zapisuje ${entry.writes}`;
    return `  ${invocation}${flags}\n      ${entry.summary}\n      ${writes}`;
  });
  return [
    'nx-angular-inspector — graf Nx i zainstalowane pakiety Angulara, bez serwera MCP.',
    'Wspierane tylko nx >= 23 i angular >= 22.',
    '',
    ...rows,
    '',
    `  flagi globalne: ${GLOBAL_FLAGS.join(' ')}`,
    '  --fresh liczy graf przez `nx graph` zamiast czytać cache',
    '',
  ].join('\n');
}
