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
/** Full aria YAML line: indent, `- role "name" [attrs] [ref=eN]` then `: value`. */
const YAML_VALUE_LINE = new RegExp(
  `^(\\s*-\\s+(?:${VALUE_ROLES})\\b[^:\\n]*?\\[ref=([a-z]\\d*e\\d+|e\\d+)\\][^:\\n]*)(:\\s.*)$`,
);
/** Compact line (`snap.md`): `e39 textbox "Szukaj…" = Harry`. */
const COMPACT_VALUE_LINE = new RegExp(`^((?:f\\d+)?e\\d+)\\s+(?:${VALUE_ROLES})\\b(.*?)(\\s=\\s.*)$`);

/**
 * Mask values in a snapshot text — both the raw aria YAML (`snap.full.yml`) and the compact form
 * (`snap.md`). Two rules: a field whose ref is in `sensitiveRefs` (type=password,
 * autocomplete=one-time-code — the sidecar knows the DOM type, the aria tree does not) NEVER shows
 * a value; every other value goes through `redact`. Lines without a value are untouched.
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
      const yaml = YAML_VALUE_LINE.exec(line);
      if (yaml) return sensitive.has(yaml[2]) ? yaml[1] : redact(line, secrets);
      const compact = COMPACT_VALUE_LINE.exec(line);
      if (compact)
        return sensitive.has(compact[1]) ? line.slice(0, line.length - compact[3].length) : redact(line, secrets);
      return line;
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
      return /** @type {E} */ (rest);
    }
    return redactDeep(entry, options.secretValues);
  });
}
