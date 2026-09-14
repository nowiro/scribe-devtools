/**
 * Tests for the deterministic parts of `read-gitlab.ts`.
 *
 * The pure surface checked here without a token and without the network: the config schema,
 * the three Markdown renderers, and `listAll` — exported precisely so its pagination can be
 * pinned against a stubbed http client (the block at the bottom says why that mattered).
 *
 * What each group guards, and why exactly that:
 *
 *  1. **The config schema** — each snapshot type carries its own ceiling and its own state
 *     vocabulary (`merged` exists only for MRs; `pipelines` stops at 2000, not 10 000). The config
 *     is written by hand and read once at start-up, so anything it lets through is paid for with a
 *     full upstream run before it shows.
 *  2. **`render: ['okf']`** — GitLab sits on the base format schema on purpose (see the comment in
 *     `shared/read-runtime.ts`): it has no OKF writer. Were the union to quietly gain `okf`, the
 *     config would parse and the pipeline would silently emit nothing.
 *  3. **The renderers** — the only human-readable output, and pure, so what is worth pinning are
 *     the DECISIONS: which line appears at all, in what order, and what stands in for a field
 *     upstream did not send. Never the whole document: a full-text snapshot breaks on every
 *     wording change and stops meaning anything the same day it is written.
 */
import { describe, expect, it } from 'vitest';

import {
  ReadConfig,
  listAll,
  renderIssueMarkdown,
  renderMrMarkdown,
  renderPipelineMarkdown,
  type ExtractedIssue,
  type ExtractedMr,
  type ExtractedPipeline,
} from './read-gitlab.js';

// ── Config schema ────────────────────────────────────────────────────────────

/** Parses a one-snapshot config and hands back that snapshot — the wrapper is not the subject. */
function parseSnapshot(snapshot: Record<string, unknown>) {
  const [snap] = ReadConfig.parse({ snapshots: [snapshot] }).snapshots;
  if (!snap) throw new Error('expected a parsed snapshot');
  return snap;
}

/** The parse of a one-snapshot config, as a thunk for `expect(...).toThrow()`. */
function parsing(snapshot: Record<string, unknown>): () => unknown {
  return () => ReadConfig.parse({ snapshots: [snapshot] });
}

const ISSUES = { name: 'open-bugs', type: 'issues', projectId: 'group/sub/app' } as const;
const MRS = { name: 'open-mrs', type: 'mrs', projectId: '4242' } as const;
const PIPELINES = { name: 'recent-pipelines', type: 'pipelines', projectId: '4242' } as const;

