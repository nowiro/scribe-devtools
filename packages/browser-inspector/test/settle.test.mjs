// `settled` = load + a quiet window without in-flight requests, capped, never failing (DESIGN.md §2.2).
import { describe, expect, it } from 'vitest';

import { CAP_MS_DEFAULT, QUIET_MS_DEFAULT, waitSettled } from '../src/settle.mjs';

/** A clock and a sleep that advance together, so the wait is deterministic and instant. */
function fakeClock() {
  let t = 0;
  return {
    now: () => t,
    sleep: async (/** @type {number} */ ms) => {
      t += ms;
    },
    advance: (/** @type {number} */ ms) => {
      t += ms;
    },
  };
}

describe('waitSettled', () => {
  it('defaults are the DESIGN numbers: 100 ms quiet, 2000 ms cap', () => {
    expect(QUIET_MS_DEFAULT).toBe(100);
    expect(CAP_MS_DEFAULT).toBe(2000);
  });

  it('settles after quietMs with nothing in flight', async () => {
    const clock = fakeClock();
    const result = await waitSettled(null, { inFlight: 0 }, { quietMs: 100, capMs: 2000, ...clock });
    expect(result.settled).toBe(true);
    expect(result.ms).toBeGreaterThanOrEqual(100);
    expect(result.ms).toBeLessThan(200);
  });

  it('waits for the in-flight counter to drop, then a full quiet window', async () => {
    const clock = fakeClock();
    const recorder = { inFlight: 1 };
    // The request finishes at t = 300 ms.
    const sleep = async (/** @type {number} */ ms) => {
      await clock.sleep(ms);
      if (clock.now() >= 300) recorder.inFlight = 0;
    };
    const result = await waitSettled(null, recorder, { quietMs: 100, capMs: 2000, now: clock.now, sleep });
    expect(result.settled).toBe(true);
    expect(result.ms).toBeGreaterThanOrEqual(400);
    expect(result.ms).toBeLessThan(450);
  });

  it('a request in the middle of the quiet window restarts it', async () => {
    const clock = fakeClock();
    const recorder = { inFlight: 0 };
    let fired = false;
    const sleep = async (/** @type {number} */ ms) => {
      await clock.sleep(ms);
      if (!fired && clock.now() >= 50) {
        recorder.inFlight = 1;
        fired = true;
      }
      if (fired && clock.now() >= 200) recorder.inFlight = 0;
    };
    const result = await waitSettled(null, recorder, { quietMs: 100, capMs: 2000, now: clock.now, sleep });
    expect(result.settled).toBe(true);
    expect(result.ms).toBeGreaterThanOrEqual(300);
  });

  it('never fails: a page that polls forever settles at the cap with settled: false', async () => {
    const clock = fakeClock();
    const result = await waitSettled(null, { inFlight: 1 }, { quietMs: 100, capMs: 500, ...clock });
    expect(result.settled).toBe(false);
    expect(result.ms).toBeGreaterThanOrEqual(500);
    expect(result.ms).toBeLessThan(520);
  });

  it('waits for load first when given a page, and swallows a load timeout', async () => {
    const calls = [];
    const page = {
      waitForLoadState: async (/** @type {string} */ state, /** @type {any} */ opts) => {
        calls.push([state, opts]);
        throw new Error('Timeout');
      },
    };
    const clock = fakeClock();
    const result = await waitSettled(/** @type {any} */ (page), { inFlight: 0 }, { quietMs: 10, capMs: 100, ...clock });
    expect(calls).toEqual([['load', { timeout: 100 }]]);
    expect(result.settled).toBe(true);
  });

  it('uses real timers by default and stays well under networkidle on a quiet page', async () => {
    const started = performance.now();
    const result = await waitSettled(null, { inFlight: 0 }, { quietMs: 30, capMs: 500 });
    expect(result.settled).toBe(true);
    expect(performance.now() - started).toBeLessThan(400);
  });
});
