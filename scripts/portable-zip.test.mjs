// The portable build must run without `npm install` (AC-20): stage the tree exactly as
// `npm run portable` does, then execute the staged `bin/browser-inspector.mjs` from the staging directory —
// `help` (the client, no browser), `lint-config` on the staged fixture (config loading, no
// browser) and, unless BROWSER_INSPECTOR_SKIP_SMOKE=1, one real `--no-daemon` batch on a staged fixture page
// (playwright-core resolved from the staged `node_modules`, the system Chrome/Edge). The zip
// round-trip (bsdtar / zip → unpack → `browser-inspector help`) runs too — a few seconds, and it is the
// artifact a release ships.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  PORTABLE_MARKER,
  buildPortable,
  isFrozen,
  readVersion,
  sha256,
  stagePortable,
  zipDirectory,
  zipEntries,
  zipName,
} from './portable-zip.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PACKAGE = 'packages/browser-inspector';
const skipSmoke =
  process.env.BROWSER_INSPECTOR_SKIP_SMOKE === '1' || process.env.BROWSER_INSPECTOR_SKIP_SMOKE === 'true';

/**
 * `node <staging>/packages/browser-inspector/bin/browser-inspector.mjs …` with a clean BROWSER_INSPECTOR_*
 * environment and the
 * keeper disabled — the unpacked zip is tested as a stranger would run it, cwd = staging root.
 * @param {string} staging
 * @param {string[]} args
 */
