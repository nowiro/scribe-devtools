/**
 * Shared helpers for `integrations/<source>/extract-<source>.ts`.
 *
 * Deliberately minimal surface: only what IS actually duplicated across >= 2
 * pipelines. Upstream-specific logic (Jira cursor pagination vs Confluence
 * cursor vs GitLab page-based vs Sonar p/ps) stays in the individual pipelines —
 * differences in upstream API semantics do not deserve a shared abstraction that
 * has to be bent for each of them.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

import { getCorrelationId } from './run-identity.js';
import { getRepoVersion } from './version.js';

// ── Shared Zod schemas used in pipeline configs ──────────────────────────────

/** Snapshot name — `[a-z0-9-]` (lowercase + dashes), used as a subdirectory. */
export const snapshotNameSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]*$/)
  .min(1)
  .max(64);

/**
 * Config-level guard for every pipeline: snapshot names must be UNIQUE — the name
 * is the output directory, so two snapshots sharing one raced their _manifest and
 * summary writes nondeterministically once snapshots gained concurrency (and were
 * a silent last-wins overwrite even before).
 */
export function assertUniqueSnapshotNames(
  config: { readonly snapshots: readonly { readonly name: string }[] },
  ctx: z.RefinementCtx,
): void {
  const seen = new Set<string>();
  config.snapshots.forEach((snapshot, index) => {
    if (seen.has(snapshot.name)) {
      ctx.addIssue({
        code: 'custom',
        path: ['snapshots', index, 'name'],
        message: `duplicate snapshot name "${snapshot.name}" — the name is the output directory, so each must be unique`,
      });
    }
    seen.add(snapshot.name);
  });
}

/** Per-resource output formats — minimum 1, both by default. */
export const renderFormatsSchema = z
  .array(z.enum(['json', 'markdown']))
  .min(1)
  .default(['json', 'markdown']);

/**
 * Variant with `'okf'` for the pipelines that CAN emit an Open Knowledge Format
 * v0.1 knowledge bundle (writer: `shared/okf.ts`) — today jira and confluence.
 * gitlab/sonar stay on the base schema, so `'okf'` in their config fails LOUDLY
 * at parse time instead of quietly doing nothing.
 */
export const renderFormatsWithOkfSchema = z
  .array(z.enum(['json', 'markdown', 'okf']))
  .min(1)
  .default(['json', 'markdown']);

export type RenderFormat = z.infer<typeof renderFormatsWithOkfSchema>[number];

// ── Output location ──────────────────────────────────────────────────────────

/**
 * Default output directory for a source, resolved by each pipeline relative to
 * its CONFIG FILE — so a config in the repo root writes to `<repo>/.alm/<source>/`.
 *
 * `.alm/` is gitignored, and that is the point rather than a convenience: what
 * lands there is upstream customer data (issue descriptions, comments,
 * worklogs, page bodies). Getting it out of git history once it is in means
 * rewriting every clone, which in practice means never.
 *
 * The five pipelines used to disagree here — one wrote to a cache path, four to
 * `./output/<source>` — so the `.gitignore` comment describing the layout was
 * false for four of them.
 */
export function defaultOutputDir(source: string): string {
  return `./.alm/${source}`;
}

/**
 * `./read.config.<source>.json` — the same convention the `read.mjs` dispatcher
 * predicts on its side of the .mjs/.ts boundary. The literal used to be hand-kept
 * in all eight pipelines; a typo in one would make the dispatcher existence-check
 * a different file than the pipeline reads.
 */
export function defaultConfigPath(source: string): string {
  return `./read.config.${source}.json`;
}

// ── Run stamp ────────────────────────────────────────────────────────────────

/** Run stamp form: `YYYY-MM-DD_HH-MM` in `Europe/Warsaw`. */
export const STAMP_PATTERN = /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}$/;

