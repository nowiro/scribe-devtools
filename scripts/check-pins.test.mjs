// The gate's own tests run against synthetic trees in a temp dir, never against this repository:
// a test that asserts "the repo is currently clean" goes green the day the check stops working.
// Each case builds the smallest tree that exhibits one failure and asserts the failure is FOUND.
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { bareVersion, checkPins, compareVersions, discoverManifests, proseLag } from './check-pins.mjs';
import { PINS } from './pins.config.mjs';

/** @type {string[]} */
const made = [];

/**
 * A workspace root with the shape this repository has: root manifest with `workspaces`,
 * one package under `packages/`, and `bench`.
 * @param {{root?: Record<string, any>, browserInspector?: Record<string, any>, bench?: Record<string, any>, files?: Record<string, string>}} tree
 * @returns {string}
 */
function fixture(tree) {
  const dir = mkdtempSync(path.join(tmpdir(), 'pins-'));
  made.push(dir);
  const write = (/** @type {string} */ rel, /** @type {unknown} */ value) => {
    mkdirSync(path.join(dir, path.dirname(rel)), { recursive: true });
    writeFileSync(path.join(dir, rel), typeof value === 'string' ? value : JSON.stringify(value, null, 2));
  };
  write('package.json', { name: 'root', workspaces: ['packages/*', 'bench'], devDependencies: {}, ...tree.root });
  if (tree.browserInspector) write('packages/browser-inspector/package.json', tree.browserInspector);
  if (tree.bench) write('bench/package.json', tree.bench);
  for (const [rel, text] of Object.entries(tree.files ?? {})) write(rel, text);
  return dir;
}

afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('the repository this gate guards', () => {
  it('every row carries the four fields a reviewer of a bump needs', () => {
    for (const pin of PINS) {
      expect(pin.id, 'id').toBeTruthy();
      expect(pin.owner, `${pin.id}: owner`).toMatch(/^[^#]+#(dependencies|devDependencies)$/u);
      expect(['exact', 'caret'], `${pin.id}: policy`).toContain(pin.policy);
      expect(pin.staleDays, `${pin.id}: staleDays`).toBeGreaterThan(0);
      // `why` is the field that makes the row worth having: the gate can prove a number moved,
      // only prose can say what the number holds up.
      expect(pin.why.length, `${pin.id}: why`).toBeGreaterThan(80);
    }
  });

  it('playwright-core stays exact with a floor at 1.62.1 — a range throws in portable-zip', () => {
    const pin = PINS.find((p) => p.id === 'playwright-core');
    expect(pin?.policy).toBe('exact');
    expect(pin?.minSupported).toBe('1.62.1');
  });
});

describe('META — the check knows what it is not checking', () => {
  it('fails on a dependency with no row, naming where it was declared', () => {
    const dir = fixture({ root: { devDependencies: { 'left-pad': '^1.0.0' } } });
    const { ok, problems } = checkPins(dir);
    expect(ok).toBe(false);
    expect(problems.join('\n')).toContain('META left-pad: declared in package.json#devDependencies');
  });

  it('fails on a row whose package nothing depends on any more', () => {
    const { problems } = checkPins(fixture({}));
    expect(problems.some((p) => p.includes('has a row but no manifest declares it'))).toBe(true);
  });

  it('fails when the owner coordinate names a section that does not declare it', () => {
    const dir = fixture({
      root: { devDependencies: { prettier: '^3.9.6' } },
      browserInspector: { name: 'bi', devDependencies: { 'playwright-core': '1.62.1' } },
    });
    expect(checkPins(dir).problems.join('\n')).toContain(
      'owner "packages/browser-inspector/package.json#dependencies"',
    );
  });

  it('discovers a package added under packages/ without touching this file', () => {
    const dir = fixture({ browserInspector: { name: 'bi' } });
    mkdirSync(path.join(dir, 'packages/new-tool'), { recursive: true });
    writeFileSync(path.join(dir, 'packages/new-tool/package.json'), JSON.stringify({ name: 'new-tool' }));
    expect(discoverManifests(dir)).toContain('packages/new-tool/package.json');
  });
});

describe('SHAPE and FLOOR', () => {
  const tree = (/** @type {string} */ spec) => ({
    browserInspector: { name: 'bi', dependencies: { 'playwright-core': spec } },
    bench: { name: 'bench', dependencies: { 'playwright-core': spec } },
  });

  it('rejects a range on an exact pin and says why it breaks', () => {
    const problems = checkPins(fixture(tree('>=1.62.1'))).problems.join('\n');
    expect(problems).toContain('SHAPE playwright-core: policy is exact');
    expect(problems).toContain('portable-zip.mjs:84');
  });

  it('rejects a version below the floor', () => {
    expect(checkPins(fixture(tree('1.61.0'))).problems.join('\n')).toContain(
      'FLOOR playwright-core: packages/browser-inspector/package.json#dependencies pins 1.61.0, below the supported floor 1.62.1',
    );
  });

  it('accepts the floor itself and anything above it', () => {
    for (const spec of ['1.62.1', '1.63.0', '2.0.0']) {
      const floorProblems = checkPins(fixture(tree(spec))).problems.filter((p) => p.startsWith('FLOOR'));
      expect(floorProblems, spec).toEqual([]);
    }
  });

  it('rejects a bare version where the policy is caret', () => {
    const dir = fixture({ root: { devDependencies: { prettier: '3.9.6' } } });
    expect(checkPins(dir).problems.join('\n')).toContain('SHAPE prettier: policy is caret');
  });
});

describe('SYNC', () => {
  it('fails when a mirror drifts from the owner', () => {
    const dir = fixture({
      browserInspector: { name: 'bi', dependencies: { 'playwright-core': '1.62.1' } },
      bench: { name: 'bench', dependencies: { 'playwright-core': '1.62.2' } },
    });
    expect(checkPins(dir).problems.join('\n')).toContain(
      'SYNC playwright-core: bench/package.json#dependencies says "1.62.2", owner',
    );
  });

  it('fails when a command line spawns a version other than the pin', () => {
    const dir = fixture({
      bench: { name: 'bench', devDependencies: { '@playwright/mcp': '0.0.80' } },
      files: {
        '.mcp.json': JSON.stringify({ mcpServers: { playwright: { args: ['-y', '@playwright/mcp@0.0.79'] } } }),
        '.vscode/mcp.json': JSON.stringify({ servers: { playwright: { args: ['-y', '@playwright/mcp@0.0.80'] } } }),
      },
    });
    const problems = checkPins(dir).problems.join('\n');
    expect(problems).toContain('SYNC @playwright/mcp: .mcp.json does not spawn @playwright/mcp@0.0.80');
    expect(problems).not.toContain('.vscode/mcp.json does not spawn');
  });
});

describe('LAG — the part a green test suite cannot do', () => {
  const text = [
    'playwright-core 1.62.1 renders the tree',
    '"playwright-core": "1.62.0"',
    'the 1.62.0 release, unrelated to any package on this line',
    'playwright-core 1.61.0 is where it started — pins:ignore',
    '@playwright/mcp@0.0.79 was the server then',
  ].join('\n');

  it('finds a stale version that follows the package name', () => {
    expect(proseLag(text, 'playwright-core', '1.62.1')).toEqual([{ line: 2, found: '1.62.0' }]);
  });

  it('ignores a version that is not attached to the package name', () => {
    expect(proseLag(text, 'playwright-core', '1.62.1').some((h) => h.line === 3)).toBe(false);
  });

  it('honours pins:ignore, so prose may quote an old version on purpose', () => {
    expect(proseLag(text, 'playwright-core', '1.62.1').some((h) => h.line === 4)).toBe(false);
  });

  it('reads the scoped package name including the slash', () => {
    expect(proseLag(text, '@playwright/mcp', '0.0.80')).toEqual([{ line: 5, found: '0.0.79' }]);
  });

  it('surfaces prose lag end to end, with file and line', () => {
    const dir = fixture({
      browserInspector: { name: 'bi', dependencies: { 'playwright-core': '1.63.0' } },
      bench: { name: 'bench', dependencies: { 'playwright-core': '1.63.0' } },
      files: { 'docs/DESIGN.md': 'facts read from playwright-core 1.62.1 before this version\n' },
    });
    expect(checkPins(dir).problems.join('\n')).toContain('LAG playwright-core: docs/DESIGN.md:1 quotes 1.62.1');
  });

  it('leaves frozen text alone — an old version there is the record of an event', () => {
    const dir = fixture({
      browserInspector: { name: 'bi', dependencies: { 'playwright-core': '1.63.0' } },
      bench: { name: 'bench', dependencies: { 'playwright-core': '1.63.0' } },
      files: {
        'CHANGELOG.md': 'shipped against playwright-core 1.62.1\n',
        'docs/handoff/WP0.md': 'measured on playwright-core 1.62.1\n',
      },
    });
    expect(checkPins(dir).problems.filter((p) => p.startsWith('LAG'))).toEqual([]);
  });
});

describe('compareVersions', () => {
  it('orders by segment, not lexically', () => {
    expect(compareVersions('1.10.0', '1.9.0')).toBe(1);
    expect(compareVersions('1.62.1', '1.62.1')).toBe(0);
    expect(compareVersions('1.62.0', '1.62.1')).toBe(-1);
  });

  it('puts a pre-release below its own release', () => {
    expect(compareVersions('1.63.0-alpha-2026-09-03', '1.63.0')).toBe(-1);
    expect(compareVersions('1.63.0-alpha-2026-09-03', '1.62.1')).toBe(1);
  });

  it('treats a missing segment as zero', () => {
    expect(compareVersions('2', '2.0.0')).toBe(0);
  });
});

describe('bareVersion', () => {
  it('strips a range operator and returns null when there is no version', () => {
    expect(bareVersion('^4.0.0')).toBe('4.0.0');
    expect(bareVersion('1.62.1')).toBe('1.62.1');
    expect(bareVersion('>=1.62.1')).toBe('1.62.1');
    expect(bareVersion('workspace:*')).toBeNull();
  });
});