function runStaged(staging, args) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('BROWSER_INSPECTOR_')));
  const result = spawnSync(process.execPath, [path.join(staging, PACKAGE, 'bin', 'browser-inspector.mjs'), ...args], {
    cwd: staging,
    env: { ...env, BROWSER_INSPECTOR_DAEMON: '0' },
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
    staging = mkdtempSync(path.join(tmpdir(), 'browser-inspector-portable-test-'));
    staged = stagePortable(REPO, staging);
  }, 60_000);

  afterAll(() => {
    if (staging) rmSync(staging, { recursive: true, force: true, maxRetries: 3 });
  });

  it('copies the runtime, the marker and the shims — never the tests', () => {
    expect(staged.playwrightVersion).toBe('1.62.1');
    expect(existsSync(path.join(staging, PACKAGE, 'bin', 'browser-inspector.mjs'))).toBe(true);
    expect(existsSync(path.join(staging, PACKAGE, 'src', 'engine.mjs'))).toBe(true);
    expect(existsSync(path.join(staging, PACKAGE, 'templates', 'flow.md'))).toBe(true);
    expect(existsSync(path.join(staging, PACKAGE, 'fixtures', 'form.html'))).toBe(true);
    expect(existsSync(path.join(staging, PACKAGE, 'test'))).toBe(false);
    expect(existsSync(path.join(staging, 'node_modules', 'playwright-core', 'package.json'))).toBe(true);
    expect(readFileSync(path.join(staging, PACKAGE, PORTABLE_MARKER), 'utf8')).toContain(staged.version);
    expect(existsSync(path.join(staging, 'browser-inspector.cmd'))).toBe(true);
    expect(existsSync(path.join(staging, 'browser-inspector'))).toBe(true);
    expect(existsSync(path.join(staging, 'README-PORTABLE.md'))).toBe(true);
  });

  it('`node packages/browser-inspector/bin/browser-inspector.mjs help` runs from the staged tree', () => {
    const { code, stdout, stderr } = runStaged(staging, ['help']);
    expect(stderr).toBe('');
    expect(code).toBe(0);
    expect(stdout).toContain('browser-inspector <config.json>');
    expect(stdout).toContain('browser-inspector help <command>');
  });

  it('`browser-inspector lint-config` reads the staged fixture (config + steps schema, no browser)', () => {
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

  it('the version is read from package.json — and the root must agree', () => {
    expect(readVersion(REPO)).toBe(staged.version);
    expect(zipName(staged.version)).toBe(`scribe-devtools-portable-${staged.version}.zip`);
    // A root that disagrees is a release mistake, not a warning.
    const root = mkdtempSync(path.join(tmpdir(), 'browser-inspector-version-'));
    try {
      mkdirSync(path.join(root, PACKAGE), { recursive: true });
      writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version: '9.9.9' }));
      writeFileSync(path.join(root, PACKAGE, 'package.json'), JSON.stringify({ version: staged.version }));
      expect(() => readVersion(root)).toThrow(/podbij obie/u);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('a released version is frozen: tag v<version> + existing zip → no rebuild; otherwise rebuild', () => {
    expect(isFrozen('0.1.0', ['v0.1.0', 'v0.0.9'], true)).toBe(true);
    // Version bumped, not yet tagged: the in-progress zip follows the tree.
    expect(isFrozen('0.1.1', ['v0.1.0'], true)).toBe(false);
    // Tagged but the zip is missing (fresh clone before the hook ran): build it.
    expect(isFrozen('0.1.0', ['v0.1.0'], false)).toBe(false);
    expect(isFrozen('0.1.0', [], true)).toBe(false);
  });

  it('two builds of the same tree are byte-identical — the tracked zip must not churn', () => {
    const a = path.join(tmpdir(), `browser-inspector-portable-det-a-${String(process.pid)}.zip`);
    const b = path.join(tmpdir(), `browser-inspector-portable-det-b-${String(process.pid)}.zip`);
    try {
      zipDirectory(staging, a);
      zipDirectory(staging, b);
      expect(sha256(a)).toBe(sha256(b));
      // Sorted entries, forward slashes, no directory entries, the shim keeps its mode bits.
      const entries = zipEntries(a);
      expect(entries).toEqual([...entries].sort());
      expect(entries.every((name) => !name.endsWith('/'))).toBe(true);
    } finally {
      rmSync(a, { force: true });
      rmSync(b, { force: true });
    }
  });

  it('buildPortable writes download/<name>.zip + .sha256 and reports `changed` only when bytes moved', () => {
    const out = mkdtempSync(path.join(tmpdir(), 'browser-inspector-portable-out-'));
    try {
      const first = buildPortable(REPO, out);
      expect(first.zipPath).toBe(path.join(out, zipName(first.version)));
      expect(first.changed).toBe(true);
      const sidecar = readFileSync(first.shaPath, 'utf8');
      expect(sidecar).toBe(`${sha256(first.zipPath)}  ${zipName(first.version)}\n`);
      const second = buildPortable(REPO, out);
      expect(second.changed).toBe(false);
      expect(sha256(second.zipPath)).toBe(sidecar.split(/\s+/u)[0]);
    } finally {
      rmSync(out, { recursive: true, force: true, maxRetries: 3 });
    }
  }, 120_000);

  it('zip → unpack → `browser-inspector help` — the release asset runs without npm install', () => {
    const zipPath = path.join(tmpdir(), `browser-inspector-portable-test-${String(process.pid)}.zip`);
    const unpacked = mkdtempSync(path.join(tmpdir(), 'browser-inspector-portable-unpacked-'));
    try {
      zipDirectory(staging, zipPath);
      expect(existsSync(zipPath)).toBe(true);
      // Entry names with backslashes (what Compress-Archive writes) unpack on Linux/macOS as flat
      // files named "packages\browser-inspector\bin\browser-inspector.mjs" — the first 0.1.0 build shipped 157
      // of them.
      const entries = zipEntries(zipPath);
      expect(entries.some((name) => name.endsWith('bin/browser-inspector.mjs'))).toBe(true);
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
      expect(stdout).toContain('browser-inspector <config.json>');
    } finally {
      rmSync(zipPath, { force: true });
      rmSync(unpacked, { recursive: true, force: true, maxRetries: 3 });
    }
  }, 300_000);
});