const STAMP_FORMAT = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Warsaw',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/** `Date` → `YYYY-MM-DD_HH-MM` in `Europe/Warsaw`. `Intl` computes the offset, not arithmetic. */
export function formatStamp(date: Date): string {
  const parts = new Map(
    STAMP_FORMAT.formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value] as const),
  );
  const hour = parts.get('hour') === '24' ? '00' : (parts.get('hour') ?? '00');
  return `${parts.get('year') ?? '1970'}-${parts.get('month') ?? '01'}-${parts.get('day') ?? '01'}_${hour}-${parts.get('minute') ?? '00'}`;
}

export interface ReadArgs {
  readonly configPath: string;
  /** Stamp given explicitly (`--stamp` / `EXTRACT_STAMP`) or `undefined` → the clock. */
  readonly stamp: string | undefined;
}

/**
 * Parses `--config <file>` / `--config=<file>` / the positional argument, plus
 * `--stamp <stamp>`. A bad stamp fails LOUDLY — silently swapping in "now"
 * would turn a deterministic run into a random directory.
 *
 * Every extract pipeline shares this. Four of the early five used to read `process.argv[2]`
 * raw, so `--config x.json` was taken as the config path *literally* — the file
 * `--config` was then reported as missing.
 */
export function parseReadArgs(
  argv: readonly string[],
  defaultConfigPath: string,
  env: Record<string, string | undefined> = {},
): ReadArgs {
  let configPath: string | undefined;
  let stamp: string | undefined;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? '';
    const eq = arg.indexOf('=');
    const [flag, inlineValue] = eq === -1 ? [arg, undefined] : [arg.slice(0, eq), arg.slice(eq + 1)];
    // A flag with no value fails LOUDLY. `--stamp` as the last argument used to leave
    // stamp undefined — the validation below never ran and the run silently fell back
    // to the clock, the exact behaviour the docblock forbids; a trailing `--config`
    // silently read the default config instead of the intended one.
    if (flag === '--config' || flag === '--stamp') {
      const value = inlineValue ?? argv[++i];
      if (value === undefined || value === '') {
        throw new Error(`${flag} requires a value — none was given`);
      }
      if (flag === '--config') configPath = value;
      else stamp = value;
    } else if (arg.startsWith('-')) {
      // A typo'd `--stmap X` used to be ignored, making X the config path and the error
      // a misleading "config not found". apply already rejects unknown flags; so do we.
      throw new Error(`unknown flag ${JSON.stringify(arg)} — extract knows --config and --stamp`);
    } else if (configPath === undefined) {
      configPath = arg;
    } else {
      // A second positional is as loud as an unknown flag — `read jira a.json b.json`
      // used to silently run a.json only, the same guessing parseWriteArgs already refuses.
      throw new Error(
        `unexpected extra argument ${JSON.stringify(arg)} — read pipelines take one config path (got ${JSON.stringify(configPath)} already)`,
      );
    }
  }
  const resolvedStamp = stamp ?? env['EXTRACT_STAMP'];
  if (resolvedStamp !== undefined && !STAMP_PATTERN.test(resolvedStamp)) {
    throw new Error(`invalid stamp ${JSON.stringify(resolvedStamp)} — expected YYYY-MM-DD_HH-MM`);
  }
  return {
    configPath: configPath ?? defaultConfigPath,
    ...(resolvedStamp === undefined ? { stamp: undefined } : { stamp: resolvedStamp }),
  };
}

// ── Logger (stderr, prefixed with the script name) ───────────────────────────

/**
 * Creates a pipeline logger writing lines to stderr.
 *
 * Stdout stays free for whatever a caller wants to pipe; progress and warnings
 * are diagnostics and belong on stderr, so `npm run read -- jira > out` never
 * mixes the two.
 */
export function createScriptLogger(scriptName: string): (msg: string) => void {
  return (msg: string) => {
    process.stderr.write(`[${scriptName}] ${msg}\n`);
  };
}

// ── Config loading ───────────────────────────────────────────────────────────

