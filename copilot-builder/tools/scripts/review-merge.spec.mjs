import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { expandInputs, findingsTable, mergeReviews, parseArgs, parseReport, renderMerged } from './review-merge.mjs';

const HEADER = '| Plik | Linia | Problem | 🔴🟡🟢 | Sugestia |\n| --- | --- | --- | --- | --- |\n';

const ANTHROPIC = `# raport\n\n${HEADER}| \`apps/x.ts\` | 12 | brak walidacji wejścia | 🔴 | schemat Zod na granicy |\n| \`apps/y.ts\` | 3 | nazwa mówi co, nie po co | 🔴 | zmień nazwę |\n\nWerdykt: **APPROVED z uwagami**\n`;
const OPENAI = `${HEADER}| apps/x.ts | 12 | wejście bez schematu | 🔴 | Zod |\n| apps/y.ts | 3 | nazwa w porządku | 🟢 | — |\n| \`apps/z.ts\` | — | duplikacja helpera | 🟡 | wyciągnij do util |\n\n**NO-GO** — jedno zdanie.\n`;
const MOONSHOT = `${HEADER}| \`./apps/x.ts\` | 12 | walidacja | 🟡 | Zod |\n\n**APPROVED**\n`;
const SEATS = ['anthropic', 'openai', 'moonshot'];

describe('parseReport', () => {
  it('reads findings by header name and the verdict from bold text', () => {
    const report = parseReport(ANTHROPIC, 'anthropic');
    expect(report?.verdict).toBe('APPROVED z uwagami');
    expect(report?.findings).toHaveLength(2);
    expect(report?.findings[0]).toEqual({
      file: 'apps/x.ts',
      line: '12',
      problem: 'brak walidacji wejścia',
      severity: '🔴',
      suggestion: 'schemat Zod na granicy',
    });
  });

  it('normalises the file cell, treats a dash as no line and warns on a row without a colour', () => {
    const report = parseReport(
      `${HEADER}| \`.\\apps\\a.ts\` | - | x | brak | y |\n| apps/b.ts | — | z | 🟢 | w |\n\n**APPROVED**\n`,
      'openai',
    );
    expect(report?.findings).toEqual([{ file: 'apps/b.ts', line: '—', problem: 'z', severity: '🟢', suggestion: 'w' }]);
    expect(report?.warnings[0]).toContain('bez koloru');
  });

  it('returns null without a findings table and warns without a verdict', () => {
    expect(parseReport('# nic\n\nSamo APPROVED bez tabeli\n', 'x')).toBeNull();
    expect(findingsTable('| a | b |\n| - | - |\n| 1 | 2 |')).toBeNull();
    expect(parseReport(`${HEADER}| a.ts | 1 | p | 🟢 | s |\n`, 'x')?.warnings[0]).toContain('brak werdyktu');
  });
});

describe('mergeReviews', () => {
  const merged = mergeReviews(
    [parseReport(ANTHROPIC, 'anthropic'), parseReport(OPENAI, 'openai'), parseReport(MOONSHOT, 'moonshot')].map(
      (report) => /** @type {NonNullable<typeof report>} */ (report),
    ),
    SEATS,
  );

  it('joins the same file and line across families, keeps the worst colour and counts the families', () => {
    const x = merged.rows.find((row) => row.file === 'apps/x.ts');
    expect(x?.families.map((entry) => `${entry.family} ${entry.severity}`)).toEqual([
      'anthropic 🔴',
      'openai 🔴',
      'moonshot 🟡',
    ]);
    expect(x?.severity).toBe('🔴');
    expect(x?.problems).toEqual(['brak walidacji wejścia', 'wejście bez schematu', 'walidacja']);
    expect(x?.suggestions).toEqual(['schemat Zod na granicy', 'Zod']);
    expect(x?.conflict).toBe(false);
  });

  it('marks a 🔴 against a 🟢 as a conflict and never averages it', () => {
    const y = merged.rows.find((row) => row.file === 'apps/y.ts');
    expect(y?.conflict).toBe(true);
    expect(y?.severity).toBe('🔴');
  });

  it('sorts by colour, then by agreement, and takes the worst verdict', () => {
    expect(merged.rows.map((row) => `${row.file}:${row.line}`)).toEqual(['apps/x.ts:12', 'apps/y.ts:3', 'apps/z.ts:—']);
    expect(merged.verdict).toBe('NO-GO');
    expect(merged.seats.map((seat) => seat.family)).toEqual(SEATS);
    expect(merged.warnings).toEqual([]);
  });

  it('names a missing seat and a family without a seat instead of averaging them away', () => {
    const partial = mergeReviews([/** @type {any} */ (parseReport(MOONSHOT, 'google'))], SEATS);
    expect(partial.warnings).toEqual([
      'brak raportu rodziny anthropic — rejestr ma to miejsce w review.seats',
      'brak raportu rodziny openai — rejestr ma to miejsce w review.seats',
      'brak raportu rodziny moonshot — rejestr ma to miejsce w review.seats',
      'raport rodziny google, która nie ma miejsca w review.seats',
    ]);
  });
});

