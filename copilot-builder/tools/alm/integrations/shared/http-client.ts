/**
 * Tiny HTTP client over native fetch. Owns the cross-cutting concerns so each
 * pipeline's fetch functions stay one-liners:
 *
 *   1. **Auth header injection** built out of band — the Authorization value
 *      never enters the rest of the codebase, never reaches the logger.
 *   2. **Timeouts** (default 15 s, override per request) covering the body
 *      read as well as the headers — a stalled body is a hang, not a success.
 *   3. **SSRF guard** — outbound URL must resolve to a hostname that is NOT
 *      loopback / link-local / RFC1918 (unless `EXTRACT_ALLOW_PRIVATE_HOSTS=true`),
 *      re-checked on **every redirect hop**. Credentials are dropped the moment
 *      a hop leaves the configured origin, and stay dropped for the rest of the
 *      chain even if a later hop points back at it.
 *   4. **Retry + jittered backoff** on `429` and `5xx` (3 tries by default,
 *      honours `Retry-After` seconds or HTTP-date).
 *   5. **In-flight request dedup** — identical idempotent (GET/HEAD) requests
 *      issued in parallel are coalesced into ONE upstream call. The follow-ups
 *      await the first promise and get the same body. This is the answer to
 *      "the same query fires 3× in a row" loops.
 *   6. **ETag/304 cache** — server returns an ETag → we store body (up to 256 KB:
 *      a run fetches each resource URL once, so caching bigger bodies only pinned
 *      megabytes that could never produce a 304). Next call sends `If-None-Match`;
 *      a 304 returns the cached body without re-parsing.
 *   7. **Response body cap** — refuse to buffer > `MAX_BODY_BYTES` (50 MB).
 *   8. **Concurrency cap** — at most `EXTRACT_HTTP_CONCURRENCY` requests in flight
 *      per client, held until the body is fully read.
 *
 * JSON in, JSON out — nothing else. The text response mode, the multipart branch,
 * the per-request header escape hatch and the caller AbortSignal all belonged to
 * MCP-era callers deleted with the servers; they survived here as surface every
 * reader had to reason about and no pipeline could trigger.
 *
 * Keep this file dependency-free: it runs on `fetch`, and nothing else. That is
 * also why there is no proxy plumbing here — Node honours `HTTPS_PROXY` /
 * `HTTP_PROXY` / `NO_PROXY` for global `fetch` natively when started with
 * `NODE_USE_ENV_PROXY=1`. An earlier revision carried ~90 lines of undici
 * `ProxyAgent` wiring that could never run, because `undici` is not a
 * dependency of this repository and the lazy `require` always threw.
 */
import { randomInt } from 'node:crypto';
import { isIP } from 'node:net';

import { AuthError, NetworkError, NotFoundError, RateLimitError, SecurityError, UpstreamError } from './errors.js';
import { LruCache } from './lru-cache.js';
import { getCorrelationId, getRunUser } from './run-identity.js';
import { createHttpLogger, type HttpLogger } from './http-log.js';
import { getRepoVersion } from './version.js';
import { authHeaderFor, type AuthConfig } from './auth.js';

/** Hard ceiling on a single response body before we abort. */
const MAX_BODY_BYTES = 50 * 1024 * 1024; // 50 MB
/** Statuses whose upstream body carries an actionable reason worth surfacing to the agent. */
const ERROR_DETAIL_STATUSES = new Set([400, 409, 422]);
/** Max chars of upstream error body echoed into the thrown error message. */
const ERROR_DETAIL_MAX_CHARS = 500;
/** Number of retry attempts on 429 / 5xx (the initial call counts as 1). */
const MAX_ATTEMPTS = 3;
/** Cap on Retry-After honour — runaway upstream should not block us forever. */
const MAX_RETRY_AFTER_MS = 30_000;
/** Default jitter window for exponential backoff (base × 2^attempt + rand 0..jitter). */
const BACKOFF_BASE_MS = 250;
const BACKOFF_JITTER_MS = 250;
/** ETag / 304 cache: 200 entries × 10 min TTL — plenty for field-registry & project lists. */
const ETAG_CACHE_CAPACITY = 200;
const ETAG_CACHE_TTL_MS = 10 * 60 * 1000;
/**
 * Bodies above this size are served but never CACHED: the entry count bounds the
 * cache, not its bytes, and 200 pinned 1-2 MB page bodies were enough to OOM a
 * small CI container — for entries whose hit rate is zero, because a read run
 * requests each resource URL exactly once.
 */
