#!/usr/bin/env node
/**
 * read-confluence — deterministic Confluence data pipeline.
 *
 * Reads its whole scope from `read.config.confluence.json` over the shared
 * layer (`auth`, `http-client`, `adf`): nothing is inferred and nothing is asked
 * interactively, so two runs of the same config over unchanged pages produce the
 * same files.
 *
 * A snapshot has one of 3 modes:
 *   - `type: "page"`  → a single page by `pageId`.
 *   - `type: "tree"`  → page + descendants (BFS, down to `depth` levels).
 *   - `type: "label"` → every page carrying label `label` (optionally within `space`).
 *
 * Per page we fetch:
 *   - Body (ADF → Markdown, in full).
 *   - Comments (footer + inline, ADF → Markdown).
 *   - Attachments (metadata list, not the files).
 *   - Labels.
 *   - Ancestors (path to the root).
 *
 * Output: `<outputDir>/<stamp>/<snapshot>/<pageId>.json` (+ `.md` if render includes markdown)
 *   plus `_manifest.json` with the run metadata.
 *
 * Run: `npm run read -- confluence [path/to/read.config.confluence.json]`
 */
import { join } from 'node:path';
import { z } from 'zod';

import { adfToMarkdownSafe } from '../shared/adf.js';
import { loadConfluenceAuth } from '../shared/auth.js';
import { buildLabelSearchCql } from '../shared/confluence-cql.js';
import {
  assertUniqueSnapshotNames,
  createScriptLogger,
  defaultOutputDir,
  mapWithConcurrency,
  PIPELINE_CONCURRENCY,
  parseCursorFromLink,
  renderFormatsWithOkfSchema as renderFormatsSchema,
  runIfMain,
  snapshotNameSchema,
  SIDECAR_DEFAULT_CHARS,
  startReadRun,
  warnIfTruncated,
  writeManifest,
  writePipelineOutputs,
  type RenderFormat,
  type WrittenFile,
} from '../shared/read-runtime.js';
import { createNamedHttpClient, type HttpClient } from '../shared/http-client.js';
import { OKF_BUNDLE_DIR, writeOkfBundle, type OkfConceptInput } from '../shared/okf.js';

const SCRIPT_NAME = 'read-confluence';

// ── Config ───────────────────────────────────────────────────────────────────

const PageSnapshot = z.strictObject({
  name: snapshotNameSchema,
  type: z.literal('page'),
  pageId: z.string().regex(/^\d+$/),
  render: renderFormatsSchema,
  /** Markdown views above this many characters split into head + `<id>.full.md` sidecar. */
  sidecarOverChars: z.number().int().min(1_000).max(1_000_000).default(SIDECAR_DEFAULT_CHARS),
});
const TreeSnapshot = z.strictObject({
  name: snapshotNameSchema,
  type: z.literal('tree'),
  rootPageId: z.string().regex(/^\d+$/),
  /** Maximum BFS depth (1 = root only, 2 = root + children, …). */
  depth: z.number().int().min(1).max(10).default(3),
  maxPages: z.number().int().min(1).max(5000).default(500),
  render: renderFormatsSchema,
  /** Markdown views above this many characters split into head + `<id>.full.md` sidecar. */
  sidecarOverChars: z.number().int().min(1_000).max(1_000_000).default(SIDECAR_DEFAULT_CHARS),
});
const LabelSnapshot = z.strictObject({
  name: snapshotNameSchema,
  type: z.literal('label'),
  label: z.string().min(1),
  space: z.string().optional(),
  maxPages: z.number().int().min(1).max(5000).default(500),
  render: renderFormatsSchema,
  /** Markdown views above this many characters split into head + `<id>.full.md` sidecar. */
  sidecarOverChars: z.number().int().min(1_000).max(1_000_000).default(SIDECAR_DEFAULT_CHARS),
});

const SnapshotConfig = z.discriminatedUnion('type', [PageSnapshot, TreeSnapshot, LabelSnapshot]);
type Snapshot = z.infer<typeof SnapshotConfig>;

export const ReadConfig = z
  .strictObject({
    outputDir: z.string().min(1).default(defaultOutputDir('confluence')),
    /**
     * Human names for numeric space ids (`"123456": "Dokumentacja"`) — the v2 API
     * returns only the id, and which id means what is a property of the operator's
     * Confluence, not of this tool. Kept in the CONFIG, like jira's `fieldNames`.
     */
    spaceNames: z.record(z.string().regex(/^\d+$/), z.string().min(1)).optional(),
    snapshots: z.array(SnapshotConfig).min(1),
  })
  .superRefine(assertUniqueSnapshotNames);

