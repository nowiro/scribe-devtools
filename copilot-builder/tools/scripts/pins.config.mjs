// pins.config.mjs — the single declaration site for every dependency version in this repository.
//
// A version number is not only an install instruction, it is a claim the repository makes about
// itself. This file inverts the usual "grep for the version and hope" approach: the version lives in
// ONE row (`owner` = the manifest section that decides it), every row explains in one sentence what
// breaks when the pin moves, and `check-pins.mjs` (offline, first steps of `npm run verify`) finds
// everything downstream of it that a human still has to look at. Its online twin, `check-upstream.mjs`,
// says which pins fell behind `latest` and for how long — WARN only, on the nightly schedule.
//
// Every pin is `exact`: two machines resolve the same lockfile the same way, and a bump is a
// deliberate one-line diff a reviewer can read. Angular's framework packages share one version, the
// CLI packages another — they are released on separate cadences and the peer ranges bind them.
//
// Fields:
//   id           npm package name.
//   owner        `<manifest>#<section>` — the ONE place the version is decided.
//   policy       'exact' (bare version) or 'caret'.
//   minSupported optional floor below which the code is known not to work (a floor, not a ceiling).
//   prose        directories/files whose text must not quote a DIFFERENT version of this package.
//   staleDays    after this many days behind `latest`, `check-upstream` WARNs (calendar, not gate).
//   why          what breaks, in one sentence — this is what the reviewer of a bump needs.

/**
 * @typedef {object} Pin
 * @property {string} id package name
 * @property {string} owner `<manifest>#<section>` that declares the version
 * @property {'exact' | 'caret'} policy the spec shape the owner must use
 * @property {string} [minSupported] a floor the pin may never go below
 * @property {string[]} [prose] files/dirs whose prose is checked for a stale version (LAG)
 * @property {string[]} [frozen] dirs never walked by LAG for this row
 * @property {{ file: string, pattern: string }[]} [tags] files that embed the version in another shape; `{version}` marks it (TAG)
 * @property {number} staleDays how long the pin may trail `latest` before check:upstream calls it stale
 * @property {string} why the reason for the pin, read by humans and quoted in messages
 */

/** Text that is history, not declaration — never rewritten by a bump. */
export const FROZEN_ALWAYS = ['CHANGELOG.md', 'docs/decisions/'];

const DEPS = 'package.json#dependencies';
const DEV = 'package.json#devDependencies';

/** @param {string} id @param {string} why @returns {Pin} */
const angular = (id, why) => ({ id, owner: DEPS, policy: 'exact', staleDays: 90, prose: ['docs/tech-stack.md'], why });
/** @param {string} id @param {string} why @returns {Pin} */
const angularDev = (id, why) => ({
  id,
  owner: DEV,
  policy: 'exact',
  staleDays: 90,
  prose: ['docs/tech-stack.md'],
  why,
});
/** @param {string} id @param {string} why @param {number} [staleDays] @returns {Pin} */
const lint = (id, why, staleDays = 120) => ({ id, owner: DEV, policy: 'exact', staleDays, prose: [], why });

