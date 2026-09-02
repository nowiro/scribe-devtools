// The batch engine on a FakePage (DESIGN.md §2.2, §2.3, §3.3, §5): step → call mapping, the
// final-screenshot rules, the scrub between snapshots, `evaluate` through CDP under a deadline
// with the old result mapping, value addressing, health (crash, disconnect, recycling) and the
// files a run leaves behind — without a browser process.
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { createEngine } from '../src/engine.mjs';
import {
  BrowserMissingError,
  E_BROWSER_MISSING,
  FAST_HEADLESS_ARGS,
  launchBrowser,
  launchPlan,
} from '../src/lanes.mjs';
import { RUNNERS } from '../src/steps.run.mjs';
import { STEPS } from '../src/steps.schema.mjs';
import { callsOf, createFakeBrowser } from './fake-browser.mjs';

/** @type {string[]} */
const dirs = [];
/** @type {{ close: () => Promise<void> }[]} */
const engines = [];

afterEach(async () => {
  for (const engine of engines.splice(0)) await engine.close();
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function tmp() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'browser-inspector-engine-'));
  dirs.push(dir);
  return dir;
}

/**
 * @param {import('./fake-browser.mjs').FakeOptions} [fakeOptions]
 * @param {Record<string, any>} [engineOptions]
 */
function harness(fakeOptions = {}, engineOptions = {}) {
  const fake = createFakeBrowser(fakeOptions);
  const engine = createEngine({ launch: async () => fake, prewarm: false, env: {}, ...engineOptions });
  engines.push(engine);
  return { fake, engine, calls: fake.calls };
}

/** A normalized flow snapshot, the shape `loadConfig` produces. @param {any[]} steps @param {Record<string, any>} [extra] */
const flow = (steps, extra = {}) => ({
  name: 'test',
  type: 'flow',
  url: 'http://localhost:4300/',
  waitUntil: 'load',
  viewport: { width: 1280, height: 720 },
  navTimeoutMs: 1000,
  stepTimeoutMs: 300,
  captureElements: true,
  captureNetwork: true,
  captureSnapshot: false,
  captureBodies: true,
  render: ['json', 'markdown'],
  isolation: 'reuse',
  finalScreenshot: 'auto',
  dialogs: 'dismiss',
  settleMs: 2000,
  steps,
  ...extra,
});

/** @param {string} dir */
const readJson = async (dir, name = 'report.json') => JSON.parse(await readFile(path.join(dir, name), 'utf8'));

describe('STEPS ↔ RUNNERS', () => {
  it('have exactly the same keys, in the table order', () => {
    expect(Object.keys(RUNNERS)).toEqual(Object.keys(STEPS));
  });
});

describe('launchPlan / launchBrowser', () => {
  it('tries chrome then msedge with the fast-headless flags by default', () => {
    const plan = launchPlan({}, {});
    expect(plan.attempts).toEqual([{ channel: 'chrome' }, { channel: 'msedge' }]);
    expect(plan.headless).toBe(true);
    expect(plan.args).toEqual([...FAST_HEADLESS_ARGS]);
  });

  it('narrows by channel, lets an executable path win, replaces args from BROWSER_INSPECTOR_BROWSER_ARGS, drops the flags when asked', () => {
    expect(launchPlan({ channel: 'msedge' }, {}).attempts).toEqual([{ channel: 'msedge' }]);
    expect(launchPlan({ channel: 'msedge' }, { BROWSER_INSPECTOR_CHANNEL: 'chrome' }).attempts).toEqual([
      { channel: 'chrome' },
    ]);
    expect(launchPlan({}, { BROWSER_INSPECTOR_BROWSER_PATH: 'C:/x/chrome.exe' }).attempts).toEqual([
      { executablePath: 'C:/x/chrome.exe' },
    ]);
    expect(launchPlan({ args: ['--foo'] }, { BROWSER_INSPECTOR_BROWSER_ARGS: '--no-sandbox' }).args).toEqual([
      '--no-sandbox',
    ]);
    expect(launchPlan({ fastHeadless: false, args: ['--foo'] }, {}).args).toEqual(['--foo']);
    expect(launchPlan({ headless: false }, {}).args).toEqual([]);
  });

  it('E_BROWSER_MISSING names every attempt when nothing launches', async () => {
    const chromium = {
      launch: async (/** @type {any} */ opts) => {
        throw new Error(`no ${String(opts.channel)} here`);
      },
    };
    const error = await launchBrowser({}, { env: {}, chromium }).catch((e) => e);
    expect(error).toBeInstanceOf(BrowserMissingError);
    expect(error.code).toBe(E_BROWSER_MISSING);
    expect(error.message).toContain('tried channel chrome: no chrome here');
    expect(error.message).toContain('tried channel msedge: no msedge here');
  });

  it('falls back to msedge when chrome is missing', async () => {
    const chromium = {
      launch: async (/** @type {any} */ opts) => {
        if (opts.channel === 'chrome') throw new Error('not installed');
        return createFakeBrowser();
      },
    };
    const result = await launchBrowser({}, { env: {}, chromium });
    expect(result.channel).toBe('msedge');
    expect(result.args).toEqual([...FAST_HEADLESS_ARGS]);
  });

  it("accepts the keeper's createEngine(browserOpts, hooks) spelling", async () => {
    const fake = createFakeBrowser();
    const lines = [];
    const engine = createEngine(
      { channel: 'msedge', headless: true },
      { log: (line) => lines.push(line), env: {}, launch: async () => fake, prewarm: false },
    );
    engines.push(engine);
    await engine.ready;
    expect(engine.status().channel).toBe('msedge');
    expect(engine.status().browser).toBe('Edge/152');
    expect(lines.some((l) => l.includes('launched'))).toBe(true);
  });
});

