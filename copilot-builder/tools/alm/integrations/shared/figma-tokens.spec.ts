/**
 * Unit tests — pure token emitters (CSS / SCSS / TS).
 */
import { describe, expect, it } from 'vitest';

import { emitCss, emitScss, emitTs, type Token } from './figma-tokens.js';

const sample: readonly Token[] = [
  { name: 'Color/Primary', value: '#ff0000', kind: 'color' },
  { name: 'spacing.sm', value: '8px', kind: 'spacing' },
  { name: 'radius--lg', value: '16px', kind: 'radius' },
];

describe('emitCss', () => {
  it('wraps tokens in a single :root block with CSS custom properties', () => {
    expect(emitCss(sample)).toBe(
      [':root {', '  --color-primary: #ff0000;', '  --spacing-sm: 8px;', '  --radius-lg: 16px;', '}'].join('\n'),
    );
  });

  it('emits an empty :root block for an empty token list', () => {
    expect(emitCss([])).toBe(':root {\n}');
  });

  it('keeps the last value when normalised names collide', () => {
    const out = emitCss([
      { name: 'Color/Primary', value: '#ff0000', kind: 'color' },
      { name: 'color.primary', value: '#0000ff', kind: 'color' },
    ]);
    expect(out).toBe(':root {\n  --color-primary: #0000ff;\n}');
  });
});

describe('emitScss', () => {
  it('emits one $variable declaration per token', () => {
    expect(emitScss(sample)).toBe(['$color-primary: #ff0000;', '$spacing-sm: 8px;', '$radius-lg: 16px;'].join('\n'));
  });

  it('returns the empty string when there are no tokens', () => {
    expect(emitScss([])).toBe('');
  });

  it('handles typography and shadow kinds (kind is metadata only, value passes through)', () => {
    const out = emitScss([
      { name: 'typography/heading-1', value: '600 32px/40px Inter', kind: 'typography' },
      { name: 'shadow.md', value: '0 2px 4px rgba(0,0,0,0.1)', kind: 'shadow' },
    ]);
    expect(out).toBe('$typography-heading-1: 600 32px/40px Inter;\n$shadow-md: 0 2px 4px rgba(0,0,0,0.1);');
  });
});

describe('emitTs', () => {
  it('emits a typed const with camelCase, always-quoted property keys', () => {
    expect(emitTs(sample)).toBe(
      [
        'export const tokens = {',
        '  "colorPrimary": "#ff0000",',
        '  "spacingSm": "8px",',
        '  "radiusLg": "16px",',
        '} as const;',
      ].join('\n'),
    );
  });

  // `2xl`, `3xl` and bare numeric steps are ordinary Figma token names. Unquoted,
  // they produce a file that is not valid TypeScript — the emitter's whole output
  // becomes unusable because of one token.
  it('survives a token name that cannot be a bare identifier', () => {
    const out = emitTs([
      { name: '2xl', value: '32px', kind: 'spacing' },
      { name: 'weight/400', value: '400', kind: 'typography' },
    ]);
    expect(out).toContain('"2xl": "32px",');
    expect(out).toContain('"weight400": "400",');
  });

  it('emits an empty const for an empty token list', () => {
    expect(emitTs([])).toBe('export const tokens = {} as const;');
  });

  it('normalises mixed separators (slash / dot / dash / space) into camelCase', () => {
    const out = emitTs([
      { name: 'Color/Surface Container Highest', value: '#eaeaea', kind: 'color' },
      { name: 'border.radius--xl', value: '24px', kind: 'radius' },
    ]);
    expect(out).toBe(
      [
        'export const tokens = {',
        '  "colorSurfaceContainerHighest": "#eaeaea",',
        '  "borderRadiusXl": "24px",',
        '} as const;',
      ].join('\n'),
    );
  });
});
