/**
 * Field registry — discovers Jira's custom-field metadata and maps
 * `customfield_10042` to a human-readable shape `{ id, name, type, value }`.
 *
 * Why:
 *   Jira returns custom fields under their internal IDs. The LLM cannot
 *   reason about `customfield_10042: 5` but can reason about
 *   `Story Points: 5`. We discover the mapping once per process and reshape
 *   raw field values into a consistent, typed presentation form.
 *
 * Discovery endpoint: GET /rest/api/3/field
 *   - Returns array of `{ id, name, custom, schema: { type, system?, custom?, items? } }`
 *   - Held in the registry instance, so one `load()` serves the whole run.
 *
 * Discovery is explicit and best-effort:
 *   - `load()` must be awaited BEFORE any lookup; until then every lookup misses.
 *     It is deliberately not lazy — see `createJiraFieldRegistry` for what that cost.
 *   - If discovery fails (e.g. token lacks `read:field-configuration:jira`), `load()`
 *     still resolves, `ready()` stays false, and lookups return `undefined` so the
 *     caller falls back to raw IDs.
 *
 * Value reshape covers Atlassian's common custom-field schema flavours:
 *   - `string`             → value as text
 *   - `number`             → number
 *   - `option`             → `{ id, value }`
 *   - `array<option>`      → `Array<{ id, value }>`
 *   - `user`               → `{ accountId, displayName }`
 *   - `array<user>`        → `Array<{ accountId, displayName }>`
 *   - `cascadingselect`    → `{ value, child?: { value } }`
 *   - `sprint` (custom)    → `Array<{ id, name, state? }>`
 *   - `epic-link`          → string (issue key)
 *   - `priority`/`status`  → `{ id, name }`
 *   - unknown              → raw value (caller can stringify)
 */
import type { HttpClient } from './http-client.js';

// Only the fields the reshape logic actually branches on. `custom` and `system`
// from the raw schema used to be carried too — populated at every construction
// site, asserted by no test, read by nothing.
export interface FieldMeta {
  readonly id: string;
  readonly name: string;
  /** Top-level type from Jira schema: 'string' | 'number' | 'option' | 'array' | 'user' | 'date' | … */
  readonly type: string;
  /** Element type when `type === 'array'` (e.g. `option`, `user`, `string`). */
  readonly itemType?: string;
  /** The plugin field-type URI for `customfield_*` fields ('com.atlassian.jira.plugin.system…' etc). */
  readonly schemaCustom?: string;
}

export interface ReshapedField {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly value: unknown;
}

export interface FieldRegistry {
  /**
   * Fetch the field metadata. **Await this before any lookup** — the registry is
   * deliberately not lazy (see `createJiraFieldRegistry`). Never rejects: a
   * failed discovery is reported through `onError` and leaves the registry empty.
   */
  load(): Promise<void>;
  byId(id: string): FieldMeta | undefined;
  /**
   * True only when discovery **succeeded**. A `false` here after `load()` means
   * the lookups will all miss — typically a token without
   * `read:field-configuration:jira` — and is worth telling the operator about.
   */
  ready(): boolean;
}

interface RawJiraField {
  readonly id: string;
  readonly name: string;
  readonly custom: boolean;
  readonly schema?: {
    readonly type?: string;
    readonly items?: string;
    readonly custom?: string;
    readonly system?: string;
  };
}

/**
 * Build a Jira field registry over `GET /rest/api/3/field`.
 *
 * **Not lazy, on purpose.** An earlier version kicked off a background `load()`
 * from the first `byId` miss and returned `undefined` in the meantime. Since the
 * reshape that calls `byId` is synchronous, the first issues of every run got
 * their custom fields labelled `unknown` — and whether that happened depended on
 * which request happened to land first, so two runs over the same data disagreed.
 * Lookups now simply miss until `load()` has been awaited; the caller decides
 * when that is.
 *
 * `load()` never rejects: a failed discovery goes to `onError`, `ready()` stays
 * false, and lookups return `undefined` so extraction continues with raw IDs.
 */
