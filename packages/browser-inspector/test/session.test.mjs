// The session half of the engine on a FakePage (DESIGN.md §4; AC-8, AC-9, AC-14): one line per
// command with the deltas, `console`/`net` only since the last call, a dead ref failing at once,
// `snap --max` with the overflow marker, `frame` never snapshotting a subtree, dialogs by policy,
// tabs, `run --file` refused without BROWSER_INSPECTOR_UNSAFE=1, the journal + export, `browser-inspector script` addressing —
// and the token budget of every line, counted with the bench's tokenizer.
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { encode } from 'gpt-tokenizer/encoding/o200k_base';
import { afterEach, describe, expect, it } from 'vitest';

import { createEngine } from '../src/engine.mjs';
import { readJournal } from '../src/session-log.mjs';
import { callsOf, createFakeBrowser } from './fake-browser.mjs';

/** @type {string[]} */
const dirs = [];
/** @type {{ close: () => Promise<void> }[]} */
const engines = [];

afterEach(async () => {
  for (const engine of engines.splice(0)) await engine.close();
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

const SNAPSHOT = [
  '- heading "Sklep" [level=1] [ref=e0]',
  '- button "Go" [ref=e1]',
  '- textbox "Name" [ref=e2]',
  '- link "Koszyk" [ref=e3]:',
  '  - /url: /cart',
].join('\n');

/**
 * A page state the FakePage's `evaluate` answers the session probe from; a test mutates it to
 * simulate what an action did (element count, DOM mutations, title).
 */
function makeState() {
  return { el: 61, dom: 0, title: 'Sklep' };
}

/**
 * @param {Record<string, any>} [fakeOptions]
 * @param {Record<string, any>} [engineOptions]
 */
async function harness(fakeOptions = {}, engineOptions = {}) {
  const state = makeState();
  /** @type {Record<string, any>} */
  const options = {
    snapshot: SNAPSHOT,
    title: 'Sklep',
    evaluate: (/** @type {any} */ fn, /** @type {any} */ arg) => {
      if (fn?.name === 'sessionProbe') return { ...state };
      if (fn?.name === 'walkInteractive') return [];
      void arg;
      return undefined;
    },
    ...fakeOptions,
  };
  const fake = createFakeBrowser(options);
  const engine = createEngine({ launch: async () => fake, prewarm: false, env: {}, ...engineOptions });
  engines.push(engine);
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'browser-inspector-session-'));
  dirs.push(cwd);
  const out = path.join(cwd, 'out');
  /** @param {import("../src/types.js").Step} step @param {Record<string, any>} [extra] */
  const run = async (step, extra = {}) => {
    const name = extra.session ?? 'default';
    const result = await engine.runCommand(name, step, {
      cwd,
      out,
      alias: extra.alias,
      values: extra.values ?? {},
      secretValues: extra.secretValues ?? [],
      files: extra.files ?? {},
      mode: 'warm',
      queuedMs: 0,
    });
    // The journal / jsonl appends ride a chain the answer does not wait for; the tests read the
    // files right after the line, so they wait here — like `close` and `export` do.
    await engine.session(name)?.writes;
    return result;
  };
  /** @returns {any} */
  const page = () => engine.session('default')?.ctx.page;
  const open = (url = 'http://localhost:4300/') => run({ do: 'goto', url }, { alias: 'open' });
  return {
    fake,
    engine,
    options,
    state,
    cwd,
    out,
    run,
    open,
    page,
    calls: fake.calls,
    dir: path.join(out, 'session', 'default'),
  };
}

/** Every session line: ≤ 160 characters, ≤ 40 o200k tokens (AC-8). */
const assertBudget = (/** @type {string[]} */ lines) => {
  for (const line of lines) {
    expect(line.length, line).toBeLessThanOrEqual(160);
    expect(encode(line).length, line).toBeLessThanOrEqual(40);
  }
};

const fakeConsole = (/** @type {string} */ type, /** @type {string} */ text) => ({
  type: () => type,
  text: () => text,
  location: () => undefined,
});

