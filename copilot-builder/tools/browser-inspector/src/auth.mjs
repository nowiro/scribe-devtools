// auth.mjs — log in ONCE, run every snapshot already logged in (DESIGN.md §2.3, §2.6, §3.3; a port
// of the auth block of the ALM tool's read-browser pipeline).
//
// Three ways to a `storageState` file (cookies + localStorage), one decision about its freshness:
//
//   file   — `auth.storageState` exists, is younger than `maxAgeMinutes` and (OAuth) its token has
//            not expired → reused as is, no browser, no network;
//   login  — `auth.login`: a fresh context from the engine, `goto login.url`, the `steps` through
//            the same RUNNERS a flow uses (`fill` only with `valueFromEnv` — a literal password in
//            a versioned config is a validation error upstream), `context.storageState({ path })`;
//   oauth  — `auth.oauth`: ONE POST to the token endpoint (`tokenUrl` or the Keycloak layout),
//            the access token written under the localStorage key the application reads it from.
//
// The difference between "browser-inspector can fill a login form" (any flow could, from day one) and "browser-inspector can log
// in" is this file: without it five snapshots are five logins, and with MFA or a lockout after N
// attempts, five failures. `auth: false` on a snapshot opts out — the anonymous view of the same
// run (`storageStateFor`), the way a permission gate is tested in both directions.
//
// Secrets: values come from the client under step addresses (`auth.login.steps[1].value`,
// `auth.oauth.password`) or, for a direct engine caller, from `env` by the `*FromEnv` names; they
// go into the page / the POST body and NOWHERE else — every log line, error message and thrown
// `AuthError` names a variable or a step, never a value, and passes through `redact()` on top.

import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { DEFAULT_VIEWPORT } from './isolation.mjs';
import { attachRecorder, errorMessage } from './recorder.mjs';
import { redact } from './redact.mjs';
import { describeStep } from './steps.schema.mjs';

/** @typedef {import('./types.js').Step} Step */
/** @typedef {import('./types.js').StepContext} StepContext */
/** @typedef {import('./types.js').StepResult} StepResult */
/** @typedef {import('./types.js').PageLike} PageLike */
/** @typedef {import('./types.js').ContextLike} ContextLike */

/**
 * @typedef {object} OAuthConfig
 * @property {string} [tokenUrl]
 * @property {{ url: string, realm: string }} [keycloak]
 * @property {'password' | 'client_credentials'} grantType
 * @property {string} clientId
 * @property {string} [scope]
 * @property {string} [username]
 * @property {string} [usernameFromEnv]
 * @property {string} [passwordFromEnv]
 * @property {string} [clientSecretFromEnv]
 * @property {{ origin: string, key: string }} store the localStorage slot the application reads the token from
 */

/**
 * @typedef {object} LoginConfig
 * @property {string} url
 * @property {Step[]} steps `fill` only with `valueFromEnv`
 * @property {string} [waitUntil]
 * @property {number} [stepTimeoutMs]
 * @property {number} [navTimeoutMs]
 */

/**
 * @typedef {object} AuthConfig
 * @property {string} storageState
 * @property {LoginConfig} [login]
 * @property {OAuthConfig} [oauth]
 * @property {number} [maxAgeMinutes]
 * @property {boolean} [reuse]
 */

/**
 * @typedef {object} SessionInfo
 * @property {string} storageState absolute path of the state file
 * @property {'file' | 'login' | 'oauth'} method how this call obtained it
 * @property {boolean} reused true when nothing was done (the file was fresh enough)
 * @property {string} reason the freshness verdict, for the log
 * @property {number} [expiresAtMs] OAuth only: when the token dies (`expires_in` / JWT `exp`)
 */

/**
 * The part of the engine the login path needs — the batch engine of `engine.mjs` satisfies it, a
 * test can hand in a stub.
 * @typedef {object} AuthEngine
 * @property {(wanted: any) => Promise<{ context: ContextLike, page: PageLike }>} freshContext `{ viewport }` — a spare or a new context with `serviceWorkers: 'allow'`
 * @property {(input: any) => StepContext & Record<string, any>} makeStepContext
 * @property {(ctx: any, step: Step, index: number) => Promise<StepResult>} runStep
 */

