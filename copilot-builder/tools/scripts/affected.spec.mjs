import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ROOT_TRIGGERS,
  TARGETS,
  affectedProjects,
  buildGraph,
  changedFiles,
  commandsFor,
  listFiles,
  main,
  mergeBaseFor,
  parseArgs,
  readWorkspace,
  taskHash,
} from './affected.mjs';

/**
 * @param {string} repo
 * @param {string} rel
 * @param {string} text
 */
function write(repo, rel, text) {
  mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true });
  writeFileSync(path.join(repo, rel), text, 'utf8');
}

/** @param {string} root @param {'application' | 'library'} projectType @param {Record<string, unknown>} architect */
const project = (root, projectType, architect) => ({
  projectType,
  root,
  sourceRoot: `${root}/src`,
  prefix: 'cb',
  architect,
});
const unitTest = { builder: '@angular/build:unit-test', options: {} };
const ANGULAR = {
  projects: {
    demo: project('apps/demo', 'application', {
      build: { builder: '@angular/build:application', options: {} },
      test: unitTest,
    }),
    'demo-e2e': project('apps/demo-e2e', 'application', {}),
    'shared-util': project('libs/shared/util', 'library', {
      build: { builder: '@angular/build:ng-packagr', options: {} },
      test: unitTest,
    }),
    'shared-ui': project('libs/shared/ui', 'library', { test: unitTest }),
  },
};
const TSCONFIG = {
  compilerOptions: {
    paths: {
      '@cb/shared/util': ['./libs/shared/util/src/public-api.ts'],
      '@cb/shared/ui': ['./libs/shared/ui/src/public-api.ts'],
    },
  },
};

