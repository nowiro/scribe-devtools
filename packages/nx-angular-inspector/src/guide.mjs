// guide.mjs — where the guidance for THIS workspace lives, and what reading it costs.
//
// This replaces `get_best_practices` and the useful half of `ai_tutor`. The contract is the part
// worth stating twice: it prints PATHS AND THEIR COST, never the content. `best-practices.md` is
// 2 849 B; whether that is worth spending on the question at hand is the caller's decision, and a
// server that answers it by pasting the file has already taken the decision away.
//
// Cost is reported in bytes, not tokens. A token count would need a tokenizer, this package has
// zero runtime dependencies on purpose, and a guessed token number in a repository that measures
// tokens for a living would be worse than no number at all.
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * @typedef {object} Doc
 * @property {string} file absolute
 * @property {number} bytes
 * @property {string} origin what shipped it
 * @property {string} what one line, ours — the file itself rarely says
 */

/**
 * Guidance shipped inside installed packages. Probed by path rather than resolved through a
 * manifest field: the field names have changed between Angular releases, the file names have not,
 * and a probe that misses is a missing row rather than a crash.
 */
const PACKAGED = Object.freeze([
  { id: '@angular/core', rel: 'best-practices.md', what: 'zasady pisania Angulara od zespołu Angulara' },
  { id: '@angular/core', rel: 'llms/best-practices.md', what: 'zasady pisania Angulara od zespołu Angulara' },
  { id: '@angular/core', rel: 'ai/best-practices.md', what: 'zasady pisania Angulara od zespołu Angulara' },
  { id: '@angular/cli', rel: 'llms.txt', what: 'indeks dokumentacji CLI dla modeli' },
  { id: 'nx', rel: 'llms.txt', what: 'indeks dokumentacji Nx dla modeli' },
]);

/** Guidance the workspace itself keeps for agents. These are the ones an agent should read first. */
const WORKSPACE = Object.freeze([
  { rel: 'AGENTS.md', what: 'instrukcje tego workspace dla agentów' },
  { rel: 'CLAUDE.md', what: 'instrukcje tego workspace dla agentów' },
  { rel: '.github/copilot-instructions.md', what: 'instrukcje tego workspace dla Copilota' },
  { rel: 'CONTRIBUTING.md', what: 'zasady wnoszenia zmian' },
]);

/**
 * Every guidance document that actually exists, workspace-owned first — the caller's own rules
 * outrank a framework's defaults, and the order of the list is the order to read them in.
 * @param {string} root
 * @returns {Doc[]}
 */
export function findGuides(root) {
  /** @type {Doc[]} */
  const docs = [];
  for (const { rel, what } of WORKSPACE) {
    const file = path.join(root, rel);
    if (existsSync(file)) docs.push({ file, bytes: sizeOf(file), origin: 'workspace', what });
  }
  /** @type {Set<string>} */
  const seenOrigins = new Set();
  for (const { id, rel, what } of PACKAGED) {
    // One document per package: Angular has moved `best-practices.md` between three locations
    // across releases and a workspace mid-upgrade can hold two copies. The first probe that hits is
    // the one the installed version means.
    if (seenOrigins.has(id)) continue;
    const file = path.join(root, 'node_modules', ...id.split('/'), ...rel.split('/'));
    if (!existsSync(file)) continue;
    seenOrigins.add(id);
    docs.push({ file, bytes: sizeOf(file), origin: id, what });
  }
  return docs;
}

/** @param {string} file @returns {number} */
function sizeOf(file) {
  try {
    return statSync(file).size;
  } catch {
    return 0;
  }
}
