// End to end through `main()`: the exact line, the exit code, and the file the line points at.
// Nothing is mocked — every case runs against a generated workspace on a real filesystem, because
// the two things most likely to be wrong (path handling and freshness) only exist there.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { encode } from 'gpt-tokenizer/encoding/o200k_base';
import { main } from '../src/main.mjs';
import { MAX_LINE } from '../src/print.mjs';
import { KINDS, makeWorkspace } from '../fixtures/generate.mjs';

/** The inherited cap from browser-inspector: 40 o200k tokens per line of stdout. */
const MAX_TOKENS = 40;

/** @type {string} */
let base;
/** @type {Record<string, string>} */
const ws = {};
/** @type {NodeJS.ProcessEnv} */
let env;
/** Counter so each stale-graph case gets a workspace of its own. */
let staleCount = 0;

beforeAll(() => {
  base = mkdtempSync(path.join(tmpdir(), 'nxai-verbs-'));
  for (const kind of KINDS) ws[kind] = makeWorkspace(path.join(base, kind), kind);
  // The graph is written by the generator in the same second as everything else, so nudge it
  // forward once: every `hit` assertion below is about the RULE, not about write ordering.
  for (const kind of ['nx-only', 'nx-angular']) {
    const graph = path.join(ws[kind], '.nx', 'workspace-data', 'project-graph.json');
    const soon = (Date.now() + 60_000) / 1000;
    utimesSync(graph, soon, soon);
  }
  env = { ...process.env, NX_ANGULAR_INSPECTOR_OUT: '' };
});

afterAll(() => {
  rmSync(base, { recursive: true, force: true });
});

/**
 * @param {string} kind
 * @param {readonly string[]} argv
 * @returns {{ line: string, exit: number }}
 */
function run(kind, argv) {
  return main([...argv, '--root', ws[kind]], { cwd: ws[kind], env, now: Date.now() });
}

/** @param {string} kind @param {string} rel */
const outFile = (kind, rel) => path.join(ws[kind], '.ws', ...rel.split('/'));

describe('kontrakt linii — obowiązuje każdą komendę', () => {
  const calls = [
    ['nx-angular', ['env']],
    ['nx-angular', ['projects']],
    ['nx-angular', ['projects', 'portal']],
    ['nx-angular', ['projects', '*kit']],
    ['nx-angular', ['graph', 'portal']],
    ['nx-angular', ['graph', 'utils', '--reverse']],
    ['nx-angular', ['gen']],
    ['nx-angular', ['gen', '@nx/js:library']],
    ['nx-angular', ['guide']],
    ['nx-angular', ['run', 'ui-kit:test']],
    ['nx-angular', ['run', 'portal:build']],
    ['nx-too-old', ['env']],
    ['plain-npm', ['projects']],
  ];

  it.each(calls)('%s %j → jedna linia w budżecie', (kind, argv) => {
    const { line } = run(String(kind), /** @type {string[]} */ (argv));
    expect(line).not.toContain('\n');
    expect(line.length, line).toBeLessThanOrEqual(MAX_LINE);
    expect(encode(line).length, line).toBeLessThanOrEqual(MAX_TOKENS);
    expect(line.startsWith('ok ') || line.startsWith('FAIL ')).toBe(true);
  });
});

describe('próg wsparcia zatrzymuje przed wykonaniem czegokolwiek', () => {
  it('nx 22 → FAIL, kod 1, i ŻADEN plik nie powstaje', () => {
    const { line, exit } = run('nx-too-old', ['projects']);
    expect(exit).toBe(1);
    expect(line).toBe('FAIL projects · wymagane nx >= 23 · nx 22.4.0');
    expect(existsSync(path.join(ws['nx-too-old'], '.ws'))).toBe(false);
  });

  it('angular 21 → FAIL nazywający wersję, którą zastał', () => {
    expect(run('angular-too-old', ['env']).line).toBe('FAIL env · wymagane angular >= 22 · ng 21.2.0');
  });

  it('czyste npm workspaces → FAIL, bez próby zrobienia czegokolwiek z package.json', () => {
    expect(run('plain-npm', ['projects']).line).toBe('FAIL projects · ani Nx, ani Angular — brak wsparcia');
  });
});

