/**
 * Tests for `read-runtime.ts` — the shared DRY helpers for the pipelines.
 *   - Zod schemas (snapshotName, renderFormats)
 *   - parseCursorFromLink (Confluence v2)
 *   - writePipelineOutputs / writeManifest — around a tmp directory
 *   - runIfMain — not tested (top-level side effect, integration territory)
 *   - createScriptLogger — basic smoke
 */
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  assertSafeBasename,
  buildManifest,
  createScriptLogger,
  defaultConfigPath,
  defaultOutputDir,
  escapeTableCell,
  formatStamp,
  loadJsonConfig,
  parseCursorFromLink,
  parseReadArgs,
  renderFormatsSchema,
  snapshotNameSchema,
  walkOffsetPages,
  writeManifest,
  writePipelineOutputs,
  type OffsetPage,
} from './read-runtime.js';
import { z } from 'zod';

/** Await a rejection and hand back the Error. Fails loudly if it resolves instead. */
async function failureOf(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error: unknown) {
    return error as Error;
  }
  throw new Error('expected the call to reject, but it resolved');
}

describe('snapshotNameSchema', () => {
  it('accepts lowercase kebab', () => {
    expect(snapshotNameSchema.parse('active-bugs')).toBe('active-bugs');
    expect(snapshotNameSchema.parse('a')).toBe('a');
    expect(snapshotNameSchema.parse('snap-1-of-2')).toBe('snap-1-of-2');
  });

  it('rejects uppercase, spaces, leading dash', () => {
    expect(() => snapshotNameSchema.parse('ActiveBugs')).toThrow();
    expect(() => snapshotNameSchema.parse('active bugs')).toThrow();
    expect(() => snapshotNameSchema.parse('-leading')).toThrow();
    expect(() => snapshotNameSchema.parse('')).toThrow();
  });

  it('rejects names over 64 chars', () => {
    expect(() => snapshotNameSchema.parse('a'.repeat(65))).toThrow();
  });
});

describe('renderFormatsSchema', () => {
  it('defaults to ["json", "markdown"] when absent', () => {
    expect(renderFormatsSchema.parse(undefined)).toEqual(['json', 'markdown']);
  });

  it('accepts subset', () => {
    expect(renderFormatsSchema.parse(['json'])).toEqual(['json']);
    expect(renderFormatsSchema.parse(['markdown'])).toEqual(['markdown']);
  });

  it('rejects empty array', () => {
    expect(() => renderFormatsSchema.parse([])).toThrow();
  });

  it('rejects unknown format', () => {
    expect(() => renderFormatsSchema.parse(['yaml'])).toThrow();
  });
});

describe('parseCursorFromLink', () => {
  it('extracts cursor from Confluence-style next link', () => {
    expect(parseCursorFromLink('https://example.atlassian.net/wiki/api/v2/pages/123/children?cursor=abc123')).toBe(
      'abc123',
    );
  });

  it('extracts cursor when not the first param', () => {
    expect(parseCursorFromLink('/some/path?limit=50&cursor=xyz789')).toBe('xyz789');
  });

  it('URL-decodes the cursor value', () => {
    expect(parseCursorFromLink('/x?cursor=a%2Fb%3Dc')).toBe('a/b=c');
  });

  it('returns undefined for empty / missing input', () => {
    expect(parseCursorFromLink(undefined)).toBeUndefined();
    expect(parseCursorFromLink('')).toBeUndefined();
  });

  it('returns undefined when link has no cursor param', () => {
    expect(parseCursorFromLink('/x?limit=50')).toBeUndefined();
  });
});

