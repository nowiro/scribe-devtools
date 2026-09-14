/**
 * Reshape raw Sonar issues / hotspots / measures into token-friendly canonical
 * forms. The raw responses are noisy: 25+ fields per issue with verbose
 * `flows`, `comments`, `transitions`, `quickFixAvailable`, etc. For a triage
 * agent the useful surface is ~10 fields.
 *
 * Key order is fixed (identity → severity → location → metadata) for cache-prefix stability.
 */

/**
 * MQR (Multi-Quality Rule) impact — one per affected software quality. Present
 * since SonarQube 10.2 and default for new instances; carries the Clean Code
 * severity (BLOCKER|HIGH|MEDIUM|LOW|INFO) per quality (RELIABILITY|SECURITY|MAINTAINABILITY).
 */
export interface SonarImpact {
  readonly softwareQuality: string;
  readonly severity: string;
}

export interface CanonicalSonarIssue {
  readonly key: string;
  readonly rule: string;
  readonly severity: string;
  readonly type: string;
  readonly status: string;
  /** MQR impacts — preserved when the instance runs Multi-Quality-Rule mode. */
  readonly impacts?: readonly SonarImpact[];
  readonly cleanCodeAttribute?: string;
  readonly cleanCodeAttributeCategory?: string;
  readonly component?: string;
  readonly line?: number;
  readonly message?: string;
  readonly author?: string;
  readonly effort?: string;
  readonly tags?: readonly string[];
  readonly creationDate?: string;
  readonly updateDate?: string;
}

interface RawImpact {
  readonly softwareQuality?: string;
  readonly severity?: string;
}

interface RawSonarIssue {
  readonly key?: string;
  readonly rule?: string;
  readonly severity?: string;
  readonly type?: string;
  readonly status?: string;
  readonly impacts?: readonly RawImpact[];
  readonly cleanCodeAttribute?: string;
  readonly cleanCodeAttributeCategory?: string;
  readonly component?: string;
  readonly line?: number;
  readonly message?: string;
  readonly author?: string;
  readonly effort?: string;
  readonly tags?: readonly string[];
  readonly creationDate?: string;
  readonly updateDate?: string;
}

/** Map raw MQR impacts to canonical, dropping entries without both fields. */
function mapImpacts(raw: readonly RawImpact[] | undefined): readonly SonarImpact[] | undefined {
  if (!raw || raw.length === 0) return undefined;
  const mapped = raw
    .filter((i): i is RawImpact & SonarImpact => Boolean(i.softwareQuality) && Boolean(i.severity))
    .map((i) => ({ softwareQuality: i.softwareQuality, severity: i.severity }));
  return mapped.length > 0 ? mapped : undefined;
}

/**
 * Reshape a raw Sonar Issue (from `/api/issues/search`) into the token-friendly
 * canonical form. Cuts 15+ noise fields (`flows`, `comments`, `transitions`,
 * `quickFixAvailable`, …) — ~10 fields relevant to a triage agent remain.
 * @param raw Raw issue from the Sonar API (`api/issues/search` response.items[]).
 * @returns Canonical shape with guaranteed `key` / `rule` / `severity` / `type` / `status`.
 * @example
 * ```ts
 * const page = await http.request<{ issues: RawSonarIssue[] }>({ path: '/api/issues/search' });
 * const minimal = page.issues.map(reshapeSonarIssue); // one reshaped issue per raw item
 * ```
 */
export function reshapeSonarIssue(raw: RawSonarIssue): CanonicalSonarIssue {
  const impacts = mapImpacts(raw.impacts);
  return {
    key: raw.key ?? '',
    rule: raw.rule ?? '',
    severity: raw.severity ?? 'INFO',
    type: raw.type ?? 'CODE_SMELL',
    status: raw.status ?? 'OPEN',
    ...(impacts ? { impacts } : {}),
    ...(raw.cleanCodeAttribute ? { cleanCodeAttribute: raw.cleanCodeAttribute } : {}),
    ...(raw.cleanCodeAttributeCategory ? { cleanCodeAttributeCategory: raw.cleanCodeAttributeCategory } : {}),
    ...(raw.component ? { component: raw.component } : {}),
    ...(typeof raw.line === 'number' ? { line: raw.line } : {}),
    ...(raw.message ? { message: raw.message } : {}),
    ...(raw.author ? { author: raw.author } : {}),
    ...(raw.effort ? { effort: raw.effort } : {}),
    ...(raw.tags && raw.tags.length > 0 ? { tags: raw.tags } : {}),
    ...(raw.creationDate ? { creationDate: raw.creationDate } : {}),
    ...(raw.updateDate ? { updateDate: raw.updateDate } : {}),
  };
}

export interface CanonicalHotspot {
  readonly key: string;
  readonly status: string;
  readonly resolution?: string;
  readonly securityCategory?: string;
  readonly vulnerabilityProbability?: string;
  /** MQR impacts — preserved when the instance runs Multi-Quality-Rule mode. */
  readonly impacts?: readonly SonarImpact[];
  readonly cleanCodeAttribute?: string;
  readonly cleanCodeAttributeCategory?: string;
  readonly component?: string;
  readonly line?: number;
  readonly message?: string;
  readonly author?: string;
  readonly creationDate?: string;
  readonly updateDate?: string;
}

interface RawHotspot {
  readonly key?: string;
  readonly status?: string;
  readonly resolution?: string;
  readonly securityCategory?: string;
  readonly vulnerabilityProbability?: string;
  readonly impacts?: readonly RawImpact[];
  readonly cleanCodeAttribute?: string;
  readonly cleanCodeAttributeCategory?: string;
  readonly component?: string;
  readonly line?: number;
  readonly message?: string;
  readonly author?: string;
  readonly creationDate?: string;
  readonly updateDate?: string;
}

/**
 * Reshape a Security Hotspot (from `/api/hotspots/search`). A hotspot is a more
 * specialised Issue with the extra fields `securityCategory` and `vulnerabilityProbability`
 * — the reshape keeps them but cuts the remaining noise.
 * @param raw Raw hotspot from the Sonar API.
 * @returns Canonical shape with guaranteed `key` / `status`.
 */
export function reshapeHotspot(raw: RawHotspot): CanonicalHotspot {
  const impacts = mapImpacts(raw.impacts);
  return {
    key: raw.key ?? '',
    status: raw.status ?? 'TO_REVIEW',
    ...(raw.resolution ? { resolution: raw.resolution } : {}),
    ...(raw.securityCategory ? { securityCategory: raw.securityCategory } : {}),
    ...(raw.vulnerabilityProbability ? { vulnerabilityProbability: raw.vulnerabilityProbability } : {}),
    ...(impacts ? { impacts } : {}),
    ...(raw.cleanCodeAttribute ? { cleanCodeAttribute: raw.cleanCodeAttribute } : {}),
    ...(raw.cleanCodeAttributeCategory ? { cleanCodeAttributeCategory: raw.cleanCodeAttributeCategory } : {}),
    ...(raw.component ? { component: raw.component } : {}),
    ...(typeof raw.line === 'number' ? { line: raw.line } : {}),
    ...(raw.message ? { message: raw.message } : {}),
    ...(raw.author ? { author: raw.author } : {}),
    ...(raw.creationDate ? { creationDate: raw.creationDate } : {}),
    ...(raw.updateDate ? { updateDate: raw.updateDate } : {}),
  };
}
