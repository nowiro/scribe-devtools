// scan.mjs — which directories a tree walk must not enter, and at what depth.
//
// Three scripts walk this repository for three different reasons: `affected.mjs` looks for a
// project's SOURCE (edges and the task hash), `check-pins.mjs` for this repository's TEXT (version
// declarations), `index-code.mjs` for its MODULES (the dependency index). They had three separate
// lists, and the lists had drifted — but the drift was never the dangerous part. The dangerous part
// was shared: every one of them matched a directory by NAME at EVERY depth.
//
// That is silent in both directions. `reports`, `tmp`, `test-results` and `coverage` are names of
// GENERATED directories at the top of a workspace, and equally ordinary names for FEATURE folders
// inside `src/`. Skipping them everywhere hid `apps/<app>/src/app/reports/**` from the dependency
// graph and from the task hash at once — measured: an edit there landed on an unchanged cache marker
// and the task reported `hit … cached` without running.
//
// So the rule is split by depth rather than by list:
//
//   SKIP_ANYWHERE   never source, wherever it appears — nobody keeps hand-written code in a folder
//                   called `node_modules`, `dist` or `.git`
//   SKIP_AT_ROOT    generated, and generated AT THE TOP of the tree being walked; deeper down the
//                   same word is somebody's feature folder
//
// A caller with its own policy passes it as `alsoAnywhere` — that is a decision about what the
// caller indexes, not about what a directory is, and it stays with the caller.

/** Never source, at any depth. */
export const SKIP_ANYWHERE = Object.freeze(['node_modules', 'dist', '.git']);

/**
 * Generated directories, skipped only among the DIRECT CHILDREN of the walk root. Every one of them
 * is written at the top of a workspace by a tool: the Angular CLI cache, the shared `.cache/`
 * GitLab carries between jobs, coverage and test reports, the on-disk output of `alm:read` and
 * `browser-inspector`.
 */
export const SKIP_AT_ROOT = Object.freeze([
  '.angular',
  '.cache',
  '.alm',
  '.browser-inspector',
  '.mcp-artifacts',
  '.vitest',
  'coverage',
  'out-tsc',
  'playwright-report',
  'test-results',
  'reports',
  'blob-report',
  'tmp',
]);

const ANYWHERE = new Set(SKIP_ANYWHERE);
const AT_ROOT = new Set(SKIP_AT_ROOT);

/**
 * Whether a directory named `name`, found `depth` levels below the walk root, must not be entered.
 * @param {string} name directory name, not a path
 * @param {number} depth 0 for a direct child of the walk root
 * @param {Iterable<string>} [alsoAnywhere] the caller's own never-enter names, at any depth
 * @returns {boolean}
 */
export function skipDirectory(name, depth, alsoAnywhere = []) {
  if (ANYWHERE.has(name)) return true;
  for (const extra of alsoAnywhere) if (extra === name) return true;
  return depth === 0 && AT_ROOT.has(name);
}
