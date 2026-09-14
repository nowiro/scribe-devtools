// Tests for the GitLab write pipeline — mode interlocks and the exact request bodies.

import { describe, expect, it } from 'vitest';

import { WriteMeta, buildCreatePayload, buildUpdatePayload, collectionPath, encodeProject } from './write-gitlab.js';

describe('WriteMeta — mode interlocks', () => {
  it('update: project + type + iid', () => {
    expect(WriteMeta.safeParse({ project: 'group/app', type: 'issue', iid: 4 }).success).toBe(true);
  });

  it('create mr: branches required; create issue: branches forbidden', () => {
    expect(WriteMeta.safeParse({ project: 'g/a', type: 'mr' }).success).toBe(false);
    expect(WriteMeta.safeParse({ project: 'g/a', type: 'mr', sourceBranch: 'f', targetBranch: 'main' }).success).toBe(
      true,
    );
    expect(WriteMeta.safeParse({ project: 'g/a', type: 'issue', sourceBranch: 'f' }).success).toBe(false);
  });

  it('comment: iid required, and only project/type/iid allowed', () => {
    expect(WriteMeta.safeParse({ project: 'g/a', type: 'mr', iid: 7, comment: true }).success).toBe(true);
    expect(WriteMeta.safeParse({ project: 'g/a', type: 'mr', comment: true }).success).toBe(false);
    expect(WriteMeta.safeParse({ project: 'g/a', type: 'mr', iid: 7, comment: true, labels: ['x'] }).success).toBe(
      false,
    );
  });

  it('iid together with branches is rejected — update does not re-point an MR', () => {
    expect(
      WriteMeta.safeParse({ project: 'g/a', type: 'mr', iid: 7, sourceBranch: 'f', targetBranch: 'main' }).success,
    ).toBe(false);
  });
});

describe('paths', () => {
  it('a project path is URL-encoded; a numeric id passes through', () => {
    expect(encodeProject('group/app')).toBe('group%2Fapp');
    expect(encodeProject('42')).toBe('42');
  });

  it('the collection path follows the type', () => {
    expect(collectionPath({ ...WriteMeta.parse({ type: 'issue', iid: 1 }), project: 'g/a' })).toBe(
      '/projects/g%2Fa/issues',
    );
    expect(collectionPath({ ...WriteMeta.parse({ type: 'mr', iid: 1 }), project: 'g/a' })).toBe(
      '/projects/g%2Fa/merge_requests',
    );
  });

  it('project may come from the DEFAULT — the schema alone no longer requires it', () => {
    // main() resolves front matter ?? GITLAB_PROJECT ?? gitlab.project and fails
    // loudly when all three are absent; at parse time the file is already valid.
    expect(WriteMeta.safeParse({ type: 'issue', iid: 4 }).success).toBe(true);
  });
});

describe('payload builders', () => {
  it('create mr: branches, joined labels, Draft: prefix from the draft flag', () => {
    const meta = WriteMeta.parse({
      project: 'g/a',
      type: 'mr',
      sourceBranch: 'feat/x',
      targetBranch: 'main',
      draft: true,
      labels: ['team::reports', 'severity::2'],
    });
    expect(buildCreatePayload(meta, 'Tytuł', 'opis')).toEqual({
      title: 'Draft: Tytuł',
      description: 'opis',
      labels: 'team::reports,severity::2',
      source_branch: 'feat/x',
      target_branch: 'main',
    });
  });

  it('raw `fields` pass through verbatim and win', () => {
    const meta = WriteMeta.parse({ project: 'g/a', type: 'issue', fields: { milestone_id: 3, weight: 5 } });
    const payload = buildCreatePayload(meta, 'T', '');
    expect(payload['milestone_id']).toBe(3);
    expect(payload['weight']).toBe(5);
    expect(payload['description']).toBeUndefined();
  });

  it('update carries only what the file carries', () => {
    const meta = WriteMeta.parse({ project: 'g/a', type: 'issue', iid: 9 });
    expect(buildUpdatePayload(meta, undefined, 'nowy opis')).toEqual({ description: 'nowy opis' });
    expect(buildUpdatePayload(meta, 'Nowy tytuł', undefined)).toEqual({ title: 'Nowy tytuł' });
  });
});
