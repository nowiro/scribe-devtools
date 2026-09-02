// Every stdout sample of DESIGN.md §4.4 reproduced character for character, and each one measured
// with the same tokenizer as the bench (o200k): ≤ 40 tokens, ≤ 160 characters. A line that grew past
// the budget would show up here before it showed up in a session cost.
import { encode } from 'gpt-tokenizer/encoding/o200k_base';
import { describe, expect, it } from 'vitest';

import {
  KEEPER_UNAVAILABLE,
  MAX_LINE,
  REF_NOT_FOUND,
  formatBytes,
  formatConsoleEntry,
  formatDeltas,
  formatDialogStatus,
  formatDoctor,
  formatEval,
  formatExport,
  formatFail,
  formatLine,
  formatMs,
  formatNetBody,
  formatNetEntry,
  formatNetSummary,
  formatNewEntries,
  formatOk,
  formatOpen,
  formatOverflow,
  formatShot,
  relPath,
  truncate,
  urlDisplay,
} from '../src/print.mjs';

const tokens = (/** @type {string} */ line) => encode(line).length;

describe('DESIGN.md §4.4 samples', () => {
  const cases = [
    [
      'open',
      formatOpen({ title: 'Księgarnia', el: 61, errors: 0, snapPath: 'session/default/snap.md' }),
      'ok open "Księgarnia" · el 61 · err 0 · session/default/snap.md',
    ],
    [
      'click with dom delta',
      formatOk(
        'click e112',
        formatDeltas(
          { url: 'http://localhost:4313/', el: 61, consoleErrors: 0 },
          { url: 'http://localhost:4313/', el: 63, consoleErrors: 1, domChanged: true },
        ),
      ),
      'ok click e112 · dom Δ · el 61→63 · +1 console.error',
    ],
    [
      'click with SPA url change',
      formatOk(
        'click e45',
        formatDeltas(
          { url: 'http://localhost:4313/', el: 63 },
          { url: 'http://localhost:4313/cart', title: 'Koszyk', el: 23 },
          { baseOrigin: 'http://localhost:4313' },
        ),
      ),
      'ok click e45 · url /cart "Koszyk" · el 63→23',
    ],
    [
      'fill with navigation',
      formatOk(
        'fill e39',
        formatDeltas(
          { url: 'http://localhost:4313/', el: 61 },
          { url: 'http://localhost:4313/szukaj?q=Harry', el: 58, navigated: true, frameSeq: 1 },
        ),
      ),
      'ok fill e39 · navigated → refs f1eN (bi snap) · el 58',
    ],
    ['overflow', formatOverflow(55, 'session/default/snap.md'), '…+55 lines · session/default/snap.md'],
    [
      'console',
      formatNewEntries([formatConsoleEntry({ type: 'error', text: '[cart] POST /api/cart → 404' })])[0],
      '1 new: error [cart] POST /api/cart → 404',
    ],
    [
      'net summary',
      formatNetSummary({
        newCount: 3,
        failed: [
          formatNetEntry(
            { id: 7, method: 'POST', url: 'http://localhost:4313/api/cart', status: 404, ms: 12 },
            'http://localhost:4313',
          ),
        ],
      })[0],
      '3 new · 1 failed: #7 POST /api/cart 404 12 ms',
    ],
    [
      'net body',
      formatNetBody({ status: 404, contentType: 'application/json', size: 41, file: 'session/default/net/7.txt' }),
      '404 application/json 41 B · session/default/net/7.txt',
    ],
    ['eval', formatEval('"Koszyk"')[0], '"Koszyk"'],
    [
      'shot',
      formatShot('session/default/shots/004-koszyk.png', 1280, 2140),
      'ok shot session/default/shots/004-koszyk.png 1280x2140',
    ],
    [
      'ref not found',
      formatFail('click e99', REF_NOT_FOUND),
      'FAIL click e99 · ref not found (gone, label changed or other frame) → bi snap',
    ],
    [
      'dialog',
      formatDialogStatus(
        { action: 'dismiss' },
        { type: 'confirm', message: 'Usunąć?', action: 'dismissed', trigger: 'bi click e12' },
      ),
      'policy dismiss · last: confirm "Usunąć?" → dismissed (bi click e12)',
    ],
    [
      'export',
      formatExport(9, 'flows/koszyk.json'),
      'ok export 9 steps → flows/koszyk.json (refs → data-testid/#id/role=)',
    ],
    [
      'keeper unavailable',
      KEEPER_UNAVAILABLE('ECONNREFUSED'),
      'FAIL keeper unavailable: ECONNREFUSED — session needs keeper (bi up, bi doctor); batch works with --no-daemon',
    ],
  ];

  it.each(cases)('%s', (_, actual, expected) => {
    expect(actual).toBe(expected);
    expect(actual.length).toBeLessThanOrEqual(MAX_LINE);
    expect(tokens(actual), `tokens of: ${actual}`).toBeLessThanOrEqual(40);
  });

  it('doctor line — the only one allowed past 160 characters (the absolute path is its point)', () => {
    const line = formatDoctor({
      survives: true,
      spawnToListenMs: 45,
      firstJobMs: 1390,
      warmMs: 470,
      hash: '3f9a1c2e',
      biPath: 'D:\\github\\scribe-devtools\\packages\\browser-inspector\\bin\\bi.mjs',
    });
    expect(line).toBe(
      'ok keeper survives shell: yes · spawn→listen 45 ms · first job 1 390 ms · warm 470 ms · hash 3f9a1c2e · D:/github/scribe-devtools/packages/browser-inspector/bin/bi.mjs',
    );
    expect(tokens(line)).toBeLessThanOrEqual(60);
  });
});

