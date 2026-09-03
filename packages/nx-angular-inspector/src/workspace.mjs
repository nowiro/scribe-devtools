// workspace.mjs — one model of the workspace, and an honest label for where it came from.
//
// Three sources, in this order of preference:
//
//   1. .nx/workspace-data/project-graph.json   6,9-12 ms   present, `version` known
//   2. `nx graph --file=<tmp>`                 ~1 400 ms   cache missing, unknown shape, or --fresh
//   3. angular.json                            a few ms    a pure Angular workspace, no nx.json
//
// Every path ends with a `cache` verdict on the line, so the agent — and the benchmark — can tell a
// 95 ms cached answer from a 1,4 s computed one. The benchmark uses it to INVALIDATE a
// measurement: a run that fell through to the CLI must not quietly raise the median of the cached
// column.
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { indexGraph, readGraph, UnsupportedGraph } from './graph.mjs';
import { nxJson } from './nxcli.mjs';
import { graphFile } from './paths.mjs';
import { stampGraph } from './stamp.mjs';

/**
 * @typedef {object} Model
 * @property {'graf' | 'nx graph' | 'angular.json'} source
 * @property {'hit' | 'stale' | 'miss' | 'unsupported' | 'forced'} cache
 * @property {import('./graph.mjs').Graph} graph
 * @property {string} graphPath
 * @property {number} graphMtime epoch ms, 0 when the answer did not come from the cache file
 * @property {import('./stamp.mjs').Stamp} stamp
 */

/**
 * JSON from a file, or null when it is missing or unparsable. Used for the `project.json` sweep,
 * where "missing" is the common and meaningful case.
 * @param {string} file
 * @returns {any | null}
 */
export function readJsonOrNull(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Build the model.
 * @param {object} options
 * @param {string} options.root
 * @param {import('./detect.mjs').Detected} options.detected
 * @param {boolean} [options.fresh]
 * @param {NodeJS.ProcessEnv} [options.env]
 * @returns {Model}
 */
export function loadModel({ root, detected, fresh = false, env = process.env }) {
  const file = graphFile(root, env);

  if (detected.nx.present) {
    if (!fresh && existsSync(file)) {
      try {
        const graph = readGraph(file);
        const stamp = stampGraph({ root, graphPath: file, projectRoots: graph.projects.map((p) => p.root) });
        return { source: 'graf', cache: stamp.cache, graph, graphPath: file, graphMtime: stamp.graphMtime, stamp };
      } catch (error) {
        // An unknown `version` is a normal event with its own verdict; unreadable JSON is a broken
        // cache. Both fall through to the CLI, and only the first keeps a name of its own, because
        // only the first tells the reader something they can act on (nx moved the format).
        if (!(error instanceof UnsupportedGraph)) return fromCli(root, file, 'miss', env);
        return fromCli(root, file, 'unsupported', env);
      }
    }
    return fromCli(root, file, fresh ? 'forced' : 'miss', env);
  }

  return fromAngularJson(root, file);
}

/**
 * Priority 2: ask Nx to write the graph and read what it wrote. `--file` rather than `--print`,
 * because the reference workspace prints 376 419 B and piping that through a buffer is slower and
 * less robust than a temp file.
 * @param {string} root
 * @param {string} graphPath
 * @param {'miss' | 'unsupported' | 'forced'} cache
 * @param {NodeJS.ProcessEnv} env
 * @returns {Model}
 */
function fromCli(root, graphPath, cache, env) {
  const dir = mkdtempSync(path.join(tmpdir(), 'nxai-'));
  const out = path.join(dir, 'graph.json');
  try {
    const result = nxJson(root, ['graph', `--file=${out}`], env);
    // `nx graph --file` writes the file and prints a notice, not JSON — so a parse failure here is
    // expected and the file is what we actually want.
    const written = readJsonOrNull(out);
    if (written === null) {
      throw new Error(result.error === '' ? 'nx graph nie zapisało pliku' : result.error);
    }
    return {
      source: 'nx graph',
      cache,
      graph: indexGraph(written.graph ?? written),
      graphPath,
      graphMtime: 0,
      stamp: { cache, graphMtime: 0, newestInput: 0, newestPath: null, statted: 0 },
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Priority 3: a workspace with `angular.json` and no `nx.json`. The shape is the classic one —
 * `projects[name] = { root, projectType, architect | targets }` — and there is nothing to be stale
 * about, so the verdict is `hit` on a file we just read.
 * @param {string} root
 * @param {string} graphPath
 * @returns {Model}
 */
function fromAngularJson(root, graphPath) {
  const parsed = readJsonOrNull(path.join(root, 'angular.json')) ?? { projects: {} };
  /** @type {import('./graph.mjs').Project[]} */
  const projects = [];
  for (const [name, entry] of Object.entries(parsed.projects ?? {})) {
    const data = /** @type {any} */ (entry) ?? {};
    projects.push({
      name,
      type: String(data.projectType ?? '?'),
      root: String(data.root ?? '').replaceAll('\\', '/'),
      targets: Object.keys(data.targets ?? data.architect ?? {}).sort(),
      tags: [],
    });
  }
  projects.sort((a, b) => a.name.localeCompare(b.name, 'en'));
  return {
    source: 'angular.json',
    cache: 'hit',
    graph: {
      version: '',
      projects,
      dependsOn: new Map(),
      dependedOnBy: new Map(),
      externalNodes: 0,
      rawEdges: 0,
      internalEdges: 0,
    },
    graphPath,
    graphMtime: 0,
    stamp: { cache: 'hit', graphMtime: 0, newestInput: 0, newestPath: null, statted: 0 },
  };
}
