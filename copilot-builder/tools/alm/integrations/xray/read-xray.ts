#!/usr/bin/env node
/**
 * read-xray — batch extraction from Xray for Jira (Server/DC, Xray as a Jira PLUGIN)
 * into on-disk snapshots. READ-ONLY.
 *
 * Two snapshot types:
 *
 *  1. `tests` — test definitions scoped by JQL: the test type (Manual / Cucumber /
 *     Generic), manual steps, the gherkin scenario or the unstructured body, plus the
 *     Jira envelope (key, summary, status).
 *  2. `test_executions` — executions scoped by JQL, each with its test runs
 *     (test key, run status).
 *
 * NO credentials of its own: Xray Server/DC lives INSIDE Jira, so everything rides
 * the `jira` auth profile against the Jira host — scope comes from Jira's own v2
 * search (JQL), definitions from `GET /rest/raven/1.0/api/test` (manual steps arrive
 * as `{step,data,result}.raw`; Cucumber/Generic as a `definition` string), runs from
 * `GET /rest/raven/1.0/api/testexec/{key}/test`.
 *
 * Worth knowing about the custom-field angle: on Server/DC the test DEFINITIONS also
 * live in Jira custom fields, so a plain `jira` snapshot (`*all`) already carries them
 * raw — what only raven can serve is RUN RESULTS, which live in Xray's own tables.
 *
 * Xray CLOUD is deliberately NOT supported (removed 2026-08-30): this repository's
 * Xray is the Jira plugin, and a GraphQL client for a service nobody calls was pure
 * fixed cost. The cloud client (token exchange + GraphQL walk) shipped through
 * v1.0.0 — recover it from that tag if the need ever returns.
 *
 * Run: `npm run read -- xray [path/to/read.config.xray.json]`
 */
import { z } from 'zod';

import { loadJiraAuth } from '../shared/auth.js';
import { NotFoundError } from '../shared/errors.js';
import { codeSpan, fencedBlock, flatLine } from '../shared/adf.js';
import type { IssueRef } from '../shared/jira-reshape.js';
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
  walkOffsetPages,
  warnIfTruncated,
  writeManifest,
  writePipelineOutputs,
} from '../shared/read-runtime.js';
import { createNamedHttpClient, type HttpClient } from '../shared/http-client.js';

const SCRIPT_NAME = 'read-xray';
const log = createScriptLogger(SCRIPT_NAME);

// ── Config ───────────────────────────────────────────────────────────────────

const baseSnapshot = {
  name: snapshotNameSchema,
  render: renderFormatsSchema,
} as const;

const TestsSnapshot = z.strictObject({
  ...baseSnapshot,
  type: z.literal('tests'),
  /** JQL narrowing WHICH tests, e.g. `project = PROJ` — explicit, nothing is guessed. */
  jql: z.string().min(1),
  maxItems: z.number().int().min(1).max(10_000).default(500),
});

const TestExecutionsSnapshot = z.strictObject({
  ...baseSnapshot,
  type: z.literal('test_executions'),
  jql: z.string().min(1),
  maxItems: z.number().int().min(1).max(10_000).default(200),
});

const SnapshotConfig = z.discriminatedUnion('type', [TestsSnapshot, TestExecutionsSnapshot]);

// The schema is strict on purpose: a config still carrying the removed
// `deployment: "cloud"` key fails LOUDLY here instead of silently running
// against the wrong system.
export const ReadConfig = z
  .strictObject({
    outputDir: z.string().min(1).default(defaultOutputDir('xray')),
    snapshots: z.array(SnapshotConfig).min(1),
  })
  .superRefine(assertUniqueSnapshotNames);

// ── Transport (Jira host: v2 search + /rest/raven) ───────────────────────────

/** Jira v2 search page size — the standard `startAt`/`maxResults` offset walk. */
const PAGE_LIMIT = 100;

/**
 * How many test keys ride one `GET /rest/raven/1.0/api/test?keys=…` request.
 * The endpoint has NO pagination — batching by key is the only way to keep both
 * the URL length and the response size bounded.
 */
const KEYS_PER_BATCH = 50;

/** Jira v2 search page — Server/DC offset pagination (`startAt`/`total`). */
interface RawSearchPage {
  readonly total?: number | null;
  readonly issues?: readonly (RawSearchIssue | null)[] | null;
}

