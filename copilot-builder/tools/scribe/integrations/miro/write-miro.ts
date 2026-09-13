/**
 * write-miro — WRITE to Miro: create sticky notes on a board, or update one note's text.
 *
 * Run: `npm run create|update -- miro <plik.md> [--yes]`
 *
 * The input is one Markdown file with YAML front matter, like every write pipeline:
 *
 *   ---
 *   boardId: uXjVN2wR8sY=     # always required
 *   frameId: "3458764"        # create: optional parent frame
 *   color: light_yellow       # create: optional sticky palette name
 *   ---
 *   - pierwsza karteczka
 *   - druga karteczka
 *
 * **Each top-level bullet becomes ONE sticky note**; indented continuation lines belong
 * to the bullet above; a body without bullets becomes a single note. The rule is simple
 * enough to predict and the dry run lists every note verbatim, so nothing is guessed.
 * Notes land in a grid (5 per row) instead of a single stacked heap at the board centre.
 *
 *   ---
 *   boardId: uXjVN2wR8sY=     # update mode: itemId — the body REPLACES the note's text
 *   itemId: "3458765"
 *   ---
 *
 * Same three rules as every write pipeline: dry-run by default (update shows a diff
 * against the live note), `--yes` to write, no delete path at all. Provenance uses the
 * PLAIN sentence (`provenanceLine`) — a sticky note renders no Markdown, so italics
 * markers would be literal underscores.
 */
import { z } from 'zod';

import {
  DRY_RUN_FOOTER,
  assertWriteMode,
  loadMarkdownInput,
  mapLinesOutsideFences,
  parseWriteArgs,
  provenanceLine,
} from '../shared/write-runtime.js';
import { loadMiroAuth } from '../shared/auth.js';
import { createScriptLogger, mapWithConcurrency, PIPELINE_CONCURRENCY, runIfMain } from '../shared/read-runtime.js';
import { createNamedHttpClient, type HttpClient } from '../shared/http-client.js';
import { diffLines } from '../shared/line-diff.js';
import { boardIdSchema, stripHtml } from './read-miro.js';

const SCRIPT_NAME = 'write-miro';
const log = createScriptLogger(SCRIPT_NAME);

/** More notes than this from one file is almost certainly a mistake, not a workshop. */
const MAX_NOTES = 50;

// ── Front matter ─────────────────────────────────────────────────────────────

export const WriteMeta = z
  .strictObject({
    boardId: boardIdSchema,
    /** Update mode: the sticky note's item id. */
    itemId: z.string().regex(/^\d+$/).optional(),
    /** Create mode: parent frame for the new notes. */
    frameId: z.string().regex(/^\d+$/).optional(),
    /** Create mode: Miro palette name (`light_yellow`, `red`, `light_green`…). */
    color: z
      .string()
      .regex(/^[a-z_]+$/)
      .optional(),
  })
  .superRefine((meta, ctx) => {
    if (meta.itemId !== undefined && (meta.frameId !== undefined || meta.color !== undefined)) {
      ctx.addIssue({
        code: 'custom',
        message: 'itemId means update — the body replaces the TEXT only; frameId/color belong to create mode',
      });
    }
  });

export type WriteMetaType = z.infer<typeof WriteMeta>;

// ── Body → notes (pure — pinned by tests) ────────────────────────────────────

/**
 * Top-level bullets → one note each; lines indented under a bullet join it; a body
 * without any bullet is one note. Empty body → zero notes (a loud error upstream).
 *
 * In a bulleted body every non-empty line must CLASSIFY — bullet or indented
 * continuation. Prose around the bullets used to be silently discarded, and the dry
 * run listed only the survivors, so the loss was invisible until someone missed
 * their intro paragraph on the board. "Nothing is guessed" includes not guessing
 * that a line was disposable.
 */
export function splitNotes(body: string): string[] {
  const lines = body.split('\n');
  const hasBullets = lines.some((line) => /^[-*]\s+/.test(line));
  if (!hasBullets) {
    const whole = body.trim();
    return whole === '' ? [] : [whole];
  }
  const notes: string[] = [];
  for (const line of lines) {
    const bullet = /^[-*]\s+(.*)$/.exec(line);
    if (bullet?.[1] !== undefined) {
      notes.push(bullet[1].trim());
    } else if (/^\s+\S/.test(line) && notes.length > 0) {
      notes[notes.length - 1] += ` ${line.trim()}`;
    } else if (line.trim() !== '') {
      throw new Error(
        `the line ${JSON.stringify(line.trim())} is neither a bullet nor an indented continuation — ` +
          'in a bulleted file every non-empty line must belong to a note; put prose in its own file (it becomes one note)',
      );
    }
  }
  return notes.filter((note) => note !== '');
}

/** Grid layout: 5 per row, 230 px apart — a heap of notes stacked at one point helps nobody. */
export function notePosition(index: number): { x: number; y: number } {
  return { x: (index % 5) * 230, y: Math.floor(index / 5) * 230 };
}

export function buildNotePayload(meta: WriteMetaType, text: string, index: number): unknown {
  return {
    data: { content: text },
    position: notePosition(index),
    ...(meta.color ? { style: { fillColor: meta.color } } : {}),
    ...(meta.frameId ? { parent: { id: meta.frameId } } : {}),
  };
}

// ── Main ─────────────────────────────────────────────────────────────────────

