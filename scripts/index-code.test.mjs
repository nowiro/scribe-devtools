// Tests for the CODE-INDEX generator. What matters: (1) the regex extraction is pinned against
// the repository's export style, (2) the reverse edges ("imported by") are correct — they are the
// whole value of the file, (3) the output is deterministic. Freshness itself is guarded by
// `npm run verify` (--check), not here.
import { describe, expect, it } from 'vitest';

import { buildIndex, generateIndex, listSourceFiles, parseExports, parseImports } from './index-code.mjs';

describe('parseExports', () => {
  it('catches every declaration form the repository uses, sorted and deduplicated', () => {
    const source = [
      'export function walk() {}',
      'export async function fetchAll() {}',
      'export const STEPS = {};',
      'export let counter = 0;',
      'export class FakePage {}',
      'export function* lines() {}',
      'export { internalName as publicName, plain };',
      "export { reexported } from './other.mjs';",
      'const internal = 1;',
      'function alsoInternal() {}',
    ].join('\n');
    expect(parseExports(source)).toEqual([
      'FakePage',
      'STEPS',
      'counter',
      'fetchAll',
      'lines',
      'plain',
      'publicName',
      'walk',
    ]);
  });
});

describe('parseImports', () => {
  it('resolves local specifiers against the importing file and drops packages', () => {
    const source = [
      "import { chromium } from 'playwright-core';",
      "import { STEPS } from './steps.schema.mjs';",
      "import { withDeadline } from '../src/deadline.mjs';",
      'import net from "node:net";',
    ].join('\n');
    expect(parseImports(source, 'packages/browser-inspector/src/engine.mjs')).toEqual([
      'packages/browser-inspector/src/deadline.mjs',
      'packages/browser-inspector/src/steps.schema.mjs',
    ]);
  });

  it('sees dynamic imports — the keeper loads the engine lazily and that edge must be on the map', () => {
    const source = "const { createEngine } = await import('./engine.mjs');";
    expect(parseImports(source, 'packages/browser-inspector/src/keeper.mjs')).toEqual([
      'packages/browser-inspector/src/engine.mjs',
    ]);
  });
});

describe('buildIndex', () => {
  it('reverse edges: a module lists WHO imports it', () => {
    const index = buildIndex([
      {
        path: 'packages/browser-inspector/src/cli.mjs',
        exports: ['parseArgs'],
        imports: ['packages/browser-inspector/src/steps.schema.mjs'],
      },
      { path: 'packages/browser-inspector/src/steps.schema.mjs', exports: ['STEPS'], imports: [] },
    ]);
    expect(index).toContain('## packages/browser-inspector/src/steps.schema.mjs');
    expect(index).toContain('- imported by: `packages/browser-inspector/src/cli.mjs`');
    expect(index).toContain('- exports: `STEPS`');
    expect(index).toContain('- imports: `packages/browser-inspector/src/steps.schema.mjs`');
  });
});

describe('listSourceFiles / generateIndex (real tree)', () => {
  it('lists the tooling, skips tests and fixtures, and is deterministic', () => {
    const files = listSourceFiles(process.cwd());
    expect(files).toContain('scripts/index-code.mjs');
    expect(files.some((f) => f.endsWith('.test.mjs'))).toBe(false);
    expect(files.some((f) => f.includes('/fixtures/'))).toBe(false);
    const first = generateIndex(process.cwd());
    expect(first).toBe(generateIndex(process.cwd()));
    expect(first).toContain('## scripts/index-code.mjs');
    expect(first).toContain('`parseExports`');
  });
});