interface RawSearchIssue {
  readonly key?: string | null;
  readonly fields?: {
    readonly summary?: string | null;
    readonly status?: { readonly name?: string | null } | null;
  } | null;
}

/** One wiki-field of a DC manual step — `raw` is the source text, `rendered` is HTML. */
interface RawStepField {
  readonly raw?: string | null;
}

interface RawStep {
  readonly step?: RawStepField | null;
  readonly data?: RawStepField | null;
  readonly result?: RawStepField | null;
}

/**
 * One test from `GET /rest/raven/1.0/api/test`. `definition` is a STRING for
 * Cucumber/Generic tests and an OBJECT with `steps` for manual ones — the shape,
 * not a type field, carries the distinction, and `type` disambiguates the string
 * case (`Automated[Cucumber]` vs `Automated[Generic]`).
 */
interface RawTest {
  readonly key?: string | null;
  readonly type?: string | null;
  readonly definition?: string | { readonly steps?: readonly (RawStep | null)[] | null } | null;
}

/** One run from `GET /rest/raven/1.0/api/testexec/{key}/test` — DC serves a flat, minimal row. */
interface RawRun {
  readonly key?: string | null;
  readonly status?: string | null;
  readonly startedOn?: string | null;
  readonly finishedOn?: string | null;
}

// ── Canonical shapes ─────────────────────────────────────────────────────────

interface TestStep {
  readonly action: string;
  readonly data?: string;
  readonly result?: string;
}

// `Omit<…, 'type'>`: IssueRef.type is the Jira ISSUE type, which this pipeline never
// selects — inheriting the slot would promise a field it cannot produce, right next
// to `testType`, which holds the actual answer.
interface CanonicalTest extends Omit<IssueRef, 'type'> {
  readonly testType?: string;
  readonly steps?: readonly TestStep[];
  /** Steps returned as `null` — not visible to this token; filtered out, and said. */
  readonly stepsHidden?: number;
  readonly gherkin?: string;
  readonly unstructured?: string;
}

interface CanonicalTestRun {
  readonly testKey: string;
  readonly status?: string;
  readonly startedOn?: string;
  readonly finishedOn?: string;
}

interface CanonicalTestExecution extends Omit<IssueRef, 'type'> {
  readonly runs: readonly CanonicalTestRun[];
  /** Run count including null-hidden rows — what upstream actually served. */
  readonly runsTotal: number;
  /**
   * Kept in the snapshot shape for stability, but always `false` here: DC serves
   * the whole run list in one response, so there is nothing to truncate.
   */
  readonly runsTruncated: boolean;
  /** Runs returned as `null` — not visible to this token; filtered out, and said. */
  readonly runsHidden: number;
}

// ── Reshaping (pure — pinned by tests) ───────────────────────────────────────

/** Split keys into raven-sized batches. Exported for the spec — the off-by-one lives here. */
export function chunkKeys(keys: readonly string[], size: number): string[][] {
  const batches: string[][] = [];
  for (let index = 0; index < keys.length; index += size) {
    batches.push(keys.slice(index, index + size) as string[]);
  }
  return batches;
}

/**
 * DC test → CanonicalTest. The Jira envelope comes from the v2 search (raven's
 * export carries no summary), and the envelope's `status` stays the JIRA status —
 * raven's own `status` here is the latest-run verdict (TODO/PASS/FAIL), a
 * different fact with a different owner.
 */
export function reshapeTest(raw: RawTest, envelope: Omit<IssueRef, 'type'>): CanonicalTest {
  const testType = raw.type ?? undefined;
  const definition = raw.definition;
  if (definition != null && typeof definition === 'object') {
    const rawSteps = definition.steps ?? [];
    const steps: TestStep[] = [];
    for (const step of rawSteps) {
      if (step === null || step === undefined) continue;
      steps.push({
        action: step.step?.raw ?? '',
        ...(step.data?.raw ? { data: step.data.raw } : {}),
        ...(step.result?.raw ? { result: step.result.raw } : {}),
      });
    }
    const stepsHidden = rawSteps.length - steps.length;
    return {
      ...envelope,
      ...(testType ? { testType } : {}),
      ...(steps.length > 0 ? { steps } : {}),
      ...(stepsHidden > 0 ? { stepsHidden } : {}),
    };
  }
  const body = typeof definition === 'string' && definition !== '' ? definition : undefined;
  // `type` names the flavour: only Cucumber definitions are gherkin; everything
  // else (Generic, or an unknown future type) is honest as unstructured text.
  const isCucumber = typeof testType === 'string' && testType.toLowerCase().includes('cucumber');
  return {
    ...envelope,
    ...(testType ? { testType } : {}),
    ...(body && isCucumber ? { gherkin: body } : {}),
    ...(body && !isCucumber ? { unstructured: body } : {}),
  };
}

