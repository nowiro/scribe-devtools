// redact.mjs — ONE function for every place a secret could surface (DESIGN.md §2.6).
//
// The keeper holds `secretValues` per job/session (values the client resolved from env — never the
// env itself) and runs this over stdout, the journal, the log, report.md/json, snap.md/snap.json,
// extract/eval results, text.txt, console.jsonl, net.jsonl and the export. One implementation, so
// a new artifact cannot forget a form the others already cover: the raw value, its JSON-escaped
// form (inside report.json a `"` becomes `\"`), its URL-encoded form (a query string in net.jsonl),
// the form-urlencoded spelling a submitted <form> puts in a POST body (space is `+`) and base64.

export const MASK = '***';

/**
 * Every spelling of a secret that can appear in text. Longest first, so a secret that contains
 * another is masked as a whole and not as `ab***cd`.
 * @param {readonly string[] | undefined | null} secretValues
 * @returns {string[]}
 */
export function secretForms(secretValues) {
  const forms = new Set();
  for (const secret of secretValues ?? []) {
    if (typeof secret !== 'string' || secret.length === 0) continue;
    forms.add(secret);
    forms.add(JSON.stringify(secret).slice(1, -1));
    forms.add(encodeURIComponent(secret));
    // `encodeURIComponent` is NOT what a browser sends: a submitted form encodes a space as `+`
    // and escapes `!'()*`, so a password with either survived redaction in `net/<n>.txt`.
    forms.add(new URLSearchParams({ v: secret }).toString().slice(2));
    // base64 is a reversible spelling too (`Authorization: Basic`, a token in a body). The pair
    // `user:secret` is NOT covered — its prefix shifts the secret off the 3-byte boundary.
    forms.add(Buffer.from(secret, 'utf8').toString('base64'));
    forms.add(Buffer.from(secret, 'utf8').toString('base64url'));
  }
  return [...forms].sort((a, b) => b.length - a.length);
}

/**
 * Replace every occurrence of every secret in a string. Non-strings pass through untouched
 * (`redactDeep` walks objects). Empty and non-string secrets are skipped, never turned into a
 * global mask.
 * @param {string} text
 * @param {readonly string[] | undefined | null} secretValues
 * @returns {string}
 */
export function redact(text, secretValues) {
  if (typeof text !== 'string' || text.length === 0) return text;
  let out = text;
  for (const form of secretForms(secretValues)) {
    if (out.includes(form)) out = out.replaceAll(form, MASK);
  }
  return out;
}

/**
 * `redact` over a JSON-like value: strings in arrays and objects (keys too — a secret used as a
 * storage key would otherwise survive in `storage list`). Returns a new value; the input is
 * not mutated.
 * @template T
 * @param {T} value
 * @param {readonly string[] | undefined | null} secretValues
 * @returns {T}
 */
export function redactDeep(value, secretValues) {
  const forms = secretForms(secretValues);
  if (forms.length === 0) return value;
  /** @param {any} node @returns {any} */
  const walk = (node) => {
    if (typeof node === 'string') return redact(node, secretValues);
    if (Array.isArray(node)) return node.map(walk);
    if (node && typeof node === 'object') {
      /** @type {Record<string, any>} */
      const out = {};
      for (const [key, inner] of Object.entries(node)) out[redact(key, secretValues)] = walk(inner);
      return out;
    }
    return node;
  };
  return walk(value);
}

/** Roles whose snapshot line can carry a typed value (`- textbox "Email" [ref=e5]: jan@x`). */
const VALUE_ROLES = 'textbox|searchbox|combobox|spinbutton|slider';
const VALUE_ROLE_SET = new Set(VALUE_ROLES.split('|'));
/** A ref as the snapshot writes it. Only ever run PAST the accessible name — see `afterName`. */
const REF_IN_LINE = /\[ref=((?:f\d+)?e\d+)\]/u;
/**
 * Head of a compact line (`snap.md`): `e39 textbox "Szukaj…" = Harry`. The ref is OPTIONAL: a field
 * playwright gave no ref to (`pointer-events: none`, its own or inherited) renders as
 * `textbox "Hasło" = …`, and anchoring on the ref made the fail-closed mode walk straight past it.
 */
const COMPACT_HEAD = new RegExp(`^(?:((?:f\\d+)?e\\d+)\\s+)?(?:${VALUE_ROLES})\\b`, 'u');

