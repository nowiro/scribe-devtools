#!/usr/bin/env node
// stack.mjs — the tech-stack canon: one AUTOGEN block in docs/tech-stack.md regenerated from
// package.json, so that no version number is ever typed into prose by hand.
//
//   node tools/scripts/stack.mjs sync    rewrite the block (pre-commit does it too)
//   node tools/scripts/stack.mjs check   exit 1 when the block is stale (part of `npm run verify`)
//
// Only the block between the markers is owned by this script; everything else in the file is prose
// a human maintains. The comparison is on DATA (component → version pairs), not on raw text, so a
// hand-realigned table column is not a false alarm.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
export const BEGIN = '<!-- AUTOGEN:STACK BEGIN -->';
export const END = '<!-- AUTOGEN:STACK END -->';

/**
 * Which manifest entries the canon shows — the ones a newcomer asks about, not every package.
 * @type {readonly [string, (pkg: Record<string, any>) => string | undefined][]}
 */
const ROWS = [
  ['node (engines)', (pkg) => pkg.engines?.node],
  ['@angular/core', (pkg) => pkg.dependencies?.['@angular/core']],
  ['@angular/cli', (pkg) => pkg.devDependencies?.['@angular/cli']],
  ['typescript', (pkg) => pkg.devDependencies?.typescript],
  ['vitest', (pkg) => pkg.devDependencies?.vitest],
  ['@playwright/test', (pkg) => pkg.devDependencies?.['@playwright/test']],
  ['eslint', (pkg) => pkg.devDependencies?.eslint],
  ['angular-eslint', (pkg) => pkg.devDependencies?.['angular-eslint']],
  ['@biomejs/biome', (pkg) => pkg.devDependencies?.['@biomejs/biome']],
  ['@commitlint/cli', (pkg) => pkg.devDependencies?.['@commitlint/cli']],
  ['zod', (pkg) => pkg.dependencies?.zod],
  ['playwright-core', (pkg) => pkg.dependencies?.['playwright-core']],
];

/**
 * @param {Record<string, any>} pkg parsed package.json
 * @returns {string} the whole block, markers included
 */
export function renderBlock(pkg) {
  const lines = [BEGIN, '', '| Składnik | Wersja (źródło: package.json) |', '| --- | --- |'];
  for (const [name, pick] of ROWS) {
    const version = pick(pkg);
    if (version) lines.push(`| ${name} | \`${version}\` |`);
  }
  lines.push('', END);
  return lines.join('\n');
}

/**
 * The table rows inside the block as `component=version` pairs — what the check compares.
 * @param {string} text
 * @returns {string}
 */
export function blockData(text) {
  const body = new RegExp(`${BEGIN}([\\s\\S]*?)${END}`, 'u').exec(text)?.[1] ?? '';
  return body
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('|'))
    .map((line) =>
      line
        .split('|')
        .map((cell) => cell.trim())
        .filter(Boolean),
    )
    .filter((cells) => !cells.every((cell) => /^-+$/u.test(cell)))
    .map((cells) => cells.join('='))
    .join('\n');
}

/**
 * @param {'sync' | 'check'} mode
 * @param {string} [repo]
 * @returns {{ code: number, message: string }}
 */
export function runStack(mode, repo = REPO) {
  const stackPath = path.join(repo, 'docs', 'tech-stack.md');
  if (!existsSync(stackPath)) return { code: 1, message: 'FAIL stack: docs/tech-stack.md does not exist' };
  const pkg = JSON.parse(readFileSync(path.join(repo, 'package.json'), 'utf8'));
  const current = readFileSync(stackPath, 'utf8');
  const pattern = new RegExp(`${BEGIN}[\\s\\S]*?${END}`, 'u');
  if (!pattern.test(current))
    return { code: 1, message: `FAIL stack: docs/tech-stack.md lacks the ${BEGIN} … ${END} markers` };
  const updated = current.replace(pattern, renderBlock(pkg));
  if (mode === 'sync') {
    if (updated !== current) {
      writeFileSync(stackPath, updated, 'utf8');
      return { code: 0, message: 'ok stack:sync · AUTOGEN block regenerated in docs/tech-stack.md' };
    }
    return { code: 0, message: 'ok stack:sync · already up to date' };
  }
  if (blockData(updated) !== blockData(current)) {
    return { code: 1, message: 'FAIL stack:check · docs/tech-stack.md is stale — run `npm run stack:sync` and commit' };
  }
  return { code: 0, message: 'ok stack:check · tech-stack canon matches package.json' };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const mode = process.argv[2];
  if (mode !== 'sync' && mode !== 'check') {
    process.stderr.write('usage: node tools/scripts/stack.mjs <sync|check>\n');
    process.exitCode = 2;
  } else {
    const { code, message } = runStack(mode);
    (code === 0 ? process.stdout : process.stderr).write(`${message}\n`);
    process.exitCode = code;
  }
}
