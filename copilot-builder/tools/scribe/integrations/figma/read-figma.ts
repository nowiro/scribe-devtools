#!/usr/bin/env node
/**
 * read-figma — batch extraction from Figma into on-disk snapshots.
 *
 * What we extract, and why exactly this
 * ------------------------------------
 * Four snapshot types, ordered from the most durable to the most ephemeral:
 *
 *  1. `tokens` — file variables mapped onto design tokens and emitted to CSS, SCSS and TS.
 *     This is the one result of this integration meant to be consumed outside Figma, so the
 *     snapshot stores both forms side by side: the data (JSON) and the ready-to-use files.
 *  2. `components` and `styles` — the team library inventory. Changes rarely, and answers
 *     the question "does this component already exist", asked before every new implementation.
 *  3. `file_summary` — file metadata and a shallow page structure. Deliberately **not** the full
 *     tree: `GET /v1/files/{key}` on a real project returns megabytes, of which the snapshot
 *     needs a few dozen lines. `pruneNodeTree` prunes the tree.
 *
 * What we deliberately do NOT extract: renders. `GET /v1/images` returns addresses with a short
 * lifetime, so a snapshot holding them would be dead before anyone read it, and the image bytes
 * themselves have nothing to offer a textual snapshot.
 *
 * A limitation inherited from the API: the Variables API is an Enterprise plan feature and
 * requires the `file_variables:read` scope. Without them `tokens` ends with a readable error, not
 * with an empty snapshot faking success — an empty snapshot would be worse, because it would look
 * like "a file without tokens".
 *
 * Run: `npm run read -- figma [path/to/read.config.figma.json]`
 */
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { z } from 'zod';

import { loadFigmaAuth } from '../shared/auth.js';
import {
  assertUniqueSnapshotNames,
  createScriptLogger,
  defaultOutputDir,
  mapWithConcurrency,
  mdTable,
  PIPELINE_CONCURRENCY,
  renderFormatsSchema,
  runIfMain,
  snapshotNameSchema,
  startReadRun,
  warnIfTruncated,
  writeManifest,
  writePipelineOutputs,
} from '../shared/read-runtime.js';
import { emitForFormat, mapFigmaVariables, type RawVariablesResponse, type Token } from '../shared/figma-tokens.js';
import { pruneNodeTree } from '../shared/figma-node-tree.js';
import { createNamedHttpClient, type HttpClient } from '../shared/http-client.js';

const SCRIPT_NAME = 'read-figma';
const log = createScriptLogger(SCRIPT_NAME);

// ── Config ───────────────────────────────────────────────────────────────────

const FileKey = z.string().regex(/^[A-Za-z0-9]{20,}$/);
const TeamId = z.string().regex(/^\d+$/);

const baseSnapshot = {
  name: snapshotNameSchema,
  render: renderFormatsSchema,
} as const;

const TokensSnapshot = z.strictObject({
  ...baseSnapshot,
  type: z.literal('tokens'),
  fileKey: FileKey,
  /** Emitter formats written next to the JSON. Empty = data only, without the ready-to-use form. */
  formats: z.array(z.enum(['css', 'scss', 'ts'])).default(['css', 'scss', 'ts']),
});

const ComponentsSnapshot = z.strictObject({
  ...baseSnapshot,
  type: z.literal('components'),
  teamId: TeamId,
  maxItems: z.number().int().min(1).max(10_000).default(1000),
});

const StylesSnapshot = z.strictObject({
  ...baseSnapshot,
  type: z.literal('styles'),
  teamId: TeamId,
  maxItems: z.number().int().min(1).max(10_000).default(1000),
});

const FileSummarySnapshot = z.strictObject({
  ...baseSnapshot,
  type: z.literal('file_summary'),
  fileKey: FileKey,
  /** Hard ceiling on the pruned tree. Guards the snapshot against megabytes from `GET /v1/files`. */
  maxNodes: z.number().int().min(10).max(5000).default(400),
});

const SnapshotConfig = z.discriminatedUnion('type', [
  TokensSnapshot,
  ComponentsSnapshot,
  StylesSnapshot,
  FileSummarySnapshot,
]);

export const ReadConfig = z
  .strictObject({
    outputDir: z.string().min(1).default(defaultOutputDir('figma')),
    snapshots: z.array(SnapshotConfig).min(1),
  })
  .superRefine(assertUniqueSnapshotNames);

// ── Raw shapes ───────────────────────────────────────────────────────────────

interface RawLibraryItem {
  readonly key?: string;
  readonly file_key?: string;
  readonly node_id?: string;
  readonly name?: string;
  readonly description?: string;
  readonly updated_at?: string;
  readonly containing_frame?: { readonly name?: string; readonly pageName?: string };
}

