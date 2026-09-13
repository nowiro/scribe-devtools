#!/usr/bin/env node
/**
 * read-jira — deterministic Jira data pipeline.
 *
 * Reads its whole scope from `read.config.jira.json`, so for an identical
 * config and an identical upstream state you get a bit-for-bit identical output
 * (modulo the `updated` dates).
 *
 * Pipeline per snapshot:
 *   1. JQL search → exhaustive list of all issue keys (paginated).
 *   2. Per-issue: fetch with `fields=*all` + `expand=changelog`.
 *   3. Reshape through `reshapeJiraIssue`, naming custom fields from the field registry.
 *   4. Optionally comments / worklogs / the rest of the changelog (separate endpoints, paginated).
 *   5. Write `<outputDir>/<STAMP>/<snapshot>/<KEY>.json` + optionally `.md`.
 *   6. Manifest: `<outputDir>/<STAMP>/<snapshot>/_manifest.json` with the run metadata.
 *
 * Next to the raw material, inside the same snapshot directory, the pipeline can
 * write an **OKF bundle** (`<snapshot>/knowledge/` — an index plus one concept
 * per issue) when `render` includes `'okf'`. It is a plain-file view of the same
 * data, for reading rather than for parsing.
 *
 * ── STAMP is an input, not a clock reading ───────────────────────────────────
 *
 * The run directory is named with a `YYYY-MM-DD_HH-MM` stamp (`Europe/Warsaw`).
 * It **may be supplied** via `--stamp` or `EXTRACT_STAMP`, and that is the path used
 * in the tests: with it, two runs over the same input give the same directory
 * and the same bytes in the OKF bundle. The clock is only the last fallback, and
 * it decides nothing but the directory name — into the bundle the stamp is
 * copied from the manifest, never re-read from `Date.now()`.
 *
 * Run: `npm run read -- jira [path/to/read.config.jira.json]`
 *
 * The dispatcher passes the config path positionally. `--config <file>` and
 * `--stamp <stamp>` work when this file is invoked directly:
 *   `node dist/jira/read-jira.js --config c.json --stamp 2026-08-23_12-00`
 *
 * Default config path: `./read.config.jira.json` (cwd).
 */
import { join } from 'node:path';
import { z } from 'zod';

import { adfToMarkdownSafe, codeSpan, flatLine } from '../shared/adf.js';
import { loadJiraAuth } from '../shared/auth.js';
import {
  assertUniqueSnapshotNames,
  createScriptLogger,
  defaultOutputDir,
  mapWithConcurrency,
  PIPELINE_CONCURRENCY,
  renderFormatsWithOkfSchema as renderFormatsSchema,
  runIfMain,
  SIDECAR_DEFAULT_CHARS,
  snapshotNameSchema,
  startReadRun,
  warnIfTruncated,
  writeManifest,
  writePipelineOutputs,
} from '../shared/read-runtime.js';
import { createJiraFieldRegistry, type FieldRegistry } from '../shared/field-registry.js';
import { createNamedHttpClient, type HttpClient } from '../shared/http-client.js';
import { issueRefLine, reshapeJiraIssue, type CanonicalIssue } from '../shared/jira-reshape.js';
import { OKF_BUNDLE_DIR, writeOkfBundle, type OkfConceptInput } from '../shared/okf.js';

const SCRIPT_NAME = 'read-jira';

// ── Config schema ────────────────────────────────────────────────────────────

