// workspace.config.mjs — the names a company changes when it adopts this template, in ONE place.
//
// Everything that can import JavaScript reads them from here: the angular-eslint selector rules, the
// oxlint module-boundary patterns, the generator, the affected runner. One file cannot import and
// repeats a value on purpose — `angular.json` (`schematics.*.prefix`, the selector prefix the CLI
// writes into new components); README.md names it in the adoption steps.
/** Selector prefix of components and directives (`<cb-button>`, `cbTooltip`). */
export const PREFIX = 'cb';
/** Scope of the tsconfig aliases every library is imported through: `@cb/<scope>/<type>[-<name>]`. */
export const ALIAS_SCOPE = '@cb';
/** The branch `affected` diffs against when the remote HEAD is unknown. */
export const DEFAULT_BRANCH = 'main';
