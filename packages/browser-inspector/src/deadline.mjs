// deadline.mjs — `withDeadline` and `degradeTo`, ported from the TypeScript browser-inspector.
//
// `page.evaluate` (and everything built on it) has NO timeout of its own, so a page whose main
// thread a step left spinning would otherwise hang the run forever — no report, no manifest,
// `browser.close()` never reached. Playwright cannot cancel the underlying call; the runaway
// script dies with the tab at scrub time, which the deadline lets the run actually reach. In `bi`
// every step, the final evidence and the CDP `Runtime.evaluate` (whose own `timeout` interrupts
// only the synchronous part — a pending promise is not covered) ride through here.

export class DeadlineError extends Error {
  /** @param {string} label @param {number} ms */
  constructor(label, ms) {
    super(`${label} timed out after ${String(ms)}ms`);
    this.name = 'DeadlineError';
    this.code = 'E_DEADLINE';
    this.label = label;
    this.ms = ms;
  }
}

/**
 * Race a promise against a hard deadline. The timer is always cleared — a dangling timer kept the
 * client process alive after the answer had been printed.
 * @template T
 * @param {Promise<T>} promise
 * @param {number} ms
 * @param {string} label names the operation in the error (`evaluate "krok-po"`)
 * @returns {Promise<T>}
 */
export async function withDeadline(promise, ms, label) {
  /** @type {NodeJS.Timeout | undefined} */
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new DeadlineError(label, ms)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * `withDeadline` with a silent fallback — the final-evidence policy in ONE place: a capture that
 * cannot complete degrades to its empty shape instead of failing a report whose whole job is
 * documenting a broken page. Restating the policy per capture is how one copy drifts.
 * @template T
 * @param {T} fallback
 * @param {Promise<T>} promise
 * @param {number} ms
 * @param {string} label
 * @returns {Promise<T>}
 */
export async function degradeTo(fallback, promise, ms, label) {
  try {
    return await withDeadline(promise, ms, label);
  } catch {
    return fallback;
  }
}

/** @param {unknown} error */
export const isDeadline = (error) => error instanceof DeadlineError;
