// session-log.mjs — the session journal (`journal.jsonl`) and its export to a batch config
// (DESIGN.md §4.5). Pure where it can be: `exportFlow` turns entries into a config object, the two
// file helpers around it are thin.
//
// The journal is the memory of a session: one JSON line per command with the step as the parser
// built it, the verdict, the time, the URL after the command and — for every action on a ref — the
// selector the engine resolved AT THE MOMENT OF THE ACTION (`locatorFor`: data-testid → #id →
// [name] → role=). That last field is what makes `browser-inspector export` possible: a ref (`e45`) is the address
// of an element in one snapshot of one session and means nothing tomorrow; the exported flow must
// carry addresses that find the element again. Secrets never enter the journal: a value from
// `--env` / `@{NAME}` is `valueFromEnv` already in the parser, and every line is redacted anyway.

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { redactDeep } from './redact.mjs';
import { ARTIFACT_NAME, STEPS, describeStep, refFieldsOf, resolveStepName, validateSteps } from './steps.schema.mjs';

/** @typedef {import('./types.js').Step} Step */

export const JOURNAL_FILE = 'journal.jsonl';

/** @param {string} sessionDir */
export const journalPath = (sessionDir) => path.join(sessionDir, JOURNAL_FILE);

export class ExportError extends Error {
  /** @param {string} message @param {string} [code] */
  constructor(message, code = 'E_EXPORT') {
    super(message);
    this.name = 'ExportError';
    this.code = code;
    this.exit = 2;
  }
}

/**
 * @typedef {object} JournalEntry
 * @property {string} [at] ISO timestamp (always present once written by `appendJournal`)
 * @property {number} [seq] 1-based position in the journal (assigned by `appendJournal` when absent)
 * @property {string} [sid] id of the session that wrote the line — the journal outlives `close`
 *   (and a TTL recycle, and yesterday), so this is what tells `exportFlow` where THIS session starts
 * @property {string} command the canonical step name (`goto`, not `open`)
 * @property {Step} step the step in config shape — `valueFromEnv`, never a resolved secret
 * @property {string} [description]
 * @property {boolean} ok
 * @property {number} [ms]
 * @property {string} [url] page URL after the command
 * @property {string} [title]
 * @property {string} [selector] the selector resolved for `step.ref` at action time
 * @property {Record<string, string>} [resolved] selectors per ref field path (`fields[1].ref`, `from`, `to`)
 * @property {string} [line] the stdout line
 * @property {string} [error]
 */

/** Fields a step may carry that never belong in a file, whatever the parser did. */
const SECRET_FIELDS = Object.freeze(['value']);

/**
 * Normalize an entry for the journal: canonical command, secrets stripped from steps that read
 * them from env, everything redacted. Returns a new object; the input is not touched.
 * @param {Partial<JournalEntry> & { step: Step }} entry
 * @param {readonly string[]} [secretValues]
 * @returns {JournalEntry & { at: string }}
 */
export function normalizeEntry(entry, secretValues = []) {
  const command = resolveStepName(entry.command ?? entry.step.do) ?? String(entry.command ?? entry.step.do);
  /** @type {Step} */
  const step = { ...entry.step, do: command };
  if (typeof step.valueFromEnv === 'string') for (const field of SECRET_FIELDS) delete step[field];
  if (Array.isArray(step.fields)) {
    step.fields = step.fields.map((field) => {
      if (!field || typeof field !== 'object' || typeof field.valueFromEnv !== 'string') return field;
      const copy = { ...field };
      for (const key of SECRET_FIELDS) delete copy[key];
      return copy;
    });
  }
  /** @type {JournalEntry & { at: string }} */
  const normalized = {
    at: entry.at ?? new Date().toISOString(),
    ...(entry.seq !== undefined ? { seq: entry.seq } : {}),
    ...(entry.sid !== undefined ? { sid: entry.sid } : {}),
    command,
    step,
    description: entry.description ?? describeStep(step),
    ok: entry.ok ?? true,
    ...(entry.ms !== undefined ? { ms: entry.ms } : {}),
    ...(entry.url !== undefined ? { url: entry.url } : {}),
    ...(entry.title !== undefined ? { title: entry.title } : {}),
    ...(entry.selector !== undefined ? { selector: entry.selector } : {}),
    ...(entry.resolved !== undefined ? { resolved: { ...entry.resolved } } : {}),
    ...(entry.line !== undefined ? { line: entry.line } : {}),
    ...(entry.error !== undefined ? { error: entry.error } : {}),
  };
  return redactDeep(normalized, secretValues);
}

/**
 * Append one line to the journal, creating the directory on the first command of a session.
 * Synchronous on purpose: a journal line is a few hundred bytes and the next command must be able
 * to read it; an unflushed async write is how a `browser-inspector export` after `browser-inspector fill` misses the fill.
 * @param {string} file the journal path (`journalPath(sessionDir)`)
 * @param {Partial<JournalEntry> & { step: Step }} entry
 * @param {{ secretValues?: readonly string[] }} [options]
 * @returns {JournalEntry & { at: string }} the line as written
 */
