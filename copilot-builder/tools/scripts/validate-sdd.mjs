#!/usr/bin/env node
// validate-sdd.mjs — the SDD hygiene gate (0 credits, part of `npm run verify`).
//
// What it checks, and why each check exists:
//   C1  committed artefacts in docs/decisions and docs/reviews are named `YYYY-MM-DD_HH-MM_<slug>.md`
//       and every one of them has a row in docs/INDEX.md — an artefact nobody can find is lost work;
//   C2  no artefact is dated in the future (read in the declared workshop timezone, tools/scripts/stamp.mjs)
//       — a fabricated stamp is the one lie this process cannot recover from;
//   C3  the templates the scaffolder emits from exist and still carry their placeholders;
//   C4  LOCAL artefacts, when present (docs/specs, docs/plans, docs/runs are gitignored): a spec has a
//       front matter with `id: spec.<slug>` matching its directory and a known `status`; a spec marked
//       `clarified` or `done` carries no `[?]`; a plan points at an existing spec and its task table has
//       the required columns; every `agent` in a plan is a roster name from .github/models-registry.json
//       — a plan that names an agent that does not exist is a plan nobody will execute.
//
// Exit codes: 0 pass · 1 violation · 2 environment error (missing INDEX, unreadable registry).
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stampToEpoch } from './stamp.mjs';

const REPO = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const COMMITTED = ['decisions', 'reviews'];
const NAME_RE = /^(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})_[a-z0-9][a-z0-9-]*\.md$/u;
const SPEC_STATUSES = new Set(['draft', 'clarified', 'done']);
const PLAN_COLUMNS = ['id', 'title', 'agent', 'done_when', 'status'];
/** @type {readonly [string, string[]][]} template → placeholders it must keep */
const TEMPLATES = [
  ['spec.md', ['{{slug}}', '{{title}}', '{{verb}}', '{{date}}']],
  ['plan.md', ['{{slug}}', '{{verb}}', '{{stamp}}']],
  ['run.md', ['{{slug}}', '{{verb}}', '{{stamp}}']],
];
/** Room for clock skew between the author's machine and the checking machine. */
const CLOCK_SKEW_MS = 5 * 60_000;

/**
 * Flat front matter reader — `key: value` pairs between the first two `---` lines. No YAML parser:
 * this is a gate, and the templates keep the front matter flat on purpose.
 * @param {string} text
 * @returns {Record<string, string> | null}
 */
