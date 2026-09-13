/**
 * Unit tests for http-client — covers SSRF guard, retry/backoff, in-flight
 * dedup, ETag/304 cache, body cap, response-mode (json vs text).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { NetworkError, RateLimitError, SecurityError, UpstreamError } from './errors.js';
import { createHttpClient } from './http-client.js';

const auth = {
  tool: 'gitlab' as const,
  baseUrl: 'https://api.example.com',
  token: 'tok',
};

interface MockResponse {
  status: number;
  headers?: Record<string, string>;
  body?: string;
}

function stringifyInput(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function mockFetchSequence(responses: readonly MockResponse[]): {
  fetch: typeof fetch;
  calls: { url: string; init?: RequestInit }[];
} {
  const calls: { url: string; init?: RequestInit }[] = [];
  let index = 0;
  const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: stringifyInput(input), init });
    const r = responses[Math.min(index, responses.length - 1)];
    if (!r) throw new Error('mock fetch: no response configured');
    index += 1;
    // 204 / 304 must have a null body per the fetch spec.
    const bodyForbidden = r.status === 204 || r.status === 304;
    const body = bodyForbidden ? null : (r.body ?? '');
    const stream =
      body === null
        ? null
        : new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode(body));
              controller.close();
            },
          });
    return new Response(stream, {
      status: r.status,
      headers: r.headers,
    });
  });
  return { fetch: mock, calls };
}

beforeEach(() => {
  delete process.env['EXTRACT_ALLOW_PRIVATE_HOSTS'];
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('http-client SSRF guard', () => {
  it('blocks loopback hosts', async () => {
    const client = createHttpClient(
      { tool: 'gitlab', baseUrl: 'http://127.0.0.1', token: 'x' },
      { userAgent: 'test/1.0', clientName: 'test', clientVersion: '1.0' },
    );
    await expect(client.request({ path: '/x' })).rejects.toBeInstanceOf(NetworkError);
  });

  it('blocks RFC1918 hosts (10.x)', async () => {
    const client = createHttpClient(
      { tool: 'gitlab', baseUrl: 'http://10.0.0.1', token: 'x' },
      { userAgent: 'test/1.0', clientName: 'test', clientVersion: '1.0' },
    );
    await expect(client.request({ path: '/x' })).rejects.toBeInstanceOf(NetworkError);
  });

  it('blocks link-local 169.254.x', async () => {
    const client = createHttpClient(
      { tool: 'gitlab', baseUrl: 'http://169.254.169.254', token: 'x' },
      { userAgent: 'test/1.0', clientName: 'test', clientVersion: '1.0' },
    );
    await expect(client.request({ path: '/x' })).rejects.toBeInstanceOf(NetworkError);
  });

  it('blocks IPv6 loopback [::1]', async () => {
    const client = createHttpClient(
      { tool: 'gitlab', baseUrl: 'http://[::1]', token: 'x' },
      { userAgent: 'test/1.0', clientName: 'test', clientVersion: '1.0' },
    );
    await expect(client.request({ path: '/x' })).rejects.toBeInstanceOf(NetworkError);
  });

  it('blocks IPv6 ULA [fc00::1] and [fd00::1]', async () => {
    for (const baseUrl of ['http://[fc00::1]', 'http://[fd00::1]']) {
      const client = createHttpClient(
        { tool: 'gitlab', baseUrl, token: 'x' },
        { userAgent: 'test/1.0', clientName: 'test', clientVersion: '1.0' },
      );
      await expect(client.request({ path: '/x' })).rejects.toBeInstanceOf(NetworkError);
    }
  });

  it('blocks IPv6 link-local [fe80::1]', async () => {
    const client = createHttpClient(
      { tool: 'gitlab', baseUrl: 'http://[fe80::1]', token: 'x' },
      { userAgent: 'test/1.0', clientName: 'test', clientVersion: '1.0' },
    );
    await expect(client.request({ path: '/x' })).rejects.toBeInstanceOf(NetworkError);
  });

  it('blocks IPv4-mapped loopback [::ffff:7f00:1]', async () => {
    const client = createHttpClient(
      { tool: 'gitlab', baseUrl: 'http://[::ffff:7f00:1]', token: 'x' },
      { userAgent: 'test/1.0', clientName: 'test', clientVersion: '1.0' },
    );
    await expect(client.request({ path: '/x' })).rejects.toBeInstanceOf(NetworkError);
  });

  it('does NOT block real DNS names with fc/fd prefix', async () => {
    const { fetch } = mockFetchSequence([{ status: 200, body: '{"ok":true}' }]);
    vi.stubGlobal('fetch', fetch);
    const client = createHttpClient(
      { tool: 'gitlab', baseUrl: 'https://fcm.googleapis.com', token: 'x' },
      { userAgent: 'test/1.0', clientName: 'test', clientVersion: '1.0' },
    );
    await expect(client.request<{ ok: boolean }>({ path: '/x' })).resolves.toEqual({ ok: true });
  });

  it('allows private hosts when escape hatch is set', async () => {
    process.env['EXTRACT_ALLOW_PRIVATE_HOSTS'] = 'true';
    const { fetch } = mockFetchSequence([{ status: 200, body: '{"ok":true}' }]);
    vi.stubGlobal('fetch', fetch);
    const client = createHttpClient(
      { tool: 'gitlab', baseUrl: 'http://127.0.0.1:8080', token: 'x' },
      { userAgent: 'test/1.0', clientName: 'test', clientVersion: '1.0' },
    );
    await expect(client.request<{ ok: boolean }>({ path: '/x' })).resolves.toEqual({ ok: true });
  });
});

describe('http-client attribution headers', () => {
  it('every request carries a stable X-Correlation-Id and the OS user', async () => {
    const { fetch, calls } = mockFetchSequence([{ status: 200, body: '{"ok":true}' }]);
    vi.stubGlobal('fetch', fetch);
    const client = createHttpClient(auth, { userAgent: 'test/1.0', clientName: 'test', clientVersion: '1.0' });
    await client.request({ path: '/a', cache: false });
    await client.request({ path: '/b', cache: false });

    const headersOf = (i: number): Record<string, string> => (calls[i]?.init?.headers ?? {}) as Record<string, string>;
    const first = headersOf(0);
    expect(first['x-correlation-id']).toBeTruthy();
    expect(first['x-extract-user']).toBeTruthy();
    // One process, one id — otherwise upstream logs cannot group the run.
    expect(headersOf(1)['x-correlation-id']).toBe(first['x-correlation-id']);
  });
});

describe('http-client retry / backoff', () => {
  it('retries on 429 honouring Retry-After', async () => {
    const { fetch, calls } = mockFetchSequence([
      { status: 429, headers: { 'retry-after': '0' } },
      { status: 200, body: '{"ok":true}' },
    ]);
    vi.stubGlobal('fetch', fetch);
    const client = createHttpClient(auth, { userAgent: 'test/1.0', clientName: 'test', clientVersion: '1.0' });
    const result = await client.request<{ ok: boolean }>({ path: '/x' });
    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(2);
  });

  it('retries on 5xx', async () => {
    const { fetch, calls } = mockFetchSequence([{ status: 503 }, { status: 200, body: '{"ok":true}' }]);
    vi.stubGlobal('fetch', fetch);
    const client = createHttpClient(auth, { userAgent: 'test/1.0', clientName: 'test', clientVersion: '1.0' });
    await client.request({ path: '/x' });
    expect(calls).toHaveLength(2);
  });

  it('gives up after MAX_ATTEMPTS and surfaces RateLimitError', async () => {
    const { fetch } = mockFetchSequence([
      { status: 429, headers: { 'retry-after': '0' } },
      { status: 429, headers: { 'retry-after': '0' } },
      { status: 429, headers: { 'retry-after': '0' } },
    ]);
    vi.stubGlobal('fetch', fetch);
    const client = createHttpClient(auth, { userAgent: 'test/1.0', clientName: 'test', clientVersion: '1.0' });
    await expect(client.request({ path: '/x' })).rejects.toBeInstanceOf(RateLimitError);
  });

  it('does NOT retry on 4xx (other than 429)', async () => {
    const { fetch, calls } = mockFetchSequence([{ status: 404 }]);
    vi.stubGlobal('fetch', fetch);
    const client = createHttpClient(auth, { userAgent: 'test/1.0', clientName: 'test', clientVersion: '1.0' });
    await expect(client.request({ path: '/x' })).rejects.toThrow();
    expect(calls).toHaveLength(1);
  });

  it('does NOT retry a POST on 5xx — the server may have committed before the response died', async () => {
    // A 502 after the backend committed used to be re-POSTed twice more: up to three
    // duplicate issues/comments/pages from one `--yes`. One attempt, one write.
    const { fetch, calls } = mockFetchSequence([{ status: 502 }, { status: 200, body: '{"ok":true}' }]);
    vi.stubGlobal('fetch', fetch);
    const client = createHttpClient(auth, { userAgent: 'test/1.0', clientName: 'test', clientVersion: '1.0' });
    await expect(client.request({ method: 'POST', path: '/x', body: { a: 1 } })).rejects.toThrow();
    expect(calls).toHaveLength(1);
  });

  it('a POST declared `idempotent: true` retries on 5xx — a GraphQL read is replay-safe', async () => {
    const { fetch, calls } = mockFetchSequence([{ status: 502 }, { status: 200, body: '{"ok":true}' }]);
    vi.stubGlobal('fetch', fetch);
    const client = createHttpClient(auth, { userAgent: 'test/1.0', clientName: 'test', clientVersion: '1.0' });
    await client.request({ method: 'POST', path: '/x', body: { q: 'query' }, idempotent: true });
    expect(calls).toHaveLength(2);
  });

  it('still retries a POST on 429 — a rate-limited request was rejected before processing', async () => {
    const { fetch, calls } = mockFetchSequence([
      { status: 429, headers: { 'retry-after': '0' } },
      { status: 200, body: '{"ok":true}' },
    ]);
    vi.stubGlobal('fetch', fetch);
    const client = createHttpClient(auth, { userAgent: 'test/1.0', clientName: 'test', clientVersion: '1.0' });
    await client.request({ method: 'POST', path: '/x', body: { a: 1 } });
    expect(calls).toHaveLength(2);
  });
});

describe('http-client in-flight dedup', () => {
  it('coalesces parallel identical GETs into one upstream call', async () => {
    let resolveResponse: () => void = () => undefined;
    const blocking = new Promise<void>((resolve) => {
      resolveResponse = resolve;
    });
    let calls = 0;
    const mockFetch = vi.fn(async () => {
      calls += 1;
      await blocking;
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(`{"hit":${calls}}`));
          controller.close();
        },
      });
      return new Response(stream, { status: 200 });
    });
    vi.stubGlobal('fetch', mockFetch);

    const client = createHttpClient(auth, { userAgent: 'test/1.0', clientName: 'test', clientVersion: '1.0' });
    const [a, b, c] = [
      client.request<{ hit: number }>({ path: '/same' }),
      client.request<{ hit: number }>({ path: '/same' }),
      client.request<{ hit: number }>({ path: '/same' }),
    ];
    resolveResponse();
    const results = await Promise.all([a, b, c]);
    expect(calls).toBe(1);
    expect(results[0].hit).toBe(1);
    expect(results[1].hit).toBe(1);
    expect(results[2].hit).toBe(1);
  });

  it('does NOT coalesce POSTs (non-idempotent)', async () => {
    const { fetch, calls } = mockFetchSequence([
      { status: 200, body: '{"ok":1}' },
      { status: 200, body: '{"ok":2}' },
    ]);
    vi.stubGlobal('fetch', fetch);
    const client = createHttpClient(auth, { userAgent: 'test/1.0', clientName: 'test', clientVersion: '1.0' });
    await Promise.all([
      client.request({ method: 'POST', path: '/x', body: { a: 1 } }),
      client.request({ method: 'POST', path: '/x', body: { a: 1 } }),
    ]);
    expect(calls.length).toBe(2);
  });

  it('cleans up the in-flight map after success (next call re-fetches)', async () => {
    const { fetch, calls } = mockFetchSequence([
      { status: 200, body: '{"ok":1}' },
      { status: 200, body: '{"ok":2}' },
    ]);
    vi.stubGlobal('fetch', fetch);
    const client = createHttpClient(auth, { userAgent: 'test/1.0', clientName: 'test', clientVersion: '1.0' });
    await client.request({ path: '/same' });
    await client.request({ path: '/same' });
    // Both calls hit upstream because dedup only covers in-flight concurrency.
    // (ETag cache layer is tested separately.)
    expect(calls.length).toBe(2);
  });
});

describe('http-client ETag / 304 cache', () => {
  it('sends If-None-Match on second call when first returned an ETag', async () => {
    const { fetch, calls } = mockFetchSequence([
      { status: 200, headers: { etag: '"v1"' }, body: '{"ok":true}' },
      { status: 304, headers: { etag: '"v1"' } },
    ]);
    vi.stubGlobal('fetch', fetch);
    const client = createHttpClient(auth, { userAgent: 'test/1.0', clientName: 'test', clientVersion: '1.0' });
    const first = await client.request<{ ok: boolean }>({ path: '/cacheable' });
    expect(first.ok).toBe(true);
    const second = await client.request<{ ok: boolean }>({ path: '/cacheable' });
    expect(second.ok).toBe(true);
    expect(calls[1]?.init?.headers).toMatchObject({ 'if-none-match': '"v1"' });
  });
});

describe('http-client concurrency limit', () => {
  beforeEach(() => {
    delete process.env['EXTRACT_HTTP_CONCURRENCY'];
  });

  it('caps in-flight upstream requests at EXTRACT_HTTP_CONCURRENCY', async () => {
    process.env['EXTRACT_HTTP_CONCURRENCY'] = '2';
    let inflight = 0;
    let peak = 0;
    const releasers: (() => void)[] = [];
    const mockFetch = vi.fn(async () => {
      inflight += 1;
      peak = Math.max(peak, inflight);
      // Each call parks on its own promise so the test can release them one-by-one.
      await new Promise<void>((resolve) => releasers.push(resolve));
      inflight -= 1;
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"ok":true}'));
          controller.close();
        },
      });
      return new Response(stream, { status: 200 });
    });
    vi.stubGlobal('fetch', mockFetch);
    const client = createHttpClient(auth, { userAgent: 'test/1.0', clientName: 'test', clientVersion: '1.0' });
    const promises = [0, 1, 2, 3].map((i) => client.request({ path: `/p${i}` }));
    // Drain: each release lets ONE in-flight call complete; the next one in
    // the semaphore queue then enters fetch. We never see > 2 parked at once.
    for (let i = 0; i < 4; i += 1) {
      while (releasers.length === 0) await Promise.resolve();
      releasers.shift()?.();
      // Two microtask yields: one for the awaited promise to settle, one for
      // the next caller to acquire the permit and hit fetch.
      await Promise.resolve();
      await Promise.resolve();
    }
    await Promise.all(promises);
    expect(peak).toBeLessThanOrEqual(2);
    expect(mockFetch).toHaveBeenCalledTimes(4);
  });
});

describe('http-client is JSON-only', () => {
  // The text response mode (and the multipart/headers/abortSignal escape hatches)
  // belonged to MCP-era callers deleted with the servers — the client speaks JSON
  // and nothing else, so a non-JSON body is an upstream fault, not a mode to pick.
  it('rejects body that is not valid JSON', async () => {
    const { fetch } = mockFetchSequence([{ status: 200, body: '<html>oops</html>' }]);
    vi.stubGlobal('fetch', fetch);
    const client = createHttpClient(auth, { userAgent: 'test/1.0', clientName: 'test', clientVersion: '1.0' });
    await expect(client.request({ path: '/x' })).rejects.toBeInstanceOf(UpstreamError);
  });
});

describe('http-client onResponseMeta', () => {
  it('invokes the callback on success with a header accessor', async () => {
    const { fetch } = mockFetchSequence([{ status: 200, headers: { 'x-next-page': '3' }, body: '{"ok":true}' }]);
    vi.stubGlobal('fetch', fetch);
    const client = createHttpClient(auth, { userAgent: 'test/1.0', clientName: 'test', clientVersion: '1.0' });
    let nextPage: string | null = 'unset';
    await client.request({
      path: '/x',
      cache: false,
      onResponseMeta: (meta) => {
        nextPage = meta.header('x-next-page');
      },
    });
    expect(nextPage).toBe('3');
  });
});

describe('http-client surfaces 4xx diagnostic body', () => {
  it('appends a bounded excerpt of a 400 body to the UpstreamError message', async () => {
    const { fetch } = mockFetchSequence([
      { status: 400, body: JSON.stringify({ errorMessages: ["Field 'foo' does not exist"], errors: {} }) },
    ]);
    vi.stubGlobal('fetch', fetch);
    const client = createHttpClient(auth, { userAgent: 'test/1.0', clientName: 'test', clientVersion: '1.0' });
    await expect(client.request({ path: '/x' })).rejects.toThrow(/does not exist/);
  });

  it('surfaces a 409 version-conflict reason', async () => {
    const { fetch } = mockFetchSequence([{ status: 409, body: JSON.stringify({ message: 'version conflict' }) }]);
    vi.stubGlobal('fetch', fetch);
    const client = createHttpClient(auth, { userAgent: 'test/1.0', clientName: 'test', clientVersion: '1.0' });
    await expect(client.request({ path: '/x' })).rejects.toThrow(/version conflict/);
  });

  it('does NOT leak a body excerpt for 401/403/404 (kept clean)', async () => {
    const { fetch } = mockFetchSequence([{ status: 403, body: JSON.stringify({ secretish: 'do-not-surface' }) }]);
    vi.stubGlobal('fetch', fetch);
    const client = createHttpClient(auth, { userAgent: 'test/1.0', clientName: 'test', clientVersion: '1.0' });
    await expect(client.request({ path: '/x' })).rejects.toThrow(/^(?:(?!do-not-surface).)*$/s);
  });
});

// ── Redirects ───────────────────────────────────────────────────────────────
//
// `request()` follows redirects MANUALLY. Letting `fetch` do it means the
// redirect target never reaches the SSRF guard, and a custom credential header
// (Figma's `x-figma-token`) is not one of the three headers undici strips across
// origins — so the token would go wherever the redirect pointed.

describe('http-client redirects', () => {
  const opts = { userAgent: 'test/1.0', clientName: 'test', clientVersion: '1.0' };

  it('follows a same-origin redirect and keeps the credential', async () => {
    const { fetch, calls } = mockFetchSequence([
      { status: 302, headers: { location: 'https://api.example.com/moved' } },
      { status: 200, body: '{"ok":true}' },
    ]);
    vi.stubGlobal('fetch', fetch);
    const client = createHttpClient(auth, opts);
    await expect(client.request({ path: '/start' })).resolves.toEqual({ ok: true });
    expect(calls).toHaveLength(2);
    expect((calls[1]?.init?.headers as Record<string, string>)['authorization']).toBeDefined();
  });

  it('drops the credential the moment a hop leaves the configured origin', async () => {
    const { fetch, calls } = mockFetchSequence([
      { status: 302, headers: { location: 'https://elsewhere.example.net/signed' } },
      { status: 200, body: '{"ok":true}' },
    ]);
    vi.stubGlobal('fetch', fetch);
    const client = createHttpClient(auth, opts);
    await expect(client.request({ path: '/start' })).resolves.toEqual({ ok: true });
    expect((calls[0]?.init?.headers as Record<string, string>)['authorization']).toBeDefined();
    expect((calls[1]?.init?.headers as Record<string, string>)['authorization']).toBeUndefined();
  });

  it('drops a Figma token off-origin too — not just Authorization', async () => {
    const figmaAuth = { tool: 'figma' as const, baseUrl: 'https://api.figma.com', token: 'figd_secret' };
    const { fetch, calls } = mockFetchSequence([
      { status: 302, headers: { location: 'https://cdn.example.net/asset' } },
      { status: 200, body: '{"ok":true}' },
    ]);
    vi.stubGlobal('fetch', fetch);
    const client = createHttpClient(figmaAuth, opts);
    await client.request({ path: '/v1/files/abc' });
    expect((calls[0]?.init?.headers as Record<string, string>)['x-figma-token']).toBe('figd_secret');
    expect((calls[1]?.init?.headers as Record<string, string>)['x-figma-token']).toBeUndefined();
  });

  it('SSRF-guards every redirect hop, fail-fast without retries', async () => {
    const { fetch, calls } = mockFetchSequence([{ status: 302, headers: { location: 'http://127.0.0.1/loot' } }]);
    vi.stubGlobal('fetch', fetch);
    const client = createHttpClient(auth, opts);
    // A blocked redirect is a deterministic policy rejection — SecurityError,
    // never retried (one upstream call only).
    await expect(client.request({ path: '/start' })).rejects.toBeInstanceOf(SecurityError);
    expect(calls).toHaveLength(1);
  });

  it('gives up after too many redirect hops', async () => {
    const { fetch } = mockFetchSequence([{ status: 302, headers: { location: 'https://api.example.com/next' } }]);
    vi.stubGlobal('fetch', fetch);
    const client = createHttpClient(auth, opts);
    await expect(client.request({ path: '/start' })).rejects.toThrow(/redirects/);
  });

  it('reports a redirect without a Location instead of returning it as a body', async () => {
    const { fetch } = mockFetchSequence([{ status: 302 }]);
    vi.stubGlobal('fetch', fetch);
    const client = createHttpClient(auth, opts);
    await expect(client.request({ path: '/start' })).rejects.toThrow(/redirect without Location/);
  });
});

// ── Body-read deadline ──────────────────────────────────────────────────────

describe('http-client body deadline', () => {
  const opts = { userAgent: 'test/1.0', clientName: 'test', clientVersion: '1.0' };

  it('maps a mid-body timeout abort to NetworkError instead of a raw DOMException', async () => {
    // Headers arrive, one chunk arrives, then the body stalls. The timer used to
    // be cleared as soon as the headers landed, so this had no deadline at all.
    const mock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      let controller!: ReadableStreamDefaultController<Uint8Array>;
      const stalled = new ReadableStream<Uint8Array>({
        start(c) {
          controller = c;
          c.enqueue(new TextEncoder().encode('{"partial":'));
        },
      });
      init?.signal?.addEventListener('abort', () => {
        controller.error(new DOMException('This operation was aborted', 'AbortError'));
      });
      return new Response(stalled, { status: 200 });
    });
    vi.stubGlobal('fetch', mock);
    const client = createHttpClient(auth, opts);
    const failure = await client.request({ path: '/slow', timeoutMs: 100 }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(NetworkError);
    expect((failure as Error).message).toMatch(/timed out/);
  });
});

// ── URL construction ────────────────────────────────────────────────────────

describe('http-client URL construction', () => {
  const opts = { userAgent: 'test/1.0', clientName: 'test', clientVersion: '1.0' };

  it('preserves a path prefix on the base URL', async () => {
    // `new URL('/projects/1', 'https://gitlab.com/api/v4')` drops `/api/v4`,
    // which pointed every GitLab request at the HTML site instead of the API.
    const { fetch, calls } = mockFetchSequence([{ status: 200, body: '[]' }]);
    vi.stubGlobal('fetch', fetch);
    const client = createHttpClient({ ...auth, baseUrl: 'https://gitlab.example.com/api/v4' }, opts);
    await client.request({ path: '/projects/1/issues', query: { per_page: 100 } });
    expect(calls[0]?.url).toBe('https://gitlab.example.com/api/v4/projects/1/issues?per_page=100');
  });

  it('leaves a prefix-free base URL alone', async () => {
    const { fetch, calls } = mockFetchSequence([{ status: 200, body: '{}' }]);
    vi.stubGlobal('fetch', fetch);
    const client = createHttpClient({ ...auth, baseUrl: 'https://site.atlassian.net' }, opts);
    await client.request({ path: '/rest/api/3/issue/X-1' });
    expect(calls[0]?.url).toBe('https://site.atlassian.net/rest/api/3/issue/X-1');
  });

  it('tolerates a trailing slash on the base URL', async () => {
    const { fetch, calls } = mockFetchSequence([{ status: 200, body: '{}' }]);
    vi.stubGlobal('fetch', fetch);
    const client = createHttpClient({ ...auth, baseUrl: 'https://gitlab.example.com/api/v4/' }, opts);
    await client.request({ path: '/projects/1' });
    expect(calls[0]?.url).toBe('https://gitlab.example.com/api/v4/projects/1');
  });
});

// ── SSRF guard: host-form edge cases ────────────────────────────────────────

describe('http-client SSRF guard, host forms', () => {
  const opts = { userAgent: 'test/1.0', clientName: 'test', clientVersion: '1.0' };

  it('blocks the fully-qualified form of localhost (trailing dot)', async () => {
    // `localhost.` resolves to loopback exactly as `localhost` does; a set
    // lookup on the raw hostname compared the wrong string and let it through.
    const client = createHttpClient({ ...auth, baseUrl: 'http://localhost./' }, opts);
    await expect(client.request({ path: '/x' })).rejects.toBeInstanceOf(NetworkError);
  });

  it('blocks LOCALHOST regardless of case', async () => {
    const client = createHttpClient({ ...auth, baseUrl: 'http://LOCALHOST/' }, opts);
    await expect(client.request({ path: '/x' })).rejects.toBeInstanceOf(NetworkError);
  });
});
