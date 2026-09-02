// settle.mjs — `waitUntil: "settled"` (DESIGN.md §2.2): `load` + a quiet window with no request in
// flight, capped, and never failing.
//
// `networkidle` costs 500 ms of silence after the LAST request and measured 666–2056 ms on the
// app-factory pages; `settled` asks for 100 ms of silence counted by the recorder that already
// sees every request, so it ends ~400 ms earlier on a page that fetches once. The cap (`settleMs`,
// 2000 by default) is the whole guarantee: a page that polls forever settles at the cap, and the
// wait degrades to `load` instead of failing the step — an animation the wait cannot see is the
// config author's `waitFor`, not this function's problem.

/** @typedef {import('./types.js').PageLike} PageLike */
/** @typedef {import('./types.js').RecorderLike} RecorderLike */

export const QUIET_MS_DEFAULT = 100;
export const CAP_MS_DEFAULT = 2000;
/** Poll interval — a page rarely goes quiet for exactly 100 ms and one extra tick costs 10 ms. */
export const POLL_MS = 10;

/**
 * @param {PageLike | null | undefined} page `null` when the caller already waited for `load`
 * @param {Pick<RecorderLike, 'inFlight'>} recorder
 * @param {{ quietMs?: number, capMs?: number, now?: () => number, sleep?: (ms: number) => Promise<void> }} [options]
 * @returns {Promise<{ settled: boolean, ms: number }>} `settled: false` when the cap ended the wait
 */
export async function waitSettled(page, recorder, options = {}) {
  const quietMs = options.quietMs ?? QUIET_MS_DEFAULT;
  const capMs = options.capMs ?? CAP_MS_DEFAULT;
  const now = options.now ?? (() => performance.now());
  const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const started = now();
  if (page && typeof page.waitForLoadState === 'function') {
    try {
      await page.waitForLoadState('load', { timeout: capMs });
    } catch {
      // `load` never fired within the cap — the quiet window below runs against the same cap.
    }
  }
  let quietSince = recorder.inFlight === 0 ? now() : -1;
  for (;;) {
    const at = now();
    if (recorder.inFlight === 0) {
      if (quietSince < 0) quietSince = at;
      if (at - quietSince >= quietMs) return { settled: true, ms: Math.round(at - started) };
    } else {
      quietSince = -1;
    }
    if (at - started >= capMs) return { settled: false, ms: Math.round(at - started) };
    await sleep(Math.min(POLL_MS, Math.max(1, capMs - (at - started))));
  }
}
