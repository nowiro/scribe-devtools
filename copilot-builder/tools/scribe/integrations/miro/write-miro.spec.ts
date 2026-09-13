// Tests for the Miro write pipeline: the mode interlock, the bullet→note split (the one
// rule with room for surprise, so it is pinned hard), the grid layout and the payloads.

import { describe, expect, it } from 'vitest';

import { WriteMeta, buildNotePayload, notePosition, splitNotes } from './write-miro.js';

describe('WriteMeta — mode interlocks', () => {
  it('create: boardId alone, optionally frameId and color', () => {
    expect(WriteMeta.safeParse({ boardId: 'uXjVN2wR8sY=' }).success).toBe(true);
    expect(WriteMeta.safeParse({ boardId: 'uXjVN2wR8sY=', frameId: '345', color: 'light_yellow' }).success).toBe(true);
  });

  it('update: itemId — and then frameId/color are refused (text-only update)', () => {
    expect(WriteMeta.safeParse({ boardId: 'uXjVN2wR8sY=', itemId: '99' }).success).toBe(true);
    expect(WriteMeta.safeParse({ boardId: 'uXjVN2wR8sY=', itemId: '99', color: 'red' }).success).toBe(false);
    expect(WriteMeta.safeParse({ boardId: 'uXjVN2wR8sY=', itemId: '99', frameId: '1' }).success).toBe(false);
  });

  it('boardId is always required; unknown keys are named', () => {
    expect(WriteMeta.safeParse({}).success).toBe(false);
    expect(WriteMeta.safeParse({ boardId: 'uXjVN2wR8sY=', tablica: 'x' }).success).toBe(false);
  });
});

describe('splitNotes()', () => {
  it('each top-level bullet is one note', () => {
    expect(splitNotes('- pierwsza\n- druga\n* trzecia')).toEqual(['pierwsza', 'druga', 'trzecia']);
  });

  it('indented continuation lines join the bullet above', () => {
    expect(splitNotes('- retry uploadów\n  przed demo\n- druga')).toEqual(['retry uploadów przed demo', 'druga']);
  });

  it('a body without bullets is ONE note, verbatim', () => {
    expect(splitNotes('Jedna karteczka,\nw dwóch liniach.')).toEqual(['Jedna karteczka,\nw dwóch liniach.']);
  });

  it('an empty body is zero notes — the caller turns that into a loud error', () => {
    expect(splitNotes('')).toEqual([]);
    expect(splitNotes('   \n  ')).toEqual([]);
  });

  it('prose in a bulleted body is a loud error, not a silent drop', () => {
    // It used to be discarded without a word — the dry run listed only the surviving
    // notes, so the author found out on the board, or never.
    expect(() => splitNotes('- a\nluźny tekst bez wcięcia\n- b')).toThrow(/neither a bullet nor an indented/);
  });

  it('an indented line before any bullet is a loud error too', () => {
    expect(() => splitNotes('  wciety sierota\n- a')).toThrow(/neither a bullet nor an indented/);
  });
});

describe('layout and payloads', () => {
  it('the grid runs 5 per row, 230 px apart', () => {
    expect(notePosition(0)).toEqual({ x: 0, y: 0 });
    expect(notePosition(4)).toEqual({ x: 920, y: 0 });
    expect(notePosition(5)).toEqual({ x: 0, y: 230 });
    expect(notePosition(12)).toEqual({ x: 460, y: 460 });
  });

  it('color and frame are present only when asked for', () => {
    const bare = WriteMeta.parse({ boardId: 'uXjVN2wR8sY=' });
    expect(buildNotePayload(bare, 'tekst', 0)).toEqual({ data: { content: 'tekst' }, position: { x: 0, y: 0 } });

    const dressed = WriteMeta.parse({ boardId: 'uXjVN2wR8sY=', frameId: '345', color: 'light_green' });
    expect(buildNotePayload(dressed, 'tekst', 6)).toEqual({
      data: { content: 'tekst' },
      position: { x: 230, y: 230 },
      style: { fillColor: 'light_green' },
      parent: { id: '345' },
    });
  });
});
