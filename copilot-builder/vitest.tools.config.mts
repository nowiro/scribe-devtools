// vitest.tools.config.mts — ONE runner for everything that is not an Angular project: the tooling
// in tools/scripts and tools/hooks (plain `.mjs`), the dispatcher scripts of tools/scribe (plain
// `.mjs`) and the ALM integrations of tools/scribe (TypeScript). Three projects inside one config,
// so `npm test` runs all of them and there is no second command to forget.
//
// The file is NOT named `vitest.config.mts` on purpose: Angular's unit-test builder looks for a
// Vitest configuration of its own (`runnerConfig` in angular.json, see tools/testing/), and a root
// `vitest.config.*` would be picked up by both runners with two different ideas of `projects`.
//
// Every `include` is a glob, never a list of names — an enumerating list is how a new module gets
// zero tests without a warning.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  cacheDir: '.cache/vite',
  test: {
    projects: [
      {
        test: {
          name: 'tools',
          include: ['tools/scripts/**/*.spec.mjs', 'tools/hooks/**/*.spec.mjs'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'scribe-scripts',
          include: ['tools/scribe/scripts/**/*.spec.mjs'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'scribe-integrations',
          include: ['tools/scribe/integrations/**/*.spec.ts'],
          exclude: ['**/node_modules/**', '**/dist/**'],
          environment: 'node',
        },
      },
    ],
    passWithNoTests: false,
    reporters: ['default'],
    coverage: {
      provider: 'v8',
      reportsDirectory: 'coverage/tools',
      reporter: ['text-summary', 'lcov', 'cobertura'],
      include: [
        'tools/scripts/**/*.mjs',
        'tools/hooks/**/*.mjs',
        'tools/scribe/scripts/**/*.mjs',
        'tools/scribe/integrations/**/*.ts',
      ],
      exclude: ['**/*.spec.*', '**/*.d.ts'],
    },
  },
});