/** @param {any} page @param {{ id?: number, method?: string, url: string, status?: number, body?: string, fail?: string }} r */
function fakeRequest(page, r) {
  const request = {
    method: () => r.method ?? 'GET',
    url: () => r.url,
    resourceType: () => 'fetch',
    headers: () => ({ accept: 'application/json', 'x-trace': 'abc' }),
    postData: () => (r.method === 'POST' ? '{"a":1}' : null),
    failure: () => (r.fail ? { errorText: r.fail } : null),
  };
  page.emit('request', request);
  if (r.fail) {
    page.emit('requestfailed', request);
    return;
  }
  const body = r.body ?? '';
  page.emit('response', {
    request: () => request,
    status: () => r.status ?? 200,
    headers: () => ({ 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(body)) }),
    fromCache: () => false,
    text: async () => body,
  });
  page.emit('requestfinished', request);
}

describe('session: open, deltas, one line per command', () => {
  it('open creates the session, writes snap.md/json and prints the open line', async () => {
    const h = await harness();
    const result = await h.open();
    expect(result.exit).toBe(0);
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]).toMatch(/^ok open "Sklep" · el 61 · err 0 · .*session\/default\/snap\.md$/u);
    assertBudget(result.lines);
    expect(h.engine.session('default')).toBeDefined();
    expect(existsSync(path.join(h.dir, 'snap.md'))).toBe(true);
    expect(existsSync(path.join(h.dir, 'snap.json'))).toBe(true);
    expect(existsSync(path.join(h.dir, 'snap.full.yml'))).toBe(true);
    expect(await readFile(path.join(h.dir, 'snap.md'), 'utf8')).toContain('e1 button "Go"');
    // The session is its own context, never a scratch lane.
    expect(h.engine.lanes.size).toBe(0);
    expect(callsOf(h.calls, 'newContext')).toHaveLength(1);
  });

  it('a command before open is a FAIL with the hint, not a crash', async () => {
    const h = await harness();
    const result = await h.run({ do: 'click', ref: 'e1' });
    expect(result.exit).toBe(1);
    expect(result.lines).toEqual(['FAIL click e1 · no open session "default" → browser-inspector open <url>']);
  });

  it('an action line carries dom Δ, el a→b and +N console.error; a query prints content', async () => {
    const h = await harness();
    await h.open();
    const page = h.page();
    h.options.fail = {
      click: () => {
        h.state.el = 63;
        h.state.dom += 5;
        page.emit('console', fakeConsole('error', '[cart] POST /api/cart → 404'));
      },
    };
    const click = await h.run({ do: 'click', ref: 'e1' });
    expect(click.exit).toBe(0);
    expect(click.lines).toEqual(['ok click e1 · dom Δ · el 61→63 · +1 console.error']);
    assertBudget(click.lines);
    // The click went to the page as `aria-ref=e1` literally, after a count() precheck.
    expect(callsOf(h.calls, 'click').at(-1)?.[0]).toBe('aria-ref=e1');
    expect(callsOf(h.calls, 'locator.count').some((a) => a[0] === 'aria-ref=e1')).toBe(true);

    h.options.fail = {};
    const get = await h.run({ do: 'extract', selector: '#total' }, { alias: 'get' });
    expect(get.lines).toEqual(['text of #total']);
    const named = await h.run({ do: 'extract', selector: '#total', name: 'suma' }, { alias: 'get' });
    expect(named.lines).toEqual(['ok get suma ← #total · text of #total']);
  });

  it('a navigation prints `navigated → refs f<seq>eN (browser-inspector snap)` and a same-document URL change prints the path', async () => {
    const h = await harness();
    await h.open('http://localhost:4300/');
    const page = h.page();
    h.options.fail = {
      click: async () => {
        await page.goto('http://localhost:4300/cart');
        h.state.title = 'Koszyk';
        h.state.el = 23;
      },
    };
    const nav = await h.run({ do: 'click', ref: 'e3' });
    expect(nav.lines).toEqual(['ok click e3 · navigated → refs f1eN (browser-inspector snap) · el 23']);
    assertBudget(nav.lines);
    const journal = readJournal(path.join(h.dir, 'journal.jsonl'));
    expect(journal.at(-1)).toMatchObject({
      command: 'click',
      ok: true,
      url: 'http://localhost:4300/cart',
      title: 'Koszyk',
    });
  });

  it('fill never echoes the value; --enter is in the head; a secret from values is redacted everywhere', async () => {
    const h = await harness();
    await h.open();
    const fill = await h.run(
      { do: 'fill', ref: 'e2', valueFromEnv: 'APP_PASS', enter: true },
      { values: { 'argv.fill.value': 'hunter2' }, secretValues: ['hunter2'] },
    );
    expect(fill.exit).toBe(0);
    expect(fill.lines).toEqual(['ok fill e2 + Enter']);
    expect(callsOf(h.calls, 'fill').at(-1)?.slice(0, 2)).toEqual(['aria-ref=e2', 'hunter2']);
    const journal = await readFile(path.join(h.dir, 'journal.jsonl'), 'utf8');
    expect(journal).not.toContain('hunter2');
    expect(journal).toContain('"valueFromEnv":"APP_PASS"');
  });

  it('a secret stays redacted for the rest of the SESSION: get --value, eval, snap and the journal after a fill without secrets', async () => {
    const secret = 'hunter2-per-session';
    const h = await harness({
      texts: { 'aria-ref=e2': secret },
      snapshot: [SNAPSHOT, `- textbox "Token" [ref=e4]: ${secret}`].join('\n'),
      runtimeEvaluate: () => ({ result: { type: 'string', value: `token=${secret}` } }),
    });
    await h.open();
    // ONE command carries the secret …
    const fill = await h.run(
      { do: 'fill', ref: 'e2', valueFromEnv: 'APP_PASS' },
      { values: { 'argv.fill.value': secret }, secretValues: [secret] },
    );
    expect(fill.exit).toBe(0);
    // … every later one carries none, and still never prints it.
    const get = await h.run({ do: 'extract', ref: 'e2', value: true }, { alias: 'get' });
    expect(get.exit).toBe(0);
    expect(get.lines).toEqual(['***']);
    const evaluated = await h.run(
      { do: 'evaluate', expression: 'document.querySelector("#t").value' },
      { alias: 'eval' },
    );
    expect(evaluated.lines.join('\n')).not.toContain(secret);
    expect(evaluated.lines.join('\n')).toContain('***');
    const snap = await h.run({ do: 'snapshot' }, { alias: 'snap' });
    expect(snap.lines.join('\n')).not.toContain(secret);
    for (const name of ['snap.md', 'snap.json', 'snap.full.yml', 'journal.jsonl']) {
      const text = await readFile(path.join(h.dir, name), 'utf8');
      expect(text, name).not.toContain(secret);
    }
    expect(await readFile(path.join(h.dir, 'journal.jsonl'), 'utf8')).toContain('***');
    expect([...(h.engine.session('default')?.secretValues ?? [])]).toEqual([secret]);
  });
});

