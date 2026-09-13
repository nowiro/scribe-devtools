/**
 * Reshape a raw Jira issue into a token-friendly canonical form.
 *
 * Three problems we solve here:
 *   1. **Custom field IDs** — `customfield_10042` → "Story Points" via the
 *      preloaded `FieldRegistry`. If the registry hasn't loaded (or the token can't
 *      see field metadata), the original ID is kept so the LLM still has a
 *      handle.
 *   2. **ADF descriptions** — the raw API returns ADF JSON which the LLM
 *      cannot read efficiently. We render it through `adfToMarkdown`.
 *   3. **Field bloat** — 50+ fields per issue is normal; most are noise for
 *      the LLM (icons, avatars, _links, expand markers). We keep the system
 *      fields a human cares about + every populated custom field.
 *
 * Key order is fixed (`key` → `id` → identity → metadata → body → custom)
 * so an assistant's prefix cache stays warm across calls.
 */
import { adfToMarkdown, flatLine } from './adf.js';
import { reshapeFieldValue, type FieldRegistry, type ReshapedField } from './field-registry.js';

/** A lightweight reference to a related issue — the parent or one subtask. */
export interface IssueRef {
  /** The issue key — or, on permission-narrowed refs that omit it, the numeric id. */
  readonly key: string;
  readonly summary?: string;
  readonly status?: string;
  /** Issue type NAME (`Epic`, `Subtask`, `Sub-task`) — the raw blob carried it, so the ref must too. */
  readonly type?: string;
}

/**
 * One issue reference as ONE markdown line: `**KEY** — summary (Type, Status)`,
 * each part only when known. It lives NEXT TO the type it formats: Parent and
 * Subtasks used to render through two private spellings, and the same `IssueRef`
 * showed status in one place and hid it in the other.
 */
export function issueRefLine(ref: IssueRef): string {
  const meta = [ref.type, ref.status].filter((part) => part !== undefined).join(', ');
  return `**${ref.key}**${ref.summary ? ` — ${flatLine(ref.summary)}` : ''}${meta ? ` (${meta})` : ''}`;
}

export interface CanonicalIssue {
  readonly key: string;
  readonly id: string;
  readonly url?: string;
  readonly summary?: string;
  readonly status?: { id: string; name: string };
  readonly issueType?: { id: string; name: string };
  readonly priority?: { id: string; name: string };
  readonly assignee?: { accountId: string; displayName: string };
  readonly reporter?: { accountId: string; displayName: string };
  readonly labels?: readonly string[];
  readonly parent?: IssueRef;
  readonly subtasks?: readonly IssueRef[];
  readonly created?: string;
  readonly updated?: string;
  /** The FULL description as Markdown. The MCP-era 8 000-char cap is gone: a snapshot
   * tool that silently amputates the description is the failure mode this repo forbids. */
  readonly descriptionMd?: string;
  readonly customFields?: readonly ReshapedField[];
}

interface RawIssue {
  readonly id: string;
  readonly key: string;
  readonly self?: string;
  readonly fields?: Record<string, unknown>;
}

const SYSTEM_FIELDS = new Set([
  'summary',
  'status',
  'issuetype',
  'priority',
  'assignee',
  'reporter',
  'labels',
  // Extracted first-class in pickSystemSlice — before they joined this set, both
  // fell through to the custom-field walk and rendered as a raw JSON blob under
  // "## Custom fields" instead of readable issue references.
  'parent',
  'subtasks',
  'created',
  'updated',
  'description',
]);

export function reshapeJiraIssue(raw: RawIssue, registry: FieldRegistry): CanonicalIssue {
  const fields = raw.fields ?? {};
  const customFields = collectCustomFields(fields, registry);
  const description = fields['description'] ? adfToMarkdown(fields['description'] as never) : '';
  const systemSlice = pickSystemSlice(fields, raw.self, raw.key);

  // Single explicit literal — no spread within identity, optional system fields
  // are merged via one slice. Optional `undefined` values are dropped by
  // `JSON.stringify` natively, so the wire JSON keeps a stable key order.
  return {
    key: raw.key,
    id: raw.id,
    ...systemSlice,
    ...(description.length > 0 ? { descriptionMd: description } : {}),
    ...(customFields.length > 0 ? { customFields } : {}),
  };
}

/** Walk all `customfield_*` (and any non-system) entries, dropping null/empty/unknown noise. */
function collectCustomFields(fields: Record<string, unknown>, registry: FieldRegistry): ReshapedField[] {
  const out: ReshapedField[] = [];
  for (const [id, value] of Object.entries(fields)) {
    if (isCustomFieldKeeper(id, value)) {
      const reshaped = reshapeFieldValue(registry.byId(id), value, id);
      if (reshaped) out.push(reshaped);
    }
  }
  return out;
}

/** Positive guard — keep when not a system key, not nullish, not an empty array. */
function isCustomFieldKeeper(id: string, value: unknown): boolean {
  if (SYSTEM_FIELDS.has(id)) return false;
  if (value === null || value === undefined) return false;
  if (Array.isArray(value) && value.length === 0) return false;
  return true;
}

