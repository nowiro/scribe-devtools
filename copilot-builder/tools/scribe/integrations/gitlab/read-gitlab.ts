#!/usr/bin/env node
/**
 * read-gitlab — deterministic GitLab data pipeline.
 *
 * Reads its whole scope from `read.config.gitlab.json`: nothing is inferred
 * and nothing is asked interactively, so two runs of the same config over an
 * unchanged project produce the same files.
 *
 * A snapshot has one of 3 types:
 *   - `type: "issues"`    → every project issue matching the filters (state/labels) + notes
 *   - `type: "mrs"`       → every MR matching the filters (state) + notes + changes summary
 *   - `type: "pipelines"` → the last N pipelines + the job list per pipeline
 *
 * Output: `<outputDir>/<stamp>/<snapshot>/<resource-id>.json` (+ `.md` if render includes markdown)
 *   plus `_manifest.json` with the run metadata.
 *
 * Run: `npm run read -- gitlab [path/to/read.config.gitlab.json]`
 */
import { z } from 'zod';

import { loadGitLabAuth } from '../shared/auth.js';
import {
  assertUniqueSnapshotNames,
  createScriptLogger,
  defaultOutputDir,
  mapWithConcurrency,
  PIPELINE_CONCURRENCY,
  renderFormatsSchema,
  runIfMain,
  snapshotNameSchema,
  startReadRun,
  warnIfTruncated,
  writeManifest,
  writePipelineOutputs,
} from '../shared/read-runtime.js';
import {
  reshapeGitLabIssue,
  reshapeGitLabMr,
  reshapeGitLabPipeline,
  type CanonicalGitLabIssue,
  type CanonicalMr,
  type CanonicalPipeline,
  encodeProject,
} from '../shared/gitlab-reshape.js';
import { createNamedHttpClient, type HttpClient } from '../shared/http-client.js';

const SCRIPT_NAME = 'read-gitlab';

// ── Config ───────────────────────────────────────────────────────────────────

const baseSnapshot = {
  name: snapshotNameSchema,
  /** GitLab project ID (number) or `group/subgroup/project` (path). Optional per snapshot
   * when the top-level `projectId` default is set — most configs walk ONE project. */
  projectId: z.string().min(1).optional(),
  render: renderFormatsSchema,
} as const;

const IssuesSnapshot = z.strictObject({
  ...baseSnapshot,
  type: z.literal('issues'),
  state: z.enum(['opened', 'closed', 'all']).default('all'),
  labels: z.string().optional(),
  maxItems: z.number().int().min(1).max(10_000).default(500),
  includeNotes: z.boolean().default(true),
});
const MrsSnapshot = z.strictObject({
  ...baseSnapshot,
  type: z.literal('mrs'),
  state: z.enum(['opened', 'closed', 'merged', 'locked', 'all']).default('all'),
  maxItems: z.number().int().min(1).max(10_000).default(500),
  includeNotes: z.boolean().default(true),
  includeChanges: z.boolean().default(false),
});
const PipelinesSnapshot = z.strictObject({
  ...baseSnapshot,
  type: z.literal('pipelines'),
  ref: z.string().optional(),
  maxItems: z.number().int().min(1).max(2000).default(100),
  includeJobs: z.boolean().default(true),
});

const SnapshotConfig = z.discriminatedUnion('type', [IssuesSnapshot, MrsSnapshot, PipelinesSnapshot]);

export const ReadConfig = z
  .strictObject({
    outputDir: z.string().min(1).default(defaultOutputDir('gitlab')),
    /** Default project for every snapshot that does not name its own. */
    projectId: z.string().min(1).optional(),
    snapshots: z.array(SnapshotConfig).min(1),
  })
  .superRefine(assertUniqueSnapshotNames)
  .superRefine((config, ctx) => {
    config.snapshots.forEach((snapshot, index) => {
      if (snapshot.projectId === undefined && config.projectId === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['snapshots', index, 'projectId'],
          message: 'no projectId on the snapshot and no top-level default — set one of them',
        });
      }
    });
  });

// ── Raw shapes (lightweight types, only what we use) ─────────────────────────

