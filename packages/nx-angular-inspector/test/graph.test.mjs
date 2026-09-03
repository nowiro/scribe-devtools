// The graph parser and the freshness stamp — the two places where a wrong answer would be a
// CONFIDENT wrong answer, which is the only kind that matters here.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  indexGraph,
  inferredTargets,
  KNOWN_VERSIONS,
  matchProjects,
  readGraph,
  UnsupportedGraph,
} from '../src/graph.mjs';
import { inputSet, mtime, ROOT_INPUTS, stampGraph } from '../src/stamp.mjs';
import { graphFileContent, makeWorkspace } from '../fixtures/generate.mjs';

/** @type {string[]} */
const made = [];

/** @param {string} kind @returns {string} */
function fixture(kind) {
  const dir = mkdtempSync(path.join(tmpdir(), 'nxai-graph-'));
  made.push(dir);
  return makeWorkspace(path.join(dir, kind), kind);
}

afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const PROJECTS = [
  { name: 'portal', type: 'application', root: 'apps/portal', targets: ['build', 'lint'], tags: ['type:app'] },
  { name: 'ui-kit', type: 'library', root: 'libs/ui-kit', targets: ['build'], tags: [] },
];

describe('parser grafu', () => {
  it('czyta projekty, targety i tagi, posortowane', () => {
    const graph = indexGraph(graphFileContent(PROJECTS, { portal: ['ui-kit'] }));
    expect(graph.projects.map((p) => p.name)).toEqual(['portal', 'ui-kit']);
    expect(graph.projects[0]).toMatchObject({ type: 'app', root: 'apps/portal', targets: ['build', 'lint'] });
  });

  it('odrzuca krawędzie zewnętrzne i zostawia wewnętrzne', () => {
    const graph = indexGraph(graphFileContent(PROJECTS, { portal: ['ui-kit'] }));
    expect(graph.dependsOn.get('portal')).toEqual(['ui-kit']);
    expect(graph.dependedOnBy.get('ui-kit')).toEqual(['portal']);
    // Dwa wpisy `npm:@angular/core` weszły do surowych, ani jeden do wewnętrznych.
    expect(graph.rawEdges).toBe(3);
    expect(graph.internalEdges).toBe(1);
  });

  it('nie robi z projektu jego własnej zależności', () => {
    const graph = indexGraph(graphFileContent(PROJECTS, { portal: ['portal', 'ui-kit'] }));
    expect(graph.dependsOn.get('portal')).toEqual(['ui-kit']);
  });

  it('nieznana wersja to UnsupportedGraph, nie próba parsowania', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'nxai-ver-'));
    made.push(dir);
    const file = path.join(dir, 'g.json');
    writeFileSync(file, JSON.stringify({ version: '7.0', nodes: {}, dependencies: {} }), 'utf8');
    expect(() => readGraph(file)).toThrow(UnsupportedGraph);
    expect(KNOWN_VERSIONS).toEqual(['6.0']);
  });

  it('czyta też kształt z `nx graph --file`, gdzie wszystko siedzi pod `graph`', () => {
    const wrapped = { graph: graphFileContent(PROJECTS, {}) };
    expect(indexGraph(wrapped.graph).projects).toHaveLength(2);
  });
});

describe('targety z pluginów — powód, dla którego nie czytamy project.json', () => {
  it('liczy, ile targetów NIE jest zadeklarowanych w project.json', () => {
    const root = fixture('nx-only');
    const graph = readGraph(path.join(root, '.nx', 'workspace-data', 'project-graph.json'));
    const counted = inferredTargets(graph, root.replaceAll('\\', '/'), (file) => {
      try {
        return JSON.parse(readFileSync(file, 'utf8'));
      } catch {
        return null;
      }
    });
    // Fixture deklaruje wyłącznie `build` w każdym z trzech projektów; reszta istnieje tylko w grafie.
    expect(counted.total).toBe(8);
    expect(counted.inferred).toBe(5);
  });
});

