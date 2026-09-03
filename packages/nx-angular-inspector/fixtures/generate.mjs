// generate.mjs — the six workspaces the detection and threshold gate are proven against.
//
// Generated, never committed. A committed fixture of a foreign workspace is a copy of somebody
// else's repository that ages silently; a generator is 200 lines that say exactly what shape is
// being claimed, and `node fixtures/generate.mjs <dir>` rebuilds all six in a second.
//
// Three positive (the detection branches) and three negative (the threshold). The three negative
// ones are the only thing that makes the threshold more than a comment:
//
//   nx-only          nx.json, no Angular                       → supported
//   angular-only     angular.json, no nx.json                  → supported, priority 3 source
//   nx-angular       nx.json + @angular/core, NO angular.json  → supported, the real Nx+Angular shape
//   nx-too-old       nx 22                                     → FAIL, names nx >= 23
//   angular-too-old  @angular/core 21                          → FAIL, names angular >= 22
//   plain-npm        npm workspaces and nothing else           → FAIL, no third ecosystem branch
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** @type {readonly string[]} */
export const KINDS = Object.freeze([
  'nx-only',
  'angular-only',
  'nx-angular',
  'nx-too-old',
  'angular-too-old',
  'plain-npm',
]);

/**
 * The graph cache as nx >= 23 writes it: `version: "6.0"`, nodes keyed by project name, an edge
 * list that mixes internal targets with `npm:` externals — because that mix is exactly what the
 * parser has to survive.
 * @param {{ name: string, type: string, root: string, targets: string[], tags: string[] }[]} projects
 * @param {Record<string, string[]>} edges
 * @returns {object}
 */
export function graphFileContent(projects, edges) {
  /** @type {Record<string, unknown>} */
  const nodes = {};
  for (const project of projects) {
    nodes[project.name] = {
      name: project.name,
      type: project.type === 'application' ? 'app' : 'lib',
      data: {
        root: project.root,
        projectType: project.type,
        tags: project.tags,
        targets: Object.fromEntries(project.targets.map((target) => [target, { executor: `@nx/js:${target}` }])),
      },
    };
  }
  /** @type {Record<string, unknown[]>} */
  const dependencies = {};
  for (const project of projects) {
    dependencies[project.name] = [
      // Every project depends on an external package. These must be filtered out of `graph <p>`:
      // on a real workspace they outnumber internal edges 26 to 1.
      { source: project.name, target: 'npm:@angular/core', type: 'static' },
      ...(edges[project.name] ?? []).map((target) => ({ source: project.name, target, type: 'static' })),
    ];
  }
  return {
    version: '6.0',
    nodes,
    externalNodes: { 'npm:@angular/core': { type: 'npm', name: 'npm:@angular/core' } },
    dependencies,
  };
}

/**
 * Write one fixture workspace into `dir`.
 * @param {string} dir
 * @param {string} kind one of `KINDS`
 * @returns {string} dir
 */
