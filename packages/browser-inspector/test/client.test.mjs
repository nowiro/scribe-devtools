// The client (DESIGN.md §2.4, AC-8, AC-12, AC-14): batch falls back in-process with
// `timing.mode = "fallback"`, a session without a keeper is exit 2 with the one line, the request
// carries no env, `@{FOO}` unset is exit 2 before anything is sent, `@literal` stays literal, files
// are read by the client. A fake keeper (a tiny NDJSON server in this process) captures requests.
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { CliError, parseArgs } from '../src/cli.mjs';
import { computeIdentity, readFileEntry, resolveValues, splitCommandLine } from '../src/client.mjs';
import { KEEPER_UNAVAILABLE } from '../src/print.mjs';
import {
  runBrowserInspector,
  cleanup,
  fakeLog,
  isAlive,
  makeEnv,
  readPid,
  stopKeeper,
  uniquePipe,
  until,
} from './fixtures/keeper-harness.mjs';

/** @type {ReturnType<typeof makeEnv>[]} */
const harnesses = [];
const fresh = (overrides = {}) => {
  const h = makeEnv(overrides);
  harnesses.push(h);
  return h;
};
/** @type {net.Server[]} */
const servers = [];

afterEach(async () => {
  for (const s of servers.splice(0)) await new Promise((resolve) => s.close(() => resolve(undefined)));
  for (const h of harnesses.splice(0)) {
    await stopKeeper(h);
    cleanup(h);
  }
});

const writeConfig = (h, extra = {}) => {
  const file = path.join(h.cwd, 'read.config.json');
  fs.writeFileSync(
    file,
    JSON.stringify({
      outputDir: './out',
      snapshots: [{ name: 'one', type: 'flow', url: 'http://localhost:4521/', steps: [{ do: 'wait', ms: 5 }] }],
      ...extra,
    }),
  );
  return file;
};

/** A pipe where a keeper cannot listen: a socket path in a directory that does not exist. */
const deadSocket = (h) => path.join(h.tmpdir, 'missing-dir', 'browser-inspector.sock');

/**
 * A fake keeper: listens on the harness pipe, writes the pid file the client reads, captures the
 * first request line of every connection and answers `reply`.
 */
async function fakeKeeper(h, reply = { done: true, exit: 0, lines: ['ok fake'], files: [] }) {
  const identity = computeIdentity({ env: h.env });
  const token = 'f'.repeat(64);
  const requests = [];
  const server = net.createServer((socket) => {
    let buffer = '';
    socket.on('data', (chunk) => {
      buffer += chunk;
      const index = buffer.indexOf('\n');
      if (index === -1) return;
      requests.push(JSON.parse(buffer.slice(0, index)));
      buffer = '';
      socket.end(
        `${JSON.stringify({ progress: { snapshot: 'x', completed: true, ms: 1, index: 0, total: 2 } })}\n${JSON.stringify(reply)}\n`,
      );
    });
    socket.on('error', () => {});
  });
  await new Promise((resolve) => server.listen(h.pipe, () => resolve(undefined)));
  servers.push(server);
  // The pid is this process (the vitest worker) — the harness recognizes it and never kills it.
  fs.writeFileSync(
    path.join(h.tmpdir, `browser-inspector-${identity.key}.json`),
    JSON.stringify({ pid: process.pid, pipe: h.pipe, token }),
  );
  return { requests, token };
}

