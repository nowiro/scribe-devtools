// repo.mjs — what every script in tools/scripts needs and none should re-implement: the repository
// root, the entrypoint guard, JSONC reading and the flat front matter reader of the agent and SDD
// files. Fifteen copies of `path.resolve(fileURLToPath(new URL('../..', import.meta.url)))` and two
// front matter readers that had already drifted apart (one stripped quotes, one did not) are the
// reason this file exists.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

/** Absolute repository root (tools/scripts/lib → three levels up). */
export const REPO = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)));

/**
 * The `docs/` categories whose artefacts are COMMITTED, and therefore policed by `sdd:check` (C1):
 * every entry must be named `YYYY-MM-DD_HH-MM_<slug>.md` and have a row in `docs/INDEX.md`.
 * `docs/specs`, `docs/plans` and `docs/runs` are deliberately absent — they are local-only working
 * material and gitignored.
 *
 * Declared here rather than inside the gate because two scripts now need the same answer: the gate
 * that enforces the naming, and `review-draw.mjs`, which refuses to write a working directory into
 * one of these. A second copy of this list is exactly the drift `lib/repo.mjs` exists to prevent.
 */
export const COMMITTED_DOCS = Object.freeze(['decisions', 'reviews']);

/**
 * Whether the module at `metaUrl` is the script node was started with — the guard that keeps every
 * script importable by its tests without running.
 * @param {string} metaUrl `import.meta.url` of the caller
 * @returns {boolean}
 */
export function isMain(metaUrl) {
  return Boolean(process.argv[1]) && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(metaUrl));
}

/**
 * JSON with comments (tsconfig.json, .vscode/*.json) as plain JSON text: `//` line comments and
 * `/* *\/` block comments removed, string literals left alone.
 *
 * A scanner, not a pair of regular expressions: the regex version read `/*` inside a string — the glob
 * `"**\/tools/hooks/**"` in .vscode/settings.json, a path alias `"@cb/*": ["libs/*"]` — as the start
 * of a comment, ate everything up to the next `*\/` and made `JSON.parse` throw or silently drop keys.
 * A block comment keeps its newlines, so a parse error still points at the right line. An unterminated
 * block comment is left in place for `JSON.parse` to reject, rather than swallowing the rest of the file
 * into a shorter document that parses. Trailing commas stay invalid, as before: no file read here has one.
 * @param {string} text
 * @returns {string}
 */
export function stripJsonComments(text) {
  let out = '';
  let copied = 0;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"') {
      i = endOfString(text, i);
      continue;
    }
    if (ch === '/' && text[i + 1] === '/') {
      out += text.slice(copied, i);
      const newline = text.indexOf('\n', i);
      i = newline === -1 ? text.length : newline;
      copied = i;
      continue;
    }
    if (ch === '/' && text[i + 1] === '*') {
      const close = text.indexOf('*/', i + 2);
      if (close === -1) break;
      out += text.slice(copied, i) + text.slice(i, close + 2).replaceAll(/[^\n]/gu, '');
      i = close + 2;
      copied = i;
      continue;
    }
    i += 1;
  }
  return out + text.slice(copied);
}

/**
 * Index just past the string literal that opens at `start` (a `"`), honouring backslash escapes; the
 * end of the text when the string never closes.
 * @param {string} text
 * @param {number} start
 * @returns {number}
 */
function endOfString(text, start) {
  let i = start + 1;
  while (i < text.length && text[i] !== '"') i += text[i] === '\\' ? 2 : 1;
  return Math.min(i + 1, text.length);
}

/**
 * @param {string} file absolute path
 * @returns {any}
 */
export function readJsonc(file) {
  return JSON.parse(stripJsonComments(readFileSync(file, 'utf8')));
}

/** @param {string} value @returns {string} the value without one pair of surrounding quotes */
export const unquote = (value) => value.trim().replace(/^['"]|['"]$/gu, '');

/**
 * Flat front matter reader: `key: value`, `key: ['a', 'b']`; a nested block (`hooks:`) is detected by
 * key presence only. A gate, not an editor — the files keep it flat on purpose. Values are returned
 * as written; pass `{ unquote: true }` to strip one pair of quotes (the SDD artefacts quote titles).
 * @param {string} text
 * @param {{ unquote?: boolean }} [options]
 * @returns {Record<string, string> | null}
 */
export function frontmatter(text, options = {}) {
  if (!text.startsWith('---')) return null;
  const end = text.indexOf('\n---', 3);
  if (end === -1) return null;
  /** @type {Record<string, string>} */
  const out = {};
  for (const line of text.slice(3, end).split('\n')) {
    const match = /^([A-Za-z_-]+):(.*)$/u.exec(line.trim());
    if (match) out[match[1]] = options.unquote ? unquote(match[2]) : match[2].trim();
  }
  return out;
}
