// report.md reproduced character for character from DESIGN.md §5.1 and measured with the bench
// tokenizer (o200k, ≤ 200 tokens — 187 on the sample); `## steps` only on failure, `## verify` only
// on a soft FAIL, header flags only when they hold; report.json a superset of both old shapes with
// `navigationError` present only when navigation failed and every step error in `Error: …` form;
// writeArtifacts lands report.json after every queued screenshot write.
import { encode } from 'gpt-tokenizer/encoding/o200k_base';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { STAMP_PATTERN } from '../src/cli.mjs';
import {
  CAPS,
  artifactFiles,
  buildManifest,
  buildReport,
  buildSnapshotManifest,
  failureOf,
  formatStepError,
  renderElementsMd,
  renderReportMd,
  writeArtifacts,
} from '../src/report.mjs';

const tokens = (/** @type {string} */ text) => encode(text).length;

/** @type {import('../src/types.js').Timing} */
const TIMING = {
  mode: 'warm',
  ctx: 'reused',
  tab: 'kept',
  lane: 0,
  queuedMs: 0,
  scrubMs: 14,
  gotoMs: 53,
  stepsMs: 371,
  captureMs: 12,
  writeMs: 9,
  totalMs: 446,
  cacheHits: 0,
  cacheHitsDocument: 0,
};

/** @type {import('../src/types.js').EngineInfo} */
const ENGINE = {
  'browser-inspector': '0.1.0',
  'playwright-core': '1.62.1',
  browser: 'Chrome/140',
  flags: ['--disable-frame-rate-limit', '--disable-gpu-vsync'],
  motion: 'no-preference',
  serviceWorkers: 'block',
  generation: 41,
};

const DESCRIPTIONS = [
  'waitFor [data-testid=request-form] (visible)',
  'click [data-testid=submit]',
  'extract blad-email ← [data-testid=error-email]',
  'extract licznik-niepoprawnych ← [data-testid=invalid-count]',
  'screenshot walidacja',
  'fill [data-testid=field-name] (literal)',
  'fill [data-testid=field-email] (literal)',
  'fill [data-testid=field-phone] (literal)',
  'select [data-testid=field-category] = zmiana',
  'click [data-testid=next]',
  'fill [data-testid=field-description] (literal)',
  'click [data-testid=priority-critical]',
  'click [data-testid=submit]',
  'waitFor [data-testid=confirmation] (visible)',
  'extract numer-zgloszenia ← [data-testid=request-number]',
  'extract kategoria ← [data-testid=summary-category]',
  'extract priorytet ← [data-testid=summary-priority]',
  'evaluate formularz-zamkniety',
];

/** @param {number} count @param {number} [failAt] 0-based index of the failing step */
const steps = (count, failAt) =>
  Array.from({ length: count }, (_, index) => ({
    index,
    description: DESCRIPTIONS[index % DESCRIPTIONS.length],
    ok: index !== failAt,
    ms: 6 + index,
    ...(index === failAt ? { error: new Error('Timeout 8000ms exceeded.\n  waiting for locator') } : {}),
  }));

/** The §5.1 sample as the engine would hand it over. */
function sampleInput(/** @type {Partial<import('../src/report.mjs').ReportInput>} */ extra = {}) {
  return {
    name: 'zgloszenie-serwisowe',
    startUrl: 'http://localhost:4300/',
    title: 'Zgłoszenie serwisowe',
    steps: steps(18),
    extracts: {
      'blad-email': 'Podaj poprawny adres e-mail',
      'licznik-niepoprawnych': '3',
      'numer-zgloszenia': 'ALM-1001',
      kategoria: 'zmiana',
      priorytet: 'krytyczny',
      'formularz-zamkniety': 'formularz zniknal, potwierdzenie widoczne',
    },
    console: [
      { type: 'log', text: 'Angular is running in development mode.' },
      { type: 'error', text: '[zgloszenia] zapis nie powiodl sie: 404', location: 'main.js:12' },
      { type: 'log', text: '[zgloszenia] formularz zamkniety' },
    ],
    network: [
      ...Array.from({ length: 11 }, (_, i) => ({
        id: i + 1,
        method: 'GET',
        url: `http://localhost:4300/a${String(i)}.js`,
        status: 200,
      })),
      { id: 7, method: 'POST', url: 'http://localhost:4300/api/zgloszenia', status: 404 },
    ],
    screenshots: ['walidacja.png', 'potwierdzenie.png'],
    text: 'Zgłoszenie serwisowe\nFormularz…',
    elements: Array.from({ length: 21 }, (_, i) => ({
      kind: 'button',
      name: `b${String(i)}`,
      selector: `#b${String(i)}`,
    })),
    timing: TIMING,
    engine: ENGINE,
    ...extra,
  };
}

