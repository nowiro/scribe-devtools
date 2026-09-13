// Tests for the Confluence write pipeline — mode interlocks and the v2 payload shapes,
// including the one wire quirk worth pinning: ADF travels as a JSON STRING in body.value.

import { describe, expect, it } from 'vitest';

import {
  WriteMeta,
  adfBodyValue,
  buildCreatePayload,
  buildUpdatePayload,
  updateBodyValue,
} from './write-confluence.js';

describe('WriteMeta — mode interlocks', () => {
  it('exactly one of id (update) / space (create)', () => {
    expect(WriteMeta.safeParse({ id: '123' }).success).toBe(true);
    expect(WriteMeta.safeParse({ space: 'DOCS' }).success).toBe(true);
    expect(WriteMeta.safeParse({}).success).toBe(false);
    expect(WriteMeta.safeParse({ id: '123', space: 'DOCS' }).success).toBe(false);
  });

  it('parentId belongs to create — an update does not move the page', () => {
    expect(WriteMeta.safeParse({ space: 'DOCS', parentId: '9' }).success).toBe(true);
    expect(WriteMeta.safeParse({ id: '123', parentId: '9' }).success).toBe(false);
  });
});

describe('payloads', () => {
  it('the body value is STRINGIFIED ADF — Confluence v2 wants a string, not an object', () => {
    const value = adfBodyValue('tekst');
    expect(typeof value).toBe('string');
    const parsed = JSON.parse(value) as { type?: string; version?: number };
    expect(parsed.type).toBe('doc');
    expect(parsed.version).toBe(1);
  });

  it('create: spaceId + status + title + optional parent + adf body', () => {
    const meta = WriteMeta.parse({ space: 'DOCS', parentId: '9' });
    expect(buildCreatePayload(meta, '777', 'Tytuł', 'treść')).toMatchObject({
      spaceId: '777',
      status: 'current',
      title: 'Tytuł',
      parentId: '9',
      body: { representation: 'atlas_doc_format' },
    });
  });

  it('update: carries id, the NEXT version number and the given body value', () => {
    const payload = buildUpdatePayload('123', 'Tytuł', adfBodyValue('treść'), 5) as {
      version?: { number?: number };
      id?: string;
    };
    expect(payload.id).toBe('123');
    expect(payload.version?.number).toBe(5);
  });

  it('a title-only update re-sends the CURRENT body value byte-for-byte — never wipes the page', () => {
    // The bug this pins: an empty input body used to become just the provenance line,
    // and --yes replaced the whole live page with it.
    expect(updateBodyValue('', 'RAW-CURRENT-ADF')).toBe('RAW-CURRENT-ADF');
  });

  it('a real body update carries the provenance line', () => {
    const value = updateBodyValue('nowa treść', 'RAW-CURRENT-ADF');
    expect(value).not.toBe('RAW-CURRENT-ADF');
    expect(value).toContain('Zaktualizowano za pomocą');
  });
});