describe('runFlow — step mapping', () => {
  it('maps every batch step to its Playwright call and writes the report files', async () => {
    const dir = await tmp();
    const { engine, calls } = harness({ texts: { '[data-testid=ticket-id]': 'ALM-1001' } });
    const steps = [
      { do: 'waitFor', selector: '[data-testid=request-form]' },
      { do: 'click', selector: '[data-testid=submit]', count: 2, button: 'right', modifiers: ['ctrl', 'shift'] },
      { do: 'fill', selector: '#name', value: 'Jan Kowalski', enter: true },
      { do: 'type', selector: '#email', value: 'jan@example.com', slowly: true },
      { do: 'press', key: 'Escape' },
      { do: 'press', key: 'Enter', selector: '#email' },
      { do: 'hover', selector: '#hover' },
      { do: 'select', selector: '#category', value: 'zmiana' },
      { do: 'check', selector: '#consent' },
      { do: 'uncheck', selector: '#consent' },
      { do: 'drag', from: '#a', to: '#b' },
      { do: 'upload', selector: '#file', files: ['fixtures/a.txt'] },
      { do: 'scroll', to: 'bottom' },
      { do: 'scroll', selector: '#footer' },
      { do: 'mouse', action: 'click', x: 10, y: 20 },
      { do: 'wait', ms: 5 },
      { do: 'wait', text: 'Gotowe' },
      { do: 'wait', url: '**/cart' },
      { do: 'resize', width: 800, height: 600 },
      { do: 'extract', name: 'numer-zgloszenia', selector: '[data-testid=ticket-id]' },
      { do: 'verify', kind: 'text', selector: '[data-testid=ticket-id]', text: 'ALM', soft: true },
      { do: 'verify', kind: 'url', url: 'http://localhost:4300/**' },
      { do: 'storage', kind: 'cookies', op: 'get', key: 'sid', name: 'cookie-sid' },
      { do: 'state', op: 'save', file: 'state.json' },
      { do: 'route', url: '**/api/x', status: 500, body: '{"e":1}' },
      { do: 'unroute', url: '**/api/x' },
      { do: 'dialog', action: 'accept', text: 'Jan', once: true },
      { do: 'tab', action: 'new', url: 'http://localhost:4300/popup' },
      { do: 'tab', action: 'close' },
      { do: 'pdf', name: 'strona' },
      { do: 'screenshot', name: 'koniec' },
    ];
    const result = await engine.runFlow(flow(steps), dir, { cwd: dir, stamp: '2026-09-02_10-00' });

    expect(result.completed).toBe(true);
    expect(result.report.steps).toHaveLength(steps.length);
    expect(result.report.steps.every((s) => s.ok)).toBe(true);
    expect(callsOf(calls, 'goto')[0]).toEqual(['http://localhost:4300/', { waitUntil: 'load', timeout: 1000 }]);
    expect(callsOf(calls, 'waitForSelector')[0]).toEqual([
      '[data-testid=request-form]',
      { timeout: 300, state: 'visible' },
    ]);
    expect(callsOf(calls, 'click')[0]).toEqual([
      '[data-testid=submit]',
      { timeout: 300, clickCount: 2, button: 'right', modifiers: ['Control', 'Shift'] },
    ]);
    expect(callsOf(calls, 'fill')[0]).toEqual(['#name', 'Jan Kowalski', { timeout: 300 }]);
    expect(callsOf(calls, 'press')).toEqual([
      ['#name', 'Enter', { timeout: 300 }],
      ['#email', 'Enter', { timeout: 300 }],
    ]);
    expect(callsOf(calls, 'keyboard.press')[0]).toEqual(['Escape', undefined]);
    expect(callsOf(calls, 'type')[0]).toEqual(['#email', 'jan@example.com', { timeout: 300, delay: 50 }]);
    expect(callsOf(calls, 'hover')[0]).toEqual(['#hover', { timeout: 300 }]);
    expect(callsOf(calls, 'selectOption')[0]).toEqual(['#category', 'zmiana', { timeout: 300 }]);
    expect(callsOf(calls, 'check')[0]).toEqual(['#consent', { timeout: 300 }]);
    expect(callsOf(calls, 'uncheck')[0]).toEqual(['#consent', { timeout: 300 }]);
    expect(callsOf(calls, 'dragAndDrop')[0]).toEqual(['#a', '#b', { timeout: 300 }]);
    expect(callsOf(calls, 'setInputFiles')[0]).toEqual([
      '#file',
      [path.resolve(dir, 'fixtures/a.txt')],
      { timeout: 300 },
    ]);
    expect(callsOf(calls, 'evaluate').some(([, arg]) => arg === 'bottom')).toBe(true);
    expect(callsOf(calls, 'locator.scrollIntoViewIfNeeded')[0]).toEqual(['#footer', { timeout: 300 }]);
    expect(callsOf(calls, 'mouse.click')[0]).toEqual([10, 20, {}]);
    expect(callsOf(calls, 'waitForTimeout')[0]).toEqual([5]);
    expect(callsOf(calls, 'waitForFunction')[0]).toEqual([{ text: 'Gotowe', gone: false }, { timeout: 300 }]);
    expect(callsOf(calls, 'waitForURL')[0][0]).toBe('/^.*\\/cart$/u');
    expect(callsOf(calls, 'setViewportSize').at(-1)).toEqual([{ width: 800, height: 600 }]);
    expect(callsOf(calls, 'storageState')[0]).toEqual([{ path: path.resolve(dir, 'state.json') }]);
    expect(callsOf(calls, 'route')[0][0]).toBe('**/api/x');
    expect(callsOf(calls, 'unroute')[0][0]).toBe('**/api/x');
    expect(callsOf(calls, 'newPage')).toHaveLength(2);
    expect(callsOf(calls, 'page.close')).toHaveLength(1);
    expect(callsOf(calls, 'pdf')[0]).toEqual([{ path: path.join(dir, 'strona.pdf') }]);
    expect(callsOf(calls, 'cdp:Page.captureScreenshot')).toHaveLength(1);
    expect(callsOf(calls, 'cdp:Page.captureScreenshot')[0][0]).toMatchObject({ format: 'png', optimizeForSpeed: true });
    expect(existsSync(path.join(dir, 'koniec.png'))).toBe(true);

    const report = await readJson(dir);
    expect(report.extracts['numer-zgloszenia']).toEqual({ value: 'ALM-1001', truncated: false });
    expect(report.extracts['cookie-sid']).toEqual({ value: 's3cr3t', truncated: false });
    expect(report.verifications).toEqual([
      { index: 20, kind: 'text', ok: true, soft: true },
      { index: 21, kind: 'url', ok: true, soft: false },
    ]);
    expect(report.screenshots).toEqual(['koniec.png']);
    expect(report.final).toBe('koniec.png');
    expect(report.files).toMatchObject({ elements: 'elements.md', text: 'text.txt', 'pdf-strona': 'strona.pdf' });
    expect(report.steps[2].description).toBe('fill #name (literal) + Enter');
    expect(JSON.stringify(report.steps)).not.toContain('Jan Kowalski');
    expect(report.title).toBe('Fake page');
    expect(report.elements.total).toBe(1);
    expect(report.timing).toMatchObject({ mode: 'first', ctx: 'reused', tab: 'new', lane: 0, queuedMs: 0, scrubMs: 0 });
    expect(report.engine).toMatchObject({ 'playwright-core': '1.62.1', serviceWorkers: 'block', generation: 1 });
    expect(report).not.toHaveProperty('navigationError');
    for (const file of ['report.md', 'elements.md', 'text.txt', '_manifest.json']) {
      expect(existsSync(path.join(dir, file)), file).toBe(true);
    }
    const manifest = await readJson(dir, '_manifest.json');
    expect(manifest).toMatchObject({ name: 'test', type: 'flow', stamp: '2026-09-02_10-00', completed: true });
    expect(result.files).toContain(path.join(dir, 'report.json'));
    expect(result.files).toContain(path.join(dir, 'koniec.png'));
  });

  it('a dead ref fails at once with the session wording after ONE snapshot refresh', async () => {
    const dir = await tmp();
    const { engine, calls } = harness({ counts: { 'aria-ref=e99': 0 } });
    const started = performance.now();
    const result = await engine.runFlow(flow([{ do: 'click', ref: 'e99' }]), dir);
    expect(performance.now() - started).toBeLessThan(100);
    expect(result.completed).toBe(false);
    expect(result.report.steps[0].error).toBe(
      'Error: ref not found (gone, label changed or other frame) → browser-inspector snap',
    );
    expect(callsOf(calls, 'ariaSnapshot')).toHaveLength(1);
    expect(callsOf(calls, 'click')).toHaveLength(0);
  });

  it('a snapshot step writes snap.full.yml / snap.md / snap.json and a later ref click goes through aria-ref=', async () => {
    const dir = await tmp();
    const { engine, calls } = harness({
      snapshot: '- button "Go" [ref=e1] [box=1,2,3,4]\n- textbox "Name" [ref=e2] [box=5,6,7,8]',
    });
    const result = await engine.runFlow(
      flow([{ do: 'snapshot', name: 'start' }, { do: 'click', ref: 'e1' }, { do: 'snapshot' }]),
      dir,
    );
    expect(result.completed).toBe(true);
    expect(callsOf(calls, 'ariaSnapshot')[0]).toEqual([{ mode: 'ai', boxes: true }]);
    expect(callsOf(calls, 'click')[0][0]).toBe('aria-ref=e1');
    for (const file of [
      'snap-start.full.yml',
      'snap-start.md',
      'snap-start.json',
      'snap.full.yml',
      'snap.md',
      'snap.json',
    ]) {
      expect(existsSync(path.join(dir, file)), file).toBe(true);
    }
    expect(await readFile(path.join(dir, 'snap.md'), 'utf8')).toContain('e1 button "Go"');
    expect(result.report.files).toMatchObject({ snapshot: 'snap.md', 'snapshot-start': 'snap-start.md' });
  });
});

