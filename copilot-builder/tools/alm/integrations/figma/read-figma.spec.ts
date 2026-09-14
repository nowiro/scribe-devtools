/**
 * Tests for the `read-figma` pipeline.
 *
 * The HTTP client is injected into every processor, so the whole thing can be checked without the
 * network and without a token — and a test that requires both fails in CI and teaches people to
 * skip it. Three things are tested, each for a different reason:
 *
 *  1. **The config schema** — because a bad `fileKey` is to fail on parsing, and not after the
 *     first upstream call, once a network round has already been paid for.
 *  2. **The pagination turn ceiling** — because an API returning a cursor pointing at itself turns
 *     the loop into an infinite one, and a failure of that kind is invisible in a code review.
 *  3. **Writing the tokens** — because this is the only result of this integration with a consumer
 *     outside Figma and it must come into being in both forms at once: the data and the file
 *     ready to be consumed directly.
 */
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import type { HttpClient } from '../shared/http-client.js';
import { ReadConfig, paginateLibrary, processTokens } from './read-figma.js';

const VALID_KEY = 'abcdefghij0123456789';

/** Minimal client: returns the prepared responses in order and records what it was asked for. */
function stubHttp(responses: readonly unknown[]): HttpClient & { readonly calls: string[] } {
  const calls: string[] = [];
  let i = 0;
  return {
    calls,
    async request({ path }: { path: string }) {
      calls.push(path);
      const next = responses[Math.min(i, responses.length - 1)];
      i += 1;
      return next as never;
    },
  } as unknown as HttpClient & { readonly calls: string[] };
}

