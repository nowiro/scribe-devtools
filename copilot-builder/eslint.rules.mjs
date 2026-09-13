/**
 * eslint.rules.mjs — the team's tuning, applied AFTER the presets of `eslint.plugins.mjs`.
 *
 * Order matters in a flat config: a later entry overrides an earlier one, so this file must stand
 * behind the presets. Every change here has a reason; a rule switched off without one comes back with
 * the next plugin update as "I wonder why this was off".
 *
 * The second half of this file is the MODULE-BOUNDARY map of the monorepo. Without Nx there is no
 * `enforce-module-boundaries`; the same contract is expressed with `no-restricted-imports` patterns
 * on the alias shape `@cb/<scope>/<type>[-<name>]`, where <type> is one of `feature`, `ui`,
 * `data-access`, `util`. The dependency direction is: feature → (ui, data-access, util);
 * ui → (ui, util); data-access → (data-access, util); util → util. Applications may import anything
 * public. Nobody imports another project's `src/` — the public API is the alias.
 */
import { CODE, TESTS } from './eslint.plugins.mjs';

const APP_CODE = ['apps/**/*.ts', 'libs/**/*.ts'];
const NODE_CODE = ['tools/**/*.mjs', 'tools/**/*.mts', '*.mjs', '*.mts'];
const HOOKS = ['tools/hooks/**/*.mjs'];

/** Deep imports into another project's sources bypass its public API and its boundary. */
const DEEP_IMPORTS = {
  group: ['@cb/*/*/src/*', '**/libs/*/*/src/**', '**/apps/*/src/**'],
  message: 'Import the public API through its alias (@cb/<scope>/<type>-<name>), never a path into src/.',
};
/** Angular Material and the CDK are wrapped once, in libs/shared/ui — swapping or upgrading them is then work in one directory. */
const MATERIAL = {
  group: ['@angular/material', '@angular/material/*', '@angular/cdk', '@angular/cdk/*'],
  message:
    'Angular Material and CDK are imported only in libs/shared/ui. Use the wrapper component from @cb/shared/ui — and add it there when it is missing.',
};
const NO_FEATURE_OR_DATA = {
  group: ['@cb/*/feature*', '@cb/*/data-access*'],
  message: 'A ui library depends only on ui and util libraries — it must not know which screen or data source uses it.',
};
const UTIL_ONLY = {
  group: ['@cb/*/feature*', '@cb/*/data-access*', '@cb/*/ui*'],
  message: 'A util library depends only on other util libraries.',
};
const NO_FEATURE_OR_UI = {
  group: ['@cb/*/feature*', '@cb/*/ui*'],
  message: 'A data-access library depends only on data-access and util libraries — presentation stays out of it.',
};

/** `no-restricted-imports` is not merged between layers, so every layer lists its full pattern set. */
const boundary = (name, files, patterns) => ({
  name,
  files,
  rules: { 'no-restricted-imports': ['error', { patterns }] },
});

