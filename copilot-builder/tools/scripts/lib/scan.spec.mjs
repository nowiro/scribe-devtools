import { describe, expect, it } from 'vitest';
import { SKIP_ANYWHERE, SKIP_AT_ROOT, skipDirectory } from './scan.mjs';

describe('skipDirectory', () => {
  it('refuses the never-source names at every depth', () => {
    for (const name of SKIP_ANYWHERE) {
      expect(skipDirectory(name, 0)).toBe(true);
      expect(skipDirectory(name, 3)).toBe(true);
    }
  });

  it('refuses generated names only among the direct children of the walk root', () => {
    // This is the whole point of the split: the same word is a generated directory at the top of a
    // workspace and an ordinary feature folder inside src/.
    for (const name of SKIP_AT_ROOT) {
      expect(skipDirectory(name, 0)).toBe(true);
      expect(skipDirectory(name, 1)).toBe(false);
      expect(skipDirectory(name, 4)).toBe(false);
    }
  });

  it('lets a caller add its own never-enter names without touching the shared lists', () => {
    const notAModule = ['fixtures', 'test'];
    expect(skipDirectory('test', 2, notAModule)).toBe(true);
    expect(skipDirectory('fixtures', 0, notAModule)).toBe(true);
    // and the caller's policy does not leak into the shared answer
    expect(skipDirectory('test', 2)).toBe(false);
  });

  it('matches whole names, never prefixes', () => {
    expect(skipDirectory('reports', 0)).toBe(true);
    expect(skipDirectory('reporting', 0)).toBe(false);
    expect(skipDirectory('node_modules_old', 2)).toBe(false);
    expect(skipDirectory('distribution', 1)).toBe(false);
  });

  it('keeps the two lists disjoint, so one name has one rule', () => {
    expect(SKIP_ANYWHERE.filter((name) => SKIP_AT_ROOT.includes(name))).toEqual([]);
  });
});
