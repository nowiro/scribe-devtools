// graph.mjs — the project graph as the source of truth, and the reason it has to be.
//
// `project.json` is NOT the source of targets. On the reference workspace, 145 of 317 targets
// (45,7 %) exist ONLY in the graph — 65 `lint` from `@nx/eslint/plugin`, 80 from
// `@nx/playwright/plugin` including 42 atomised `e2e-ci--<spec>.ts`. Nx's own guidance says it
// outright: do not read project.json directly, it only contains partial configuration.
//
// `version` is ASSERTED. Within nx >= 23 exactly one value is known — "6.0". Anything else is the
// `nieznany format` verdict and a fall back to the CLI, never a hopeful parse. This is precisely
// the failure that killed `nx-mcp` 0.25.0 on nx 23, with the difference that there was neither an
// assertion nor a fallback there.
import { readFileSync } from 'node:fs';

/** Graph shapes this parser knows how to read. A value outside this set is `unsupported`. */
export const KNOWN_VERSIONS = Object.freeze(['6.0']);

/**
 * @typedef {object} Project
 * @property {string} name
 * @property {string} type `app` | `lib` | `e2e`
 * @property {string} root repo-relative
 * @property {string[]} targets sorted
 * @property {string[]} tags sorted
 */

/**
 * @typedef {object} Graph
 * @property {string} version
 * @property {Project[]} projects sorted by name
 * @property {Map<string, string[]>} dependsOn name → names it depends on (internal only)
 * @property {Map<string, string[]>} dependedOnBy the reverse edges, built once
 * @property {number} externalNodes
 * @property {number} rawEdges every edge in the file, internal and external
 * @property {number} internalEdges edges whose target is a project in this workspace
 */

export class UnsupportedGraph extends Error {
  /** @param {string} version */
  constructor(version) {
    super(`nieznany format grafu: version ${version}`);
    this.name = 'UnsupportedGraph';
    this.version = version;
  }
}

/**
 * Parse the graph cache file. Throws `UnsupportedGraph` for a shape we do not know, and the
 * underlying error for unreadable JSON — both are answered by the caller with a CLI fallback, but
 * only the first is a normal event worth its own verdict.
 * @param {string} file
 * @returns {Graph}
 */
export function readGraph(file) {
  const raw = JSON.parse(readFileSync(file, 'utf8'));
  const version = String(raw.version ?? '');
  if (!KNOWN_VERSIONS.includes(version)) throw new UnsupportedGraph(version === '' ? '(brak)' : version);
  return indexGraph(raw);
}

/**
 * Turn the parsed file into the two lookups every command needs. Separate from `readGraph` so the
 * tests can drive it with a literal instead of a temp file.
 * @param {any} raw
 * @returns {Graph}
 */
export function indexGraph(raw) {
  const nodes = raw.nodes ?? raw.graph?.nodes ?? {};
  /** @type {Project[]} */
  const projects = [];
  for (const [name, node] of Object.entries(nodes)) {
    const data = /** @type {any} */ (node)?.data ?? {};
    projects.push({
      name,
      type: String(/** @type {any} */ (node)?.type ?? data.projectType ?? '?'),
      root: String(data.root ?? '').replaceAll('\\', '/'),
      targets: Object.keys(data.targets ?? {}).sort(),
      // Only an ARRAY is a tag list. A string used to be spread into characters — `scope:shared`
      // became twelve one-letter tags, printed with full confidence — and a number threw.
      tags: (Array.isArray(data.tags) ? data.tags : []).map(String).sort(),
    });
  }
  projects.sort((a, b) => a.name.localeCompare(b.name, 'en'));

  const names = new Set(projects.map((p) => p.name));
  const dependencies = raw.dependencies ?? raw.graph?.dependencies ?? {};
  /** @type {Map<string, string[]>} */
  const dependsOn = new Map();
  /** @type {Map<string, string[]>} */
  const dependedOnBy = new Map();
  let rawEdges = 0;
  let internalEdges = 0;
  for (const [source, edges] of Object.entries(dependencies)) {
    /** @type {Set<string>} */
    const targets = new Set();
    for (const edge of /** @type {any[]} */ (edges ?? [])) {
      rawEdges += 1;
      const target = String(edge?.target ?? '');
      // External edges outnumber internal ones by 26 to 1 on the reference workspace (4 024 against
      // 153). Keeping them would make `graph <p>` print a dependency list nobody asked about.
      if (!names.has(target) || target === source) continue;
      targets.add(target);
      internalEdges += 1;
    }
    const sorted = [...targets].sort((a, b) => a.localeCompare(b, 'en'));
    dependsOn.set(source, sorted);
    for (const target of sorted) {
      const list = dependedOnBy.get(target);
      if (list) list.push(source);
      else dependedOnBy.set(target, [source]);
    }
  }
  for (const list of dependedOnBy.values()) list.sort((a, b) => a.localeCompare(b, 'en'));

  return {
    version: String(raw.version ?? ''),
    projects,
    dependsOn,
    dependedOnBy,
    externalNodes: Object.keys(raw.externalNodes ?? {}).length,
    rawEdges,
    internalEdges,
  };
}

/**
 * How many of the graph's targets are not written down in the project's own `project.json` — the
 * number that justifies reading the graph at all. Counted, not assumed: a workspace where every
 * target is declared would make this `0/N` and say so.
 * @param {Graph} graph
 * @param {string} root
 * @param {(file: string) => any | null} readJson injected so the tests do not need a filesystem
 * @returns {{ total: number, inferred: number }}
 */
export function inferredTargets(graph, root, readJson) {
  let total = 0;
  let inferred = 0;
  for (const project of graph.projects) {
    total += project.targets.length;
    const declared = readJson(`${root}/${project.root}/project.json`);
    const names = new Set(Object.keys(declared?.targets ?? {}));
    for (const target of project.targets) if (!names.has(target)) inferred += 1;
  }
  return { total, inferred };
}

/**
 * Projects matching a name or a `*` glob, anchored whole-string. Anchored on purpose: a substring
 * matcher turns `api` into every project with `api` anywhere in its name, which reads like a bug in
 * the workspace rather than a bug in the query.
 * @param {Graph} graph
 * @param {string} pattern
 * @returns {Project[]}
 */
export function matchProjects(graph, pattern) {
  if (!pattern.includes('*')) {
    const exact = graph.projects.find((p) => p.name === pattern);
    return exact ? [exact] : [];
  }
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/gu, '\\$&').replaceAll('*', '[^]*');
  const regex = new RegExp(`^${escaped}$`, 'u');
  return graph.projects.filter((p) => regex.test(p.name));
}
