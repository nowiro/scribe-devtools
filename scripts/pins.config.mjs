// The single declaration site for every dependency version in this repository.
//
// Why a config and not just the manifests: a version number here is not only an install
// instruction, it is a claim the repository makes about itself. `playwright-core` 1.62.1 is
// quoted in 43 lines across 20 files — six of them assertions the test suite enforces, the
// rest prose that no gate reads. Bumping the pin therefore fails loudly on string comparisons
// (cheap to "fix": edit six literals) and stays silent about the thing that actually breaks
// (the aria grammar the golden fixtures were rendered from). This file inverts that: the
// version lives in one row, and `check-pins.mjs` mechanically finds everything downstream of
// it that a human still has to look at.
//
// Fields:
//   id           npm package name.
//   owner        `<manifest>#<section>` — the ONE place the version is decided.
//   mirrors      other `<manifest>#<section>` entries that must repeat it character for character.
//   argv         files where the version rides in a command line (`npx -y pkg@version …`).
//   policy       'exact' (bare version, no range operator) or 'caret'.
//   minSupported the floor below which the code is known not to work. A FLOOR, not a ceiling:
//                it does not loosen `policy`. `>= 1.62.1` means "1.62.0 is not an option any more",
//                while the installed version stays exactly what `owner` says — one deliberate
//                edit of one line, never a silent resolution by npm.
//   prose        directories/files whose text must not quote a DIFFERENT version of this package.
//   frozen       text where an old version is the record of a past event; never rewritten.
//   regenerate   commands that must be re-run after a bump, because their output embeds the version.
//   staleDays    after this many days without a review, `check-upstream.mjs` (online, WARN) complains.
//   why          what breaks, in one sentence — this is what the reviewer of a bump needs.
//
// `check-pins.mjs` is offline and deterministic, so it can be the first step of `npm run verify`.
// Whether the pin is still `latest` upstream is a calendar question and belongs to a separate,
// network-touching, WARN-only script — mixing the two would make the gate red on a train.

/** @typedef {{ id: string, owner: string, mirrors?: string[], argv?: string[], policy: 'exact' | 'caret', minSupported?: string, prose?: string[], frozen?: string[], regenerate?: string[], staleDays: number, why: string, links?: string[] }} Pin */

/** Text that is history, not declaration — true for every pin. */
export const FROZEN_ALWAYS = ['CHANGELOG.md', 'docs/handoff/', 'docs/research/'];

/** @type {Pin[]} */
export const PINS = [
  {
    id: 'playwright-core',
    owner: 'packages/browser-inspector/package.json#dependencies',
    mirrors: ['bench/package.json#dependencies'],
    policy: 'exact',
    minSupported: '1.62.1',
    prose: ['AGENTS.md', 'README.md', 'docs/', 'packages/', 'scripts/', 'bench/'],
    // The gate's own tests build synthetic trees pinned to 1.62.0/1.62.2/1.63.0 on purpose — those
    // numbers are the test's subject, not a claim about this repository. Excluded here rather than
    // with six `pins:ignore` comments, which would say the same thing six times and read as noise.
    frozen: ['scripts/check-pins.test.mjs'],
    regenerate: ['node packages/browser-inspector/fixtures/generate.mjs', 'npm run bench'],
    staleDays: 45,
    why: 'The engine reads playwright-core internals: `aria-ref` resolution through `_lastAriaSnapshotForQuery`, `ariaSnapshotWithRefs`, `ariaSnapshotForFrame`, `computeAriaRef` ref stability, the `f<seq>` frame prefix. Six of those facts are written down in docs/DESIGN.md:27 and none of them is asserted against the installed bundle. The four golden fixtures were rendered by 1.62.1 and have no `--check` mode, so a grammar change repaints them and stays green. `pwVersion` is also part of the keeper `identityHash`, and `stagePortable` in scripts/portable-zip.mjs compares this manifest string to the installed version literally — a range here throws on every portable build.',
    links: ['https://www.npmjs.com/package/playwright-core/v/1.62.1'],
  },
  {
    id: '@playwright/mcp',
    owner: 'bench/package.json#devDependencies',
    argv: ['.mcp.json', '.vscode/mcp.json'],
    policy: 'exact',
    prose: ['AGENTS.md', 'README.md', 'docs/', 'bench/'],
    regenerate: ['npm run bench'],
    staleDays: 30,
    why: 'The whole benchmark is measured against this exact server: 4069 fixed tokens for 24 tools, the 2913 ms baseline, and every ratio in RAPORT/WYNIKI/BUDGET/README. The tool count moves between releases (21 tools / 3211 tokens at 0.0.69), and the default `--timeout-settle 500` is, per docs/DESIGN.md:35, two thirds of the measured difference. A different version does not make the numbers worse, it makes them not comparable.',
  },
  {
    id: 'gpt-tokenizer',
    owner: 'package.json#devDependencies',
    mirrors: ['bench/package.json#devDependencies'],
    policy: 'caret',
    prose: [],
    staleDays: 120,
    why: "The measuring instrument, not a dependency of the product: the 200-token limit on the AGENTS.md instruction block, AC-6/AC-7, the snapshot budgets and every token figure in the reports come out of it. A change moves BOTH sides of every ratio at once, so the result still looks plausible — which is exactly why it must never move unnoticed. Kept on caret deliberately: pinning it exact would freeze a tokenizer that is only ever a proxy for the agent's own, and the honest guard is the review calendar, not the range.",
  },
  {
    id: 'prettier',
    owner: 'package.json#devDependencies',
    policy: 'caret',
    prose: [],
    staleDays: 180,
    why: '`prettier --check .` is the first step of `npm run verify`, so a formatting change turns the whole gate red before a single test runs. Loud and immediate — the cheapest failure mode in the repository, which is why caret is fine.',
  },
  {
    id: 'typescript',
    owner: 'package.json#devDependencies',
    policy: 'caret',
    prose: [],
    staleDays: 180,
    why: '`tsc --noEmit` type-checks the JSDoc on plain .mjs sources. A stricter release fails the gate visibly; there is no silent mode of failure.',
  },
  {
    id: 'vitest',
    owner: 'package.json#devDependencies',
    policy: 'caret',
    prose: [],
    staleDays: 180,
    why: 'The runner for all six projects in vitest.config.mts. `passWithNoTests: true` is the one quiet spot: a major that renames a project silently runs zero tests instead of failing, so a bump must be checked against the printed test count, not against a green tick.',
  },
  {
    id: '@types/node',
    owner: 'package.json#devDependencies',
    policy: 'caret',
    prose: [],
    staleDays: 365,
    why: 'Types only, consumed by `tsc --noEmit`. Deliberately kept at 22 to match `engines.node: >=22`: types from a newer runtime would typecheck calls that do not exist on the oldest Node we claim to support.',
  },
];
