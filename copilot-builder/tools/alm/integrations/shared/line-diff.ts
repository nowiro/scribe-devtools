/**
 * A minimal line diff for the `apply` pipelines' dry-run output.
 *
 * `apply` promises "a diff and an explicit --yes" before any write. The diff here is the
 * classic LCS walk — O(n·m), fine for issue descriptions and pages — printed in the unified
 * style everyone can read: `- ` old, `+ ` new, two spaces for context. No hunks and no
 * truncation: the whole point of the dry run is that a human sees EVERYTHING that would
 * change, and the documents involved are short.
 */

/** Diff `before` → `after` as prefixed lines. Equal inputs return `[]`. */
export function diffLines(before: string, after: string): string[] {
  // Normalize BEFORE the equality check — a CRLF copy of the same text is not a change,
  // and reporting it as one would make every Windows-edited file look rewritten.
  const beforeLf = before.replaceAll('\r\n', '\n');
  const afterLf = after.replaceAll('\r\n', '\n');
  if (beforeLf === afterLf) return [];
  const a = beforeLf.split('\n');
  const b = afterLf.split('\n');

  // lcs[i][j] = LCS length of a[i..] vs b[j..]
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      lcs[i]![j] = a[i] === b[j] ? (lcs[i + 1]![j + 1] ?? 0) + 1 : Math.max(lcs[i + 1]![j] ?? 0, lcs[i]![j + 1] ?? 0);
    }
  }

  const out: string[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push(`  ${a[i] ?? ''}`);
      i += 1;
      j += 1;
    } else if ((lcs[i + 1]?.[j] ?? 0) >= (lcs[i]?.[j + 1] ?? 0)) {
      out.push(`- ${a[i] ?? ''}`);
      i += 1;
    } else {
      out.push(`+ ${b[j] ?? ''}`);
      j += 1;
    }
  }
  while (i < a.length) out.push(`- ${a[i++] ?? ''}`);
  while (j < b.length) out.push(`+ ${b[j++] ?? ''}`);
  return out;
}