describe('batch without a keeper', () => {
  it('falls back in-process after the connect deadline: `keeper: fallback` on stdout, timing.mode = fallback', async () => {
    const h = fresh({ BROWSER_INSPECTOR_CONNECT_TIMEOUT_MS: '400' });
    h.env.BROWSER_INSPECTOR_SOCKET = deadSocket(h);
    const config = writeConfig(h);
    const run = await runBrowserInspector([config, '--stamp', '2026-09-01_12-00'], h);
    expect(run.code).toBe(0);
    expect(run.lines[0]).toMatch(/^keeper: fallback · no keeper after 400 ms/u);
    expect(run.lines[1]).toMatch(/^ok 1\/1 completed · [\d ]+ ms · fallback · out\/2026-09-01_12-00$/u);
    const report = JSON.parse(
      fs.readFileSync(path.join(h.cwd, 'out', '2026-09-01_12-00', 'one', 'report.json'), 'utf8'),
    );
    expect(report.timing.mode).toBe('fallback');
    expect(fakeLog(h).map((e) => e.event)).toEqual(['launch', 'runFlow', 'close']);
    // The run manifest is the keeper's: written on the in-process path too, with the same mode.
    const manifest = JSON.parse(fs.readFileSync(path.join(h.cwd, 'out', '2026-09-01_12-00', '_manifest.json'), 'utf8'));
    expect(manifest.timing.mode).toBe('fallback');
    expect(manifest.snapshots.map((s) => s.name)).toEqual(['one']);
  }, 20000);

  it('`--no-daemon` runs in-process without spawning anything: timing.mode = no-daemon', async () => {
    const h = fresh();
    const config = writeConfig(h);
    const run = await runBrowserInspector([config, '--stamp', '2026-09-01_12-01', '--no-daemon'], h);
    expect(run.code).toBe(0);
    expect(run.lines).toEqual([expect.stringMatching(/^ok 1\/1 completed · [\d ]+ ms · no-daemon · /u)]);
    const report = JSON.parse(
      fs.readFileSync(path.join(h.cwd, 'out', '2026-09-01_12-01', 'one', 'report.json'), 'utf8'),
    );
    expect(report.timing.mode).toBe('no-daemon');
    expect(readPid(h)).toBeUndefined();
  }, 20000);

  it('BROWSER_INSPECTOR_DAEMON=0 and CI mean no keeper; BROWSER_INSPECTOR_DAEMON=1 overrides CI', async () => {
    const h = fresh({ BROWSER_INSPECTOR_DAEMON: '0' });
    const config = writeConfig(h);
    const run = await runBrowserInspector([config, '--stamp', '2026-09-01_12-02'], h);
    expect(run.code).toBe(0);
    expect(run.lines[0]).toContain(' · no-daemon · ');
    expect(readPid(h)).toBeUndefined();

    const ci = fresh({ BROWSER_INSPECTOR_DAEMON: '', CI: 'true' });
    delete ci.env.BROWSER_INSPECTOR_DAEMON;
    const cfg2 = writeConfig(ci);
    const onCi = await runBrowserInspector([cfg2, '--stamp', '2026-09-01_12-03'], ci);
    expect(onCi.lines[0]).toContain(' · no-daemon · ');
    expect(readPid(ci)).toBeUndefined();

    const forced = fresh({ CI: 'true', BROWSER_INSPECTOR_DAEMON: '1' });
    const cfg3 = writeConfig(forced);
    const warm = await runBrowserInspector([cfg3, '--stamp', '2026-09-01_12-04'], forced);
    expect(warm.lines[0]).toContain(' · first · ');
    expect(readPid(forced)).toBeDefined();
  }, 30000);

  it('a config error is exit 2 before any keeper is contacted', async () => {
    const h = fresh();
    fs.writeFileSync(path.join(h.cwd, 'bad.json'), '{"snapshots": []}');
    const run = await runBrowserInspector(['bad.json'], h);
    expect(run.code).toBe(2);
    expect(run.stderr).toContain('config:');
    expect(readPid(h)).toBeUndefined();
  }, 20000);
});

describe('session without a keeper', () => {
  it('BROWSER_INSPECTOR_DAEMON=0: exit 2 with the FAIL keeper unavailable line, nothing spawned', async () => {
    const h = fresh({ BROWSER_INSPECTOR_DAEMON: '0' });
    const run = await runBrowserInspector(['click', 'e5'], h);
    expect(run.code).toBe(2);
    expect(run.lines).toHaveLength(1);
    expect(run.lines[0]).toMatch(
      /^FAIL keeper unavailable: .* — sessions need the keeper \(browser-inspector up \| doctor\); batch: --no-daemon$/u,
    );
    expect(readPid(h)).toBeUndefined();
    expect(fakeLog(h)).toEqual([]);
  }, 20000);

  it('keeper does not come up: exit 2 with the reason, never a browser in-process', async () => {
    const h = fresh({ BROWSER_INSPECTOR_CONNECT_TIMEOUT_MS: '400' });
    h.env.BROWSER_INSPECTOR_SOCKET = deadSocket(h);
    const run = await runBrowserInspector(['open', 'http://localhost:4521/'], h);
    expect(run.code).toBe(2);
    // The spawned keeper could not listen there, so it never wrote a pid file — that is the reason.
    expect(run.lines[0]).toBe(KEEPER_UNAVAILABLE('no keeper after 400 ms (no pid file)'));
    expect(run.lines[0].length).toBeLessThanOrEqual(160);
    expect(fakeLog(h)).toEqual([]);
    expect(run.ms).toBeLessThan(3000);
  }, 20000);

  it('`browser-inspector status` / `browser-inspector stop` without a keeper say so with exit 0 and spawn nothing', async () => {
    const h = fresh();
    const status = await runBrowserInspector(['status'], h);
    expect(status.code).toBe(0);
    expect(status.lines[0]).toMatch(/^keeper not running · hash [0-9a-f]{8} · /u);
    expect(status.lines).toHaveLength(1);
    const stop = await runBrowserInspector(['stop'], h);
    expect(stop.code).toBe(0);
    expect(stop.lines[0]).toMatch(/^ok keeper not running/u);
    expect(readPid(h)).toBeUndefined();
  }, 20000);

  it('a stale pid file is named on its own line (one line would pass 160 characters)', async () => {
    const h = fresh();
    const identity = computeIdentity({ env: h.env });
    const pidPath = path.join(h.tmpdir, `browser-inspector-${identity.key}.json`);
    fs.writeFileSync(pidPath, JSON.stringify({ pid: 999_999, pipe: h.pipe, token: 'f'.repeat(64) }));
    const status = await runBrowserInspector(['status'], h);
    expect(status.code).toBe(0);
    expect(status.lines).toHaveLength(2);
    expect(status.lines[0]).toBe(`keeper not running · hash ${identity.hash} · ${h.pipe}`);
    expect(status.lines[1]).toBe(`stale pid file ${pidPath.replaceAll('\\', '/')} — removed on the next start`);
    for (const line of status.lines) expect(line.length, line).toBeLessThanOrEqual(160);
    fs.unlinkSync(pidPath);
  }, 20000);
});