describe('session: refs', () => {
  it('a dead ref fails in < 500 ms with the §4.4 line, after ONE full snapshot refresh — no actionability wait', async () => {
    const h = await harness({ counts: { 'aria-ref=e99': 0 } });
    await h.open();
    const snapshotsBefore = callsOf(h.calls, 'ariaSnapshot').length;
    const started = performance.now();
    const result = await h.run({ do: 'click', ref: 'e99' });
    expect(performance.now() - started).toBeLessThan(500);
    expect(result.exit).toBe(1);
    expect(result.lines).toEqual([
      'FAIL click e99 · ref not found (gone, label changed or other frame) → browser-inspector snap',
    ]);
    assertBudget(result.lines);
    const refreshes = callsOf(h.calls, 'ariaSnapshot').slice(snapshotsBefore);
    expect(refreshes).toHaveLength(1);
    // Full page, `ai` mode — never a subtree or `default` (that would kill every other ref).
    expect(refreshes[0][0]).toMatchObject({ mode: 'ai' });
    expect(callsOf(h.calls, 'click')).toHaveLength(0);
  });

  it('find prints ≤ 10 compact lines from ONE full snapshot; verify list does not touch the ref map', async () => {
    const h = await harness();
    await h.open();
    const before = callsOf(h.calls, 'ariaSnapshot').length;
    const find = await h.run({ do: 'find', text: 'kosz' });
    expect(find.lines).toEqual(['e3 link "Koszyk" → /cart']);
    expect(callsOf(h.calls, 'ariaSnapshot').length - before).toBe(1);
    const none = await h.run({ do: 'find', text: 'nic-takiego' });
    expect(none.lines).toEqual(['0 matches for "nic-takiego"']);
    const list = await h.run({ do: 'verify', kind: 'list', selector: '#menu', items: ['text'] });
    expect(list.lines).toEqual(['ok verify list #menu']);
    // Still resolvable without a refresh: count() > 0 on the first try.
    const snaps = callsOf(h.calls, 'ariaSnapshot').length;
    const click = await h.run({ do: 'click', ref: 'e1' });
    expect(click.exit).toBe(0);
    expect(callsOf(h.calls, 'ariaSnapshot').length).toBe(snaps);
  });

  it('locator prints the durable selector of a ref; the journal keeps it for export', async () => {
    const h = await harness();
    await h.open();
    const loc = await h.run({ do: 'locator', ref: 'e1' });
    expect(loc.exit).toBe(0);
    expect(loc.lines).toEqual(['role=button[name="Go"]']);
    await h.run({ do: 'click', ref: 'e1' });
    const journal = readJournal(path.join(h.dir, 'journal.jsonl'));
    expect(journal.at(-1)).toMatchObject({ command: 'click', selector: 'role=button[name="Go"]' });
  });
});