export function reshapeRun(raw: RawRun): CanonicalTestRun {
  return {
    testKey: raw.key || '(unknown)',
    ...(raw.status ? { status: raw.status } : {}),
    ...(raw.startedOn ? { startedOn: raw.startedOn } : {}),
    ...(raw.finishedOn ? { finishedOn: raw.finishedOn } : {}),
  };
}

// ── Rendering (pure — pinned by tests) ───────────────────────────────────────

interface WalkSummary {
  readonly jql: string;
  readonly total?: number;
  readonly truncated: boolean;
  readonly stalled: boolean;
  readonly hidden: number;
  /**
   * Issues the JQL matched that raven does not export — they are not Xray
   * entities of this snapshot's kind. Distinct from `hidden` (rows the token
   * cannot see): the remedy is narrowing the JQL, not fixing permissions.
   */
  readonly skipped?: number;
}

interface TestsSummary extends WalkSummary {
  readonly tests: readonly CanonicalTest[];
}

interface ExecutionsSummary extends WalkSummary {
  readonly executions: readonly CanonicalTestExecution[];
}

/**
 * The shared snapshot header: title with the JQL as a proper code span, the count,
 * and one line per KIND of loss — a stalled server, a ceiling, null-hidden rows
 * and non-Xray issues are different problems with different remedies, and one
 * note used to claim them all. `truncatedNote` names the remedy each snapshot
 * type can actually offer.
 */
function summaryHeader(
  title: string,
  noun: string,
  count: number,
  summary: WalkSummary,
  truncatedNote: string,
): string[] {
  const upstream = summary.total === undefined ? 'an unknown upstream total' : `${String(summary.total)} upstream`;
  const lines = [
    `# ${title} — ${codeSpan(flatLine(summary.jql))}`,
    '',
    `- **${noun}**: ${String(count)} of ${upstream}`,
  ];
  if (summary.stalled) {
    lines.push('- **STALLED**: upstream stopped advancing mid-walk — rows are missing and the snapshot is incomplete');
  } else if (summary.truncated) {
    lines.push(`- **TRUNCATED**: ${truncatedNote}`);
  }
  if (summary.hidden > 0) {
    lines.push(`- **HIDDEN**: ${String(summary.hidden)} row(s) returned as null — not visible to this token`);
  }
  if (summary.skipped) {
    lines.push(
      `- **SKIPPED**: ${String(summary.skipped)} issue(s) matched the JQL but are not Xray entities of this kind — narrow the JQL (e.g. add issuetype)`,
    );
  }
  lines.push('');
  return lines;
}

export function renderTestsMarkdown(summary: TestsSummary): string {
  const lines = summaryHeader(
    'Xray tests',
    'Tests',
    summary.tests.length,
    summary,
    'more tests upstream than this snapshot holds — raise maxItems or narrow the JQL',
  );
  for (const test of summary.tests) {
    lines.push(`## ${test.key} — ${flatLine(test.summary ?? '(no summary)')}`);
    lines.push('');
    lines.push(`- **Type**: ${test.testType ?? '—'}`);
    lines.push(`- **Status**: ${test.status ?? '—'}`);
    if (test.stepsHidden) {
      lines.push(
        `- **STEPS HIDDEN**: ${String(test.stepsHidden)} step(s) returned as null — not visible to this token`,
      );
    }
    lines.push('');
    if (test.steps && test.steps.length > 0) {
      lines.push(
        mdTable(
          ['#', 'Action', 'Data', 'Expected result'],
          test.steps.map((step, index) => [String(index + 1), step.action, step.data ?? '', step.result ?? '']),
        ),
      );
      lines.push('');
    }
    if (test.gherkin) {
      lines.push(fencedBlock(test.gherkin, 'gherkin'));
      lines.push('');
    }
    if (test.unstructured) {
      lines.push(fencedBlock(test.unstructured));
      lines.push('');
    }
  }
  return lines.join('\n');
}

