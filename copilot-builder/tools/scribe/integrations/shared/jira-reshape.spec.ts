import { describe, expect, it } from 'vitest';

import { reshapeJiraIssue } from './jira-reshape.js';
import type { FieldMeta, FieldRegistry } from './field-registry.js';

function fakeRegistry(map: Record<string, FieldMeta>): FieldRegistry {
  return {
    async load() {
      /* noop */
    },
    byId(id) {
      return map[id];
    },
    ready() {
      return true;
    },
  };
}

describe('reshapeJiraIssue', () => {
  it('keeps the key + id', () => {
    const out = reshapeJiraIssue({ id: '1', key: 'ABC-1' }, fakeRegistry({}));
    expect(out.key).toBe('ABC-1');
    expect(out.id).toBe('1');
  });

  it('extracts summary, status, issueType, priority', () => {
    const out = reshapeJiraIssue(
      {
        id: '1',
        key: 'ABC-1',
        fields: {
          summary: 'Fix the thing',
          status: { id: '10000', name: 'Done' },
          issuetype: { id: '1', name: 'Bug' },
          priority: { id: '3', name: 'Medium' },
        },
      },
      fakeRegistry({}),
    );
    expect(out.summary).toBe('Fix the thing');
    expect(out.status).toEqual({ id: '10000', name: 'Done' });
    expect(out.issueType).toEqual({ id: '1', name: 'Bug' });
    expect(out.priority).toEqual({ id: '3', name: 'Medium' });
  });

  it('parent and subtasks become first-class references, NOT custom-field noise', () => {
    const out = reshapeJiraIssue(
      {
        id: '1',
        key: 'ABC-2',
        fields: {
          parent: {
            key: 'ABC-1',
            fields: { summary: 'Epic thing', status: { name: 'In Progress' }, issuetype: { name: 'Epic' } },
          },
          subtasks: [
            { key: 'ABC-3', fields: { summary: 'Step one', status: { name: 'Done' }, issuetype: { name: 'Subtask' } } },
            { key: 'ABC-4', fields: { summary: 'Step two' } },
          ],
        },
      },
      fakeRegistry({}),
    );
    expect(out.parent).toEqual({ key: 'ABC-1', summary: 'Epic thing', status: 'In Progress', type: 'Epic' });
    expect(out.subtasks).toEqual([
      { key: 'ABC-3', summary: 'Step one', status: 'Done', type: 'Subtask' },
      { key: 'ABC-4', summary: 'Step two' },
    ]);
    // The whole point: they used to land here as raw JSON blobs.
    expect(out.customFields).toBeUndefined();
  });

  it('an id-only parent (permission-narrowed) keeps the relationship instead of vanishing', () => {
    const out = reshapeJiraIssue({ id: '1', key: 'ABC-2', fields: { parent: { id: '10010' } } }, fakeRegistry({}));
    // SYSTEM_FIELDS bars the custom-dump fallback, so the id is the last identity we have.
    expect(out.parent).toEqual({ key: '10010' });
    expect(out.customFields).toBeUndefined();
  });

  it('renders ADF description to Markdown', () => {
    const out = reshapeJiraIssue(
      {
        id: '1',
        key: 'ABC-1',
        fields: {
          description: {
            type: 'doc',
            content: [
              { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Goal' }] },
              { type: 'paragraph', content: [{ type: 'text', text: 'Ship it.' }] },
            ],
          },
        },
      },
      fakeRegistry({}),
    );
    expect(out.descriptionMd).toContain('# Goal');
    expect(out.descriptionMd).toContain('Ship it.');
  });

  it('maps known customfield IDs to readable names', () => {
    const registry = fakeRegistry({
      customfield_10016: { id: 'customfield_10016', name: 'Story Points', type: 'number' },
    });
    const out = reshapeJiraIssue(
      {
        id: '1',
        key: 'ABC-1',
        fields: { customfield_10016: 5 },
      },
      registry,
    );
    expect(out.customFields).toHaveLength(1);
    expect(out.customFields?.[0]).toEqual({
      id: 'customfield_10016',
      name: 'Story Points',
      type: 'number',
      value: 5,
    });
  });

  it('still emits unknown custom fields with the raw id (no metadata available)', () => {
    const out = reshapeJiraIssue(
      {
        id: '1',
        key: 'ABC-1',
        fields: { customfield_99999: 'something' },
      },
      fakeRegistry({}),
    );
    expect(out.customFields).toHaveLength(1);
    // The id is the whole point of this case: without metadata it is the only
    // handle left that still identifies the field to the API. It used to be
    // replaced with the literal 'unknown', and this test asserted everything
    // EXCEPT the id, so the loss went unnoticed.
    expect(out.customFields?.[0]).toEqual({
      id: 'customfield_99999',
      name: 'customfield_99999',
      type: 'unknown',
      value: 'something',
    });
  });

  it('drops null / empty array fields from customFields output', () => {
    const out = reshapeJiraIssue(
      {
        id: '1',
        key: 'ABC-1',
        fields: { customfield_1: null, customfield_2: [], customfield_3: 'kept' },
      },
      fakeRegistry({}),
    );
    expect(out.customFields).toHaveLength(1);
  });

  it('keeps a very long description IN FULL — the MCP-era 8000-char cap silently lost data', () => {
    const longText = 'x'.repeat(20_000);
    const out = reshapeJiraIssue(
      {
        id: '1',
        key: 'ABC-1',
        fields: {
          description: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: longText }] }] },
        },
      },
      fakeRegistry({}),
    );
    expect(out.descriptionMd).toContain(longText);
  });

  it('omits description field when ADF renders to empty', () => {
    const out = reshapeJiraIssue(
      {
        id: '1',
        key: 'ABC-1',
        fields: { description: null },
      },
      fakeRegistry({}),
    );
    expect(out.descriptionMd).toBeUndefined();
  });

  it('extracts assignee + reporter as {accountId, displayName}', () => {
    const out = reshapeJiraIssue(
      {
        id: '1',
        key: 'ABC-1',
        fields: {
          assignee: { accountId: 'aid1', displayName: 'Alice' },
          reporter: { accountId: 'aid2', displayName: 'Bob' },
        },
      },
      fakeRegistry({}),
    );
    expect(out.assignee).toEqual({ accountId: 'aid1', displayName: 'Alice' });
    expect(out.reporter).toEqual({ accountId: 'aid2', displayName: 'Bob' });
  });

  it('serialises keys in a deterministic order (key → id → identity → metadata → body → custom)', () => {
    const out = reshapeJiraIssue(
      {
        id: '1',
        key: 'ABC-1',
        self: 'https://acme.atlassian.net/rest/api/3/issue/1',
        fields: {
          summary: 'Fix the thing',
          status: { id: '10000', name: 'Done' },
          issuetype: { id: '1', name: 'Bug' },
          priority: { id: '3', name: 'Medium' },
          assignee: { accountId: 'aid1', displayName: 'Alice' },
          reporter: { accountId: 'aid2', displayName: 'Bob' },
          labels: ['p1'],
          created: '2026-05-15T10:00:00.000Z',
          updated: '2026-05-16T10:00:00.000Z',
          customfield_999: 'whatever',
        },
      },
      fakeRegistry({}),
    );
    expect(Object.keys(out)).toEqual([
      'key',
      'id',
      'url',
      'summary',
      'status',
      'issueType',
      'priority',
      'assignee',
      'reporter',
      'labels',
      'created',
      'updated',
      'customFields',
    ]);
  });
});