/**
 * @typedef {object} EnsureSessionOptions
 * @property {AuthEngine} [engine] required for `auth.login`
 * @property {string} [baseDir] `auth.storageState` is resolved against it (the config's directory); default cwd
 * @property {Record<string, string>} [values] resolved values by address, as the client sends them
 * @property {string[]} [secretValues] every value that came from env — redacted in every message
 * @property {Record<string, string | undefined>} [env] fallback for `*FromEnv` when the client did not resolve them
 * @property {(line: string) => void} [log]
 * @property {() => number} [now]
 * @property {typeof fetch} [fetch]
 * @property {number} [timeoutMs] OAuth request timeout (default `OAUTH_TIMEOUT_MS`)
 * @property {{ width: number, height: number }} [viewport]
 */

export const E_AUTH = 'E_AUTH';

/** A session that could not be obtained. Fatal for the run: every snapshot would show the login screen. */
export class AuthError extends Error {
  /** @param {string} message @param {string} [step] the login step that failed, for the report */
  constructor(message, step) {
    super(message);
    this.name = 'AuthError';
    this.code = E_AUTH;
    this.exit = 2;
    this.step = step;
  }
}

/** A token "valid for 10 more seconds" is dead for a run that takes longer than that. */
export const TOKEN_EXPIRY_MARGIN_MS = 30_000;
/** Every other step has an explicit timeout — the token endpoint must not be the one place that hangs silently. */
export const OAUTH_TIMEOUT_MS = 15_000;
const LOGIN_NAV_TIMEOUT_MS = 30_000;
const LOGIN_STEP_TIMEOUT_MS = 10_000;
const MAX_AGE_MINUTES_DEFAULT = 60;

// ── Pure parts ───────────────────────────────────────────────────────────────

/**
 * Whether a saved session is still worth reusing, by the file's age. Pure and separate because it
 * is the one decision here that can be wrong SILENTLY: too loose and runs go "logged in" on a dead
 * session (the report shows a login screen and nobody knows why), too tight and every run logs in.
 * @param {{ mtimeMs: number } | undefined} stat
 * @param {number} nowMs
 * @param {number} maxAgeMinutes
 * @returns {{ usable: boolean, reason: string }}
 */
export function sessionUsable(stat, nowMs, maxAgeMinutes) {
  if (!stat) return { usable: false, reason: 'no saved session' };
  const ageMinutes = (nowMs - stat.mtimeMs) / 60_000;
  if (ageMinutes > maxAgeMinutes) {
    return {
      usable: false,
      reason: `session older than ${String(maxAgeMinutes)} min (${String(Math.round(ageMinutes))} min)`,
    };
  }
  return { usable: true, reason: `session from ${String(Math.round(ageMinutes))} min ago` };
}

/**
 * When the token stops being valid: `expires_in` of the response, else the `exp` claim of a JWT,
 * else unknown. The second freshness decision that can lie silently — a real Keycloak gives an
 * access token 5 minutes by default, and `maxAgeMinutes: 60` by mtime would keep a dead token for
 * an hour.
 * @param {{ expires_in?: unknown, access_token?: unknown }} tokenResponse
 * @param {number} nowMs
 * @returns {number | undefined}
 */
export function tokenExpiresAt(tokenResponse, nowMs) {
  if (typeof tokenResponse.expires_in === 'number' && Number.isFinite(tokenResponse.expires_in)) {
    return nowMs + tokenResponse.expires_in * 1000;
  }
  if (typeof tokenResponse.access_token !== 'string') return undefined;
  const parts = tokenResponse.access_token.split('.');
  if (parts.length < 2) return undefined;
  try {
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    if (typeof claims.exp === 'number') return claims.exp * 1000;
  } catch {
    // Not a JWT — no data about validity is `undefined`, not a guess.
  }
  return undefined;
}

/**
 * Whether the saved token is still alive, with the safety margin. `meta` is the sidecar written next
 * to the state file by the OAuth path (`<state>.meta.json`).
 * @param {{ expiresAtMs?: unknown } | undefined} meta
 * @param {number} nowMs
 * @returns {{ usable: boolean, reason: string }}
 */
