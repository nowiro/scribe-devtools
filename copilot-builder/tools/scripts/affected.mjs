#!/usr/bin/env node
// affected.mjs — run one target for the projects a change touches: the `nx affected` this repository
// deliberately does not have, in one dependency-free script over angular.json.
//
//   node tools/scripts/affected.mjs <target> [--all] [--base=<git-ref>] [--no-cache] [--dry-run] [--list]
//   targets: lint · typecheck · test · build · e2e
//   npm:     npm run affected -- test --base=origin/main
//
// How "affected" is computed
// --------------------------
// 1. Projects come from angular.json (`root`, `sourceRoot`, `projectType`, `architect`).
// 2. Edges come from imports of the aliases in tsconfig.json `paths` (`@cb/<scope>/<name>` → the
//    library whose root contains the alias target) plus one convention: `<app>-e2e` depends on `<app>`.
// 3. Changed files = `git diff --name-only <merge-base(base, HEAD)>` plus the working tree (staged,
//    unstaged, untracked). A changed file under a project root marks the project; a change to a
//    ROOT TRIGGER (package.json, lockfile, angular.json, tsconfig.json, the ESLint/Biome configs,
//    tools/testing/**) marks every project, because every project depends on it.
// 4. Dependents of a marked project are marked transitively.
//
// The task cache
// --------------
// `lint` and `typecheck` produce no outputs, so a run that already succeeded on identical inputs need
// not run again: the inputs (every file of the project and of its dependencies, the root triggers, the
// target name, the Node major) are hashed, and a marker in `.cache/tasks/` records the green run.
// GitLab CI carries `.cache/` between jobs and branches, so the cache is shared without any remote
// service. `build` (Angular has its own cache in .angular/cache) and `e2e` are never cached.
//
// `test` is NOT cached, although it used to be. `ng test … --coverage` writes
// `reports/junit-<project>.xml` and `coverage/<project>/cobertura-coverage.xml`, which the
// `test-projects` job publishes as GitLab reports — and a marker hit returned 0 without producing
// either, while GitLab does not fail a job for a missing report. The hit was also worth little:
// taskHash covers the project's files, its dependencies' files and the root triggers, so a marker only
// ever matched on a pipeline re-run or an `--all` pass on the default branch — exactly the runs the
// coverage report is read from.
// `--no-cache` or `CB_TASK_CACHE=0` bypasses the markers.
//
// Exit codes: 0 pass (also when nothing is affected) · 1 a task failed · 2 usage error.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { displayCommand } from './display-command.mjs';
import { REPO, isMain, readJsonc } from './lib/repo.mjs';
import { skipDirectory } from './lib/scan.mjs';

export const TARGETS = Object.freeze(['lint', 'typecheck', 'test', 'build', 'e2e']);
const CACHED_TARGETS = new Set(['lint', 'typecheck']);
const CACHE_DIR = path.join(REPO, '.cache', 'tasks');
/** Files whose change affects EVERY project. */
export const ROOT_TRIGGERS = Object.freeze([
  'package.json',
  'package-lock.json',
  'angular.json',
  'tsconfig.json',
  'biome.jsonc',
  'eslint.config.mjs',
  'eslint.plugins.mjs',
  'eslint.rules.mjs',
  'tools/testing/',
]);

/**
 * @typedef {object} Project
 * @property {string} name
 * @property {string} root repository-relative POSIX path
 * @property {string} sourceRoot
 * @property {'application' | 'library'} projectType
 * @property {Record<string, unknown>} architect
 */

/**
 * @typedef {object} Workspace
 * @property {Map<string, Project>} projects
 * @property {Map<string, string>} aliases alias → project name
 */

/**
 * @param {string} repo
 * @returns {Workspace}
 */