describe('writePipelineOutputs / writeManifest (tmpdir)', () => {
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await mkdtemp(join(tmpdir(), 'extract-test-'));
  });
  afterEach(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
  });

  it('writes both JSON and Markdown when formats requested', async () => {
    const dir = join(tmpRoot, 'snap');
    await writePipelineOutputs({
      dir,
      basename: 'abc-123',
      data: { hello: 'world' },
      markdown: '# Hello',
      formats: ['json', 'markdown'],
    });
    const json = await readFile(join(dir, 'abc-123.json'), 'utf8');
    const md = await readFile(join(dir, 'abc-123.md'), 'utf8');
    expect(JSON.parse(json)).toEqual({ hello: 'world' });
    expect(json.endsWith('\n')).toBe(true);
    expect(md).toBe('# Hello');
  });

  it('writes only JSON when markdown is excluded', async () => {
    const dir = join(tmpRoot, 'snap');
    await writePipelineOutputs({
      dir,
      basename: 'only-json',
      data: { a: 1 },
      markdown: 'should not be written',
      formats: ['json'],
    });
    const json = await readFile(join(dir, 'only-json.json'), 'utf8');
    expect(JSON.parse(json)).toEqual({ a: 1 });
    await expect(readFile(join(dir, 'only-json.md'), 'utf8')).rejects.toThrow();
  });

  it('creates the directory recursively if it does not exist', async () => {
    const dir = join(tmpRoot, 'deep', 'nested', 'snap');
    await writePipelineOutputs({
      dir,
      basename: 'x',
      data: {},
      markdown: '',
      formats: ['json'],
    });
    const json = await readFile(join(dir, 'x.json'), 'utf8');
    expect(JSON.parse(json)).toEqual({});
  });

  it('assertSafeBasename passes real upstream ids and rejects traversal', () => {
    for (const ok of ['PROJ-123', '_summary', '_manifest', '12345', 'issue-42', 'abc-123']) {
      expect(assertSafeBasename(ok)).toBe(ok);
    }
    for (const evil of ['../evil', '../../evil', '..', '.', 'a/b', 'a\\b', 'a/../b', '']) {
      expect(() => assertSafeBasename(evil)).toThrow(/path-traversal guard/);
    }
  });

  it('writePipelineOutputs rejects a traversal basename before writing (path-traversal)', async () => {
    const dir = join(tmpRoot, 'snap');
    await expect(
      writePipelineOutputs({ dir, basename: '../../evil', data: {}, markdown: '', formats: ['json'] }),
    ).rejects.toThrow(/path-traversal guard/);
  });

  it('an oversized markdown view splits: head + loud pointer in .md, everything in .full.md', async () => {
    const dir = join(tmpRoot, 'snap');
    const big = Array.from({ length: 400 }, (_, i) => `line ${String(i)}`).join('\n');
    const files = await writePipelineOutputs({
      dir,
      basename: 'huge-1',
      data: { ok: true },
      markdown: big,
      formats: ['json', 'markdown'],
      sidecarOverChars: 500,
    });
    const head = await readFile(join(dir, 'huge-1.md'), 'utf8');
    const full = await readFile(join(dir, 'huge-1.full.md'), 'utf8');
    expect(full).toBe(big); // nothing lost — the split shapes the READING view only
    expect(head.length).toBeLessThan(big.length);
    expect(head).toContain('**SIDECAR**');
    expect(head).toContain('huge-1.full.md');
    // Cut lands on a line boundary — a mid-table cut reads as corruption.
    expect(head.split('\n\n> **SIDECAR**')[0]).toMatch(/line \d+$/);
    expect(files.map((f) => f.name).sort()).toEqual(['huge-1.full.md', 'huge-1.json', 'huge-1.md']);
    for (const f of files) expect(f.bytes).toBeGreaterThan(0);
  });

  it('under the threshold nothing splits and the sizes still come back', async () => {
    const dir = join(tmpRoot, 'snap');
    const files = await writePipelineOutputs({
      dir,
      basename: 'small-1',
      data: {},
      markdown: '# small',
      formats: ['json', 'markdown'],
      sidecarOverChars: 500,
    });
    expect(files.map((f) => f.name).sort()).toEqual(['small-1.json', 'small-1.md']);
    await expect(readFile(join(dir, 'small-1.full.md'), 'utf8')).rejects.toThrow();
  });

  it('writeManifest writes _manifest.json with stable serialization', async () => {
    const dir = join(tmpRoot, 'snap');
    await mkdir(dir, { recursive: true });
    const manifest = { snapshot: 'test', count: 5, ids: ['a', 'b', 'c'] };
    await writeManifest(dir, manifest);
    const content = await readFile(join(dir, '_manifest.json'), 'utf8');
    expect(JSON.parse(content)).toEqual(manifest);
    expect(content.endsWith('\n')).toBe(true);
  });

  it('loadJsonConfig reads + validates via Zod', async () => {
    const dir = join(tmpRoot, 'cfg');
    await mkdir(dir, { recursive: true });
    const schema = z.object({ outputDir: z.string(), version: z.number() });
    const configPath = join(dir, 'config.json');
    await writeManifest(dir, { foo: 'bar' });
    // reuse manifest as a json file — write minimal valid config
    const validConfig = { outputDir: './out', version: 1 };
    await writePipelineOutputs({
      dir,
      basename: 'config',
      data: validConfig,
      markdown: '',
      formats: ['json'],
    });
    const loaded = await loadJsonConfig(configPath, schema);
    expect(loaded).toEqual(validConfig);
  });

  it('loadJsonConfig throws on schema mismatch', async () => {
    const dir = join(tmpRoot, 'cfg');
    await mkdir(dir, { recursive: true });
    const schema = z.object({ outputDir: z.string() });
    const configPath = join(dir, 'config.json');
    await writePipelineOutputs({
      dir,
      basename: 'config',
      data: { wrong: 'shape' },
      markdown: '',
      formats: ['json'],
    });
    await expect(loadJsonConfig(configPath, schema)).rejects.toThrow();
  });

  it('loadJsonConfig reports every schema problem as a readable line, not a JSON dump', async () => {
    // Zod's own message is its issue array serialised. For a strict config schema
    // the commonest failure is a typo, and the person who made it has to be able
    // to find it — so each issue gets `path: message`, with array indices as
    // `snapshots[0]` rather than as a separate path segment.
    const dir = join(tmpRoot, 'cfg');
    await mkdir(dir, { recursive: true });
    const schema = z.strictObject({
      outputDir: z.string(),
      snapshots: z.array(z.strictObject({ name: z.string().min(1) })),
    });
    await writePipelineOutputs({
      dir,
      basename: 'config',
      data: { outputDir: './x', snapshots: [{ name: '' }, { name: 'ok', typo: 1 }] },
      markdown: '',
      formats: ['json'],
    });
    const failure = await failureOf(loadJsonConfig(join(dir, 'config.json'), schema));
    expect(failure.message).toContain('is not a valid config:');
    expect(failure.message).toContain('  - snapshots[0].name:');
    expect(failure.message).toContain('  - snapshots[1]: Unrecognized key: "typo"');
    // Not the raw serialised issue array.
    expect(failure.message).not.toContain('"code"');
  });

  it('loadJsonConfig labels a root-level problem rather than printing an empty path', async () => {
    const dir = join(tmpRoot, 'cfg-root');
    await mkdir(dir, { recursive: true });
    await writePipelineOutputs({ dir, basename: 'config', data: [], markdown: '', formats: ['json'] });
    const failure = await failureOf(loadJsonConfig(join(dir, 'config.json'), z.strictObject({ a: z.string() })));
    expect(failure.message).toContain('  - (root):');
  });
});