export function createJiraFieldRegistry(
  http: HttpClient,
  options: {
    onError?: (error: unknown) => void;
    /**
     * External names for custom fields (`customfield_10011` → `Sprint`), from the
     * read config. They WIN over the discovered name — the operator configured them
     * deliberately — and they fill in when `/rest/api/3/field` is unreadable (a
     * token without the field-configuration scope), the case where snapshots used
     * to fall back to raw ids with no recourse.
     */
    fieldNames?: Readonly<Record<string, string>>;
  } = {},
): FieldRegistry {
  const byId = new Map<string, FieldMeta>();
  let succeeded = false;
  // ONE latch: the memoized, never-rejecting load promise. It is never cleared, so
  // every later call — concurrent or sequential, after success or failure alike —
  // awaits the same settled attempt; no-retry-after-failure falls out for free.
  // The previous form juggled `attempted`, `succeeded` AND a `loading` slot cleared
  // in `finally` — three interdependent variables for "do this once", one reorder
  // away from re-introducing the double-load race the machinery existed to prevent.
  let loading: Promise<void> | undefined;

  const doLoad = async (): Promise<void> => {
    try {
      const fields = await http.request<RawJiraField[]>({ path: '/rest/api/3/field' });
      for (const raw of fields) {
        const meta: FieldMeta = {
          id: raw.id,
          name: raw.name,
          type: raw.schema?.type ?? 'unknown',
          itemType: raw.schema?.items,
          schemaCustom: raw.schema?.custom,
        };
        byId.set(meta.id, meta);
      }
      succeeded = true;
    } catch (error) {
      options.onError?.(error);
    }
  };

  const load = (): Promise<void> => (loading ??= doLoad());

  return {
    async load() {
      await load();
    },
    byId(id) {
      const override = options.fieldNames?.[id];
      const discovered = byId.get(id);
      if (override === undefined) return discovered;
      if (discovered === undefined) return { id, name: override, type: 'unknown' };
      return { ...discovered, name: override };
    },
    ready() {
      return succeeded;
    },
  };
}

// ── Value reshape ───────────────────────────────────────────────────────────

/**
 * Reshape a raw Jira field value into a presentation-friendly form.
 * The output always retains the original ID for traceability — useful for
 * round-tripping back to the API on writes.
 *
 * `fieldId` is the key the value arrived under. It matters only when `meta` is
 * missing (discovery failed, or the field is not in this project's
 * configuration): the id is the ONE piece of information still worth keeping,
 * because it is what identifies the field to the API. Replacing it with the
 * literal `'unknown'` — as this used to do — threw away the only usable handle
 * and made every unresolved field indistinguishable from every other.
 */
export function reshapeFieldValue(
  meta: FieldMeta | undefined,
  raw: unknown,
  // Required on purpose: the optional form fell back to 'unknown' — the exact
  // indistinguishable-field collapse the docblock above condemns, reachable by
  // any caller that simply forgot the argument.
  fieldId: string,
): ReshapedField | undefined {
  if (raw === null || raw === undefined) return undefined;
  if (!meta) return { id: fieldId, name: fieldId, type: 'unknown', value: raw };

  const base = { id: meta.id, name: meta.name } as const;

  const pluginType = pluginMatch(meta);
  if (pluginType) {
    return reshapePluginField(pluginType, raw, base);
  }

  // Sprint + cascading are the two custom-field edge cases.
  if (meta.schemaCustom?.includes('sprint') && Array.isArray(raw)) {
    return {
      ...base,
      type: 'sprint[]',
      value: raw.map((sprint) => extractSprint(sprint)).filter((s) => s !== undefined),
    };
  }
  if (meta.type === 'option-with-child' || meta.schemaCustom?.includes('cascadingselect')) {
    return { ...base, type: 'cascading', value: extractCascading(raw) };
  }

  // Scalar / object fields are dispatched by `meta.type`. Array fields delegate
  // to `reshapeArrayField` so this function stays under the cognitive-complexity cap.
  if (meta.type === 'array') return reshapeArrayField(meta, raw, base);
  return reshapeScalarField(meta, raw, base);
}

