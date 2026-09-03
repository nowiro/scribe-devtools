// One case per defect found by the adversarial review of 2026-09-03. Each one FAILS against the
// code as it was and passes against the code as it is — that is the only thing that makes a
// regression test worth its runtime.
//
// They live in their own file rather than being scattered into the topic files for a reason the
// review itself surfaced: `verbs.test.mjs` had a test that passed only because another `describe`
// further down the file mutated a shared fixture AFTERWARDS. Cases that mutate the filesystem get
// their own workspace here, built per test.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { encode } from 'gpt-tokenizer/encoding/o200k_base';
import { changedFiles, sharedGlobals } from '../src/affected.mjs';
import { ownerOf } from '../src/glob.mjs';
import { main } from '../src/main.mjs';
import { parseArgs } from '../src/cli.mjs';
import { indexGraph } from '../src/graph.mjs';
import { writeOut } from '../src/out.mjs';
import { formatOk, MAX_LINE, relPath, sliceUnits } from '../src/print.mjs';
import { directoriesUnder, inputSet, INFERRING_FILES, ROOT_INPUTS, stampGraph } from '../src/stamp.mjs';
import { errorSummary, runTarget, stripAnsi } from '../src/target.mjs';
import { loadModel } from '../src/workspace.mjs';
import { detect } from '../src/detect.mjs';
import { makeWorkspace } from '../fixtures/generate.mjs';

/** The inherited cap: 40 o200k tokens per line of stdout. */
const MAX_TOKENS = 40;
const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);

/** @type {string[]} */
const made = [];

afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A fresh workspace of its own, so no test can depend on another test's mutations. @param {string} kind */
function workspace(kind = 'nx-angular') {
  const base = mkdtempSync(path.join(tmpdir(), 'nxai-reg-'));
  made.push(base);
  const root = makeWorkspace(path.join(base, kind), kind);
  return root;
}

const graphOf = (/** @type {string} */ root) => path.join(root, '.nx', 'workspace-data', 'project-graph.json');
const touch = (/** @type {string} */ file, /** @type {number} */ ms) => utimesSync(file, ms / 1000, ms / 1000);

/** Push the whole input set into the past so only the change under test is recent. @param {string} root */
function settle(root, projectRoots) {
  const past = Date.now() - 600_000;
  for (const file of inputSet(root, projectRoots)) {
    try {
      touch(file, past);
    } catch {
      /* a path that is not there is not an input */
    }
  }
  touch(graphOf(root), past + 1000);
}

const ROOTS = ['apps/portal', 'libs/ui-kit', 'libs/utils'];