describe('runFlow — failure, page and final screenshot rules', () => {
  it('a failing step stops the flow: completed:false, skipped counted, final.png taken, error in the Error: form', async () => {
    const dir = await tmp();
    const { engine } = harness({ fail: { click: new Error('Timeout 300ms exceeded.\n  waiting for x') } });
    const result = await engine.runFlow(
      flow([
        { do: 'waitFor', selector: '#a' },
        { do: 'click', selector: '#b' },
        { do: 'fill', selector: '#c', value: 'x' },
      ]),
      dir,
    );
    expect(result.completed).toBe(false);
    expect(result.failure).toBe('step 2 "click #b" — Error: Timeout 300ms exceeded.');
    const report = await readJson(dir);
    expect(report.completed).toBe(false);
    expect(report.steps).toHaveLength(2);
    expect(report.steps[1]).toMatchObject({ index: 1, ok: false, error: 'Error: Timeout 300ms exceeded.' });
    expect(report.skipped).toBe(1);
    expect(report.screenshots).toEqual(['final.png']);
    expect(existsSync(path.join(dir, 'final.png'))).toBe(true);
    expect(await readFile(path.join(dir, 'report.md'), 'utf8')).toContain('## steps');
  });

  it('a navigation failure is navigationError (only then), no steps run, final.png still taken', async () => {
    const dir = await tmp();
    const { engine } = harness({ fail: { goto: new Error('net::ERR_CONNECTION_REFUSED at http://localhost:4300/') } });
    const result = await engine.runFlow(flow([{ do: 'click', selector: '#b' }]), dir);
    expect(result.completed).toBe(false);
    const report = await readJson(dir);
    expect(report.navigationError).toBe('Error: net::ERR_CONNECTION_REFUSED at http://localhost:4300/');
    expect(report.steps).toEqual([]);
    expect(report.skipped).toBe(1);
    expect(report.screenshots).toEqual(['final.png']);
  });

  it('type: page always writes page.png (fullPage honoured) and runs no steps', async () => {
    const dir = await tmp();
    const { engine, calls } = harness();
    const result = await engine.runFlow(flow([{ do: 'click', selector: '#b' }], { type: 'page', fullPage: true }), dir);
    expect(result.completed).toBe(true);
    expect(result.report.screenshots).toEqual(['page.png']);
    expect(existsSync(path.join(dir, 'page.png'))).toBe(true);
    expect(callsOf(calls, 'click')).toHaveLength(0);
    // fullPage goes through Playwright, not CDP.
    expect(callsOf(calls, 'screenshot')[0][0]).toMatchObject({ fullPage: true });
    expect(callsOf(calls, 'cdp:Page.captureScreenshot')).toHaveLength(0);
  });

  it('auto: success with a screenshot as the last step skips final.png; otherwise final.png; always/never obey', async () => {
    const { engine } = harness();
    const a = await tmp();
    const withShot = await engine.runFlow(
      flow([
        { do: 'click', selector: '#b' },
        { do: 'screenshot', name: 'koszyk' },
      ]),
      a,
    );
    expect(withShot.report.screenshots).toEqual(['koszyk.png']);
    expect(withShot.report.final).toBe('koszyk.png');
    expect(existsSync(path.join(a, 'final.png'))).toBe(false);

    const b = await tmp();
    const plain = await engine.runFlow(
      flow([
        { do: 'screenshot', name: 'x' },
        { do: 'click', selector: '#b' },
      ]),
      b,
    );
    expect(plain.report.screenshots).toEqual(['x.png', 'final.png']);
    expect(plain.report.final).toBeUndefined();

    const c = await tmp();
    const never = await engine.runFlow(flow([{ do: 'click', selector: '#b' }], { finalScreenshot: 'never' }), c);
    expect(never.report.screenshots).toEqual([]);

    const d = await tmp();
    const always = await engine.runFlow(flow([{ do: 'screenshot', name: 'x' }], { finalScreenshot: 'always' }), d);
    expect(always.report.screenshots).toEqual(['x.png', 'final.png']);
  });
});

