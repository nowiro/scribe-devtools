#!/usr/bin/env node
/**
 * read-miro — batch extraction from Miro boards into on-disk snapshots. READ-ONLY.
 *
 * Two snapshot types:
 *
 *  1. `boards` — the inventory: every board the token can see (optionally narrowed to one
 *     team), with names and modification times. Offset-paginated (`GET /v2/boards`).
 *  2. `board` — one board's content: metadata plus every item (sticky notes, cards, texts,
 *     shapes, frames…), cursor-paginated (`GET /v2/boards/{id}/items`). Item text arrives
 *     as HTML fragments (`<p>…</p>`), so the snapshot strips tags and decodes entities —
 *     the Markdown is the readable view, the JSON keeps the raw fields.
 *
 * The token comes from a Miro Developer app (developers.miro.com → Create new app →
 * install to the team → copy the OAuth token; the `boards:read` scope is enough for
 * everything here). Auth is a plain Bearer header.
 *
 * Run: `npm run read -- miro [path/to/read.config.miro.json]`
 */
import { z } from 'zod';

import { loadMiroAuth } from '../shared/auth.js';
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
import { createNamedHttpClient, type HttpClient } from '../shared/http-client.js';

const SCRIPT_NAME = 'read-miro';
const log = createScriptLogger(SCRIPT_NAME);

// ── Config ───────────────────────────────────────────────────────────────────

/** Miro board ids are URL-safe base64 with a trailing `=` (e.g. `uXjVN2wR8sY=`).
 * Exported: write-miro validates the same ids and one regex must not fork into two. */
export const boardIdSchema = z.string().regex(/^[A-Za-z0-9_=-]{4,}$/);

const baseSnapshot = {
  name: snapshotNameSchema,
  render: renderFormatsSchema,
} as const;

const BoardsSnapshot = z.strictObject({
  ...baseSnapshot,
  type: z.literal('boards'),
  /** Narrow the inventory to one team; default is everything the token can see. */
  teamId: z.string().min(1).optional(),
  maxItems: z.number().int().min(1).max(10_000).default(200),
});

const BoardSnapshot = z.strictObject({
  ...baseSnapshot,
  type: z.literal('board'),
  boardId: boardIdSchema,
  maxItems: z.number().int().min(1).max(20_000).default(2000),
});

const SnapshotConfig = z.discriminatedUnion('type', [BoardsSnapshot, BoardSnapshot]);

export const ReadConfig = z
  .strictObject({
    outputDir: z.string().min(1).default(defaultOutputDir('miro')),
    snapshots: z.array(SnapshotConfig).min(1),
  })
  .superRefine(assertUniqueSnapshotNames);

// ── Raw shapes ───────────────────────────────────────────────────────────────

interface RawBoard {
  readonly id?: string;
  readonly name?: string;
  readonly description?: string;
  readonly createdAt?: string;
  readonly modifiedAt?: string;
  readonly viewLink?: string;
}

interface RawBoardsResponse {
  readonly data?: readonly RawBoard[];
}

interface RawItem {
  readonly id?: string;
  readonly type?: string;
  readonly data?: { readonly content?: string; readonly title?: string; readonly shape?: string };
  readonly parent?: { readonly id?: string };
  readonly createdAt?: string;
  readonly modifiedAt?: string;
}

interface RawItemsResponse {
  readonly data?: readonly RawItem[];
  readonly cursor?: string;
}

// ── Reshaping (pure — pinned by tests) ───────────────────────────────────────

/**
 * Miro item text is an HTML fragment. One pass strips tags, decodes the five entities that
 * actually occur, and collapses whitespace — the JSON output next to the Markdown keeps the
 * raw form for anyone who needs the markup.
 */
