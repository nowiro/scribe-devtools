// When the keeper may go away (DESIGN.md §2.5, AC-14): idle only with empty queues, an open
// session blocks it, a session expires on its TTL — and what waits for what: a recycle deferred
// under an open session, the scrub queued after the answer.

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
  pidFilePath,
  rawRequest,
  readPid,
  sleep,
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

describe('idle and sessions', () => {
  it('exits after BROWSER_INSPECTOR_IDLE_MS only when the queue is empty', async () => {
    const h = fresh({ BROWSER_INSPECTOR_IDLE_MS: '200' });
    await runBrowserInspector(['up'], h);
    const info = readPid(h);
    // A 700 ms job: the idle timer must not fire under it.
    const job = rawRequest(h, { argv: ['wait', '700', '--session', 'w'], session: 'w' });
    await sleep(450);
    expect(isAlive(info.pid)).toBe(true);
    const { done } = await job;
    expect(done.exit).toBe(0);
    await until(() => !isAlive(info.pid), 2000);
    expect(isAlive(info.pid)).toBe(false);
    expect(pidFilePath(h)).toBeUndefined();
    expect(keeperLog(h)).toContain('shutdown: idle');
  }, 20000);

  it('the TTL sweep does not push the idle deadline: a sweep every 100 ms, idle budget 800 ms', async () => {
    // The regression this pins: `sweepSessions` used to call `armIdle()` unconditionally, and
    // `armIdle` restarts the countdown from zero. The sweep runs every `min(sessionTtlMs / 2, 30 s)`
    // — with production defaults every 30 s against an idle budget of 30 min — so the deadline was
    // pushed forever and the keeper never exited. The existing tests could not see it: they set a
    // short IDLE_MS with the default SESSION_TTL_MS, so no sweep ever fired inside the test. Only a
    // sweep FASTER than the idle budget reproduces it, which is exactly the production ratio.
    const h = fresh({ BROWSER_INSPECTOR_IDLE_MS: '800', BROWSER_INSPECTOR_SESSION_TTL_MS: '200' });
    const up = await runBrowserInspector(['up'], h);
    const info = { pid: Number(/pid (\d+)/u.exec(up.lines[0])?.[1] ?? -1) };
    // ~8 sweeps fit inside the idle budget; before the fix every one of them reset it to 800 ms.
    await until(() => !isAlive(info.pid), 6000);
    expect(isAlive(info.pid)).toBe(false);
    expect(keeperLog(h)).toContain('shutdown: idle');
  }, 20000);

  it('an open session blocks idle until `browser-inspector close`', async () => {
    const h = fresh({ BROWSER_INSPECTOR_IDLE_MS: '200' });
    await runBrowserInspector(['up'], h);
    const open = await runBrowserInspector(['open', 'http://localhost:4521/', '--session', 's'], h);
    expect(open.code).toBe(0);
    // The pid AFTER `open`, not after `up`: starting a client node process takes 80-190 ms, and on a
    // loaded machine that outruns a 200 ms idle budget — the keeper from `up` then exits and the
    // client spawns another one, which is the keeper holding the session and the one under test.
    const info = readPid(h);
    await sleep(600);
    expect(isAlive(info.pid)).toBe(true);
    const status = await runBrowserInspector(['status'], h);
    expect(status.lines.some((l) => l.startsWith('session s · cwd '))).toBe(true);
    const close = await runBrowserInspector(['close', '--session', 's'], h);
    expect(close.code).toBe(0);
    await until(() => !isAlive(info.pid), 2000);
    expect(isAlive(info.pid)).toBe(false);
  }, 20000);

  it('a session expires after BROWSER_INSPECTOR_SESSION_TTL_MS and the keeper goes idle', async () => {
    const h = fresh({ BROWSER_INSPECTOR_IDLE_MS: '200', BROWSER_INSPECTOR_SESSION_TTL_MS: '400' });
    await runBrowserInspector(['up'], h);
    await runBrowserInspector(['open', 'http://localhost:4521/', '--session', 't'], h);
    // The keeper serving the session, for the same reason as above.
    const info = readPid(h);
    await sleep(250);
    expect(isAlive(info.pid)).toBe(true);
    await until(() => !isAlive(info.pid), 3000);
    expect(isAlive(info.pid)).toBe(false);
    expect(fakeLog(h).some((e) => e.event === 'closeSession' && e.session === 't')).toBe(true);
    expect(keeperLog(h)).toContain('session t expired');
  }, 20000);

  it('a session opened by `browser-inspector script` is registered: it blocks idle, `status` sees it, a script that closes releases it', async () => {
    // `script` used to run its lines without ever calling `touchSession`: the engine held an open
    // session the keeper's registry knew nothing about, so `status` said `sessions 0`, the idle
    // timer took the browser (and the login) down after IDLE_MS instead of the session's TTL, and a
    // due recycle was not deferred under it.
    const h = fresh({ BROWSER_INSPECTOR_IDLE_MS: '200' });
    await runBrowserInspector(['up'], h);
    fs.writeFileSync(path.join(h.cwd, 'setup.txt'), 'open http://localhost:4521/\n');
    const script = await runBrowserInspector(['script', 'setup.txt'], h);
    expect(script.code).toBe(0);
    // The keeper AFTER the script, for the same reason as in the `open` case above.
    const info = readPid(h);
    await sleep(600);
    expect(isAlive(info.pid)).toBe(true);
    const status = await runBrowserInspector(['status'], h);
    expect(status.lines[1]).toContain('sessions 1');
    expect(status.lines.some((l) => l.startsWith('session default · cwd '))).toBe(true);
    fs.writeFileSync(path.join(h.cwd, 'teardown.txt'), 'close\n');
    const teardown = await runBrowserInspector(['script', 'teardown.txt'], h);
    expect(teardown.code).toBe(0);
    await until(() => !isAlive(info.pid), 2000);
    expect(isAlive(info.pid)).toBe(false);
  }, 20000);

  it('`browser-inspector script` refreshes the session it drives, so the TTL sweep does not close it under the agent', async () => {
    // An agent that packs its steps into `script` files kept a session whose `lastUsedAt` never
    // moved: the sweep expired it mid-work, at the default TTL, with no idle window anywhere.
    const h = fresh({ BROWSER_INSPECTOR_IDLE_MS: '30000', BROWSER_INSPECTOR_SESSION_TTL_MS: '1000' });
    await runBrowserInspector(['open', 'http://localhost:4521/', '--session', 'k'], h);
    const file = path.join(h.cwd, 'step.txt');
    fs.writeFileSync(file, 'wait 5\n');
    // Six steps 250 ms apart: 1.5 s of work, every gap well inside the 1 s TTL. Over the pipe, not
    // through the client, so the gaps are the test's and not a node start's.
    for (let i = 0; i < 6; i += 1) {
      await sleep(250);
      const step = await rawRequest(h, {
        argv: ['script', 'step.txt'],
        session: 'k',
        files: { 'step.txt': { path: file } },
      });
      expect(step.done.exit).toBe(0);
    }
    expect(keeperLog(h)).not.toContain('session k expired');
    expect(fakeLog(h).some((e) => e.event === 'closeSession' && e.session === 'k')).toBe(false);
    const status = await rawRequest(h, { argv: ['status'] });
    expect(status.done.lines.some((l) => l.startsWith('session k · cwd '))).toBe(true);
  }, 20000);

  it('a command that leaves no session open (per the engine) does not keep the keeper', async () => {
    // 600 ms, not 200: this test needs the keeper from `up` to still be there when the NEXT client
    // process connects, and starting that process costs 80-190 ms (more on a loaded machine).
    const h = fresh({ BROWSER_INSPECTOR_IDLE_MS: '600' });
    const up = await runBrowserInspector(['up'], h);
    // The pid from the answer, not the pid file: with a short idle budget the keeper can be gone
    // (file unlinked) before this process gets to read it when the machine is busy.
    const info = { pid: Number(/pid (\d+)/u.exec(up.lines[0])?.[1] ?? -1) };
    const click = await runBrowserInspector(['click', 'e404', '--session', 'x'], h);
    expect(click.code).toBe(1);
    await until(() => !isAlive(info.pid), 4000);
    expect(isAlive(info.pid)).toBe(false);
  }, 20000);
});