const ETAG_MAX_CACHED_BODY_BYTES = 256 * 1024;
/** Default max concurrent in-flight upstream requests per HttpClient. Tunable via EXTRACT_HTTP_CONCURRENCY. */
const DEFAULT_CONCURRENCY = 6;

function resolveConcurrency(): number {
  const raw = process.env['EXTRACT_HTTP_CONCURRENCY'];
  if (!raw) return DEFAULT_CONCURRENCY;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_CONCURRENCY;
  return Math.floor(parsed);
}

/**
 * Tiny FIFO semaphore. Counts permits; if exhausted, `acquire()` parks the
 * caller on a queue until `release()` is called. Used to prevent a single
 * `extract` pulling 50 pages in parallel from spinning up 50 sockets at once.
 */
class Semaphore {
  private permits: number;
  private readonly queue: (() => void)[] = [];

  constructor(permits: number) {
    this.permits = permits;
  }

  async acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits -= 1;
      return;
    }
    await new Promise<void>((resolve) => this.queue.push(resolve));
  }

  release(): void {
    const next = this.queue.shift();
    if (next) {
      next();
    } else {
      this.permits += 1;
    }
  }
}

/** Lightweight view of a successful upstream response, for callers that need headers. */
export interface ResponseMeta {
  readonly status: number;
  /** Case-insensitive response header accessor — e.g. `header('x-next-page')`. */
  readonly header: (name: string) => string | null;
}

export interface HttpRequest {
  readonly method?: 'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  readonly path: string;
  readonly query?: Record<string, string | number | boolean | undefined>;
  readonly body?: unknown;
  readonly timeoutMs?: number;
  /**
   * Declares a non-GET request safe to REPLAY, opting it into the 5xx/network
   * retry that GET/HEAD get by default. For reads that must travel as POST —
   * xray's GraphQL queries — the method alone misclassifies them as writes, and
   * the one read pipeline lost all retry resilience. Affects ONLY the retry
   * decision: caching and in-flight dedup stay method-keyed, because their
   * `method + url` key ignores the body and would coalesce two different queries.
   */
  readonly idempotent?: boolean;
  /** Set to `false` to bypass in-flight dedup + ETag cache for this call. Defaults to `true` for GET/HEAD. */
  readonly cache?: boolean;
  /**
   * Invoked once on the success path (2xx) with the response status + a header
   * accessor — the escape hatch for header-driven pagination (GitLab `x-next-page`).
   * Not called for 304 cache hits, so pair it with `cache: false` when the headers
   * must be fresh every page.
   */
  readonly onResponseMeta?: (meta: ResponseMeta) => void;
}

export interface HttpClient {
  request<T>(req: HttpRequest): Promise<T>;
}

export interface HttpClientOptions {
  /** Full client identifier — e.g. `extract-jira/1.2.0`. Sent as `User-Agent` per RFC 7231. */
  readonly userAgent: string;
  /** Client name without version — e.g. `extract-jira`. Sent as `X-Extract-Client`. */
  readonly clientName: string;
  /** Client semver — e.g. `1.2.0`. Sent as `X-Extract-Version`. */
  readonly clientVersion: string;
}

/**
 * Join `baseUrl` with a request path, **preserving any path prefix on the base**.
 *
 * The naive `new URL('/projects/1', 'https://gitlab.com/api/v4')` resolves to
 * `https://gitlab.com/projects/1` — the base's path is discarded, because a
 * leading slash means "site root". That silently pointed every GitLab request at
 * the HTML site instead of the REST API, and it would do the same to any
 * self-hosted instance mounted under a sub-path (`https://host/sonarqube`).
 * Atlassian bases carry no prefix, so nothing changes for Jira/Confluence.
 */