const SnapshotConfig = z.strictObject({
  /** Snapshot name — used as a subdirectory inside outputDir. Only `[a-z0-9-]`. */
  name: snapshotNameSchema,
  /** JQL identifying the issue scope. */
  jql: z.string().min(1),
  /** Upper limit on the issue count per snapshot — guards against shooting yourself in the foot. */
  maxIssues: z.number().int().min(1).max(10_000).default(1000),
  /** Which extra payloads to attach. All by default — "all the data". */
  include: z
    .strictObject({
      changelog: z.boolean().default(true),
      comments: z.boolean().default(true),
      worklog: z.boolean().default(true),
      attachments: z.boolean().default(true),
    })
    .default({
      changelog: true,
      comments: true,
      worklog: true,
      attachments: true,
    }),
  /** Which output formats to generate per issue. */
  render: renderFormatsSchema,
  /** Markdown views above this many characters split into head + `<KEY>.full.md` sidecar. */
  sidecarOverChars: z.number().int().min(1_000).max(1_000_000).default(SIDECAR_DEFAULT_CHARS),
});
type Snapshot = z.infer<typeof SnapshotConfig>;

/** Where the raw material lands when the config does not say — see `defaultOutputDir`. */
export const DEFAULT_OUTPUT_DIR = defaultOutputDir('jira');

export const ReadConfig = z
  .strictObject({
    outputDir: z.string().min(1).default(DEFAULT_OUTPUT_DIR),
    /**
     * External names for custom fields (`customfield_10011: "Sprint"`) — they win
     * over the auto-discovered registry and cover tokens that cannot read
     * `/rest/api/3/field` at all. Kept in the CONFIG, not in code: which id means
     * what is a property of the operator's Jira, not of this tool.
     */
    fieldNames: z.record(z.string().regex(/^customfield_\d+$/), z.string().min(1)).optional(),
    snapshots: z.array(SnapshotConfig).min(1),
  })
  .superRefine(assertUniqueSnapshotNames);

// ── Raw Jira shapes (light types, we validate only what we use) ──────────────

export interface RawIssue {
  readonly id: string;
  readonly key: string;
  readonly self?: string;
  readonly fields?: Record<string, unknown>;
  readonly changelog?: { readonly histories?: readonly RawChangelogEntry[]; readonly total?: number };
}
interface RawChangelogEntry {
  readonly id?: string;
  readonly created?: string;
  readonly author?: { readonly displayName?: string; readonly accountId?: string };
  readonly items?: readonly { readonly field?: string; readonly fromString?: string; readonly toString?: string }[];
}
interface RawComment {
  readonly id?: string;
  readonly author?: { readonly displayName?: string; readonly accountId?: string };
  readonly created?: string;
  readonly updated?: string;
  readonly body?: unknown;
}
interface RawWorklog {
  readonly id?: string;
  readonly author?: { readonly displayName?: string; readonly accountId?: string };
  readonly started?: string;
  readonly timeSpent?: string;
  readonly timeSpentSeconds?: number;
  readonly comment?: unknown;
}
interface RawAttachment {
  readonly id?: string;
  readonly filename?: string;
  readonly mimeType?: string;
  readonly size?: number;
  readonly created?: string;
  readonly author?: { readonly displayName?: string; readonly accountId?: string };
  readonly content?: string;
}
interface JqlSearchResponse {
  readonly issues: readonly RawIssue[];
  readonly nextPageToken?: string;
  readonly isLast?: boolean;
}

// ── Output shape ─────────────────────────────────────────────────────────────

