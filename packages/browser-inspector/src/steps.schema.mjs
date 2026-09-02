// steps.schema.mjs — the ONE step table, client side (DESIGN.md §3.2, §4, §7).
//
// Every step `browser-inspector` knows is a row here: how it is spelled in a config (`config`), how it is typed in
// a session (`argv`, `flags`, `fromArgv`), how it is validated (`validate` on top of the field types),
// how it is described in a report and a journal (`describe` — never a fill VALUE, only its origin)
// and how `browser-inspector help <step>` and docs/STEPS.md explain it (`help`). `src/steps.run.mjs` holds the
// twin table `RUNNERS` with the same keys — the engine imports that one, the client only this one,
// and a test keeps the key sets equal.
//
// No zod: the field types are a five-word mini-language (`FIELD_TYPES`) checked by `checkField`,
// which is all a config format with forty flat shapes needs — and it renders itself into docs.

/** @typedef {import('./types.js').Step} Step */
/** @typedef {import('./types.js').StepDef} StepDef */
/** @typedef {import('./types.js').ValidateContext} ValidateContext */

/** `e12`, `f3e7` — a ref from the last full aria snapshot; the `f<seq>` prefix names the frame. */
export const REF_PATTERN = /^(?:f\d+)?e\d+$/u;
/** @param {unknown} value @returns {value is string} */
export const isRef = (value) => typeof value === 'string' && REF_PATTERN.test(value);

/** Artifact and snapshot names become file basenames and report keys — one alphabet for all. */
export const ARTIFACT_NAME = /^[a-z0-9][a-z0-9-]*$/u;

/** Session spelling of click modifiers → Playwright's. */
export const MODIFIERS = Object.freeze({ ctrl: 'Control', shift: 'Shift', alt: 'Alt', meta: 'Meta' });

export const WAIT_UNTIL = Object.freeze(['load', 'domcontentloaded', 'networkidle', 'settled']);

/**
 * The field type mini-language. A trailing `?` makes a field optional. Rendered into docs/STEPS.md.
 * @type {Readonly<Record<string, string>>}
 */
export const FIELD_TYPES = Object.freeze({
  string: 'non-empty string',
  text: 'string (may be empty)',
  int: 'integer',
  number: 'number',
  bool: 'true | false (flag without a value in a session)',
  list: 'array of strings (comma-separated in a session)',
  'enum:a,b': 'one of the listed words',
  ref: 'aria ref `eN` / `f<seq>eN` from the last snapshot',
  target: 'ref or Playwright selector',
  url: 'absolute URL',
  name: 'artifact name `[a-z0-9][a-z0-9-]*`',
  object: 'JSON object',
  array: 'JSON array',
  any: 'anything',
});

/**
 * @param {string} type
 * @returns {{ base: string, optional: boolean, values?: string[] }}
 */
export function parseFieldType(type) {
  const optional = type.endsWith('?');
  const base = optional ? type.slice(0, -1) : type;
  if (base.startsWith('enum:')) return { base: 'enum', optional, values: base.slice(5).split(',') };
  return { base, optional };
}

/**
 * Check one value against a field type. Returns the error message (prefixed with `path`) or
 * `undefined`. Session values arrive as strings already coerced by the CLI parser, config values raw.
 * @param {unknown} value
 * @param {string} type
 * @param {string} path
 * @returns {string | undefined}
 */
export function checkField(value, type, path) {
  const spec = parseFieldType(type);
  if (value === undefined) return spec.optional ? undefined : `${path}: required (${spec.base})`;
  const fail = (/** @type {string} */ expected) => `${path}: expected ${expected}, got ${JSON.stringify(value)}`;
  switch (spec.base) {
    case 'string':
      return typeof value === 'string' && value.length > 0 ? undefined : fail('a non-empty string');
    case 'text':
      return typeof value === 'string' ? undefined : fail('a string');
    case 'int':
      return Number.isInteger(value) ? undefined : fail('an integer');
    case 'number':
      return typeof value === 'number' && Number.isFinite(value) ? undefined : fail('a number');
    case 'bool':
      return typeof value === 'boolean' ? undefined : fail('true or false');
    case 'list':
      return Array.isArray(value) && value.every((v) => typeof v === 'string')
        ? undefined
        : fail('an array of strings');
    case 'enum':
      return typeof value === 'string' && (spec.values ?? []).includes(value)
        ? undefined
        : fail(`one of ${(spec.values ?? []).join(' | ')}`);
    case 'ref':
      return isRef(value) ? undefined : fail('a ref like e12 or f3e7');
    case 'target':
      return typeof value === 'string' && value.length > 0 ? undefined : fail('a ref or a selector');
    case 'url':
      return typeof value === 'string' && URL.canParse(value)
        ? undefined
        : fail('an absolute URL (http://, https://, file://)');
    case 'name':
      return typeof value === 'string' && ARTIFACT_NAME.test(value) && value.length <= 64
        ? undefined
        : fail('a name matching [a-z0-9][a-z0-9-]* (max 64)');
    case 'object':
      return value !== null && typeof value === 'object' && !Array.isArray(value) ? undefined : fail('an object');
    case 'array':
      return Array.isArray(value) ? undefined : fail('an array');
    case 'any':
      return undefined;
    default:
      return `${path}: unknown field type "${type}" in STEPS`;
  }
}

// ── Small helpers shared by the rows ─────────────────────────────────────────

const TARGET = Object.freeze({ selector: 'string?', ref: 'ref?' });

/** @param {Step} s */
const targetOf = (s) => String(s.ref ?? s.selector ?? '');

/** A positional `target` is a ref when it looks like one, a Playwright selector otherwise. */
const fromTarget = (/** @type {string} */ raw) => (isRef(raw) ? { ref: raw } : { selector: raw });

/**
 * @param {Step} s @param {string} where @param {readonly string[]} fields
 * @param {{ atMost?: boolean }} [options] `atMost`: zero is fine too
 */
function needOneOf(s, where, fields, options = {}) {
  const present = fields.filter((field) => s[field] !== undefined);
  if (present.length === 1) return undefined;
  const list = fields.map((field) => `"${field}"`).join(' / ');
  if (present.length === 0) return options.atMost ? undefined : `${where}: needs one of ${list}`;
  return `${where}: exactly one of ${list}, got ${present.map((f) => `"${f}"`).join(' + ')}`;
}

/** @param {Step} s @param {string} where */
const needTarget = (s, where) => needOneOf(s, where, ['selector', 'ref']);

/**
 * `--tail` is a budget: `0` means "no entries" and a negative number means nothing at all. Without
 * this, `--tail -1` fell through to the default and printed EVERYTHING, silently.
 * @param {Step} s @param {string} where
 */
const nonNegativeTail = (s, where) =>
  typeof s.tail === 'number' && s.tail < 0 ? `${where}.tail: must be 0 or more, got ${String(s.tail)}` : undefined;

/**
 * Where a typed value comes from: exactly one of `value` / `valueFromEnv`; in `auth.login.steps`
 * a literal is forbidden outright — a password in a versioned config is the one mistake this
 * repository has refused since day one.
 * @param {Step} s @param {string} where @param {ValidateContext} ctx
 */
function valueSource(s, where, ctx) {
  const error = needOneOf(s, where, ['value', 'valueFromEnv']);
  if (error) return error;
  if (ctx.mode === 'auth' && s.value !== undefined) {
    return `${where}: in auth.login only "valueFromEnv" is allowed, never a literal "value"`;
  }
  return undefined;
}

