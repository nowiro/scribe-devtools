/**
 * eslint.config.mjs — ANGULAR ONLY. Every other rule of the repository lives in oxlint.config.mts.
 *
 * ESLint stays for the one thing oxlint cannot do: it has no Angular template parser, so the
 * angular-eslint rules for `.html` templates and for the inline `template:` of a component
 * (`processInlineTemplates`) run here. Nothing else does — no JavaScript base, no typescript-eslint
 * rule set, no plugin presets — so the two linters never hold two opinions about one line, and
 * `eslint-plugin-oxlint` (which switches off the overlap) is not needed.
 *
 * Layers, in order (a later layer wins over an earlier one):
 *   1. global ignores — build output, caches, tool output and the two vendored trees;
 *   2. Angular TypeScript rules with inline-template processing (typescript-eslint is the parser only);
 *   3. template rules with the accessibility set on `.html`.
 *
 * Formatting is oxfmt's job (.oxfmtrc.jsonc). `--max-warnings=0` in package.json makes every warning
 * a gate failure — a rule is an error or it is switched off, never a warning nobody has to fix.
 */
import angular from 'angular-eslint';
import { defineConfig, globalIgnores } from 'eslint/config';
import { PREFIX } from './tools/scripts/workspace.config.mjs';

export default defineConfig(
  globalIgnores([
    // Anchored exactly like .gitignore, and for the same reason: `coverage`, `out-tsc`, `tmp`,
    // `test-results` and `playwright-report` are written only at the repository root, while the same
    // words are ordinary feature-folder names inside `src/`. Ignoring them at every depth left
    // `apps/<app>/src/app/tmp/**` unlinted forever while `affected lint` still reported `ok`.
    '**/node_modules/**',
    '**/dist/**',
    'out-tsc/**',
    'coverage/**',
    '**/.angular/**',
    '**/.cache/**',
    '**/.alm/**',
    '**/.browser-inspector/**',
    '**/.mcp-artifacts/**',
    'tmp/**',
    'playwright-report/**',
    'test-results/**',
    // tools/ is oxlint's alone (no Angular in it), vendored trees included.
    'tools/**',
  ]),
  {
    name: 'cb/angular-ts',
    files: ['apps/**/*.ts', 'libs/**/*.ts'],
    extends: [angular.configs.tsRecommended],
    processor: angular.processInlineTemplates,
    linterOptions: { reportUnusedDisableDirectives: 'error' },
    rules: {
      '@angular-eslint/directive-selector': ['error', { type: 'attribute', prefix: PREFIX, style: 'camelCase' }],
      '@angular-eslint/component-selector': ['error', { type: 'element', prefix: PREFIX, style: 'kebab-case' }],
      '@angular-eslint/prefer-on-push-component-change-detection': 'error',
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
);