/**
 * Reads a JSON file from the path, parses it, validates it against the given Zod
 * schema. Throws on a missing file or malformed JSON / schema mismatch — the
 * pipeline catches it in `runIfMain` and prints FATAL.
 *
 * A schema failure is reformatted first. Zod's own message is a JSON dump of its
 * issue array, and the config schemas are strict, so the single most common
 * failure is a misspelled key — the one case where the message has to be
 * readable by the person who made the typo, not by a parser.
 */
export async function loadJsonConfig<T extends z.ZodTypeAny>(path: string, schema: T): Promise<z.infer<T>> {
  const text = await readFile(path, 'utf8');
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    // A bare SyntaxError names a position but no FILE — with several read.config.*.json
    // around, the schema branch below prefixes the path and this branch must too.
    const msg = error instanceof Error ? error.message : String(error);
    throw new Error(`${path} is not valid JSON: ${msg}`);
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    throw new Error(`${path} is not a valid config:\n${formatSchemaIssues(parsed.error)}`);
  }
  return parsed.data as z.infer<T>;
}

/**
 * One `  - where: what` line per issue, in the order Zod reported them.
 * Exported because the apply runtime formats its front-matter errors the same way —
 * a config typo and a front-matter typo deserve the same readable answer.
 */
export function formatSchemaIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      // `['snapshots', 0, 'maxIssues']` reads better as `snapshots[0].maxIssues`
      // than as a JSON array, which is how Zod prints it by default.
      const where = issue.path.reduce<string>((acc, segment) => {
        if (typeof segment === 'number') return `${acc}[${String(segment)}]`;
        const key = String(segment);
        return acc === '' ? key : `${acc}.${key}`;
      }, '');
      return `  - ${where === '' ? '(root)' : where}: ${issue.message}`;
    })
    .join('\n');
}

// ── Markdown tables ──────────────────────────────────────────────────────────

/**
 * Collapse newlines and escape pipes so a free-text cell cannot reshape the table.
 * ONLY `|` and newlines — never backslash-doubling: several callers wrap cells in
 * backtick code spans, where GFM does not process backslash escapes, so doubling
 * rendered a CSS.escape'd selector like `.md\:flex` as the unusable `.md\\:flex`
 * (adf.ts's own cell escaper documents the same rule).
 */
export const escapeTableCell = (value: string): string =>
  value
    .replaceAll(/[\r\n]+/gu, ' ')
    .replaceAll('|', '\\|')
    .trim();

/**
 * A GFM table with every cell hardened by {@link escapeTableCell}. Promoted from
 * the figma pipeline, which patched pipe- and newline-in-cell corruption TWICE
 * (`replace` once escaped only the FIRST pipe) — while sonar and browser-inspector
 * hand-rolled the same tables with upstream text unescaped, waiting to rediscover
 * the identical bug in a rule message or component path.
 */
// ── Offset pagination (the canonical walker) ─────────────────────────────────

/** One page of an offset-paginated list: nullable `total` plus nullable rows. */
export interface OffsetPage<T> {
  readonly total?: number | null;
  readonly results?: readonly (T | null)[] | null;
}

/** What a walk over one offset-paginated query produced — every kind of loss is a named fact. */
export interface OffsetWalk<T> {
  readonly items: T[];
  /** Upstream's own count — absent when upstream never sent a usable one. */
  readonly total?: number;
  /** More rows upstream than this walk holds — a ceiling, a shift, or a stall. */
  readonly truncated: boolean;
  /** The walk ended because upstream stopped advancing — rows ARE missing. */
  readonly stalled: boolean;
  /** Rows upstream returned as `null` (not visible to this token) — filtered out, and said. */
  readonly hidden: number;
}

/**
 * A hard ceiling on page REQUESTS, independent of `maxItems`: an upstream that
 * streams only null rows never grows `items`, and (like figma's cursor guard) a
 * loop bounded only by data-derived state is one server bug away from spinning.
 */
const OFFSET_MAX_PAGES = 200;

