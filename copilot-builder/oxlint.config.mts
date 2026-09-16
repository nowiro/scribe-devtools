/**
 * oxlint.config.mts — THE linter configuration for every code file of the repository.
 *
 * Layers, in order (a later override wins over an earlier one):
 *   1. options and ignores — build output, caches, tool output and the two vendored trees
 *      (tools/alm, tools/browser-inspector), which carry their own gates and are read, not rewritten;
 *   2. plugin presets (oxlint.plugins.mts): ESLint core, TypeScript (typed for applications and
 *      libraries), SonarJS, regexp, promise, unicorn, import, security, n, vitest, playwright;
 *   3. the team's tuning and the module boundaries (oxlint.rules.mts).
 *
 * What oxlint does NOT lint is Angular: it has no template parser, neither for `.html` nor for the
 * inline `template:` of a component. Those rules (angular-eslint) stay in eslint.config.mjs, and
 * `npm run lint` runs both, oxlint first. Formatting is oxfmt's job (.oxfmtrc.jsonc).
 *
 * `denyWarnings` makes every warning a gate failure — a rule is an error or it is switched off, never
 * a warning nobody has to fix. `typeAware` runs the typed TypeScript rules through oxlint-tsgolint.
 */
import { defineConfig } from 'oxlint';
import { pluginLayers } from './oxlint.plugins.mts';
import { tuningLayers } from './oxlint.rules.mts';

export default defineConfig({
  // Every plugin is enabled per file set in the layers; nothing is on for a file no layer names.
  plugins: [],
  categories: { correctness: 'off' },
  options: { typeAware: true, denyWarnings: true, reportUnusedDisableDirectives: 'error' },
  // Anchored like .gitignore: `coverage`, `out-tsc`, `tmp`, `test-results` and `playwright-report` are
  // written only at the repository root, while the same words are ordinary feature-folder names inside
  // `src/` — ignored at every depth, such a folder would never be linted.
  ignorePatterns: [
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
    'tools/alm/**',
    'tools/browser-inspector/**',
  ],
  overrides: [...pluginLayers, ...tuningLayers],
});
