// The portable build must run without `npm install` (AC-20): stage the tree exactly as
// `npm run portable` does, then execute the staged `bin/bi.mjs` from the staging directory —
// `help` (the client, no browser), `lint-config` on the staged fixture (config loading, no
// browser) and, unless BI_SKIP_SMOKE=1, one real `--no-daemon` batch on a staged fixture page
// (playwright-core resolved from the staged `node_modules`, the system Chrome/Edge). The zip
// round-trip (bsdtar / zip → unpack → `bi help`) runs too — a few seconds, and it is the
// artifact a release ships.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PORTABLE_MARKER, stagePortable, zipDirectory, zipEntries } from './portable-zip.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PACKAGE = 'packages/browser-inspector';
const skipSmoke = process.env.BI_SKIP_SMOKE === '1' || process.env.BI_SKIP_SMOKE === 'true';

/**
 * `node <staging>/packages/browser-inspector/bin/bi.mjs …` with a clean BI_* environment and the
 * keeper disabled — the unpacked zip is tested as a stranger would run it, cwd = staging root.
 * @param {string} staging
 * @param {string[]} args
 */
function runStaged(staging, args) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('BI_')));
  const result = spawnSync(process.execPath, [path.join(staging, PACKAGE, 'bin', 'bi.mjs'), ...args], {
    cwd: staging,
    env: { ...env, BI_DAEMON: '0' },
    encoding: 'utf8',
    windowsHide: true,
    timeout: 120_000,
  });
  return { code: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

describe('portable staging', () => {
  /** @type {string} */
  let staging;
  /** @type {{ version: string, playwrightVersion: string }} */
  let staged;

  beforeAll(() => {
    staging = mkdtempSync(path.join(tmpdir(), 'bi-portable-test-'));
    staged = stagePortable(REPO, staging);
  }, 60_000);

  afterAll(() => {
    if (staging) rmSync(staging, { recursive: true, force: true, maxRetries: 3 });
  });

  it('copies the runtime, the marker and the shims — never the tests', () => {
    expect(staged.playwrightVersion).toBe('1.62.1');
    expect(existsSync(path.join(staging, PACKAGE, 'bin', 'bi.mjs'))).toBe(true);
    expect(existsSync(path.join(staging, PACKAGE, 'src', 'engine.mjs'))).toBe(true);
    expect(existsSync(path.join(staging, PACKAGE, 'templates', 'flow.md'))).toBe(true);
    expect(existsSync(path.join(staging, PACKAGE, 'fixtures', 'form.html'))).toBe(true);
    expect(existsSync(path.join(staging, PACKAGE, 'test'))).toBe(false);
    expect(existsSync(path.join(staging, 'node_modules', 'playwright-core', 'package.json'))).toBe(true);
    expect(readFileSync(path.join(staging, PACKAGE, PORTABLE_MARKER), 'utf8')).toContain(staged.version);
    expect(existsSync(path.join(staging, 'bi.cmd'))).toBe(true);
    expect(existsSync(path.join(staging, 'bi'))).toBe(true);
    expect(existsSync(path.join(staging, 'README-PORTABLE.md'))).toBe(true);
  });

  it('`node packages/browser-inspector/bin/bi.mjs help` runs from the staged tree', () => {
    const { code, stdout, stderr } = runStaged(staging, ['help']);
    expect(stderr).toBe('');
    expect(code).toBe(0);
    expect(stdout).toContain('bi <config.json>');
    expect(stdout).toContain('bi help <command>');
  });

  it('`bi lint-config` reads the staged fixture (config + steps schema, no browser)', () => {
    const { code, stdout } = runStaged(staging, [
      'lint-config',
      path.join(PACKAGE, 'fixtures', 'app-factory.config.json'),
    ]);
    expect(code).toBe(0);
    expect(stdout).toContain('4× waitUntil "networkidle" → "settled"');
    expect(stdout).toContain('parallel: 3');
  });

  it.skipIf(skipSmoke)(
    'a --no-daemon batch on a staged fixture page runs with the staged playwright-core',
    () => {
      const fixture = pathToFileURL(path.join(staging, PACKAGE, 'fixtures', 'form.html')).href;
      const out = path.join(staging, 'out');
      mkdirSync(out, { recursive: true });
      const config = {
        outputDir: './out',
        snapshots: [
          {
            name: 'formularz',
            type: 'flow',
            url: fixture,
            steps: [
              { do: 'waitFor', selector: '[data-testid=request-form]' },
              { do: 'extract', name: 'tytul', selector: 'h1' },
            ],
          },
        ],
      };
      writeFileSync(path.join(staging, 'portable.config.json'), JSON.stringify(config));
      const { code, stdout, stderr } = runStaged(staging, [
        'portable.config.json',
        '--stamp',
        '2026-09-02_12-00',
        '--no-daemon',
      ]);
      expect(stderr).toBe('');
      expect(code).toBe(0);
      // One snapshot: the client prints only the summary line (per-snapshot lines need total > 1).
      expect(stdout).toContain('ok 1/1 completed');
      const report = JSON.parse(readFileSync(path.join(out, '2026-09-02_12-00', 'formularz', 'report.json'), 'utf8'));
      expect(report.completed).toBe(true);
      expect(report.extracts.tytul.value.length).toBeGreaterThan(0);
      expect(report.engine['playwright-core']).toBe('1.62.1');
      expect(report.timing.mode).toBe('no-daemon');
    },
    120_000,
  );

  it('zip → unpack → `bi help` — the release asset runs without npm install', () => {
    const zipPath = path.join(tmpdir(), `bi-portable-test-${String(process.pid)}.zip`);
    const unpacked = mkdtempSync(path.join(tmpdir(), 'bi-portable-unpacked-'));
    try {
      zipDirectory(staging, zipPath);
      expect(existsSync(zipPath)).toBe(true);
      // Entry names with backslashes (what Compress-Archive writes) unpack on Linux/macOS as flat
      // files named "packages\browser-inspector\bin\bi.mjs" — the first 0.1.0 build shipped 157 of them.
      const entries = zipEntries(zipPath);
      expect(entries.some((name) => name.endsWith('bin/bi.mjs'))).toBe(true);
      expect(entries.filter((name) => name.includes('\\'))).toEqual([]);
      if (process.platform === 'win32') {
        spawnSync(
          'powershell',
          ['-NoProfile', '-Command', `Expand-Archive -Path '${zipPath}' -DestinationPath '${unpacked}' -Force`],
          { stdio: 'ignore' },
        );
      } else {
        spawnSync('unzip', ['-q', zipPath, '-d', unpacked], { stdio: 'ignore' });
      }
      expect(existsSync(path.join(unpacked, PACKAGE, PORTABLE_MARKER))).toBe(true);
      const { code, stdout } = runStaged(unpacked, ['help']);
      expect(code).toBe(0);
      expect(stdout).toContain('bi <config.json>');
    } finally {
      rmSync(zipPath, { force: true });
      rmSync(unpacked, { recursive: true, force: true, maxRetries: 3 });
    }
  }, 300_000);
});
