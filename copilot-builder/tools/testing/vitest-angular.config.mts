// vitest-angular.config.mts — the shared Vitest configuration of every Angular project, referenced
// from angular.json as `test.options.runnerConfig` (written there by `npm run new:app` / `new:lib`).
//
// The Angular unit-test builder owns `test.projects` and `test.include` (it overrides them) and
// writes coverage to `coverage/<project>/` when this file names no `reportsDirectory` — so it must
// not, or every project would overwrite the previous one. The junit file is per project too:
// tools/scripts/affected.mjs sets CB_PROJECT before each `ng test`. Thresholds are the Definition of
// Done for libraries and applications alike — a project below them is red, not "noted". Raise them,
// never lower them, and never per project without an ADR.
import { defineConfig } from 'vitest/config';

const project = process.env.CB_PROJECT ?? 'angular';

export default defineConfig({
  cacheDir: '.cache/vite',
  test: {
    reporters: process.env.CI ? ['default', 'junit'] : ['default'],
    outputFile: { junit: `reports/junit-${project}.xml` },
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'lcov', 'cobertura'],
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
