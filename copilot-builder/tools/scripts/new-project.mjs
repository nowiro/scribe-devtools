#!/usr/bin/env node
// new-project.mjs — the ONE way an application or a library is added to this workspace (0 credits).
//
//   npm run new:app -- <name>                      → apps/<name> (+ apps/<name>-e2e with Playwright)
//   npm run new:lib -- <scope>/<type>[-<name>]     → libs/<scope>/<type>[-<name>], alias <ALIAS_SCOPE>/<scope>/<type>[-<name>]
//   options: --dry-run (print the generator command only), --prefix=<selector prefix> (default: PREFIX of
//   tools/scripts/workspace.config.mjs), --port=<n> (e2e port; default: derived from the name, first free)
//
// It runs the Angular CLI generator and then makes the result fit THIS repository — the things the
// generator cannot know:
//   - the manifest is restored afterwards (the schematics append prettier, jsdom and ng-packagr to
//     package.json; every version here is pinned in ONE place, tools/scripts/pins.config.mjs);
//   - the `test` target points at the shared Vitest runner config (coverage thresholds, CI reporters);
//   - a library is consumed FROM SOURCE through a tsconfig alias (`<ALIAS_SCOPE>/<scope>/<type>` → its
//     public-api.ts) instead of the generated `dist/` alias; the ng-packagr `build` target stays as
//     generated because the unit-test builder derives the library's compile options from it, but CI
//     never runs it (`affected build` builds applications only) — publishing is a later, explicit step;
//   - components get `changeDetection: OnPush` (the lint rule requires it) and the 20 kB placeholder
//     page becomes a minimal template that the generated spec still passes;
//   - the result is run through `eslint --fix` and `biome format` so that it satisfies the
//     repository's own rules on day one (the schematics know neither);
//   - an application gets an e2e project (`apps/<name>-e2e`) with a Playwright config that serves the
//     BUILT application through tools/testing/serve-static.mjs and a smoke test over the viewport matrix
//     (`ui.viewports` of .github/models-registry.json);
//   - the change is transactional: when a post-processing step fails, angular.json and tsconfig.json go
//     back to their previous content and the generated directories are removed, so the next attempt
//     starts clean instead of hitting "already exists".
//
// The library <type> is one of feature, ui, data-access, util — it is the first segment of the name
// and it is what eslint.rules.mjs uses to enforce the dependency direction.
//
// Exit codes: 0 done · 1 the generator or a post-processing step failed · 2 usage error.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ALIAS_SCOPE, PREFIX } from './workspace.config.mjs';
import { REPO, isMain, readJsonc } from './lib/repo.mjs';

const NG = path.join(REPO, 'node_modules', '@angular', 'cli', 'bin', 'ng.js');
const RUNNER_CONFIG = 'tools/testing/vitest-angular.config.mts';
export const LIB_TYPES = Object.freeze(['feature', 'ui', 'data-access', 'util']);
const KEBAB = /^[a-z][a-z0-9-]*$/u;

const USAGE = [
  'usage:',
  `  npm run new:app -- <name> [--prefix=${PREFIX}] [--port=<n>] [--dry-run]`,
  `  npm run new:lib -- <scope>/<type>[-<name>] [--prefix=${PREFIX}] [--dry-run]   type: feature | ui | data-access | util`,
].join('\n');

/** @param {string} rel @returns {any} */
const readJson = (rel) => JSON.parse(readFileSync(path.join(REPO, rel), 'utf8'));
/** @param {string} rel @param {unknown} value */
const writeJson = (rel, value) => writeFileSync(path.join(REPO, rel), `${JSON.stringify(value, null, 2)}\n`, 'utf8');
/** tsconfig.json is plain JSON (the CLI rewrites it without comments); a stray comment is tolerated on read. */
function readTsconfig() {
  return readJsonc(path.join(REPO, 'tsconfig.json'));
}
/** @param {unknown} json */
const writeTsconfig = (json) => writeJson('tsconfig.json', json);
/** @param {string} value */
const pascal = (value) =>
  value
    .split(/[-/]/u)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
/** @param {string} value */
const camel = (value) => {
  const p = pascal(value);
  return p.charAt(0).toLowerCase() + p.slice(1);
};

/**
 * `ng generate …` with the manifest protected: whatever the schematic appends to package.json is
 * reverted, because every dependency of this repository is pinned in one place.
 * @param {string[]} args
 * @param {boolean} dryRun
 * @returns {boolean}
 */