describe('recycling waits for the sessions', () => {
  it('a recycle due under an open session is deferred and runs after `browser-inspector close`', async () => {
    const h = fresh({ BROWSER_INSPECTOR_MAX_JOBS: '2' });
    await runBrowserInspector(['open', 'http://localhost:4521/', '--session', 's'], h);
    await runBrowserInspector(['wait', '5', '--session', 's'], h);
    await sleep(150);
    expect(fakeLog(h).some((e) => e.event === 'recycle')).toBe(false);
    expect(keeperLog(h)).toContain('recycle deferred: 1 sessions open');
    const close = await runBrowserInspector(['close', '--session', 's'], h);
    expect(close.code).toBe(0);
    await until(() => fakeLog(h).some((e) => e.event === 'recycle'));
    expect(fakeLog(h).find((e) => e.event === 'recycle')?.sessions).toBe(0);
  }, 20000);

  it('a recycle due right after `browser-inspector script` is deferred under the session the script opened', async () => {
    // MAX_JOBS 1: the recycle falls due on the script's own job, the first one the keeper runs —
    // the only moment where nothing but the script's `touchSession` can defer it.
    const h = fresh({ BROWSER_INSPECTOR_MAX_JOBS: '1' });
    fs.writeFileSync(path.join(h.cwd, 'setup.txt'), 'open http://localhost:4521/\n');
    const script = await runBrowserInspector(['script', 'setup.txt'], h);
    expect(script.code).toBe(0);
    await sleep(200);
    expect(fakeLog(h).some((e) => e.event === 'recycle')).toBe(false);
    expect(keeperLog(h)).toContain('recycle deferred: 1 sessions open');
  }, 20000);

  it('samples the browser RSS in the background every 10 jobs, never on a job', async () => {
    const h = fresh();
    await runBrowserInspector(['up'], h);
    for (let i = 0; i < 10; i += 1) await rawRequest(h, { argv: ['wait', '1', '--session', 'm'], session: 'm' });
    await until(() => fakeLog(h).some((e) => e.event === 'sampleRss'));
    const samples = fakeLog(h).filter((e) => e.event === 'sampleRss');
    expect(samples).toHaveLength(1);
    expect(samples[0].jobs).toBe(10);
  }, 20000);
});

