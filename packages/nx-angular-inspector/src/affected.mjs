// affected.mjs — which projects a range of commits touched.
//
// This command replaces nothing in either MCP server: neither exposes it. It is the one verb here
// that is pure gain, and also the one with the most ways to be quietly wrong, so every step is
// separated from the process boundary and tested on its own.
//
// Three steps, in order:
//   1. the changed files            `git diff --name-only <base>...HEAD`
//   2. files → projects             longest segment-wise root prefix; a `sharedGlobals` hit means
//                                   the whole workspace, because that is what "shared" means
//   3. projects → closure           everything that depends on a touched project, transitively
//
// Step 3 is the half people forget. Changing a leaf library affects every application that
// consumes it; an answer that lists only the library is the kind of wrong that passes review and
// then skips a build.
import { spawnSync } from 'node:child_process';
import { matchesAny, ownerOf } from './glob.mjs';

/** Default patterns when `nx.json` names none: a change to any of these can change every project. */
export const DEFAULT_SHARED_GLOBALS = Object.freeze([
  'nx.json',
  'package.json',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'tsconfig.base.json',
  'angular.json',
]);

/**
 * @typedef {object} Affected
 * @property {string[]} projects sorted names
 * @property {string[]} files the changed files
 * @property {string | null} sharedHit the shared file that made everything affected, if any
 * @property {string} range as passed to git
 */

/**
 * Changed files between `base` and `HEAD`.
 *
 * Three dots, not two: `a...b` diffs against the MERGE BASE, which is what "what did this branch
 * change" means. Two dots would call every commit that landed on `main` since the branch started a
 * change of the branch, and on a busy repository that is most of the workspace.
 * @param {string} root
 * @param {string} base
 * @returns {{ ok: boolean, files: string[], error: string }}
 */
export function changedFiles(root, base) {
  const result = spawnSync('git', ['diff', '--name-only', `${base}...HEAD`], {
    cwd: root,
    shell: false,
    windowsHide: true,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.error) return { ok: false, files: [], error: 'git nie jest dostępny' };
  if (result.status !== 0) {
    const stderr = (result.stderr ?? '').split('\n')[0].trim();
    return { ok: false, files: [], error: stderr === '' ? `git zwrócił ${String(result.status)}` : stderr };
  }
  const files = (result.stdout ?? '')
    .split('\n')
    .map((line) => line.trim().replaceAll('\\', '/'))
    .filter((line) => line !== '');
  return { ok: true, files, error: '' };
}

/**
 * `namedInputs.sharedGlobals` from `nx.json`, reduced to plain globs.
 *
 * Nx writes these as `{fileset: '{workspaceRoot}/nx.json'}` objects as often as plain strings, and
 * the `{workspaceRoot}/` prefix is a token, not a directory — leaving it in would make every
 * pattern match nothing, which fails in the quiet direction (no shared file ever detected).
 * @param {any} nxJson
 * @returns {string[]}
 */
export function sharedGlobals(nxJson) {
  const entries = nxJson?.namedInputs?.sharedGlobals;
  if (!Array.isArray(entries)) return [...DEFAULT_SHARED_GLOBALS];
  /** @type {string[]} */
  const globs = [];
  for (const entry of entries) {
    const raw = typeof entry === 'string' ? entry : typeof entry?.fileset === 'string' ? entry.fileset : '';
    if (raw === '') continue;
    const cleaned = raw.replace('{workspaceRoot}/', '').replace('{workspaceRoot}', '');
    if (cleaned !== '') globs.push(cleaned);
  }
  return globs.length === 0 ? [...DEFAULT_SHARED_GLOBALS] : globs;
}

/**
 * Files → the projects that own them, plus the closure of everything depending on those.
 * @param {object} options
 * @param {readonly string[]} options.files
 * @param {readonly {name: string, root: string}[]} options.projects
 * @param {Map<string, string[]>} options.dependedOnBy
 * @param {readonly string[]} options.shared
 * @returns {{ projects: string[], sharedHit: string | null }}
 */
export function affectedProjects({ files, projects, dependedOnBy, shared }) {
  const sharedHit = files.find((file) => matchesAny(file, shared)) ?? null;
  if (sharedHit !== null) {
    return { projects: projects.map((p) => p.name).sort((a, b) => a.localeCompare(b, 'en')), sharedHit };
  }

  /** @type {Set<string>} */
  const seeds = new Set();
  for (const file of files) {
    const owner = ownerOf(file, projects);
    if (owner !== null) seeds.add(owner);
  }

  /** @type {Set<string>} */
  const closed = new Set();
  const queue = [...seeds];
  while (queue.length > 0) {
    const name = /** @type {string} */ (queue.pop());
    if (closed.has(name)) continue;
    closed.add(name);
    for (const dependent of dependedOnBy.get(name) ?? []) if (!closed.has(dependent)) queue.push(dependent);
  }

  return { projects: [...closed].sort((a, b) => a.localeCompare(b, 'en')), sharedHit: null };
}