describe('a keeper that never answers', () => {
  it('is abandoned after BROWSER_INSPECTOR_REQUEST_TIMEOUT_MS: a session command exits 2 with the reason, a batch falls back', async () => {
    const h = fresh({ BROWSER_INSPECTOR_REQUEST_TIMEOUT_MS: '300' });
    const identity = computeIdentity({ env: h.env });
    const server = net.createServer((socket) => {
      // Reads the request and says nothing — a wedged handler.
      socket.on('data', () => {});
      socket.on('error', () => {});
    });
    await new Promise((resolve) => server.listen(h.pipe, () => resolve(undefined)));
    servers.push(server);
    fs.writeFileSync(
      path.join(h.tmpdir, `browser-inspector-${identity.key}.json`),
      JSON.stringify({ pid: process.pid, pipe: h.pipe, token: 'f'.repeat(64) }),
    );
    const t0 = performance.now();
    const click = await runBrowserInspector(['click', 'e1', '--session', 'w'], h);
    expect(performance.now() - t0).toBeLessThan(5000);
    expect(click.code).toBe(2);
    expect(click.lines[0]).toMatch(/^FAIL keeper unavailable: no answer from the keeper within 300 ms/u);
    const config = writeConfig(h);
    const run = await runBrowserInspector([config, '--stamp', '2026-09-02_12-30'], h);
    expect(run.code).toBe(0);
    expect(run.lines[0]).toMatch(/^keeper: fallback · no answer from the keeper within 300 ms/u);
  }, 20000);
});

