#!/usr/bin/env node
// guard-forbidden.mjs — the things this repository has decided NOT to have (part of `npm run verify`).
//
// Each entry is a decision recorded in docs/decisions/, not a taste: a second assistant's config
// doubles the always-on context; GitHub Actions would be a second CI next to GitLab; Nx and Prettier
// were weighed and declined, Biome was replaced by oxfmt; Husky is replaced by .githooks; a live `.mcp.json` would put tool
// schemas into every session; and a vendored tool carries the name of what it DOES, not the brand of
// where it came from — a company adopts this tree as its own, and an upstream name in a path, a
// Vitest project or a provenance line stamped into its Jira is noise to them and a leak of origin.
// The guard turns each decision from prose into a red gate.
//
// Exit codes: 0 pass · 1 something forbidden is present.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { REPO, isMain } from './lib/repo.mjs';

/** @type {readonly [string, string][]} path → why it is forbidden */
export const FORBIDDEN_PATHS = Object.freeze([
  ['CLAUDE.md', 'the repository supports GitHub Copilot only — one assistant, one always-on context'],
  ['GEMINI.md', 'the repository supports GitHub Copilot only'],
  ['.claude', 'the repository supports GitHub Copilot only'],
  ['.cursor', 'the repository supports GitHub Copilot only'],
  ['.codex', 'the repository supports GitHub Copilot only'],
  ['.opencode', 'the repository supports GitHub Copilot only'],
  ['.gemini', 'the repository supports GitHub Copilot only'],
  ['.ai', 'the repository supports GitHub Copilot only'],
  ['.mcp.json', 'MCP servers are declared in .vscode/mcp.json and used only through mcp-gateway'],
  ['.github/workflows', 'CI runs on GitLab (.gitlab-ci.yml); a second CI is a second place for the gates to drift'],
  ['nx.json', 'no Nx by decision (docs/decisions) — Angular CLI workspace plus tools/scripts/affected.mjs'],
  ['.nx', 'no Nx by decision'],
  ['.husky', 'native hooks in .githooks/, armed by npm run prepare'],
  ['.prettierrc', 'oxfmt is the only formatter (.oxfmtrc.jsonc)'],
  ['.prettierrc.json', 'oxfmt is the only formatter (.oxfmtrc.jsonc)'],
  ['prettier.config.mjs', 'oxfmt is the only formatter (.oxfmtrc.jsonc)'],
  ['prettier.config.js', 'oxfmt is the only formatter (.oxfmtrc.jsonc)'],
  ['.prettierignore', 'oxfmt is the only formatter (.oxfmtrc.jsonc)'],
  ['biome.json', 'oxfmt replaced Biome (docs/decisions) — a second formatter would fight it over the same files'],
  ['biome.jsonc', 'oxfmt replaced Biome (docs/decisions) — a second formatter would fight it over the same files'],
  ['pnpm-lock.yaml', 'npm is the package manager — one lockfile, package-lock.json'],
  ['yarn.lock', 'npm is the package manager — one lockfile, package-lock.json'],
]);

/** Package names whose presence in the manifest contradicts a recorded decision. */
export const FORBIDDEN_PACKAGES = Object.freeze([
  'nx',
  'nx-cloud',
  '@nx/workspace',
  'prettier',
  '@biomejs/biome',
  'husky',
  'lint-staged',
]);

/**
 * Words no tracked file may carry — in its path or its text, as a whole word, in any case. A word
 * glued to letters or digits is a different word (`describe`, `subscribes` pass); a dot, slash,
 * dash or underscore is a boundary (`.<word>/`, `<word>-devtools`, `<WORD>_TOKEN` fail). The one line
 * that has to quote a word (this list, its spec) carries `forbidden:ignore`. Rename FIRST, add the
 * word SECOND — the other order leaves `verify` red until the rename lands.
 * @type {readonly [string, string][]} word → why it is forbidden
 */
export const FORBIDDEN_WORDS = Object.freeze([
  ['scribe', 'upstream tool name — the ALM tool is `alm` here (tools/alm, .alm/); ADR neutral-tool-names'], // forbidden:ignore
  ['nowiro', 'the upstream owner name; docs/decisions, ADR neutral-tool-names'], // forbidden:ignore
]);

