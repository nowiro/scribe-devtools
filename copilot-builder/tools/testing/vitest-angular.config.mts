// vitest-angular.config.mts — the shared Vitest configuration of every Angular project, referenced
// from angular.json as `test.options.runnerConfig` (written there by `npm run new:app` / `new:lib`).
//
// The Angular unit-test builder owns `test.projects` and `test.include` (it overrides them); this
// file carries what the builder leaves to the team: the coverage contract and the reporters CI reads.
// Thresholds are the Definition of Done for libraries and applications alike — a project below them
// is red, not "noted". Raise them, never lower them, and never per project without an ADR.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  cacheDir: '.cache/vite',
  test: {
    reporters: process.env.CI ? ['default', 'junit'] : ['default'],
    outputFile: { junit: 'reports/junit-angular.xml' },
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'lcov', 'cobertura'],
      reportsDirectory: 'coverage/angular',
      exclude: [
        '**/*.spec.ts',
        '**/main.ts',
        '**/app.config.ts',
        '**/app.routes.ts',
        '**/public-api.ts',
        '**/index.ts',
      ],
      thresholds: { lines: 80, functions: 80, branches: 80, statements: 80 },
    },
  },
});