export function buildUrl(baseUrl: string, path: string, query?: HttpRequest['query']): string {
  const base = new URL(baseUrl);
  const prefix = base.pathname.replace(/\/+$/, '');
  const suffix = path.startsWith('/') ? path : `/${path}`;
  const url = new URL(`${prefix}${suffix}`, base);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined) continue;
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

const SPECIAL_PRIVATE_HOSTS = new Set(['localhost', '0.0.0.0', '::1', '::']);

/**
 * Block link-local + loopback + RFC1918 unless explicitly allowed. Exported for the
 * ONE request that legitimately runs outside this client — xray's pre-auth token
 * bootstrap — so even that call passes the same SSRF gate. Throws NetworkError.
 */
export function assertHostnameAllowed(url: string): void {
  if (process.env['EXTRACT_ALLOW_PRIVATE_HOSTS']?.toLowerCase() === 'true') return;
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    throw new NetworkError(`invalid URL: ${url}`);
  }
  // `new URL().hostname` wraps IPv6 literals in square brackets (e.g. `[::1]`,
  // `[fc00::1]`, `[::ffff:7f00:1]`). Strip them so the special-host set and the
  // IPv6 prefix checks below see the bare address.
  if (host.startsWith('[') && host.endsWith(']')) {
    host = host.slice(1, -1);
  }
  // A trailing dot is the fully-qualified form of the SAME name: `localhost.`
  // resolves to loopback exactly as `localhost` does, and DNS treats them as
  // one. Without this the set lookup below compares the wrong string and the
  // guard waves the request through.
  if (host.length > 1 && host.endsWith('.')) {
    host = host.slice(0, -1);
  }
  if (SPECIAL_PRIVATE_HOSTS.has(host.toLowerCase())) {
    throw new NetworkError(`SSRF guard: refusing to call ${host}`);
  }
  const v4Reason = ipv4PrivateReason(host);
  if (v4Reason) throw new NetworkError(`SSRF guard: ${v4Reason} ${host}`);
  // IPv6-only checks. Guard with `isIP === 6` so real DNS names like
  // `fcm.googleapis.com` / `fd-xxx.example.com` are NOT caught by the fc/fd/fe80
  // ULA + link-local prefix tests below.
  if (isIP(host) === 6) {
    const v6Reason = ipv6PrivateReason(host);
    if (v6Reason) throw new NetworkError(`SSRF guard: ${v6Reason} ${host}`);
  }
}

/** Returns the SSRF reason if the host is a private/loopback/link-local IPv6; `undefined` otherwise. */
function ipv6PrivateReason(host: string): string | undefined {
  const lower = host.toLowerCase();
  // IPv4-mapped IPv6 (`::ffff:a.b.c.d` or `::ffff:7f00:1`) — defer to the IPv4 rules.
  const mapped = /^::ffff:(.+)$/.exec(lower)?.[1];
  if (mapped !== undefined) {
    if (isIP(mapped) === 4) return ipv4PrivateReason(mapped);
    // Hex-rendered IPv4-mapped form, e.g. `::ffff:7f00:1` → 127.0.0.1.
    const hex = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(mapped);
    if (hex) {
      const high = Number.parseInt(hex[1] ?? '', 16);
      const low = Number.parseInt(hex[2] ?? '', 16);
      const dotted = `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`;
      return ipv4PrivateReason(dotted);
    }
  }
  if (lower.startsWith('fe80:')) return 'link-local IPv6 host';
  if (lower.startsWith('fc') || lower.startsWith('fd')) return 'private IPv6 host';
  return undefined;
}

/** Returns the SSRF reason if the host is a private IPv4; `undefined` otherwise. */
function ipv4PrivateReason(host: string): string | undefined {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!match) return undefined;
  const a = Number(match[1]);
  const b = Number(match[2]);
  if (a === 127) return 'loopback host';
  if (a === 10) return 'RFC1918 host';
  if (a === 169 && b === 254) return 'link-local host';
  if (a === 172 && b >= 16 && b <= 31) return 'RFC1918 host';
  if (a === 192 && b === 168) return 'RFC1918 host';
  if (a === 0) return 'invalid host';
  return undefined;
}