export function tokenUsable(meta, nowMs) {
  const expiresAtMs = meta?.expiresAtMs;
  if (typeof expiresAtMs !== 'number') return { usable: true, reason: 'token without a known expiry' };
  if (nowMs > expiresAtMs - TOKEN_EXPIRY_MARGIN_MS) {
    return { usable: false, reason: `token expired/expiring (${new Date(expiresAtMs).toISOString()})` };
  }
  return { usable: true, reason: `token valid until ${new Date(expiresAtMs).toISOString()}` };
}

/**
 * The token endpoint: verbatim, or derived from the standard Keycloak layout.
 * @param {Pick<OAuthConfig, 'tokenUrl' | 'keycloak'>} oauth
 * @returns {string}
 */
export function oauthTokenUrl(oauth) {
  if (oauth.tokenUrl) return oauth.tokenUrl;
  if (!oauth.keycloak) throw new AuthError('auth.oauth: tokenUrl or keycloak { url, realm } is required');
  const base = oauth.keycloak.url.replace(/\/+$/u, '');
  return `${base}/realms/${encodeURIComponent(oauth.keycloak.realm)}/protocol/openid-connect/token`;
}

/**
 * The address under which the client sends a resolved `auth.oauth.<field>FromEnv`
 * (docs/handoff/WP5.md): `auth.oauth.password`, `auth.oauth.clientSecret`, `auth.oauth.username`.
 * @param {string} field
 */
const oauthAddress = (field) => `auth.oauth.${field}`;

/**
 * The body of the token request. Pure: the resolved values and the env come in as parameters, so a
 * test never touches the process, and a missing variable is NAMED — like everywhere in this
 * repository — never echoed.
 * @param {OAuthConfig} oauth
 * @param {{ values?: Record<string, string>, env?: Record<string, string | undefined> }} [source]
 * @returns {Record<string, string>}
 */
export function oauthRequestBody(oauth, source = {}) {
  const values = source.values ?? {};
  const env = source.env ?? {};
  /** @param {string} field @param {string | undefined} envName */
  const need = (field, envName) => {
    const sent = values[oauthAddress(field)];
    if (sent !== undefined) return sent;
    if (envName === undefined || envName === '') {
      throw new AuthError(`auth.oauth: ${field}FromEnv is required for grant "${oauth.grantType}"`);
    }
    const value = env[envName];
    if (value === undefined || value === '') {
      throw new AuthError(`auth.oauth: environment variable ${envName} (${field}FromEnv) is not set`);
    }
    return value;
  };
  /** @type {Record<string, string>} */
  const body = { grant_type: oauth.grantType, client_id: oauth.clientId };
  if (oauth.scope) body.scope = oauth.scope;
  if (oauth.grantType === 'password') {
    body.username = oauth.username ?? need('username', oauth.usernameFromEnv);
    body.password = need('password', oauth.passwordFromEnv);
    if (oauth.clientSecretFromEnv || values[oauthAddress('clientSecret')] !== undefined) {
      body.client_secret = need('clientSecret', oauth.clientSecretFromEnv);
    }
  } else {
    body.client_secret = need('clientSecret', oauth.clientSecretFromEnv);
  }
  return body;
}

/**
 * A `storageState` built by hand: the token under the localStorage key the APPLICATION looks for.
 * That key is the only contract between the grant and the SPA — hence `store` is mandatory in the
 * config instead of guessed.
 * @param {{ origin: string, key: string }} store
 * @param {string} accessToken
 */
export function oauthStorageState(store, accessToken) {
  return {
    cookies: [],
    origins: [{ origin: store.origin, localStorage: [{ name: store.key, value: accessToken }] }],
  };
}

/**
 * The values the login steps and the OAuth grant need, under the addresses the engine's
 * `ctx.value()` and `oauthRequestBody` read. The client already sends `values` for everything with
 * `valueFromEnv` (DESIGN.md §2.4); a direct engine caller (bench, smoke, `runBatch`) has only the
 * env, so what the client did not send is taken from there. Returns what is still missing BY NAME,
 * so the caller can fail before touching a browser.
 * @param {AuthConfig} auth
 * @param {{ values?: Record<string, string>, env?: Record<string, string | undefined> }} [source]
 * @returns {{ values: Record<string, string>, secretValues: string[], missing: string[] }}
 */
