// Secrets and auth through the keeper (DESIGN.md §2.4, §2.6): no value in the log or the journal, a
// login executed once before the lanes, and a secret that stays masked for the whole session.

import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  runBrowserInspector,
  cleanup,
  fakeLog,
  keeperLog,
  makeEnv,
  stopKeeper,
  writeConfig,
  AUTH,
} from './fixtures/keeper-harness.mjs';

/** @type {ReturnType<typeof makeEnv>[]} */
const harnesses = [];
const fresh = (overrides = {}) => {
  const h = makeEnv(overrides);
  harnesses.push(h);
  return h;
};

afterEach(async () => {
  for (const h of harnesses.splice(0)) {
    await stopKeeper(h);
    cleanup(h);
  }
});

describe('secrets', () => {
  it('never land in the keeper log or the session journal (fill --env, @{NAME}, form)', async () => {
    const secret = `hunter2-${Math.random().toString(36).slice(2)}`;
    const h = fresh({ SECRET_X: secret, OTHER_Y: `${secret}-two` });
    const out = path.join(h.tmpdir, 'out');
    await runBrowserInspector(['open', 'http://localhost:4521/', '--session', 's', '--out', out], h);
    const fill = await runBrowserInspector(['fill', 'e3', '@{SECRET_X}', '--session', 's'], h);
    expect(fill.code).toBe(0);
    expect(fill.stdout).not.toContain(secret);
    const env = await runBrowserInspector(['fill', 'e3', '--env', 'OTHER_Y', '--session', 's'], h);
    expect(env.code).toBe(0);
    const form = await runBrowserInspector(['form', 'e1=@{SECRET_X}', 'e2=plain', '--session', 's'], h);
    expect(form.code).toBe(0);
    const journal = fs.readFileSync(path.join(out, 'session', 's', 'journal.jsonl'), 'utf8');
    expect(journal).not.toContain(secret);
    expect(journal).toContain('***');
    expect(journal).toContain('plain');
    expect(keeperLog(h)).not.toContain(secret);
    // The fake echoes the values into report.json through the keeper's redact — a batch too.
    const config = writeConfig(h, [{ name: 'b', steps: [{ do: 'fill', selector: '#p', valueFromEnv: 'SECRET_X' }] }]);
    const batch = await runBrowserInspector([config, '--stamp', '2026-09-01_11-00'], h);
    expect(batch.code).toBe(0);
    const report = fs.readFileSync(path.join(h.cwd, 'out', '2026-09-01_11-00', 'b', 'report.json'), 'utf8');
    expect(report).not.toContain(secret);
    expect(report).toContain('snapshots[0].steps[0].value');
    expect(keeperLog(h)).not.toContain(secret);
    expect(batch.stdout).not.toContain(secret);
  }, 30000);
});

describe('auth in a config is executed, not only validated', () => {
  it('a fresh state file is reused and handed to every snapshot except `auth: false`', async () => {
    const h = fresh({ APP_PASS: 'wonderland-42' });
    const config = writeConfig(h, [{ name: 'pulpit' }, { name: 'gosc', auth: false }], { auth: AUTH });
    const state = path.join(h.cwd, '.scribe-devtools', 'auth.json');
    fs.mkdirSync(path.dirname(state), { recursive: true });
    fs.writeFileSync(state, JSON.stringify({ cookies: [], origins: [] }));
    const run = await runBrowserInspector([config, '--stamp', '2026-09-02_12-00'], h);
    expect(run.code).toBe(0);
    expect(run.lines.at(-1)).toMatch(/^ok 2\/2 completed/u);
    const flows = fakeLog(h).filter((e) => e.event === 'runFlow');
    expect(flows.map((f) => [f.name, f.storageState])).toEqual([
      ['pulpit', state],
      ['gosc', undefined],
    ]);
    expect(keeperLog(h)).toContain('auth: session from file');
    expect(keeperLog(h)).not.toContain('wonderland-42');
  }, 20000);

  it('a login that cannot run is FAIL E_AUTH with exit 2 — no snapshot runs anonymously', async () => {
    const h = fresh({ APP_PASS: 'wonderland-42' });
    const config = writeConfig(h, [{ name: 'pulpit' }], { auth: AUTH });
    const run = await runBrowserInspector([config, '--stamp', '2026-09-02_12-01'], h);
    expect(run.code).toBe(2);
    expect(run.lines[0]).toMatch(/^FAIL E_AUTH: /u);
    expect(run.stdout).not.toContain('wonderland-42');
    expect(fakeLog(h).filter((e) => e.event === 'runFlow')).toHaveLength(0);
    expect(fs.existsSync(path.join(h.cwd, 'out', '2026-09-02_12-01', '_manifest.json'))).toBe(false);
  }, 20000);
});

describe('secrets are per session', () => {
  it('a value filled with @{NAME} is still *** in a later `get` that carries no secrets', async () => {
    const secret = `hunter2-${Math.random().toString(36).slice(2)}`;
    const h = fresh({ SECRET_X: secret });
    await runBrowserInspector(['open', 'http://localhost:4521/', '--session', 's'], h);
    await runBrowserInspector(['fill', 'e1', '@{SECRET_X}', '--session', 's'], h);
    const get = await runBrowserInspector(['get', 'e1', '--value', '--session', 's'], h);
    expect(get.code).toBe(0);
    expect(get.lines[0]).toBe('ok get e1 · ***');
    expect(get.stdout).not.toContain(secret);
  }, 20000);
});
