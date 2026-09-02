// auth on a real Chrome/Edge (PLAN.md WP7; DESIGN.md §2.3, §2.6): log in ONCE through the engine,
// then every authenticated snapshot starts logged in on a fresh context (`serviceWorkers: 'allow'`),
// `auth: false` gives the anonymous view of the same run on the scratch lane, and the OAuth path
// lands a token the page reads without any form. The wiring is the one the keeper / `runBatch`
// do per batch: `ensureSession` before the flows, `storageStateFor(snapshot, session)` per flow.
//
// Ports 4561 (login.html) and 4563 (token stub) — WP7 owns 4561–4569. `BI_SKIP_SMOKE=1` skips.
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ensureSession, storageStateFor } from '../../src/auth.mjs';
import { parseConfig } from '../../src/config.mjs';
import { createEngine } from '../../src/engine.mjs';
import { startTokenServer } from '../../fixtures/kc-token.mjs';
import { bi, cleanup, keeperLog, makeEnv, stopKeeper } from '../fixtures/keeper-harness.mjs';
import { startFixtureServer } from './fixture-server.mjs';

const PORT_APP = 4561;
const PORT_TOKEN = 4563;
const PORT_CLI = 4565;
const PASS = 'wonderland-42';
const skip = process.env.BI_SKIP_SMOKE === '1' || process.env.BI_SKIP_SMOKE === 'true';

describe.skipIf(skip)('smoke: auth through bin/bi.mjs — the keeper and --no-daemon log in once', () => {
  /** @type {Awaited<ReturnType<typeof startFixtureServer>>} */
  let app;
  /** @type {ReturnType<typeof makeEnv>} */
  let h;
  /** @type {string} */
  let config;

  beforeAll(async () => {
    app = await startFixtureServer(PORT_CLI);
    h = makeEnv({ APP_USER: 'alice', APP_PASS: PASS });
    // The real engine, not the fake the keeper tests wire in.
    delete h.env.BI_ENGINE_MODULE;
    delete h.env.BI_FAKE_LOG;
    config = path.join(h.cwd, 'read.config.json');
    await writeFile(
      config,
      JSON.stringify({
        outputDir: './out',
        auth: {
          storageState: './.scribe-devtools/auth.json',
          login: {
            url: app.url('login.html'),
            steps: [
              { do: 'fill', selector: '[data-testid=field-user]', valueFromEnv: 'APP_USER' },
              { do: 'fill', selector: '[data-testid=field-pass]', valueFromEnv: 'APP_PASS' },
              { do: 'click', selector: '[data-testid=login-submit]' },
              { do: 'waitFor', selector: '[data-testid=dashboard-user]' },
            ],
          },
        },
        snapshots: [
          {
            name: 'pulpit',
            type: 'flow',
            url: app.url('login.html'),
            steps: [
              { do: 'waitFor', selector: '[data-testid=dashboard-user]' },
              { do: 'extract', name: 'user', selector: '[data-testid=dashboard-user]' },
              { do: 'extract', name: 'source', selector: '[data-testid=session-source]' },
              { do: 'extract', name: 'logins', selector: '[data-testid=login-count]' },
            ],
          },
          {
            name: 'gosc',
            type: 'flow',
            url: app.url('login.html'),
            auth: false,
            steps: [{ do: 'waitFor', selector: '[data-testid=dashboard-anonymous]' }],
          },
        ],
      }),
    );
  }, 30_000);

  afterAll(async () => {
    if (h) await stopKeeper(h);
    await app?.close();
    if (h) cleanup(h);
  });

  /** @param {string} stamp @param {string} name */
  const report = async (stamp, name) =>
    JSON.parse(await readFile(path.join(h.cwd, 'out', stamp, name, 'report.json'), 'utf8'));

  it('--no-daemon: logs in, writes the state file, the snapshot sees the dashboard, the anonymous one does not', async () => {
    const run = await bi([config, '--no-daemon', '--stamp', '2026-09-02_13-00'], h);
    expect(run.code, run.stdout + run.stderr).toBe(0);
    expect(run.lines.at(-1)).toMatch(/^ok 2\/2 completed/u);
    expect(existsSync(path.join(h.cwd, '.scribe-devtools', 'auth.json'))).toBe(true);
    const pulpit = await report('2026-09-02_13-00', 'pulpit');
    // The user name came from env through `valueFromEnv`, so the client made it a secret (§2.6):
    // the dashboard shows it, the report masks it. `source` and the login counter prove the login.
    expect(pulpit.extracts.user.value).toBe('***');
    expect(pulpit.extracts.source.value).toBe('form');
    expect(pulpit.extracts.logins.value).toBe('1');
    expect(pulpit.timing.ctx).toBe('fresh');
    const gosc = await report('2026-09-02_13-00', 'gosc');
    expect(gosc.completed).toBe(true);
    expect(gosc.timing.ctx).toBe('reused');
    expect(run.stdout).not.toContain(PASS);
  }, 60_000);

  it('through the keeper, twice: the second run reuses the state file and still starts logged in', async () => {
    await rm(path.join(h.cwd, '.scribe-devtools'), { recursive: true, force: true });
    const first = await bi([config, '--stamp', '2026-09-02_13-01'], h);
    expect(first.code, first.stdout + first.stderr).toBe(0);
    expect(first.lines.at(-1)).toMatch(/^ok 2\/2 completed/u);
    const second = await bi([config, '--stamp', '2026-09-02_13-02'], h);
    expect(second.code, second.stdout + second.stderr).toBe(0);
    expect(second.lines.at(-1)).toMatch(/^ok 2\/2 completed · [\d ]+ ms · warm/u);
    for (const stamp of ['2026-09-02_13-01', '2026-09-02_13-02']) {
      const pulpit = await report(stamp, 'pulpit');
      expect(pulpit.extracts.user.value).toBe('***');
      expect(pulpit.extracts.source.value).toBe('form');
      // ONE login: the counter the fixture keeps in localStorage stays at 1 across both runs.
      expect(pulpit.extracts.logins.value).toBe('1');
    }
    const log = keeperLog(h);
    expect(log).toContain('auth: login (');
    expect(log).toContain('auth: session from file');
    expect(log).not.toContain(PASS);
  }, 60_000);
});

