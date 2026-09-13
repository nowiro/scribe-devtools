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
// `check-pins.mjs` is offline and deterministic, so it can be the first step of `npm run verify`.
// Whether the pin is still `latest` upstream is a calendar question and belongs to a separate,
// network-touching, WARN-only script — mixing the two would make the gate red on a train.

/** @typedef {{ id: string, owner: string, mirrors?: string[], argv?: string[], policy: 'exact' | 'caret', minSupported?: string, prose?: string[], frozen?: string[], regenerate?: string[], staleDays: number, why: string, links?: string[] }} Pin */

/**
 * Text that is history, not declaration. Empty on this branch: the changelog and the archived
 * design/handoff/research docs that used to live here are gone — there is no long-form prose left
 * to freeze, only the short files `prose` below already points at.
 */
export const FROZEN_ALWAYS = [];

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
    id: 'gpt-tokenizer',
    owner: 'package.json#devDependencies',
    policy: 'caret',
    prose: [],
    staleDays: 120,
    why: "The measuring instrument behind the 200-token limit on the AGENTS.md instruction block (`check-instruction-sync.mjs`), not a dependency of the product. Kept on caret deliberately: pinning it exact would freeze a tokenizer that is only ever a proxy for the agent's own, and the honest guard is the review calendar, not the range.",
  },
  {
    id: '@biomejs/biome',
    owner: 'package.json#devDependencies',
    policy: 'caret',
    prose: [],
    staleDays: 180,
    why: '`biome format .` is the first step of `npm run verify`, so a formatting change turns the whole gate red before anything else runs — loud and immediate, which is why caret is fine. It replaced prettier: on this tree the two disagree about exactly ONE line out of 62 files (a space before `)` in an empty `for` update clause), so the switch was a change of tool, not of style. What it does NOT carry over is Markdown: the 2.x configuration schema has no markdown section, so the nine prose files prettier used to format are on review now. A major that adds one would be worth taking; that is what this row is for.',
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
