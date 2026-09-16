/**
 * oxlint.plugins.mts — WHICH rule sets are enabled and ON WHICH files.
 *
 * This file answers only "which presets". The answer to "which thresholds and which rules are switched
 * off because they are noise in this repository" lives next door, in `oxlint.rules.mts`. The split is
 * deliberate: a plugin's preset changes with its version and does not belong to us; the tuning is a
 * team decision and carries a comment per rule.
 *
 * Two kinds of plugin:
 *   - NATIVE (eslint core, typescript, unicorn, import, promise, vitest) — implemented in Rust by oxlint,
 *     no npm package. Presets of packages installed anyway (`@eslint/js`, `typescript-eslint`) are READ
 *     from them, so a bump moves the rule list without an edit here; the others are written out below.
 *   - JS plugins (sonarjs, regexp, security, n, eslint-comments, playwright) — the ESLint plugin itself,
 *     loaded by oxlint (`jsPlugins`, alpha). Their presets are read from the package. `n` is one of them
 *     although oxlint has a native `node` plugin: that one carries one rule of the fourteen in the preset.
 *
 * A preset rule oxlint does not have makes oxlint REFUSE the config ("Rule 'x' not found") — loud on
 * purpose. Such rules are listed in `NOT_IN_OXLINT` with the reason; the module throws when an entry
 * there is no longer in any preset, so the list cannot rot.
 */
import comments from '@eslint-community/eslint-plugin-eslint-comments/configs';
import js from '@eslint/js';
import n from 'eslint-plugin-n';
import playwright from 'eslint-plugin-playwright';
import regexp from 'eslint-plugin-regexp';
import security from 'eslint-plugin-security';
import sonarjs from 'eslint-plugin-sonarjs';
import tseslint from 'typescript-eslint';

type Severity = 'off' | 'warn' | 'error';
export type Rules = Record<string, Severity | [Severity, ...unknown[]]>;
type Preset = { rules?: Rules } | { rules?: Rules }[];
/** One entry of `overrides`. */
export type Layer = {
  files: string[];
  rules: Rules;
  plugins: string[];
  jsPlugins: string[];
  env?: Record<string, boolean>;
};

/** Code files — never `.html` (oxlint does not parse Angular templates; ESLint lints them). */
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

/** Rule prefix → the plugin that provides it: a native plugin name, or the package loaded as a JS plugin. */
const NATIVE_PLUGINS = new Set(['typescript', 'unicorn', 'import', 'promise', 'vitest']);
const JS_PLUGINS: Record<string, string> = {
  sonarjs: 'eslint-plugin-sonarjs',
  regexp: 'eslint-plugin-regexp',
  security: 'eslint-plugin-security',
  n: 'eslint-plugin-n',
  playwright: 'eslint-plugin-playwright',
  '@eslint-community/eslint-comments': '@eslint-community/eslint-plugin-eslint-comments',
};

/**
 * An override whose `plugins` and `jsPlugins` are DERIVED from its rule names. Not a convenience:
 * once any override loads a JS plugin, oxlint 1.83 ignores the options a later override gives a native
 * rule unless that override enables the rule's plugin as well (`vitest/valid-expect` fell back to
 * `maxArgs: 1`). Deriving the lists makes that impossible to forget.
 */
export function layer(files: string[], rules: Rules, env?: Record<string, boolean>): Layer {
  const plugins = new Set<string>();
  const jsPlugins = new Set<string>();
  for (const name of Object.keys(rules)) {
    if (!name.includes('/')) continue; // ESLint core
    const js = Object.keys(JS_PLUGINS).find((prefix) => name.startsWith(`${prefix}/`));
    const native = [...NATIVE_PLUGINS].find((prefix) => name.startsWith(`${prefix}/`));
    if (js) jsPlugins.add(JS_PLUGINS[js]);
    else if (native) plugins.add(native);
    else throw new Error(`oxlint.plugins.mts: no plugin is known for rule "${name}" — add its prefix`);
  }
  return { files, rules, plugins: [...plugins], jsPlugins: [...jsPlugins], ...(env ? { env } : {}) };
}

/** Preset rules oxlint does not implement, with the reason. */
const NOT_IN_OXLINT: Record<string, string> = {
  'no-dupe-args': 'superseded by strict mode — every file here is an ES module',
  'no-octal': 'superseded by strict mode — every file here is an ES module',
  'no-new-symbol': 'removed in ESLint 9; typescript-eslint still switches it off for TypeScript files',
  'no-return-await': 'deprecated in ESLint; strict-type-checked switches it off in favour of typescript/return-await',
  '@typescript-eslint/no-generated-empty-object-type': 'a typed strict rule oxlint-tsgolint does not have yet',
};
const dropped = new Set<string>();

