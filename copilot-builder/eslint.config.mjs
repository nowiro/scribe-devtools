/**
 * eslint.config.mjs — ONE flat config for the whole repository.
 *
 * Layers, in order (a later layer wins over an earlier one):
 *   1. global ignores — build output, caches, tool output and the two vendored trees
 *      (tools/scribe, tools/browser-inspector), which carry their own gates and are read, not rewritten;
 *   2. the JavaScript base for every code file;
 *   3. typed TypeScript for applications and libraries (strict + stylistic, type information from
 *      the project tsconfigs through the TypeScript project service);
 *   4. Angular: TypeScript rules with inline-template processing, then the template rules with the
 *      accessibility set on `.html`;
 *   5. plugin presets (eslint.plugins.mjs) and — behind them — the team's tuning and the module
 *      boundaries (eslint.rules.mjs).
 *
 * Formatting is Biome's job (biome.jsonc); no formatting rule and no Prettier bridge lives here.
 * `--max-warnings=0` in package.json makes every warning a gate failure — a rule is an error or it
 * is switched off, never a warning nobody has to fix.
 */
import js from '@eslint/js';
import angular from 'angular-eslint';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import { pluginConfigs } from './eslint.plugins.mjs';
import { customRules } from './eslint.rules.mjs';
import { PREFIX } from './tools/scripts/workspace.config.mjs';

/** Selector prefix of every component and directive of this workspace (angular.json → schematics). */

export default defineConfig(
  globalIgnores([
    '**/node_modules/**',
    '**/dist/**',
    '**/out-tsc/**',
    '**/coverage/**',
    '**/.angular/**',
    '**/.cache/**',
    '**/.scribe/**',
    '**/.scribe-devtools/**',
    '**/.mcp-artifacts/**',
    '**/tmp/**',
    '**/playwright-report/**',
    '**/test-results/**',
    'tools/scribe/**',
    'tools/browser-inspector/**',
  ]),
  {
    name: 'cb/js-base',
    files: ['**/*.ts', '**/*.mts', '**/*.js', '**/*.mjs'],
    extends: [js.configs.recommended],
    linterOptions: { reportUnusedDisableDirectives: 'error' },
  },
  {
    name: 'cb/node-globals',
    files: ['tools/**/*.mjs', 'tools/**/*.mts', '*.mjs', '*.mts'],
    languageOptions: { globals: { ...globals.node }, ecmaVersion: 'latest', sourceType: 'module' },
  },
  {
    // Root TypeScript configuration files (Vitest, Playwright) — parsed as TypeScript, no type information.
    name: 'cb/ts-config-files',
    files: ['**/*.mts', 'tools/testing/**/*.ts'],
    extends: [tseslint.configs.recommended],
  },
  {
    name: 'cb/ts-typed',
    files: ['apps/**/*.ts', 'libs/**/*.ts'],
    extends: [tseslint.configs.strictTypeChecked, tseslint.configs.stylisticTypeChecked],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      // Numbers belong in template literals (`http://127.0.0.1:${PORT}`); strict-type-checked forbids
      // them by default, which only ever produces `String(port)` noise.
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      // Angular templates read signals as `count()` — the rule would flag every `protected readonly` field used only there.
      '@typescript-eslint/no-unused-private-class-members': 'off',
    },
  },
  {
    name: 'cb/angular-ts',
    files: ['apps/**/*.ts', 'libs/**/*.ts'],
    extends: [angular.configs.tsRecommended],
    processor: angular.processInlineTemplates,
    rules: {
      '@angular-eslint/directive-selector': ['error', { type: 'attribute', prefix: PREFIX, style: 'camelCase' }],
      '@angular-eslint/component-selector': ['error', { type: 'element', prefix: PREFIX, style: 'kebab-case' }],
      '@angular-eslint/prefer-on-push-component-change-detection': 'error',
      // A component or directive is a decorated class that may legitimately have no members.
      '@typescript-eslint/no-extraneous-class': ['error', { allowWithDecorator: true }],
      '@angular-eslint/prefer-standalone': 'error',
      '@angular-eslint/prefer-signals': 'error',
      '@angular-eslint/prefer-inject': 'error',
      '@angular-eslint/no-async-lifecycle-method': 'error',
      '@angular-eslint/use-lifecycle-interface': 'error',
    },
  },
  {
    name: 'cb/angular-templates',
    files: ['apps/**/*.html', 'libs/**/*.html'],
    extends: [angular.configs.templateRecommended, angular.configs.templateAccessibility],
    rules: {
      '@angular-eslint/template/prefer-control-flow': 'error',
      '@angular-eslint/template/prefer-self-closing-tags': 'error',
      '@angular-eslint/template/button-has-type': 'error',
      '@angular-eslint/template/no-negated-async': 'error',
      '@angular-eslint/template/prefer-ngsrc': 'error',
    },
  },
  ...pluginConfigs,
  ...customRules,
);
