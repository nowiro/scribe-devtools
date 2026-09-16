// schedule.mjs — which lane a snapshot goes to (DESIGN.md §2.3).
//
// A pure function over the config, deliberately: the alternative — reading the previous run's
// `_manifest.json` for real durations — would make `outputDir` an INPUT of the planner. That
// directory is documented as a dump you may delete at any time, so deleting it would change the
// schedule, a hand-edited manifest would steer it, and CI would run a different plan than the
// developer's machine. A rough estimate that is always available beats an exact one that is not.
//
// The rule is offline LPT (longest processing time first): sort by estimate descending, give each
// snapshot to the least loaded lane. Round-robin (`k % parallel`) put snapshots 0 and 3 on the same
// lane whatever they cost — on the app-factory config that is 4,35 s against a 3,22 s optimum,
// while §2.3 promises "≈ max(lane), not sum(flow)".
//
// What this does NOT change is as important as what it does: the ORDER of results, of
// `_manifest.json.snapshots[]`, of JUnit `<testcase>` and of the value addresses `snapshots[i]` all
// stay the config's, because only the lane NUMBER moves. And the order WITHIN a lane stays the
// config's too — which is what keeps the scrub between two snapshots of one batch inside `scrubMs`
// instead of moving it to `queuedMs` (the property the budget report and the app-factory compat
// gate read).

/**
 * What one snapshot is expected to cost, in arbitrary units that only have to ORDER snapshots
 * correctly. `wait` steps are the one cost known exactly from the config (a `wait 700` sleeps 700 ms
 * whatever the page does); every other step is charged a flat 100. Measured against the app-factory
 * config this ordering lands within 1 % of the optimum computed from real medians — and a
 * "better calibrated" variant (base + networkidle + fullPage surcharges) landed WORSE, which is the
 * honest reason this estimate stays this crude: with six data points the estimators are
 * indistinguishable, and every estimate that puts the two heavy snapshots first wins the same 25 %.
 * @param {{ steps?: readonly Record<string, any>[] }} snapshot
 * @returns {number}
 */
export function estimateSnapshot(snapshot) {
  const steps = Array.isArray(snapshot?.steps) ? snapshot.steps : [];
  let total = 100 * steps.length;
  for (const step of steps) {
    const ms = Number(step?.ms);
    if (step?.do === 'wait' && Number.isFinite(ms) && ms > 0) total += ms;
  }
  return total;
}

// What a snapshot costs a lane before its first step runs: the `goto`, the settle and the final
// evidence, which every snapshot pays. `estimateSnapshot` may leave it out — it only has to ORDER,
// and a constant is invisible to an ordering — but a bin-packer may not: charged 0, a `type: "page"`
// snapshot (which the config schema forbids from having `steps`) never makes a lane the loaded one,
// so `load[i] < load[lane]` is false for every i and all of them land on lane 0. A config of nothing
// but pages — the one `lintConfig` suggests `parallel` for — then ran serially on one lane.
const LANE_BASE_COST = 100;

/**
 * Lane index per snapshot, in the snapshots' own order: `plan[k]` is the lane for `snapshots[k]`.
 * Ties go to the lowest lane index, so a config whose snapshots all look alike gets exactly the
 * round-robin this replaced — every existing assertion about lane numbers survives.
 * @param {readonly Record<string, any>[]} snapshots
 * @param {number} parallel
 * @returns {number[]}
 */
export function planLanes(snapshots, parallel) {
  const lanes = Math.max(1, Math.min(Math.trunc(parallel) || 1, snapshots.length || 1));
  const plan = Array.from({ length: snapshots.length }, () => 0);
  if (lanes === 1) return plan;
  const load = Array.from({ length: lanes }, () => 0);
  const order = snapshots
    .map((snapshot, index) => ({ index, cost: LANE_BASE_COST + estimateSnapshot(snapshot) }))
    // Stable on ties (by index), so the plan is a function of the config and nothing else.
    .sort((a, b) => b.cost - a.cost || a.index - b.index);
  for (const { index, cost } of order) {
    let lane = 0;
    for (let i = 1; i < lanes; i += 1) if (load[i] < load[lane]) lane = i;
    plan[index] = lane;
    load[lane] += cost;
  }
  return plan;
}
