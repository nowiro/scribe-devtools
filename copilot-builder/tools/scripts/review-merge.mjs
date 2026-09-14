#!/usr/bin/env node
// review-merge.mjs — three readings of one change, from three model families, into one table (0 credits).
//
//   node tools/scripts/review-merge.mjs <katalog | <rodzina>.md …> [--out <plik>] [--slug <slug>]
//
// Each input is what one review seat returned: a table `| Plik | Linia | Problem | 🔴🟡🟢 | Sugestia |`
// and a verdict `**APPROVED**` / `**APPROVED z uwagami**` / `**NO-GO**`. A directory argument means
// every `*.md` in it. The family is the file's base name (`anthropic.md`) and is checked against
// `review.seats` of the registry: a family that holds no seat, and a seat that sent nothing, are both
// written into the result — the merge never pretends a reading happened.
//
// The merge is arithmetic on purpose: the same file and line from two families is ONE row with the
// worst colour and the count of agreeing families (`3×`, `2×` = confirmed, `1×` = candidate); a 🔴 from
// one family against a 🟢 from another is a conflict listed for the operator, never averaged to 🟡;
// the verdict is the worst of the seats. Without this script the three tables would be merged inside
// the orchestrator's context — the most expensive place in the ladder to count.
//
// Exit codes: 0 merged · 1 an input has no findings table or no verdict · 2 usage error.
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { REPO, isMain } from './lib/repo.mjs';

/** @typedef {'🔴' | '🟡' | '🟢'} Severity */
export const SEVERITY = Object.freeze({ '🔴': 2, '🟡': 1, '🟢': 0 });
/** Verdicts from mildest to worst — the merged verdict is the worst one any seat gave. */
export const VERDICTS = Object.freeze(['APPROVED', 'APPROVED z uwagami', 'NO-GO', 'STOP']);

/** @typedef {{ file: string, line: string, problem: string, severity: Severity, suggestion: string }} Finding */
/** @typedef {{ family: string, verdict: string | null, findings: Finding[], warnings: string[] }} Report */
/**
 * @typedef {object} MergedRow
 * @property {string} file
 * @property {string} line
 * @property {Severity} severity the worst colour any family gave
 * @property {{ family: string, severity: Severity }[]} families who reported it, in registry order
 * @property {string[]} problems distinct wordings
 * @property {string[]} suggestions distinct wordings
 * @property {boolean} conflict a 🔴 next to a 🟢
 */
/** @typedef {{ rows: MergedRow[], verdict: string, seats: { family: string, verdict: string | null }[], warnings: string[] }} Merged */

/**
 * @param {string} cell
 * @returns {Severity | null}
 */
export function severityOf(cell) {
  if (cell.includes('🔴')) return '🔴';
  if (cell.includes('🟡')) return '🟡';
  if (cell.includes('🟢')) return '🟢';
  return null;
}

/** @param {string} cell @returns {string} */
const cleanFile = (cell) => cell.replaceAll('`', '').trim().replaceAll('\\', '/').replace(/^\.\//u, '');

/** @param {string} cell @returns {string} `—` for an empty or "no line" cell */
const cleanLine = (cell) => {
  const value = cell.replaceAll('`', '').trim();
  return value === '' || value === '-' || value === '—' || value.toLowerCase() === 'n/a' ? '—' : value;
};

/**
 * The cells of one markdown table row, trimmed, outer pipes dropped.
 * @param {string} line
 * @returns {string[]}
 */
export function cells(line) {
  const trimmed = line.trim();
  const inner = trimmed.startsWith('|') ? trimmed.slice(1) : trimmed;
  const body = inner.endsWith('|') ? inner.slice(0, -1) : inner;
  // `\|` is a pipe INSIDE a cell (markdown's own escape), not a separator.
  return body.split(/(?<!\\)\|/u).map((cell) => cell.trim().replaceAll('\\|', '|'));
}

/**
 * The first table whose header names Plik and Linia; rows keep the header's column order.
 * @param {string} markdown
 * @returns {{ header: string[], rows: string[][] } | null}
 */
export function findingsTable(markdown) {
  const lines = markdown.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    if (!lines[i].trim().startsWith('|')) continue;
    const header = cells(lines[i]).map((cell) => cell.toLowerCase());
    if (!header.includes('plik') || !header.includes('linia')) continue;
    /** @type {string[][]} */
    const rows = [];
    for (let j = i + 2; j < lines.length && lines[j].trim().startsWith('|'); j += 1) rows.push(cells(lines[j]));
    return { header, rows };
  }
  return null;
}

/**
 * One seat's report → findings and verdict; null when the report has no findings table at all.
 * @param {string} markdown
 * @param {string} family
 * @returns {Report | null}
 */