describe('the scrub after the answer', () => {
  it('runs in the lane queue after the done line; the next client on the lane pays it as queuedMs', async () => {
    // A 600 ms scrub: the second client's node start (~100 ms) eats part of it, the rest is its wait.
    const h = fresh({ BROWSER_INSPECTOR_FAKE_SCRUB_MS: '600' });
    const config = writeConfig(h, [{ name: 'a' }]);
    const first = await runBrowserInspector([config, '--stamp', '2026-09-02_11-00'], h);
    expect(first.code).toBe(0);
    expect(first.ms).toBeLessThan(2000);
    const second = await runBrowserInspector([config, '--stamp', '2026-09-02_11-01'], h);
    expect(second.code).toBe(0);
    const events = fakeLog(h).map((e) => e.event);
    expect(events.indexOf('scrub')).toBeGreaterThan(events.indexOf('runFlow'));
    expect(events.indexOf('scrub')).toBeLessThan(events.lastIndexOf('runFlow'));
    const flows = fakeLog(h).filter((e) => e.event === 'runFlow');
    // The first run did not wait for anything; the second waited for the first one's scrub.
    expect(flows[0].queuedMs).toBeLessThan(50);
    expect(flows[1].queuedMs).toBeGreaterThanOrEqual(200);
    const manifest = JSON.parse(fs.readFileSync(path.join(h.cwd, 'out', '2026-09-02_11-00', '_manifest.json'), 'utf8'));
    expect(manifest.snapshots[0].queuedMs).toBeLessThan(50);
    // The second run's own scrub is queued right after its answer; once it ran, nothing is left
    // and the keeper can go idle.
    const status = await runBrowserInspector(['status'], h);
    expect(status.lines[1]).toMatch(/queued [01]/u);
    await until(() => fakeLog(h).filter((e) => e.event === 'scrub').length === 2, 3000);
    expect((await runBrowserInspector(['status'], h)).lines[1]).toContain('queued 0');
  }, 20000);
});