export interface ExtractedIssue extends CanonicalIssue {
  readonly changelog?: readonly NormalisedChangelogEntry[];
  readonly comments?: readonly NormalisedComment[];
  readonly worklog?: readonly NormalisedWorklog[];
  readonly attachments?: readonly NormalisedAttachment[];
}
interface NormalisedChangelogEntry {
  readonly id?: string;
  readonly created?: string;
  readonly author?: string;
  readonly changes: readonly { readonly field: string; readonly from?: string; readonly to?: string }[];
}
interface NormalisedComment {
  readonly id?: string;
  readonly author?: string;
  readonly created?: string;
  readonly updated?: string;
  readonly bodyMd?: string;
}
interface NormalisedWorklog {
  readonly id?: string;
  readonly author?: string;
  readonly started?: string;
  readonly timeSpent?: string;
  readonly timeSpentSeconds?: number;
  readonly commentMd?: string;
}
interface NormalisedAttachment {
  readonly id?: string;
  readonly filename?: string;
  readonly mimeType?: string;
  readonly size?: number;
  readonly created?: string;
  readonly author?: string;
  readonly contentUrl?: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const log = createScriptLogger(SCRIPT_NAME);

async function fetchAllIssueKeys(
  http: HttpClient,
  jql: string,
  max: number,
): Promise<{ keys: readonly string[]; truncated: boolean }> {
  const keys: string[] = [];
  const seen = new Set<string>();
  let nextPageToken: string | undefined;
  const PAGE = 100;
  while (keys.length < max) {
    const remaining = max - keys.length;
    const maxResults = Math.min(PAGE, remaining);
    const resp: JqlSearchResponse = await http.request<JqlSearchResponse>({
      path: '/rest/api/3/search/jql',
      query: {
        jql,
        fields: 'key',
        maxResults,
        ...(nextPageToken ? { nextPageToken } : {}),
      },
    });
    const before = keys.length;
    // Deduped as they arrive: a token-echoing server re-serves the same page, and a
    // duplicated key would later race two concurrent per-issue workers on the SAME
    // output files. A page of pure repeats adds nothing, so the no-progress guard
    // below also fires for it.
    for (const issue of resp.issues) {
      if (seen.has(issue.key)) continue;
      seen.add(issue.key);
      keys.push(issue.key);
    }
    if (resp.isLast || !resp.nextPageToken) return { keys, truncated: false };
    // An empty page carrying a live nextPageToken is a server refusing to advance —
    // the same threat the sub-list paginators below guard against. Without this exit
    // the loop re-issued the identical request forever: keys.length never grew, so
    // neither loop condition could ever end it.
    if (keys.length === before) return { keys, truncated: true };
    nextPageToken = resp.nextPageToken;
  }
  // The loop left because `max` was reached while the server still had a next page —
  // that is a truncated scope, and a truncated scope must be SAID, not implied.
  return { keys, truncated: true };
}

async function fetchIssueFull(http: HttpClient, key: string, snapshot: Snapshot): Promise<RawIssue> {
  // Only `changelog` is expanded. `renderedFields` used to be requested too,
  // behind an `include.renderedFields` flag — and nothing ever read
  // `raw.renderedFields`. It was a bigger response, per issue, for nobody.
  const expandParts: string[] = [];
  if (snapshot.include.changelog) expandParts.push('changelog');
  return http.request<RawIssue>({
    path: `/rest/api/3/issue/${key}`,
    query: {
      fields: '*all',
      ...(expandParts.length > 0 ? { expand: expandParts.join(',') } : {}),
    },
  });
}

/** Ceiling on a per-issue sub-list. A ticket with more worklogs than this is pathological. */
export const MAX_SUBLIST_ITEMS = 2000;

/**
 * ONE `startAt`/`maxResults` paginator for Jira's per-issue sub-lists (`/comment`,
 * `/worklog`), parameterised only by the path, the response's array field and the item
 * mapper — the parts that genuinely differ.
 *
 * The loop is driven by the response's `total` and bounded three ways, because a
 * paginator with no exit condition of its own is one misbehaving server away from
 * running forever: a hard item ceiling, an empty page, and a no-progress guard for a
 * server that ignores `startAt` and keeps answering with page one. A short page ends
 * the walk ONLY when no `total` was ever reported: comments and worklogs used to be
 * two hand-kept twins, and the comments copy trusted a short page unconditionally —
 * an instance clamping `maxResults` below the requested 100 silently lost every
 * comment past page one while reporting `truncated: false`.
 */
// A SIBLING of shared/read-runtime's `walkOffsetPages`, kept separate on purpose:
// this walker pins a LAST-total policy and the `cleanEnd` short-page signal that
// Jira's sub-list endpoints need — folding it into the shared walker would change
// pinned semantics for no bug fixed.
async function fetchSubList<Raw, Out>(
  http: HttpClient,
  path: string,
  field: string,
  map: (raw: Raw) => Out,
  max: number,
): Promise<{ items: readonly Out[]; truncated: boolean }> {
  const out: Out[] = [];
  let startAt = 0;
  let total: number | undefined;
  let incomplete = false;
  let cleanEnd = false;
  let prevFirst: string | undefined;
  const PAGE = 100;
  while (out.length < max) {
    const resp = await http.request<{ total?: number } & Record<string, unknown>>({
      path,
      query: { startAt, maxResults: PAGE },
    });
    total = resp.total ?? total;
    const batch = (resp[field] as readonly Raw[] | undefined) ?? [];
    if (batch.length === 0) {
      cleanEnd = true;
      break;
    }
    // No-progress guard, done on CONTENT: a server that ignores `startAt` answers
    // every request with page one. An offset comparison cannot see that — a
    // non-empty batch always advances the local counter, which left the old
    // `advanced <= startAt` check as dead code while duplicated pages marched
    // into the output flagged complete.
    const first = JSON.stringify(batch[0]);
    if (first === prevFirst) {
      incomplete = true;
      break;
    }
    prevFirst = first;
    for (const item of batch) out.push(map(item));
    startAt += batch.length;
    if (total !== undefined && startAt >= total) {
      cleanEnd = true;
      break;
    }
    // No `total` to trust: a short page is the only remaining end-of-list signal.
    if (total === undefined && batch.length < PAGE) {
      cleanEnd = true;
      break;
    }
  }
  const kept = out.slice(0, max);
  // With a known total the answer is arithmetic. Without one, hitting the cap with
  // NO clean end signal means an unknown remainder — and since the page size
  // divides the default cap exactly, `out` never overshot `max`, so the old
  // `out.length > max` test reported an exactly-filled walk as complete.
  const truncated = incomplete || (total !== undefined ? kept.length < total : !cleanEnd);
  return { items: kept, truncated };
}

/** All comments of an issue — see {@link fetchSubList} for the pagination contract. */
async function fetchComments(
  http: HttpClient,
  key: string,
  max = MAX_SUBLIST_ITEMS,
): Promise<{ items: readonly NormalisedComment[]; truncated: boolean }> {
  return fetchSubList<RawComment, NormalisedComment>(
    http,
    `/rest/api/3/issue/${key}/comment`,
    'comments',
    (c) => ({
      id: c.id,
      author: c.author?.displayName ?? c.author?.accountId,
      created: c.created,
      updated: c.updated,
      bodyMd: adfToMarkdownSafe(c.body),
    }),
    max,
  );
}

/**
 * All worklog entries of an issue — see {@link fetchSubList} for the pagination
 * contract. One request with `maxResults: 1000` is not the same thing: it returns at
 * most 1000 entries — fewer if the instance lowers the ceiling — and the response's
 * `total` is the only thing that says whether more exist. A long-running ticket lost
 * the rest without a word.
 */
export async function fetchWorklogs(
  http: HttpClient,
  key: string,
  max = MAX_SUBLIST_ITEMS,
): Promise<{ items: readonly NormalisedWorklog[]; truncated: boolean }> {
  return fetchSubList<RawWorklog, NormalisedWorklog>(
    http,
    `/rest/api/3/issue/${key}/worklog`,
    'worklogs',
    (w) => ({
      id: w.id,
      author: w.author?.displayName ?? w.author?.accountId,
      started: w.started,
      timeSpent: w.timeSpent,
      timeSpentSeconds: w.timeSpentSeconds,
      commentMd: adfToMarkdownSafe(w.comment),
    }),
    max,
  );
}

/**
 * The full changelog of an issue.
 *
 * `expand=changelog` on the issue fetch returns only the FIRST page of history
 * (Jira caps it at 100 entries) and says so in `changelog.total` — which the
 * pipeline used to ignore, silently keeping the oldest 100 transitions of a
 * long-lived ticket. When the embedded page is complete this makes no extra
 * request; when it is not, it re-reads the history from the dedicated endpoint.
 */
export async function fetchFullChangelog(
  http: HttpClient,
  key: string,
  raw: RawIssue,
  max = MAX_SUBLIST_ITEMS,
): Promise<{ items: readonly NormalisedChangelogEntry[]; truncated: boolean }> {
  const embedded = normaliseChangelog(raw);
  const total = raw.changelog?.total;
  if (typeof total !== 'number' || embedded.length >= total) {
    return { items: embedded, truncated: false };
  }

  // Do NOT resume the dedicated endpoint at `embedded.length`. That would assume
  // the embedded page is the first N rows of the endpoint's own sequence, and
  // the two are separate paginated views whose ordering is not guaranteed to
  // line up — splicing them can duplicate some entries and skip others. When the
  // embedded page is short, re-read the whole history from one source.
  const out: NormalisedChangelogEntry[] = [];
  let startAt = 0;
  let prevFirst: string | undefined;
  const PAGE = 100;
  while (out.length < max && startAt < total) {
    const resp = await http.request<{ values?: readonly RawChangelogEntry[]; total?: number }>({
      path: `/rest/api/3/issue/${key}/changelog`,
      query: { startAt, maxResults: PAGE },
    });
    const batch = resp.values ?? [];
    if (batch.length === 0) break;
    // Same content-based no-progress guard as fetchSubList: a server ignoring
    // `startAt` re-served page one until the offset arithmetic PASSED `total`,
    // shipping a changelog with every entry duplicated and flagged complete.
    const first = JSON.stringify(batch[0]);
    if (first === prevFirst) break; // partial — the truncated arithmetic below says so
    prevFirst = first;
    out.push(...normaliseChangelogEntries(batch));
    startAt += batch.length;
  }
  // A dedicated-endpoint read that came back empty is worse than the embedded
  // page we already had; keep whichever holds more.
  if (out.length < embedded.length) return { items: embedded, truncated: embedded.length < total };
  const kept = out.slice(0, max);
  return { items: kept, truncated: kept.length < total };
}

function normaliseChangelog(raw: RawIssue): readonly NormalisedChangelogEntry[] {
  return normaliseChangelogEntries(raw.changelog?.histories ?? []);
}

function normaliseChangelogEntries(histories: readonly RawChangelogEntry[]): readonly NormalisedChangelogEntry[] {
  return histories.map((h) => ({
    id: h.id,
    created: h.created,
    author: h.author?.displayName ?? h.author?.accountId,
    changes: (h.items ?? []).map((i) => ({
      field: i.field ?? '',
      from: i.fromString ?? undefined,
      to: i.toString ?? undefined,
    })),
  }));
}

function normaliseAttachments(raw: RawIssue): readonly NormalisedAttachment[] {
  const attachments = (raw.fields?.['attachment'] as readonly RawAttachment[] | undefined) ?? [];
  return attachments.map((a) => ({
    id: a.id,
    filename: a.filename,
    mimeType: a.mimeType,
    size: a.size,
    created: a.created,
    author: a.author?.displayName ?? a.author?.accountId,
    contentUrl: a.content,
  }));
}

export function buildExtractedIssue(raw: RawIssue, registry: FieldRegistry, snapshot: Snapshot): ExtractedIssue {
  const base = reshapeJiraIssue(raw, registry);

  // Assemble a deterministic shape — the key order is fixed. The changelog is NOT
  // assembled here: fetchFullChangelog is its single writer — this function used to
  // compute the embedded page too, only for main() to overwrite it on every issue,
  // leaving two assembly paths for one field with tests pinning the dead one.
  const out: ExtractedIssue = {
    ...base,
    ...(snapshot.include.attachments ? { attachments: normaliseAttachments(raw) } : {}),
  };
  return out;
}

export function renderIssueMarkdown(issue: ExtractedIssue): string {
  const lines: string[] = [];
  lines.push(`# ${issue.key} — ${flatLine(issue.summary ?? '(no summary)')}`);
  lines.push('');
  lines.push(`- **Status**: ${issue.status?.name ?? '—'}`);
  lines.push(`- **Type**: ${issue.issueType?.name ?? '—'}`);
  lines.push(`- **Priority**: ${issue.priority?.name ?? '—'}`);
  lines.push(`- **Assignee**: ${issue.assignee?.displayName ?? '—'}`);
  lines.push(`- **Reporter**: ${issue.reporter?.displayName ?? '—'}`);
  lines.push(`- **Created**: ${issue.created ?? '—'}`);
  lines.push(`- **Updated**: ${issue.updated ?? '—'}`);
  if (issue.labels && issue.labels.length > 0) lines.push(`- **Labels**: ${issue.labels.join(', ')}`);
  if (issue.parent) lines.push(`- **Parent**: ${issueRefLine(issue.parent)}`);
  lines.push('');

  const desc = issue.descriptionMd;
  if (desc) {
    lines.push('## Description');
    lines.push('');
    lines.push(desc);
    lines.push('');
  }

  if (issue.subtasks && issue.subtasks.length > 0) {
    lines.push('## Subtasks');
    lines.push('');
    for (const sub of issue.subtasks) lines.push(`- ${issueRefLine(sub)}`);
    lines.push('');
  }

  if (issue.customFields && issue.customFields.length > 0) {
    lines.push('## Custom fields');
    lines.push('');
    for (const cf of issue.customFields) {
      lines.push(`- **${cf.name}** (\`${cf.id}\`): ${formatFieldValue(cf.value)}`);
    }
    lines.push('');
  }

  if (issue.comments && issue.comments.length > 0) {
    lines.push('## Comments');
    lines.push('');
    for (const c of issue.comments) {
      lines.push(`### ${c.author ?? 'unknown'} — ${c.created ?? '—'}`);
      lines.push('');
      if (c.bodyMd) lines.push(c.bodyMd);
      lines.push('');
    }
  }

  if (issue.worklog && issue.worklog.length > 0) {
    lines.push('## Worklog');
    lines.push('');
    for (const w of issue.worklog) {
      lines.push(`- ${w.started ?? '—'} · ${w.author ?? 'unknown'} · ${w.timeSpent ?? '—'}`);
      if (w.commentMd) lines.push(`  > ${w.commentMd.replaceAll('\n', '\n  > ')}`);
    }
    lines.push('');
  }

  if (issue.changelog && issue.changelog.length > 0) {
    lines.push('## Changelog');
    lines.push('');
    for (const h of issue.changelog) {
      lines.push(`### ${h.created ?? '—'} — ${h.author ?? 'unknown'}`);
      for (const ch of h.changes) {
        lines.push(`- **${ch.field}**: \`${ch.from ?? '∅'}\` → \`${ch.to ?? '∅'}\``);
      }
      lines.push('');
    }
  }

  if (issue.attachments && issue.attachments.length > 0) {
    lines.push('## Attachments');
    lines.push('');
    for (const a of issue.attachments) {
      lines.push(`- **${a.filename ?? '?'}** (${a.mimeType ?? '?'}, ${a.size ?? '?'} B) — ${a.contentUrl ?? ''}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Render one custom-field value as a **single line**, safe to sit after
 * `- **Name** (`id`): ` in a list item.
 *
 * It used to emit a fenced ```json block here. Mid-line, after the list marker
 * and the field label, those backticks open nothing — but the closing ``` lands
 * at column zero, where it reads as an OPENING fence. Everything after it — the
 * remaining fields, the comments, the worklog — is swallowed into a code block.
 * One structured value corrupted the rest of the document.
 *
 * So: compact JSON on one line, with backticks escaped and any newline removed.
 * The complete value is in the `.json` output next to this file; the markdown is
 * the readable view, not the archive.
 */
function formatFieldValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return inlineCode(String(value));
  }
  return inlineCode(JSON.stringify(value));
}

/**
 * Wrap `text` in an inline code span whose fence is longer than any backtick run
 * inside it, collapsing newlines so the span cannot break the list item.
 */
function inlineCode(text: string): string {
  const flat = text.replaceAll(/\s*\n\s*/gu, ' ').trim();
  return flat.length === 0 ? '—' : codeSpan(flat);
}

/**
 * OKF issue concept (render `'okf'`): frontmatter with upstream metadata
 * (summary free-form — quoting happens in the writer), body = the existing markdown renderer.
 * `parent`/`subtasks` are mirrored into `extra` so a frontmatter-only consumer sees the
 * hierarchy — burying it in the free-text body rendered an epic and its children as
 * unrelated concepts. Generic issuelinks stay a non-goal: `CanonicalIssue` does not carry
 * them — they will arrive together, not by guessing from the text.
 */
export function buildIssueConcept(issue: ExtractedIssue, renderedMarkdown?: string): OkfConceptInput {
  return {
    slug: issue.key,
    type: 'Jira Issue',
    title: `${issue.key} — ${issue.summary ?? '(no summary)'}`,
    description: `Issue ${issue.issueType?.name ?? '?'} in status ${issue.status?.name ?? '?'}.`,
    ...(issue.url !== undefined ? { resource: issue.url } : {}),
    ...(issue.labels !== undefined && issue.labels.length > 0 ? { tags: issue.labels } : {}),
    extra: [
      ['issue_key', issue.key],
      ...(issue.status?.name !== undefined ? [['status', issue.status.name] as const] : []),
      ...(issue.issueType?.name !== undefined ? [['issue_type', issue.issueType.name] as const] : []),
      ...(issue.priority?.name !== undefined ? [['priority', issue.priority.name] as const] : []),
      ...(issue.parent !== undefined ? [['parent', issue.parent.key] as const] : []),
      // The ARRAY form — okfFrontmatter renders it as a YAML list, like `tags`; a
      // comma-joined scalar forced every frontmatter consumer to re-split it.
      ...(issue.subtasks !== undefined && issue.subtasks.length > 0
        ? [['subtasks', issue.subtasks.map((sub) => sub.key)] as const]
        : []),
    ],
    // The caller usually already rendered the .md file — re-rendering every issue a
    // second time here doubled the markdown pass of an okf run.
    body: renderedMarkdown ?? renderIssueMarkdown(issue),
  };
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const run = await startReadRun({ scriptName: SCRIPT_NAME, source: 'jira', schema: ReadConfig, log });

  const http = createNamedHttpClient(SCRIPT_NAME, loadJiraAuth());
  // Load the field metadata BEFORE any issue is reshaped, and wait for it. The registry
  // used to lazy-load in the background on the first `byId()` miss, which labelled the
  // custom fields of the first issues `unknown` nondeterministically — lookups now simply
  // miss until this await has completed, so the await is the whole correctness story.
  const registry = createJiraFieldRegistry(http, { fieldNames: run.config.fieldNames });
  await registry.load();
  if (!registry.ready()) {
    log(
      'WARN: could not read /rest/api/3/field — custom fields fall back to raw ids (or to fieldNames from the config) ' +
        'with no name or type. The token most likely lacks `read:field-configuration:jira`.',
    );
  }
  let totalIssues = 0;

  for (const snapshot of run.config.snapshots) {
    log(`snapshot "${snapshot.name}": ${snapshot.jql}`);
    const snapshotDir = await run.snapshotDir(snapshot.name);

    const { keys, truncated: scopeTruncated } = await fetchAllIssueKeys(http, snapshot.jql, snapshot.maxIssues);
    log(`  resolved ${keys.length} issue key(s)`);
    if (scopeTruncated) {
      warnIfTruncated(
        log,
        true,
        `the JQL matches more than maxIssues=${String(snapshot.maxIssues)} — the snapshot is a PREFIX of the scope`,
      );
    }

    const wantOkf = snapshot.render.includes('okf');
    // Issues are processed CONCURRENTLY (bounded), and within one issue everything
    // that does not need `raw` runs in a single Promise.all — a fully serial walk
    // used at most one of the HTTP client's six permits, so a 1000-issue snapshot
    // paid ~4 sequential round-trips per issue for work the client could overlap.
    const results = await mapWithConcurrency(keys, PIPELINE_CONCURRENCY, async (key) => {
      const [raw, comments, worklog] = await Promise.all([
        fetchIssueFull(http, key, snapshot),
        snapshot.include.comments ? fetchComments(http, key) : undefined,
        snapshot.include.worklog ? fetchWorklogs(http, key) : undefined,
      ]);
      // Only the changelog reads `raw` (its embedded fast path), so it alone chains.
      const changelog = snapshot.include.changelog ? await fetchFullChangelog(http, key, raw) : undefined;
      const built = buildExtractedIssue(raw, registry, snapshot);

      const mutableExtras: { -readonly [K in keyof ExtractedIssue]?: ExtractedIssue[K] } = {};
      if (comments) {
        if (comments.truncated)
          warnIfTruncated(log, true, `comments of ${key} hit the ${String(MAX_SUBLIST_ITEMS)}-item cap`);
        mutableExtras.comments = comments.items;
      }
      if (worklog) {
        warnIfTruncated(log, worklog.truncated, `worklog of ${key} hit the ${String(MAX_SUBLIST_ITEMS)}-item cap`);
        mutableExtras.worklog = worklog.items;
      }
      if (changelog) {
        warnIfTruncated(log, changelog.truncated, `changelog of ${key} is incomplete`);
        mutableExtras.changelog = changelog.items;
      }

      const finalIssue: ExtractedIssue = { ...built, ...mutableExtras };
      const markdown = renderIssueMarkdown(finalIssue);
      const files = await writePipelineOutputs({
        dir: snapshotDir,
        basename: finalIssue.key,
        data: finalIssue,
        markdown,
        formats: snapshot.render,
        sidecarOverChars: snapshot.sidecarOverChars,
      });
      // Only the key (and, for okf, the ready concept) leaves the worker: returning
      // the fully-hydrated issue pinned every comment, worklog and changelog in heap
      // until the manifest write — hundreds of MB at maxIssues=10000 — to produce a
      // key list.
      return { key: finalIssue.key, files, concept: wantOkf ? buildIssueConcept(finalIssue, markdown) : undefined };
    });
    const written = results.map((result) => result.key);
    // Per-file sizes, so an agent can BUDGET its context before opening anything.
    const files = results.flatMap((result) => result.files);
    const concepts: OkfConceptInput[] = results.flatMap((result) => (result.concept ? [result.concept] : []));
    totalIssues += results.length;

    let okfConcepts = 0;
    if (wantOkf) {
      okfConcepts = await writeOkfBundle({
        snapshotDir,
        source: 'jira',
        snapshotName: snapshot.name,
        conceptsDir: 'issues',
        concepts,
        stamp: run.stamp,
      });
      log(`  okf bundle: ${okfConcepts} concept(s) → ${join(snapshotDir, OKF_BUNDLE_DIR)}`);
    }

    await writeManifest(
      snapshotDir,
      run.manifest(snapshot, {
        jql: snapshot.jql,
        // A capped scope looks exactly like a small scope — the manifest says which it was.
        truncated: scopeTruncated,
        issueCount: written.length,
        issueKeys: written,
        files,
        include: snapshot.include,
        ...(wantOkf ? { okfConcepts } : {}),
      }),
    );
    log(`  wrote ${written.length} issue(s) → ${snapshotDir}`);
  }

  run.finish(totalIssues);
}

await runIfMain(SCRIPT_NAME, import.meta.url, main);