/** Mutable mirror of the optional system fields — flipped to `readonly` on return. */
interface MutableSystemSlice {
  url?: string;
  summary?: string;
  status?: { id: string; name: string };
  issueType?: { id: string; name: string };
  priority?: { id: string; name: string };
  assignee?: { accountId: string; displayName: string };
  reporter?: { accountId: string; displayName: string };
  labels?: readonly string[];
  parent?: IssueRef;
  subtasks?: readonly IssueRef[];
  created?: string;
  updated?: string;
}

/**
 * Gather all optional system fields in one slice with stable key order — keeps
 * the cognitive cap on `reshapeJiraIssue` and the wire JSON deterministic.
 */
function pickSystemSlice(fields: Record<string, unknown>, self: string | undefined, key: string): MutableSystemSlice {
  const slice: MutableSystemSlice = {};
  // `url` is the BROWSE link a human can follow, derived from `self`'s origin. `self`
  // itself is the REST endpoint (…/rest/api/3/issue/10002) — copying it verbatim sent
  // every snapshot reader and OKF `resource` link to an auth-gated JSON blob instead
  // of the issue page.
  const browse = browseUrl(self, key);
  if (browse) slice.url = browse;
  if (typeof fields['summary'] === 'string') slice.summary = fields['summary'];
  const status = pickIdName(fields['status']);
  if (status) slice.status = status;
  const issueType = pickIdName(fields['issuetype']);
  if (issueType) slice.issueType = issueType;
  const priority = pickIdName(fields['priority']);
  if (priority) slice.priority = priority;
  const assignee = pickUser(fields['assignee']);
  if (assignee) slice.assignee = assignee;
  const reporter = pickUser(fields['reporter']);
  if (reporter) slice.reporter = reporter;
  if (Array.isArray(fields['labels'])) slice.labels = fields['labels'] as readonly string[];
  const parent = pickIssueRef(fields['parent']);
  if (parent) slice.parent = parent;
  if (Array.isArray(fields['subtasks'])) {
    const subtasks: IssueRef[] = [];
    for (const rawRef of fields['subtasks']) {
      const ref = pickIssueRef(rawRef);
      if (ref) subtasks.push(ref);
    }
    if (subtasks.length > 0) slice.subtasks = subtasks;
  }
  if (typeof fields['created'] === 'string') slice.created = fields['created'];
  if (typeof fields['updated'] === 'string') slice.updated = fields['updated'];
  return slice;
}

/**
 * `parent` / `subtasks[]` entries arrive as `{ id, key, fields: { summary, status, issuetype } }`.
 * A ref without `key` (permission-narrowed responses can send id-only) falls back to the
 * numeric id — SYSTEM_FIELDS bars these fields from the custom dump, so dropping the ref
 * here would erase the relationship from the snapshot entirely, in silence.
 */
function pickIssueRef(raw: unknown): IssueRef | undefined {
  if (!isObject(raw)) return undefined;
  // Truthiness, not typeof: an EMPTY key is a string too, and it used to win over
  // the id fallback, publishing `key: ''`. A numeric id (some payloads send one)
  // is stringified rather than dropped — losing the whole ref over a number's type
  // is the silent erasure this fallback exists to prevent.
  const id = typeof raw['id'] === 'number' ? String(raw['id']) : raw['id'];
  const key =
    (typeof raw['key'] === 'string' && raw['key'] !== '' ? raw['key'] : undefined) ??
    (typeof id === 'string' && id !== '' ? id : undefined);
  if (key === undefined) return undefined;
  const inner = isObject(raw['fields']) ? raw['fields'] : {};
  const status = pickIdName(inner['status'])?.name;
  const type = pickIdName(inner['issuetype'])?.name;
  return {
    key,
    ...(typeof inner['summary'] === 'string' ? { summary: inner['summary'] } : {}),
    ...(status ? { status } : {}),
    ...(type ? { type } : {}),
  };
}

/** `https://x.atlassian.net/rest/api/3/issue/10002` + `PROJ-1` → `https://x.atlassian.net/browse/PROJ-1`. */
function browseUrl(self: string | undefined, key: string): string | undefined {
  if (!self) return undefined;
  try {
    return `${new URL(self).origin}/browse/${key}`;
  } catch {
    return undefined; // an unparseable `self` is upstream noise, not a reason to fail the reshape
  }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function pickIdName(raw: unknown): { id: string; name: string } | undefined {
  if (!isObject(raw)) return undefined;
  const id = typeof raw['id'] === 'string' ? raw['id'] : '';
  const name = typeof raw['name'] === 'string' ? raw['name'] : '';
  return id || name ? { id, name } : undefined;
}

function pickUser(raw: unknown): { accountId: string; displayName: string } | undefined {
  if (!isObject(raw)) return undefined;
  const accountId = typeof raw['accountId'] === 'string' ? raw['accountId'] : '';
  const displayName = typeof raw['displayName'] === 'string' ? raw['displayName'] : '';
  return accountId || displayName ? { accountId, displayName } : undefined;
}
