// The journal → config export (DESIGN.md §4.5, AC-14): the exported file parses with the config
// loader, every ref is replaced by the selector resolved at action time (a ref without one is an
// error, never a silent drop), a value from env stays `valueFromEnv` and the secret itself never
// lands in the journal or the export, and an existing file is not overwritten without --force.
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { loadConfig, parseConfig } from '../src/config.mjs';
import {
  ExportError,
  appendJournal,
  exportFlow,
  flowNameFrom,
  journalPath,
  normalizeEntry,
  readJournal,
  writeFlowExport,
} from '../src/session-log.mjs';

const SECRET = 'hunter2!ą';
const tmp = () => mkdtempSync(path.join(os.tmpdir(), 'browser-inspector-wp4-export-'));

/**
 * A session as the engine would journal it: open, look, act on refs, fill from env, capture.
 * @returns {import('../src/session-log.mjs').JournalEntry[]}
 */
function journal() {
  return [
    {
      seq: 1,
      command: 'goto',
      step: { do: 'goto', url: 'http://localhost:4313/', waitUntil: 'settled' },
      ok: true,
      ms: 120,
      url: 'http://localhost:4313/',
    },
    { seq: 2, command: 'find', step: { do: 'find', text: 'koszyk' }, ok: true, ms: 30 },
    {
      seq: 3,
      command: 'click',
      step: { do: 'click', ref: 'e112' },
      ok: true,
      ms: 44,
      selector: '[data-testid=card-add-to-cart]',
    },
    { seq: 4, command: 'click', step: { do: 'click', ref: 'e99' }, ok: false, ms: 12, error: 'ref not found' },
    {
      seq: 5,
      command: 'fill',
      step: { do: 'fill', ref: 'e39', valueFromEnv: 'SHOP_PASS', enter: true },
      ok: true,
      ms: 9,
      selector: '#mat-input-0',
    },
    {
      seq: 6,
      command: 'form',
      step: {
        do: 'form',
        fields: [
          { ref: 'e3', value: 'Jan' },
          { selector: '#email', valueFromEnv: 'SHOP_EMAIL' },
        ],
      },
      ok: true,
      ms: 20,
      resolved: { 'fields[0].ref': '[name=firstName]' },
    },
    {
      seq: 7,
      command: 'drag',
      step: { do: 'drag', from: 'e5', to: '#drop' },
      ok: true,
      ms: 15,
      resolved: { from: '#card-1' },
    },
    { seq: 8, command: 'snapshot', step: { do: 'snapshot', max: 25 }, ok: true, ms: 40 },
    {
      seq: 9,
      command: 'extract',
      step: { do: 'extract', ref: 'e45' },
      ok: true,
      ms: 2,
      selector: '[data-testid=header-cart-button]',
    },
    { seq: 10, command: 'screenshot', step: { do: 'screenshot', fullPage: true, mark: 'e45' }, ok: true, ms: 25 },
    { seq: 11, command: 'screenshot', step: { do: 'screenshot', name: 'koszyk' }, ok: true, ms: 25 },
    { seq: 12, command: 'evaluate', step: { do: 'evaluate', expression: 'document.title' }, ok: true, ms: 1 },
    { seq: 13, command: 'evaluate', step: { do: 'evaluate', file: 's.js' }, ok: true, ms: 1 },
    { seq: 14, command: 'console', step: { do: 'console', level: 'error' }, ok: true, ms: 1 },
    { seq: 15, command: 'verify', step: { do: 'verify', kind: 'url', url: '**/cart', soft: true }, ok: true, ms: 3 },
    { seq: 16, command: 'dialog', step: { do: 'dialog' }, ok: true, ms: 0 },
    {
      seq: 17,
      command: 'storage',
      step: { do: 'storage', kind: 'local', op: 'set', key: 'token', valueFromEnv: 'APP_TOKEN' },
      ok: true,
      ms: 1,
    },
    { seq: 18, command: 'wait', step: { do: 'wait', text: 'Harry Potter' }, ok: true, ms: 200 },
  ];
}

