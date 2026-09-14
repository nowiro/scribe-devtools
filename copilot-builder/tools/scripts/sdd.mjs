#!/usr/bin/env node
// sdd.mjs — the SDD tables edited by a script, not by a model (0 credits).
//
//   npm run sdd -- next <plan.md>                                  the task to do now: in-progress first, else the first open task
//   npm run sdd -- brief <plan.md> <id>                            the brief for one task, rendered from the plan row and the spec
//   npm run sdd -- task <plan.md> <id> --status <s> [--commit <sha>]   set the status (one of STATUSES) and/or the commit SHA
//   npm run sdd -- log <run.md> --step <n> --name <krok> --agent <a> --tier <t> --result <text> [--status <s>]
//                                                                  update (or append) one row of the run-log "Kroki" table
//
// Why a script: a plan and a run-log are markdown tables, and a small model asked to "mark T002 done
// and add the SHA" edits the wrong column, drops a pipe or rewrites the whole table from memory. The
// same model asked to compose a brief forgets a field. Here every one of those is a command with a
// fixed output, and the orchestrator's procedure names the command instead of describing the edit.
//
// Exit codes: 0 done · 1 unknown task, unknown file or nothing to do · 2 usage error.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { listCell, parseTable, replaceRows } from './lib/md-table.mjs';
import { REPO, frontmatter, isMain } from './lib/repo.mjs';

export const STATUSES = Object.freeze(['todo', 'in-progress', 'done', 'n/a']);

/** @typedef {{ id: string, title: string, agent: string, paths: string[], doneWhen: string, status: string, ac: string, commit: string }} Task */
/** @typedef {{ table: import('./lib/md-table.mjs').Table, tasks: Task[], slug: string | null }} Plan */

/** @param {string[]} header @returns {boolean} */
const isPlanTable = (header) => header.includes('id') && header.includes('agent') && header.includes('status');
/** @param {string[]} header @returns {boolean} */
const isStepsTable = (header) => header[0] === '#' && header.some((cell) => cell.startsWith('krok'));

/**
 * @param {string} text plan markdown
 * @returns {Plan | null} null when the task table is missing
 */
export function readPlan(text) {
  const table = parseTable(text, isPlanTable);
  if (table === null) return null;
  const at = (/** @type {string} */ name) => table.header.indexOf(name);
  const cell = (/** @type {string[]} */ row, /** @type {string} */ name) =>
    at(name) === -1 ? '' : (row[at(name)] ?? '');
  const tasks = table.rows.map((row) => ({
    id: cell(row, 'id'),
    title: cell(row, 'title'),
    agent: cell(row, 'agent'),
    paths: listCell(cell(row, 'paths')),
    doneWhen: cell(row, 'done_when'),
    status: cell(row, 'status'),
    ac: cell(row, 'ac'),
    commit: cell(row, 'commit'),
  }));
  const id = /^plan\.[a-z]+\.([a-z0-9-]+)$/u.exec(frontmatter(text, { unquote: true })?.id ?? '');
  return { table, tasks, slug: id ? id[1] : null };
}

/**
 * The task to work on: the one in progress, else the first open one.
 * @param {readonly Task[]} tasks
 * @returns {Task | null}
 */
export function nextTask(tasks) {
  return tasks.find((task) => task.status === 'in-progress') ?? tasks.find((task) => task.status === 'todo') ?? null;
}

/**
 * The AC lines of a spec, keyed by number: every line of the "Kryteria akceptacji" section that
 * names `AC<n>`, list markers stripped.
 * @param {string} specText
 * @returns {Map<number, string>}
 */
export function acLines(specText) {
  /** @type {Map<number, string>} */
  const out = new Map();
  const section = /##\s+Kryteria akceptacji\s*\n([\s\S]*?)(?:\n##\s|$)/u.exec(specText)?.[1] ?? '';
  for (const raw of section.split('\n')) {
    const line = raw.replace(/^\s*(?:[-*]|\d+\.)\s*/u, '').trim();
    const match = /\bAC(\d+)\b/u.exec(line);
    if (match && !out.has(Number(match[1]))) out.set(Number(match[1]), line);
  }
  return out;
}