describe('runFlow — evaluate through CDP', () => {
  it('sends Runtime.evaluate with awaitPromise and the timeout, maps undefined / string / object', async () => {
    const dir = await tmp();
    const { engine, calls } = harness({
      runtimeEvaluate: (params) => {
        if (params.expression === 'undefined') return { result: { type: 'undefined' } };
        if (params.expression === 'document.title') return { result: { type: 'string', value: 'Koszyk' } };
        return { result: { type: 'object', objectId: 'o1', className: 'Object' } };
      },
      cdp: (method) => (method === 'Runtime.callFunctionOn' ? { result: { type: 'object', value: { a: 1 } } } : {}),
    });
    const result = await engine.runFlow(
      flow([
        { do: 'evaluate', name: 'u', expression: 'undefined' },
        { do: 'evaluate', name: 's', expression: 'document.title', timeout: 150 },
        { do: 'evaluate', name: 'o', expression: '({ a: 1 })' },
      ]),
      dir,
    );
    expect(result.completed).toBe(true);
    expect(result.report.extracts).toEqual({
      u: { value: 'undefined', truncated: false },
      s: { value: 'Koszyk', truncated: false },
      o: { value: '{"a":1}', truncated: false },
    });
    const sent = callsOf(calls, 'cdp:Runtime.evaluate').map(([p]) => p);
    expect(sent[0]).toEqual({ expression: 'undefined', returnByValue: false, awaitPromise: true, timeout: 300 });
    expect(sent[1].timeout).toBe(150);
    expect(callsOf(calls, 'cdp:Runtime.callFunctionOn')).toHaveLength(1);
    expect(callsOf(calls, 'cdp:Runtime.releaseObject')).toHaveLength(1);
  });

  it('a thrown value fails the step as `Error: <first line>`, a DOM node fails it, a pending promise hits the deadline', async () => {
    const dir = await tmp();
    const { engine } = harness({
      runtimeEvaluate: (params) => {
        if (params.expression === 'throw') {
          return {
            exceptionDetails: {
              text: 'Uncaught',
              exception: { description: 'Error: uczen widzi przycisk nauczyciela\n    at <anonymous>:1:7' },
            },
          };
        }
        if (params.expression === 'node')
          return { result: { type: 'object', subtype: 'node', objectId: 'n1', description: 'div' } };
        // Only the step's own expression hangs — the scrub's in-page storage clear rides the same
        // CDP method and must answer, or the lane would be rebuilt between these runs.
        if (params.expression === 'hang') return new Promise(() => {});
        return { result: { type: 'boolean', value: true } };
      },
    });
    const thrown = await engine.runFlow(flow([{ do: 'evaluate', name: 't', expression: 'throw' }]), dir);
    expect(thrown.report.steps[0].error).toBe('Error: uczen widzi przycisk nauczyciela');

    const node = await engine.runFlow(flow([{ do: 'evaluate', name: 'n', expression: 'node' }]), await tmp());
    expect(node.report.steps[0].error).toMatch(/^Error: evaluate returned a DOM node/u);

    const started = performance.now();
    const hang = await engine.runFlow(
      flow([{ do: 'evaluate', name: 'h', expression: 'hang', timeout: 100 }]),
      await tmp(),
    );
    expect(performance.now() - started).toBeLessThan(2000);
    expect(hang.report.steps[0].error).toBe('Error: evaluate "h" timed out after 100ms');
  });
});