interface RawNote {
  readonly id?: number;
  readonly system?: boolean;
  readonly author?: { readonly username?: string };
  readonly created_at?: string;
  readonly updated_at?: string;
  readonly body?: string;
}
interface RawJob {
  readonly id?: number;
  readonly name?: string;
  readonly stage?: string;
  readonly status?: string;
  readonly created_at?: string;
  readonly started_at?: string;
  readonly finished_at?: string;
  readonly duration?: number | null;
  readonly web_url?: string;
}
interface RawMrChange {
  readonly old_path?: string;
  readonly new_path?: string;
  readonly new_file?: boolean;
  readonly renamed_file?: boolean;
  readonly deleted_file?: boolean;
}
interface RawMrChanges {
  readonly changes?: readonly RawMrChange[];
}

// ── Output ───────────────────────────────────────────────────────────────────

interface NormalisedNote {
  readonly id?: number;
  readonly author?: string;
  readonly system: boolean;
  readonly createdAt?: string;
  readonly updatedAt?: string;
  readonly body?: string;
}
interface NormalisedJob {
  readonly id?: number;
  readonly name?: string;
  readonly stage?: string;
  readonly status?: string;
  readonly startedAt?: string;
  readonly finishedAt?: string;
  readonly durationSec?: number;
  readonly url?: string;
}
interface NormalisedChange {
  readonly oldPath?: string;
  readonly newPath?: string;
  readonly newFile: boolean;
  readonly renamedFile: boolean;
  readonly deletedFile: boolean;
}