/** @param {Step} s */
const valueOrigin = (s) => (typeof s.valueFromEnv === 'string' ? `(from env ${s.valueFromEnv})` : '(literal)');

const ENV_REF = /^@\{([^}]*)\}$/u;

/**
 * A typed value in a session: `--env NAME` or `@{NAME}` → `valueFromEnv`, anything else (including
 * `@literal` without braces) is a literal. `@{}` is an error, not a value.
 * @param {string} raw @param {Record<string, any>} flags
 * @returns {{ value: string } | { valueFromEnv: string }}
 */
export function valueArg(raw, flags = {}) {
  if (typeof flags.env === 'string' && flags.env !== '') return { valueFromEnv: flags.env };
  const match = ENV_REF.exec(raw ?? '');
  if (match) {
    if (match[1] === '') throw new Error('empty @{} — name the environment variable: @{APP_PASS}');
    return { valueFromEnv: match[1] };
  }
  return { value: raw };
}

/**
 * Where `<target>=<value>` splits: the first `=` at bracket depth 0 outside quotes. The tool's own
 * `elements.md` / `browser-inspector find` hand the agent `[data-testid=field-name]` selectors, and those carry
 * an `=` of their own — the first `=` of the pair is inside the selector, not after it. `e5=a=b`
 * still splits at the first one (the value keeps the rest). `-1` when there is none.
 * @param {string} pair
 */
export function splitPoint(pair) {
  let depth = 0;
  let quote = '';
  for (let i = 0; i < pair.length; i += 1) {
    const ch = pair[i];
    if (quote) {
      if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '[' || ch === '(') depth += 1;
    else if (ch === ']' || ch === ')') depth = Math.max(0, depth - 1);
    else if (ch === '=' && depth === 0) return i;
  }
  return -1;
}

/** Shell quoting survives into argv on Windows (`e3="Jan"`) — strip one matching pair. */
const unquote = (/** @type {string} */ raw) =>
  raw.length >= 2 && ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'")))
    ? raw.slice(1, -1)
    : raw;

/** @param {string} raw @param {string} what */
function integer(raw, what) {
  const n = Number(raw);
  if (!Number.isInteger(n)) throw new Error(`${what} must be an integer, got ${JSON.stringify(raw)}`);
  return n;
}

/** @param {string} raw @param {string} what */
function numeric(raw, what) {
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`${what} must be a number, got ${JSON.stringify(raw)}`);
  return n;
}

/** @param {string} raw */
function urlArg(raw) {
  // A real scheme is followed by `//` (or is one of the schemeless browser ones); `localhost:4313` is a host.
  if (/^(?:[a-z][a-z0-9+.-]*:[/][/]|about:|data:|blob:|file:|chrome:|javascript:)/iu.test(raw)) return raw;
  // `browser-inspector open localhost:4313/` — a scheme-less host is a typing shortcut, not a mistake.
  return `http://${raw}`;
}

// ── The table ────────────────────────────────────────────────────────────────

