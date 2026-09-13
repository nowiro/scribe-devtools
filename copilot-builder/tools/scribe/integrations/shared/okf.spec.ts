/**
 * Tests for the OKF writer (`shared/okf.ts`): frontmatter quoting (including the
 * newline/`---` injection from upstream titles), index §6/§11, log §7 (newest-first,
 * prior normalization), writer end-to-end with the path-traversal guard.
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import { renderFormatsSchema, renderFormatsWithOkfSchema } from './read-runtime.js';
import {
  insertOkfLogEntry,
  okfFrontmatter,
  okfScalar,
  renderOkfConcept,
  renderOkfIndex,
  writeOkfBundle,
  type OkfConceptInput,
} from './okf.js';

function parseFm(content: string): Record<string, unknown> {
  expect(content.startsWith('---\n')).toBe(true);
  const end = content.indexOf('\n---\n', 4);
  expect(end).toBeGreaterThan(0);
  return parse(content.slice(4, end + 1)) as Record<string, unknown>;
}

const CONCEPT: OkfConceptInput = {
  slug: 'PROJ-1',
  type: 'Jira Issue',
  title: 'PROJ-1 — apostrophe \' and "quotes"',
  description: 'Description.',
  resource: 'https://example.atlassian.net/browse/PROJ-1',
  tags: ['bug', 'p1'],
  extra: [['issue_key', 'PROJ-1']],
  body: '# PROJ-1\n\nBody.\n',
};

describe('okfScalar / okfFrontmatter', () => {
  it('quotes plain values single, quote-bearing values double', () => {
    expect(okfScalar('plain text')).toBe("'plain text'");
    expect(okfScalar("with 'apostrophes'")).toBe('"with \'apostrophes\'"');
  });

  it('escapes control characters — a newline/--- injection stays one safe scalar', () => {
    const hostile = 'Title\n---\ninjected_key: pwned';
    const fm = parseFm(
      `${okfFrontmatter([
        ['type', 'X'],
        ['title', hostile],
      ])}\nbody\n`,
    );
    expect(fm['title']).toBe(hostile);
    expect(fm['injected_key']).toBeUndefined();
  });
});

describe('renderOkfConcept', () => {
  it('emits parseable frontmatter with the contracted field order and the body verbatim', () => {
    const content = renderOkfConcept(CONCEPT, '2026-07-23');
    const fm = parseFm(content);
    expect(fm['type']).toBe('Jira Issue');
    expect(fm['title']).toBe(CONCEPT.title);
    expect(fm['resource']).toBe(CONCEPT.resource);
    expect(fm['tags']).toEqual(['bug', 'p1']);
    expect(fm['timestamp']).toBe('2026-07-23');
    expect(fm['issue_key']).toBe('PROJ-1');
    expect(content.endsWith('# PROJ-1\n\nBody.\n')).toBe(true);
  });
});

describe('renderOkfIndex (§6/§11)', () => {
  it('frontmatter is EXACTLY okf_version; titles are flattened in the listing', () => {
    const multiline: OkfConceptInput = { ...CONCEPT, slug: 'PROJ-2', title: 'line\nsecond' };
    const content = renderOkfIndex({
      source: 'jira',
      snapshotName: 'sprint-42',
      conceptsDir: 'issues',
      concepts: [CONCEPT, multiline],
    });
    expect(parseFm(content)).toEqual({ okf_version: '0.1' });
    expect(content).toContain('[issues/PROJ-1.md](issues/PROJ-1.md)');
    expect(content).toContain('— line second');
    expect(content).toContain('## Concepts (2)');
  });
});

describe('insertOkfLogEntry (§7 newest-first)', () => {
  const ENTRY = {
    stamp: '2026-07-23',
    source: 'jira',
    snapshotName: 'sprint-42',
    conceptCount: 2,
    toolVersion: '1.2.0',
  };

  it('fresh log = header + entry with a pure ISO heading', () => {
    const log = insertOkfLogEntry(ENTRY);
    expect(log.startsWith('---\n')).toBe(true);
    expect(log).toContain('## 2026-07-23');
    expect(log).not.toContain('## 2026-07-23 —');
    expect(log).toContain('**extract**');
  });

  it('inserts above prior entries and preserves them; prior is normalized (BOM/CRLF/empty)', () => {
    const first = insertOkfLogEntry(ENTRY);
    const bom = String.fromCharCode(0xfeff);
    const second = insertOkfLogEntry({ ...ENTRY, stamp: '2026-07-24' }, bom + first.replaceAll('\n', '\r\n'));
    expect(second).not.toContain('\r');
    expect(second.indexOf('## 2026-07-24')).toBeLessThan(second.indexOf('## 2026-07-23'));
    expect(insertOkfLogEntry(ENTRY, '   \n').startsWith('---\n')).toBe(true);
  });
});

describe('writeOkfBundle', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'extract-okf-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const ARGS = {
    source: 'jira',
    snapshotName: 'sprint-42',
    conceptsDir: 'issues',
    concepts: [CONCEPT],
    stamp: '2026-07-23',
    toolVersion: '1.2.0',
  };

  it('writes index + log + concepts; a rerun grows the log newest-first', async () => {
    expect(await writeOkfBundle({ snapshotDir: dir, ...ARGS })).toBe(1);
    const index = await readFile(join(dir, 'knowledge', 'index.md'), 'utf8');
    expect(parseFm(index)).toEqual({ okf_version: '0.1' });
    expect(parseFm(await readFile(join(dir, 'knowledge', 'issues', 'PROJ-1.md'), 'utf8'))['type']).toBe('Jira Issue');

    await writeOkfBundle({ snapshotDir: dir, ...ARGS, stamp: '2026-07-24' });
    const log = await readFile(join(dir, 'knowledge', 'log.md'), 'utf8');
    expect(log.indexOf('## 2026-07-24')).toBeLessThan(log.indexOf('## 2026-07-23'));
  });

  it('rejects a path-traversal slug from a hostile upstream', async () => {
    await expect(
      writeOkfBundle({
        snapshotDir: dir,
        ...ARGS,
        concepts: [{ ...CONCEPT, slug: '../evil' }],
      }),
    ).rejects.toThrow(/path-traversal/);
  });
});

describe('render schema split (okf only for jira/confluence)', () => {
  it('base schema rejects okf loudly; the okf-capable variant accepts it', () => {
    expect(() => renderFormatsSchema.parse(['okf'])).toThrow();
    expect(renderFormatsWithOkfSchema.parse(['json', 'okf'])).toEqual(['json', 'okf']);
  });
});