describe('affected.mjs on a small workspace', () => {
  /** @type {string} */
  let repo;
  /** @type {ReturnType<typeof readWorkspace>} */
  let workspace;
  /** @type {Map<string, Set<string>>} */
  let graph;

  beforeEach(() => {
    repo = mkdtempSync(path.join(os.tmpdir(), 'cb-affected-'));
    write(repo, 'angular.json', JSON.stringify(ANGULAR));
    write(repo, 'tsconfig.json', JSON.stringify(TSCONFIG));
    write(repo, 'apps/demo/tsconfig.app.json', '{}');
    write(repo, 'apps/demo/tsconfig.spec.json', '{}');
    write(repo, 'apps/demo/src/main.ts', "import './app/app';\n");
    write(repo, 'apps/demo/src/app/app.ts', "import { SharedUi } from '@cb/shared/ui';\nexport const x = SharedUi;\n");
    // a declaration file and a dependency folder do not create edges
    write(repo, 'apps/demo/src/types.d.ts', "import type { Y } from '@cb/shared/util';\nexport type Z = Y;\n");
    write(repo, 'apps/demo/node_modules/pkg/index.ts', "import '@cb/shared/util';\n");
    write(repo, 'apps/demo-e2e/tsconfig.json', '{}');
    write(repo, 'apps/demo-e2e/src/smoke.spec.ts', 'export {};\n');
    write(repo, 'libs/shared/ui/src/public-api.ts', "export * from './lib/shared-ui';\n");
    write(
      repo,
      'libs/shared/ui/src/lib/shared-ui.ts',
      "import { sharedUtil } from '@cb/shared/util';\nexport const SharedUi = sharedUtil;\n",
    );
    write(repo, 'libs/shared/util/src/public-api.ts', "export * from './lib/shared-util';\n");
    write(repo, 'libs/shared/util/src/lib/shared-util.ts', "export const sharedUtil = 'x';\n");
    workspace = readWorkspace(repo);
    graph = buildGraph(workspace, repo);
  });
  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  it('reads projects and resolves aliases to their owning project', () => {
    expect([...workspace.projects.keys()].sort()).toEqual(['demo', 'demo-e2e', 'shared-ui', 'shared-util']);
    expect(workspace.aliases.get('@cb/shared/util')).toBe('shared-util');
    expect(workspace.aliases.get('@cb/shared/ui')).toBe('shared-ui');
  });

  it('lists project files sorted and skips dependency folders', () => {
    const files = listFiles(repo, 'apps/demo');
    expect(files).toContain('apps/demo/src/app/app.ts');
    expect(files.some((file) => file.includes('node_modules'))).toBe(false);
    expect(files).toEqual([...files].sort());
  });

  it('builds the dependency graph from alias imports and the <app>-e2e convention', () => {
    expect([...(graph.get('demo') ?? [])]).toEqual(['shared-ui']);
    expect([...(graph.get('shared-ui') ?? [])]).toEqual(['shared-util']);
    expect([...(graph.get('demo-e2e') ?? [])]).toEqual(['demo']);
    expect([...(graph.get('shared-util') ?? [])]).toEqual([]);
  });

  it('marks dependents transitively', () => {
    expect(affectedProjects(['libs/shared/util/src/lib/shared-util.ts'], workspace, graph)).toEqual({
      affected: ['demo', 'demo-e2e', 'shared-ui', 'shared-util'],
      reason: '1 changed file(s)',
    });
    expect(affectedProjects(['apps/demo/src/main.ts'], workspace, graph).affected).toEqual(['demo', 'demo-e2e']);
    expect(affectedProjects(['libs/shared/ui/src/lib/shared-ui.ts'], workspace, graph).affected).toEqual([
      'demo',
      'demo-e2e',
      'shared-ui',
    ]);
  });

  it('treats a root trigger as touching every project and unrelated files as touching none', () => {
    expect(ROOT_TRIGGERS).toContain('package.json');
    expect(affectedProjects(['package.json'], workspace, graph)).toEqual({
      affected: ['demo', 'demo-e2e', 'shared-ui', 'shared-util'],
      reason: 'root trigger changed: package.json',
    });
    expect(affectedProjects(['README.md', 'docs/x.md'], workspace, graph).affected).toEqual([]);
  });

  it('maps targets to commands per project kind', () => {
    const demo = /** @type {NonNullable<ReturnType<typeof workspace.projects.get>>} */ (workspace.projects.get('demo'));
    const e2e = /** @type {NonNullable<ReturnType<typeof workspace.projects.get>>} */ (
      workspace.projects.get('demo-e2e')
    );
    const util = /** @type {NonNullable<ReturnType<typeof workspace.projects.get>>} */ (
      workspace.projects.get('shared-util')
    );

    expect(commandsFor(demo, 'build', repo).map((command) => command.slice(2))).toEqual([['build', 'demo']]);
    // a library's ng-packagr target is for publishing, never for CI
    expect(commandsFor(util, 'build', repo)).toEqual([]);
    expect(commandsFor(e2e, 'test', repo)).toEqual([]);
    expect(commandsFor(demo, 'typecheck', repo).map((command) => command[3])).toEqual([
      'apps/demo/tsconfig.app.json',
      'apps/demo/tsconfig.spec.json',
    ]);
    expect(commandsFor(e2e, 'typecheck', repo).map((command) => command[3])).toEqual(['apps/demo-e2e/tsconfig.json']);
    expect(commandsFor(e2e, 'e2e', repo)).toEqual([]);
    write(repo, 'apps/demo-e2e/playwright.config.ts', 'export default {};\n');
    expect(commandsFor(e2e, 'e2e', repo)[0]?.slice(2)).toEqual([
      'test',
      '--config',
      'apps/demo-e2e/playwright.config.ts',
    ]);
    expect(commandsFor(demo, 'lint', repo)[0]?.slice(2)).toEqual(['apps/demo']);
    expect(commandsFor(demo, 'lint', repo)[1]?.slice(2, 4)).toEqual(['apps/demo', '--max-warnings=0']);
  });
});

describe('parseArgs', () => {
  const saved = process.env.CB_TASK_CACHE;
  afterEach(() => {
    if (saved === undefined) delete process.env.CB_TASK_CACHE;
    else process.env.CB_TASK_CACHE = saved;
  });

  it('reads the target and the flags', () => {
    delete process.env.CB_TASK_CACHE;
    expect(parseArgs(['test', '--all', '--base=origin/dev', '--no-cache', '--dry-run'])).toEqual({
      target: 'test',
      all: true,
      base: 'origin/dev',
      cache: false,
      dryRun: true,
      list: false,
    });
  });

  it('lets CB_TASK_CACHE=0 switch the task cache off', () => {
    process.env.CB_TASK_CACHE = '0';
    expect(parseArgs(['lint']).cache).toBe(false);
    process.env.CB_TASK_CACHE = '1';
    expect(parseArgs(['lint']).cache).toBe(true);
  });

  it('knows the five targets', () => {
    expect([...TARGETS]).toEqual(['lint', 'typecheck', 'test', 'build', 'e2e']);
  });
});

/**
 * @param {string} cwd
 * @param {string[]} args
 * @returns {string}
 */
function git(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  return result.stdout.trim();
}

/**
 * A repository with one commit on `trunk` (the default branch is NOT main) and the small workspace.
 * @param {string} dir
 */