export function renderExecutionsMarkdown(summary: ExecutionsSummary): string {
  const lines = summaryHeader(
    'Xray test executions',
    'Executions',
    summary.executions.length,
    summary,
    'more executions upstream than this snapshot holds — raise maxItems or narrow the JQL',
  );
  for (const execution of summary.executions) {
    lines.push(`## ${execution.key} — ${flatLine(execution.summary ?? '(no summary)')}`);
    lines.push('');
    lines.push(`- **Status**: ${execution.status ?? '—'}`);
    lines.push(`- **Runs**: ${String(execution.runs.length)} shown of ${String(execution.runsTotal)} upstream`);
    if (execution.runsTruncated) {
      // Kept for shape stability; on DC this cannot fire (one response, whole list).
      const fetched = execution.runs.length + execution.runsHidden;
      lines.push(
        `- **RUNS TRUNCATED**: ${String(fetched)} of ${String(execution.runsTotal)} run(s) fetched — inspect this execution in Xray`,
      );
    }
    if (execution.runsHidden > 0) {
      lines.push(
        `- **RUNS HIDDEN**: ${String(execution.runsHidden)} run(s) returned as null — not visible to this token`,
      );
    }
    lines.push('');
    if (execution.runs.length > 0) {
      lines.push(
        mdTable(
          ['Test', 'Status', 'Started', 'Finished'],
          execution.runs.map((run) => [run.testKey, run.status ?? '—', run.startedOn ?? '—', run.finishedOn ?? '—']),
        ),
      );
      lines.push('');
    }
  }
  return lines.join('\n');
}

// ── Scope (Jira v2 search) ───────────────────────────────────────────────────

/**
 * JQL scope via Jira's own v2 search. Envelopes (summary, jira status) ride along
 * so raven's summary-less export still yields the shared IssueRef shape.
 */
async function searchScope(http: HttpClient, jql: string, maxItems: number) {
  return walkOffsetPages<RawSearchIssue>(
    (start, limit) =>
      http
        .request<RawSearchPage | undefined>({
          path: '/rest/api/2/search',
          query: { jql, fields: 'summary,status', startAt: start, maxResults: limit },
        })
        .then((page) => ({ total: page?.total, results: page?.issues })),
    { maxItems, pageLimit: PAGE_LIMIT },
  );
}

function scopeEnvelopes(issues: readonly RawSearchIssue[]): Map<string, Omit<IssueRef, 'type'>> {
  const envelopes = new Map<string, Omit<IssueRef, 'type'>>();
  for (const issue of issues) {
    if (!issue.key) continue;
    const status = issue.fields?.status?.name;
    envelopes.set(issue.key, {
      key: issue.key,
      ...(issue.fields?.summary ? { summary: issue.fields.summary } : {}),
      ...(status ? { status } : {}),
    });
  }
  return envelopes;
}

// ── Processors ───────────────────────────────────────────────────────────────

interface ProcessResult {
  readonly itemCount: number;
  readonly truncated: boolean;
  readonly stalled: boolean;
  readonly hidden: number;
}

async function processTests(
  http: HttpClient,
  snapshot: z.infer<typeof TestsSnapshot>,
  snapshotDir: string,
): Promise<ProcessResult> {
  const walk = await searchScope(http, snapshot.jql, snapshot.maxItems);
  const envelopes = scopeEnvelopes(walk.items);
  const batches = chunkKeys([...envelopes.keys()], KEYS_PER_BATCH);
  const exported = await mapWithConcurrency(batches, PIPELINE_CONCURRENCY, async (batch) => {
    const tests = await http.request<readonly (RawTest | null)[] | undefined>({
      path: '/rest/raven/1.0/api/test',
      query: { keys: batch.join(';') },
    });
    return tests ?? [];
  });
  const rawTests = exported.flat().filter((test): test is RawTest => test != null);
  const tests = rawTests.map((raw) =>
    reshapeTest(raw, envelopes.get(raw.key ?? '') ?? { key: raw.key || '(unknown)' }),
  );
  // Issues the JQL matched that raven refused to export are NOT tests — a broad JQL
  // (no issuetype clause) makes this number big, and the header says so.
  const skipped = envelopes.size - rawTests.filter((raw) => raw.key && envelopes.has(raw.key)).length;
  const summary: TestsSummary = {
    jql: snapshot.jql,
    ...(walk.total !== undefined ? { total: walk.total } : {}),
    truncated: walk.truncated,
    stalled: walk.stalled,
    hidden: walk.hidden,
    ...(skipped > 0 ? { skipped } : {}),
    tests,
  };
  await writePipelineOutputs({
    dir: snapshotDir,
    basename: 'tests',
    data: summary,
    markdown: renderTestsMarkdown(summary),
    formats: snapshot.render,
  });
  return { itemCount: tests.length, truncated: walk.truncated, stalled: walk.stalled, hidden: walk.hidden };
}

