#!/usr/bin/env node
/**
 * read-sonar — deterministic SonarQube / SonarCloud data pipeline.
 *
 * Reads its whole scope from `read.config.sonar.json` over the shared
 * `http-client.ts`, and reshapes the responses through `sonar-reshape.ts`.
 *
 * A snapshot has one of 4 types (pick one, or combine them in a single config):
 *   - `type: "quality_gate"` → QG status for the project (key compliance use case)
 *   - `type: "issues"`       → every issue matching the filters (paginated)
 *   - `type: "hotspots"`     → every security hotspot (paginated)
 *   - `type: "measures"`     → project metrics in a single fetch
 *
 * Every snapshot writes:
 *   - `<outputDir>/<stamp>/<snapshot>/_summary.json` — the full snapshot as one file
 *   - `<outputDir>/<stamp>/<snapshot>/_summary.md`   — human-readable rendering
 *   - `<outputDir>/<stamp>/<snapshot>/_manifest.json`
 *
 * WARNING: `issues` and `hotspots` can be large — the default limit is 5000.
 *
 * Run: `npm run read -- sonar [path/to/read.config.sonar.json]`
 */
import { z } from 'zod';

import { loadSonarAuth } from '../shared/auth.js';
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
  writeManifest,
  writePipelineOutputs,
} from '../shared/read-runtime.js';
import { createNamedHttpClient, type HttpClient } from '../shared/http-client.js';
import {
  reshapeHotspot,
  reshapeSonarIssue,
  type CanonicalHotspot,
  type CanonicalSonarIssue,
} from '../shared/sonar-reshape.js';

const SCRIPT_NAME = 'read-sonar';

// ── Config ───────────────────────────────────────────────────────────────────

const baseSnapshot = {
  name: snapshotNameSchema,
  projectKey: z.string().min(1),
  render: renderFormatsSchema,
} as const;

const QualityGateSnapshot = z.strictObject({
  ...baseSnapshot,
  type: z.literal('quality_gate'),
  branch: z.string().optional(),
  pullRequest: z.string().optional(),
});
const IssuesSnapshot = z.strictObject({
  ...baseSnapshot,
  type: z.literal('issues'),
  severities: z.array(z.enum(['INFO', 'MINOR', 'MAJOR', 'CRITICAL', 'BLOCKER'])).optional(),
  types: z.array(z.enum(['CODE_SMELL', 'BUG', 'VULNERABILITY'])).optional(),
  branch: z.string().optional(),
  pullRequest: z.string().optional(),
  maxItems: z.number().int().min(1).max(20_000).default(5000),
});
const HotspotsSnapshot = z.strictObject({
  ...baseSnapshot,
  type: z.literal('hotspots'),
  status: z.enum(['TO_REVIEW', 'REVIEWED']).optional(),
  maxItems: z.number().int().min(1).max(20_000).default(5000),
});
const MeasuresSnapshot = z.strictObject({
  ...baseSnapshot,
  type: z.literal('measures'),
  /** List of Sonar metric keys — e.g. ["coverage","duplicated_lines_density","ncloc","bugs"]. */
  metrics: z.array(z.string().min(1)).min(1),
  branch: z.string().optional(),
  pullRequest: z.string().optional(),
});

const SnapshotConfig = z.discriminatedUnion('type', [
  QualityGateSnapshot,
  IssuesSnapshot,
  HotspotsSnapshot,
  MeasuresSnapshot,
]);

export const ReadConfig = z
  .strictObject({
    outputDir: z.string().min(1).default(defaultOutputDir('sonar')),
    snapshots: z.array(SnapshotConfig).min(1),
  })
  .superRefine(assertUniqueSnapshotNames);

// ── Raw shapes ───────────────────────────────────────────────────────────────

interface SonarPaging {
  readonly pageIndex?: number;
  readonly pageSize?: number;
  readonly total?: number;
}
interface RawIssuesResponse {
  readonly issues?: readonly Parameters<typeof reshapeSonarIssue>[0][];
  readonly paging?: SonarPaging;
}
interface RawHotspotsResponse {
  readonly hotspots?: readonly Parameters<typeof reshapeHotspot>[0][];
  readonly paging?: SonarPaging;
}

interface RawQualityGateCondition {
  readonly status?: string;
  readonly metricKey?: string;
  readonly comparator?: string;
  readonly errorThreshold?: string;
  readonly actualValue?: string;
}
interface RawQualityGateResponse {
  readonly projectStatus?: {
    readonly status?: string;
    readonly conditions?: readonly RawQualityGateCondition[];
    readonly periods?: readonly { readonly index?: number; readonly mode?: string; readonly date?: string }[];
  };
}

