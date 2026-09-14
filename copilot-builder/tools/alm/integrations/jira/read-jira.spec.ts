/**
 * Tests for the deterministic parts of `read-jira.ts`:
 *   - config schema (ReadConfig) — defaults, validation
 *   - Markdown renderer (renderIssueMarkdown) — pure function, deterministic
 *   - fixture roundtrip for `buildExtractedIssue` — the guard of output shape
 *     determinism (every change in reshape / extras assembly = a diff in the
 *     inline snapshot)
 *
 * Does NOT test the HTTP / auth layer — that is integration territory requiring
 * a mock of the full http-client (a separate integration test once one is needed).
 */
import { describe, expect, it } from 'vitest';

import {
  buildExtractedIssue,
  buildIssueConcept,
  DEFAULT_OUTPUT_DIR,
  fetchFullChangelog,
  ReadConfig,
  renderIssueMarkdown,
  type ExtractedIssue,
  type RawIssue,
} from './read-jira.js';
import type { FieldRegistry } from '../shared/field-registry.js';

describe('ReadConfig (Jira)', () => {
  it('rejects an unknown key rather than dropping it in silence', () => {
    // `maxIssue` for `maxIssues` used to be stripped and the run quietly pulled
    // the default 1000 issues instead of the 5 that were asked for.
    expect(() => ReadConfig.parse({ snapshots: [{ name: 'a', jql: 'project = X', maxIssue: 5 }] })).toThrow(/maxIssue/);
    expect(() => ReadConfig.parse({ outputDirs: './x', snapshots: [{ name: 'a', jql: 'project = X' }] })).toThrow(
      /outputDirs/,
    );
  });

  it('rejects an unknown key inside the nested include block', () => {
    expect(() =>
      ReadConfig.parse({ snapshots: [{ name: 'a', jql: 'project = X', include: { changelogs: true } }] }),
    ).toThrow(/changelogs/);
  });

  it('parses minimal config — fills defaults', () => {
    const parsed = ReadConfig.parse({
      snapshots: [{ name: 'a', jql: 'project = X' }],
    });
    expect(parsed.outputDir).toBe(DEFAULT_OUTPUT_DIR);
    expect(DEFAULT_OUTPUT_DIR).toBe('./.alm/jira');
    const [snap] = parsed.snapshots;
    if (!snap) throw new Error('expected snapshot');
    expect(snap.maxIssues).toBe(1000);
    expect(snap.render).toEqual(['json', 'markdown']);
    expect(snap.include).toEqual({
      changelog: true,
      comments: true,
      worklog: true,
      attachments: true,
    });
  });

  it('rejects snapshot name with uppercase / spaces', () => {
    expect(() => ReadConfig.parse({ snapshots: [{ name: 'Active Bugs', jql: 'x' }] })).toThrow();
    expect(() => ReadConfig.parse({ snapshots: [{ name: 'ActiveBugs', jql: 'x' }] })).toThrow();
  });

  it('rejects empty jql', () => {
    expect(() => ReadConfig.parse({ snapshots: [{ name: 'a', jql: '' }] })).toThrow();
  });

  it('rejects empty render array', () => {
    expect(() => ReadConfig.parse({ snapshots: [{ name: 'a', jql: 'x', render: [] }] })).toThrow();
  });

  it('rejects maxIssues out of bounds', () => {
    expect(() => ReadConfig.parse({ snapshots: [{ name: 'a', jql: 'x', maxIssues: 0 }] })).toThrow();
    expect(() => ReadConfig.parse({ snapshots: [{ name: 'a', jql: 'x', maxIssues: 20_000 }] })).toThrow();
  });

  it('accepts partial include — fills missing flags with true', () => {
    const parsed = ReadConfig.parse({
      snapshots: [{ name: 'a', jql: 'x', include: { comments: false } }],
    });
    const [snap] = parsed.snapshots;
    if (!snap) throw new Error('expected snapshot');
    expect(snap.include).toEqual({
      changelog: true,
      comments: false,
      worklog: true,
      attachments: true,
    });
  });
});