describe('projects', () => {
  it('bez argumentu: liczy projekty, mówi ile targetów jest z pluginów, pisze plik', () => {
    const { line, exit } = run('nx-angular', ['projects']);
    expect(exit).toBe(0);
    expect(line).toBe('ok projects · 3 · nx 23.1.1 · 5/8 targetów z pluginów · świeże · .ws/projects.md');
    const written = readFileSync(outFile('nx-angular', 'projects.md'), 'utf8');
    expect(written).toContain('| portal | app | apps/portal | build lint serve | type:app |');
    expect(written).toContain('świeżość: świeże');
  });

  it('z nazwą: linia JEST odpowiedzią, pliku nie ma', () => {
    const before = existsSync(outFile('nx-only', 'projects.md'));
    const { line } = run('nx-only', ['projects', 'portal']);
    expect(line).toBe('ok projects portal · app · apps/portal · build lint serve · type:app');
    expect(existsSync(outFile('nx-only', 'projects.md'))).toBe(before);
  });

  it('glob trafiający JEDEN projekt zachowuje się jak nazwa — linia jest odpowiedzią', () => {
    expect(run('nx-angular', ['projects', '*kit']).line).toBe(
      'ok projects ui-kit · lib · libs/ui-kit · build lint test · type:lib',
    );
  });

  it('glob trafiający kilka: plik i licznik dopasowań', () => {
    expect(run('nx-angular', ['projects', 'u*']).line).toBe('ok projects u* · 2 z 3 · świeże · .ws/projects.md');
  });

  it('nieznany projekt → FAIL i kod 1', () => {
    const { line, exit } = run('nx-angular', ['projects', 'nie-ma-takiego']);
    expect(exit).toBe(1);
    expect(line).toBe('FAIL projects nie-ma-takiego · brak projektu nie-ma-takiego');
  });
});

describe('graph', () => {
  it('liczy obie strony i pisze plik o nazwie projektu', () => {
    expect(run('nx-angular', ['graph', 'portal']).line).toBe(
      'ok graph portal · 2 zależności · 0 zależnych · świeże · .ws/graph-portal.md',
    );
    const written = readFileSync(outFile('nx-angular', 'graph-portal.md'), 'utf8');
    expect(written).toContain('## Zależy od (2)');
    expect(written).toContain('- ui-kit');
    // Krawędź zewnętrzna `npm:@angular/core` nie może się tu pojawić.
    expect(written).not.toContain('npm:');
  });

  it('--reverse odwraca kierunek i mówi o tym na linii', () => {
    expect(run('nx-angular', ['graph', 'utils', '--reverse']).line).toBe(
      'ok graph utils · 2 zależnych (--reverse) · świeże · .ws/graph-utils.md',
    );
  });
});

describe('gen', () => {
  it('bez argumentu: liczy generatory i kolekcje, pomija ukryte', () => {
    const { line } = run('nx-angular', ['gen']);
    expect(line).toBe('ok gen · 1 generator w 1 kolekcji · .ws/gen.md');
    expect(readFileSync(outFile('nx-angular', 'gen.md'), 'utf8')).not.toContain('internal');
  });

  it('z pełną nazwą: digest opcji, wymagane wypisane, plik pod bezpieczną ścieżką', () => {
    const { line } = run('nx-angular', ['gen', '@nx/js:library']);
    expect(line).toBe('ok gen @nx/js:library · 4 opcje · wymagane: directory · .ws/gen/nx-js/library.md');
    const written = readFileSync(outFile('nx-angular', 'gen/nx-js/library.md'), 'utf8');
    expect(written).toContain('| directory | string | tak |');
    expect(written).toContain('| bundler | tsc|swc|none |  | "tsc" |');
  });

  it('nieznany generator → FAIL, kod 1', () => {
    const { line, exit } = run('nx-angular', ['gen', '@nx/js:nie-ma']);
    expect(exit).toBe(1);
    expect(line).toContain('FAIL gen @nx/js:nie-ma');
  });
});

describe('guide', () => {
  it('podaje ścieżki i koszt, nie treść', () => {
    const { line } = run('angular-only', ['guide']);
    expect(line).toMatch(/^ok guide · 1 dokument · \d+ B · \.ws\/guide\.md$/u);
    const written = readFileSync(outFile('angular-only', 'guide.md'), 'utf8');
    expect(written).toContain('node_modules/@angular/core/best-practices.md');
    // Zasada, dla której ta komenda istnieje: plik z zasadami NIE jest tu wklejony.
    expect(written).not.toContain('przykład');
  });
});