describe('the request on the wire', () => {
  it('carries v, token, cwd, argv, values, secretValues, files, session — and no env', async () => {
    const h = fresh({ FOO: 'bar-secret' });
    const { requests, token } = await fakeKeeper(h);
    const run = await runBrowserInspector(['fill', 'e3', '@{FOO}', '--session', 's1'], h);
    expect(run.code).toBe(0);
    expect(run.lines).toEqual(['ok fake']);
    expect(requests).toHaveLength(1);
    const request = requests[0];
    expect(Object.keys(request).sort()).toEqual([
      'argv',
      'cwd',
      'files',
      'secretValues',
      'session',
      'token',
      'v',
      'values',
    ]);
    expect(request).not.toHaveProperty('env');
    expect(request.v).toBe(1);
    expect(request.token).toBe(token);
    expect(request.cwd).toBe(h.cwd);
    expect(request.argv).toEqual(['fill', 'e3', '@{FOO}', '--session', 's1']);
    expect(request.values).toEqual({ 'argv.fill.value': 'bar-secret' });
    expect(request.secretValues).toEqual(['bar-secret']);
    expect(request.files).toEqual({});
    expect(request.session).toBe('s1');
    expect(JSON.stringify(request)).not.toContain('PATH');
  }, 20000);

  it('`@{FOO}` unset is exit 2 in the client — nothing is sent', async () => {
    const h = fresh();
    delete h.env.FOO;
    const { requests } = await fakeKeeper(h);
    const run = await runBrowserInspector(['fill', 'e3', '@{FOO}'], h);
    expect(run.code).toBe(2);
    expect(run.stderr).toContain('argv.fill.valueFromEnv: environment variable FOO is not set');
    expect(requests).toHaveLength(0);
    const form = await runBrowserInspector(['form', 'e1=x', 'e2=@{FOO}'], h);
    expect(form.code).toBe(2);
    expect(form.stderr).toContain('argv.form.fields[1].valueFromEnv: environment variable FOO is not set');
  }, 20000);

  it('`@literal` (no braces) stays a literal value, not a secret', async () => {
    const h = fresh();
    const { requests } = await fakeKeeper(h);
    const run = await runBrowserInspector(['fill', 'e3', '@literal'], h);
    expect(run.code).toBe(0);
    expect(requests[0].values).toEqual({});
    expect(requests[0].secretValues).toEqual([]);
    expect(requests[0].argv).toEqual(['fill', 'e3', '@literal']);
  }, 20000);

  it('files are read by the client relative to its cwd: upload, eval --file, script', async () => {
    const h = fresh({ APP_PASS: 'pw-1234' });
    const { requests } = await fakeKeeper(h);
    fs.writeFileSync(path.join(h.cwd, 'photo.bin'), Buffer.from([1, 2, 3, 250]));
    const up = await runBrowserInspector(['upload', 'e1', 'photo.bin'], h);
    expect(up.code).toBe(0);
    expect(requests[0].files).toEqual({
      'photo.bin': { base64: Buffer.from([1, 2, 3, 250]).toString('base64'), size: 4 },
    });

    fs.writeFileSync(path.join(h.cwd, 'expr.js'), 'document.title');
    await runBrowserInspector(['eval', '--file', 'expr.js'], h);
    expect(Buffer.from(requests[1].files['expr.js'].base64, 'base64').toString()).toBe('document.title');

    fs.writeFileSync(
      path.join(h.cwd, 'flow.txt'),
      [
        '# comment',
        'open http://localhost:4521/',
        'fill e3 @{APP_PASS}',
        '',
        'form e1="Jan Kowalski" e2=@{APP_PASS}',
      ].join('\n'),
    );
    const script = await runBrowserInspector(['script', 'flow.txt'], h);
    expect(script.code).toBe(0);
    expect(Object.keys(requests[2].files)).toEqual(['flow.txt']);
    expect(requests[2].values).toEqual({ 'script[2].value': 'pw-1234', 'script[4].fields[1].value': 'pw-1234' });
    expect(requests[2].secretValues).toEqual(['pw-1234']);

    const missing = await runBrowserInspector(['upload', 'e1', 'nope.bin'], h);
    expect(missing.code).toBe(2);
    expect(missing.stderr).toContain('argv.upload.files[0]: cannot read nope.bin');
  }, 20000);

  it('batch: valueFromEnv is addressed by snapshot and step, auth.oauth *FromEnv by field', async () => {
    const h = fresh({ SHOP_EMAIL: 'a@b.c', KC_SECRET: 's3cr3t' });
    const { requests } = await fakeKeeper(h, { done: true, exit: 0, lines: ['ok'], files: [] });
    const config = writeConfig(h, {
      snapshots: [
        { name: 'one', type: 'page', url: 'http://localhost:4521/' },
        {
          name: 'two',
          type: 'flow',
          url: 'http://localhost:4521/',
          steps: [
            { do: 'wait', ms: 1 },
            { do: 'fill', selector: '#email', valueFromEnv: 'SHOP_EMAIL' },
            {
              do: 'form',
              fields: [
                { selector: '#a', value: 'x' },
                { selector: '#b', valueFromEnv: 'SHOP_EMAIL' },
              ],
            },
          ],
        },
      ],
      auth: {
        storageState: './state.json',
        oauth: {
          tokenUrl: 'http://localhost:4521/token',
          grantType: 'client_credentials',
          clientId: 'browser-inspector',
          clientSecretFromEnv: 'KC_SECRET',
          store: { origin: 'http://localhost:4521', key: 'token' },
        },
      },
    });
    const run = await runBrowserInspector([config, '--stamp', '2026-09-01_12-05'], h);
    expect(run.code).toBe(0);
    expect(requests[0].values).toEqual({
      'snapshots[1].steps[1].value': 'a@b.c',
      'snapshots[1].steps[2].fields[1].value': 'a@b.c',
      'auth.oauth.clientSecret': 's3cr3t',
    });
    expect(requests[0].secretValues.sort()).toEqual(['a@b.c', 's3cr3t']);
    expect(requests[0]).not.toHaveProperty('env');
  }, 20000);

  it('prints progress lines only for multi-snapshot runs, then the done lines', async () => {
    const h = fresh();
    await fakeKeeper(h, { done: true, exit: 0, lines: ['ok 2/2 completed'], files: [] });
    const config = writeConfig(h, {
      snapshots: [
        { name: 'one', type: 'page', url: 'http://localhost:4521/' },
        { name: 'two', type: 'page', url: 'http://localhost:4521/' },
      ],
    });
    const run = await runBrowserInspector([config], h);
    expect(run.lines).toEqual(['ok x · 1 ms', 'ok 2/2 completed']);
  }, 20000);
});