/** @type {Readonly<Record<string, StepDef>>} */
export const STEPS = Object.freeze({
  goto: {
    kind: 'action',
    aliases: ['open'],
    batch: true,
    session: true,
    argv: ['url'],
    flags: { wait: 'enum:load,domcontentloaded,networkidle,settled', video: 'bool' },
    config: { url: 'url', waitUntil: 'enum:load,domcontentloaded,networkidle,settled?', video: 'bool?' },
    describe: (s) => `goto ${String(s.url)}`,
    help: 'open <url> [--wait load|settled|networkidle] [--video]',
    fromArgv: ({ url }, flags) => ({
      url: urlArg(url),
      ...(flags.wait ? { waitUntil: flags.wait } : {}),
      ...(flags.video ? { video: true } : {}),
    }),
  },
  back: {
    kind: 'action',
    aliases: [],
    batch: true,
    session: true,
    argv: [],
    flags: {},
    config: {},
    describe: () => 'back',
    help: 'back',
  },
  forward: {
    kind: 'action',
    aliases: [],
    batch: true,
    session: true,
    argv: [],
    flags: {},
    config: {},
    describe: () => 'forward',
    help: 'forward',
  },
  reload: {
    kind: 'action',
    aliases: [],
    batch: true,
    session: true,
    argv: [],
    flags: { wait: 'enum:load,domcontentloaded,networkidle,settled' },
    config: { waitUntil: 'enum:load,domcontentloaded,networkidle,settled?' },
    describe: () => 'reload',
    help: 'reload [--wait load|settled|networkidle]',
    fromArgv: (_, flags) => (flags.wait ? { waitUntil: flags.wait } : {}),
  },
  click: {
    kind: 'action',
    aliases: [],
    batch: true,
    session: true,
    argv: ['target'],
    flags: { double: 'bool', right: 'bool', mod: 'list' },
    config: { ...TARGET, button: 'enum:left,right,middle?', count: 'int?', modifiers: 'list?' },
    validate: (s, where) => {
      const errors = [needTarget(s, where)];
      if (s.count !== undefined && ![1, 2, 3].includes(/** @type {number} */ (s.count))) {
        errors.push(`${where}.count: 1, 2 or 3`);
      }
      for (const mod of /** @type {string[]} */ (s.modifiers ?? [])) {
        if (!(mod in MODIFIERS) && !(/** @type {string[]} */ (Object.values(MODIFIERS)).includes(mod))) {
          errors.push(`${where}.modifiers: "${mod}" is not one of ${Object.keys(MODIFIERS).join(', ')}`);
        }
      }
      return errors.filter((e) => e !== undefined);
    },
    describe: (s) => `click ${targetOf(s)}${s.count === 2 ? ' (double)' : ''}${s.button === 'right' ? ' (right)' : ''}`,
    help: 'click <eN|selector> [--double] [--right] [--mod ctrl,shift]',
    fromArgv: ({ target }, flags) => ({
      ...fromTarget(target),
      ...(flags.double ? { count: 2 } : {}),
      ...(flags.right ? { button: 'right' } : {}),
      ...(flags.mod ? { modifiers: flags.mod } : {}),
    }),
  },
  fill: {
    kind: 'action',
    aliases: [],
    batch: true,
    session: true,
    argv: ['target', 'value?'],
    flags: { enter: 'bool', env: 'string' },
    config: { ...TARGET, value: 'text?', valueFromEnv: 'string?', enter: 'bool?' },
    validate: (s, where, ctx) => [needTarget(s, where), valueSource(s, where, ctx)].filter((e) => e !== undefined),
    describe: (s) => `fill ${targetOf(s)} ${valueOrigin(s)}${s.enter ? ' + Enter' : ''}`,
    help: 'fill <eN|selector> <text|@{ENV}> [--env NAME] [--enter]',
    fromArgv: ({ target, value }, flags) => {
      if (value === undefined && !flags.env)
        throw new Error('fill needs a value: fill e39 Harry | fill e5 @{APP_PASS} | --env APP_PASS');
      return { ...fromTarget(target), ...valueArg(value ?? '', flags), ...(flags.enter ? { enter: true } : {}) };
    },
  },
  type: {
    kind: 'action',
    aliases: [],
    batch: true,
    session: true,
    argv: ['target', 'text?'],
    flags: { slowly: 'bool', env: 'string' },
    config: { ...TARGET, value: 'text?', valueFromEnv: 'string?', slowly: 'bool?' },
    validate: (s, where, ctx) => [needTarget(s, where), valueSource(s, where, ctx)].filter((e) => e !== undefined),
    describe: (s) => `type ${targetOf(s)} ${valueOrigin(s)}${s.slowly ? ' (slowly)' : ''}`,
    help: 'type <eN|selector> <text|@{ENV}> [--env NAME] [--slowly]',
    fromArgv: ({ target, text }, flags) => {
      if (text === undefined && !flags.env) throw new Error('type needs a text: type e39 Harry | --env NAME');
      return { ...fromTarget(target), ...valueArg(text ?? '', flags), ...(flags.slowly ? { slowly: true } : {}) };
    },
  },
  form: {
    kind: 'action',
    aliases: [],
    batch: true,
    session: true,
    argv: ['fields...'],
    flags: {},
    config: { fields: 'array' },
    validate: (s, where, ctx) => {
      const fields = /** @type {any[]} */ (s.fields ?? []);
      if (fields.length === 0) return `${where}.fields: at least one field`;
      const errors = [];
      fields.forEach((field, k) => {
        const at = `${where}.fields[${String(k)}]`;
        if (!field || typeof field !== 'object' || Array.isArray(field)) {
          errors.push(`${at}: expected { selector|ref, value|valueFromEnv }`);
          return;
        }
        for (const key of Object.keys(field)) {
          if (!['selector', 'ref', 'value', 'valueFromEnv'].includes(key)) errors.push(`${at}.${key}: unknown field`);
        }
        errors.push(needTarget(field, at), valueSource(field, at, ctx));
      });
      return errors.filter((e) => e !== undefined);
    },
    describe: (s) => {
      const fields = /** @type {any[]} */ (s.fields ?? []);
      const fromEnv = fields.filter((f) => f && f.valueFromEnv !== undefined).length;
      return `form ${String(fields.length)} field${fields.length === 1 ? '' : 's'}${fromEnv > 0 ? ` (${String(fromEnv)} from env)` : ''}`;
    },
    help: 'form <eN|selector>=<text|@{ENV}> …   e.g. form e3="Jan" e5=@{APP_PASS}',
    fromArgv: ({ fields }) => {
      if (!fields || fields.length === 0)
        throw new Error('form needs at least one field: form e3="Jan" e5=@{APP_PASS}');
      return {
        fields: /** @type {string[]} */ (fields).map((pair) => {
          const eq = splitPoint(pair);
          if (eq <= 0) throw new Error(`form field ${JSON.stringify(pair)} — expected <target>=<value>`);
          return { ...fromTarget(pair.slice(0, eq)), ...valueArg(unquote(pair.slice(eq + 1))) };
        }),
      };
    },
  },
  press: {
    kind: 'action',
    aliases: [],
    batch: true,
    session: true,
    argv: ['key'],
    flags: { el: 'string' },
    config: { key: 'string', ...TARGET },
    validate: (s, where) => needOneOf(s, where, ['selector', 'ref'], { atMost: true }),
    describe: (s) => `press ${String(s.key)}${s.ref || s.selector ? ` @ ${targetOf(s)}` : ''}`,
    help: 'press <key> [--el eN|selector]     e.g. press Enter, press Control+a',
    fromArgv: ({ key }, flags) => ({ key, ...(flags.el ? fromTarget(flags.el) : {}) }),
  },
  hover: {
    kind: 'action',
    aliases: [],
    batch: true,
    session: true,
    argv: ['target'],
    flags: {},
    config: { ...TARGET },
    validate: needTarget,
    describe: (s) => `hover ${targetOf(s)}`,
    help: 'hover <eN|selector>',
    fromArgv: ({ target }) => fromTarget(target),
  },
  select: {
    kind: 'action',
    aliases: [],
    batch: true,
    session: true,
    argv: ['target', 'value'],
    flags: {},
    config: { ...TARGET, value: 'string?', values: 'list?' },
    validate: (s, where) =>
      [needTarget(s, where), needOneOf(s, where, ['value', 'values'])].filter((e) => e !== undefined),
    describe: (s) => `select ${targetOf(s)} = ${String(s.value ?? /** @type {string[]} */ (s.values ?? []).join(','))}`,
    help: 'select <eN|selector> <value[,value…]>',
    fromArgv: ({ target, value }) =>
      value.includes(',') ? { ...fromTarget(target), values: value.split(',') } : { ...fromTarget(target), value },
  },
  check: {
    kind: 'action',
    aliases: [],
    batch: true,
    session: true,
    argv: ['target'],
    flags: {},
    config: { ...TARGET },
    validate: needTarget,
    describe: (s) => `check ${targetOf(s)}`,
    help: 'check <eN|selector>',
    fromArgv: ({ target }) => fromTarget(target),
  },
  uncheck: {
    kind: 'action',
    aliases: [],
    batch: true,
    session: true,
    argv: ['target'],
    flags: {},
    config: { ...TARGET },
    validate: needTarget,
    describe: (s) => `uncheck ${targetOf(s)}`,
    help: 'uncheck <eN|selector>',
    fromArgv: ({ target }) => fromTarget(target),
  },
  drag: {
    kind: 'action',
    aliases: [],
    batch: true,
    session: true,
    argv: ['from', 'to'],
    flags: {},
    config: { from: 'target', to: 'target' },
    describe: (s) => `drag ${String(s.from)} → ${String(s.to)}`,
    help: 'drag <eN|selector> <eN|selector>',
    fromArgv: ({ from, to }) => ({ from, to }),
  },
  upload: {
    kind: 'action',
    aliases: [],
    batch: true,
    session: true,
    argv: ['target', 'files...'],
    flags: {},
    config: { ...TARGET, files: 'list' },
    validate: (s, where) => {
      const errors = [needTarget(s, where)];
      if (Array.isArray(s.files) && s.files.length === 0) errors.push(`${where}.files: at least one path`);
      return errors.filter((e) => e !== undefined);
    },
    describe: (s) => {
      const n = /** @type {string[]} */ (s.files ?? []).length;
      return `upload ${targetOf(s)} (${String(n)} file${n === 1 ? '' : 's'})`;
    },
    help: 'upload <eN|selector> <file> [file…]   (files are read by the client, relative to its cwd)',
    fromArgv: ({ target, files }) => {
      if (!files || files.length === 0) throw new Error('upload needs at least one file');
      return { ...fromTarget(target), files };
    },
  },
  scroll: {
    kind: 'action',
    aliases: [],
    batch: true,
    session: true,
    argv: ['target?'],
    flags: { to: 'enum:top,bottom' },
    config: { ...TARGET, to: 'enum:top,bottom?' },
    validate: (s, where) => needOneOf(s, where, ['selector', 'ref', 'to']),
    describe: (s) => `scroll ${targetOf(s) || String(s.to ?? '')}`,
    help: 'scroll <eN|selector> | scroll --to top|bottom | scroll top|bottom',
    fromArgv: ({ target }, flags) => {
      if (flags.to) return { to: flags.to };
      if (target === 'top' || target === 'bottom') return { to: target };
      if (target === undefined) throw new Error('scroll needs a target or --to top|bottom');
      return fromTarget(target);
    },
  },
  mouse: {
    kind: 'action',
    aliases: [],
    batch: true,
    session: true,
    argv: ['action', 'coords...'],
    flags: { button: 'enum:left,right,middle' },
    config: {
      action: 'enum:click,move,down,up,wheel,drag',
      x: 'number?',
      y: 'number?',
      toX: 'number?',
      toY: 'number?',
      dx: 'number?',
      dy: 'number?',
      button: 'enum:left,right,middle?',
    },
    validate: (s, where) => {
      const need = (/** @type {string[]} */ fields) =>
        fields.filter((f) => s[f] === undefined).map((f) => `${where}.${f}: required for mouse ${String(s.action)}`);
      switch (s.action) {
        case 'click':
        case 'move':
          return need(['x', 'y']);
        case 'drag':
          return need(['x', 'y', 'toX', 'toY']);
        case 'wheel':
          return need(['dy']);
        default:
          return undefined;
      }
    },
    describe: (s) => {
      const at = s.x !== undefined ? ` ${String(s.x)},${String(s.y)}` : '';
      const to = s.toX !== undefined ? ` → ${String(s.toX)},${String(s.toY)}` : '';
      const wheel = s.action === 'wheel' ? ` ${String(s.dy)}` : '';
      return `mouse ${String(s.action)}${at}${to}${wheel}`;
    },
    help: 'mouse click|move <x> <y> | mouse drag <x> <y> <toX> <toY> | mouse wheel <dy> [dx] | mouse down|up [--button right]',
    fromArgv: ({ action, coords }, flags) => {
      const nums = /** @type {string[]} */ (coords ?? []).map((c, i) =>
        numeric(c, `mouse ${action} argument ${String(i + 1)}`),
      );
      /** @type {Record<string, unknown>} */
      const step = { action, ...(flags.button ? { button: flags.button } : {}) };
      if (action === 'click' || action === 'move') [step.x, step.y] = nums;
      else if (action === 'drag') [step.x, step.y, step.toX, step.toY] = nums;
      else if (action === 'wheel') [step.dy, step.dx] = nums;
      return step;
    },
  },
  wait: {
    kind: 'control',
    aliases: [],
    batch: true,
    session: true,
    argv: ['ms?'],
    flags: { ms: 'int', text: 'string', gone: 'string', url: 'string', sel: 'string' },
    config: { ms: 'int?', text: 'string?', textGone: 'string?', url: 'string?', selector: 'string?' },
    validate: (s, where) => {
      const errors = [needOneOf(s, where, ['ms', 'text', 'textGone', 'url', 'selector'])];
      if (typeof s.ms === 'number' && (s.ms < 0 || s.ms > 60_000)) errors.push(`${where}.ms: 0…60000`);
      return errors.filter((e) => e !== undefined);
    },
    describe: (s) => {
      if (s.ms !== undefined) return `wait ${String(s.ms)}ms`;
      if (s.text !== undefined) return `wait text ${JSON.stringify(s.text)}`;
      if (s.textGone !== undefined) return `wait gone ${JSON.stringify(s.textGone)}`;
      if (s.url !== undefined) return `wait url ${String(s.url)}`;
      return `wait ${String(s.selector ?? '')}`;
    },
    help: 'wait --text <t> | --gone <t> | --url <pattern> | --sel <selector> | --ms <n> | wait <ms>',
    fromArgv: ({ ms }, flags) => {
      if (flags.text !== undefined) return { text: flags.text };
      if (flags.gone !== undefined) return { textGone: flags.gone };
      if (flags.url !== undefined) return { url: flags.url };
      if (flags.sel !== undefined) return { selector: flags.sel };
      if (flags.ms !== undefined) return { ms: flags.ms };
      if (ms === undefined) throw new Error('wait needs one of --text, --gone, --url, --sel, --ms (or a number of ms)');
      return { ms: integer(ms, 'wait ms') };
    },
  },
  waitFor: {
    kind: 'control',
    aliases: [],
    batch: true,
    session: true,
    argv: ['target'],
    flags: { state: 'enum:attached,visible,hidden,detached' },
    config: { ...TARGET, state: 'enum:attached,visible,hidden,detached?' },
    validate: needTarget,
    describe: (s) => `waitFor ${targetOf(s)} (${String(s.state ?? 'visible')})`,
    help: 'waitFor <eN|selector> [--state attached|visible|hidden|detached]',
    fromArgv: ({ target }, flags) => ({ ...fromTarget(target), ...(flags.state ? { state: flags.state } : {}) }),
  },
  screenshot: {
    kind: 'query',
    aliases: ['shot'],
    batch: true,
    session: true,
    argv: ['name?'],
    flags: { full: 'bool', el: 'string', jpeg: 'bool', quality: 'int', mark: 'string' },
    config: { name: 'name?', fullPage: 'bool?', ...TARGET, format: 'enum:png,jpeg?', quality: 'int?', mark: 'ref?' },
    validate: (s, where, ctx) => {
      const errors = [needOneOf(s, where, ['selector', 'ref'], { atMost: true })];
      if (ctx.mode === 'batch' && s.name === undefined)
        errors.push(`${where}.name: required in a config (the file basename)`);
      if (s.name === 'final')
        errors.push(`${where}.name: "final" is reserved for the automatic end-of-flow screenshot`);
      if (typeof s.quality === 'number' && (s.quality < 0 || s.quality > 100)) errors.push(`${where}.quality: 0…100`);
      if (s.quality !== undefined && s.format !== 'jpeg') errors.push(`${where}.quality: only with format "jpeg"`);
      return errors.filter((e) => e !== undefined);
    },
    describe: (s) => `screenshot ${String(s.name ?? '')}${s.fullPage ? ' (full)' : ''}`.trimEnd(),
    help: 'shot [name] [--full] [--el eN|selector] [--jpeg [--quality 80]] [--mark eN]',
    fromArgv: ({ name }, flags) => ({
      ...(name !== undefined ? { name } : {}),
      ...(flags.full ? { fullPage: true } : {}),
      ...(flags.el ? fromTarget(flags.el) : {}),
      ...(flags.jpeg ? { format: 'jpeg' } : {}),
      ...(flags.quality !== undefined ? { quality: flags.quality, format: 'jpeg' } : {}),
      ...(flags.mark ? { mark: flags.mark } : {}),
    }),
  },
  pdf: {
    kind: 'query',
    aliases: [],
    batch: true,
    session: true,
    argv: ['name?'],
    flags: {},
    config: { name: 'name?' },
    validate: (s, where, ctx) =>
      ctx.mode === 'batch' && s.name === undefined
        ? `${where}.name: required in a config (the file basename)`
        : undefined,
    describe: (s) => `pdf ${String(s.name ?? '')}`.trimEnd(),
    help: 'pdf [name]',
    fromArgv: ({ name }) => (name !== undefined ? { name } : {}),
  },
  extract: {
    kind: 'query',
    aliases: ['get'],
    batch: true,
    session: true,
    argv: ['target'],
    flags: { value: 'bool', name: 'string' },
    config: { name: 'name?', ...TARGET, value: 'bool?' },
    validate: (s, where, ctx) => {
      const errors = [needTarget(s, where)];
      if (ctx.mode === 'batch' && s.name === undefined)
        errors.push(`${where}.name: required in a config (the report key)`);
      return errors.filter((e) => e !== undefined);
    },
    describe: (s) => (s.name !== undefined ? `extract ${String(s.name)} ← ${targetOf(s)}` : `extract ${targetOf(s)}`),
    help: 'get <eN|selector> [--value] [--name key]',
    fromArgv: ({ target }, flags) => ({
      ...fromTarget(target),
      ...(flags.value ? { value: true } : {}),
      ...(flags.name ? { name: flags.name } : {}),
    }),
  },
  evaluate: {
    kind: 'query',
    aliases: ['eval'],
    batch: true,
    session: true,
    argv: ['expression...'],
    flags: { file: 'string', el: 'string', timeout: 'int', name: 'string' },
    config: { name: 'name?', expression: 'string?', file: 'string?', ...TARGET, timeout: 'int?' },
    validate: (s, where, ctx) => {
      const errors = [needOneOf(s, where, ['selector', 'ref'], { atMost: true })];
      if (ctx.mode === 'batch') {
        if (s.name === undefined) errors.push(`${where}.name: required in a config (the report key)`);
        if (s.expression === undefined) errors.push(`${where}.expression: required in a config`);
        if (s.file !== undefined)
          errors.push(`${where}.file: only in a session (eval --file) — a config carries the expression`);
      } else {
        errors.push(needOneOf(s, where, ['expression', 'file']));
      }
      if (typeof s.expression === 'string' && s.expression.length > 2000)
        errors.push(`${where}.expression: max 2000 chars`);
      return errors.filter((e) => e !== undefined);
    },
    // The expression stays in the config / journal; the report line stays one line.
    describe: (s) =>
      s.name !== undefined ? `evaluate ${String(s.name)}` : `eval${s.file ? ` --file ${String(s.file)}` : ''}`,
    help: 'eval <expression…> | eval --file s.js [--el eN] [--timeout ms] [--name key]',
    fromArgv: ({ expression }, flags) => {
      const text = /** @type {string[]} */ (expression ?? []).join(' ');
      if (text === '' && !flags.file) throw new Error('eval needs an expression or --file');
      return {
        ...(text !== '' ? { expression: text } : {}),
        ...(flags.file ? { file: flags.file } : {}),
        ...(flags.el ? fromTarget(flags.el) : {}),
        ...(flags.timeout !== undefined ? { timeout: flags.timeout } : {}),
        ...(flags.name ? { name: flags.name } : {}),
      };
    },
  },
  snapshot: {
    kind: 'query',
    aliases: ['snap'],
    batch: true,
    session: true,
    argv: [],
    flags: { max: 'int', diff: 'bool', around: 'string', grep: 'string', names: 'bool', all: 'bool' },
    config: {
      name: 'name?',
      max: 'int?',
      diff: 'bool?',
      around: 'ref?',
      grep: 'string?',
      names: 'bool?',
      all: 'bool?',
    },
    describe: (s) => `snapshot ${String(s.name ?? '')}`.trimEnd(),
    help: 'snap [--max 25] [--diff] [--around eN] [--grep text] [--names] [--all]',
    fromArgv: (_, flags) => ({
      ...(flags.max !== undefined ? { max: flags.max } : {}),
      ...(flags.diff ? { diff: true } : {}),
      ...(flags.around ? { around: flags.around } : {}),
      ...(flags.grep ? { grep: flags.grep } : {}),
      ...(flags.names ? { names: true } : {}),
      ...(flags.all ? { all: true } : {}),
    }),
  },
  find: {
    kind: 'query',
    aliases: [],
    batch: false,
    session: true,
    argv: ['text...'],
    flags: { names: 'bool' },
    config: { text: 'string', names: 'bool?' },
    describe: (s) => `find ${JSON.stringify(s.text)}`,
    help: 'find <text…> [--names]',
    fromArgv: ({ text }, flags) => {
      const joined = /** @type {string[]} */ (text ?? []).join(' ');
      if (joined === '') throw new Error('find needs a text to look for');
      return { text: joined, ...(flags.names ? { names: true } : {}) };
    },
  },
  verify: {
    kind: 'query',
    aliases: [],
    batch: true,
    session: true,
    argv: ['kind', 'args...'],
    flags: { soft: 'bool' },
    config: {
      kind: 'enum:visible,hidden,text,value,list,url,title,count',
      ...TARGET,
      text: 'string?',
      value: 'text?',
      items: 'list?',
      url: 'string?',
      title: 'string?',
      count: 'int?',
      soft: 'bool?',
    },
    validate: (s, where) => {
      const need = (/** @type {string} */ field) =>
        s[field] === undefined ? `${where}.${field}: required for kind "${String(s.kind)}"` : undefined;
      switch (s.kind) {
        case 'visible':
        case 'hidden':
          return needTarget(s, where);
        case 'text':
          return [needTarget(s, where), need('text')].filter((e) => e !== undefined);
        case 'value':
          return [needTarget(s, where), need('value')].filter((e) => e !== undefined);
        case 'list':
          return [needTarget(s, where), need('items')].filter((e) => e !== undefined);
        case 'count':
          return [needTarget(s, where), need('count')].filter((e) => e !== undefined);
        case 'url':
          return need('url');
        case 'title':
          return need('title');
        default:
          return undefined;
      }
    },
    describe: (s) =>
      `verify ${String(s.kind)} ${targetOf(s) || String(s.url ?? s.title ?? '')}${s.soft ? ' (soft)' : ''}`.trim(),
    help: 'verify visible|hidden|text|value|count|list <eN|selector> [expected…] | verify url <pattern> | verify title <text>  [--soft]',
    fromArgv: ({ kind, args }, flags) => {
      const rest = /** @type {string[]} */ (args ?? []);
      const soft = flags.soft ? { soft: true } : {};
      const needArgs = (/** @type {number} */ n, /** @type {string} */ usage) => {
        if (rest.length < n) throw new Error(`verify ${kind}: ${usage}`);
      };
      switch (kind) {
        case 'visible':
        case 'hidden':
          needArgs(1, 'needs a target');
          return { kind, ...fromTarget(rest[0]), ...soft };
        case 'text':
          needArgs(2, 'needs <target> <text>');
          return { kind, ...fromTarget(rest[0]), text: rest.slice(1).join(' '), ...soft };
        case 'value':
          needArgs(1, 'needs <target> [value]');
          return { kind, ...fromTarget(rest[0]), value: rest.slice(1).join(' '), ...soft };
        case 'list':
          needArgs(2, 'needs <target> <item> [item…]');
          return { kind, ...fromTarget(rest[0]), items: rest.slice(1), ...soft };
        case 'count':
          needArgs(2, 'needs <target> <n>');
          return { kind, ...fromTarget(rest[0]), count: integer(rest[1], 'verify count'), ...soft };
        case 'url':
          needArgs(1, 'needs a URL pattern');
          return { kind, url: rest[0], ...soft };
        case 'title':
          needArgs(1, 'needs a title');
          return { kind, title: rest.join(' '), ...soft };
        default:
          throw new Error(`verify: unknown kind "${String(kind)}" — visible|hidden|text|value|list|url|title|count`);
      }
    },
  },
  resize: {
    kind: 'control',
    aliases: [],
    batch: true,
    session: true,
    argv: ['size'],
    flags: {},
    config: { width: 'int', height: 'int' },
    validate: (s, where) => {
      const errors = [];
      for (const key of ['width', 'height']) {
        const v = /** @type {number} */ (s[key]);
        if (typeof v === 'number' && (v < 200 || v > 4000)) errors.push(`${where}.${key}: 200…4000`);
      }
      return errors;
    },
    describe: (s) => `resize ${String(s.width)}x${String(s.height)}`,
    help: 'resize <width>x<height>     e.g. resize 1280x720',
    fromArgv: ({ size }) => {
      const match = /^(\d+)x(\d+)$/u.exec(size ?? '');
      if (!match) throw new Error(`resize expects <width>x<height>, got ${JSON.stringify(size)}`);
      return { width: Number(match[1]), height: Number(match[2]) };
    },
  },
  route: {
    kind: 'control',
    aliases: [],
    batch: true,
    session: true,
    argv: ['pattern'],
    flags: { block: 'bool', status: 'int', body: 'text', file: 'string', delay: 'int', 'content-type': 'string' },
    config: {
      url: 'string',
      block: 'bool?',
      status: 'int?',
      body: 'text?',
      file: 'string?',
      delay: 'int?',
      contentType: 'string?',
    },
    validate: (s, where) => {
      const effect = ['block', 'status', 'body', 'file', 'delay'].some((f) => s[f] !== undefined);
      const errors = effect ? [] : [`${where}: a route needs an effect — block, status, body, file or delay`];
      if (s.body !== undefined && s.file !== undefined) errors.push(`${where}: "body" and "file" exclude each other`);
      return errors;
    },
    describe: (s) => {
      const effect = s.block
        ? 'block'
        : s.file !== undefined
          ? `file ${String(s.file)}`
          : s.status !== undefined
            ? `status ${String(s.status)}`
            : s.body !== undefined
              ? 'body'
              : `delay ${String(s.delay)}ms`;
      return `route ${String(s.url)} → ${effect}`;
    },
    help: 'route <pattern> --block | --status 500 [--body \'{"e":1}\'] | --file resp.json | --delay 300 [--content-type t]',
    fromArgv: ({ pattern }, flags) => ({
      url: pattern,
      ...(flags.block ? { block: true } : {}),
      ...(flags.status !== undefined ? { status: flags.status } : {}),
      ...(flags.body !== undefined ? { body: flags.body } : {}),
      ...(flags.file ? { file: flags.file } : {}),
      ...(flags.delay !== undefined ? { delay: flags.delay } : {}),
      ...(flags['content-type'] ? { contentType: flags['content-type'] } : {}),
    }),
  },
  unroute: {
    kind: 'control',
    aliases: [],
    batch: true,
    session: true,
    argv: ['pattern?'],
    flags: {},
    config: { url: 'string?' },
    describe: (s) => `unroute ${String(s.url ?? '(all)')}`,
    help: 'unroute [pattern]',
    fromArgv: ({ pattern }) => (pattern !== undefined ? { url: pattern } : {}),
  },
  routes: {
    kind: 'query',
    aliases: [],
    batch: false,
    session: true,
    argv: [],
    flags: {},
    config: {},
    describe: () => 'routes',
    help: 'routes',
  },
  offline: {
    kind: 'control',
    aliases: [],
    batch: true,
    session: true,
    argv: ['state'],
    flags: {},
    config: { on: 'bool' },
    describe: (s) => `offline ${s.on ? 'on' : 'off'}`,
    help: 'offline on|off',
    fromArgv: ({ state }) => {
      if (state !== 'on' && state !== 'off') throw new Error(`offline expects on|off, got ${JSON.stringify(state)}`);
      return { on: state === 'on' };
    },
  },
  fetch: {
    kind: 'query',
    aliases: [],
    batch: true,
    session: true,
    argv: ['url'],
    flags: { method: 'string', body: 'text', header: 'list', name: 'string' },
    config: { url: 'string', method: 'string?', body: 'text?', headers: 'object?', name: 'name?' },
    describe: (s) => `fetch ${String(s.method ?? 'GET').toUpperCase()} ${String(s.url)}`,
    help: 'fetch <url> [--method POST] [--body data] [--header k:v,k2:v2] [--name key]',
    fromArgv: ({ url }, flags) => {
      /** @type {Record<string, string>} */
      const headers = {};
      for (const pair of /** @type {string[]} */ (flags.header ?? [])) {
        const colon = pair.indexOf(':');
        if (colon <= 0) throw new Error(`--header expects name:value, got ${JSON.stringify(pair)}`);
        headers[pair.slice(0, colon).trim()] = pair.slice(colon + 1).trim();
      }
      return {
        url,
        ...(flags.method ? { method: flags.method } : {}),
        ...(flags.body !== undefined ? { body: flags.body } : {}),
        ...(Object.keys(headers).length > 0 ? { headers } : {}),
        ...(flags.name ? { name: flags.name } : {}),
      };
    },
  },
  dialog: {
    kind: 'control',
    aliases: [],
    batch: true,
    session: true,
    argv: ['policy?'],
    flags: { text: 'string', once: 'bool' },
    config: { action: 'enum:accept,dismiss?', text: 'string?', once: 'bool?' },
    validate: (s, where, ctx) =>
      ctx.mode === 'batch' && s.action === undefined ? `${where}.action: "accept" or "dismiss"` : undefined,
    describe: (s) => (s.action ? `dialog ${String(s.action)}${s.once ? ' (once)' : ''}` : 'dialog'),
    help: 'dialog accept|dismiss [--text "prompt answer"] [--once]   |   dialog   (show policy + last dialog)',
    fromArgv: ({ policy }, flags) => {
      if (policy !== undefined && policy !== 'accept' && policy !== 'dismiss') {
        throw new Error(`dialog expects accept|dismiss, got ${JSON.stringify(policy)}`);
      }
      return {
        ...(policy !== undefined ? { action: policy } : {}),
        ...(flags.text !== undefined ? { text: flags.text } : {}),
        ...(flags.once ? { once: true } : {}),
      };
    },
  },
  tab: {
    kind: 'control',
    aliases: [],
    batch: true,
    session: true,
    argv: ['action', 'url?'],
    flags: {},
    config: { action: 'enum:new,select,close', index: 'int?', url: 'url?' },
    validate: (s, where) =>
      s.action === 'select' && s.index === undefined ? `${where}.index: required for tab select` : undefined,
    describe: (s) =>
      `tab ${String(s.action)}${s.index !== undefined ? ` ${String(s.index)}` : ''}${s.url ? ` ${String(s.url)}` : ''}`,
    help: 'tab new [url] | tab <n> | tab close',
    fromArgv: ({ action, url }) => {
      if (action === 'new') return { action: 'new', ...(url !== undefined ? { url: urlArg(url) } : {}) };
      if (action === 'close') return { action: 'close' };
      if (/^\d+$/u.test(action ?? '')) return { action: 'select', index: Number(action) };
      throw new Error(`tab expects new [url] | <n> | close, got ${JSON.stringify(action)}`);
    },
  },
  tabs: {
    kind: 'query',
    aliases: [],
    batch: false,
    session: true,
    argv: [],
    flags: {},
    config: {},
    describe: () => 'tabs',
    help: 'tabs',
  },
  frame: {
    kind: 'control',
    aliases: [],
    batch: true,
    session: true,
    argv: ['target'],
    flags: {},
    config: { frame: 'string' },
    describe: (s) => `frame ${String(s.frame)}`,
    help: 'frame main | frame <n> | frame <selector>    (scope for CSS selectors, eval, extract — refs need no frame)',
    fromArgv: ({ target }) => ({ frame: target }),
  },
  storage: {
    kind: 'query',
    aliases: [],
    batch: true,
    session: true,
    argv: ['kind', 'op', 'key?', 'value?'],
    flags: { env: 'string', name: 'string' },
    config: {
      kind: 'enum:cookies,local,session',
      op: 'enum:list,get,set,del,clear',
      key: 'string?',
      value: 'text?',
      valueFromEnv: 'string?',
      name: 'name?',
    },
    validate: (s, where, ctx) => {
      const errors = [];
      if ((s.op === 'get' || s.op === 'del' || s.op === 'set') && s.key === undefined) {
        errors.push(`${where}.key: required for storage ${String(s.op)}`);
      }
      if (s.op === 'set') errors.push(valueSource(s, where, ctx));
      else if (s.value !== undefined || s.valueFromEnv !== undefined)
        errors.push(`${where}: a value only with op "set"`);
      return errors.filter((e) => e !== undefined);
    },
    describe: (s) =>
      `storage ${String(s.kind)} ${String(s.op)}${s.key !== undefined ? ` ${String(s.key)}` : ''}${s.op === 'set' ? ` ${valueOrigin(s)}` : ''}`,
    help: 'storage cookies|local|session list|get|set|del|clear [key] [value|@{ENV}] [--env NAME] [--name key]',
    fromArgv: ({ kind, op, key, value }, flags) => ({
      kind,
      op,
      ...(key !== undefined ? { key } : {}),
      ...(op === 'set' ? valueArg(value ?? '', flags) : {}),
      ...(flags.name ? { name: flags.name } : {}),
    }),
  },
  state: {
    kind: 'control',
    aliases: [],
    batch: true,
    session: true,
    argv: ['op', 'file'],
    flags: {},
    config: { op: 'enum:save,load', file: 'string' },
    describe: (s) => `state ${String(s.op)} ${String(s.file)}`,
    help: 'state save|load <file.json>',
    fromArgv: ({ op, file }) => ({ op, file }),
  },
  console: {
    kind: 'query',
    aliases: [],
    batch: false,
    session: true,
    argv: [],
    flags: { level: 'enum:info,warn,error', errors: 'bool', all: 'bool', tail: 'int' },
    config: { level: 'enum:info,warn,error?', all: 'bool?', tail: 'int?' },
    validate: (s, where) => nonNegativeTail(s, where),
    describe: (s) => `console${s.level ? ` --level ${String(s.level)}` : ''}`,
    help: 'console [--level info|warn|error] [--errors] [--all] [--tail N]',
    fromArgv: (_, flags) => ({
      ...(flags.errors ? { level: 'error' } : flags.level ? { level: flags.level } : {}),
      ...(flags.all ? { all: true } : {}),
      ...(flags.tail !== undefined ? { tail: flags.tail } : {}),
    }),
  },
  net: {
    kind: 'query',
    aliases: [],
    batch: false,
    session: true,
    argv: ['n?'],
    flags: { failed: 'bool', all: 'bool', tail: 'int', body: 'bool', req: 'bool' },
    config: { n: 'int?', failed: 'bool?', all: 'bool?', tail: 'int?', body: 'bool?', req: 'bool?' },
    validate: (s, where) => nonNegativeTail(s, where),
    describe: (s) => `net${s.n !== undefined ? ` ${String(s.n)}` : ''}${s.failed ? ' --failed' : ''}`,
    help: 'net [--failed] [--all] [--tail N] | net <n> [--body] [--req]',
    fromArgv: ({ n }, flags) => ({
      ...(n !== undefined ? { n: integer(n, 'net <n>') } : {}),
      ...(flags.failed ? { failed: true } : {}),
      ...(flags.all ? { all: true } : {}),
      ...(flags.tail !== undefined ? { tail: flags.tail } : {}),
      ...(flags.body ? { body: true } : {}),
      ...(flags.req ? { req: true } : {}),
    }),
  },
  trace: {
    kind: 'control',
    aliases: [],
    batch: false,
    session: true,
    argv: ['action', 'file?'],
    flags: {},
    config: { action: 'enum:start,stop', file: 'string?' },
    describe: (s) => `trace ${String(s.action)}${s.file ? ` ${String(s.file)}` : ''}`,
    help: 'trace start | trace stop [file.zip]     (batch: "trace": true on the snapshot)',
    fromArgv: ({ action, file }) => ({ action, ...(file !== undefined ? { file } : {}) }),
  },
  video: {
    kind: 'control',
    aliases: [],
    batch: false,
    session: true,
    argv: ['action'],
    flags: {},
    config: { action: 'enum:start,stop' },
    describe: (s) => `video ${String(s.action)}`,
    help: 'video start|stop     (start = fresh context; batch: "video": true on the snapshot)',
    fromArgv: ({ action }) => ({ action }),
  },
  locator: {
    kind: 'query',
    aliases: [],
    batch: false,
    session: true,
    argv: ['ref'],
    flags: {},
    config: { ref: 'ref' },
    describe: (s) => `locator ${String(s.ref)}`,
    help: 'locator <eN>     (durable selector: data-testid → #id → [name] → role=)',
    fromArgv: ({ ref }) => ({ ref }),
  },
  run: {
    kind: 'control',
    aliases: [],
    batch: false,
    session: true,
    argv: ['file?'],
    flags: { file: 'string' },
    config: { file: 'string' },
    describe: (s) => `run --file ${String(s.file)}`,
    help: 'run --file script.mjs     (BROWSER_INSPECTOR_UNSAFE=1 only — runs code in the keeper, RCE-equivalent)',
    fromArgv: ({ file }, flags) => {
      const chosen = flags.file ?? file;
      if (!chosen) throw new Error('run needs --file <script.mjs> (and BROWSER_INSPECTOR_UNSAFE=1)');
      return { file: chosen };
    },
  },
  close: {
    kind: 'control',
    aliases: [],
    batch: false,
    session: true,
    argv: [],
    flags: {},
    config: {},
    describe: () => 'close',
    help: 'close     (ends the session; the keeper stays)',
  },
});