export interface ExtractedIssue extends CanonicalGitLabIssue {
  readonly notes?: readonly NormalisedNote[];
}
export interface ExtractedMr extends CanonicalMr {
  readonly notes?: readonly NormalisedNote[];
  readonly changes?: readonly NormalisedChange[];
}
export interface ExtractedPipeline extends CanonicalPipeline {
  readonly jobs?: readonly NormalisedJob[];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const log = createScriptLogger(SCRIPT_NAME);

/**
 * Page through a GitLab list endpoint until `max` items or the last page.
 *
 * `per_page` stays **constant**. Shrinking it to fit the remaining budget —
 * which this used to do — is wrong for offset pagination: GitLab computes
 * `x-next-page` against the `per_page` of the request that produced it, so a
 * smaller final page re-reads rows already collected and never reaches the tail.
 * With 150 wanted, page 2 came back at `per_page=50` and returned rows 51–100
 * for the second time. Ask for full pages, then cut once at the end.
 */
export async function listAll<T>(
  http: HttpClient,
  path: string,
  baseQuery: Record<string, string | number | boolean | undefined>,
  max: number,
): Promise<{ items: readonly T[]; truncated: boolean }> {
  const out: T[] = [];
  let page: string | number = 1;
  const PER_PAGE = 100;
  // Whether a page existed AFTER the last one we took. It has to describe the
  // final iteration, not "at some point there was a next page" — a cumulative
  // flag reports truncation for a walk that ended exactly on the last page.
  let hasMore = false;
  // `x-total` when GitLab sends it (it stops on very large sets) — the only way to
  // DETECT an upward shift: an item deleted (or leaving the filtered state) during
  // the walk moves later rows up across the offset boundary and one is skipped.
  let reportedTotal: number | undefined;
  while (out.length < max) {
    let nextPage: string | undefined;
    const items = await http.request<readonly T[]>({
      path,
      query: { ...baseQuery, per_page: PER_PAGE, page },
      // cache:false so GitLab's pagination headers are fresh each page.
      cache: false,
      onResponseMeta: (meta) => {
        const value = meta.header('x-next-page')?.trim();
        nextPage = value !== undefined && value.length > 0 ? value : undefined;
        const total = Number(meta.header('x-total') ?? '');
        // The FIRST page's total only. Later pages already count the shrunken set,
        // so overwriting per page made `shifted` compare the walk against the very
        // number the deletion produced — the detection could never fire.
        if (reportedTotal === undefined && Number.isFinite(total) && total > 0) reportedTotal = total;
      },
    });
    if (items.length === 0) {
      hasMore = false;
      break;
    }
    for (const it of items) out.push(it);
    // GitLab's authoritative cursor: empty `x-next-page` ⇒ last page.
    hasMore = nextPage !== undefined;
    if (!hasMore) break;
    page = nextPage as string;
  }
  // Fewer rows than upstream reported, with no cap and no next page in play, means
  // the walk lost something to a mid-walk shift — say so instead of implying complete.
  const shifted = reportedTotal !== undefined && !hasMore && out.length < Math.min(reportedTotal, max);
  return { items: out.slice(0, max), truncated: out.length > max || hasMore || shifted };
}

/**
 * Ceiling on a per-resource sub-list (an issue's notes, a pipeline's jobs).
 * A discussion longer than this is real and rare; the point of the cap is that
 * one pathological thread cannot stall the whole snapshot.
 */
const MAX_SUBLIST_ITEMS = 1000;

/** `listAll` for a sub-list, with the cap and a stderr line when it bites. */
async function fetchSubList<T>(
  http: HttpClient,
  path: string,
  baseQuery: Record<string, string | number | boolean | undefined>,
  label: string,
): Promise<readonly T[]> {
  const page = await listAll<T>(http, path, baseQuery, MAX_SUBLIST_ITEMS);
  warnIfTruncated(log, page.truncated, `${label} hit the ${String(MAX_SUBLIST_ITEMS)}-item cap`);
  return page.items;
}

/**
 * Say out loud when a cap dropped data. Silence here is the failure mode worth
 * fearing: a snapshot missing half a discussion looks exactly like a snapshot
 * of a short discussion.
 */
function normaliseNote(n: RawNote): NormalisedNote {
  return {
    id: n.id,
    author: n.author?.username,
    system: n.system === true,
    createdAt: n.created_at,
    updatedAt: n.updated_at,
    body: n.body,
  };
}
function normaliseJob(j: RawJob): NormalisedJob {
  return {
    id: j.id,
    name: j.name,
    stage: j.stage,
    status: j.status,
    startedAt: j.started_at,
    finishedAt: j.finished_at,
    durationSec: typeof j.duration === 'number' ? j.duration : undefined,
    url: j.web_url,
  };
}
function normaliseChange(c: RawMrChange): NormalisedChange {
  return {
    oldPath: c.old_path,
    newPath: c.new_path,
    newFile: c.new_file === true,
    renamedFile: c.renamed_file === true,
    deletedFile: c.deleted_file === true,
  };
}

// ── Renderers ────────────────────────────────────────────────────────────────

export function renderIssueMarkdown(issue: ExtractedIssue): string {
  const lines: string[] = [];
  lines.push(`# #${issue.iid} — ${issue.title}`);
  lines.push('');
  lines.push(`- **State**: ${issue.state}`);
  if (issue.author) lines.push(`- **Author**: ${issue.author}`);
  if (issue.assignees && issue.assignees.length > 0) lines.push(`- **Assignees**: ${issue.assignees.join(', ')}`);
  if (issue.labels && issue.labels.length > 0) lines.push(`- **Labels**: ${issue.labels.join(', ')}`);
  if (issue.milestone) lines.push(`- **Milestone**: ${issue.milestone}`);
  if (issue.createdAt) lines.push(`- **Created**: ${issue.createdAt}`);
  if (issue.updatedAt) lines.push(`- **Updated**: ${issue.updatedAt}`);
  if (issue.closedAt) lines.push(`- **Closed**: ${issue.closedAt}`);
  if (issue.url) lines.push(`- **URL**: ${issue.url}`);
  lines.push('');

  if (issue.description) {
    lines.push('## Description');
    lines.push('');
    lines.push(issue.description);
    lines.push('');
  }

  pushNotesSection(lines, issue.notes);

  return lines.join('\n');
}

/**
 * The `## Notes` section, shared by the issue and MR renderers — it was the same
 * 11 lines twice in one file, and a format change made to one copy would quietly
 * leave issue notes and MR notes rendering differently.
 */
function pushNotesSection(lines: string[], notes: readonly NormalisedNote[] | undefined): void {
  if (!notes || notes.length === 0) return;
  lines.push('## Notes');
  lines.push('');
  for (const n of notes) {
    const sys = n.system ? ' [system]' : '';
    lines.push(`### ${n.author ?? 'unknown'}${sys} — ${n.createdAt ?? '—'}`);
    lines.push('');
    if (n.body) lines.push(n.body);
    lines.push('');
  }
}

export function renderMrMarkdown(mr: ExtractedMr): string {
  const lines: string[] = [];
  lines.push(`# !${mr.iid} — ${mr.title}`);
  lines.push('');
  lines.push(`- **State**: ${mr.state}`);
  if (mr.draft === true) lines.push(`- **Draft**: yes`);
  if (mr.author) lines.push(`- **Author**: ${mr.author}`);
  if (mr.sourceBranch && mr.targetBranch) lines.push(`- **Branches**: \`${mr.sourceBranch}\` → \`${mr.targetBranch}\``);
  // `detailedMergeStatus` is the field GitLab actually keeps current; the older
  // `mergeStatus` is deprecated and collapses several distinct reasons into
  // `cannot_be_merged`. Prefer the detailed one, fall back to the old one.
  const mergeStatus = mr.detailedMergeStatus ?? mr.mergeStatus;
  if (mergeStatus) lines.push(`- **Merge status**: ${mergeStatus}`);
  if (mr.hasConflicts === true) lines.push(`- **Conflicts**: yes`);
  if (mr.assignees && mr.assignees.length > 0) lines.push(`- **Assignees**: ${mr.assignees.join(', ')}`);
  if (mr.reviewers && mr.reviewers.length > 0) lines.push(`- **Reviewers**: ${mr.reviewers.join(', ')}`);
  if (mr.labels && mr.labels.length > 0) lines.push(`- **Labels**: ${mr.labels.join(', ')}`);
  if (mr.createdAt) lines.push(`- **Created**: ${mr.createdAt}`);
  if (mr.updatedAt) lines.push(`- **Updated**: ${mr.updatedAt}`);
  if (mr.mergedAt) lines.push(`- **Merged**: ${mr.mergedAt}`);
  if (mr.url) lines.push(`- **URL**: ${mr.url}`);
  lines.push('');

  if (mr.description) {
    lines.push('## Description');
    lines.push('');
    lines.push(mr.description);
    lines.push('');
  }

  if (mr.changes && mr.changes.length > 0) {
    lines.push('## Changed files');
    lines.push('');
    for (const c of mr.changes) {
      const marker = c.newFile ? '+' : c.deletedFile ? '-' : c.renamedFile ? 'R' : 'M';
      const path = c.newPath ?? c.oldPath ?? '?';
      lines.push(`- \`${marker}\` ${path}`);
    }
    lines.push('');
  }

  pushNotesSection(lines, mr.notes);

  return lines.join('\n');
}

export function renderPipelineMarkdown(pipeline: ExtractedPipeline): string {
  const lines: string[] = [];
  lines.push(`# Pipeline #${pipeline.id} — ${pipeline.status}`);
  lines.push('');
  if (pipeline.ref) lines.push(`- **Ref**: \`${pipeline.ref}\``);
  if (pipeline.sha) lines.push(`- **SHA**: \`${pipeline.sha}\``);
  if (pipeline.source) lines.push(`- **Source**: ${pipeline.source}`);
  if (pipeline.createdAt) lines.push(`- **Created**: ${pipeline.createdAt}`);
  if (pipeline.updatedAt) lines.push(`- **Updated**: ${pipeline.updatedAt}`);
  if (pipeline.url) lines.push(`- **URL**: ${pipeline.url}`);
  lines.push('');

  if (pipeline.jobs && pipeline.jobs.length > 0) {
    lines.push('## Jobs');
    lines.push('');
    for (const j of pipeline.jobs) {
      const dur = typeof j.durationSec === 'number' ? ` (${j.durationSec.toFixed(1)}s)` : '';
      lines.push(`- \`${j.status ?? '?'}\` **${j.name ?? '?'}** [${j.stage ?? '?'}]${dur}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

// ── Per-type processors ──────────────────────────────────────────────────────

// Every processor reports `truncated` alongside the written ids: a stderr WARN is
// gone once the terminal scrolls, and a capped snapshot on disk used to be
// byte-for-byte indistinguishable from a complete one — the manifest is the contract.
interface ProcessResult {
  readonly written: readonly string[];
  readonly truncated: boolean;
}

// Pagination is ordered by CREATION, newest first — not `updated_at`. The creation
// date never changes, so an item updated mid-walk cannot jump to page one and shift
// the offset window: with `updated_at` ordering, one comment from anyone during a
// multi-page walk silently skipped whatever straddled the next page boundary. An
// item CREATED mid-walk still shifts rows down one slot, but downward shifts only
// re-read a row — the id Set below drops the duplicate.
const STABLE_ORDER = { order_by: 'created_at', sort: 'desc' } as const;

async function processIssues(
  http: HttpClient,
  snapshot: z.infer<typeof IssuesSnapshot> & { readonly projectId: string },
  snapshotDir: string,
): Promise<ProcessResult> {
  const project = encodeProject(snapshot.projectId);
  const page = await listAll<Parameters<typeof reshapeGitLabIssue>[0]>(
    http,
    `/projects/${project}/issues`,
    {
      state: snapshot.state === 'all' ? undefined : snapshot.state,
      ...(snapshot.labels ? { labels: snapshot.labels } : {}),
      ...STABLE_ORDER,
    },
    snapshot.maxItems,
  );
  warnIfTruncated(log, page.truncated, `issues in ${snapshot.projectId} hit the ${String(snapshot.maxItems)}-item cap`);

  const work = dedupeByStableId(
    page.items.map((rawIssue) => reshapeGitLabIssue(rawIssue)),
    (base) => `issue-${base.iid}`,
  );
  // Items are independent — processed concurrently (bounded). One at a time meant a
  // 500-issue snapshot paid 500 SEQUENTIAL note walks on a single client permit.
  await mapWithConcurrency(work.items, PIPELINE_CONCURRENCY, async (base) => {
    const notes = snapshot.includeNotes
      ? (
          await fetchSubList<RawNote>(
            http,
            `/projects/${project}/issues/${base.iid}/notes`,
            { sort: 'asc' },
            `notes of issue #${base.iid}`,
          )
        ).map(normaliseNote)
      : undefined;
    const issue: ExtractedIssue = { ...base, ...(notes ? { notes } : {}) };
    await writePipelineOutputs({
      dir: snapshotDir,
      basename: `issue-${base.iid}`,
      data: issue,
      markdown: renderIssueMarkdown(issue),
      formats: snapshot.render,
    });
  });
  return { written: work.ids, truncated: page.truncated };
}

