/**
 * Pure helpers for assembling Confluence CQL (Confluence Query Language)
 * search strings.
 *
 * Why this lives apart from the pipeline:
 *   - CQL string assembly is deterministic and worth unit-testing without
 *     spinning up the HTTP client.
 *   - Escaping `"` in user-provided labels / space keys is the only thing
 *     standing between us and a malformed query (or, in adversarial input,
 *     a CQL-injection); a pure function makes that property easy to assert.
 *
 * CQL reference: https://developer.atlassian.com/server/confluence/advanced-searching-using-cql/
 *   - Quoted string literals use `"…"`; embedded `"` must be backslash-escaped.
 *   - `space.key = "X"` constrains to a single space.
 */

/** Escape a CQL quoted-string literal value. Backslash and `"` are the only specials. */
export function escapeCqlString(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('"', String.raw`\"`);
}

export interface BuildLabelCqlInput {
  /** ONE label — the config schema has a scalar `label`, so a multi-label OR list was surface no run could reach. */
  readonly label: string;
  readonly space?: string;
}

/**
 * Build the CQL string for "pages tagged with this label, optionally scoped to
 * a single space".
 *
 * Example output:
 *   label: "bug", space: "ENG"
 *   → `label = "bug" AND space.key = "ENG" AND type = "page"`
 */
export function buildLabelSearchCql(input: BuildLabelCqlInput): string {
  const label = input.label.trim();
  if (label.length === 0) {
    throw new Error('buildLabelSearchCql: a non-empty label is required');
  }

  const parts: string[] = [`label = "${escapeCqlString(label)}"`];

  const space = input.space?.trim();
  if (space && space.length > 0) {
    parts.push(`space.key = "${escapeCqlString(space)}"`);
  }

  parts.push('type = "page"');
  return parts.join(' AND ');
}
