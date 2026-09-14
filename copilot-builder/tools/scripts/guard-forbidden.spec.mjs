import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  FORBIDDEN_PATHS,
  FORBIDDEN_WORDS,
  IGNORE_MARK,
  findForbiddenWords,
  guardForbidden,
} from './guard-forbidden.mjs';

// The forbidden words are never spelled in this file: the gate reads it like any other tracked file.
const [WORD] = FORBIDDEN_WORDS[0];

describe('findForbiddenWords', () => {
  it('flags the word as a whole word in any case, with the line number', () => {
    const text = `clean line\n.${WORD}/x\n${WORD.toUpperCase()}-DEVTOOLS\n${WORD}_TOKEN=1`;
    const found = findForbiddenWords(text, 'a.md');
    expect(found.map((line) => line.split(' · ')[0])).toEqual(['a.md:2', 'a.md:3', 'a.md:4']);
    expect(found[0]).toContain(FORBIDDEN_WORDS[0][1]);
  });

  it('lets a longer word that merely contains it pass', () => {
    expect(findForbiddenWords(`de${WORD}('x')\nsub${WORD}s\naria-de${WORD}dby`, 'a.mjs')).toEqual([]);
  });

  it('flags the path and skips a line carrying the ignore marker', () => {
    const found = findForbiddenWords(`x ${WORD} y // ${IGNORE_MARK}`, `tools/${WORD}/read.mjs`);
    expect(found).toHaveLength(1);
    expect(found[0]).toContain('path carries');
  });
});

describe('guardForbidden', () => {
  /** @type {string} */
  let dir;
  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'cb-forbidden-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('is green on a clean tree', () => {
    writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ scripts: { lint: 'eslint .' } }), 'utf8');
    writeFileSync(path.join(dir, 'README.md'), 'describe the tool\n', 'utf8');
    expect(guardForbidden(dir, ['package.json', 'README.md'])).toEqual({ ok: true, problems: [], scanned: 2 });
  });

  it('reports a forbidden path, package, npx call and word, and skips binaries', () => {
    mkdirSync(path.join(dir, '.claude'));
    const manifest = { scripts: { x: 'npx foo' }, devDependencies: { prettier: '3.0.0' } };
    writeFileSync(path.join(dir, 'package.json'), JSON.stringify(manifest), 'utf8');
    writeFileSync(path.join(dir, 'notes.md'), `see .${WORD}/\n`, 'utf8');
    writeFileSync(path.join(dir, 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]));
    const { ok, problems, scanned } = guardForbidden(dir, ['package.json', 'notes.md', 'logo.png', 'gone.md']);
    expect(ok).toBe(false);
    expect(scanned).toBe(2);
    expect(problems.some((p) => p.startsWith('.claude exists'))).toBe(true);
    expect(problems.some((p) => p.includes('declares prettier'))).toBe(true);
    expect(problems.some((p) => p.includes('`npx`'))).toBe(true);
    expect(problems.some((p) => p.startsWith('notes.md:1 ·'))).toBe(true);
  });

  it('fails loudly when the tracked-file list is unavailable instead of scanning nothing', () => {
    const { ok, problems } = guardForbidden(dir, null);
    expect(ok).toBe(false);
    expect(problems).toEqual(['git ls-files failed — the forbidden-word scan needs a git checkout']);
  });

  it('keeps the path list validate-ai-config shares', () => {
    expect(FORBIDDEN_PATHS.map(([rel]) => rel)).toContain('.claude');
  });
});