// ── Raw Confluence shapes ────────────────────────────────────────────────────

interface RawPageBody {
  readonly value?: unknown;
  readonly representation?: string;
}
interface RawPage {
  readonly id: string;
  readonly title?: string;
  readonly spaceId?: string;
  readonly status?: string;
  readonly authorId?: string;
  readonly createdAt?: string;
  readonly version?: { readonly number?: number };
  readonly body?: { readonly atlas_doc_format?: RawPageBody };
  readonly _links?: { readonly webui?: string; readonly base?: string };
}
interface RawComment {
  readonly id?: string;
  readonly title?: string;
  readonly createdAt?: string;
  readonly version?: { readonly authorId?: string; readonly number?: number };
  readonly body?: { readonly atlas_doc_format?: RawPageBody };
}
interface RawAttachment {
  readonly id?: string;
  readonly title?: string;
  readonly mediaType?: string;
  readonly fileSize?: number;
  readonly createdAt?: string;
  readonly version?: { readonly number?: number };
  readonly downloadLink?: string;
}
interface RawLabel {
  readonly id?: string;
  readonly name?: string;
  readonly prefix?: string;
}
interface RawAncestor {
  readonly id?: string;
  readonly title?: string;
}

// ── Output ───────────────────────────────────────────────────────────────────

