import { describe, expect, it } from 'vitest';
import { cells, listCell, parseTable, renderRow, replaceRows } from './lib/md-table.mjs';
import { acField, acLines, nextTask, parseArgs, readPlan, renderBrief, updateLog, updateTask } from './sdd.mjs';

const PLAN = `---
type: plan
id: 'plan.feature.portal-login'
status: draft
---

# Plan

## Zadania

| id | title | agent | paths | done_when | status | AC | commit |
| --- | --- | --- | --- | --- | --- | --- | --- |
| T000 | intake | doc-intake | — | blok intake | done | — | — |
| T002 | implementacja logowania | code-angular | \`apps/portal/src/app/login.ts\`, apps/portal/src/app/login.html | \`npm run affected -- lint\` i \`-- typecheck\` zielone | todo | AC1, AC2 | — |
| T004 | testy jednostkowe | code-tester-unit | apps/portal/src/app/login.spec.ts | \`npm run affected -- test\` zielone | todo | wszystkie | — |

## Pytania otwarte
`;

const SPEC = `---
type: spec
id: 'spec.portal-login'
---

## Kryteria akceptacji

1. AC1: zakładając poprawne dane, gdy użytkownik wysyła formularz, wtedy widzi pulpit.
2. AC2: zakładając błędne hasło, gdy wysyła formularz, wtedy widzi komunikat przy polu hasła.
- AC3 — po trzech błędach przycisk jest zablokowany na minutę.

## Zakres
`;

const RUN = `# Run-log

## Kroki

| # | krok (SDD) | agent | tier | wynik / artefakt | status |
| --- | --- | --- | --- | --- | --- |
| 0 | intake | doc-intake | fast | verb, slug, AC | todo |
| 1 | specify (scaffold) | — (skrypt) | 0 | spec + plan + run-log | done |

## Napotkane problemy
`;

describe('md-table', () => {
  it('splits cells, honours an escaped pipe and renders it back', () => {
    expect(cells('| a | b \\| c | d |')).toEqual(['a', 'b | c', 'd']);
    expect(renderRow(['a', 'b | c'])).toBe('| a | b \\| c |');
  });

  it('parses the first accepted table and replaces its rows without touching the rest', () => {
    const table = parseTable(PLAN, (header) => header.includes('id'));
    expect(table?.header).toEqual(['id', 'title', 'agent', 'paths', 'done_when', 'status', 'ac', 'commit']);
    expect(table?.rows).toHaveLength(3);
    const next = replaceRows(PLAN, /** @type {any} */ (table), [['T001', 'x', 'y', '—', 'z', 'todo', '—', '—']]);
    expect(next).toContain('| T001 | x | y | — | z | todo | — | — |');
    expect(next).not.toContain('T002');
    expect(next).toContain('## Pytania otwarte');
    expect(next.startsWith('---\ntype: plan')).toBe(true);
  });

  it('reads list cells and treats dashes as nothing', () => {
    expect(listCell('`a.ts`, b.ts , —')).toEqual(['a.ts', 'b.ts']);
    expect(listCell('n/a')).toEqual([]);
  });
});

describe('readPlan / nextTask', () => {
  it('maps rows to tasks by header name and finds the slug', () => {
    const plan = readPlan(PLAN);
    expect(plan?.slug).toBe('portal-login');
    expect(plan?.tasks[1]).toMatchObject({
      id: 'T002',
      agent: 'code-angular',
      paths: ['apps/portal/src/app/login.ts', 'apps/portal/src/app/login.html'],
      status: 'todo',
      ac: 'AC1, AC2',
    });
  });

  it('prefers the task in progress, then the first todo, then nothing', () => {
    const plan = /** @type {any} */ (readPlan(PLAN));
    expect(nextTask(plan.tasks)?.id).toBe('T002');
    const started = /** @type {any} */ (updateTask(PLAN, 'T004', { status: 'in-progress' }));
    expect(nextTask(/** @type {any} */ (readPlan(started.text)).tasks)?.id).toBe('T004');
    expect(nextTask([{ ...plan.tasks[0], status: 'done' }])).toBeNull();
  });
});

