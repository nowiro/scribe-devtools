import { describe, expect, it } from 'vitest';

import {
  ReadConfig,
  chunkKeys,
  renderExecutionsMarkdown,
  renderTestsMarkdown,
  reshapeRun,
  reshapeTest,
} from './read-xray.js';

describe('ReadConfig', () => {
  it('accepts both snapshot types and applies defaults', () => {
    const parsed = ReadConfig.parse({
      snapshots: [
        { name: 'tests', type: 'tests', jql: 'project = PROJ' },
        { name: 'runs', type: 'test_executions', jql: 'project = PROJ' },
      ],
    });
    expect(parsed.outputDir).toContain('xray');
    expect(parsed.snapshots[0]?.maxItems).toBe(500);
    expect(parsed.snapshots[1]?.maxItems).toBe(200);
  });

  it('jql is required — nothing is guessed about scope', () => {
    expect(ReadConfig.safeParse({ snapshots: [{ name: 'x', type: 'tests' }] }).success).toBe(false);
  });

  it('maxItems: 0 is refused — it would write an empty snapshot that LOOKS like an empty JQL', () => {
    expect(ReadConfig.safeParse({ snapshots: [{ name: 'x', type: 'tests', jql: 'a', maxItems: 0 }] }).success).toBe(
      false,
    );
  });

  it('the removed `deployment` key is refused loudly — a leftover cloud config must not run silently', () => {
    expect(
      ReadConfig.safeParse({ deployment: 'cloud', snapshots: [{ name: 'x', type: 'tests', jql: 'a' }] }).success,
    ).toBe(false);
    expect(
      ReadConfig.safeParse({ deployment: 'server', snapshots: [{ name: 'x', type: 'tests', jql: 'a' }] }).success,
    ).toBe(false);
  });
});

describe('reshapeTest', () => {
  const envelope = { key: 'PER-1233', summary: 'Manual login test', status: 'In Progress' };

  it('manual test: DC steps ({step,data,result}.raw) become steps; a null step is HIDDEN, never silent', () => {
    const out = reshapeTest(
      {
        key: 'PER-1233',
        type: 'Manual',
        definition: {
          steps: [
            { step: { raw: 'step1' }, data: { raw: 'data1' }, result: { raw: 'result1' } },
            { step: { raw: 'step2' }, data: { raw: '' }, result: null },
            null,
          ],
        },
      },
      envelope,
    );
    expect(out).toEqual({
      key: 'PER-1233',
      summary: 'Manual login test',
      status: 'In Progress',
      testType: 'Manual',
      steps: [{ action: 'step1', data: 'data1', result: 'result1' }, { action: 'step2' }],
      stepsHidden: 1,
    });
  });

  it('cucumber: a string definition lands in gherkin because the TYPE says so', () => {
    const out = reshapeTest(
      { key: 'PER-1098', type: 'Automated[Cucumber]', definition: 'Given a calculator' },
      { key: 'PER-1098' },
    );
    expect(out.gherkin).toBe('Given a calculator');
    expect(out.unstructured).toBeUndefined();
  });

  it('generic (and any unknown type): a string definition is honest as unstructured, never guessed as gherkin', () => {
    const generic = reshapeTest(
      { key: 'PER-1099', type: 'Automated[Generic]', definition: 'run the suite' },
      { key: 'PER-1099' },
    );
    expect(generic.unstructured).toBe('run the suite');
    expect(generic.gherkin).toBeUndefined();
    const unknown = reshapeTest({ key: 'X-1', type: 'Exploratory', definition: 'notes' }, { key: 'X-1' });
    expect(unknown.unstructured).toBe('notes');
  });

  it('the envelope status stays the JIRA status — raven serves the run verdict elsewhere', () => {
    const out = reshapeTest({ key: 'PER-1', type: 'Manual' }, { key: 'PER-1', status: 'To Do' });
    expect(out.status).toBe('To Do');
  });
});

describe('reshapeRun', () => {
  it('flat DC row → CanonicalTestRun; a missing key is named, not silent', () => {
    expect(reshapeRun({ key: 'CALC-10', status: 'FAIL' })).toEqual({ testKey: 'CALC-10', status: 'FAIL' });
    expect(reshapeRun({})).toEqual({ testKey: '(unknown)' });
    expect(reshapeRun({ key: 'CALC-12', status: 'PASS', startedOn: '2016-10-11T17:15:05+01:00' }).startedOn).toBe(
      '2016-10-11T17:15:05+01:00',
    );
  });
});

