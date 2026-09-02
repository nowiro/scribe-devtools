// vitest.config.mts — ONE runner, several projects, because the test kinds have opposite
// cost profiles and must be selectable by name from the gates:
//
//   unit    — pure functions on a FakePage, milliseconds, run on every `npm test`;
//   scripts — the repository's own tooling (CODE-INDEX generator, docs generator);
//   bench   — the benchmark harness' self-tests (pin of @playwright/mcp, token counting);
//   smoke   — ONE real Chrome/Edge through fixtures served by node:http (`npm run smoke`,
//             last step of `npm run verify`; `BI_SKIP_SMOKE=1` only on a machine without a browser);
//   compat  — spawns bin/bi.mjs on the app-factory config fixture and reads report.json
//             with a copy of evaluateReports() — the drop-in guarantee;
//   perf    — opt-in via `BI_PERF=1`: timing assertions are flaky on a loaded machine and must
//             never turn a red gate into a coin toss.
//
// Include patterns are globs, never lists of names — an enumerating list silently runs zero tests
// for a module added later (a real bug in the repository this one is ported from).
//
// Tests live under `packages/*/test/` (DESIGN.md §8), the tooling tests next to their scripts.
import { defineConfig } from 'vitest/config';

const perf = process.env.BI_PERF === '1' || process.env.BI_PERF === 'true';

const node = (name: string, include: string[], exclude: string[] = []) => ({
  test: {
    name,
    include,
    exclude: ['**/node_modules/**', '**/dist/**', ...exclude],
    environment: 'node' as const,
  },
});

export default defineConfig({
  test: {
    projects: [
      node(
        'unit',
        ['packages/**/test/**/*.test.mjs'],
        ['packages/**/test/smoke/**', 'packages/**/test/compat/**', 'packages/**/test/perf/**'],
      ),
      node('scripts', ['scripts/**/*.test.mjs']),
      node('bench', ['bench/**/*.test.mjs'], ['bench/app/**', 'bench/out/**', 'bench/probes/**']),
      node('smoke', ['packages/**/test/smoke/**/*.test.mjs']),
      node('compat', ['packages/**/test/compat/**/*.test.mjs']),
      ...(perf ? [node('perf', ['packages/**/test/perf/**/*.perf.test.mjs'])] : []),
    ],
    // The scaffold ships before the first unit test exists and `npm run smoke` runs in a tree
    // without smoke tests until WP2 — an empty project is a stage of the plan, not a failure.
    passWithNoTests: true,
    reporters: ['default'],
  },
});
