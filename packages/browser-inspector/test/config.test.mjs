// The config loader is the drop-in guarantee: the app-factory config parses UNCHANGED (fixture),
// a secret literal in the login flow is refused, a ref before any snapshot is refused, and every
// error names `snapshots[i].steps[j]` so the author fixes the file in one round.
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { ConfigError, DEFAULTS, lintConfig, loadConfig, parseConfig } from '../src/config.mjs';

const FIXTURE = fileURLToPath(new URL('../fixtures/app-factory.config.json', import.meta.url));
const raw = () => JSON.parse(readFileSync(FIXTURE, 'utf8'));

/** @param {() => unknown} fn */
function errorsOf(fn) {
  try {
    fn();
  } catch (error) {
    if (error instanceof ConfigError) return error.errors;
    throw error;
  }
  throw new Error('expected a ConfigError');
}

/** @param {any[]} steps @param {Record<string, any>} [extra] */
const flow = (steps, extra = {}) => ({
  snapshots: [{ name: 'f', type: 'flow', url: 'http://localhost:4300/', steps, ...extra }],
});

describe('app-factory fixture', () => {
  it('parses unchanged: 6 snapshots, steps kept verbatim, outputDir relative to the config file', () => {
    const config = loadConfig(FIXTURE, os.tmpdir());
    const original = raw();
    expect(config.snapshots).toHaveLength(6);
    expect(config.snapshots.map((s) => s.name)).toEqual(original.snapshots.map((s) => s.name));
    original.snapshots.forEach((snapshot, i) => {
      if (snapshot.steps) expect(config.snapshots[i].steps).toEqual(snapshot.steps);
      expect(config.snapshots[i].url).toBe(snapshot.url);
      expect(config.snapshots[i].waitUntil).toBe(snapshot.waitUntil ?? 'load');
    });
    expect(config.outputDir.replaceAll('\\', '/')).toBe(
      path.resolve(path.dirname(FIXTURE), './.scribe-devtools/browser-inspector').replaceAll('\\', '/'),
    );
    expect(config.configPath.replaceAll('\\', '/')).toBe(FIXTURE.replaceAll('\\', '/'));
  });

  it('applies the documented defaults without touching what the author wrote', () => {
    const config = loadConfig(FIXTURE);
    const page = config.snapshots[0];
    expect(page.type).toBe('page');
    expect(page.fullPage).toBe(true);
    expect(page.viewport).toEqual({ width: 1280, height: 720 });
    expect(page.isolation).toBe('reuse');
    expect(page.captureElements).toBe(true);
    expect(page.captureSnapshot).toBe(false);
    expect(page.captureBodies).toBe(true);
    expect(page.dialogs).toBe('dismiss');
    expect(page.finalScreenshot).toBe('auto');
    expect(page.settleMs).toBe(2000);
    expect(page.navTimeoutMs).toBe(30_000);
    expect(config.snapshots[2].stepTimeoutMs).toBe(8000);
    expect(config.snapshots[3].stepTimeoutMs).toBe(DEFAULTS.snapshot.stepTimeoutMs);
    expect(config.parallel).toBe(1);
    expect(config.browser).toEqual({ headless: true, fastHeadless: true, motion: 'no-preference' });
    expect(config.auth).toBeUndefined();
  });

  it('lint-config proposes exactly the three migrations of DESIGN.md §3.4', () => {
    const { lines, findings } = lintConfig(loadConfig(FIXTURE));
    expect(lines).toEqual([
      '4× waitUntil "networkidle" → "settled" (−500…−1900 ms każdy; sonda: 666–2056 ms)',
      '7× wait ms (razem 4200 ms snu) → waitFor <selector> / wait --text',
      'parallel: 3 (6 flow → 3 lane)',
    ]);
    expect(findings.filter((f) => f.kind === 'wait-ms').map((f) => f.path)).toContain('snapshots[1].steps[2]');
    expect(lines.join('\n')).not.toMatch(/wait ms.*settled/u);
  });
});

