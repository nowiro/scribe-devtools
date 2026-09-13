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
// `lint`, `typecheck` and `test` produce no outputs, so a run that already succeeded on identical
// inputs need not run again: the inputs (every file of the project and of its dependencies, the root
// triggers, the target name, the Node major) are hashed, and a marker in `.cache/tasks/` records the
// green run. GitLab CI carries `.cache/` between jobs and branches, so the cache is shared without any
// remote service. `build` (Angular has its own cache in .angular/cache) and `e2e` are never cached.
// `--no-cache` or `CB_TASK_CACHE=0` bypasses the markers.
//
// Exit codes: 0 pass (also when nothing is affected) · 1 a task failed · 2 usage error.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { displayCommand } from './display-command.mjs';

export const REPO = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
export const TARGETS = Object.freeze(['lint', 'typecheck', 'test', 'build', 'e2e']);
const CACHED_TARGETS = new Set(['lint', 'typecheck', 'test']);
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
const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  '.angular',
  '.cache',
  'coverage',
  'playwright-report',
  'test-results',
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
  const tsconfigText = readFileSync(path.join(repo, 'tsconfig.json'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .replace(/^\s*\/\/.*$/gmu, '');
  const paths = JSON.parse(tsconfigText).compilerOptions?.paths ?? {};
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
  const walk = (/** @type {string} */ rel) => {
    const abs = path.join(repo, rel);
    if (!existsSync(abs)) return;
    for (const entry of readdirSync(abs, { withFileTypes: true })) {
      const childRel = `${rel}/${entry.name}`;
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) walk(childRel);
      } else out.push(childRel);
    }
  };
  walk(dir.replace(/\/$/u, ''));
  return out.sort();
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
  const pattern = /(?:from\s+|import\s*\(\s*)['"]([^'"]+)['"]/gu;
  for (const project of workspace.projects.values()) {
    const deps = new Set();
    for (const file of listFiles(repo, project.root)) {
      if (!/\.(?:ts|mts)$/u.test(file) || /\.d\.ts$/u.test(file)) continue;
      const source = readFileSync(path.join(repo, file), 'utf8');
      for (const match of source.matchAll(pattern)) {
        const specifier = match[1];
        for (const [alias, owner] of workspace.aliases) {
          if ((specifier === alias || specifier.startsWith(`${alias}/`)) && owner !== project.name) deps.add(owner);
        }
      }
    }
    if (project.name.endsWith('-e2e')) {
      const app = project.name.slice(0, -4);
      if (workspace.projects.has(app)) deps.add(app);
    }
    graph.set(project.name, deps);
  }
  return graph;
}

/**
 * @param {string[]} args
 * @returns {string | null} stdout, or null when git is unavailable or the command failed
 */
function git(args, repo = REPO) {
  const result = spawnSync('git', args, { cwd: repo, encoding: 'utf8' });
  return result.status === 0 ? result.stdout : null;
}

/**
 * Changed files (committed since the merge base with `base`, staged, unstaged and untracked), or
 * null when there is no git history to compare against — the caller then treats everything as affected.
 * @param {string | undefined} base
 * @param {string} repo
 * @returns {string[] | null}
 */
export function changedFiles(base, repo = REPO) {
  if (git(['rev-parse', '--is-inside-work-tree'], repo) === null) return null;
  const candidates = base ? [base] : ['origin/main', 'main', 'origin/master', 'master'];
  let mergeBase = null;
  for (const candidate of candidates) {
    mergeBase = git(['merge-base', candidate, 'HEAD'], repo)?.trim() ?? null;
    if (mergeBase) break;
  }
  const outputs = [
    mergeBase ? git(['diff', '--name-only', mergeBase, 'HEAD'], repo) : null,
    git(['diff', '--name-only'], repo),
    git(['diff', '--name-only', '--cached'], repo),
    git(['ls-files', '--others', '--exclude-standard'], repo),
  ];
  if (mergeBase === null && outputs.slice(1).every((out) => out === null)) return null;
  const files = new Set();
  for (const out of outputs)
    for (const line of (out ?? '').split('\n')) if (line.trim() !== '') files.add(line.trim().replace(/\\/gu, '/'));
  return [...files].sort();
}

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
    if (changed.some((file) => file === project.root || file.startsWith(`${project.root}/`))) marked.add(project.name);
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
 * Run one project's commands for the target, honouring the task cache.
 * @param {string} name
 * @param {RunContext} ctx
 * @returns {number} exit code — 0 also when the project has no such target or the cache hit
 */
function runProject(name, ctx) {
  const { target, workspace, graph, repo } = ctx;
  const project = /** @type {Project} */ (workspace.projects.get(name));
  const commands = commandsFor(project, target, repo);
  if (commands.length === 0) {
    process.stdout.write(`skip ${target} ${name} · no such target\n`);
    return 0;
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
      env: { ...process.env, NG_CLI_ANALYTICS: 'false' },
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
  const { selected, reason } = selectProjects(args, workspace, graph, repo);
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

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  process.exitCode = main(process.argv.slice(2));
}
