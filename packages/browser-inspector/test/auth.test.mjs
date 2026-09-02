// auth.mjs without a browser (DESIGN.md §2.6, §3.3; AC-14): the pure parts (token URL, request
// body, storage state, freshness by mtime and by token expiry), `ensureSession` on the fake engine
// (the login steps go through the real RUNNERS on a FakePage; the state is saved once and reused)
// and against the Keycloak-shaped stub on port 4562 (WP7 owns 4561–4569). Secrets: every log line,
// error message and file is checked for the value — a test that logs a password is itself a leak.
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  AuthError,
  E_AUTH,
  TOKEN_EXPIRY_MARGIN_MS,
  ensureSession,
  metaPath,
  oauthRequestBody,
  oauthStorageState,
  oauthTokenUrl,
  resolveAuthValues,
  sessionUsable,
  storageStateFor,
  tokenExpiresAt,
  tokenUsable,
} from '../src/auth.mjs';
import { createEngine } from '../src/engine.mjs';
import { describeStep } from '../src/steps.schema.mjs';
import { startTokenServer } from '../fixtures/kc-token.mjs';
import { callsOf, createFakeBrowser } from './fake-browser.mjs';

const PORT_TOKEN = 4562;
const PORT_SILENT = 4564;
const PASS = 'wonderland-42';
const SECRET = 'service-secret-7';

/** @type {string[]} */
const dirs = [];
/** @type {{ close: () => Promise<void> }[]} */
const closers = [];

afterEach(async () => {
  for (const c of closers.splice(0)) await c.close();
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function tmp() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'browser-inspector-auth-'));
  dirs.push(dir);
  return dir;
}

/** @param {import('./fake-browser.mjs').FakeOptions} [fakeOptions] */
function fakeEngine(fakeOptions = {}) {
  const fake = createFakeBrowser(fakeOptions);
  const engine = createEngine({ launch: async () => fake, prewarm: false, env: {} });
  closers.push(engine);
  // The fake context RECORDS `storageState({ path })` without writing; the real one leaves the
  // file behind and `loginSession` renames it into place, so the fake has to leave bytes too.
  const wrapped = {
    ...engine,
    freshContext: async (/** @type {any} */ options) => {
      const pair = await engine.freshContext(options);
      const inner = pair.context.storageState.bind(pair.context);
      pair.context.storageState = async (/** @type {any} */ opts) => {
        const state = await inner(opts);
        if (opts?.path) await writeFile(opts.path, `${JSON.stringify(state)}\n`, 'utf8');
        return state;
      };
      return pair;
    },
  };
  return { fake, engine: wrapped, calls: fake.calls };
}

/** @param {number} [port] @param {import('../fixtures/kc-token.mjs').TokenServerOptions} [options] */
async function tokenServer(port = PORT_TOKEN, options = {}) {
  const server = await startTokenServer(port, options);
  closers.push(server);
  return server;
}

/** The login block of a config, as `loadConfig` normalizes it. @param {string} statePath */
const loginAuth = (statePath, extra = {}) => ({
  storageState: statePath,
  maxAgeMinutes: 60,
  reuse: true,
  login: {
    url: 'http://localhost:4561/login.html',
    steps: [
      { do: 'fill', selector: '[data-testid=field-user]', valueFromEnv: 'APP_USER' },
      { do: 'fill', selector: '[data-testid=field-pass]', valueFromEnv: 'APP_PASS' },
      { do: 'click', selector: '[data-testid=login-submit]' },
      { do: 'waitFor', selector: '[data-testid=dashboard-user]' },
    ],
    ...extra,
  },
});

/** Everything a test may inspect for a leaked secret, in one string. @param {string[]} log @param {unknown} extra */
const everything = (log, extra) => `${log.join('\n')}\n${JSON.stringify(extra)}`;

describe('oauthTokenUrl', () => {
  it('takes tokenUrl verbatim', () => {
    expect(oauthTokenUrl({ tokenUrl: 'https://idp.example/oauth/token' })).toBe('https://idp.example/oauth/token');
  });

  it('derives the Keycloak layout, without a double slash', () => {
    expect(oauthTokenUrl({ keycloak: { url: 'https://kc.example/', realm: 'app' } })).toBe(
      'https://kc.example/realms/app/protocol/openid-connect/token',
    );
    expect(oauthTokenUrl({ keycloak: { url: 'https://kc.example/auth', realm: 'my realm' } })).toBe(
      'https://kc.example/auth/realms/my%20realm/protocol/openid-connect/token',
    );
  });

  it('is an AuthError without either', () => {
    expect(() => oauthTokenUrl({})).toThrow(AuthError);
  });
});

