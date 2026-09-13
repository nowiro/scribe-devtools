/**
 * Tests for the deterministic parts of `read-browser-inspector.ts`:
 *   - config schema — defaults, strictness, the fill-step value/valueFromEnv rule
 *   - `describeStep` — the report line must never echo a fill VALUE
 *   - `resolveFillValue` — env resolution and its readable failure
 *   - `renderReportMarkdown` — pure renderers
 *
 * The browser paths (launch, navigation, capture) are exercised end to end by
 * hand against a file:// fixture, not here — a unit suite that launches Chrome
 * would tie `npm run verify` to whichever browsers a machine happens to carry.
 */
import { describe, expect, it } from 'vitest';

import {
  describeStep,
  ReadConfig,
  renderReportMarkdown,
  resolveFillValue,
  type Step,
  type WebReport,
} from './read-browser-inspector.js';

const URL_OK = 'https://example.com/app';

describe('ReadConfig (browser-inspector)', () => {
  it('fills the defaults a minimal page snapshot leaves out', () => {
    const parsed = ReadConfig.parse({ snapshots: [{ name: 'home', type: 'page', url: URL_OK }] });
    expect(parsed.outputDir).toBe('./.scribe/browser-inspector');
    expect(parsed.browser).toEqual({ headless: true });
    const [snap] = parsed.snapshots;
    if (!snap) throw new Error('expected snapshot');
    expect(snap.viewport).toEqual({ width: 1280, height: 720 });
    expect(snap.navTimeoutMs).toBe(30_000);
    expect(snap.waitUntil).toBe('load');
    expect(snap.render).toEqual(['json', 'markdown']);
  });

  it('rejects an unknown key rather than dropping it in silence', () => {
    expect(() => ReadConfig.parse({ snapshots: [{ name: 'h', type: 'page', url: URL_OK, viewPort: {} }] })).toThrow(
      /viewPort/,
    );
    expect(() =>
      ReadConfig.parse({ outputDirs: './x', snapshots: [{ name: 'h', type: 'page', url: URL_OK }] }),
    ).toThrow(/outputDirs/);
  });

  it('rejects an unknown key inside a step', () => {
    expect(() =>
      ReadConfig.parse({
        snapshots: [{ name: 'f', type: 'flow', url: URL_OK, steps: [{ do: 'click', selector: '#a', force: true }] }],
      }),
    ).toThrow(/force/);
  });

  it('rejects a relative URL — the browser needs an absolute one', () => {
    expect(() => ReadConfig.parse({ snapshots: [{ name: 'h', type: 'page', url: '/dashboard' }] })).toThrow(
      /absolute URL/,
    );
  });

  it('accepts file:// URLs — local fixtures are a first-class use case', () => {
    const parsed = ReadConfig.parse({
      snapshots: [{ name: 'fixture', type: 'page', url: 'file:///C:/tmp/fixture.html' }],
    });
    expect(parsed.snapshots[0]?.url).toMatch(/^file:/);
  });

  it('a fill step needs exactly one of value / valueFromEnv, and the error points at the step', () => {
    const flow = (step: Record<string, unknown>) => ({
      snapshots: [{ name: 'f', type: 'flow', url: URL_OK, steps: [{ do: 'goto', url: URL_OK }, step] }],
    });
    const neither = ReadConfig.safeParse(flow({ do: 'fill', selector: '#user' }));
    expect(neither.success).toBe(false);
    if (!neither.success) {
      expect(neither.error.issues[0]?.path).toEqual(['snapshots', 0, 'steps', 1]);
      expect(neither.error.issues[0]?.message).toContain('exactly one');
    }
    const both = ReadConfig.safeParse(flow({ do: 'fill', selector: '#user', value: 'a', valueFromEnv: 'B' }));
    expect(both.success).toBe(false);
    expect(ReadConfig.safeParse(flow({ do: 'fill', selector: '#user', value: 'a' })).success).toBe(true);
    expect(ReadConfig.safeParse(flow({ do: 'fill', selector: '#user', valueFromEnv: 'B' })).success).toBe(true);
  });

  it('rejects a screenshot name that could not be a safe basename', () => {
    expect(() =>
      ReadConfig.parse({
        snapshots: [{ name: 'f', type: 'flow', url: URL_OK, steps: [{ do: 'screenshot', name: '../evil' }] }],
      }),
    ).toThrow();
  });

  it('caps a flow at 50 steps', () => {
    const steps = Array.from({ length: 51 }, () => ({ do: 'press', key: 'Tab' }));
    expect(() => ReadConfig.parse({ snapshots: [{ name: 'f', type: 'flow', url: URL_OK, steps }] })).toThrow();
  });

  it('parses the browser-automation steps: hover, select, scroll, wait, extract, evaluate', () => {
    const parsed = ReadConfig.parse({
      snapshots: [
        {
          name: 'f',
          type: 'flow',
          url: URL_OK,
          steps: [
            { do: 'hover', selector: '#menu' },
            { do: 'select', selector: '#country', value: 'PL' },
            { do: 'scroll', to: 'bottom' },
            { do: 'scroll', selector: '#footer' },
            { do: 'wait', ms: 250 },
            { do: 'extract', name: 'total', selector: '[data-testid=total]' },
            { do: 'evaluate', name: 'rows', expression: 'document.querySelectorAll("tr").length' },
          ],
        },
      ],
    });
    expect(parsed.snapshots[0]).toMatchObject({ captureElements: true });
  });

  it('a scroll step needs exactly one of selector / to, and the error points at the step', () => {
    const flow = (step: Record<string, unknown>) => ({
      snapshots: [{ name: 'f', type: 'flow', url: URL_OK, steps: [step] }],
    });
    const neither = ReadConfig.safeParse(flow({ do: 'scroll' }));
    expect(neither.success).toBe(false);
    if (!neither.success) expect(neither.error.issues[0]?.path).toEqual(['snapshots', 0, 'steps', 0]);
    expect(ReadConfig.safeParse(flow({ do: 'scroll', selector: '#x', to: 'top' })).success).toBe(false);
  });

  it('an extract/evaluate name must be a safe basename-shaped key', () => {
    expect(
      ReadConfig.safeParse({
        snapshots: [
          { name: 'f', type: 'flow', url: URL_OK, steps: [{ do: 'extract', name: '../evil', selector: '#x' }] },
        ],
      }).success,
    ).toBe(false);
  });
});