describe('stempel świeżości', () => {
  it('NOWY plik GŁĘBOKO w projekcie unieważnia graf', () => {
    const root = workspace();
    // Zagnieżdżony, nie w korzeniu projektu: korzeń był pilnowany od początku, a `src/lib/` nie —
    // i to tam leżą pliki, których importy wyznaczają krawędzie.
    mkdirSync(path.join(root, 'apps', 'portal', 'src', 'lib'), { recursive: true });
    settle(root, ROOTS);
    expect(stampGraph({ root, graphPath: graphOf(root), projectRoots: ROOTS }).cache).toBe('hit');
    writeFileSync(path.join(root, 'apps', 'portal', 'src', 'lib', 'nowy.ts'), 'export const a = 1;\n', 'utf8');
    expect(stampGraph({ root, graphPath: graphOf(root), projectRoots: ROOTS }).cache).toBe('stale');
  });

  it('projekt dodany w ZUPEŁNIE NOWYM katalogu najwyższego poziomu unieważnia graf', () => {
    const root = workspace();
    settle(root, ROOTS);
    // Wszystkie znane projekty leżą pod `apps/` i `libs/`. Kontrola pilnująca tylko bezpośrednich
    // rodziców znanych korzeni nie zobaczyłaby `tools/` w ogóle.
    mkdirSync(path.join(root, 'tools', 'skrypt'), { recursive: true });
    writeFileSync(path.join(root, 'tools', 'skrypt', 'project.json'), '{"name":"skrypt"}\n', 'utf8');
    const stamp = stampGraph({ root, graphPath: graphOf(root), projectRoots: ROOTS });
    expect(stamp.cache).toBe('stale');
    expect(stamp.newestPath).toBe(root);
  });

  it('projekt dodany w rodzeństwie zagnieżdżonego katalogu też jest widoczny', () => {
    const root = workspace();
    mkdirSync(path.join(root, 'libs', 'shared', 'ui', 'button'), { recursive: true });
    const nested = ['libs/shared/ui/button'];
    settle(root, nested);
    mkdirSync(path.join(root, 'libs', 'shared', 'data'), { recursive: true });
    expect(stampGraph({ root, graphPath: graphOf(root), projectRoots: nested }).cache).toBe('stale');
  });

  it('EDYCJA istniejącego pliku jest widoczna tylko w trybie --deep — i to jest nazwana granica', () => {
    const root = workspace();
    const file = path.join(root, 'apps', 'portal', 'src', 'main.ts');
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, 'export const a = 1;\n', 'utf8');
    settle(root, ROOTS);

    writeFileSync(file, "import { x } from '@org/store';\nexport const a = 1;\n", 'utf8');
    // Tani stempel tego nie widzi: mtime katalogu nie drgnął (sprawdzone na NTFS).
    expect(stampGraph({ root, graphPath: graphOf(root), projectRoots: ROOTS }).cache).toBe('hit');
    // `--deep` widzi, bo statuje pliki.
    const deep = stampGraph({ root, graphPath: graphOf(root), projectRoots: ROOTS, deep: true });
    expect(deep.cache).toBe('stale');
    expect(deep.deep).toBe(true);
    expect(deep.newestPath).toBe(file);
  });

  it('graf ze znacznikiem czasu w PRZYSZŁOŚCI nie dostaje `hit` — inaczej byłby świeży na zawsze', () => {
    const root = workspace();
    settle(root, ROOTS);
    touch(graphOf(root), Date.now() + 3600_000);
    writeFileSync(path.join(root, 'nx.json'), '{"defaultBase":"main"}\n', 'utf8');
    const stamp = stampGraph({ root, graphPath: graphOf(root), projectRoots: ROOTS });
    expect(stamp.cache).toBe('stale');
    expect(stamp.note).toContain('przyszłości');
  });

  it('REMIS mtime liczy się jako świeży — inaczej system plików o ziarnistości sekundy kłamie', () => {
    const root = workspace();
    const when = Date.now() - 60_000;
    for (const file of inputSet(root, ROOTS)) {
      try {
        touch(file, when);
      } catch {
        /* nie ma czego dotknąć */
      }
    }
    touch(graphOf(root), when);
    // Mutacja `>=` na `>` czerwieni dokładnie ten test i żaden inny.
    expect(stampGraph({ root, graphPath: graphOf(root), projectRoots: ROOTS }).cache).toBe('hit');
  });

  it('zbiór wejściowy naprawdę zawiera wymienione z nazwy pliki, nie „to, co jest w stałej”', () => {
    // Asercja pętlą po tej samej stałej, której używa implementacja, przechodziła po obcięciu
    // stałej do jednego elementu. Te nazwy są wypisane tutaj, więc skasowanie ich w stamp.mjs boli.
    for (const required of ['nx.json', 'package-lock.json', 'pnpm-lock.yaml', 'tsconfig.base.json']) {
      expect(ROOT_INPUTS, required).toContain(required);
    }
    for (const required of ['project.json', 'vite.config.ts', 'eslint.config.js', 'playwright.config.ts']) {
      expect(INFERRING_FILES, required).toContain(required);
    }
    const root = workspace();
    const set = inputSet(root, ROOTS).map((p) => p.replaceAll('\\', '/'));
    expect(set).toContain(`${root.replaceAll('\\', '/')}/package-lock.json`);
    expect(set).toContain(`${root.replaceAll('\\', '/')}/apps/portal/vite.config.ts`);
  });

  it('przejście po katalogach pomija node_modules i katalogi kropkowe', () => {
    const root = workspace();
    const dirs = directoriesUnder(root).map((d) => d.replaceAll('\\', '/'));
    expect(dirs.some((d) => d.includes('/node_modules'))).toBe(false);
    expect(dirs.some((d) => d.includes('/.nx'))).toBe(false);
  });
});