function reshapeScalarField(
  meta: FieldMeta,
  raw: unknown,
  base: { readonly id: string; readonly name: string },
): ReshapedField {
  switch (meta.type) {
    case 'string': {
      return { ...base, type: 'string', value: typeof raw === 'string' ? raw : safeStringify(raw) };
    }
    case 'number': {
      return { ...base, type: 'number', value: typeof raw === 'number' ? raw : Number(raw) };
    }
    case 'date':
    case 'datetime': {
      return { ...base, type: meta.type, value: typeof raw === 'string' ? raw : null };
    }
    case 'option': {
      return { ...base, type: 'option', value: extractOption(raw) };
    }
    case 'user': {
      return { ...base, type: 'user', value: extractUser(raw) };
    }
    case 'priority':
    case 'status':
    case 'resolution':
    case 'issuetype':
    case 'project': {
      return { ...base, type: meta.type, value: extractIdName(raw) };
    }
    default: {
      return { ...base, type: meta.type, value: raw };
    }
  }
}

function reshapeArrayField(
  meta: FieldMeta,
  raw: unknown,
  base: { readonly id: string; readonly name: string },
): ReshapedField {
  const itemType = meta.itemType ?? 'unknown';
  const array = Array.isArray(raw) ? raw : [];
  switch (itemType) {
    case 'option': {
      return { ...base, type: 'option[]', value: array.map((x) => extractOption(x)) };
    }
    case 'user': {
      return { ...base, type: 'user[]', value: array.map((x) => extractUser(x)) };
    }
    case 'string': {
      return { ...base, type: 'string[]', value: array.map((x) => (typeof x === 'string' ? x : safeStringify(x))) };
    }
    case 'version': {
      return { ...base, type: 'version[]', value: array.map((x) => extractIdName(x)) };
    }
    case 'component': {
      return { ...base, type: 'component[]', value: array.map((x) => extractIdName(x)) };
    }
    default: {
      return { ...base, type: `${itemType}[]`, value: array };
    }
  }
}

// ── Plugin-aware extractors ────────────────────────────────────────────────

type PluginType = 'tempo-account' | 'insight-object' | 'xray-test' | 'epic-link' | 'epic-name';

/**
 * Recognise common third-party plugin custom fields by their `schemaCustom`
 * marker. The marker is the `com.tempoplugin…` / `com.atlassian.servicedesk…`
 * URI Jira returns in `schema.custom`.
 */
function pluginMatch(meta: FieldMeta): PluginType | undefined {
  const c = meta.schemaCustom ?? '';
  if (c.includes('tempo') && c.includes('account')) return 'tempo-account';
  if (c.includes('riadalabs.jira.plugin.insight') || c.includes('atlassian.cmdb')) return 'insight-object';
  if (c.includes('xpandit.plugins.xray') || c.includes('xpand-it.xray')) return 'xray-test';
  if (c.includes('gh-epic-link') || c.includes(':epic-link')) return 'epic-link';
  if (c.includes('gh-epic-label') || c.includes(':epic-label')) return 'epic-name';
  return undefined;
}

function reshapePluginField(
  type: PluginType,
  raw: unknown,
  base: { readonly id: string; readonly name: string },
): ReshapedField {
  switch (type) {
    case 'tempo-account': {
      return { ...base, type: 'tempo-account', value: extractTempoAccount(raw) };
    }
    case 'insight-object': {
      return { ...base, type: 'insight-object[]', value: extractInsightObjects(raw) };
    }
    case 'xray-test': {
      return { ...base, type: 'xray-test', value: extractXray(raw) };
    }
    case 'epic-link':
    case 'epic-name': {
      // Epic Link → key string; Epic Name → label string. Both come through as plain strings.
      return { ...base, type, value: typeof raw === 'string' ? raw : safeStringify(raw) };
    }
  }
}

