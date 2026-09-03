// ANSI stripping and error extraction: the two things that decide whether a failing build costs
// the agent a line or a thousand.
import { describe, expect, it } from 'vitest';
import { errorLines, parseTargetSpec, stripAnsi } from '../src/target.mjs';

const ESC = String.fromCharCode(27);

describe('stripAnsi', () => {
  it('zdejmuje kolory', () => {
    expect(stripAnsi(`${ESC}[31mERROR${ESC}[0m dalej`)).toBe('ERROR dalej');
  });

  it('zdejmuje hiperłącze OSC 8, razem z terminatorem BEL i ESC-backslash', () => {
    const bel = `${ESC}]8;;http://a${String.fromCharCode(7)}link${ESC}]8;;${String.fromCharCode(7)}`;
    expect(stripAnsi(bel)).toBe('link');
    const st = `${ESC}]0;tytuł${ESC}\\reszta`;
    expect(stripAnsi(st)).toBe('reszta');
  });

  it('nie zjada tekstu przy zachłannym dopasowaniu dwóch sekwencji OSC w jednej linii', () => {
    const two = `${ESC}]0;a${String.fromCharCode(7)}ZOSTAJE${ESC}]0;b${String.fromCharCode(7)}TEŻ`;
    expect(stripAnsi(two)).toBe('ZOSTAJETEŻ');
  });

  it('normalizuje CRLF i wywala samotne CR z pasków postępu', () => {
    expect(stripAnsi('a\r\nb\rc')).toBe('a\nbc');
  });

  it('tekst bez ANSI przechodzi bez zmian', () => {
    expect(stripAnsi('zwykła linia · z kropką')).toBe('zwykła linia · z kropką');
  });
});

describe('errorLines', () => {
  const LOG = [
    'NX   Running target build',
    'apps/portal/src/app/x.ts(12,5): error TS2322: typ nie pasuje',
    'apps/portal/src/app/y.ts(3,1): error TS2304: nie znaleziono nazwy',
    'apps/portal/src/app/x.ts(12,5): error TS2322: typ nie pasuje',
    '',
    'NX   Ran target build for project portal',
    'Failed tasks:',
  ].join('\n');

  it('wyciąga błędy w kolejności i bez powtórzeń', () => {
    expect(errorLines(LOG)).toEqual([
      'apps/portal/src/app/x.ts(12,5): error TS2322: typ nie pasuje',
      'apps/portal/src/app/y.ts(3,1): error TS2304: nie znaleziono nazwy',
    ]);
  });

  it('pomija banery podsumowania, które pasują do wzorca, a nic nie mówią', () => {
    expect(errorLines(LOG).some((line) => line.startsWith('Failed tasks'))).toBe(false);
    expect(errorLines(LOG).some((line) => line.includes('Ran target'))).toBe(false);
  });

  it('tnie po pięciu — reszta jest w pliku, jeden odczyt dalej', () => {
    const many = Array.from({ length: 40 }, (_, i) => `src/a${String(i)}.ts(1,1): error TS1005: brak`).join('\n');
    expect(errorLines(many)).toHaveLength(5);
    expect(errorLines(many, 2)).toHaveLength(2);
  });

  it('log bez błędów daje pustą listę, nie zgadywanie', () => {
    expect(errorLines('wszystko dobrze\nNX   Successfully ran target build')).toEqual([]);
  });
});

describe('parseTargetSpec', () => {
  it('dzieli na projekt i target, a konfigurację zostawia po stronie targetu', () => {
    expect(parseTargetSpec('portal:build')).toEqual({ project: 'portal', target: 'build' });
    expect(parseTargetSpec('portal:build:production')).toEqual({ project: 'portal', target: 'build:production' });
  });

  it('null, gdy którejś połowy brak', () => {
    expect(parseTargetSpec('portal')).toBeNull();
    expect(parseTargetSpec(':build')).toBeNull();
    expect(parseTargetSpec('portal:')).toBeNull();
  });
});