/** Parse `Retry-After` — accepts seconds OR an HTTP-date. Returns ms (capped). */
function parseRetryAfter(value: string | null): number {
  if (!value) return 0;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, MAX_RETRY_AFTER_MS);
  const ms = Date.parse(value) - Date.now();
  if (Number.isFinite(ms) && ms > 0) return Math.min(ms, MAX_RETRY_AFTER_MS);
  return 0;
}

function backoffDelayMs(attempt: number, retryAfter: number): number {
  if (retryAfter > 0) return retryAfter;
  const exponential = BACKOFF_BASE_MS * 2 ** attempt;
  // `randomInt` is overkill for jitter but keeps sonarjs/pseudo-random happy and
  // costs effectively nothing on this hot path.
  const jitter = randomInt(0, BACKOFF_JITTER_MS);
  return exponential + jitter;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

interface CachedResponse {
  readonly etag: string;
  readonly body: string;
}

/** Per-client cache + in-flight map; both live as long as the HttpClient itself. */
interface ClientState {
  readonly etagCache: LruCache<CachedResponse>;
  readonly inflight: Map<string, Promise<unknown>>;
  readonly semaphore: Semaphore;
  /** JSONL z kazda proba i odpowiedzia — patrz http-log.ts (sekrety nie maja tam wstepu). */
  readonly httpLog: HttpLogger;
}

/**
 * Convenience wrapper over `createHttpClient` with the conventional headers that
 * identify the producer. Every pipeline sets the identical options shape —
 * `userAgent = ${name}/${version}` + `clientName = name` + `clientVersion =
 * version` — so passing `name` (e.g. `extract-jira`) is enough; the rest is
 * derived from `getRepoVersion()`.
 *
 * If custom options are needed (e.g. a different User-Agent), use
 * `createHttpClient` directly.
 */
export function createNamedHttpClient(name: string, auth: AuthConfig): HttpClient {
  const version = getRepoVersion();
  return createHttpClient(auth, {
    userAgent: `${name}/${version}`,
    clientName: name,
    clientVersion: version,
  });
}

export function createHttpClient(auth: AuthConfig, options: HttpClientOptions): HttpClient {
  const authHeader = authHeaderFor(auth);
  const state: ClientState = {
    etagCache: new LruCache<CachedResponse>(ETAG_CACHE_CAPACITY, ETAG_CACHE_TTL_MS),
    inflight: new Map(),
    semaphore: new Semaphore(resolveConcurrency()),
    httpLog: createHttpLogger(options.clientName),
  };

  return {
    async request<T>(req: HttpRequest): Promise<T> {
      const method = req.method ?? 'GET';
      const isIdempotent = method === 'GET' || method === 'HEAD';
      const cacheable = isIdempotent && req.cache !== false;
      const url = buildUrl(auth.baseUrl, req.path, req.query);
      assertHostnameAllowed(url);

      // ─ In-flight dedup ─────────────────────────────────────────────────────
      // Identical concurrent GETs share one upstream round-trip. The follow-ups
      // await the in-flight promise and receive the parsed body of the first.
      const cacheKey = cacheable ? `${method} ${url}` : undefined;
      if (cacheKey) {
        const inflight = state.inflight.get(cacheKey) as Promise<T> | undefined;
        if (inflight) {
          return inflight;
        }
      }

      const promise = executeWithCleanup<T>(auth, authHeader, options, state, req, url, method, cacheable, cacheKey);
      if (cacheKey) state.inflight.set(cacheKey, promise);
      return promise;
    },
  };
}

interface AuthHeader {
  readonly name: string;
  readonly value: string;
}

/** Wrap `executeRequest` with cache cleanup that survives rejection. */
async function executeWithCleanup<T>(
  auth: AuthConfig,
  authHeader: AuthHeader,
  options: HttpClientOptions,
  state: ClientState,
  req: HttpRequest,
  url: string,
  method: string,
  cacheable: boolean,
  cacheKey: string | undefined,
): Promise<T> {
  try {
    return await executeRequest<T>(auth, authHeader, options, state, req, url, method, cacheable);
  } finally {
    if (cacheKey) state.inflight.delete(cacheKey);
  }
}

/** Single-attempt-with-retries body. Split out so dedup wraps it cleanly. */
async function executeRequest<T>(
  auth: AuthConfig,
  authHeader: AuthHeader,
  options: HttpClientOptions,
  state: ClientState,
  req: HttpRequest,
  url: string,
  method: string,
  cacheable: boolean,
): Promise<T> {
  let attempt = 0;

  const retryable = method === 'GET' || method === 'HEAD' || req.idempotent === true;
  while (attempt < MAX_ATTEMPTS) {
    try {
      return await singleAttempt<T>(auth, authHeader, options, state, req, url, method, cacheable, attempt + 1);
    } catch (error: unknown) {
      const delay = retryDelayFor(error, attempt, retryable);
      if (delay === undefined) {
        throw error;
      }
      await sleep(delay);
      attempt += 1;
    }
  }
  // Unreachable — the last attempt re-throws via `delay === undefined`.
  throw new UpstreamError(0, `${auth.tool} ${req.path}: max retries exhausted`);
}

/** Return ms to wait before next attempt, or `undefined` to give up. */
function retryDelayFor(error: unknown, attempt: number, retryable: boolean): number | undefined {
  if (attempt >= MAX_ATTEMPTS - 1) return undefined;
  // 429 is retryable for EVERY method: a rate-limited request was rejected before it was
  // processed, so re-sending cannot double a write.
  if (error instanceof RateLimitError) {
    return backoffDelayMs(attempt, (error.retryAfterSeconds ?? 0) * 1000);
  }
  // 5xx and network failures are ambiguous — the server may have committed before the
  // response was lost. Re-sending a POST/PUT there published duplicate issues, comments
  // and pages, so only requests that cannot double a write — GET/HEAD, or a request
  // DECLARED replay-safe via `idempotent: true` (a GraphQL read) — are retried.
  if (!retryable) return undefined;
  if (error instanceof UpstreamError && error.statusCode >= 500) {
    return backoffDelayMs(attempt, 0);
  }
  if (error instanceof NetworkError) {
    return backoffDelayMs(attempt, 0);
  }
  return undefined;
}

/** Redirect-hop ceiling for manual following. One hop is the realistic maximum; five is slack. */
const MAX_REDIRECT_HOPS = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

async function singleAttempt<T>(
  auth: AuthConfig,
  authHeader: AuthHeader,
  options: HttpClientOptions,
  state: ClientState,
  req: HttpRequest,
  url: string,
  method: string,
  cacheable: boolean,
  attempt: number,
): Promise<T> {
  // Log per PROBA, nie per zadanie logiczne: retry maja byc widoczne jako osobne
  // linie, bo "3x 503 i sukces" a "sukces" to rozne fakty o upstreamie.
  const startedAt = performance.now();
  let loggedStatus: number | undefined;
  let loggedResponseBytes: number | undefined;
  const logOutcome = (error?: unknown): void => {
    state.httpLog.log({
      script: options.clientName,
      correlationId: getCorrelationId(),
      attempt,
      method,
      url,
      ...(req.body !== undefined ? { requestBytes: Buffer.byteLength(JSON.stringify(req.body), 'utf8') } : {}),
      ...(loggedStatus !== undefined ? { status: loggedStatus } : {}),
      durationMs: Math.round(performance.now() - startedAt),
      ...(loggedResponseBytes !== undefined ? { responseBytes: loggedResponseBytes } : {}),
      ...(error !== undefined ? { error } : {}),
    });
  };
  const cacheEntryKey = `${method} ${url}`;
  const cached = cacheable ? state.etagCache.get(cacheEntryKey) : undefined;
  const label = `${auth.tool} ${req.path}`;

  // The permit is taken FIRST, and only then is the deadline armed. Arming it
  // before the queue makes `timeoutMs` cover the wait for a permit, so lowering
  // `EXTRACT_HTTP_CONCURRENCY` — the knob for being gentle with a rate-limited
  // instance — starts aborting requests against a perfectly healthy server, and
  // reporting it as a network timeout. The permit is then held until the body is
  // fully read: releasing it on headers bounds only the handshake and lets an
  // unbounded number of bodies stream.
  await state.semaphore.acquire();
  // One deadline for the whole exchange — headers AND body. Clearing the timer
  // when the headers land (as this used to) leaves a stalled body with no
  // deadline at all, which is a hang, not a slow request.
  const timeout = startRequestTimeout(req);
  try {
    const response = await fetchFollowingRedirects({
      auth,
      authHeader,
      options,
      req,
      url,
      method,
      etag: cached?.etag,
      signal: timeout.signal,
    });

    loggedStatus = response.status;
    if (response.status === 304 && cached) {
      loggedResponseBytes = Buffer.byteLength(cached.body, 'utf8');
      logOutcome();
      return parseBody(cached.body) as T;
    }
    if (response.status === 304) {
      // No `If-None-Match` was sent, so a 304 is an upstream fault — falling through
      // would parse an empty body into `undefined` and hand the caller silent nothing.
      throw new UpstreamError(304, `${auth.tool} ${req.path}: 304 without a stored ETag`);
    }
    if (!response.ok) {
      const wantDetail = ERROR_DETAIL_STATUSES.has(response.status);
      const detail = wantDetail ? await readErrorDetail(response) : '';
      // A body nobody reads pins the keep-alive socket until GC — a 429/5xx retry
      // loop abandoned one per attempt while the semaphore thought permits were free.
      if (!wantDetail) await response.body?.cancel().catch(() => undefined);
      rejectByStatus(response, auth.tool, req.path, detail);
    }

    const body = await readBodyCapped(response, label);
    loggedResponseBytes = Buffer.byteLength(body, 'utf8');
    logOutcome();
    req.onResponseMeta?.({ status: response.status, header: (name) => response.headers.get(name) });
    // byteLength, not .length: string length counts UTF-16 code units, and Polish
    // page bodies at 2-3 UTF-8 bytes per character quietly doubled the byte budget
    // the OOM fix promised.
    if (cacheable && Buffer.byteLength(body, 'utf8') <= ETAG_MAX_CACHED_BODY_BYTES) {
      const etag = response.headers.get('etag');
      if (etag) state.etagCache.set(cacheEntryKey, { etag, body });
    }
    return parseBody(body) as T;
  } catch (error) {
    logOutcome(error);
    throw error;
  } finally {
    state.semaphore.release();
    timeout.cancel();
  }
}

interface RequestTimeout {
  readonly signal: AbortSignal;
  readonly cancel: () => void;
}

/**
 * Default per-request deadline. Exported so the ONE call outside this client —
 * xray's auth bootstrap — uses the same number instead of restating it.
 */
export const DEFAULT_TIMEOUT_MS = 15_000;

/** Arm one deadline for the whole request. */
function startRequestTimeout(req: HttpRequest): RequestTimeout {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, req.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  return {
    signal: controller.signal,
    cancel: () => {
      clearTimeout(timer);
    },
  };
}

interface FetchAttempt {
  readonly auth: AuthConfig;
  readonly authHeader: AuthHeader;
  readonly options: HttpClientOptions;
  readonly req: HttpRequest;
  readonly url: string;
  readonly method: string;
  readonly etag: string | undefined;
  readonly signal: AbortSignal;
}

/**
 * Issue the request, following redirects **manually**.
 *
 * `fetch` follows them by itself, and that is precisely the problem: the
 * redirect target never reaches {@link assertHostnameAllowed}, so an upstream
 * that answers `302 Location: http://169.254.169.254/…` walks the client
 * straight through the SSRF guard it just passed. Undici also only strips
 * `authorization` / `cookie` / `proxy-authorization` across origins — a custom
 * credential header such as Figma's `x-figma-token` would be handed to whoever
 * the redirect names.
 *
 * So: every hop is re-checked, and credentials go only to the configured origin.
 */
async function fetchFollowingRedirects(attempt: FetchAttempt): Promise<Response> {
  const { auth, req } = attempt;
  const baseOrigin = new URL(auth.baseUrl).origin;
  let url = attempt.url;
  let method = attempt.method;
  let body = req.body;
  // Once the credential has been withheld from a hop it stays withheld for the
  // rest of the chain. Recomputing "same origin?" per hop would re-attach it if
  // an off-origin redirector pointed back at the configured host — which would
  // let that redirector choose the URL of an authenticated request. `fetch` and
  // undici strip stickily for the same reason.
  let credentialed = true;

  for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop += 1) {
    credentialed &&= new URL(url).origin === baseOrigin;
    const init: RequestInit = {
      method,
      headers: buildHeaders({
        authHeader: attempt.authHeader,
        options: attempt.options,
        tool: auth.tool,
        etag: attempt.etag,
        withCredentials: credentialed,
        withBody: body !== undefined,
      }),
      body: serializeBody(body),
      redirect: 'manual',
      signal: attempt.signal,
    };

    let response: Response;
    try {
      response = await fetch(url, init);
    } catch (error: unknown) {
      throwAsNetworkError(error, `${auth.tool} ${req.path}`, 'timed out');
    }

    if (!REDIRECT_STATUSES.has(response.status)) return response;

    const location = response.headers.get('location');
    await response.body?.cancel().catch(() => undefined);
    if (!location) {
      throw new UpstreamError(response.status, `${auth.tool} ${req.path}: redirect without Location`);
    }
    url = new URL(location, url).toString();
    // A blocked redirect target is deterministic, so it must NOT be retried —
    // a plain NetworkError here would burn two more authenticated upstream
    // calls plus backoff on what is a policy rejection.
    try {
      assertHostnameAllowed(url);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      throw new SecurityError(`${auth.tool} ${req.path}: redirect blocked — ${message}`);
    }
    // The Fetch standard's rule, exactly: 303 turns any non-GET/HEAD follow-up
    // into a bodyless GET, and 301/302 do so only for POST. Downgrading PUT,
    // PATCH or DELETE on a 301 would turn a write into a read and then report the
    // GET's body as that write's result. 307/308 exist to preserve both.
    const downgrade =
      response.status === 303
        ? method !== 'GET' && method !== 'HEAD'
        : response.status !== 307 && response.status !== 308 && method === 'POST';
    if (downgrade) {
      method = 'GET';
      body = undefined;
    }
  }
  throw new UpstreamError(0, `${auth.tool} ${req.path}: more than ${MAX_REDIRECT_HOPS} redirects`);
}

