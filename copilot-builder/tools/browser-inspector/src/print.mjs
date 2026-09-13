// print.mjs — the shape of every stdout line of a session (DESIGN.md §4.4), pure.
//
// One line per success, ≤ 160 characters and ≤ 40 o200k tokens (a test counts them), prefix
// `ok | FAIL`, separator ` · `, paths relative to the caller's cwd. The line says whether it is
// worth looking again — `navigated` (refs are dead), `dom Δ`, `el 61→63`, `+1 console.error` — so
// the agent runs `browser-inspector snap` when something changed and not after every click. Content commands
// (`find`, `snap`, `console`, `net`, `eval`, `get`) print the content itself, because the content
// IS the result; their headers and overflow markers come from here too.

export const SEP = ' · ';
export const MAX_LINE = 160;
/** `eval` prints the value inline up to this many characters; longer goes to `eval-NNN.txt`. */
export const EVAL_INLINE_MAX = 300;

export const REF_NOT_FOUND = 'ref not found (gone, label changed or other frame) → browser-inspector snap';

/**
 * The line a session command prints when there is no keeper (exit 2) — sessions have no
 * in-process fallback, batch has.
 * @param {string} reason
 */
export const KEEPER_UNAVAILABLE = (reason) =>
  `FAIL keeper unavailable: ${reason} — sessions need the keeper (browser-inspector up | doctor); batch: --no-daemon`;

/**
 * One line, hard-capped. Newlines collapse to spaces (a console message with a stack trace must
 * not become five lines); the cut is marked with `…`.
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
 * character the page never had. One unit back is enough: the cut is a budget, not a promise.
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
 * Integers with a thin thousands space: `1 390`. Not `toLocaleString` — the output must not depend
 * on the machine's locale.
 * @param {number} ms
 * @returns {string}
 */
export function formatMs(ms) {
  const n = Math.round(ms);
  const sign = n < 0 ? '-' : '';
  const digits = String(Math.abs(n));
  return sign + digits.replace(/\B(?=(\d{3})+(?!\d))/gu, ' ');
}

