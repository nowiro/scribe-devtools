/**
 * Shared runtime for the WRITE pipelines (`integrations/<source>/write-<source>.ts`).
 *
 * The write model this repository promised itself back when the MCP servers went out:
 * **dry-run is the default, a write needs an explicit `--yes`, and nothing is ever
 * deleted.** The input is one Markdown file with YAML front matter — the same shape the
 * templates in `templates/` teach — so the file a human reviews IS the file that gets
 * published, not a translation of it.
 *
 *   ---
 *   key: PROJ-123          # front matter: WHERE it goes (validated per source, strict)
 *   ---
 *   # The title            # first H1: the summary / title (where the mode uses one)
 *   The body…              # everything after: the content, in Markdown
 */
import { readFile } from 'node:fs/promises';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

import { diffLines } from './line-diff.js';
import { formatSchemaIssues } from './read-runtime.js';
import { getRepoVersion } from './version.js';

// ── Arguments ────────────────────────────────────────────────────────────────

export type WriteMode = 'create' | 'update';

export interface WriteArgs {
  readonly filePath: string;
  /**
   * The caller's declared intent, injected by the `write.mjs` dispatcher as `--mode`.
   * `undefined` when the pipeline is invoked directly from `dist/` (the consumer-repo
   * path) — then the file alone decides, exactly as before the split.
   */
  readonly mode: WriteMode | undefined;
  /** `--yes`: actually write. Absent → dry-run, which prints what WOULD happen and stops. */
  readonly yes: boolean;
}

/**
 * `write-<source> <file.md> [--mode create|update] [--yes]`. The file is the first non-flag
 * argument and it is required: the write pipelines have no default input, because "publish
 * whatever happened to lie around" is not a behaviour anyone asked for.
 */
export function parseWriteArgs(argv: readonly string[]): WriteArgs {
  let filePath: string | undefined;
  let yes = false;
  let mode: WriteMode | undefined;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? '';
    // `--mode create` and `--mode=create` both work — parseReadArgs accepts the inline
    // form, and rejecting it HERE produced the self-contradicting error "unknown flag
    // --mode=update — write pipelines know only --yes and --mode".
    const eq = arg.indexOf('=');
    const [flag, inlineValue] = eq === -1 ? [arg, undefined] : [arg.slice(0, eq), arg.slice(eq + 1)];
    if (arg === '--yes') yes = true;
    else if (flag === '--mode') {
      const value = inlineValue ?? argv[++i];
      if (value !== 'create' && value !== 'update') {
        throw new Error(`--mode takes "create" or "update", got ${JSON.stringify(value ?? '')}`);
      }
      mode = value;
    } else if (!arg.startsWith('-')) {
      // A second positional is as loud as an unknown flag: `write-jira a.md b.md`
      // used to publish a.md and silently ignore b.md — the worst possible reading
      // of an ambiguous command in a pipeline whose contract is "nothing is guessed".
      if (filePath !== undefined) {
        throw new Error(
          `unexpected extra argument ${JSON.stringify(arg)} — write pipelines take exactly one input file (got ${JSON.stringify(filePath)} already)`,
        );
      }
      filePath = arg;
    } else {
      throw new Error(`unknown flag ${JSON.stringify(arg)} — write pipelines know only --yes and --mode`);
    }
  }
  if (filePath === undefined) {
    throw new Error('missing input file — usage: write-<source> <file.md> [--mode create|update] [--yes]');
  }
  return { filePath, yes, mode };
}

/**
 * The assertion that makes `create` and `update` two commands instead of one: the FILE
 * decides its own mode (a `key:`/`iid:`/`id:` marks an update file), and the command must
 * agree — a mismatch never runs, it explains. A comment file counts as CREATE (it creates
 * a comment). `declared === undefined` (direct dist/ invocation) skips the check.
 */
export function assertWriteMode(declared: WriteMode | undefined, actual: WriteMode, describe: string): void {
  if (declared === undefined || declared === actual) return;
  throw new Error(
    `this file is ${describe} — that is ${actual.toUpperCase()} mode, but the command says ${declared}. ` +
      `Use the "${actual}" command (the front matter, not the command, decides what the file IS).`,
  );
}