describe('env', () => {
  it('mówi wersje, wiek grafu, werdykt i stan demona', () => {
    const { line } = run('nx-angular', ['env']);
    expect(line).toMatch(/^ok env · nx 23\.1\.1 · ng 22\.1\.3 · graf \d+ \S+ · demon brak · świeże · \.ws\/env\.md$/u);
    const written = readFileSync(outFile('nx-angular', 'env.md'), 'utf8');
    expect(written).toContain('nie jest to dowód świeżości');
    expect(written).toContain('Pliki inferujące targety');
  });

  it('workspace bez nx czyta angular.json i nie udaje, że ma graf', () => {
    const { line, exit } = run('angular-only', ['env']);
    expect(exit).toBe(0);
    expect(line).toContain('ng 22.1.3');
    expect(readFileSync(outFile('angular-only', 'env.md'), 'utf8')).toContain('źródło: angular.json');
  });

  it('w workspace z samym angular.json licznik targetow z pluginow NIE pada', () => {
    // 5/5 „z pluginów" o workspace bez ani jednego pluginu to liczba prawdziwa arytmetycznie
    // i fałszywa co do znaczenia: w `angular.json` targety SĄ zadeklarowane, tylko w innym pliku.
    const { line } = run('angular-only', ['projects']);
    expect(line).toBe('ok projects · 2 · ng 22.1.3 · świeże · .ws/projects.md');
  });
});

describe('świeżość na linii', () => {
  // WŁASNY workspace, nie współdzielony `ws['nx-only']`. Poprzednia wersja cofała mtime grafu
  // fixture'u używanego przez cały plik, przez co test `projects <nazwa>` wyżej przechodził
  // WYŁĄCZNIE dlatego, że stoi wcześniej — każde przetasowanie kolejności go czerwieniło.
  /** @returns {string} */
  function stale() {
    const dir = makeWorkspace(path.join(base, `stale-${String(staleCount++)}`), 'nx-only');
    const graph = path.join(dir, '.nx', 'workspace-data', 'project-graph.json');
    const past = (Date.now() - 600_000) / 1000;
    utimesSync(graph, past, past);
    return dir;
  }

  it('nieświeży graf jest nazwany na linii, a komenda I TAK odpowiada', () => {
    const dir = stale();
    const { line, exit } = main(['projects', '--root', dir], { cwd: dir, env });
    expect(exit).toBe(0);
    expect(line).toContain('nieświeże');
    // Mówi o ryzyku, nie odmawia.
    expect(line.startsWith('ok ')).toBe(true);
  });

  it('`projects <nazwa>` też ostrzega — cisza na tej linii znaczy „świeże"', () => {
    const dir = stale();
    const { line } = main(['projects', 'portal', '--root', dir], { cwd: dir, env });
    expect(line).toContain('nieświeże');
    // A na świeżym grafie tego słowa nie ma — inaczej ostrzeżenie nic by nie znaczyło.
    expect(run('nx-angular', ['projects', 'portal']).line).not.toContain('nieśwież');
  });
});

describe('run — jedyna komenda, która coś zmienia', () => {
  it('sukces: czas i ścieżka logu, kod 0', () => {
    const { line, exit } = run('nx-angular', ['run', 'ui-kit:test']);
    expect(exit).toBe(0);
    expect(line).toMatch(/^ok run ui-kit:test · \d+,\d s · \.ws\/run\/ui-kit-test\.log$/u);
  });

  it('porażka: liczba błędów, ścieżka, PIERWSZY błąd — i kod 1', () => {
    const { line, exit } = run('nx-angular', ['run', 'portal:build']);
    expect(exit).toBe(1);
    // Fragment błędu jest PRZYCIęTY: linia niesie wskazówkę, która to awaria, a cały tekst leży
    // w logu jeden odczyt dalej. Limit 120 znaków i limit 40 tokenów to dwa różne limity, a błąd
    // kompilatora obok ścieżki jest dość gęsty, żeby przejść pierwszy i oblać drugi.
    expect(line).toBe(
      'FAIL run portal:build · 2 błędy · .ws/run/portal-build.log · ERROR apps/portal/src/app/x.ts(12,5): e…',
    );
  });

  it('log na dysku jest bez ANSI — to 45-51 % tokenów, których agent i tak nie widzi', () => {
    run('nx-angular', ['run', 'portal:build']);
    const log = readFileSync(outFile('nx-angular', 'run/portal-build.log'), 'utf8');
    expect(log).toContain('error TS2322');
    expect(log).not.toContain(String.fromCharCode(27));
  });

  it('zły kształt argumentu pada, zanim cokolwiek wystartuje', () => {
    const { line, exit } = run('nx-angular', ['run', 'portal']);
    expect(exit).toBe(1);
    expect(line).toBe('FAIL run portal · oczekiwano <projekt>:<target>');
  });
});

