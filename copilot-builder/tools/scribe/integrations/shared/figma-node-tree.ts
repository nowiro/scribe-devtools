/**
 * Pure helpers for bounding a Figma document node tree before it reaches the
 * consumer. A single Figma file serialises to 5+ MB, so `extract-figma` prunes
 * the tree to a node budget before writing it out: a snapshot nobody can open is
 * not a snapshot.
 *
 * Zero I/O — trivial to unit-test for depth / budget edge cases.
 */

/** Guard against pathological / cyclic-looking trees. */
const MAX_DEPTH = 50;

interface NodeLike {
  readonly children?: readonly unknown[];
}

function asNode(value: unknown): (Record<string, unknown> & NodeLike) | undefined {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown> & NodeLike) : undefined;
}

/**
 * Total node count across a forest, counting levels 0…MAX_DEPTH inclusive —
 * exactly the levels `pruneForest` emits.
 *
 * Anything below the ceiling is NOT counted, which is why `deeperThanMaxDepth`
 * exists beside it: a tree that runs past the ceiling is undercounted here, and
 * `pruneNodeTree` must not take its "already fits" shortcut on that number,
 * because the shortcut returns the forest by reference — subtrees below the
 * ceiling and all.
 */
export function countNodes(children: readonly unknown[], depth = 0): number {
  if (depth > MAX_DEPTH) return 0;
  let total = children.length;
  for (const child of children) {
    const node = asNode(child);
    if (node && Array.isArray(node.children)) {
      total += countNodes(node.children, depth + 1);
    }
  }
  return total;
}

/** True when any branch of the forest extends past {@link MAX_DEPTH}. */
function deeperThanMaxDepth(children: readonly unknown[], depth = 0): boolean {
  if (depth > MAX_DEPTH) return true;
  for (const child of children) {
    const node = asNode(child);
    if (
      node &&
      Array.isArray(node.children) &&
      node.children.length > 0 &&
      deeperThanMaxDepth(node.children, depth + 1)
    )
      return true;
  }
  return false;
}

/** Result of {@link pruneNodeTree}. */
export interface PrunedForest {
  /** The pruned forest — at most `maxNodes` nodes, original DFS order preserved. */
  readonly children: readonly unknown[];
  /** Total node count in the *original* forest (before pruning). */
  readonly totalNodes: number;
  /** `true` when the original forest exceeded `maxNodes` and was clipped. */
  readonly truncated: boolean;
}

/**
 * Prune a Figma node forest to at most `maxNodes` nodes, depth-first. Nodes
 * keep all of their own properties; only descendants beyond the budget are
 * dropped. A node whose children were (partly) cut gains
 * `childrenTruncated: true`. Returns the input untouched when it already fits.
 */
export function pruneNodeTree(children: readonly unknown[], maxNodes: number): PrunedForest {
  const cap = Math.max(1, Math.floor(maxNodes));
  const totalNodes = countNodes(children);
  // The shortcut hands the input back BY REFERENCE, so it is only safe when the
  // count describes the whole forest. Past the depth ceiling it does not, and
  // taking the shortcut there emits the deep subtrees the ceiling exists to cut.
  if (totalNodes <= cap && !deeperThanMaxDepth(children)) {
    return { children, totalNodes, truncated: false };
  }
  const budget = { left: cap };
  return { children: pruneForest(children, budget, 0), totalNodes, truncated: true };
}

function pruneForest(nodes: readonly unknown[], budget: { left: number }, depth: number): unknown[] {
  const out: unknown[] = [];
  for (const value of nodes) {
    if (budget.left <= 0) break;
    budget.left -= 1;
    const node = asNode(value);
    const hasChildren = node && Array.isArray(node.children) && node.children.length > 0;
    if (!hasChildren) {
      out.push(value);
      continue;
    }
    if (depth >= MAX_DEPTH) {
      // At the depth ceiling, emit the node WITHOUT its subtree. Pushing the raw
      // value here (as this used to) handed back the whole remaining tree
      // unpruned and uncounted — the one case the budget exists to prevent.
      out.push(rebuildNode(node, [], true));
      continue;
    }
    const originalCount = node.children.length;
    const prunedChildren = budget.left > 0 ? pruneForest(node.children, budget, depth + 1) : [];
    out.push(rebuildNode(node, prunedChildren, prunedChildren.length < originalCount));
  }
  return out;
}

/** Clone a node, replacing `children` with the pruned set and flagging cuts. */
function rebuildNode(
  node: Record<string, unknown>,
  prunedChildren: readonly unknown[],
  cut: boolean,
): Record<string, unknown> {
  const rest: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(node)) {
    if (key !== 'children') rest[key] = val;
  }
  if (prunedChildren.length > 0) rest['children'] = prunedChildren;
  if (cut) rest['childrenTruncated'] = true;
  return rest;
}