function seedRepo(dir) {
  git(dir, ['init', '-q', '-b', 'trunk']);
  git(dir, ['config', 'user.email', 'spec@example.com']);
  git(dir, ['config', 'user.name', 'spec']);
  git(dir, ['config', 'commit.gpgsign', 'false']);
  write(dir, 'angular.json', JSON.stringify(ANGULAR));
  write(dir, 'tsconfig.json', JSON.stringify(TSCONFIG));
  write(dir, 'apps/demo/src/main.ts', 'export {};\n');
  write(dir, 'libs/shared/util/src/public-api.ts', 'export {};\n');
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', 'init']);
}

describe('changedFiles against real git history', () => {
  /** @type {string} */
  let repo;
  beforeEach(() => {
    repo = mkdtempSync(path.join(os.tmpdir(), 'cb-affected-git-'));
    seedRepo(repo);
  });
  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  it('returns null — everything affected — when no default branch can be found', () => {
    expect(mergeBaseFor(undefined, repo)).toBeNull();
    expect(changedFiles(undefined, repo)).toBeNull();
    expect(main(['--list'], repo)).toBe(0);
  });

  it('refuses an explicit base that does not exist instead of reporting nothing to do', () => {
    expect(mergeBaseFor('nonexistent', repo)).toBeNull();
    expect(main(['test', '--base=nonexistent'], repo)).toBe(2);
  });

  it('diffs against the merge base with a default branch, including uncommitted and untracked files', () => {
    git(repo, ['branch', 'main']);
    git(repo, ['checkout', '-q', '-b', 'feature']);
    write(repo, 'libs/shared/util/src/lib/x.ts', 'export const x = 1;\n');
    git(repo, ['add', '-A']);
    git(repo, ['commit', '-q', '-m', 'feat']);
    write(repo, 'apps/demo/src/main.ts', 'export const y = 2;\n');
    write(repo, 'apps/demo/src/new.ts', 'export {};\n');
    expect(changedFiles(undefined, repo)).toEqual([
      'apps/demo/src/main.ts',
      'apps/demo/src/new.ts',
      'libs/shared/util/src/lib/x.ts',
    ]);
    expect(changedFiles('main', repo)).toEqual([
      'apps/demo/src/main.ts',
      'apps/demo/src/new.ts',
      'libs/shared/util/src/lib/x.ts',
    ]);
  });

  it('keeps non-ASCII paths readable so they still match a project root', () => {
    git(repo, ['branch', 'main']);
    git(repo, ['checkout', '-q', '-b', 'feature']);
    write(repo, 'apps/demo/src/zażółć.ts', 'export {};\n');
    git(repo, ['add', '-A']);
    git(repo, ['commit', '-q', '-m', 'feat']);
    expect(changedFiles(undefined, repo)).toEqual(['apps/demo/src/zażółć.ts']);
  });
});

describe('graph edges from angular.json options and the task hash', () => {
  /** @type {string} */
  let repo;
  beforeEach(() => {
    repo = mkdtempSync(path.join(os.tmpdir(), 'cb-affected-hash-'));
    const angular = structuredClone(ANGULAR);
    angular.projects.demo.architect.build.options = { styles: ['libs/shared/ui/src/styles/tokens.css'] };
    write(repo, 'angular.json', JSON.stringify(angular));
    write(repo, 'tsconfig.json', JSON.stringify(TSCONFIG));
    write(repo, 'apps/demo/src/main.ts', 'export {};\n');
    write(repo, 'libs/shared/ui/src/styles/tokens.css', ':root { --x: 1; }\n');
    write(repo, 'libs/shared/ui/src/public-api.ts', 'export {};\n');
    write(repo, 'libs/shared/util/src/public-api.ts', 'export {};\n');
  });
  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  it('adds an edge for shared styles listed in the build options', () => {
    const workspace = readWorkspace(repo);
    const graph = buildGraph(workspace, repo);
    expect([...(graph.get('demo') ?? [])]).toEqual(['shared-ui']);
    expect(affectedProjects(['libs/shared/ui/src/styles/tokens.css'], workspace, graph).affected).toEqual([
      'demo',
      'demo-e2e',
      'shared-ui',
    ]);
  });

  it('changes the task hash when a dependency file, the target or the command changes', () => {
    const workspace = readWorkspace(repo);
    const graph = buildGraph(workspace, repo);
    const demo = /** @type {NonNullable<ReturnType<typeof workspace.projects.get>>} */ (workspace.projects.get('demo'));
    const before = taskHash(demo, graph, workspace, 'lint', repo);
    expect(taskHash(demo, graph, workspace, 'lint', repo)).toBe(before);
    expect(taskHash(demo, graph, workspace, 'typecheck', repo)).not.toBe(before);
    write(repo, 'libs/shared/ui/src/styles/tokens.css', ':root { --x: 2; }\n');
    expect(taskHash(demo, graph, workspace, 'lint', repo)).not.toBe(before);
  });
});