describe('affected', () => {
  /**
   * A fixture workspace that is also a git repository, with one commit on `main` and one on a
   * branch touching a leaf library.
   * @returns {string}
   */
  function gitWorkspace() {
    const dir = path.join(base, 'nx-git');
    makeWorkspace(dir, 'nx-only');
    const git = (/** @type {string[]} */ args) =>
      spawnSync('git', args, { cwd: dir, shell: false, windowsHide: true, encoding: 'utf8' });
    git(['init', '-q', '-b', 'main']);
    git(['config', 'user.email', 'test@example.invalid']);
    git(['config', 'user.name', 'test']);
    git(['config', 'commit.gpgsign', 'false']);
    writeFileSync(path.join(dir, '.gitignore'), ['node_modules/', '.nx/', '.ws/', ''].join('\n'), 'utf8');
    git(['add', '-A']);
    git(['commit', '-qm', 'base']);
    git(['checkout', '-qb', 'feature']);
    writeFileSync(path.join(dir, 'libs', 'utils', 'nowy.ts'), 'export const a = 1;\n', 'utf8');
    git(['add', '-A']);
    git(['commit', '-qm', 'zmiana w utils']);
    // Git dotknęło plików po zapisaniu grafu, więc stempel słusznie mówiłby `nieświeże`.
    // Test dotyczy tego, co liczy `affected`, nie tego, co robi `git checkout` z mtime.
    const soon = (Date.now() + 60_000) / 1000;
    utimesSync(path.join(dir, '.nx', 'workspace-data', 'project-graph.json'), soon, soon);
    return dir;
  }

  it('zmiana w libs/utils dotyka utils I wszystkich, którzy od niego zależą', () => {
    const dir = gitWorkspace();
    const { line, exit } = main(['affected', '--root', dir], { cwd: dir, env, now: Date.now() });
    expect(exit).toBe(0);
    expect(line).toBe('ok affected · 3/3 · 1 plik · main...HEAD · świeże · .ws/affected.md');
    const written = readFileSync(path.join(dir, '.ws', 'affected.md'), 'utf8');
    expect(written).toContain('- portal');
    expect(written).toContain('domknięciem zależnych');
  });

  it('brak gita to FAIL nazywający zakres, nie cicha pusta odpowiedź', () => {
    const dir = ws['nx-only'];
    const { line, exit } = main(['affected', '--root', dir, '--base', 'nie-ma'], { cwd: dir, env, now: Date.now() });
    expect(exit).toBe(1);
    expect(line).toContain('FAIL affected');
    expect(line).toContain('nie-ma...HEAD');
  });
});

describe('fallback do CLI — ścieżka, która opuszcza ten proces', () => {
  it('--fresh liczy graf przez `nx graph` i mówi `przeliczone`', () => {
    const { line, exit } = run('nx-angular', ['projects', '--fresh']);
    expect(exit).toBe(0);
    expect(line).toContain('przeliczone');
    expect(line).toContain('3');
  });

  it('nieznana wersja grafu → `nieznany format` i odpowiedź mimo to', () => {
    const dir = path.join(base, 'nx-future-shape');
    makeWorkspace(dir, 'nx-only');
    const graph = path.join(dir, '.nx', 'workspace-data', 'project-graph.json');
    const parsed = JSON.parse(readFileSync(graph, 'utf8'));
    writeFileSync(graph, JSON.stringify({ ...parsed, version: '9.9' }), 'utf8');
    const { line, exit } = main(['projects', '--root', dir], { cwd: dir, env, now: Date.now() });
    expect(exit).toBe(0);
    expect(line).toContain('nieznany format');
    // Zdegradowało się do CLI, nie do złej odpowiedzi: projekty są te same.
    expect(line).toContain('3');
  });
});

describe('help i version', () => {
  it('help nie wymaga workspace', () => {
    const { line, exit } = main(['help'], { cwd: base, env });
    expect(exit).toBe(0);
    expect(line).toContain('nx-angular-inspector env');
  });

  it('nieznana komenda kończy się kodem 2, nie 1 — to inna klasa błędu', () => {
    expect(main(['projcts'], { cwd: base, env }).exit).toBe(2);
  });
});
