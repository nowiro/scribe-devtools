/**
 * Tests for the `extract-sonar` pipeline.
 *
 * The module exports the config schema, the four Markdown renderers and `paginateSonar`. The
 * per-type processors stay module-private. What is covered here is the part that decides whether
 * a snapshot is worth reading — and whether it is complete:
 *
 *  1. **The config schema** — a Sonar snapshot is four different shapes behind one `type` field. A
 *     wrong `type`, an `okf` render format this pipeline cannot emit, or `measures` without metric
 *     keys has to die at parse time; learning it after the first paginated fetch means a network
 *     round already paid for a config that was never valid.
 *  2. **The difference between "absent" and "zero"** — every renderer writes `—` for a missing
 *     field. `coverage 0` and `line 0` are real measurements, and an `??` quietly turned into a
 *     `||` would report them as no-data in a compliance document. That is the class of bug these
 *     tests exist for.
 *  3. **The empty and truncated cases** — a snapshot with nothing in it must not emit a table
 *     header with no rows underneath, and a truncated one must say so *and* name the knob
 *     (`maxItems`), because that warning is the only place a reader learns the file is not the
 *     whole story.
 *
 * The assertions stay line-level on purpose. A whole-document snapshot goes red on every editorial
 * change to a heading and stops meaning anything within one release.
 */
import { describe, expect, it } from 'vitest';

import {
  ReadConfig,
  paginateSonar,
  renderHotspotsMarkdown,
  renderIssuesMarkdown,
  renderMeasuresMarkdown,
  renderQualityGateMarkdown,
  type HotspotsSummary,
  type IssuesSummary,
  type MeasuresSummary,
  type QualityGateSummary,
} from './read-sonar.js';