export function appendJournal(file, entry, options = {}) {
  mkdirSync(path.dirname(file), { recursive: true });
  const seq = entry.seq ?? journalLineCount(file) + 1;
  const normalized = normalizeEntry({ ...entry, seq }, options.secretValues);
  appendFileSync(file, `${JSON.stringify(normalized)}\n`, 'utf8');
  return normalized;
}

/**
 * The same line as `appendJournal` writes, for a caller that appends it itself — the engine keeps
 * the session's sequence in memory and chains the append off the answer path (the next command
 * reads the journal only through that chain, so nothing is missed).
 * @param {Partial<JournalEntry> & { step: Step, seq: number }} entry
 * @param {readonly string[]} [secretValues]
 * @returns {string} one JSON line with its newline
 */
export function formatJournalLine(entry, secretValues = []) {
  return `${JSON.stringify(normalizeEntry(entry, secretValues))}\n`;
}

/** Non-empty lines of a journal — the next `seq`. @param {string} file */
export function journalLineCount(file) {
  if (!existsSync(file)) return 0;
  const text = readFileSync(file, 'utf8');
  return text.split('\n').filter((line) => line.trim() !== '').length;
}

/**
 * Read the journal. A corrupt line (a crash mid-write) is skipped, not fatal — the rest of the
 * session is still worth exporting.
 * @param {string} file
 * @returns {JournalEntry[]}
 */
export function readJournal(file) {
  if (!existsSync(file)) return [];
  const entries = [];
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (line.trim() === '') continue;
    try {
      const parsed = JSON.parse(line);
      if (parsed && typeof parsed === 'object' && parsed.step && typeof parsed.step === 'object') entries.push(parsed);
    } catch {
      // Skipped on purpose — see above.
    }
  }
  return entries;
}

// ── exportFlow ───────────────────────────────────────────────────────────────

/** Steps that make sense only while somebody is looking — dropped from an export, with a reason. */
const LOOKING_ONLY = Object.freeze({
  snapshot: 'refs are replaced by selectors — a snapshot step has nothing to resolve',
  find: 'session-only',
  console: 'session-only',
  net: 'session-only',
  tabs: 'session-only',
  routes: 'session-only',
  locator: 'session-only',
  trace: 'session-only',
  video: 'session-only',
  run: 'session-only (BROWSER_INSPECTOR_UNSAFE) — never in a config',
  close: 'session-only',
});

/** Fields a session step may carry that a batch step may not (or that only make sense with refs). */
const SESSION_ONLY_FIELDS = Object.freeze({
  screenshot: ['mark'],
  snapshot: ['around'],
  goto: ['video'],
});

/** Batch requires a name where a session invents one; the prefix is the step name. */
const NAMED = Object.freeze({ screenshot: 'shot', pdf: 'pdf', extract: 'extract', evaluate: 'eval' });

/**
 * A snapshot name from a file name: `flows/koszyk.json` → `koszyk`; anything outside the artifact
 * alphabet becomes `-`, so the export always validates.
 * @param {string} file
 * @returns {string}
 */
export function flowNameFrom(file) {
  const base = path
    .basename(file)
    .replace(/\.json$/iu, '')
    .toLowerCase();
  const name = base
    .replace(/[^a-z0-9-]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 64);
  return ARTIFACT_NAME.test(name) ? name : 'flow';
}

/**
 * Read a field by a path like `fields[1].ref`.
 * @param {any} object @param {string} fieldPath
 * @returns {unknown}
 */
function readPath(object, fieldPath) {
  const match = /^fields\[(\d+)\]\.ref$/u.exec(fieldPath);
  return match ? object.fields?.[Number(match[1])]?.ref : object[fieldPath];
}

/**
 * Set a field by a path like `fields[1].ref` on a copy already made by the caller.
 * @param {any} object @param {string} fieldPath @param {string} selector
 */
function replaceRef(object, fieldPath, selector) {
  const match = /^fields\[(\d+)\]\.ref$/u.exec(fieldPath);
  if (match) {
    const field = { ...object.fields[Number(match[1])] };
    delete field.ref;
    field.selector = selector;
    object.fields = object.fields.map((/** @type {any} */ f, /** @type {number} */ k) =>
      k === Number(match[1]) ? field : f,
    );
    return;
  }
  if (fieldPath === 'ref') {
    delete object.ref;
    object.selector = selector;
    return;
  }
  // `target` fields (`drag.from` / `drag.to`) hold the selector in place.
  object[fieldPath] = selector;
}

/**
 * @typedef {object} ExportResult
 * @property {Record<string, any>} config a batch config with one flow snapshot — parses with `parseConfig`
 * @property {number} count steps exported
 * @property {{ seq: number, command: string, reason: string }[]} skipped what the export left out and why
 */

