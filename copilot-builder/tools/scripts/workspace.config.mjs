// workspace.config.mjs — the names a company changes when it adopts this template, in ONE place.
//
// Everything that can import JavaScript reads them from here: the ESLint selector rules and the
// module-boundary patterns, the generator, the affected runner. Two files cannot import and repeat a
// value on purpose — `angular.json` (`schematics.*.prefix`, the selector prefix the CLI writes into new
// components) and `biome.jsonc` (`vcs.defaultBranch`); README.md names both in the adoption steps.
/** Selector prefix of components and directives (`<cb-button>`, `cbTooltip`). */
export const PREFIX = 'cb';
/** Scope of the tsconfig aliases every library is imported through: `@cb/<scope>/<type>[-<name>]`. */
export const ALIAS_SCOPE = '@cb';
/** The branch `affected` diffs against when the remote HEAD is unknown (also biome.jsonc → vcs.defaultBranch). */
export const DEFAULT_BRANCH = 'main';