/**
 * Index of the `:` that closes the key of a `- ` YAML item body, or -1. Cannot be a regexp over
 * roles and colons: the accessible name may itself contain a colon (`textbox "Hasło:"`), and when
 * it contains `: ` the renderer quotes the WHOLE key (`'textbox "Kod: SMS" [ref=e5] [box=…]': 1`),
 * so the line does not even start with a role any more.
 * @param {string} body the text after `- `
 * @returns {number}
 */
function keyEnd(body) {
  if (body.startsWith("'") || body.startsWith('"')) {
    const quote = body[0];
    let i = 1;
    while (i < body.length) {
      if (quote === '"' && body[i] === '\\') {
        i += 2;
        continue;
      }
      if (body[i] === quote) {
        if (quote === "'" && body[i + 1] === "'") {
          i += 2;
          continue;
        }
        break;
      }
      i += 1;
    }
    return body[i + 1] === ':' ? i + 1 : -1;
  }
  let inName = false;
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (ch === '\\' && inName) {
      i += 1;
      continue;
    }
    if (ch === '"') inName = !inName;
    else if (ch === ':' && !inName && (i === body.length - 1 || body[i + 1] === ' ')) return i;
  }
  return -1;
}

/**
 * Index just past the accessible name of a key, or 0 when it has none. The name is PAGE TEXT and
 * the renderer puts it before every attribute, so scanning the whole key for `[ref=…]` let a
 * crafted `aria-label` ("Hasło [ref=e1] konta") hand the line the ref of another node: the password
 * field stopped being recognised as sensitive and kept its value in `snap.full.yml`, while an
 * unrelated field whose name mentioned a sensitive ref lost the value it should have kept.
 * @param {string} key key text with the outer YAML quotes already removed
 * @returns {number}
 */
function afterName(key) {
  const role = /^\s*[a-zA-Z][\w-]*/u.exec(key);
  const start = role ? role[0].length : 0;
  const rest = key.slice(start);
  if (/^\s+\//u.test(rest)) {
    // `createKey` leaves a name that already starts AND ends with `/` UNQUOTED, so there is no
    // quote to skip and the whole key was scanned again — a `/Hasło [ref=e1]/` label handed the
    // line the ref of another node and the password stayed in `snap.full.yml`. The name ends at the
    // last `/` before the trailing run of `[attr]` / `[attr=value]`, which the renderer appends
    // after the name and after every state attribute.
    const tail = /(?:\s\[[a-z]+(?:=[^\]]*)?\])+$/u.exec(key);
    const end = key.lastIndexOf('/', (tail ? tail.index : key.length) - 1);
    return end > start ? end + 1 : 0;
  }
  const quote = key.indexOf('"');
  if (quote < 0) return 0;
  let i = quote + 1;
  while (i < key.length) {
    if (key[i] === '\\') {
      i += 2;
      continue;
    }
    if (key[i] === '"') return i + 1;
    i += 1;
  }
  return 0;
}

/**
 * A raw aria YAML line with a key: its role, its own ref, where the key ends and whether anything
 * follows the `:`. A line whose value is EMPTY is a container — cutting its `:` would break the
 * nesting — but it is not automatically harmless either: when a field carries a property
 * (`- /placeholder: …`) the renderer cannot write the value inline and puts it in a `- text:` leaf
 * underneath, so the caller has to cut that leaf instead.
 * @param {string} line
 * @returns {{ ref?: string, role: string, at: number, indent: number, empty: boolean } | undefined}
 *   `at` = index of the `:` that ends the key
 */
function yamlLine(line) {
  const item = /^(\s*)-\s+/u.exec(line);
  if (!item) return undefined;
  const start = item[0].length;
  const body = line.slice(start);
  const colon = keyEnd(body);
  if (colon < 0) return undefined;
  const key = body.slice(0, colon);
  // A name containing `: ` makes the renderer quote the WHOLE key; the role and the attributes are
  // then inside those quotes.
  const inner = key.startsWith("'") || key.startsWith('"') ? key.slice(1, -1) : key;
  const role = /^\s*([a-zA-Z][\w-]*)/u.exec(inner)?.[1] ?? '';
  const ref = REF_IN_LINE.exec(inner.slice(afterName(inner)))?.[1];
  return {
    ...(ref !== undefined ? { ref } : {}),
    role,
    at: start + colon,
    indent: item[1].length,
    empty: body.slice(colon + 1).trim() === '',
  };
}