describe('renderMerged', () => {
  it('prints one table with the family count, the summary line and the conflicts section', () => {
    const merged = mergeReviews(
      [parseReport(ANTHROPIC, 'anthropic'), parseReport(OPENAI, 'openai'), parseReport(MOONSHOT, 'moonshot')].map(
        (report) => /** @type {NonNullable<typeof report>} */ (report),
      ),
      SEATS,
    );
    const markdown = renderMerged(merged, { slug: 'portal-login' });
    expect(markdown).toContain('## Review scalony — portal-login');
    expect(markdown).toContain('Miejsca: anthropic **APPROVED z uwagami** · openai **NO-GO** · moonshot **APPROVED**');
    expect(markdown).toContain('| 🔴 | schemat Zod na granicy · Zod | 3× anthropic 🔴, openai 🔴, moonshot 🟡 |');
    expect(markdown).toContain('| 2× anthropic 🔴, openai 🟢 — konflikt |');
    expect(markdown).toContain('| 1× openai |');
    expect(markdown).toContain(
      '**Werdykt scalony: NO-GO** (najgorszy z 3). Potwierdzone (≥ 2 rodziny): 2 · kandydaci (1 rodzina): 1 · konflikty 🔴/🟢: 1 · 🔴 potwierdzone: 2 · 🔴 kandydaci do pytania operatora: 0',
    );
    expect(markdown).toContain(
      '## Konflikty — pytanie do operatora, nie średnia\n- `apps/y.ts:3` — anthropic 🔴 / openai 🟢:',
    );
    expect(markdown).not.toContain('## Uwagi scalania');
  });

  it('escapes a pipe inside a problem cell', () => {
    const merged = mergeReviews(
      [/** @type {any} */ (parseReport(`${HEADER}| a.ts | 1 | a \\| b | 🟢 | s |\n\n**APPROVED**\n`, 'anthropic'))],
      [],
    );
    expect(renderMerged(merged)).toContain('| a \\| b |');
  });
});

describe('CLI helpers', () => {
  /** @type {string} */
  let dir;
  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'cb-review-merge-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('parseArgs separates inputs from --out and --slug', () => {
    expect(parseArgs(['a.md', '--out', 'x.md', 'b.md', '--slug', 's'])).toEqual({
      inputs: ['a.md', 'b.md'],
      out: 'x.md',
      slug: 's',
    });
  });

  it('expandInputs takes every *.md of a directory, sorted, and passes files through', () => {
    mkdirSync(path.join(dir, 'seats'));
    writeFileSync(path.join(dir, 'seats', 'openai.md'), 'x', 'utf8');
    writeFileSync(path.join(dir, 'seats', 'anthropic.md'), 'x', 'utf8');
    writeFileSync(path.join(dir, 'seats', 'notes.txt'), 'x', 'utf8');
    expect(expandInputs([path.join(dir, 'seats'), 'single.md'])).toEqual([
      path.join(dir, 'seats', 'anthropic.md'),
      path.join(dir, 'seats', 'openai.md'),
      'single.md',
    ]);
  });
});