describe('runFlow — values, secrets, addressing', () => {
  it('reads a resolved valueFromEnv under the step address and redacts it everywhere', async () => {
    const dir = await tmp();
    const { engine, calls } = harness();
    const result = await engine.runFlow(
      flow([
        { do: 'fill', selector: '#pass', valueFromEnv: 'APP_PASS' },
        {
          do: 'form',
          fields: [
            { selector: '#a', value: 'lit' },
            { selector: '#b', valueFromEnv: 'APP_PASS' },
          ],
        },
        { do: 'extract', name: 'echo', selector: '#pass' },
      ]),
      dir,
      {
        snapshotIndex: 2,
        values: { 'snapshots[2].steps[0].value': 'hunter2', 'snapshots[2].steps[1].fields[1].value': 'hunter2' },
        secretValues: ['hunter2'],
      },
    );
    expect(result.completed).toBe(true);
    expect(callsOf(calls, 'fill').map(([sel, value]) => [sel, value])).toEqual([
      ['#pass', 'hunter2'],
      ['#a', 'lit'],
      ['#b', 'hunter2'],
    ]);
    expect(result.report.steps[0].description).toBe('fill #pass (from env APP_PASS)');
    const json = await readFile(path.join(dir, 'report.json'), 'utf8');
    expect(json).not.toContain('hunter2');
  });

  it("the keeper's `address: snapshots[i]` addresses the same values", async () => {
    const dir = await tmp();
    const { engine, calls } = harness();
    await engine.runFlow(flow([{ do: 'fill', selector: '#pass', valueFromEnv: 'APP_PASS' }]), dir, {
      address: 'snapshots[4]',
      values: { 'snapshots[4].steps[0].value': 'pw' },
    });
    expect(callsOf(calls, 'fill')[0][1]).toBe('pw');
  });

  it('an unresolved valueFromEnv fails the step by name, not with an empty fill', async () => {
    const dir = await tmp();
    const { engine, calls } = harness();
    const result = await engine.runFlow(flow([{ do: 'fill', selector: '#pass', valueFromEnv: 'APP_PASS' }]), dir);
    expect(result.completed).toBe(false);
    expect(result.report.steps[0].error).toBe('Error: value from env APP_PASS was not resolved (is APP_PASS set?)');
    expect(callsOf(calls, 'fill')).toHaveLength(0);
  });
});

