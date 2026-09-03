// coverage.test.mjs — one case per branch the adversarial review of 2026-09-03 found UNTESTED
// (not wrong — the review's "wysoka"/"średnia" bugs already have their own cases in
// regressions.test.mjs; these are the "the gate does not know this code still works" findings).
//
// Two branches the review named were not tested here: `nxJson`/`stripToJson` in `nxcli.mjs` turned
// out to have exactly one caller, itself — dead in production, not just in tests — so they were
// DELETED instead of tested (`git log` for that change). Testing dead code preserves it; this
// repository's convention is to remove what nothing calls.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { detect } from '../src/detect.mjs';
import { findGuides } from '../src/guide.mjs';
import { indexGraph, matchProjects } from '../src/graph.mjs';
import { globToRegExp } from '../src/glob.mjs';
import { MANIFEST_NAMES, scanGenerators } from '../src/generators.mjs';
import { main } from '../src/main.mjs';
import { runTarget } from '../src/target.mjs';
import { workspaceDataDir } from '../src/paths.mjs';
import { makeWorkspace } from '../fixtures/generate.mjs';

/** @type {string[]} */
const made = [];
/** A fresh directory registered for cleanup, empty or seeded. @param {string} [prefix] */
function tmp(prefix = 'nxai-cov-') {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  made.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('guide — dokumenty workspace, nie tylko z node_modules', () => {
  it('AGENTS.md, CLAUDE.md i copilot-instructions.md są widziane, w tej kolejności, przed pakietami', () => {
    const root = tmp();
    writeFileSync(path.join(root, 'AGENTS.md'), 'a', 'utf8');
    writeFileSync(path.join(root, 'CLAUDE.md'), 'b', 'utf8');
    mkdirSync(path.join(root, '.github'), { recursive: true });
    writeFileSync(path.join(root, '.github', 'copilot-instructions.md'), 'c', 'utf8');
    const docs = findGuides(root);
    expect(docs.map((d) => d.origin)).toEqual(['workspace', 'workspace', 'workspace']);
    expect(docs.map((d) => path.basename(d.file))).toEqual(['AGENTS.md', 'CLAUDE.md', 'copilot-instructions.md']);
  });

  it('drugie miejsce best-practices.md tego samego pakietu jest pominięte — jeden dokument na origin', () => {
    const root = tmp();
    const core = path.join(root, 'node_modules', '@angular', 'core');
    mkdirSync(core, { recursive: true });
    writeFileSync(path.join(core, 'best-practices.md'), 'stąd', 'utf8');
    mkdirSync(path.join(core, 'llms'), { recursive: true });
    writeFileSync(path.join(core, 'llms', 'best-practices.md'), 'nie stąd — pierwsze trafienie wygrywa', 'utf8');
    const docs = findGuides(root);
    expect(docs).toHaveLength(1);
    expect(docs[0].file).toBe(path.join(core, 'best-practices.md'));
  });

  it('brak jakichkolwiek dokumentów to po prostu pusta lista', () => {
    expect(findGuides(tmp())).toEqual([]);
  });
});

describe('dopasowanie wzorców — metaznaki i **', () => {
  it('kropka w nazwie projektu jest literałem, nie „dowolny znak”', () => {
    // Rozróżniające pary: gdyby `.` w `*.b` był nieescapowany (dowolny znak w regexie), wzorzec
    // złapałby też `aXb` — dowolny znak zamiast X i literalne `b`. Escapowany łapie tylko `a.b`.
    const graph = indexGraph({
      nodes: { 'a.b': { data: { root: 'x', targets: {} } }, aXb: { data: { root: 'y', targets: {} } } },
      dependencies: {},
    });
    expect(matchProjects(graph, '*.b').map((p) => p.name)).toEqual(['a.b']);
    expect(matchProjects(graph, 'a.b').map((p) => p.name)).toEqual(['a.b']);
  });

  it('goła `**` na końcu wzorca łapie wszystko pod prefiksem, ale NIE sam prefiks bez ukośnika', () => {
    expect(globToRegExp('libs/shared/**').test('libs/shared/a/b.ts')).toBe(true);
    expect(globToRegExp('libs/shared/**').test('libs/shared/')).toBe(true);
    expect(globToRegExp('libs/shared/**').test('libs/shared')).toBe(false);
  });

  it('kropka w globie plikowym jest literałem — `libs/*.json` nie łapie `libsXa.json`', () => {
    expect(globToRegExp('libs/*.json').test('libs/a.json')).toBe(true);
    expect(globToRegExp('libs/*.json').test('libsXa.json')).toBe(false);
  });
});

describe('generators.mjs — powierzchnia poza jedną kolekcją z fixture', () => {
  /** A synthetic node_modules with several plugin shapes. @returns {string} */
  function fixtureRoot() {
    const root = tmp();
    const write = (/** @type {string} */ rel, /** @type {unknown} */ value) => {
      const file = path.join(root, ...rel.split('/'));
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, JSON.stringify(value), 'utf8');
    };
    // Z-first name, to prove sorting; `generators.json` present (highest MANIFEST_NAMES priority).
    write('node_modules/z-plugin/generators.json', {
      generators: {
        widget: { description: 'Widget.' },
        secret: { description: 'Ukryty.', private: true },
      },
    });
    // `collection.json`, second priority — used only when `generators.json` is absent.
    write('node_modules/@scope/pkg/collection.json', {
      schematics: { component: { description: 'Komponent, pisownia Angulara.', hidden: true } },
    });
    // A package with BOTH spellings in one manifest — the merge, not just the fallback.
    write('node_modules/mixed/generators.json', {
      generators: { fromGenerators: { description: 'nx' } },
      schematics: { fromSchematics: { description: 'angular' } },
    });
    // A directory with no manifest at all — must be silently skipped, not crash the scan.
    mkdirSync(path.join(root, 'node_modules', 'no-manifest'), { recursive: true });
    return root;
  }

  it('MANIFEST_NAMES ma nx first, potem angular, w tej kolejności', () => {
    expect(MANIFEST_NAMES).toEqual(['generators.json', 'collection.json', 'schematics.json']);
  });

  it('generatory są posortowane po collection:name, niezależnie od kolejności na dysku', () => {
    const { generators } = scanGenerators(fixtureRoot());
    const keys = generators.map((g) => `${g.collection}:${g.name}`);
    expect(keys).toEqual([...keys].sort((a, b) => a.localeCompare(b, 'en')));
    expect(keys).toContain('@scope/pkg:component');
  });

  it('`private: true` ukrywa generator tak samo jak `hidden: true`', () => {
    const { generators } = scanGenerators(fixtureRoot());
    const secret = generators.find((g) => g.name === 'secret');
    const component = generators.find((g) => g.name === 'component');
    expect(secret?.hidden).toBe(true);
    expect(component?.hidden).toBe(true); // collection.json + schematics + hidden:true
  });

  it('jeden manifest z obiema pisowniami scala oba zestawy generatorów', () => {
    const { generators } = scanGenerators(fixtureRoot());
    const names = generators.filter((g) => g.collection === 'mixed').map((g) => g.name);
    expect(names.sort()).toEqual(['fromGenerators', 'fromSchematics']);
  });

  it('pakiet bez żadnego manifestu jest pomijany, nie wywala skanu', () => {
    const { generators, collections } = scanGenerators(fixtureRoot());
    expect(generators.some((g) => g.collection === 'no-manifest')).toBe(false);
    expect(collections).toBe(3);
  });
});