const SAMPLE_MD = [
  '# zgloszenie-serwisowe — OK 18/18 · 446 ms · warm reused',
  'http://localhost:4300/ "Zgłoszenie serwisowe" · console 3 (1 err) · net 12 (1 failed) · shots walidacja.png potwierdzenie.png',
  '',
  '## errors',
  '- console.error [zgloszenia] zapis nie powiodl sie: 404',
  '- POST /api/zgloszenia → 404',
  '',
  '## values',
  'blad-email: Podaj poprawny adres e-mail',
  'licznik-niepoprawnych: 3',
  'numer-zgloszenia: ALM-1001',
  'kategoria: zmiana',
  'priorytet: krytyczny',
  'formularz-zamkniety: formularz zniknal, potwierdzenie widoczne',
  '',
  'more: elements.md (21) · text.txt · report.json',
  '',
].join('\n');

describe('report.md — DESIGN.md §5.1 sample (AC-7)', () => {
  const { report } = buildReport(sampleInput());
  const md = renderReportMd(report);

  it('renders the sample character for character', () => {
    expect(md).toBe(SAMPLE_MD);
  });

  it('costs ≤ 200 o200k tokens (DESIGN measured 187)', () => {
    const count = tokens(md);
    expect(count).toBeLessThanOrEqual(200);
    expect(count).toBe(187);
  });

  it('has no ## steps and no ## verify on success', () => {
    expect(md).not.toContain('## steps');
    expect(md).not.toContain('## verify');
  });

  it('drops empty sections: no errors, no values → header + footer only', () => {
    const quiet = buildReport(sampleInput({ console: [], network: [], extracts: {} })).report;
    const text = renderReportMd(quiet);
    expect(text).not.toContain('## errors');
    expect(text).not.toContain('## values');
    expect(text.split('\n')[1]).toBe(
      'http://localhost:4300/ "Zgłoszenie serwisowe" · console 0 · net 0 · shots walidacja.png potwierdzenie.png',
    );
    expect(text.endsWith('more: elements.md (21) · text.txt · report.json\n')).toBe(true);
  });
});

describe('report.md — failure (AC-7)', () => {
  const failed = buildReport(
    sampleInput({
      name: 'wizard-formularz',
      steps: steps(10, 9),
      skipped: 6,
      screenshots: ['walidacja.png', 'final.png'],
      timing: { ...TIMING, totalMs: 1812 },
    }),
  ).report;
  const md = renderReportMd(failed);

  it('header says FAIL ok/total, thin-space ms and final.png', () => {
    expect(md.split('\n')[0]).toBe('# wizard-formularz — FAIL 9/16 · 1 812 ms · warm reused · final.png');
    expect(failed.completed).toBe(false);
  });

  it('## steps lists two steps before the failed one, the failed one and the skipped range', () => {
    const section = md.slice(md.indexOf('## steps')).split('\n');
    expect(section).toEqual([
      '## steps',
      `- ok 8. ${DESCRIPTIONS[7]} · 13 ms`,
      `- ok 9. ${DESCRIPTIONS[8]} · 14 ms`,
      `- FAIL 10. ${DESCRIPTIONS[9]} — Error: Timeout 8000ms exceeded.`,
      '- skipped 11–16',
      '',
      'more: elements.md (21) · text.txt · report.json',
      '',
    ]);
    expect(tokens(md)).toBeLessThan(300);
  });

  it('a navigation failure lists it under errors and steps, with every step skipped', () => {
    const nav = buildReport(
      sampleInput({
        steps: [],
        skipped: 18,
        navigationError: new Error('net::ERR_CONNECTION_REFUSED at http://localhost:4300/'),
      }),
    ).report;
    const text = renderReportMd(nav);
    expect(text.split('\n')[0]).toBe('# zgloszenie-serwisowe — FAIL 0/18 · 446 ms · warm reused');
    expect(text).toContain('- navigation Error: net::ERR_CONNECTION_REFUSED at http://localhost:4300/');
    expect(text).toContain('- FAIL navigation — Error: net::ERR_CONNECTION_REFUSED at http://localhost:4300/');
    expect(text).toContain('- skipped 1–18');
  });

  it('a page snapshot (no steps) prints no counter', () => {
    const page = buildReport(sampleInput({ steps: [], screenshots: ['page.png'] })).report;
    expect(renderReportMd(page).split('\n')[0]).toBe('# zgloszenie-serwisowe — OK · 446 ms · warm reused');
  });
});