export function resolveAuthValues(auth, source = {}) {
  const values = { ...(source.values ?? {}) };
  const env = source.env ?? {};
  /** @type {string[]} */
  const secretValues = [];
  /** @type {string[]} */
  const missing = [];
  /** @param {string} address @param {string} envName */
  const take = (address, envName) => {
    if (values[address] !== undefined) {
      secretValues.push(values[address]);
      return;
    }
    const value = env[envName];
    if (value === undefined || value === '') {
      missing.push(`${envName} (${address})`);
      return;
    }
    values[address] = value;
    secretValues.push(value);
  };
  if (auth.login) {
    auth.login.steps.forEach((step, j) => {
      const address = `auth.login.steps[${String(j)}]`;
      if (typeof step.valueFromEnv === 'string') take(`${address}.value`, step.valueFromEnv);
      if (Array.isArray(step.fields)) {
        step.fields.forEach((/** @type {Record<string, any>} */ field, /** @type {number} */ k) => {
          if (typeof field?.valueFromEnv === 'string')
            take(`${address}.fields[${String(k)}].value`, field.valueFromEnv);
        });
      }
    });
  }
  if (auth.oauth) {
    for (const [key, envName] of Object.entries(auth.oauth)) {
      if (key.endsWith('FromEnv') && typeof envName === 'string') {
        take(oauthAddress(key.slice(0, -'FromEnv'.length)), envName);
      }
    }
  }
  return { values, secretValues: [...new Set(secretValues)], missing };
}

/**
 * The state file a snapshot runs with: the session's, unless the snapshot asked for the anonymous
 * view (`auth: false`). The caller puts this in `laneOpts.storageState` — `needsFreshContext` makes
 * the same distinction for the context, this one for the file.
 * @param {{ auth?: unknown }} snapshot
 * @param {{ storageState: string } | undefined} session
 * @returns {string | undefined}
 */
export function storageStateFor(snapshot, session) {
  if (!session || snapshot.auth === false) return undefined;
  return session.storageState;
}

/** @param {AuthConfig} auth @param {string} [baseDir] */
export const resolveStatePath = (auth, baseDir) => path.resolve(baseDir ?? process.cwd(), auth.storageState);

/** The OAuth sidecar with the token's expiry — mtime alone lies when the IdP gives 5 minutes. */
export const metaPath = (/** @type {string} */ statePath) => `${statePath}.meta.json`;

/**
 * Write the session state so a reader never sees half of it. Both writers truncate their target
 * in place — `writeFile` here, `context.storageState({ path })` in playwright-core — and a lane
 * of another run opens exactly this file with `newContext({ storageState })`. A rename is atomic
 * on both platforms, so a concurrent reader gets the old file or the new one, never a prefix.
 * @param {string} file
 * @param {(target: string) => Promise<unknown>} write what puts the bytes at `target`
 * @returns {Promise<void>}
 */