/** Canonical names in table order. */
export const STEP_NAMES = Object.freeze(Object.keys(STEPS));

/** alias → canonical name (`open` → `goto`, `shot` → `screenshot`, …). */
const ALIASES = new Map();
for (const [name, def] of Object.entries(STEPS)) for (const alias of def.aliases) ALIASES.set(alias, name);

/**
 * Canonical names filtered by where they may appear.
 * @param {{ batch?: boolean, session?: boolean }} [where]
 * @returns {string[]}
 */
export function stepNames(where = {}) {
  return STEP_NAMES.filter((name) => (!where.batch || STEPS[name].batch) && (!where.session || STEPS[name].session));
}

/**
 * Resolve a name or alias to the canonical step name, `undefined` for a stranger.
 * @param {unknown} nameOrAlias
 * @returns {string | undefined}
 */
export function resolveStepName(nameOrAlias) {
  if (typeof nameOrAlias !== 'string') return undefined;
  if (Object.hasOwn(STEPS, nameOrAlias)) return nameOrAlias;
  return ALIASES.get(nameOrAlias);
}

/** Every spelling the CLI accepts — names and aliases — for "did you mean". */
export const ALL_SPELLINGS = Object.freeze([...STEP_NAMES, ...ALIASES.keys()]);

/**
 * Field paths (relative to the step) that carry a ref: `ref` fields, `target` fields holding a ref,
 * and `fields[k].ref` of a form. The "ref before snapshot" rule and the export both need this.
 * @param {Step} step
 * @param {StepDef} def
 * @returns {string[]}
 */
