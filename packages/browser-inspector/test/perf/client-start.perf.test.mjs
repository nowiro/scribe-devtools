// Opt-in (BI_PERF=1): the client's start budget (DESIGN.md §2.4, AC-13). Median of 5 spawns of
// `bi help` ≤ 120 ms — the design counts the client at 72 ms, the threshold leaves room for a
// loaded machine without making the gate a coin toss (a single run under Defender is not a signal).
import { describe, expect, it } from 'vitest';

import { bi, cleanup, makeEnv } from '../fixtures/keeper-harness.mjs';

const BUDGET_MS = Number(process.env.BI_PERF_CLIENT_MS ?? 120);

describe('client start', () => {
  it(`\`bi help\` median of 5 ≤ ${String(BUDGET_MS)} ms`, async () => {
    const h = makeEnv();
    try {
      // One warm-up: the first spawn after a build pays the OS file cache, not the client.
      await bi(['help'], h);
      const samples = [];
      for (let i = 0; i < 5; i += 1) {
        const r = await bi(['help'], h);
        expect(r.code).toBe(0);
        samples.push(r.ms);
      }
      samples.sort((a, b) => a - b);
      const median = samples[2];
      process.stdout.write(
        `bi help: ${samples.join(' ')} ms → median ${String(median)} ms (budget ${String(BUDGET_MS)})\n`,
      );
      expect(median).toBeLessThanOrEqual(BUDGET_MS);
    } finally {
      cleanup(h);
    }
  }, 30000);
});