describe('exportFlow', () => {
  const { config, count, skipped } = exportFlow(journal(), { file: 'flows/koszyk.json' });
  const flow = config.snapshots[0];

  it('produces a config the loader accepts, named after the file', () => {
    expect(() => parseConfig(config)).not.toThrow();
    expect(flow.name).toBe('koszyk');
    expect(flow.type).toBe('flow');
    expect(flow.url).toBe('http://localhost:4313/');
    expect(flow.waitUntil).toBe('settled');
    expect(count).toBe(flow.steps.length);
  });

  it('replaces every ref with the selector resolved at action time — no ref survives', () => {
    const text = JSON.stringify(config);
    expect(text).not.toMatch(/"ref"/u);
    expect(text).not.toMatch(/"(?:f\d+)?e\d+"/u);
    expect(flow.steps[0]).toEqual({ do: 'click', selector: '[data-testid=card-add-to-cart]' });
    expect(flow.steps[1]).toEqual({ do: 'fill', selector: '#mat-input-0', valueFromEnv: 'SHOP_PASS', enter: true });
    expect(flow.steps[2]).toEqual({
      do: 'form',
      fields: [
        { selector: '[name=firstName]', value: 'Jan' },
        { selector: '#email', valueFromEnv: 'SHOP_EMAIL' },
      ],
    });
    expect(flow.steps[3]).toEqual({ do: 'drag', from: '#card-1', to: '#drop' });
    expect(flow.steps[4]).toEqual({ do: 'extract', selector: '[data-testid=header-cart-button]', name: 'extract-1' });
  });

  it('invents the names batch requires, drops session-only fields and keeps valueFromEnv', () => {
    expect(flow.steps[5]).toEqual({ do: 'screenshot', fullPage: true, name: 'shot-1' });
    expect(flow.steps[6]).toEqual({ do: 'screenshot', name: 'koszyk' });
    expect(flow.steps[7]).toEqual({ do: 'evaluate', expression: 'document.title', name: 'eval-1' });
    expect(flow.steps[8]).toEqual({ do: 'verify', kind: 'url', url: '**/cart', soft: true });
    expect(flow.steps[9]).toEqual({ do: 'storage', kind: 'local', op: 'set', key: 'token', valueFromEnv: 'APP_TOKEN' });
    expect(flow.steps[10]).toEqual({ do: 'wait', text: 'Harry Potter' });
    expect(flow.steps).toHaveLength(11);
  });

  it('skips failed and session-only commands and says why', () => {
    expect(skipped.map((s) => [s.seq, s.command])).toEqual([
      [2, 'find'],
      [4, 'click'],
      [8, 'snapshot'],
      [13, 'evaluate'],
      [14, 'console'],
      [16, 'dialog'],
    ]);
    expect(skipped.find((s) => s.seq === 4)?.reason).toBe('failed in the session');
    expect(skipped.find((s) => s.seq === 13)?.reason).toContain('session-only');
  });

  it('refuses a ref that resolved inside an iframe — its selector is local to that document', () => {
    // The selector `durableSelector` computes is unique in the FRAME; a config step resolves it in
    // the main document, where it either finds a like-named element or nothing. Both are worse than
    // an export that says no.
    const entries = journal().map((e) => (e.seq === 3 ? { ...e, inFrame: true } : e));
    expect(() => exportFlow(entries)).toThrow(ExportError);
    expect(() => exportFlow(entries)).toThrow(/step 3 \(click e112\): the ref resolved inside an iframe/u);
    // Without the marker the same journal exports as before — the refusal is not blanket.
    expect(exportFlow(journal()).count).toBeGreaterThan(0);
  });

  it('refuses a ref without a resolved selector instead of exporting a ref (negative test)', () => {
    const entries = journal().map((e) => (e.seq === 3 ? { ...e, selector: undefined } : e));
    expect(() => exportFlow(entries)).toThrow(ExportError);
    expect(() => exportFlow(entries)).toThrow(/step 3 \(click e112\): ref "e112" \(ref\) has no selector/u);
    const form = journal().map((e) => (e.seq === 6 ? { ...e, resolved: {} } : e));
    expect(() => exportFlow(form)).toThrow(/ref "e3" \(fields\[0\]\.ref\)/u);
    const drag = journal().map((e) => (e.seq === 7 ? { ...e, resolved: undefined } : e));
    expect(() => exportFlow(drag)).toThrow(/"e5"/u);
  });

  it('needs an open and at least one step after it', () => {
    expect(() => exportFlow([])).toThrow(/no successful "open"/u);
    expect(() => exportFlow(journal().slice(0, 2))).toThrow(/no successful step after "open"/u);
  });

  it('later opens become goto steps', () => {
    const entries = [
      ...journal().slice(0, 1),
      {
        seq: 2,
        command: 'goto',
        step: { do: 'goto', url: 'http://localhost:4313/cart', video: true },
        ok: true,
        ms: 50,
      },
    ];
    const out = exportFlow(entries, { name: 'dwa' });
    expect(out.config.snapshots[0].steps).toEqual([{ do: 'goto', url: 'http://localhost:4313/cart' }]);
    expect(out.config.snapshots[0].name).toBe('dwa');
  });

  it('exports the LAST session in the journal, whatever ended the previous one', () => {
    // `journal.jsonl` is per session NAME and survives `close`, a TTL recycle and yesterday. The
    // export used to start at the first `open` in the file, so it replayed a flow nobody ran: the
    // URL of the previous session with its steps in front of the real ones.
    const older = [
      { seq: 1, sid: 'a1', command: 'goto', step: { do: 'goto', url: 'http://localhost:4595/' }, ok: true },
      { seq: 2, sid: 'a1', command: 'click', step: { do: 'click', selector: '#btnA' }, ok: true },
      { seq: 3, sid: 'a1', command: 'close', step: { do: 'close' }, ok: true },
    ];
    const current = [
      { seq: 4, sid: 'b2', command: 'goto', step: { do: 'goto', url: 'http://localhost:4596/' }, ok: true },
      { seq: 5, sid: 'b2', command: 'click', step: { do: 'click', selector: '#btnB' }, ok: true },
    ];
    const out = exportFlow([...older, ...current], { name: 'druga' });
    expect(out.config.snapshots[0].url).toBe('http://localhost:4596/');
    expect(out.config.snapshots[0].steps).toEqual([{ do: 'click', selector: '#btnB' }]);
    // A session that ended by TTL or a keeper restart leaves no `close` line — the id is what
    // marks the boundary, not the command.
    const noClose = exportFlow([...older.slice(0, 2), ...current], { name: 'druga' });
    expect(noClose.config.snapshots[0].url).toBe('http://localhost:4596/');
    // A journal written before ids existed is one session, as it always was.
    expect(exportFlow(journal(), { name: 'stary' }).config.snapshots[0].url).toBe('http://localhost:4313/');
  });

  it('derives the flow name from the file inside the artifact alphabet', () => {
    expect(flowNameFrom('flows/Koszyk Test.json')).toBe('koszyk-test');
    expect(flowNameFrom('D:\\x\\_a.json')).toBe('a');
    expect(flowNameFrom('---.json')).toBe('flow');
  });
});