export function refFieldsOf(step, def) {
  const found = [];
  for (const [key, type] of Object.entries(def.config)) {
    const { base } = parseFieldType(type);
    if (base === 'ref' && step[key] !== undefined) found.push(key);
    else if (base === 'target' && isRef(step[key])) found.push(key);
  }
  if (Array.isArray(step.fields)) {
    step.fields.forEach((field, k) => {
      if (field && typeof field === 'object' && field.ref !== undefined) found.push(`fields[${String(k)}].ref`);
    });
  }
  return found;
}

/**
 * Validate one step against its row: known name, allowed here, no unknown fields, field types,
 * the row's own rules. Returns messages prefixed with `where`.
 * @param {unknown} step
 * @param {string} where e.g. `snapshots[2].steps[4]`
 * @param {ValidateContext} ctx
 * @returns {string[]}
 */
export function validateStep(step, where, ctx) {
  if (!step || typeof step !== 'object' || Array.isArray(step)) return [`${where}: a step is an object with "do"`];
  const s = /** @type {Step} */ (step);
  const name = resolveStepName(s.do);
  if (name === undefined) {
    return [
      `${where}.do: unknown step ${JSON.stringify(s.do)} — known: ${stepNames({ [ctx.mode === 'session' ? 'session' : 'batch']: true }).join(', ')}`,
    ];
  }
  const def = STEPS[name];
  const errors = [];
  if (ctx.mode !== 'session' && !def.batch)
    errors.push(`${where}.do: "${name}" is a session-only command, not a config step`);
  if (ctx.mode === 'session' && !def.session) errors.push(`${where}.do: "${name}" is not a session command`);
  for (const key of Object.keys(s)) {
    if (key === 'do' || Object.hasOwn(def.config, key)) continue;
    errors.push(
      `${where}.${key}: unknown field for "${name}" (known: ${Object.keys(def.config).join(', ') || 'none'})`,
    );
  }
  for (const [key, type] of Object.entries(def.config)) {
    const error = checkField(s[key], type, `${where}.${key}`);
    if (error) errors.push(error);
  }
  if (errors.length > 0) return errors;
  const own = def.validate?.(s, where, ctx);
  if (typeof own === 'string') errors.push(own);
  else if (Array.isArray(own)) errors.push(...own.filter((e) => typeof e === 'string'));
  return errors;
}