describe('paths.mjs — NX_WORKSPACE_DATA_DIRECTORY', () => {
  it('nadpisuje domyślną lokalizację, względem korzenia workspace, nie cwd', () => {
    const root = path.resolve('D:/workspace');
    const relative = workspaceDataDir(root, { NX_WORKSPACE_DATA_DIRECTORY: 'gdzie-indziej' });
    expect(relative).toBe(path.resolve(root, 'gdzie-indziej'));
    const absolute = workspaceDataDir(root, { NX_WORKSPACE_DATA_DIRECTORY: 'D:/inny-dysk/dane' });
    expect(absolute).toBe(path.resolve('D:/inny-dysk/dane'));
  });

  it('pusty string w zmiennej środowiskowej to wciąż wartość domyślna', () => {
    const root = path.resolve('D:/workspace');
    expect(workspaceDataDir(root, { NX_WORKSPACE_DATA_DIRECTORY: '' })).toBe(path.join(root, '.nx', 'workspace-data'));
  });
});

describe('indexGraph — sortowanie na NIEPOSORTOWANYM wejściu', () => {
  it('projekty, targety i tagi wychodzą posortowane, choć weszły w odwrotnej kolejności', () => {
    const graph = indexGraph({
      nodes: {
        zebra: { data: { root: 'z', targets: { test: {}, build: {}, lint: {} }, tags: ['scope:z', 'type:app'] } },
        apple: { data: { root: 'a', targets: { serve: {}, build: {} }, tags: ['type:lib'] } },
        mango: { data: { root: 'm', targets: {} } },
      },
      dependencies: {},
    });
    expect(graph.projects.map((p) => p.name)).toEqual(['apple', 'mango', 'zebra']);
    expect(graph.projects[0].targets).toEqual(['build', 'serve']);
    expect(graph.projects.find((p) => p.name === 'zebra')?.targets).toEqual(['build', 'lint', 'test']);
    expect(graph.projects.find((p) => p.name === 'zebra')?.tags).toEqual(['scope:z', 'type:app']);
  });

  it('dependedOnBy jest posortowane, nie w kolejności odkrycia krawędzi', () => {
    const graph = indexGraph({
      nodes: { a: { data: { root: 'a' } }, b: { data: { root: 'b' } }, c: { data: { root: 'c' } } },
      dependencies: {
        // c i b oba zależą od a; c jest deklarowane PIERWSZE, więc odkrycie-w-kolejności dałoby [c, b].
        c: [{ target: 'a' }],
        b: [{ target: 'a' }],
      },
    });
    expect(graph.dependedOnBy.get('a')).toEqual(['b', 'c']);
  });
});