interface RawMeasure {
  readonly metric?: string;
  readonly value?: string;
  readonly bestValue?: boolean;
}
interface RawMeasuresResponse {
  readonly component?: {
    readonly key?: string;
    readonly name?: string;
    readonly measures?: readonly RawMeasure[];
  };
}

// ── Output shapes ────────────────────────────────────────────────────────────

export interface QualityGateSummary {
  readonly projectKey: string;
  readonly branch?: string;
  readonly pullRequest?: string;
  readonly status: string;
  readonly conditions: readonly {
    readonly metricKey: string;
    readonly status: string;
    readonly comparator?: string;
    readonly errorThreshold?: string;
    readonly actualValue?: string;
  }[];
}
export interface IssuesSummary {
  readonly projectKey: string;
  readonly filters: {
    readonly severities?: readonly string[];
    readonly types?: readonly string[];
    readonly branch?: string;
    readonly pullRequest?: string;
  };
  readonly total: number;
  readonly truncated: boolean;
  readonly issues: readonly CanonicalSonarIssue[];
}
export interface HotspotsSummary {
  readonly projectKey: string;
  readonly filters: { readonly status?: string };
  readonly total: number;
  readonly truncated: boolean;
  readonly hotspots: readonly CanonicalHotspot[];
}
export interface MeasuresSummary {
  readonly projectKey: string;
  readonly branch?: string;
  readonly pullRequest?: string;
  readonly measures: readonly { readonly metric: string; readonly value?: string; readonly bestValue?: boolean }[];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const log = createScriptLogger(SCRIPT_NAME);

// A SIBLING of shared/read-runtime's `walkOffsetPages`, kept separate on purpose:
// page-NUMBER arithmetic (p/ps, constant PS) and Sonar's hard 10 000-result ceiling
// are quirks the shared walker deliberately does not model.
export async function paginateSonar<TOut>(
  http: HttpClient,
  path: string,
  baseQuery: Record<string, string | number | boolean | undefined>,
  itemsKey: 'issues' | 'hotspots',
  reshape: (raw: unknown) => TOut,
  max: number,
): Promise<{ items: readonly TOut[]; total: number; truncated: boolean }> {
  const out: TOut[] = [];
  let page = 1;
  // Constant page size. Shrinking `ps` to fit the remaining budget is wrong for
  // offset pagination: Sonar's offset is `(p - 1) × ps`, so a smaller final page
  // points at a LOWER offset and re-reads rows already collected, while the tail
  // is never fetched at all. Asking for 150 read rows 1–100, then rows 51–100
  // again. Ask for full pages and cut once, at the end.
  const PS = 100;
  // Upstream's hard pagination ceiling — a constant of SonarQube/SonarCloud, not ours.
  const SONAR_RESULT_CEILING = 10_000;
  // `undefined`, not 0: the two mean different things and conflating them cost a silent
  // truncation. A response without `paging.total` left this at 0, so the first full page
  // satisfied `out.length >= lastTotal`, the loop stopped after one request, and the result
  // reported `total: 0` with `truncated: false` — the flag whose whole job is to warn about
  // lost rows went quiet exactly when rows were lost.
  let lastTotal: number | undefined;
  // True when the walk was ended by upstream rather than by the caller's ceiling:
  // an empty page, a short page, or a `total` we have now reached. Without a
  // `paging.total` it is the only evidence that the result is complete, and it is
  // the difference between "you have everything" and "we stopped at your ceiling".
  let exhausted = false;
  while (out.length < max) {
    // Sonar's web API refuses to page past 10 000 results (400 "Can return only the
    // first 10000 results") while the config allows maxItems up to 20 000. Stop AT
    // the ceiling and report truncation — letting the request for page 101 fly threw
    // an UpstreamError that FATALed the run and discarded every row already fetched.
    if ((page - 1) * PS >= SONAR_RESULT_CEILING) break;
    const resp = await http.request<RawIssuesResponse | RawHotspotsResponse>({
      path,
      query: { ...baseQuery, ps: PS, p: page },
    });
    lastTotal = resp.paging?.total ?? lastTotal;
    const items = itemsKey === 'issues' ? (resp as RawIssuesResponse).issues : (resp as RawHotspotsResponse).hotspots;
    if (!items || items.length === 0) {
      exhausted = true;
      break;
    }
    for (const it of items) out.push(reshape(it));
    if (items.length < PS) {
      exhausted = true;
      break;
    }
    if (lastTotal !== undefined && out.length >= lastTotal) {
      exhausted = true;
      break;
    }
    page += 1;
  }
  const kept = out.slice(0, max);
  return {
    items: kept,
    total: lastTotal ?? out.length,
    // With a known total the answer is arithmetic: did we keep fewer rows than exist?
    // Without one, we are truncated unless upstream itself ended the walk and nothing
    // was cut off the last over-fetched page.
    truncated: lastTotal === undefined ? !exhausted || kept.length < out.length : kept.length < lastTotal,
  };
}

// ── Renderers ────────────────────────────────────────────────────────────────

export function renderQualityGateMarkdown(qg: QualityGateSummary): string {
  const lines: string[] = [];
  const target = qg.branch ? ` (branch \`${qg.branch}\`)` : qg.pullRequest ? ` (PR \`${qg.pullRequest}\`)` : '';
  lines.push(`# Quality Gate — ${qg.projectKey}${target}`);
  lines.push('');
  lines.push(`- **Status**: \`${qg.status}\``);
  lines.push('');

  if (qg.conditions.length > 0) {
    lines.push('## Conditions');
    lines.push('');
    lines.push(
      mdTable(
        ['Metric', 'Status', 'Actual', 'Threshold', 'Comparator'],
        qg.conditions.map((c) => [
          `\`${c.metricKey}\``,
          c.status,
          c.actualValue ?? '—',
          c.errorThreshold ?? '—',
          c.comparator ?? '—',
        ]),
      ),
    );
    lines.push('');
  }

  return lines.join('\n');
}

export function renderIssuesMarkdown(summary: IssuesSummary): string {
  const lines: string[] = [];
  lines.push(`# Issues — ${summary.projectKey}`);
  lines.push('');
  lines.push(`- **Total upstream**: ${summary.total}`);
  lines.push(`- **Extracted**: ${summary.issues.length}`);
  if (summary.truncated) lines.push(`- **Truncated**: YES (raise \`maxItems\` in the config)`);
  const filters: string[] = [];
  // The guard mirrors `processIssues`: an empty array is not sent upstream, so the document
  // must not claim it either.
  if (summary.filters.severities?.length) filters.push(`severities=${summary.filters.severities.join(',')}`);
  if (summary.filters.types?.length) filters.push(`types=${summary.filters.types.join(',')}`);
  if (summary.filters.branch) filters.push(`branch=${summary.filters.branch}`);
  if (summary.filters.pullRequest) filters.push(`pr=${summary.filters.pullRequest}`);
  if (filters.length > 0) lines.push(`- **Filters**: ${filters.join(' · ')}`);
  lines.push('');

  if (summary.issues.length === 0) return lines.join('\n');

  lines.push('## Issues');
  lines.push('');
  // mdTable escapes every cell — a rule message or component path carrying `|` used
  // to reshape the whole table, the exact bug figma patched twice.
  lines.push(
    mdTable(
      ['Key', 'Severity', 'Type', 'Status', 'Rule', 'Component', 'Line'],
      summary.issues.map((i) => [
        `\`${i.key}\``,
        i.severity,
        i.type,
        i.status,
        `\`${i.rule}\``,
        i.component ?? '—',
        i.line === undefined ? '—' : String(i.line),
      ]),
    ),
  );
  lines.push('');
  return lines.join('\n');
}

export function renderHotspotsMarkdown(summary: HotspotsSummary): string {
  const lines: string[] = [];
  lines.push(`# Security Hotspots — ${summary.projectKey}`);
  lines.push('');
  lines.push(`- **Total upstream**: ${summary.total}`);
  lines.push(`- **Extracted**: ${summary.hotspots.length}`);
  if (summary.truncated) lines.push(`- **Truncated**: YES`);
  if (summary.filters.status) lines.push(`- **Status filter**: ${summary.filters.status}`);
  lines.push('');

  if (summary.hotspots.length === 0) return lines.join('\n');

  lines.push('## Hotspots');
  lines.push('');
  lines.push(
    mdTable(
      ['Key', 'Status', 'Probability', 'Category', 'Component', 'Line'],
      summary.hotspots.map((h) => [
        `\`${h.key}\``,
        h.status,
        h.vulnerabilityProbability ?? '—',
        h.securityCategory ?? '—',
        h.component ?? '—',
        h.line === undefined ? '—' : String(h.line),
      ]),
    ),
  );
  lines.push('');
  return lines.join('\n');
}

export function renderMeasuresMarkdown(summary: MeasuresSummary): string {
  const lines: string[] = [];
  const target = summary.branch
    ? ` (branch \`${summary.branch}\`)`
    : summary.pullRequest
      ? ` (PR \`${summary.pullRequest}\`)`
      : '';
  lines.push(`# Measures — ${summary.projectKey}${target}`);
  lines.push('');
  lines.push(
    mdTable(
      ['Metric', 'Value', 'Best?'],
      summary.measures.map((m) => [`\`${m.metric}\``, m.value ?? '—', m.bestValue === true ? '✓' : '']),
    ),
  );
  lines.push('');
  return lines.join('\n');
}

// ── Output writers ───────────────────────────────────────────────────────────

async function writeSummary(
  baseDir: string,
  summary: unknown,
  markdown: string,
  formats: readonly ('json' | 'markdown')[],
): Promise<void> {
  await writePipelineOutputs({ dir: baseDir, basename: '_summary', data: summary, markdown, formats });
}

// ── Per-type processors ──────────────────────────────────────────────────────

async function processQualityGate(
  http: HttpClient,
  snapshot: z.infer<typeof QualityGateSnapshot>,
  snapshotDir: string,
): Promise<{ itemCount: number }> {
  const resp = await http.request<RawQualityGateResponse>({
    path: '/api/qualitygates/project_status',
    query: {
      projectKey: snapshot.projectKey,
      ...(snapshot.branch ? { branch: snapshot.branch } : {}),
      ...(snapshot.pullRequest ? { pullRequest: snapshot.pullRequest } : {}),
    },
  });
  const summary: QualityGateSummary = {
    projectKey: snapshot.projectKey,
    ...(snapshot.branch ? { branch: snapshot.branch } : {}),
    ...(snapshot.pullRequest ? { pullRequest: snapshot.pullRequest } : {}),
    status: resp.projectStatus?.status ?? 'UNKNOWN',
    conditions: (resp.projectStatus?.conditions ?? []).map((c) => ({
      metricKey: c.metricKey ?? '',
      status: c.status ?? 'UNKNOWN',
      ...(c.comparator ? { comparator: c.comparator } : {}),
      ...(c.errorThreshold ? { errorThreshold: c.errorThreshold } : {}),
      ...(c.actualValue ? { actualValue: c.actualValue } : {}),
    })),
  };
  await writeSummary(snapshotDir, summary, renderQualityGateMarkdown(summary), snapshot.render);
  return { itemCount: 1 };
}

async function processIssues(
  http: HttpClient,
  snapshot: z.infer<typeof IssuesSnapshot>,
  snapshotDir: string,
): Promise<{ itemCount: number }> {
  const baseQuery = {
    // `components` replaced the deprecated `componentKeys` in SonarQube 10.2.
    components: snapshot.projectKey,
    ...(snapshot.severities && snapshot.severities.length > 0 ? { severities: snapshot.severities.join(',') } : {}),
    ...(snapshot.types && snapshot.types.length > 0 ? { types: snapshot.types.join(',') } : {}),
    ...(snapshot.branch ? { branch: snapshot.branch } : {}),
    ...(snapshot.pullRequest ? { pullRequest: snapshot.pullRequest } : {}),
    s: 'CREATION_DATE',
    asc: 'true',
  };
  const result = await paginateSonar<CanonicalSonarIssue>(
    http,
    '/api/issues/search',
    baseQuery,
    'issues',
    (r) => reshapeSonarIssue(r as Parameters<typeof reshapeSonarIssue>[0]),
    snapshot.maxItems,
  );
  const summary: IssuesSummary = {
    projectKey: snapshot.projectKey,
    filters: {
      // Mirror the query built above: an EMPTY array filtered nothing upstream,
      // so recording it here would claim a narrowing that never happened.
      ...(snapshot.severities?.length ? { severities: snapshot.severities } : {}),
      ...(snapshot.types?.length ? { types: snapshot.types } : {}),
      ...(snapshot.branch ? { branch: snapshot.branch } : {}),
      ...(snapshot.pullRequest ? { pullRequest: snapshot.pullRequest } : {}),
    },
    total: result.total,
    truncated: result.truncated,
    issues: result.items,
  };
  await writeSummary(snapshotDir, summary, renderIssuesMarkdown(summary), snapshot.render);
  return { itemCount: result.items.length };
}

async function processHotspots(
  http: HttpClient,
  snapshot: z.infer<typeof HotspotsSnapshot>,
  snapshotDir: string,
): Promise<{ itemCount: number }> {
  const baseQuery = {
    projectKey: snapshot.projectKey,
    ...(snapshot.status ? { status: snapshot.status } : {}),
  };
  const result = await paginateSonar<CanonicalHotspot>(
    http,
    '/api/hotspots/search',
    baseQuery,
    'hotspots',
    (r) => reshapeHotspot(r as Parameters<typeof reshapeHotspot>[0]),
    snapshot.maxItems,
  );
  const summary: HotspotsSummary = {
    projectKey: snapshot.projectKey,
    filters: snapshot.status ? { status: snapshot.status } : {},
    total: result.total,
    truncated: result.truncated,
    hotspots: result.items,
  };
  await writeSummary(snapshotDir, summary, renderHotspotsMarkdown(summary), snapshot.render);
  return { itemCount: result.items.length };
}

async function processMeasures(
  http: HttpClient,
  snapshot: z.infer<typeof MeasuresSnapshot>,
  snapshotDir: string,
): Promise<{ itemCount: number }> {
  const resp = await http.request<RawMeasuresResponse>({
    path: '/api/measures/component',
    query: {
      component: snapshot.projectKey,
      metricKeys: snapshot.metrics.join(','),
      ...(snapshot.branch ? { branch: snapshot.branch } : {}),
      ...(snapshot.pullRequest ? { pullRequest: snapshot.pullRequest } : {}),
    },
  });
  const summary: MeasuresSummary = {
    projectKey: snapshot.projectKey,
    ...(snapshot.branch ? { branch: snapshot.branch } : {}),
    ...(snapshot.pullRequest ? { pullRequest: snapshot.pullRequest } : {}),
    measures: (resp.component?.measures ?? []).map((m) => ({
      metric: m.metric ?? '',
      ...(m.value !== undefined ? { value: m.value } : {}),
      ...(m.bestValue !== undefined ? { bestValue: m.bestValue } : {}),
    })),
  };
  await writeSummary(snapshotDir, summary, renderMeasuresMarkdown(summary), snapshot.render);
  return { itemCount: summary.measures.length };
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const run = await startReadRun({ scriptName: SCRIPT_NAME, source: 'sonar', schema: ReadConfig, log });
  const http = createNamedHttpClient(SCRIPT_NAME, loadSonarAuth());

  // Snapshots run CONCURRENTLY: they are fully independent (separate endpoints,
  // separate directories) and — unlike jira or confluence — a Sonar snapshot has
  // no internal parallelism at all, its offset walk being strictly sequential. So
  // cross-snapshot overlap is the only one available, and the typical config
  // (quality_gate + issues + hotspots + measures) is exactly the shape that
  // benefits. Log lines carry the snapshot name, so interleaving stays readable.
  // mapWithConcurrency rather than Promise.all for its failure LATCH: when one
  // snapshot dies, unstarted siblings never launch — Promise.all rejected fast
  // while zombie walks kept hammering the API behind the FATAL exit.
  const counts = await mapWithConcurrency(run.config.snapshots, PIPELINE_CONCURRENCY, async (snapshot) => {
    log(`snapshot "${snapshot.name}" (${snapshot.type}, project ${snapshot.projectKey})`);
    const snapshotDir = await run.snapshotDir(snapshot.name);

    let result: { itemCount: number };
    if (snapshot.type === 'quality_gate') result = await processQualityGate(http, snapshot, snapshotDir);
    else if (snapshot.type === 'issues') result = await processIssues(http, snapshot, snapshotDir);
    else if (snapshot.type === 'hotspots') result = await processHotspots(http, snapshot, snapshotDir);
    else result = await processMeasures(http, snapshot, snapshotDir);

    await writeManifest(
      snapshotDir,
      run.manifest(snapshot, {
        type: snapshot.type,
        projectKey: snapshot.projectKey,
        itemCount: result.itemCount,
      }),
    );
    log(`  wrote ${result.itemCount} item(s) → ${snapshotDir}`);
    return result.itemCount;
  });

  run.finish(counts.reduce((sum, count) => sum + count, 0));
}

await runIfMain(SCRIPT_NAME, import.meta.url, main);