describe('new fields (DESIGN.md §3.3 sample)', () => {
  it('accepts the documented sample config', () => {
    const config = parseConfig({
      outputDir: './.scribe-devtools/browser-inspector',
      parallel: 3,
      browser: { channel: 'chrome', headless: true, fastHeadless: true, motion: 'no-preference' },
      snapshots: [
        {
          name: 'bookstore-zakupy',
          type: 'flow',
          url: 'http://localhost:4313/',
          waitUntil: 'settled',
          isolation: 'reuse',
          finalScreenshot: 'auto',
          captureSnapshot: false,
          captureBodies: true,
          dialogs: 'dismiss',
          routes: [{ url: '**/api/recommendations', block: true }],
          stepTimeoutMs: 8000,
          steps: [
            { do: 'fill', selector: '#mat-input-0', value: 'Harry', enter: true },
            { do: 'wait', text: 'Harry Potter' },
            { do: 'click', selector: '[data-testid=card-add-to-cart]' },
            { do: 'verify', kind: 'text', selector: '[data-testid=header-cart-button]', text: '1', soft: true },
            { do: 'fill', selector: '#email', valueFromEnv: 'SHOP_EMAIL' },
            { do: 'click', selector: '[data-testid=header-cart-button]' },
            { do: 'verify', kind: 'url', url: '**/cart' },
            { do: 'snapshot', name: 'koszyk' },
            { do: 'screenshot', name: 'koszyk', fullPage: true },
            { do: 'screenshot', name: 'karta', selector: 'ais-shop-cart-line', format: 'jpeg', quality: 80 },
            { do: 'storage', kind: 'local', op: 'get', key: 'cart', name: 'koszyk-ls' },
            { do: 'pdf', name: 'koszyk' },
          ],
        },
      ],
    });
    expect(config.parallel).toBe(3);
    expect(config.snapshots[0].routes).toEqual([{ url: '**/api/recommendations', block: true }]);
  });

  it('refuses a route without an effect and a bad enum, naming the path', () => {
    const errors = errorsOf(() =>
      parseConfig(flow([{ do: 'click', selector: 'a' }], { routes: [{ url: '**/x' }], isolation: 'sometimes' })),
    );
    expect(errors.some((e) => e.startsWith('snapshots[0].routes[0]:') && /effect/u.test(e))).toBe(true);
    expect(errors.some((e) => e.startsWith('snapshots[0].isolation:') && /reuse \| fresh/u.test(e))).toBe(true);
  });
});

describe('secrets', () => {
  it('rejects a literal value in auth.login.steps — only valueFromEnv', () => {
    const errors = errorsOf(() =>
      parseConfig({
        auth: {
          storageState: './.scribe-devtools/auth.json',
          login: {
            url: 'http://localhost:4300/login',
            steps: [
              { do: 'fill', selector: '#user', valueFromEnv: 'APP_USER' },
              { do: 'fill', selector: '#pass', value: 'hunter2' },
              { do: 'click', selector: 'button[type=submit]' },
            ],
          },
        },
        snapshots: [{ name: 'p', type: 'page', url: 'http://localhost:4300/' }],
      }),
    );
    expect(errors).toEqual([
      'auth.login.steps[1]: in auth.login only "valueFromEnv" is allowed, never a literal "value"',
    ]);
  });

  it('rejects a literal secret in auth.oauth', () => {
    const errors = errorsOf(() =>
      parseConfig({
        auth: {
          storageState: 'a.json',
          oauth: {
            tokenUrl: 'http://idp/token',
            grantType: 'password',
            clientId: 'c',
            username: 'u',
            password: 'p',
            store: { origin: 'http://localhost:4300', key: 'token' },
          },
        },
        snapshots: [{ name: 'p', type: 'page', url: 'http://localhost:4300/' }],
      }),
    );
    expect(errors.join('\n')).toMatch(/passwordFromEnv/u);
  });
});

describe('refs in a batch config', () => {
  it('refuses a ref with no prior snapshot step in the same flow', () => {
    const errors = errorsOf(() => parseConfig(flow([{ do: 'click', ref: 'e12' }])));
    expect(errors).toEqual([
      'snapshots[0].steps[0].ref: ref "e12" before any "snapshot" step in this flow — the ref map is empty; add { "do": "snapshot" } first or use a selector',
    ]);
    expect(errorsOf(() => parseConfig(flow([{ do: 'drag', from: 'e1', to: '#drop' }])))[0]).toMatch(
      /steps\[0\]\.from: ref "e1"/u,
    );
    expect(errorsOf(() => parseConfig(flow([{ do: 'form', fields: [{ ref: 'e1', value: 'x' }] }])))[0]).toMatch(
      /steps\[0\]\.fields\[0\]\.ref/u,
    );
  });

  it('accepts a ref after a snapshot step', () => {
    const config = parseConfig(flow([{ do: 'snapshot' }, { do: 'click', ref: 'e12' }]));
    expect(config.snapshots[0].steps[1]).toEqual({ do: 'click', ref: 'e12' });
  });
});