describe('pure helpers', () => {
  it('splitCommandLine handles quotes like a shell for the simple cases', () => {
    expect(splitCommandLine('form e1="Jan Kowalski" e2=@{APP_PASS}')).toEqual([
      'form',
      'e1=Jan Kowalski',
      'e2=@{APP_PASS}',
    ]);
    expect(splitCommandLine("fill e3 'a b'  --enter")).toEqual(['fill', 'e3', 'a b', '--enter']);
    expect(splitCommandLine('eval "document.querySelector(\\"h1\\").textContent"')).toEqual([
      'eval',
      'document.querySelector("h1").textContent',
    ]);
    expect(splitCommandLine('  ')).toEqual([]);
    expect(splitCommandLine('fill e3 ""')).toEqual(['fill', 'e3', '']);
  });

  it('resolveValues names the missing variable with its address and never reads process.env', () => {
    const parsed = parseArgs(['fill', 'e3', '--env', 'NOPE']);
    expect(() => resolveValues(parsed, { env: {}, cwd: process.cwd() })).toThrow(CliError);
    expect(() => resolveValues(parsed, { env: {}, cwd: process.cwd() })).toThrow(
      'argv.fill.valueFromEnv: environment variable NOPE is not set',
    );
    const ok = resolveValues(parsed, { env: { NOPE: 'v' }, cwd: process.cwd() });
    expect(ok).toEqual({ values: { 'argv.fill.value': 'v' }, secretValues: ['v'], files: {} });
  });

  it('readFileEntry inlines small files and hands over a path above 1 MB', () => {
    const h = fresh();
    const small = path.join(h.cwd, 'small.txt');
    fs.writeFileSync(small, 'hi');
    expect(readFileEntry('small.txt', [h.cwd], 'x')).toEqual({ base64: Buffer.from('hi').toString('base64'), size: 2 });
    const big = path.join(h.cwd, 'big.bin');
    fs.writeFileSync(big, Buffer.alloc(1024 * 1024 + 1));
    expect(readFileEntry('big.bin', [h.cwd], 'x')).toEqual({ path: big, size: 1024 * 1024 + 1 });
    expect(() => readFileEntry('none', [h.cwd], 'here')).toThrow('here: cannot read none');
  });

  it('computeIdentity: BROWSER_INSPECTOR_SOCKET changes the pipe and the file key, not the hash', () => {
    const base = computeIdentity({ env: { ...process.env, BROWSER_INSPECTOR_SOCKET: '' } });
    const a = computeIdentity({ env: { ...process.env, BROWSER_INSPECTOR_SOCKET: uniquePipe(process.cwd()) } });
    const b = computeIdentity({ env: { ...process.env, BROWSER_INSPECTOR_SOCKET: uniquePipe(process.cwd()) } });
    expect(a.hash).toBe(b.hash);
    expect(a.hash).toBe(base.hash);
    expect(a.pipe).not.toBe(b.pipe);
    expect(a.key).not.toBe(b.key);
    expect(a.key.startsWith(`${a.hash}-`)).toBe(true);
    expect(base.key).toBe(base.hash);
  });
});

describe('`browser-inspector up` through the real keeper', () => {
  it('starts one, and a second `browser-inspector up` reuses it', async () => {
    const h = fresh();
    const first = await runBrowserInspector(['up'], h);
    expect(first.code).toBe(0);
    const pid = readPid(h).pid;
    const second = await runBrowserInspector(['up'], h);
    expect(second.code).toBe(0);
    expect(second.lines[0]).toContain(`pid ${String(pid)}`);
    expect(isAlive(pid)).toBe(true);
    await stopKeeper(h);
    await until(() => !isAlive(pid));
    expect(isAlive(pid)).toBe(false);
  }, 20000);
});
