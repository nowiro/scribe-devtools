// `affected` is the verb with the most ways to be quietly wrong, so its three steps are tested
// apart: the matcher, the mapping, the closure. The one integration case drives a real `git`,
// because the range syntax is the part a unit test cannot vouch for.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { affectedProjects, changedFiles, DEFAULT_SHARED_GLOBALS, sharedGlobals } from '../src/affected.mjs';
import { globToRegExp, matchesAny, ownerOf } from '../src/glob.mjs';

/** @type {string[]} */
const made = [];

afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const PROJECTS = [
  { name: 'portal', root: 'apps/portal' },
  { name: 'ui', root: 'libs/ui' },
  { name: 'ui-kit', root: 'libs/ui-kit' },
  { name: 'theme', root: 'libs/ui/theme' },
];

/** portal → ui-kit → ui; nothing depends on portal. */
const DEPENDED_ON_BY = new Map([
  ['ui', ['ui-kit']],
  ['ui-kit', ['portal']],
]);

describe('glob — zakotwiczony na segmentach', () => {
  it('gwiazdka NIE przechodzi przez ukośnik — to jest ta pomyłka, która robi z 21 affected 80', () => {
    expect(globToRegExp('tools/testing/**/*.ts').test('tools/scripts/x.spec.mjs')).toBe(false);
    expect(globToRegExp('tools/testing/*.ts').test('tools/testing/a/b.ts')).toBe(false);
    expect(globToRegExp('tools/testing/**/*.ts').test('tools/testing/a/b.ts')).toBe(true);
  });

  it('`**/` łapie także zero segmentów', () => {
    expect(globToRegExp('libs/**/index.ts').test('libs/index.ts')).toBe(true);
    expect(globToRegExp('libs/**/index.ts').test('libs/a/b/index.ts')).toBe(true);
  });

  it('wzorzec bez ukośnika działa na każdej głębokości — tak ludzie piszą sharedGlobals', () => {
    expect(globToRegExp('*.md').test('docs/a.md')).toBe(true);
    expect(globToRegExp('nx.json').test('nx.json')).toBe(true);
    expect(globToRegExp('nx.json').test('apps/nx.json')).toBe(true);
  });

  it('kropka jest kropką, nie dowolnym znakiem', () => {
    expect(globToRegExp('nx.json').test('nxXjson')).toBe(false);
  });

  it('znak zapytania to dokładnie jeden znak wewnątrz segmentu', () => {
    expect(globToRegExp('a?.ts').test('ab.ts')).toBe(true);
    expect(globToRegExp('a?.ts').test('a/.ts')).toBe(false);
  });
});

describe('właściciel pliku — najdłuższy prefiks segmentowy', () => {
  it('zagnieżdżony projekt wygrywa z rodzicem', () => {
    expect(ownerOf('libs/ui/theme/dark.ts', PROJECTS)).toBe('theme');
    expect(ownerOf('libs/ui/button.ts', PROJECTS)).toBe('ui');
  });

  it('`libs/ui` nie zagarnia `libs/ui-kit`', () => {
    expect(ownerOf('libs/ui-kit/a.ts', PROJECTS)).toBe('ui-kit');
  });

  it('plik spoza jakiegokolwiek roota nie ma właściciela', () => {
    expect(ownerOf('README.md', PROJECTS)).toBeNull();
  });
});

describe('sharedGlobals z nx.json', () => {
  it('rozwija token {workspaceRoot} — zostawiony sprawiłby, że nic nigdy nie pasuje', () => {
    expect(sharedGlobals({ namedInputs: { sharedGlobals: [{ fileset: '{workspaceRoot}/nx.json' }] } })).toEqual([
      'nx.json',
    ]);
  });

  it('przyjmuje też gołe napisy i spada na domyślne, gdy nx.json nic nie mówi', () => {
    expect(sharedGlobals({ namedInputs: { sharedGlobals: ['babel.config.json'] } })).toEqual(['babel.config.json']);
    expect(sharedGlobals({})).toEqual([...DEFAULT_SHARED_GLOBALS]);
    expect(sharedGlobals(null)).toEqual([...DEFAULT_SHARED_GLOBALS]);
  });

  it('domyślne łapią plik lockfile i tsconfig.base.json', () => {
    expect(matchesAny('pnpm-lock.yaml', DEFAULT_SHARED_GLOBALS)).toBe(true);
    expect(matchesAny('tsconfig.base.json', DEFAULT_SHARED_GLOBALS)).toBe(true);
    expect(matchesAny('apps/portal/src/main.ts', DEFAULT_SHARED_GLOBALS)).toBe(false);
  });
});