/**
 * The AC field of a brief: the spec's own wording for the numbers the plan row names, or the row's
 * cell plus a pointer when the spec does not spell them out.
 * @param {Task} task
 * @param {Map<number, string>} lines
 * @param {string} specPath
 * @returns {string}
 */
export function acField(task, lines, specPath) {
  const all = /wszystkie/iu.test(task.ac);
  const wanted = all ? [...lines.keys()] : [...task.ac.matchAll(/AC(\d+)/gu)].map((match) => Number(match[1]));
  const found = wanted.filter((n) => lines.has(n)).map((n) => lines.get(n));
  if (found.length > 0) return found.join(' · ');
  return task.ac === '' || task.ac === '—'
    ? `— (zadanie bez AC; spec: ${specPath})`
    : `${task.ac} — treść w ${specPath}`;
}

/**
 * @param {Task} task
 * @param {string} ac the rendered AC field
 * @returns {string} the brief, in the one shape the orchestrator delegates with
 */
export function renderBrief(task, ac) {
  const files =
    task.paths.length > 0
      ? task.paths.join(', ')
      : '— (zadanie bez plików: brief dla agenta tylko-odczyt albo uzupełnij kolumnę paths)';
  const budget = `${Math.max(task.paths.length, 1)} plików, 2 próby`;
  const gate = task.doneWhen.replaceAll('`', '');
  return [
    `AGENT:    ${task.agent}`,
    `ZADANIE:  ${task.id} — ${task.title}`,
    `PLIKI:    ${files}`,
    `AC:       ${ac}`,
    `BRAMA:    ${gate}`,
    `BUDŻET:   ${budget}`,
    'ZWRÓĆ:    PLIKI: <lista> · BRAMA: ok | FAIL + 10 linii · UWAGI: <zdanie> | brak',
    'NIE:      nie commituj, nie edytuj plików spoza PLIKI, nie pytaj o historię rozmowy',
  ].join('\n');
}

/**
 * The plan with one task's status and/or commit changed.
 * @param {string} text
 * @param {string} id
 * @param {{ status?: string, commit?: string }} change
 * @returns {{ text: string, task: Task } | null} null when the task table or the id is missing
 */
export function updateTask(text, id, change) {
  const plan = readPlan(text);
  if (plan === null) return null;
  const index = plan.tasks.findIndex((task) => task.id === id);
  if (index === -1) return null;
  const rows = plan.table.rows.map((row) => [...row]);
  const set = (/** @type {string} */ column, /** @type {string} */ value) => {
    const at = plan.table.header.indexOf(column);
    if (at !== -1) rows[index][at] = value;
  };
  if (change.status !== undefined) set('status', change.status);
  if (change.commit !== undefined) set('commit', change.commit);
  const next = replaceRows(text, plan.table, rows);
  const task = /** @type {Plan} */ (readPlan(next)).tasks[index];
  return { text: next, task };
}

/**
 * @typedef {object} LogEntry
 * @property {string} step the `#` cell
 * @property {string} [name] the `krok (SDD)` cell
 * @property {string} [agent]
 * @property {string} [tier]
 * @property {string} [result]
 * @property {string} [status]
 */

/**
 * The run-log with one "Kroki" row updated — or appended when no row carries that step number.
 * @param {string} text
 * @param {LogEntry} entry
 * @returns {string | null} null when the run-log has no "Kroki" table
 */
export function updateLog(text, entry) {
  const table = parseTable(text, isStepsTable);
  if (table === null) return null;
  const width = table.header.length;
  const columns = { name: 1, agent: 2, tier: 3, result: 4, status: 5 };
  const rows = table.rows.map((row) => [...row]);
  let row = rows.find((candidate) => candidate[0] === entry.step);
  if (!row) {
    row = Array.from({ length: width }, () => '');
    row[0] = entry.step;
    row[columns.status] = 'done';
    rows.push(row);
  }
  for (const [key, at] of Object.entries(columns)) {
    const value = entry[/** @type {keyof LogEntry} */ (key)];
    if (value !== undefined && at < width) row[at] = value;
  }
  return replaceRows(text, table, rows);
}