export function readWorkspace(repo = REPO) {
  const angular = JSON.parse(readFileSync(path.join(repo, 'angular.json'), 'utf8'));
  /** @type {Map<string, Project>} */
  const projects = new Map();
  for (const [name, raw] of Object.entries(angular.projects ?? {})) {
    const entry = /** @type {any} */ (raw);
    const root = String(entry.root ?? '')
      .replace(/\\/gu, '/')
      .replace(/\/$/u, '');
    projects.set(name, {
      name,
      root,
      sourceRoot: String(entry.sourceRoot ?? `${root}/src`).replace(/\\/gu, '/'),
      projectType: entry.projectType === 'library' ? 'library' : 'application',
      architect: entry.architect ?? {},
    });
  }
  /** @type {Map<string, string>} */
  const aliases = new Map();
  const paths = readJsonc(path.join(repo, 'tsconfig.json')).compilerOptions?.paths ?? {};
  for (const [alias, targets] of Object.entries(paths)) {
    const target = String(/** @type {string[]} */ (targets)[0] ?? '').replace(/^\.\//u, '');
    const owner = [...projects.values()].find(
      (project) => target.startsWith(`${project.root}/`) || target === project.root,
    );
    if (owner) aliases.set(alias.replace(/\/\*$/u, ''), owner.name);
  }
  return { projects, aliases };
}

/**
 * Every file under `dir` (repository-relative POSIX paths), skipping build output and caches.
 * @param {string} repo
 * @param {string} dir repository-relative
 * @returns {string[]}
 */
export function listFiles(repo, dir) {
  /** @type {string[]} */
  const out = [];
  const walk = (/** @type {string} */ rel, /** @type {number} */ depth) => {
    const abs = path.join(repo, rel);
    if (!existsSync(abs)) return;
    for (const entry of readdirSync(abs, { withFileTypes: true })) {
      // `rel` is '' when the walk root is the repository itself; joining blindly would emit
      // `/apps/demo/src/main.ts`, a path with a leading slash that matches nothing git ever reports,
      // so every comparison downstream silently failed.
      const childRel = rel === '' ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDirectory()) {
        if (skipDirectory(entry.name, depth)) continue;
        walk(childRel, depth + 1);
      } else out.push(childRel);
    }
  };
  walk(dir.replace(/\/$/u, ''), 0);
  return out.sort();
}

/**
 * Repository-relative paths named by `styles`, `assets` and `scripts` of a project's targets, in
 * both spellings the CLI accepts (a string or `{ input }`).
 * @param {Project} project
 * @returns {string[]}
 */