describe('affected', () => {
  it('projekt zakorzeniony w korzeniu workspace jest właścicielem — `ng new` pisze dokładnie taki', () => {
    const projects = [
      { name: 'my-app', root: '' },
      { name: 'my-app-e2e', root: 'e2e' },
    ];
    expect(ownerOf('src/main.ts', projects)).toBe('my-app');
    // Bardziej szczegółowy korzeń nadal wygrywa.
    expect(ownerOf('e2e/spec.ts', projects)).toBe('my-app-e2e');
  });

  it('ścieżka spoza ASCII wraca z gita w całości, nie jako oktalne ucieczki', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'nxai-utf8-'));
    made.push(dir);
    const git = (/** @type {string[]} */ args) =>
      spawnSync('git', args, { cwd: dir, shell: false, windowsHide: true, encoding: 'utf8' });
    git(['init', '-q', '-b', 'main']);
    git(['config', 'user.email', 'test@example.invalid']);
    git(['config', 'user.name', 'test']);
    git(['config', 'commit.gpgsign', 'false']);
    mkdirSync(path.join(dir, 'libs', 'ui'), { recursive: true });
    writeFileSync(path.join(dir, 'libs', 'ui', 'zolc.ts'), 'a', 'utf8');
    git(['add', '-A']);
    git(['commit', '-qm', 'base']);
    git(['checkout', '-qb', 'feature']);
    const named = path.join(dir, 'libs', 'ui', 'żółć.ts');
    writeFileSync(named, 'b', 'utf8');
    git(['add', '-A']);
    git(['commit', '-qm', 'plik z ogonkami']);

    const result = changedFiles(dir, 'main');
    expect(result.ok).toBe(true);
    expect(result.files).toEqual(['libs/ui/żółć.ts']);
    // A skoro nazwa wróciła w całości, plik ma właściciela.
    expect(ownerOf(result.files[0], [{ name: 'ui', root: 'libs/ui' }])).toBe('ui');
  });
});

describe('zapis do .ws/', () => {
  it('odmawia zapisu poza katalogiem wyjściowym', () => {
    const base = mkdtempSync(path.join(tmpdir(), 'nxai-out-'));
    made.push(base);
    const out = path.join(base, 'workspace', '.ws');
    mkdirSync(out, { recursive: true });
    expect(() => writeOut(out, 'run/../../../../evil.log', 'x')).toThrow(/wychodzi poza/u);
    expect(existsSync(path.join(base, 'evil.log'))).toBe(false);
  });

  it('nadpisanie pliku różniącego się tylko wielkością liter NIE jest raportowane jako porażka', () => {
    const base = mkdtempSync(path.join(tmpdir(), 'nxai-case-'));
    made.push(base);
    writeOut(base, 'run/Portal-build.log', 'pierwszy');
    // Na NTFS to ten sam plik; asercja porównująca bajt w bajt zgłaszała tu FAIL dla zapisu,
    // który się udał — i tak przy każdym kolejnym wywołaniu.
    expect(() => writeOut(base, 'run/portal-build.log', 'drugi')).not.toThrow();
  });

  it('weryfikacja przez readdirSync naprawdę łapie pułapkę NTFS ADS, nie tylko obiecuje', () => {
    // To DOKŁADNIE ten przypadek, dla którego writeOut w ogóle sprawdza katalog zamiast ufać
    // zapisowi: dwukropek w nazwie robi z `library.md` alternate data stream na `angular`, plik
    // "zapisuje się" bez wyjątku, ale `readdirSync` go nie widzi. `safeSegment`/`generatorPath`
    // w produkcyjnym kodzie zawsze czyszczą dwukropek PRZED wywołaniem `writeOut` — ten test woła
    // `writeOut` wprost, z pominięciem tamtej sanityzacji, żeby sam mechanizm obrony był
    // sprawdzony niezależnie od tego, czy ktoś zapomni go użyć.
    const base = mkdtempSync(path.join(tmpdir(), 'nxai-ads-'));
    made.push(base);
    if (process.platform === 'win32') {
      expect(() => writeOut(base, 'gen/angular:library.md', 'tresc')).toThrow(/nie przeżyła systemu plików/u);
    } else {
      // Dwukropek w nazwie pliku jest w pełni legalny poza NTFS — ta sama ścieżka po prostu się zapisuje.
      expect(() => writeOut(base, 'gen/angular:library.md', 'tresc')).not.toThrow();
    }
  });
});

