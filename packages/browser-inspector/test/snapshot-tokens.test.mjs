// Token budget of the compact view, measured with the bench's tokenizer (o200k) on the real
// bookstore tree: `browser-inspector snap` prints 25 lines by default and must stay ≤ 450 tokens, `--max 40`
// ≤ 700 (AC-10; DESIGN.md measured ~370 / ~590). A `find` answer and a `--names` line have their
// own ceilings so a format change shows up here before it shows up in a session's cost.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { encode } from 'gpt-tokenizer/encoding/o200k_base';
import { describe, expect, it } from 'vitest';

import { boxJoin, compactLines, findInSnapshot } from '../src/snapshot.mjs';

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'snapshots');
const read = (/** @type {string} */ name) => readFileSync(path.join(fixtures, name), 'utf8');

const bookstore = read('bookstore.ai.yml');
const sidecar = boxJoin(read('bookstore.boxes.yml'), JSON.parse(read('walk.json'))).entries;
const tokens = (/** @type {string[]} */ lines) => encode(lines.join('\n')).length;

describe('snap.md token budget (o200k)', () => {
  const compact = compactLines(bookstore, { sidecar });

  it('25 lines ≤ 450 tokens, 40 lines ≤ 700 tokens', () => {
    expect(compact.length).toBeGreaterThanOrEqual(40);
    expect(tokens(compact.slice(0, 25))).toBeLessThanOrEqual(450);
    expect(tokens(compact.slice(0, 40))).toBeLessThanOrEqual(700);
  });

  it('the whole compact bookstore costs less than one MCP browser_snapshot (534 tokens) plus a fold', () => {
    expect(tokens(compact)).toBeLessThanOrEqual(700);
  });

  it('--names adds context but keeps 25 lines ≤ 450 + 12 per line', () => {
    const named = compactLines(bookstore, { sidecar, names: true });
    expect(tokens(named.slice(0, 25))).toBeLessThanOrEqual(450 + 25 * 12);
  });

  it('a find answer stays ≤ 10 lines and ≤ 250 tokens; every line ≤ 40 tokens, a fold line ≤ 60', () => {
    const { lines } = findInSnapshot(bookstore, 'koszyk', { sidecar });
    expect(lines.length).toBeLessThanOrEqual(10);
    expect(tokens(lines)).toBeLessThanOrEqual(250);
    for (const line of compact) expect(encode(line).length, line).toBeLessThanOrEqual(line.startsWith('…') ? 60 : 40);
  });
});