describe('ReadConfig (GitLab)', () => {
  it('defaults the output root, so a config only has to name the scope', () => {
    expect(ReadConfig.parse({ snapshots: [ISSUES] }).outputDir).toBe('./.alm/gitlab');
  });

  it('gives each snapshot type its own defaults — the expensive fetches are the ones opted into', () => {
    // notes are on by default (cheap, one call per item), MR changes are off (one more call per
    // MR, and most triage never opens the diff).
    expect(parseSnapshot({ ...ISSUES })).toMatchObject({
      state: 'all',
      maxItems: 500,
      includeNotes: true,
      render: ['json', 'markdown'],
    });
    expect(parseSnapshot({ ...MRS })).toMatchObject({
      state: 'all',
      maxItems: 500,
      includeNotes: true,
      includeChanges: false,
    });
    expect(parseSnapshot({ ...PIPELINES })).toMatchObject({ maxItems: 100, includeJobs: true });
  });

  it('caps the three types differently — a pipelines snapshot may not ask for an issues-sized page', () => {
    expect(parseSnapshot({ ...ISSUES, maxItems: 10_000 })).toMatchObject({ maxItems: 10_000 });
    expect(parsing({ ...ISSUES, maxItems: 10_001 })).toThrow();
    expect(parseSnapshot({ ...PIPELINES, maxItems: 2000 })).toMatchObject({ maxItems: 2000 });
    expect(parsing({ ...PIPELINES, maxItems: 2001 })).toThrow();
    // The same number: legal for issues, over the ceiling for pipelines.
    expect(parseSnapshot({ ...ISSUES, maxItems: 5000 })).toMatchObject({ maxItems: 5000 });
    expect(parsing({ ...PIPELINES, maxItems: 5000 })).toThrow();
  });

  it('rejects a maxItems that is not a whole positive count', () => {
    expect(parsing({ ...ISSUES, maxItems: 0 })).toThrow();
    expect(parsing({ ...ISSUES, maxItems: -1 })).toThrow();
    expect(parsing({ ...ISSUES, maxItems: 1.5 })).toThrow();
  });

  it('keeps the state vocabularies apart — `merged` is an MR word, not an issue word', () => {
    expect(parseSnapshot({ ...MRS, state: 'merged' })).toMatchObject({ state: 'merged' });
    expect(parseSnapshot({ ...MRS, state: 'locked' })).toMatchObject({ state: 'locked' });
    expect(parsing({ ...ISSUES, state: 'merged' })).toThrow();
    expect(parsing({ ...ISSUES, state: 'locked' })).toThrow();
    expect(parsing({ ...MRS, state: 'open' })).toThrow(); // GitLab says `opened`
  });

  it('rejects a snapshot whose type is missing or unknown — there is no fallback processor', () => {
    expect(parsing({ name: 'x', projectId: '1' })).toThrow();
    expect(parsing({ name: 'x', type: 'commits', projectId: '1' })).toThrow();
  });

  it('rejects an empty snapshot list — a pipeline without a scope has nothing to do', () => {
    expect(() => ReadConfig.parse({ snapshots: [] })).toThrow();
  });

  it('rejects a snapshot name that cannot be a directory', () => {
    expect(parsing({ ...ISSUES, name: 'Open Bugs' })).toThrow();
    expect(parsing({ ...ISSUES, name: 'OpenBugs' })).toThrow();
    expect(parsing({ ...ISSUES, name: '-leading-dash' })).toThrow();
    expect(parsing({ ...ISSUES, name: '' })).toThrow();
    expect(parsing({ ...ISSUES, name: 'a'.repeat(65) })).toThrow();
    expect(parseSnapshot({ ...ISSUES, name: 'open-bugs-2' })).toMatchObject({ name: 'open-bugs-2' });
  });

  it('takes a project as either a numeric id or a nested group path, but not as nothing', () => {
    expect(parseSnapshot({ ...ISSUES, projectId: '4242' })).toMatchObject({ projectId: '4242' });
    expect(parseSnapshot({ ...ISSUES, projectId: 'group/sub/app' })).toMatchObject({ projectId: 'group/sub/app' });
    expect(parsing({ ...ISSUES, projectId: '' })).toThrow();
    expect(parsing({ ...ISSUES, projectId: 4242 })).toThrow();
  });

  it('does not know the `okf` format — GitLab has no OKF writer, so the config must fail loudly', () => {
    expect(parsing({ ...ISSUES, render: ['okf'] })).toThrow();
    expect(parsing({ ...ISSUES, render: ['json', 'okf'] })).toThrow();
    expect(parseSnapshot({ ...ISSUES, render: ['json'] })).toMatchObject({ render: ['json'] });
  });

  it('rejects an empty render list — a snapshot that writes nothing is a silently wasted run', () => {
    expect(parsing({ ...ISSUES, render: [] })).toThrow();
  });

  it('rejects an empty outputDir', () => {
    expect(() => ReadConfig.parse({ outputDir: '', snapshots: [ISSUES] })).toThrow();
  });

  it('rejects a filter that belongs to another type instead of dropping it in silence', () => {
    // `labels` exists only on the issues branch. On an MR snapshot it used to be
    // stripped without a word, which reads exactly like a filter that was applied
    // and matched nothing. The schema is strict now, so it says so.
    expect(() => parseSnapshot({ ...MRS, labels: 'bug' })).toThrow(/labels/);
    expect(parseSnapshot({ ...ISSUES, labels: 'bug,auth' })).toMatchObject({ labels: 'bug,auth' });
  });

  it('names the offending key when a field is misspelled', () => {
    // The whole point of strictness: `maxItem` used to be dropped and the run
    // silently used the default of 500.
    expect(() => parseSnapshot({ ...ISSUES, maxItem: 5 })).toThrow(/maxItem/);
  });

  it('rejects an unknown key at the top level too, not just inside a snapshot', () => {
    expect(() => ReadConfig.parse({ outputDirs: './x', snapshots: [ISSUES] })).toThrow(/outputDirs/);
  });
});

// ── renderIssueMarkdown ──────────────────────────────────────────────────────

