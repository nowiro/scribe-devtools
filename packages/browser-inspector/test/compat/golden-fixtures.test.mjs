// golden-fixtures.test.mjs — the gate `fixtures/snapshots/generate.mjs` did not have before this
// file existed.
//
// The four committed fixtures (`bookstore.ai.yml`, `bookstore.boxes.yml`, `walk.json`,
// `wizard.ai.yml`) are what `test/snapshot.test.mjs` reads as ground truth for the aria grammar and
// the box-join. They were written by `generate.mjs`, and `generate.mjs` ALWAYS overwrote them — so
// a `playwright-core` bump that changed the grammar (the six facts in `docs/DESIGN.md:27` are all
// specific to 1.62.1; two of them — `ariaSnapshotWithRefs`, `ariaSnapshotForFrame` — are already
// gone in the `1.63.0-alpha` tag) would repaint the golden files instead of failing anything, and
// `snapshot.test.mjs` would stay green through the exact drift it exists to catch.
//
// This spawns `generate.mjs --check`: it renders the same four artefacts against the REAL
// app-factory builds and the installed playwright-core, and reports a mismatch instead of writing
// one. If it ever finds one, the fix is `node fixtures/snapshots/generate.mjs` (no `--check`) after
// reviewing the diff — the new content is a claim about what the browser renders NOW, not
// automatically the truth.
//
// Needs the app-factory builds next to this repository (`../app-factory/dist/apps/*/browser`, or
// `APP_FACTORY_DIR`) and a Chrome/Edge — the same dependency `smoke-gate.test.mjs` has, checked the
// same way: without them the test skips and says why, rather than failing on an environment gap.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const PACKAGE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const REPO_ROOT = path.resolve(PACKAGE_DIR, '..', '..');
const APP_FACTORY = path.resolve(process.env.APP_FACTORY_DIR ?? path.join(REPO_ROOT, '..', 'app-factory'));
const GENERATE = path.join(PACKAGE_DIR, 'fixtures', 'snapshots', 'generate.mjs');

const APPS = ['bookstore', 'business-wizard'];
const buildsPresent = APPS.every((app) =>
  existsSync(path.join(APP_FACTORY, 'dist', 'apps', app, 'browser', 'index.html')),
);
const skipSmoke =
  process.env.BROWSER_INSPECTOR_SKIP_SMOKE === '1' || process.env.BROWSER_INSPECTOR_SKIP_SMOKE === 'true';
const skip = skipSmoke || !buildsPresent;
if (!buildsPresent && !skipSmoke) {
  console.warn(`[golden-fixtures] app-factory builds not found under ${APP_FACTORY}/dist/apps — check skipped`);
}

describe.skipIf(skip)('compat: golden snapshot fixtures agree with the installed playwright-core', () => {
  it('generate.mjs --check reports no drift', () => {
    const result = spawnSync(
      process.execPath,
      [GENERATE, '--apps', path.join(APP_FACTORY, 'dist', 'apps'), '--check'],
      {
        cwd: PACKAGE_DIR,
        encoding: 'utf8',
        shell: false,
        windowsHide: true,
        timeout: 60_000,
      },
    );
    expect(result.status, `stdout:\n${result.stdout}\n\nstderr:\n${result.stderr}`).toBe(0);
    expect(result.stdout).toContain('ok golden fixtures: 4/4');
  }, 60_000);
});