export function parseReport(markdown, family) {
  const table = findingsTable(markdown);
  if (table === null) return null;
  const column = (/** @type {string} */ name) => table.header.findIndex((cell) => cell.includes(name));
  const iFile = column('plik');
  const iLine = column('linia');
  const iProblem = column('problem');
  const iSeverity = table.header.findIndex((cell) => severityOf(cell) !== null || cell.includes('ocena'));
  const iSuggestion = column('sugest');
  /** @type {string[]} */
  const warnings = [];
  /** @type {Finding[]} */
  const findings = [];
  for (const row of table.rows) {
    const severity = iSeverity === -1 ? null : severityOf(row[iSeverity] ?? '');
    if (severity === null) {
      warnings.push(`${family}: wiersz bez koloru pominięty — ${row[iFile] ?? '?'}`);
      continue;
    }
    findings.push({
      file: cleanFile(row[iFile] ?? ''),
      line: cleanLine(row[iLine] ?? ''),
      problem: (row[iProblem] ?? '').trim(),
      severity,
      suggestion: iSuggestion === -1 ? '' : (row[iSuggestion] ?? '').trim(),
    });
  }
  const verdict = /\*\*(NO-GO|APPROVED z uwagami|APPROVED|STOP)\*\*/u.exec(markdown)?.[1] ?? null;
  if (verdict === null) {
    warnings.push(`${family}: brak werdyktu (**APPROVED** / **APPROVED z uwagami** / **NO-GO**)`);
  }
  return { family, verdict, findings, warnings };
}

/** @param {string} line @returns {number} the leading number of a line cell, or the end for `—` and ranges without a number */
const lineNumber = (line) => Number.parseInt(line, 10) || Number.MAX_SAFE_INTEGER;

/**
 * @param {Report[]} reports
 * @param {readonly string[]} seatFamilies the families the registry expects, in its order
 * @returns {Merged}
 */
export function mergeReviews(reports, seatFamilies) {
  const warnings = reports.flatMap((report) => report.warnings);
  const present = new Set(reports.map((report) => report.family));
  for (const family of seatFamilies) {
    if (!present.has(family)) warnings.push(`brak raportu rodziny ${family} — rejestr ma to miejsce w review.seats`);
  }
  for (const report of reports) {
    if (seatFamilies.length > 0 && !seatFamilies.includes(report.family)) {
      warnings.push(`raport rodziny ${report.family}, która nie ma miejsca w review.seats`);
    }
  }
  const order = (/** @type {string} */ family) => {
    const index = seatFamilies.indexOf(family);
    return index === -1 ? seatFamilies.length : index;
  };

  /** @type {Map<string, MergedRow>} */
  const byKey = new Map();
  for (const report of reports) {
    for (const finding of report.findings) {
      const key = `${finding.file}#${finding.line}`;
      const row = byKey.get(key) ?? {
        file: finding.file,
        line: finding.line,
        severity: /** @type {Severity} */ ('🟢'),
        families: [],
        problems: [],
        suggestions: [],
        conflict: false,
      };
      row.families.push({ family: report.family, severity: finding.severity });
      if (SEVERITY[finding.severity] > SEVERITY[row.severity]) row.severity = finding.severity;
      if (finding.problem !== '' && !row.problems.includes(finding.problem)) row.problems.push(finding.problem);
      if (finding.suggestion !== '' && !row.suggestions.includes(finding.suggestion)) {
        row.suggestions.push(finding.suggestion);
      }
      byKey.set(key, row);
    }
  }
  const rows = [...byKey.values()];
  for (const row of rows) {
    row.families.sort((a, b) => order(a.family) - order(b.family));
    const levels = row.families.map((entry) => SEVERITY[entry.severity]);
    row.conflict = Math.max(...levels) === SEVERITY['🔴'] && Math.min(...levels) === SEVERITY['🟢'];
  }
  rows.sort(
    (a, b) =>
      SEVERITY[b.severity] - SEVERITY[a.severity] ||
      b.families.length - a.families.length ||
      a.file.localeCompare(b.file, 'en') ||
      lineNumber(a.line) - lineNumber(b.line),
  );

  const ranks = reports.map((report) => (report.verdict === null ? -1 : VERDICTS.indexOf(report.verdict)));
  const worst = Math.max(-1, ...ranks);
  const verdict = worst === -1 ? 'brak werdyktu' : VERDICTS[worst];
  const seats = reports
    .map((report) => ({ family: report.family, verdict: report.verdict }))
    .sort((a, b) => order(a.family) - order(b.family));
  return { rows, verdict, seats, warnings };
}

/** @param {string} text @returns {string} a table cell may not contain a raw pipe */
const cell = (text) => text.replaceAll('|', String.raw`\|`);

/**
 * @param {Merged} merged
 * @param {{ slug?: string }} [options]
 * @returns {string} markdown
 */
