#!/usr/bin/env node
// guard-forbidden.mjs — the things this repository has decided NOT to have (part of `npm run verify`).
//
// Each entry is a decision recorded in docs/decisions/, not a taste: a second assistant's config
// doubles the always-on context; GitHub Actions would be a second CI next to GitLab; Nx and Prettier
// were weighed and declined; Husky is replaced by .githooks; a live `.mcp.json` would put tool
// schemas into every session. The guard turns each decision from prose into a red gate.
//
// Exit codes: 0 pass · 1 something forbidden is present.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

/** @type {readonly [string, string][]} path → why it is forbidden */
export const FORBIDDEN_PATHS = Object.freeze([
  ['CLAUDE.md', 'the repository supports GitHub Copilot only — one assistant, one always-on context'],
  ['GEMINI.md', 'the repository supports GitHub Copilot only'],
  ['.claude', 'the repository supports GitHub Copilot only'],
  ['.cursor', 'the repository supports GitHub Copilot only'],
  ['.codex', 'the repository supports GitHub Copilot only'],
  ['.ai', 'the repository supports GitHub Copilot only'],
  ['.mcp.json', 'MCP servers are declared in .vscode/mcp.json and used only through mcp-gateway'],
  ['.github/workflows', 'CI runs on GitLab (.gitlab-ci.yml); a second CI is a second place for the gates to drift'],
  ['nx.json', 'no Nx by decision (docs/decisions) — Angular CLI workspace plus tools/scripts/affected.mjs'],
  ['.nx', 'no Nx by decision'],
  ['.husky', 'native hooks in .githooks/, armed by npm run prepare'],
  ['.prettierrc', 'Biome is the only formatter (biome.jsonc)'],
  ['.prettierrc.json', 'Biome is the only formatter (biome.jsonc)'],
  ['prettier.config.mjs', 'Biome is the only formatter (biome.jsonc)'],
  ['prettier.config.js', 'Biome is the only formatter (biome.jsonc)'],
  ['.prettierignore', 'Biome is the only formatter (biome.jsonc)'],
  ['pnpm-lock.yaml', 'npm is the package manager — one lockfile, package-lock.json'],
  ['yarn.lock', 'npm is the package manager — one lockfile, package-lock.json'],
]);

/** Package names whose presence in the manifest contradicts a recorded decision. */
export const FORBIDDEN_PACKAGES = Object.freeze([
  'nx',
  'nx-cloud',
  '@nx/workspace',
  'prettier',
  'husky',
  'lint-staged',
]);

/**
 * @param {string} repo
 * @returns {{ ok: boolean, problems: string[] }}
 */
export function guardForbidden(repo = REPO) {
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
  return { ok: problems.length === 0, problems };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const { ok, problems } = guardForbidden();
  if (ok)
    process.stdout.write(
      `ok guard:forbidden · ${FORBIDDEN_PATHS.length} paths and ${FORBIDDEN_PACKAGES.length} packages absent\n`,
    );
  else process.stderr.write(`FAIL guard:forbidden\n${problems.map((p) => `  · ${p}`).join('\n')}\n`);
  process.exitCode = ok ? 0 : 1;
}
