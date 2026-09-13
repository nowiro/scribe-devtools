/**
 * write-gitlab — WRITE to GitLab: create/update an issue or a merge request, or add a note
 * (comment) to either.
 *
 * Run: `npm run create|update -- gitlab <plik.md> [--yes]`
 *
 * GitLab takes plain Markdown everywhere, so the body goes through untouched — what you
 * review in the file is byte-for-byte what lands in the description or the note.
 *
 *   ---
 *   project: group/app        # path or numeric id — always required
 *   type: mr                  # 'issue' | 'mr'
 *   iid: 7                    # existing item → update (or comment with `comment: true`)
 *   ---
 *   # New title               # H1 → title; body → description
 *
 *   Create an MR instead: drop `iid`, give `sourceBranch` + `targetBranch` (and `draft: true`
 *   while it is not ready). Create an issue: `type: issue`, no iid, no branches.
 *   `fields:` passes RAW extra API parameters verbatim (assignee_ids, milestone_id, weight…)
 *   — the escape hatch for everything this pipeline does not model.
 *
 * Same three rules as every write pipeline: dry-run by default with a live diff, `--yes` to
 * write, and no delete path at all.
 */
import { z } from 'zod';

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
import { defaultGitLabProject, loadGitLabAuth } from '../shared/auth.js';
import { createScriptLogger, runIfMain } from '../shared/read-runtime.js';
import { createNamedHttpClient, type HttpClient } from '../shared/http-client.js';
import { encodeProject } from '../shared/gitlab-reshape.js';

const SCRIPT_NAME = 'write-gitlab';
const log = createScriptLogger(SCRIPT_NAME);

// ── Front matter ─────────────────────────────────────────────────────────────

export const WriteMeta = z
  .strictObject({
    /** Project path or numeric id. Optional when a DEFAULT is configured (GITLAB_PROJECT / gitlab.project). */
    project: z.string().min(1).optional(),
    type: z.enum(['issue', 'mr']),
    iid: z.number().int().positive().optional(),
    comment: z.boolean().optional(),
    labels: z.array(z.string().min(1)).optional(),
    sourceBranch: z.string().min(1).optional(),
    targetBranch: z.string().min(1).optional(),
    draft: z.boolean().optional(),
    /** RAW extra API parameters, merged into the request body verbatim and LAST (they win). */
    fields: z.record(z.string(), z.unknown()).optional(),
  })
  .superRefine((meta, ctx) => {
    const branches = meta.sourceBranch !== undefined || meta.targetBranch !== undefined;
    if (meta.comment === true) {
      if (meta.iid === undefined) ctx.addIssue({ code: 'custom', message: 'comment: true requires iid' });
      if (branches || meta.labels || meta.draft !== undefined || meta.fields) {
        ctx.addIssue({ code: 'custom', message: 'comment mode takes only project, type, iid — a note is only a body' });
      }
      return;
    }
    if (meta.iid !== undefined && branches) {
      ctx.addIssue({ code: 'custom', message: 'iid means update — branches belong to MR create mode (drop iid)' });
    }
    // `draft` is applied exactly once: as the `Draft:` title prefix when CREATING an
    // MR. Everywhere else it used to validate and then be silently ignored — the
    // worst combination: the file said draft, the run said OK, the MR stayed as-is.
    if (meta.iid !== undefined && meta.draft !== undefined) {
      ctx.addIssue({
        code: 'custom',
        message: 'draft applies only when creating an MR — GitLab toggles draft via the title; edit the title instead',
      });
    }
    if (meta.iid === undefined && meta.type === 'issue' && meta.draft !== undefined) {
      ctx.addIssue({ code: 'custom', message: 'an issue has no draft state — draft is MR-only' });
    }
    if (
      meta.iid === undefined &&
      meta.type === 'mr' &&
      (meta.sourceBranch === undefined || meta.targetBranch === undefined)
    ) {
      ctx.addIssue({ code: 'custom', message: 'creating an MR requires sourceBranch and targetBranch' });
    }
    if (meta.iid === undefined && meta.type === 'issue' && branches) {
      ctx.addIssue({ code: 'custom', message: 'an issue has no branches — sourceBranch/targetBranch are MR-only' });
    }
  });

export type WriteMetaType = z.infer<typeof WriteMeta>;

/** WriteMeta with the project RESOLVED — from the front matter or the configured default. */
export type ResolvedWriteMeta = WriteMetaType & { readonly project: string };

// Re-exported from gitlab-reshape so read and write share ONE encoding rule — the
// spec and any future caller keep their import site, but a fix lands once.
export { encodeProject };

/** `/projects/<enc>/issues` | `/projects/<enc>/merge_requests` — the shared path stem. */
export const collectionPath = (meta: ResolvedWriteMeta): string =>
  `/projects/${encodeProject(meta.project)}/${meta.type === 'issue' ? 'issues' : 'merge_requests'}`;

// ── Payload builders (pure — pinned by tests) ────────────────────────────────

export function buildCreatePayload(meta: WriteMetaType, title: string, body: string): Record<string, unknown> {
  const mrTitle = meta.draft === true ? `Draft: ${title}` : title;
  return {
    title: meta.type === 'mr' ? mrTitle : title,
    ...(body === '' ? {} : { description: body }),
    ...(meta.labels ? { labels: meta.labels.join(',') } : {}),
    ...(meta.type === 'mr' ? { source_branch: meta.sourceBranch, target_branch: meta.targetBranch } : {}),
    ...(meta.fields ?? {}),
  };
}