function asStringOrNumberId(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  return undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function extractTempoAccount(raw: unknown): { id?: string; key?: string; name?: string } | undefined {
  if (raw === null || typeof raw !== 'object') return undefined;
  const bag = raw as Record<string, unknown>;
  const id = asStringOrNumberId(bag['id']);
  const key = asString(bag['key']);
  const name = asString(bag['name']) ?? asString(bag['value']);
  if (id === undefined && key === undefined && name === undefined) return undefined;
  return {
    ...(id === undefined ? {} : { id }),
    ...(key === undefined ? {} : { key }),
    ...(name === undefined ? {} : { name }),
  };
}

interface InsightObject {
  id: string;
  objectKey?: string;
  label?: string;
}

function extractInsightObjects(raw: unknown): readonly InsightObject[] {
  // Insight returns either array of objects or one object with `objectKey`/`label`.
  const items = Array.isArray(raw) ? raw : [raw];
  const out: InsightObject[] = [];
  for (const item of items) {
    const insight = mapInsightObject(item);
    if (insight) out.push(insight);
  }
  return out;
}

function mapInsightObject(item: unknown): InsightObject | undefined {
  if (item === null || typeof item !== 'object') return undefined;
  const bag = item as Record<string, unknown>;
  const id = asStringOrNumberId(bag['id']);
  if (id === undefined || id === '') return undefined;
  const label = asString(bag['label']) ?? asString(bag['name']);
  return {
    id,
    ...(typeof bag['objectKey'] === 'string' ? { objectKey: bag['objectKey'] } : {}),
    ...(label === undefined ? {} : { label }),
  };
}

function extractXray(raw: unknown): { testType?: string; steps?: number; preconditions?: number } | undefined {
  if (typeof raw === 'string') return { testType: raw };
  if (raw === null || typeof raw !== 'object') return undefined;
  const bag = raw as Record<string, unknown>;
  const testType = asString(bag['value']) ?? asString(bag['testType']);
  const steps = asCountOrNumber(bag['steps']);
  const preconditions = Array.isArray(bag['preconditions']) ? bag['preconditions'].length : undefined;
  if (testType === undefined && steps === undefined && preconditions === undefined) return undefined;
  return {
    ...(testType === undefined ? {} : { testType }),
    ...(steps === undefined ? {} : { steps }),
    ...(preconditions === undefined ? {} : { preconditions }),
  };
}

function asCountOrNumber(value: unknown): number | undefined {
  if (typeof value === 'number') return value;
  if (Array.isArray(value)) return value.length;
  return undefined;
}

// ── Extractors ──────────────────────────────────────────────────────────────

function safeStringify(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return '';
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function extractOption(raw: unknown): { id: string; value: string } | undefined {
  if (!isObject(raw)) return undefined;
  const id = typeof raw['id'] === 'string' ? raw['id'] : '';
  const value = typeof raw['value'] === 'string' ? raw['value'] : '';
  return id || value ? { id, value } : undefined;
}

function extractUser(raw: unknown): { accountId: string; displayName: string } | undefined {
  if (!isObject(raw)) return undefined;
  const accountId = typeof raw['accountId'] === 'string' ? raw['accountId'] : '';
  const displayName = typeof raw['displayName'] === 'string' ? raw['displayName'] : '';
  return accountId || displayName ? { accountId, displayName } : undefined;
}

function extractIdName(raw: unknown): { id: string; name: string } | undefined {
  if (!isObject(raw)) return undefined;
  const id = typeof raw['id'] === 'string' ? raw['id'] : '';
  const name = typeof raw['name'] === 'string' ? raw['name'] : '';
  return id || name ? { id, name } : undefined;
}

function extractCascading(raw: unknown): { value: string; child?: { value: string } } | undefined {
  if (!isObject(raw)) return undefined;
  const value = typeof raw['value'] === 'string' ? raw['value'] : '';
  const childRaw = raw['child'];
  const child = isObject(childRaw) && typeof childRaw['value'] === 'string' ? { value: childRaw['value'] } : undefined;
  return value ? { value, ...(child ? { child } : {}) } : undefined;
}

function extractSprint(raw: unknown): { id: number; name: string; state?: string } | undefined {
  if (!isObject(raw)) return undefined;
  const id = typeof raw['id'] === 'number' ? raw['id'] : Number(raw['id']);
  const name = typeof raw['name'] === 'string' ? raw['name'] : '';
  const state = typeof raw['state'] === 'string' ? raw['state'] : undefined;
  if (!Number.isFinite(id)) return undefined;
  return state ? { id, name, state } : { id, name };
}
