// paths.mjs — where things are, and nothing else. Pure except for `existsSync`.
//
// Two locations are NOT assumed, because both moved inside the supported version range:
//   * the graph cache. Nx 23 moved its database to `~/.nx/<sha256(workspaceId)[0:16]>/databases`
//     and `NX_WORKSPACE_DATA_DIRECTORY` can move the rest. A missing file is a verdict
//     (`brak grafu` → CLI), never a crash and never a guess.
//   * the workspace root. The agent runs the tool from wherever it is; we walk up for the marker
//     files rather than assuming `process.cwd()` is the root.
import { existsSync } from 'node:fs';
import path from 'node:path';

/** Marker files that make a directory a workspace root, most specific first. */
export const ROOT_MARKERS = Object.freeze(['nx.json', 'angular.json', 'package.json']);

/**
 * The workspace root at or above `from`: the nearest directory holding `nx.json` or `angular.json`,
 * else the nearest holding `package.json`, else `from` itself.
 *
 * Two passes rather than one, because a `package.json` in a subdirectory of an Nx workspace is the
 * common case (every project has one) and stopping there would analyse a project as if it were a
 * workspace — the tool would then report `ani Nx, ani Angular` from inside a perfectly good Nx repo.
 * @param {string} from
 * @returns {string}
 */
export function findRoot(from) {
  const start = path.resolve(from);
  for (const marker of ['nx.json', 'angular.json']) {
    const hit = walkUp(start, marker);
    if (hit !== null) return hit;
  }
  return walkUp(start, 'package.json') ?? start;
}

/**
 * The nearest directory at or above `from` that contains `file`, or null.
 * @param {string} from
 * @param {string} file
 * @returns {string | null}
 */
export function walkUp(from, file) {
  let dir = path.resolve(from);
  for (;;) {
    if (existsSync(path.join(dir, file))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * The directory Nx keeps its workspace data in. `NX_WORKSPACE_DATA_DIRECTORY` wins when set, as it
 * does for Nx itself; relative values resolve against the workspace root, not against `cwd`.
 * @param {string} root
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string}
 */
export function workspaceDataDir(root, env = process.env) {
  const override = env.NX_WORKSPACE_DATA_DIRECTORY;
  if (override !== undefined && override !== '') return path.resolve(root, override);
  return path.join(root, '.nx', 'workspace-data');
}

/**
 * The project graph cache file. Its absence is normal (a workspace that never ran an Nx command)
 * and is answered with the `brak grafu` verdict.
 * @param {string} root
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string}
 */
export function graphFile(root, env = process.env) {
  return path.join(workspaceDataDir(root, env), 'project-graph.json');
}

/**
 * The output directory. `.ws/` rather than `.scribe-devtools/nx-angular-inspector/` for one
 * measured reason: the path is printed on EVERY line of stdout, and `.ws/projects.md` costs 3
 * o200k tokens against 10 for the long form. `NX_ANGULAR_INSPECTOR_OUT` overrides it (the tests
 * and the benchmark use that rather than writing into a checkout).
 * @param {string} root
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string}
 */
export function outDir(root, env = process.env) {
  const override = env.NX_ANGULAR_INSPECTOR_OUT;
  if (override !== undefined && override !== '') return path.resolve(root, override);
  return path.join(root, '.ws');
}

/**
 * A package's `package.json` inside the workspace's own `node_modules`, resolved by path rather
 * than by `require.resolve`: the packages we ask about (`nx`, `@angular/core`, `@angular/cli`) are
 * dependencies of the WORKSPACE, not of this tool, so this tool's resolver would not find them —
 * and under pnpm it would find the wrong copy through a symlinked store.
 * @param {string} root
 * @param {string} id npm package name, e.g. `@angular/core`
 * @returns {string}
 */
export function packageManifest(root, id) {
  return path.join(root, 'node_modules', ...id.split('/'), 'package.json');
}

/** The `nx` CLI entry inside the workspace, used for the fallback path. @param {string} root */
export function nxBin(root) {
  return path.join(root, 'node_modules', 'nx', 'bin', 'nx.js');
}