describe('report.md — conditional header and sections', () => {
  it('adds tab new, motion=reduce, sw=blocked and final: <shot> only when they hold', () => {
    const decorated = buildReport(
      sampleInput({
        timing: { ...TIMING, mode: 'fallback', tab: 'new' },
        engine: { ...ENGINE, motion: 'reduce' },
        serviceWorkerBlocked: true,
        final: 'potwierdzenie.png',
      }),
    ).report;
    expect(renderReportMd(decorated).split('\n')[0]).toBe(
      '# zgloszenie-serwisowe — OK 18/18 · 446 ms · fallback reused · tab new · motion=reduce · sw=blocked · final: potwierdzenie.png',
    );
    // serviceWorkers: 'block' alone (every reused lane) does not print the flag — DESIGN's sample has it and no flag.
    expect(ENGINE.serviceWorkers).toBe('block');
    expect(renderReportMd(buildReport(sampleInput()).report)).not.toContain('sw=blocked');
  });

  it('## verify appears only for soft failures and names the step', () => {
    const soft = buildReport(
      sampleInput({
        steps: [
          ...steps(3),
          { index: 3, description: 'verify text [data-testid=header-cart-button]', ok: true, ms: 4 },
        ],
        verifications: [
          { index: 3, kind: 'text', ok: false, soft: true, detail: 'expected "1", got "0"' },
          { index: 1, kind: 'visible', ok: true, soft: false },
        ],
      }),
    ).report;
    const text = renderReportMd(soft);
    expect(soft.completed).toBe(true);
    expect(text).toContain('## verify\n- FAIL verify text [data-testid=header-cart-button] — expected "1", got "0"\n');
    expect(text).not.toContain('## steps');
    const hard = buildReport(
      sampleInput({ verifications: [{ index: 1, kind: 'url', ok: false, soft: false }] }),
    ).report;
    expect(renderReportMd(hard)).not.toContain('## verify');
  });

  it('shows a redirected final URL as a path on the same origin, the whole URL elsewhere', () => {
    const same = buildReport(sampleInput({ finalUrl: 'http://localhost:4300/cart?x=1' })).report;
    expect(
      renderReportMd(same).split('\n')[1].startsWith('http://localhost:4300/ → /cart?x=1 "Zgłoszenie serwisowe"'),
    ).toBe(true);
    const other = buildReport(sampleInput({ finalUrl: 'https://sso.example/login' })).report;
    expect(renderReportMd(other).split('\n')[1].startsWith('http://localhost:4300/ → https://sso.example/login ')).toBe(
      true,
    );
  });

  it('fences multi-line values and points long ones at values/<name>.txt', () => {
    const long = 'x'.repeat(12_000);
    const { report, files } = buildReport(sampleInput({ extracts: { multi: 'a\nb', long, tick: 'has ``` inside' } }));
    const text = renderReportMd(report);
    expect(text).toContain('multi:\n```\na\nb\n```\n');
    // The file holds the WHOLE value, so report.md can say how much is there — not "5 000+".
    expect(text).toContain('long: values/long.txt (12 000 chars)');
    expect(text).toContain('tick: has ``` inside');
    expect(files['values/long.txt']).toBe(long);
    expect(report.extracts.long).toEqual({ value: 'x'.repeat(CAPS.extract), truncated: true, length: 12_000 });
  });

  it('the engine path fills values/<name>.txt with the whole value, not with the head report.json keeps', () => {
    // The shape `emit()` hands over: the value is NOT capped before the report sees it, or the file
    // report.md points at would be a copy of the head — and the rest would exist nowhere.
    const long = 'y'.repeat(12_000);
    const { report, files } = buildReport(sampleInput({ extracts: { duzy: { value: long, truncated: false } } }));
    expect(files['values/duzy.txt']).toHaveLength(12_000);
    expect(report.extracts.duzy.value).toHaveLength(CAPS.extract);
    expect(report.extracts.duzy.truncated).toBe(true);
    // …and what `artifactFiles` would derive on its own is only that head — `buildReport` wins.
    expect(artifactFiles(report)['values/duzy.txt']).toHaveLength(CAPS.extract);
  });

  it('a cap that lands inside an emoji cuts before it, never between the two halves', () => {
    const lonely = (/** @type {string} */ s) =>
      [...s].some((ch) => {
        const code = ch.charCodeAt(0);
        return ch.length === 1 && code >= 0xd800 && code <= 0xdfff;
      });
    const value = `${'a'.repeat(CAPS.extract - 1)}😀tail`;
    const { report } = buildReport(sampleInput({ extracts: { emoji: value } }));
    expect(lonely(report.extracts.emoji.value)).toBe(false);
    const { report: withText } = buildReport(sampleInput({ text: `${'b'.repeat(CAPS.text - 1)}😀tail` }));
    expect(lonely(withText.text.content)).toBe(false);
  });

  it('caps the error lists and counts the rest', () => {
    const many = Array.from({ length: 25 }, (_, i) => ({ type: 'error', text: `boom ${String(i)}` }));
    const text = renderReportMd(
      buildReport(sampleInput({ console: many, pageErrors: ['TypeError: x is not a function\n  at main.js'] })).report,
    );
    expect(text).toContain('- pageerror TypeError: x is not a function\n');
    expect(text).toContain(`- console.error boom ${String(CAPS.errorLines - 1)}\n- … +15 console.error (report.json)`);
    expect(text).not.toContain('boom 20');
  });

  it('footer names snap.md when the engine captured a snapshot and skips elements when not captured', () => {
    const withSnap = buildReport(sampleInput({ files: { snapshot: 'snap.md' }, captureElements: false })).report;
    expect(withSnap.elements).toBeUndefined();
    expect(renderReportMd(withSnap)).toContain('more: text.txt · snap.md · report.json');
  });
});