describe('describeStep', () => {
  it('never echoes a fill value — literal or resolved', () => {
    const literal: Step = { do: 'fill', selector: '#password', value: 'hunter2' };
    const fromEnv: Step = { do: 'fill', selector: '#password', valueFromEnv: 'APP_PASSWORD' };
    expect(describeStep(literal)).not.toContain('hunter2');
    expect(describeStep(literal)).toContain('(literal)');
    // Naming the VARIABLE is fine — that is how the reader finds the source.
    expect(describeStep(fromEnv)).toContain('APP_PASSWORD');
  });

  it('describes the automation steps in one line each; evaluate names the capture, not the code', () => {
    expect(describeStep({ do: 'hover', selector: '#menu' })).toBe('hover #menu');
    expect(describeStep({ do: 'select', selector: '#c', value: 'PL' })).toBe('select #c = PL');
    expect(describeStep({ do: 'scroll', to: 'bottom' })).toBe('scroll bottom');
    expect(describeStep({ do: 'wait', ms: 250 })).toBe('wait 250ms');
    expect(describeStep({ do: 'extract', name: 'total', selector: '#t' })).toBe('extract total ← #t');
    expect(describeStep({ do: 'evaluate', name: 'rows', expression: 'document.title' })).toBe('evaluate rows');
  });
});

describe('resolveFillValue', () => {
  it('reads the named environment variable and names it when missing', () => {
    process.env['WEB_SPEC_PROBE'] = 'secret-value';
    try {
      expect(resolveFillValue({ valueFromEnv: 'WEB_SPEC_PROBE' })).toBe('secret-value');
    } finally {
      delete process.env['WEB_SPEC_PROBE'];
    }
    expect(() => resolveFillValue({ valueFromEnv: 'WEB_SPEC_ABSENT' })).toThrow(/WEB_SPEC_ABSENT/);
  });
});

describe('renderReportMarkdown', () => {
  const base: WebReport = {
    name: 'home',
    startUrl: 'https://example.com',
    finalUrl: 'https://example.com/dash',
    title: 'Dashboard',
    completed: true,
    console: { entries: [{ type: 'error', text: 'boom' }], total: 1, truncated: false },
    pageErrors: [],
    failedRequests: { entries: [], truncated: false },
    text: { content: 'Hello world', truncated: false },
    screenshots: ['page.png'],
  };

  it('leads with the title and shows the redirect', () => {
    const md = renderReportMarkdown(base);
    expect(md.split('\n')[0]).toBe('# home — Dashboard');
    expect(md).toContain('https://example.com → https://example.com/dash');
  });

  it('surfaces console errors in their own section', () => {
    expect(renderReportMarkdown(base)).toContain('- console.error: boom');
  });

  it('says plainly when the run did not complete', () => {
    const md = renderReportMarkdown({ ...base, completed: false, navigationError: 'net::ERR_CONNECTION_REFUSED' });
    expect(md).toContain('**Completed**: NO — net::ERR_CONNECTION_REFUSED');
  });

  it('marks a failing step and keeps the later ones absent, not invented', () => {
    const md = renderReportMarkdown({
      ...base,
      completed: false,
      steps: [
        { index: 0, description: 'click #btn', ok: true },
        { index: 1, description: 'waitFor #x (visible)', ok: false, error: 'Timeout 1500ms exceeded.' },
      ],
    });
    expect(md).toContain('ok   1. click #btn');
    expect(md).toContain('FAIL  2. waitFor #x (visible) — Timeout 1500ms exceeded.');
  });

  it('renders named extracts as their own fenced sections', () => {
    const md = renderReportMarkdown({
      ...base,
      extracts: { total: { value: '42,50 zł', truncated: false }, rows: { value: '17', truncated: true } },
    });
    expect(md).toContain('### total');
    expect(md).toContain('42,50 zł');
    expect(md).toContain('### rows (first 5000 chars)');
  });

  it('renders the interactive-elements map as a table, with the cap said', () => {
    const md = renderReportMarkdown({
      ...base,
      elements: {
        entries: [
          { kind: 'button', name: 'Zapisz', selector: '[data-testid="save"]' },
          { kind: 'a', name: 'Pomoc', selector: '#help', href: '/help' },
          { kind: 'input[password]', name: 'Hasło', selector: 'input[name="pass"]', disabled: true },
        ],
        total: 250,
        truncated: true,
      },
    });
    expect(md).toContain('## Interactive elements (250, listed 100)');
    expect(md).toContain('| `button` | Zapisz | `[data-testid="save"]` |');
    expect(md).toContain('Pomoc → /help');
    expect(md).toContain('(disabled)');
  });
});