let dir: string | undefined;
afterEach(() => {
  if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

describe('config schema', () => {
  it('rejects an unknown key rather than dropping it in silence', () => {
    expect(() =>
      ReadConfig.parse({ snapshots: [{ name: 'x', type: 'tokens', fileKey: VALID_KEY, format: ['css'] }] }),
    ).toThrow(/format/);
    expect(() =>
      ReadConfig.parse({ outputDirs: './x', snapshots: [{ name: 'x', type: 'tokens', fileKey: VALID_KEY }] }),
    ).toThrow(/outputDirs/);
  });

  it('accepts a correct tokens snapshot and fills in the defaults', () => {
    const parsed = ReadConfig.parse({
      snapshots: [{ name: 'product-tokens', type: 'tokens', fileKey: VALID_KEY }],
    });
    expect(parsed.outputDir).toBe('./.alm/figma');
    expect(parsed.snapshots[0]).toMatchObject({ formats: ['css', 'scss', 'ts'] });
  });

  it('rejects a fileKey shorter than Figma requires — before anyone pays for a network round', () => {
    expect(() => ReadConfig.parse({ snapshots: [{ name: 'x', type: 'tokens', fileKey: 'tooshort' }] })).toThrow();
  });

  it('rejects a teamId that is not a number', () => {
    expect(() => ReadConfig.parse({ snapshots: [{ name: 'x', type: 'components', teamId: 'team' }] })).toThrow();
  });

  it('rejects an empty snapshot list — a pipeline without a scope has nothing to do', () => {
    expect(() => ReadConfig.parse({ snapshots: [] })).toThrow();
  });

  it('does not know the `okf` format — the pipeline does not emit it, so the config must fail loudly', () => {
    expect(() =>
      ReadConfig.parse({
        snapshots: [{ name: 'x', type: 'tokens', fileKey: VALID_KEY, render: ['okf'] }],
      }),
    ).toThrow();
  });
});

describe('library pagination', () => {
  it('ends when the API stops returning a cursor', async () => {
    const http = stubHttp([
      { meta: { components: [{ key: 'a', name: 'Alpha' }], cursor: { after: 'c1' } } },
      { meta: { components: [{ key: 'b', name: 'Beta' }] } },
    ]);
    const out = await paginateLibrary(http, '/v1/teams/1/components', 'components', 1000);
    expect(out.entries.map((e) => e.key)).toEqual(['a', 'b']);
    expect(out.truncated).toBe(false);
  });

  it('respects maxItems and does not fetch more than needed', async () => {
    const http = stubHttp([
      {
        meta: {
          components: [
            { key: 'a', name: 'A' },
            { key: 'b', name: 'B' },
            { key: 'c', name: 'C' },
          ],
          cursor: { after: 'c1' },
        },
      },
    ]);
    const out = await paginateLibrary(http, '/v1/teams/1/components', 'components', 2);
    expect(out.entries).toHaveLength(2);
    // The cap fired with more data available — the caller must be told, not left guessing.
    expect(out.truncated).toBe(true);
    expect(http.calls).toHaveLength(1);
  });

  it('does not loop forever when the API returns a cursor pointing at itself', async () => {
    // Without the turn ceiling this response gives an infinite loop: the cursor is always the
    // same, and the list never grows to `maxItems`.
    const http = stubHttp([{ meta: { components: [], cursor: { after: 'always-the-same' } } }]);
    const out = await paginateLibrary(http, '/v1/teams/1/components', 'components', 1000);
    expect(out.entries).toEqual([]);
    // The guard bailed mid-chain with the cursor still live — partial data, and SAID so.
    expect(out.truncated).toBe(true);
    expect(http.calls.length).toBeLessThanOrEqual(200);
    expect(http.calls.length).toBeGreaterThan(1);
  });

  it('skips entries without a key instead of writing empty rows', async () => {
    const http = stubHttp([{ meta: { components: [{ name: 'no key' }, { key: 'a' }] } }]);
    const out = await paginateLibrary(http, '/v1/teams/1/components', 'components', 1000);
    expect(out.entries.map((e) => e.key)).toEqual(['a']);
  });
});

describe('tokens snapshot', () => {
  const VARIABLES = {
    meta: {
      variableCollections: { col1: { id: 'col1', defaultModeId: 'm1' } },
      variables: {
        v1: {
          name: 'color/primary',
          resolvedType: 'COLOR',
          variableCollectionId: 'col1',
          valuesByMode: { m1: { r: 0, g: 0.5, b: 1, a: 1 } },
        },
        v2: {
          name: 'spacing/sm',
          resolvedType: 'FLOAT',
          variableCollectionId: 'col1',
          valuesByMode: { m1: 8 },
        },
      },
    },
  };

  it('writes the data and the ready-to-use form side by side', async () => {
    dir = mkdtempSync(join(tmpdir(), 'figma-tokens-'));
    const http = stubHttp([VARIABLES]);
    const result = await processTokens(
      http,
      {
        name: 'tokens',
        type: 'tokens',
        fileKey: VALID_KEY,
        render: ['json', 'markdown'],
        formats: ['css', 'ts'],
      },
      dir,
    );

    expect(result.itemCount).toBe(2);
    const written = readdirSync(dir).sort();
    expect(written).toEqual(['tokens.css', 'tokens.json', 'tokens.md', 'tokens.ts']);

    const data = JSON.parse(readFileSync(join(dir, 'tokens.json'), 'utf8'));
    expect(data.tokenCount).toBe(2);
    expect(data.byKind).toMatchObject({ color: 1, spacing: 1 });

    // The ready-to-use form must be genuinely emitted, and not be an empty placeholder file: it
    // is what a consumer imports directly, without re-deriving it from the JSON.
    expect(readFileSync(join(dir, 'tokens.css'), 'utf8')).toContain('--color-primary');
    expect(readFileSync(join(dir, 'tokens.ts'), 'utf8')).toContain('colorPrimary');
  });

  it('does not emit a format that was not asked for', async () => {
    dir = mkdtempSync(join(tmpdir(), 'figma-tokens-'));
    await processTokens(
      stubHttp([VARIABLES]),
      { name: 't', type: 'tokens', fileKey: VALID_KEY, render: ['json'], formats: [] },
      dir,
    );
    expect(readdirSync(dir)).toEqual(['tokens.json']);
  });

  it('markdown carries a table of tokens, not raw JSON', async () => {
    dir = mkdtempSync(join(tmpdir(), 'figma-tokens-'));
    await processTokens(
      stubHttp([VARIABLES]),
      {
        name: 't',
        type: 'tokens',
        fileKey: VALID_KEY,
        render: ['json', 'markdown'],
        formats: [],
      },
      dir,
    );
    const md = readFileSync(join(dir, 'tokens.md'), 'utf8');
    expect(md).toContain('| Token | Kind | Value |');
    expect(md).toContain('color/primary');
    expect(md).not.toContain('"valuesByMode"');
  });

  it('an empty file gives a snapshot with zero tokens, not a crash', async () => {
    dir = mkdtempSync(join(tmpdir(), 'figma-tokens-'));
    const result = await processTokens(
      stubHttp([{ meta: { variables: {}, variableCollections: {} } }]),
      { name: 't', type: 'tokens', fileKey: VALID_KEY, render: ['json'], formats: [] },
      dir,
    );
    expect(result.itemCount).toBe(0);
  });
});
