// The scrub plan is a pure function of the lane's state (DESIGN.md §2.3): one origin, four origins,
// popups, a crash — and never a navigation to about:blank or a new tab without a crash.
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_VIEWPORT,
  GEN_MARKER,
  GEN_SCRIPT,
  SCRUB_STORAGE_TYPES,
  clearableOrigins,
  needsFreshContext,
  scrubPlan,
} from '../src/isolation.mjs';

const lane = { page: 'laneTab', isLaneTab: true };
/** @param {Partial<import('../src/types.js').LaneState>} patch */
const state = (patch = {}) => ({
  pages: [lane],
  crashed: false,
  currentOrigin: 'http://localhost:4313',
  visitedOrigins: ['http://localhost:4313'],
  generation: 40,
  ...patch,
});

describe('scrubPlan', () => {
  it('one origin: storage in place, new generation, clear the origin, reset the context and the history', () => {
    expect(scrubPlan(state())).toEqual([
      { op: 'domStorageClear', origin: 'http://localhost:4313' },
      { op: 'setGeneration', generation: 41 },
      { op: 'clearOrigin', origin: 'http://localhost:4313', storageTypes: SCRUB_STORAGE_TYPES },
      { op: 'resetContext', viewport: { width: 1280, height: 720 }, dialogs: 'dismiss' },
      { op: 'resetNavigationHistory' },
    ]);
  });

  it('four origins: one clearOrigin per visited origin, deduplicated, current origin included', () => {
    const plan = scrubPlan(
      state({
        currentOrigin: 'http://localhost:4314',
        visitedOrigins: [
          'http://localhost:4311',
          'http://localhost:4312',
          'http://localhost:4312',
          'http://localhost:4313',
          'http://localhost:4314',
        ],
      }),
    );
    const cleared = plan.filter((op) => op.op === 'clearOrigin').map((op) => /** @type {any} */ (op).origin);
    expect(cleared).toEqual([
      'http://localhost:4311',
      'http://localhost:4312',
      'http://localhost:4313',
      'http://localhost:4314',
    ]);
    expect(plan[0]).toEqual({ op: 'domStorageClear', origin: 'http://localhost:4314' });
    expect(plan.at(-1)).toEqual({ op: 'resetNavigationHistory' });
  });

  it('popups are closed first, one op per page that is not the lane tab', () => {
    const plan = scrubPlan(
      state({ pages: [lane, { page: 'popup1', isLaneTab: false }, { page: 'popup2', isLaneTab: false }] }),
    );
    expect(plan.slice(0, 2)).toEqual([
      { op: 'closePage', page: 'popup1', reason: 'popup' },
      { op: 'closePage', page: 'popup2', reason: 'popup' },
    ]);
    expect(plan.filter((op) => op.op === 'closePage')).toHaveLength(2);
  });

  it('a crashed renderer gets a new tab instead of in-place storage and history ops', () => {
    const plan = scrubPlan(state({ crashed: true, pages: [lane, { page: 'popup', isLaneTab: false }] }));
    expect(plan.map((op) => op.op)).toEqual(['closePage', 'newTab', 'setGeneration', 'clearOrigin', 'resetContext']);
    expect(plan[1]).toEqual({ op: 'newTab', reason: 'crash' });
    expect(plan.some((op) => op.op === 'domStorageClear')).toBe(false);
    expect(plan.some((op) => op.op === 'resetNavigationHistory')).toBe(false);
  });

  it('never navigates: no about:blank, no goto, no newTab without a crash', () => {
    for (const s of [state(), state({ visitedOrigins: [] }), state({ currentOrigin: null, visitedOrigins: [] })]) {
      const plan = scrubPlan(s);
      expect(JSON.stringify(plan)).not.toContain('about:blank');
      expect(plan.some((op) => /** @type {string} */ (op.op) === 'goto')).toBe(false);
      expect(plan.some((op) => op.op === 'newTab')).toBe(false);
    }
  });

  it('a tab on about:blank (nothing visited) still swaps the generation and resets the context', () => {
    expect(scrubPlan(state({ currentOrigin: null, visitedOrigins: [], generation: 0 }))).toEqual([
      { op: 'setGeneration', generation: 1 },
      { op: 'resetContext', viewport: { width: 1280, height: 720 }, dialogs: 'dismiss' },
      { op: 'resetNavigationHistory' },
    ]);
  });

  it('carries a custom default viewport and copies it (no shared object)', () => {
    const viewport = { width: 800, height: 600 };
    const op = /** @type {any} */ (scrubPlan(state({ viewport })).find((o) => o.op === 'resetContext'));
    expect(op.viewport).toEqual(viewport);
    expect(op.viewport).not.toBe(viewport);
    expect(DEFAULT_VIEWPORT).toEqual({ width: 1280, height: 720 });
  });
});

describe('clearableOrigins', () => {
  it('keeps http(s) origins once, in order, and drops the rest', () => {
    expect(
      clearableOrigins([
        'http://a',
        'null',
        'about:blank',
        'file://',
        undefined,
        null,
        'https://b',
        'http://a',
        'data:x',
      ]),
    ).toEqual(['http://a', 'https://b']);
  });
});

describe('GEN_SCRIPT', () => {
  it('clears sessionStorage once per generation and marks it under __bi_gen', () => {
    const script = GEN_SCRIPT(41);
    expect(script).toContain(`"${GEN_MARKER}"`);
    expect(script).toContain('"41"');
    expect(script).toContain('s.clear()');
    expect(GEN_SCRIPT(42)).not.toBe(script);
    // It must be a valid, self-contained program: no reference to anything but window.sessionStorage.
    expect(() => new Function(script)).not.toThrow();
  });
});

describe('needsFreshContext', () => {
  it('follows DESIGN.md: isolation fresh, auth/storageState, video, or --fresh', () => {
    expect(needsFreshContext({})).toBe(false);
    expect(needsFreshContext({ isolation: 'reuse' })).toBe(false);
    expect(needsFreshContext({ isolation: 'fresh' })).toBe(true);
    expect(needsFreshContext({ video: true })).toBe(true);
    expect(needsFreshContext({ storageState: 'auth.json' })).toBe(true);
    expect(needsFreshContext({}, { fresh: true })).toBe(true);
    expect(needsFreshContext({}, { auth: { storageState: 'x' } })).toBe(true);
    expect(needsFreshContext({ auth: false }, { auth: { storageState: 'x' } })).toBe(false);
    expect(needsFreshContext({ auth: true })).toBe(true);
  });
});