export const customRules = [
  {
    name: 'cb/sonar-thresholds',
    files: CODE,
    rules: {
      // 15 as in "Sonar way". An error, not a warning: a warning does not stop the gate, and a function
      // with complexity 30 does not become simpler because somebody saw it on a list.
      'sonarjs/cognitive-complexity': ['error', 15],
      // Repeated user-facing strings ("Nie znaleziono") are the same message in many places, not
      // duplicated logic; the rule would push towards constants named MESSAGE_3.
      'sonarjs/no-duplicate-string': 'off',
      // A two-branch switch is a deliberate state machine with a closed case list.
      'sonarjs/no-small-switch': 'off',
      // Angular templates in literals carry their own strings inside `${}`; the formatter decides readability.
      'sonarjs/no-nested-template-literals': 'off',
      // Task markers in code are forbidden by convention (tasks live in issues, not in comments).
      'sonarjs/todo-tag': 'error',
      'sonarjs/fixme-tag': 'error',
    },
  },
  {
    name: 'cb/promise-tuning',
    files: CODE,
    rules: {
      // `void promise` is the explicit "not awaiting" of this codebase (navigation after save,
      // background refresh); errors are handled by interceptors, not by a catch on every call site.
      'promise/catch-or-return': 'off',
      'promise/always-return': 'off',
    },
  },
  {
    name: 'cb/node-tooling',
    files: NODE_CODE,
    rules: {
      // Tooling reads files from paths built out of arguments and spawns git, tsc and eslint — that
      // is its job; the two rules would need a disable comment on every second line and teach
      // everyone to ignore them. Paths still go through path.join under the repository root.
      'security/detect-non-literal-fs-filename': 'off',
      'security/detect-non-literal-regexp': 'off',
      'security/detect-child-process': 'off',
      // Tooling indexes plain objects with keys read from its own manifests and registries
      // (`pkg[section]`, `roster[name]`); the injection heuristic flags every such access and carries
      // no signal for local scripts running over trusted repository files.
      'security/detect-object-injection': 'off',
      // ReDoS rules assume untrusted input. Every regex in tools/ runs over repository sources,
      // manifests and the repository's own prose — the regexp plugin's correctness rules stay on,
      // the two performance rules and the duplicate `security` heuristic go.
      'security/detect-unsafe-regex': 'off',
      'sonarjs/super-linear-regex': 'off',
      'regexp/no-super-linear-backtracking': 'off',
      // `git`, `node` and the npm binaries are resolved from PATH on purpose — the scripts run on
      // three operating systems and never assume an install location.
      'sonarjs/no-os-command-from-path': 'off',
      // Scripts are also executables (`node tools/scripts/x.mjs` and `./tools/scripts/x.mjs`); the
      // shebang is documentation of that, not an error — the rule expects a `bin` entry we do not have.
      'n/hashbang': 'off',
      // A gate is a straight-line list of checks: the Sonar threshold of 15 fits a component, not a
      // validator with twelve rules. 25 keeps the worst offenders split into helpers without
      // fragmenting every check into a one-line function.
      'sonarjs/cognitive-complexity': ['error', 25],
      // Scripts are gates: exit codes are their contract, and `process.exitCode` is used where the
      // event loop should drain; the remaining explicit exits are in hooks (below) by design.
      'n/no-process-exit': 'error',
      // Every script imports vitest/eslint/biome only through package.json — resolution is checked by tsc.
      'n/no-missing-import': 'off',
      'n/no-unpublished-import': 'off',
      'n/no-unsupported-features/node-builtins': ['error', { ignores: ['fetch', 'AbortController'] }],
    },
  },
  {
    name: 'cb/hooks',
    files: HOOKS,
    rules: {
      // A hook answers through stdout and MUST end the process before the client times out —
      // `process.exit` is the protocol here, not a shortcut.
      'n/no-process-exit': 'off',
    },
  },
  {
    name: 'cb/tests',
    files: TESTS,
    rules: {
      // A test may repeat the same string in many cases — readability of the assertion wins.
      'sonarjs/no-duplicate-string': 'off',
      'sonarjs/cognitive-complexity': 'off',
      // Table-driven tests assert in loops and conditionally; the rule would force one `it` per row.
      'vitest/no-conditional-expect': 'off',
      // Test titles are Polish sentences and may be long.
      'vitest/valid-title': 'off',
      // `expect(value, description)` — the description is what Vitest prints when a table row fails.
      'vitest/valid-expect': ['error', { maxArgs: 2 }],
      // A focused or skipped test in a commit is a red gate, not a warning.
      'vitest/no-focused-tests': 'error',
      'vitest/no-disabled-tests': 'error',
    },
  },
  // ── Module boundaries (last, and complete per layer) ──────────────────────────────────────
  boundary('cb/boundary-default', APP_CODE, [DEEP_IMPORTS, MATERIAL]),
  boundary('cb/boundary-ui', ['libs/*/ui*/**/*.ts'], [DEEP_IMPORTS, MATERIAL, NO_FEATURE_OR_DATA]),
  boundary('cb/boundary-shared-ui', ['libs/shared/ui*/**/*.ts'], [DEEP_IMPORTS, NO_FEATURE_OR_DATA]),
  boundary('cb/boundary-util', ['libs/*/util*/**/*.ts'], [DEEP_IMPORTS, MATERIAL, UTIL_ONLY]),
  boundary('cb/boundary-data-access', ['libs/*/data-access*/**/*.ts'], [DEEP_IMPORTS, MATERIAL, NO_FEATURE_OR_UI]),
];
