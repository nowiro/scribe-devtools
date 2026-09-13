---
description: 'Optimize DX & performance of an Angular + Nx + Vitest + Playwright + ESLint repo: package-manager tuning (npm/pnpm/yarn, no migration), Nx caching without Nx Cloud, affected-only verify, native git hooks, GitLab CI build pipeline.'
mode: agent
---

# /perf-optimize — repo performance & DX runbook

You are a Senior/Lead Engineer. Goal: make the local feedback loop and `<pm> run verify` materially faster, and add (or fix) a GitLab CI pipeline that builds and verifies the app using caching and Nx affected — without changing application behavior, without changing the package manager, and without Nx Cloud.

`<pm>` below means the package manager the repo already uses (`npm` / `pnpm` / `yarn`).

## Ground rules (non-negotiable)

1. Source-of-truth order: real project files → official docs / MCP (`context7`, `nx_docs`, `angular-cli`) → expert knowledge. Never assume a config key, CLI flag or API exists — verify it for the versions pinned in `package.json` / `.nvmrc` / `packageManager`. Never hardcode versions in prose or docs.
2. Follow `AGENTS.md` and `.github/copilot-instructions.md`. Do NOT add `CLAUDE.md`, `.claude/`, `.ai/`, or GitHub Actions.
3. Package manager is detected, never migrated. Detect from the lockfile (`package-lock.json` → npm, `pnpm-lock.yaml` → pnpm, `yarn.lock` + `.yarnrc.yml` → Yarn Berry, `yarn.lock` alone → Yarn Classic) and the `packageManager` field. Optimize within that manager. Do not switch managers, do not switch Yarn linker (`node-modules` ↔ `pnp`), do not migrate Yarn Classic → Berry. If a switch would clearly pay off, write it as a recommendation in the report — not as a change.
4. Nx Cloud is forbidden — always, in every repo. No `nx connect`, no `nx-cloud` package, no `nxCloudId` / `nxCloudAccessToken` / cloud `tasksRunnerOptions` in `nx.json`, no `NX_CLOUD_*` variables, no Nx Agents / DTE, no Nx Cloud remote cache. If any of it exists, removing it is in scope. Guard it: `neverConnectToCloud: true` in `nx.json`, `NX_NO_CLOUD=true` in CI and in `.env.example`, and a `deps:check` step that fails on `nx-cloud` / `nxCloudId` / `nxCloudAccessToken`. Cross-runner cache = GitLab `cache:` on `.nx/cache` only.
5. Entrypoints stay package scripts (`<pm> run <script>`) — never raw `nx run` in docs or hooks. Nx may run under the scripts.
6. Git hooks are native (`core.hooksPath` → committed `.githooks/`), not Husky. If Husky is present, migrating it to native hooks is in scope (see Phase 3).
7. State every assumption explicitly. When a requirement is unclear, ask before implementing.
8. Every optimization is a hypothesis: measure before → apply → measure after. If it does not help or introduces flakiness, revert it and say so.
9. No behavior change to the app or tools. No `any`. Conventional Commits (`type(scope): subject`), one logical change per commit.
10. Release stays manual. CI builds and verifies; it never publishes.
11. SDD applies (≥2 files or behavior change → full ladder `specify → clarify → plan → analyze → implement → review → test → DoD`). Artifacts under `docs/specs|plans|runs/` are local-only (gitignored).

## Reply header (start every reply with it)

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎯 CEL BIZNESOWY:  [what this step achieves]
🆔 SDD:            verb=chore  slug=perf-optimize
📋 AC:             ✅ AC1 …  ⏳ AC2 …  ❌ AC3 …
🔒 ZAŁOŻENIA:      [explicit list — always includes: detected <pm>, hooks system found, Nx Cloud status]
📊 POSTĘP:         [XX%] ████████░░
🎯 PEWNOŚĆ:        [XX%] — [why]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

## Phase 0 — Baseline (first, no changes yet)

Record in `docs/runs/<date>-perf-baseline.md`:

- Detected package manager + version source (`packageManager` field / lockfile / Corepack).
- Nx Cloud status: any trace of it in `nx.json`, `package.json`, env, CI config.
- Wall time (cold and warm — run twice) for: clean install (`rm -rf node_modules` then `<pm>` frozen install), `<pm> run verify`, `lint`, `typecheck`, `test`, `build`, `e2e`. Windows: `Measure-Command { <pm> run verify }` · bash: `time <pm> run verify`.
- `nx show projects --affected` after touching only `README.md` — if any project is affected by a non-code change, Nx inputs are misconfigured. Run one cached target twice and confirm the second run is a cache hit (`--verbose` shows the hash inputs on a miss).
- Bundle: `ng build --stats-json` + `esbuild-visualizer` — top 10 heaviest modules.
- `node_modules` size, `npx knip` summary, duplicate versions (`<pm> ls --all | grep -c deduped`, or `pnpm dedupe --check` / `yarn dedupe --check`).
- Time of each git hook (pre-commit, commit-msg, pre-push) on a one-line change; `git status` time on a warm repo.
- Test suite: slowest 10 Vitest files (`--reporter=verbose` timing), slowest 10 Playwright tests (HTML report), flaky list if any.
- Node runtime: cold start of the heavy CLIs (`nx --version`, `eslint --version`, `vitest --version`, `tsc --version`) with and without `NODE_COMPILE_CACHE`; `build` and `test` wall time with and without `NODE_OPTIONS=--max-semi-space-size=<n>`; note the installed Node major (`.nvmrc`) and whether the compile cache is already on by default.
- Hardware/OS note: cores, RAM, Windows Dev Drive / Defender exclusions present or not.

## Phase 1 — Diagnose

Report as `| Area | File | Current | Problem | Impact 🔴🟡🟢 |`:

- Node runtime — `.nvmrc` + `engines.node` (+ `engine-strict` in `.npmrc`) consistent with `packageManager`? `NODE_COMPILE_CACHE` set (dev docs, CI variables) and its directory persistent, gitignored and cached in CI? `NODE_OPTIONS` used — is `--max-semi-space-size` tuned, is `--max-old-space-size` set only where a build actually hits the heap limit (not as a blanket)? `NODE_NO_WARNINGS`/experimental-warning noise in CI logs? Any scripts that spawn Node without inheriting env (losing the cache)?
- Package manager — `packageManager` field present and Corepack usable? lockfile committed and in sync? `.npmrc` / `.yarnrc.yml` committed? frozen install used in CI? audit/fund/progress/update-notifier noise disabled in CI? cache/store directory cacheable in CI? lifecycle scripts: which packages really need `postinstall` (pnpm: `onlyBuiltDependencies`)? duplicated transitive versions?
- VS Code workspace — `.vscode/settings.json` + `extensions.json` committed? `files.watcherExclude` / `search.exclude` / `files.exclude` cover `node_modules`, `.nx`, `.angular`, `dist`, `coverage`, `playwright-report`, `test-results`, `<pm>` store? `search.followSymlinks: false` (pnpm)? `typescript.tsdk` = workspace TypeScript, `typescript.tsserver.maxTsServerMemory` raised, `includePackageJsonAutoImports: off`? `eslint.useFlatConfig`, `eslint.validate` incl. `html`, `eslint.workingDirectories` auto, `eslint.run: onSave`? `npm.autoDetect` / `typescript.tsc.autoDetect` off in a monorepo? prompt files and instruction files enabled for Copilot? Any personal settings leaking into the committed file?
- Nx Cloud (must be absent) — `nx.json` (`nxCloudId`, `nxCloudAccessToken`, `tasksRunnerOptions`), `nx-cloud` in `package.json`, `NX_CLOUD_*` in CI/env, `neverConnectToCloud` set?
- Nx — `nx.json`: `defaultBase` = default branch; `targetDefaults` (`cache`, `dependsOn`, `inputs`, `outputs` declared correctly — wrong outputs = cache hits that restore nothing); `namedInputs` (`production` excludes `**/*.spec.ts`, `**/*.md`, `docs/**`, e2e, test configs; `sharedGlobals` minimal); `parallel`; `cacheDirectory`; daemon; plugins (inferred tasks) vs explicit targets — consistent?; `e2e` target inputs include `^production`?; `@nx/enforce-module-boundaries` on (keeps the graph honest)? Do scripts use `run-many` where `affected` would do? `.nx/` gitignored?
- Angular — `angular.json`: builder (`@angular/build:application` vs legacy `browser`), `cli.cache` (`.angular/cache` enabled, not deleted by scripts), `cli.analytics: false`, unit-test builder (`@angular/build:unit-test` with Vitest vs Karma/other), dev configuration (`optimization: false`, source-map scope), prod configuration (`budgets` enforced, `outputHashing: all`, source maps off/hidden), zoneless change detection in app and tests, `zone.js` still in polyfills/deps?, routes lazy (`loadComponent` / `loadChildren`)?, `@defer` used for heavy below-the-fold UI?, `NgOptimizedImage`?, deep barrel `index.ts` files?, schematics defaults (`changeDetection: OnPush`, standalone)?
- Vitest — config: `pool`, `isolate`, `maxWorkers`, `fileParallelism`, `environment` (`node` for pure logic vs `jsdom` for DOM — split via `test.projects`?), `setupFiles` weight, `include`/`exclude` (e2e dirs, `dist`, `.nx` excluded?), `coverage.provider` (`v8` vs `istanbul`), `coverage.include` narrowed to sources, `thresholds`, reporters (junit/cobertura for GitLab?), `restoreMocks`/`clearMocks`, `sequence.shuffle`, `retry` (must be 0 locally), coverage in watch mode?, `--typecheck` used instead of `tsc`?
- TypeScript — `incremental`, `tsBuildInfoFile`, `skipLibCheck`, `isolatedModules`, separate `typecheck` script (Vitest does not type-check), project references if several projects.
- Repository index — is there a generated map of the codebase at all, and is the agent TOLD to read it first? If one exists: is it generated or hand-written, is it regenerated by a hook, does `verify` fail on a stale one, does it carry signatures and not just names, and is its size stated in tokens anywhere the agent will see it? Time a realistic "find where X is handled" both ways — index read versus repository-wide grep — and count the tokens each pulls into context, because that difference is the whole case for or against.
- Project glossary — is there one at all? Does it map both ways (word → identifier and back), does it carry meanings rather than just names, is every identifier it names actually resolvable today, and is the agent told to read it alongside the index? Check the vocabulary gap first: take five terms from the issue tracker or the README and grep for each one in the code — every miss is a row the glossary owes you.
- Formatter — which one runs the gate (`nx format`, Prettier, Biome, dprint, none)? In an Nx workspace, is `nx format:check` used at all, or does `verify` shell out to `prettier --check .` over the whole tree? Is it cached (`prettier --cache`)? How long does a full check take, cold and warm, as a share of `verify`? Which file types does it actually cover, and which are formatted by nobody? Is `NX_SKIP_FORMAT` set anywhere, and does it match the formatter the repo actually uses?
- ESLint — flat config; `--cache --cache-location`; typed linting scope (`projectService` / `parserOptions.project`) limited to `**/*.ts` sources with `disableTypeChecked` for JS/config files, `ignores` for `dist`, `.nx`, `.angular`, `coverage`; lint-staged lints staged files only; `--max-warnings 0` in `verify`/CI; `linterOptions.reportUnusedDisableDirectives: 'error'`; slow rules found with `TIMING=1`? Plugins present vs missing (see Phase 3 tiers): `typescript-eslint` strict-type-checked, `angular-eslint` (ts + template + accessibility), `@nx/eslint-plugin` (`enforce-module-boundaries`, `dependency-checks`), `eslint-plugin-rxjs-x`, `eslint-plugin-unicorn`, `eslint-plugin-sonarjs`, `eslint-plugin-import-x`, `@vitest/eslint-plugin`, `eslint-plugin-playwright`, `eslint-plugin-n`, `eslint-plugin-security`, `@eslint-community/eslint-plugin-eslint-comments`, `eslint-plugin-regexp`, `eslint-plugin-no-secrets`, `eslint-config-prettier` last? Anti-patterns: `eslint-plugin-prettier`, deprecated `eslint-plugin-rxjs` / `eslint-plugin-deprecation`, `@typescript-eslint/no-explicit-any` downgraded, blanket `eslint-disable` without description, duplicate rule sets from several plugins.
- Git hooks — which system: Husky (`.husky/`, `prepare: husky`), native (`core.hooksPath` + `.githooks/`), or none? pre-commit = lint-staged? commit-msg = commitlint? pre-push = `verify` and is it affected-based (`--base=origin/<default>`)? Hook scripts POSIX `sh` with executable bit? Time per hook.
- Git repo — `.gitattributes` (`* text=auto eol=lf`, lockfiles collapsed in diffs), `.gitignore` complete (`.nx/`, `.angular/`, `.eslintcache`, `*.tsbuildinfo`, `coverage/`, `dist/`, `playwright-report/`, `test-results/`, `blob-report/`, `<pm>` cache dir, `docs/specs|plans|runs/`), recommended local config documented (`core.fsmonitor`, `core.untrackedCache`, `git maintenance`, `core.longpaths` on Windows)?
- Playwright — `workers` explicit in CI, `fullyParallel`, `forbidOnly` in CI, `retries` (CI only), `trace: 'on-first-retry'`, `screenshot`/`video` only on failure, `webServer` serves a prebuilt app with `reuseExistingServer` locally, auth via `storageState` + setup project (no per-test login), browser matrix (chromium only on MRs?), `testIdAttribute`, sharding + `merge-reports` in CI, `--only-changed` script, `waitForTimeout` occurrences, tests independent (`describe.configure({ mode: 'parallel' })`)?
- Deps — `knip` findings, dedupe candidates, `overrides` / `resolutions` for duplicated transitive deps, packages replaceable by Node built-ins (`fetch`, `structuredClone`, `node:util.parseArgs`, `node:fs/promises`, `crypto.randomUUID`, `--env-file`).
- GitLab CI — `.gitlab-ci.yml` present? `workflow: rules` (no duplicate branch + MR pipelines)? `interruptible`? `needs:` DAG vs pure stages? `default:` / `extends` / `!reference` for DRY? install frozen + offline? caches keyed on the lockfile with correct paths and `policy`? separate `.nx/cache` cache with `fallback_keys` to the default branch? build once → `dist/` artifact reused by e2e? `artifacts.expire_in` short? junit + cobertura reports wired? affected on MRs, full on default branch? scheduled nightly for the full matrix? Playwright image matches installed `@playwright/test`? `GIT_DEPTH` compatible with affected? `FF_USE_FASTZIP` / compression levels set?