describe('report.json — superset of the old shapes (AC-1)', () => {
  it('omits navigationError on success and carries it as a string on a navigation failure', () => {
    const ok = buildReport(sampleInput()).report;
    expect('navigationError' in ok).toBe(false);
    expect(JSON.stringify(ok)).not.toContain('navigationError');
    const failed = buildReport(sampleInput({ steps: [], skipped: 18, navigationError: new Error('boom') })).report;
    expect(failed.navigationError).toBe('Error: boom');
    expect(failed.completed).toBe(false);
    const parsed = JSON.parse(JSON.stringify(failed));
    expect(typeof parsed.navigationError).toBe('string');
    // The gate reads `report.navigationError ?? step.error` — a string, never `null`.
    expect(parsed.navigationError ?? 'fallback').toBe('Error: boom');
  });

  it('keeps steps[].error in the `Error: …` form, one line, name kept', () => {
    expect(formatStepError(new Error('uczen widzi przycisk nauczyciela'))).toBe(
      'Error: uczen widzi przycisk nauczyciela',
    );
    expect(formatStepError('Error: uczen widzi przycisk nauczyciela')).toBe('Error: uczen widzi przycisk nauczyciela');
    expect(formatStepError('ref not found (gone) → browser-inspector snap')).toBe(
      'Error: ref not found (gone) → browser-inspector snap',
    );
    const timeout = new Error('Timeout 8000ms exceeded.\nCall log:\n  - waiting');
    timeout.name = 'TimeoutError';
    expect(formatStepError(timeout)).toBe('TimeoutError: Timeout 8000ms exceeded.');
    const { report } = buildReport(sampleInput({ steps: steps(3, 1), skipped: 15 }));
    expect(report.steps[1]).toEqual({
      index: 1,
      description: DESCRIPTIONS[1],
      ok: false,
      ms: 7,
      error: 'Error: Timeout 8000ms exceeded.',
    });
    expect(report.completed).toBe(false);
  });

  it('has every field evaluateReports() and the skryba shape read, plus timing and tabs[]', () => {
    const { report } = buildReport(
      sampleInput({
        tabs: [{ url: 'http://localhost:4300/popup', title: 'Popup', openedAt: 1 }],
        dialogs: [{ type: 'confirm', message: 'Usunąć?', action: 'dismissed' }],
      }),
    );
    const json = JSON.parse(JSON.stringify(report));
    for (const key of [
      'name',
      'startUrl',
      'finalUrl',
      'title',
      'completed',
      'steps',
      'skipped',
      'extracts',
      'verifications',
      'console',
      'pageErrors',
      'network',
      'failedRequests',
      'dialogs',
      'tabs',
      'screenshots',
      'text',
      'elements',
      'files',
      'timing',
      'engine',
    ]) {
      expect(json, key).toHaveProperty(key);
    }
    expect(json.steps[0]).toEqual({ index: 0, description: DESCRIPTIONS[0], ok: true, ms: 6 });
    expect(json.extracts['numer-zgloszenia']).toEqual({ value: 'ALM-1001', truncated: false });
    expect(json.console).toEqual({
      entries: sampleInput().console,
      total: 3,
      truncated: false,
    });
    expect(json.network).toEqual({
      total: 12,
      failed: [
        { id: 7, method: 'POST', url: 'http://localhost:4300/api/zgloszenia', status: 404, failure: 'HTTP 404' },
      ],
    });
    expect(json.failedRequests).toEqual({
      entries: [{ url: 'http://localhost:4300/api/zgloszenia', failure: 'HTTP 404' }],
      truncated: false,
    });
    expect(json.tabs).toEqual([{ url: 'http://localhost:4300/popup', title: 'Popup', openedAt: 1 }]);
    expect(json.screenshots).toEqual(['walidacja.png', 'potwierdzenie.png']);
    expect(json.text).toEqual({ content: 'Zgłoszenie serwisowe\nFormularz…', truncated: false });
    expect(json.elements.total).toBe(21);
    expect(json.files).toEqual({ elements: 'elements.md', text: 'text.txt' });
    expect(json.timing).toEqual(TIMING);
    expect(json.timing.mode).toBe('warm');
    expect(json.engine).toEqual(ENGINE);
  });

  it('applies the caps and marks them', () => {
    const { report } = buildReport(
      sampleInput({
        console: Array.from({ length: CAPS.console + 5 }, (_, i) => ({ type: 'log', text: String(i) })),
        network: Array.from({ length: CAPS.failedRequests + 1 }, (_, i) => ({
          id: i,
          method: 'GET',
          url: `http://x/${String(i)}`,
          failure: 'net::ERR',
        })),
        text: 'y'.repeat(CAPS.text + 1),
        elements: Array.from({ length: CAPS.elements + 1 }, (_, i) => ({
          kind: 'a',
          name: String(i),
          selector: `#a${String(i)}`,
        })),
      }),
    );
    expect(report.console.entries).toHaveLength(CAPS.console);
    expect(report.console.truncated).toBe(true);
    expect(report.console.total).toBe(CAPS.console + 5);
    expect(report.failedRequests.entries).toHaveLength(CAPS.failedRequests);
    expect(report.failedRequests.truncated).toBe(true);
    expect(report.text.content).toHaveLength(CAPS.text);
    expect(report.text.truncated).toBe(true);
    expect(report.elements?.entries).toHaveLength(CAPS.elements);
    expect(report.elements?.truncated).toBe(true);
  });

  it('takes the failures from the recorder, so one past the network cap is still in the report', () => {
    // The recorder caps `network` at 500 ENTRIES but keeps every failure in its own list; the
    // report used to derive the failures from the capped list, so a 500 on the 521st request
    // vanished — and `failedRequests.truncated` said the empty list was complete.
    const { report } = buildReport(
      sampleInput({
        network: Array.from({ length: 500 }, (_, i) => ({ id: i, method: 'GET', url: `http://x/${String(i)}` })),
        networkTotal: 521,
        failed: [{ id: 520, method: 'POST', url: 'http://x/api/broken', status: 500 }],
        failedTotal: 1,
      }),
    );
    expect(report.network.total).toBe(521);
    expect(report.network.failed).toEqual([
      { id: 520, method: 'POST', url: 'http://x/api/broken', status: 500, failure: 'HTTP 500' },
    ]);
    expect(report.failedRequests).toEqual({
      entries: [{ url: 'http://x/api/broken', failure: 'HTTP 500' }],
      truncated: false,
    });
    const md = renderReportMd(report);
    expect(md).toContain('net 521 (1 failed)');
    expect(md).toContain('- POST http://x/api/broken → 500');
  });

  it('failedRequests.truncated counts the failures the recorder saw, not the ones that fit', () => {
    const { report } = buildReport(
      sampleInput({
        failed: Array.from({ length: CAPS.failedRequests }, (_, i) => ({
          id: i,
          method: 'GET',
          url: `http://x/${String(i)}`,
          failure: 'net::ERR',
        })),
        failedTotal: 150,
      }),
    );
    expect(report.failedRequests.entries).toHaveLength(CAPS.failedRequests);
    expect(report.failedRequests.truncated).toBe(true);
  });
});

