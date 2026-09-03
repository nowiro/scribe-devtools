// The six fixtures the threshold is proven against. Three positive branches of the detection rule,
// three negative ones of the threshold — and the three negative ones are the only thing that makes
// "we support only nx >= 23 and angular >= 22" more than a sentence in a document.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { detect, installedVersion, major, MIN_ANGULAR, MIN_NX, versionParts } from '../src/detect.mjs';
import { findRoot, walkUp } from '../src/paths.mjs';
import { KINDS, makeWorkspace } from '../fixtures/generate.mjs';

/** @type {string} */
let base;
/** @type {Record<string, string>} */
const ws = {};

beforeAll(() => {
  base = mkdtempSync(path.join(tmpdir(), 'nxai-detect-'));
  for (const kind of KINDS) ws[kind] = makeWorkspace(path.join(base, kind), kind);
});

afterAll(() => {
  rmSync(base, { recursive: true, force: true });
});

describe('detekcja — trzy gałęzie pozytywne', () => {
  it('nx-only: nx.json wystarcza, Angulara nie ma', () => {
    const found = detect(ws['nx-only']);
    expect(found.supported).toBe(true);
    expect(found.nx).toMatchObject({ present: true, version: '23.1.1', major: 23, evidence: 'nx.json' });
    expect(found.angular.present).toBe(false);
  });

  it('angular-only: angular.json bez nx.json', () => {
    const found = detect(ws['angular-only']);
    expect(found.supported).toBe(true);
    expect(found.nx.present).toBe(false);
    expect(found.angular).toMatchObject({ present: true, version: '22.1.3', evidence: 'angular.json' });
  });

  it('nx-angular: BEZ angular.json — Angular rozpoznany po @angular/core, czyli realny kształt', () => {
    const found = detect(ws['nx-angular']);
    expect(found.supported).toBe(true);
    expect(found.nx.present).toBe(true);
    expect(found.angular).toMatchObject({ present: true, evidence: '@angular/core' });
  });
});

describe('próg wsparcia — trzy gałęzie negatywne', () => {
  it('nx 22 → FAIL nazywający wymaganie', () => {
    const found = detect(ws['nx-too-old']);
    expect(found.supported).toBe(false);
    expect(found.reason).toBe(`wymagane nx >= ${String(MIN_NX)}`);
  });

  it('angular 21 → FAIL nazywający wymaganie', () => {
    const found = detect(ws['angular-too-old']);
    expect(found.supported).toBe(false);
    expect(found.reason).toBe(`wymagane angular >= ${String(MIN_ANGULAR)}`);
  });

  it('czyste npm workspaces → FAIL, bez trzeciej gałęzi ekosystemowej', () => {
    const found = detect(ws['plain-npm']);
    expect(found.supported).toBe(false);
    expect(found.reason).toBe('ani Nx, ani Angular — brak wsparcia');
  });
});

describe('próg — przypadki, które nie są ani wersją, ani brakiem', () => {
  it('nx.json bez zainstalowanego nx to FAIL wskazujący instalację, nie zgadywanie wersji', () => {
    const dir = path.join(base, 'nx-not-installed');
    makeWorkspace(dir, 'nx-only');
    rmSync(path.join(dir, 'node_modules', 'nx'), { recursive: true, force: true });
    const found = detect(dir);
    expect(found.supported).toBe(false);
    expect(found.reason).toContain('nie jest zainstalowany');
  });

  it('uszkodzony package.json zależności czyta się jak brak, nie jak wyjątek', () => {
    const dir = path.join(base, 'nx-broken-manifest');
    makeWorkspace(dir, 'nx-only');
    writeFileSync(path.join(dir, 'node_modules', 'nx', 'package.json'), '{ to nie jest json', 'utf8');
    expect(installedVersion(dir, 'nx')).toBeNull();
    expect(detect(dir).supported).toBe(false);
  });

  it('próg jest podłogą, nie sufitem: nx 24 przechodzi', () => {
    const dir = path.join(base, 'nx-future');
    makeWorkspace(dir, 'nx-only');
    writeFileSync(
      path.join(dir, 'node_modules', 'nx', 'package.json'),
      JSON.stringify({ name: 'nx', version: '24.0.0' }),
      'utf8',
    );
    expect(detect(dir).supported).toBe(true);
  });
});

describe('major', () => {
  it('czyta wiodącą liczbę, także z prerelease', () => {
    expect(major('23.1.1')).toBe(23);
    expect(major('22.0.0-next.3')).toBe(22);
    expect(major('7')).toBe(7);
    expect(major(null)).toBeNull();
    expect(major('workspace:*')).toBeNull();
  });
});

describe('szukanie korzenia', () => {
  it('wchodzi w górę do nx.json, a nie zatrzymuje się na package.json projektu', () => {
    const root = ws['nx-angular'];
    expect(findRoot(path.join(root, 'apps', 'portal'))).toBe(root);
  });

  it('bez nx.json i angular.json cofa się do najbliższego package.json', () => {
    const root = ws['plain-npm'];
    expect(findRoot(path.join(root, 'packages', 'tool'))).toBe(path.join(root, 'packages', 'tool'));
  });

  it('walkUp zwraca null, gdy pliku nie ma nigdzie w górę', () => {
    expect(walkUp(base, 'na-pewno-nie-ma-takiego-pliku.json')).toBeNull();
  });
});

describe('versionParts', () => {
  it('podaje tylko te połówki, które istnieją', () => {
    expect(versionParts(detect(ws['nx-only']))).toEqual(['nx 23.1.1']);
    expect(versionParts(detect(ws['angular-only']))).toEqual(['ng 22.1.3']);
    expect(versionParts(detect(ws['nx-angular']))).toEqual(['nx 23.1.1', 'ng 22.1.3']);
  });
});