describe('createScriptLogger', () => {
  it('returns a function that writes prefixed lines to stderr', () => {
    const log = createScriptLogger('test-script');
    expect(typeof log).toBe('function');
    // Sanity — the stderr write is not tested deeper (testing process.stderr
    // would require a mock that pollutes the other tests). This is smoke only.
  });
});

describe('buildManifest', () => {
  const snapshot = { name: 'active-bugs', render: ['json', 'markdown'] as const };
  const run = { source: 'jira', stamp: '2026-05-22_12-00', startedAt: '2026-05-22T10:00:00.000Z' };

  it('builds envelope with common fields + extras', () => {
    const manifest = buildManifest('read-jira', run, snapshot, {
      jql: 'project = X',
      issueCount: 42,
    });

    expect(manifest.snapshot).toBe('active-bugs');
    // source + stamp make the snapshot self-describing — they are ENVELOPE fields,
    // not extras every pipeline has to remember to append by hand.
    expect(manifest.source).toBe('jira');
    expect(manifest.stamp).toBe('2026-05-22_12-00');
    expect(manifest.runStartedAt).toBe('2026-05-22T10:00:00.000Z');
    expect(manifest.runFinishedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(manifest.render).toEqual(['json', 'markdown']);
    expect(manifest.tooling.script).toBe('read-jira');
    expect(manifest.tooling.version).toBeTypeOf('string');
    expect(manifest.jql).toBe('project = X');
    expect(manifest.issueCount).toBe(42);
  });

  it('carries the run correlation id — the same one every request sent in X-Correlation-Id', () => {
    const first = buildManifest('s', run, snapshot, {});
    const second = buildManifest('s', run, snapshot, {});
    expect(first.correlationId.length).toBeGreaterThan(0);
    // Same process → same id, or upstream logs and snapshots stop correlating.
    expect(second.correlationId).toBe(first.correlationId);
  });

  it('finished timestamp is >= started timestamp', () => {
    const started = new Date().toISOString();
    const manifest = buildManifest('s', { ...run, startedAt: started }, snapshot, {});
    expect(new Date(manifest.runFinishedAt).getTime()).toBeGreaterThanOrEqual(new Date(started).getTime());
  });

  it('preserves extras keys; spread allows override (caller responsibility)', () => {
    const manifest = buildManifest('s', run, snapshot, {
      type: 'page',
      pageIds: ['1', '2'],
    });
    expect(manifest.type).toBe('page');
    expect(manifest.pageIds).toEqual(['1', '2']);
  });
});

// ── Arguments, the run stamp and the output root ────────────────────────────
//
// These guard two properties every pipeline stands on:
//   1. the raw material lands under a gitignored `.alm/<source>/`, never in the tree;
//   2. the run stamp is an INPUT (`--stamp` / `EXTRACT_STAMP`), so two runs over the
//      same config produce the same directory instead of a new one per minute.

describe('defaultOutputDir', () => {
  it('keeps every source inside the gitignored cache directory', () => {
    expect(defaultOutputDir('jira')).toBe('./.alm/jira');
    expect(defaultOutputDir('gitlab')).toBe('./.alm/gitlab');
  });
});

describe('parseReadArgs', () => {
  it('reads --config in both forms and falls back to the positional argument', () => {
    expect(parseReadArgs(['--config', 'a.json'], './d.json').configPath).toBe('a.json');
    expect(parseReadArgs(['--config=b.json'], './d.json').configPath).toBe('b.json');
    expect(parseReadArgs(['c.json'], './d.json').configPath).toBe('c.json');
    expect(parseReadArgs([], './d.json').configPath).toBe('./d.json');
  });

  it('does not mistake a flag for the positional config path', () => {
    // The four non-Jira pipelines used to read `process.argv[2]` raw, so
    // `--stamp X` was taken as the config filename and reported as missing.
    expect(parseReadArgs(['--stamp', '2026-08-23_12-00'], './d.json').configPath).toBe('./d.json');
  });

  it('rejects an unknown flag by name instead of silently ignoring it', () => {
    // A typo'd `--stmap X` used to be dropped, X became the config path, and the
    // resulting error was a misleading "config not found".
    expect(() => parseReadArgs(['--stmap', 'X'], './d.json')).toThrow(/--stmap/u);
  });

  it('takes the stamp from the flag, then from EXTRACT_STAMP, else leaves it undefined', () => {
    expect(parseReadArgs(['--stamp', '2026-08-23_12-00'], './d.json').stamp).toBe('2026-08-23_12-00');
    expect(parseReadArgs(['--stamp=2026-08-23_12-00'], './d.json').stamp).toBe('2026-08-23_12-00');
    expect(parseReadArgs([], './d.json', { EXTRACT_STAMP: '2026-01-02_03-04' }).stamp).toBe('2026-01-02_03-04');
    expect(parseReadArgs([], './d.json', {}).stamp).toBeUndefined();
    // The flag beats the environment — otherwise `--stamp` would be decoration.
    expect(
      parseReadArgs(['--stamp', '2026-05-05_05-05'], './d.json', { EXTRACT_STAMP: '2026-01-02_03-04' }).stamp,
    ).toBe('2026-05-05_05-05');
  });

  it('rejects a malformed stamp loudly instead of silently reaching for the clock', () => {
    expect(() => parseReadArgs(['--stamp', '2026-08-23'], './d.json')).toThrow(/invalid stamp/);
    expect(() => parseReadArgs([], './d.json', { EXTRACT_STAMP: 'now' })).toThrow(/invalid stamp/);
  });

  it('a flag with no value fails loudly instead of silently falling back', () => {
    // A trailing `--stamp` used to leave the stamp undefined: validation never ran and
    // the run silently took the clock — the exact behaviour the docblock forbids. A
    // trailing `--config` silently read the default config instead of the intended one.
    expect(() => parseReadArgs(['--stamp'], './d.json')).toThrow(/--stamp requires a value/);
    expect(() => parseReadArgs(['x.json', '--config'], './d.json')).toThrow(/--config requires a value/);
    expect(() => parseReadArgs(['--config='], './d.json')).toThrow(/--config requires a value/);
  });

  it('a SECOND positional is a loud error — the write runtime refuses the same ambiguity', () => {
    // `read jira a.json b.json` used to silently run a.json only.
    expect(() => parseReadArgs(['a.json', 'b.json'], './d.json')).toThrow(/unexpected extra argument/);
  });
});

describe('defaultConfigPath', () => {
  it('matches the convention the read.mjs dispatcher predicts on its side of the .mjs/.ts boundary', () => {
    expect(defaultConfigPath('jira')).toBe('./read.config.jira.json');
    expect(defaultConfigPath('browser-inspector')).toBe('./read.config.browser-inspector.json');
  });
});

describe('formatStamp', () => {
  it('formats in Europe/Warsaw, honouring the DST offset of the given instant', () => {
    // 2026-08-23T10:00Z is summer (UTC+2) → 12:00 local time.
    expect(formatStamp(new Date('2026-08-23T10:00:00Z'))).toBe('2026-08-23_12-00');
    // 2026-01-15T10:00Z is winter (UTC+1) → 11:00 local time. Same UTC hour, different stamp.
    expect(formatStamp(new Date('2026-01-15T10:00:00Z'))).toBe('2026-01-15_11-00');
  });

  it('produces a stamp the parser accepts — both sides talk about the same shape', () => {
    expect(parseReadArgs(['--stamp', formatStamp(new Date('2026-08-23T10:00:00Z'))], './d.json').stamp).toBe(
      '2026-08-23_12-00',
    );
  });
});

describe('escapeTableCell', () => {
  it('escapes pipes and flattens newlines — nothing else', () => {
    expect(escapeTableCell('a|b')).toBe('a\\|b');
    expect(escapeTableCell(' a\r\nb ')).toBe('a b');
  });

  it('backslashes pass through — a code-span cell must carry them verbatim', () => {
    expect(escapeTableCell('`.md\\:flex`')).toBe('`.md\\:flex`');
  });
});

describe('walkOffsetPages', () => {
  const page = <T>(total: number | null | undefined, results: readonly (T | null)[]): OffsetPage<T> => ({
    ...(total !== undefined ? { total } : {}),
    results,
  });

  it('walks pages until the first-page total is reached', async () => {
    const calls: number[] = [];
    const out = await walkOffsetPages<number>(
      async (start, limit) => {
        calls.push(start);
        const all = Array.from({ length: 150 }, (_, i) => i);
        return page(150, all.slice(start, start + limit));
      },
      { maxItems: 10_000 },
    );
    expect(out.items).toHaveLength(150);
    expect(out.total).toBe(150);
    expect(out.truncated).toBe(false);
    expect(out.hidden).toBe(0);
    expect(calls).toEqual([0, 100]);
  });

  it('the FIRST page total wins — later pages restate the shifted count', async () => {
    let call = 0;
    const out = await walkOffsetPages<number>(
      async (start, limit) => {
        call += 1;
        const total = call === 1 ? 150 : 999;
        return page(
          total,
          Array.from({ length: Math.min(limit, 150 - start) }, (_, i) => start + i),
        );
      },
      { maxItems: 10_000 },
    );
    expect(out.total).toBe(150);
    expect(out.items).toHaveLength(150);
  });

  it('a null FIRST-page total is not replaced by a later page — a shifted count must not end the walk', async () => {
    let call = 0;
    const out = await walkOffsetPages<number>(
      async (start, limit) => {
        call += 1;
        const all = Array.from({ length: 300 }, (_, i) => i);
        // Page 1 carries no usable total; page 2 restates a SHIFTED count of 50.
        return page(call === 1 ? null : 50, all.slice(start, start + limit));
      },
      { maxItems: 10_000 },
    );
    expect(out.items).toHaveLength(300);
    expect(out.total).toBeUndefined();
    expect(out.truncated).toBe(false);
  });

  it('a NULL total (nullable Int in the schema) is ignored, not latched into `start >= null`', async () => {
    const calls: number[] = [];
    const out = await walkOffsetPages<number>(
      async (start, limit) => {
        calls.push(start);
        const all = Array.from({ length: 150 }, (_, i) => i);
        return page(null, all.slice(start, start + limit));
      },
      { maxItems: 10_000 },
    );
    expect(out.items).toHaveLength(150);
    expect(calls.length).toBeGreaterThan(1);
    expect(out.total).toBeUndefined();
  });

  it('stopping at maxItems with no known total still SAYS truncated when the last page was full', async () => {
    const out = await walkOffsetPages<number>(
      async (start, limit) =>
        page(
          null,
          Array.from({ length: limit }, (_, i) => start + i),
        ),
      { maxItems: 50 },
    );
    expect(out.items).toHaveLength(50);
    expect(out.truncated).toBe(true);
  });

  it('a server that over-returns past the requested limit cannot overflow maxItems', async () => {
    const out = await walkOffsetPages<number>(
      async (start) =>
        page(
          500,
          Array.from({ length: 100 }, (_, i) => start + i), // 100 rows despite limit 10
        ),
      { maxItems: 10 },
    );
    expect(out.items).toHaveLength(10);
    expect(out.truncated).toBe(true);
  });

  it('null rows are HIDDEN, not truncation — different problems, different remedies', async () => {
    const calls: number[] = [];
    const out = await walkOffsetPages<number>(
      async (start) => {
        calls.push(start);
        return page(3, [1, null, 2]);
      },
      { maxItems: 10_000 },
    );
    expect(out.items).toEqual([1, 2]);
    expect(calls).toEqual([0]);
    expect(out.hidden).toBe(1);
    expect(out.truncated).toBe(false);
  });

  it('the cursor advances by RAW rows — a short page must not skip the rows after it', async () => {
    const calls: number[] = [];
    const out = await walkOffsetPages<number>(
      async (start, limit) => {
        calls.push(start);
        const all = Array.from({ length: 120 }, (_, i) => i);
        return page(120, all.slice(start, start + Math.min(limit, 40)));
      },
      { maxItems: 10_000 },
    );
    expect(calls).toEqual([0, 40, 80]);
    expect(out.items).toHaveLength(120);
  });

  it('pages merely STARTING with a null row do not trip the no-progress guard', async () => {
    const all: (number | null)[] = Array.from({ length: 250 }, (_, i) => i);
    all[0] = null;
    all[100] = null;
    const out = await walkOffsetPages<number>(async (start, limit) => page(250, all.slice(start, start + limit)), {
      maxItems: 10_000,
    });
    expect(out.stalled).toBe(false);
    expect(out.items).toHaveLength(248);
    expect(out.hidden).toBe(2);
  });

  it('a server that stops advancing is caught and named STALLED, not written as duplicates', async () => {
    const calls: number[] = [];
    const out = await walkOffsetPages<number>(
      async (start) => {
        calls.push(start);
        return page(300, [1, 2, 3]);
      },
      { maxItems: 10_000 },
    );
    expect(calls).toHaveLength(2);
    expect(out.items).toEqual([1, 2, 3]);
    expect(out.stalled).toBe(true);
    expect(out.truncated).toBe(true);
  });

  it('a stuck server with a NULL total is still caught — mayHaveMore is not the only signal', async () => {
    const out = await walkOffsetPages<number>(async () => page(null, [1, 2, 3]), { maxItems: 10_000 });
    expect(out.stalled).toBe(true);
    expect(out.truncated).toBe(true); // the stall alone forces the flag
  });

  it('an all-null stream is bounded by the page ceiling, not an infinite loop', async () => {
    let calls = 0;
    const out = await walkOffsetPages<number>(
      async () => {
        calls += 1;
        return page<number>(null, [null, null, null]);
      },
      { maxItems: 10_000 },
    );
    expect(calls).toBeLessThanOrEqual(200);
    expect(out.items).toEqual([]);
    expect(out.hidden).toBeGreaterThan(0);
  });
});