describe('elements.md', () => {
  it('lists kind, name, href, disabled and the selector, one line each', () => {
    const md = renderElementsMd({
      name: 'sklep',
      elements: {
        entries: [
          { kind: 'a', name: 'Katalog\nlinia', href: '/katalog', selector: '#nav-catalog' },
          { kind: 'button', name: 'Wyślij', disabled: true, selector: '[data-testid="submit"]' },
        ],
        total: 2,
        truncated: false,
      },
    });
    expect(md).toBe(
      '# elements — sklep (2)\n\n1. a "Katalog" → /katalog #nav-catalog\n2. button "Wyślij" (disabled) [data-testid="submit"]\n',
    );
    expect(renderElementsMd({ name: 'pusty' })).toBe('# elements — pusty (0)\n\n(none)\n');
  });
});

describe('manifests', () => {
  const ok = buildReport(sampleInput()).report;
  const failed = buildReport(sampleInput({ steps: steps(10, 9), skipped: 6 })).report;

  it('run-level: DESIGN §5 shape, stamp from the clock in Europe/Warsaw when not given', () => {
    const manifest = buildManifest(
      { config: 'D:/x/read.config.json', version: '0.1.0', timing: { mode: 'warm', clientMs: 72 } },
      [
        { name: ok.name, report: ok, dir: 'zgloszenie-serwisowe' },
        { name: 'wizard', report: failed, dir: 'wizard' },
      ],
    );
    expect(manifest.stamp).toMatch(STAMP_PATTERN);
    expect(manifest.config).toBe('D:/x/read.config.json');
    expect(manifest.version).toBe('0.1.0');
    expect(manifest.timing).toEqual({ mode: 'warm', clientMs: 72 });
    expect(manifest.snapshots[0]).toEqual({
      name: 'zgloszenie-serwisowe',
      completed: true,
      dir: 'zgloszenie-serwisowe',
      ms: 446,
      ctx: 'reused',
      tab: 'kept',
      lane: 0,
      queuedMs: 0,
      scrubMs: 14,
      cacheHits: 0,
    });
    expect(manifest.snapshots[1].failure).toBe(`step 10 "${DESCRIPTIONS[9]}" — Error: Timeout 8000ms exceeded.`);
    expect(
      buildManifest(
        { stamp: '2026-09-01_10-30', config: 'c', version: 'v', timing: { mode: 'no-daemon', clientMs: 1 } },
        [],
      ).stamp,
    ).toBe('2026-09-01_10-30');
  });

  it('per snapshot: the read-runtime envelope plus type/url/completed/screenshots/timing', () => {
    const manifest = buildSnapshotManifest(ok, {
      type: 'flow',
      url: 'http://localhost:4300/',
      stamp: '2026-09-01_10-30',
      version: '0.1.0',
      startedAt: '2026-09-01T08:30:00.000Z',
    });
    expect(manifest).toMatchObject({
      snapshot: 'zgloszenie-serwisowe',
      name: 'zgloszenie-serwisowe',
      source: 'browser-inspector',
      stamp: '2026-09-01_10-30',
      runStartedAt: '2026-09-01T08:30:00.000Z',
      render: ['json', 'markdown'],
      tooling: { script: 'browser-inspector', version: '0.1.0' },
      type: 'flow',
      url: 'http://localhost:4300/',
      completed: true,
      screenshots: ['walidacja.png', 'potwierdzenie.png'],
      timing: TIMING,
    });
    expect('failure' in manifest).toBe(false);
    expect(failureOf(failed)).toContain('step 10');
    expect(failureOf(ok)).toBeUndefined();
  });
});