/** Serialize the request body — JSON or nothing; `undefined` omits the body entirely. */
function serializeBody(body: unknown): BodyInit | undefined {
  if (body === undefined) return undefined;
  return JSON.stringify(body);
}

/**
 * Map a fetch/stream failure to the typed, retryable {@link NetworkError} — an
 * AbortError here is the armed deadline firing. ONE mapping for the header fetch
 * AND the body read: the two hand-kept copies could drift, and a divergence makes
 * header and body timeouts behave differently under the retry policy.
 */
function throwAsNetworkError(error: unknown, label: string, timedOutWhat: string): never {
  if (error instanceof Error && error.name === 'AbortError') {
    throw new NetworkError(`${label} ${timedOutWhat}`);
  }
  throw new NetworkError(`${label}: ${error instanceof Error ? error.message : String(error)}`);
}

interface FetchHeaderBundle {
  readonly authHeader: AuthHeader;
  readonly options: HttpClientOptions;
  /** The source name from the auth config — `X-Extract-Source` attribution. */
  readonly tool: string;
  readonly etag?: string | undefined;
  /** False on a redirect hop that left the configured origin — see `fetchFollowingRedirects`. */
  readonly withCredentials: boolean;
  /** False once a 303-style redirect has dropped the body — the content-type must go with it. */
  readonly withBody: boolean;
}