/**
 * @param {string[]} argv
 * @returns {{ command: string, positional: string[], flags: Record<string, string> }}
 */
export function parseArgs(argv) {
  const [command = '', ...rest] = argv;
  /** @type {string[]} */
  const positional = [];
  /** @type {Record<string, string>} */
  const flags = {};
  for (let i = 0; i < rest.length; i += 1) {
    if (rest[i].startsWith('--')) {
      flags[rest[i].slice(2)] = rest[i + 1] ?? '';
      i += 1;
    } else positional.push(rest[i]);
  }
  return { command, positional, flags };
}

const USAGE = [
  'usage:',
  '  sdd next <plan.md>',
  '  sdd brief <plan.md> <id>',
  '  sdd task <plan.md> <id> --status <todo|in-progress|done|n/a> [--commit <sha>]',
  '  sdd log <run.md> --step <n> [--name <krok>] [--agent <a>] [--tier <t>] [--result <text>] [--status <s>]',
  '',
].join('\n');

/** @param {string} file @returns {string} */
const resolve = (file) => (path.isAbsolute(file) ? file : path.join(REPO, file));

/**
 * @param {string[]} argv
 * @returns {number} exit code
 */
export function runCli(argv) {
  const { command, positional, flags } = parseArgs(argv);
  const file = positional[0] === undefined ? null : resolve(positional[0]);
  if (file === null || !['next', 'brief', 'task', 'log'].includes(command)) {
    process.stderr.write(USAGE);
    return 2;
  }
  if (!existsSync(file)) {
    process.stderr.write(`sdd ${command}: ${positional[0]} does not exist\n`);
    return 1;
  }
  const text = readFileSync(file, 'utf8');

  if (command === 'log') {
    if (flags.step === undefined) {
      process.stderr.write(USAGE);
      return 2;
    }
    const next = updateLog(text, { step: flags.step, ...flags });
    if (next === null) {
      process.stderr.write(`sdd log: ${positional[0]} has no "Kroki" table\n`);
      return 1;
    }
    writeFileSync(file, next, 'utf8');
    process.stdout.write(`ok sdd log · step ${flags.step} in ${positional[0]}\n`);
    return 0;
  }

  const plan = readPlan(text);
  if (plan === null) {
    process.stderr.write(`sdd ${command}: ${positional[0]} has no task table\n`);
    return 1;
  }
  if (command === 'next') {
    const task = nextTask(plan.tasks);
    if (task === null) {
      process.stdout.write('sdd next: no task left (every task is done or n/a)\n');
      return 1;
    }
    process.stdout.write(`${task.id}  ${task.agent}  ${task.status}  ${task.title}\n`);
    return 0;
  }
  const id = positional[1];
  const task = plan.tasks.find((candidate) => candidate.id === id);
  if (id === undefined || task === undefined) {
    process.stderr.write(
      `sdd ${command}: unknown task id "${id ?? ''}" (ids: ${plan.tasks.map((t) => t.id).join(', ')})\n`,
    );
    return 1;
  }
  if (command === 'brief') {
    const specPath = plan.slug === null ? 'docs/specs/<slug>/spec.md' : `docs/specs/${plan.slug}/spec.md`;
    const specFile = path.join(REPO, specPath);
    const lines = existsSync(specFile) ? acLines(readFileSync(specFile, 'utf8')) : new Map();
    process.stdout.write(`${renderBrief(task, acField(task, lines, specPath))}\n`);
    return 0;
  }
  // task
  if (flags.status !== undefined && !STATUSES.includes(flags.status)) {
    process.stderr.write(`sdd task: status must be one of ${STATUSES.join(' | ')}\n`);
    return 2;
  }
  if (flags.status === undefined && flags.commit === undefined) {
    process.stderr.write(USAGE);
    return 2;
  }
  const updated = updateTask(text, id, { status: flags.status, commit: flags.commit });
  if (updated === null) return 1;
  writeFileSync(file, updated.text, 'utf8');
  process.stdout.write(`ok sdd task · ${id} status=${updated.task.status} commit=${updated.task.commit || '—'}\n`);
  return 0;
}

if (isMain(import.meta.url)) process.exitCode = runCli(process.argv.slice(2));