/** @type {Pin[]} */
export const PINS = [
  // ── Angular framework (one version for all six) ───────────────────────────────────────────
  angular(
    '@angular/core',
    'The framework. All @angular/* framework packages must carry the same version — a mixed set fails at bootstrap with an injector error far from the cause.',
  ),
  angular('@angular/common', 'Framework package; same version as @angular/core.'),
  angular(
    '@angular/compiler',
    'Framework package; the build peer-depends on ^22 and the AOT compiler must match @angular/core exactly.',
  ),
  angular(
    '@angular/forms',
    'Framework package; Signal Forms (`@angular/forms/signals`) are the form model of this repository.',
  ),
  angular('@angular/platform-browser', 'Framework package; same version as @angular/core.'),
  angular('@angular/router', 'Framework package; same version as @angular/core.'),
  // ── Angular CLI (separate cadence, bound to the framework by peer ranges) ────────────────
  angularDev(
    '@angular/cli',
    'The workspace CLI (`ng generate`, `ng build`, `ng test`) and the `ng mcp` server declared in .vscode/mcp.json. Same version as @angular/build.',
  ),
  angularDev(
    '@angular/build',
    'Application builder, dev server and the Vitest unit-test builder. Peer-depends on typescript >=6.0 <6.1 and vitest ^4 — bumping it decides the TypeScript and Vitest majors.',
  ),
  angularDev(
    '@angular/compiler-cli',
    'AOT compiler used by @angular/build; must match the framework version, not the CLI version.',
  ),
  // ── Runtime libraries of the applications ─────────────────────────────────────────────────
  {
    id: 'rxjs',
    owner: DEPS,
    policy: 'exact',
    staleDays: 180,
    prose: [],
    why: 'Angular peer-depends on rxjs ^7; the repository uses RxJS at the I/O edge only (streams), signals for state.',
  },
  {
    id: 'tslib',
    owner: DEPS,
    policy: 'exact',
    staleDays: 365,
    prose: [],
    why: 'Runtime helpers emitted with `importHelpers: true`; any 2.x works, pinned for reproducibility.',
  },
  {
    id: 'zod',
    owner: DEPS,
    policy: 'exact',
    staleDays: 120,
    prose: [],
    why: 'Schema validation at every boundary: ALM configs and front matter in tools/alm, and Signal Forms `validateStandardSchema` in applications. A major changes the error shape the pipelines print.',
  },
  {
    id: 'yaml',
    owner: DEPS,
    policy: 'exact',
    staleDays: 180,
    prose: [],
    why: 'Front matter parser of the ALM write pipelines (tools/alm); yaml 2.x only.',
  },
  {
    id: 'playwright-core',
    owner: DEPS,
    policy: 'exact',
    minSupported: '1.62.1',
    prose: ['AGENTS.md', 'README.md', 'tools/browser-inspector/', 'tools/alm/', '.gitlab-ci.yml'],
    staleDays: 45,
    why: 'browser-inspector reads playwright-core internals (aria-ref resolution, snapshot refs) that are not public API, and tools/alm drives the browser source with it. Must equal the version @playwright/test resolves, or two copies of the engine land in node_modules.',
  },
  // ── Test runners ──────────────────────────────────────────────────────────────────────────
  {
    id: '@playwright/test',
    owner: DEV,
    policy: 'exact',
    prose: ['.gitlab-ci.yml', 'README.md', 'docs/dev-setup.md'],
    tags: [{ file: '.gitlab-ci.yml', pattern: 'mcr.microsoft.com/playwright:v{version}-' }],
    staleDays: 45,
    why: 'E2E runner. The GitLab e2e job image `mcr.microsoft.com/playwright:v<version>-noble` must carry the same version — the TAG rule compares the two; playwright-core must be pinned identically.',
  },
  {
    id: 'vitest',
    owner: DEV,
    policy: 'exact',
    staleDays: 90,
    prose: [],
    why: 'Unit test runner for tools/ and tools/alm, and the runner behind @angular/build:unit-test, which peer-depends on vitest ^4. @vitest/coverage-v8 must be the same version.',
  },
  {
    id: '@vitest/coverage-v8',
    owner: DEV,
    policy: 'exact',
    staleDays: 90,
    prose: [],
    why: 'Coverage provider; must equal the vitest version to the patch.',
  },
  {
    id: 'jsdom',
    owner: DEV,
    policy: 'exact',
    staleDays: 120,
    prose: [],
    why: 'DOM environment of Angular unit tests (the unit-test builder defaults to jsdom when no `browsers` are set).',
  },
  // ── TypeScript and typings ────────────────────────────────────────────────────────────────
  {
    id: 'typescript',
    owner: DEV,
    policy: 'exact',
    staleDays: 120,
    prose: ['docs/'],
    why: 'Angular 22 requires >=6.0 <6.1 (peer range of @angular/build); TypeScript 7 is out but breaks the Angular template compiler — this row moves only with the Angular major.',
  },
  {
    id: '@types/node',
    owner: DEV,
    policy: 'exact',
    staleDays: 365,
    prose: [],
    why: 'Types only, consumed by `tsc` over tools/ (checkJs) and tools/alm. Kept on the Node major of .nvmrc on purpose: types from a newer runtime would typecheck calls that do not exist on the runtime we run.',
  },
  // ── Formatter and linters ─────────────────────────────────────────────────────────────────
  {
    id: 'oxfmt',
    owner: DEV,
    policy: 'exact',
    staleDays: 60,
    prose: [],
    why: 'THE formatter: `oxfmt --check` is the first step of `npm run verify`, so a formatting change turns the whole gate red before anything else runs — loud and immediate. 0.x with weekly releases: a bump may move output, so it is its own commit with `npm run format` in it. Markdown is ignored by choice (.oxfmtrc.jsonc), `sortPackageJson` is off.',
  },
  lint(
    'oxlint',
    'THE linter for every code file (oxlint.config.mts). A release that adds a rule to a preset it implements, or renames one, turns the config red ("Rule not found") — loud. `jsPlugins` are alpha and not under semver: after a bump run `npm run lint` and read the JS-plugin errors first. 1.83 drops a native rule\'s options in a layer that does not enable its plugin — `layer()` in oxlint.plugins.mts exists for that.',
    60,
  ),
  lint(
    'oxlint-tsgolint',
    'Type-aware rules of oxlint (strictTypeChecked + stylisticTypeChecked on apps/libs) on TypeScript 7, independent of the TypeScript 6 the Angular compiler needs. TypeScript 7 refuses an `outDir` without `rootDir` — new-project.mjs writes it into library tsconfigs.',
    60,
  ),
  lint(
    'eslint',
    'Angular only (eslint.config.mjs): oxlint has no template parser. The plugins below that run in oxlint declare a peer range including ^10 — verify the ranges before a major.',
  ),
  lint(
    '@eslint/js',
    'Read by oxlint.plugins.mts: its `recommended` preset is the JavaScript base layer oxlint runs natively.',
  ),
  lint(
    'typescript-eslint',
    'The parser angular-eslint runs on, and the source of the strictTypeChecked + stylisticTypeChecked rule lists oxlint.plugins.mts reads. Peer range typescript <6.1 must cover the pinned TypeScript.',
  ),
  lint(
    'angular-eslint',
    'Angular rules for TypeScript and templates, including the accessibility set and inline-template processing — the part of the lint oxlint cannot do. Its major follows the Angular major.',
  ),
  lint(
    'eslint-plugin-sonarjs',
    'SonarQube rules (cognitive complexity 15, identical functions, dead branches) so the local lint says what the Sonar server says. Runs as an oxlint JS plugin and is its most expensive part (about 2 s of the lint).',
  ),
  lint(
    'eslint-plugin-regexp',
    'Regex correctness: catastrophic backtracking, useless escapes, duplicate classes (oxlint JS plugin).',
  ),
  lint(
    'eslint-plugin-security',
    'OWASP patterns for the Node code in tools/ (eval, child_process, non-literal paths); oxlint JS plugin.',
  ),
  lint(
    'eslint-plugin-n',
    'Node rules for tools/ driven by engines.node: unsupported built-ins, process.exit, sync fs calls. An oxlint JS plugin — the native `node` plugin carries one rule of this preset.',
  ),
  lint(
    '@eslint-community/eslint-plugin-eslint-comments',
    'Every disable needs a matching enable; unlimited disables are forbidden (oxlint JS plugin; `no-unlimited-disable` reports a wrong location in oxlint 1.83, the gate is red anyway).',
  ),
  lint(
    'eslint-plugin-playwright',
    'E2E hygiene: web-first assertions, no waitForTimeout, no networkidle, no focused tests (oxlint JS plugin).',
  ),
  // ── Commit convention ─────────────────────────────────────────────────────────────────────
  lint(
    '@commitlint/cli',
    'Conventional Commits check in .githooks/commit-msg; same version as the config package.',
    180,
  ),
  lint(
    '@commitlint/config-conventional',
    'The rule preset commitlint.config.mjs extends; same version as the CLI.',
    180,
  ),
];