describe('session: snap', () => {
  const many = Array.from({ length: 30 }, (_, i) => {
    const role = ['button', 'link', 'textbox', 'checkbox'][i % 4];
    return `- ${role} "Item ${String(i + 1)}" [ref=e${String(i + 1)}]`;
  }).join('\n');

  it('prints 25 compact lines by default with the overflow marker; --max changes the cut; --all only names the file', async () => {
    const h = await harness({ snapshot: many });
    await h.open();
    const snap = await h.run({ do: 'snapshot' }, { alias: 'snap' });
    expect(snap.lines).toHaveLength(26);
    expect(snap.lines[0]).toBe('e1 button "Item 1"');
    expect(snap.lines[25]).toMatch(/^…\+5 lines · .*session\/default\/snap\.md$/u);
    const five = await h.run({ do: 'snapshot', max: 5 }, { alias: 'snap' });
    expect(five.lines).toHaveLength(6);
    expect(five.lines[5]).toMatch(/^…\+25 lines · /u);
    const all = await h.run({ do: 'snapshot', all: true }, { alias: 'snap' });
    expect(all.lines).toHaveLength(1);
    expect(all.lines[0]).toMatch(/^ok snap 30 lines · .*snap\.full\.yml · .*snap\.md$/u);
    assertBudget(all.lines);
  });

  it('--diff prints only the lines added and removed since the previous snapshot; --around the neighbourhood', async () => {
    const h = await harness();
    await h.open();
    const same = await h.run({ do: 'snapshot', diff: true }, { alias: 'snap' });
    expect(same.lines).toEqual([expect.stringMatching(/^0 changed · /u)]);
    h.options.snapshot = SNAPSHOT.replace('- button "Go" [ref=e1]', '- button "W koszyku" [ref=e7]');
    const diff = await h.run({ do: 'snapshot', diff: true }, { alias: 'snap' });
    expect(diff.lines).toEqual(['+ e7 button "W koszyku"', '- e1 button "Go"']);
    const around = await h.run({ do: 'snapshot', around: 'e2' }, { alias: 'snap' });
    expect(around.lines).toEqual([
      'h1 "Sklep"',
      'e7 button "W koszyku"',
      'e2 textbox "Name"',
      'e3 link "Koszyk" → /cart',
    ]);
    const gone = await h.run({ do: 'snapshot', around: 'e1' }, { alias: 'snap' });
    expect(gone.lines).toEqual([expect.stringMatching(/^ref e1 not in snapshot · /u)]);
    const grep = await h.run({ do: 'snapshot', grep: 'name' }, { alias: 'snap' });
    expect(grep.lines).toEqual(['e2 textbox "Name"']);
  });
});

