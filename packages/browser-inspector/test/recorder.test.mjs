// The recorder is attached once per tab and feeds the report, the session's "since last call"
// cursors and the scrub (visited origins) — every event kind on a FakePage (DESIGN.md §2.2).
import { describe, expect, it } from 'vitest';

import { BODY_LIMIT, CONSOLE_CAP, attachRecorder, createRecorder, originOf, summarize } from '../src/recorder.mjs';
import { createFakePage } from './fake-browser.mjs';

const message = (/** @type {string} */ type, /** @type {string} */ text, url = 'http://x/main.js', line = 12) => ({
  type: () => type,
  text: () => text,
  location: () => ({ url, lineNumber: line }),
});

/** @param {Partial<{ method: string, url: string, resourceType: string, failure: string }>} spec */
const request = (spec = {}) => ({
  method: () => spec.method ?? 'GET',
  url: () => spec.url ?? 'http://localhost:4300/api',
  resourceType: () => spec.resourceType ?? 'fetch',
  failure: () => (spec.failure ? { errorText: spec.failure } : null),
});

/** @param {any} req @param {Partial<{ status: number, headers: Record<string, string>, fromCache: boolean, body: string }>} spec */
const response = (req, spec = {}) => ({
  request: () => req,
  status: () => spec.status ?? 200,
  url: () => req.url(),
  headers: () => spec.headers ?? { 'content-type': 'application/json' },
  fromCache: () => spec.fromCache === true,
  text: async () => spec.body ?? '{"ok":true}',
});

