// One keeper per identity (DESIGN.md §2.5, AC-12): the lock and the token, who cleans stale files
// after a reboot, and what `browser-inspector doctor` says about a shell that kills its children.

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