/** The rules of an ESLint preset (one flat-config object or an array of them), merged in order. */
function presetRules(preset: Preset): Rules {
  const layers = Array.isArray(preset) ? preset : [preset];
  const out: Rules = {};
  for (const [name, value] of Object.entries(Object.assign({}, ...layers.map((entry) => entry.rules ?? {})))) {
    if (name in NOT_IN_OXLINT) dropped.add(name);
    else out[name.replace(/^@typescript-eslint\//u, 'typescript/')] = value as Rules[string];
  }
  return out;
}

export const pluginLayers: Layer[] = [
  // ESLint's own `recommended` — the JavaScript base for every code file.
  layer(CODE, presetRules(js.configs.recommended as Preset)),
  // Root TypeScript configuration files (Vitest, Playwright) — `recommended`, no type information.
  layer(['**/*.mts', 'tools/testing/**/*.ts'], presetRules(tseslint.configs.recommended as Preset)),
  // Applications and libraries: strict + stylistic with type information (oxlint-tsgolint).
  layer(
    APP_CODE,
    presetRules([...tseslint.configs.strictTypeChecked, ...tseslint.configs.stylisticTypeChecked] as Preset),
  ),
  // SonarQube rules: cognitive complexity, identical functions, dead branches, useless jumps —
  // the local lint says what the Sonar server would say.
  layer(CODE, presetRules(sonarjs.configs.recommended as Preset)),
  layer(CODE, presetRules(regexp.configs['flat/recommended'] as Preset)),
  // Every disable needs a reason and a matching enable — a disable without a reason is a rule nobody
  // can remove later, because nobody knows why it was silenced.
  layer(CODE, presetRules(comments.recommended as Preset)),
  // `eslint-plugin-promise` flat/recommended as of 7.3, written out: the plugin is native in oxlint.
  // `no-return-in-finally` is still in oxlint's nursery and runs anyway, because it is named.
  layer(CODE, {
    'promise/always-return': 'error',
    'promise/no-return-wrap': 'error',
    'promise/param-names': 'error',
    'promise/catch-or-return': 'error',
    'promise/no-nesting': 'warn',
    'promise/no-promise-in-callback': 'warn',
    'promise/no-callback-in-promise': 'warn',
    'promise/avoid-new': 'off',
    'promise/no-new-statics': 'error',
    'promise/no-return-in-finally': 'warn',
    'promise/valid-params': 'warn',
  }),
  // A HAND-PICKED set, not `recommended`. The recommended preset forbids `null` (a domain value here),
  // abbreviations (`req`, `env`) and `reduce` — three rules that would force rewriting correct code for
  // no gain. What stays catches real bugs and archaisms.
  layer(CODE, {
    'unicorn/catch-error-name': ['error', { name: 'error' }],
    'unicorn/error-message': 'error',
    'unicorn/explicit-length-check': 'error',
    'unicorn/filename-case': ['error', { case: 'kebabCase' }],
    'unicorn/new-for-builtins': 'error',
    // oxlint's name for eslint-plugin-unicorn's `no-array-push-push`.
    'unicorn/prefer-single-call': 'error',
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
  }),
  // Import hygiene without module resolution: `no-unresolved` and `no-cycle` need a resolver, and
  // module boundaries are enforced by pattern in oxlint.rules.mts.
  layer(CODE, {
    'import/first': 'error',
    'import/newline-after-import': 'error',
    'import/no-duplicates': 'error',
    'import/no-mutable-exports': 'error',
    'import/no-self-import': 'error',
  }),
  // Node-only layers: OWASP patterns and engines-driven feature checks for the repository tooling.
  layer(NODE, presetRules(security.configs.recommended as Preset), { node: true }),
  layer(NODE, presetRules(n.configs['flat/recommended-module'] as Preset)),
  // `@vitest/eslint-plugin` recommended as of 1.6, written out: the plugin is native in oxlint.
  layer(TESTS, {
    'vitest/expect-expect': 'error',
    'vitest/no-commented-out-tests': 'error',
    'vitest/no-conditional-expect': 'error',
    'vitest/no-disabled-tests': 'warn',
    'vitest/no-focused-tests': 'error',
    'vitest/no-identical-title': 'error',
    'vitest/no-import-node-test': 'error',
    'vitest/no-interpolation-in-snapshots': 'error',
    'vitest/no-mocks-import': 'error',
    'vitest/no-standalone-expect': 'error',
    'vitest/no-unneeded-async-expect-function': 'error',
    'vitest/prefer-called-exactly-once-with': 'error',
    'vitest/require-local-test-context-for-concurrent-snapshots': 'error',
    'vitest/valid-describe-callback': 'error',
    'vitest/valid-expect': 'error',
    'vitest/valid-expect-in-promise': 'error',
    'vitest/valid-title': 'error',
  }),
  layer(E2E, presetRules(playwright.configs['flat/recommended'] as Preset)),
];

const stale = Object.keys(NOT_IN_OXLINT).filter((name) => !dropped.has(name));
if (stale.length > 0) {
  throw new Error(`oxlint.plugins.mts: no preset contains ${stale.join(', ')} any more — remove it from NOT_IN_OXLINT`);
}
