/**
 * Unit tests — CQL builder for label-based page search.
 */
import { describe, expect, it } from 'vitest';

import { buildLabelSearchCql, escapeCqlString } from './confluence-cql.js';

describe('escapeCqlString', () => {
  it('passes plain values through unchanged', () => {
    expect(escapeCqlString('plain-label')).toBe('plain-label');
  });

  it('escapes embedded double quotes', () => {
    expect(escapeCqlString('weird"label')).toBe(String.raw`weird\"label`);
  });

  it('escapes embedded backslashes before quote handling', () => {
    expect(escapeCqlString(String.raw`a\b`)).toBe(String.raw`a\\b`);
  });
});

describe('buildLabelSearchCql', () => {
  // The builder takes ONE label — the config schema has a scalar `label`, and the
  // multi-label OR-list surface it used to carry was reachable from no run.
  it('builds a single-label CQL with type filter', () => {
    expect(buildLabelSearchCql({ label: 'bug' })).toBe('label = "bug" AND type = "page"');
  });

  it('appends a space.key clause when space is provided', () => {
    expect(buildLabelSearchCql({ label: 'bug', space: 'ENG' })).toBe(
      'label = "bug" AND space.key = "ENG" AND type = "page"',
    );
  });

  it('ignores an empty / whitespace-only space', () => {
    expect(buildLabelSearchCql({ label: 'bug', space: '   ' })).toBe('label = "bug" AND type = "page"');
    expect(buildLabelSearchCql({ label: 'bug', space: '' })).toBe('label = "bug" AND type = "page"');
  });

  it('escapes double quotes inside label and space values', () => {
    expect(buildLabelSearchCql({ label: 'weird"label', space: 'sp"ce' })).toBe(
      String.raw`label = "weird\"label" AND space.key = "sp\"ce" AND type = "page"`,
    );
  });

  it('trims label whitespace', () => {
    expect(buildLabelSearchCql({ label: '  bug  ' })).toBe('label = "bug" AND type = "page"');
  });

  it('throws when no usable label is supplied', () => {
    expect(() => buildLabelSearchCql({ label: '' })).toThrow(/non-empty label/i);
    expect(() => buildLabelSearchCql({ label: '   ' })).toThrow(/non-empty label/i);
  });
});