describe('domknięcie zależnych — połowa, o której się zapomina', () => {
  const call = (/** @type {string[]} */ files) =>
    affectedProjects({ files, projects: PROJECTS, dependedOnBy: DEPENDED_ON_BY, shared: DEFAULT_SHARED_GLOBALS });

  it('zmiana w liściu dotyka wszystkiego, co go konsumuje, tranzytywnie', () => {
    expect(call(['libs/ui/button.ts']).projects).toEqual(['portal', 'ui', 'ui-kit']);
  });

  it('zmiana w aplikacji nie dotyka bibliotek', () => {
    expect(call(['apps/portal/src/main.ts']).projects).toEqual(['portal']);
  });

  it('plik niczyj nie dotyka niczego', () => {
    expect(call(['README.md']).projects).toEqual([]);
  });

  it('plik wspólny dotyka wszystkiego i mówi, KTÓRY to był', () => {
    const result = call(['apps/portal/src/main.ts', 'pnpm-lock.yaml']);
    expect(result.sharedHit).toBe('pnpm-lock.yaml');
    expect(result.projects).toEqual(['portal', 'theme', 'ui', 'ui-kit']);
  });

  it('cykl w zależnych nie zapętla domknięcia', () => {
    const cyclic = new Map([
      ['a', ['b']],
      ['b', ['a']],
    ]);
    const result = affectedProjects({
      files: ['libs/a/x.ts'],
      projects: [
        { name: 'a', root: 'libs/a' },
        { name: 'b', root: 'libs/b' },
      ],
      dependedOnBy: cyclic,
      shared: [],
    });
    expect(result.projects).toEqual(['a', 'b']);
  });
});

describe('changedFiles — prawdziwy git', () => {
  /** A repository with two commits on `main` and one on a branch. @returns {string} */
  function repo() {
    const dir = mkdtempSync(path.join(tmpdir(), 'nxai-git-'));
    made.push(dir);
    const git = (/** @type {string[]} */ args) =>
      spawnSync('git', args, { cwd: dir, shell: false, windowsHide: true, encoding: 'utf8' });
    const file = (/** @type {string} */ rel, /** @type {string} */ text) => {
      mkdirSync(path.join(dir, path.dirname(rel)), { recursive: true });
      writeFileSync(path.join(dir, rel), text, 'utf8');
    };
    git(['init', '-q', '-b', 'main']);
    git(['config', 'user.email', 'test@example.invalid']);
    git(['config', 'user.name', 'test']);
    git(['config', 'commit.gpgsign', 'false']);
    file('apps/portal/main.ts', 'a');
    file('libs/ui/button.ts', 'a');
    git(['add', '-A']);
    git(['commit', '-qm', 'base']);
    git(['checkout', '-qb', 'feature']);
    file('libs/ui/button.ts', 'b');
    git(['add', '-A']);
    git(['commit', '-qm', 'zmiana w ui']);
    return dir;
  }

  it('podaje pliki zmienione wobec bazy, ukośnikami w przód', () => {
    const result = changedFiles(repo(), 'main');
    expect(result.ok).toBe(true);
    expect(result.files).toEqual(['libs/ui/button.ts']);
  });

  it('nieznana baza to FAIL z komunikatem gita, nie pusta lista udająca „nic się nie zmieniło”', () => {
    const result = changedFiles(repo(), 'nie-ma-takiej-galezi');
    expect(result.ok).toBe(false);
    expect(result.files).toEqual([]);
    expect(result.error).not.toBe('');
  });

  it('katalog bez repozytorium to FAIL, nie wyjątek', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'nxai-nogit-'));
    made.push(dir);
    expect(changedFiles(dir, 'main').ok).toBe(false);
  });
});
