/**
 * Pure emitters for Figma design tokens → CSS variables / SCSS variables / TS const.
 *
 * Kept dependency-free and side-effect free so the extract pipeline stays a
 * one-liner: fetch Variables API, map to `Token[]`, hand to the matching
 * emitter. Name normalisation is locked at the emitter boundary:
 *
 *   - CSS / SCSS — kebab-case (`color-primary`, `spacing-sm`),
 *   - TS         — camelCase (`colorPrimary`, `spacingSm`).
 *
 * The Token shape is intentionally narrow (name + value + kind) — anything
 * richer (modes, references, aliases) belongs in the mapping layer that
 * produces `Token[]`, not in the emitters.
 */

/** Supported token kinds. Matches the categories surfaced by Figma Variables. */
export type TokenKind = 'color' | 'spacing' | 'typography' | 'radius' | 'shadow';

/** Canonical token shape consumed by the emitters. */
export interface Token {
  readonly name: string;
  readonly value: string;
  readonly kind: TokenKind;
}

/**
 * Emit `:root { --name: value; … }` from a token list. Names are kebab-cased;
 * duplicates after normalisation keep the last occurrence (mirrors CSS cascade).
 */
export function emitCss(tokens: readonly Token[]): string {
  if (tokens.length === 0) return ':root {\n}';
  const lines = dedupeByName(tokens, toKebabCase).map(([name, value]) => `  --${name}: ${sanitiseCssValue(value)};`);
  return `:root {\n${lines.join('\n')}\n}`;
}

/**
 * Emit `$name: value;` SCSS variable declarations. Names are kebab-cased; one
 * declaration per line, terminating newline omitted to match repo style.
 */
export function emitScss(tokens: readonly Token[]): string {
  if (tokens.length === 0) return '';
  return dedupeByName(tokens, toKebabCase)
    .map(([name, value]) => `$${scssName(name)}: ${scssSafe(sanitiseCssValue(value))};`)
    .join('\n');
}

/**
 * Sass identifiers cannot begin with a digit — `2xl` and `400` are real Figma token
 * names (the very examples the TS emitter's docblock cites), and one `$2xl:` line
 * failed the compile of the whole generated file. CSS custom properties (`--2xl`)
 * are legal, so only the SCSS emitter needs the prefix.
 */
const scssName = (name: string): string => (/^\d/u.test(name) ? `_${name}` : name);

/**
 * `//` opens a LINE comment in SCSS (not in CSS), so a URL-bearing STRING token
 * (`https://cdn…`) silently truncated its own declaration at the slashes. Slash
 * pairs are broken up with a space, to a fixed point — a visibly mangled value
 * over a silently broken stylesheet, the same trade sanitiseCssValue documents.
 */
function scssSafe(value: string): string {
  let out = value;
  while (out.includes('//')) out = out.replaceAll('//', '/ /');
  return out;
}

/**
 * Emit a `const tokens = { … } as const;` TS module.
 *
 * Keys are camelCased and **always quoted**. Unquoted was a real defect, not a
 * style choice: a Figma token called `2xl` or `400` camelCases to something that
 * cannot begin a JavaScript identifier, and the emitted file was then not valid
 * TypeScript at all. Quoting every key costs two characters and cannot fail.
 */
export function emitTs(tokens: readonly Token[]): string {
  if (tokens.length === 0) return 'export const tokens = {} as const;';
  const lines = dedupeByName(tokens, toCamelCase).map(
    ([name, value]) => `  ${JSON.stringify(name)}: ${JSON.stringify(value)},`,
  );
  return `export const tokens = {\n${lines.join('\n')}\n} as const;`;
}

/**
 * Strip what would end a declaration — or the whole stylesheet — early.
 *
 * A Figma STRING variable is free text. Interpolated straight into
 * `--name: <value>;`, one containing `;` or `}` does not produce a broken token,
 * it produces a broken *stylesheet* from that line to the end of the file. `{`
 * and a comment opener do the same in the other direction: `/*` swallows every
 * declaration after it until something closes the comment.
 *
 * Dropping the characters rather than escaping them is deliberate — CSS has no
 * escape that survives in every position a token value can occupy, and a
 * mangled value is a visible bug where a broken stylesheet is a silent one.
 */
