// Tests for the dry-run diff. The property that matters: every input line appears exactly
// once in the output (as context, removal or addition) — a diff that drops lines would make
// the dry run lie, and the dry run is the safety mechanism of every write.

import { describe, expect, it } from 'vitest';

import { diffLines } from './line-diff.js';

describe('diffLines()', () => {
  it('equal inputs produce an empty diff', () => {
    expect(diffLines('a\nb', 'a\nb')).toEqual([]);
  });

  it('a changed line shows as - old / + new with surrounding context', () => {
    expect(diffLines('a\nstare\nc', 'a\nnowe\nc')).toEqual(['  a', '- stare', '+ nowe', '  c']);
  });

  it('pure additions and pure removals work at the edges', () => {
    expect(diffLines('a', 'a\nb')).toEqual(['  a', '+ b']);
    expect(diffLines('a\nb', 'b')).toEqual(['- a', '  b']);
  });

  it('every line of both inputs is accounted for — nothing is silently dropped', () => {
    const before = 'jeden\ndwa\ntrzy\ncztery';
    const after = 'zero\ndwa\ncztery\npięć';
    const out = diffLines(before, after);
    const kept = out.filter((l) => l.startsWith('  ')).map((l) => l.slice(2));
    const removed = out.filter((l) => l.startsWith('- ')).map((l) => l.slice(2));
    const added = out.filter((l) => l.startsWith('+ ')).map((l) => l.slice(2));
    expect([...kept, ...removed].sort()).toEqual(before.split('\n').sort());
    expect([...kept, ...added].sort()).toEqual(after.split('\n').sort());
  });

  it('CRLF input diffs equal to its LF twin', () => {
    expect(diffLines('a\r\nb', 'a\nb')).toEqual([]);
  });
});