describe.skipIf(skip)('smoke: auth — login once, snapshots logged in, anonymous on demand', () => {
  /** @type {Awaited<ReturnType<typeof startFixtureServer>>} */
  let app;
  /** @type {Awaited<ReturnType<typeof startTokenServer>>} */
  let idp;
  /** @type {ReturnType<typeof createEngine>} */
  let engine;
  /** @type {string} */
  let out;
  /** @type {string[]} */
  const log = [];
  let seq = 0;

  beforeAll(async () => {
    [app, idp] = await Promise.all([startFixtureServer(PORT_APP), startTokenServer(PORT_TOKEN)]);
    out = await mkdtemp(path.join(os.tmpdir(), 'bi-auth-smoke-'));
    engine = createEngine({ browser: { headless: true }, env: process.env, prewarm: false, log: (l) => log.push(l) });
    await engine.ready;
  }, 60_000);

  afterAll(async () => {
    await engine?.close();
    await Promise.all([app?.close(), idp?.close()]);
    if (out) await rm(out, { recursive: true, force: true });
  });

  /**
   * A whole config normalized like `loadConfig`, so `config.auth` carries the defaults and the
   * snapshots their own; `runFlow` gets the same `laneOpts` the keeper builds per snapshot.
   * @param {Record<string, any>} auth
   * @param {Record<string, any>[]} snapshots
   */
  function configOf(auth, snapshots) {
    seq += 1;
    return parseConfig(
      { outputDir: out, auth, snapshots: snapshots.map((s) => ({ type: 'flow', ...s })) },
      { configPath: path.join(out, `read.config.${String(seq)}.json`), cwd: out },
    );
  }

  /** @param {Record<string, any>} config @param {number} i @param {{ storageState: string } | undefined} session */
  async function flow(config, i, session) {
    const snapshot = config.snapshots[i];
    const dir = path.join(out, `run-${String(seq)}`, snapshot.name);
    return engine.runFlow(snapshot, dir, {
      cwd: out,
      stamp: '2026-09-02_10-00',
      snapshotIndex: i,
      auth: config.auth,
      storageState: storageStateFor(snapshot, session),
      secretValues: [PASS],
    });
  }

  const dashboardSteps = [
    { do: 'waitFor', selector: '[data-testid=dashboard-user]' },
    { do: 'extract', name: 'user', selector: '[data-testid=dashboard-user]' },
    { do: 'extract', name: 'source', selector: '[data-testid=session-source]' },
    { do: 'extract', name: 'logins', selector: '[data-testid=login-count]' },
  ];

  it('form login once → two snapshots logged in on fresh contexts, auth:false anonymous on the lane', async () => {
    const config = configOf(
      {
        storageState: './.scribe-devtools/auth.json',
        login: {
          url: app.url('login.html'),
          steps: [
            { do: 'fill', selector: '[data-testid=field-user]', valueFromEnv: 'APP_USER' },
            { do: 'fill', selector: '[data-testid=field-pass]', valueFromEnv: 'APP_PASS' },
            { do: 'click', selector: '[data-testid=login-submit]' },
            { do: 'waitFor', selector: '[data-testid=dashboard-user]' },
          ],
        },
      },
      [
        { name: 'pulpit', url: app.url('login.html'), steps: dashboardSteps },
        { name: 'pulpit-drugi', url: app.url('login.html'), steps: dashboardSteps },
        {
          name: 'gosc',
          url: app.url('login.html'),
          auth: false,
          steps: [
            { do: 'waitFor', selector: '[data-testid=dashboard-anonymous]' },
            { do: 'verify', kind: 'visible', selector: '[data-testid=login-form]' },
            { do: 'verify', kind: 'hidden', selector: '[data-testid=dashboard-user]' },
          ],
        },
      ],
    );
    let contexts = 0;
    const counting = {
      ...engine,
      freshContext: (/** @type {any} */ wanted) => {
        contexts += 1;
        return engine.freshContext(wanted);
      },
    };
    const values = { 'auth.login.steps[0].value': 'alice', 'auth.login.steps[1].value': PASS };
    const common = { engine: counting, baseDir: out, values, secretValues: [PASS], log: (l) => log.push(l) };

    // The keeper calls this once per batch; a second batch within maxAgeMinutes reuses the file.
    const session = await ensureSession(config.auth, common);
    expect(session).toMatchObject({
      method: 'login',
      reused: false,
      storageState: path.join(out, '.scribe-devtools', 'auth.json'),
    });
    expect(contexts).toBe(1);
    const state = JSON.parse(await readFile(session.storageState, 'utf8'));
    expect(state.cookies.some((c) => c.name === 'sid')).toBe(true);
    expect(state.origins[0].localStorage.some((e) => e.name === 'session' && e.value.includes('alice'))).toBe(true);

    const first = await flow(config, 0, session);
    expect(first.failure).toBeUndefined();
    expect(first.report.extracts.user.value).toBe('alice');
    expect(first.report.extracts.source.value).toBe('form');
    expect(first.report.extracts.logins.value).toBe('1');
    expect(first.report.timing.ctx).toBe('fresh');
    expect(first.report.engine.serviceWorkers).toBe('allow');

    const again = await ensureSession(config.auth, common);
    expect(again.reused).toBe(true);
    expect(contexts).toBe(1);
    const second = await flow(config, 1, again);
    expect(second.completed).toBe(true);
    expect(second.report.extracts.user.value).toBe('alice');
    expect(second.report.extracts.logins.value).toBe('1');
    expect(second.report.timing.ctx).toBe('fresh');

    const anonymous = await flow(config, 2, again);
    expect(anonymous.failure).toBeUndefined();
    expect(anonymous.completed).toBe(true);
    expect(anonymous.report.timing.ctx).toBe('reused');

    // The password went into the form and nowhere else: not the log, not the state, not a report.
    const artifacts = await Promise.all(
      [first, second, anonymous].flatMap((result) =>
        ['report.json', 'report.md', 'text.txt'].map((name) =>
          readFile(path.join(result.dir, name), 'utf8').catch(() => ''),
        ),
      ),
    );
    expect([...artifacts, log.join('\n'), JSON.stringify(state)].join('\n')).not.toContain(PASS);
  }, 60_000);

  it('OAuth password grant → token in storageState → the page shows the user from the JWT, no form', async () => {
    const config = configOf(
      {
        storageState: './.scribe-devtools/oauth.json',
        oauth: {
          keycloak: { url: idp.origin, realm: idp.realm },
          grantType: 'password',
          clientId: 'bi-public',
          usernameFromEnv: 'APP_USER',
          passwordFromEnv: 'APP_PASS',
          store: { origin: app.origin, key: 'access_token' },
        },
      },
      [{ name: 'token', url: app.url('login.html'), steps: dashboardSteps }],
    );
    const session = await ensureSession(config.auth, {
      baseDir: out,
      values: { 'auth.oauth.username': 'alice', 'auth.oauth.password': PASS },
      secretValues: [PASS],
      log: (l) => log.push(l),
    });
    expect(session.method).toBe('oauth');
    expect(idp.requests).toHaveLength(1);
    const result = await flow(config, 0, session);
    expect(result.failure).toBeUndefined();
    expect(result.report.extracts.user.value).toBe('alice');
    expect(result.report.extracts.source.value).toBe('token');
    expect(result.report.extracts.logins.value).toBe('0');
    expect(result.report.timing.ctx).toBe('fresh');
    expect(log.join('\n')).not.toContain(PASS);
  }, 30_000);
});