describe('linia', () => {
  it('ścieżka na końcu przeżywa przycinanie', () => {
    const long = 'acme-platform-frontend-portal-shell-feature-checkout-payment-e2e';
    const line = formatOk(`graph ${long}`, ['1 zależność', '0 zależnych', 'świeże', `.ws/graph-${long}.md`]);
    expect(line.length).toBeLessThanOrEqual(MAX_LINE);
    expect(line.endsWith('.md')).toBe(true);
  });

  it('werdykt świeżości przeżywa przycinanie — cisza znaczy „świeże”, więc nie wolno jej udawać', () => {
    const targets = Array.from({ length: 44 }, (_, i) => `e2e-ci--src-checkout-${String(i)}.spec.ts`).join(' ');
    const line = formatOk('projects portal-e2e', ['app', 'apps/portal-e2e', targets, 'type:app', 'nieświeże']);
    expect(line.length).toBeLessThanOrEqual(MAX_LINE);
    expect(line).toContain('nieświeże');
  });

  it('przycięcie zostawia samotny surogat poza wynikiem', () => {
    // Poprzednia asercja szukała U+FFFD, którego JS w tym miejscu nigdy nie wstawia — przechodziła
    // także po usunięciu całego mechanizmu.
    const cut = sliceUnits(`${'a'.repeat(9)}😀`, 10);
    expect(/[\uD800-\uDBFF]$/u.test(cut)).toBe(false);
    expect([...cut].length).toBe(9);
  });

  it('gęsta treść mieści się w budżecie TOKENÓW, nie tylko znaków', () => {
    const dense = [
      formatOk('affected', ['3/3', '1 plik', 'ac7009fd885e...HEAD', 'świeże', '.ws/affected.md']),
      formatOk('projects portal-e2e', [
        'app',
        'apps/portal-e2e',
        Array.from({ length: 44 }, (_, i) => `e2e-ci--src-checkout-${String(i)}.spec.ts`).join(' '),
        'type:app',
        'nieświeże',
      ]),
      formatOk('graph acme-platform-frontend-portal-shell-feature-checkout', [
        '12 zależności',
        'świeże',
        '.ws/graph-acme-platform-frontend-portal-shell-feature-checkout.md',
      ]),
    ];
    for (const line of dense) {
      expect(line.length, line).toBeLessThanOrEqual(MAX_LINE);
      expect(encode(line).length, line).toBeLessThanOrEqual(MAX_TOKENS);
    }
  });
});