export function makeWorkspace(dir, kind) {
  if (!KINDS.includes(kind)) throw new Error(`nieznany fixture: ${kind}`);
  const write = (/** @type {string} */ rel, /** @type {unknown} */ value) => {
    const file = path.join(dir, ...rel.split('/'));
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  };
  const installed = (/** @type {string} */ id, /** @type {string} */ version) =>
    write(`node_modules/${id}/package.json`, { name: id, version });

  mkdirSync(dir, { recursive: true });
  write('package.json', { name: `fixture-${kind}`, private: true, version: '0.0.0' });

  if (kind === 'plain-npm') {
    write('package.json', { name: 'fixture-plain-npm', private: true, workspaces: ['packages/*'] });
    write('packages/tool/package.json', { name: 'tool', version: '0.0.0' });
    return dir;
  }

  if (kind === 'angular-only' || kind === 'angular-too-old') {
    installed('@angular/core', kind === 'angular-too-old' ? '21.2.0' : '22.1.3');
    write('angular.json', {
      version: 1,
      projects: {
        portal: {
          root: 'apps/portal',
          projectType: 'application',
          architect: { build: {}, serve: {}, test: {} },
        },
        'ui-kit': { root: 'libs/ui-kit', projectType: 'library', architect: { build: {}, test: {} } },
      },
    });
    write('apps/portal/tsconfig.json', { compilerOptions: {} });
    write('libs/ui-kit/tsconfig.json', { compilerOptions: {} });
    if (kind === 'angular-only') write('node_modules/@angular/core/best-practices.md', '# zasady\n\nprzykład\n');
    return dir;
  }

  // The three Nx shapes.
  installed('nx', kind === 'nx-too-old' ? '22.4.0' : '23.1.1');
  write('nx.json', { defaultBase: 'main', targetDefaults: { build: { cache: true } } });
  // Angular is installed in `nx-angular` only. `nx-too-old` has to isolate ONE variable: if it also
  // carried Angular, its FAIL line would name two versions and stop proving which rule fired.
  if (kind === 'nx-angular') installed('@angular/core', '22.1.3');

  const projects = [
    { name: 'portal', type: 'application', root: 'apps/portal', targets: ['build', 'serve', 'lint'], tags: ['type:app'] },
    { name: 'ui-kit', type: 'library', root: 'libs/ui-kit', targets: ['build', 'lint', 'test'], tags: ['type:lib'] },
    { name: 'utils', type: 'library', root: 'libs/utils', targets: ['build', 'lint'], tags: ['type:lib'] },
  ];
  for (const project of projects) {
    // `project.json` declares only `build`. Everything else — `lint`, `serve`, `test` — exists only
    // in the graph, which is the whole reason the tool reads the graph and not this file.
    write(`${project.root}/project.json`, { name: project.name, root: project.root, targets: { build: {} } });
    write(`${project.root}/tsconfig.json`, { compilerOptions: {} });
  }
  write(
    '.nx/workspace-data/project-graph.json',
    graphFileContent(projects, { portal: ['ui-kit', 'utils'], 'ui-kit': ['utils'] }),
  );

  // `serve-hang` and `serve-die` are answered by the stand-in but deliberately NOT declared in the
  // graph: a real workspace has no such targets, and putting them there would shift every other
  // test's target counts to accommodate a testing convenience. The serve tests reach them through
  // `startServe` directly.
  // The `nx` stand-in lives in its own file (`nx-stub.cjs`) and is COPIED here rather than
  // written as a string: a program embedded in a string literal is unreadable in a diff and one
  // escaping mistake away from being silently broken.
  write('node_modules/nx/bin/nx.js', readFileSync(path.join(HERE, 'nx-stub.cjs'), 'utf8'));
  write('node_modules/nx/bin/dev-server.cjs', readFileSync(path.join(HERE, 'dev-server.cjs'), 'utf8'));

  // A generator collection, so `gen` has something real to find in every Nx fixture.
  write('node_modules/@nx/js/package.json', { name: '@nx/js', version: '23.1.1', generators: './generators.json' });
  write('node_modules/@nx/js/generators.json', {
    generators: {
      library: { description: 'Tworzy bibliotekę TypeScript.', schema: './schema-library.json' },
      internal: { description: 'Nie dla ludzi.', hidden: true, schema: './schema-library.json' },
    },
  });
  write('node_modules/@nx/js/schema-library.json', {
    $schema: 'http://json-schema.org/schema',
    required: ['directory'],
    properties: {
      directory: { type: 'string', description: 'Gdzie utworzyć bibliotekę.' },
      bundler: { type: 'string', enum: ['tsc', 'swc', 'none'], default: 'tsc', description: 'Bundler.' },
      unitTestRunner: { type: 'string', enum: ['vitest', 'jest', 'none'], default: 'vitest' },
      tags: { type: 'string', description: 'Tagi rozdzielone przecinkami.' },
    },
  });
  return dir;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const target = process.argv[2] ?? path.join(path.dirname(fileURLToPath(import.meta.url)), 'ws');
  for (const kind of KINDS) makeWorkspace(path.join(target, kind), kind);
  process.stdout.write(`ok fixtures · ${String(KINDS.length)} workspace'ów · ${target}\n`);
}