export function renderMerged(merged, { slug = '' } = {}) {
  const title = slug === '' ? '## Review scalony' : `## Review scalony — ${slug}`;
  const seatsLine = merged.seats.map((seat) => `${seat.family} **${seat.verdict ?? 'brak werdyktu'}**`).join(' · ');
  const rows = merged.rows.map((row) => {
    const sameColour = row.families.every((entry) => entry.severity === row.severity);
    const names = sameColour
      ? row.families.map((entry) => entry.family).join(', ')
      : row.families.map((entry) => `${entry.family} ${entry.severity}`).join(', ');
    const families = `${row.families.length}× ${names}${row.conflict ? ' — konflikt' : ''}`;
    return `| \`${row.file}\` | ${row.line} | ${cell(row.problems.join(' · '))} | ${row.severity} | ${cell(row.suggestions.join(' · '))} | ${families} |`;
  });
  const confirmed = merged.rows.filter((row) => row.families.length >= 2);
  const candidates = merged.rows.filter((row) => row.families.length === 1);
  const conflicts = merged.rows.filter((row) => row.conflict);
  const redConfirmed = confirmed.filter((row) => row.severity === '🔴').length;
  const redCandidates = candidates.filter((row) => row.severity === '🔴').length;
  const summary =
    `**Werdykt scalony: ${merged.verdict}** (najgorszy z ${merged.seats.length}). ` +
    `Potwierdzone (≥ 2 rodziny): ${confirmed.length} · kandydaci (1 rodzina): ${candidates.length} · ` +
    `konflikty 🔴/🟢: ${conflicts.length} · 🔴 potwierdzone: ${redConfirmed} · 🔴 kandydaci do pytania operatora: ${redCandidates}`;
  const parts = [
    title,
    '',
    `Miejsca: ${seatsLine}`,
    '',
    '| Plik | Linia | Problem | 🔴🟡🟢 | Sugestia | Rodziny |',
    '| --- | --- | --- | --- | --- | --- |',
    ...rows,
    '',
    summary,
  ];
  if (conflicts.length > 0) {
    parts.push(
      '',
      '## Konflikty — pytanie do operatora, nie średnia',
      ...conflicts.map(
        (row) =>
          `- \`${row.file}:${row.line}\` — ${row.families.map((entry) => `${entry.family} ${entry.severity}`).join(' / ')}: ${row.problems.join(' · ')}`,
      ),
    );
  }
  if (merged.warnings.length > 0)
    parts.push('', '## Uwagi scalania', ...merged.warnings.map((warning) => `- ${warning}`));
  return `${parts.join('\n')}\n`;
}

/**
 * The families the registry seats, in registry order.
 * @param {string} [repo]
 * @returns {string[]}
 */
export function reviewSeatFamilies(repo = REPO) {
  const file = path.join(repo, '.github', 'models-registry.json');
  if (!existsSync(file)) return [];
  const registry = JSON.parse(readFileSync(file, 'utf8'));
  return Object.values(registry.review?.seats ?? {}).map(String);
}

/**
 * @param {string[]} argv
 * @returns {{ inputs: string[], out: string | null, slug: string }}
 */
export function parseArgs(argv) {
  /** @type {string[]} */
  const inputs = [];
  let out = null;
  let slug = '';
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--out') {
      out = argv[i + 1] ?? null;
      i += 1;
    } else if (arg === '--slug') {
      slug = argv[i + 1] ?? '';
      i += 1;
    } else inputs.push(arg);
  }
  return { inputs, out, slug };
}

/**
 * Files to read: every `*.md` of a directory argument, files as given.
 * @param {string[]} inputs
 * @returns {string[]}
 */
export function expandInputs(inputs) {
  return inputs.flatMap((input) => {
    if (existsSync(input) && statSync(input).isDirectory()) {
      return readdirSync(input)
        .filter((entry) => entry.endsWith('.md'))
        .sort((a, b) => a.localeCompare(b, 'en'))
        .map((entry) => path.join(input, entry));
    }
    return [input];
  });
}

/**
 * @param {string[]} argv
 * @returns {number} exit code
 */
export function runCli(argv) {
  const { inputs, out, slug } = parseArgs(argv);
  const files = expandInputs(inputs);
  if (files.length === 0) {
    process.stderr.write('usage: review:merge <katalog | rodzina.md …> [--out <plik>] [--slug <slug>]\n');
    return 2;
  }
  /** @type {Report[]} */
  const reports = [];
  let unreadable = 0;
  for (const file of files) {
    const family = path.basename(file).replace(/\.md$/u, '');
    if (!existsSync(file)) {
      process.stderr.write(`review:merge: ${file} does not exist\n`);
      unreadable += 1;
      continue;
    }
    const report = parseReport(readFileSync(file, 'utf8'), family);
    if (report === null) {
      process.stderr.write(`review:merge: ${file} has no findings table (| Plik | Linia | … |)\n`);
      unreadable += 1;
      continue;
    }
    reports.push(report);
  }
  if (unreadable > 0) return 1;
  const merged = mergeReviews(reports, reviewSeatFamilies());
  const markdown = renderMerged(merged, { slug });
  if (out === null) process.stdout.write(markdown);
  else {
    writeFileSync(out, markdown, 'utf8');
    process.stdout.write(`ok review:merge · ${reports.length} raporty → ${out} · werdykt ${merged.verdict}\n`);
  }
  for (const warning of merged.warnings) process.stderr.write(`WARN review:merge: ${warning}\n`);
  return reports.some((report) => report.verdict === null) ? 1 : 0;
}

if (isMain(import.meta.url)) process.exitCode = runCli(process.argv.slice(2));