describe('attachRecorder', () => {
  it('records console entries with a location and caps them, counting the total', () => {
    const page = createFakePage();
    const recorder = attachRecorder(page);
    page.emit('console', message('error', '[zgloszenia] zapis nie powiodl sie: 404'));
    expect(recorder.console[0]).toMatchObject({
      type: 'error',
      text: '[zgloszenia] zapis nie powiodl sie: 404',
      location: 'http://x/main.js:12',
    });
    for (let i = 0; i < CONSOLE_CAP + 5; i += 1) page.emit('console', message('log', `line ${String(i)}`));
    expect(recorder.console).toHaveLength(CONSOLE_CAP);
    expect(recorder.consoleTotal).toBe(CONSOLE_CAP + 6);
    expect(summarize(recorder).console.truncated).toBe(true);
  });

  it('keeps the first line of a page error', () => {
    const page = createFakePage();
    const recorder = attachRecorder(page);
    page.emit('pageerror', new Error('boom\n    at x.js:1'));
    expect(recorder.pageErrors).toEqual(['boom']);
  });

  it('counts requests, tracks in-flight, statuses, sizes, cache hits and HTTP ≥ 400 failures', async () => {
    const page = createFakePage();
    const recorder = attachRecorder(page);
    const doc = request({ url: 'http://localhost:4300/', resourceType: 'document' });
    const api = request({ method: 'POST', url: 'http://localhost:4300/api/zgloszenia' });
    page.emit('request', doc);
    page.emit('request', api);
    expect(recorder.inFlight).toBe(2);
    page.emit(
      'response',
      response(doc, { fromCache: true, headers: { 'content-type': 'text/html', 'content-length': '512' } }),
    );
    page.emit('requestfinished', doc);
    page.emit('response', response(api, { status: 404, body: '{"error":"cart not found"}' }));
    page.emit('requestfinished', api);
    await recorder.settle();
    expect(recorder.inFlight).toBe(0);
    expect(recorder.networkTotal).toBe(2);
    expect(recorder.cacheHits).toBe(1);
    expect(recorder.cacheHitsDocument).toBe(1);
    expect(recorder.network[0]).toMatchObject({
      id: 1,
      method: 'GET',
      status: 200,
      contentType: 'text/html',
      size: 512,
      fromCache: true,
    });
    expect(recorder.network[1]).toMatchObject({
      id: 2,
      method: 'POST',
      status: 404,
      failure: 'HTTP 404',
      fromCache: false,
    });
    expect(typeof recorder.network[1].ms).toBe('number');
    const summary = summarize(recorder);
    expect(summary.network).toEqual({
      total: 2,
      failed: [expect.objectContaining({ id: 2, url: 'http://localhost:4300/api/zgloszenia', failure: 'HTTP 404' })],
    });
    expect(summary.failedRequests).toEqual({
      entries: [{ url: 'http://localhost:4300/api/zgloszenia', failure: 'HTTP 404' }],
      truncated: false,
    });
    expect(summary.cacheHits).toBe(1);
    expect(JSON.stringify(summary)).not.toContain('startedAt');
  });

  it('records requestfailed with the error text and never lets inFlight go negative', () => {
    const page = createFakePage();
    const recorder = attachRecorder(page);
    const req = request({ url: 'http://localhost:4300/x', failure: 'net::ERR_CONNECTION_REFUSED' });
    page.emit('request', req);
    page.emit('requestfailed', req);
    page.emit('requestfailed', request());
    expect(recorder.inFlight).toBe(0);
    expect(recorder.failed).toHaveLength(2);
    expect(recorder.failed[0]).toMatchObject({
      url: 'http://localhost:4300/x',
      failure: 'net::ERR_CONNECTION_REFUSED',
    });
  });

  it('never reads a bundle, an oversized or a streaming body — and says why; a stuck read cannot hold settle()', async () => {
    const page = createFakePage();
    const recorder = attachRecorder(page, { bodyReadMs: 60 });
    let reads = 0;
    const reading = (/** @type {any} */ req, /** @type {Record<string, string>} */ headers, body = 'x') => ({
      ...response(req, { headers }),
      text: async () => {
        reads += 1;
        return body;
      },
    });
    const js = request({ url: 'http://x/chunk-GGK3JVFA.js', resourceType: 'script' });
    const css = request({ url: 'http://x/styles.css', resourceType: 'stylesheet' });
    const big = request({ url: 'http://x/big.json' });
    const sse = request({ url: 'http://x/events', resourceType: 'eventsource' });
    const ok = request({ url: 'http://x/a.json' });
    const stuck = request({ url: 'http://x/slow.json' });
    for (const r of [js, css, big, sse, ok, stuck]) page.emit('request', r);
    page.emit('response', reading(js, { 'content-type': 'text/javascript' }, 'x'.repeat(100 * 1024)));
    page.emit('response', reading(css, { 'content-type': 'text/css' }));
    page.emit(
      'response',
      reading(big, { 'content-type': 'application/json', 'content-length': String(BODY_LIMIT + 1) }),
    );
    page.emit('response', reading(sse, { 'content-type': 'text/event-stream' }));
    page.emit('response', reading(ok, { 'content-type': 'application/json; charset=utf-8' }, '{"ok":true}'));
    page.emit('response', {
      ...response(stuck, { headers: { 'content-type': 'application/json' } }),
      text: () => new Promise(() => {}),
    });
    const started = performance.now();
    await recorder.settle();
    expect(performance.now() - started).toBeLessThan(1000);
    // Only the JSON that is worth keeping was read — not the 100 KB bundle, not the stylesheet.
    expect(reads).toBe(1);
    expect(recorder.bodies.get(5)).toBe('{"ok":true}');
    // The stuck read gave up at its own cap (the same `bodyReadMs`) and says so.
    expect(recorder.network.map((e) => e.bodySkipped)).toEqual([
      'type',
      'type',
      'too large',
      'stream',
      undefined,
      'timeout',
    ]);
    expect(recorder.bodies.has(6)).toBe(false);
  });

  it('keeps json/text bodies up to 64 KB, skips binaries, honours captureBodies: false', async () => {
    const page = createFakePage();
    const recorder = attachRecorder(page);
    const json = request({ url: 'http://x/a.json' });
    const png = request({ url: 'http://x/a.png' });
    const big = request({ url: 'http://x/big.txt' });
    for (const r of [json, png, big]) page.emit('request', r);
    page.emit('response', response(json, { body: '{"a":1}' }));
    page.emit('response', response(png, { headers: { 'content-type': 'image/png' }, body: 'PNG' }));
    page.emit(
      'response',
      response(big, { headers: { 'content-type': 'text/plain' }, body: 'x'.repeat(BODY_LIMIT + 10) }),
    );
    await recorder.settle();
    expect(recorder.bodies.get(1)).toBe('{"a":1}');
    expect(recorder.bodies.has(2)).toBe(false);
    expect(recorder.bodies.get(3)).toHaveLength(BODY_LIMIT);

    const quiet = attachRecorder(createFakePage(), { captureBodies: false });
    const page2 = /** @type {any} */ (quiet);
    void page2;
    const other = createFakePage();
    const off = attachRecorder(other, { captureBodies: false });
    other.emit('request', json);
    other.emit('response', response(json));
    await off.settle();
    expect(off.bodies.size).toBe(0);
  });

  it('applies the dialog policy: dismiss by default, accept with a prompt text, once, beforeunload always accepted', async () => {
    const page = createFakePage();
    const recorder = attachRecorder(page);
    const actions = [];
    const dialog = (/** @type {string} */ type, /** @type {string} */ text) => ({
      type: () => type,
      message: () => text,
      accept: async (/** @type {string} */ value) => void actions.push(['accept', value]),
      dismiss: async () => void actions.push(['dismiss']),
    });
    recorder.trigger = 'click e12';
    page.emit('dialog', dialog('confirm', 'Usunąć?'));
    recorder.dialogPolicy = { action: 'accept', text: 'Jan', once: true };
    page.emit('dialog', dialog('prompt', 'Imię?'));
    page.emit('dialog', dialog('alert', 'Hi'));
    page.emit('dialog', dialog('beforeunload', ''));
    await Promise.resolve();
    expect(actions).toEqual([['dismiss'], ['accept', 'Jan'], ['dismiss'], ['accept', undefined]]);
    expect(recorder.dialogs).toEqual([
      { type: 'confirm', message: 'Usunąć?', action: 'dismissed', trigger: 'click e12' },
      { type: 'prompt', message: 'Imię?', action: 'accepted', trigger: 'click e12' },
      { type: 'alert', message: 'Hi', action: 'dismissed', trigger: 'click e12' },
      { type: 'beforeunload', message: '', action: 'accepted', trigger: 'click e12' },
    ]);
    expect(recorder.dialogPolicy).toEqual({ action: 'dismiss' });
  });

  it('lists popups in tabs[] with url, title and openedAt', async () => {
    const page = createFakePage();
    const recorder = attachRecorder(page, { now: () => 1234 });
    const popup = {
      url: () => 'http://localhost:4300/popup',
      waitForLoadState: async () => undefined,
      title: async () => 'Popup',
    };
    page.emit('popup', popup);
    await recorder.settle();
    expect(recorder.tabs).toEqual([{ url: 'http://localhost:4300/popup', title: 'Popup', openedAt: 1234 }]);
  });

  it('tracks visited origins from main-frame navigations, deduplicated, and the crash flag', () => {
    const page = createFakePage();
    const recorder = attachRecorder(page);
    const main = page.mainFrame();
    const child = { url: () => 'http://other:1/', parentFrame: () => main };
    page.goto('http://localhost:4311/');
    page.goto('http://localhost:4312/a');
    page.goto('http://localhost:4311/b');
    page.emit('framenavigated', child);
    page.emit('crash');
    expect(recorder.visitedOrigins).toEqual(['http://localhost:4311', 'http://localhost:4312']);
    expect(recorder.navigations).toBe(3);
    expect(recorder.crashed).toBe(true);
    recorder.resetOrigins();
    expect(recorder.visitedOrigins).toEqual([]);
    expect(recorder.crashed).toBe(false);
  });

  it('sinceLast returns only entries after the cursor and the new cursor', () => {
    const page = createFakePage();
    const recorder = attachRecorder(page);
    page.emit('console', message('log', 'a'));
    page.emit('console', message('error', 'b'));
    const first = recorder.sinceLast('console', 0);
    expect(first.entries.map((e) => e.text)).toEqual(['a', 'b']);
    expect(first.cursor).toBe(2);
    page.emit('console', message('warning', 'c'));
    const second = recorder.sinceLast('console', first.cursor);
    expect(second.entries.map((e) => e.text)).toEqual(['c']);
    expect(recorder.sinceLast('net', 99)).toEqual({ entries: [], cursor: 0 });
  });

  it('reset clears the run-scoped state but keeps the visited origins for the scrub', () => {
    const page = createFakePage();
    const recorder = attachRecorder(page);
    page.goto('http://localhost:4313/');
    page.emit('console', message('log', 'x'));
    page.emit('request', request());
    recorder.dialogPolicy = { action: 'accept' };
    recorder.reset();
    expect(recorder.console).toEqual([]);
    expect(recorder.consoleTotal).toBe(0);
    expect(recorder.network).toEqual([]);
    expect(recorder.inFlight).toBe(0);
    expect(recorder.dialogPolicy).toEqual({ action: 'dismiss' });
    expect(recorder.visitedOrigins).toEqual(['http://localhost:4313']);
  });

  it('a second page attaches into the same store (tab new, popups)', () => {
    const store = createRecorder();
    const a = createFakePage();
    const b = createFakePage();
    attachRecorder(a, { into: store });
    attachRecorder(b, { into: store });
    a.emit('console', message('log', 'from a'));
    b.emit('console', message('log', 'from b'));
    expect(store.console.map((e) => e.text)).toEqual(['from a', 'from b']);
  });
});

describe('originOf', () => {
  it('keeps http(s) origins and drops what CDP cannot clear', () => {
    expect(originOf('http://localhost:4313/cart?x=1')).toBe('http://localhost:4313');
    expect(originOf('https://a.b/')).toBe('https://a.b');
    expect(originOf('about:blank')).toBeNull();
    expect(originOf('file:///x.html')).toBeNull();
    expect(originOf('nope')).toBeNull();
    expect(originOf(undefined)).toBeNull();
  });
});