/**
 * `start`/`limit` pagination — the CANONICAL offset walker, lifted from xray (its
 * best-specified incarnation) after the same hardening had grown five homes. New
 * sources start here; jira's `fetchSubList` and sonar's `paginateSonar` stay
 * separate on purpose — each pins deliberate quirks (last-total policy + cleanEnd,
 * page-number arithmetic + Sonar's 10k ceiling) that this walker does not model.
 *
 * The hardening, each line paid for by a bug:
 * - `total` comes from the FIRST page only — later pages restate the CURRENT
 *   (shifted) count, and the field is nullable, so "first page" must not mean
 *   "first page that had a number".
 * - The cursor advances by RAW rows (nulls included); pushed items are SLICED to
 *   the remaining budget, because `limit` is only a request and a server clamping
 *   to its own page size used to overflow `maxItems`.
 * - The no-progress guard keys on the first NON-NULL row: every null row
 *   stringifies to the same `'null'`, so two pages merely STARTING with a hidden
 *   row collided and aborted good walks. An all-null page leaves the guard to the
 *   OFFSET_MAX_PAGES ceiling.
 */
export async function walkOffsetPages<T>(
  fetchPage: (start: number, limit: number) => Promise<OffsetPage<T>>,
  options: { readonly maxItems: number; readonly pageLimit?: number },
): Promise<OffsetWalk<T>> {
  const { maxItems, pageLimit = 100 } = options;
  const items: T[] = [];
  let total: number | undefined;
  let sawFirstPage = false;
  let start = 0;
  let pages = 0;
  let hidden = 0;
  let mayHaveMore = false;
  let overflowed = false;
  let stalled = false;
  let prevFirst: string | undefined;
  while (items.length < maxItems && pages < OFFSET_MAX_PAGES) {
    const limit = Math.min(pageLimit, maxItems - items.length);
    const page = await fetchPage(start, limit);
    pages += 1;
    if (!sawFirstPage && typeof page.total === 'number') total = page.total;
    sawFirstPage = true;
    const raw = page.results ?? [];
    if (raw.length === 0) {
      mayHaveMore = false;
      break;
    }
    const probe = raw.find((row) => row !== null && row !== undefined);
    const first = probe === undefined ? undefined : JSON.stringify(probe);
    if (first !== undefined && first === prevFirst) {
      stalled = true;
      break;
    }
    if (first !== undefined) prevFirst = first;
    const visible = raw.filter((row): row is T => row !== null && row !== undefined);
    hidden += raw.length - visible.length;
    const budget = maxItems - items.length;
    if (visible.length > budget) overflowed = true;
    items.push(...visible.slice(0, budget));
    start += raw.length;
    mayHaveMore = raw.length >= limit;
    if (total !== undefined && start >= total) break;
  }
  // A server can lie LOW (serving rows beyond its own count) — trust the walk.
  if (total !== undefined && total < start) total = start;
  return {
    items,
    ...(total !== undefined ? { total } : {}),
    truncated: stalled || overflowed || (total !== undefined ? total > start : mayHaveMore),
    stalled,
    hidden,
  };
}

/**
 * One spelling for the operator's stderr truncation alarm. The markdown carries
 * the details; stderr carries the alarm — and it had grown a different spelling
 * per pipeline, so no single grep could find "something was cut" across sources.
 */
export function warnIfTruncated(log: (msg: string) => void, truncated: boolean, detail: string): void {
  if (truncated) log(`WARN: truncated — ${detail}`);
}

export const mdTable = (headers: readonly string[], rows: readonly (readonly string[])[]): string =>
  [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((r) => `| ${r.map(escapeTableCell).join(' | ')} |`),
  ].join('\n');

// ── Output writers ───────────────────────────────────────────────────────────

/**
 * Path-traversal guard for output file names. `basename` comes from
 * upstream-controlled identifiers (`issue.key`, `page.id`, `issue-<iid>`), and a
 * malicious / compromised upstream — the first threat in the threat model —
 * could return `../../evil`, a path separator or `..`, which `path.join` would
 * resolve OUTSIDE the snapshot directory. Fail-closed: only `[A-Za-z0-9._-]` is
 * allowed, `..` and empty are rejected. Jira keys (`PROJ-123`), numeric
 * Confluence ids, `issue-42`, `_summary`/`_manifest` pass through unchanged.
 */
