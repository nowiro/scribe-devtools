// The harness measures itself. Most of these assert the SHAPE of the measurement, not a number
// that can drift with machine load:
//
//   * the fixed cost is the instruction block and nothing else;
//   * the variable cost is dominated by the files, not by the lines — which is the whole claim;
//   * a session that fell through to the CLI is REJECTED by the validity gate rather than averaged.
//
// The one exception is the timing assertion in `describe('czas')`: it says a good chunk of the
// wall clock is Node starting, which is the fact that decided against building a keeper, and that
// still needs a real number. It is deliberately loose and one-sided, with a threshold measured
// against this repository's own worst case (see the comment there) rather than the quiet-machine
// number — a test that only passes when nothing else is running is not a gate, it is a hope.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  benchEnv,
  cacheModes,
  COMMANDS,
  INSTRUCTION,
  makeFixture,
  median,
  runOnce,
  runScenario,
  scenarioTokens,
  timeVerb,
} from './nx-angular-inspector-run.mjs';

/** @type {string} */
let base;
/** @type {string} */
let root;
/** @type {Awaited<ReturnType<typeof runScenario>>} */
let sample;

beforeAll(async () => {
  base = mkdtempSync(path.join(tmpdir(), 'nxai-bench-'));
  root = await makeFixture(base);
  sample = await runScenario({ root });
}, 120_000);

afterAll(() => {
  rmSync(base, { recursive: true, force: true });
});

describe('scenariusz', () => {
  it('każda komenda kończy się zerem i drukuje dokładnie jedną linię', () => {
    expect(sample.runs).toHaveLength(COMMANDS.length);
    for (const run of sample.runs) {
      expect(run.exit, run.argv.join(' ')).toBe(0);
      expect(run.line.split('\n'), run.argv.join(' ')).toHaveLength(1);
      expect(run.line.startsWith('ok '), run.line).toBe(true);
    }
  });

  it('plik z `.ws/` jest czytany tylko tam, gdzie linia nie jest odpowiedzią', () => {
    const byArgv = new Map(sample.runs.map((run) => [run.argv.join(' '), run]));
    // `projects portal` odpowiada samą linią — gdyby ktoś dopisał tam plik, ta asercja czerwienieje.
    expect(byArgv.get('projects portal')?.read).toBe('');
    expect((byArgv.get('projects')?.read ?? '').length).toBeGreaterThan(100);
  });
});

describe('tokeny', () => {
  it('koszt STAŁY to wyłącznie blok instrukcji', () => {
    const counted = scenarioTokens(sample);
    expect(counted.fixed).toHaveLength(1);
    expect(counted.fixed[0].label).toContain('INSTRUCTION');
    expect(counted.totals.fixed.tokens).toBeGreaterThan(150);
    expect(counted.totals.fixed.tokens).toBeLessThanOrEqual(200);
  });

  it('same linie stdout są tanie — to jest teza całego narzędzia', () => {
    const counted = scenarioTokens(sample);
    const lines = counted.variable.filter((item) => item.label.startsWith('← stdout'));
    const files = counted.variable.filter((item) => item.label.includes('plik z .ws/'));
    const lineTokens = lines.reduce((sum, item) => sum + item.tokens, 0);
    const fileTokens = files.reduce((sum, item) => sum + item.tokens, 0);
    // Pięć odpowiedzi mieści się w budżecie, w którym nie zmieściłby się ani jeden `tools/list`.
    expect(lineTokens).toBeLessThan(200);
    // A to, co duże, leży na dysku i jest czytane tylko wtedy, gdy naprawdę trzeba.
    expect(fileTokens).toBeGreaterThan(lineTokens);
  });

  it('sumy się zgadzają — raport nie może zgubić pozycji', () => {
    const counted = scenarioTokens(sample);
    const sum = (/** @type {{tokens: number}[]} */ items) => items.reduce((n, i) => n + i.tokens, 0);
    expect(counted.totals.all.tokens).toBe(sum(counted.fixed) + sum(counted.variable));
    expect(counted.totals.variable.tokens).toBe(sum(counted.variable));
  });
});

describe('bramka ważności pomiaru', () => {
  it('sesja z cache uznaje się za ważną', () => {
    const verdicts = cacheModes(sample);
    expect(verdicts.valid).toBe(true);
    expect(verdicts.modes.filter((mode) => mode !== '')).not.toHaveLength(0);
  });

  it('przebieg, który poszedł do CLI, UNIEWAŻNIA pomiar zamiast go zaniżyć', async () => {
    const forced = await runOnce({ root, argv: ['projects', '--fresh'], env: benchEnv() });
    expect(forced.line).toContain('przeliczone');
    expect(cacheModes({ runs: [forced] }).valid).toBe(false);
  });
});

describe('czas', () => {
  it('większość zegara to start Node-a, nie nasza praca — dlatego v1 nie ma keepera', async () => {
    const timed = await timeVerb({ root, argv: ['projects'], reps: 5 });
    expect(timed.samples).toHaveLength(5);
    expect(timed.median).toBeGreaterThan(0);
    // Jednostronnie i luźno: podłoga Node-a to spory kawałek przebiegu. Keeper mógłby uratować
    // najwyżej resztę, a kosztowałby cały podsystem tożsamości, locka i nazwanego pipe'a.
    //
    // Próg 0.3, nie 0.5: na spokojnej maszynie mediana `projects` to ~90 ms przy podłodze ~64 ms
    // (72 %), ale pod dużym obciążeniem współbieżnym (kilkadziesiąt równoległych testów, w tym
    // realny Chrome z innych pakietów) obie liczby rosną nierównomiernie — zmierzony spadek do
    // 41 % pod takim obciążeniem nadal potwierdza tezę (Node start to wciąż spory ułamek), więc
    // próg jest niżej, żeby nie migotać dokładnie tam, gdzie AGENTS.md już ostrzega o migotaniu.
    expect(timed.nodeFloor / timed.median, `mediana ${timed.median} ms, podłoga ${timed.nodeFloor} ms`).toBeGreaterThan(
      0.3,
    );
  }, 120_000);

  it('median liczy się dla parzystej i nieparzystej długości', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });
});

describe('blok instrukcji', () => {
  it('jest tym samym napisem, co w AGENTS.md — pilnuje tego bramka, tu tylko kotwica', () => {
    expect(INSTRUCTION.startsWith('Nx/Angular:')).toBe(true);
    expect(INSTRUCTION).toContain('serve [wait|stop] <projekt>');
    expect(INSTRUCTION).not.toContain('\n');
  });
});
