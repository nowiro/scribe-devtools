// stamp.mjs — is the cached graph still the truth?
//
//   fresh  ⟺  mtime(graph) ≥ max(mtime over the input set)
//
// WHAT THE INPUT SET CAN AND CANNOT SEE — measured, not assumed:
//
//   root configuration            nx.json, angular.json, lockfiles, tsconfig.base.json …
//   every project's own files     project.json, package.json, the inferring configs
//   every ANCESTOR directory      up to the workspace root, so a project added ANYWHERE moves it
//   every directory BELOW a root  recursively, ~18 ms for 243 directories
//
// A directory's mtime moves when an entry is added, removed or renamed — verified on NTFS — so the
// recursive directory sweep catches a new source file, a deleted one, and a new project. It does
// NOT move when an existing file's CONTENT changes, and that is the honest limit of the cheap
// stamp: editing an `import` inside a file that already exists changes an edge in the graph and
// moves nothing here.
//
// That case needs file mtimes, which cost 275 ms for 20 000 files against 18 ms for the directories
// alone (both measured on this machine). So it is `--deep`, not the default, and `env` prints the
// gap next to the flag that closes it. A gap you can read is one you can work around; a gap you
// cannot read is a confident lie.
//
// What this module deliberately does NOT do is ask the Nx daemon. On the machine this was designed
// against, the daemon's pid was dead (ESRCH) and a `disabled` marker had been sitting there for
// weeks, while the graph was two hours old and perfectly current — a CLI call had refreshed it.
// The converse is just as possible: a recycled pid makes `kill(pid, 0)` succeed against a
// stranger's process. Daemon liveness is not evidence of freshness in either direction.
import { readdirSync, statSync } from 'node:fs';
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
 * keying on a file outside this list will not bump the stamp by itself. The recursive directory
 * sweep covers its CREATION; only a later edit of its contents is invisible without `--deep`.
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

/** Never walked: installed, generated, or our own output. A dot-directory is skipped as a class. */
export const SKIP_DIRS = new Set(['node_modules', 'dist', 'out', 'coverage', 'tmp', 'build']);

/**
 * A graph timestamp this far ahead of the wall clock is not a timestamp we can compare against.
 * It happens: a VM whose clock was corrected by NTP afterwards, a restore from an archive that
 * preserved times, a network share. Without this guard the comparison is trivially satisfied and
 * the tool answers `świeże` to every question for as long as the skew lasts.
 */
export const FUTURE_TOLERANCE_MS = 60_000;

/**
 * @typedef {object} Stamp
 * @property {'hit' | 'stale' | 'miss' | 'unsupported' | 'forced'} cache
 * @property {number} graphMtime epoch ms, 0 when there is no graph
 * @property {number} newestInput epoch ms, 0 when nothing was readable
 * @property {string | null} newestPath the input that decided a `stale` verdict — the actionable half
 * @property {number} statted how many paths were successfully stat'ed
 * @property {boolean} deep whether source file contents were included
 * @property {string} note '' or a plain-language reason the verdict is not what it looks like
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

/** Runaway guards for a symlinked or pathological tree. */
const DIR_LIMIT = 20_000;
const FILE_LIMIT = 200_000;

/**
 * ONE sweep below `from`: every directory and, with `files`, every file too, skipping installed
 * and generated trees. One `readdirSync` per directory — `--deep` used to walk the same tree three
 * times (the directory list, the same list again inside `filesUnder`, then one more readdir per
 * directory for its files).
 * @param {string} from
 * @param {{ files: boolean, dirLimit?: number, fileLimit?: number }} options
 * @returns {{ dirs: string[], files: string[] }}
 */
function sweep(from, { files, dirLimit = DIR_LIMIT, fileLimit = FILE_LIMIT }) {
  /** @type {string[]} */
  const dirs = [];
  /** @type {string[]} */
  const found = [];
  /** @type {string[]} */
  const stack = [from];
  while (stack.length > 0 && dirs.length < dirLimit && (!files || found.length < fileLimit)) {
    const dir = /** @type {string} */ (stack.pop());
    dirs.push(dir);
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
        stack.push(path.join(dir, entry.name));
      } else if (files && found.length < fileLimit && !entry.name.startsWith('.')) {
        found.push(path.join(dir, entry.name));
      }
    }
  }
  return { dirs, files: found };
}

/**
 * Every directory at or below `from`, skipping installed and generated trees.
 * @param {string} from
 * @param {number} [limit] a runaway guard for a symlinked or pathological tree
 * @returns {string[]}
 */
export function directoriesUnder(from, limit = DIR_LIMIT) {
  return sweep(from, { files: false, dirLimit: limit }).dirs;
}