/** Rows of every rendered table open with a backticked key — this pulls that key back out. */
function keyColumn(markdown: string): readonly string[] {
  return markdown
    .split('\n')
    .filter((line) => line.startsWith('| `'))
    .map((line) => line.match(/^\| `([^`]+)`/)?.[1] ?? '');
}

// ── Config schema ────────────────────────────────────────────────────────────

describe('ReadConfig (Sonar)', () => {
  it('rejects an unknown key rather than dropping it in silence', () => {
    expect(() => ReadConfig.parse({ snapshots: [{ name: 'i', type: 'issues', projectKey: 'p', maxItem: 5 }] })).toThrow(
      /maxItem/,
    );
    expect(() =>
      ReadConfig.parse({ outputDirs: './x', snapshots: [{ name: 'g', type: 'quality_gate', projectKey: 'p' }] }),
    ).toThrow(/outputDirs/);
  });

  it('fills in the defaults a snapshot does not have to spell out', () => {
    const parsed = ReadConfig.parse({
      snapshots: [{ name: 'gate', type: 'quality_gate', projectKey: 'org:app' }],
    });
    expect(parsed.outputDir).toBe('./.scribe/sonar');
    expect(parsed.snapshots[0]?.render).toEqual(['json', 'markdown']);
  });

  it('caps the two paginated types at 5000 items unless the config says otherwise', () => {
    const issues = ReadConfig.parse({ snapshots: [{ name: 'i', type: 'issues', projectKey: 'p' }] }).snapshots[0];
    if (issues?.type !== 'issues') throw new Error('expected an issues snapshot');
    expect(issues.maxItems).toBe(5000);

    const hotspots = ReadConfig.parse({ snapshots: [{ name: 'h', type: 'hotspots', projectKey: 'p' }] }).snapshots[0];
    if (hotspots?.type !== 'hotspots') throw new Error('expected a hotspots snapshot');
    expect(hotspots.maxItems).toBe(5000);
  });

  it('rejects an empty snapshot list — a pipeline without a scope has nothing to fetch', () => {
    expect(() => ReadConfig.parse({ snapshots: [] })).toThrow();
  });

  it('rejects a snapshot name that will not survive as a directory name', () => {
    const named = (name: string) => () => ReadConfig.parse({ snapshots: [{ name, type: 'issues', projectKey: 'p' }] });
    expect(named('Quality Gate')).toThrow();
    expect(named('QualityGate')).toThrow();
    expect(named('-leading-dash')).toThrow();
    expect(named('a'.repeat(65))).toThrow();
    expect(named('quality-gate-1')).not.toThrow();
  });

  it('rejects an empty projectKey — every one of the four types builds its query out of it', () => {
    expect(() => ReadConfig.parse({ snapshots: [{ name: 'x', type: 'issues', projectKey: '' }] })).toThrow();
  });

  it('rejects a type it has no processor for, and a snapshot with no type at all', () => {
    expect(() => ReadConfig.parse({ snapshots: [{ name: 'x', type: 'duplications', projectKey: 'p' }] })).toThrow();
    expect(() => ReadConfig.parse({ snapshots: [{ name: 'x', projectKey: 'p' }] })).toThrow();
  });

  it('does not know the `okf` render format — sonar has no OKF writer, so the config must fail loudly', () => {
    expect(() =>
      ReadConfig.parse({ snapshots: [{ name: 'x', type: 'issues', projectKey: 'p', render: ['okf'] }] }),
    ).toThrow();
    expect(() =>
      ReadConfig.parse({ snapshots: [{ name: 'x', type: 'issues', projectKey: 'p', render: [] }] }),
    ).toThrow();
  });

  it('holds the maxItems bounds at the edges, not somewhere near them', () => {
    const withMax = (maxItems: number) => () =>
      ReadConfig.parse({ snapshots: [{ name: 'x', type: 'issues', projectKey: 'p', maxItems }] });
    expect(withMax(0)).toThrow();
    expect(withMax(20_001)).toThrow();
    expect(withMax(1500.5)).toThrow();
    expect(withMax(1)).not.toThrow();
    expect(withMax(20_000)).not.toThrow();
  });

  it('rejects MQR severities and hotspot-ish types in the issues filters', () => {
    // BLOCKER is shared, but HIGH/MEDIUM/LOW are Clean Code severities and belong to `impacts`,
    // not to the `severities` query parameter — Sonar answers 400 for them.
    expect(() =>
      ReadConfig.parse({ snapshots: [{ name: 'x', type: 'issues', projectKey: 'p', severities: ['HIGH'] }] }),
    ).toThrow();
    // SECURITY_HOTSPOT is a separate endpoint (and a separate snapshot type), not an issue type.
    expect(() =>
      ReadConfig.parse({ snapshots: [{ name: 'x', type: 'issues', projectKey: 'p', types: ['SECURITY_HOTSPOT'] }] }),
    ).toThrow();
    expect(() =>
      ReadConfig.parse({
        snapshots: [{ name: 'x', type: 'issues', projectKey: 'p', severities: ['BLOCKER'], types: ['BUG'] }],
      }),
    ).not.toThrow();
  });

  it('knows only the two hotspot review states the search endpoint accepts', () => {
    const withStatus = (status: string) => () =>
      ReadConfig.parse({ snapshots: [{ name: 'x', type: 'hotspots', projectKey: 'p', status }] });
    expect(withStatus('TO_REVIEW')).not.toThrow();
    expect(withStatus('REVIEWED')).not.toThrow();
    // IN_REVIEW was dropped from Sonar years ago; accepting it would send an unsupported filter.
    expect(withStatus('IN_REVIEW')).toThrow();
  });

  it('requires measures to name at least one non-empty metric key', () => {
    expect(() => ReadConfig.parse({ snapshots: [{ name: 'x', type: 'measures', projectKey: 'p' }] })).toThrow();
    expect(() =>
      ReadConfig.parse({ snapshots: [{ name: 'x', type: 'measures', projectKey: 'p', metrics: [] }] }),
    ).toThrow();
    expect(() =>
      ReadConfig.parse({ snapshots: [{ name: 'x', type: 'measures', projectKey: 'p', metrics: [''] }] }),
    ).toThrow();
  });

  it('discriminates on `type` instead of falling through to a permissive branch', () => {
    // The very same body is valid as `issues` and invalid as `measures`: proof that the union
    // picks a branch by `type` rather than accepting whatever any branch would accept.
    const body = { name: 'x', projectKey: 'p', branch: 'main' };
    expect(() => ReadConfig.parse({ snapshots: [{ ...body, type: 'issues' }] })).not.toThrow();
    expect(() => ReadConfig.parse({ snapshots: [{ ...body, type: 'measures' }] })).toThrow();
  });
});

// ── Quality gate renderer ────────────────────────────────────────────────────

describe('renderQualityGateMarkdown', () => {
  const gate: QualityGateSummary = {
    projectKey: 'org:app',
    status: 'ERROR',
    conditions: [
      { metricKey: 'new_coverage', status: 'ERROR', comparator: 'LT', errorThreshold: '80', actualValue: '0' },
      { metricKey: 'new_bugs', status: 'OK' },
    ],
  };

  it('opens with the project and states the gate status', () => {
    const md = renderQualityGateMarkdown(gate);
    expect(md.split('\n')[0]).toBe('# Quality Gate — org:app');
    expect(md).toContain('- **Status**: `ERROR`');
  });

  it('names the branch in the header, and prefers it over a pull request when both are set', () => {
    const md = renderQualityGateMarkdown({ ...gate, branch: 'main', pullRequest: '42' });
    expect(md.split('\n')[0]).toBe('# Quality Gate — org:app (branch `main`)');
    expect(md).not.toContain('PR `42`');
  });

  it('falls back to the pull request when there is no branch', () => {
    const md = renderQualityGateMarkdown({ ...gate, pullRequest: '42' });
    expect(md.split('\n')[0]).toBe('# Quality Gate — org:app (PR `42`)');
  });

  it('drops the whole Conditions section when the gate returned none', () => {
    const md = renderQualityGateMarkdown({ ...gate, status: 'OK', conditions: [] });
    expect(md).not.toContain('## Conditions');
    expect(md).not.toContain('| Metric |');
    expect(md).toContain('- **Status**: `OK`');
  });

  it('renders an actual value of 0 as a measurement and a missing one as an em dash', () => {
    const md = renderQualityGateMarkdown(gate);
    // `coverage: 0` is a result, not a gap — a `||` here would hide a failing gate behind "no data".
    expect(md).toContain('| `new_coverage` | ERROR | 0 | 80 | LT |');
    expect(md).toContain('| `new_bugs` | OK | — | — | — |');
    expect(md).not.toContain('undefined');
  });

  it('keeps the conditions in the order the gate returned them, without sorting', () => {
    // Alphabetically `new_bugs` would come first; the upstream order is the contract.
    expect(keyColumn(renderQualityGateMarkdown(gate))).toEqual(['new_coverage', 'new_bugs']);
  });
});

// ── Issues renderer ──────────────────────────────────────────────────────────

describe('renderIssuesMarkdown', () => {
  const base: IssuesSummary = {
    projectKey: 'org:app',
    filters: {},
    total: 250,
    truncated: false,
    issues: [
      {
        key: 'AX-1',
        rule: 'java:S100',
        severity: 'MAJOR',
        type: 'BUG',
        status: 'OPEN',
        component: 'src/A.java',
        line: 0,
      },
      { key: 'AX-2', rule: 'java:S101', severity: 'MINOR', type: 'CODE_SMELL', status: 'CONFIRMED' },
    ],
  };

  it('reports what was extracted separately from what exists upstream', () => {
    const md = renderIssuesMarkdown(base);
    expect(md).toContain('- **Total upstream**: 250');
    expect(md).toContain('- **Extracted**: 2');
  });

  it('warns about truncation and names the knob that fixes it', () => {
    const md = renderIssuesMarkdown({ ...base, truncated: true });
    expect(md).toContain('**Truncated**');
    // Without the knob the warning tells a reader something is wrong and nothing about the remedy.
    expect(md).toContain('maxItems');
  });

  it('trusts the truncated flag instead of re-deriving it from the two counters', () => {
    // 2 of 250 extracted, yet the flag says otherwise — the renderer must not second-guess it,
    // because the pagination is the only place that knows whether the walk really ended early.
    expect(renderIssuesMarkdown(base)).not.toContain('**Truncated**');
  });

  it('joins the filters in a fixed order and shortens pullRequest to `pr`', () => {
    const md = renderIssuesMarkdown({
      ...base,
      filters: { severities: ['BLOCKER', 'CRITICAL'], types: ['BUG'], branch: 'main', pullRequest: '42' },
    });
    expect(md).toContain('- **Filters**: severities=BLOCKER,CRITICAL · types=BUG · branch=main · pr=42');
  });

  it('omits the Filters line entirely when nothing was filtered', () => {
    expect(renderIssuesMarkdown(base)).not.toContain('**Filters**');
  });

  it('stops after the counters when there are no issues, rather than printing an empty table', () => {
    const md = renderIssuesMarkdown({ ...base, total: 0, issues: [] });
    expect(md).not.toContain('## Issues');
    expect(md).not.toContain('| Key |');
    expect(md).toContain('- **Extracted**: 0');
  });

  it('renders line 0 as a line number and a missing line as an em dash', () => {
    const md = renderIssuesMarkdown(base);
    expect(md).toContain('| `AX-1` | MAJOR | BUG | OPEN | `java:S100` | src/A.java | 0 |');
    expect(md).toContain('| `AX-2` | MINOR | CODE_SMELL | CONFIRMED | `java:S101` | — | — |');
    expect(md).not.toContain('undefined');
  });

  // Regression: the renderer once guarded this line with a bare
  // `if (summary.filters.severities)`, so a config with `"severities": []` produced
  // a document claiming a severity filter nobody applied — a dangling `severities=`.
  it('does not claim a severity filter for an empty severities array', () => {
    const md = renderIssuesMarkdown({ ...base, filters: { severities: [] } });
    expect(md).not.toContain('**Filters**');
  });
});

// ── Hotspots renderer ────────────────────────────────────────────────────────

describe('renderHotspotsMarkdown', () => {
  const base: HotspotsSummary = {
    projectKey: 'org:app',
    filters: {},
    total: 3,
    truncated: false,
    hotspots: [
      {
        key: 'HS-1',
        status: 'TO_REVIEW',
        vulnerabilityProbability: 'HIGH',
        securityCategory: 'sql-injection',
        component: 'src/Db.java',
        line: 0,
      },
      { key: 'HS-2', status: 'REVIEWED' },
    ],
  };

  it('stops after the counters when there are no hotspots', () => {
    const md = renderHotspotsMarkdown({ ...base, total: 0, hotspots: [] });
    expect(md).not.toContain('## Hotspots');
    expect(md).not.toContain('| Key |');
    expect(md).toContain('- **Extracted**: 0');
  });

  it('names the status filter only when the snapshot actually set one', () => {
    expect(renderHotspotsMarkdown(base)).not.toContain('**Status filter**');
    expect(renderHotspotsMarkdown({ ...base, filters: { status: 'TO_REVIEW' } })).toContain(
      '- **Status filter**: TO_REVIEW',
    );
  });

  it('fills every missing optional column with an em dash, never with "undefined"', () => {
    const md = renderHotspotsMarkdown(base);
    expect(md).toContain('| `HS-1` | TO_REVIEW | HIGH | sql-injection | src/Db.java | 0 |');
    expect(md).toContain('| `HS-2` | REVIEWED | — | — | — | — |');
    expect(md).not.toContain('undefined');
  });

  it('flags truncation for hotspots as well — the same silent-data-loss trap as issues', () => {
    expect(renderHotspotsMarkdown(base)).not.toContain('**Truncated**');
    expect(renderHotspotsMarkdown({ ...base, truncated: true })).toContain('**Truncated**');
  });
});

// ── Measures renderer ────────────────────────────────────────────────────────

describe('renderMeasuresMarkdown', () => {
  const base: MeasuresSummary = {
    projectKey: 'org:app',
    measures: [
      { metric: 'ncloc', value: '12000' },
      { metric: 'coverage', value: '0', bestValue: false },
      { metric: 'bugs', value: '0', bestValue: true },
      { metric: 'duplicated_lines_density' },
    ],
  };

  it('names the branch in the header and prefers it over a pull request', () => {
    expect(renderMeasuresMarkdown({ ...base, branch: 'main', pullRequest: '42' }).split('\n')[0]).toBe(
      '# Measures — org:app (branch `main`)',
    );
    expect(renderMeasuresMarkdown({ ...base, pullRequest: '42' }).split('\n')[0]).toBe(
      '# Measures — org:app (PR `42`)',
    );
  });

  it('renders a measured 0 as a value, and only a truly absent one as an em dash', () => {
    const md = renderMeasuresMarkdown(base);
    // The whole point of a measures snapshot: `coverage 0` must not read as "not measured".
    expect(md).toContain('| `coverage` | 0 |');
    expect(md).toContain('| `duplicated_lines_density` | — |  |');
    expect(md).not.toContain('undefined');
  });

  it('ticks the best-value column only for an explicit true', () => {
    const md = renderMeasuresMarkdown(base);
    expect(md).toContain('| `bugs` | 0 | ✓ |');
    expect(md).toContain('| `coverage` | 0 |  |');
    expect(md.match(/✓/g)).toHaveLength(1);
  });

  it('keeps the table header but writes no rows when the component reported no measures', () => {
    // Unlike issues and hotspots this renderer does not bail out early; the empty table is the
    // documented shape, and a reader has to see that the fetch happened and came back empty.
    const md = renderMeasuresMarkdown({ ...base, measures: [] });
    expect(md).toContain('| Metric | Value | Best? |');
    expect(keyColumn(md)).toEqual([]);
  });

  it('follows the upstream order of the metrics instead of sorting them', () => {
    expect(keyColumn(renderMeasuresMarkdown(base))).toEqual(['ncloc', 'coverage', 'bugs', 'duplicated_lines_density']);
  });
});

// ── Pagination ───────────────────────────────────────────────────────────────
//
// This block exists because of a defect the renderer tests could not see. `paginateSonar`
// tracked the upstream total in a counter that started at 0, so a response WITHOUT
// `paging.total` looked identical to "there are zero rows upstream": the loop stopped after one
// page and reported `truncated: false`. The flag whose entire purpose is to warn about dropped
// rows went silent exactly when rows were dropped.

describe('paginateSonar', () => {
  /** A client that serves the prepared pages in order and counts how many times it was asked. */
  function pager(pages: readonly unknown[]) {
    let i = 0;
    const calls: unknown[] = [];
    const http = {
      async request({ query }: { query: unknown }) {
        calls.push(query);
        const page = pages[Math.min(i, pages.length - 1)];
        i += 1;
        return page as never;
      },
    } as unknown as Parameters<typeof paginateSonar>[0];
    return { http, calls };
  }

  const rows = (n: number, from = 0) => Array.from({ length: n }, (_, k) => ({ key: `K-${from + k}` }));
  const id = (raw: unknown) => raw as { key: string };

  it('walks pages until the upstream total is reached', async () => {
    const { http, calls } = pager([
      { issues: rows(100), paging: { total: 150 } },
      { issues: rows(50, 100), paging: { total: 150 } },
    ]);
    const out = await paginateSonar(http, '/api/issues/search', {}, 'issues', id, 1000);
    expect(out.items).toHaveLength(150);
    expect(out.total).toBe(150);
    expect(out.truncated).toBe(false);
    expect(calls).toHaveLength(2);
  });

  it('stops at the caller ceiling and says so', async () => {
    const { http } = pager([{ issues: rows(100), paging: { total: 500 } }]);
    const out = await paginateSonar(http, '/api/issues/search', {}, 'issues', id, 100);
    expect(out.items).toHaveLength(100);
    expect(out.truncated).toBe(true);
  });

  it('a response without `paging.total` does not end the walk after one page', async () => {
    const { http, calls } = pager([{ issues: rows(100) }, { issues: rows(100, 100) }, { issues: rows(7, 200) }]);
    const out = await paginateSonar(http, '/api/issues/search', {}, 'issues', id, 1000);
    expect(calls.length).toBeGreaterThan(1);
    expect(out.items).toHaveLength(207);
  });

  it('with no total it reports what it actually has, never zero', async () => {
    const { http } = pager([{ issues: rows(30) }]);
    const out = await paginateSonar(http, '/api/issues/search', {}, 'issues', id, 1000);
    expect(out.total).toBe(30);
    expect(out.truncated).toBe(false);
  });

  it('with no total, hitting the ceiling still raises the truncation flag', async () => {
    const { http } = pager([{ issues: rows(100) }]);
    const out = await paginateSonar(http, '/api/issues/search', {}, 'issues', id, 100);
    expect(out.items).toHaveLength(100);
    expect(out.truncated).toBe(true);
  });

  it('an empty first page is not an error, just an empty result', async () => {
    const { http } = pager([{ issues: [], paging: { total: 0 } }]);
    const out = await paginateSonar(http, '/api/issues/search', {}, 'issues', id, 1000);
    expect(out.items).toEqual([]);
    expect(out.truncated).toBe(false);
  });
  // The page size must NOT shrink to fit the remaining budget. Sonar's offset is
  // `(p - 1) × ps`, so a smaller final page points at a LOWER offset: asking for
  // 150 read rows 1–100, then rows 51–100 a second time, and rows 101–150 never.
  it('keeps the page size constant across pages', async () => {
    const { http, calls } = pager([
      { issues: rows(100), paging: { total: 150 } },
      { issues: rows(50, 100), paging: { total: 150 } },
    ]);
    await paginateSonar(http, '/api/issues/search', {}, 'issues', id, 150);
    expect(calls.map((c) => (c as { ps: number }).ps)).toEqual([100, 100]);
    expect(calls.map((c) => (c as { p: number }).p)).toEqual([1, 2]);
  });

  it('returns distinct rows when the ceiling is not a multiple of the page size', async () => {
    const { http } = pager([
      { issues: rows(100), paging: { total: 150 } },
      { issues: rows(50, 100), paging: { total: 150 } },
    ]);
    const out = await paginateSonar(http, '/api/issues/search', {}, 'issues', id, 150);
    const keys = out.items.map((i) => i.key);
    expect(keys).toHaveLength(150);
    expect(new Set(keys).size).toBe(150);
    expect(keys.at(-1)).toBe('K-149');
  });

  it('cuts an over-fetched last page down to the ceiling and flags it', async () => {
    const { http } = pager([{ issues: rows(100), paging: { total: 100 } }]);
    const out = await paginateSonar(http, '/api/issues/search', {}, 'issues', id, 40);
    expect(out.items).toHaveLength(40);
    expect(out.truncated).toBe(true);
  });
});
