/**
 * Version of the extract tooling. It appears in three places a human or an
 * upstream administrator can actually see:
 *
 *   - the outbound `User-Agent` and `X-Extract-Version` headers, so an upstream
 *     rate-limit dashboard or audit log can attribute the calls,
 *   - the `tooling.version` field of every `_manifest.json`,
 *   - the OKF bundle's provenance stamp.
 *
 * It is pinned here rather than read from `package.json`, because that file
 * belongs to whoever forks: they rename it and version it as their own project,
 * and none of that should move the version stamped into snapshots. Bump it by
 * hand when the snapshot format or the extraction semantics change; leave it
 * alone for edits that a consumer of the snapshot cannot observe.
 */
// 1.3.0: outbound requests carry `X-Correlation-Id` + `X-Extract-User`, and the manifest
// gained `correlationId` — an observable change to both the wire and the snapshot format.
// 1.3.1: the tool got a name of its own — the provenance line written into upstream content
// changed accordingly.
// 1.4.0: the default output directory moved from `./.cache/<source>` to `./.<tool>/<source>`
// (gh:fetch artifacts likewise) — an observable change of where snapshots land.
// 1.5.0: the seventh source — read-only Miro (`boards` inventory + `board` items).
// 1.6.0: the web source covers the batchable majority of the Playwright MCP server —
// hover/select/scroll/wait steps, named `extract`/`evaluate` captures, and the
// interactive-elements map in every report.
// 1.7.0: apply writes to Miro — sticky notes on a board (one bullet = one note, grid
// layout, plain-text provenance) and text updates of an existing note.
// 1.8.0: the two-agent refactor round. Snapshot format: descriptions are FULL (the
// MCP-era 8000/2000-char caps and `descriptionMdFull`/`descriptionTruncated` are gone),
// every manifest carries `source` + `stamp`, and scope truncation lands in manifests as
// `truncated`. Wire: `X-Extract-Source` on every request by default.
// 1.9.0: the browser source is named `browser-inspector` (was `web`) — the source id,
// config filename and output directory all follow.
// 2.0.0: the commands are the CRUD they perform — `read` (was `extract`), `create` and
// `update` (was one `apply`; the front matter still decides what the file IS, the command
// asserts it). Pipelines/configs follow: `read-<src>`/`write-<src>`, `read.config.*.json`.
// The provenance line drops "apply" ("narzędzia <tool> v…"). Deliberately UNCHANGED:
// `~/.config/extract`, `EXTRACT_*` env vars, `X-Extract-*` headers — stable infrastructure.
// 2.1.0: the eighth source — read-only Xray Cloud (`tests`, `test_executions`); jira
// snapshots gain first-class `parent`/`subtasks` (JSON, markdown and OKF `extra`), and
// xray manifests carry `hidden` next to `truncated`.
// 2.2.0: context-budget features — oversized jira/confluence markdown splits into a
// `.full.md` sidecar (head + loud pointer stays in the `.md`; json unchanged), their
// manifests carry per-file byte sizes, jira accepts `fieldNames` (external custom-field
// naming), and the repo ships a generated CODE-INDEX.md dependency map.
// 2.3.0: the tool is named `alm` in this repository — a vendored copy carries the name of what it
// does, not the brand it came from (docs/decisions, ADR neutral-tool-names). The provenance line
// ("narzędzia alm v…") and the default output directory (`./.alm/<source>`) follow; `~/.config/extract`,
// `EXTRACT_*` and `X-Extract-*` stay, as in 2.0.0.
const TOOLING_VERSION = '2.3.0';

export function getRepoVersion(): string {
  return TOOLING_VERSION;
}