export interface ExtractedPage {
  readonly id: string;
  readonly title?: string;
  readonly spaceId?: string;
  /** Human name for `spaceId` — from the config's `spaceNames`, never guessed. */
  readonly spaceName?: string;
  readonly status?: string;
  readonly version?: number;
  readonly authorId?: string;
  readonly createdAt?: string;
  readonly url?: string;
  readonly bodyMd?: string;
  readonly labels: readonly string[];
  readonly ancestors: readonly { id: string; title?: string }[];
  readonly comments: readonly NormalisedComment[];
  readonly attachments: readonly NormalisedAttachment[];
  readonly childPageIds: readonly string[];
  /** Present when the children walk stopped abnormally — the list above is partial. */
  readonly childPageIdsTruncated?: true;
}
interface NormalisedComment {
  readonly id?: string;
  readonly title?: string;
  readonly authorId?: string;
  readonly createdAt?: string;
  readonly version?: number;
  readonly bodyMd?: string;
}
interface NormalisedAttachment {
  readonly id?: string;
  readonly title?: string;
  readonly mediaType?: string;
  readonly fileSize?: number;
  readonly createdAt?: string;
  readonly version?: number;
  readonly downloadLink?: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const log = createScriptLogger(SCRIPT_NAME);

/**
 * The page's browse URL from its `_links` — ONE formula for both confluence
 * pipelines (write-miro-style import), because the two used to disagree: the read
 * side emitted a dead RELATIVE url when `_links.base` was absent while the write
 * side hardcoded `/wiki`, wrong on a Data Center context path.
 */
export function pageWebUrl(
  links: { readonly base?: string; readonly webui?: string } | undefined,
  fallbackBase?: string,
): string | undefined {
  if (!links?.webui) return undefined;
  const base = links.base ?? fallbackBase;
  return base === undefined ? undefined : `${base}${links.webui}`;
}

async function fetchPage(http: HttpClient, pageId: string): Promise<RawPage> {
  return http.request<RawPage>({
    path: `/wiki/api/v2/pages/${pageId}`,
    query: { 'body-format': 'atlas_doc_format' },
  });
}

/**
 * Child-id lists already fetched in THIS run.
 *
 * In `tree` mode every non-leaf page is asked for its children twice: once to
 * expand the BFS frontier in `resolvePageIds`, and again while assembling the
 * page record in `buildExtractedPage`. The endpoint is paginated, so for a wide
 * tree that is a second full round of requests for an answer we already have.
 * The process is one-shot — it extracts and exits — so a run-scoped map is the
 * whole lifetime of this cache; nothing here outlives the snapshot.
 */
const childIdCache = new Map<string, ChildIds>();

interface ChildIds {
  readonly ids: readonly string[];
  /**
   * True when the children walk stopped abnormally (cursor echo, turn ceiling).
   * Discarding this used to prune whole subtrees SILENTLY: the partial list was
   * cached for the rest of the run and the manifest still said truncated:false.
   */
  readonly truncated: boolean;
}

async function fetchChildren(http: HttpClient, pageId: string): Promise<ChildIds> {
  const cached = childIdCache.get(pageId);
  if (cached) return cached;
  const fetched = await fetchChildrenUncached(http, pageId);
  childIdCache.set(pageId, fetched);
  return fetched;
}

/** Ceiling on cursor-walk turns — the same defence figma's paginateLibrary carries. */
const MAX_CURSOR_TURNS = 200;

/**
 * Guarded walk over a Confluence cursor collection. The only NATURAL exit is a
 * missing `_links.next`, so two artificial ones stand in front of it: an
 * equal-cursor check and a turn ceiling — a server (or intercepting proxy) echoing
 * the cursor it was just asked for would otherwise be re-fetched forever while the
 * result array grows until OOM. jira's sub-list paginator and figma's
 * paginateLibrary guard against exactly this threat; these loops used to trust the
 * cursor unconditionally.
 *
 * `fetchPage` receives the cursor and the count collected so far (for callers that
 * shrink their per-page `limit` to the remaining budget).
 */
async function walkCursor<R>(args: {
  readonly label: string;
  readonly max?: number;
  readonly fetchPage: (
    cursor: string | undefined,
    collected: number,
  ) => Promise<{ results: readonly R[]; next: string | undefined }>;
}): Promise<{ items: readonly R[]; truncated: boolean }> {
  const max = args.max ?? Number.POSITIVE_INFINITY;
  const out: R[] = [];
  let cursor: string | undefined;
  for (let turn = 0; turn < MAX_CURSOR_TURNS; turn += 1) {
    if (out.length >= max) return { items: out.slice(0, max), truncated: true };
    const page = await args.fetchPage(cursor, out.length);
    out.push(...page.results);
    if (!page.next) return { items: out.slice(0, max), truncated: out.length > max };
    if (page.next === cursor) {
      log(`WARN: ${args.label} — the server echoed the cursor it was asked for; stopping an endless walk`);
      return { items: out.slice(0, max), truncated: true };
    }
    cursor = page.next;
  }
  log(`WARN: ${args.label} — hit the ${MAX_CURSOR_TURNS}-turn ceiling; the walk is incomplete`);
  return { items: out.slice(0, max), truncated: true };
}

/**
 * One request/parse wrapper for every v2 cursor collection — five walkers used to
 * hand-copy the same closure around {@link walkCursor}, and a contract fix applied
 * to four of them would leave the fifth silently truncating at page one.
 */
function walkV2Collection<R>(
  http: HttpClient,
  args: {
    readonly label: string;
    readonly path: string;
    readonly limit: number;
    readonly query?: Record<string, string>;
  },
): Promise<{ items: readonly R[]; truncated: boolean }> {
  return walkCursor<R>({
    label: args.label,
    fetchPage: async (cursor) => {
      const resp = await http.request<{ results?: readonly R[]; _links?: { next?: string } }>({
        path: args.path,
        query: { ...args.query, limit: args.limit, ...(cursor ? { cursor } : {}) },
      });
      return { results: resp.results ?? [], next: parseCursorFromLink(resp._links?.next) };
    },
  });
}

async function fetchChildrenUncached(http: HttpClient, pageId: string): Promise<ChildIds> {
  const walk = await walkV2Collection<{ id?: string }>(http, {
    label: `children of page ${pageId}`,
    path: `/wiki/api/v2/pages/${pageId}/children`,
    limit: 250,
  });
  return {
    ids: walk.items.map((r) => r.id).filter((id): id is string => typeof id === 'string' && id.length > 0),
    truncated: walk.truncated,
  };
}

async function fetchAncestors(http: HttpClient, pageId: string): Promise<readonly { id: string; title?: string }[]> {
  const resp = await http.request<{ results?: readonly RawAncestor[] }>({
    path: `/wiki/api/v2/pages/${pageId}/ancestors`,
  });
  return (resp.results ?? [])
    .filter((a): a is RawAncestor & { id: string } => typeof a.id === 'string')
    .map((a) => ({ id: a.id, title: a.title }));
}

async function fetchLabels(http: HttpClient, pageId: string): Promise<readonly string[]> {
  // Paginated like every other v2 collection: a single 250-limit request used to
  // silently drop label 251+ while the sibling walkers followed their cursors.
  const walk = await walkV2Collection<RawLabel>(http, {
    label: `labels of page ${pageId}`,
    path: `/wiki/api/v2/pages/${pageId}/labels`,
    limit: 250,
  });
  return walk.items.map((l) => l.name).filter((n): n is string => typeof n === 'string' && n.length > 0);
}

async function fetchComments(http: HttpClient, pageId: string): Promise<readonly NormalisedComment[]> {
  const out: NormalisedComment[] = [];
  for (const endpoint of ['footer-comments', 'inline-comments'] as const) {
    const walk = await walkV2Collection<RawComment>(http, {
      label: `${endpoint} of page ${pageId}`,
      path: `/wiki/api/v2/pages/${pageId}/${endpoint}`,
      limit: 100,
      query: { 'body-format': 'atlas_doc_format' },
    });
    for (const c of walk.items) {
      out.push({
        id: c.id,
        title: c.title,
        authorId: c.version?.authorId,
        createdAt: c.createdAt,
        version: c.version?.number,
        bodyMd: adfToMarkdownSafe(c.body?.atlas_doc_format?.value),
      });
    }
  }
  return out;
}

async function fetchAttachments(http: HttpClient, pageId: string): Promise<readonly NormalisedAttachment[]> {
  // Paginated for the same reason as fetchLabels — 250 attachments is real on a
  // long-lived page, and the tail used to vanish without a marker.
  const walk = await walkV2Collection<RawAttachment>(http, {
    label: `attachments of page ${pageId}`,
    path: `/wiki/api/v2/pages/${pageId}/attachments`,
    limit: 250,
  });
  return walk.items.map((a) => ({
    id: a.id,
    title: a.title,
    mediaType: a.mediaType,
    fileSize: a.fileSize,
    createdAt: a.createdAt,
    version: a.version?.number,
    downloadLink: a.downloadLink,
  }));
}

async function fetchPagesByLabel(
  http: HttpClient,
  label: string,
  space: string | undefined,
  max: number,
): Promise<{ ids: readonly string[]; truncated: boolean }> {
  // Reuse the shared, escaped CQL builder so label/space values can't malform the query.
  const cql = buildLabelSearchCql({ label, ...(space ? { space } : {}) });

  const walk = await walkCursor<string>({
    label: `CQL search for label "${label}"`,
    max,
    fetchPage: async (cursor, collected) => {
      const resp = await http.request<{
        results?: readonly { content?: { id?: string; type?: string } }[];
        _links?: { next?: string };
      }>({
        path: '/wiki/rest/api/search',
        query: { cql, limit: Math.min(50, max - collected), ...(cursor ? { cursor } : {}) },
      });
      // Filter to page ids HERE so the walker's budget counts what the caller keeps.
      const ids = (resp.results ?? []).flatMap((r) =>
        r.content?.id && r.content.type === 'page' ? [r.content.id] : [],
      );
      return { results: ids, next: parseCursorFromLink(resp._links?.next) };
    },
  });
  return { ids: walk.items, truncated: walk.truncated };
}

async function buildExtractedPage(
  http: HttpClient,
  pageId: string,
  spaceNames?: Readonly<Record<string, string>>,
): Promise<ExtractedPage> {
  const [raw, labels, ancestors, comments, attachments, children] = await Promise.all([
    fetchPage(http, pageId),
    fetchLabels(http, pageId),
    fetchAncestors(http, pageId),
    fetchComments(http, pageId),
    fetchAttachments(http, pageId),
    fetchChildren(http, pageId),
  ]);

  return {
    id: raw.id,
    title: raw.title,
    spaceId: raw.spaceId,
    ...(raw.spaceId !== undefined && spaceNames?.[raw.spaceId] !== undefined
      ? { spaceName: spaceNames[raw.spaceId] }
      : {}),
    status: raw.status,
    version: raw.version?.number,
    authorId: raw.authorId,
    createdAt: raw.createdAt,
    url: pageWebUrl(raw._links),
    bodyMd: adfToMarkdownSafe(raw.body?.atlas_doc_format?.value),
    labels,
    ancestors,
    comments,
    attachments,
    childPageIds: children.ids,
    ...(children.truncated ? { childPageIdsTruncated: true as const } : {}),
  };
}

export function renderPageMarkdown(page: ExtractedPage): string {
  const lines: string[] = [];
  lines.push(`# ${page.title ?? `Page ${page.id}`}`);
  lines.push('');
  lines.push(`- **ID**: \`${page.id}\``);
  if (page.spaceId) {
    lines.push(
      `- **Space**: ${page.spaceName ? `${page.spaceName} (` : ''}\`${page.spaceId}\`${page.spaceName ? ')' : ''}`,
    );
  }
  lines.push(`- **Status**: ${page.status ?? '—'}`);
  lines.push(`- **Version**: ${page.version ?? '—'}`);
  lines.push(`- **Created**: ${page.createdAt ?? '—'}`);
  if (page.url) lines.push(`- **URL**: ${page.url}`);
  if (page.labels.length > 0) lines.push(`- **Labels**: ${page.labels.join(', ')}`);
  if (page.ancestors.length > 0) {
    lines.push(`- **Path**: ${page.ancestors.map((a) => a.title ?? a.id).join(' › ')}`);
  }
  lines.push('');

  if (page.bodyMd) {
    lines.push('## Body');
    lines.push('');
    lines.push(page.bodyMd);
    lines.push('');
  }

  if (page.comments.length > 0) {
    lines.push('## Comments');
    lines.push('');
    for (const c of page.comments) {
      lines.push(`### ${c.title ?? '(no title)'} — ${c.createdAt ?? '—'}`);
      if (c.bodyMd) {
        lines.push('');
        lines.push(c.bodyMd);
      }
      lines.push('');
    }
  }

  if (page.attachments.length > 0) {
    lines.push('## Attachments');
    lines.push('');
    for (const a of page.attachments) {
      lines.push(`- **${a.title ?? '?'}** (${a.mediaType ?? '?'}, ${a.fileSize ?? '?'} B)`);
    }
    lines.push('');
  }

  if (page.childPageIds.length > 0) {
    lines.push('## Children');
    lines.push('');
    for (const id of page.childPageIds) {
      lines.push(`- \`${id}\``);
    }
    lines.push('');
  }

  return lines.join('\n');
}

async function writePageOutputs(
  baseDir: string,
  page: ExtractedPage,
  formats: readonly RenderFormat[],
  sidecarOverChars: number,
): Promise<readonly WrittenFile[]> {
  return writePipelineOutputs({
    dir: baseDir,
    basename: page.id,
    data: page,
    markdown: renderPageMarkdown(page),
    formats,
    sidecarOverChars,
  });
}

/**
 * OKF concept of a page (render `'okf'`): frontmatter with upstream metadata
 * (free-form titles — quoting happens in the writer), body = the existing markdown renderer
 * + a section of links to ancestor/child concepts PRESENT in this snapshot
 * (deterministically: id ∈ the set of extracted pages — the Confluence graph
 * mapped onto the bundle's relative links).
 */
export function buildPageConcept(page: ExtractedPage, inSnapshot: ReadonlySet<string>): OkfConceptInput {
  const links: string[] = [];
  for (const a of page.ancestors) {
    if (inSnapshot.has(a.id)) links.push(`- Ancestor: [${a.id}](${a.id}.md)`);
  }
  for (const childId of page.childPageIds) {
    if (inSnapshot.has(childId)) links.push(`- Child: [${childId}](${childId}.md)`);
  }
  const linksSection = links.length > 0 ? `\n\n## Related concepts\n\n${links.join('\n')}` : '';
  return {
    slug: page.id,
    type: 'Confluence Page',
    title: page.title ?? `Page ${page.id}`,
    description: `Confluence page (space ${page.spaceName ?? page.spaceId ?? '?'}, version ${String(page.version ?? '?')}).`,
    ...(page.url !== undefined ? { resource: page.url } : {}),
    ...(page.labels.length > 0 ? { tags: page.labels } : {}),
    extra: [
      ['page_id', page.id],
      ...(page.spaceId !== undefined ? [['space_id', page.spaceId] as const] : []),
      ...(page.spaceName !== undefined ? [['space_name', page.spaceName] as const] : []),
      ...(page.status !== undefined ? [['status', page.status] as const] : []),
    ],
    body: renderPageMarkdown(page) + linksSection,
  };
}

// ── Resolvers per snapshot type ──────────────────────────────────────────────

async function resolvePageIds(
  http: HttpClient,
  snapshot: Snapshot,
): Promise<{ ids: readonly string[]; truncated: boolean }> {
  if (snapshot.type === 'page') return { ids: [snapshot.pageId], truncated: false };
  if (snapshot.type === 'label') {
    const result = await fetchPagesByLabel(http, snapshot.label, snapshot.space, snapshot.maxPages);
    // Deduped: a page relabeled mid-walk (or a cursor-echoing proxy) can appear on
    // two CQL pages, and a duplicate id would race two concurrent workers on the
    // same output files while inflating the manifest counts.
    return { ids: [...new Set(result.ids)], truncated: result.truncated };
  }

  // tree — BFS from rootPageId down to snapshot.depth levels
  const seen = new Set<string>();
  const order: string[] = [];
  let frontier: string[] = [snapshot.rootPageId];
  let leftover = false;
  let childWalkTruncated = false;
  for (let level = 0; level < snapshot.depth && !leftover; level += 1) {
    const toVisit: string[] = [];
    for (const id of frontier) {
      if (seen.has(id)) continue;
      // Checked BEFORE the visit: truncation means an unvisited page was actually
      // in hand when the cap fired. Checking after the push reported a tree of
      // EXACTLY maxPages pages as truncated — a permanent false alarm in the
      // manifest of a complete snapshot.
      if (order.length + toVisit.length >= snapshot.maxPages) {
        leftover = true;
        break;
      }
      seen.add(id);
      toVisit.push(id);
    }
    order.push(...toVisit);
    if (leftover || level + 1 >= snapshot.depth) break;
    // The whole level's child lists come down concurrently — one frontier node at
    // a time serialized the walk on a single client permit.
    const childLists = await mapWithConcurrency(toVisit, PIPELINE_CONCURRENCY, (id) => fetchChildren(http, id));
    const next: string[] = [];
    for (const children of childLists) {
      // A children walk that stopped abnormally pruned its whole subtree — that is
      // scope truncation, and it used to evaporate into a stderr WARN while the
      // manifest said complete.
      if (children.truncated) childWalkTruncated = true;
      for (const c of children.ids) if (!seen.has(c)) next.push(c);
    }
    frontier = next;
    if (frontier.length === 0) break;
  }
  return { ids: order, truncated: leftover || childWalkTruncated };
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const run = await startReadRun({ scriptName: SCRIPT_NAME, source: 'confluence', schema: ReadConfig, log });
  const http = createNamedHttpClient(SCRIPT_NAME, loadConfluenceAuth());
  let totalPages = 0;

  for (const snapshot of run.config.snapshots) {
    log(`snapshot "${snapshot.name}" (${snapshot.type})`);
    const snapshotDir = await run.snapshotDir(snapshot.name);

    const { ids: pageIds, truncated } = await resolvePageIds(http, snapshot);
    log(`  resolved ${pageIds.length} page id(s)`);
    if (truncated) {
      warnIfTruncated(log, true, 'the scope holds more pages than the maxPages cap — the snapshot is a PREFIX of it');
    }

    const wantOkf = snapshot.render.includes('okf');
    // The cross-link set is known UP FRONT (resolvePageIds returned the full list),
    // so each worker builds its okf concept immediately and only the id (plus that
    // concept) leaves it. Returning whole ExtractedPages pinned every body, comment
    // and attachment in heap until the snapshot ended — while a comment claimed the
    // collection was okf-only.
    const inSnapshot = new Set(pageIds);
    // Pages are independent — processed concurrently (bounded); the serial walk
    // used one of the client's six permits while five sat idle.
    const results = await mapWithConcurrency(pageIds, PIPELINE_CONCURRENCY, async (pageId) => {
      const page = await buildExtractedPage(http, pageId, run.config.spaceNames);
      const files = await writePageOutputs(snapshotDir, page, snapshot.render, snapshot.sidecarOverChars);
      return { id: page.id, files, concept: wantOkf ? buildPageConcept(page, inSnapshot) : undefined };
    });
    const written = results.map((result) => result.id);
    // Per-file sizes, so an agent can BUDGET its context before opening anything.
    const files = results.flatMap((result) => result.files);
    totalPages += results.length;

    let okfConcepts = 0;
    if (wantOkf) {
      okfConcepts = await writeOkfBundle({
        snapshotDir,
        source: 'confluence',
        snapshotName: snapshot.name,
        conceptsDir: 'pages',
        concepts: results.flatMap((result) => (result.concept ? [result.concept] : [])),
        // The RUN stamp, never the wall clock — jira does the same, and the header's
        // determinism promise (same config, same data, same bytes) depends on it.
        stamp: run.stamp,
      });
      log(`  okf bundle: ${okfConcepts} concept(s) → ${join(snapshotDir, OKF_BUNDLE_DIR)}`);
    }

    await writeManifest(
      snapshotDir,
      run.manifest(snapshot, {
        type: snapshot.type,
        truncated,
        pageCount: written.length,
        pageIds: written,
        files,
        ...(wantOkf ? { okfConcepts } : {}),
      }),
    );
    log(`  wrote ${written.length} page(s) → ${snapshotDir}`);
  }

  run.finish(totalPages);
}

await runIfMain(SCRIPT_NAME, import.meta.url, main);
