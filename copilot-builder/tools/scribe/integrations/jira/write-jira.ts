/**
 * write-jira — WRITE to Jira: create an issue, update an issue's content, or add a comment.
 *
 * Run: `npm run create|update -- jira <plik.md> [--yes]`
 *
 * The input is one Markdown file with YAML front matter (see `templates/jira-issue.md`):
 *
 *   ---
 *   project: PROJ            # create mode: project + type, no key
 *   type: Task
 *   labels: [reports]
 *   priority: High
 *   fields:                  # RAW Jira fields — custom / plugin fields, passed verbatim
 *     customfield_10011: "Sprint 42"
 *   ---
 *   # The summary
 *   The description, in Markdown.
 *
 *   ---
 *   key: PROJ-123            # update mode: key — H1 updates the summary, body the description
 *   ---
 *
 *   ---
 *   key: PROJ-123            # comment mode: the whole body becomes one comment
 *   comment: true
 *   ---
 *
 * Three rules, shared by every write pipeline:
 *   1. **Dry-run is the default.** Without `--yes` the pipeline prints what it WOULD send —
 *      for an update, a real diff against the live issue — and exits 0.
 *   2. **Nothing is ever deleted.** Create, update, comment; there is no delete path at all.
 *   3. **Strict front matter.** An unknown key is a hard error naming the key — a typo that
 *      silently publishes the wrong thing is the worst outcome a write tool can have.
 */
import { z } from 'zod';

import { adfToMarkdownSafe, type AdfNode } from '../shared/adf.js';
import {
  DRY_RUN_FOOTER,
  assertWriteMode,
  loadMarkdownInput,
  logUpdatePreview,
  parseWriteArgs,
  prepareBodyWithLog,
  prepareCommentBodyWithLog,
  updatedBodyOrUndefined,
} from '../shared/write-runtime.js';
import { defaultJiraProject, loadJiraAuth } from '../shared/auth.js';
import { createScriptLogger, runIfMain } from '../shared/read-runtime.js';
import { createNamedHttpClient, type HttpClient } from '../shared/http-client.js';
import { markdownToAdf } from '../shared/markdown-to-adf.js';

const SCRIPT_NAME = 'write-jira';
const log = createScriptLogger(SCRIPT_NAME);

// ── Front matter ─────────────────────────────────────────────────────────────

/** One shape for every issue-key field — `key` and `parent` must never drift apart. */
const ISSUE_KEY = /^[A-Z][A-Z0-9]*-\d+$/;