async function processExecutions(
  http: HttpClient,
  snapshot: z.infer<typeof TestExecutionsSnapshot>,
  snapshotDir: string,
): Promise<ProcessResult> {
  const walk = await searchScope(http, snapshot.jql, snapshot.maxItems);
  const envelopes = scopeEnvelopes(walk.items);
  let skipped = 0;
  const collected = await mapWithConcurrency([...envelopes.values()], PIPELINE_CONCURRENCY, async (envelope) => {
    let runsRaw: readonly (RawRun | null)[] | undefined;
    try {
      runsRaw = await http.request<readonly (RawRun | null)[] | undefined>({
        path: `/rest/raven/1.0/api/testexec/${envelope.key}/test`,
      });
    } catch (error) {
      // A JQL-matched issue that is not a Test Execution 404s here — that is a scope
      // problem to SAY (skipped), not a fatal one; every other failure stays fatal.
      if (error instanceof NotFoundError) {
        skipped += 1;
        return undefined;
      }
      throw error;
    }
    const rows = runsRaw ?? [];
    const runs = rows.filter((row): row is RawRun => row != null).map(reshapeRun);
    const runsHidden = rows.length - runs.length;
    const execution: CanonicalTestExecution = {
      ...envelope,
      runs,
      runsTotal: runs.length + runsHidden,
      // DC serves the whole run list in one response — nothing to truncate.
      runsTruncated: false,
      runsHidden,
    };
    return execution;
  });
  const executions = collected.filter((execution): execution is CanonicalTestExecution => execution !== undefined);
  const hidden = walk.hidden + executions.reduce((sum, execution) => sum + execution.runsHidden, 0);
  const summary: ExecutionsSummary = {
    jql: snapshot.jql,
    ...(walk.total !== undefined ? { total: walk.total } : {}),
    truncated: walk.truncated,
    stalled: walk.stalled,
    hidden,
    ...(skipped > 0 ? { skipped } : {}),
    executions,
  };
  await writePipelineOutputs({
    dir: snapshotDir,
    basename: 'test-executions',
    data: summary,
    markdown: renderExecutionsMarkdown(summary),
    formats: snapshot.render,
  });
  return { itemCount: executions.length, truncated: walk.truncated, stalled: walk.stalled, hidden };
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const run = await startReadRun({ scriptName: SCRIPT_NAME, source: 'xray', schema: ReadConfig, log });
  // Xray as a Jira plugin: the plain jira profile is the whole auth story —
  // no key pair, no token exchange, same host as the jira pipeline.
  const http = createNamedHttpClient(SCRIPT_NAME, loadJiraAuth());

  // Snapshots run CONCURRENTLY through mapWithConcurrency — sonar's rationale
  // applies verbatim (independent snapshots, strictly serial walks inside), and the
  // failure latch stops the siblings after the first fatal error.
  const counts = await mapWithConcurrency(run.config.snapshots, PIPELINE_CONCURRENCY, async (snapshot) => {
    log(`snapshot "${snapshot.name}" (${snapshot.type}, jql: ${snapshot.jql})`);
    const snapshotDir = await run.snapshotDir(snapshot.name);

    const result =
      snapshot.type === 'tests'
        ? await processTests(http, snapshot, snapshotDir)
        : await processExecutions(http, snapshot, snapshotDir);

    warnIfTruncated(log, result.truncated, `snapshot "${snapshot.name}" — the markdown says which ceiling bit`);
    await writeManifest(
      snapshotDir,
      run.manifest(snapshot, {
        type: snapshot.type,
        jql: snapshot.jql,
        itemCount: result.itemCount,
        truncated: result.truncated,
        ...(result.stalled ? { stalled: true } : {}),
        hidden: result.hidden,
      }),
    );
    log(`  wrote ${String(result.itemCount)} item(s) → ${snapshotDir}`);
    return result.itemCount;
  });

  run.finish(counts.reduce((sum, count) => sum + count, 0));
}

await runIfMain(SCRIPT_NAME, import.meta.url, main);