describe('renderIssueMarkdown', () => {
  const issue: ExtractedIssue = {
    iid: 42,
    title: 'Login times out on slow links',
    state: 'opened',
    author: 'jdoe',
    assignees: ['adam', 'beata'],
    labels: ['bug', 'auth'],
    milestone: 'Sprint 12',
    createdAt: '2026-05-01T10:00:00Z',
    updatedAt: '2026-05-22T14:00:00Z',
    url: 'https://gitlab.example.com/group/app/-/issues/42',
  };

  const sparse: ExtractedIssue = { iid: 1, title: 'Bare issue', state: 'closed' };

  it('opens with an H1 carrying the iid and the title', () => {
    expect(renderIssueMarkdown(issue).split('\n')[0]).toMatch(/^# .*42 — Login times out on slow links$/);
  });

  // Regression: the header once used `!`, GitLab's merge-request sigil, so every
  // issue document announced itself as `# !42` — a live reference to MR 42 in the
  // same project, pointing the reader at an unrelated object.
  it('marks an issue with the issue sigil `#`, not the merge-request sigil `!`', () => {
    expect(renderIssueMarkdown(issue).split('\n')[0]).toBe('# #42 — Login times out on slow links');
  });

  it('lists every metadata field it was handed', () => {
    const md = renderIssueMarkdown(issue);
    expect(md).toContain('- **State**: opened');
    expect(md).toContain('- **Author**: jdoe');
    expect(md).toContain('- **Assignees**: adam, beata');
    expect(md).toContain('- **Labels**: bug, auth');
    expect(md).toContain('- **Milestone**: Sprint 12');
    expect(md).toContain('- **Created**: 2026-05-01T10:00:00Z');
    expect(md).toContain('- **Updated**: 2026-05-22T14:00:00Z');
    expect(md).toContain('- **URL**: https://gitlab.example.com/group/app/-/issues/42');
    // Never closed → the line is absent, not empty.
    expect(md).not.toContain('**Closed**');
  });

  it('drops the whole line for a field upstream did not send, rather than printing `undefined`', () => {
    const md = renderIssueMarkdown(sparse);
    expect(md).not.toContain('undefined');
    expect(md).not.toContain('**Author**');
    expect(md).not.toContain('**Milestone**');
    expect(md).not.toContain('**URL**');
    expect(md).toContain('- **State**: closed');
  });

  it('treats an empty list as no list — an issue with no labels gets no Labels line', () => {
    const md = renderIssueMarkdown({ ...sparse, assignees: [], labels: [] });
    expect(md).not.toContain('**Assignees**');
    expect(md).not.toContain('**Labels**');
  });

  it('omits a section whose data is absent or empty', () => {
    expect(renderIssueMarkdown(sparse)).not.toContain('## Description');
    expect(renderIssueMarkdown(sparse)).not.toContain('## Notes');
    expect(renderIssueMarkdown({ ...sparse, description: '' })).not.toContain('## Description');
    expect(renderIssueMarkdown({ ...sparse, notes: [] })).not.toContain('## Notes');
  });

  it('names an anonymous note `unknown` and an undated one `—`, and flags the system ones', () => {
    const md = renderIssueMarkdown({
      ...sparse,
      notes: [
        { system: false, author: 'adam', createdAt: '2026-05-02T08:00:00Z', body: 'Reproduced on staging.' },
        { system: true, author: 'gitlab-bot', createdAt: '2026-05-03T09:00:00Z', body: 'changed the description' },
        { system: false, body: 'no author, no date' },
      ],
    });
    expect(md).toContain('### adam — 2026-05-02T08:00:00Z');
    expect(md).toContain('### gitlab-bot [system] — 2026-05-03T09:00:00Z');
    expect(md).toContain('### unknown — —');
    expect(md).not.toContain('adam [system]');
    expect(md).not.toContain('undefined');
  });

  it('keeps notes in the order they arrived — the document must not re-sort the discussion', () => {
    const md = renderIssueMarkdown({
      ...sparse,
      notes: [
        { system: false, author: 'zoe', createdAt: '2026-05-09T08:00:00Z', body: 'first in the array' },
        { system: false, author: 'adam', createdAt: '2026-05-01T08:00:00Z', body: 'second in the array' },
      ],
    });
    expect(md.indexOf('first in the array')).toBeLessThan(md.indexOf('second in the array'));
  });

  it('still prints the heading of a note that carries no body', () => {
    const md = renderIssueMarkdown({
      ...sparse,
      notes: [{ system: true, author: 'gitlab-bot', createdAt: '2026-05-03T09:00:00Z' }],
    });
    expect(md).toContain('## Notes');
    expect(md).toContain('### gitlab-bot [system] — 2026-05-03T09:00:00Z');
    expect(md).not.toContain('undefined');
  });

  it('copies bodies through verbatim — upstream Markdown is not escaped or re-indented', () => {
    const body = '## Steps\n\n| a | b |\n| - | - |\n\n`code` and *stars* and a — dash';
    const md = renderIssueMarkdown({ ...sparse, description: body });
    expect(md).toContain('## Description');
    expect(md).toContain(body);
  });

  it('fixes the section order: Description before Notes', () => {
    const md = renderIssueMarkdown({
      ...issue,
      description: 'the description body',
      notes: [{ system: false, author: 'adam', body: 'the note body' }],
    });
    expect(md.indexOf('## Description')).toBeLessThan(md.indexOf('## Notes'));
  });
});

// ── renderMrMarkdown ─────────────────────────────────────────────────────────

describe('renderMrMarkdown', () => {
  const mr: ExtractedMr = {
    iid: 7,
    title: 'Cache the token exchange',
    state: 'opened',
    author: 'jdoe',
    sourceBranch: 'feat/token-cache',
    targetBranch: 'main',
    mergeStatus: 'can_be_merged',
    createdAt: '2026-05-01T10:00:00Z',
    url: 'https://gitlab.example.com/group/app/-/merge_requests/7',
  };

  const sparse: ExtractedMr = { iid: 2, title: 'Bare MR', state: 'opened' };

  it('opens with the merge-request sigil `!` and the iid', () => {
    expect(renderMrMarkdown(mr).split('\n')[0]).toBe('# !7 — Cache the token exchange');
  });

  it('prints the branch pair only when both ends are known — half a pair says nothing', () => {
    expect(renderMrMarkdown(mr)).toContain('- **Branches**: `feat/token-cache` → `main`');
    expect(renderMrMarkdown({ ...sparse, sourceBranch: 'feat/x' })).not.toContain('**Branches**');
    expect(renderMrMarkdown({ ...sparse, targetBranch: 'main' })).not.toContain('**Branches**');
  });

  it('treats draft and conflicts as flags — printed only when literally true', () => {
    const off = renderMrMarkdown({ ...mr, draft: false, hasConflicts: false });
    expect(off).not.toContain('**Draft**');
    expect(off).not.toContain('**Conflicts**');
    const on = renderMrMarkdown({ ...mr, draft: true, hasConflicts: true });
    expect(on).toContain('- **Draft**: yes');
    expect(on).toContain('- **Conflicts**: yes');
  });

  it('marks each changed file by what happened to it, and falls back through the paths', () => {
    const md = renderMrMarkdown({
      ...mr,
      changes: [
        { newFile: true, renamedFile: false, deletedFile: false, newPath: 'src/added.ts' },
        { newFile: false, renamedFile: false, deletedFile: true, oldPath: 'src/gone.ts' },
        { newFile: false, renamedFile: true, deletedFile: false, oldPath: 'src/old.ts', newPath: 'src/new.ts' },
        { newFile: false, renamedFile: false, deletedFile: false, newPath: 'src/touched.ts' },
        { newFile: false, renamedFile: false, deletedFile: false },
      ],
    });
    expect(md).toContain('- `+` src/added.ts');
    // Deleted: only the old path survives upstream, so that is the one that must show.
    expect(md).toContain('- `-` src/gone.ts');
    // Renamed: the new path wins, the old one is not the file any more.
    expect(md).toContain('- `R` src/new.ts');
    expect(md).toContain('- `M` src/touched.ts');
    // Neither path known — a placeholder, never `undefined`.
    expect(md).toContain('- `M` ?');
    expect(md).not.toContain('undefined');
  });

  it('omits a section whose data is absent or empty', () => {
    expect(renderMrMarkdown(sparse)).not.toContain('## Changed files');
    expect(renderMrMarkdown(sparse)).not.toContain('## Notes');
    expect(renderMrMarkdown({ ...sparse, changes: [] })).not.toContain('## Changed files');
    expect(renderMrMarkdown({ ...sparse, notes: [] })).not.toContain('## Notes');
  });

  it('drops missing metadata lines instead of printing `undefined`', () => {
    const md = renderMrMarkdown(sparse);
    expect(md).not.toContain('undefined');
    expect(md).not.toContain('**Merge status**');
    expect(md).not.toContain('**Reviewers**');
    expect(md).toContain('- **State**: opened');
  });

  it('fixes the section order: Description → Changed files → Notes', () => {
    const md = renderMrMarkdown({
      ...mr,
      description: 'the description body',
      changes: [{ newFile: false, renamedFile: false, deletedFile: false, newPath: 'src/a.ts' }],
      notes: [{ system: false, author: 'adam', body: 'the note body' }],
    });
    expect(md.indexOf('## Description')).toBeLessThan(md.indexOf('## Changed files'));
    expect(md.indexOf('## Changed files')).toBeLessThan(md.indexOf('## Notes'));
  });
});

// ── renderPipelineMarkdown ───────────────────────────────────────────────────

describe('renderPipelineMarkdown', () => {
  const pipeline: ExtractedPipeline = {
    id: 1234,
    status: 'failed',
    ref: 'main',
    sha: 'deadbeefcafe',
    source: 'push',
    createdAt: '2026-05-01T10:00:00Z',
    updatedAt: '2026-05-01T10:12:00Z',
    url: 'https://gitlab.example.com/group/app/-/pipelines/1234',
  };

  const sparse: ExtractedPipeline = { id: 9, status: 'success' };

  it('opens with the pipeline id and its status', () => {
    expect(renderPipelineMarkdown(pipeline).split('\n')[0]).toBe('# Pipeline #1234 — failed');
  });

  it('renders ref and sha as code, so a branch name with underscores survives', () => {
    const md = renderPipelineMarkdown({ ...pipeline, ref: 'release/2026_05' });
    expect(md).toContain('- **Ref**: `release/2026_05`');
    expect(md).toContain('- **SHA**: `deadbeefcafe`');
    expect(md).toContain('- **Source**: push');
  });

  it('drops missing metadata lines instead of printing `undefined`', () => {
    const md = renderPipelineMarkdown(sparse);
    expect(md).not.toContain('undefined');
    expect(md).not.toContain('**Ref**');
    expect(md).not.toContain('**SHA**');
    expect(md).not.toContain('## Jobs');
  });

  it('reports a zero-second job as `0.0s` — a duration of 0 is a measurement, not a missing field', () => {
    const md = renderPipelineMarkdown({
      ...sparse,
      jobs: [{ name: 'noop', stage: 'build', status: 'success', durationSec: 0 }],
    });
    expect(md).toContain('- `success` **noop** [build] (0.0s)');
  });

  it('rounds a duration to one decimal and omits the parenthesis when there is none', () => {
    const md = renderPipelineMarkdown({
      ...sparse,
      jobs: [
        { name: 'test', stage: 'test', status: 'failed', durationSec: 95.66 },
        { name: 'deploy', stage: 'deploy', status: 'created' },
      ],
    });
    expect(md).toContain('- `failed` **test** [test] (95.7s)');
    expect(md).toContain('- `created` **deploy** [deploy]');
    expect(md).not.toContain('**deploy** [deploy] (');
    expect(md).not.toContain('NaN');
  });

  it('puts `?` where a job field is missing, never `undefined`', () => {
    const md = renderPipelineMarkdown({ ...sparse, jobs: [{}] });
    expect(md).toContain('- `?` **?** [?]');
    expect(md).not.toContain('undefined');
  });

  it('keeps jobs in the order the API returned them — stage order is upstream’s statement', () => {
    const md = renderPipelineMarkdown({
      ...sparse,
      jobs: [
        { name: 'zeta', stage: 'build', status: 'success' },
        { name: 'alpha', stage: 'test', status: 'success' },
      ],
    });
    expect(md.indexOf('**zeta**')).toBeLessThan(md.indexOf('**alpha**'));
  });

  it('omits the Jobs section when the list is empty', () => {
    expect(renderPipelineMarkdown({ ...pipeline, jobs: [] })).not.toContain('## Jobs');
  });
});

// ── Not covered here, and why ────────────────────────────────────────────────
//
// `listAll` (page-based pagination driven by the `x-next-page` header), `encodeProject`
// (numeric id passed through, path percent-encoded) and `processIssues` / `processMrs` /
// `processPipelines` are module-private. Testing them would mean exporting them from the
// pipeline, which is a change to production code and belongs in its own commit — not in the
// commit that adds the tests. Until then their behaviour is guarded only by the shared layer's
// own specs (`shared/http-client.spec.ts`, `shared/gitlab-reshape.spec.ts`).

// ── Pagination ───────────────────────────────────────────────────────────────
//
// `listAll` was exported for this block, and that is the point: the same defect
// lived in Sonar's paginator, survived a full round of renderer tests, and was
// only found by reading. Code that cannot be called from a test is code nobody
// has checked.

describe('listAll', () => {
  /** A client serving prepared pages in order, recording the query of each call. */
  function pager(pages: readonly { items: readonly unknown[]; nextPage?: string }[]) {
    let i = 0;
    const calls: Record<string, unknown>[] = [];
    const http = {
      async request({
        query,
        onResponseMeta,
      }: {
        query: Record<string, unknown>;
        onResponseMeta?: (meta: { status: number; header: (name: string) => string | null }) => void;
      }) {
        calls.push(query);
        const page = pages[Math.min(i, pages.length - 1)];
        i += 1;
        onResponseMeta?.({
          status: 200,
          header: (name) => (name === 'x-next-page' ? (page?.nextPage ?? '') : null),
        });
        return (page?.items ?? []) as never;
      },
    } as unknown as Parameters<typeof listAll>[0];
    return { http, calls };
  }

  const rows = (n: number, from = 0) => Array.from({ length: n }, (_, k) => ({ id: from + k }));

  it('keeps per_page constant instead of shrinking it to the remaining budget', async () => {
    // GitLab computes `x-next-page` against the per_page of the request that
    // produced it. A smaller final page therefore re-reads rows already
    // collected: asking for 150 returned rows 1–100, then rows 51–100 again.
    const { http, calls } = pager([{ items: rows(100), nextPage: '2' }, { items: rows(50, 100) }]);
    await listAll(http, '/projects/1/issues', {}, 150);
    expect(calls.map((c) => c['per_page'])).toEqual([100, 100]);
    expect(calls.map((c) => c['page'])).toEqual([1, '2']);
  });

  it('returns distinct rows when the ceiling is not a multiple of the page size', async () => {
    const { http } = pager([{ items: rows(100), nextPage: '2' }, { items: rows(50, 100) }]);
    const out = await listAll<{ id: number }>(http, '/projects/1/issues', {}, 150);
    const ids = out.items.map((i) => i.id);
    expect(ids).toHaveLength(150);
    expect(new Set(ids).size).toBe(150);
    expect(ids.at(-1)).toBe(149);
  });

  it('cuts to the ceiling and reports the truncation', async () => {
    const { http } = pager([{ items: rows(100), nextPage: '2' }, { items: rows(100, 100) }]);
    const out = await listAll<{ id: number }>(http, '/projects/1/issues', {}, 120);
    expect(out.items).toHaveLength(120);
    expect(out.truncated).toBe(true);
  });

  it('does not claim truncation when the last page ended the walk', async () => {
    const { http } = pager([{ items: rows(30) }]);
    const out = await listAll(http, '/projects/1/issues', {}, 500);
    expect(out.items).toHaveLength(30);
    expect(out.truncated).toBe(false);
  });

  it('does not claim truncation when the walk ends exactly on the ceiling', async () => {
    // A cumulative "there was a next page at some point" flag reports truncation
    // here, because page 1 did have a successor — the one that completed the set.
    const { http } = pager([{ items: rows(100), nextPage: '2' }, { items: rows(50, 100) }]);
    const out = await listAll(http, '/projects/1/issues', {}, 150);
    expect(out.items).toHaveLength(150);
    expect(out.truncated).toBe(false);
  });

  it('claims truncation when the ceiling stops a walk that had more to give', async () => {
    const { http } = pager([{ items: rows(100), nextPage: '2' }]);
    const out = await listAll(http, '/projects/1/issues', {}, 100);
    expect(out.items).toHaveLength(100);
    expect(out.truncated).toBe(true);
  });

  it('treats an empty x-next-page as the last page', async () => {
    const { http, calls } = pager([{ items: rows(100), nextPage: '   ' }]);
    const out = await listAll(http, '/projects/1/issues', {}, 500);
    expect(calls).toHaveLength(1);
    expect(out.items).toHaveLength(100);
  });
});

describe('ReadConfig — the top-level projectId default', () => {
  it('a top-level projectId covers snapshots that name none; a snapshot override wins', () => {
    const parsed = ReadConfig.parse({
      projectId: 'grupa/aplikacja',
      snapshots: [
        { name: 'issues', type: 'issues' },
        { name: 'other', type: 'mrs', projectId: 'grupa/inna' },
      ],
    });
    expect(parsed.projectId).toBe('grupa/aplikacja');
    expect(parsed.snapshots[0]?.projectId).toBeUndefined(); // resolved in main, not in the schema
    expect(parsed.snapshots[1]?.projectId).toBe('grupa/inna');
  });

  it('no projectId anywhere is a loud parse error pointing at the snapshot', () => {
    expect(ReadConfig.safeParse({ snapshots: [{ name: 'x', type: 'issues' }] }).success).toBe(false);
  });
});