describe('oauthRequestBody', () => {
  const password = {
    grantType: /** @type {const} */ ('password'),
    clientId: 'browser-inspector-public',
    usernameFromEnv: 'APP_USER',
    passwordFromEnv: 'APP_PASS',
    store: { origin: 'http://localhost:4561', key: 'access_token' },
  };

  it('password grant from the values the client resolved, in the address form auth.oauth.<field>', () => {
    const body = oauthRequestBody(password, {
      values: { 'auth.oauth.username': 'alice', 'auth.oauth.password': PASS },
    });
    expect(body).toEqual({
      grant_type: 'password',
      client_id: 'browser-inspector-public',
      username: 'alice',
      password: PASS,
    });
  });

  it('falls back to env by the *FromEnv names, values win over env', () => {
    const body = oauthRequestBody(
      { ...password, scope: 'openid profile' },
      { values: { 'auth.oauth.password': PASS }, env: { APP_USER: 'alice', APP_PASS: 'stale' } },
    );
    expect(body).toMatchObject({ username: 'alice', password: PASS, scope: 'openid profile' });
  });

  it('literal username, confidential client: client_secret rides along', () => {
    const body = oauthRequestBody(
      { ...password, username: 'alice', usernameFromEnv: undefined, clientSecretFromEnv: 'CLIENT_SECRET' },
      { env: { APP_PASS: PASS, CLIENT_SECRET: SECRET } },
    );
    expect(body).toEqual({
      grant_type: 'password',
      client_id: 'browser-inspector-public',
      username: 'alice',
      password: PASS,
      client_secret: SECRET,
    });
  });

  it('client_credentials grant needs only the secret', () => {
    const body = oauthRequestBody(
      {
        grantType: 'client_credentials',
        clientId: 'browser-inspector-service',
        clientSecretFromEnv: 'CLIENT_SECRET',
        store: password.store,
      },
      { env: { CLIENT_SECRET: SECRET } },
    );
    expect(body).toEqual({
      grant_type: 'client_credentials',
      client_id: 'browser-inspector-service',
      client_secret: SECRET,
    });
  });

  it('a missing variable is NAMED, the values that were there are not echoed', () => {
    let error;
    try {
      oauthRequestBody(password, { values: { 'auth.oauth.username': 'alice' }, env: { APP_PASS: '' } });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(AuthError);
    expect(error.code).toBe(E_AUTH);
    expect(error.message).toContain('APP_PASS');
    expect(error.message).toContain('passwordFromEnv');
    expect(error.message).not.toContain('alice');
  });
});

describe('oauthStorageState', () => {
  it('puts the token under the key the application reads, on its origin', () => {
    expect(oauthStorageState({ origin: 'http://localhost:4561', key: 'access_token' }, 'tok')).toEqual({
      cookies: [],
      origins: [{ origin: 'http://localhost:4561', localStorage: [{ name: 'access_token', value: 'tok' }] }],
    });
  });
});

describe('sessionUsable / tokenUsable / tokenExpiresAt', () => {
  const now = Date.parse('2026-09-02T10:00:00Z');

  it('no file, too old, fresh — with the age in the reason', () => {
    expect(sessionUsable(undefined, now, 60)).toEqual({ usable: false, reason: 'no saved session' });
    expect(sessionUsable({ mtimeMs: now - 61 * 60_000 }, now, 60)).toEqual({
      usable: false,
      reason: 'session older than 60 min (61 min)',
    });
    expect(sessionUsable({ mtimeMs: now - 12 * 60_000 }, now, 60)).toEqual({
      usable: true,
      reason: 'session from 12 min ago',
    });
    expect(sessionUsable({ mtimeMs: now - 60 * 60_000 }, now, 60).usable).toBe(true);
  });

  it('expires_in wins, then the JWT exp, else undefined', () => {
    const exp = Math.floor(now / 1000) + 120;
    const jwt = `x.${Buffer.from(JSON.stringify({ exp })).toString('base64url')}.y`;
    expect(tokenExpiresAt({ expires_in: 300, access_token: jwt }, now)).toBe(now + 300_000);
    expect(tokenExpiresAt({ access_token: jwt }, now)).toBe(exp * 1000);
    expect(tokenExpiresAt({ access_token: 'opaque-token' }, now)).toBeUndefined();
    expect(tokenExpiresAt({ access_token: 'a.not-json.c' }, now)).toBeUndefined();
    expect(tokenExpiresAt({}, now)).toBeUndefined();
  });

  it('a token inside the safety margin is already dead; no meta = usable by mtime alone', () => {
    expect(tokenUsable({ expiresAtMs: now + TOKEN_EXPIRY_MARGIN_MS - 1 }, now).usable).toBe(false);
    expect(tokenUsable({ expiresAtMs: now + TOKEN_EXPIRY_MARGIN_MS + 1000 }, now).usable).toBe(true);
    expect(tokenUsable(undefined, now).usable).toBe(true);
    expect(tokenUsable({ expiresAtMs: null }, now).usable).toBe(true);
  });
});

describe('resolveAuthValues / storageStateFor', () => {
  it('keeps what the client sent, fills the rest from env, names what is missing', () => {
    const base = loginAuth('s.json');
    const auth = loginAuth('s.json', {
      steps: [...base.login.steps, { do: 'form', fields: [{ selector: '#a', valueFromEnv: 'APP_OTP' }] }],
    });
    const resolved = resolveAuthValues(auth, {
      values: { 'auth.login.steps[1].value': 'from-client' },
      env: { APP_USER: 'alice', APP_PASS: 'from-env' },
    });
    expect(resolved.values).toEqual({
      'auth.login.steps[0].value': 'alice',
      'auth.login.steps[1].value': 'from-client',
    });
    expect(resolved.secretValues).toEqual(['alice', 'from-client']);
    expect(resolved.missing).toEqual(['APP_OTP (auth.login.steps[4].fields[0].value)']);

    const oauth = resolveAuthValues(
      {
        storageState: 's.json',
        oauth: {
          grantType: 'password',
          clientId: 'c',
          usernameFromEnv: 'U',
          passwordFromEnv: 'P',
          store: { origin: 'http://x', key: 'k' },
        },
      },
      { env: { U: 'alice', P: PASS } },
    );
    expect(oauth.values).toEqual({ 'auth.oauth.username': 'alice', 'auth.oauth.password': PASS });
    expect(oauth.missing).toEqual([]);
  });

  it('auth: false on a snapshot means no state file — the anonymous view', () => {
    const session = { storageState: '/tmp/s.json' };
    expect(storageStateFor({ auth: false }, session)).toBeUndefined();
    expect(storageStateFor({}, session)).toBe('/tmp/s.json');
    expect(storageStateFor({ auth: true }, undefined)).toBeUndefined();
  });
});

describe('ensureSession — login through the engine', () => {
  it('runs the steps on a fresh context with the client values, saves the state ONCE, reuses it next time', async () => {
    const dir = await tmp();
    const statePath = path.join(dir, '.scribe-devtools', 'auth.json');
    const { engine, calls } = fakeEngine();
    /** @type {string[]} */
    const log = [];
    const auth = loginAuth(statePath);
    const first = await ensureSession(auth, {
      engine,
      values: { 'auth.login.steps[0].value': 'alice', 'auth.login.steps[1].value': PASS },
      secretValues: [PASS],
      log: (line) => log.push(line),
    });
    expect(first).toMatchObject({
      storageState: statePath,
      method: 'login',
      reused: false,
      reason: 'no saved session',
    });
    expect(callsOf(calls, 'goto')[0][0]).toBe('http://localhost:4561/login.html');
    expect(callsOf(calls, 'fill')).toEqual([
      ['[data-testid=field-user]', 'alice', expect.anything()],
      ['[data-testid=field-pass]', PASS, expect.anything()],
    ]);
    expect(callsOf(calls, 'click')).toHaveLength(1);
    // Written beside the target and renamed onto it: a lane of another run reads this exact file
    // with `newContext({ storageState })`, and a truncate-in-place write can hand it half a JSON.
    const saved = callsOf(calls, 'storageState');
    expect(saved).toHaveLength(1);
    expect(saved[0][0].path).not.toBe(statePath);
    expect(existsSync(statePath)).toBe(true);
    expect(existsSync(saved[0][0].path)).toBe(false);
    expect(callsOf(calls, 'context.close')).toHaveLength(1);
    // A fresh context (never the scratch lane), with service workers allowed (DESIGN.md §2.3 point 7).
    expect(callsOf(calls, 'newContext').at(-1)?.[0]).toMatchObject({ serviceWorkers: 'allow' });
    expect(log.some((l) => l.startsWith('auth: login (no saved session) → http://localhost:4561/login.html'))).toBe(
      true,
    );
    expect(log.some((l) => l.includes('session saved'))).toBe(true);
    expect(everything(log, first)).not.toContain(PASS);
    expect(describeStep(auth.login.steps[1])).toBe('fill [data-testid=field-pass] (from env APP_PASS)');

    // The fake's storageState writes nothing — stand in for the file the real context writes.
    await writeFile(statePath, '{"cookies":[],"origins":[]}\n', 'utf8');
    const before = calls.length;
    const second = await ensureSession(auth, { engine, log: (line) => log.push(line) });
    expect(second).toMatchObject({ storageState: statePath, method: 'file', reused: true });
    expect(second.reason).toMatch(/^session from \d+ min ago$/u);
    expect(calls.length).toBe(before);
    expect(log.at(-1)).toContain('auth: session from file');
  });

  it('falls back to env for valueFromEnv when the client sent nothing; a missing variable fails before the browser', async () => {
    const dir = await tmp();
    const statePath = path.join(dir, '.scribe-devtools', 'auth.json');
    const { engine, calls } = fakeEngine();
    const auth = loginAuth(statePath);
    await expect(ensureSession(auth, { engine, env: {} })).rejects.toMatchObject({
      code: E_AUTH,
      message:
        'auth: environment variables not set: APP_USER (auth.login.steps[0].value), APP_PASS (auth.login.steps[1].value)',
    });
    expect(callsOf(calls, 'newContext')).toHaveLength(0);
    await ensureSession(auth, { engine, env: { APP_USER: 'alice', APP_PASS: PASS } });
    expect(callsOf(calls, 'fill')[1][1]).toBe(PASS);
  });

  it('a failing step is an AuthError naming the step, never the value; the context is closed', async () => {
    const dir = await tmp();
    const statePath = path.join(dir, '.scribe-devtools', 'auth.json');
    const { engine, calls } = fakeEngine({
      fail: { click: new Error(`element [data-testid=login-submit] is not attached (value ${PASS} typed)`) },
    });
    /** @type {string[]} */
    const log = [];
    let error;
    try {
      await ensureSession(loginAuth(statePath), {
        engine,
        env: { APP_USER: 'alice', APP_PASS: PASS },
        log: (l) => log.push(l),
      });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(AuthError);
    expect(error.message).toMatch(/^login failed at step 3 \(click \[data-testid=login-submit\]\): /u);
    expect(error.message).toContain('is not attached');
    expect(error.message).not.toContain(PASS);
    expect(error.step).toBe('click [data-testid=login-submit]');
    expect(callsOf(calls, 'storageState')).toHaveLength(0);
    expect(callsOf(calls, 'context.close')).toHaveLength(1);
    expect(everything(log, {})).not.toContain(PASS);
    expect(existsSync(statePath)).toBe(false);
  });

  it('an old file logs in again; reuse: false always logs in; the login needs an engine', async () => {
    const dir = await tmp();
    const statePath = path.join(dir, '.scribe-devtools', 'auth.json');
    await mkdir(path.dirname(statePath), { recursive: true });
    await writeFile(statePath, '{"cookies":[],"origins":[]}\n', 'utf8');
    const old = new Date(Date.now() - 2 * 3_600_000);
    await utimes(statePath, old, old);
    const { engine, calls } = fakeEngine();
    const stale = await ensureSession(loginAuth(statePath), { engine, env: { APP_USER: 'alice', APP_PASS: PASS } });
    expect(stale.reused).toBe(false);
    expect(stale.reason).toMatch(/^session older than 60 min \(1\d\d min\)$/u);
    expect(callsOf(calls, 'storageState')).toHaveLength(1);

    const now = new Date();
    await utimes(statePath, now, now);
    const forced = await ensureSession(
      { ...loginAuth(statePath), reuse: false },
      { engine, env: { APP_USER: 'alice', APP_PASS: PASS } },
    );
    expect(forced.reused).toBe(false);
    expect(callsOf(calls, 'storageState')).toHaveLength(2);

    await rm(statePath);
    await expect(ensureSession(loginAuth(statePath), { env: { APP_USER: 'alice', APP_PASS: PASS } })).rejects.toThrow(
      /auth\.login needs the engine/u,
    );
  });

  it('warns once when the state file lives outside .scribe-devtools/', async () => {
    const dir = await tmp();
    const statePath = path.join(dir, 'auth.json');
    const { engine } = fakeEngine();
    /** @type {string[]} */
    const log = [];
    await ensureSession(loginAuth(statePath), {
      engine,
      env: { APP_USER: 'alice', APP_PASS: PASS },
      log: (l) => log.push(l),
    });
    expect(log.filter((l) => l.includes('outside .scribe-devtools/'))).toHaveLength(1);
    expect(log.join('\n')).toContain('do not commit it');
  });
});

describe('ensureSession — OAuth against the Keycloak-shaped stub', () => {
  /** @param {string} statePath @param {Partial<import('../src/auth.mjs').OAuthConfig>} [extra] */
  const oauthAuth = (statePath, extra = {}) => ({
    storageState: statePath,
    maxAgeMinutes: 60,
    reuse: true,
    oauth: {
      keycloak: { url: `http://localhost:${String(PORT_TOKEN)}`, realm: 'browser-inspector' },
      grantType: /** @type {const} */ ('password'),
      clientId: 'browser-inspector-public',
      username: 'alice',
      passwordFromEnv: 'APP_PASS',
      store: { origin: 'http://localhost:4561', key: 'access_token' },
      ...extra,
    },
  });

  it('password grant → state file with the token under the store key + meta with the expiry; the second call reuses', async () => {
    const server = await tokenServer();
    const dir = await tmp();
    const statePath = path.join(dir, '.scribe-devtools', 'auth.json');
    /** @type {string[]} */
    const log = [];
    const t0 = Date.now();
    const info = await ensureSession(oauthAuth(statePath), {
      values: { 'auth.oauth.password': PASS },
      secretValues: [PASS],
      log: (l) => log.push(l),
    });
    expect(info).toMatchObject({ storageState: statePath, method: 'oauth', reused: false });
    expect(info.expiresAtMs).toBeGreaterThanOrEqual(t0 + 300_000);
    expect(server.requests).toEqual([
      {
        path: '/realms/browser-inspector/protocol/openid-connect/token',
        grant_type: 'password',
        client_id: 'browser-inspector-public',
        username: 'alice',
        hasSecret: false,
        hasPassword: true,
      },
    ]);
    const state = JSON.parse(await readFile(statePath, 'utf8'));
    expect(state.origins[0].origin).toBe('http://localhost:4561');
    expect(state.origins[0].localStorage[0].name).toBe('access_token');
    expect(state.origins[0].localStorage[0].value).toMatch(/^[\w-]+\.[\w-]+\.stub$/u);
    const meta = JSON.parse(await readFile(metaPath(statePath), 'utf8'));
    expect(meta.expiresAtMs).toBe(info.expiresAtMs);
    expect(log[0]).toBe(
      `auth: oauth password (no saved session) → http://localhost:${String(PORT_TOKEN)}/realms/browser-inspector/protocol/openid-connect/token`,
    );
    expect(everything(log, [info, state, meta])).not.toContain(PASS);

    const again = await ensureSession(oauthAuth(statePath), { log: (l) => log.push(l) });
    expect(again).toMatchObject({ method: 'file', reused: true, expiresAtMs: info.expiresAtMs });
    expect(again.reason).toMatch(/^session from \d+ min ago$/u);
    expect(server.requests).toHaveLength(1);
  });

  it('a token inside the expiry margin is fetched again although the file is young (expires_in and exp alike)', async () => {
    const server = await tokenServer(PORT_TOKEN, { expiresIn: 10 });
    const dir = await tmp();
    const statePath = path.join(dir, '.scribe-devtools', 'auth.json');
    const env = { APP_USER: 'alice', APP_PASS: PASS };
    await ensureSession(oauthAuth(statePath), { env });
    const second = await ensureSession(oauthAuth(statePath), { env });
    expect(second.reused).toBe(false);
    expect(second.reason).toMatch(/^token expired\/expiring \(/u);
    expect(server.requests).toHaveLength(2);
    await server.close();
    closers.pop();

    const expOnly = await tokenServer(PORT_TOKEN, { expiresIn: 10, omitExpiresIn: true });
    const other = path.join(dir, '.scribe-devtools', 'auth2.json');
    const first = await ensureSession(oauthAuth(other), { env });
    expect(first.expiresAtMs).toBeGreaterThan(Date.now());
    await ensureSession(oauthAuth(other), { env });
    expect(expOnly.requests).toHaveLength(2);
  });

  it('client_credentials with a plain tokenUrl and the secret from env', async () => {
    const server = await tokenServer();
    const dir = await tmp();
    const statePath = path.join(dir, '.scribe-devtools', 'auth.json');
    const info = await ensureSession(
      {
        storageState: statePath,
        oauth: {
          tokenUrl: server.tokenUrl,
          grantType: 'client_credentials',
          clientId: 'browser-inspector-service',
          clientSecretFromEnv: 'CLIENT_SECRET',
          store: { origin: 'http://localhost:4561', key: 'access_token' },
        },
      },
      { env: { CLIENT_SECRET: SECRET } },
    );
    expect(info.method).toBe('oauth');
    expect(server.requests[0]).toMatchObject({ path: '/token', grant_type: 'client_credentials', hasSecret: true });
  });

  it('wrong credentials: HTTP 401 with the OAuth error code, no secret in the message', async () => {
    await tokenServer();
    const dir = await tmp();
    const statePath = path.join(dir, '.scribe-devtools', 'auth.json');
    let error;
    try {
      await ensureSession(oauthAuth(statePath), { env: { APP_PASS: 'wrong-one' } });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(AuthError);
    expect(error.message).toMatch(
      /^OAuth http:\/\/localhost:4562\/realms\/browser-inspector\/protocol\/openid-connect\/token: HTTP 401 — /u,
    );
    expect(error.message).toContain('invalid_grant');
    expect(error.message).not.toContain('wrong-one');
    expect(existsSync(statePath)).toBe(false);
  });

  it('a 200 with HTML and a JSON without access_token are named errors, with the endpoint', async () => {
    const html = await tokenServer(PORT_TOKEN, {
      respond: () => ({ status: 200, headers: { 'content-type': 'text/html' }, body: '<html>login portal</html>' }),
    });
    const dir = await tmp();
    const statePath = path.join(dir, '.scribe-devtools', 'auth.json');
    await expect(ensureSession(oauthAuth(statePath), { env: { APP_USER: 'alice', APP_PASS: PASS } })).rejects.toThrow(
      /^OAuth http:\/\/localhost:4562\/.*: the response is not JSON: <html>login portal<\/html>$/u,
    );
    await html.close();
    closers.pop();

    await tokenServer(PORT_TOKEN, { respond: () => ({ status: 200, body: '{"token_type":"Bearer"}' }) });
    await expect(ensureSession(oauthAuth(statePath), { env: { APP_USER: 'alice', APP_PASS: PASS } })).rejects.toThrow(
      /the response has no access_token$/u,
    );
  });

  it('an endpoint that never answers is a timeout, not a hang', async () => {
    const silent = http.createServer(() => {
      // Never respond — the client's timeout has to end this.
    });
    await new Promise((resolve) => silent.listen(PORT_SILENT, '127.0.0.1', () => resolve(undefined)));
    closers.push({
      close: () =>
        new Promise((done) => {
          silent.closeAllConnections?.();
          silent.close(() => done());
        }),
    });
    const dir = await tmp();
    const statePath = path.join(dir, '.scribe-devtools', 'auth.json');
    const auth = oauthAuth(statePath, {
      keycloak: undefined,
      tokenUrl: `http://localhost:${String(PORT_SILENT)}/token`,
    });
    await expect(ensureSession(auth, { env: { APP_USER: 'alice', APP_PASS: PASS }, timeoutMs: 200 })).rejects.toThrow(
      /^OAuth http:\/\/localhost:4564\/token: no response after 200 ms$/u,
    );
  });
});
