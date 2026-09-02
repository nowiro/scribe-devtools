// The keeper on a real pipe with a fake engine (DESIGN.md §2.5, AC-12, AC-14): one keeper per
// identity, lock and token, stale files cleaned by the keeper, idle only with empty queues and no
// open session, queues per key with `queuedMs`, recycling, a log without secrets.
import fs from 'node:fs';
import path from 'node:path';
import { encode } from 'gpt-tokenizer/encoding/o200k_base';
import { afterEach, describe, expect, it } from 'vitest';

import {
  runBrowserInspector,
  cleanup,
  fakeLog,
  isAlive,
  keeperLog,
  lockFilePath,
  makeEnv,
  pidFilePath,
  rawRequest,
  readPid,
  sleep,
  spawnKeeperDirect,
  stopKeeper,
  until,
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

/** A batch config with N flows; a `wait` step makes the fake sleep, a name with `fail` fails. */
function writeConfig(h, snapshots, extra = {}) {
  const file = path.join(h.cwd, 'read.config.json');
  fs.writeFileSync(
    file,
    JSON.stringify({
      outputDir: './out',
      ...extra,
      snapshots: snapshots.map((s) => ({
        type: 'flow',
        url: 'http://localhost:4521/',
        steps: [{ do: 'wait', ms: 5 }],
        ...s,
      })),
    }),
  );
  return file;
}

/** A config with an `auth` block: a form login, `APP_PASS` from env, the state file next to the config. */
const AUTH = {
  storageState: './.scribe-devtools/auth.json',
  login: {
    url: 'http://localhost:4521/login.html',
    steps: [
      { do: 'fill', selector: '#pass', valueFromEnv: 'APP_PASS' },
      { do: 'click', selector: '#go' },
    ],
  },
};

describe('one keeper per identity', () => {
  it('auto-starts on `browser-inspector up`, listens before the engine, and two clients hit the same process', async () => {
    const h = fresh();
    const up = await runBrowserInspector(['up'], h);
    expect(up.code).toBe(0);
    expect(up.lines[0]).toMatch(/^ok keeper up · pid \d+ · hash [0-9a-f]{8} · /u);
    const info = readPid(h);
    expect(info).toBeDefined();
    expect(info.pipe).toBe(h.pipe);
    expect(info.token).toMatch(/^[0-9a-f]{64}$/u);
    expect(isAlive(info.pid)).toBe(true);

    // The log proves the order: listening first, engine after.
    const log = keeperLog(h);
    expect(log.indexOf('listening on')).toBeGreaterThan(-1);
    expect(log.indexOf('listening on')).toBeLessThan(log.indexOf('engine ready'));

    const [a, b] = await Promise.all([runBrowserInspector(['status'], h), runBrowserInspector(['status'], h)]);
    expect(a.code).toBe(0);
    expect(b.code).toBe(0);
    const pidOf = (r) => Number(/pid (\d+)/u.exec(r.lines[0])?.[1] ?? -1);
    expect(pidOf(a)).toBe(info.pid);
    expect(pidOf(b)).toBe(info.pid);
    expect(a.lines[0]).toContain(`hash ${info.hash}`);
    expect(a.lines[0]).toContain(h.pipe);
    expect(a.lines[0]).toMatch(/rss \d+ MB/u);
    expect(a.lines[1]).toMatch(/^jobs \d+ · lanes \d+ · routes \d+ · sessions \d+ · queued \d+$/u);
    expect(a.lines[2]).toMatch(/^browser-inspector \S+ · playwright-core \S+ · node \S+ · browser /u);
    // The bin path stands alone (the same exception as the doctor line); every other status line
    // stays within 160 characters with the full pipe name in it, and the counters and versions
    // within 40 tokens (the headline carries pid, hash and pipe — identity, measured by characters).
    expect(a.lines[3]).toMatch(/^\S+\/bin\/browser-inspector\.mjs$/u);
    expect(a.lines).toHaveLength(4);
    for (const line of a.lines.slice(0, 3)) expect(line.length, line).toBeLessThanOrEqual(160);
    for (const line of a.lines.slice(1, 3)) expect(encode(line).length, line).toBeLessThanOrEqual(40);
    expect(fakeLog(h).filter((e) => e.event === 'launch')).toHaveLength(1);
  }, 20000);

  it('a second keeper of the same identity finds the lock and exits 0; the first keeps working', async () => {
    const h = fresh();
    await runBrowserInspector(['up'], h);
    const info = readPid(h);
    const code = await spawnKeeperDirect(['--hash', info.hash, '--pipe', h.pipe, '--key', info.key], h);
    expect(code).toBe(0);
    expect(isAlive(info.pid)).toBe(true);
    expect(readPid(h).pid).toBe(info.pid);
    const status = await runBrowserInspector(['status'], h);
    expect(status.lines[0]).toContain(`pid ${String(info.pid)}`);
  }, 20000);

  it('rejects a request with a bad token', async () => {
    const h = fresh();
    await runBrowserInspector(['up'], h);
    const { done } = await rawRequest(h, { argv: ['status'] }, { token: 'deadbeef' });
    expect(done.exit).toBe(2);
    expect(done.lines[0]).toContain('bad token');
    expect(keeperLog(h)).toContain('bad token');
    // The keeper is still there for the client with the right token.
    const ok = await rawRequest(h, { argv: ['status'] });
    expect(ok.done.exit).toBe(0);
  }, 20000);

  it('cleans a stale pid file, lock and socket itself (the client never unlinks)', async () => {
    const h = fresh();
    const stalePid = 999_999;
    // The client computes the key from the hash — get it from a quick in-process identity.
    const { computeIdentity } = await import('../src/client.mjs');
    const identity = computeIdentity({ env: h.env });
    const pidPath = path.join(h.tmpdir, `browser-inspector-${identity.key}.json`);
    const lockPath = path.join(h.tmpdir, `browser-inspector-${identity.key}.lock`);
    fs.writeFileSync(pidPath, JSON.stringify({ pid: stalePid, pipe: h.pipe, token: 'stale' }));
    fs.writeFileSync(lockPath, String(stalePid));
    if (process.platform !== 'win32') fs.writeFileSync(h.pipe, '');

    const up = await runBrowserInspector(['up'], h);
    expect(up.code).toBe(0);
    const info = readPid(h);
    expect(info.pid).not.toBe(stalePid);
    expect(info.token).not.toBe('stale');
    expect(fs.readFileSync(lockPath, 'utf8')).toBe(String(info.pid));
    expect(pidFilePath(h)).toBe(pidPath);
    expect(lockFilePath(h)).toBe(lockPath);
  }, 20000);

  it('BROWSER_INSPECTOR_SOCKET is the pipe: status prints it and the pid file records it', async () => {
    const h = fresh();
    await runBrowserInspector(['up'], h);
    const status = await runBrowserInspector(['status'], h);
    expect(status.lines[0]).toContain(h.pipe);
    expect(readPid(h).pipe).toBe(h.pipe);
  }, 20000);

  it('`browser-inspector stop` ends the keeper and removes pid and lock', async () => {
    const h = fresh();
    await runBrowserInspector(['up'], h);
    const info = readPid(h);
    const stop = await runBrowserInspector(['stop'], h);
    expect(stop.code).toBe(0);
    expect(stop.lines[0]).toMatch(/^ok keeper stopping/u);
    // Released before the answer, so a `status` right after `stop` never sees a stale pid file.
    expect(pidFilePath(h)).toBeUndefined();
    expect(lockFilePath(h)).toBeUndefined();
    const rightAfter = await runBrowserInspector(['status'], h);
    expect(rightAfter.lines).toEqual([`keeper not running · hash ${info.hash} · ${h.pipe}`]);
    await until(() => !isAlive(info.pid));
    expect(isAlive(info.pid)).toBe(false);
    expect(pidFilePath(h)).toBeUndefined();
    expect(lockFilePath(h)).toBeUndefined();
    expect(fakeLog(h).some((e) => e.event === 'close')).toBe(true);
    const again = await runBrowserInspector(['stop'], h);
    expect(again.code).toBe(0);
    expect(again.lines[0]).toMatch(/^ok keeper not running/u);
  }, 20000);
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

  it('an open session blocks idle until `browser-inspector close`', async () => {
    const h = fresh({ BROWSER_INSPECTOR_IDLE_MS: '200' });
    await runBrowserInspector(['up'], h);
    const info = readPid(h);
    const open = await runBrowserInspector(['open', 'http://localhost:4521/', '--session', 's'], h);
    expect(open.code).toBe(0);
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
    const info = readPid(h);
    await runBrowserInspector(['open', 'http://localhost:4521/', '--session', 't'], h);
    await sleep(250);
    expect(isAlive(info.pid)).toBe(true);
    await until(() => !isAlive(info.pid), 3000);
    expect(isAlive(info.pid)).toBe(false);
    expect(fakeLog(h).some((e) => e.event === 'closeSession' && e.session === 't')).toBe(true);
    expect(keeperLog(h)).toContain('session t expired');
  }, 20000);

  it('a command that leaves no session open (per the engine) does not keep the keeper', async () => {
    const h = fresh({ BROWSER_INSPECTOR_IDLE_MS: '200' });
    const up = await runBrowserInspector(['up'], h);
    // The pid from the answer, not the pid file: with a 200 ms idle budget the keeper can be gone
    // (file unlinked) before this process gets to read it when the machine is busy.
    const info = { pid: Number(/pid (\d+)/u.exec(up.lines[0])?.[1] ?? -1) };
    const click = await runBrowserInspector(['click', 'e404', '--session', 'x'], h);
    expect(click.code).toBe(1);
    await until(() => !isAlive(info.pid), 2000);
    expect(isAlive(info.pid)).toBe(false);
  }, 20000);
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

describe('secrets', () => {
  it('never land in the keeper log or the session journal (fill --env, @{NAME}, form)', async () => {
    const secret = `hunter2-${Math.random().toString(36).slice(2)}`;
    const h = fresh({ SECRET_X: secret, OTHER_Y: `${secret}-two` });
    const out = path.join(h.tmpdir, 'out');
    await runBrowserInspector(['open', 'http://localhost:4521/', '--session', 's', '--out', out], h);
    const fill = await runBrowserInspector(['fill', 'e3', '@{SECRET_X}', '--session', 's'], h);
    expect(fill.code).toBe(0);
    expect(fill.stdout).not.toContain(secret);
    const env = await runBrowserInspector(['fill', 'e3', '--env', 'OTHER_Y', '--session', 's'], h);
    expect(env.code).toBe(0);
    const form = await runBrowserInspector(['form', 'e1=@{SECRET_X}', 'e2=plain', '--session', 's'], h);
    expect(form.code).toBe(0);
    const journal = fs.readFileSync(path.join(out, 'session', 's', 'journal.jsonl'), 'utf8');
    expect(journal).not.toContain(secret);
    expect(journal).toContain('***');
    expect(journal).toContain('plain');
    expect(keeperLog(h)).not.toContain(secret);
    // The fake echoes the values into report.json through the keeper's redact — a batch too.
    const config = writeConfig(h, [{ name: 'b', steps: [{ do: 'fill', selector: '#p', valueFromEnv: 'SECRET_X' }] }]);
    const batch = await runBrowserInspector([config, '--stamp', '2026-09-01_11-00'], h);
    expect(batch.code).toBe(0);
    const report = fs.readFileSync(path.join(h.cwd, 'out', '2026-09-01_11-00', 'b', 'report.json'), 'utf8');
    expect(report).not.toContain(secret);
    expect(report).toContain('snapshots[0].steps[0].value');
    expect(keeperLog(h)).not.toContain(secret);
    expect(batch.stdout).not.toContain(secret);
  }, 30000);
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

describe('stale files after a reboot (a recycled pid)', () => {
  it('a lock and pid file naming a LIVE pid that does not answer on the pipe are stale once old', async () => {
    const h = fresh();
    const { computeIdentity } = await import('../src/client.mjs');
    const identity = computeIdentity({ env: h.env });
    const pidPath = path.join(h.tmpdir, `browser-inspector-${identity.key}.json`);
    const lockPath = path.join(h.tmpdir, `browser-inspector-${identity.key}.lock`);
    // This process is alive and `kill(pid, 0)` says so — exactly what a recycled pid looks like.
    fs.writeFileSync(pidPath, JSON.stringify({ pid: process.pid, pipe: h.pipe, token: 'stale' }));
    fs.writeFileSync(lockPath, String(process.pid));
    const old = new Date(Date.now() - 60_000);
    fs.utimesSync(pidPath, old, old);
    fs.utimesSync(lockPath, old, old);

    const up = await runBrowserInspector(['up'], h);
    expect(up.code).toBe(0);
    const info = readPid(h);
    expect(info.pid).not.toBe(process.pid);
    expect(info.token).not.toBe('stale');
    expect(fs.readFileSync(lockPath, 'utf8')).toBe(String(info.pid));
    expect(isAlive(info.pid)).toBe(true);
  }, 20000);

  it('a young lock with a live holder is trusted: the second keeper exits 0', async () => {
    const h = fresh();
    const { computeIdentity } = await import('../src/client.mjs');
    const identity = computeIdentity({ env: h.env });
    const lockPath = path.join(h.tmpdir, `browser-inspector-${identity.key}.lock`);
    fs.writeFileSync(lockPath, String(process.pid));
    const code = await spawnKeeperDirect(['--hash', identity.hash, '--pipe', h.pipe, '--key', identity.key], h);
    expect(code).toBe(0);
    expect(fs.readFileSync(lockPath, 'utf8')).toBe(String(process.pid));
    fs.unlinkSync(lockPath);
  }, 20000);

  it('`browser-inspector stop` without a keeper names the stale pid file', async () => {
    const h = fresh();
    const { computeIdentity } = await import('../src/client.mjs');
    const identity = computeIdentity({ env: h.env });
    const pidPath = path.join(h.tmpdir, `browser-inspector-${identity.key}.json`);
    fs.writeFileSync(pidPath, JSON.stringify({ pid: 999_999, pipe: h.pipe, token: 'stale' }));
    const stop = await runBrowserInspector(['stop'], h);
    expect(stop.code).toBe(0);
    expect(stop.lines[0]).toMatch(/^ok keeper not running · hash [0-9a-f]{8} · /u);
    expect(stop.lines[1]).toContain('stale pid file');
    expect(stop.lines[1]).toContain(path.basename(pidPath));
    fs.unlinkSync(pidPath);
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

describe('auth in a config is executed, not only validated', () => {
  it('a fresh state file is reused and handed to every snapshot except `auth: false`', async () => {
    const h = fresh({ APP_PASS: 'wonderland-42' });
    const config = writeConfig(h, [{ name: 'pulpit' }, { name: 'gosc', auth: false }], { auth: AUTH });
    const state = path.join(h.cwd, '.scribe-devtools', 'auth.json');
    fs.mkdirSync(path.dirname(state), { recursive: true });
    fs.writeFileSync(state, JSON.stringify({ cookies: [], origins: [] }));
    const run = await runBrowserInspector([config, '--stamp', '2026-09-02_12-00'], h);
    expect(run.code).toBe(0);
    expect(run.lines.at(-1)).toMatch(/^ok 2\/2 completed/u);
    const flows = fakeLog(h).filter((e) => e.event === 'runFlow');
    expect(flows.map((f) => [f.name, f.storageState])).toEqual([
      ['pulpit', state],
      ['gosc', undefined],
    ]);
    expect(keeperLog(h)).toContain('auth: session from file');
    expect(keeperLog(h)).not.toContain('wonderland-42');
  }, 20000);

  it('a login that cannot run is FAIL E_AUTH with exit 2 — no snapshot runs anonymously', async () => {
    const h = fresh({ APP_PASS: 'wonderland-42' });
    const config = writeConfig(h, [{ name: 'pulpit' }], { auth: AUTH });
    const run = await runBrowserInspector([config, '--stamp', '2026-09-02_12-01'], h);
    expect(run.code).toBe(2);
    expect(run.lines[0]).toMatch(/^FAIL E_AUTH: /u);
    expect(run.stdout).not.toContain('wonderland-42');
    expect(fakeLog(h).filter((e) => e.event === 'runFlow')).toHaveLength(0);
    expect(fs.existsSync(path.join(h.cwd, 'out', '2026-09-02_12-01', '_manifest.json'))).toBe(false);
  }, 20000);
});

describe('secrets are per session', () => {
  it('a value filled with @{NAME} is still *** in a later `get` that carries no secrets', async () => {
    const secret = `hunter2-${Math.random().toString(36).slice(2)}`;
    const h = fresh({ SECRET_X: secret });
    await runBrowserInspector(['open', 'http://localhost:4521/', '--session', 's'], h);
    await runBrowserInspector(['fill', 'e1', '@{SECRET_X}', '--session', 's'], h);
    const get = await runBrowserInspector(['get', 'e1', '--value', '--session', 's'], h);
    expect(get.code).toBe(0);
    expect(get.lines[0]).toBe('ok get e1 · ***');
    expect(get.stdout).not.toContain(secret);
  }, 20000);
});

describe('doctor', () => {
  it('spawns a probe keeper from a shell and reports whether it survived', async () => {
    const h = fresh();
    const result = await runBrowserInspector(['doctor'], h);
    expect(result.code).toBe(0);
    expect(result.lines[0]).toMatch(
      /^ok keeper survives shell: yes · spawn→listen [\d ]+ ms · first job [\d ]+ ms · warm [\d ]+ ms · hash [0-9a-f]{8} · .*bin\/browser-inspector\.mjs$/u,
    );
    // The probe used its own pipe and stopped itself: no keeper on the working pipe.
    expect(readPid(h)).toBeUndefined();
    await until(() => fs.readdirSync(h.tmpdir).every((f) => !f.endsWith('.json')), 3000);
    expect(fs.readdirSync(h.tmpdir).filter((f) => f.endsWith('.json'))).toEqual([]);
  }, 30000);
});