describe('lanes, scrub, isolation', () => {
  it('scrubs the lane between snapshots (N−1 times) and executes every op of the plan', async () => {
    const { engine, calls } = harness();
    const dirs3 = [await tmp(), await tmp(), await tmp()];
    const results = [];
    for (const dir of dirs3) results.push(await engine.runFlow(flow([{ do: 'click', selector: '#b' }]), dir));
    expect(engine.status().scrubs).toBe(2);
    expect(results.map((r) => r.timing.tab)).toEqual(['new', 'kept', 'kept']);
    expect(results.map((r) => r.timing.ctx)).toEqual(['reused', 'reused', 'reused']);
    expect(results.map((r) => r.timing.mode)).toEqual(['first', 'warm', 'warm']);
    expect(results[1].timing.scrubMs).toBeGreaterThanOrEqual(0);
    expect(results.map((r) => r.report.engine.generation)).toEqual([1, 2, 3]);
    // One context, one page — the tab is reused, not replaced.
    expect(callsOf(calls, 'newContext')).toHaveLength(1);
    expect(callsOf(calls, 'newPage')).toHaveLength(1);
    // The scrub ops, on the visited origin. The storage clear is in-page (`Runtime.evaluate` on
    // the document still loaded there), never the CDP `DOMStorage.clear` that stalled for 500 ms.
    const storageClears = callsOf(calls, 'cdp:Runtime.evaluate')
      .map(([p]) => p)
      .filter((p) => /sessionStorage\.clear\(\)/u.test(String(p?.expression)));
    expect(storageClears).toHaveLength(2);
    expect(storageClears[0]).toMatchObject({ returnByValue: true, timeout: expect.any(Number) });
    expect(callsOf(calls, 'cdp:DOMStorage.clear')).toHaveLength(0);
    expect(callsOf(calls, 'cdp:Storage.clearDataForOrigin')[0][0]).toMatchObject({ origin: 'http://localhost:4300' });
    expect(callsOf(calls, 'cdp:Page.addScriptToEvaluateOnNewDocument')).toHaveLength(3);
    expect(callsOf(calls, 'cdp:Page.removeScriptToEvaluateOnNewDocument')).toHaveLength(2);
    // Once after every goto (history starts at the run) and once per scrub.
    expect(callsOf(calls, 'cdp:Page.resetNavigationHistory')).toHaveLength(5);
    for (const method of [
      'clearCookies',
      'clearPermissions',
      'unrouteAll',
      'setOffline',
      'setExtraHTTPHeaders',
      'setGeolocation',
      'emulateMedia',
    ]) {
      expect(callsOf(calls, method).length, method).toBe(2);
    }
  });

  it('applies the scrub before the next run, not after the previous one (the answer goes out first)', async () => {
    const { engine } = harness();
    await engine.runFlow(flow([]), await tmp());
    expect(engine.status().scrubs).toBe(0);
    expect(engine.status().lanes[0].dirty).toBe(true);
    const { plan, ms } = await engine.scrub(0);
    expect(plan.map((op) => op.op)).toEqual([
      'domStorageClear',
      'setGeneration',
      'clearOrigin',
      'resetContext',
      'resetNavigationHistory',
    ]);
    expect(ms).toBeGreaterThanOrEqual(0);
    expect(engine.status().lanes[0].dirty).toBe(false);
  });

  it('a crashed renderer rebuilds the tab at the next scrub: timing.tab = new', async () => {
    const { engine, calls } = harness();
    await engine.runFlow(flow([]), await tmp());
    const lane = engine.lanes.get(0);
    /** @type {any} */ (lane?.page).emit('crash');
    const second = await engine.runFlow(flow([]), await tmp());
    expect(second.timing.tab).toBe('new');
    expect(callsOf(calls, 'newPage')).toHaveLength(2);
    expect(callsOf(calls, 'page.close')).toHaveLength(1);
    expect(callsOf(calls, 'newCDPSession')).toHaveLength(2);
    const third = await engine.runFlow(flow([]), await tmp());
    expect(third.timing.tab).toBe('kept');
  });

  it('isolation: fresh → a new context with serviceWorkers allow, cache cleared, closed after the run', async () => {
    const { engine, calls } = harness();
    const result = await engine.runFlow(flow([{ do: 'click', selector: '#b' }], { isolation: 'fresh' }), await tmp());
    expect(result.timing).toMatchObject({ ctx: 'fresh', tab: 'new' });
    expect(result.report.engine.serviceWorkers).toBe('allow');
    expect(callsOf(calls, 'newContext')[0][0]).toMatchObject({ serviceWorkers: 'allow' });
    expect(callsOf(calls, 'cdp:Network.clearBrowserCache')).toHaveLength(1);
    expect(callsOf(calls, 'context.close')).toHaveLength(1);
    expect(engine.status().lanes).toEqual([]);
    // `--fresh` does the same for a plain snapshot.
    const forced = await engine.runFlow(flow([]), await tmp(), { fresh: true });
    expect(forced.timing.ctx).toBe('fresh');
  });

  it('runs --parallel lanes as persistent contexts and returns results in config order', async () => {
    const { engine, calls } = harness();
    const outputDir = await tmp();
    const config = {
      outputDir,
      configPath: path.join(outputDir, 'read.config.json'),
      parallel: 2,
      snapshots: [flow([], { name: 'a' }), flow([], { name: 'b' }), flow([], { name: 'c' })],
    };
    const run = await engine.runBatch(config, { stamp: '2026-09-02_10-00', junit: 'out/junit.xml', cwd: outputDir });
    expect(run.snapshots.map((s) => s.name)).toEqual(['a', 'b', 'c']);
    expect(new Set(run.snapshots.map((s) => s.timing.lane))).toEqual(new Set([0, 1]));
    expect(callsOf(calls, 'newContext')).toHaveLength(2);
    expect(run.manifest.snapshots.map((s) => s.name)).toEqual(['a', 'b', 'c']);
    expect(run.manifest.snapshots[0]).toMatchObject({
      completed: true,
      ctx: 'reused',
      tab: 'new',
      queuedMs: 0,
      scrubMs: 0,
    });
    expect(existsSync(path.join(outputDir, '2026-09-02_10-00', '_manifest.json'))).toBe(true);
    expect(existsSync(path.join(outputDir, 'out', 'junit.xml'))).toBe(true);
    expect(existsSync(path.join(outputDir, '2026-09-02_10-00', 'c', 'report.json'))).toBe(true);
  });

  it('finishRun lists a flow whose runFlow threw as incomplete with the failure', async () => {
    const { engine } = harness();
    const runDir = await tmp();
    const { manifest } = await engine.finishRun({
      runDir,
      stamp: 'x',
      configPath: 'c.json',
      results: [{ name: 'boom', dir: path.join(runDir, 'boom'), completed: false, failure: 'browser gone', ms: 3 }],
      mode: 'no-daemon',
      totalMs: 3,
    });
    expect(manifest.snapshots[0]).toMatchObject({ name: 'boom', completed: false, failure: 'Error: browser gone' });
  });
});