/**
 * Journal → batch config. Every successful command that exists as a config step becomes one; every
 * ref becomes the selector the engine resolved when the action ran; values from env stay
 * `valueFromEnv`; names batch requires are invented; session-only commands and fields are dropped
 * and listed in `skipped`. A ref WITHOUT a resolved selector is an error, not a silent drop — an
 * export that replays a different flow is worse than none.
 * @param {readonly JournalEntry[]} entries
 * @param {{ name?: string, file?: string, secretValues?: readonly string[] }} [options]
 * @returns {ExportResult}
 */
export function exportFlow(entries, options = {}) {
  // ONE session, the current one. The journal is per session NAME and outlives `close`, a TTL
  // recycle and yesterday, so an export that started from the first `open` in the file replayed a
  // flow nobody ran: the URL of a previous session and its steps in front of the real ones.
  // Lines without `sid` come from an older format — they belong to whatever ran before.
  const sid = [...entries].reverse().find((entry) => typeof entry.sid === 'string')?.sid;
  const current = sid === undefined ? entries : entries.filter((entry) => entry.sid === sid);
  const opened = current.find((entry) => entry.ok && resolveStepName(entry.step?.do) === 'goto');
  if (!opened)
    throw new ExportError('nothing to export: the journal has no successful "open" (browser-inspector open <url>)');
  const startIndex = current.indexOf(opened);

  /** @type {Record<string, any>[]} */
  const steps = [];
  /** @type {ExportResult['skipped']} */
  const skipped = [];
  const used = new Set();
  /** @param {string} prefix */
  const invent = (prefix) => {
    let n = 1;
    while (used.has(`${prefix}-${String(n)}`)) n += 1;
    return `${prefix}-${String(n)}`;
  };

  current.slice(startIndex + 1).forEach((entry, offset) => {
    const seq = entry.seq ?? startIndex + offset + 2;
    const name = resolveStepName(entry.step?.do);
    const command = name ?? String(entry.step?.do ?? entry.command);
    if (name === undefined) {
      skipped.push({ seq, command, reason: 'unknown step' });
      return;
    }
    if (!entry.ok) {
      skipped.push({ seq, command, reason: 'failed in the session' });
      return;
    }
    const def = STEPS[name];
    if (!def.batch || Object.hasOwn(LOOKING_ONLY, name)) {
      skipped.push({ seq, command, reason: LOOKING_ONLY[name] ?? 'session-only' });
      return;
    }
    if (name === 'dialog' && entry.step.action === undefined) {
      skipped.push({ seq, command, reason: 'dialog without a policy only shows the last dialog' });
      return;
    }
    if (name === 'evaluate' && entry.step.file !== undefined) {
      skipped.push({ seq, command, reason: 'eval --file is session-only — a config carries the expression' });
      return;
    }

    /** @type {Step & Record<string, any>} */
    const step = { ...entry.step, do: name };
    for (const field of SESSION_ONLY_FIELDS[name] ?? []) delete step[field];

    for (const field of refFieldsOf(step, def)) {
      const selector = entry.resolved?.[field] ?? (field === 'ref' ? entry.selector : undefined);
      if (typeof selector !== 'string' || selector === '') {
        throw new ExportError(
          `step ${String(seq)} (${describeStep(step)}): ref ${JSON.stringify(readPath(step, field))} (${field}) has no selector resolved at action time — a config cannot carry refs`,
        );
      }
      replaceRef(step, field, selector);
    }

    const prefix = NAMED[name];
    if (prefix !== undefined) {
      if (typeof step.name !== 'string' || used.has(step.name)) step.name = invent(prefix);
      used.add(step.name);
    } else if (typeof step.name === 'string') {
      // `storage --name` / `fetch --name` share the extracts namespace with the named ones.
      if (used.has(step.name)) step.name = invent(step.name);
      used.add(step.name);
    }
    steps.push(step);
  });

  if (steps.length === 0) throw new ExportError('nothing to export: no successful step after "open"');

  const flowName = options.name ?? (options.file ? flowNameFrom(options.file) : 'flow');
  const snapshot = {
    name: flowName,
    type: 'flow',
    url: String(opened.step.url),
    ...(opened.step.waitUntil !== undefined ? { waitUntil: opened.step.waitUntil } : {}),
    steps,
  };
  const problems = validateSteps(steps, 'snapshots[0].steps', { mode: 'batch' });
  if (problems.length > 0) throw new ExportError(`export does not validate:\n  - ${problems.join('\n  - ')}`);
  const config = redactDeep({ snapshots: [snapshot] }, options.secretValues);
  return { config, count: steps.length, skipped };
}

/**
 * Write the exported config as a NEW file — an existing one needs `--force`, because a flow
 * somebody tuned by hand must not vanish under a session's replay.
 * @param {string} file
 * @param {Record<string, any>} config
 * @param {{ force?: boolean }} [options]
 * @returns {string} the absolute path written
 */
export function writeFlowExport(file, config, options = {}) {
  const abs = path.resolve(file);
  if (existsSync(abs) && !options.force) {
    throw new ExportError(`${file} exists — add --force to overwrite it`, 'E_EXISTS');
  }
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  return abs;
}