/** `41 B`, `1.5 KB`, `2.0 MB`. @param {number} bytes */
export function formatBytes(bytes) {
  if (bytes < 1024) return `${String(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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
 * A URL as a delta prints it: path (+ query, + hash) when it stays on the origin the session
 * started on, the whole URL otherwise.
 * @param {string} url
 * @param {string} [baseOrigin]
 */
export function urlDisplay(url, baseOrigin) {
  try {
    const parsed = new URL(url);
    if (baseOrigin === undefined || parsed.origin === baseOrigin)
      return `${parsed.pathname}${parsed.search}${parsed.hash}`;
    return url;
  } catch {
    return url;
  }
}

/** @param {string | undefined} url @returns {string | undefined} */
function originOf(url) {
  try {
    return url === undefined ? undefined : new URL(url).origin;
  } catch {
    return undefined;
  }
}

/**
 * The general line: `<status> <head> · part · part`. Empty parts are dropped.
 * @param {'ok' | 'FAIL'} status
 * @param {string} head e.g. `click e112`
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
 * `FAIL click e99 · ref not found (…) → browser-inspector snap` — the reason is the first part.
 * @param {string} head
 * @param {string} reason
 * @param {readonly (string | undefined | null | false)[]} [parts]
 */
export const formatFail = (head, reason, parts = []) => formatLine('FAIL', head, [truncate(reason, 120), ...parts]);

/**
 * @typedef {object} PageProbe
 * @property {string} [url]
 * @property {string} [title]
 * @property {number} [el] number of interactive elements
 * @property {number} [consoleErrors] cumulative count
 * @property {number} [netFailed] cumulative count
 */

/**
 * @typedef {object} AfterProbe
 * @property {string} [url]
 * @property {string} [title]
 * @property {number} [el]
 * @property {number} [consoleErrors]
 * @property {number} [netFailed]
 * @property {boolean} [navigated] a new document (refs are dead)
 * @property {number} [frameSeq] the new document's frame sequence (`f1eN`)
 * @property {boolean} [domChanged] MutationObserver counter moved
 * @property {{ type: string, message: string, action: string }[]} [dialogs] dialogs during the action
 */

/**
 * The deltas after an action, in the order DESIGN.md prints them: navigation (or a same-document
 * URL change), `dom Δ`, the element count, new console errors, new failed requests, dialogs.
 * @param {PageProbe} before
 * @param {AfterProbe} after
 * @param {{ baseOrigin?: string }} [options]
 * @returns {string[]}
 */
export function formatDeltas(before, after, options = {}) {
  const parts = [];
  if (after.navigated) {
    // No `(browser-inspector snap)` hint: the instruction block already says where refs come from,
    // and six tokens on every navigating action added up.
    parts.push(`navigated → refs f${String(after.frameSeq ?? 1)}eN`);
  } else if (after.url !== undefined && before.url !== undefined && after.url !== before.url) {
    const title = after.title ? ` ${JSON.stringify(truncate(after.title, 40))}` : '';
    // Without a session origin the previous URL says what "same origin" means: a cross-origin hop
    // prints in full, a route change prints as a path.
    parts.push(`url ${urlDisplay(after.url, options.baseOrigin ?? originOf(before.url))}${title}`);
  } else if (after.domChanged) {
    parts.push('dom Δ');
  }
  if (after.el !== undefined) {
    parts.push(
      before.el !== undefined && before.el !== after.el && !after.navigated
        ? `el ${String(before.el)}→${String(after.el)}`
        : `el ${String(after.el)}`,
    );
  }
  const errors = (after.consoleErrors ?? 0) - (before.consoleErrors ?? 0);
  if (errors > 0) parts.push(`+${String(errors)} console.error`);
  const failed = (after.netFailed ?? 0) - (before.netFailed ?? 0);
  if (failed > 0) parts.push(`+${String(failed)} net failed`);
  for (const dialog of after.dialogs ?? []) {
    parts.push(`dialog ${dialog.type} ${JSON.stringify(truncate(dialog.message, 40))} → ${dialog.action}`);
  }
  return parts;
}

/**
 * `ok open "Księgarnia" · el 61 · err 0 · session/default/snap.md`
 * @param {{ title: string, el: number, errors: number, snapPath: string }} r
 */
export const formatOpen = (r) =>
  formatOk(`open ${JSON.stringify(truncate(r.title, 60))}`, [
    `el ${String(r.el)}`,
    `err ${String(r.errors)}`,
    r.snapPath,
  ]);

/**
 * `ok shot session/default/shots/004-koszyk.png 1280x2140`
 * @param {string} file relative path @param {number} width @param {number} height
 */
export const formatShot = (file, width, height) => formatOk(`shot ${file} ${String(width)}x${String(height)}`);

/**
 * `…+55 lines · session/default/snap.md` — the overflow marker after `--max` lines.
 * @param {number} hidden @param {string} file
 */
export const formatOverflow = (hidden, file) => `…+${String(hidden)} lines${SEP}${file}`;

/**
 * `1 new: error [cart] POST /api/cart → 404` for one entry, `3 new:` + one line each for more,
 * `0 new` when nothing happened since the last call.
 * @param {readonly string[]} lines already-formatted entries
 * @param {string} [what] `new` (default) — `console --all` passes `total`
 * @returns {string[]}
 */
export function formatNewEntries(lines, what = 'new') {
  if (lines.length === 0) return [`0 ${what}`];
  if (lines.length === 1) return [truncate(`1 ${what}: ${lines[0]}`)];
  return [`${String(lines.length)} ${what}:`, ...lines.map((l) => truncate(l))];
}

/**
 * `error [cart] POST /api/cart → 404` — the console entry as a line (type first, location last if any).
 * @param {{ type: string, text: string, location?: string }} entry
 */
export const formatConsoleEntry = (entry) =>
  truncate(`${entry.type} ${entry.text}${entry.location ? ` (${entry.location})` : ''}`);

/**
 * `#7 POST /api/cart 404 12 ms` — a network entry; failures print the failure text instead of a status.
 * @param {{ id: number, method: string, url: string, status?: number, ms?: number, failure?: string }} entry
 * @param {string} [baseOrigin]
 */
export function formatNetEntry(entry, baseOrigin) {
  const outcome = entry.status !== undefined ? String(entry.status) : (entry.failure ?? 'failed');
  const ms = entry.ms !== undefined ? ` ${formatMs(entry.ms)} ms` : '';
  return truncate(`#${String(entry.id)} ${entry.method} ${urlDisplay(entry.url, baseOrigin)} ${outcome}${ms}`);
}

/**
 * `3 new · 1 failed: #7 POST /api/cart 404 12 ms` — the summary line of `browser-inspector net`; when nothing
 * failed only the count prints, and `--failed` lists the failures underneath.
 * @param {{ newCount: number, failed: readonly string[] }} r formatted failed entries
 * @returns {string[]}
 */
export function formatNetSummary(r) {
  if (r.failed.length === 0) return [`${String(r.newCount)} new`];
  const head = `${String(r.newCount)} new${SEP}${String(r.failed.length)} failed:`;
  if (r.failed.length === 1) return [truncate(`${head} ${r.failed[0]}`)];
  return [head, ...r.failed.map((l) => truncate(l))];
}

/**
 * `404 application/json 41 B · session/default/net/7.txt` — the header line of `browser-inspector net <n> --body`.
 * @param {{ status?: number, failure?: string, contentType?: string, size?: number, file: string }} r
 */
export const formatNetBody = (r) =>
  truncate(
    [
      [
        r.status !== undefined ? String(r.status) : (r.failure ?? 'failed'),
        r.contentType,
        r.size !== undefined ? formatBytes(r.size) : undefined,
      ]
        .filter((p) => p !== undefined && p !== '')
        .join(' '),
      r.file,
    ].join(SEP),
  );

/**
 * `policy dismiss · last: confirm "Usunąć?" → dismissed (browser-inspector click e12)` — `browser-inspector dialog` without arguments.
 * @param {{ action: string, text?: string, once?: boolean }} policy
 * @param {{ type: string, message: string, action: string, trigger?: string } | undefined} last
 */
export function formatDialogStatus(policy, last) {
  const pol = `policy ${policy.action}${policy.once ? ' (once)' : ''}`;
  if (!last) return `${pol}${SEP}last: none`;
  const trigger = last.trigger ? ` (${last.trigger})` : '';
  return truncate(
    `${pol}${SEP}last: ${last.type} ${JSON.stringify(truncate(last.message, 40))} → ${last.action}${trigger}`,
  );
}

/**
 * `ok export 9 steps → flows/koszyk.json (refs → data-testid/#id/role=)`
 * @param {number} count @param {string} file
 */
export const formatExport = (count, file) =>
  formatOk(`export ${String(count)} step${count === 1 ? '' : 's'} → ${file} (refs → data-testid/#id/role=)`);

/**
 * `ok keeper survives shell: yes · spawn→listen 45 ms · first job 1 390 ms · warm 470 ms · hash 3f9a1c2e · <browser-inspector path>`
 * @param {{ survives: boolean, spawnToListenMs: number, firstJobMs: number, warmMs: number, hash: string, binPath: string }} r
 */
export const formatDoctor = (r) =>
  // The doctor line is the one exception to the 160-character cap: the absolute path of bin/browser-inspector.mjs
  // is its point, and cutting it would hide which checkout answered.
  [
    `ok keeper survives shell: ${r.survives ? 'yes' : 'no'}`,
    `spawn→listen ${formatMs(r.spawnToListenMs)} ms`,
    `first job ${formatMs(r.firstJobMs)} ms`,
    `warm ${formatMs(r.warmMs)} ms`,
    `hash ${r.hash}`,
    r.binPath.replaceAll('\\', '/'),
  ].join(SEP);

/**
 * The `eval` output policy: inline up to EVAL_INLINE_MAX characters, otherwise the first line and
 * the file the whole value went to.
 * @param {string} text the mapped result (JSON for objects, raw for strings)
 * @param {string} [file] where the full value was written when too long
 * @returns {string[]}
 */
export function formatEval(text, file) {
  if (text.length <= EVAL_INLINE_MAX && !text.includes('\n')) return [text];
  const lines = text.split('\n');
  if (text.length <= EVAL_INLINE_MAX) return lines;
  return [truncate(lines[0], EVAL_INLINE_MAX), `…${String(text.length)} chars${file ? `${SEP}${file}` : ''}`];
}
