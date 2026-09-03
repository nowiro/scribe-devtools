// Which lane a snapshot goes to (DESIGN.md §2.3). A pure function, so this is a pure test — and it
// has to pin three things at once: that the plan beats round-robin on the config the gate actually
// runs, that it degenerates to round-robin when snapshots look alike (every existing assertion
// about lane numbers depends on that), and that it is a function of the config and nothing else.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { estimateSnapshot, planLanes } from '../src/schedule.mjs';

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');

/** Load per lane for a plan — what the makespan is bounded by. */
const loads = (snapshots, plan, lanes) => {
  const load = new Array(lanes).fill(0);
  snapshots.forEach((s, i) => (load[plan[i]] += estimateSnapshot(s)));
  return load;
};

const roundRobin = (n, lanes) => Array.from({ length: n }, (_, k) => k % lanes);

describe('planLanes', () => {
  it('beats round-robin on the app-factory config and stays within 20 % of the lower bound', () => {
    const config = JSON.parse(readFileSync(path.join(FIXTURES, 'app-factory.config.json'), 'utf8'));
    const snapshots = config.snapshots;
    expect(snapshots).toHaveLength(6);
    const lanes = 3;
    const plan = planLanes(snapshots, lanes);
    const planned = Math.max(...loads(snapshots, plan, lanes));
    const naive = Math.max(...loads(snapshots, roundRobin(snapshots.length, lanes), lanes));
    // Round-robin puts snapshots 0 and 3 on one lane whatever they cost; the two heaviest flows of
    // this config (wizard, bookstore) are exactly 2 and 3.
    expect(planned).toBeLessThan(naive);
    // LPT's guarantee is (4/3 - 1/(3m)) of the optimum, and the optimum is at least sum/m — so this
    // is the tightest bound that is a property of the algorithm rather than of this one fixture.
    const bound = snapshots.reduce((sum, s) => sum + estimateSnapshot(s), 0) / lanes;
    expect(planned).toBeLessThanOrEqual(bound * (4 / 3 - 1 / (3 * lanes)));
    // No lane left idle while another has two flows — the promise of §2.3 is `max(lane)`.
    expect(new Set(plan).size).toBe(lanes);
    // The property that actually buys the 25 %: the two heaviest flows do not share a lane.
    const heaviest = snapshots
      .map((s, i) => ({ i, cost: estimateSnapshot(s) }))
      .sort((a, b) => b.cost - a.cost)
      .slice(0, 2);
    expect(plan[heaviest[0].i]).not.toBe(plan[heaviest[1].i]);
  });

  it('degenerates to round-robin when the snapshots look alike', () => {
    // This is what keeps every existing lane assertion green: equal estimates, ties to the lowest
    // lane index, so the plan is exactly `k % parallel`.
    const same = Array.from({ length: 6 }, () => ({ steps: [{ do: 'wait', ms: 5 }] }));
    expect(planLanes(same, 3)).toEqual(roundRobin(6, 3));
    expect(planLanes(same, 1)).toEqual([0, 0, 0, 0, 0, 0]);
    // The alike-and-FREE variant, which is the whole of `{ "parallel": 3, snapshots: [six pages] }`
    // — the config the `lint-config` hint suggests `parallel` for. A step estimate of 0 is still an
    // equal estimate, so it has to degenerate the same way instead of piling onto lane 0.
    const pages = Array.from({ length: 6 }, () => ({ type: 'page', url: 'http://localhost:4311/' }));
    expect(planLanes(pages, 3)).toEqual(roundRobin(6, 3));
  });

  it('spreads stepless snapshots even when a flow shares the config', () => {
    // A snapshot with no steps is not free — it still pays a goto, a settle and the final evidence —
    // so it must never be the snapshot a lane can take an unbounded number of.
    /** @type {Record<string, any>[]} */
    const snapshots = [
      { steps: [{ do: 'wait', ms: 700 }, { do: 'click' }] },
      { steps: [{ do: 'click' }] },
      ...Array.from({ length: 4 }, () => ({ type: 'page', url: 'http://localhost:4311/' })),
    ];
    const plan = planLanes(snapshots, 3);
    expect(new Set(plan).size).toBe(3);
    const pagesPerLane = [0, 1, 2].map((lane) => plan.filter((l, i) => l === lane && !snapshots[i].steps).length);
    expect(Math.max(...pagesPerLane)).toBeLessThan(4);
  });

  it('is a function of the config alone: same input, same plan, no lane out of range', () => {
    const snapshots = [
      { steps: [{ do: 'wait', ms: 700 }, { do: 'click' }] },
      { steps: [{ do: 'click' }] },
      { steps: [] },
      { steps: [{ do: 'wait', ms: 300 }] },
    ];
    const first = planLanes(snapshots, 2);
    expect(planLanes(snapshots, 2)).toEqual(first);
    expect(first.every((lane) => lane >= 0 && lane < 2)).toBe(true);
    // The heaviest snapshot goes first, so it opens lane 0 and the cheapest tail balances the rest.
    expect(first[0]).toBe(0);
  });

  it('estimates a sleep exactly and everything else flat', () => {
    // `wait ms` is the one cost the config states outright — a `wait 700` sleeps 700 ms whatever the
    // page does. Everything else is charged the same, because the estimate only has to ORDER.
    expect(estimateSnapshot({ steps: [{ do: 'wait', ms: 700 }] })).toBe(800);
    expect(estimateSnapshot({ steps: [{ do: 'click' }, { do: 'fill' }] })).toBe(200);
    expect(estimateSnapshot({ steps: [] })).toBe(0);
    expect(estimateSnapshot({})).toBe(0);
    // A `wait` on a selector, not a sleep: no `ms`, so no surcharge.
    expect(estimateSnapshot({ steps: [{ do: 'wait', selector: '#x' }] })).toBe(100);
  });

  it('never returns more lanes than there are snapshots', () => {
    expect(planLanes([{ steps: [] }], 4)).toEqual([0]);
    expect(new Set(planLanes([{ steps: [{ do: 'wait', ms: 900 }] }, { steps: [] }], 8)).size).toBe(2);
  });
});