describe('detect — druga połowa progu Angulara', () => {
  it('angular.json jest, @angular/core nie jest zainstalowany → FAIL wskazujący instalację', () => {
    const root = makeWorkspace(tmp('nxai-noangular-'), 'angular-only');
    rmSync(path.join(root, 'node_modules', '@angular', 'core'), { recursive: true, force: true });
    const found = detect(root);
    expect(found.supported).toBe(false);
    expect(found.reason).toContain('@angular/core nie jest zainstalowany');
  });
});

describe('daemonState — przez `env`, trzy nieoczywiste gałęzie', () => {
  /** @returns {string} */
  function withDaemonDir() {
    const root = makeWorkspace(tmp('nxai-daemon-'), 'nx-only');
    const dir = path.join(root, '.nx', 'workspace-data', 'd');
    mkdirSync(dir, { recursive: true });
    return root;
  }

  it('marker `disabled` → „wyłączony”, nawet gdy server-process.json wskazuje żywy pid', () => {
    const root = withDaemonDir();
    const dir = path.join(root, '.nx', 'workspace-data', 'd');
    writeFileSync(path.join(dir, 'disabled'), '', 'utf8');
    writeFileSync(path.join(dir, 'server-process.json'), JSON.stringify({ processId: process.pid }), 'utf8');
    const { line } = main(['env', '--root', root], { cwd: root });
    expect(line).toContain('demon wyłączony');
  });

  it('server-process.json z pid-em, który naprawdę odpowiada → „pid żyje”', () => {
    const root = withDaemonDir();
    const dir = path.join(root, '.nx', 'workspace-data', 'd');
    // Własny pid tego procesu testowego — bezpieczny, bo na pewno istnieje przez cały test.
    writeFileSync(path.join(dir, 'server-process.json'), JSON.stringify({ processId: process.pid }), 'utf8');
    const { line } = main(['env', '--root', root], { cwd: root });
    expect(line).toContain('demon pid żyje');
  });

  it('server-process.json z pid-em, który nie istnieje → „martwy”', () => {
    const root = withDaemonDir();
    const dir = path.join(root, '.nx', 'workspace-data', 'd');
    writeFileSync(path.join(dir, 'server-process.json'), JSON.stringify({ processId: 0x7ffffff0 }), 'utf8');
    const { line } = main(['env', '--root', root], { cwd: root });
    expect(line).toContain('demon martwy');
  });
});

describe('gen <wzorzec> bez dwukropka — gałąź filtrowania', () => {
  it('wzorzec bez dwukropka filtruje po podciągu `collection:name`, exit 0 nawet przy zerze trafień', () => {
    const root = makeWorkspace(tmp('nxai-genf-'), 'nx-angular');
    const hit = main(['gen', 'library'], { cwd: root, env: { ...process.env, NX_ANGULAR_INSPECTOR_OUT: '' } });
    expect(hit.exit).toBe(0);
    expect(hit.line).toBe('ok gen library · 1 z 1 · .ws/gen.md');

    const miss = main(['gen', 'nie-ma-takiego-wzorca'], {
      cwd: root,
      env: { ...process.env, NX_ANGULAR_INSPECTOR_OUT: '' },
    });
    expect(miss.exit).toBe(0);
    expect(miss.line).toBe('ok gen nie-ma-takiego-wzorca · 0 z 1 · .ws/gen.md');
  });
});

