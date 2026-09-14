/**
 * OKF v0.1 bundle writer for the `extract-*` pipelines (render format `'okf'`).
 *
 * A snapshot with `render: [..., 'okf']` gets, next to the per-resource files, a
 * `knowledge/` directory in the Open Knowledge Format v0.1 standard
 * (GoogleCloudPlatform/knowledge-catalog): a markdown concept per resource
 * (frontmatter with the required `type`), `index.md` (frontmatter is EXCLUSIVELY
 * `okf_version` — §6/§11) and `log.md` (newest entries on top, date headings pure
 * ISO — §7; history is never rewritten).
 *
 * Frontmatter rule worth stating once: free-form values (page and issue titles
 * straight from upstream) are quoted, with control characters escaped in
 * double-quoted YAML style. A raw newline inside a single-quoted scalar cuts the
 * frontmatter block short and orphans the quote — the document then parses as
 * something else entirely, without an error.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { assertSafeBasename, mapWithConcurrency, PIPELINE_CONCURRENCY } from './read-runtime.js';
import { getRepoVersion } from './version.js';

// ── Frontmatter ──────────────────────────────────────────────────────────────

/**
 * Quoted YAML scalar for near-arbitrary values (titles from upstream): single
 * quotes normally; double quotes with escapes when the value contains a quote,
 * a backslash or a control character.
 */
export function okfScalar(value: string): string {
  let needsDouble = false;
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    if (ch === "'" || ch === '"' || ch === '\\' || code < 0x20 || code === 0x7f) {
      needsDouble = true;
      break;
    }
  }
  if (!needsDouble) return `'${value}'`;
  let escaped = '';
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    if (ch === '\\') escaped += '\\\\';
    else if (ch === '"') escaped += '\\"';
    else if (ch === '\n') escaped += '\\n';
    else if (ch === '\r') escaped += '\\r';
    else if (ch === '\t') escaped += '\\t';
    else if (code < 0x20 || code === 0x7f) escaped += `\\x${code.toString(16).padStart(2, '0')}`;
    else escaped += ch;
  }
  return `"${escaped}"`;
}

export type OkfFmValue = string | readonly string[];

/** Frontmatter block: entries in the given order, every scalar quoted, arrays as a block list. */
export function okfFrontmatter(entries: readonly (readonly [string, OkfFmValue])[]): string {
  const lines: string[] = ['---'];
  for (const [key, value] of entries) {
    if (typeof value === 'string') {
      lines.push(`${key}: ${okfScalar(value)}`);
    } else {
      lines.push(`${key}:`);
      for (const item of value) lines.push(`  - ${okfScalar(item)}`);
    }
  }
  lines.push('---', '');
  return lines.join('\n');
}

// ── Concepts ─────────────────────────────────────────────────────────────────

export interface OkfConceptInput {
  /** Concept file basename (without `.md`) — validated by {@link assertSafeBasename}. */
  readonly slug: string;
  /** Required OKF field (`type` in the frontmatter), e.g. 'Jira Issue' / 'Confluence Page'. */
  readonly type: string;
  readonly title: string;
  readonly description?: string;
  /** URL of the resource in the source system (Jira / Confluence). */
  readonly resource?: string;
  readonly tags?: readonly string[];
  /** Extra frontmatter fields specific to the pipeline (ids, statuses). */
  readonly extra?: readonly (readonly [string, OkfFmValue])[];
  /** Markdown body of the concept (usually the pipeline's existing per-resource renderer). */
  readonly body: string;
}

/** Full contents of the concept file: frontmatter + body. */
export function renderOkfConcept(concept: OkfConceptInput, stamp: string): string {
  const fm: (readonly [string, OkfFmValue])[] = [
    ['type', concept.type],
    ['title', concept.title],
  ];
  if (concept.description !== undefined) fm.push(['description', concept.description]);
  if (concept.resource !== undefined) fm.push(['resource', concept.resource]);
  if (concept.tags !== undefined && concept.tags.length > 0) fm.push(['tags', concept.tags]);
  fm.push(['timestamp', stamp]);
  for (const entry of concept.extra ?? []) fm.push(entry);
  return `${okfFrontmatter(fm)}\n${concept.body.replace(/\s+$/, '')}\n`;
}