// ── The input file ───────────────────────────────────────────────────────────

export interface MarkdownInput<M> {
  readonly meta: M;
  /** Text of the first `# ` heading, or `undefined` when the file has none. */
  readonly title: string | undefined;
  /** Markdown after the front matter (and after the H1, when one was taken as the title). */
  readonly body: string;
  /**
   * Markdown after the front matter with the H1 STILL IN PLACE. Comment/note modes
   * post this: they have no title field, and re-joining the lifted H1 at the top
   * used to silently hoist a mid-document heading above the prose that preceded it.
   */
  readonly rawBody: string;
}

/**
 * Splits `--- yaml ---` front matter from the Markdown, validates the front matter against
 * the pipeline's strict schema, and lifts the first `# H1` out as the title. Errors carry
 * the same `  - where: what` lines as a broken extract config — same class of typo, same
 * class of answer.
 */
export function parseMarkdownInput<T extends z.ZodTypeAny>(
  raw: string,
  schema: T,
  sourcePath: string,
): MarkdownInput<z.infer<T>> {
  // The BOM strip mirrors okf.ts: Notepad and PowerShell 5 save "UTF-8 with BOM", and a
  // U+FEFF in front of `---` used to fail the anchored regex with a message claiming the
  // file does not start with front matter — while it visibly does.
  const text = raw.replace(/^﻿/u, '').replaceAll('\r\n', '\n');
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(text);
  if (!match || match[1] === undefined) {
    throw new Error(
      `${sourcePath}: expected YAML front matter — the file must start with "---", the target ` +
        'fields, and a closing "---". Templates in templates/ show the shape.',
    );
  }
  const meta: unknown = parseYaml(match[1]);
  const parsed = schema.safeParse(meta ?? {});
  if (!parsed.success) {
    throw new Error(`${sourcePath}: front matter is not valid:\n${formatSchemaIssues(parsed.error)}`);
  }

  const markdown = text.slice(match[0].length);
  // Stale provenance footers come off HERE, at the single entry point — every
  // guard, diff and splitter downstream then sees real content only (see
  // stripTrailingProvenance for why a footer in an input is stale by definition).
  const rawBody = stripTrailingProvenance(markdown.trim());
  const h1 = findTitleHeading(markdown);
  if (h1 !== undefined) {
    const body = stripTrailingProvenance((markdown.slice(0, h1.index) + markdown.slice(h1.index + h1.length)).trim());
    return { meta: parsed.data as z.infer<T>, title: h1.title, body, rawBody };
  }
  return { meta: parsed.data as z.infer<T>, title: undefined, body: rawBody, rawBody };
}

type FenceMarker = '```' | '~~~';

/**
 * One step of the fence tracker: the open-fence state after seeing `line`. A single
 * reducer, because every write-side rule that must not fire inside code — the title
 * lift, the provenance strip, miro's heading unmarking — has to agree on what
 * "inside a fence" means: a ``` inside a ~~~ block is content (the marker KIND is
 * tracked, not a boolean), and only the matching marker closes.
 */
