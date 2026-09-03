// The parser, the line formatter, and the one invariant that holds the two tables together.
import { describe, expect, it } from 'vitest';
import { CliError, parseArgs } from '../src/cli.mjs';
import { formatAge, formatFail, formatInt, formatOk, MAX_LINE, plural, relPath, truncate } from '../src/print.mjs';
import { generatorPath, safeSegment } from '../src/out.mjs';
import { usage, VERB_NAMES, VERBS } from '../src/verbs.schema.mjs';
import { RUNNERS } from '../src/verbs.run.mjs';

describe('tabela komend ↔ tabela implementacji', () => {
  it('te same klucze W TEJ SAMEJ KOLEJNOŚCI', () => {
    // Kolejność, nie tylko zbiór: komenda opisana w jednej tabeli i nieobecna w drugiej psuje się
    // po cichu — help wypisze ją, a uruchomienie nie zrobi nic.
    expect(Object.keys(RUNNERS)).toEqual([...VERB_NAMES]);
  });

  it('każdy wiersz mówi, czy czyta graf i co zapisuje', () => {
    for (const verb of VERBS) {
      expect(typeof verb.needsGraph, verb.name).toBe('boolean');
      expect(typeof verb.writes, verb.name).toBe('string');
      expect(verb.summary.length, verb.name).toBeGreaterThan(10);
    }
  });

  it('help wymienia wszystkie komendy i próg wsparcia', () => {
    const text = usage();
    for (const name of VERB_NAMES) expect(text).toContain(`nx-angular-inspector ${name}`);
    expect(text).toContain('nx >= 23');
    expect(text).toContain('angular >= 22');
  });
});

describe('parser', () => {
  it('brak argumentów, help i --help to ten sam tryb', () => {
    for (const argv of [[], ['help'], ['--help'], ['-h']]) expect(parseArgs(argv).mode).toBe('help');
    expect(parseArgs(['help', 'graph']).verb).toBe('graph');
  });

  it('nieznana komenda pada z listą znanych i kodem 2', () => {
    expect(() => parseArgs(['projcts'])).toThrow(CliError);
    try {
      parseArgs(['projcts']);
    } catch (error) {
      expect(/** @type {CliError} */ (error).exit).toBe(2);
      expect(/** @type {CliError} */ (error).message).toContain('projects');
    }
  });

  it('flaga spoza tabeli danej komendy jest błędem, nie ciszą', () => {
    expect(() => parseArgs(['projects', '--reverse'])).toThrow(/nieznana flaga/u);
    expect(parseArgs(['graph', 'portal', '--reverse']).flags.reverse).toBe(true);
  });

  it('flagi z wartością przyjmują obie pisownie', () => {
    expect(parseArgs(['env', '--root', 'D:/w']).flags.root).toBe('D:/w');
    expect(parseArgs(['env', '--root=D:/w']).flags.root).toBe('D:/w');
    expect(() => parseArgs(['env', '--root'])).toThrow(/wymaga wartości/u);
    expect(() => parseArgs(['env', '--fresh=1'])).toThrow(/nie przyjmuje wartości/u);
  });

  it('brakujący argument obowiązkowy pada przed czytaniem czegokolwiek', () => {
    expect(() => parseArgs(['graph'])).toThrow(/brakuje argumentu/u);
    expect(() => parseArgs(['projects', 'a', 'b'])).toThrow(/za dużo argumentów/u);
  });
});

describe('linia', () => {
  it('składa części i pomija puste', () => {
    expect(formatOk('projects portal', ['app', '', 'apps/portal', undefined, false])).toBe(
      'ok projects portal · app · apps/portal',
    );
  });

  it('FAIL stawia powód jako pierwszą część', () => {
    expect(formatFail('env', 'wymagane nx >= 23', ['nx 21.3.11'])).toBe('FAIL env · wymagane nx >= 23 · nx 21.3.11');
  });

  it('nigdy nie przekracza limitu i nie rozbija się na wiele linii', () => {
    const line = formatOk('x', ['a'.repeat(300), 'b\nc']);
    expect(line.length).toBeLessThanOrEqual(MAX_LINE);
    expect(line).not.toContain('\n');
  });

  it('nie tnie w połowie pary surogatów', () => {
    const cut = truncate(`${'a'.repeat(118)}😀tail`, 120);
    expect(cut.length).toBeLessThanOrEqual(120);
    expect(cut).not.toContain('\ufffd');
  });
});

describe('formatery', () => {
  it('liczby z wąską spacją, niezależnie od locale', () => {
    expect(formatInt(1743)).toBe('1 743');
    expect(formatInt(-42)).toBe('-42');
  });

  it('wiek w najgrubszej jednostce, która jest jeszcze prawdziwa', () => {
    expect(formatAge(5_000)).toBe('5 s');
    expect(formatAge(120_000)).toBe('2 min');
    expect(formatAge(2 * 3600_000)).toBe('2 h');
    expect(formatAge(5 * 86_400_000)).toBe('5 dni');
  });

  it('polska liczba mnoga zgadza się z liczbą', () => {
    const forms = /** @type {[string, string, string]} */ (['zależność', 'zależności', 'zależności']);
    expect(plural(1, forms)).toBe('1 zależność');
    expect(plural(2, forms)).toBe('2 zależności');
    expect(plural(5, forms)).toBe('5 zależności');
    expect(plural(22, forms)).toBe('22 zależności');
    expect(plural(12, forms)).toBe('12 zależności');
  });

  it('ścieżki względne wobec cwd, zawsze ukośnikiem w przód', () => {
    expect(relPath('D:\\w\\.ws\\projects.md', 'D:\\w')).toBe('.ws/projects.md');
    expect(relPath('D:/w', 'D:/w')).toBe('.');
    expect(relPath('C:/inne/miejsce.md', 'D:/w')).toBe('C:/inne/miejsce.md');
  });
});

describe('nazwy plików generatorów — pułapka NTFS', () => {
  it('dwukropek i ukośnik nie trafiają do nazwy pliku', () => {
    expect(generatorPath('@nx/angular', 'library')).toBe('gen/nx-angular/library.md');
    expect(safeSegment('@schematics/angular')).toBe('schematics-angular');
    expect(safeSegment('::')).toBe('x');
  });
});