export function stripHtml(html: string): string {
  return (
    html
      .replace(/<[^>]*>/gu, ' ')
      .replaceAll('&nbsp;', ' ')
      .replaceAll('&lt;', '<')
      .replaceAll('&gt;', '>')
      .replaceAll('&quot;', '"')
      .replaceAll('&#39;', "'")
      // `&amp;` strictly LAST: decoding it first double-decoded `&amp;lt;` into `<`,
      // so text the author literally wrote as "&lt;" silently became markup.
      .replaceAll('&amp;', '&')
      .replace(/\s+/gu, ' ')
      .trim()
  );
}

export interface BoardItem {
  readonly id: string;
  readonly type: string;
  /** Plain text of the item — `data.content` for notes/texts/shapes, `data.title` for cards/frames. */
  readonly text: string;
  readonly parentId?: string;
}

export function reshapeItem(raw: RawItem): BoardItem {
  const source = raw.data?.content ?? raw.data?.title ?? '';
  return {
    id: raw.id ?? '',
    type: raw.type ?? 'unknown',
    text: stripHtml(source),
    ...(raw.parent?.id ? { parentId: raw.parent.id } : {}),
  };
}

/** Items grouped by type, types sorted, order inside a type preserved (board order). */
export function groupByType(items: readonly BoardItem[]): ReadonlyMap<string, readonly BoardItem[]> {
  const groups = new Map<string, BoardItem[]>();
  for (const item of items) {
    const bucket = groups.get(item.type) ?? [];
    bucket.push(item);
    groups.set(item.type, bucket);
  }
  return new Map([...groups.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

export function renderBoardMarkdown(board: RawBoard, items: readonly BoardItem[], truncated: boolean): string {
  const lines: string[] = [];
  lines.push(`# ${board.name ?? '(unnamed board)'} — ${board.id ?? ''}`);
  lines.push('');
  if (board.description) lines.push(board.description, '');
  lines.push(`- **Modified**: ${board.modifiedAt ?? '—'}`);
  lines.push(`- **Items**: ${items.length}${truncated ? ' — TRUNCATED at the maxItems ceiling' : ''}`);
  if (board.viewLink) lines.push(`- **Link**: ${board.viewLink}`);
  lines.push('');

  for (const [type, group] of groupByType(items)) {
    lines.push(`## ${type} (${group.length})`);
    lines.push('');
    for (const item of group) {
      // An empty text is still an item (a bare shape, an image) — count it, do not list it.
      if (item.text !== '') lines.push(`- ${item.text}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

// ── Fetching ─────────────────────────────────────────────────────────────────

/** Cursor pagination over a board's items. Hitting the cap is SAID, not swallowed. */
export async function fetchBoardItems(
  http: HttpClient,
  boardId: string,
  maxItems: number,
): Promise<{ items: BoardItem[]; truncated: boolean }> {
  const items: BoardItem[] = [];
  let cursor: string | undefined;
  for (;;) {
    const page = await http.request<RawItemsResponse>({
      path: `/v2/boards/${encodeURIComponent(boardId)}/items`,
      query: { limit: 50, ...(cursor ? { cursor } : {}) },
    });
    for (const raw of page.data ?? []) {
      if (items.length >= maxItems) return { items, truncated: true };
      items.push(reshapeItem(raw));
    }
    if ((page.data?.length ?? 0) === 0) {
      // An empty page carrying a LIVE cursor is a server refusing to advance, not
      // the end of the list — jira's key paginator reports the same answer as
      // truncation; only a missing cursor makes an empty page a natural end.
      return { items, truncated: Boolean(page.cursor) };
    }
    if (!page.cursor) return { items, truncated: false };
    cursor = page.cursor;
  }
}

/** Offset pagination over the board inventory (`/v2/boards` has no cursor). */
export async function fetchBoards(
  http: HttpClient,
  teamId: string | undefined,
  maxItems: number,
): Promise<{ boards: RawBoard[]; truncated: boolean }> {
  const boards: RawBoard[] = [];
  const limit = 50;
  for (let offset = 0; ; offset += limit) {
    const page = await http.request<RawBoardsResponse>({
      path: '/v2/boards',
      query: { limit, offset, ...(teamId ? { team_id: teamId } : {}) },
    });
    const data = page.data ?? [];
    for (const board of data) {
      if (boards.length >= maxItems) return { boards, truncated: true };
      boards.push(board);
    }
    if (data.length < limit) return { boards, truncated: false };
  }
}

// ── Snapshot processing ──────────────────────────────────────────────────────

async function processBoards(
  http: HttpClient,
  snapshot: z.infer<typeof BoardsSnapshot>,
  dir: string,
): Promise<{ itemCount: number; truncated: boolean }> {
  const { boards, truncated } = await fetchBoards(http, snapshot.teamId, snapshot.maxItems);
  warnIfTruncated(
    log,
    truncated,
    `board inventory hit maxItems=${String(snapshot.maxItems)} — raise it to see the rest`,
  );

  const markdown = [
    `# Miro boards — ${snapshot.name}`,
    '',
    `Boards: ${boards.length}${truncated ? ' — TRUNCATED' : ''}${snapshot.teamId ? ` · team ${snapshot.teamId}` : ''}`,
    '',
    ...boards.map((b) => `- **${b.name ?? '(unnamed)'}** — \`${b.id ?? ''}\` · modified ${b.modifiedAt ?? '—'}`),
    '',
  ].join('\n');

  await writePipelineOutputs({
    dir,
    basename: 'boards',
    data: { teamId: snapshot.teamId ?? null, boardCount: boards.length, truncated, boards },
    markdown,
    formats: snapshot.render,
  });
  return { itemCount: boards.length, truncated };
}

async function processBoard(
  http: HttpClient,
  snapshot: z.infer<typeof BoardSnapshot>,
  dir: string,
): Promise<{ itemCount: number; truncated: boolean }> {
  const board = await http.request<RawBoard>({
    path: `/v2/boards/${encodeURIComponent(snapshot.boardId)}`,
  });
  const { items, truncated } = await fetchBoardItems(http, snapshot.boardId, snapshot.maxItems);
  warnIfTruncated(log, truncated, `board items hit maxItems=${String(snapshot.maxItems)} — raise it to see the rest`);

  await writePipelineOutputs({
    dir,
    // The board id itself contains `=`, which the path-traversal guard (rightly) rejects —
    // and one snapshot holds exactly one board, so a constant basename loses nothing.
    basename: 'board',
    data: { boardId: snapshot.boardId, board, itemCount: items.length, truncated, items },
    markdown: renderBoardMarkdown(board, items, truncated),
    formats: snapshot.render,
  });
  return { itemCount: items.length, truncated };
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const run = await startReadRun({ scriptName: SCRIPT_NAME, source: 'miro', schema: ReadConfig, log });
  const http = createNamedHttpClient(SCRIPT_NAME, loadMiroAuth());

  // Snapshots run CONCURRENTLY — sonar's rationale applies verbatim: every miro
  // processor is a strictly serial cursor/offset walk with no internal
  // parallelism, and snapshots are independent, so cross-snapshot overlap is the
  // only one available. mapWithConcurrency rather than Promise.all for its
  // failure latch — sonar explains that too.
  const counts = await mapWithConcurrency(run.config.snapshots, PIPELINE_CONCURRENCY, async (snapshot) => {
    log(`snapshot "${snapshot.name}" (${snapshot.type})`);
    const snapshotDir = await run.snapshotDir(snapshot.name);

    const result =
      snapshot.type === 'boards'
        ? await processBoards(http, snapshot, snapshotDir)
        : await processBoard(http, snapshot, snapshotDir);

    await writeManifest(
      snapshotDir,
      run.manifest(snapshot, {
        type: snapshot.type,
        target: snapshot.type === 'board' ? snapshot.boardId : (snapshot.teamId ?? '(all)'),
        itemCount: result.itemCount,
        truncated: result.truncated,
      }),
    );
    log(`  wrote ${result.itemCount} item(s) → ${snapshotDir}`);
    return result.itemCount;
  });

  run.finish(counts.reduce((sum, count) => sum + count, 0));
}

await runIfMain(SCRIPT_NAME, import.meta.url, main);
