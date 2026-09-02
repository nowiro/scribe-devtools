// The queues (DESIGN.md §2.5, AC-14): one key serializes and reports `queuedMs`, different keys run
// concurrently — and the two ways a job fails without taking the keeper down: an engine that throws
// mid-run, and a browser that never launches.

import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  runBrowserInspector,
  cleanup,
  fakeLog,
  isAlive,
  keeperLog,
  makeEnv,
  rawRequest,
  readPid,
  stopKeeper,
  until,
  writeConfig,
} from './fixtures/keeper-harness.mjs';

/** @type {ReturnType<typeof makeEnv>[]} */
const harnesses = [];
const fresh = (overrides = {}) => {
  const h = makeEnv(overrides);
  harnesses.push(h);
  return h;
};

afterEach(async () => {
  for (const h of harnesses.splice(0)) {
    await stopKeeper(h);
    cleanup(h);
  }
});

describe('queues', () => {
  it('serializes jobs on one key and reports queuedMs; different keys run concurrently', async () => {
    const h = fresh();
    await runBrowserInspector(['up'], h);
    const t0 = performance.now();
    const [a, b] = await Promise.all([
      rawRequest(h, { argv: ['wait', '300', '--session', 'q'], session: 'q' }),
      rawRequest(h, { argv: ['wait', '300', '--session', 'q'], session: 'q' }),
    ]);
    const serial = performance.now() - t0;
    expect(a.done.exit).toBe(0);
    expect(b.done.exit).toBe(0);
    const queued = [a.done.timing.queuedMs, b.done.timing.queuedMs].sort((x, y) => x - y);
    expect(queued[0]).toBeLessThan(100);
    expect(queued[1]).toBeGreaterThanOrEqual(250);
    expect(serial).toBeGreaterThanOrEqual(580);

    const t1 = performance.now();
    await Promise.all([
      rawRequest(h, { argv: ['wait', '300', '--session', 'a'], session: 'a' }),
      rawRequest(h, { argv: ['wait', '300', '--session', 'b'], session: 'b' }),
    ]);
    expect(performance.now() - t1).toBeLessThan(560);
    expect(fakeLog(h).filter((e) => e.event === 'runCommand')).toHaveLength(4);
  }, 20000);

  it('runs a batch through the keeper: lanes round-robin, first→warm, progress per snapshot', async () => {
    const h = fresh();
    const config = writeConfig(h, [{ name: 'one' }, { name: 'two' }, { name: 'three-fail' }]);
    const first = await runBrowserInspector([config, '--stamp', '2026-09-01_10-00', '--parallel', '2'], h);
    expect(first.code).toBe(0);
    expect(first.lines.filter((l) => /^(ok|FAIL) (one|two|three-fail) · [\d ]+ ms$/u.test(l))).toHaveLength(3);
    expect(first.lines.at(-2)).toMatch(/^FAIL 2\/3 completed · [\d ]+ ms · first · out\/2026-09-01_10-00$/u);
    expect(first.lines.at(-1)).toMatch(
      /^FAIL three-fail · step 1 failed on purpose · out\/2026-09-01_10-00\/three-fail\/report\.md$/u,
    );
    const flows = fakeLog(h).filter((e) => e.event === 'runFlow');
    expect(flows.map((f) => f.lane).sort()).toEqual([0, 0, 1]);
    expect(flows.map((f) => f.address).sort()).toEqual(['snapshots[0]', 'snapshots[1]', 'snapshots[2]']);
    const report = JSON.parse(
      fs.readFileSync(path.join(h.cwd, 'out', '2026-09-01_10-00', 'one', 'report.json'), 'utf8'),
    );
    expect(report.timing.mode).toBe('first');
    // The run manifest is the keeper's (DESIGN §5): one entry per snapshot with the lane and the
    // failure, `timing.mode` of the run, spawn→listen as `keeperStartMs` on a first run.
    const manifest = JSON.parse(fs.readFileSync(path.join(h.cwd, 'out', '2026-09-01_10-00', '_manifest.json'), 'utf8'));
    expect(manifest.stamp).toBe('2026-09-01_10-00');
    expect(manifest.timing.mode).toBe('first');
    expect(manifest.timing.keeperStartMs).toBeGreaterThanOrEqual(0);
    expect(manifest.snapshots.map((s) => [s.name, s.completed, s.lane])).toEqual([
      ['one', true, 0],
      ['two', true, 1],
      ['three-fail', false, 0],
    ]);
    expect(manifest.snapshots[2].failure).toBe('step 1 failed on purpose');
    expect(manifest.snapshots.every((s) => typeof s.queuedMs === 'number' && typeof s.ms === 'number')).toBe(true);

    const second = await runBrowserInspector(
      [config, '--stamp', '2026-09-01_10-01', '--only', 'two', '--fail-on-incomplete', '--junit', 'out/junit.xml'],
      h,
    );
    expect(second.code).toBe(0);
    expect(second.lines).toEqual([expect.stringMatching(/^ok 1\/1 completed · [\d ]+ ms · warm · /u)]);
    const junit = fs.readFileSync(path.join(h.cwd, 'out', 'junit.xml'), 'utf8');
    expect(junit).toContain('<testsuite name="read.config.json" tests="1" failures="0"');
    expect(junit).toContain('<testcase name="two"');
    const third = await runBrowserInspector(
      [config, '--stamp', '2026-09-01_10-02', '--only', 'three-fail', '--fail-on-incomplete'],
      h,
    );
    expect(third.code).toBe(1);
    const unknown = await runBrowserInspector([config, '--only', 'nope'], h);
    expect(unknown.code).toBe(2);
    expect(unknown.stdout).toContain('--only: no snapshot named nope');
  }, 30000);

  it('recycles the browser between jobs after BROWSER_INSPECTOR_MAX_JOBS and the next call is `first` again', async () => {
    const h = fresh({ BROWSER_INSPECTOR_MAX_JOBS: '2' });
    await runBrowserInspector(['up'], h);
    await runBrowserInspector(['wait', '5', '--session', 'r'], h);
    await runBrowserInspector(['wait', '5', '--session', 'r'], h);
    await until(() => fakeLog(h).some((e) => e.event === 'recycle'));
    const third = await rawRequest(h, { argv: ['wait', '5', '--session', 'r'], session: 'r' });
    expect(third.done.mode).toBe('first');
    const modes = fakeLog(h)
      .filter((e) => e.event === 'runCommand')
      .map((e) => e.mode);
    expect(modes).toEqual(['first', 'warm', 'first']);
  }, 20000);
});