export function assertSafeBasename(basename: string): string {
  if (!/^[A-Za-z0-9._-]+$/.test(basename) || basename === '.' || basename.includes('..')) {
    throw new Error(`unsafe output basename (path-traversal guard): ${JSON.stringify(basename)}`);
  }
  return basename;
}

/**
 * Writes the per-resource output: JSON `<basename>.json` (with a trailing
 * newline, 2-space indent) + Markdown `<basename>.md`. Creates the directory if
 * it does not exist. Controlled by `formats` — usually `['json', 'markdown']`.
 * `basename` is validated by {@link assertSafeBasename} (path-traversal).
 */
/** One file this run wrote, with its size — the budget an agent reads BEFORE opening it. */
export interface WrittenFile {
  readonly name: string;
  readonly bytes: number;
}

/**
 * Default threshold for the markdown SIDECAR split — ~15k tokens. Jira issues and
 * Confluence pages can be enormous; an agent that must load a 2 MB file to answer
 * one question wastes its whole context. Above the threshold the `.md` keeps the
 * head plus a loud pointer, and the COMPLETE document moves to `<basename>.full.md`.
 * The `.json` always carries everything — the split shapes the READING view only,
 * so nothing is lost, per this repo's no-silent-amputation rule.
 */
export const SIDECAR_DEFAULT_CHARS = 60_000;

/** Cut at the last newline within `limit` — a mid-table cut reads as corruption. */
function headAtLineBoundary(text: string, limit: number): string {
  const cut = text.lastIndexOf('\n', limit);
  return cut > 0 ? text.slice(0, cut) : text.slice(0, limit);
}

export async function writePipelineOutputs(args: {
  readonly dir: string;
  readonly basename: string;
  readonly data: unknown;
  readonly markdown: string;
  readonly formats: readonly RenderFormat[];
  /** Set (jira, confluence) to split an oversized markdown view into head + `.full.md` sidecar. */
  readonly sidecarOverChars?: number;
}): Promise<readonly WrittenFile[]> {
  assertSafeBasename(args.basename);
  await mkdir(args.dir, { recursive: true });
  const written: WrittenFile[] = [];
  const put = async (name: string, content: string): Promise<void> => {
    await writeFile(join(args.dir, name), content, 'utf8');
    written.push({ name, bytes: Buffer.byteLength(content, 'utf8') });
  };
  if (args.formats.includes('json')) {
    await put(`${args.basename}.json`, JSON.stringify(args.data, null, 2) + '\n');
  }
  if (args.formats.includes('markdown')) {
    const limit = args.sidecarOverChars;
    if (limit !== undefined && args.markdown.length > limit) {
      const head = headAtLineBoundary(args.markdown, limit);
      const note =
        `\n\n> **SIDECAR**: this view holds the first ${String(head.length)} of ` +
        `${String(args.markdown.length)} characters — the complete document is in ` +
        `\`${args.basename}.full.md\`, and \`${args.basename}.json\` always carries everything.\n`;
      await put(`${args.basename}.md`, head + note);
      await put(`${args.basename}.full.md`, args.markdown);
    } else {
      await put(`${args.basename}.md`, args.markdown);
    }
  }
  return written;
}

/**
 * Writes `<dir>/_manifest.json` with the run metadata. The manifest is the
 * snapshot-by-snapshot contract: name, type, start/finish timestamp, list of
 * extracted ids, tooling. Identical shape across all pipelines.
 */