function optionFiles(project) {
  /** @type {string[]} */
  const out = [];
  for (const target of Object.values(project.architect)) {
    const options = /** @type {{ options?: Record<string, unknown> }} */ (target).options ?? {};
    for (const key of ['styles', 'assets', 'scripts']) {
      const entries = options[key];
      if (!Array.isArray(entries)) continue;
      for (const entry of entries) {
        const value = typeof entry === 'string' ? entry : /** @type {{ input?: unknown }} */ (entry)?.input;
        if (typeof value === 'string') out.push(value.replace(/^\.\//u, '').replace(/\/$/u, ''));
      }
    }
  }
  return out;
}

/**
 * Dependencies of every project: alias imports found in its `.ts` sources, plus the e2e convention.
 * @param {{ projects: Map<string, Project>, aliases: Map<string, string> }} workspace
 * @param {string} repo
 * @returns {Map<string, Set<string>>} project → projects it depends on
 */
export function buildGraph(workspace, repo = REPO) {
  /** @type {Map<string, Set<string>>} */
  const graph = new Map();
  for (const project of workspace.projects.values()) {
    const deps = aliasEdges(project, workspace, repo);
    if (project.name.endsWith('-e2e')) {
      const app = project.name.slice(0, -4);
      if (workspace.projects.has(app)) deps.add(app);
    }
    // Shared styles, assets and scripts declared in angular.json are edges too: a change to a design
    // token file under libs/shared/ui affects every application whose build lists it.
    for (const file of optionFiles(project)) {
      const owner = [...workspace.projects.values()].find(
        (other) => other !== project && (file === other.root || file.startsWith(`${other.root}/`)),
      );
      if (owner) deps.add(owner.name);
    }
    graph.set(project.name, deps);
  }
  return graph;
}

/**
 * The projects a project imports through aliases in its `.ts` sources (declaration files excluded).
 * @param {Project} project
 * @param {Workspace} workspace
 * @param {string} repo
 * @returns {Set<string>}
 */
function aliasEdges(project, workspace, repo) {
  // Three shapes, and the third is the one that used to be invisible: `import '@cb/x';` — a polyfill,
  // a global stylesheet side-effect, a locale or an interceptor registration. It has no `from`, so a
  // pattern anchored on `from` could not see it, and the importing project silently lost the edge.
  // `import\s+` must come last and requires the quote to follow directly, so it never swallows
  // `import x from '…'` (already covered by the `from` branch) or `import('…')`.
  const pattern = /(?:from\s+|import\s*\(\s*|import\s+)['"]([^'"]+)['"]/gu;
  const deps = new Set();
  for (const file of listFiles(repo, project.root)) {
    // `.d.ts` is scanned like any other source. It used to be excluded, and that exclusion was a
    // defect, not a decision: a declaration file is compiled (`tsconfig.app.json` includes
    // `src/**/*.d.ts`), so an alias import inside one is a real typecheck dependency. Measured on a
    // fixture whose ONLY link ran through `src/types.d.ts`: removing the exported type from the
    // library made `tsc -p apps/demo/tsconfig.app.json` fail with TS2305, while `affected` answered
    // `['shared-util']` and left the broken application out. The exclusion was also inconsistent —
    // `/\.d\.ts$/` never matched `.d.mts`, which passes the `.mts` test and WAS scanned — and
    // pointless as a filter, because only workspace aliases are matched below, so an ambient
    // `declare module 'third-party'` could never have produced an edge anyway.
    if (!/\.(?:ts|mts)$/u.test(file)) continue;
    const source = readFileSync(path.join(repo, file), 'utf8');
    for (const match of source.matchAll(pattern)) {
      const specifier = match[1];
      for (const [alias, owner] of workspace.aliases) {
        if ((specifier === alias || specifier.startsWith(`${alias}/`)) && owner !== project.name) deps.add(owner);
      }
    }
  }
  return deps;
}

/**
 * @param {string[]} args
 * @param {string} repo
 * @returns {string | null} stdout, or null when git is unavailable or the command failed
 */
function git(args, repo = REPO) {
  const result = spawnSync('git', args, { cwd: repo, encoding: 'utf8' });
  return result.status === 0 ? result.stdout : null;
}

/** Where the default branch lives when no explicit base is given: the remote HEAD first, then the usual names. */
const BASE_CANDIDATES = ['origin/main', 'main', 'origin/master', 'master'];

/**
 * The commit to diff against: the merge base of HEAD and `base`, or of HEAD and the first default
 * branch candidate that exists. Null when nothing resolves — an explicit `base` that does not exist
 * is the caller's error, an absent default branch means there is no history to compare.
 * @param {string | undefined} base
 * @param {string} repo
 * @returns {string | null}
 */
export function mergeBaseFor(base, repo = REPO) {
  const remoteHead = git(['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD'], repo)
    ?.trim()
    .replace(/^refs\/remotes\//u, '');
  const candidates = base ? [base] : [...(remoteHead ? [remoteHead] : []), ...BASE_CANDIDATES];
  for (const candidate of candidates) {
    const found = git(['merge-base', candidate, 'HEAD'], repo)?.trim();
    if (found) return found;
  }
  return null;
}

/**
 * Changed files — committed since the merge base, staged, unstaged and untracked — or null when there
 * is nothing to compare against (no git, no history, no default branch): the caller then treats EVERY
 * project as affected. Returning "only the uncommitted changes" here would turn a pre-push gate green
 * on a clean tree, which is the one thing it must never do.
 * @param {string | undefined} base
 * @param {string} repo
 * @returns {string[] | null}
 */
export function changedFiles(base, repo = REPO) {
  if (git(['rev-parse', '--is-inside-work-tree'], repo) === null) return null;
  const mergeBase = mergeBaseFor(base, repo);
  if (mergeBase === null) return null;
  // -z and quotePath=false: a path with a non-ASCII character would otherwise come back quoted and
  // octal-escaped ("apps/x/src/za\305\274.ts") and match no project root.
  const quiet = ['-c', 'core.quotePath=false'];
  // --no-renames, and it is not optional. git's `diff.renames` defaults to ON, and a renamed file is
  // then reported ONLY under its NEW path — so the project that LOST the file never enters the seed
  // set and drops out of the answer without a word. Measured: moving a file out of a library to a
  // path outside every project answered `[]`, fully green, while that library's build was broken.
  // `ls-files --others` lists untracked paths and knows nothing about renames, so it stays as is.
  const named = [...quiet, 'diff', '-z', '--name-only', '--no-renames'];
  const outputs = [
    git([...named, mergeBase, 'HEAD'], repo),
    git([...named], repo),
    git([...named, '--cached'], repo),
    git([...quiet, 'ls-files', '-z', '--others', '--exclude-standard'], repo),
  ];
  const files = new Set();
  for (const out of outputs) {
    for (const entry of (out ?? '').split('\0')) if (entry !== '') files.add(entry.replaceAll('\\', '/'));
  }
  return [...files].sort();
}

/**
 * Whether `file` lies inside `root`, both repository-relative POSIX paths.
 *
 * The empty root is the case that has to be spelled out rather than fall out of the arithmetic: a
 * project whose `root` is `''` IS the repository, so it contains every file. Comparing by prefix
 * without this branch asked whether the path equals `''` or starts with `/` — false for every path
 * git reports — so such a project was never marked, and a change to its OWN source answered
 * `affected: []`. Measured on a fixture: editing `src/app/app.ts` of a `"root": ""` application
 * marked nothing at all. Over-marking is the safe direction here; silent green is not.
 * @param {string} root
 * @param {string} file
 * @returns {boolean}
 */
const contains = (root, file) => root === '' || file === root || file.startsWith(`${root}/`);

/**
 * @param {string[]} changed
 * @param {{ projects: Map<string, Project> }} workspace
 * @param {Map<string, Set<string>>} graph
 * @returns {{ affected: string[], reason: string }}
 */
export function affectedProjects(changed, workspace, graph) {
  const all = [...workspace.projects.keys()].sort();
  const rootHit = changed.find((file) =>
    ROOT_TRIGGERS.some((trigger) => (trigger.endsWith('/') ? file.startsWith(trigger) : file === trigger)),
  );
  if (rootHit) return { affected: all, reason: `root trigger changed: ${rootHit}` };
  const marked = new Set();
  for (const project of workspace.projects.values()) {
    if (changed.some((file) => contains(project.root, file))) marked.add(project.name);
  }
  // dependents, transitively
  let grew = true;
  while (grew) {
    grew = false;
    for (const [name, deps] of graph) {
      if (marked.has(name)) continue;
      if ([...deps].some((dep) => marked.has(dep))) {
        marked.add(name);
        grew = true;
      }
    }
  }
  return { affected: all.filter((name) => marked.has(name)), reason: `${changed.length} changed file(s)` };
}

/**
 * Content hash of everything a cached task depends on.
 * @param {Project} project
 * @param {Map<string, Set<string>>} graph
 * @param {{ projects: Map<string, Project> }} workspace
 * @param {string} target
 * @param {string} repo
 * @returns {string}
 */
export function taskHash(project, graph, workspace, target, repo = REPO) {
  const hash = createHash('sha256');
  hash.update(`${target}\n${process.versions.node.split('.')[0]}\n`);
  // The command lines are inputs too: a new flag in commandsFor must not be served from old markers.
  hash.update(
    `${commandsFor(project, target, repo)
      .map((command) => displayCommand(command, repo))
      .join('\n')}\n`,
  );
  const roots = new Set([project.root]);
  const queue = [project.name];
  while (queue.length > 0) {
    const current = /** @type {string} */ (queue.pop());
    for (const dep of graph.get(current) ?? []) {
      const depProject = workspace.projects.get(dep);
      if (depProject && !roots.has(depProject.root)) {
        roots.add(depProject.root);
        queue.push(dep);
      }
    }
  }
  const files = [...roots].flatMap((root) => listFiles(repo, root));
  for (const trigger of ROOT_TRIGGERS) {
    if (trigger.endsWith('/')) files.push(...listFiles(repo, trigger));
    else if (existsSync(path.join(repo, trigger))) files.push(trigger);
  }
  for (const file of files.sort()) {
    hash.update(`${file}\n`);
    hash.update(readFileSync(path.join(repo, file)));
  }
  return hash.digest('hex').slice(0, 16);
}

/**
 * The command lines one target runs for one project — empty when the project has no such target.
 * @param {Project} project
 * @param {string} target
 * @param {string} repo
 * @returns {string[][]}
 */
export function commandsFor(project, target, repo = REPO) {
  const node = process.execPath;
  const ng = path.join(repo, 'node_modules', '@angular', 'cli', 'bin', 'ng.js');
  const tsc = path.join(repo, 'node_modules', 'typescript', 'bin', 'tsc');
  const eslint = path.join(repo, 'node_modules', 'eslint', 'bin', 'eslint.js');
  const playwright = path.join(repo, 'node_modules', '@playwright', 'test', 'cli.js');
  switch (target) {
    case 'lint':
      return [[node, eslint, project.root, '--max-warnings=0', '--cache', '--cache-location', '.cache/eslint/']];
    case 'typecheck':
      // apps and libraries carry app/lib + spec tsconfigs; an e2e project has a single tsconfig.json.
      return ['tsconfig.app.json', 'tsconfig.lib.json', 'tsconfig.spec.json', 'tsconfig.json']
        .filter((file) => existsSync(path.join(repo, project.root, file)))
        .map((file) => [node, tsc, '-p', `${project.root}/${file}`, '--noEmit']);
    case 'test':
      return 'test' in project.architect ? [[node, ng, 'test', project.name, '--watch=false', '--coverage']] : [];
    case 'build':
      // Libraries are consumed from source; their ng-packagr target is for publishing, not for CI.
      return project.projectType === 'application' && 'build' in project.architect
        ? [[node, ng, 'build', project.name]]
        : [];
    case 'e2e':
      return project.name.endsWith('-e2e') && existsSync(path.join(repo, project.root, 'playwright.config.ts'))
        ? [[node, playwright, 'test', '--config', `${project.root}/playwright.config.ts`]]
        : [];
    default:
      return [];
  }
}

/**
 * @param {string[]} argv
 * @returns {{ target?: string, all: boolean, base?: string, cache: boolean, dryRun: boolean, list: boolean }}
 */
export function parseArgs(argv) {
  const out = { all: false, cache: process.env.CB_TASK_CACHE !== '0', dryRun: false, list: false };
  for (const arg of argv) {
    if (arg === '--all') out.all = true;
    else if (arg === '--no-cache') out.cache = false;
    else if (arg === '--dry-run') out.dryRun = true;
    else if (arg === '--list') out.list = true;
    else if (arg.startsWith('--base=')) out.base = arg.slice('--base='.length);
    else if (!arg.startsWith('--') && out.target === undefined) out.target = arg;
  }
  return out;
}

/**
 * @typedef {object} RunContext
 * @property {string} target
 * @property {Workspace} workspace
 * @property {Map<string, Set<string>>} graph
 * @property {string} repo
 * @property {boolean} cache
 * @property {boolean} dryRun
 */

/**
 * Whether an empty command list is the DESIGNED answer for this pair rather than a hole in
 * `angular.json`. Three cases, each of them a decision somebody made on purpose:
 *
 *   * a `<app>-e2e` project is generated with `architect: {}` (new-project.mjs) — it carries neither
 *     `test` nor `build`, and runs Playwright off its own config instead;
 *   * a library's `build` is ng-packagr, which exists for publishing: libraries are consumed from
 *     source, so CI never builds them (the ADR says this outright);
 *   * `e2e` asked of anything that is not an `<app>-e2e` project.
 *
 * Everything else empty is a MISSING target, and the difference matters: a typo in `architect.test`
 * used to print `skip` and exit 0, which turns that project's test gate permanently green — the 80 %
 * coverage thresholds never fire, `reports/junit-<project>.xml` is simply never written, and nothing
 * compares the absence to anything. The header line counts projects SELECTED, not run, so it reports
 * the full number either way.
 * @param {Project} project
 * @param {string} target
 * @returns {boolean}
 */
export function expectedEmpty(project, target) {
  const isE2eProject = project.name.endsWith('-e2e');
  if (target === 'e2e') return !isE2eProject;
  if (isE2eProject) return target === 'test' || target === 'build';
  return target === 'build' && project.projectType === 'library';
}

/**
 * What the reader has to add for this target to run. Only `lint`, `test` and `build` live in
 * `architect`; `e2e` hangs off the project's own Playwright config and `typecheck` off its tsconfigs,
 * so one generic sentence would send them to the wrong file.
 * @param {Project} project
 * @param {string} target
 * @returns {string}
 */
function missingInput(project, target) {
  if (target === 'e2e') return `${project.root}/playwright.config.ts`;
  if (target === 'typecheck') return `a tsconfig under ${project.root}/`;
  return `architect.${target} in angular.json`;
}

/**
 * Run one project's commands for the target, honouring the task cache.
 * @param {string} name
 * @param {RunContext} ctx
 * @returns {number} exit code — 0 also when the target is designedly absent or the cache hit, 1 when
 *   the target is MISSING
 */
function runProject(name, ctx) {
  const { target, workspace, graph, repo } = ctx;
  const project = /** @type {Project} */ (workspace.projects.get(name));
  const commands = commandsFor(project, target, repo);
  if (commands.length === 0) {
    if (expectedEmpty(project, target)) {
      process.stdout.write(`skip ${target} ${name} · no such target\n`);
      return 0;
    }
    const missing = missingInput(project, target);
    process.stderr.write(
      `FAIL ${target} ${name} · nothing to run — this ${project.projectType} needs ${missing}; ` +
        `running nothing is not the same as passing\n`,
    );
    return 1;
  }
  const marker =
    ctx.cache && CACHED_TARGETS.has(target)
      ? path.join(CACHE_DIR, `${target}.${name}.${taskHash(project, graph, workspace, target, repo)}`)
      : null;
  if (marker && existsSync(marker)) {
    process.stdout.write(`hit  ${target} ${name} · cached\n`);
    return 0;
  }
  const started = Date.now();
  for (const command of commands) {
    const shown = displayCommand(command, repo);
    if (ctx.dryRun) {
      process.stdout.write(`dry  ${target} ${name} · ${shown}\n`);
      continue;
    }
    const result = spawnSync(command[0], command.slice(1), {
      cwd: repo,
      stdio: 'inherit',
      env: { ...process.env, NG_CLI_ANALYTICS: 'false', CB_PROJECT: name },
    });
    if (result.status !== 0) {
      process.stderr.write(`FAIL ${target} ${name} · ${shown} (exit ${result.status ?? 'signal'})\n`);
      return 1;
    }
  }
  if (ctx.dryRun) return 0;
  process.stdout.write(`ok   ${target} ${name} · ${((Date.now() - started) / 1000).toFixed(1)} s\n`);
  if (marker) writeFileSync(marker, `${new Date().toISOString()}\n`, 'utf8');
  return 0;
}

/**
 * @param {ReturnType<typeof parseArgs>} args
 * @param {Workspace} workspace
 * @param {Map<string, Set<string>>} graph
 * @param {string} repo
 * @returns {{ selected: string[], reason: string }}
 */
function selectProjects(args, workspace, graph, repo) {
  const every = { selected: [...workspace.projects.keys()].sort(), reason: '--all' };
  if (args.all) return every;
  if (args.base !== undefined && mergeBaseFor(args.base, repo) === null) {
    throw new Error(`--base=${args.base} does not resolve to a commit reachable from HEAD (fetch it first)`);
  }
  const changed = changedFiles(args.base, repo);
  if (changed === null) return { ...every, reason: 'no git history to compare — every project' };
  const { affected, reason } = affectedProjects(changed, workspace, graph);
  return { selected: affected, reason };
}

/**
 * @param {string[]} argv
 * @param {string} repo
 * @returns {number} exit code
 */
export function main(argv, repo = REPO) {
  const args = parseArgs(argv);
  if (!args.list && (!args.target || !TARGETS.includes(args.target))) {
    process.stderr.write(
      `usage: node tools/scripts/affected.mjs <${TARGETS.join('|')}> [--all] [--base=<ref>] [--no-cache] [--dry-run] [--list]\n`,
    );
    return 2;
  }
  const workspace = readWorkspace(repo);
  const graph = buildGraph(workspace, repo);
  let selection;
  try {
    selection = selectProjects(args, workspace, graph, repo);
  } catch (error) {
    process.stderr.write(`FAIL affected · ${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  }
  const { selected, reason } = selection;
  if (args.list) {
    process.stdout.write(`${selected.join('\n')}${selected.length > 0 ? '\n' : ''}`);
    return 0;
  }
  const target = /** @type {string} */ (args.target);
  process.stdout.write(`affected ${target} · ${selected.length}/${workspace.projects.size} project(s) · ${reason}\n`);
  if (selected.length === 0) {
    process.stdout.write(`ok ${target} · nothing to do\n`);
    return 0;
  }
  mkdirSync(CACHE_DIR, { recursive: true });
  const ctx = { target, workspace, graph, repo, cache: args.cache, dryRun: args.dryRun };
  for (const name of selected) {
    const code = runProject(name, ctx);
    if (code !== 0) return code;
  }
  return 0;
}

if (isMain(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
