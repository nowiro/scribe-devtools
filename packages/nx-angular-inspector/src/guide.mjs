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
import { existsSync, readdirSync, statSync } from 'node:fs';
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
 * Guidance that comes as MANY files of one kind rather than one named file: per-area rules, ready
 * prompts, custom agents. Matched by SUFFIX under `.github/`, deliberately not by directory: VS
 * Code points at `.github/instructions` and `.github/prompts` through settings a workspace may
 * move (`chat.instructionsFilesLocations`, `chat.promptFilesLocations`), and an agent plugin keeps
 * its own tree. A hardcoded directory would then report nothing about a workspace that is set up
 * correctly, which is the failure mode this command exists to prevent.
 */
const SUFFIXED = Object.freeze([
  { suffix: '.instructions.md', what: 'reguły per obszar plików (applyTo)' },
  { suffix: '.prompt.md', what: 'gotowy przepływ (/nazwa)' },
  { suffix: '.agent.md', what: 'własny agent tego workspace' },
]);

/**
 * An agent plugin's manifest. Three locations because the format allows a plugin to sit at the
 * repository root or tucked inside `.github/`, and a workspace picks one. The row says only that
 * the plugin is there and how big its manifest is — what it declares is behind the same rule as
 * every other row: paths and cost, never content.
 */
const PLUGIN_MANIFESTS = Object.freeze(['plugin.json', '.github/plugin.json', '.github/plugin/plugin.json']);

/** A runaway guard: `.github/` is small in every healthy repository, and this is not a file finder. */
const GITHUB_SCAN_DEPTH = 3;
const GITHUB_SCAN_LIMIT = 200;

/**
 * Every file under `.github/`, breadth-first, capped. Sorted at each level so two runs on the same
 * tree print the same order — the output is a document a human diffs.
 * @param {string} root
 * @returns {string[]} absolute paths
 */
function githubFiles(root) {
  /** @type {string[]} */
  const out = [];
  /** @type {{ dir: string, depth: number }[]} */
  let level = [{ dir: path.join(root, '.github'), depth: 0 }];
  while (level.length > 0 && out.length < GITHUB_SCAN_LIMIT) {
    /** @type {{ dir: string, depth: number }[]} */
    const next = [];
    for (const { dir, depth } of level) {
      /** @type {import('node:fs').Dirent[]} */
      let entries;
      try {
        entries = readdirSync(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (depth + 1 <= GITHUB_SCAN_DEPTH) next.push({ dir: full, depth: depth + 1 });
        } else if (out.length < GITHUB_SCAN_LIMIT) {
          out.push(full);
        }
      }
    }
    level = next;
  }
  return out;
}

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
  const inGithub = githubFiles(root);
  for (const { suffix, what } of SUFFIXED) {
    for (const file of inGithub) {
      if (file.endsWith(suffix)) docs.push({ file, bytes: sizeOf(file), origin: 'workspace', what });
    }
  }
  for (const rel of PLUGIN_MANIFESTS) {
    const file = path.join(root, ...rel.split('/'));
    if (existsSync(file)) docs.push({ file, bytes: sizeOf(file), origin: 'workspace', what: 'wtyczka agenta' });
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