export const WriteMeta = z
  .strictObject({
    /** Existing issue — update mode, or comment mode together with `comment: true`. */
    key: z.string().regex(ISSUE_KEY).optional(),
    /** Create mode: the project key. Optional when a DEFAULT is configured (JIRA_PROJECT / jira.project). */
    project: z.string().min(1).optional(),
    /** Create mode: the issue type NAME as Jira shows it (`Task`, `Bug`, `Story`). */
    type: z.string().min(1).optional(),
    /** `true` + `key`: the body becomes one comment; nothing else may be set. */
    comment: z.boolean().optional(),
    /**
     * Create mode: the parent issue key — a subtask under an issue (`type: Subtask`)
     * or an issue under an epic. Modelled instead of raw `fields.parent`, because the
     * natural-but-wrong form (`parent: PROJ-1` as a bare string in `fields`) passed the
     * dry run and bounced from Jira with a 400 only at write time.
     */
    parent: z.string().regex(ISSUE_KEY).optional(),
    labels: z.array(z.string().min(1)).optional(),
    priority: z.string().min(1).optional(),
    /**
     * RAW Jira fields, passed into the API `fields` object verbatim and LAST (they win).
     * This is the escape hatch for custom and plugin fields (`customfield_*`, sprint,
     * epic link…) — the pipeline cannot know them, so it does not try to.
     */
    fields: z.record(z.string(), z.unknown()).optional(),
  })
  .superRefine((meta, ctx) => {
    if (meta.comment === true) {
      if (meta.key === undefined) ctx.addIssue({ code: 'custom', message: 'comment: true requires key' });
      for (const banned of ['project', 'type', 'parent', 'labels', 'priority', 'fields'] as const) {
        if (meta[banned] !== undefined) {
          ctx.addIssue({
            code: 'custom',
            message: `comment mode does not take "${banned}" — a comment is only a body`,
          });
        }
      }
      return;
    }
    if (meta.key !== undefined && (meta.project !== undefined || meta.type !== undefined)) {
      ctx.addIssue({
        code: 'custom',
        message: 'key means update — "project" and "type" belong to create mode (drop the key to create)',
      });
    }
    if (meta.key !== undefined && meta.parent !== undefined) {
      // Same rule confluence pins for parentId: placement is a create-time decision.
      ctx.addIssue({
        code: 'custom',
        message: 'parent belongs to create mode — an update does not re-parent the issue',
      });
    }
    if (meta.parent !== undefined && meta.fields !== undefined && 'parent' in meta.fields) {
      // `fields` wins by design (it spreads last) — which here would silently replace
      // the VALIDATED parent with a raw blob that can 400 after a clean dry run.
      ctx.addIssue({ code: 'custom', message: 'parent is set twice — drop it from `fields` or from `parent:`' });
    }
    if (meta.key === undefined && meta.type === undefined) {
      // `project` is NOT required here: a configured default (JIRA_PROJECT /
      // jira.project) can supply it, and main() checks loudly when neither exists.
      ctx.addIssue({ code: 'custom', message: 'create mode requires "type" (or "key" to update)' });
    }
  });

export type WriteMetaType = z.infer<typeof WriteMeta>;

// ── Payload builders (pure — this is what the tests pin) ─────────────────────

export function buildCreatePayload(meta: WriteMetaType, title: string, description: AdfNode): unknown {
  return {
    fields: {
      project: { key: meta.project },
      issuetype: { name: meta.type },
      summary: title,
      description,
      ...(meta.parent ? { parent: { key: meta.parent } } : {}),
      ...(meta.labels ? { labels: meta.labels } : {}),
      ...(meta.priority ? { priority: { name: meta.priority } } : {}),
      ...(meta.fields ?? {}),
    },
  };
}

export function buildUpdatePayload(
  meta: WriteMetaType,
  title: string | undefined,
  description: AdfNode | undefined,
): { readonly fields: Record<string, unknown> } {
  return {
    fields: {
      ...(title !== undefined ? { summary: title } : {}),
      ...(description !== undefined ? { description } : {}),
      ...(meta.labels ? { labels: meta.labels } : {}),
      ...(meta.priority ? { priority: { name: meta.priority } } : {}),
      ...(meta.fields ?? {}),
    },
  };
}

// ── Main ─────────────────────────────────────────────────────────────────────

interface CurrentIssue {
  readonly fields?: { readonly summary?: string; readonly description?: unknown };
}