describe('journal and export never carry a secret (AC-14)', () => {
  it('appendJournal strips the value next to valueFromEnv and redacts everything else', () => {
    const file = journalPath(path.join(tmp(), 'session', 'default'));
    const written = appendJournal(
      file,
      {
        command: 'open',
        step: { do: 'open', url: 'http://localhost:4313/' },
        ok: true,
        ms: 100,
        url: 'http://localhost:4313/',
        title: 'Księgarnia',
      },
      { secretValues: [SECRET] },
    );
    expect(written.command).toBe('goto');
    expect(written.step.do).toBe('goto');
    expect(written.seq).toBe(1);
    expect(written.description).toBe('goto http://localhost:4313/');
    const fill = appendJournal(
      file,
      {
        command: 'fill',
        step: { do: 'fill', ref: 'e5', valueFromEnv: 'APP_PASS', value: SECRET },
        ok: true,
        ms: 9,
        selector: '#password',
        line: `ok fill e5 · typed ${SECRET}`,
      },
      { secretValues: [SECRET] },
    );
    expect(fill.seq).toBe(2);
    expect(fill.step).toEqual({ do: 'fill', ref: 'e5', valueFromEnv: 'APP_PASS' });
    expect(fill.line).toBe('ok fill e5 · typed ***');
    appendJournal(
      file,
      {
        command: 'form',
        step: {
          do: 'form',
          fields: [
            { ref: 'e3', value: 'Jan' },
            { ref: 'e5', valueFromEnv: 'APP_PASS', value: SECRET },
          ],
        },
        ok: true,
        resolved: { 'fields[0].ref': '#first', 'fields[1].ref': '#password' },
      },
      { secretValues: [SECRET] },
    );
    appendJournal(
      file,
      { command: 'storage', step: { do: 'storage', kind: 'local', op: 'set', key: 'k', value: SECRET }, ok: true },
      { secretValues: [SECRET] },
    );
    const text = readFileSync(file, 'utf8');
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain(JSON.stringify(SECRET).slice(1, -1));
    expect(text.trim().split('\n')).toHaveLength(4);
    const entries = readJournal(file);
    expect(entries.map((e) => e.seq)).toEqual([1, 2, 3, 4]);
    expect(/** @type {any} */ (entries[2].step.fields)[1]).toEqual({ ref: 'e5', valueFromEnv: 'APP_PASS' });
    expect(entries[3].step.value).toBe('***');

    const dir = tmp();
    const out = path.join(dir, 'flows', 'login.json');
    const { config } = exportFlow(entries, { file: out, secretValues: [SECRET] });
    writeFlowExport(out, config);
    const exported = readFileSync(out, 'utf8');
    expect(exported).not.toContain(SECRET);
    expect(exported).toContain('"valueFromEnv": "APP_PASS"');
    expect(exported).not.toMatch(/"ref"/u);
    const loaded = loadConfig(out);
    expect(loaded.snapshots[0].name).toBe('login');
    expect(loaded.snapshots[0].steps).toEqual([
      { do: 'fill', selector: '#password', valueFromEnv: 'APP_PASS' },
      {
        do: 'form',
        fields: [
          { selector: '#first', value: 'Jan' },
          { selector: '#password', valueFromEnv: 'APP_PASS' },
        ],
      },
      { do: 'storage', kind: 'local', op: 'set', key: 'k', value: '***' },
    ]);
  });

  it('readJournal skips a corrupt line and keeps the rest', () => {
    const file = path.join(tmp(), 'journal.jsonl');
    writeFileSync(
      file,
      `${JSON.stringify(normalizeEntry({ command: 'goto', step: { do: 'goto', url: 'http://x/' }, ok: true }))}\n{"broken\n\n{"nostep":1}\n`,
    );
    expect(readJournal(file)).toHaveLength(1);
    expect(readJournal(path.join(tmp(), 'missing.jsonl'))).toEqual([]);
  });
});

describe('writeFlowExport', () => {
  it('writes a new file and refuses to overwrite without --force', () => {
    const file = path.join(tmp(), 'flows', 'koszyk.json');
    const { config } = exportFlow(journal(), { file });
    expect(existsSync(file)).toBe(false);
    writeFlowExport(file, config);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(config);
    expect(readFileSync(file, 'utf8').endsWith('}\n')).toBe(true);
    expect(() => writeFlowExport(file, config)).toThrow(ExportError);
    try {
      writeFlowExport(file, config);
    } catch (error) {
      expect(error).toBeInstanceOf(ExportError);
      expect(/** @type {ExportError} */ (error).code).toBe('E_EXISTS');
      expect(/** @type {ExportError} */ (error).exit).toBe(2);
      expect(/** @type {ExportError} */ (error).message).toContain('--force');
    }
    expect(() => writeFlowExport(file, { ...config, forced: true }, { force: true })).not.toThrow();
    expect(JSON.parse(readFileSync(file, 'utf8')).forced).toBe(true);
  });
});
