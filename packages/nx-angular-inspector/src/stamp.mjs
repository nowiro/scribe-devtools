// stamp.mjs — is the cached graph still the truth?
//
//   fresh  ⟺  mtime(graph) ≥ max(mtime over the input set)
//
// The input set is: the root's own configuration; per project its root DIRECTORY, `project.json`
// and `package.json`; a curated list of files that infer targets (vite / vitest / playwright /
// eslint / jest / tsconfig*); and — the part that is easy to leave out and expensive to leave out —
// the PARENT directories of the project roots.
//
// The parents are there to catch a project being ADDED. `mkdir apps/__probe` bumps the mtime of
// `apps/` (verified on NTFS, and so does `rm -rf`), so without that row a brand new project would
// be invisible behind a confident `świeże`.
//
// What this module deliberately does NOT do is ask the Nx daemon. On the machine this was designed
// against, the daemon's pid was dead (ESRCH) and a `disabled` marker had been sitting there for
// weeks, while the graph was two hours old and perfectly current — a CLI call had refreshed it.
// The converse is just as possible: a recycled pid makes `kill(pid, 0)` succeed against a stranger's
// process. Daemon liveness is not evidence of freshness in either direction.
import { statSync } from 'node:fs';
import path from 'node:path';

/** Root-level configuration: any of these moving can change every project in the workspace. */
export const ROOT_INPUTS = Object.freeze([
  'nx.json',
  'angular.json',
  'package.json',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'bun.lockb',
  'pnpm-workspace.yaml',
  'tsconfig.base.json',
  'tsconfig.json',
]);

/**
 * Per-project files that make a plugin infer targets. Curated, and therefore a KNOWN GAP: a plugin
 * keying on a file outside this list will not bump the stamp. That is why `env` prints this list —
 * a gap you can read is a gap you can work around (`--fresh`), a gap you cannot read is a lie.
 */
export const INFERRING_FILES = Object.freeze([
  'project.json',
  'package.json',
  'vite.config.ts',
  'vite.config.js',
  'vite.config.mts',
  'vitest.config.ts',
  'vitest.config.js',
  'vitest.config.mts',
  'playwright.config.ts',
  'playwright.config.js',
  'jest.config.ts',
  'jest.config.js',
  'eslint.config.js',
  'eslint.config.mjs',
  'eslint.config.cjs',
  '.eslintrc.json',
  'tsconfig.json',
  'tsconfig.app.json',
  'tsconfig.lib.json',
  'tsconfig.spec.json',
]);

/**
 * @typedef {object} Stamp
 * @property {'hit' | 'stale' | 'miss' | 'unsupported' | 'forced'} cache
 * @property {number} graphMtime epoch ms, 0 when there is no graph
 * @property {number} newestInput epoch ms, 0 when nothing was readable
 * @property {string | null} newestPath the input that decided a `stale` verdict — the actionable half
 * @property {number} statted how many paths were successfully stat'ed
 */

/**
 * `mtimeMs`, or null when the path is not there. Missing is not an error: half of the input set is
 * conditional by construction (a workspace has one lockfile, not four).
 * @param {string} file
 * @returns {number | null}
 */
export function mtime(file) {
  try {
    return statSync(file).mtimeMs;
  } catch {
    return null;
  }
}

/**
 * Every path whose mtime can invalidate the graph.
 * @param {string} root
 * @param {readonly string[]} projectRoots repo-relative, forward or platform slashes
 * @returns {string[]} absolute paths
 */
export function inputSet(root, projectRoots) {
  /** @type {Set<string>} */
  const paths = new Set(ROOT_INPUTS.map((file) => path.join(root, file)));
  /** @type {Set<string>} */
  const parents = new Set();
  for (const projectRoot of projectRoots) {
    const abs = path.resolve(root, projectRoot);
    paths.add(abs);
    for (const file of INFERRING_FILES) paths.add(path.join(abs, file));
    const parent = path.dirname(abs);
    if (parent !== abs && parent.length >= root.length) parents.add(parent);
  }
  for (const parent of parents) paths.add(parent);
  return [...paths];
}

/**
 * The freshness verdict for a graph read at `graphPath`.
 * @param {object} options
 * @param {string} options.root
 * @param {string} options.graphPath
 * @param {readonly string[]} options.projectRoots
 * @param {boolean} [options.fresh] `--fresh` was passed: the answer came from the CLI, so the
 *   verdict is `forced` and the comparison is not worth doing.
 * @returns {Stamp}
 */
export function stampGraph({ root, graphPath, projectRoots, fresh = false }) {
  if (fresh) return { cache: 'forced', graphMtime: 0, newestInput: 0, newestPath: null, statted: 0 };
  const graphMtime = mtime(graphPath);
  if (graphMtime === null) return { cache: 'miss', graphMtime: 0, newestInput: 0, newestPath: null, statted: 0 };

  let newestInput = 0;
  /** @type {string | null} */
  let newestPath = null;
  let statted = 0;
  for (const file of inputSet(root, projectRoots)) {
    const at = mtime(file);
    if (at === null) continue;
    statted += 1;
    if (at > newestInput) {
      newestInput = at;
      newestPath = file;
    }
  }
  // `>=` and not `>`: a file written in the same millisecond as the graph is the graph's own input,
  // not a change made after it. Sub-millisecond ordering is not observable through `statSync` on
  // every filesystem we support, so the tie goes to the cheaper answer and `--fresh` is the escape.
  const cache = graphMtime >= newestInput ? 'hit' : 'stale';
  return { cache, graphMtime, newestInput, newestPath: cache === 'stale' ? newestPath : null, statted };
}