describe('waits, routes, dialogs', () => {
  it('waitUntil settled: goto with load, then the recorder-counted quiet window; networkidle passes through', async () => {
    const { engine, calls } = harness();
    const settled = await engine.runFlow(flow([], { waitUntil: 'settled' }), await tmp());
    expect(settled.completed).toBe(true);
    expect(callsOf(calls, 'goto')[0][1]).toMatchObject({ waitUntil: 'load' });
    await engine.runFlow(flow([{ do: 'reload', waitUntil: 'networkidle' }], { waitUntil: 'networkidle' }), await tmp());
    expect(callsOf(calls, 'goto')[1][1]).toMatchObject({ waitUntil: 'networkidle' });
    expect(callsOf(calls, 'reload')[0][0]).toMatchObject({ waitUntil: 'networkidle' });
  });

  it('routes[] of the snapshot are installed before goto and the dialog policy comes from the snapshot', async () => {
    const { engine, calls } = harness();
    const result = await engine.runFlow(
      flow([{ do: 'dialog', action: 'dismiss' }], {
        routes: [{ url: '**/api/recommendations', block: true }],
        dialogs: 'accept',
      }),
      await tmp(),
    );
    expect(result.completed).toBe(true);
    const order = calls.map((c) => c.method).filter((m) => m === 'route' || m === 'goto');
    expect(order).toEqual(['route', 'goto']);
    expect(engine.lanes.get(0)?.recorder.dialogPolicy).toEqual({ action: 'dismiss' });
  });

  it('a soft verify failure is recorded, does not stop the flow, and lands in ## verify', async () => {
    const dir = await tmp();
    const { engine } = harness({ texts: { '#cart': '0' } });
    const result = await engine.runFlow(
      flow(
        [
          { do: 'verify', kind: 'text', selector: '#cart', text: '1', soft: true },
          { do: 'click', selector: '#b' },
        ],
        { stepTimeoutMs: 120 },
      ),
      dir,
    );
    expect(result.completed).toBe(true);
    expect(result.report.verifications[0]).toMatchObject({ kind: 'text', ok: false, soft: true });
    expect(result.report.verifications[0].detail).toContain('expected #cart to contain "1"');
    expect(await readFile(path.join(dir, 'report.md'), 'utf8')).toContain('## verify');
  });
});