describe('error paths', () => {
  it('names snapshots[i].steps[j] and collects every problem at once', () => {
    const errors = errorsOf(() =>
      parseConfig({
        snapshots: [
          { name: 'ok', type: 'page', url: 'http://localhost/' },
          {
            name: 'bad',
            type: 'flow',
            url: 'http://localhost/',
            steps: [
              { do: 'click', selector: 'a' },
              { do: 'fill', selector: '#x' },
              { do: 'clack', selector: 'a' },
              { do: 'click', selektor: 'a' },
              { do: 'screenshot', name: 'final' },
              { do: 'wait', ms: 'soon' },
            ],
          },
        ],
      }),
    );
    expect(errors).toEqual([
      'snapshots[1].steps[1]: needs one of "value" / "valueFromEnv"',
      expect.stringMatching(/^snapshots\[1\]\.steps\[2\]\.do: unknown step "clack"/u),
      expect.stringMatching(/^snapshots\[1\]\.steps\[3\]\.selektor: unknown field for "click"/u),
      expect.stringMatching(/^snapshots\[1\]\.steps\[4\]\.name: "final" is reserved/u),
      expect.stringMatching(/^snapshots\[1\]\.steps\[5\]\.ms: expected an integer/u),
    ]);
  });

  it('is strict about the top level and the snapshot shape', () => {
    expect(errorsOf(() => parseConfig({ snapshots: [], outputdir: 'x' }))).toEqual([
      'outputdir: unknown field (known: outputDir, parallel, settleMs, browser, auth, snapshots)',
      'snapshots: at least one snapshot',
    ]);
    expect(
      errorsOf(() => parseConfig({ snapshots: [{ name: 'p', type: 'page', url: 'http://x/', steps: [] }] }))[0],
    ).toMatch(/type "page" runs no steps/u);
    expect(errorsOf(() => parseConfig({ snapshots: [{ name: 'Bad Name', type: 'page', url: 'nope' }] }))).toEqual([
      'snapshots[0].name: expected a name matching [a-z0-9][a-z0-9-]* (max 64), got "Bad Name"',
      'snapshots[0].url: expected an absolute URL (http://, https://, file://), got "nope"',
    ]);
    expect(
      errorsOf(() =>
        parseConfig({
          snapshots: [
            { name: 'a', type: 'page', url: 'http://x/' },
            { name: 'a', type: 'page', url: 'http://x/' },
          ],
        }),
      )[0],
    ).toMatch(/duplicate snapshot name "a"/u);
    expect(
      errorsOf(() =>
        parseConfig({ snapshots: [{ name: 'a', type: 'flow', url: 'http://x/', steps: [{ do: 'find', text: 'x' }] }] }),
      )[0],
    ).toMatch(/session-only command/u);
    expect(
      errorsOf(() =>
        parseConfig({
          snapshots: [{ name: 'a', type: 'page', url: 'http://x/', viewport: { width: 10, height: 720 } }],
        }),
      )[0],
    ).toBe('snapshots[0].viewport.width: 200…4000');
    expect(errorsOf(() => parseConfig([]))).toEqual(['the config must be a JSON object']);
  });

  it('loadConfig turns a missing file and invalid JSON into ConfigError', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'browser-inspector-config-'));
    expect(errorsOf(() => loadConfig('missing.json', dir))[0]).toMatch(/cannot read/u);
    writeFileSync(path.join(dir, 'broken.json'), '{ "snapshots": [', 'utf8');
    expect(errorsOf(() => loadConfig('broken.json', dir))[0]).toMatch(/not valid JSON/u);
    let error;
    try {
      loadConfig('broken.json', dir);
    } catch (e) {
      error = e;
    }
    expect(/** @type {ConfigError} */ (error).code).toBe('E_CONFIG');
    expect(/** @type {ConfigError} */ (error).message).toContain('broken.json');
  });

  it('resolves outputDir relative to the config file, not the cwd', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'browser-inspector-config-'));
    const file = path.join(dir, 'nested', '..', 'read.config.json');
    writeFileSync(
      file,
      JSON.stringify({ outputDir: './out', snapshots: [{ name: 'p', type: 'page', url: 'http://x/' }] }),
    );
    const config = loadConfig(file, 'C:/somewhere/else');
    expect(config.outputDir).toBe(path.join(path.resolve(dir), 'out'));
    const absolute = parseConfig({
      outputDir: path.join(dir, 'abs'),
      snapshots: [{ name: 'p', type: 'page', url: 'http://x/' }],
    });
    expect(absolute.outputDir).toBe(path.join(dir, 'abs'));
  });
});