// ── Index (§6/§11: frontmatter is EXCLUSIVELY okf_version) ───────────────────

/** One-line concept entry in the index — newlines from upstream titles flattened. */
function indexLine(conceptsDir: string, concept: OkfConceptInput): string {
  const flatTitle = concept.title.replace(/\s+/g, ' ').trim();
  return `- [${conceptsDir}/${concept.slug}.md](${conceptsDir}/${concept.slug}.md) — ${flatTitle}`;
}

export function renderOkfIndex(args: {
  readonly source: string;
  readonly snapshotName: string;
  readonly conceptsDir: string;
  readonly concepts: readonly OkfConceptInput[];
}): string {
  const lines = args.concepts.map((c) => indexLine(args.conceptsDir, c)).join('\n');
  return `${okfFrontmatter([['okf_version', '0.1']])}
# ${args.snapshotName} — knowledge bundle (OKF v0.1)

Extract of \`${args.source}\` generated by the extract tooling (snapshot \`${args.snapshotName}\`).
The concepts mirror the resources of the source system; \`resource\` in the frontmatter
points at the original. Run log: [log.md](log.md) (newest on top).

## Concepts (${String(args.concepts.length)})

${lines}
`;
}

// ── Log (§7: newest first, date headings pure ISO) ───────────────────────────

const LOG_HEADER = `${okfFrontmatter([
  ['type', 'Log'],
  ['title', 'Extraction log'],
])}
# Change log

Entries NEWEST ON TOP (OKF v0.1 §7), date headings in ISO \`YYYY-MM-DD\` form.
One entry per extract run; do not rewrite existing entries.
`;

export interface OkfLogEntry {
  /**
   * Date of the run in pure ISO `YYYY-MM-DD` — the form OKF v0.1 §7 requires for a
   * log heading. `writeOkfBundle` passes {@link okfLogDate} of the run stamp; a
   * caller reaching this directly should do the same.
   */
  readonly stamp: string;
  readonly source: string;
  readonly snapshotName: string;
  readonly conceptCount: number;
  readonly toolVersion: string;
}

/**
 * Reduce anything date-shaped — an ISO timestamp, or a `YYYY-MM-DD_HH-MM` run stamp — to the
 * `YYYY-MM-DD` heading OKF asks for.
 */
export function okfLogDate(stampOrIso: string): string {
  return stampOrIso.slice(0, 10);
}

/**
 * New log = the entry inserted directly under the header, above existing entries.
 * The prior log is normalised first (BOM stripped, CRLF→LF); empty or
 * whitespace-only counts as absent, so a truncated file does not produce a
 * bundle whose log begins with a blank heading.
 */
export function insertOkfLogEntry(entry: OkfLogEntry, priorLog?: string): string {
  const body = `## ${entry.stamp}

- **extract** (\`${entry.source}\`, snapshot \`${entry.snapshotName}\`) — concepts: ${String(entry.conceptCount)}.
- Tooling: extract ${entry.toolVersion}.
`;
  const normalised = priorLog
    ?.replace(/^\uFEFF/, '')
    .replaceAll('\r\n', '\n')
    .replaceAll('\r', '\n');
  const prior =
    normalised === undefined || normalised.trim() === '' ? LOG_HEADER : `${normalised.replace(/\s+$/, '')}\n`;
  // `startsWith` first: a log whose header was hand-edited away starts with `## ` at
  // position 0, which `indexOf('\n## ')` cannot see — the new entry then landed BELOW
  // the old ones, silently breaking the newest-first promise above.
  const firstEntry = prior.startsWith('## ') ? 0 : prior.indexOf('\n## ');
  if (firstEntry === -1) return `${prior}\n${body}`;
  if (firstEntry === 0) return `${body}\n${prior}`;
  // The head slice keeps its own trailing blank line, so inserting another `\n` on
  // top of it grew the header-to-entry gap by one blank line on EVERY run —
  // cumulative degradation on the one file that is never rewritten. Collapse the
  // head's trailing newlines to exactly one before rebuilding the gap.
  const head = prior.slice(0, firstEntry + 1).replace(/\n+$/, '\n');
  return `${head}\n${body}\n${prior.slice(firstEntry + 1)}`;
}

