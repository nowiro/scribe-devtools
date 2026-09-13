#!/usr/bin/env node
// check-secrets.mjs — the pre-commit look at STAGED additions for anything that is a credential:
// Atlassian and GitLab tokens (this repository talks to both), GitHub and Slack tokens, AWS keys,
// private keys, and a `token = "…"`-shaped assignment with a long literal. Zero network, a few
// milliseconds. The policy "secrets live in the environment or the user profile" needs one mechanical
// check at the moment a secret could enter history — afterwards only a force push can take it out.
//
//   node tools/scripts/check-secrets.mjs            staged diff (pre-commit)
//   node tools/scripts/check-secrets.mjs <file…>    whole files (ad hoc)
//
// Escape hatch: a line carrying `secrets:ignore` is skipped (documentation quoting the SHAPE of a
// token, a test fixture that is obviously fake).
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { REPO, isMain } from './lib/repo.mjs';

/** @type {readonly [string, RegExp][]} what it is → how it looks */
export const PATTERNS = Object.freeze([
  ['Atlassian API token', /\bATATT3[\w-]{20,}/u],
  ['GitLab personal access token', /\bglpat-[\w-]{20,}/u],
  ['GitHub token', /\bgh[pousr]_[A-Za-z0-9]{36,}/u],
  ['Slack token', /\bxox[abprs]-[\w-]{10,}/u],
  ['AWS access key id', /\bAKIA[0-9A-Z]{16}\b/u],
  ['private key', /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY(?: BLOCK)?-----/u],
  ['credential assignment', /(?:api[_-]?key|[a-z]+[_-]?token|secret|password)\s*[:=]\s*["'][\w+/=.-]{16,}["']/iu],
]);

/** Values a human wrote as an example, not a secret. */
const PLACEHOLDER = /<[^>]+>|\bx{3,}\b|\bexample\b|\bplaceholder\b|\bchangeme\b|\byour[-_ ]/iu;

/**
 * @param {string} text
 * @param {string} [where] label for the findings
 * @returns {string[]} one finding per line, `where:line · kind`
 */
export function findSecrets(text, where = 'input') {
  /** @type {string[]} */
  const findings = [];
  text.split('\n').forEach((line, index) => {
    if (line.includes('secrets:ignore')) return;
    for (const [kind, pattern] of PATTERNS) {
      const match = pattern.exec(line);
      if (match && !(kind === 'credential assignment' && PLACEHOLDER.test(match[0]))) {
        findings.push(`${where}:${index + 1} · ${kind}`);
        break;
      }
    }
  });
  return findings;
}

/**
 * Added lines of the staged diff, grouped by file (`+++ b/<file>` headers, `+` lines).
 * @param {string} repo
 * @returns {Map<string, string>} file → its added lines joined with newlines
 */
export function stagedAdditions(repo = REPO) {
  const result = spawnSync('git', ['diff', '--cached', '--no-color', '-U0', '--', '.', ':!package-lock.json'], {
    cwd: repo,
    encoding: 'utf8',
  });
  /** @type {Map<string, string[]>} */
  const byFile = new Map();
  let current = '';
  for (const line of (result.stdout ?? '').split('\n')) {
    if (line.startsWith('+++ b/')) {
      current = line.slice('+++ b/'.length);
      byFile.set(current, []);
    } else if (line.startsWith('+') && !line.startsWith('+++') && current !== '') {
      byFile.get(current)?.push(line.slice(1));
    }
  }
  return new Map([...byFile].map(([file, lines]) => [file, lines.join('\n')]));
}

if (isMain(import.meta.url)) {
  const files = process.argv.slice(2);
  const sources =
    files.length > 0
      ? new Map(files.map((file) => [file, readFileSync(path.resolve(REPO, file), 'utf8')]))
      : stagedAdditions();
  const findings = [...sources].flatMap(([file, text]) => findSecrets(text, file));
  if (findings.length > 0) {
    process.stderr.write(
      `FAIL check:secrets · ${findings.length} line(s) look like credentials:\n${findings.map((f) => `  ${f}`).join('\n')}\n  Move the value to the environment or ~/.config; append \`secrets:ignore\` only to a line that is provably not a secret.\n`,
    );
    process.exitCode = 1;
  } else {
    process.stdout.write(`ok check:secrets · ${sources.size} file(s), nothing that looks like a credential\n`);
  }
}