export async function writeManifest(dir: string, manifest: unknown): Promise<void> {
  await writeFile(join(dir, '_manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
}

/** Common manifest envelope — fields shared by all pipelines. */
interface ManifestEnvelope {
  readonly snapshot: string;
  /**
   * With `stamp`, `source` makes the snapshot self-describing: a reader knows what
   * it is looking at without parsing the directory name it happens to sit in, which
   * survives the directory being moved, renamed or archived. Both used to be
   * hand-appended as extras by every single pipeline — universally shared fields
   * pretending to be pipeline-specific.
   */
  readonly source: string;
  readonly stamp: string;
  readonly runStartedAt: string;
  readonly runFinishedAt: string;
  /**
   * The run's correlation id — the SAME value every outbound request carried in
   * `X-Correlation-Id`, so an upstream audit log and this snapshot can be tied together.
   */
  readonly correlationId: string;
  readonly render: readonly RenderFormat[];
  readonly tooling: { readonly script: string; readonly version: string };
}

/** The run identity the envelope needs — a `ReadRun` satisfies it structurally. */
export interface ManifestRun {
  readonly source: string;
  readonly stamp: string;
  readonly startedAt: string;
}

/**
 * Builds the common manifest envelope (snapshot name, run identity, start/finish
 * timestamps, render, tooling) + appends the pipeline-specific `extras` (jql,
 * type, projectId, itemCount, …).
 *
 * `extras` wins (spread after the envelope), but to preserve the envelope
 * contract it is recommended not to override the shared fields.
 */
export function buildManifest<E extends Record<string, unknown>>(
  scriptName: string,
  run: ManifestRun,
  snapshot: { readonly name: string; readonly render: readonly RenderFormat[] },
  extras: E,
): ManifestEnvelope & E {
  return {
    snapshot: snapshot.name,
    source: run.source,
    stamp: run.stamp,
    runStartedAt: run.startedAt,
    runFinishedAt: new Date().toISOString(),
    correlationId: getCorrelationId(),
    render: snapshot.render,
    tooling: { script: scriptName, version: getRepoVersion() },
    ...extras,
  };
}

// ── The run scaffold ─────────────────────────────────────────────────────────

/** The part of every read config the scaffold itself touches. */
interface ReadRunConfigShape {
  readonly outputDir: string;
  readonly snapshots: readonly unknown[];
}

export interface ReadRun<C> {
  readonly config: C;
  readonly configPath: string;
  readonly runRoot: string;
  readonly stamp: string;
  readonly startedAt: string;
  /** `<runRoot>/<name>`, created. */
  snapshotDir(name: string): Promise<string>;
  /** {@link buildManifest} with this run's identity (source, stamp, startedAt) baked in. */
  manifest<E extends Record<string, unknown>>(
    snapshot: { readonly name: string; readonly render: readonly RenderFormat[] },
    extras: E,
  ): Record<string, unknown>;
  /** The uniform closing line: `done — N item(s) across M snapshot(s) in Xms`. */
  finish(totalItems: number): void;
  /** ms since the run started — for a pipeline whose closing line must differ. */
  elapsedMs(): number;
}

/**
 * Everything between `main()`'s first line and the first source-specific call:
 * argv → config → output root → stamp → run directory. This block was copy-pasted
 * into all eight pipelines — four of them carried the same three-line comment
 * verbatim — and had already drifted twice; by this module's own rule (shared is
 * what IS duplicated across >= 2 pipelines) it belongs here.
 *
 * Every run gets its own `<outputRoot>/<stamp>` directory. Writing straight into
 * `<outputRoot>/<snapshot>` left the previous run's files sitting beside the new
 * ones, and a resource deleted upstream simply stayed in the snapshot forever.
 * The stamp is the ONLY place the clock has a say; everything downstream copies
 * it out of the run rather than reading the clock again.
 */
export async function startReadRun<T extends z.ZodTypeAny>(args: {
  readonly scriptName: string;
  readonly source: string;
  readonly schema: T;
  readonly log: (msg: string) => void;
}): Promise<ReadRun<z.infer<T>>> {
  const parsed = parseReadArgs(process.argv.slice(2), defaultConfigPath(args.source), process.env);
  const configPath = resolve(parsed.configPath);
  args.log(`config: ${configPath}`);
  // The cast states what every read config schema guarantees: `outputDir` (with a
  // default) and a `snapshots` array. The zod generic cannot carry that constraint
  // without forcing every pipeline's schema type through this module.
  const config = (await loadJsonConfig(configPath, args.schema)) as z.infer<T> & ReadRunConfigShape;
  // outputDir resolves relative to the CONFIG FILE, so a config in a consumer repo
  // writes into that repo, not into this checkout.
  const outputRoot = resolve(dirname(configPath), config.outputDir);
  const startedAt = new Date().toISOString();
  const startMs = Date.now();
  const stamp = parsed.stamp ?? formatStamp(new Date(startedAt));
  const runRoot = join(outputRoot, stamp);
  args.log(`run: ${runRoot}`);
  const run: ManifestRun = { source: args.source, stamp, startedAt };
  return {
    config,
    configPath,
    runRoot,
    stamp,
    startedAt,
    async snapshotDir(name: string): Promise<string> {
      const dir = join(runRoot, name);
      await mkdir(dir, { recursive: true });
      return dir;
    },
    manifest(snapshot, extras) {
      return buildManifest(args.scriptName, run, snapshot, extras);
    },
    finish(totalItems: number): void {
      args.log(
        `done — ${totalItems} item(s) across ${config.snapshots.length} snapshot(s) in ${Date.now() - startMs}ms`,
      );
    },
    elapsedMs(): number {
      return Date.now() - startMs;
    },
  };
}

// ── Cursor parsing (Confluence v2-style `_links.next`) ───────────────────────

/**
 * Extracts the `cursor` parameter value from the URL in `_links.next`. Confluence
 * v2 cursor pagination returns `_links.next` as an absolute URL with `?cursor=…` —
 * only the cursor value is needed.
 *
 * Returns `undefined` when linkOrUndefined is empty or has no `cursor=`.
 */
export function parseCursorFromLink(linkOrUndefined: string | undefined): string | undefined {
  if (!linkOrUndefined) return undefined;
  const match = /[?&]cursor=([^&]+)/.exec(linkOrUndefined);
  const cursorValue = match?.[1];
  if (!cursorValue) return undefined;
  return decodeURIComponent(cursorValue);
}

// ── Bounded concurrency ──────────────────────────────────────────────────────

/**
 * How many ITEMS a pipeline works on at once — mirrors the HTTP client's default
 * permit count. The client's semaphore stays the real socket bound; this only
 * keeps enough items in flight to actually use it.
 */
export const PIPELINE_CONCURRENCY = 6;

/**
 * Order-preserving map with a concurrency bound. The HTTP client caps SOCKETS,
 * but a `for … of await` upstream of it used at most one permit — every pipeline
 * paid full serial latency for overlap the client was already built to provide.
 * Results land by index, so `written` lists and okf concept order stay
 * deterministic; the first rejection aborts the run exactly as the serial loop
 * did (items already in flight settle in the background — their writes go to
 * distinct files).
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  let failed = false;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    // The `failed` latch stops the OTHER workers after the first rejection.
    // Without it Promise.all rejected (and the run reported FATAL) while the
    // surviving workers kept pulling and processing every remaining item —
    // issuing requests and writing files long after the failure, and leaving a
    // partial run directory that looked complete.
    for (;;) {
      if (failed) return;
      const index = next;
      if (index >= items.length) return;
      next += 1;
      try {
        results[index] = await fn(items[index] as T, index);
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  });
  await Promise.all(workers);
  return results;
}

// ── Main() boilerplate ───────────────────────────────────────────────────────

/**
 * Standard entry-point for `extract-*.ts`. Checks whether the file is run
 * directly (not imported from a test) — if so, executes `main()` and catches
 * every error, writing FATAL to stderr with exit code 1.
 *
 * Usage:
 * ```ts
 * await runIfMain('read-jira', import.meta.url, main);
 * ```
 */
export async function runIfMain(scriptName: string, fileUrl: string, main: () => Promise<void>): Promise<void> {
  if (process.argv[1] !== fileURLToPath(fileUrl)) return;
  try {
    await main();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[${scriptName}] FATAL: ${msg}\n`);
    process.exitCode = 1;
  }
}
