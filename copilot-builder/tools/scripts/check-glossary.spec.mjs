import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseMappings, resolveMapping } from './check-glossary.mjs';

const TABLE = [
  '| Pojęcie | Znaczenie | W kodzie | Nie mylić z |',
  '| --- | --- | --- | --- |',
  '| `alias biblioteki` | jedyna droga importu | `tools/scripts/new-project.mjs#newLibrary`, `libs/` | ścieżka względna |',
  '| bramka | jedna kontrola | `npm run verify` | hook |',
  '',
  'Prose after the table is not a row.',
].join('\n');

describe('parseMappings', () => {
  it('collects every backticked reference of the third column, stripping backticks from the term', () => {
    expect(parseMappings(TABLE)).toEqual([
      { term: 'alias biblioteki', ref: 'tools/scripts/new-project.mjs#newLibrary' },
      { term: 'alias biblioteki', ref: 'libs/' },
      { term: 'bramka', ref: 'npm run verify' },
    ]);
  });

  it('ignores lines that are not table rows', () => {
    expect(parseMappings('| a |\n| b |\n')).toEqual([]);
  });
});

describe('resolveMapping', () => {
  /** @type {string} */
  let repo;
  beforeEach(() => {
    repo = mkdtempSync(path.join(os.tmpdir(), 'cb-glossary-'));
    mkdirSync(path.join(repo, 'tools'), { recursive: true });
    writeFileSync(path.join(repo, 'tools', 'x.mjs'), 'export function newLibrary() {}\n', 'utf8');
  });
  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  it('accepts an existing file, an existing symbol and a directory', () => {
    expect(resolveMapping(repo, { term: 't', ref: 'tools/x.mjs' })).toBeNull();
    expect(resolveMapping(repo, { term: 't', ref: 'tools/x.mjs#newLibrary' })).toBeNull();
    expect(resolveMapping(repo, { term: 't', ref: 'tools/' })).toBeNull();
  });

  it('names the missing file or symbol', () => {
    expect(resolveMapping(repo, { term: 't', ref: 'tools/gone.mjs' })).toContain('does not exist');
    expect(resolveMapping(repo, { term: 't', ref: 'tools/x.mjs#oldName' })).toContain('no longer contains');
  });

  it('does not check commands', () => {
    expect(resolveMapping(repo, { term: 't', ref: 'npm run verify' })).toBeNull();
  });
});