describe('rules', () => {
  it('truncates to 160 characters with a marker and flattens newlines', () => {
    const long = formatOk('click e1', ['x'.repeat(300)]);
    expect(long.length).toBe(MAX_LINE);
    expect(long.endsWith('…')).toBe(true);
    expect(truncate('a\n  b\nc')).toBe('a b c');
    expect(truncate('abcdef', 4)).toBe('abc…');
    expect(truncate('abc', 4)).toBe('abc');
  });

  it('formatLine drops empty parts and formatFail caps the reason', () => {
    expect(formatLine('ok', 'back', ['', undefined, null, false, 'el 3'])).toBe('ok back · el 3');
    expect(formatFail('eval', 'boom '.repeat(100), ['el 1'])).toMatch(/^FAIL eval · boom .*… · el 1$/u);
  });

  it('formatDeltas covers each delta once, in order', () => {
    const before = { url: 'http://a/', el: 10, consoleErrors: 1, netFailed: 0 };
    expect(formatDeltas(before, { url: 'http://a/', el: 10 })).toEqual(['el 10']);
    expect(
      formatDeltas(before, { url: 'http://a/', el: 12, consoleErrors: 3, netFailed: 2, domChanged: true }),
    ).toEqual(['dom Δ', 'el 10→12', '+2 console.error', '+2 net failed']);
    expect(
      formatDeltas(before, {
        url: 'http://a/',
        el: 10,
        dialogs: [{ type: 'beforeunload', message: '', action: 'accepted' }],
      }),
    ).toEqual(['el 10', 'dialog beforeunload "" → accepted']);
    expect(formatDeltas(before, { url: 'http://b/x', title: 'B', el: 5 })).toEqual(['url http://b/x "B"', 'el 10→5']);
    expect(formatDeltas({}, { navigated: true, frameSeq: 2 })).toEqual(['navigated → refs f2eN (bi snap)']);
    expect(formatDeltas(before, { url: 'http://a/', el: 10, consoleErrors: 0 })).toEqual(['el 10']);
  });

  it('formats numbers, bytes, paths and urls without a locale', () => {
    expect(formatMs(470)).toBe('470');
    expect(formatMs(1390)).toBe('1 390');
    expect(formatMs(1234567.6)).toBe('1 234 568');
    expect(formatMs(-1500)).toBe('-1 500');
    expect(formatBytes(41)).toBe('41 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(3 * 1024 * 1024)).toBe('3.0 MB');
    expect(relPath('D:\\x\\.scribe-devtools\\session\\default\\snap.md', 'D:/x')).toBe(
      '.scribe-devtools/session/default/snap.md',
    );
    expect(relPath('d:/x/a.txt', 'D:/x/')).toBe('a.txt');
    expect(relPath('/tmp/other/a.txt', '/home/me')).toBe('/tmp/other/a.txt');
    expect(relPath('/home/me', '/home/me')).toBe('.');
    expect(urlDisplay('http://localhost:4313/cart?x=1#y', 'http://localhost:4313')).toBe('/cart?x=1#y');
    expect(urlDisplay('http://other/cart', 'http://localhost:4313')).toBe('http://other/cart');
    expect(urlDisplay('not a url')).toBe('not a url');
  });

  it('formatNewEntries / formatNetSummary / formatEval handle the other counts', () => {
    expect(formatNewEntries([])).toEqual(['0 new']);
    expect(formatNewEntries(['a', 'b'])).toEqual(['2 new:', 'a', 'b']);
    expect(formatNewEntries(['a'], 'total')).toEqual(['1 total: a']);
    expect(formatNetSummary({ newCount: 3, failed: [] })).toEqual(['3 new']);
    expect(formatNetSummary({ newCount: 3, failed: ['#1 x', '#2 y'] })).toEqual(['3 new · 2 failed:', '#1 x', '#2 y']);
    expect(formatNetEntry({ id: 3, method: 'GET', url: 'http://a/b', failure: 'net::ERR_FAILED' })).toBe(
      '#3 GET /b net::ERR_FAILED',
    );
    expect(formatNetBody({ failure: 'net::ERR', file: 'f' })).toBe('net::ERR · f');
    expect(formatDialogStatus({ action: 'accept', once: true }, undefined)).toBe('policy accept (once) · last: none');
    expect(formatEval('a\nb')).toEqual(['a', 'b']);
    const long = formatEval('x'.repeat(500), 'session/default/eval-003.txt');
    expect(long).toHaveLength(2);
    expect(long[1]).toBe('…500 chars · session/default/eval-003.txt');
  });
});