describe('dopasowanie nazw', () => {
  const graph = indexGraph(graphFileContent(PROJECTS, {}));

  it('nazwa dokładna', () => {
    expect(matchProjects(graph, 'portal').map((p) => p.name)).toEqual(['portal']);
  });

  it('glob jest zakotwiczony — `kit` nie trafia w `ui-kit`', () => {
    expect(matchProjects(graph, 'kit')).toEqual([]);
    expect(matchProjects(graph, '*kit').map((p) => p.name)).toEqual(['ui-kit']);
  });

  it('gwiazdka łapie wszystko', () => {
    expect(matchProjects(graph, '*')).toHaveLength(2);
  });
});

describe('stempel świeżości', () => {
  /** @param {string} file @param {number} epochMs */
  const touch = (file, epochMs) => utimesSync(file, epochMs / 1000, epochMs / 1000);
  const graphOf = (/** @type {string} */ root) => path.join(root, '.nx', 'workspace-data', 'project-graph.json');
  const roots = ['apps/portal', 'libs/ui-kit', 'libs/utils'];

  it('graf nowszy niż wszystko → hit', () => {
    const root = fixture('nx-only');
    touch(graphOf(root), Date.now() + 60_000);
    expect(stampGraph({ root, graphPath: graphOf(root), projectRoots: roots }).cache).toBe('hit');
  });

  it('nowszy plik projektu → stale, i stempel mówi KTÓRY', () => {
    const root = fixture('nx-only');
    touch(graphOf(root), Date.now() - 60_000);
    const changed = path.join(root, 'apps', 'portal', 'project.json');
    // W przyszłość, nie na „teraz": fixture zapisał wszystkie pliki w tej samej sekundzie, więc
    // „teraz" nie gwarantuje, że to WŁAŚNIE ten plik jest najnowszy — a test ma sprawdzać regułę,
    // nie kolejność zapisu.
    touch(changed, Date.now() + 60_000);
    const stamp = stampGraph({ root, graphPath: graphOf(root), projectRoots: roots });
    expect(stamp.cache).toBe('stale');
    expect(stamp.newestPath).toBe(changed);
  });

  it('NOWY projekt pod apps/ → stale, bo w zbiorze są katalogi nadrzędne', () => {
    const root = fixture('nx-only');
    // Cały zbiór wejściowy w przeszłość, żeby jedynym świeżym bytem był katalog utworzony niżej.
    // Bez tego test zależy od ziarnistości znaczników czasu systemu plików, a nie od reguły.
    const past = Date.now() - 600_000;
    touch(graphOf(root), past);
    for (const file of inputSet(root, roots)) if (mtime(file) !== null) touch(file, past);
    mkdirSync(path.join(root, 'apps', 'swiezy-projekt'), { recursive: true });
    const stamp = stampGraph({ root, graphPath: graphOf(root), projectRoots: roots });
    expect(stamp.cache).toBe('stale');
    expect(stamp.newestPath).toBe(path.join(root, 'apps'));
  });

  it('brak pliku grafu → miss, nie wyjątek', () => {
    const root = fixture('nx-only');
    rmSync(graphOf(root));
    expect(stampGraph({ root, graphPath: graphOf(root), projectRoots: roots }).cache).toBe('miss');
  });

  it('--fresh → forced, bez liczenia stempla', () => {
    const root = fixture('nx-only');
    const stamp = stampGraph({ root, graphPath: graphOf(root), projectRoots: roots, fresh: true });
    expect(stamp).toMatchObject({ cache: 'forced', statted: 0 });
  });

  it('zbiór wejściowy zawiera korzeń, pliki projektów i katalogi nadrzędne — bez duplikatów', () => {
    // Korzeń przez `path.resolve`, bo na Windows `/w` bez dysku i `path.resolve('/w')` to dwa różne
    // napisy, a test ma sprawdzać zawartość zbioru, nie zapis ścieżki.
    const root = path.resolve('/w');
    const set = inputSet(root, ['apps/portal', 'apps/admin', 'libs/ui']);
    const at = (/** @type {string[]} */ ...parts) => path.join(root, ...parts);
    for (const file of ROOT_INPUTS) expect(set).toContain(at(file));
    expect(set).toContain(at('apps', 'portal', 'project.json'));
    expect(set).toContain(at('apps'));
    expect(set).toContain(at('libs'));
    expect(new Set(set).size).toBe(set.length);
  });

  it('mtime nieistniejącego pliku to null, nie rzut', () => {
    expect(mtime(path.join(tmpdir(), 'na-pewno-nie-ma-tego-pliku'))).toBeNull();
  });
});