interface RawStickyNote {
  readonly data?: { readonly content?: string };
}

async function main(): Promise<void> {
  const args = parseWriteArgs(process.argv.slice(2));
  const input = await loadMarkdownInput(args.filePath, WriteMeta);
  const meta = input.meta;
  if (meta.itemId !== undefined) assertWriteMode(args.mode, 'update', `an update of sticky note ${meta.itemId}`);
  else assertWriteMode(args.mode, 'create', 'new sticky notes');
  const http: HttpClient = createNamedHttpClient(SCRIPT_NAME, loadMiroAuth());
  const boardPath = `/v2/boards/${encodeURIComponent(meta.boardId)}/sticky_notes`;
  const boardLink = `https://miro.com/app/board/${meta.boardId}/`;
  if (meta.itemId !== undefined) {
    const current = await http.request<RawStickyNote>({
      method: 'GET',
      path: `${boardPath}/${meta.itemId}`,
    });
    // For UPDATE the note text is the file in its ORIGINAL ORDER — `rawBody` with
    // markdown heading markers dropped (a sticky renders no Markdown, so `# ` would
    // be literal noise). Re-joining the lifted title at the top silently hoisted a
    // mid-document heading above the prose that preceded it — the reorder the
    // comment modes fixed the same way. Fences are off limits: a `# comment` in a
    // pasted ```sh block is the author's content, and the earlier `\s+` even
    // swallowed the newline after a bare `#` line, gluing two lines together.
    const noteText = mapLinesOutsideFences(input.rawBody, (line) => line.replace(/^#{1,6}[ \t]+/u, ''));
    if (noteText === '') throw new Error('nothing to update — the file has no body');
    const newText = `${noteText}\n\n${provenanceLine('updated')}`;

    log(`update sticky note ${meta.itemId} on ${meta.boardId}:`);
    // Both sides of the diff are compared in the same collapsed form: stripHtml
    // flattens ALL whitespace, so diffing it against the multi-line newText showed a
    // full delete-and-rewrite even for an unchanged note — the dry run lied in the
    // one place it exists to be trusted. The PATCH still sends newText verbatim,
    // which is why the unchanged line below names its own blind spot: line-break
    // layout cannot be compared against the HTML Miro returns.
    const collapse = (text: string): string => text.replace(/\s+/gu, ' ').trim();
    const diff = diffLines(stripHtml(current.data?.content ?? ''), collapse(newText));
    for (const line of diff) log(line);
    if (diff.length === 0)
      log('  (text unchanged — line breaks are not comparable; --yes applies the file layout as written)');
    if (!args.yes) {
      log(DRY_RUN_FOOTER);
      return;
    }
    await http.request({
      method: 'PATCH',
      path: `${boardPath}/${meta.itemId}`,
      body: { data: { content: newText } },
    });
    log(`updated: ${boardLink}`);
    return;
  }

  // Create. A lifted H1 is content like everything else: it becomes the FIRST note,
  // and the bullets are classified on the body alone — the title must not have to
  // pass a bullet/continuation test it can only fail.
  const noteTexts = [...(input.title !== undefined ? [input.title] : []), ...splitNotes(input.body)];
  const notes = noteTexts.map((text) => `${text}\n\n${provenanceLine('created')}`);
  if (notes.length === 0) throw new Error('the file body is empty — nothing to put on the board');
  if (notes.length > MAX_NOTES) {
    throw new Error(
      `${String(notes.length)} notes from one file — the ceiling is ${String(MAX_NOTES)}; split the file`,
    );
  }

  log(
    `create ${String(notes.length)} sticky note(s) on ${meta.boardId}${meta.frameId ? ` in frame ${meta.frameId}` : ''}:`,
  );
  if (meta.color) log(`  color: ${meta.color}`);
  notes.forEach((note, index) => {
    // Every line, verbatim — the header PROMISES the dry run lists each note in
    // full, and a first-line-only preview approved multi-line stickies unseen.
    const [first, ...restLines] = note.split('\n');
    log(`  ${String(index + 1)}. ${first ?? ''}`);
    for (const line of restLines) log(`     ${line}`);
  });
  if (!args.yes) {
    log(DRY_RUN_FOOTER);
    return;
  }
  // The POSTs are independent (position comes from the index, not from any server
  // response) and non-retried, so bounded parallelism adds no duplicate risk — one
  // at a time, a full 50-note board took 50 sequential round-trips. Failures are
  // collected instead of aborting mid-list: "note 20 failed" with notes 21-50
  // silently uncreated forced the operator to diff the board by hand.
  const failures: number[] = [];
  await mapWithConcurrency([...notes.entries()], PIPELINE_CONCURRENCY, async ([index, note]) => {
    try {
      await http.request({ method: 'POST', path: boardPath, body: buildNotePayload(meta, note, index) });
    } catch {
      failures.push(index + 1);
    }
  });
  if (failures.length > 0) {
    // 'the others are on the board' when NOTHING was created sent the operator
    // hunting for phantom notes instead of simply retrying the file.
    const where = failures.length === notes.length ? 'NONE of the notes were created' : 'the others are on the board';
    throw new Error(`note(s) ${failures.sort((a, b) => a - b).join(', ')} failed — ${where}: ${boardLink}`);
  }
  log(`created ${String(notes.length)} note(s): ${boardLink}`);
}

await runIfMain(SCRIPT_NAME, import.meta.url, main);
