/**
 * Unit tests — countNodes / pruneNodeTree: the node budget that keeps a Figma
 * file summary from becoming the whole multi-megabyte document.
 */
import { describe, expect, it } from 'vitest';

import { countNodes, pruneNodeTree } from './figma-node-tree.js';

interface TestNode {
  readonly id: string;
  readonly name?: string;
  readonly children?: readonly TestNode[];
  readonly childrenTruncated?: boolean;
}

const ids = (forest: readonly unknown[]): string[] => forest.map((n) => (n as TestNode).id);

describe('countNodes', () => {
  it('counts a flat forest', () => {
    expect(countNodes([{ id: 'a' }, { id: 'b' }, { id: 'c' }])).toBe(3);
  });

  it('counts nested children', () => {
    const forest = [{ id: 'root', children: [{ id: 'c1' }, { id: 'c2' }] }, { id: 'b' }];
    expect(countNodes(forest)).toBe(4); // root + c1 + c2 + b
  });

  it('ignores non-object entries', () => {
    expect(countNodes([null, 'x', 42, { id: 'a' }])).toBe(4);
  });
});

describe('pruneNodeTree', () => {
  it('returns the forest untouched when it fits the budget', () => {
    const forest = [{ id: 'a' }, { id: 'b', children: [{ id: 'c' }] }];
    const result = pruneNodeTree(forest, 10);
    expect(result.truncated).toBe(false);
    expect(result.totalNodes).toBe(3);
    expect(result.children).toBe(forest); // same reference, no copy
  });

  it('prunes a deep child list to the budget and flags the cut', () => {
    const forest = [{ id: 'root', children: [{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }] }];
    const result = pruneNodeTree(forest, 2);
    expect(result.truncated).toBe(true);
    expect(result.totalNodes).toBe(4);
    expect(countNodes(result.children)).toBeLessThanOrEqual(2);
    const root = result.children[0] as TestNode;
    expect(root.id).toBe('root');
    expect(root.children).toHaveLength(1);
    expect(root.childrenTruncated).toBe(true);
  });

  it('drops overflow roots while preserving order and properties', () => {
    const forest = [
      { id: 'a', name: 'A' },
      { id: 'b', name: 'B' },
      { id: 'c', name: 'C' },
    ];
    const result = pruneNodeTree(forest, 2);
    expect(result.truncated).toBe(true);
    expect(ids(result.children)).toEqual(['a', 'b']);
    expect((result.children[0] as TestNode).name).toBe('A');
  });

  it('does not mutate the input forest', () => {
    const root = { id: 'root', children: [{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }] };
    pruneNodeTree([root], 2);
    expect(root.children).toHaveLength(3); // original intact
  });

  // Forward compatibility: node types Figma adds later (TEXT_PATH, TRANSFORM_GROUP,
  // PATTERN paint, TEXTURE/NOISE effects) must pass through untouched, not be dropped
  // for being unrecognised.
  it('preserves nodes with unknown/new `type` and walks their children', () => {
    const forest = [
      { id: 'root', type: 'TRANSFORM_GROUP', children: [{ id: 'tp', type: 'TEXT_PATH' }] },
      { id: 'rect', type: 'RECTANGLE', fills: [{ type: 'PATTERN' }] },
      { id: 'spare', type: 'TEXTURE' },
    ];
    // A budget of 50 for this forest returns the input array BY REFERENCE without
    // ever entering the pruner, so the test could not fail for any type-related
    // reason. A budget of 3 against 4 nodes forces the walk and drops `spare`.
    const result = pruneNodeTree(forest, 3);
    expect(result.truncated).toBe(true);
    expect(result.children).not.toBe(forest);
    expect(ids(result.children)).toEqual(['root', 'rect']);
    expect(ids((result.children[0] as TestNode).children ?? [])).toEqual(['tp']);
    // unknown fields (fills/type) survive untouched
    expect((result.children[1] as { type?: string }).type).toBe('RECTANGLE');
  });

  it('counts and prunes the same set of levels, so a very deep tree cannot slip past the budget', () => {
    // `countNodes` stopped one level earlier than `pruneForest` walked, and at
    // the ceiling the pruner pushed the raw node — subtree and all. A tree past
    // MAX_DEPTH therefore reported `truncated: false` and was emitted whole.
    let node: Record<string, unknown> = { id: 'leaf-0' };
    for (let depth = 1; depth <= 60; depth += 1) {
      node = { id: `n-${depth}`, children: [node] };
    }
    const result = pruneNodeTree([node], 5);
    expect(result.truncated).toBe(true);
    expect(JSON.stringify(result.children).length).toBeLessThan(600);
  });
});
