#!/usr/bin/env node
// check-glossary.mjs — GLOSSARY.md maps words to identifiers; this gate checks that every identifier
// it names still exists (part of `npm run verify`).
//
// The meaning of a term is written by a human and cannot be verified. The MAPPING can: every
// backticked path in the "gdzie w kodzie" column must be a file or directory in the repository, and a
// `path#Symbol` reference must find `Symbol` in that file. A renamed symbol without a glossary update
// therefore turns the build red instead of quietly teaching the next reader a name that is gone.
//
// Rows are `| termin | znaczenie | gdzie w kodzie | nie mów |`; the third column is the one checked.
// Exit codes: 0 pass · 1 a mapping points at nothing · 2 the glossary or its table is missing.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
export const GLOSSARY_FILE = 'GLOSSARY.md';

/**
 * Every `` `ref` `` inside the third cell of every table body row.
 * @param {string} markdown
 * @returns {{ term: string, ref: string }[]}
 */
export function parseMappings(markdown) {
  /** @type {{ term: string, ref: string }[]} */
  const out = [];
  let inTable = false;
  for (const line of markdown.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('|')) {
      inTable = false;
      continue;
    }
    const cells = trimmed.split('|').map((cell) => cell.trim());
    // A markdown table line `| a | b |` splits into ['', 'a', 'b', ''].
    if (cells.length < 5) continue;
    if (!inTable) {
      // header row, then the separator row on the next line
      inTable = true;
      continue;
    }
    if (/^:?-+:?$/u.test(cells[1])) continue;
    const term = cells[1].replace(/`/gu, '');
    for (const match of cells[3].matchAll(/`([^`]+)`/gu)) out.push({ term, ref: match[1] });
  }
  return out;
}

/**
 * @param {string} repo
 * @param {{ term: string, ref: string }} mapping
 * @returns {string | null} a problem, or null when the reference resolves
 */
export function resolveMapping(repo, { term, ref }) {
  // References that are commands, not paths (`npm run …`, `node …`) are not checked.
  if (/\s/u.test(ref)) return null;
  const [file, symbol] = ref.split('#');
  const target = path.join(repo, file.replace(/\/$/u, ''));
  if (!existsSync(target)) return `${term}: \`${file}\` does not exist`;
  if (symbol) {
    const text = readFileSync(target, 'utf8');
    if (!new RegExp(`\\b${symbol.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}\\b`, 'u').test(text)) {
      return `${term}: \`${file}\` no longer contains \`${symbol}\``;
    }
  }
  return null;
}

/**
 * @param {string} repo
 * @returns {{ ok: boolean, code: number, problems: string[], checked: number }}
 */
export function checkGlossary(repo = REPO) {
  const file = path.join(repo, GLOSSARY_FILE);
  if (!existsSync(file)) return { ok: false, code: 2, problems: [`${GLOSSARY_FILE} is missing`], checked: 0 };
  const mappings = parseMappings(readFileSync(file, 'utf8'));
  if (mappings.length === 0)
    return { ok: false, code: 2, problems: [`${GLOSSARY_FILE} has no table rows with code references`], checked: 0 };
  const problems = mappings.map((mapping) => resolveMapping(repo, mapping)).filter((problem) => problem !== null);
  return {
    ok: problems.length === 0,
    code: problems.length === 0 ? 0 : 1,
    problems: /** @type {string[]} */ (problems),
    checked: mappings.length,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const { ok, code, problems, checked } = checkGlossary();
  if (ok) process.stdout.write(`ok glossary · ${checked} mappings resolve to a live path or symbol\n`);
  else process.stderr.write(`FAIL glossary\n${problems.map((p) => `  · ${p}`).join('\n')}\n`);
  process.exitCode = code;
}
