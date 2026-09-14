/**
 * write-confluence — WRITE to Confluence: create a page or update a page's content.
 *
 * Run: `npm run create|update -- confluence <plik.md> [--yes]`
 *
 * The body travels as ADF (`atlas_doc_format`) — the same representation the read
 * pipeline reads back, so a page written here and snapshotted later round-trips through
 * one pair of converters (`markdownToAdf` / `adfToMarkdown`).
 *
 *   ---
 *   space: DOCS               # create mode: space key (or numeric id), optional parentId
 *   parentId: "123"
 *   labels: [adr]             # labels are the extraction handle — set them at birth
 *   ---
 *   # The page title
 *   The body, in Markdown.
 *
 *   ---
 *   id: "456"                 # update mode: page id — H1 replaces the title, body the content
 *   ---
 *
 * Labels are ADDED (never removed) after the write, via the v1 label endpoint — v2 has no
 * label write yet. Same three rules as every write pipeline: dry-run by default with a live
 * diff, `--yes` to write, no delete path.
 */
import { z } from 'zod';

import { adfToMarkdownSafe } from '../shared/adf.js';
import {
  DRY_RUN_FOOTER,
  assertWriteMode,
  loadMarkdownInput,
  logUpdatePreview,
  parseWriteArgs,
  prepareBodyWithLog,
  updatedBodyOrUndefined,
  withProvenance,
} from '../shared/write-runtime.js';
import { loadConfluenceAuth } from '../shared/auth.js';
import { createScriptLogger, runIfMain } from '../shared/read-runtime.js';
import { createNamedHttpClient, type HttpClient } from '../shared/http-client.js';
import { markdownToAdf } from '../shared/markdown-to-adf.js';
import { pageWebUrl } from './read-confluence.js';

const SCRIPT_NAME = 'write-confluence';
const log = createScriptLogger(SCRIPT_NAME);

// ── Front matter ─────────────────────────────────────────────────────────────

export const WriteMeta = z
  .strictObject({
    /** Update mode: the page id. */
    id: z.string().regex(/^\d+$/).optional(),
    /** Create mode: the space KEY (`DOCS`) or numeric space id. */
    space: z.string().min(1).optional(),
    parentId: z.string().regex(/^\d+$/).optional(),
    labels: z.array(z.string().min(1)).optional(),
  })
  .superRefine((meta, ctx) => {
    if ((meta.id === undefined) === (meta.space === undefined)) {
      ctx.addIssue({ code: 'custom', message: 'exactly one of "id" (update) or "space" (create) is required' });
    }
    if (meta.id !== undefined && meta.parentId !== undefined) {
      ctx.addIssue({ code: 'custom', message: 'parentId belongs to create mode — an update does not move the page' });
    }
  });

export type WriteMetaType = z.infer<typeof WriteMeta>;

// ── Payload builders (pure — pinned by tests) ────────────────────────────────

/** ADF travels to Confluence v2 as a JSON **string** inside the body value. */
export const adfBodyValue = (markdown: string): string => JSON.stringify(markdownToAdf(markdown));

export function buildCreatePayload(meta: WriteMetaType, spaceId: string, title: string, body: string): unknown {
  return {
    spaceId,
    status: 'current',
    title,
    ...(meta.parentId !== undefined ? { parentId: meta.parentId } : {}),
    body: { representation: 'atlas_doc_format', value: adfBodyValue(body) },
  };
}

export function buildUpdatePayload(id: string, title: string, bodyValue: string, nextVersion: number): unknown {
  return {
    id,
    status: 'current',
    title,
    body: { representation: 'atlas_doc_format', value: bodyValue },
    version: { number: nextVersion },
  };
}

/**
 * The body VALUE an update sends. Confluence v2 PUT always requires a body, so a
 * title-only or labels-only file must re-send the CURRENT value verbatim — building it
 * from the empty input used to replace the whole page with just the provenance line.
 */
export function updateBodyValue(inputBody: string, currentValue: string | undefined): string {
  if (inputBody === '') {
    // The GET asked for atlas_doc_format explicitly, so a missing value is an upstream
    // anomaly — and the fallback here used to be an EMPTY document, which turned a
    // title-only update into a wiped page. Same rule as the version check: refuse a
    // blind overwrite.
    if (currentValue === undefined) {
      throw new Error('the API returned no atlas_doc_format body — refusing a blind overwrite of the page content');
    }
    return currentValue;
  }
  return adfBodyValue(withProvenance(inputBody, 'updated'));
}

// ── Main ─────────────────────────────────────────────────────────────────────

interface CurrentPage {
  readonly title?: string;
  readonly version?: { readonly number?: number };
  readonly body?: { readonly atlas_doc_format?: { readonly value?: string } };
  readonly _links?: { readonly base?: string; readonly webui?: string };
}

/**
 * Labels ride on the legacy v1 endpoint — a different API than the page write, with
 * its own ways to fail (403 on the old path is real). A label failure must not mask
 * a SUCCESSFUL write: it used to throw before the page URL was printed, the run
 * ended FATAL, and the natural reaction — re-running with `--yes` — created a
 * duplicate page. The write logs its URL first; a label error degrades to a WARN
 * that names what to add by hand.
 */