function fenceStateAfter(state: FenceMarker | undefined, line: string): FenceMarker | undefined {
  const fence = /^ {0,3}(```|~~~)/.exec(line);
  if (!fence) return state;
  const marker = fence[1] as FenceMarker;
  if (state === undefined) return marker;
  return state === marker ? undefined : state;
}

/**
 * Applies `transform` to every line OUTSIDE ``` / ~~~ fences; fenced lines and the
 * fence lines themselves pass through verbatim.
 */
export function mapLinesOutsideFences(text: string, transform: (line: string) => string): string {
  let state: FenceMarker | undefined;
  return text
    .split('\n')
    .map((line) => {
      const next = fenceStateAfter(state, line);
      const outside = state === undefined && next === undefined;
      state = next;
      return outside ? transform(line) : line;
    })
    .join('\n');
}

/**
 * The first `# ` line OUTSIDE any code block. A naive regex lifted `# install deps`
 * out of a ```bash block — silently deleting it from a comment body, or worse, renaming
 * a Jira issue after a shell comment. Fences go through {@link fenceStateAfter}; the
 * heading itself allows at most 3 leading spaces, because CommonMark treats 4+-space
 * indentation as a third code-block form and a heading regex accepting any indentation
 * reached into it.
 */
function findTitleHeading(markdown: string): { title: string; index: number; length: number } | undefined {
  let offset = 0;
  let state: FenceMarker | undefined;
  for (const line of markdown.split(/(?<=\n)/u)) {
    const next = fenceStateAfter(state, line);
    if (state === undefined && next === undefined) {
      const heading = /^ {0,3}# (.+?)\s*$/.exec(line.replace(/\n$/u, ''));
      if (heading?.[1] !== undefined) {
        return { title: heading[1].trim(), index: offset, length: line.length };
      }
    }
    state = next;
    offset += line.length;
  }
  return undefined;
}

/** `parseMarkdownInput` over a file on disk. */
export async function loadMarkdownInput<T extends z.ZodTypeAny>(
  path: string,
  schema: T,
): Promise<MarkdownInput<z.infer<T>>> {
  return parseMarkdownInput(await readFile(path, 'utf8'), schema, path);
}

// ── Provenance ───────────────────────────────────────────────────────────────

export type ProvenanceAction = 'created' | 'updated' | 'commented';

const PROVENANCE_VERB: Record<ProvenanceAction, string> = {
  created: 'Utworzono',
  updated: 'Zaktualizowano',
  commented: 'Dodano',
};

/**
 * A provenance FOOTER: the whole FINAL line, in any of the three shapes this tool
 * has ever written — `_italic_` (markdown bodies), `*italic*` (what adf.ts renders
 * the em mark back to in snapshots) and the plain sentence (miro). The shape is
 * matched EXACTLY: line start, optional marker, verb, the phrase, `v<version>.`,
 * the SAME closing marker (backreference), end of text. An earlier pattern took
 * `v` plus anything, so a prose line that merely BEGAN with the phrase
 * ('Utworzono za pomocą narzędzia scribe v2 można poznać po…') was eaten whole.
 */
const TRAILING_PROVENANCE =
  /(?:^|\n)([_*]?)(?:Utworzono|Zaktualizowano|Dodano) za pomocą narzędzia scribe v\d[\w.-]*\.\1$/u;

/** True when `body` ends inside an UNCLOSED ``` / ~~~ fence — its tail is code. */
function endsInsideFence(body: string): boolean {
  return body.split('\n').reduce<FenceMarker | undefined>(fenceStateAfter, undefined) !== undefined;
}

/**
 * Strips stale provenance footers off the end of `body`, to a fixed point. A footer
 * in an INPUT file is stale by definition — it described the previous write; the
 * fresh one is appended at write time — so the loader calls this on every body and
 * a file trimmed down to nothing but the old footer counts as EMPTY instead of
 * publishing boilerplate.
 *
 * A body ending inside an UNCLOSED fence is left alone: pasted tool output
 * naturally ends with this very sentence, and the unclosed-fence construct is one
 * markdownToAdf explicitly supports — its last line is code, not a footer.
 */
export function stripTrailingProvenance(body: string): string {
  if (endsInsideFence(body)) return body;
  let bare = body;
  while (TRAILING_PROVENANCE.test(bare)) {
    bare = bare.replace(TRAILING_PROVENANCE, '').trimEnd();
  }
  return bare;
}

/**
 * Appends the provenance line to a body written upstream: the content itself says it was
 * made by this tool, not only the request headers (which upstream users never see). One
 * italic line, Polish (the language the content is written in), with the tooling version.
 *
 * Applied BEFORE the dry-run diff is computed, so the preview shows byte-for-byte what
 * `--yes` will send — a footer added after the diff would make the dry run lie.
 *
 * Any provenance lines ALREADY at the end are stripped first (belt to the loader's
 * braces): the documented snapshot → edit → write-back cycle used to stack one more
 * line per cycle.
 */
export function withProvenance(body: string, action: ProvenanceAction): string {
  const line = `_${provenanceLine(action)}_`;
  const bare = stripTrailingProvenance(body);
  return bare === '' ? line : `${bare}\n\n${line}`;
}

/**
 * The update-mode body rule every pipeline shares: an EMPTY body means "leave the
 * content alone" — `undefined` here, so payload builders omit the field. Kept in
 * one place because this is the safety line that once wiped a Confluence page.
 */
export function updatedBodyOrUndefined(input: { readonly body: string }): string | undefined {
  return input.body === '' ? undefined : withProvenance(input.body, 'updated');
}

/**
 * The provenance sentence, plain: for targets that render no Markdown (a Miro sticky
 * note), where literal underscores would be noise instead of italics.
 */
export function provenanceLine(action: ProvenanceAction): string {
  return `${PROVENANCE_VERB[action]} za pomocą narzędzia scribe v${getRepoVersion()}.`;
}

// ── Dry-run rendering ────────────────────────────────────────────────────────

/**
 * The closing line of every dry run, identical across pipelines so both a human and an
 * agent can key on it. A dry run exits 0: previewing a write that LOOKS right is success.
 */
export const DRY_RUN_FOOTER = 'dry-run: nothing was written. Re-run with --yes to apply.';

/**
 * The create-path body with its provenance line, logged in the one shape every dry
 * run shares (the wording had already forked once across the three copies). An empty
 * body stays EMPTY: appending only the provenance line used to publish items whose
 * whole description was tooling boilerplate.
 */
export function prepareBodyWithLog(log: (msg: string) => void, body: string, action: ProvenanceAction): string {
  if (body === '') {
    log('  body: (none)');
    return '';
  }
  const out = withProvenance(body, action);
  log(`  body: ${out.split('\n').length} line(s) of Markdown (with the provenance line)`);
  return out;
}

/**
 * The comment/note body with the same uniform dry-run line — the jira and gitlab
 * comment paths were hand-kept twins whose wording had already drifted once.
 * `noun` names the thing for the empty-body error ('comment', 'note'); `target`
 * is the log line's prefix ('comment on PROJ-1', 'note on group/app mr !7').
 */
export function prepareCommentBodyWithLog(
  log: (msg: string) => void,
  rawBody: string,
  labels: { readonly noun: string; readonly target: string },
): string {
  if (rawBody === '') throw new Error(`the ${labels.noun} body is empty — nothing to post`);
  const out = withProvenance(rawBody, 'commented');
  log(`${labels.target}: ${out.split('\n').length} line(s) of Markdown (with the provenance line)`);
  return out;
}

/**
 * The update dry-run preview — identical across pipelines for the same reason as
 * {@link DRY_RUN_FOOTER}: a human and an agent both key on its shape. Computes and
 * logs the title and body diffs. It used to exist as three hand-kept copies (jira,
 * confluence, gitlab) that had already begun to drift apart in wording — and used
 * to return a `changed` boolean no caller read; a skip-the-write gate built on it
 * would have ignored the labels/fields changes the callers log separately, so the
 * return value is gone rather than waiting to mislead someone.
 *
 * `bodyNoun` names the body the way the upstream does — 'description' for GitLab —
 * so the unchanged line speaks the target system's vocabulary.
 */
export function logUpdatePreview(
  log: (msg: string) => void,
  args: {
    readonly currentTitle: string;
    readonly newTitle: string | undefined;
    readonly currentBody: string;
    readonly newBody: string | undefined;
    readonly bodyNoun?: string;
  },
): void {
  const titleDiff = args.newTitle === undefined ? [] : diffLines(args.currentTitle, args.newTitle);
  const bodyDiff = args.newBody === undefined ? [] : diffLines(args.currentBody, args.newBody);
  for (const line of [...titleDiff, ...bodyDiff]) log(line);
  if (titleDiff.length === 0 && bodyDiff.length === 0) log(`  (title and ${args.bodyNoun ?? 'body'} unchanged)`);
}