function buildHeaders(bundle: FetchHeaderBundle): Record<string, string> {
  const { authHeader, options, etag, withCredentials, withBody } = bundle;
  return {
    // The credential AND every attribution header go only to the configured origin
    // (`withCredentials` is false on any redirect hop that left it): an off-origin
    // redirector used to be handed the operator's OS account name and the run's
    // correlation id — hop-by-hop stripping that stopped at the token alone.
    ...(withCredentials
      ? {
          [authHeader.name]: authHeader.value,
          'x-extract-client': options.clientName,
          'x-extract-version': options.clientVersion,
          // Attribution: one correlation id per run (EXTRACT_CORRELATION_ID injects a
          // caller's own — a CI job id, say), and the OS account behind the token. The
          // same correlation id is written into `_manifest.json`, tying upstream audit
          // logs to the snapshot.
          'x-correlation-id': getCorrelationId(),
          'x-extract-user': getRunUser(),
          // Attribution by default: `X-Extract-Source` names the source on EVERY
          // request straight from the auth config — the per-request override it
          // used to defer to had no caller and only invited mislabeling.
          'x-extract-source': bundle.tool,
        }
      : {}),
    accept: 'application/json',
    'user-agent': options.userAgent,
    ...(etag ? { 'if-none-match': etag } : {}),
    ...(withBody ? { 'content-type': 'application/json' } : {}),
  };
}