describe('log z `run`', () => {
  it('niedomknięty OSC nie zjada błędów kompilatora', () => {
    const log = `Building${ESC}]\napps/x.ts(1,1): error TS2304: brak\nkoniec${BEL}\nostatnia`;
    const cleaned = stripAnsi(log);
    expect(cleaned).toContain('error TS2304');
    expect(errorSummary(cleaned).total).toBe(1);
  });

  it('nazwy PRZECHODZĄCYCH testów i podsumowania nie są błędami', () => {
    const log = [
      '✔ handles error responses gracefully (12 ms)',
      '✔ retries once when the request failed (4 ms)',
      'Test Suites: 1 failed, 13 passed, 14 total',
      'Tests:       1 failed, 127 passed, 128 total',
      'chunk-A.js | error-page | 12.00 kB',
      'Errors are handled by the retry helper',
      'apps/portal/src/app/x.ts(12,5): error TS2322: typ nie pasuje',
    ].join('\n');
    expect(errorSummary(log)).toEqual({
      shown: ['apps/portal/src/app/x.ts(12,5): error TS2322: typ nie pasuje'],
      total: 1,
    });
  });

  it('licznik błędów jest PEŁNY, a pokazane są pierwsze pięć', () => {
    const log = Array.from({ length: 147 }, (_, i) => `src/a${String(i)}.ts(1,1): error TS2345: x`).join('\n');
    const summary = errorSummary(log);
    expect(summary.total).toBe(147);
    expect(summary.shown).toHaveLength(5);
  });
});

describe('źródło modelu', () => {
  it('brak nx.json I brak angular.json to FAIL, nie „0 projektów, świeże”', () => {
    const root = workspace('nx-angular');
    rmSync(path.join(root, 'nx.json'));
    const detected = detect(root);
    expect(detected.supported).toBe(true); // @angular/core jest zainstalowany
    expect(() => loadModel({ root, detected })).toThrow(/brak angular\.json/u);
    // A przez main() to jedna linia FAIL, nie sfabrykowana odpowiedź.
    const result = main(['projects', '--root', root], { cwd: root });
    expect(result.exit).toBe(1);
    expect(result.line.startsWith('FAIL ')).toBe(true);
  });

  it('uszkodzony angular.json to FAIL wskazujący składnię, nie pusty workspace', () => {
    const root = workspace('angular-only');
    writeFileSync(path.join(root, 'angular.json'), '{"projects":{"a":{"root":""},}}', 'utf8');
    const result = main(['projects', '--root', root], { cwd: root });
    expect(result.exit).toBe(1);
    expect(result.line).toContain('angular.json');
  });
});

describe('kody wyjścia', () => {
  it('pusty wynik `gen` i `guide` to kod 0 — plik powstał i jest poprawny', () => {
    const root = workspace('nx-angular');
    const gen = main(['gen', 'nie-ma-takiego-wzorca', '--root', root], { cwd: root });
    expect(gen.exit).toBe(0);
    expect(gen.line.startsWith('ok ')).toBe(true);
    expect(readFileSync(path.join(root, '.ws', 'gen.md'), 'utf8')).toContain('Generatory');

    const guide = main(['guide', '--root', root], { cwd: root });
    expect(guide.exit).toBe(0);
    expect(guide.line.startsWith('ok ')).toBe(true);
  });

  it('linia `ok …` nigdy nie wychodzi z kodem różnym od zera', () => {
    const root = workspace('nx-angular');
    for (const argv of [['env'], ['projects'], ['gen'], ['guide'], ['graph', 'portal']]) {
      const result = main([...argv, '--root', root], { cwd: root });
      const okLine = result.line.startsWith('ok ');
      expect(okLine === (result.exit === 0), `${argv.join(' ')} → ${result.line} (exit ${String(result.exit)})`).toBe(
        true,
      );
    }
  });
});