## Phase 2 — Plan (go/no-go before implementing)

Write `docs/plans/<date>-chore-perf-optimize.md` with `| id | title | agent | done_when |`, ordered highest impact / lowest risk first. Each item names exact files (`path:line`) and its rollback. Stop and ask for go/no-go.

## Phase 3 — Implement (approved items only, one commit each)

Apply only what Phase 1 showed is missing, after verifying exact option names and flags for the installed versions.

### Repository index — what the agent reads BEFORE it reads anything else

Every agent session starts by orienting itself, and orienting by grepping is the single most expensive habit in an agent-assisted repository: the search pulls matches, near-matches and whole files into the context window, and it does it again in the next session because nothing was written down. A generated index answers "where does X live and what does it take" in ONE read, deterministically, and the read is cheap enough to make first every time. This section multiplies everything else in the same way the Node runtime section does, just on the agent's side of the loop.

**Generate it, never write it by hand.** A hand-written map is accurate on the day it is written and misleading a week later, and a misleading map is worse than none: the agent trusts it and skips the search that would have corrected it. The generator is a small deterministic script (the repo's own tooling, no new dependency), it is regenerated by the pre-commit hook, and `verify` fails on a stale index. Staleness must be a red gate, not a convention.

**Put in it exactly what decides "open this file or not":**

- one entry per module, at a fixed heading so the agent can jump by path;
- what it **exports**, and for every function its **input and output** — parameter names plus the return type from the type annotations the repo already keeps. A bare name says a symbol exists; a signature says whether it is the one being looked for, and that is the difference between one file opened and five;
- what it **subscribes to** — `emitter.on('event')` wiring, which an import list structurally cannot show, and which is often the real contract of a module;
- what it **imports** and **who imports it**, so a change's blast radius is visible without a search.

**Leave out what does not earn context:** tests, fixtures, generated trees, build output, vendored code. Do not embed full doc comments; the index says which file to open, the file says the rest. Cap long types with an ellipsis rather than letting one signature eat a screen.

**State its cost where the agent reads it, and guard that number.** Measure the index with a tokenizer and write the figure into the instruction file: an agent that knows the index costs N tokens can decide whether to read it whole. That figure is a promise like any other and goes stale the first time the index grows, so add a check that compares the stated number against the real one and fails outside a tolerance. A budget number nobody verifies is the exact failure this whole runbook exists to prevent.

**Wire the read-first rule explicitly.** The index only pays off if the agent is told to start there, so put one short paragraph in `AGENTS.md` (and its `.github/copilot-instructions.md` copy) that says: read the index before searching, open only what it names, and fall back to search when the index does not answer. Keep the pointer tiny — the pointer is a fixed cost paid every session, the index is a variable cost paid on demand, and the point is to move weight from the first to the second. Use `.github/instructions/*.instructions.md` with `applyTo` to attach per-area pointers automatically, so editing a package brings its own rules without anyone loading them globally.

**Scale it before it stops fitting.** When the index outgrows what is worth reading whole, shard it: one file per package plus a root table of contents naming each shard and its size. The agent reads the table, then one shard. In an Nx workspace, `nx graph` is already the project-level index — complement it with the file-level one, never restate the project graph in prose that will drift from it.

**Anti-patterns**, each of which turns the index from an asset into a liability: a hand-maintained map; an index nobody is told to read; an index of names without signatures (the agent still has to open everything); indexing tests and fixtures; a stated size that no gate checks; regenerating it only in CI, so local commits carry a stale one.

### Project glossary — the words, and what they are called in the code

The index answers WHERE something is. It cannot answer WHAT IT IS CALLED, and that is the other half of every failed search: a person asks about the thing they name in their own language, the code names it something else, and the UI names it a third thing. The agent then greps for a word that appears nowhere, finds nothing, and falls back to reading files — the exact cost the index was built to avoid. A glossary is the mapping between those vocabularies, and it is read at session start next to the index.

**Map in both directions.** Word → identifier lets the agent turn a request into a search. Identifier → word lets it turn a symbol it just read into language the person will recognise in the reply. A one-way list only solves half the sessions. One row is: the term, one line of meaning, the identifiers and paths it lives in, and the synonyms that must NOT be used.

**Include only what the name does not already tell you.** A glossary of every class in the repository is noise that competes with the index for context. Earn a row by being one of:

- a domain word whose identifier is different (the spoken name and `camelCase` name diverge, or prose is in one language and code in another);
- an overloaded word that means two things in two places, with both meanings spelled out and the disambiguator named;
- a word with rejected synonyms, so the agent stops searching for the variant nobody used;
- a concept with no single symbol, where the row's job is to name the two or three files that together implement it;
- an abbreviation or internal coinage that no outside reader could expand.

**Meanings are written by a human, mappings are checked by a gate.** The sentence explaining what a term means cannot be generated and should not be; that is the value. What CAN be verified is every identifier and path a row points at — a gate that resolves each one and fails on a miss turns the glossary from documentation, which rots silently, into a claim, which goes red. Rename a symbol without touching the glossary and the build tells you.

**Keep it next to the index and point at both in one breath.** Same instruction-file paragraph, same read-first rule, both sized in tokens so the agent can budget. If the glossary and the index disagree about a name, the glossary is the one that changed last and the index is generated — regenerate before believing either.

**Anti-patterns:** a glossary that repeats the index (names without meanings); one that grows into prose documentation and stops being scannable; unverified mappings; rows for terms whose identifier is the obvious translation of the word; two glossaries, one for humans and one for the agent, which guarantees they diverge.

### Node runtime & V8 — every tool runs on it, so this multiplies everything else

- Pin: `.nvmrc` = `engines.node` (single source), `engine-strict=true` in `.npmrc`.
- Compile cache: set `NODE_COMPILE_CACHE=<repo>/node_modules/.cache/node-compile-cache` (or a per-user dir on machines with many repos). Node then stores V8 bytecode for every module it loads, so the next start of `nx`, `eslint`, `vitest`, `tsc`, the Angular CLI skips parsing and compiling thousands of files. Check whether the installed Node already enables it by default; if not, set it in `docs/dev-setup.md` (shell profile / Windows user env — it must exist before Node starts, an npm script cannot set it for itself), in CI `variables:`, and make the dir gitignored and CI-cached. Entries are keyed by Node version and flags, so a Node bump just misses once. Measure cold CLI start before/after.
- Young-generation GC: `NODE_OPTIONS=--max-semi-space-size=<n>` (try 32–128 MB; default is small). Build tooling, the TypeScript/Angular compilers and test runners allocate short-lived objects at a rate that triggers scavenges constantly; a larger semi-space means fewer of them. Cost is ~3× the value in RAM per process — pick the smallest value that stops improving `build`/`test` time, set it in `docs/dev-setup.md` and CI, not in scripts. Do not set `--max-old-space-size` globally; raise it only for the one target that actually OOMs, on that target.
- Inherit, don't lose: scripts that spawn Node (`tools/scripts/*.mjs`, Nx executors, Vitest workers) must pass `process.env` through, or the cache and GC settings vanish in child processes.
- Log noise: `NODE_NO_WARNINGS=1` in CI only; never locally (warnings are signal).
- Tie-in: `n/no-unsupported-features/*` rules read `engines.node`, so "built-ins over packages" stays safe exactly for the pinned major.

### VS Code workspace — committed `.vscode/`, DX + Windows perf

Often worth more on Windows than the whole Vitest tuning: an unexcluded watcher on `node_modules` + `.nx` + `.angular` + `dist` keeps the file watcher, search index, tsserver and Defender busy on every build.

- `.vscode/settings.json` (workspace-scoped, committed; personal prefs stay in user settings):
  - `files.watcherExclude`, `search.exclude`, `files.exclude` for `**/node_modules/**`, `**/.nx/**`, `**/.angular/**`, `**/dist/**`, `**/coverage/**`, `**/playwright-report/**`, `**/test-results/**`, `**/blob-report/**`, `**/.eslintcache`, the `<pm>` store dir; `search.followSymlinks: false` (pnpm's `node_modules/.pnpm` symlink forest).
  - TypeScript: `typescript.tsdk: node_modules/typescript/lib` + `typescript.enablePromptUseWorkspaceTsdk: true` (one compiler version everywhere), `typescript.tsserver.maxTsServerMemory` raised for large workspaces, `typescript.preferences.includePackageJsonAutoImports: "off"` (stops tsserver indexing every dependency for auto-imports), tsserver log off. In `tsconfig`: `watchOptions.excludeDirectories` for `node_modules`, `dist`, `.nx`, `.angular`.
  - ESLint: `eslint.useFlatConfig: true`, `eslint.validate` incl. `html` (Angular templates), `eslint.workingDirectories: [{ "mode": "auto" }]` for the monorepo, `eslint.run: "onSave"` when typed linting makes on-type linting laggy, `editor.codeActionsOnSave: { "source.fixAll.eslint": "explicit" }`.
  - Format: Prettier as default formatter per language, `editor.formatOnSave: true`, `files.eol: "\n"` (matches `.gitattributes`), never `source.organizeImports` next to an ESLint import sorter.
  - Task/scan noise in monorepos: `npm.autoDetect: "off"`, `typescript.tsc.autoDetect: "off"`.
  - Copilot: prompt files (`chat.promptFiles`) and instruction files (`github.copilot.chat.codeGeneration.useInstructionFiles`) enabled so `.github/prompts/*.prompt.md` and `.github/instructions/*.instructions.md` are picked up.
  - Vitest / Playwright extensions: point them at the repo configs; disable continuous background runs if they compete for CPU with the terminal.
- `.vscode/extensions.json`: `recommendations` = Angular Language Service, ESLint, Prettier, Vitest, Playwright, Nx Console, EditorConfig, Copilot + Copilot Chat; `unwantedRecommendations` = any second formatter/linter (TSLint-era extensions, Beautify-style formatters) that would fight Prettier/ESLint.
- Verify every setting id against the installed VS Code / extension versions before committing; measure with the VS Code "Developer: Show Running Extensions" and tsserver restart time before/after.

### Package manager — common (all three)

- Pin the manager: `packageManager` field in `package.json` (version lives there, nowhere else); document `corepack enable` in `docs/dev-setup.md`; CI runs `corepack enable` before install.
- Lockfile always committed; frozen installs everywhere except an explicit `deps:update` script.
- Kill install noise in CI and hooks: disable audit, fund, progress and update-notifier via the manager's config file (`.npmrc` / `.yarnrc.yml`), not via ad-hoc flags in scripts.
- Prefer offline/cached resolution locally and in CI.
- Dedupe + pin duplicated transitive deps (`overrides` for npm/pnpm, `resolutions` for Yarn), and add a `deps:check` script (dedupe `--check` + `knip` + Nx Cloud grep) to `verify` as a warning first, a blocker once clean.
- Production installs (Docker/deploy) omit dev dependencies.

#### npm

- Install: `npm ci --prefer-offline` (audit/fund/progress off via `.npmrc`: `audit=false`, `fund=false`, `progress=false`, `update-notifier=false`).
- `npm dedupe` once; `overrides` for stragglers; `npm ci --omit=dev` for prod images.
- CI cache: set `npm_config_cache` to a repo-local dir (e.g. `.npm/`) and cache it keyed on `package-lock.json`.
- Optional, verify first: `--ignore-scripts` in CI if no dependency needs `postinstall`.

#### pnpm

- Install: `pnpm install --frozen-lockfile --prefer-offline`.
- `.npmrc`: keep `node-linker=isolated` and strictness as-is (no `shamefully-hoist` unless already present); consider `auto-install-peers`, `dedupe-peer-dependents`, `prefer-frozen-lockfile=true` — verify each against the installed pnpm version.
- Lifecycle scripts: pnpm blocks dependency build scripts by default — allowlist only what truly needs them via `pnpm.onlyBuiltDependencies` in `package.json` (e.g. `esbuild`), nothing else.
- `pnpm dedupe` once, `pnpm dedupe --check` in `deps:check`; `pnpm.overrides` for stragglers.
- CI cache: `store-dir` → repo-local `.pnpm-store/`, cached keyed on `pnpm-lock.yaml`; `pnpm store prune` in a scheduled job, not on every run.
- Docker: `pnpm fetch` on the lockfile layer, then `pnpm install --offline` — dependency layer survives source changes.
- Windows gotcha: hardlinks need store and repos on the same volume — on a Dev Drive put `store-dir` on that drive too.

#### Yarn — detect Classic vs Berry, do not migrate

- Classic: `yarn install --frozen-lockfile --prefer-offline`; `yarn-deduplicate` once (`--list` in `deps:check`); `resolutions` for stragglers; CI cache: `--cache-folder .yarn-cache/` keyed on `yarn.lock`; disable progress/emoji noise in `.yarnrc`.
- Berry: `yarn install --immutable` (add `--immutable-cache` only when the cache is committed); keep the existing `nodeLinker` and zero-install choice untouched; `yarn dedupe` once, `yarn dedupe --check` in `deps:check`; `resolutions` for stragglers; verify `compressionLevel` and `enableGlobalCache` for the installed version and pick what makes CI cache smaller/faster; CI cache: `.yarn/cache` (if not committed) keyed on `yarn.lock`; `yarn workspaces focus` for CI jobs that need one project only.

### Nx — local cache + affected, never Nx Cloud

- Remove Nx Cloud if present (one commit): `nx-cloud` dependency, `nxCloudId` / `nxCloudAccessToken` / cloud `tasksRunnerOptions` in `nx.json`, `NX_CLOUD_*` in CI and env files, cloud-related scripts. Add `neverConnectToCloud: true`, `NX_NO_CLOUD=true` in CI variables and `.env.example`, and the `deps:check` grep guard. Note: custom task runners are not a substitute — do not add community remote-cache runners either.
- `verify` and pre-push run `nx affected -t lint typecheck test build` (+ `e2e` only when the app is affected). Keep full `run-many` as `verify:all`. `defaultBase` in `nx.json` = the default branch.
- `targetDefaults`: `cache: true` for `build`, `lint`, `typecheck`, `test`, `e2e`; `build.dependsOn: ["^build"]`; `test.inputs: ["default", "^production", {…test configs…}]`; `lint.inputs` include the ESLint config files; `outputs` exact (`{projectRoot}/dist`, `{workspaceRoot}/coverage/{projectRoot}`, `{workspaceRoot}/playwright-report`…) — verify a warm run actually restores them.
- `namedInputs`: `default` = `{projectRoot}/**/*` + `sharedGlobals`; `production` excludes specs, test setup, `*.md`, `docs/**`, e2e, tool configs; `sharedGlobals` only files that truly affect every project (root tsconfig, `.nvmrc`, lockfile) — not the whole root.
- Parallelism: `parallel` in `nx.json` ≈ physical cores locally; in CI set per runner size.
- Daemon on locally (`NX_DAEMON` unset), `NX_DAEMON=false` in CI. `cacheDirectory` = `.nx/cache` (gitignored) so GitLab can cache it.
- Graph hygiene: enable `@nx/enforce-module-boundaries` with tags; keep plugins' inferred tasks or explicit targets consistently (not both for the same target); use plugin `include`/`exclude` to shrink graph computation in large repos; `nx graph --file=graph.json` in `deps:check` to catch accidental cross-project imports.
- Diagnose cache misses with `--verbose` (input hashes) before touching inputs; `nx reset` only when the daemon/graph is corrupted.

### Angular

- Builders: `@angular/build:application`, `@angular/build:dev-server`, `@angular/build:unit-test` (Vitest) — migrate if still on legacy `browser`/Karma; keep `.angular/cache` enabled; `cli.analytics: false` (`NG_CLI_ANALYTICS=false` in CI).
- Zoneless: if the app already runs OnPush + signals, switch to `provideZonelessChangeDetection()` and drop `zone.js` from polyfills and deps (bundle and runtime win). If not ready, write it as a recommendation with the blockers listed.
- Schematics defaults in `angular.json`: standalone, `changeDetection: OnPush`, `skipTests: false` — so new code is born fast.
- Routing: lazy `loadComponent` / `loadChildren` per feature; a preloading strategy (`PreloadAllModules` or quicklink-style) only if it measurably helps; `@defer` for heavy below-the-fold blocks; `NgOptimizedImage` for images.
- Build hygiene: `budgets` enforced in prod, `outputHashing: all`, prod source maps off or hidden, `optimization` on; dev configuration: no optimization, source maps only where useful.
- Tree-shaking killers: no deep barrel `index.ts` chains (import from the file), no whole-library imports (`lodash`, `moment`, full Material entrypoints); `sideEffects: false` in library `package.json`; check with `--stats-json` + `esbuild-visualizer`.
- TS: `strict`, `strictTemplates`, `isolatedModules: true`, `skipLibCheck: true`.
- Tests: `provideZonelessChangeDetection()` in `TestBed`; pure logic (services, `computed`, utils) tested without `TestBed`; override heavy children (`TestBed.overrideComponent`) instead of rendering trees; `provideRouter([])` / `provideHttpClientTesting()` over module imports; harnesses only where they pay for themselves.
- SSR/hydration only if the app already uses `@angular/ssr`: `provideClientHydration(withEventReplay())`, incremental hydration on `@defer` blocks — otherwise out of scope.

### Vitest

- Pool: `pool: 'threads'` + `isolate: false` — only if the full suite passes twice in a row and once with `sequence.shuffle: true`; otherwise keep isolation and document why. `pool: 'vmThreads'` only for memory-bound suites.
- `maxWorkers` ≈ physical cores locally, explicit per runner size in CI; `fileParallelism: true`.
- Environments: `node` by default; `jsdom` only where DOM is needed — split with `test.projects` (or per-file `// @vitest-environment` pragma) so pure logic never pays for jsdom startup. Keep `setupFiles` tiny; no heavy global imports.
- `include` narrowed to `src/**/*.spec.ts`; `exclude` `node_modules`, `dist`, `.nx`, `.angular`, e2e dirs.
- Determinism: `restoreMocks: true`, `clearMocks: true`, fake timers for time-based logic, msw for HTTP, `retry: 0` locally (never hide flakes), `bail: 1` in CI.
- Coverage: `provider: 'v8'`, `include` = sources only, `exclude` specs/configs/barrels, `thresholds` (≥80 % lines/branches/functions) as the gate, reporters `text-summary` + `lcov` + `cobertura` (GitLab MR diff coverage); coverage only in `verify`/CI, never in watch.
- Reporters: `default` locally; `dot` + `junit` (`outputFile`) in CI for GitLab `reports: junit`.
- Type checking via `tsc --noEmit` in `typecheck`, not `vitest --typecheck`.
- Scripts: `test` = `vitest run`, `test:watch` = `vitest`, `test:changed` = `vitest run --changed`, `test:cov` = `vitest run --coverage`.
- CI sharding for large suites: `vitest run --shard=$CI_NODE_INDEX/$CI_NODE_TOTAL --reporter=blob` under `parallel:`, then `vitest --merge-reports` in a follow-up job.
- Timeouts explicit (`testTimeout`, `hookTimeout`) — slow tests fail loudly, not silently.

### TypeScript

- `incremental: true`, `tsBuildInfoFile` in a gitignored dir, `skipLibCheck: true`; `typecheck` = `tsc --noEmit -p <tsconfig>`; project references when several projects.

### Formatter — `nx format` vs Prettier vs Biome (default is the one already there)

Swapping the formatter touches every file in the repository and is a matter of taste as much as of speed, so it is one of the few items on this list that you **must put to the user before doing**. Measure first, then ask, then implement only a yes. The exception is the Nx default below, which is not a swap at all.

**In an Nx workspace the default is `nx format`, and you do not need to ask to adopt it.** Nx ships `nx format:check` and `nx format:write`; they drive Prettier through the project graph and take the same `--base` / `--projects` / `--files` targeting as the rest of Nx, so `verify` and the pre-push hook check only what changed instead of the whole tree. That is the same win as a faster binary, obtained with **zero new dependencies and zero new configuration**: no second formatter in `package.json`, no second config file, no second ignore file, no second editor extension, no second entry in CI caching. In a repo that already pays for Nx, adding Biome next to it buys milliseconds and costs a whole parallel toolchain. Wire `format` to `nx format:write` and `format:check` to `nx format:check --base=$(git merge-base origin/<default-branch> HEAD)` (full-tree `nx format:check` on the default branch), and stop there.

Only when Nx is absent, or when the user asks for the comparison explicitly, is the three-way question live:

|             | covers                                                                                      | new dependencies                        | new configuration                                             | speed                                                 |
| ----------- | ------------------------------------------------------------------------------------------- | --------------------------------------- | ------------------------------------------------------------- | ----------------------------------------------------- |
| `nx format` | whatever Prettier covers                                                                    | none in an Nx repo                      | none                                                          | only changed projects                                 |
| Prettier    | `.ts`, `.js`, `.html` (Angular templates included), `.css`/`.scss`, `.json`, `.md`, `.yaml` | the one already installed               | the one already written                                       | `--cache` makes a warm run cheap                      |
| Biome       | `.ts`, `.js`, `.json`, `.css`; `.html` only after enabling it explicitly; **no Markdown**   | one binary, plus a new editor extension | `biome.jsonc`, new ignore syntax, editor formatter re-pointed | fastest on code, by roughly 4× cold on a JS-only tree |

- **Measure both on this repo's own files**, not on a blog's benchmark: full check cold and warm for the current formatter, then the same file set through `npx @biomejs/biome format .`. Report wall time and, more importantly, **how many files the two disagree about** (`biome format --write` on a scratch copy, then `git diff --stat`). A one-line diff and a ten-thousand-line diff are different decisions.
- **Check what Biome does not cover, against the installed version, not against this text.** Read the shipped schema (`node_modules/@biomejs/biome/configuration_schema.json`) and list its language sections. At the time of writing there is no `markdown` section, so every `.md` file in the repo would lose its formatting gate — in a docs-heavy repo that is the whole decision. Its HTML formatter is off by default and young, which matters most in Angular repos, where templates are half the code. Also confirm `json.parser.allowComments` for JSONC files (`.vscode/*.json`, `tsconfig.json`) or the formatter will reject them as malformed.
- **A Biome plugin does not close a language gap** — do not let "it is extensible" end the discussion. Plugins are GritQL patterns matched against a tree Biome itself parsed, they are lint-only (so they do nothing under `linter.enabled: false` or `biome format`), and they never emit formatting. A file type Biome cannot parse never reaches them: with a plugin configured, `biome check x.md` still answers "these paths were provided but ignored". Verify that on the installed binary before either believing or repeating it.
- **Ask the user in one question with the numbers in it**: how much time is saved, how many files change, which file types stop being formatted, how many dependencies and config files appear, and what the fallback is (keep Prettier with `--cache`, which is usually within a factor of two of Biome on a warm run). Offer the hybrid explicitly — Biome for code, Prettier kept for Markdown only — because it is the option that loses nothing and is easy to miss, and say plainly that it means maintaining two formatters.
- **If the answer is yes**, it is a formatter swap and nothing else: carry the existing numbers over verbatim (line width, quote style, trailing commas, line ending, indent), set `linter.enabled: false` and `assist.enabled: false` so a bundled linter and import sorter do not rewrite files nobody asked to change, translate the ignore file into `files.includes` with `!` negations, remove the old formatter from the manifest, config and editor settings (`editor.defaultFormatter`, recommended extensions), and regenerate anything that embeds line numbers. Point `$schema` at the copy in `node_modules` so the version is not declared a second time. In an Nx workspace also set `NX_SKIP_FORMAT=true`, or generators will keep running Prettier over files the repo no longer formats with it.
- **If the answer is no**, the cheap win is `--cache` on the existing formatter, plus making sure the cache directory is gitignored (or lives under `node_modules`) and restored in CI.
- Either way, adopting Biome's **linter** is a separate question from adopting its formatter. Do not bundle them: the linter's findings are a code-review backlog, not a formatting change, and mixing the two makes the diff unreviewable.

### ESLint — performance

- Flat config only; `eslint --cache --cache-location .eslintcache` (gitignored) locally and in lint-staged; in CI the cache dir is restored from the GitLab tooling cache.
- Typed linting is the expensive part: `parserOptions.projectService: true` (no hand-listed `project` arrays), typed configs applied only to `**/*.ts` sources, `disableTypeChecked` for `*.js`, `*.mjs`, config and spec-helper files; keep `allowDefaultProject` minimal.
- Find slow rules with `TIMING=1 <pm> exec eslint .`; restrict the known heavy ones (`import-x/no-cycle` with `maxDepth`, `sonarjs/cognitive-complexity` only on sources).
- Multithreaded linting (`--concurrency`) if the installed ESLint supports it — verify; otherwise parallelism comes from Nx running `lint` per project.
- Prettier runs separately (lint-staged + `format:check` in `verify`); never through `eslint-plugin-prettier`. `eslint-config-prettier` is the last entry in the config array.
- Gate: `--max-warnings 0` in `verify`/CI, `linterOptions.reportUnusedDisableDirectives: 'error'`; every `eslint-disable` needs a `-- reason` (enforced by the comments plugin).

### ESLint — quality plugins (tiered; install only what the repo lacks)

Tier 1 — must-have in every repo of this stack:

- `typescript-eslint` → `strictTypeChecked` + `stylisticTypeChecked`. Non-negotiable rules at `error`: `no-explicit-any`, `no-floating-promises`, `no-misused-promises`, `switch-exhaustiveness-check`, `no-unnecessary-condition`, `strict-boolean-expressions`, `consistent-type-imports`, `no-deprecated` (replaces `eslint-plugin-deprecation`), `prefer-readonly`, `explicit-module-boundary-types` on public APIs, `restrict-template-expressions`, `no-unnecessary-type-assertion`.
- `angular-eslint` → `tsRecommended` + `templateRecommended` + `templateAccessibility`, with `processInlineTemplates`. Turn on: `prefer-signals`, `prefer-standalone`, `prefer-on-push-component-change-detection`, `prefer-inject`, `no-async-lifecycle-method`, `component-selector` / `directive-selector` with the repo prefix; template: `prefer-control-flow`, `prefer-self-closing-tags`, `no-call-expression`, `button-has-type`, `prefer-ngsrc`, `no-negated-async`, and the accessibility set (`alt-text`, `click-events-have-key-events`, `interactive-supports-focus`, `label-has-associated-control`, `role-has-required-aria`).
- `@nx/eslint-plugin` → `flat/typescript` + `flat/angular` + `flat/angular-template`; `@nx/enforce-module-boundaries` with `depConstraints` by tags (`type:*`, `scope:*`), and `@nx/dependency-checks` on every publishable/library `package.json`.
- `eslint-plugin-rxjs-x` (the maintained, flat-config successor of `eslint-plugin-rxjs`): `no-ignored-subscription`, `no-nested-subscribe`, `no-unsafe-takeuntil`, `no-ignored-error`, `prefer-observer`, `no-subject-value` — RxJS only at the I/O edge.
- `@vitest/eslint-plugin` on spec files: `expect-expect`, `no-focused-tests` (error), `no-disabled-tests` (warn), `no-identical-title`, `valid-title`, `prefer-to-be`, `consistent-test-it`, `no-standalone-expect`.
- `eslint-plugin-playwright` on e2e files: `recommended` + `no-wait-for-timeout`, `no-focused-test`, `missing-playwright-await`, `prefer-web-first-assertions`, `no-conditional-in-test`, `expect-expect`, `no-networkidle`.
- `@eslint-community/eslint-plugin-eslint-comments`: `require-description`, `no-unlimited-disable`, `no-unused-disable`, `disable-enable-pair`.
- `eslint-config-prettier` — last.

Tier 2 — strongly recommended:

- `eslint-plugin-unicorn` → `recommended`, then disable the noisy opinion rules (`prevent-abbreviations`, `no-null`, `no-array-reduce` — decide per repo, once); keep `prefer-node-protocol`, `filename-case` (kebab-case), `prefer-top-level-await`, `no-useless-undefined`, `prefer-string-slice`, `throw-new-error`.
- `eslint-plugin-sonarjs` → `recommended`; `cognitive-complexity` at 15, `no-duplicate-string`, `no-identical-functions`, `no-nested-template-literals`. If a SonarQube quality gate exists, align thresholds with it — one standard, not two.
- `eslint-plugin-import-x` + `eslint-import-resolver-typescript`: `no-duplicates`, `no-extraneous-dependencies`, `no-cycle` (scoped, `maxDepth`), `first`, `newline-after-import`; ordering by `eslint-plugin-simple-import-sort` (or `perfectionist` — pick one, never both).
- `eslint-plugin-n` for Node code (tools, scripts, MCP servers): `no-unsupported-features/node-builtins` and `es-syntax` driven by `engines.node` (this is what makes "built-ins over packages" safe), `no-process-exit`, `no-sync` (warn), `no-path-concat`, `prefer-promises/fs`.
- `eslint-plugin-security` for Node code: `detect-child-process`, `detect-non-literal-fs-filename` (paths must go through the sandbox guard), `detect-eval-with-expression`, `detect-unsafe-regex`; `detect-object-injection` at warn.
- `eslint-plugin-regexp` → `recommended` (ReDoS, unreachable alternatives, needless escapes).
- `eslint-plugin-no-secrets` → `no-secrets` at error on sources, tolerance tuned to avoid false positives on hashes in fixtures.
- `eslint-plugin-promise`: `catch-or-return`, `no-nesting`, `always-return` where `no-floating-promises` does not already cover it.

Tier 3 — situational:

- `eslint-plugin-unused-imports` (autofix removal in lint-staged; `no-unused-vars` still reports).
- `eslint-plugin-tsdoc` / `eslint-plugin-jsdoc` (`require-jsdoc` on exported public APIs of published libraries only).
- `@eslint/json` (+ `jsonc` sorting) for `package.json`, `nx.json`, `angular.json`, `tsconfig*.json`; `@eslint/markdown` for docs.
- `eslint-plugin-compat` with the repo `browserslist` when the app ships to legacy browsers.

Do not add: `eslint-plugin-prettier`, `eslint-plugin-rxjs` (unmaintained), `eslint-plugin-deprecation` (superseded), `eslint-plugin-boundaries` when Nx boundaries are already on, two sorting plugins, or any plugin whose rule set duplicates an existing one — every extra plugin costs lint time; each must earn it in the before/after table.

Config layering (one `eslint.config.mjs` per repo, project overrides only where needed):

1. global `ignores`;
2. base JS (`@eslint/js` recommended) for all files;
3. typed TS layer for `**/*.ts` (typescript-eslint strict + stylistic, unicorn, sonarjs, import-x, comments, regexp, no-secrets, promise);
4. Angular layer for app/lib sources (`angular-eslint` ts rules, rxjs-x, Nx boundaries) and an HTML/inline-template layer (`angular-eslint` template + accessibility);
5. Node layer for `tools/**`, scripts and server code (`n`, `security`);
6. test layers: `**/*.spec.ts` (`@vitest/eslint-plugin`; do not relax `no-explicit-any` in tests), `e2e/**` (`eslint-plugin-playwright`);
7. `disableTypeChecked` for JS/config files;
8. `eslint-config-prettier`.

Verify each plugin's flat-config export name for the installed version before wiring it.

Rollout: enable new plugins at `warn` on the first commit, fix the findings in dedicated `refactor(lint):` commits, then promote to `error` — never land a config that turns the current branch red.

### Git hooks — native, committed, cross-platform

- Layout: `.githooks/pre-commit`, `.githooks/commit-msg`, `.githooks/pre-push` — POSIX `#!/bin/sh`, `set -e`, executable bit committed (`git update-index --chmod=+x`). Git for Windows ships `sh`, so no `.cmd` wrappers.
- Activation: `git config core.hooksPath .githooks`, run from a tiny deterministic `tools/scripts/setup-hooks.mjs` that is a no-op when `.git` is absent or `CI` is set (so published packages and CI never touch git config). Wire it to `prepare` (npm/pnpm/Yarn Classic) or `postinstall` (Yarn Berry, which does not run `prepare` on install) — verify for the installed manager.
- Contents: pre-commit → `<pm> exec lint-staged` (eslint `--cache --fix` + prettier on staged files only, target ≤ a few seconds); commit-msg → `<pm> exec commitlint --edit "$1"`; pre-push → `<pm> run verify` with Nx affected against `$(git merge-base origin/<default-branch> HEAD)`.
- Migration from Husky, if present: move `.husky/*` bodies into `.githooks/*`, remove the `husky` dependency and `prepare: husky`, keep lint-staged/commitlint configs unchanged. One commit, measured (hook time before/after).
- Bypass: `CI=1` or `--no-verify` for emergencies only — document, never script it.

### Git repo & local git performance

- `.gitattributes`: `* text=auto eol=lf` (no CRLF churn, stable lint-staged diffs); lockfiles and generated files collapsed in MR diffs (`gitlab-generated=true`, plus `linguist-generated=true` for portability); binaries marked `binary`.
- `.gitignore` complete (see Phase 1 list) — cache dirs must never be committed.
- Documented local config (`docs/dev-setup.md`, not enforced): `core.fsmonitor=true`, `core.untrackedCache=true`, `feature.manyFiles=true`, `git maintenance start` (commit-graph, prefetch, gc in background), `core.longpaths=true` on Windows, `merge.conflictstyle=zdiff3`, `diff.algorithm=histogram`, `rerere.enabled=true`, `pull.rebase=true`, `fetch.prune=true`.
- Large repos only (recommendation): partial clone `--filter=blob:none` for new clones.
- Conventions: Conventional Commits via commitlint (scopes per repo), small commits, branch names `type/slug`; `.gitlab/merge_request_templates/Default.md` with the DoD checklist; `CODEOWNERS` if reviewers are fixed.

### Playwright

- Config: `fullyParallel: true`, `workers` explicit in CI (per runner cores) and default locally, `forbidOnly: !!process.env.CI`, `retries: process.env.CI ? 2 : 0`, `trace: 'on-first-retry'`, `screenshot: 'only-on-failure'`, `video: 'retain-on-failure'` or off, `preserveOutput: 'failures-only'`, explicit `timeout` / `expect.timeout`, `testIdAttribute` set.
- `webServer`: serve the prebuilt `dist/` (static server or prod dev-server), never a full dev build inside the e2e job; `reuseExistingServer: !process.env.CI`; sane `timeout`.
- Auth & data: `storageState` produced once by a setup project (project `dependencies`), never login per test; seed data via API/fixtures, not UI; tests independent and order-agnostic (`test.describe.configure({ mode: 'parallel' })`).
- Locators & waits: `getByRole` / `getByTestId`, web-first assertions, zero `waitForTimeout`; tags (`@smoke`) so pre-push can run the smoke subset when the full affected suite is too slow — CI still runs everything.
- Browser matrix: `chromium` only on MR pipelines; `firefox` / `webkit` on the default branch and nightly schedule.
- Reports: `list` locally; `blob` + `junit` in CI; shard with `--shard=$CI_NODE_INDEX/$CI_NODE_TOTAL` under `parallel:`, then `playwright merge-reports --reporter html,junit` in a follow-up job; HTML report and traces as artifacts `when: on_failure`.
- Scripts: `e2e` = `playwright test`, `e2e:changed` = `playwright test --only-changed`, `e2e:failed` = `--last-failed`, `e2e:ui` for local debugging.
- Browsers: official Playwright image matching installed `@playwright/test` in CI (`PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` on install); locally cache browsers, do not reinstall on every `install`.
- Flakes: any test needing `retries` locally is a bug — fix or quarantine with a tag, never raise retries to hide it.

### Deps

- Remove `knip` findings; dedupe with `<pm>`; `overrides`/`resolutions` where justified; built-ins over packages when the package is used for <20 % of its features.

### Windows (docs only)

- Document Dev Drive and Defender exclusions for `node_modules`, `.nx`, `.angular`, `dist`, `.eslintcache`, the `NODE_COMPILE_CACHE` dir and the `<pm>` cache/store dir in `docs/dev-setup.md`; how to set `NODE_COMPILE_CACHE` / `NODE_OPTIONS` as user environment variables (they must exist before any terminal or VS Code starts); and that the committed `.vscode/settings.json` excludes must stay in sync with this list.

### GitLab CI — create or refactor `.gitlab-ci.yml`

- Skeleton: `workflow: rules` = MR pipelines + default branch + schedules, no duplicate branch/MR pipelines; `default:` block for `image`, `interruptible: true`, `retry: { max: 1, when: [runner_system_failure, stuck_or_timeout_failure] }`, per-job `timeout`; `extends` / `!reference` for shared fragments; optionally `include: project:` a shared template repo so every repo in the organization consumes the same pipeline.
- `image` derived from `.nvmrc` (document the mapping; no version in prose); `before_script`: `corepack enable` when `packageManager` is set.
- Variables: `CI=true`, `NX_DAEMON=false`, `NX_NO_CLOUD=true`, `NG_CLI_ANALYTICS=false`, `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` (non-e2e jobs), `<pm>` cache/store dir → repo-local, `NODE_COMPILE_CACHE` → repo-local dir (cached), `NODE_OPTIONS: "--max-semi-space-size=<n>"` (the value measured in Phase 0), `NODE_NO_WARNINGS: "1"`, `FF_USE_FASTZIP: "true"`, `CACHE_COMPRESSION_LEVEL: "fastest"`, `ARTIFACT_COMPRESSION_LEVEL: "fastest"`, `GIT_DEPTH` compatible with affected (`0`, or a depth plus explicit fetch of the base SHA).
- Stages: `install` → `check` (lint, typecheck, test — parallel jobs, `needs: [install]`) → `build` → `e2e` (`needs: [build]`, consumes the `dist/` artifact — build once). Jobs that do not need artifacts declare `dependencies: []`.
- Install with the detected manager's frozen + offline mode (see blocks above).
- Caches (separate, so each invalidates independently):
  1. deps: `key: { files: [<lockfile>] }` → manager cache/store dir; `policy: pull-push` in `install`, `pull` elsewhere;
  2. Nx: `key: nx-$CI_COMMIT_REF_SLUG`, `fallback_keys: [nx-$CI_DEFAULT_BRANCH]`, paths `.nx/cache` — this is the only cross-runner cache (Nx Cloud is forbidden);
  3. tooling: `.angular/cache`, `.eslintcache`, `*.tsbuildinfo`, the `NODE_COMPILE_CACHE` dir (same key strategy as 2).
- MR pipelines: `nx affected --base=$CI_MERGE_REQUEST_DIFF_BASE_SHA --head=$CI_COMMIT_SHA`; default branch: full `run-many`; nightly schedule: full run + full browser matrix + `pnpm store prune` / cache warm-up.
- Playwright job on the official image matching installed `@playwright/test`; `parallel: N` shards + a `merge-reports` job; `artifacts`: `playwright-report/`, `blob-report/`, traces `when: on_failure`, `expire_in: 1 day`.
- Test/coverage reports: `artifacts.reports.junit` from Vitest and Playwright junit outputs; `artifacts.reports.coverage_report: { coverage_format: cobertura, path: … }`; job-level `coverage:` regex matching the `text-summary` line.
- Gates: `allow_failure: false` on lint/typecheck/test/build/e2e; project settings "pipelines must succeed" + auto-cancel redundant pipelines documented in `docs/dev-setup.md`.
- Optional, off the MR critical path (default branch / schedule only): GitLab SAST and Dependency Scanning templates via `include: template:`.
- No secrets needed for build/test; masked/protected variables only for anything else. No publish/release job. Validate the file with the pipeline editor / CI lint before committing.

## Phase 4 — Review

Every changed file: `| File | Line | Problem | 🔴🟡🟢 | Suggestion |`. Check: no behavior change · package manager unchanged · zero Nx Cloud traces · no versions in prose · hooks are native, committed, executable, and still block on failure · Nx `outputs` restore on warm runs · CI affected-based on MRs and full on default branch · build once, e2e reuses `dist/` · no secrets needed for build/test.

## Phase 5 — Verify & measure

- `<pm> run verify` = PASS, including every app-level unit and e2e script the repo defines (the full local gate, whatever it is named in this repo).
- Re-run Phase 0 measurements; report `| Metric | Before | After | Δ |` (cold and warm), including clean-install time, per-hook time, warm cache-hit rate, MR pipeline wall time.
- Revert any change without measurable gain or with flakiness. Update `docs/runs/<date>-perf-optimize.md`.

## Done when

All approved plan items ✅ · review APPROVED · `<pm> run verify` PASS · before/after table delivered · CI pipeline green on an MR · package manager unchanged · Nx Cloud absent and guarded · hooks native · no version numbers in prose.