/**
 * Drop rows whose id repeats — with creation-ordered offset pagination an item
 * CREATED mid-walk shifts rows down one slot, so the boundary row is read twice.
 */
function dedupeByStableId<T>(items: readonly T[], idOf: (item: T) => string): { items: T[]; ids: string[] } {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const id = idOf(item);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(item);
  }
  return { items: out, ids: [...seen] };
}

async function processMrs(
  http: HttpClient,
  snapshot: z.infer<typeof MrsSnapshot> & { readonly projectId: string },
  snapshotDir: string,
): Promise<ProcessResult> {
  const project = encodeProject(snapshot.projectId);
  const page = await listAll<Parameters<typeof reshapeGitLabMr>[0]>(
    http,
    `/projects/${project}/merge_requests`,
    {
      state: snapshot.state === 'all' ? undefined : snapshot.state,
      ...STABLE_ORDER,
    },
    snapshot.maxItems,
  );
  warnIfTruncated(
    log,
    page.truncated,
    `merge requests in ${snapshot.projectId} hit the ${String(snapshot.maxItems)}-item cap`,
  );

  const work = dedupeByStableId(
    page.items.map((rawMr) => reshapeGitLabMr(rawMr)),
    (base) => `mr-${base.iid}`,
  );
  await mapWithConcurrency(work.items, PIPELINE_CONCURRENCY, async (base) => {
    // Notes and changes are independent endpoints needing only the iid — fetched in
    // parallel under the shared client's semaphore; awaiting them one after the other
    // simply doubled the per-MR latency.
    const [notes, changes] = await Promise.all([
      snapshot.includeNotes
        ? fetchSubList<RawNote>(
            http,
            `/projects/${project}/merge_requests/${base.iid}/notes`,
            { sort: 'asc' },
            `notes of MR !${base.iid}`,
          ).then((raw) => raw.map(normaliseNote))
        : undefined,
      snapshot.includeChanges
        ? http
            .request<RawMrChanges>({ path: `/projects/${project}/merge_requests/${base.iid}/changes` })
            .then((resp) => resp.changes?.map(normaliseChange))
        : undefined,
    ]);

    const mr: ExtractedMr = {
      ...base,
      ...(notes ? { notes } : {}),
      ...(changes && changes.length > 0 ? { changes } : {}),
    };
    await writePipelineOutputs({
      dir: snapshotDir,
      basename: `mr-${base.iid}`,
      data: mr,
      markdown: renderMrMarkdown(mr),
      formats: snapshot.render,
    });
  });
  return { written: work.ids, truncated: page.truncated };
}

