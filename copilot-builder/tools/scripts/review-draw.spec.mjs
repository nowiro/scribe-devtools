import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DRAW_FILE, drawForDirectory, drawSeats, formatDraw, readDraw, reviewPool } from './review-draw.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** @param {string} dir @param {Record<string, string>} seats @param {number} seatsPerReview */
function fakeRegistry(dir, seats, seatsPerReview) {
  mkdirSync(path.join(dir, '.github'), { recursive: true });
  writeFileSync(
    path.join(dir, '.github', 'models-registry.json'),
    JSON.stringify({ review: { seats, seatsPerReview } }),
    'utf8',
  );
}

describe('drawSeats', () => {
  it('draws `count` distinct items and keeps their original order', () => {
    // random(n) → n - 1 swaps each position with the current last element: d comes first, then the a that
    // landed at the end, then b — the sample is {a, b, d}, handed back in the original order.
    expect(drawSeats(['a', 'b', 'c', 'd'], 3, (max) => max - 1)).toEqual(['a', 'b', 'd']);
    // random(n) → 0: the swap keeps the position, so the sample is the head of the list.
    expect(drawSeats(['a', 'b', 'c', 'd'], 2, () => 0)).toEqual(['a', 'b']);
  });

  it('returns everything when count covers the pool, and never repeats an item', () => {
    expect(drawSeats(['a', 'b', 'c'], 3, () => 0)).toEqual(['a', 'b', 'c']);
    for (let run = 0; run < 50; run += 1) {
      const drawn = drawSeats(['a', 'b', 'c', 'd', 'e'], 3);
      expect(new Set(drawn).size).toBe(3);
      expect(drawn).toEqual([...drawn].sort());
    }
  });
});

describe('drawForDirectory', () => {
  /** @type {string} */
  let dir;
  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'cb-review-draw-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('draws from the registry pool, records the draw and reprints it on a second run', () => {
    fakeRegistry(dir, { 'code-reviewer-a': 'alpha', 'code-reviewer-b': 'beta', 'code-reviewer-c': 'gamma' }, 2);
    const run = path.join(dir, 'docs', 'runs', 'x_review-y');
    const first = drawForDirectory(run, { repo: dir, random: () => 0, now: new Date('2026-09-15T10:00:00+02:00') });
    expect(first.recorded).toBe(false);
    expect(first.draw).toEqual({
      drawnAt: '2026-09-15_10-00',
      seatsPerReview: 2,
      pool: ['alpha', 'beta', 'gamma'],
      seats: { 'code-reviewer-a': 'alpha', 'code-reviewer-b': 'beta' },
    });
    expect(readDraw(path.join(run, DRAW_FILE))).toEqual(first.draw);
    expect(JSON.parse(readFileSync(path.join(run, DRAW_FILE), 'utf8'))).toEqual(first.draw);

    // The pool changes and the dice would say otherwise — the recorded draw still wins.
    fakeRegistry(dir, { 'code-reviewer-z': 'zeta', 'code-reviewer-y': 'ypsilon' }, 2);
    const second = drawForDirectory(run, { repo: dir, random: (max) => max - 1 });
    expect(second.recorded).toBe(true);
    expect(second.draw).toEqual(first.draw);
  });

  it('refuses a registry the gate would refuse instead of drawing something', () => {
    fakeRegistry(dir, { 'code-reviewer-a': 'alpha', 'code-reviewer-b': 'beta' }, 3);
    expect(() => drawForDirectory(path.join(dir, 'run'), { repo: dir })).toThrow('A20');
    expect(existsSync(path.join(dir, 'run', DRAW_FILE))).toBe(false);
  });

  it('formats one line per seat, agent padded, family after', () => {
    expect(
      formatDraw({
        drawnAt: '',
        seatsPerReview: 2,
        pool: [],
        seats: { 'code-reviewer-a': 'alpha', 'code-reviewer-bb': 'beta' },
      }),
    ).toBe('code-reviewer-a   alpha\ncode-reviewer-bb  beta\n');
  });
});

describe('reviewPool', () => {
  it('reads the real registry: every seat has a family and seatsPerReview fits the pool', () => {
    const { seats, seatsPerReview } = reviewPool(REPO);
    expect(seats.length).toBeGreaterThanOrEqual(2);
    for (const [seat, family] of seats) {
      expect(seat).toMatch(/^code-reviewer-[a-z0-9-]+$/u);
      expect(family).not.toBe('');
    }
    expect(seatsPerReview).toBeGreaterThanOrEqual(2);
    expect(seatsPerReview).toBeLessThanOrEqual(seats.length);
  });
});