describe('brief', () => {
  it('quotes the AC lines of the spec by number and renders every field', () => {
    const plan = /** @type {any} */ (readPlan(PLAN));
    const lines = acLines(SPEC);
    expect([...lines.keys()]).toEqual([1, 2, 3]);
    const brief = renderBrief(plan.tasks[1], acField(plan.tasks[1], lines, 'docs/specs/portal-login/spec.md'));
    expect(brief).toBe(
      [
        'AGENT:    code-angular',
        'ZADANIE:  T002 — implementacja logowania',
        'PLIKI:    apps/portal/src/app/login.ts, apps/portal/src/app/login.html',
        'AC:       AC1: zakładając poprawne dane, gdy użytkownik wysyła formularz, wtedy widzi pulpit. · AC2: zakładając błędne hasło, gdy wysyła formularz, wtedy widzi komunikat przy polu hasła.',
        'BRAMA:    npm run affected -- lint i -- typecheck zielone',
        'BUDŻET:   2 plików, 2 próby',
        'ZWRÓĆ:    PLIKI: <lista> · BRAMA: ok | FAIL + 10 linii · UWAGI: <zdanie> | brak',
        'NIE:      nie commituj, nie edytuj plików spoza PLIKI, nie pytaj o historię rozmowy',
      ].join('\n'),
    );
  });

  it('takes every AC for "wszystkie" and falls back to the cell when the spec has no AC lines', () => {
    const plan = /** @type {any} */ (readPlan(PLAN));
    expect(acField(plan.tasks[2], acLines(SPEC), 'spec.md').split(' · ')).toHaveLength(3);
    expect(acField(plan.tasks[1], new Map(), 'docs/specs/x/spec.md')).toBe('AC1, AC2 — treść w docs/specs/x/spec.md');
    expect(acField(plan.tasks[0], new Map(), 'spec.md')).toContain('zadanie bez AC');
  });
});

describe('updateTask / updateLog', () => {
  it('changes only the asked cells of one task', () => {
    const done = /** @type {any} */ (updateTask(PLAN, 'T002', { status: 'done', commit: 'abc1234' }));
    expect(done.task).toMatchObject({ status: 'done', commit: 'abc1234' });
    expect(done.text).toContain('| T002 | implementacja logowania | code-angular |');
    expect(done.text).toContain('| done | AC1, AC2 | abc1234 |');
    expect(done.text).toContain('| T004 | testy jednostkowe | code-tester-unit |');
    expect(updateTask(PLAN, 'T999', { status: 'done' })).toBeNull();
  });

  it('updates the run-log row by step number or appends a new one', () => {
    const updated = /** @type {string} */ (
      updateLog(RUN, {
        step: '0',
        agent: 'doc-intake',
        tier: 'fast',
        result: 'verb=feature, slug=portal-login',
        status: 'done',
      })
    );
    expect(updated).toContain('| 0 | intake | doc-intake | fast | verb=feature, slug=portal-login | done |');
    const appended = /** @type {string} */ (
      updateLog(updated, {
        step: '5',
        name: 'implement',
        agent: 'code-angular',
        tier: 'base',
        result: 'T002 ok, sha abc1234',
      })
    );
    expect(appended).toContain('| 5 | implement | code-angular | base | T002 ok, sha abc1234 | done |');
    expect(appended).toContain('## Napotkane problemy');
    expect(updateLog('# nic\n', { step: '1' })).toBeNull();
  });
});

describe('parseArgs', () => {
  it('separates the command, positionals and --flags', () => {
    expect(parseArgs(['task', 'plan.md', 'T002', '--status', 'done', '--commit', 'abc'])).toEqual({
      command: 'task',
      positional: ['plan.md', 'T002'],
      flags: { status: 'done', commit: 'abc' },
    });
  });
});