// `never`, not `void`: the caller only reaches this with a non-ok status (304 is handled
// earlier), so every path throws — a conditional final branch used to leave a theoretical
// fall-through in which an error body was parsed as success.
function rejectByStatus(response: Response, tool: string, path: string, detail = ''): never {
  if (response.status === 401 || response.status === 403) {
    throw new AuthError(`${tool} returned ${response.status} for ${path}`);
  }
  if (response.status === 404) {
    throw new NotFoundError(`${tool} ${path} not found`);
  }
  if (response.status === 429) {
    throw new RateLimitError(`${tool} rate-limited`, parseRetryAfterSeconds(response));
  }
  if (response.status >= 500) {
    throw new UpstreamError(response.status, `${tool} upstream error`);
  }
  // 400/409/422 carry a diagnostic body (bad JQL, version conflict, validation)
  // the agent can act on; append a bounded, sanitized excerpt when available.
  const suffix = detail ? ` — ${detail}` : '';
  throw new UpstreamError(response.status, `${tool} ${path}: status ${response.status}${suffix}`);
}

/**
 * Read a small, bounded, single-line prefix of an error response body so 4xx
 * failures carry an actionable reason. Auth tokens live in request headers,
 * never in these bodies, so the excerpt is safe to surface. Best-effort:
 * returns '' when the body is empty or unreadable.
 */