export function buildUpdatePayload(
  meta: WriteMetaType,
  title: string | undefined,
  body: string | undefined,
): Record<string, unknown> {
  return {
    ...(title !== undefined ? { title } : {}),
    ...(body !== undefined ? { description: body } : {}),
    ...(meta.labels ? { labels: meta.labels.join(',') } : {}),
    ...(meta.fields ?? {}),
  };
}

// ── Main ─────────────────────────────────────────────────────────────────────

interface CurrentItem {
  readonly title?: string;
  readonly description?: string | null;
  readonly web_url?: string;
}

async function main(): Promise<void> {
  const args = parseWriteArgs(process.argv.slice(2));
  const input = await loadMarkdownInput(args.filePath, WriteMeta);
  // Front matter wins; GITLAB_PROJECT / gitlab.project fills the gap — EVERY gitlab
  // write needs the project (it addresses the API path), so this resolves up front.
  const project = input.meta.project ?? defaultGitLabProject();
  if (project === undefined) {
    throw new Error(
      'every gitlab write needs a project — set `project:` in the front matter, or the default via GITLAB_PROJECT / gitlab.project in the user config',
    );
  }
  const meta: ResolvedWriteMeta = { ...input.meta, project };
  if (meta.comment === true) assertWriteMode(args.mode, 'create', `a new note on ${meta.type} ${meta.iid ?? ''}`);
  else if (meta.iid !== undefined) assertWriteMode(args.mode, 'update', `an update of ${meta.type} ${meta.iid}`);
  else assertWriteMode(args.mode, 'create', `a new ${meta.type}`);
  const http: HttpClient = createNamedHttpClient(SCRIPT_NAME, loadGitLabAuth());
  const stem = collectionPath(meta);

  if (meta.comment === true) {
    // A note has no title field, so it posts `rawBody` — the markdown with any H1
    // still IN PLACE; re-joining the lifted title at the top silently hoisted a
    // mid-document heading above the prose that preceded it.
    // `!` is the MR sigil, `#` the issue sigil — printing `issue !5` is the exact
    // confusion the read side once shipped and then pinned a regression test on.
    const sigil = meta.type === 'mr' ? '!' : '#';
    const noteBody = prepareCommentBodyWithLog(log, input.rawBody, {
      noun: 'note',
      target: `note on ${meta.project} ${meta.type} ${sigil}${meta.iid ?? ''}`,
    });
    if (!args.yes) {
      log(DRY_RUN_FOOTER);
      return;
    }
    await http.request({
      method: 'POST',
      path: `${stem}/${meta.iid}/notes`,
      body: { body: noteBody },
    });
    log('note posted.');
    return;
  }

  if (meta.iid !== undefined) {
    const current = await http.request<CurrentItem>({ method: 'GET', path: `${stem}/${meta.iid}` });
    const newTitle = input.title;
    const newBody = updatedBodyOrUndefined(input);
    if (newTitle === undefined && newBody === undefined && !meta.labels && !meta.fields) {
      throw new Error('nothing to update — the file has no H1, no body and no fields');
    }

    log(`update ${meta.project} ${meta.type} ${meta.iid}:`);
    logUpdatePreview(log, {
      currentTitle: current.title ?? '',
      newTitle,
      currentBody: current.description ?? '',
      newBody,
      // GitLab calls the body a description — the preview speaks its vocabulary.
      bodyNoun: 'description',
    });
    if (meta.labels) log(`  labels ← ${meta.labels.join(', ')} (replaces the current set)`);
    if (meta.fields) log(`  raw fields ← ${Object.keys(meta.fields).join(', ')}`);
    if (!args.yes) {
      log(DRY_RUN_FOOTER);
      return;
    }
    const updated = await http.request<CurrentItem>({
      method: 'PUT',
      path: `${stem}/${meta.iid}`,
      body: buildUpdatePayload(meta, newTitle, newBody),
    });
    log(`updated: ${updated.web_url ?? `${meta.project} ${meta.type} ${meta.iid}`}`);
    return;
  }

  // Create.
  if (input.title === undefined) throw new Error('create mode requires a "# title" heading in the file');
  log(
    `create ${meta.type} in ${meta.project}${input.meta.project === undefined ? ' (default project)' : ''}: "${input.title}"`,
  );
  if (meta.type === 'mr')
    log(`  ${meta.sourceBranch ?? ''} → ${meta.targetBranch ?? ''}${meta.draft ? ' (draft)' : ''}`);
  if (meta.labels) log(`  labels: ${meta.labels.join(', ')}`);
  if (meta.fields) log(`  raw fields: ${Object.keys(meta.fields).join(', ')}`);
  // An empty body stays empty and buildCreatePayload OMITS the description — the
  // provenance-only description its `body === ''` guard always promised to prevent.
  const createBody = prepareBodyWithLog(log, input.body, 'created');
  if (!args.yes) {
    log(DRY_RUN_FOOTER);
    return;
  }
  const created = await http.request<CurrentItem>({
    method: 'POST',
    path: stem,
    body: buildCreatePayload(meta, input.title, createBody),
  });
  log(`created: ${created.web_url ?? '(no web_url in response)'}`);
}

await runIfMain(SCRIPT_NAME, import.meta.url, main);
