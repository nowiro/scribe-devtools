// The single declaration site for every dependency version in this repository.
//
// Why a config and not just the manifests: a version number here is not only an install
// instruction, it is a claim the repository makes about itself. This file inverts the usual
// "grep for the version and hope" approach: the version lives in one row, and `check-pins.mjs`
// mechanically finds everything downstream of it that a human still has to look at.
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
// `check-pins.mjs` is offline and deterministic, so it can be the first step of `pnpm run verify`.
// Whether the pin is still `latest` upstream is a calendar question and belongs to a separate,
// network-touching, WARN-only script — mixing the two would make the gate red on a train.

/** @typedef {{ id: string, owner: string, mirrors?: string[], argv?: string[], policy: 'exact' | 'caret', minSupported?: string, prose?: string[], frozen?: string[], regenerate?: string[], staleDays: number, why: string, links?: string[] }} Pin */

/**
 * Text that is history, not declaration. Empty on this branch: the changelog and the archived
 * design/handoff/research docs that used to live here are gone — there is no long-form prose left
 * to freeze, only the short files `prose` below already points at.
 */
// copilot-builder/ is a self-contained template tree with its own pins and gates — not this repository's prose.
export const FROZEN_ALWAYS = ['copilot-builder/'];

/** @type {Pin[]} */
export const PINS = [
  {
    id: 'playwright-core',
    owner: 'packages/browser-inspector/package.json#dependencies',
    policy: 'exact',
    minSupported: '1.62.1',
    prose: ['AGENTS.md', 'README.md', 'packages/', 'scripts/'],
    staleDays: 45,
    why: 'The engine reads playwright-core internals: `aria-ref` resolution through `_lastAriaSnapshotForQuery`, `ariaSnapshotWithRefs`, `ariaSnapshotForFrame`, `computeAriaRef` ref stability, the `f<seq>` frame prefix — none of it public API. `pwVersion` is also part of the keeper `identityHash`, and `scripts/portable-zip.mjs` compares this manifest string to the installed version literally — a range here throws on every portable build.',
    links: ['https://www.npmjs.com/package/playwright-core/v/1.62.1'],
  },
  {
    id: 'oxfmt',
    owner: 'package.json#devDependencies',
    policy: 'caret',
    prose: [],
    staleDays: 90,
    why: "`oxfmt --check` is the first step of `pnpm run verify`, so a formatting change turns the whole gate red before anything else runs — loud and immediate, which is why caret is fine. On 0.x a caret admits patches only: every minor is a deliberate one-line bump, and a minor is where formatting output may move. It replaced Biome (which had replaced prettier) with the same numbers; the switch rewrote ONE line of code — the space before `)` in an empty `for` update clause went back to prettier's shape. Markdown is ignored by choice in .oxfmtrc.jsonc, not for lack of support: table padding made AGENTS.md 48 % bigger. `sortPackageJson` is off; a release that flips a default shows up as a red `--check`, not as a silent rewrite.",
  },
  {
    id: 'oxlint',
    owner: 'package.json#devDependencies',
    policy: 'caret',
    prose: [],
    staleDays: 90,
    why: 'A bare `oxlint` is the second step of `pnpm run verify` (`categories.correctness: error`, `denyWarnings`, unused disable directives are errors). A release that adds a correctness rule turns the gate red on existing code — visible, never silent. The first run found six unused imports/variables and 23 other findings; the deliberate exceptions carry `oxlint-disable-next-line <rule> -- <reason>`.',
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
    id: '@types/node',
    owner: 'package.json#devDependencies',
    policy: 'caret',
    prose: [],
    staleDays: 365,
    why: 'Types only, consumed by `tsc --noEmit`. Deliberately kept at 22 to match `engines.node: >=22`: types from a newer runtime would typecheck calls that do not exist on the oldest Node we claim to support.',
  },
];