async function addLabels(http: HttpClient, pageId: string, labels: readonly string[]): Promise<void> {
  try {
    await http.request({
      method: 'POST',
      path: `/wiki/rest/api/content/${pageId}/label`,
      body: labels.map((name) => ({ prefix: 'global', name })),
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    log(`WARN: the page was written but adding labels failed (${msg}) — add ${labels.join(', ')} by hand`);
  }
}

async function main(): Promise<void> {
  const args = parseWriteArgs(process.argv.slice(2));
  const input = await loadMarkdownInput(args.filePath, WriteMeta);
  const meta = input.meta;
  if (meta.id !== undefined) assertWriteMode(args.mode, 'update', `an update of page ${meta.id}`);
  else assertWriteMode(args.mode, 'create', `a new page in space ${meta.space ?? ''}`);
  const auth = loadConfluenceAuth();
  const http: HttpClient = createNamedHttpClient(SCRIPT_NAME, auth);
  // ONE formula with the read pipeline (pageWebUrl) — the two used to disagree on
  // a Data Center context path. The hardcoded `/wiki` remains only as the fallback.
  const pageUrl = (links: CurrentPage['_links']): string =>
    pageWebUrl(links, `${auth.baseUrl}/wiki`) ?? '(no link in response)';

  if (meta.id !== undefined) {
    const current = await http.request<CurrentPage>({
      method: 'GET',
      path: `/wiki/api/v2/pages/${meta.id}`,
      query: { 'body-format': 'atlas_doc_format' },
    });
    const currentVersion = current.version?.number;
    if (currentVersion === undefined) {
      throw new Error(`page ${meta.id}: the API returned no version number — refusing a blind overwrite`);
    }
    const title = input.title ?? current.title ?? '';
    if (input.body === '' && input.title === undefined && !meta.labels) {
      throw new Error('nothing to update — the file has no H1, no body and no labels');
    }

    log(`update page ${meta.id} (version ${currentVersion} → ${currentVersion + 1}):`);
    // Computed BEFORE the dry-run gate: its refusing-a-blind-overwrite throw must fire
    // in the dry run too — a preview that says OK for an input `--yes` then refuses is
    // the one divergence the dry-run contract forbids.
    const bodyValue = updateBodyValue(input.body, current.body?.atlas_doc_format?.value);
    // An empty body means "leave the content alone" — the update re-sends the current
    // value untouched (see updateBodyValue), so the diff has nothing to show for it.
    const newBody = updatedBodyOrUndefined(input);
    logUpdatePreview(log, {
      currentTitle: current.title ?? '',
      newTitle: input.title,
      currentBody: adfToMarkdownSafe(current.body?.atlas_doc_format?.value) ?? '',
      newBody,
    });
    if (meta.labels) log(`  labels += ${meta.labels.join(', ')} (labels are added, never removed)`);
    if (!args.yes) {
      log(DRY_RUN_FOOTER);
      return;
    }
    const updated = await http.request<CurrentPage>({
      method: 'PUT',
      path: `/wiki/api/v2/pages/${meta.id}`,
      body: buildUpdatePayload(meta.id, title, bodyValue, currentVersion + 1),
    });
    log(`updated: ${pageUrl(updated._links)}`);
    if (meta.labels) await addLabels(http, meta.id, meta.labels);
    return;
  }

  // Create.
  if (input.title === undefined) throw new Error('create mode requires a "# title" heading in the file');
  const space = meta.space ?? '';
  let spaceId = space;
  if (!/^\d+$/.test(space)) {
    const found = await http.request<{ results?: readonly { id?: string }[] }>({
      method: 'GET',
      path: '/wiki/api/v2/spaces',
      query: { keys: space },
    });
    const resolved = found.results?.[0]?.id;
    if (resolved === undefined)
      throw new Error(`space "${space}" was not found — check the key (or pass a numeric id)`);
    spaceId = resolved;
  }

  log(`create page in space ${space}${meta.parentId ? ` under ${meta.parentId}` : ''}: "${input.title}"`);
  if (meta.labels) log(`  labels: ${meta.labels.join(', ')}`);
  const createBody = prepareBodyWithLog(log, input.body, 'created');
  if (!args.yes) {
    log(DRY_RUN_FOOTER);
    return;
  }
  const created = await http.request<CurrentPage & { id?: string }>({
    method: 'POST',
    path: '/wiki/api/v2/pages',
    body: buildCreatePayload(meta, spaceId, input.title, createBody),
  });
  log(`created: ${pageUrl(created._links)}`);
  if (meta.labels) {
    if (created.id) {
      await addLabels(http, created.id, meta.labels);
    } else {
      // Labels are the extraction handle — skipping them SILENTLY when the response
      // carries no id would break downstream extraction invisibly; same WARN-by-hand
      // contract as a failed label call.
      log(`WARN: the page was created but the response carried no id — add labels ${meta.labels.join(', ')} by hand`);
    }
  }
}

await runIfMain(SCRIPT_NAME, import.meta.url, main);