async function processPipelines(
  http: HttpClient,
  snapshot: z.infer<typeof PipelinesSnapshot> & { readonly projectId: string },
  snapshotDir: string,
): Promise<ProcessResult> {
  const project = encodeProject(snapshot.projectId);
  const page = await listAll<Parameters<typeof reshapeGitLabPipeline>[0]>(
    http,
    `/projects/${project}/pipelines`,
    {
      ...(snapshot.ref ? { ref: snapshot.ref } : {}),
      // `id` is creation order under another name and equally immutable — already stable.
      order_by: 'id',
      sort: 'desc',
    },
    snapshot.maxItems,
  );
  warnIfTruncated(
    log,
    page.truncated,
    `pipelines in ${snapshot.projectId} hit the ${String(snapshot.maxItems)}-item cap`,
  );

  const work = dedupeByStableId(
    page.items.map((rawPipeline) => reshapeGitLabPipeline(rawPipeline)),
    (base) => `pipeline-${base.id}`,
  );
  await mapWithConcurrency(work.items, PIPELINE_CONCURRENCY, async (base) => {
    const jobs = snapshot.includeJobs
      ? (
          await fetchSubList<RawJob>(
            http,
            `/projects/${project}/pipelines/${base.id}/jobs`,
            {},
            `jobs of pipeline ${base.id}`,
          )
        ).map(normaliseJob)
      : undefined;
    const pipeline: ExtractedPipeline = { ...base, ...(jobs ? { jobs } : {}) };
    await writePipelineOutputs({
      dir: snapshotDir,
      basename: `pipeline-${base.id}`,
      data: pipeline,
      markdown: renderPipelineMarkdown(pipeline),
      formats: snapshot.render,
    });
  });
  return { written: work.ids, truncated: page.truncated };
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const run = await startReadRun({ scriptName: SCRIPT_NAME, source: 'gitlab', schema: ReadConfig, log });
  const http = createNamedHttpClient(SCRIPT_NAME, loadGitLabAuth());
  let totalItems = 0;

  for (const rawSnapshot of run.config.snapshots) {
    // The refine guarantees one of the two exists; processors get it RESOLVED.
    const projectId = rawSnapshot.projectId ?? run.config.projectId;
    if (projectId === undefined) throw new Error('unreachable — the config refine pins projectId presence');
    const snapshot = { ...rawSnapshot, projectId };
    log(`snapshot "${snapshot.name}" (${snapshot.type}, project ${snapshot.projectId})`);
    const snapshotDir = await run.snapshotDir(snapshot.name);

    let result: ProcessResult;
    if (snapshot.type === 'issues') result = await processIssues(http, snapshot, snapshotDir);
    else if (snapshot.type === 'mrs') result = await processMrs(http, snapshot, snapshotDir);
    else result = await processPipelines(http, snapshot, snapshotDir);

    await writeManifest(
      snapshotDir,
      run.manifest(snapshot, {
        type: snapshot.type,
        projectId: snapshot.projectId,
        // A capped scope looks exactly like a small scope — the manifest says which
        // it was; the stderr WARN alone is gone once the terminal scrolls.
        truncated: result.truncated,
        itemCount: result.written.length,
        itemIds: result.written,
      }),
    );
    log(`  wrote ${result.written.length} item(s) → ${snapshotDir}`);
    totalItems += result.written.length;
  }

  run.finish(totalItems);
}

await runIfMain(SCRIPT_NAME, import.meta.url, main);