describe('engine failures are results, not crashes', () => {
  it('a keeper whose engine cannot load answers exit 2 with the reason', async () => {
    const h = fresh({
      BROWSER_INSPECTOR_ENGINE_MODULE: path.join(makeEnv().tmpdir, 'no-such-engine.mjs'),
      BROWSER_INSPECTOR_IDLE_MS: '300',
    });
    const up = await runBrowserInspector(['up'], h);
    expect(up.code).toBe(2);
    expect(up.lines[0]).toMatch(/^FAIL keeper: engine unavailable: /u);
    const info = readPid(h);
    await until(() => !isAlive(info.pid), 3000);
    expect(isAlive(info.pid)).toBe(false);
  }, 20000);

  it('rejects a request that carries env, and one with the wrong shape', async () => {
    const h = fresh();
    await runBrowserInspector(['up'], h);
    const withEnv = await rawRequest(h, { argv: ['status'], env: { SECRET: 'x' } });
    expect(withEnv.done.exit).toBe(2);
    expect(withEnv.done.lines[0]).toContain('no env');
    const malformed = await rawRequest(h, { argv: 'status' });
    expect(malformed.done.exit).toBe(2);
    expect(malformed.done.lines[0]).toContain('malformed');
  }, 20000);
});

describe('a browser that cannot launch is an answer, never a hang', () => {
  it('batch through the keeper: exit 2 with FAIL E_BROWSER_MISSING and the attempts, the socket closes', async () => {
    const h = fresh({ BROWSER_INSPECTOR_FAKE_LAUNCH_FAIL: '1', BROWSER_INSPECTOR_IDLE_MS: '300' });
    const config = writeConfig(h, [{ name: 'one' }, { name: 'two' }]);
    const run = await runBrowserInspector([config, '--stamp', '2026-09-02_10-00'], h);
    expect(run.code).toBe(2);
    expect(run.stdout).toContain('FAIL E_BROWSER_MISSING: no usable browser.');
    expect(run.stdout).toContain('tried channel chrome');
    expect(run.stdout).not.toContain('replaceAll');
    expect(run.stdout.match(/FAIL E_BROWSER_MISSING/gu)).toHaveLength(1);
    expect(keeperLog(h)).not.toContain('unhandled rejection');
    // A session command on the same keeper answers too (exit 2, the reason), no hang either.
    const open = await runBrowserInspector(['open', 'http://localhost:4521/', '--session', 's'], h);
    expect(open.code).toBe(2);
    expect(open.lines[0]).toMatch(/^FAIL keeper: engine unavailable: E_BROWSER_MISSING/u);
  }, 20000);

  it('the same batch with --no-daemon prints the same reason with exit 2', async () => {
    const h = fresh({ BROWSER_INSPECTOR_FAKE_LAUNCH_FAIL: '1' });
    const config = writeConfig(h, [{ name: 'one' }]);
    const run = await runBrowserInspector([config, '--no-daemon', '--stamp', '2026-09-02_10-01'], h);
    expect(run.code).toBe(2);
    expect(run.stdout).toContain('FAIL E_BROWSER_MISSING: no usable browser.');
    expect(run.stderr).not.toContain('replaceAll');
  }, 20000);
});