describe('renderIssueMarkdown', () => {
  const minimalIssue: ExtractedIssue = {
    key: 'ABC-123',
    id: '10001',
    summary: 'Investigate login flakiness',
    status: { id: '3', name: 'In Progress' },
    issueType: { id: '1', name: 'Bug' },
    priority: { id: '2', name: 'High' },
    assignee: { accountId: 'a-1', displayName: 'Jane Doe' },
    reporter: { accountId: 'a-2', displayName: 'John Smith' },
    created: '2026-05-01T10:00:00Z',
    updated: '2026-05-22T14:00:00Z',
    labels: ['auth', 'flaky'],
  };

  it('produces a header with key and summary', () => {
    const md = renderIssueMarkdown(minimalIssue);
    expect(md).toMatch(/^# ABC-123 — Investigate login flakiness/);
  });

  it('renders all primary fields', () => {
    const md = renderIssueMarkdown(minimalIssue);
    expect(md).toContain('**Status**: In Progress');
    expect(md).toContain('**Type**: Bug');
    expect(md).toContain('**Priority**: High');
    expect(md).toContain('**Assignee**: Jane Doe');
    expect(md).toContain('**Reporter**: John Smith');
    expect(md).toContain('**Created**: 2026-05-01T10:00:00Z');
    expect(md).toContain('**Updated**: 2026-05-22T14:00:00Z');
    expect(md).toContain('**Labels**: auth, flaky');
  });

  it('shows em-dash for missing fields rather than "undefined"', () => {
    const sparseIssue: ExtractedIssue = { key: 'X-1', id: '1' };
    const md = renderIssueMarkdown(sparseIssue);
    expect(md).toContain('**Status**: —');
    expect(md).not.toContain('undefined');
  });

  it('parent and subtasks render through ONE line shape — key, summary, (Type, Status)', () => {
    const issue: ExtractedIssue = {
      ...minimalIssue,
      parent: { key: 'ABC-100', summary: 'Epic thing', status: 'Done', type: 'Epic' },
      subtasks: [{ key: 'ABC-124', summary: 'Step one', status: 'To Do', type: 'Subtask' }, { key: 'ABC-125' }],
    };
    const md = renderIssueMarkdown(issue);
    expect(md).toContain('- **Parent**: **ABC-100** — Epic thing (Epic, Done)');
    expect(md).toContain('## Subtasks');
    expect(md).toContain('- **ABC-124** — Step one (Subtask, To Do)');
    expect(md).toContain('- **ABC-125**');
  });

  it('a newline smuggled into a summary cannot split the heading', () => {
    const md = renderIssueMarkdown({ ...minimalIssue, summary: 'Line one\n## Injected' });
    expect(md).toMatch(/^# ABC-123 — Line one ## Injected/);
  });

  it('renders descriptionMd — which now always carries the FULL text', () => {
    const issue: ExtractedIssue = {
      ...minimalIssue,
      descriptionMd: 'full long description with all details',
    };
    const md = renderIssueMarkdown(issue);
    expect(md).toContain('full long description with all details');
  });

  it('renders comments section when comments present', () => {
    const issue: ExtractedIssue = {
      ...minimalIssue,
      comments: [
        { id: 'c1', author: 'Alice', created: '2026-05-10T09:00:00Z', bodyMd: 'Looking into this' },
        { id: 'c2', author: 'Bob', created: '2026-05-11T11:00:00Z', bodyMd: 'Confirmed reproduction' },
      ],
    };
    const md = renderIssueMarkdown(issue);
    expect(md).toContain('## Comments');
    expect(md).toContain('Alice — 2026-05-10T09:00:00Z');
    expect(md).toContain('Looking into this');
    expect(md).toContain('Bob — 2026-05-11T11:00:00Z');
  });

  it('renders changelog section with field-level changes', () => {
    const issue: ExtractedIssue = {
      ...minimalIssue,
      changelog: [
        {
          id: 'h1',
          created: '2026-05-15T08:00:00Z',
          author: 'Jane Doe',
          changes: [{ field: 'status', from: 'To Do', to: 'In Progress' }],
        },
      ],
    };
    const md = renderIssueMarkdown(issue);
    expect(md).toContain('## Changelog');
    expect(md).toContain('**status**: `To Do` → `In Progress`');
  });

  it('skips sections when their data is absent', () => {
    const md = renderIssueMarkdown(minimalIssue);
    expect(md).not.toContain('## Comments');
    expect(md).not.toContain('## Worklog');
    expect(md).not.toContain('## Changelog');
    expect(md).not.toContain('## Attachments');
    expect(md).not.toContain('## Custom fields');
  });

  it('is deterministic — identical input produces identical output', () => {
    const issue: ExtractedIssue = {
      ...minimalIssue,
      comments: [{ id: 'c1', author: 'Alice', created: '2026-05-10T09:00:00Z', bodyMd: 'body' }],
      changelog: [
        {
          id: 'h1',
          created: '2026-05-15T08:00:00Z',
          author: 'Jane',
          changes: [{ field: 'status', from: 'a', to: 'b' }],
        },
      ],
    };
    const first = renderIssueMarkdown(issue);
    const second = renderIssueMarkdown(issue);
    expect(first).toBe(second);
  });
});

// ── Fixture roundtrip — the guard of the output shape ──────────────────────

/** Mock registry — returns undefined for every ID, so custom fields
 *  use the ID as the name (deterministic without reaching for upstream). */
const mockRegistry: FieldRegistry = {
  load: () => Promise.resolve(),
  byId: () => undefined,
  ready: () => true,
};

const minimalSnapshotMaybe = ReadConfig.parse({
  snapshots: [{ name: 'fixture', jql: 'project = X' }],
}).snapshots[0];
if (!minimalSnapshotMaybe) throw new Error('expected fixture snapshot');
const minimalSnapshot = minimalSnapshotMaybe;

describe('buildExtractedIssue — fixture roundtrip', () => {
  it('transforms minimal raw issue → canonical shape (snapshot)', () => {
    const raw: RawIssue = {
      id: '10001',
      key: 'ABC-123',
      self: 'https://example.atlassian.net/rest/api/3/issue/10001',
      fields: {
        summary: 'Sample issue',
        status: { id: '3', name: 'In Progress' },
        issuetype: { id: '1', name: 'Bug' },
        priority: { id: '2', name: 'High' },
        assignee: { accountId: 'a-1', displayName: 'Jane Doe' },
        reporter: { accountId: 'a-2', displayName: 'John Smith' },
        labels: ['frontend', 'flaky'],
        created: '2026-05-01T10:00:00.000Z',
        updated: '2026-05-22T14:00:00.000Z',
      },
    };

    const result = buildExtractedIssue(raw, mockRegistry, minimalSnapshot);

    expect(result).toMatchInlineSnapshot(`
      {
        "assignee": {
          "accountId": "a-1",
          "displayName": "Jane Doe",
        },
        "attachments": [],
        "created": "2026-05-01T10:00:00.000Z",
        "id": "10001",
        "issueType": {
          "id": "1",
          "name": "Bug",
        },
        "key": "ABC-123",
        "labels": [
          "frontend",
          "flaky",
        ],
        "priority": {
          "id": "2",
          "name": "High",
        },
        "reporter": {
          "accountId": "a-2",
          "displayName": "John Smith",
        },
        "status": {
          "id": "3",
          "name": "In Progress",
        },
        "summary": "Sample issue",
        "updated": "2026-05-22T14:00:00.000Z",
        "url": "https://example.atlassian.net/browse/ABC-123",
      }
    `);
  });

  it('transforms raw issue with ADF description → Markdown body', () => {
    const adfDescription = {
      type: 'doc',
      version: 1,
      content: [
        { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Repro' }] },
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Steps to reproduce ' },
            { type: 'text', text: 'the bug', marks: [{ type: 'strong' }] },
          ],
        },
      ],
    };

    const raw: RawIssue = {
      id: '10002',
      key: 'ABC-456',
      fields: {
        summary: 'With description',
        description: adfDescription,
      },
    };

    const result = buildExtractedIssue(raw, mockRegistry, minimalSnapshot);

    // The description went through adfToMarkdown — canonical MD
    expect(result.descriptionMd).toBeDefined();
    expect(result.descriptionMd).toContain('Repro');
    expect(result.descriptionMd).toContain('Steps to reproduce');
    // Bold marker
    expect(result.descriptionMd).toContain('**the bug**');
  });

  it('normalizes an embedded changelog through fetchFullChangelog — its single writer', async () => {
    const raw: RawIssue = {
      id: '10003',
      key: 'ABC-789',
      fields: { summary: 'With changelog' },
      changelog: {
        histories: [
          {
            id: 'h1',
            created: '2026-05-10T09:00:00.000Z',
            author: { accountId: 'a-1', displayName: 'Jane' },
            items: [
              { field: 'status', fromString: 'To Do', toString: 'In Progress' },
              { field: 'assignee', fromString: undefined, toString: 'Jane' },
            ],
          },
        ],
      },
    };

    // No `changelog.total` → the embedded page is complete and no request is made;
    // the stub throws to PROVE the fast path stays requestless.
    const http = {
      request: () => {
        throw new Error('the embedded fast path must not call upstream');
      },
    } as unknown as Parameters<typeof fetchFullChangelog>[0];
    const result = await fetchFullChangelog(http, 'ABC-789', raw);

    expect(result.truncated).toBe(false);
    expect(result.items).toMatchInlineSnapshot(`
      [
        {
          "author": "Jane",
          "changes": [
            {
              "field": "status",
              "from": "To Do",
              "to": "In Progress",
            },
            {
              "field": "assignee",
              "from": undefined,
              "to": "Jane",
            },
          ],
          "created": "2026-05-10T09:00:00.000Z",
          "id": "h1",
        },
      ]
    `);
  });

  it('transforms raw issue with attachments → normalized list', () => {
    const raw: RawIssue = {
      id: '10004',
      key: 'ABC-101',
      fields: {
        summary: 'With attachments',
        attachment: [
          {
            id: 'att-1',
            filename: 'screenshot.png',
            mimeType: 'image/png',
            size: 12_345,
            created: '2026-05-15T11:00:00.000Z',
            author: { accountId: 'a-1', displayName: 'Bob' },
            content: 'https://example.atlassian.net/secure/attachment/att-1/screenshot.png',
          },
        ],
      },
    };

    const result = buildExtractedIssue(raw, mockRegistry, minimalSnapshot);

    expect(result.attachments).toMatchInlineSnapshot(`
      [
        {
          "author": "Bob",
          "contentUrl": "https://example.atlassian.net/secure/attachment/att-1/screenshot.png",
          "created": "2026-05-15T11:00:00.000Z",
          "filename": "screenshot.png",
          "id": "att-1",
          "mimeType": "image/png",
          "size": 12345,
        },
      ]
    `);
  });

  it('respects snapshot.include flags — disabled extras are absent from output', () => {
    const snapshotMinimal = ReadConfig.parse({
      snapshots: [
        {
          name: 'minimal',
          jql: 'x',
          include: { changelog: false, comments: false, worklog: false, attachments: false },
        },
      ],
    }).snapshots[0];
    if (!snapshotMinimal) throw new Error('expected minimal snapshot');

    const raw: RawIssue = {
      id: '1',
      key: 'X-1',
      fields: { summary: 's', attachment: [{ id: 'a' }] },
      changelog: { histories: [{ id: 'h1', items: [] }] },
    };

    const result = buildExtractedIssue(raw, mockRegistry, snapshotMinimal);

    expect(result.changelog).toBeUndefined();
    expect(result.attachments).toBeUndefined();
  });

  it('two calls with same raw + same snapshot produce deep-equal output', () => {
    const raw: RawIssue = {
      id: '10001',
      key: 'ABC-123',
      fields: {
        summary: 's',
        status: { id: '1', name: 'Open' },
        labels: ['a', 'b'],
      },
    };
    const first = buildExtractedIssue(raw, mockRegistry, minimalSnapshot);
    const second = buildExtractedIssue(raw, mockRegistry, minimalSnapshot);
    expect(first).toEqual(second);
    // And what matters more — JSON-serialized bit-for-bit identical (key order matters)
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });
});

describe('buildIssueConcept (render okf)', () => {
  const issue: ExtractedIssue = {
    key: 'PROJ-7',
    id: '10007',
    url: 'https://example.atlassian.net/browse/PROJ-7',
    summary: 'Cart drops the discount',
    status: { id: '3', name: 'In Progress' },
    issueType: { id: '1', name: 'Bug' },
    priority: { id: '2', name: 'High' },
    labels: ['checkout'],
  };

  it('maps canonical metadata into frontmatter fields and renders the markdown body', () => {
    const concept = buildIssueConcept(issue);
    expect(concept.slug).toBe('PROJ-7');
    expect(concept.type).toBe('Jira Issue');
    expect(concept.title).toBe('PROJ-7 — Cart drops the discount');
    expect(concept.resource).toBe(issue.url);
    expect(concept.tags).toEqual(['checkout']);
    expect(concept.extra).toEqual([
      ['issue_key', 'PROJ-7'],
      ['status', 'In Progress'],
      ['issue_type', 'Bug'],
      ['priority', 'High'],
    ]);
    expect(concept.body).toContain('# PROJ-7 — Cart drops the discount');
  });

  it('degrades gracefully without optional fields (no resource/tags, fallback summary)', () => {
    const bare = buildIssueConcept({ key: 'PROJ-8', id: '10008' });
    expect(bare.title).toBe('PROJ-8 — (no summary)');
    expect(bare.resource).toBeUndefined();
    expect(bare.tags).toBeUndefined();
    expect(bare.extra).toEqual([['issue_key', 'PROJ-8']]);
  });

  it('parent is a scalar and subtasks an ARRAY in extra — a YAML list, not a joined string', () => {
    const concept = buildIssueConcept({
      ...issue,
      parent: { key: 'PROJ-1' },
      subtasks: [{ key: 'PROJ-8' }, { key: 'PROJ-9' }],
    });
    expect(concept.extra).toContainEqual(['parent', 'PROJ-1']);
    expect(concept.extra).toContainEqual(['subtasks', ['PROJ-8', 'PROJ-9']]);
  });
});

describe('ReadConfig render okf (Jira)', () => {
  it('accepts okf alongside per-resource formats', () => {
    const parsed = ReadConfig.parse({
      snapshots: [{ name: 's', jql: 'project = PROJ', render: ['json', 'markdown', 'okf'] }],
    });
    expect(parsed.snapshots[0]?.render).toEqual(['json', 'markdown', 'okf']);
  });
});