/**
 * Every FILE at or below `from` — the `--deep` half. Separated so the cost is opt-in and visible.
 * @param {string} from
 * @param {number} [limit]
 * @returns {string[]}
 */
export function filesUnder(from, limit = FILE_LIMIT) {
  return sweep(from, { files: true, fileLimit: limit }).files;
}

/**
 * Whether `child` is inside `parent` along a path the sweep would have walked — so its own sweep
 * would only repeat `readdirSync` calls already made. A child behind a skipped directory (`dist/`,
 * a dot-directory) is NOT covered and keeps its own sweep.
 * @param {string} parent absolute
 * @param {string} child absolute
 */
function sweptBy(parent, child) {
  if (child === parent) return true;
  if (!child.startsWith(parent + path.sep)) return false;
  return child
    .slice(parent.length + 1)
    .split(path.sep)
    .every((segment) => !SKIP_DIRS.has(segment) && !segment.startsWith('.'));
}

/**
 * Every path whose mtime can invalidate the graph THROUGH A STRUCTURAL CHANGE — plus, with `deep`,
 * the source files whose contents can invalidate it through an edge change.
 * @param {string} root
 * @param {readonly string[]} projectRoots repo-relative, forward or platform slashes
 * @param {boolean} [deep]
 * @returns {string[]} absolute paths
 */
export function inputSet(root, projectRoots, deep = false) {
  /** @type {Set<string>} */
  const paths = new Set(ROOT_INPUTS.map((file) => path.join(root, file)));
  // The workspace root itself, always: a project added in a brand new top-level directory moves
  // only this one, and the previous version of this function did not look at it.
  paths.add(root);

  // Sorted, so a root that contains another comes first and the nested one skips its sweep: with a
  // project at `.` (the `nx init` on an Angular app shape) every other project's tree was read
  // twice — the same `readdirSync` calls, deduplicated only in the Set afterwards.
  /** @type {string[]} */
  const swept = [];
  for (const abs of projectRoots.map((projectRoot) => path.resolve(root, projectRoot)).sort()) {
    for (const file of INFERRING_FILES) paths.add(path.join(abs, file));
    // EVERY ancestor up to the workspace root, not just the immediate parent: with projects under
    // `libs/shared/ui/*`, a new project at `libs/shared/data/store` moves `libs/shared`, which the
    // immediate-parent rule never looked at.
    for (let dir = abs; dir.length >= root.length; dir = path.dirname(dir)) {
      paths.add(dir);
      if (dir === path.dirname(dir)) break;
    }
    if (swept.some((done) => sweptBy(done, abs))) continue;
    swept.push(abs);
    const { dirs, files } = sweep(abs, { files: deep });
    for (const dir of dirs) paths.add(dir);
    for (const file of files) paths.add(file);
  }
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
 * @param {boolean} [options.deep] include source file contents
 * @param {number} [options.now] injected so a test does not race the clock
 * @returns {Stamp}
 */
export function stampGraph({ root, graphPath, projectRoots, fresh = false, deep = false, now = Date.now() }) {
  if (fresh) {
    return { cache: 'forced', graphMtime: 0, newestInput: 0, newestPath: null, statted: 0, deep, note: '' };
  }
  const graphMtime = mtime(graphPath);
  if (graphMtime === null) {
    return { cache: 'miss', graphMtime: 0, newestInput: 0, newestPath: null, statted: 0, deep, note: '' };
  }
  if (graphMtime > now + FUTURE_TOLERANCE_MS) {
    // Refusing to answer `hit` here is the whole point: a future timestamp satisfies the comparison
    // against everything, forever, and would turn every later question into a confident `świeże`.
    return {
      cache: 'stale',
      graphMtime,
      newestInput: 0,
      newestPath: graphPath,
      statted: 0,
      deep,
      note: 'znacznik czasu grafu jest w przyszłości — nie da się go z niczym porównać',
    };
  }

  let newestInput = 0;
  /** @type {string | null} */
  let newestPath = null;
  let statted = 0;
  for (const file of inputSet(root, projectRoots, deep)) {
    const at = mtime(file);
    if (at === null) continue;
    statted += 1;
    if (at > newestInput) {
      newestInput = at;
      newestPath = file;
    }
  }
  // `>=` and not `>`: a file written in the same millisecond as the graph is the graph's own input,
  // not a change made after it. Filesystem timestamp granularity is coarser than a millisecond on
  // several filesystems we support, so with `>` a freshly computed graph would report `nieświeże`
  // every time. There is a test for the tie, because a mutation to `>` used to pass the whole suite.
  const cache = graphMtime >= newestInput ? 'hit' : 'stale';
  return {
    cache,
    graphMtime,
    newestInput,
    newestPath: cache === 'stale' ? newestPath : null,
    statted,
    deep,
    note: '',
  };
}