function generate(args, dryRun) {
  const shown = `ng ${args.join(' ')}`;
  if (dryRun) {
    process.stdout.write(`dry-run · ${shown}\n`);
    return true;
  }
  const manifestBefore = readFileSync(path.join(REPO, 'package.json'), 'utf8');
  const result = spawnSync(process.execPath, [NG, ...args], {
    cwd: REPO,
    stdio: 'inherit',
    env: { ...process.env, NG_CLI_ANALYTICS: 'false' },
  });
  const manifestAfter = readFileSync(path.join(REPO, 'package.json'), 'utf8');
  if (manifestAfter !== manifestBefore) {
    writeFileSync(path.join(REPO, 'package.json'), manifestBefore, 'utf8');
    process.stdout.write(
      'restored package.json (the generator appends its own dependency versions; ours are pinned in tools/scripts/pins.config.mjs)\n',
    );
  }
  if (result.status !== 0) process.stderr.write(`FAIL ${shown} (exit ${result.status ?? 'signal'})\n`);
  return result.status === 0;
}

/**
 * Inserts `changeDetection: ChangeDetectionStrategy.OnPush` into the first `@Component({` of a file.
 * @param {string} rel
 */
function addOnPush(rel) {
  const abs = path.join(REPO, rel);
  if (!existsSync(abs)) return;
  let text = readFileSync(abs, 'utf8');
  if (text.includes('ChangeDetectionStrategy.OnPush')) return;
  text = text.replace(/import \{ ([^}]*)\} from '@angular\/core';/u, (_, names) => {
    const list = names
      .split(',')
      .map((/** @type {string} */ n) => n.trim())
      .filter(Boolean);
    if (!list.includes('ChangeDetectionStrategy')) list.unshift('ChangeDetectionStrategy');
    return `import { ${list.join(', ')} } from '@angular/core';`;
  });
  text = text.replace(/@Component\(\{\n/u, '@Component({\n  changeDetection: ChangeDetectionStrategy.OnPush,\n');
  writeFileSync(abs, text, 'utf8');
}

/** Ports already taken by the e2e projects of this workspace (`const PORT = <n>;` in their configs). */
export function existingE2ePorts(repo = REPO) {
  /** @type {Set<number>} */
  const taken = new Set();
  const apps = path.join(repo, 'apps');
  if (!existsSync(apps)) return taken;
  for (const entry of readdirSync(apps, { withFileTypes: true })) {
    const config = path.join(apps, entry.name, 'playwright.config.ts');
    if (!entry.isDirectory() || !existsSync(config)) continue;
    const match = /const PORT = (\d+);/u.exec(readFileSync(config, 'utf8'));
    if (match) taken.add(Number(match[1]));
  }
  return taken;
}

/**
 * The e2e port of a new application: the requested one when given, otherwise one derived from the
 * NAME (so two branches scaffolding the same application agree) and moved up while it collides with
 * a port already in use — a counter of projects would hand two applications created on parallel
 * branches the same port.
 * @param {string} name
 * @param {Set<number>} taken
 * @param {number} [requested]
 * @returns {number}
 */
export function allocatePort(name, taken, requested) {
  if (requested !== undefined) {
    if (!Number.isInteger(requested) || requested < 1024 || requested > 65_535)
      throw new Error(`--port must be an integer between 1024 and 65535 (got ${requested})`);
    if (taken.has(requested)) throw new Error(`--port ${requested} is already used by another e2e project`);
    return requested;
  }
  let hash = 0;
  for (const char of name) hash = (hash * 31 + (char.codePointAt(0) ?? 0)) % 100_000;
  let port = 4300 + (hash % 100);
  while (taken.has(port)) port += 1;
  return port;
}

/** The two workspace files every generator rewrites, as they were before it ran. */
function snapshotWorkspace() {
  return Object.fromEntries(
    ['angular.json', 'tsconfig.json'].map((rel) => [rel, readFileSync(path.join(REPO, rel), 'utf8')]),
  );
}

/**
 * Undo a half-finished generation: the workspace files back to the snapshot, the new directories gone.
 * @param {Record<string, string>} snapshot
 * @param {string[]} roots directories the generation created
 * @param {unknown} error
 */
function rollback(snapshot, roots, error) {
  for (const [rel, text] of Object.entries(snapshot)) writeFileSync(path.join(REPO, rel), text, 'utf8');
  for (const root of roots) rmSync(path.join(REPO, root), { recursive: true, force: true });
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(
    `FAIL new-project · ${message}\n  rolled back: ${Object.keys(snapshot).join(', ')} restored, ${roots.join(', ')} removed\n`,
  );
}

/**
 * The generated code through the repository's own tools: `eslint --fix` (type imports, catch
 * variables, void expressions the schematics do not care about) and then `biome format`. A problem
 * ESLint cannot fix is reported as a warning — the files are already on disk, the gate will say the rest.
 * @param {string[]} roots repository-relative project roots
 * @returns {string | null} a warning line, or null when the result is clean
 */
function polish(roots) {
  const eslint = spawnSync(
    process.execPath,
    [path.join(REPO, 'node_modules', 'eslint', 'bin', 'eslint.js'), ...roots, '--fix', '--max-warnings=0'],
    { cwd: REPO, encoding: 'utf8' },
  );
  // the workspace files the generator rewrote (JSON.stringify layout ≠ Biome layout) are formatted too
  spawnSync(
    process.execPath,
    [
      path.join(REPO, 'node_modules', '@biomejs', 'biome', 'bin', 'biome'),
      'format',
      '--write',
      ...roots,
      'angular.json',
      'tsconfig.json',
    ],
    { cwd: REPO, stdio: 'ignore' },
  );
  if (eslint.status === 0) return null;
  const summary = `${eslint.stdout}${eslint.stderr}`.trim().split('\n').slice(-2).join(' ');
  return `warn lint still reports problems in ${roots.join(', ')} — ${summary} · fix them before pushing (npm run affected -- lint)`;
}

/**
 * @param {string} name
 * @param {{ prefix: string, dryRun: boolean, port?: number }} options
 * @returns {number}
 */
export function newApplication(name, { prefix, dryRun, port: requestedPort }) {
  if (!KEBAB.test(name) || name.endsWith('-e2e')) {
    process.stderr.write(`application name must be kebab-case and not end with -e2e (got "${name}")\n${USAGE}\n`);
    return 2;
  }
  const root = `apps/${name}`;
  const e2eName = `${name}-e2e`;
  const e2eRoot = `apps/${e2eName}`;
  if (existsSync(path.join(REPO, root)) || existsSync(path.join(REPO, e2eRoot))) {
    process.stderr.write(`FAIL ${root} or ${e2eRoot} already exists\n`);
    return 1;
  }
  /** @type {number} */
  let port;
  try {
    port = allocatePort(name, existingE2ePorts(), requestedPort);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n${USAGE}\n`);
    return 2;
  }
  const snapshot = snapshotWorkspace();
  const ok = generate(
    [
      'generate',
      'application',
      name,
      `--project-root=${root}`,
      `--prefix=${prefix}`,
      '--style=css',
      '--routing',
      '--ssr=false',
      '--skip-install',
      '--defaults',
    ],
    dryRun,
  );
  if (!ok) return 1;
  if (dryRun) return 0;
  try {
    finishApplication({ name, root, e2eName, e2eRoot, port, prefix });
  } catch (error) {
    rollback(snapshot, [root, e2eRoot], error);
    return 1;
  }
  const warning = polish([root, e2eRoot]);
  if (warning) process.stdout.write(`${warning}\n`);
  process.stdout.write(
    [
      `ok new:app · ${root} (project ${name}) + ${e2eRoot} (project ${e2eName}, port ${port})`,
      `next: npm run affected -- test · npm run affected -- build · node node_modules/@angular/cli/bin/ng.js serve ${name}`,
      '',
    ].join('\n'),
  );
  return 0;
}

/**
 * Everything after `ng generate application`: the workspace entries, the minimal template, the
 * canonical bootstrap and the e2e project. Throws on any failure — the caller rolls back.
 * @param {{ name: string, root: string, e2eName: string, e2eRoot: string, port: number, prefix: string }} app
 */
function finishApplication({ name, root, e2eName, e2eRoot, port, prefix }) {
  // build output mirrors the source layout (dist/apps/<name>/browser — what the e2e project serves);
  // test target → shared runner config
  const angular = readJson('angular.json');
  const project = angular.projects[name];
  project.architect.build.options.outputPath = `dist/${root}`;
  project.architect.test = {
    builder: '@angular/build:unit-test',
    options: { tsConfig: `${root}/tsconfig.spec.json`, runnerConfig: RUNNER_CONFIG },
  };

  // minimal template instead of the placeholder page; the generated spec expects `Hello, <name>` in an h1
  writeFileSync(
    path.join(REPO, root, 'src/app/app.html'),
    ['<main class="app">', `  <h1>Hello, {{ title() }}</h1>`, '  <router-outlet />', '</main>', ''].join('\n'),
    'utf8',
  );
  writeFileSync(path.join(REPO, root, 'src/app/app.css'), ['.app {', '  padding: 1rem;', '}', ''].join('\n'), 'utf8');
  addOnPush(`${root}/src/app/app.ts`);
  // the schematic's `.catch((err) => console.error(err))` is what the lint rules reject; write the
  // canonical bootstrap instead (typed catch variable, block body)
  writeFileSync(
    path.join(REPO, root, 'src/main.ts'),
    [
      "import { bootstrapApplication } from '@angular/platform-browser';",
      "import { appConfig } from './app/app.config';",
      "import { App } from './app/app';",
      '',
      'bootstrapApplication(App, appConfig).catch((error: unknown) => {',
      '  console.error(error);',
      '});',
      '',
    ].join('\n'),
    'utf8',
  );

  // e2e project over the BUILT application; report paths are relative to the CONFIG FILE in
  // Playwright, so they climb to the repository root where CI collects them
  const viewports = JSON.stringify(
    readJson('.github/models-registry.json').ui?.viewports ?? [360, 768, 1024, 1440, 1920],
  );
  mkdirSync(path.join(REPO, e2eRoot, 'src'), { recursive: true });
  writeFileSync(
    path.join(REPO, e2eRoot, 'playwright.config.ts'),
    `import { defineConfig, devices } from '@playwright/test';

// E2E of the BUILT application: \`npm run affected -- build\` first (CI: the build job's dist/ artifact).
// Locally, \`reuseExistingServer\` lets you point the tests at a running \`ng serve ${name}\` on this port instead.
const PORT = ${port};

export default defineConfig({
  testDir: './src',
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 2 : 0,
  workers: process.env['CI'] ? 2 : undefined,
  // Playwright resolves these against this file's directory: ../../ is the repository root.
  reporter: process.env['CI'] ? [['list'], ['junit', { outputFile: '../../reports/junit-e2e-${name}.xml' }]] : 'list',
  outputDir: '../../test-results/${name}',
  use: {
    baseURL: \`http://127.0.0.1:\${PORT}\`,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    testIdAttribute: 'data-testid',
  },
  webServer: {
    command: \`node tools/testing/serve-static.mjs dist/apps/${name}/browser \${PORT}\`,
    url: \`http://127.0.0.1:\${PORT}\`,
    reuseExistingServer: !process.env['CI'],
    cwd: '../..',
    timeout: 30_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
`,
    'utf8',
  );
  writeFileSync(
    path.join(REPO, e2eRoot, 'src/smoke.spec.ts'),
    `import { expect, test } from '@playwright/test';

// The viewport matrix of the repository (models-registry.json → ui.viewports): mobile-first means
// every screen is checked at every width, and a horizontal scrollbar at any of them is a defect.
const VIEWPORTS = ${viewports};

test('renders the start page without console errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  expect(errors).toEqual([]);
});

for (const width of VIEWPORTS) {
  test(\`has no horizontal scroll at \${width}px\`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
}
`,
    'utf8',
  );
  writeFileSync(
    path.join(REPO, e2eRoot, 'tsconfig.json'),
    `${JSON.stringify({ extends: '../../tsconfig.json', compilerOptions: { types: ['node'], module: 'esnext', moduleResolution: 'bundler' }, include: ['src/**/*.ts', 'playwright.config.ts'] }, null, 2)}\n`,
    'utf8',
  );
  angular.projects[e2eName] = {
    projectType: 'application',
    root: e2eRoot,
    sourceRoot: `${e2eRoot}/src`,
    prefix,
    architect: {},
  };
  writeJson('angular.json', angular);
}

/**
 * @param {string} spec `<scope>/<type>[-<name>]`
 * @param {{ prefix: string, dryRun: boolean }} options
 * @returns {number}
 */
export function newLibrary(spec, { prefix, dryRun }) {
  const [scope, libName, ...rest] = spec.split('/');
  if (!scope || !libName || rest.length > 0 || !KEBAB.test(scope) || !KEBAB.test(libName)) {
    process.stderr.write(`library must be <scope>/<type>[-<name>] in kebab-case (got "${spec}")\n${USAGE}\n`);
    return 2;
  }
  const type = LIB_TYPES.find((candidate) => libName === candidate || libName.startsWith(`${candidate}-`));
  if (!type) {
    process.stderr.write(
      `library name must start with one of ${LIB_TYPES.join(', ')} (got "${libName}") — the type drives the module boundaries\n`,
    );
    return 2;
  }
  const root = `libs/${scope}/${libName}`;
  const projectName = `${scope}-${libName}`;
  const alias = `${ALIAS_SCOPE}/${scope}/${libName}`;
  if (existsSync(path.join(REPO, root))) {
    process.stderr.write(`FAIL ${root} already exists\n`);
    return 1;
  }
  const snapshot = snapshotWorkspace();
  const ok = generate(
    [
      'generate',
      'library',
      projectName,
      `--project-root=${root}`,
      `--prefix=${prefix}`,
      '--skip-install',
      '--skip-package-json',
      '--defaults',
    ],
    dryRun,
  );
  if (!ok) return 1;
  if (dryRun) return 0;
  try {
    finishLibrary({ root, projectName, alias, type, scope });
  } catch (error) {
    rollback(snapshot, [root], error);
    return 1;
  }
  const warning = polish([root]);
  if (warning) process.stdout.write(`${warning}\n`);
  process.stdout.write(
    `ok new:lib · ${root} (project ${projectName}) · import from '${alias}'\nnext: npm run affected -- test\n`,
  );
  return 0;
}

/**
 * Everything after `ng generate library`. Throws on any failure — the caller rolls back.
 * @param {{ root: string, projectName: string, alias: string, type: string, scope: string }} lib
 */
function finishLibrary({ root, projectName, alias, type, scope }) {
  // consumed from source: the alias points at public-api.ts, never at dist/
  const tsconfig = readTsconfig();
  tsconfig.compilerOptions.paths = Object.fromEntries(
    Object.entries(tsconfig.compilerOptions.paths ?? {}).filter(([key]) => key !== projectName),
  );
  tsconfig.compilerOptions.paths[alias] = [`./${root}/src/public-api.ts`];
  writeTsconfig(tsconfig);

  // the ng-packagr build target stays (the unit-test builder reads the library's compile options
  // from it); the test target runs through the shared runner config like every other project
  const angular = readJson('angular.json');
  const project = angular.projects[projectName];
  project.architect.test = {
    builder: '@angular/build:unit-test',
    options: { tsConfig: `${root}/tsconfig.spec.json`, runnerConfig: RUNNER_CONFIG },
  };
  writeJson('angular.json', angular);

  // the placeholder: a component for ui/feature libraries, a function for util/data-access
  const fileBase = `${root}/src/lib/${projectName}`;
  if (type === 'ui' || type === 'feature') {
    addOnPush(`${fileBase}.ts`);
  } else {
    const fn = camel(projectName);
    writeFileSync(
      path.join(REPO, `${fileBase}.ts`),
      `export function ${fn}(): string {\n  return '${projectName}';\n}\n`,
      'utf8',
    );
    writeFileSync(
      path.join(REPO, `${fileBase}.spec.ts`),
      `import { ${fn} } from './${projectName}';\n\ndescribe('${fn}', () => {\n  it('returns its own name', () => {\n    expect(${fn}()).toBe('${projectName}');\n  });\n});\n`,
      'utf8',
    );
  }
  writeFileSync(
    path.join(REPO, root, 'README.md'),
    [
      `# ${projectName}`,
      '',
      `Biblioteka typu \`${type}\` w zakresie \`${scope}\`. Import wyłącznie przez alias \`${alias}\` (ze źródeł, nie z \`dist/\`); publiczne API to \`src/public-api.ts\`.`,
      '',
      'Target `build` (ng-packagr) służy wyłącznie publikacji — `npm run affected -- build` buduje tylko aplikacje, a builder testów czyta z niego opcje kompilacji.',
      '',
      'Kierunek zależności (pilnuje `eslint.rules.mjs`): feature → ui, data-access, util · ui → ui, util · data-access → data-access, util · util → util.',
      '',
      `Testy: \`npm run affected -- test\` (Vitest przez \`@angular/build:unit-test\`, progi pokrycia w \`${RUNNER_CONFIG}\`).`,
      '',
    ].join('\n'),
    'utf8',
  );
}

if (isMain(import.meta.url)) {
  const [kind, target, ...flags] = process.argv.slice(2);
  const all = [target, ...flags].filter((arg) => arg !== undefined);
  const dryRun = all.includes('--dry-run');
  const prefix = all.find((arg) => arg.startsWith('--prefix='))?.slice('--prefix='.length) ?? PREFIX;
  const portArg = all.find((arg) => arg.startsWith('--port='))?.slice('--port='.length);
  const port = portArg === undefined ? undefined : Number(portArg);
  /** @type {Map<string, (name: string) => number>} */
  const kinds = new Map([
    ['application', (name) => newApplication(name, { prefix, dryRun, port })],
    ['library', (name) => newLibrary(name, { prefix, dryRun })],
  ]);
  const generate = kinds.get(kind ?? '');
  if (generate === undefined || !target || target.startsWith('--') || !KEBAB.test(prefix)) {
    process.stderr.write(`${USAGE}\n`);
    process.exitCode = 2;
  } else {
    process.exitCode = generate(target);
  }
}