async function main(): Promise<void> {
  const args = parseWriteArgs(process.argv.slice(2));
  const input = await loadMarkdownInput(args.filePath, WriteMeta);
  const meta = input.meta;
  // The file decides its mode; the command must agree — a comment file is CREATE
  // (it creates a comment), a `key:` file without `comment` is UPDATE.
  if (meta.comment === true) assertWriteMode(args.mode, 'create', `a new comment on ${meta.key ?? ''}`);
  else if (meta.key !== undefined) assertWriteMode(args.mode, 'update', `an update of ${meta.key}`);
  else assertWriteMode(args.mode, 'create', 'a new issue (type, plus project or its default)');
  const auth = loadJiraAuth();
  const http: HttpClient = createNamedHttpClient(SCRIPT_NAME, auth);

  if (meta.comment === true) {
    // A comment has no title field, so it posts `rawBody` — the markdown with any H1
    // still IN PLACE. Re-joining the lifted title at the top used to silently hoist
    // a mid-document heading above the prose that preceded it, and the dry run's
    // line count could not show the reorder.
    const noteBody = prepareCommentBodyWithLog(log, input.rawBody, {
      noun: 'comment',
      target: `comment on ${meta.key ?? ''}`,
    });
    if (!args.yes) {
      log(DRY_RUN_FOOTER);
      return;
    }
    await http.request({
      method: 'POST',
      path: `/rest/api/3/issue/${meta.key}/comment`,
      body: { body: markdownToAdf(noteBody) },
    });
    log(`comment posted: ${auth.baseUrl}/browse/${meta.key}`);
    return;
  }

  if (meta.key !== undefined) {
    // Update: fetch the live issue first, so the dry run shows a DIFF, not a hope.
    const current = await http.request<CurrentIssue>({
      method: 'GET',
      path: `/rest/api/3/issue/${meta.key}`,
      query: { fields: 'summary,description' },
    });
    const newTitle = input.title;
    const newBody = updatedBodyOrUndefined(input);
    if (newTitle === undefined && newBody === undefined && !meta.labels && !meta.priority && !meta.fields) {
      throw new Error('nothing to update — the file has no H1, no body and no fields');
    }

    log(`update ${meta.key}:`);
    logUpdatePreview(log, {
      currentTitle: current.fields?.summary ?? '',
      newTitle,
      currentBody: adfToMarkdownSafe(current.fields?.description) ?? '',
      newBody,
    });
    if (meta.labels) log(`  labels ← ${meta.labels.join(', ')} (replaces the current set)`);
    if (meta.priority) log(`  priority ← ${meta.priority}`);
    if (meta.fields) log(`  raw fields ← ${Object.keys(meta.fields).join(', ')}`);
    if (!args.yes) {
      log(DRY_RUN_FOOTER);
      return;
    }
    await http.request({
      method: 'PUT',
      path: `/rest/api/3/issue/${meta.key}`,
      body: buildUpdatePayload(meta, newTitle, newBody === undefined ? undefined : markdownToAdf(newBody)),
    });
    log(`updated: ${auth.baseUrl}/browse/${meta.key}`);
    return;
  }

  // Create.
  if (input.title === undefined) throw new Error('create mode requires a "# summary" heading in the file');
  // Front matter wins; the configured default fills the gap — and its use is SAID
  // in the preview, because publishing into the wrong project has no undo here.
  const project = meta.project ?? defaultJiraProject();
  if (project === undefined) {
    throw new Error(
      'create needs a project — set `project:` in the front matter, or the default via JIRA_PROJECT / jira.project in the user config',
    );
  }
  log(
    `create in ${project}${meta.project === undefined ? ' (default project)' : ''}: ${meta.type ?? ''} "${input.title}"`,
  );
  // The preview must show EVERY modelled field — parent was missing, so the operator
  // approved a subtask placement they were never shown, and this tool cannot undo one.
  if (meta.parent) log(`  parent: ${meta.parent}`);
  if (meta.labels) log(`  labels: ${meta.labels.join(', ')}`);
  if (meta.priority) log(`  priority: ${meta.priority}`);
  if (meta.fields) log(`  raw fields: ${Object.keys(meta.fields).join(', ')}`);
  const createBody = prepareBodyWithLog(log, input.body, 'created');
  if (!args.yes) {
    log(DRY_RUN_FOOTER);
    return;
  }
  const created = await http.request<{ key?: string }>({
    method: 'POST',
    path: '/rest/api/3/issue',
    body: buildCreatePayload({ ...meta, project }, input.title, markdownToAdf(createBody)),
  });
  log(`created: ${auth.baseUrl}/browse/${created.key ?? '(no key in response)'}`);
}

await runIfMain(SCRIPT_NAME, import.meta.url, main);