describe('health', () => {
  it('emits disconnected when the browser goes away and relaunches on the next job', async () => {
    const { engine, fake } = harness();
    const events = [];
    engine.on('disconnected', () => events.push('disconnected'));
    await engine.runFlow(flow([]), await tmp());
    fake.emit('disconnected');
    expect(events).toEqual(['disconnected']);
    expect(engine.status().connected).toBe(false);
    expect(engine.status().lanes).toEqual([]);
  });

  it('recycle() is the keeper’s call, never runFlow’s: close + launch, the next run is `first`, open sessions end', async () => {
    let launched = 0;
    const fakes = [createFakeBrowser(), createFakeBrowser()];
    const engine = createEngine({
      launch: async () => fakes[launched++],
      prewarm: false,
      env: {},
      maxJobs: 2,
    });
    engines.push(engine);
    const modes = [];
    // `maxJobs: 2` and three runs: the engine does NOT recycle on its own (a recycle inside a
    // runFlow would close the browser under the other --parallel lanes) — the keeper decides.
    for (let i = 0; i < 3; i += 1) modes.push((await engine.runFlow(flow([]), await tmp())).timing.mode);
    expect(modes).toEqual(['first', 'warm', 'warm']);
    expect(launched).toBe(1);
    expect(engine.status().maxJobs).toBe(2);

    const cwd = await tmp();
    await engine.runCommand('s', { do: 'goto', url: 'http://localhost:4300/' }, { cwd, out: path.join(cwd, 'out') });
    expect(engine.session('s')).toBeDefined();
    await engine.recycle();
    expect(launched).toBe(2);
    expect(callsOf(fakes[0].calls, 'browser.close')).toHaveLength(1);
    // A session cannot outlive its browser: ended explicitly (context closed), not left dangling.
    expect(engine.session('s')).toBeUndefined();
    expect(callsOf(fakes[0].calls, 'context.close').length).toBeGreaterThanOrEqual(1);
    expect((await engine.runFlow(flow([]), await tmp())).timing.mode).toBe('first');
    expect(engine.status().launches).toBe(2);
  });

  it('status() never spawns a process: the RSS is the cached sampleRss() result', async () => {
    let samples = 0;
    const { engine } = harness(
      {},
      {
        rssOf: async () => {
          samples += 1;
          return 512;
        },
      },
    );
    await engine.runFlow(flow([]), await tmp());
    for (let i = 0; i < 3; i += 1) expect(engine.status().browserRssMb).toBe(0);
    expect(samples).toBe(0);
    expect(await engine.sampleRss()).toBe(512);
    expect(samples).toBe(1);
    expect(engine.status().browserRssMb).toBe(512);
    expect(engine.status().rssMb).toBe(512);
  });
});

describe('scrub under a deadline', () => {
  it('a scrub op that never answers is cut at scrubOpMs, the tab is rebuilt and the run reports tab: new', async () => {
    const { engine, calls } = harness({}, { scrubOpMs: 60 });
    await engine.runFlow(flow([]), await tmp());
    const lane = engine.lanes.get(0);
    // A renderer whose main thread spins answers no renderer-side call: `emulateMedia` here.
    /** @type {any} */ (lane).page.emulateMedia = () => new Promise(() => {});
    const started = performance.now();
    const { ops } = await engine.scrub(0);
    expect(performance.now() - started).toBeLessThan(1000);
    const stuck = ops.find((o) => o.op === 'emulateMedia');
    expect(stuck?.ms).toBeGreaterThanOrEqual(50);
    expect(lane?.scrubErrors.some((e) => /^emulateMedia: scrub emulateMedia timed out/u.test(e))).toBe(true);
    // The plan was recomputed as a crash: page.close + newPage + a new CDP session.
    expect(ops.some((o) => o.op === 'newTab')).toBe(true);
    expect(callsOf(calls, 'newPage')).toHaveLength(2);
    expect(callsOf(calls, 'page.close')).toHaveLength(1);
    expect(lane?.tab).toBe('new');
    const next = await engine.runFlow(flow([]), await tmp());
    expect(next.timing.tab).toBe('new');
    expect(next.completed).toBe(true);
  });

  it('scrub() reports the cost of every op and scrubIfDirty() is a no-op on a clean lane', async () => {
    const { engine } = harness();
    await engine.runFlow(flow([]), await tmp());
    const first = await engine.scrubIfDirty(0);
    expect(first.ops.map((o) => o.op)).toEqual(
      expect.arrayContaining([
        'domStorageClear',
        'setGeneration',
        'clearOrigin',
        'clearCookies',
        'resetNavigationHistory',
      ]),
    );
    expect(first.ops.every((o) => typeof o.ms === 'number' && o.ms >= 0)).toBe(true);
    const again = await engine.scrubIfDirty(0);
    expect(again).toEqual({ ms: 0, plan: [], ops: [] });
    expect(engine.status().scrubs).toBe(1);
  });
});

describe('runBatch with auth', () => {
  it('reuses a fresh state file once and hands storageState to every snapshot but the anonymous one', async () => {
    const { engine, calls } = harness();
    const dir = await tmp();
    const statePath = path.join(dir, '.scribe-devtools', 'auth.json');
    await mkdir(path.dirname(statePath), { recursive: true });
    await writeFile(statePath, JSON.stringify({ cookies: [], origins: [] }), 'utf8');
    const config = {
      configPath: path.join(dir, 'read.config.json'),
      outputDir: path.join(dir, 'out'),
      auth: { storageState: './.scribe-devtools/auth.json', maxAgeMinutes: 60, reuse: true },
      snapshots: [flow([], { name: 'pulpit' }), flow([], { name: 'gosc', auth: false })],
    };
    const run = await engine.runBatch(config, { stamp: '2026-09-02_10-00', cwd: dir });
    expect(run.snapshots.map((s) => [s.name, s.completed, s.timing.ctx])).toEqual([
      ['pulpit', true, 'fresh'],
      ['gosc', true, 'reused'],
    ]);
    const withState = callsOf(calls, 'newContext').filter(([opts]) => opts?.storageState === statePath);
    expect(withState).toHaveLength(1);
    expect(withState[0][0]).toMatchObject({ serviceWorkers: 'allow' });
  });
});