/**
 * A compact line that carries a typed value: its ref and where ` = value` starts. The accessible
 * name is skipped as a quoted run, so a name containing ` = ` neither hides the value nor eats the
 * rest of the line.
 * @param {string} line
 * @returns {{ ref?: string, at: number } | undefined}
 */
function compactValueLine(line) {
  const head = COMPACT_HEAD.exec(line);
  if (!head) return undefined;
  let i = head[0].length;
  if (line[i] === ' ' && line[i + 1] === '"') {
    let j = i + 2;
    while (j < line.length) {
      if (line[j] === '\\') {
        j += 2;
        continue;
      }
      if (line[j] === '"') break;
      j += 1;
    }
    i = Math.min(j + 1, line.length);
  }
  const at = line.indexOf(' = ', i);
  return at < 0 ? undefined : { ...(head[1] !== undefined ? { ref: head[1] } : {}), at };
}

/**
 * Mask values in a snapshot text — both the raw aria YAML (`snap.full.yml`) and the compact form
 * (`snap.md`). Two rules: a field whose ref is in `sensitiveRefs` (type=password,
 * autocomplete=one-time-code — the sidecar knows the DOM type, the aria tree does not) NEVER shows
 * a value; every OTHER line goes through `redact`, the ones carrying no value included — a page
 * that echoes a secret into a heading or a URL must not slip through because its line did not look
 * like a value line. `maskAllValueRoles` is the fail-closed mode for a snapshot whose DOM walk did
 * not run: without the walk NOTHING is known to be sensitive, so every value-carrying line is cut
 * rather than every one kept.
 * @param {string} text
 * @param {{ secretValues?: readonly string[], sensitiveRefs?: Iterable<string>, maskAllValueRoles?: boolean }} [options]
 * @returns {string}
 */
export function maskSnapshotValues(text, options = {}) {
  const sensitive = new Set(options.sensitiveRefs ?? []);
  const secrets = options.secretValues ?? [];
  const all = options.maskAllValueRoles === true;
  /** Indentation of the value field whose `- text:` leaf must go, -1 when there is none open. */
  let cutUnder = -1;
  return text
    .split('\n')
    .map((line) => {
      const yaml = yamlLine(line);
      if (cutUnder >= 0 && (yaml === undefined || yaml.indent <= cutUnder)) cutUnder = -1;
      if (yaml) {
        // A value-carrying line WITHOUT a ref cannot be checked against the sidecar at all: the
        // sidecar is keyed by ref and playwright hands none to a field that does not receive
        // pointer events, so `sensitive` never reached it. Unknown sensitivity is cut, like a
        // snapshot whose walk did not run.
        const unvouched = VALUE_ROLE_SET.has(yaml.role) && (all || yaml.ref === undefined);
        if ((yaml.ref !== undefined && sensitive.has(yaml.ref)) || unvouched) {
          if (!yaml.empty) return line.slice(0, yaml.at);
          cutUnder = yaml.indent;
          return redact(line, secrets);
        }
        if (cutUnder >= 0 && yaml.role === 'text' && !yaml.empty) return line.slice(0, yaml.at);
      }
      const compact = compactValueLine(line);
      if (compact && (all || compact.ref === undefined || sensitive.has(compact.ref))) {
        return line.slice(0, compact.at);
      }
      return redact(line, secrets);
    })
    .join('\n');
}

/**
 * The same policy for the sidecar entries (`snap.json`: `[{ ref, role, name, selector?, value?, sensitive? }]`):
 * a sensitive entry loses its `value` outright, the rest are redacted. New array, new objects.
 * @template {{ ref?: string, value?: unknown, sensitive?: boolean, [k: string]: unknown }} E
 * @param {readonly E[]} entries
 * @param {{ secretValues?: readonly string[], sensitiveRefs?: Iterable<string> }} [options]
 * @returns {E[]}
 */
export function maskSnapshotEntries(entries, options = {}) {
  const sensitive = new Set(options.sensitiveRefs ?? []);
  return entries.map((entry) => {
    if (entry.sensitive === true || (entry.ref !== undefined && sensitive.has(entry.ref))) {
      const { value: _dropped, ...rest } = entry;
      // The rest of a sensitive entry is redacted like any other: a page that echoed the secret
      // into the field's accessible name would otherwise ship it in `snap.json`.
      return /** @type {E} */ (redactDeep(rest, options.secretValues));
    }
    return redactDeep(entry, options.secretValues);
  });
}