/**
 * Validate a list of steps as ONE flow: per-step rules plus the flow-level ones — a ref may only
 * appear after a `snapshot` step (the ref map is empty before), artifact names are unique, and
 * `extract` / `evaluate` / `storage --name` / `fetch --name` share one `extracts` namespace.
 * @param {unknown} steps
 * @param {string} [where] e.g. `snapshots[2].steps`
 * @param {Partial<ValidateContext>} [options]
 * @returns {string[]} empty when valid
 */
export function validateSteps(steps, where = 'steps', options = {}) {
  /** @type {ValidateContext} */
  const ctx = { mode: options.mode ?? 'batch' };
  if (!Array.isArray(steps)) return [`${where}: expected an array of steps`];
  const errors = [];
  const shotNames = new Set();
  const pdfNames = new Set();
  const snapNames = new Set();
  const captureNames = new Set();
  let refsLive = ctx.mode === 'session';
  steps.forEach((raw, j) => {
    const at = `${where}[${String(j)}]`;
    const own = validateStep(raw, at, ctx);
    if (own.length > 0) {
      errors.push(...own);
      return;
    }
    const s = /** @type {Step} */ (raw);
    const name = /** @type {string} */ (resolveStepName(s.do));
    const def = STEPS[name];
    if (!refsLive) {
      for (const field of refFieldsOf(s, def)) {
        errors.push(
          `${at}.${field}: ref ${JSON.stringify(s[field] ?? '')} before any "snapshot" step in this flow — the ref map is empty; add { "do": "snapshot" } first or use a selector`,
        );
      }
    }
    if (name === 'snapshot') refsLive = true;
    if (ctx.mode === 'session') return;
    if (name === 'screenshot' && typeof s.name === 'string') {
      if (shotNames.has(s.name))
        errors.push(
          `${at}.name: duplicate screenshot name "${s.name}" — the later capture would overwrite the earlier file`,
        );
      shotNames.add(s.name);
    }
    if (name === 'pdf' && typeof s.name === 'string') {
      if (pdfNames.has(s.name)) errors.push(`${at}.name: duplicate pdf name "${s.name}"`);
      pdfNames.add(s.name);
    }
    if (name === 'snapshot' && typeof s.name === 'string') {
      // A named snapshot writes three files (`snap-<name>.md/.full.yml/.json`); the second one with
      // the same name overwrites all three and the report keeps ONE entry in `files` — the evidence
      // of the earlier state is gone with nothing saying so. Its own namespace, like screenshot and
      // pdf: this is a file name, not the `extracts` namespace.
      if (snapNames.has(s.name))
        errors.push(
          `${at}.name: duplicate snapshot name "${s.name}" — the later snapshot would overwrite snap-${s.name}.md / .full.yml / .json`,
        );
      snapNames.add(s.name);
    }
    if (['extract', 'evaluate', 'storage', 'fetch'].includes(name) && typeof s.name === 'string') {
      if (captureNames.has(s.name)) {
        errors.push(
          `${at}.name: duplicate capture name "${s.name}" — extract, evaluate, storage and fetch share one namespace`,
        );
      }
      captureNames.add(s.name);
    }
  });
  return errors;
}

