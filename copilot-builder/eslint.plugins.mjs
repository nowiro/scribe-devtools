/**
 * eslint.plugins.mjs — WHICH plugins are enabled and ON WHICH files.
 *
 * This file answers only "which presets". The answer to "which thresholds and which rules are switched
 * off because they are noise in this repository" lives next door, in `eslint.rules.mjs`. The split is
 * deliberate: a plugin's preset changes with its version and does not belong to us; the tuning is a
 * team decision and carries a comment per rule. Kept together, the decisions would vanish between the
 * lines of somebody else's list.
 *
 * Every preset is scoped with `files`. Without it a preset also reaches Angular `.html` templates,
 * whose AST is different — rules written for JavaScript throw on it instead of reporting.
 */
import comments from '@eslint-community/eslint-plugin-eslint-comments/configs';
import vitest from '@vitest/eslint-plugin';
import importX from 'eslint-plugin-import-x';
import n from 'eslint-plugin-n';
import playwright from 'eslint-plugin-playwright';
import promise from 'eslint-plugin-promise';
import regexp from 'eslint-plugin-regexp';
import security from 'eslint-plugin-security';
import sonarjs from 'eslint-plugin-sonarjs';
import unicorn from 'eslint-plugin-unicorn';

/** Code files — never `.html`. */
export const CODE = ['**/*.ts', '**/*.mts', '**/*.js', '**/*.mjs'];
/** Unit tests of applications, libraries and tooling. */
export const TESTS = ['**/*.spec.ts', '**/*.test.ts', '**/*.spec.mjs'];
/** Playwright end-to-end projects (`apps/<app>-e2e`). */
export const E2E = ['apps/*-e2e/**/*.ts'];
/** Node code: repository tooling, hooks and root configuration files. */
export const NODE = ['tools/**/*.mjs', 'tools/**/*.mts', '*.mjs', '*.mts'];
/** Angular application and library sources. */
export const APP_CODE = ['apps/**/*.ts', 'libs/**/*.ts'];
/** Agent hooks — the one place `process.exit` is the right tool. */
export const HOOKS = ['tools/hooks/**/*.mjs'];

/** A plugin preset narrowed to a file list; `name` makes `eslint --print-config` readable. */
const scoped = (files, name, config) => ({ ...config, files, name });

export const pluginConfigs = [
  // SonarQube rules: cognitive complexity, identical functions, dead branches, useless jumps —
  // the local lint says what the Sonar server would say.
  scoped(CODE, 'cb/sonarjs', sonarjs.configs.recommended),
  scoped(CODE, 'cb/promise', promise.configs['flat/recommended']),
  scoped(CODE, 'cb/regexp', regexp.configs['flat/recommended']),
  // Every eslint-disable needs a reason and a matching enable — a disable without a reason is a
  // rule nobody can remove later, because nobody knows why it was silenced.
  scoped(CODE, 'cb/comments', comments.recommended),
  {
    // A HAND-PICKED set, not `recommended`. The recommended preset forbids `null` (a domain value
    // here), abbreviations (`req`, `env`) and `reduce` — three rules that would force rewriting
    // correct code for no gain. What stays catches real bugs and archaisms.
    name: 'cb/unicorn',
    files: CODE,
    plugins: { unicorn },
    rules: {
      'unicorn/catch-error-name': ['error', { name: 'error' }],
      'unicorn/error-message': 'error',
      'unicorn/explicit-length-check': 'error',
      'unicorn/filename-case': ['error', { case: 'kebabCase' }],
      'unicorn/new-for-builtins': 'error',
      'unicorn/no-array-push-push': 'error',
      'unicorn/no-instanceof-builtins': 'error',
      'unicorn/no-lonely-if': 'error',
      'unicorn/no-new-array': 'error',
      'unicorn/no-typeof-undefined': 'error',
      'unicorn/no-unnecessary-await': 'error',
      'unicorn/no-useless-fallback-in-spread': 'error',
      'unicorn/no-useless-promise-resolve-reject': 'error',
      'unicorn/no-useless-spread': 'error',
      'unicorn/no-zero-fractions': 'error',
      'unicorn/prefer-array-find': 'error',
      'unicorn/prefer-array-flat-map': 'error',
      'unicorn/prefer-array-index-of': 'error',
      'unicorn/prefer-array-some': 'error',
      'unicorn/prefer-date-now': 'error',
      'unicorn/prefer-default-parameters': 'error',
      'unicorn/prefer-includes': 'error',
      'unicorn/prefer-node-protocol': 'error',
      'unicorn/prefer-number-properties': 'error',
      'unicorn/prefer-optional-catch-binding': 'error',
      'unicorn/prefer-regexp-test': 'error',
      'unicorn/prefer-set-has': 'error',
      'unicorn/prefer-string-slice': 'error',
      'unicorn/prefer-string-starts-ends-with': 'error',
      'unicorn/prefer-string-trim-start-end': 'error',
      'unicorn/throw-new-error': 'error',
    },
  },
  {
    // Import hygiene without module resolution: `no-unresolved` and `no-cycle` need a resolver, and
    // module boundaries are enforced by pattern in eslint.rules.mjs, so no resolver is installed.
    name: 'cb/import-x',
    files: CODE,
    plugins: { 'import-x': importX },
    rules: {
      'import-x/first': 'error',
      'import-x/newline-after-import': 'error',
      'import-x/no-duplicates': 'error',
      'import-x/no-mutable-exports': 'error',
      'import-x/no-self-import': 'error',
    },
  },
  // Node-only layers: OWASP patterns and engines-driven feature checks for the repository tooling.
  scoped(NODE, 'cb/security', security.configs.recommended),
  scoped(NODE, 'cb/n', n.configs['flat/recommended-module']),
  // Test layers.
  scoped(TESTS, 'cb/vitest', vitest.configs.recommended),
  scoped(E2E, 'cb/playwright', playwright.configs['flat/recommended']),
];