// ── Writer ───────────────────────────────────────────────────────────────────

/**
 * The bundle directory name, per OKF v0.1 — exported so the pipelines' log lines
 * point at the SAME directory this writer creates, instead of hand-repeating the
 * literal that would silently go stale on a rename.
 */
export const OKF_BUNDLE_DIR = 'knowledge';

/**
 * Writes the snapshot's OKF bundle: `knowledge/index.md`, `knowledge/log.md`
 * (appended newest-first relative to the existing one) and the concepts in
 * `knowledge/<conceptsDir>/<slug>.md`. Slugs go through the path-traversal
 * guard (upstream-controlled ids — threat model as in read-runtime).
 * Returns the number of concepts written.
 */
export async function writeOkfBundle(args: {
  readonly snapshotDir: string;
  readonly source: string;
  readonly snapshotName: string;
  readonly conceptsDir: string;
  readonly concepts: readonly OkfConceptInput[];
  /**
   * The run stamp, at whatever precision the caller keeps it. It goes into each
   * concept's `timestamp` frontmatter verbatim; the log heading gets
   * {@link okfLogDate} of it, because OKF v0.1 §7 wants a plain date there. The
   * two used to be conflated, which either coarsened the concept timestamp to a
   * day or put a run stamp in a field documented as a date.
   */
  readonly stamp: string;
  /**
   * Defaults to the repo's own version — both pipelines passed exactly that, and a
   * third okf-capable pipeline copying the call is one hand-plumbed knob lighter.
   * A test may still pin an explicit value for byte determinism.
   */
  readonly toolVersion?: string;
}): Promise<number> {
  const bundleDir = join(args.snapshotDir, OKF_BUNDLE_DIR);
  const conceptsDir = join(bundleDir, assertSafeBasename(args.conceptsDir));
  await mkdir(conceptsDir, { recursive: true });

  // Concept files are independent (distinct slugs, deterministic content) — a
  // serial for…await paid one threadpool round-trip per file, seconds of pure fs
  // latency at 10k concepts, for writes whose order is irrelevant.
  await mapWithConcurrency(args.concepts, PIPELINE_CONCURRENCY, async (concept) => {
    assertSafeBasename(concept.slug);
    await writeFile(join(conceptsDir, `${concept.slug}.md`), renderOkfConcept(concept, args.stamp), 'utf8');
  });

  await writeFile(
    join(bundleDir, 'index.md'),
    renderOkfIndex({
      source: args.source,
      snapshotName: args.snapshotName,
      conceptsDir: args.conceptsDir,
      concepts: args.concepts,
    }),
    'utf8',
  );

  const logPath = join(bundleDir, 'log.md');
  // Only "the file is not there yet" may be swallowed. Catching everything meant a
  // transient read failure — a lock, a permission blip — silently rewrote the log
  // with a single entry, and the history the log exists to keep was gone with no
  // error anywhere.
  const priorLog = await readFile(logPath, 'utf8').catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') return undefined;
    throw error;
  });
  await writeFile(
    logPath,
    insertOkfLogEntry(
      {
        stamp: okfLogDate(args.stamp),
        source: args.source,
        snapshotName: args.snapshotName,
        conceptCount: args.concepts.length,
        toolVersion: args.toolVersion ?? getRepoVersion(),
      },
      priorLog,
    ),
    'utf8',
  );

  return args.concepts.length;
}