describe('writeArtifacts', () => {
  it('writes the text artifacts and the queued screenshots BEFORE report.json, then md and manifest', async () => {
    const dir = path.join(mkdtempSync(path.join(os.tmpdir(), 'browser-inspector-wp4-')), 'zgloszenie-serwisowe');
    const { report, files } = buildReport(
      sampleInput({ extracts: { long: 'z'.repeat(CAPS.extract + 10) }, files: { snapshot: 'snap.md' } }),
    );
    let shotLanded = false;
    let pendingLanded = false;
    const shot = new Promise((resolve) => {
      setTimeout(() => {
        shotLanded = true;
        resolve(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
      }, 20);
    });
    const pending = new Promise((resolve) => {
      setTimeout(() => {
        pendingLanded = true;
        resolve(undefined);
      }, 30);
    });
    const { written, ms } = await writeArtifacts(
      dir,
      report,
      { ...files, 'snap.md': 'e1 button "x"', 'walidacja.png': shot },
      {
        pending: [pending],
        manifest: { type: 'flow', url: 'http://localhost:4300/', stamp: '2026-09-01_10-30', version: '0.1.0' },
        redact: (text) => text.replaceAll('serwisowe', 'REDACTED'),
      },
    );
    expect(shotLanded && pendingLanded).toBe(true);
    expect(ms).toBeGreaterThanOrEqual(0);
    expect(written.slice(-3)).toEqual(['report.json', 'report.md', '_manifest.json']);
    expect(new Set(readdirSync(dir))).toEqual(
      new Set([
        'elements.md',
        'text.txt',
        'values',
        'snap.md',
        'walidacja.png',
        'report.json',
        'report.md',
        '_manifest.json',
      ]),
    );
    expect(readFileSync(path.join(dir, 'values', 'long.txt'), 'utf8')).toBe('z'.repeat(CAPS.extract + 10));
    expect(readFileSync(path.join(dir, 'walidacja.png'))).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const json = JSON.parse(readFileSync(path.join(dir, 'report.json'), 'utf8'));
    expect(json.name).toBe('zgloszenie-REDACTED');
    expect(json.completed).toBe(true);
    expect(readFileSync(path.join(dir, 'report.md'), 'utf8').startsWith('# zgloszenie-REDACTED — OK 18/18')).toBe(true);
    const manifest = JSON.parse(readFileSync(path.join(dir, '_manifest.json'), 'utf8'));
    expect(manifest).toMatchObject({
      snapshot: 'zgloszenie-REDACTED',
      stamp: '2026-09-01_10-30',
      completed: true,
      type: 'flow',
    });
  });

  it('derives elements.md, text.txt and values/*.txt from a Report the engine assembled itself', async () => {
    // `runFlow` (WP2) returns a finished Report with `files: {}` — the text artifacts are this module's job.
    const dir = path.join(mkdtempSync(path.join(os.tmpdir(), 'browser-inspector-wp4-')), 'engine-report');
    /** @type {import('../src/report.mjs').BiReport} */
    const report = {
      name: 'engine',
      startUrl: 'http://localhost:4300/',
      finalUrl: 'http://localhost:4300/',
      completed: true,
      steps: [],
      skipped: 0,
      extracts: {
        capped: { value: 'q'.repeat(CAPS.extract), truncated: true },
        short: { value: 'x', truncated: false },
      },
      verifications: [],
      console: { entries: [], total: 0, truncated: false },
      pageErrors: [],
      network: { total: 0, failed: [] },
      failedRequests: { entries: [], truncated: false },
      dialogs: [],
      tabs: [],
      screenshots: ['page.png'],
      text: { content: 'Strona', truncated: false },
      elements: { entries: [{ kind: 'button', name: 'Go', selector: '#go' }], total: 1, truncated: false },
      files: { koszyk: 'koszyk.png' },
      timing: TIMING,
      engine: ENGINE,
    };
    const { written } = await writeArtifacts(dir, report);
    expect(written).toEqual(expect.arrayContaining(['elements.md', 'text.txt', 'values/capped.txt']));
    expect(readFileSync(path.join(dir, 'elements.md'), 'utf8')).toBe('# elements — engine (1)\n\n1. button "Go" #go\n');
    expect(readFileSync(path.join(dir, 'text.txt'), 'utf8')).toBe('Strona');
    expect(readFileSync(path.join(dir, 'values', 'capped.txt'), 'utf8')).toBe('q'.repeat(CAPS.extract));
    const json = JSON.parse(readFileSync(path.join(dir, 'report.json'), 'utf8'));
    expect(json.files).toEqual({ koszyk: 'koszyk.png', elements: 'elements.md', text: 'text.txt' });
    expect(readFileSync(path.join(dir, 'report.md'), 'utf8')).toContain(
      'more: elements.md (1) · text.txt · report.json',
    );

    const bare = path.join(dir, 'no-derive');
    await writeArtifacts(bare, { ...report, files: {} }, {}, { derive: false });
    expect(readdirSync(bare)).toEqual(['report.json', 'report.md']);
  });

  it('honours render: ["json"] and writes no markdown', async () => {
    const dir = path.join(mkdtempSync(path.join(os.tmpdir(), 'browser-inspector-wp4-')), 'only-json');
    const { report, files } = buildReport(sampleInput());
    const { written } = await writeArtifacts(dir, report, files, { render: ['json'] });
    expect(written).toContain('report.json');
    expect(written).not.toContain('report.md');
    expect(readdirSync(dir)).not.toContain('_manifest.json');
  });
});

describe('a cap that bites is marked, whatever caused it', () => {
  it('elements.truncated says "partial" when the frames were counted but not listed', () => {
    // `pageEvidence` counts the elements of child frames and lists only the main document, so the
    // map is incomplete far below `CAPS.elements` — recomputing the flag from the cap alone said
    // `false` for every embedded app (DESIGN.md §5.1).
    const { report } = buildReport(
      sampleInput({
        elements: [{ kind: 'button', name: 'Przycisk rodzica', selector: '#parent-btn' }],
        elementsTotal: 3,
      }),
    );
    expect(report.elements).toMatchObject({ total: 3, truncated: true });
    expect(renderElementsMd(report)).toContain('# elements — zgloszenie-serwisowe (3, listed 1)');
  });

  it('text.truncated comes from the page, which already cut at the cap', () => {
    const { report } = buildReport(
      sampleInput({ text: 'y'.repeat(CAPS.text), textTruncated: true, textLength: 200_000 }),
    );
    expect(report.text).toMatchObject({ truncated: true, length: 200_000 });
    expect(renderReportMd(report)).toContain(`text.txt (${String(CAPS.text)} of 200000)`);
  });

  it('a text that fits is not marked and carries no length', () => {
    const { report } = buildReport(sampleInput());
    expect(report.text).toEqual({ content: 'Zgłoszenie serwisowe\nFormularz…', truncated: false });
  });
});