describe('parser i komunikaty', () => {
  it('flaga z wartością nie połyka następnej flagi', () => {
    // `--root --deep` ustawiało root na napis `--deep` i po cichu gubiło `--deep`: dwie złe rzeczy
    // z jednej literówki, żadna zgłoszona.
    expect(() => parseArgs(['projects', '--root', '--deep'])).toThrow(/wymaga wartości/u);
    const both = parseArgs(['projects', '--root', 'D:/w', '--deep']);
    expect(both.flags).toEqual({ root: 'D:/w', deep: true });
  });

  it('`help <literówka>` kończy się tym samym kodem co sama literówka', () => {
    expect(main(['help', 'projcts'], { cwd: process.cwd() }).exit).toBe(2);
    expect(main(['help', 'projects'], { cwd: process.cwd() }).exit).toBe(0);
    expect(main(['help'], { cwd: process.cwd() }).exit).toBe(0);
  });

  it('`version` odpowiada wersją, nie helpem', () => {
    expect(main(['version'], { cwd: process.cwd(), version: '9.9.9' })).toEqual({ line: '9.9.9', exit: 0 });
  });
});

describe('kształty, których nie piszemy my', () => {
  it('`tags` jako napis nie rozsypuje się na znaki, a jako liczba nie rzuca', () => {
    const one = indexGraph({ nodes: { a: { data: { root: 'a', tags: 'scope:shared' } } }, dependencies: {} });
    expect(one.projects[0].tags).toEqual([]);
    expect(() => indexGraph({ nodes: { a: { data: { root: 'a', tags: 5 } } }, dependencies: {} })).not.toThrow();
  });

  it('jawnie pusta lista sharedGlobals znaczy „nic nie jest wspólne”, a nie „użyj domyślnych”', () => {
    expect(sharedGlobals({ namedInputs: { sharedGlobals: [] } })).toEqual([]);
    // Brak deklaracji to nadal domyślne.
    expect(sharedGlobals({}).length).toBeGreaterThan(0);
  });
});

describe('git', () => {
  it('zmiana nazwy pliku pokazuje OBIE ścieżki — projekt źródłowy też jest dotknięty', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'nxai-mv-'));
    made.push(dir);
    const git = (/** @type {string[]} */ args) =>
      spawnSync('git', args, { cwd: dir, shell: false, windowsHide: true, encoding: 'utf8' });
    git(['init', '-q', '-b', 'main']);
    git(['config', 'user.email', 'test@example.invalid']);
    git(['config', 'user.name', 'test']);
    git(['config', 'commit.gpgsign', 'false']);
    mkdirSync(path.join(dir, 'libs', 'a'), { recursive: true });
    mkdirSync(path.join(dir, 'libs', 'b'), { recursive: true });
    writeFileSync(path.join(dir, 'libs', 'a', 'x.ts'), 'export const x = 1;\n', 'utf8');
    git(['add', '-A']);
    git(['commit', '-qm', 'base']);
    git(['checkout', '-qb', 'feature']);
    git(['mv', 'libs/a/x.ts', 'libs/b/x.ts']);
    git(['commit', '-qm', 'przeniesienie']);

    const result = changedFiles(dir, 'main');
    expect(result.files.sort()).toEqual(['libs/a/x.ts', 'libs/b/x.ts']);
  });
});

describe('log procesu', () => {
  it('stdout i stderr są sklejane przez nową linię, nie zrastane', () => {
    // Ostatnia niezakończona linia stdout zrastała się z pierwszą linią stderr — a to właśnie tam
    // kompilator zwykle stawia błąd.
    const root = workspace();
    const result = runTarget(root, 'portal', 'build');
    for (const line of result.log.split('\n')) {
      expect(line.includes('error TS2322') && line.includes('error TS2304')).toBe(false);
    }
  });
});

describe('ścieżki', () => {
  it('relPath skraca także przy innej wielkości liter w środku ścieżki', () => {
    const shown = relPath('D:/Github/repo/.ws/projects.md', 'D:/github/repo');
    expect(shown).toBe(process.platform === 'win32' ? '.ws/projects.md' : 'D:/Github/repo/.ws/projects.md');
  });
});
