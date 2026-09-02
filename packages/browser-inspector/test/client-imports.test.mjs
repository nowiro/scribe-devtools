// The client's module graph (DESIGN.md §2.4, AC-13): `browser-inspector help` and a session command without a
// keeper must never resolve playwright-core, engine.mjs or steps.run.mjs. Without this guard the
// start of the client grows from 48 to 300 ms with no test going red — and the thesis is gone.
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { runBrowserInspector, cleanup, makeEnv } from './fixtures/keeper-harness.mjs';

// A file URL, not a path: on Windows `--import=C:...` reads `C:` as a URL scheme and Node exits 1.
const HOOK = new URL('./hooks/trace-loads.mjs', import.meta.url).href;
const FORBIDDEN = [/playwright-core/u, /\/src\/engine\.mjs$/u, /\/src\/steps\.run\.mjs$/u];

/** @type {ReturnType<typeof makeEnv>[]} */
const harnesses = [];
afterEach(() => {
  for (const h of harnesses.splice(0)) cleanup(h);
});

/** Run browser-inspector under the trace hook and return the resolved module URLs. */
async function trace(args, overrides = {}) {
  const h = makeEnv(overrides);
  harnesses.push(h);
  const file = path.join(h.tmpdir, 'loads.txt');
  h.env.BROWSER_INSPECTOR_TRACE_LOADS = file;
  const result = await runBrowserInspector(args, h, { nodeArgs: [`--import=${HOOK}`] });
  const urls = fs.existsSync(file)
    ? fs
        .readFileSync(file, 'utf8')
        .split('\n')
        .filter((l) => l !== '')
    : [];
  return { result, urls };
}

describe('client module graph', () => {
  it('`browser-inspector help` loads the parser and the table, nothing that carries a browser', async () => {
    const { result, urls } = await trace(['help']);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('browser-inspector <config.json>');
    expect(urls.length).toBeGreaterThan(0);
    expect(urls.some((u) => /\/src\/steps\.schema\.mjs$/u.test(u))).toBe(true);
    // `browser-inspector help` needs the parser only — the client module with node:net stays unloaded.
    expect(urls.some((u) => /\/src\/client\.mjs$/u.test(u))).toBe(false);
    for (const pattern of FORBIDDEN) expect(urls.filter((u) => pattern.test(u))).toEqual([]);
  }, 20000);

  it('a session command without a keeper goes through the client and still never touches the engine', async () => {
    const { result, urls } = await trace(['click', 'e5'], { BROWSER_INSPECTOR_DAEMON: '0' });
    expect(result.code).toBe(2);
    expect(result.stdout).toMatch(/^FAIL keeper unavailable/u);
    expect(urls.some((u) => /\/src\/client\.mjs$/u.test(u))).toBe(true);
    expect(urls.some((u) => /\/src\/keeper\.mjs$/u.test(u))).toBe(false);
    for (const pattern of FORBIDDEN) expect(urls.filter((u) => pattern.test(u))).toEqual([]);
  }, 20000);

  it('a lint-config run (config loader, no keeper) stays engine-free too', async () => {
    const h = makeEnv();
    harnesses.push(h);
    const config = path.join(h.cwd, 'c.json');
    fs.writeFileSync(
      config,
      JSON.stringify({ snapshots: [{ name: 'a', type: 'page', url: 'http://localhost:4521/' }] }),
    );
    const file = path.join(h.tmpdir, 'loads.txt');
    h.env.BROWSER_INSPECTOR_TRACE_LOADS = file;
    const result = await runBrowserInspector(['lint-config', config], h, { nodeArgs: [`--import=${HOOK}`] });
    expect(result.code).toBe(0);
    const urls = fs.readFileSync(file, 'utf8').split('\n');
    for (const pattern of FORBIDDEN) expect(urls.filter((u) => pattern.test(u))).toEqual([]);
  }, 20000);
});