describe('session: console and net', () => {
  it('console prints only the entries since the last call; --level filters; --all counts the total', async () => {
    const h = await harness();
    await h.open();
    const page = h.page();
    page.emit('console', fakeConsole('log', 'hello'));
    page.emit('console', fakeConsole('warning', 'careful'));
    const first = await h.run({ do: 'console' });
    expect(first.lines).toEqual(['2 new:', 'log hello', 'warning careful']);
    const nothing = await h.run({ do: 'console' });
    expect(nothing.lines).toEqual(['0 new']);
    page.emit('console', fakeConsole('error', '[cart] POST /api/cart → 404'));
    page.emit('pageerror', new Error('boom in page'));
    const errors = await h.run({ do: 'console', level: 'error' });
    expect(errors.lines).toEqual(['2 new:', 'error [cart] POST /api/cart → 404', 'pageerror boom in page']);
    const all = await h.run({ do: 'console', all: true, level: 'warn' });
    expect(all.lines).toEqual([
      '3 total:',
      'warning careful',
      'error [cart] POST /api/cart → 404',
      'pageerror boom in page',
    ]);
    assertBudget(all.lines);
    expect(await readFile(path.join(h.dir, 'console.jsonl'), 'utf8')).toContain('"text":"hello"');
  });

  it('net summarises the new requests with the failures; net <n> --body --req writes net/<n>.txt', async () => {
    const h = await harness();
    await h.open('http://localhost:4300/');
    const page = h.page();
    fakeRequest(page, { url: 'http://localhost:4300/api/items', body: '[1,2,3]' });
    fakeRequest(page, {
      url: 'http://localhost:4300/api/cart',
      method: 'POST',
      status: 404,
      body: '{"error":"cart not found"}',
    });
    fakeRequest(page, { url: 'http://localhost:4300/api/ping', fail: 'net::ERR_FAILED' });
    const net = await h.run({ do: 'net' });
    // The request timings are wall-clock: a millisecond tick between `request` and `response` is
    // a `1 ms`, not a failure.
    expect(net.lines).toEqual([
      '3 new · 2 failed:',
      expect.stringMatching(/^#2 POST \/api\/cart 404 [01] ms$/u),
      expect.stringMatching(/^#3 GET \/api\/ping net::ERR_FAILED [01] ms$/u),
    ]);
    assertBudget(net.lines);
    expect((await h.run({ do: 'net' })).lines).toEqual(['0 new']);
    const body = await h.run({ do: 'net', n: 2, body: true, req: true });
    expect(body.lines[0]).toMatch(/^404 application\/json 26 B · .*session\/default\/net\/2\.txt$/u);
    expect(body.lines.slice(1)).toEqual(['> accept: application/json', '> x-trace: abc', '{"error":"cart not found"}']);
    const file = await readFile(path.join(h.dir, 'net', '2.txt'), 'utf8');
    expect(file).toContain('POST http://localhost:4300/api/cart');
    expect(file).toContain('{"a":1}');
    const missing = await h.run({ do: 'net', n: 9 });
    expect(missing.exit).toBe(1);
    expect(missing.lines[0]).toMatch(/^FAIL net 9 · net #9: no such request/u);
    const all = await h.run({ do: 'net', all: true, tail: 1 });
    expect(all.lines).toEqual([
      '3 total:',
      '…2 older (browser-inspector net --all --tail N)',
      expect.stringMatching(/^#3 GET \/api\/ping net::ERR_FAILED [01] ms$/u),
    ]);
    expect(await readFile(path.join(h.dir, 'net.jsonl'), 'utf8')).toContain('"url":"http://localhost:4300/api/cart"');
  });
});

describe('session: frames, dialogs, tabs', () => {
  it('frame changes the scope of CSS selectors and eval only — never a subtree snapshot; refs stay on the page', async () => {
    const h = await harness();
    await h.open();
    const snaps = callsOf(h.calls, 'ariaSnapshot').length;
    const frame = await h.run({ do: 'frame', frame: '0' });
    expect(frame.lines).toEqual(['ok frame 0']);
    const get = await h.run({ do: 'extract', selector: '#child-out' }, { alias: 'get' });
    expect(get.lines).toEqual(['text of #child-out']);
    const click = await h.run({ do: 'click', ref: 'e1' });
    expect(click.exit).toBe(0);
    expect(callsOf(h.calls, 'ariaSnapshot').length).toBe(snaps);
    const main = await h.run({ do: 'frame', frame: 'main' });
    expect(main.lines).toEqual(['ok frame main']);
    expect(h.engine.session('default')?.ctx.frame).toBeUndefined();
  });

  it('dialogs follow the policy set BEFORE the action, show up in the line, and `dialog` shows policy + last', async () => {
    const h = await harness();
    await h.open();
    const page = h.page();
    const emitDialog = (/** @type {string} */ type, /** @type {string} */ message) =>
      page.emit('dialog', {
        type: () => type,
        message: () => message,
        accept: async () => {},
        dismiss: async () => {},
      });
    h.options.fail = { click: () => emitDialog('confirm', 'Usunąć?') };
    const dismissed = await h.run({ do: 'click', ref: 'e1' });
    expect(dismissed.lines).toEqual(['ok click e1 · dialog confirm "Usunąć?" → dismissed']);
    const policy = await h.run({ do: 'dialog', action: 'accept', once: true });
    expect(policy.lines).toEqual(['ok dialog accept (once)']);
    const accepted = await h.run({ do: 'click', ref: 'e1' });
    expect(accepted.lines).toEqual(['ok click e1 · dialog confirm "Usunąć?" → accepted']);
    assertBudget(accepted.lines);
    // `--once` spent: back to dismiss; beforeunload is ALWAYS accepted whatever the policy.
    h.options.fail = { click: () => emitDialog('beforeunload', '') };
    const unload = await h.run({ do: 'click', ref: 'e1' });
    expect(unload.lines).toEqual(['ok click e1 · dialog beforeunload "" → accepted']);
    h.options.fail = {};
    const show = await h.run({ do: 'dialog' });
    expect(show.lines).toEqual(['policy dismiss · last: beforeunload "" → accepted (click e1)']);
    assertBudget(show.lines);
  });

  it('tab new / tabs / tab <n> / tab close: the new tab gets its own CDP session, the first tab never closes', async () => {
    const h = await harness();
    await h.open('http://localhost:4300/');
    const cdpBefore = callsOf(h.calls, 'newCDPSession').length;
    const opened = await h.run({ do: 'tab', action: 'new', url: 'http://localhost:4300/help' });
    expect(opened.exit).toBe(0);
    expect(opened.lines).toEqual(['ok tab new http://localhost:4300/help · url /help "Sklep"']);
    expect(callsOf(h.calls, 'newCDPSession').length).toBe(cdpBefore + 1);
    const tabs = await h.run({ do: 'tabs' });
    expect(tabs.lines).toEqual(['0 "Sklep" /', '1* "Sklep" /help']);
    assertBudget(tabs.lines);
    const select = await h.run({ do: 'tab', action: 'select', index: 0 });
    expect(select.lines).toEqual(['ok tab select 0 · url / "Sklep"']);
    const refuse = await h.run({ do: 'tab', action: 'close' });
    expect(refuse.exit).toBe(1);
    expect(refuse.lines[0]).toMatch(/^FAIL tab close · tab close: the lane tab stays open/u);
    await h.run({ do: 'tab', action: 'select', index: 1 });
    const closed = await h.run({ do: 'tab', action: 'close' });
    expect(closed.lines).toEqual(['ok tab close · url / "Sklep"']);
    expect((await h.run({ do: 'tabs' })).lines).toEqual(['0* "Sklep" /']);
  });
});

describe('session: shot, eval, run, close, export, script', () => {
  it('shot prints the numbered file with its size; --mark outlines through the locator', async () => {
    const h = await harness();
    await h.open();
    const shot = await h.run({ do: 'screenshot', name: 'koszyk', mark: 'e1' }, { alias: 'shot' });
    expect(shot.lines).toEqual([expect.stringMatching(/^ok shot .*session\/default\/shots\/001-koszyk\.png 1x1$/u)]);
    assertBudget(shot.lines);
    expect(existsSync(path.join(h.dir, 'shots', '001-koszyk.png'))).toBe(true);
    expect(callsOf(h.calls, 'locator.evaluate').some((a) => a[0] === 'aria-ref=e1')).toBe(true);
    const second = await h.run({ do: 'screenshot' }, { alias: 'shot' });
    expect(second.lines[0]).toContain('shots/002-shot.png');
  });

  it('eval prints inline up to 300 chars, longer goes to eval-NNN.txt; --el evaluates on the element', async () => {
    const h = await harness();
    await h.open();
    const short = await h.run({ do: 'evaluate', expression: 'document.title' }, { alias: 'eval' });
    expect(short.lines).toEqual(['evaluated document.title']);
    const long = 'x'.repeat(400);
    h.options.runtimeEvaluate = () => ({ result: { type: 'string', value: long } });
    const big = await h.run({ do: 'evaluate', expression: 'big' }, { alias: 'eval' });
    expect(big.lines).toHaveLength(2);
    expect(big.lines[0]).toHaveLength(300);
    expect(big.lines[1]).toMatch(/^…400 chars · .*session\/default\/eval-001\.txt$/u);
    expect(await readFile(path.join(h.dir, 'eval-001.txt'), 'utf8')).toBe(long);
    const el = await h.run({ do: 'evaluate', expression: 'el.tagName', ref: 'e1' }, { alias: 'eval' });
    expect(el.exit).toBe(0);
    expect(callsOf(h.calls, 'locator.evaluate').some((a) => a[0] === 'aria-ref=e1' && a[1] === 'el.tagName')).toBe(
      true,
    );
  });

  it('run --file is refused with exit 2 without BROWSER_INSPECTOR_UNSAFE=1 and runs the module with it', async () => {
    const files = {
      's.mjs': { base64: Buffer.from('export default async (page) => page.url();').toString('base64'), size: 44 },
    };
    const h = await harness();
    await h.open();
    const refused = await h.run({ do: 'run', file: 's.mjs' }, { files });
    expect(refused.exit).toBe(2);
    expect(refused.lines).toEqual([
      'FAIL run --file s.mjs · refused: set BROWSER_INSPECTOR_UNSAFE=1 (the file runs inside the keeper — RCE-equivalent)',
    ]);
    assertBudget(refused.lines);
    expect(existsSync(path.join(h.dir, 'run-001.mjs'))).toBe(false);

    const unsafe = await harness({}, { env: { BROWSER_INSPECTOR_UNSAFE: '1' } });
    await unsafe.open('http://localhost:4300/');
    const ran = await unsafe.run({ do: 'run', file: 's.mjs' }, { files });
    expect(ran.exit, ran.lines.join('\n')).toBe(0);
    expect(ran.lines).toEqual(['ok run --file s.mjs · http://localhost:4300/']);
  });

  it('close ends the session (context closed, registry empty); closeSession is what the TTL calls', async () => {
    const h = await harness();
    await h.open();
    await h.run({ do: 'click', ref: 'e1' });
    const close = await h.run({ do: 'close' });
    expect(close.exit).toBe(0);
    expect(close.lines).toEqual([
      expect.stringMatching(/^ok close · session default · 3 commands · .*session\/default$/u),
    ]);
    expect(h.engine.session('default')).toBeUndefined();
    expect(callsOf(h.calls, 'context.close')).toHaveLength(1);
    await h.open();
    expect(h.engine.session('default')).toBeDefined();
    await h.engine.closeSession('default');
    expect(h.engine.session('default')).toBeUndefined();
    expect(callsOf(h.calls, 'context.close')).toHaveLength(2);
  });

  it('export writes the journal as a flow config with selectors instead of refs, refuses to overwrite without --force', async () => {
    const h = await harness();
    await h.open('http://localhost:4300/');
    await h.run({ do: 'click', ref: 'e1' });
    await h.run(
      { do: 'fill', ref: 'e2', valueFromEnv: 'NAME' },
      { values: { 'argv.fill.value': 'Jan' }, secretValues: ['Jan'] },
    );
    const file = path.join(h.cwd, 'flows', 'koszyk.json');
    const exported = await h.engine.exportFlow('default', { file, cwd: h.cwd });
    expect(exported.exit, exported.lines.join('\n')).toBe(0);
    expect(exported.lines).toEqual(['ok export 2 steps → flows/koszyk.json (refs → data-testid/#id/role=)']);
    assertBudget(exported.lines);
    const config = JSON.parse(await readFile(file, 'utf8'));
    expect(config.snapshots[0]).toMatchObject({ name: 'koszyk', url: 'http://localhost:4300/' });
    expect(config.snapshots[0].steps).toEqual([
      { do: 'click', selector: 'role=button[name="Go"]' },
      { do: 'fill', selector: 'role=textbox[name="Name"]', valueFromEnv: 'NAME' },
    ]);
    const again = await h.engine.exportFlow('default', { file, cwd: h.cwd });
    expect(again.exit).toBe(2);
    expect(again.lines[0]).toMatch(/^FAIL export · .*exists — add --force/u);
    const forced = await h.engine.exportFlow('default', { file, cwd: h.cwd, force: true });
    expect(forced.exit).toBe(0);
  });

  it('runScript: one command per line, values under script[<line>], stops at the first FAIL, comments keep the numbering', async () => {
    const h = await harness({ counts: { 'aria-ref=e99': 0 } });
    const lines = [
      '# a comment',
      'open http://localhost:4300/',
      'fill e2 @{APP_PASS} --enter',
      '',
      'click e99',
      'click e1',
    ];
    const result = await h.engine.runScript(lines, {
      session: 'default',
      cwd: h.cwd,
      out: h.out,
      values: { 'script[2].value': 's3cret' },
      secretValues: ['s3cret'],
      files: {},
      mode: 'no-daemon',
      queuedMs: 0,
    });
    expect(result.exit).toBe(1);
    expect(result.lines).toEqual([
      expect.stringMatching(/^ok open "Sklep" · el 61 · err 0 · /u),
      'ok fill e2 + Enter',
      'FAIL click e99 · ref not found (gone, label changed or other frame) → browser-inspector snap',
    ]);
    expect(callsOf(h.calls, 'fill').at(-1)?.slice(0, 2)).toEqual(['aria-ref=e2', 's3cret']);
    expect(callsOf(h.calls, 'click')).toHaveLength(0);
    await h.engine.session('default')?.writes;
    const journal = await readFile(path.join(h.dir, 'journal.jsonl'), 'utf8');
    expect(journal).not.toContain('s3cret');
    const bad = await h.engine.runScript(['clik e1'], { session: 'default', cwd: h.cwd, out: h.out });
    expect(bad.exit).toBe(2);
    expect(bad.lines[0]).toMatch(/^FAIL script:1 · unknown command "clik"/u);
  });

  it('sessions are keyed by name only; status counts them and their routes', async () => {
    const h = await harness();
    await h.open();
    await h.run({ do: 'route', url: '**/api/*', block: true });
    await h.run({ do: 'goto', url: 'http://localhost:4300/' }, { session: 'other', alias: 'open' });
    const status = h.engine.status();
    expect(status.sessions.map((s) => s.name)).toEqual(['default', 'other']);
    expect(status.routes).toBe(1);
    const routes = await h.run({ do: 'routes' });
    expect(routes.lines).toEqual(['**/api/* block']);
    await h.run({ do: 'unroute' });
    expect((await h.run({ do: 'routes' })).lines).toEqual(['0 routes']);
  });
});