async function writeAtomic(file, write) {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${String(process.pid)}.tmp`;
  await write(tmp);
  await rename(tmp, file);
}

// ── ensureSession ────────────────────────────────────────────────────────────

/**
 * Log in ONCE and save the `storageState` to disk; every snapshot of this run — and of the next
 * runs, until the session expires — starts already logged in. Never returns without a usable file
 * or an `AuthError` (`code: E_AUTH`): a silent failure here would surface twenty steps later as a
 * `waitFor` timeout on a login screen.
 * @param {AuthConfig} auth the normalized `config.auth` (`maxAgeMinutes`, `reuse` filled in by `loadConfig`)
 * @param {EnsureSessionOptions} [options]
 * @returns {Promise<SessionInfo>}
 */
export async function ensureSession(auth, options = {}) {
  const log = options.log ?? (() => {});
  const now = options.now ?? Date.now;
  const statePath = resolveStatePath(auth, options.baseDir);
  const maxAgeMinutes = auth.maxAgeMinutes ?? MAX_AGE_MINUTES_DEFAULT;
  const method = auth.oauth ? 'oauth' : 'login';

  const saved = await stat(statePath).catch(() => undefined);
  let verdict = sessionUsable(saved, now(), maxAgeMinutes);
  /** @type {number | undefined} */
  let expiresAtMs;
  if (verdict.usable && auth.oauth) {
    // For OAuth the mtime is not enough: the token carries its own lifetime and that one wins.
    const meta = await readFile(metaPath(statePath), 'utf8')
      .then((text) => /** @type {{ expiresAtMs?: unknown }} */ (JSON.parse(text)))
      .catch(() => undefined);
    const token = tokenUsable(meta, now());
    if (!token.usable) verdict = token;
    else if (typeof meta?.expiresAtMs === 'number') expiresAtMs = meta.expiresAtMs;
  }
  if (auth.reuse !== false && verdict.usable) {
    log(`auth: session from file ${statePath} (${verdict.reason})`);
    return { storageState: statePath, method: 'file', reused: true, reason: verdict.reason, expiresAtMs };
  }

  const resolved = resolveAuthValues(auth, { values: options.values, env: options.env });
  if (resolved.missing.length > 0) {
    throw new AuthError(
      `auth: environment variable${resolved.missing.length > 1 ? 's' : ''} not set: ${resolved.missing.join(', ')}`,
    );
  }
  const secretValues = [...new Set([...(options.secretValues ?? []), ...resolved.secretValues])];
  const clean = (/** @type {string} */ text) => redact(text, secretValues);

  if (auth.oauth) {
    const info = await oauthSession(auth.oauth, statePath, {
      values: resolved.values,
      env: options.env,
      log,
      now,
      fetch: options.fetch,
      timeoutMs: options.timeoutMs,
      clean,
      reason: verdict.reason,
    });
    warnIfOutside(statePath, log);
    return info;
  }
  if (!auth.login) throw new AuthError('auth: exactly one of "login" / "oauth" is required');
  if (!options.engine) throw new AuthError('auth.login needs the engine (a browser) — none was given');
  const info = await loginSession(auth.login, statePath, {
    engine: options.engine,
    values: resolved.values,
    secretValues,
    log,
    clean,
    reason: verdict.reason,
    baseDir: options.baseDir,
    viewport: options.viewport,
  });
  warnIfOutside(statePath, log);
  return info;
}

/**
 * The state file is live credentials — a commit with it is not a typo, it is a leak. `.browser-inspector/` is
 * in the repository's `.gitignore`; anywhere else gets one line in the log.
 * @param {string} statePath @param {(line: string) => void} log
 */
function warnIfOutside(statePath, log) {
  if (!statePath.replaceAll('\\', '/').includes('/.browser-inspector/')) {
    log(`auth: WARNING ${statePath} is outside .browser-inspector/ — a live session, do not commit it`);
  }
}

/**
 * OAuth without a browser: one POST to the token endpoint (Keycloak's shape), the token under the
 * localStorage key the application reads. No form, no rendering — the fastest and most robust
 * road WHEN the grant is enabled.
 * @param {OAuthConfig} oauth
 * @param {string} statePath
 * @param {{
 *   values: Record<string, string>, env?: Record<string, string | undefined>, log: (line: string) => void,
 *   now: () => number, fetch?: typeof fetch, timeoutMs?: number, clean: (text: string) => string, reason: string,
 * }} run
 * @returns {Promise<SessionInfo>}
 */
async function oauthSession(oauth, statePath, run) {
  const url = oauthTokenUrl(oauth);
  const body = new URLSearchParams(oauthRequestBody(oauth, { values: run.values, env: run.env })).toString();
  const doFetch = run.fetch ?? globalThis.fetch;
  const timeoutMs = run.timeoutMs ?? OAUTH_TIMEOUT_MS;
  run.log(`auth: oauth ${oauth.grantType} (${run.reason}) → ${url}`);
  const response = await doFetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body,
    signal: AbortSignal.timeout(timeoutMs),
  }).catch((error) => {
    const why = error?.name === 'TimeoutError' ? `no response after ${String(timeoutMs)} ms` : errorMessage(error);
    throw new AuthError(`OAuth ${url}: ${run.clean(why)}`);
  });
  const text = await response.text();
  if (!response.ok) {
    // The body of an OAuth error is the standard `{ error, error_description }` — no secrets, and
    // the difference between `invalid_grant` and `unauthorized_client` is a different fix.
    throw new AuthError(`OAuth ${url}: HTTP ${String(response.status)} — ${run.clean(text.slice(0, 200))}`);
  }
  /** @type {{ access_token?: unknown, expires_in?: unknown }} */
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    // A proxy or a login portal can answer 200 with HTML — a bare SyntaxError would not say WHICH endpoint.
    throw new AuthError(`OAuth ${url}: the response is not JSON: ${run.clean(text.slice(0, 120))}`);
  }
  const accessToken = payload?.access_token;
  if (typeof accessToken !== 'string' || accessToken === '') {
    throw new AuthError(`OAuth ${url}: the response has no access_token`);
  }
  await writeAtomic(statePath, (target) =>
    writeFile(target, `${JSON.stringify(oauthStorageState(oauth.store, accessToken), null, 2)}\n`, 'utf8'),
  );
  const expiresAtMs = tokenExpiresAt(payload, run.now());
  // The expiry straight from the response into the sidecar: the mtime would lie when the IdP gives
  // the token 5 minutes and `maxAgeMinutes` stands at 60.
  await writeAtomic(metaPath(statePath), (target) =>
    writeFile(
      target,
      `${JSON.stringify({ expiresAtMs: expiresAtMs ?? null, obtainedAt: new Date(run.now()).toISOString() }, null, 2)}\n`,
      'utf8',
    ),
  );
  run.log(`auth: session saved → ${statePath}`);
  return {
    storageState: statePath,
    method: 'oauth',
    reused: false,
    reason: run.reason,
    ...(expiresAtMs !== undefined ? { expiresAtMs } : {}),
  };
}

/**
 * The form login: a fresh context (never the scratch lane — the login page's storage must not
 * leak into the next anonymous run, and `serviceWorkers: 'allow'` keeps a PWA login intact), the
 * steps through the engine's `runStep` (same RUNNERS, same deadline, same `ctx.value()` addressing
 * as a flow), then `context.storageState({ path })`.
 * @param {LoginConfig} login
 * @param {string} statePath
 * @param {{
 *   engine: AuthEngine, values: Record<string, string>, secretValues: string[], log: (line: string) => void,
 *   clean: (text: string) => string, reason: string, baseDir?: string, viewport?: { width: number, height: number },
 * }} run
 * @returns {Promise<SessionInfo>}
 */
async function loginSession(login, statePath, run) {
  run.log(`auth: login (${run.reason}) → ${login.url}`);
  const { context, page } = await run.engine.freshContext({ viewport: run.viewport ?? { ...DEFAULT_VIEWPORT } });
  try {
    const cdp = await Promise.resolve()
      .then(() => context.newCDPSession(page))
      .catch(() => ({ send: async () => undefined }));
    const ctx = run.engine.makeStepContext({
      page,
      context,
      cdp,
      // No bodies: the login context is thrown away right after and nobody ever calls `settle()`
      // on this recorder, so a body read would be left dangling in a context that no longer exists.
      recorder: attachRecorder(page, { captureBodies: false }),
      dir: path.dirname(statePath),
      timeoutMs: login.stepTimeoutMs ?? LOGIN_STEP_TIMEOUT_MS,
      mode: 'batch',
      snapshot: { waitUntil: login.waitUntil ?? 'load', settleMs: 2000 },
      values: run.values,
      secretValues: run.secretValues,
      cwd: run.baseDir,
    });
    try {
      await ctx.navigate(login.url, login.waitUntil ?? 'load', login.navTimeoutMs ?? LOGIN_NAV_TIMEOUT_MS);
    } catch (error) {
      throw new AuthError(`login: navigation to ${login.url} failed: ${run.clean(errorMessage(error))}`);
    }
    for (const [index, step] of login.steps.entries()) {
      ctx.address = `auth.login.steps[${String(index)}]`;
      const result = await run.engine.runStep(ctx, step, index);
      if (!result.ok) {
        // A login failure must be loud: without the session every next snapshot shows the login
        // screen and the "failed step" lands twenty lines lower, in a different place entirely.
        const description = result.description ?? describeStep(step);
        throw new AuthError(
          `login failed at step ${String(index + 1)} (${description}): ${run.clean(result.error ?? 'unknown error')}`,
          description,
        );
      }
    }
    await writeAtomic(statePath, (target) => context.storageState({ path: target }));
    run.log(`auth: session saved → ${statePath}`);
    return { storageState: statePath, method: 'login', reused: false, reason: run.reason };
  } finally {
    await context.close().catch(() => {});
  }
}
