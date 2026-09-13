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
  commandsFor,
  listFiles,
  parseArgs,
  readWorkspace,
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
    expect(commandsFor(demo, 'lint', repo)[0]?.slice(2, 4)).toEqual(['apps/demo', '--max-warnings=0']);
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
