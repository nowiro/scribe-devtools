// ONE real Chrome/Edge through the fixtures (DESIGN.md §8; AC-9, AC-11, AC-15, AC-16): the batch
// engine in-process — the same `runFlow` the `--no-daemon` path and the keeper call. The session
// half (keeper up/doctor/stop, `browser-inspector script`) is WP6's extension of this file.
//
// `BROWSER_INSPECTOR_SKIP_SMOKE=1` skips the whole file — only for a machine without Chrome or Edge.
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { encode } from 'gpt-tokenizer/encoding/o200k_base';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { parseConfig } from '../../src/config.mjs';
import { createEngine } from '../../src/engine.mjs';
import { readJournal } from '../../src/session-log.mjs';
import { runBrowserInspector, cleanup, makeEnv, stopKeeper } from '../fixtures/keeper-harness.mjs';
import { startFixtureServer } from './fixture-server.mjs';

const PORT_A = 4501;
const PORT_B = 4502;
const skip = process.env.BROWSER_INSPECTOR_SKIP_SMOKE === '1' || process.env.BROWSER_INSPECTOR_SKIP_SMOKE === 'true';

describe.skipIf(skip)('smoke: batch engine on a real browser', () => {
  /** @type {Awaited<ReturnType<typeof startFixtureServer>>} */
  let a;
  /** @type {Awaited<ReturnType<typeof startFixtureServer>>} */
  let b;
  /** @type {ReturnType<typeof createEngine>} */
  let engine;
  /** @type {string} */
  let out;
  let seq = 0;

  beforeAll(async () => {
    [a, b] = await Promise.all([startFixtureServer(PORT_A), startFixtureServer(PORT_B)]);
    out = await mkdtemp(path.join(os.tmpdir(), 'browser-inspector-smoke-'));
    engine = createEngine({ browser: { headless: true }, env: process.env, prewarm: true });
    await engine.ready;
  }, 60_000);

  afterAll(async () => {
    await engine?.close();
    await Promise.all([a?.close(), b?.close()]);
    if (out) await rm(out, { recursive: true, force: true });
  });

  /**
   * A snapshot normalized exactly like `loadConfig` does it (defaults, absolute outputDir), run
   * through `runFlow` into its own directory.
   * @param {Record<string, any>} snapshot
   * @param {Record<string, any>} [laneOpts]
   */
  async function run(snapshot, laneOpts = {}) {
    seq += 1;
    const name = snapshot.name ?? `s${String(seq)}`;
    const config = parseConfig(
      { outputDir: out, snapshots: [{ type: 'flow', ...snapshot, name }] },
      { configPath: path.join(out, 'read.config.json'), cwd: out },
    );
    const dir = path.join(out, `run-${String(seq)}`, name);
    return engine.runFlow(config.snapshots[0], dir, { cwd: out, stamp: '2026-09-02_10-00', ...laneOpts });
  }

  /** @param {string} dir @param {string} name */
  const text = (dir, name) => readFile(path.join(dir, name), 'utf8');

  it('runs a 16-step flow on form.html: values, console error, failed POST, two screenshots, no final.png', async () => {
    const result = await run({
      url: a.url('form.html'),
      stepTimeoutMs: 5000,
      steps: [
        { do: 'waitFor', selector: '[data-testid=request-form]' },
        { do: 'click', selector: '[data-testid=submit]' },
        { do: 'verify', kind: 'visible', selector: '[data-testid=error-email]' },
        { do: 'extract', name: 'blad-email', selector: '[data-testid=error-email]' },
        { do: 'extract', name: 'licznik-niepoprawnych', selector: '[data-testid=invalid-count]' },
        { do: 'screenshot', name: 'walidacja' },
        { do: 'fill', selector: '[data-testid=field-name]', value: 'Jan Kowalski' },
        { do: 'fill', selector: '[data-testid=field-email]', value: 'jan.kowalski@example.com' },
        { do: 'select', selector: '[data-testid=field-category]', value: 'zmiana' },
        { do: 'click', selector: '[data-testid=priority-krytyczny]' },
        { do: 'fill', selector: '[data-testid=field-description]', value: 'Formularz nie zapisuje zgloszenia.' },
        { do: 'check', selector: '[data-testid=field-consent]' },
        {
          do: 'verify',
          kind: 'text',
          selector: '[data-testid=invalid-count]',
          text: 'Niepoprawnych pól: 0',
          soft: true,
        },
        { do: 'click', selector: '[data-testid=submit]' },
        { do: 'waitFor', selector: '[data-testid=confirmation]' },
        { do: 'extract', name: 'numer-zgloszenia', selector: '[data-testid=ticket-id]' },
        { do: 'extract', name: 'kategoria', selector: '[data-testid=ticket-category]' },
        { do: 'extract', name: 'priorytet', selector: '[data-testid=ticket-priority]' },
        { do: 'evaluate', name: 'formularz-zamkniety', expression: 'document.getElementById("form").hidden' },
        { do: 'wait', textGone: 'Wyślij zgłoszenie' },
        { do: 'screenshot', name: 'potwierdzenie' },
      ],
    });
    expect(result.failure).toBeUndefined();
    expect(result.completed).toBe(true);
    const report = result.report;
    expect(report.steps).toHaveLength(21);
    expect(report.extracts['blad-email'].value).toBe('Podaj poprawny adres e-mail.');
    expect(report.extracts['licznik-niepoprawnych'].value).toBe('Niepoprawnych pól: 4');
    expect(report.extracts['numer-zgloszenia'].value).toBe('ALM-1001');
    expect(report.extracts.kategoria.value).toBe('zmiana');
    expect(report.extracts.priorytet.value).toBe('krytyczny');
    expect(report.extracts['formularz-zamkniety'].value).toBe('true');
    expect(report.title).toBe('Zgłoszenie serwisowe');
    expect(
      report.console.entries.some((e) => e.type === 'error' && e.text.includes('[zgloszenia] zapis nie powiodl sie')),
    ).toBe(true);
    expect(report.failedRequests.entries).toEqual([{ url: a.url('api/zgloszenia'), failure: 'HTTP 404' }]);
    expect(report.network.failed[0]).toMatchObject({ method: 'POST', status: 404 });
    expect(report.screenshots).toEqual(['walidacja.png', 'potwierdzenie.png']);
    expect(report.final).toBe('potwierdzenie.png');
    expect(existsSync(path.join(result.dir, 'final.png'))).toBe(false);
    expect(existsSync(path.join(result.dir, 'walidacja.png'))).toBe(true);
    expect(report.verifications).toEqual([
      { index: 2, kind: 'visible', ok: true, soft: false },
      { index: 12, kind: 'text', ok: true, soft: true },
    ]);
    // The form is hidden after the submit — the element map lists what is clickable NOW.
    expect(report.elements?.entries.some((e) => e.selector === '[data-testid="new-request"]')).toBe(true);
    expect(report.elements?.entries.some((e) => e.selector === '[data-testid="submit"]')).toBe(false);
    expect(report.timing.cacheHitsDocument).toBe(0);
    const md = await text(result.dir, 'report.md');
    expect(md).toMatch(/^# s\d+ — OK 21\/21 · /u);
    expect(md).toContain('## errors');
    expect(md).toContain('- console.error [zgloszenia] zapis nie powiodl sie: HTTP 404');
    expect(md).toContain('## values');
    expect(md).toContain('numer-zgloszenia: ALM-1001');
    expect(md).not.toContain('## steps');
    for (const file of ['report.json', 'elements.md', 'text.txt', '_manifest.json']) {
      expect(existsSync(path.join(result.dir, file)), file).toBe(true);
    }
    const manifest = JSON.parse(await text(result.dir, '_manifest.json'));
    expect(manifest).toMatchObject({
      source: 'browser-inspector',
      type: 'flow',
      completed: true,
      stamp: '2026-09-02_10-00',
    });
  }, 60_000);

  it('a password in an iframe or a shadow root never reaches snap.md / snap.full.yml (AC-10)', async () => {
    const inFrame = await run({
      name: 'ramka',
      url: a.url('iframe.html'),
      stepTimeoutMs: 5000,
      steps: [
        { do: 'waitFor', selector: 'iframe' },
        { do: 'frame', frame: '1' },
        { do: 'fill', selector: '[data-testid=child-pass]', value: 'TAJNE-W-RAMCE' },
        { do: 'snapshot' },
        // The navigation detaches the frame; the scope has to go with it, or every CSS selector
        // after it answers `Frame was detached` — in a session until the agent guesses `frame main`.
        { do: 'goto', url: a.url('iframe.html') },
        { do: 'click', selector: '[data-testid=parent-button]' },
      ],
    });
    expect(inFrame.failure).toBeUndefined();
    expect(inFrame.completed).toBe(true);
    expect(await text(inFrame.dir, 'snap.full.yml')).not.toContain('TAJNE-W-RAMCE');
    expect(await text(inFrame.dir, 'snap.md')).not.toContain('TAJNE-W-RAMCE');
    const framed = JSON.parse(await text(inFrame.dir, 'snap.json'));
    const childPass = framed.find((/** @type {any} */ e) => e.selector === '[data-testid="child-pass"]');
    expect(childPass).toMatchObject({ sensitive: true });
    expect(String(childPass.ref)).toMatch(/^f\d+e\d+$/u);
    // The element map lists the main frame only, but the count is the whole page — an app inside an
    // iframe is not an empty page (DESIGN.md §5.1).
    expect(inFrame.report.elements?.total).toBeGreaterThan(inFrame.report.elements?.entries.length ?? 0);

    const shadow = await run({
      name: 'shadow',
      url: a.url('shadow.html'),
      stepTimeoutMs: 5000,
      steps: [{ do: 'fill', selector: '[data-testid=sd-pass]', value: 'TAJNE-W-KOMPONENCIE' }, { do: 'snapshot' }],
    });
    expect(shadow.failure).toBeUndefined();
    expect(await text(shadow.dir, 'snap.full.yml')).not.toContain('TAJNE-W-KOMPONENCIE');
    expect(await text(shadow.dir, 'snap.md')).not.toContain('TAJNE-W-KOMPONENCIE');
    const inShadow = JSON.parse(await text(shadow.dir, 'snap.json'));
    expect(inShadow.find((/** @type {any} */ e) => e.selector === '[data-testid="sd-pass"]')).toMatchObject({
      sensitive: true,
    });
    // Three controls, all of them inside the open shadow root — the map used to see none.
    expect(shadow.report.elements?.total).toBe(3);
  }, 60_000);

  it('the scrub keeps the HTTP cache: the second run on the same lane counts cacheHits (AC-12)', async () => {
    // The number this pins is a design claim, not a detail: `SCRUB_STORAGE_TYPES` deliberately omits
    // `all`, so the scrub clears storage and leaves the HTTP cache — that is what makes a warm run
    // 20 ms instead of 250. It is also the guard this metric never had: `cacheHits` was read from
    // `response.fromCache()`, a method playwright-core does not have, so it reported 0 for every run
    // ever measured and no test noticed. A positive assertion is the only kind that would have.
    const flow = { url: a.url('cache.html'), steps: [{ do: 'waitFor', selector: '[data-testid=cache-heading]' }] };
    const first = await run(flow);
    expect(first.completed).toBe(true);
    // `cacheable.css` is the only fixture the server sends with `Cache-Control` — cold, it is a miss.
    expect(first.report.timing.cacheHits).toBe(0);
    const second = await run(flow);
    expect(second.completed).toBe(true);
    expect(second.report.timing.ctx).toBe('reused');
    expect(second.report.timing.cacheHits).toBeGreaterThan(0);
    // The document itself carries no caching headers, so it is fetched again both times.
    expect(second.report.timing.cacheHitsDocument).toBe(0);
  });

  it('a navigation that never reached a server is not a cache hit (the Chrome error page is not the document)', async () => {
    // `chrome-error://chromewebdata/` reports `deliveryType: 'cache'` with `transferSize: 0` for a
    // body Chrome made up, so a failed run used to claim the document came from the HTTP cache —
    // the one number whose whole point is warning about a stale build after a rebuild.
    const dead = await run({ url: 'http://127.0.0.1:4519/nie-ma', navTimeoutMs: 5000, type: 'page' });
    expect(dead.completed).toBe(false);
    expect(String(dead.report.navigationError)).toContain('net::ERR');
    expect(dead.report.finalUrl.startsWith('chrome-error://')).toBe(true);
    expect(dead.report.timing.cacheHitsDocument).toBe(0);
    expect(dead.report.timing.cacheHits).toBe(0);
  }, 30_000);

  it('a failing step writes final.png and the Error: form; evaluate maps like the old runner', async () => {
    const result = await run({
      url: a.url('storage.html'),
      stepTimeoutMs: 3000,
      steps: [
        { do: 'evaluate', name: 'u', expression: 'undefined' },
        { do: 'evaluate', name: 't', expression: 'document.title' },
        { do: 'evaluate', name: 'o', expression: '({ a: 1, b: [1, 2] })' },
        { do: 'evaluate', name: 'p', expression: 'new Promise((r) => setTimeout(() => r("late"), 50))' },
        {
          do: 'evaluate',
          name: 'boom',
          expression: '(() => { throw new Error("uczen widzi przycisk nauczyciela"); })()',
        },
        { do: 'click', selector: '[data-testid=set]' },
      ],
    });
    expect(result.completed).toBe(false);
    expect(result.report.extracts).toMatchObject({
      u: { value: 'undefined' },
      t: { value: 'Storage' },
      o: { value: '{"a":1,"b":[1,2]}' },
      p: { value: 'late' },
    });
    expect(result.report.steps[4]).toMatchObject({ ok: false, error: 'Error: uczen widzi przycisk nauczyciela' });
    expect(result.report.skipped).toBe(1);
    expect(result.report.screenshots).toEqual(['final.png']);
    expect(existsSync(path.join(result.dir, 'final.png'))).toBe(true);
    expect(result.failure).toBe('step 5 "evaluate boom" — Error: uczen widzi przycisk nauczyciela');
    expect(await text(result.dir, 'report.md')).toContain('## steps');

    const node = await run({
      url: a.url('storage.html'),
      steps: [{ do: 'evaluate', name: 'n', expression: 'document.body' }],
    });
    expect(node.report.steps[0].error).toMatch(/^Error: evaluate returned a DOM node/u);

    const hang = await run({
      url: a.url('storage.html'),
      stepTimeoutMs: 1000,
      steps: [{ do: 'evaluate', name: 'h', expression: 'new Promise(() => {})', timeout: 300 }],
    });
    expect(hang.report.steps[0].error).toBe('Error: evaluate "h" timed out after 300ms');
    // The page is alive after the timed-out evaluate — the next run reuses the tab.
    const alive = await run({
      url: a.url('storage.html'),
      steps: [{ do: 'evaluate', name: 'x', expression: '1 + 1' }],
    });
    expect(alive.report.extracts.x.value).toBe('2');
    expect(alive.timing.tab).toBe('kept');
  }, 60_000);

  it('dialogs follow the policy: snapshot-level accept, a dialog step, --text and --once, all recorded', async () => {
    const result = await run({
      url: a.url('dialog.html'),
      dialogs: 'accept',
      stepTimeoutMs: 3000,
      steps: [
        { do: 'click', selector: '[data-testid=confirm]' },
        { do: 'verify', kind: 'text', selector: '[data-testid=dialog-result]', text: 'confirm accepted' },
        { do: 'dialog', action: 'dismiss' },
        { do: 'click', selector: '[data-testid=prompt]' },
        { do: 'verify', kind: 'text', selector: '[data-testid=dialog-result]', text: 'prompt dismissed' },
        { do: 'dialog', action: 'accept', text: 'Ala', once: true },
        { do: 'click', selector: '[data-testid=prompt]' },
        { do: 'verify', kind: 'text', selector: '[data-testid=dialog-result]', text: 'prompt: Ala' },
        { do: 'click', selector: '[data-testid=alert]' },
        { do: 'verify', kind: 'text', selector: '[data-testid=dialog-result]', text: 'alert closed' },
      ],
    });
    expect(result.failure).toBeUndefined();
    expect(result.report.dialogs.map((d) => [d.type, d.action])).toEqual([
      ['confirm', 'accepted'],
      ['prompt', 'dismissed'],
      ['prompt', 'accepted'],
      ['alert', 'dismissed'],
    ]);
    expect(result.report.dialogs[0].trigger).toBe('click [data-testid=confirm]');
  }, 30_000);

  it('upload sends a file the client named; drag drops onto the target', async () => {
    const file = path.join(out, 'notatka.txt');
    await writeFile(file, 'hello upload');
    const upload = await run({
      url: a.url('upload.html'),
      steps: [
        { do: 'upload', selector: '[data-testid=file]', files: [file] },
        { do: 'verify', kind: 'text', selector: '[data-testid=count]', text: '1 files' },
        { do: 'extract', name: 'lista', selector: '[data-testid=files]' },
      ],
    });
    expect(upload.failure).toBeUndefined();
    expect(upload.report.extracts.lista.value).toBe('notatka.txt (12 B)');

    const drag = await run({
      url: a.url('drag.html'),
      steps: [
        { do: 'drag', from: '[data-testid=drag-source]', to: '[data-testid=drop-target]' },
        { do: 'verify', kind: 'text', selector: '[data-testid=drop-result]', text: 'dropped: item-a' },
        { do: 'verify', kind: 'text', selector: '[data-testid=drop-target]', text: 'Got it' },
      ],
    });
    expect(drag.failure).toBeUndefined();
  }, 30_000);

  it('routes: the snapshot-level block, a route step with a body, unroute back to the server', async () => {
    const result = await run({
      url: a.url('routes.html'),
      routes: [{ url: '**/api/data', block: true }],
      stepTimeoutMs: 3000,
      steps: [
        { do: 'click', selector: '[data-testid=load]' },
        { do: 'verify', kind: 'text', selector: '[data-testid=api-result]', text: 'error: network' },
        { do: 'route', url: '**/api/data', body: '{"source":"stub"}', contentType: 'application/json' },
        { do: 'click', selector: '[data-testid=load]' },
        { do: 'verify', kind: 'text', selector: '[data-testid=api-result]', text: '"stub"' },
        { do: 'unroute', url: '**/api/data' },
        { do: 'click', selector: '[data-testid=load]' },
        { do: 'verify', kind: 'text', selector: '[data-testid=api-result]', text: '"server"' },
        { do: 'route', url: '**/api/data', status: 503, body: 'down' },
        { do: 'click', selector: '[data-testid=load]' },
        { do: 'verify', kind: 'text', selector: '[data-testid=api-result]', text: 'error: 503 down' },
      ],
    });
    expect(result.failure).toBeUndefined();
    expect(result.report.network.failed.some((e) => e.status === 503)).toBe(true);
  }, 30_000);

  it('isolation on one tab: what run A leaves on two origins, run B does not see, and history starts at 1', async () => {
    const dirty = await run({
      url: a.url('storage.html'),
      dialogs: 'accept',
      routes: [{ url: '**/never-called', block: true }],
      steps: [
        { do: 'click', selector: '[data-testid=set]' },
        { do: 'click', selector: '[data-testid=nav]' },
        { do: 'click', selector: '[data-testid=nav]' },
        { do: 'extract', name: 'a-state', selector: '[data-testid=state]' },
        { do: 'goto', url: b.url('storage.html') },
        { do: 'click', selector: '[data-testid=set]' },
        { do: 'click', selector: '[data-testid=nav]' },
        { do: 'extract', name: 'b-state', selector: '[data-testid=state]' },
        { do: 'extract', name: 'b-history', selector: '[data-testid=history]' },
        { do: 'storage', kind: 'cookies', op: 'list', name: 'cookies' },
      ],
    });
    expect(dirty.failure).toBeUndefined();
    expect(dirty.report.extracts['a-state'].value).toBe(
      `{"ls":"L@${String(PORT_A)}","ss":"S@${String(PORT_A)}","cookie":"browser-inspector-cookie=C@${String(PORT_A)}"}`,
    );
    expect(dirty.report.extracts['b-state'].value).toBe(
      `{"ls":"L@${String(PORT_B)}","ss":"S@${String(PORT_B)}","cookie":"browser-inspector-cookie=C@${String(PORT_B)}"}`,
    );
    // history.length is per TAB, not per origin: load, push, push, goto, push.
    expect(dirty.report.extracts['b-history'].value).toBe('history 5');
    // Cookies are not port-scoped: the second origin overwrote the first one's `browser-inspector-cookie`.
    expect(JSON.parse(dirty.report.extracts.cookies.value)).toEqual([
      expect.objectContaining({ name: 'browser-inspector-cookie', value: `C@${String(PORT_B)}` }),
    ]);

    const clean = await run({
      url: a.url('storage.html'),
      steps: [
        { do: 'extract', name: 'a-state', selector: '[data-testid=state]' },
        { do: 'evaluate', name: 'a-history', expression: 'history.length' },
        { do: 'storage', kind: 'session', op: 'list', name: 'a-session' },
        { do: 'goto', url: b.url('storage.html') },
        { do: 'extract', name: 'b-state', selector: '[data-testid=state]' },
        { do: 'storage', kind: 'cookies', op: 'list', name: 'cookies' },
        { do: 'back' },
        { do: 'evaluate', name: 'after-back', expression: 'location.port' },
      ],
    });
    expect(clean.failure).toBeUndefined();
    expect(clean.timing).toMatchObject({ ctx: 'reused', tab: 'kept', mode: 'warm' });
    expect(clean.report.extracts['a-state'].value).toBe('{"ls":"","ss":"","cookie":""}');
    expect(clean.report.extracts['a-history'].value).toBe('1');
    // The generation marker is the ONE key the engine leaves in sessionStorage (DESIGN.md §2.3).
    expect(Object.keys(JSON.parse(clean.report.extracts['a-session'].value))).toEqual(['__bi_gen']);
    expect(clean.report.extracts['b-state'].value).toBe('{"ls":"","ss":"","cookie":""}');
    expect(clean.report.extracts.cookies.value).toBe('[]');
    // `back` stays inside this run: the previous run's pages are not in the history any more.
    expect(clean.report.extracts['after-back'].value).toBe(String(PORT_A));
    expect(clean.report.engine.generation).toBeGreaterThan(dirty.report.engine.generation);
    // AC-11: the scrub between the two runs costs ≤ 50 ms on the fixture (two origins).
    expect(clean.timing.scrubMs).toBeGreaterThan(0);
    expect(clean.timing.scrubMs).toBeLessThanOrEqual(50);
  }, 60_000);

  it('refs: a snapshot step yields [ref=eN] lines, a click through aria-ref= works, a dead ref fails fast', async () => {
    const lane = await engine.getLane(0);
    if (lane.dirty) await engine.scrub(lane);
    const dir = path.join(out, 'refs');
    const ctx = engine.makeStepContext({
      page: lane.page,
      context: lane.context,
      cdp: lane.cdp,
      recorder: lane.recorder,
      dir,
      timeoutMs: 3000,
      mode: 'batch',
      snapshot: { waitUntil: 'load' },
    });
    try {
      await ctx.navigate(a.url('storage.html'), 'load');
      const snap = await engine.runStep(ctx, { do: 'snapshot' }, 0);
      expect(snap.ok, snap.error).toBe(true);
      const yaml = ctx.lastSnapshot?.text ?? '';
      // A reused tab's refs carry the frame sequence after its first navigation (`f11e3`, WP3
      // fact 2); they still go to the page as `aria-ref=<ref>` literally.
      expect(yaml).toMatch(/\[ref=(?:f\d+)?e\d+\]/u);
      const match = /button "Set storage"[^\n]*\[ref=((?:f\d+)?e\d+)\]/u.exec(yaml);
      expect(match).not.toBeNull();
      const ref = /** @type {RegExpExecArray} */ (match)[1];
      const compact = await text(dir, 'snap.md');
      expect(compact).toContain(`${ref} button "Set storage" [data-testid=set]`);
      const sidecar = JSON.parse(await text(dir, 'snap.json'));
      expect(sidecar.find((e) => e.ref === ref)).toMatchObject({ role: 'button', selector: '[data-testid="set"]' });

      const click = await engine.runStep(ctx, { do: 'click', ref }, 1);
      expect(click.ok, click.error).toBe(true);
      const state = await engine.runStep(ctx, { do: 'extract', name: 'state', selector: '[data-testid=state]' }, 2);
      expect(state.ok).toBe(true);
      expect(ctx.capture.extracts.state.value).toContain(`L@${String(PORT_A)}`);

      const started = performance.now();
      const dead = await engine.runStep(ctx, { do: 'click', ref: 'e9999' }, 3);
      expect(performance.now() - started).toBeLessThan(500);
      expect(dead.ok).toBe(false);
      // `runStep` keeps the bare message; `buildReport` adds the `Error: ` prefix in report.json.
      expect(dead.error).toBe('ref not found (gone, label changed or other frame) → browser-inspector snap');
    } finally {
      lane.dirty = true;
    }
  }, 30_000);

  it('waitUntil settled beats networkidle by ≥ 150 ms on slow.html and still sees the late DOM (AC-16)', async () => {
    const steps = [{ do: 'verify', kind: 'visible', selector: '[data-testid=late]' }];
    const slow = (/** @type {string} */ waitUntil) => run({ url: a.url('slow.html?delay=300'), waitUntil, steps });
    // Two samples each, the better one counts: the first goto to a path can pay a one-off
    // (renderer warm-up, GC) that has nothing to do with the wait policy. Measured steady state:
    // settled ≈ 450 ms (300 ms XHR + 100 ms quiet), networkidle ≈ 830 ms (+ 500 ms of silence).
    const settled = [await slow('settled'), await slow('settled')];
    const idle = [await slow('networkidle'), await slow('networkidle')];
    for (const r of [...settled, ...idle]) expect(r.failure).toBeUndefined();
    const best = (/** @type {typeof settled} */ runs) => Math.min(...runs.map((r) => r.timing.gotoMs));
    expect(best(settled)).toBeGreaterThanOrEqual(300);
    expect(best(idle) - best(settled)).toBeGreaterThanOrEqual(150);
    // A page that polls forever settles at the cap instead of failing.
    const capped = await run({
      url: a.url('slow.html?poll=1&delay=50'),
      waitUntil: 'settled',
      settleMs: 600,
      steps: [{ do: 'wait', ms: 1 }],
    });
    expect(capped.completed).toBe(true);
    expect(capped.timing.gotoMs).toBeLessThan(2000);
  }, 60_000);

  it('type: page writes page.png; captureSnapshot writes snap.md with box-joined selectors', async () => {
    const page = await run({ type: 'page', url: a.url('form.html'), fullPage: true, captureSnapshot: true });
    expect(page.completed).toBe(true);
    expect(page.report.screenshots).toEqual(['page.png']);
    expect(existsSync(path.join(page.dir, 'page.png'))).toBe(true);
    expect(page.report.files).toMatchObject({ snapshot: 'snap.md', elements: 'elements.md', text: 'text.txt' });
    const compact = await text(page.dir, 'snap.md');
    expect(compact).toMatch(/^(?:f\d+)?e\d+ button "Wyślij zgłoszenie" \[data-testid=submit\]$/mu);
    expect(compact).toMatch(/^(?:f\d+)?e\d+ textbox "Imię i nazwisko" \[data-testid=field-name\]$/mu);
    expect(page.report.text.content).toContain('Zgłoszenie serwisowe');
  }, 30_000);

  it('isolation: fresh runs in a new context with service workers allowed; --fresh forces it', async () => {
    const fresh = await run({
      url: a.url('storage.html'),
      isolation: 'fresh',
      steps: [{ do: 'click', selector: '[data-testid=set]' }],
    });
    expect(fresh.failure).toBeUndefined();
    expect(fresh.timing).toMatchObject({ ctx: 'fresh', tab: 'new' });
    expect(fresh.report.engine.serviceWorkers).toBe('allow');
    const forced = await run({ url: a.url('storage.html'), steps: [{ do: 'wait', ms: 1 }] }, { fresh: true });
    expect(forced.timing.ctx).toBe('fresh');
    // The scratch lane did not see the fresh run's storage.
    const lane = await run({
      url: a.url('storage.html'),
      steps: [{ do: 'extract', name: 'state', selector: '[data-testid=state]' }],
    });
    expect(lane.report.extracts.state.value).toBe('{"ls":"","ss":"","cookie":""}');
    expect(lane.timing.ctx).toBe('reused');
  }, 30_000);

  it('a crashed renderer (CDP Page.crash) is rebuilt at the next scrub: timing.tab = new, the run works', async () => {
    const before = await run({ url: a.url('storage.html'), steps: [{ do: 'wait', ms: 1 }] });
    expect(before.timing.tab).toBe('kept');
    const lane = engine.lanes.get(0);
    expect(lane).toBeDefined();
    const crashed = new Promise((resolve) => lane?.page.once('crash', () => resolve(true)));
    // `Page.crash` kills the renderer of this target only; `chrome://crash` takes the whole
    // browser down in headless Chrome 152 (the next test covers that).
    // `Page.crash` never answers (the renderer is gone) — fire and forget, wait for the event.
    void lane?.cdp.send('Page.crash').catch(() => {});
    expect(await Promise.race([crashed, new Promise((r) => setTimeout(() => r(false), 5000))])).toBe(true);
    const next = await run({
      url: a.url('storage.html'),
      // Live `history.length`, not the text the page rendered at load (before the reset).
      steps: [{ do: 'evaluate', name: 'history', expression: 'history.length' }],
    });
    expect(next.failure).toBeUndefined();
    expect(next.timing).toMatchObject({ tab: 'new', ctx: 'reused', mode: 'warm' });
    expect(next.report.extracts.history.value).toBe('1');
    const after = await run({ url: a.url('storage.html'), steps: [{ do: 'wait', ms: 1 }] });
    expect(after.timing.tab).toBe('kept');
  }, 60_000);

  it('a browser that dies mid-run is reported as disconnected and relaunched for the next run', async () => {
    const events = [];
    engine.on('disconnected', () => events.push('disconnected'));
    const dead = await run({
      url: a.url('storage.html'),
      navTimeoutMs: 5000,
      steps: [{ do: 'goto', url: 'chrome://crash' }],
    });
    expect(dead.completed).toBe(false);
    expect(dead.report.steps[0].ok).toBe(false);
    expect(events).toEqual(['disconnected']);
    const next = await run({
      url: a.url('storage.html'),
      // Live `history.length`, not the text the page rendered at load (before the reset).
      steps: [{ do: 'evaluate', name: 'history', expression: 'history.length' }],
    });
    expect(next.failure).toBeUndefined();
    expect(next.timing).toMatchObject({ mode: 'first', tab: 'new' });
    expect(next.report.extracts.history.value).toBe('1');
    expect(engine.status().launches).toBe(2);
  }, 60_000);
});

// ── Sessions through the keeper (WP6; AC-8, AC-9, AC-15) ─────────────────────
//
// The real client (`bin/browser-inspector.mjs`, one process per command) → a real keeper on its own pipe → the
// real engine on Chrome/Edge: `browser-inspector up`, the session commands of DESIGN.md §4.4 on form.html,
// relabel.html, iframe.html, tabs.html and dialog.html, `browser-inspector doctor`, `browser-inspector stop`; then `browser-inspector script`
// under `--no-daemon`. Every line is measured against the budget of AC-8 with the bench's tokenizer.

const PORT_SESSION = 4541;
/** Commands whose stdout IS content (AC-8 exempts them from the 40-token cap, not from 160 chars). */
const CONTENT = new Set(['find', 'snap', 'console', 'net', 'eval', 'get', 'tabs']);

describe.skipIf(skip)('smoke: session commands through the keeper', () => {
  /** @type {Awaited<ReturnType<typeof startFixtureServer>>} */
  let server;
  /** @type {ReturnType<typeof makeEnv>} */
  let h;

  beforeAll(async () => {
    server = await startFixtureServer(PORT_SESSION);
    h = makeEnv();
    // The real engine, not the fake the keeper tests wire in.
    delete h.env.BROWSER_INSPECTOR_ENGINE_MODULE;
    delete h.env.BROWSER_INSPECTOR_FAKE_LOG;
  }, 30_000);

  afterAll(async () => {
    if (h) await stopKeeper(h);
    await server?.close();
    if (h) cleanup(h);
  });

  /**
   * Run one `browser-inspector` command against the keeper and check the line budget of AC-8.
   * @param {string[]} argv
   * @param {{ exit?: number }} [expectation]
   */
  async function cmd(argv, expectation = {}) {
    const result = await runBrowserInspector(argv, h);
    const wanted = expectation.exit ?? 0;
    expect(result.code, `${argv.join(' ')}\n${result.stdout}${result.stderr}`).toBe(wanted);
    const content = CONTENT.has(argv[0]);
    if (!content) expect(result.lines, argv.join(' ')).toHaveLength(1);
    for (const line of result.lines) {
      if (argv[0] === 'net' && argv.includes('--body')) continue;
      expect(line.length, line).toBeLessThanOrEqual(160);
      if (!content) expect(encode(line).length, line).toBeLessThanOrEqual(40);
    }
    return result;
  }

  const refOf = (/** @type {string} */ line) => line.split(' ')[0];
  const sessionDir = () => path.join(h.cwd, '.scribe-devtools', 'browser-inspector', 'session', 'default');

  it('browser-inspector up → session commands on form/relabel/iframe/tabs/dialog → export → doctor → close → stop', async () => {
    const up = await cmd(['up']);
    expect(up.lines[0]).toMatch(/^ok keeper up · pid \d+ · hash [0-9a-f]{8} · /u);

    // form.html: open, find, fill, form, check, click, wait, console, net, eval, shot, get, snap, verify
    const open = await cmd(['open', server.url('form.html')]);
    expect(open.lines[0]).toMatch(
      /^ok open "Zgłoszenie serwisowe" · el \d+ · err \d+ · .*session\/default\/snap\.md$/u,
    );
    const submit = refOf((await cmd(['find', 'Wyślij zgłoszenie'])).lines[0]);
    expect(submit).toMatch(/^(?:f\d+)?e\d+$/u);
    const nameLine = (await cmd(['find', 'Imię i nazwisko'])).lines.find((l) => l.includes(' textbox '));
    expect(nameLine).toContain('[data-testid=field-name]');
    const nameRef = refOf(/** @type {string} */ (nameLine));
    const fill = await cmd(['fill', nameRef, 'Jan Kowalski']);
    expect(fill.lines[0]).toMatch(new RegExp(`^ok fill ${nameRef}(?: · .*)?$`, 'u'));
    expect(fill.stdout).not.toContain('Jan Kowalski');
    const form = await cmd(['form', '#email=jan@example.com', '#description=Formularz nie zapisuje zgloszenia.']);
    expect(form.lines[0]).toMatch(/^ok form 2 fields/u);
    expect((await cmd(['check', '[data-testid=field-consent]'])).lines[0]).toMatch(/^ok check /u);
    const click = await cmd(['click', submit]);
    expect(click.lines[0]).toMatch(new RegExp(`^ok click ${submit} · dom Δ`, 'u'));
    expect((await cmd(['wait', '--text', 'ALM-1001'])).lines[0]).toBe('ok wait text "ALM-1001"');
    // The POST the page fires after the submit lands a few ms later — give it a beat.
    expect((await cmd(['wait', '300'])).lines[0]).toBe('ok wait 300ms');
    const errors = await cmd(['console', '--errors']);
    expect(errors.lines[0]).toMatch(/^\d+ new/u);
    expect(errors.lines.some((l) => l.includes('[zgloszenia] zapis nie powiodl sie: HTTP 404'))).toBe(true);
    expect((await cmd(['console'])).lines).toEqual(['0 new']);
    const net = await cmd(['net', '--failed']);
    const failed = /#(\d+) POST \/api\/zgloszenia 404/u.exec(net.stdout);
    expect(failed, net.stdout).not.toBeNull();
    const id = /** @type {RegExpExecArray} */ (failed)[1];
    const body = await cmd(['net', id, '--body']);
    expect(body.lines[0]).toMatch(new RegExp(`^404 application/json \\d+ B · .*session/default/net/${id}\\.txt$`, 'u'));
    expect(body.lines[1]).toBe('{"error":"not found"}');
    expect((await cmd(['eval', 'document.title'])).lines).toEqual(['Zgłoszenie serwisowe']);
    expect((await cmd(['eval', '({ a: 1, b: [1, 2] })'])).lines).toEqual(['{"a":1,"b":[1,2]}']);
    const shot = await cmd(['shot', 'koszyk']);
    expect(shot.lines[0]).toMatch(/^ok shot .*session\/default\/shots\/001-koszyk\.png 1280x720$/u);
    expect(existsSync(path.join(sessionDir(), 'shots', '001-koszyk.png'))).toBe(true);
    expect((await cmd(['get', '[data-testid=ticket-id]'])).lines).toEqual(['ALM-1001']);
    // The confirmation view is short (a heading, a button, two nav links): --max 2 overflows for sure.
    const snap = await cmd(['snap', '--max', '2']);
    expect(snap.lines).toHaveLength(3);
    expect(snap.lines[2]).toMatch(/^…\+\d+ lines · .*session\/default\/snap\.md$/u);
    expect((await cmd(['verify', 'text', '[data-testid=ticket-id]', 'ALM-1001'])).lines).toEqual([
      'ok verify text [data-testid=ticket-id]',
    ]);

    // relabel.html (AC-9): the old ref of a re-labelled button fails fast after a full snapshot.
    await cmd(['open', server.url('relabel.html')]);
    const add = refOf((await cmd(['find', 'Dodaj do koszyka'])).lines[0]);
    expect((await cmd(['click', add])).lines[0]).toMatch(new RegExp(`^ok click ${add}`, 'u'));
    const relabelled = await cmd(['snap']);
    expect(relabelled.stdout).toContain('button "W koszyku"');
    const dead = await cmd(['click', add], { exit: 1 });
    expect(dead.lines).toEqual([
      `FAIL click ${add} · ref not found (gone, label changed or other frame) → browser-inspector snap`,
    ]);
    const deadEntry = readJournal(path.join(sessionDir(), 'journal.jsonl')).at(-1);
    expect(deadEntry).toMatchObject({ command: 'click', ok: false });
    // The failure took milliseconds in the engine; the process spawn around it is the client's cost.
    expect(Number(deadEntry?.ms)).toBeLessThan(100);

    // iframe.html: a ref inside the frame resolves from the page; `frame` scopes CSS selectors only.
    await cmd(['open', server.url('iframe.html')]);
    const inFrame = refOf((await cmd(['find', 'Przycisk w ramce'])).lines[0]);
    expect(inFrame).toMatch(/^f\d+e\d+$/u);
    expect((await cmd(['click', inFrame])).lines[0]).toMatch(new RegExp(`^ok click ${inFrame}`, 'u'));
    expect((await cmd(['frame', '1'])).lines).toEqual(['ok frame 1']);
    expect((await cmd(['get', '#child-out'])).lines).toEqual(['kliknięto w ramce']);
    expect((await cmd(['frame', 'main'])).lines).toEqual(['ok frame main']);
    expect((await cmd(['get', '#parent-out'])).lines).toEqual(['nic']);

    // tabs.html: a popup becomes a tab of the session.
    await cmd(['open', server.url('tabs.html')]);
    await cmd(['click', '[data-testid=popup-link]']);
    await cmd(['wait', '200']);
    const tabs = await cmd(['tabs']);
    expect(tabs.lines).toEqual(['0* "Karty" /tabs.html', '1 "Dziecko karty" /tabs.html?child=1']);
    expect((await cmd(['tab', '1'])).lines[0]).toBe('ok tab select 1 · url /tabs.html?child=1 "Dziecko karty"');
    expect((await cmd(['click', '[data-testid=child-button]'])).lines[0]).toMatch(/^ok click /u);
    expect((await cmd(['get', '#out'])).lines).toEqual(['kliknięto w karcie']);
    expect((await cmd(['tab', 'close'])).lines[0]).toBe('ok tab close · url /tabs.html "Karty"');
    expect((await cmd(['tabs'])).lines).toEqual(['0* "Karty" /tabs.html']);

    // dialog.html: the policy set before the action; beforeunload always accepted.
    await cmd(['open', server.url('dialog.html')]);
    expect((await cmd(['dialog', 'accept'])).lines).toEqual(['ok dialog accept']);
    const confirm = await cmd(['click', '[data-testid=confirm]']);
    expect(confirm.lines[0]).toContain('dialog confirm "Usunąć?" → accepted');
    expect((await cmd(['dialog'])).lines[0]).toMatch(/^policy accept · last: confirm "Usunąć\?" → accepted \(click /u);
    const leave = await cmd(['click', '[data-testid=leave]']);
    expect(leave.lines[0]).toMatch(/navigated → refs f\d+eN \(browser-inspector snap\)/u);
    expect(leave.lines[0]).toContain('dialog beforeunload "" → accepted');

    // export: refs → selectors; status counts the session; doctor; close; stop.
    const exported = await cmd(['export', 'flows/koszyk.json']);
    expect(exported.lines[0]).toMatch(
      /^ok export \d+ steps → flows\/koszyk\.json \(refs → data-testid\/#id\/role=\)$/u,
    );
    const flow = JSON.parse(await readFile(path.join(h.cwd, 'flows', 'koszyk.json'), 'utf8'));
    expect(flow.snapshots[0].url).toBe(server.url('form.html'));
    expect(flow.snapshots[0].steps.find((s) => s.do === 'fill')).toEqual({
      do: 'fill',
      selector: '[data-testid="field-name"]',
      value: 'Jan Kowalski',
    });
    expect(JSON.stringify(flow)).not.toMatch(/"ref":/u);
    const status = await runBrowserInspector(['status'], h);
    expect(status.code).toBe(0);
    expect(status.lines[1]).toContain('sessions 1');
    const doctor = await runBrowserInspector(['doctor'], h);
    expect(doctor.code, doctor.stdout + doctor.stderr).toBe(0);
    expect(doctor.lines[0]).toMatch(
      /^ok keeper survives shell: yes · spawn→listen [\d ]+ ms · first job [\d ]+ ms · warm [\d ]+ ms · hash [0-9a-f]{8} · /u,
    );
    const close = await cmd(['close']);
    expect(close.lines[0]).toMatch(/^ok close · session default · \d+ commands · .*session\/default$/u);
    const orphan = await cmd(['click', 'e1'], { exit: 1 });
    expect(orphan.lines).toEqual(['FAIL click e1 · no open session "default" → browser-inspector open <url>']);
    const stop = await runBrowserInspector(['stop'], h);
    expect(stop.code).toBe(0);
    expect(stop.lines[0]).toMatch(/^ok keeper stopping/u);
  }, 120_000);

  it('browser-inspector script <file> --no-daemon runs the session lines in one process and prints the same lines', async () => {
    // Whatever the previous test left (a keeper survives a failed assertion), this one starts clean.
    await stopKeeper(h);
    const script = path.join(h.cwd, 'session.txt');
    await writeFile(
      script,
      [
        '# a session as a file — one command per line, comments and blank lines allowed',
        `open ${server.url('form.html')}`,
        '',
        'fill #name "Jan Kowalski"',
        'click [data-testid=submit]',
        'wait --text "Podaj poprawny adres e-mail."',
        'verify text [data-testid=invalid-count] "Niepoprawnych pól: 3"',
        'get [data-testid=invalid-count]',
        'console --level warn',
        'close',
      ].join('\n'),
    );
    const out = path.join(h.cwd, 'script-out');
    const result = await runBrowserInspector(['script', script, '--out', out, '--no-daemon'], h);
    expect(result.code, result.stdout + result.stderr).toBe(0);
    expect(result.lines[0]).toMatch(
      /^ok open "Zgłoszenie serwisowe" · el \d+ · err \d+ · script-out\/session\/default\/snap\.md$/u,
    );
    expect(result.lines.slice(1, 5)).toEqual([
      expect.stringMatching(/^ok fill #name(?: · dom Δ)?$/u),
      expect.stringMatching(/^ok click \[data-testid=submit\] · dom Δ/u),
      'ok wait text "Podaj poprawny adres e-mail."',
      'ok verify text [data-testid=invalid-count]',
    ]);
    expect(result.lines[5]).toBe('Niepoprawnych pól: 3');
    expect(result.lines.slice(6).some((l) => l.includes('[zgloszenia] odrzucono wysylke: 3 niepoprawnych pol'))).toBe(
      true,
    );
    expect(result.lines.at(-1)).toMatch(/^ok close · session default · 8 commands/u);
    expect(existsSync(path.join(out, 'session', 'default', 'journal.jsonl'))).toBe(true);
    // No keeper was left behind by the in-process run.
    const status = await runBrowserInspector(['status'], h);
    expect(status.lines[0]).toMatch(/^keeper not running/u);

    const failing = path.join(h.cwd, 'failing.txt');
    await writeFile(
      failing,
      [`open ${server.url('form.html')}`, 'click e9999', 'get [data-testid=page-title]'].join('\n'),
    );
    const failed = await runBrowserInspector(['script', failing, '--out', out, '--no-daemon'], h);
    expect(failed.code).toBe(1);
    expect(failed.lines).toHaveLength(2);
    expect(failed.lines[1]).toBe(
      'FAIL click e9999 · ref not found (gone, label changed or other frame) → browser-inspector snap',
    );
  }, 60_000);
});