/** Marker that exempts one line from the word scan. */
export const IGNORE_MARK = 'forbidden:ignore';

/** @param {string} word @returns {RegExp} */
const wholeWord = (word) => new RegExp(`(?<![\\p{L}\\p{N}])${word}(?![\\p{L}\\p{N}])`, 'iu');

/**
 * Every forbidden word in `file`'s path and in every line of `text`, as `file:line · word — why`.
 * @param {string} text
 * @param {string} file repository-relative path, forward slashes
 * @returns {string[]}
 */
export function findForbiddenWords(text, file) {
  /** @type {string[]} */
  const out = [];
  const rules = FORBIDDEN_WORDS.map(([word, why]) => ({ word, why, pattern: wholeWord(word) }));
  for (const { word, why, pattern } of rules) {
    if (pattern.test(file)) out.push(`${file} · path carries \`${word}\` — ${why}`);
  }
  for (const [index, line] of text.split('\n').entries()) {
    if (line.includes(IGNORE_MARK)) continue;
    for (const { word, why, pattern } of rules) {
      if (pattern.test(line)) out.push(`${file}:${index + 1} · \`${word}\` — ${why}`);
    }
  }
  return out;
}

/**
 * The paths git tracks in `repo` — the tree as it will be cloned, not the working tree with its
 * ignored snapshots and caches. `null` when git cannot answer (no repository): the caller reports
 * that rather than passing over a tree it never scanned.
 * @param {string} repo
 * @returns {string[] | null}
 */
export function trackedFiles(repo) {
  const result = spawnSync('git', ['ls-files', '-z'], { cwd: repo, encoding: 'utf8' });
  if (result.status !== 0) return null;
  return result.stdout.split('\0').filter(Boolean);
}

/** A NUL byte in the first 8 KiB is how git itself tells a binary from text. */
const isBinary = (/** @type {Buffer} */ buffer) => buffer.subarray(0, 8192).includes(0);

/**
 * @param {string} repo
 * @param {string[] | null} [files] tracked paths to scan for words; defaults to `git ls-files` of `repo`
 * @returns {{ ok: boolean, problems: string[], scanned: number }}
 */
export function guardForbidden(repo = REPO, files = trackedFiles(repo)) {
  /** @type {string[]} */
  const problems = [];
  for (const [rel, why] of FORBIDDEN_PATHS) {
    if (existsSync(path.join(repo, rel))) problems.push(`${rel} exists — ${why}`);
  }
  const manifestPath = path.join(repo, 'package.json');
  if (existsSync(manifestPath)) {
    const pkg = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const declared = new Set([...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})]);
    for (const name of FORBIDDEN_PACKAGES) {
      if (declared.has(name))
        problems.push(`package.json declares ${name} — contradicts a recorded decision (docs/decisions)`);
    }
    const scripts = JSON.stringify(pkg.scripts ?? {});
    if (/\bnpx\s+(?!--no\b)/u.test(scripts)) {
      problems.push('package.json scripts call `npx` — pin the tool in devDependencies and call its binary directly');
    }
  }
  let scanned = 0;
  if (files === null) {
    problems.push('git ls-files failed — the forbidden-word scan needs a git checkout');
  } else {
    for (const rel of files) {
      const file = path.join(repo, rel);
      // Still in the index, gone from the working tree: nothing to read, `git status` shows it.
      if (!existsSync(file)) continue;
      const buffer = readFileSync(file);
      if (isBinary(buffer)) continue;
      scanned += 1;
      problems.push(...findForbiddenWords(buffer.toString('utf8'), rel));
    }
  }
  return { ok: problems.length === 0, problems, scanned };
}

if (isMain(import.meta.url)) {
  const { ok, problems, scanned } = guardForbidden();
  if (ok)
    process.stdout.write(
      `ok guard:forbidden · ${FORBIDDEN_PATHS.length} paths and ${FORBIDDEN_PACKAGES.length} packages absent · ${FORBIDDEN_WORDS.length} words absent from ${scanned} tracked files\n`,
    );
  else process.stderr.write(`FAIL guard:forbidden\n${problems.map((p) => `  · ${p}`).join('\n')}\n`);
  process.exitCode = ok ? 0 : 1;
}