describe('run — gałęzie bez rozpoznanych błędów, bez nx, i timeout', () => {
  it('kod wyjścia różny od zera, ale bez linii pasującej do ERROR_SHAPES → „kod N”, nie zero błędów udawane za sukces', () => {
    const root = makeWorkspace(tmp('nxai-runcode-'), 'nx-angular');
    const { line, exit } = main(['run', 'utils:fail-plain'], {
      cwd: root,
      env: { ...process.env, NX_ANGULAR_INSPECTOR_OUT: '' },
    });
    expect(exit).toBe(1);
    expect(line).toBe('FAIL run utils:fail-plain · kod 7 · .ws/run/utils-fail-plain.log');
  });

  it('workspace bez zainstalowanego nx → FAIL nazywający brak instalacji, nie awaria spawn', () => {
    const root = makeWorkspace(tmp('nxai-runnonx-'), 'nx-angular');
    rmSync(path.join(root, 'node_modules', 'nx'), { recursive: true, force: true });
    const { line, exit } = main(['run', 'portal:build'], {
      cwd: root,
      env: { ...process.env, NX_ANGULAR_INSPECTOR_OUT: '' },
    });
    expect(exit).toBe(1);
    expect(line).toContain('nx nie jest zainstalowany');
  });

  it('target, który nigdy się nie kończy, daje PRAWDZIWY ETIMEDOUT — zweryfikowane na milisekundowym budżecie', () => {
    const root = makeWorkspace(tmp('nxai-runtimeout-'), 'nx-angular');
    const result = runTarget(root, 'utils', 'hang', process.env, 300);
    expect(result.status).toBe(1);
    expect(result.error).toContain('budżet czasu (300 ms)');
  }, 15_000);
});

describe('affected — plik wspólny na linii i defaultBase z nx.json, bez --base', () => {
  /** @returns {string} */
  function gitWorkspace() {
    const dir = makeWorkspace(tmp('nxai-shared-'), 'nx-only');
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
    // nx.json jest w DEFAULT_SHARED_GLOBALS — ta zmiana ma dotknąć WSZYSTKICH projektów.
    writeFileSync(path.join(dir, 'nx.json'), JSON.stringify({ defaultBase: 'main', touched: true }), 'utf8');
    git(['add', '-A']);
    git(['commit', '-qm', 'zmiana pliku wspólnego']);
    return dir;
  }

  it('bez --base bierze defaultBase z nx.json, a plik wspólny oznacza WSZYSTKIE projekty na linii', () => {
    const dir = gitWorkspace();
    // Bez --base: base ma pochodzić z nx.json (`defaultBase: 'main'`), nie z twardo wpisanego 'main'
    // po stronie testu — inny defaultBase w fixture zmieniłby tę linię, gdyby kod tego nie czytał.
    const { line, exit } = main(['affected', '--root', dir], { cwd: dir });
    expect(exit).toBe(0);
    expect(line).toContain('wspólny nx.json');
    expect(line).toContain('main...HEAD');
    const written = readFileSync(path.join(dir, '.ws', 'affected.md'), 'utf8');
    expect(written).toContain('WSZYSTKIE projekty');
  });
});

describe('main.mjs — --root w podkatalogu, i łapanie nieoczekiwanego wyjątku', () => {
  it('--root wskazujący podkatalog workspace nadal trafia w prawdziwy korzeń', () => {
    const root = makeWorkspace(tmp('nxai-subdir-'), 'nx-angular');
    const sub = path.join(root, 'apps', 'portal');
    const { line, exit } = main(['projects', '--root', sub], { cwd: sub });
    expect(exit).toBe(0);
    expect(line).toContain('ok projects · 3');
  });

  it('wyjątek zgłoszony z wnętrza runnera kończy się JEDNĄ linią FAIL, nie stosem wywołań na stdout', () => {
    const root = makeWorkspace(tmp('nxai-blocked-'), 'nx-angular');
    // Plik dokładnie tam, gdzie writeOut musi utworzyć katalog .ws/ — mkdirSync rzuci EEXIST/ENOTDIR,
    // main() musi to złapać i sprowadzić do kontraktu jednej linii, tak jak każdy inny błąd.
    writeFileSync(path.join(root, '.ws'), 'jestem plikiem, nie katalogiem', 'utf8');
    const result = main(['env', '--root', root], { cwd: root });
    expect(result.exit).toBe(1);
    expect(result.line.split('\n')).toHaveLength(1);
    expect(result.line.startsWith('FAIL env')).toBe(true);
  });
});
