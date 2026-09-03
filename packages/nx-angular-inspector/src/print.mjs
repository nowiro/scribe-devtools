// print.mjs — the shape of every stdout line, pure. The mechanism is browser-inspector's
// src/print.mjs; what differs is the cap and the vocabulary.
//
// One line per command, `ok | FAIL` prefix, ` · ` separator, ≤ 120 characters and ≤ 40 o200k
// tokens (a test counts them). The cap is 120 rather than browser-inspector's 160 because the
// longest line this tool can produce was measured at 35 tokens and a budget you never approach
// stops being a budget. Everything larger than a line goes to a file under `.ws/` and the line
// ends with its path: the agent reads the file instead of running the command again.
//
// The line is Polish because the agent instruction block in AGENTS.md is Polish and the two are
// read together; the code around it is English, like the rest of the repository.

export const SEP = ' · ';
export const MAX_LINE = 120;

/** Freshness verdicts as they appear on stdout, and the `cache` field they map to in a JSON payload. */
export const VERDICT = Object.freeze({
  hit: 'świeże',
  stale: 'nieświeże',
  miss: 'brak grafu',
  unsupported: 'nieznany format',
  forced: 'przeliczone',
});

/**
 * One line, hard-capped. Newlines collapse to spaces (a compiler error with a stack must not
 * become five lines); the cut is marked with `…`.
 * @param {string} text
 * @param {number} [max]
 * @returns {string}
 */
export function truncate(text, max = MAX_LINE) {
  const flat = String(text)
    .replace(/\s*\n\s*/gu, ' ')
    .trim();
  if (flat.length <= max) return flat;
  return `${sliceUnits(flat, Math.max(0, max - 1)).trimEnd()}…`;
}

/**
 * `text.slice(0, max)` that never leaves half of a surrogate pair behind. A cut between the two
 * units of an emoji writes U+FFFD into a file and `\ud83d` into the JSON — two spellings of a
 * character the source never had. One unit back is enough: the cut is a budget, not a promise.
 * @param {string} text
 * @param {number} max
 * @returns {string}
 */
export function sliceUnits(text, max) {
  if (max <= 0) return '';
  if (text.length <= max) return text;
  const code = text.charCodeAt(max - 1);
  return text.slice(0, code >= 0xd800 && code <= 0xdbff ? max - 1 : max);
}

/**
 * Integers with a thin thousands space: `1 743`. Not `toLocaleString` — the output must not depend
 * on the machine's locale.
 * @param {number} value
 * @returns {string}
 */
export function formatInt(value) {
  const n = Math.round(value);
  const sign = n < 0 ? '-' : '';
  return sign + String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/gu, ' ');
}

/**
 * How old the graph is, in the coarsest unit that is still true: `2 min`, `3 h`, `5 dni`. Age is
 * a hint about whether to re-run something, so a false precision of seconds would be noise.
 * @param {number} ms
 * @returns {string}
 */
export function formatAge(ms) {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 90) return `${String(seconds)} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) return `${String(minutes)} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 36) return `${String(hours)} h`;
  return `${String(Math.round(hours / 24))} dni`;
}

/**
 * A path as the agent typed its cwd: relative when inside it, forward slashes always (the same
 * line must read the same in Bash and PowerShell).
 * @param {string} file
 * @param {string} cwd
 * @returns {string}
 */
export function relPath(file, cwd) {
  const norm = (/** @type {string} */ p) => p.replaceAll('\\', '/').replace(/\/+$/u, '');
  const f = norm(file);
  const c = norm(cwd);
  const lower = (/** @type {string} */ p) => (/^[a-z]:\//iu.test(p) ? p[0].toLowerCase() + p.slice(1) : p);
  if (lower(f).startsWith(`${lower(c)}/`)) return f.slice(c.length + 1);
  if (lower(f) === lower(c)) return '.';
  return f;
}

/**
 * The general line: `<status> <head> · part · part`. Empty parts are dropped, so a caller may pass
 * a conditional part as `condition && text` without composing the array by hand.
 * @param {'ok' | 'FAIL'} status
 * @param {string} head e.g. `projects portal`
 * @param {readonly (string | undefined | null | false)[]} [parts]
 * @returns {string}
 */
export function formatLine(status, head, parts = []) {
  const kept = parts.filter((p) => typeof p === 'string' && p !== '');
  return truncate([`${status} ${head}`, ...kept].join(SEP));
}

/** @param {string} head @param {readonly (string | undefined | null | false)[]} [parts] */
export const formatOk = (head, parts = []) => formatLine('ok', head, parts);

/**
 * `FAIL env · nx 21.3.11 · wymagane nx >= 23` — the reason is the first part, capped well below the
 * line so the parts after it (a path, usually) survive the truncation.
 * @param {string} head
 * @param {string} reason
 * @param {readonly (string | undefined | null | false)[]} [parts]
 */
export const formatFail = (head, reason, parts = []) => formatLine('FAIL', head, [truncate(reason, 80), ...parts]);

/**
 * Polish counts agree with the number: `1 zależność`, `2 zależności`, `22 zależnych`. Getting this
 * wrong is cheap to fix and expensive to read, and the line is read on every single command.
 * @param {number} n
 * @param {[one: string, few: string, many: string]} forms
 * @returns {string}
 */
export function plural(n, forms) {
  const abs = Math.abs(n);
  const last = abs % 10;
  const lastTwo = abs % 100;
  if (abs === 1) return `${formatInt(n)} ${forms[0]}`;
  if (last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14)) return `${formatInt(n)} ${forms[1]}`;
  return `${formatInt(n)} ${forms[2]}`;
}