export function frontmatter(text) {
  if (!text.startsWith('---')) return null;
  const end = text.indexOf('\n---', 3);
  if (end === -1) return null;
  /** @type {Record<string, string>} */
  const out = {};
  for (const line of text.slice(3, end).split('\n')) {
    const match = /^([A-Za-z_-]+):(.*)$/u.exec(line.trim());
    if (match)
      out[match[1]] = match[2]
        .trim()
        .replace(/^['"]|['"]$/gu, '')
        .trim();
  }
  return out;
}

/**
 * The header cells of the first markdown table in `text`, lower-cased.
 * @param {string} text
 * @returns {string[]}
 */
export function firstTableHeader(text) {
  const line = text.split('\n').find((candidate) => candidate.trim().startsWith('|'));
  if (!line) return [];
  return line
    .split('|')
    .map((cell) => cell.trim().toLowerCase())
    .filter((cell) => cell !== '');
}

/**
 * Values of one column across every body row of the first table whose header names that column.
 * @param {string} text
 * @param {string} column
 * @returns {string[]}
 */
export function tableColumn(text, column) {
  const lines = text.split('\n');
  const headerIndex = lines.findIndex((line) => line.trim().startsWith('|'));
  if (headerIndex === -1) return [];
  const header = lines[headerIndex].split('|').map((cell) => cell.trim().toLowerCase());
  const at = header.indexOf(column);
  if (at === -1) return [];
  /** @type {string[]} */
  const out = [];
  for (const line of lines.slice(headerIndex + 2)) {
    if (!line.trim().startsWith('|')) break;
    const cells = line.split('|').map((cell) => cell.trim());
    if (cells[at] !== undefined) out.push(cells[at]);
  }
  return out;
}

/**
 * Agent names in a plan cell: `code-angular + code-tester-unit`, `—`, `n/a` and backticks tolerated.
 * @param {string} cell
 * @returns {string[]}
 */
export function agentNames(cell) {
  return cell
    .split(/[+,/]/u)
    .map((part) => part.trim().replace(/^`|`$/gu, ''))
    .filter((part) => part !== '' && part !== '—' && part !== '-' && part !== 'n/a');
}

/**
 * C1 + C2 over one committed category.
 * @param {string} repo
 * @param {string} category
 * @param {string} index
 * @param {string[]} problems
 * @returns {number} artefacts seen
 */
function checkCommitted(repo, category, index, problems) {
  const dir = path.join(repo, 'docs', category);
  if (!existsSync(dir)) return 0;
  const now = Date.now();
  let count = 0;
  for (const entry of readdirSync(dir)) {
    if (entry === '.gitkeep') continue;
    count += 1;
    const match = NAME_RE.exec(entry);
    if (!match) {
      problems.push(`C1 docs/${category}/${entry}: name violates YYYY-MM-DD_HH-MM_<slug>.md`);
      continue;
    }
    const stamp = stampToEpoch(
      Number(match[1]),
      Number(match[2]),
      Number(match[3]),
      Number(match[4]),
      Number(match[5]),
    );
    if (stamp > now + CLOCK_SKEW_MS) problems.push(`C2 docs/${category}/${entry}: stamp is in the future`);
    if (!index.includes(entry)) problems.push(`C1 docs/${category}/${entry}: no row in docs/INDEX.md`);
  }
  return count;
}

/**
 * C3 — the scaffolder's templates.
 * @param {string} repo
 * @param {string[]} problems
 */
function checkTemplates(repo, problems) {
  for (const [name, placeholders] of TEMPLATES) {
    const file = path.join(repo, 'docs', 'sdd', 'templates', name);
    if (!existsSync(file)) {
      problems.push(`C3 docs/sdd/templates/${name} is missing — workflow:specify has nothing to emit`);
      continue;
    }
    const text = readFileSync(file, 'utf8');
    for (const placeholder of placeholders) {
      if (!text.includes(placeholder))
        problems.push(`C3 docs/sdd/templates/${name}: placeholder ${placeholder} is gone`);
    }
  }
}

/**
 * C4 — local specs.
 * @param {string} repo
 * @param {string[]} problems
 * @returns {number} specs seen
 */
function checkSpecs(repo, problems) {
  const specsDir = path.join(repo, 'docs', 'specs');
  if (!existsSync(specsDir)) return 0;
  let count = 0;
  for (const slug of readdirSync(specsDir)) {
    const specPath = path.join(specsDir, slug, 'spec.md');
    if (!statSync(path.join(specsDir, slug)).isDirectory() || !existsSync(specPath)) continue;
    count += 1;
    const where = `docs/specs/${slug}/spec.md`;
    const text = readFileSync(specPath, 'utf8');
    const front = frontmatter(text);
    if (!front) {
      problems.push(`C4 ${where}: no front matter`);
      continue;
    }
    if (front.id !== `spec.${slug}`) problems.push(`C4 ${where}: id "${front.id ?? ''}" ≠ spec.${slug}`);
    if (!SPEC_STATUSES.has(front.status ?? ''))
      problems.push(`C4 ${where}: status "${front.status ?? ''}" is not draft|clarified|done`);
    if (front.status !== 'draft' && text.includes('[?]')) {
      problems.push(
        `C4 ${where}: status is ${front.status} but the spec still carries [?] markers — /clarify is not finished`,
      );
    }
  }
  return count;
}

/**
 * C4 — one local plan.
 * @param {string} repo
 * @param {string} entry file name in docs/plans
 * @param {Set<string>} roster
 * @param {string[]} problems
 */
function checkPlan(repo, entry, roster, problems) {
  const where = `docs/plans/${entry}`;
  if (!NAME_RE.test(entry)) problems.push(`C4 ${where}: name violates YYYY-MM-DD_HH-MM_<verb>-<slug>.md`);
  const text = readFileSync(path.join(repo, 'docs', 'plans', entry), 'utf8');
  const front = frontmatter(text);
  const id = /^plan\.[a-z]+\.([a-z0-9-]+)$/u.exec(front?.id ?? '');
  if (!id) {
    problems.push(`C4 ${where}: front matter id must be plan.<verb>.<slug>`);
  } else if (!existsSync(path.join(repo, 'docs', 'specs', id[1], 'spec.md'))) {
    problems.push(`C4 ${where}: points at docs/specs/${id[1]}/spec.md, which does not exist`);
  }
  const header = firstTableHeader(text);
  for (const column of PLAN_COLUMNS) {
    if (!header.includes(column)) problems.push(`C4 ${where}: task table lacks the column "${column}"`);
  }
  for (const cell of tableColumn(text, 'agent')) {
    for (const name of agentNames(cell)) {
      if (!roster.has(name))
        problems.push(`C4 ${where}: agent "${name}" is not in the roster (.github/models-registry.json)`);
    }
  }
}

/**
 * @param {string} repo
 * @returns {{ ok: boolean, code: number, problems: string[], summary: string }}
 */
export function validateSdd(repo = REPO) {
  /** @type {string[]} */
  const problems = [];
  const indexPath = path.join(repo, 'docs', 'INDEX.md');
  if (!existsSync(indexPath)) return { ok: false, code: 2, problems: ['docs/INDEX.md is missing'], summary: '' };
  const registryPath = path.join(repo, '.github', 'models-registry.json');
  if (!existsSync(registryPath)) {
    return { ok: false, code: 2, problems: ['.github/models-registry.json is missing'], summary: '' };
  }
  const index = readFileSync(indexPath, 'utf8');
  const roster = new Set(Object.keys(JSON.parse(readFileSync(registryPath, 'utf8')).agents?.roster ?? {}));

  let committedCount = 0;
  for (const category of COMMITTED) committedCount += checkCommitted(repo, category, index, problems);
  checkTemplates(repo, problems);
  let localCount = checkSpecs(repo, problems);
  const plansDir = path.join(repo, 'docs', 'plans');
  if (existsSync(plansDir)) {
    for (const entry of readdirSync(plansDir).filter((name) => name.endsWith('.md'))) {
      localCount += 1;
      checkPlan(repo, entry, roster, problems);
    }
  }

  const summary = `${committedCount} committed artefacts indexed · ${localCount} local artefacts checked · roster of ${roster.size} agents`;
  return { ok: problems.length === 0, code: problems.length === 0 ? 0 : 1, problems, summary };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const { ok, code, problems, summary } = validateSdd();
  if (ok) process.stdout.write(`ok sdd:check · ${summary}\n`);
  else process.stderr.write(`FAIL sdd:check\n${problems.map((p) => `  · ${p}`).join('\n')}\n`);
  process.exitCode = code;
}
