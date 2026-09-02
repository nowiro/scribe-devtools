// redact.mjs — ONE function for every place a secret could surface (DESIGN.md §2.6).
//
// The keeper holds `secretValues` per job/session (values the client resolved from env — never the
// env itself) and runs this over stdout, the journal, the log, report.md/json, snap.md/snap.json,
// extract/eval results, text.txt, console.jsonl, net.jsonl and the export. One implementation, so
// a new artifact cannot forget a form the others already cover: the raw value, its JSON-escaped
// form (inside report.json a `"` becomes `\"`) and its URL-encoded form (a POST body in net.jsonl).

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
/** A ref as the snapshot writes it, anywhere in a line. */
const REF_IN_LINE = /\[ref=((?:f\d+)?e\d+)\]/u;
/** Head of a compact line (`snap.md`): `e39 textbox "Szukaj…" = Harry`. */
const COMPACT_HEAD = new RegExp(`^((?:f\\d+)?e\\d+)\\s+(?:${VALUE_ROLES})\\b`, 'u');

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
 * A raw aria YAML line that carries both a ref and an inline value. A line whose value is empty is
 * a container whose children follow — cutting its `:` would break the nesting, so it does not count.
 * @param {string} line
 * @returns {{ ref: string, at: number } | undefined} `at` = index of the `:` that ends the key
 */
function yamlValueLine(line) {
  const item = /^\s*-\s+/u.exec(line);
  if (!item) return undefined;
  const start = item[0].length;
  const body = line.slice(start);
  const colon = keyEnd(body);
  if (colon < 0 || body.slice(colon + 1).trim() === '') return undefined;
  const ref = REF_IN_LINE.exec(body.slice(0, colon))?.[1];
  return ref === undefined ? undefined : { ref, at: start + colon };
}

/**
 * A compact line that carries a typed value: its ref and where ` = value` starts. The accessible
 * name is skipped as a quoted run, so a name containing ` = ` neither hides the value nor eats the
 * rest of the line.
 * @param {string} line
 * @returns {{ ref: string, at: number } | undefined}
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
  return at < 0 ? undefined : { ref: head[1], at };
}

/**
 * Mask values in a snapshot text — both the raw aria YAML (`snap.full.yml`) and the compact form
 * (`snap.md`). Two rules: a field whose ref is in `sensitiveRefs` (type=password,
 * autocomplete=one-time-code — the sidecar knows the DOM type, the aria tree does not) NEVER shows
 * a value; every OTHER line goes through `redact`, the ones carrying no value included — a page
 * that echoes a secret into a heading or a URL must not slip through because its line did not look
 * like a value line.
 * @param {string} text
 * @param {{ secretValues?: readonly string[], sensitiveRefs?: Iterable<string> }} [options]
 * @returns {string}
 */
export function maskSnapshotValues(text, options = {}) {
  const sensitive = new Set(options.sensitiveRefs ?? []);
  const secrets = options.secretValues ?? [];
  return text
    .split('\n')
    .map((line) => {
      const yaml = yamlValueLine(line);
      if (yaml && sensitive.has(yaml.ref)) return line.slice(0, yaml.at);
      const compact = compactValueLine(line);
      if (compact && sensitive.has(compact.ref)) return line.slice(0, compact.at);
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