/**
 * One line for the report / journal. Unknown steps describe themselves by name only — a
 * description must never throw, the report is written for broken configs too.
 * @param {Step} step
 * @returns {string}
 */
export function describeStep(step) {
  const name = resolveStepName(step?.do);
  if (name === undefined) return String(step?.do ?? '?');
  try {
    return STEPS[name].describe(step);
  } catch {
    return name;
  }
}

/**
 * `browser-inspector help <step>` — the one-liner plus the config fields and session flags of the row.
 * @param {string} nameOrAlias
 * @returns {string | undefined} undefined for an unknown name
 */
export function helpFor(nameOrAlias) {
  const name = resolveStepName(nameOrAlias);
  if (name === undefined) return undefined;
  const def = STEPS[name];
  const lines = [`browser-inspector ${def.help}`];
  const spellings = [name, ...def.aliases];
  lines.push(
    `  kind: ${def.kind} · names: ${spellings.join(', ')} · config: ${def.batch ? 'yes' : 'no'} · session: ${def.session ? 'yes' : 'no'}`,
  );
  const fields = Object.entries(def.config).map(([k, t]) => `${k}: ${t}`);
  if (fields.length > 0) lines.push(`  config fields: ${fields.join(', ')}`);
  const flags = Object.entries(def.flags).map(([k, t]) => `--${k}${t === 'bool' ? '' : ` <${t}>`}`);
  if (flags.length > 0) lines.push(`  flags: ${flags.join(' ')}`);
  return lines.join('\n');
}