describe('chunkKeys', () => {
  it('splits exactly at the batch size — the boundary key goes to the NEXT request', () => {
    expect(chunkKeys(['a', 'b', 'c', 'd', 'e'], 2)).toEqual([['a', 'b'], ['c', 'd'], ['e']]);
    expect(chunkKeys(['a', 'b'], 2)).toEqual([['a', 'b']]);
    expect(chunkKeys([], 2)).toEqual([]);
  });
});

describe('renderers', () => {
  it('tests: steps become a table (pipes escaped by mdTable), gherkin a fenced block', () => {
    const md = renderTestsMarkdown({
      jql: 'project = PROJ',
      total: 2,
      truncated: false,
      stalled: false,
      hidden: 0,
      tests: [
        { key: 'PROJ-1', summary: 'Manual one', testType: 'Manual', steps: [{ action: 'Click a | b' }] },
        { key: 'PROJ-2', summary: 'BDD one', testType: 'Automated[Cucumber]', gherkin: 'Given x' },
      ],
    });
    expect(md).toContain('## PROJ-1 — Manual one');
    expect(md).toContain('Click a \\| b');
    expect(md).toContain('```gherkin\nGiven x\n```');
    expect(md).not.toContain('TRUNCATED');
    expect(md).not.toContain('HIDDEN');
    expect(md).not.toContain('STALLED');
    expect(md).not.toContain('SKIPPED');
  });

  it('a JQL with a backtick or newline cannot break the header — codeSpan sizes the fence', () => {
    const md = renderTestsMarkdown({
      jql: 'summary ~ "a`b"\nAND project = P',
      truncated: false,
      stalled: false,
      hidden: 0,
      tests: [],
    });
    const [header] = md.split('\n');
    expect(header).toBe('# Xray tests — ``summary ~ "a`b" AND project = P``');
  });

  it('an unknown upstream total is SAID, not restated as the fetched count', () => {
    const md = renderTestsMarkdown({ jql: 'a', truncated: true, stalled: false, hidden: 0, tests: [] });
    expect(md).toContain('0 of an unknown upstream total');
    expect(md).toContain('**TRUNCATED**');
  });

  it('a stalled walk gets the STALLED note, not the raise-maxItems remedy', () => {
    const md = renderTestsMarkdown({ jql: 'a', total: 300, truncated: true, stalled: true, hidden: 0, tests: [] });
    expect(md).toContain('**STALLED**');
    expect(md).not.toContain('raise maxItems');
  });

  it('hidden steps get their own note on the test section', () => {
    const md = renderTestsMarkdown({
      jql: 'a',
      total: 1,
      truncated: false,
      stalled: false,
      hidden: 0,
      tests: [{ key: 'PROJ-1', summary: 'x', stepsHidden: 2 }],
    });
    expect(md).toContain('**STEPS HIDDEN**: 2 step(s)');
  });

  it('SKIPPED gets its own line with the JQL remedy — it is not HIDDEN', () => {
    const md = renderTestsMarkdown({
      jql: 'project = PER',
      total: 5,
      truncated: false,
      stalled: false,
      hidden: 0,
      skipped: 3,
      tests: [{ key: 'PER-1' }],
    });
    expect(md).toContain('**SKIPPED**: 3 issue(s)');
    expect(md).toContain('narrow the JQL');
    expect(md).not.toContain('**HIDDEN**');
  });

  it('executions: runs table plus MEASURED notes for each kind of loss', () => {
    const md = renderExecutionsMarkdown({
      jql: 'project = PROJ',
      total: 9,
      truncated: true,
      stalled: false,
      hidden: 2,
      executions: [
        {
          key: 'PROJ-9',
          summary: 'Regression',
          runs: [{ testKey: 'PROJ-1', status: 'FAILED' }],
          runsTotal: 150,
          runsTruncated: true,
          runsHidden: 1,
        },
      ],
    });
    expect(md).toContain('| PROJ-1 | FAILED |');
    expect(md).toContain('**TRUNCATED**');
    expect(md).toContain('**HIDDEN**: 2 row(s)');
    expect(md).toContain('**RUNS TRUNCATED**: 2 of 150 run(s) fetched');
    expect(md).toContain('**RUNS HIDDEN**: 1 run(s)');
  });
});