async function readErrorDetail(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return '';
  const decoder = new TextDecoder('utf-8');
  let text = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (value) text += decoder.decode(value, { stream: true });
      if (done) break;
      if (text.length >= ERROR_DETAIL_MAX_CHARS * 4) {
        await reader.cancel().catch(() => undefined);
        break;
      }
    }
    text += decoder.decode();
  } catch {
    /* best-effort — surface whatever was read */
  }
  const collapsed = text.replaceAll(/\s+/g, ' ').trim();
  return collapsed.length > ERROR_DETAIL_MAX_CHARS ? `${collapsed.slice(0, ERROR_DETAIL_MAX_CHARS)}…` : collapsed;
}

function parseRetryAfterSeconds(response: Response): number | undefined {
  const ms = parseRetryAfter(response.headers.get('retry-after'));
  return ms > 0 ? Math.ceil(ms / 1000) : undefined;
}

/**
 * Buffer the response body as text, refusing to exceed {@link MAX_BODY_BYTES}.
 *
 * The read runs under the request's deadline, so an abort can surface here as
 * well as at the headers. It is mapped to the typed contract: without the catch
 * a timed-out body escaped as a raw `DOMException`, which no caller handles and
 * which the retry policy does not recognise as retryable.
 */
async function readBodyCapped(response: Response, label: string): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return '';
  const decoder = new TextDecoder('utf-8');
  let received = 0;
  let out = '';

  for (;;) {
    let value: Uint8Array | undefined;
    let done: boolean;
    try {
      ({ value, done } = await reader.read());
    } catch (error: unknown) {
      throwAsNetworkError(error, label, 'timed out reading the response body');
    }
    if (done) break;
    if (!value) continue;
    received += value.byteLength;
    if (received > MAX_BODY_BYTES) {
      try {
        await reader.cancel();
      } catch {
        /* best-effort */
      }
      throw new UpstreamError(0, `response body exceeded ${MAX_BODY_BYTES} bytes`);
    }
    out += decoder.decode(value, { stream: true });
  }
  out += decoder.decode();
  return out;
}

function parseBody(body: string): unknown {
  if (body.length === 0) return undefined;
  try {
    return JSON.parse(body);
  } catch {
    throw new UpstreamError(0, `response was not valid JSON (first 80 chars: ${body.slice(0, 80)})`);
  }
}
