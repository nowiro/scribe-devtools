// Tests for the Jira write pipeline: the mode rules of the front matter (the safety
// interlocks) and the exact payloads that would reach the API. HTTP itself is not mocked
// here — the builders are pure, and the payload IS the contract.

import { describe, expect, it } from 'vitest';

import { markdownToAdf } from '../shared/markdown-to-adf.js';
import { WriteMeta, buildCreatePayload, buildUpdatePayload } from './write-jira.js';

describe('WriteMeta — mode interlocks', () => {
  it('create mode: project + type, no key', () => {
    expect(WriteMeta.safeParse({ project: 'PROJ', type: 'Task' }).success).toBe(true);
  });

  it('update mode: key alone', () => {
    expect(WriteMeta.safeParse({ key: 'PROJ-123' }).success).toBe(true);
  });

  it('comment mode: key + comment, and NOTHING else', () => {
    expect(WriteMeta.safeParse({ key: 'PROJ-123', comment: true }).success).toBe(true);
    expect(WriteMeta.safeParse({ comment: true }).success).toBe(false);
    expect(WriteMeta.safeParse({ key: 'PROJ-123', comment: true, labels: ['x'] }).success).toBe(false);
  });

  it('key together with project/type is rejected — one file, one mode', () => {
    expect(WriteMeta.safeParse({ key: 'PROJ-1', project: 'PROJ', type: 'Task' }).success).toBe(false);
  });

  it('neither key nor project+type is rejected', () => {
    expect(WriteMeta.safeParse({}).success).toBe(false);
    expect(WriteMeta.safeParse({ project: 'PROJ' }).success).toBe(false);
    // `type` alone IS valid: the project may come from the JIRA_PROJECT /
    // jira.project default — main() fails loudly when all sources are absent.
    expect(WriteMeta.safeParse({ type: 'Task' }).success).toBe(true);
  });

  it('an unknown key is rejected by name (strict schema)', () => {
    const out = WriteMeta.safeParse({ key: 'PROJ-1', projekt: 'X' });
    expect(out.success).toBe(false);
  });
});

describe('payload builders', () => {
  const adf = markdownToAdf('treść');

  it('create: project/type/summary/description plus the optional fields', () => {
    const meta = WriteMeta.parse({ project: 'PROJ', type: 'Bug', labels: ['reports'], priority: 'High' });
    expect(buildCreatePayload(meta, 'Tytuł', adf)).toEqual({
      fields: {
        project: { key: 'PROJ' },
        issuetype: { name: 'Bug' },
        summary: 'Tytuł',
        description: adf,
        labels: ['reports'],
        priority: { name: 'High' },
      },
    });
  });

  it('a subtask: type Subtask + first-class `parent:` — validated at parse, shaped in the payload', () => {
    const meta = WriteMeta.parse({ project: 'PROJ', type: 'Subtask', parent: 'PROJ-1' });
    const payload = buildCreatePayload(meta, 'Krok', adf) as { fields: Record<string, unknown> };
    expect(payload.fields['issuetype']).toEqual({ name: 'Subtask' });
    expect(payload.fields['parent']).toEqual({ key: 'PROJ-1' });
  });

  it('parent belongs to create mode — an update file naming it is refused at parse', () => {
    expect(WriteMeta.safeParse({ key: 'PROJ-2', parent: 'PROJ-1' }).success).toBe(false);
  });

  it('a malformed parent key is a parse error, not a post-dry-run 400 from Jira', () => {
    expect(WriteMeta.safeParse({ project: 'PROJ', type: 'Subtask', parent: 'not a key' }).success).toBe(false);
  });

  it('parent set twice (modelled + raw fields) is refused — `fields` would silently win', () => {
    const out = WriteMeta.safeParse({
      project: 'PROJ',
      type: 'Subtask',
      parent: 'PROJ-1',
      fields: { parent: 'PROJ-2' },
    });
    expect(out.success).toBe(false);
  });

  it('raw `fields` pass through verbatim and WIN over the modelled ones', () => {
    const meta = WriteMeta.parse({
      project: 'PROJ',
      type: 'Task',
      labels: ['a'],
      fields: { customfield_10011: 'Sprint 42', labels: ['b'] },
    });
    const payload = buildCreatePayload(meta, 'T', adf) as { fields: Record<string, unknown> };
    expect(payload.fields['customfield_10011']).toBe('Sprint 42');
    expect(payload.fields['labels']).toEqual(['b']);
  });

  it('update: only what the file actually carries lands in the payload', () => {
    const meta = WriteMeta.parse({ key: 'PROJ-1' });
    expect(buildUpdatePayload(meta, undefined, adf)).toEqual({ fields: { description: adf } });
    expect(buildUpdatePayload(meta, 'Nowy tytuł', undefined)).toEqual({ fields: { summary: 'Nowy tytuł' } });
  });
});