function sanitiseCssValue(value: string): string {
  let out = value.replaceAll(/[\r\n]+/gu, ' ').replaceAll(/[;{}]/gu, '');
  // Comment tokens go to a FIXED POINT, and only AFTER the single-char strip above:
  // each deletion can butt two survivors into a brand-new opener (`/;*` loses its
  // `;` and becomes `/*`; `//**` loses its inner `/*` the same way), and a single
  // pass let that synthesized `/*` through — the exact silent stylesheet-swallowing
  // this function exists to prevent. Each round removes characters, so it terminates.
  while (out.includes('/*') || out.includes('*/')) {
    out = out.replaceAll('/*', '').replaceAll('*/', '');
  }
  return out.trim();
}

// ── helpers ────────────────────────────────────────────────────────────────

/**
 * Normalise a Figma-style token name (`Color/Primary 500`, `spacing.sm`,
 * `radius--lg`) to kebab-case. Non-alphanumeric runs collapse to a single dash;
 * camelCase splits are inserted before consecutive uppercase letters.
 */
function toKebabCase(raw: string): string {
  // Bounded quantifiers (≤32) keep sonarjs/slow-regex happy without limiting
  // realistic token names (longest real ones are ~30 chars).
  return raw
    .replaceAll(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replaceAll(/[^a-zA-Z0-9]{1,32}/g, '-')
    .replace(/^-{1,32}/, '')
    .replace(/-{1,32}$/, '')
    .toLowerCase();
}

/** Convert kebab/space/dot-separated names to camelCase. */
function toCamelCase(raw: string): string {
  const kebab = toKebabCase(raw);
  if (kebab.length === 0) return '';
  const parts = kebab.split('-');
  const [head, ...tail] = parts;
  return (head ?? '') + tail.map((p) => (p.length === 0 ? '' : (p[0] ?? '').toUpperCase() + p.slice(1))).join('');
}

/**
 * Apply `normalise` to each token name and keep the last occurrence for
 * collisions — preserves input order otherwise. Returns `[name, value]` pairs
 * so the caller can format without re-looking up the token.
 */
function dedupeByName(tokens: readonly Token[], normalise: (name: string) => string): [string, string][] {
  const map = new Map<string, string>();
  for (const t of tokens) {
    const key = normalise(t.name);
    if (key.length === 0) continue;
    map.set(key, t.value);
  }
  return [...map.entries()];
}

// ── Figma Variables API → Token[] ────────────────────────────────────────────
//
// The mapping lives beside the emitters rather than inside `read-figma.ts`
// because it is pure and testable on its own: given a Variables response it
// produces `Token[]`, with no network and no filesystem in the way.
//
// Variables API returns two collections: `variables` (one entry per token,
// keyed by id) and `variableCollections` (groups + mode metadata). Each
// variable has a `resolvedType` (COLOR / FLOAT / STRING / BOOLEAN) and a
// `valuesByMode` map keyed by modeId. We pick the default mode and project the
// raw value down to the string the emitters expect.

export type FigmaResolvedType = 'COLOR' | 'FLOAT' | 'STRING' | 'BOOLEAN';

export interface RawFigmaColor {
  readonly r?: number;
  readonly g?: number;
  readonly b?: number;
  readonly a?: number;
}

export interface RawFigmaVariable {
  readonly id?: string;
  readonly name?: string;
  readonly resolvedType?: FigmaResolvedType;
  readonly variableCollectionId?: string;
  readonly scopes?: readonly string[];
  readonly valuesByMode?: Readonly<Record<string, number | string | boolean | RawFigmaColor>>;
}

export interface RawFigmaVariableCollection {
  readonly id?: string;
  readonly defaultModeId?: string;
}

export interface RawVariablesResponse {
  readonly meta?: {
    readonly variables?: Readonly<Record<string, RawFigmaVariable>>;
    readonly variableCollections?: Readonly<Record<string, RawFigmaVariableCollection>>;
  };
}

export function emitForFormat(tokens: readonly Token[], format: 'css' | 'scss' | 'ts'): string {
  switch (format) {
    case 'css': {
      return emitCss(tokens);
    }
    case 'scss': {
      return emitScss(tokens);
    }
    case 'ts': {
      return emitTs(tokens);
    }
  }
}

// Limitation (figma-4): we resolve each variable's value in its collection's
// DEFAULT mode only. Extended/themed collections (Enterprise `isExtension` /
// `variableOverrides` / `initialModeIdToParentModeIdMapping`) are not walked, so
// theme-override values are not emitted. Documented here; revisit if a
// caller needs multi-theme token export.
export function mapFigmaVariables(raw: RawVariablesResponse): Token[] {
  const variables = raw.meta?.variables ?? {};
  const collections = raw.meta?.variableCollections ?? {};
  const tokens: Token[] = [];
  for (const v of Object.values(variables)) {
    if (!v.name || !v.resolvedType || !v.valuesByMode) continue;
    const collection = v.variableCollectionId ? collections[v.variableCollectionId] : undefined;
    const modeId = collection?.defaultModeId ?? Object.keys(v.valuesByMode)[0];
    if (!modeId) continue;
    const rawValue = v.valuesByMode[modeId];
    const value = renderValue(v.resolvedType, rawValue, v.scopes ?? []);
    if (value === undefined) continue;
    tokens.push({ name: v.name, value, kind: pickKind(v) });
  }
  return tokens;
}

/** Figma scopes whose FLOAT values are ratios or counts, NOT lengths. */
const UNITLESS_FLOAT_SCOPES = new Set(['FONT_WEIGHT', 'LINE_HEIGHT', 'OPACITY']);

/**
 * A variable may carry several scopes, and Figma's catch-all `ALL_SCOPES` sits
 * beside the specific ones. `some(unitless)` would therefore call a width
 * variable unitless the moment somebody also scoped it to opacity. The value is
 * treated as unitless only when the scope list is non-empty and says nothing but
 * "unitless" — otherwise `px` stays, which is the safe default for a design
 * token.
 */
function isUnitlessFloat(scopes: readonly string[]): boolean {
  return scopes.length > 0 && scopes.every((scope) => UNITLESS_FLOAT_SCOPES.has(scope));
}

function renderValue(
  type: FigmaResolvedType,
  value: number | string | boolean | RawFigmaColor | undefined,
  scopes: readonly string[],
): string | undefined {
  if (value === undefined) return undefined;
  switch (type) {
    case 'COLOR': {
      return typeof value === 'object' ? rgbaToCss(value) : undefined;
    }
    case 'FLOAT': {
      if (typeof value !== 'number') return undefined;
      // Not every FLOAT is a length. A font weight of 700 is not `700px`, an
      // opacity of 0.5 is not `0.5px`, and a line-height multiplier of 1.5 is
      // not `1.5px` — each of those is a value the browser silently ignores.
      return isUnitlessFloat(scopes) ? String(value) : `${value}px`;
    }
    case 'STRING': {
      return typeof value === 'string' ? value : undefined;
    }
    case 'BOOLEAN': {
      return typeof value === 'boolean' ? String(value) : undefined;
    }
  }
}

function rgbaToCss(c: RawFigmaColor): string {
  const r = Math.round((c.r ?? 0) * 255);
  const g = Math.round((c.g ?? 0) * 255);
  const b = Math.round((c.b ?? 0) * 255);
  const a = c.a ?? 1;
  return a === 1 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${a})`;
}

function pickKind(v: RawFigmaVariable): TokenKind {
  if (v.resolvedType === 'COLOR') return 'color';
  const scopes = v.scopes ?? [];
  if (scopes.includes('CORNER_RADIUS')) return 'radius';
  if (scopes.some((s) => s === 'EFFECT_FLOAT' || s === 'EFFECT_COLOR')) return 'shadow';
  if (scopes.some((s) => s === 'FONT_FAMILY' || s === 'FONT_SIZE' || s === 'FONT_WEIGHT' || s === 'LINE_HEIGHT')) {
    return 'typography';
  }
  return 'spacing';
}