interface RawLibraryResponse {
  readonly meta?: {
    readonly components?: readonly RawLibraryItem[];
    readonly styles?: readonly RawLibraryItem[];
    readonly cursor?: { readonly after?: string };
  };
}

interface RawFileResponse {
  readonly name?: string;
  readonly lastModified?: string;
  readonly version?: string;
  readonly editorType?: string;
  readonly document?: { readonly children?: readonly unknown[] };
}

// ── Output shapes ────────────────────────────────────────────────────────────

interface LibraryEntry {
  readonly key: string;
  readonly name: string;
  readonly description: string;
  readonly page: string;
  readonly frame: string;
  readonly updatedAt: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Cursor pagination over team libraries. Figma returns `meta.cursor.after`; the loop ends when
 * it is missing or when `maxItems` is exhausted. The limit is hard, because a large team's
 * library can hold thousands of entries, and a snapshot without a ceiling grows uncontrolled.
 */
export async function paginateLibrary(
  http: HttpClient,
  path: string,
  field: 'components' | 'styles',
  maxItems: number,
): Promise<{ entries: LibraryEntry[]; truncated: boolean }> {
  const out: LibraryEntry[] = [];
  let after: string | undefined;
  let guard = 0;

  do {
    const query = new URLSearchParams({ page_size: '100' });
    if (after !== undefined) query.set('after', after);
    const raw = await http.request<RawLibraryResponse>({ path: `${path}?${query.toString()}` });

    for (const item of raw.meta?.[field] ?? []) {
      if (item.key === undefined) continue;
      // Checked BEFORE the push: truncation means a further item was actually in
      // hand when the cap fired — checking after the push flagged a library of
      // exactly maxItems entries as partial.
      if (out.length >= maxItems) return { entries: out, truncated: true };
      out.push({
        key: item.key,
        name: item.name ?? '',
        description: item.description ?? '',
        page: item.containing_frame?.pageName ?? '',
        frame: item.containing_frame?.name ?? '',
        updatedAt: item.updated_at ?? '',
      });
    }

    after = raw.meta?.cursor?.after;
    // At the cap the CURSOR decides: another page means truncation, no cursor means
    // the exact-fit inventory is complete — and either way the next request is spared.
    if (out.length >= maxItems) return { entries: out, truncated: after !== undefined };
    guard += 1;
    // A ceiling on loop turns, independent of `maxItems`: it guards against an API that returns a
    // cursor pointing at itself. Without it a failure on Figma's side turns into an infinite
    // loop, and the snapshot never comes into being.
  } while (after !== undefined && guard < 200);

  // `after` still set means the guard ceiling stopped a possibly-broken cursor chain
  // mid-list — partial data, and the caller must know.
  return { entries: out, truncated: after !== undefined };
}

// The hardened table builder moved to shared/read-runtime — see mdTable there for
// the pipe/newline history this pipeline paid for twice.

// ── Per-type processors ──────────────────────────────────────────────────────

export async function processTokens(
  http: HttpClient,
  snapshot: z.infer<typeof TokensSnapshot>,
  dir: string,
): Promise<{ itemCount: number; truncated: boolean }> {
  const raw = await http.request<RawVariablesResponse>({
    path: `/v1/files/${snapshot.fileKey}/variables/local`,
  });
  const tokens: Token[] = mapFigmaVariables(raw);

  const byKind = tokens.reduce<Record<string, number>>((acc, t) => {
    acc[t.kind] = (acc[t.kind] ?? 0) + 1;
    return acc;
  }, {});

  const markdown = [
    `# Design tokens — ${snapshot.name}`,
    '',
    `File \`${snapshot.fileKey}\` · tokens ${tokens.length}`,
    '',
    mdTable(
      ['Kind', 'Count'],
      Object.entries(byKind)
        .sort((a, b) => (a[0] < b[0] ? -1 : 1))
        .map(([kind, n]) => [kind, String(n)]),
    ),
    '',
    mdTable(
      ['Token', 'Kind', 'Value'],
      [...tokens]
        .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
        .map((t) => [`\`${t.name}\``, t.kind, `\`${t.value}\``]),
    ),
    '',
  ].join('\n');

  await writePipelineOutputs({
    dir,
    basename: 'tokens',
    data: { fileKey: snapshot.fileKey, tokenCount: tokens.length, byKind, tokens },
    markdown,
    formats: snapshot.render,
  });

  // The ready-to-use form, written next to the data: emitting it again from the
  // JSON on every use would repeat work the pipeline has already done.
  for (const format of snapshot.formats) {
    await writeFile(join(dir, `tokens.${format}`), emitForFormat(tokens, format), 'utf8');
  }

  return { itemCount: tokens.length, truncated: false };
}

export async function processLibrary(
  http: HttpClient,
  snapshot: z.infer<typeof ComponentsSnapshot> | z.infer<typeof StylesSnapshot>,
  dir: string,
): Promise<{ itemCount: number; truncated: boolean }> {
  const field = snapshot.type === 'components' ? 'components' : 'styles';
  const { entries, truncated } = await paginateLibrary(
    http,
    `/v1/teams/${snapshot.teamId}/${field}`,
    field,
    snapshot.maxItems,
  );
  warnIfTruncated(
    log,
    truncated,
    `the ${field} library holds more than maxItems=${String(snapshot.maxItems)} — partial inventory`,
  );
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  const markdown = [
    `# Team library (${field}) — ${snapshot.name}`,
    '',
    `Team \`${snapshot.teamId}\` · items ${entries.length}`,
    '',
    mdTable(
      ['Name', 'Page', 'Frame', 'Description'],
      entries.map((e) => [`\`${e.name}\``, e.page, e.frame, e.description]),
    ),
    '',
  ].join('\n');

  await writePipelineOutputs({
    dir,
    basename: field,
    data: { teamId: snapshot.teamId, itemCount: entries.length, truncated, entries },
    markdown,
    formats: snapshot.render,
  });

  return { itemCount: entries.length, truncated };
}

export async function processFileSummary(
  http: HttpClient,
  snapshot: z.infer<typeof FileSummarySnapshot>,
  dir: string,
): Promise<{ itemCount: number; truncated: boolean }> {
  const raw = await http.request<RawFileResponse>({ path: `/v1/files/${snapshot.fileKey}` });
  const children = raw.document?.children ?? [];
  const pruned = pruneNodeTree(children, snapshot.maxNodes);

  const pages = children.map((child) => {
    const node = child as { readonly name?: string; readonly children?: readonly unknown[] };
    return { name: node.name ?? '', childCount: node.children?.length ?? 0 };
  });

  const markdown = [
    `# File structure — ${snapshot.name}`,
    '',
    `\`${raw.name ?? snapshot.fileKey}\` · version ${raw.version ?? '—'} ·`,
    `last change ${raw.lastModified ?? '—'} · pages ${pages.length}`,
    '',
    'The tree is **pruned** — a full document can weigh megabytes, while the snapshot is to',
    `answer the question about structure, not reproduce the file. Ceiling: ${snapshot.maxNodes} nodes.`,
    '',
    mdTable(
      ['Page', 'Children'],
      pages.map((p) => [`\`${p.name}\``, String(p.childCount)]),
    ),
    '',
  ].join('\n');

  await writePipelineOutputs({
    dir,
    basename: 'file-summary',
    data: {
      fileKey: snapshot.fileKey,
      name: raw.name ?? null,
      version: raw.version ?? null,
      lastModified: raw.lastModified ?? null,
      editorType: raw.editorType ?? null,
      pages,
      tree: pruned,
    },
    markdown,
    formats: snapshot.render,
  });

  return { itemCount: pages.length, truncated: false };
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const run = await startReadRun({ scriptName: SCRIPT_NAME, source: 'figma', schema: ReadConfig, log });
  const http = createNamedHttpClient(SCRIPT_NAME, loadFigmaAuth());

  // Snapshots run CONCURRENTLY — sonar's rationale applies verbatim: each figma
  // processor is one request or a strictly serial cursor walk with no internal
  // parallelism, snapshots are independent (separate endpoints and directories),
  // so cross-snapshot overlap is the only one available. mapWithConcurrency
  // rather than Promise.all for its failure latch — sonar explains that too.
  const counts = await mapWithConcurrency(run.config.snapshots, PIPELINE_CONCURRENCY, async (snapshot) => {
    log(`snapshot "${snapshot.name}" (${snapshot.type})`);
    const snapshotDir = await run.snapshotDir(snapshot.name);

    let result: { itemCount: number; truncated: boolean };
    if (snapshot.type === 'tokens') result = await processTokens(http, snapshot, snapshotDir);
    else if (snapshot.type === 'file_summary') result = await processFileSummary(http, snapshot, snapshotDir);
    else result = await processLibrary(http, snapshot, snapshotDir);

    await writeManifest(
      snapshotDir,
      run.manifest(snapshot, {
        truncated: result.truncated,
        type: snapshot.type,
        target: snapshot.type === 'tokens' || snapshot.type === 'file_summary' ? snapshot.fileKey : snapshot.teamId,
        itemCount: result.itemCount,
      }),
    );
    log(`  wrote ${result.itemCount} item(s) → ${snapshotDir}`);
    return result.itemCount;
  });

  run.finish(counts.reduce((sum, count) => sum + count, 0));
}

await runIfMain(SCRIPT_NAME, import.meta.url, main);
