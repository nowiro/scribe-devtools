# CODE-INDEX

Dependency map of this repository — generated, do not edit by hand.
Regenerate: `npm run code-index` (the pre-commit hook does it on every commit;
`npm run verify` fails when this file is stale). One section per module:
what it is **for**, what it **exports** (with the inputs and output of every function), what it
**subscribes to**, which **environment** knobs it reads, what it **imports** (runtime edges and
type-only edges apart) and **who imports it** — read this before grepping.

Modules: 98.

## tools/alm/integrations/browser-inspector/read-browser-inspector.ts
- purpose: web pages through a real browser, as a script instead of the Playwright MCP server.
- exports: `ReadConfig`, `Step`, `WebReport`, `describeStep(step: Step)`, `renderReportMarkdown(report: WebReport)`, `resolveFillValue(step: {…})`
- subscribes: `page:console`, `page:pageerror`, `page:requestfailed`
- imports: `tools/alm/integrations/shared/adf.ts`, `tools/alm/integrations/shared/read-runtime.ts`

## tools/alm/integrations/confluence/read-confluence.ts
- purpose: deterministic Confluence data pipeline.
- exports: `ExtractedPage`, `ReadConfig`, `buildPageConcept(page: ExtractedPage, inSnapshot: ReadonlySet<string>)`, `pageWebUrl(links: {…} | undefined, fallbackBase?: string)`, `renderPageMarkdown(page: ExtractedPage)`
- imports: `tools/alm/integrations/shared/adf.ts`, `tools/alm/integrations/shared/auth.ts`, `tools/alm/integrations/shared/confluence-cql.ts`, `tools/alm/integrations/shared/http-client.ts`, `tools/alm/integrations/shared/okf.ts`, `tools/alm/integrations/shared/read-runtime.ts`
- imported by: `tools/alm/integrations/confluence/write-confluence.ts`

## tools/alm/integrations/confluence/write-confluence.ts
- purpose: WRITE to Confluence: create a page or update a page's content.
- exports: `WriteMeta`, `WriteMetaType`, `adfBodyValue(markdown: string)`, `buildCreatePayload(meta: WriteMetaType, spaceId: string, title: string, body: string)`, `buildUpdatePayload(id: string, title: string, bodyValue: string, nextVersion: number)`, `updateBodyValue(inputBody: string, currentValue: string | undefined)`
- imports: `tools/alm/integrations/confluence/read-confluence.ts`, `tools/alm/integrations/shared/adf.ts`, `tools/alm/integrations/shared/auth.ts`, `tools/alm/integrations/shared/http-client.ts`, `tools/alm/integrations/shared/markdown-to-adf.ts`, `tools/alm/integrations/shared/read-runtime.ts`, `tools/alm/integrations/shared/write-runtime.ts`

## tools/alm/integrations/figma/read-figma.ts
- purpose: batch extraction from Figma into on-disk snapshots.
- exports: `ReadConfig`, `paginateLibrary(http: HttpClient, path: string, field: 'components' | 'styles', maxItems: number)`, `processFileSummary(http: HttpClient, snapshot: z.infer<typeof FileSummarySnapshot>, dir: string)`, `processLibrary(http: HttpClient, snapshot: z.infer<typeof ComponentsSnapshot> | z.infer<typeof StylesSnapshot>, dir: string)`, `processTokens(http: HttpClient, snapshot: z.infer<typeof TokensSnapshot>, dir: string)`
- imports: `tools/alm/integrations/shared/auth.ts`, `tools/alm/integrations/shared/figma-node-tree.ts`, `tools/alm/integrations/shared/figma-tokens.ts`, `tools/alm/integrations/shared/http-client.ts`, `tools/alm/integrations/shared/read-runtime.ts`

## tools/alm/integrations/gitlab/read-gitlab.ts
- purpose: deterministic GitLab data pipeline.
- exports: `ExtractedIssue`, `ExtractedMr`, `ExtractedPipeline`, `ReadConfig`, `listAll`, `renderIssueMarkdown(issue: ExtractedIssue)`, `renderMrMarkdown(mr: ExtractedMr)`, `renderPipelineMarkdown(pipeline: ExtractedPipeline)`
- imports: `tools/alm/integrations/shared/auth.ts`, `tools/alm/integrations/shared/gitlab-reshape.ts`, `tools/alm/integrations/shared/http-client.ts`, `tools/alm/integrations/shared/read-runtime.ts`

## tools/alm/integrations/gitlab/write-gitlab.ts
- purpose: WRITE to GitLab: create/update an issue or a merge request, or add a note (comment) to either.
- exports: `ResolvedWriteMeta`, `WriteMeta`, `WriteMetaType`, `buildCreatePayload(meta: WriteMetaType, title: string, body: string)`, `buildUpdatePayload(meta: WriteMetaType, title: string | undefined, body: string | undefined)`, `collectionPath(meta: ResolvedWriteMeta)`, `encodeProject`
- imports: `tools/alm/integrations/shared/auth.ts`, `tools/alm/integrations/shared/gitlab-reshape.ts`, `tools/alm/integrations/shared/http-client.ts`, `tools/alm/integrations/shared/read-runtime.ts`, `tools/alm/integrations/shared/write-runtime.ts`

## tools/alm/integrations/jira/read-jira.ts
- purpose: deterministic Jira data pipeline.
- exports: `DEFAULT_OUTPUT_DIR`, `ExtractedIssue`, `MAX_SUBLIST_ITEMS`, `RawIssue`, `ReadConfig`, `buildExtractedIssue(raw: RawIssue, registry: FieldRegistry, snapshot: Snapshot)`, `buildIssueConcept(issue: ExtractedIssue, renderedMarkdown?: string)`, `fetchFullChangelog(http: HttpClient, key: string, raw: RawIssue, max)`, `fetchWorklogs(http: HttpClient, key: string, max)`, `renderIssueMarkdown(issue: ExtractedIssue)`
- imports: `tools/alm/integrations/shared/adf.ts`, `tools/alm/integrations/shared/auth.ts`, `tools/alm/integrations/shared/field-registry.ts`, `tools/alm/integrations/shared/http-client.ts`, `tools/alm/integrations/shared/jira-reshape.ts`, `tools/alm/integrations/shared/okf.ts`, `tools/alm/integrations/shared/read-runtime.ts`

## tools/alm/integrations/jira/write-jira.ts
- purpose: WRITE to Jira: create an issue, update an issue's content, or add a comment.
- exports: `WriteMeta`, `WriteMetaType`, `buildCreatePayload(meta: WriteMetaType, title: string, description: AdfNode)`, `buildUpdatePayload(meta: WriteMetaType, title: string | undefined, description: AdfNode | undefined)`
- imports: `tools/alm/integrations/shared/adf.ts`, `tools/alm/integrations/shared/auth.ts`, `tools/alm/integrations/shared/http-client.ts`, `tools/alm/integrations/shared/markdown-to-adf.ts`, `tools/alm/integrations/shared/read-runtime.ts`, `tools/alm/integrations/shared/write-runtime.ts`

## tools/alm/integrations/miro/read-miro.ts
- purpose: batch extraction from Miro boards into on-disk snapshots.
- exports: `BoardItem`, `ReadConfig`, `boardIdSchema`, `fetchBoardItems(http: HttpClient, boardId: string, maxItems: number)`, `fetchBoards(http: HttpClient, teamId: string | undefined, maxItems: number)`, `groupByType(items: readonly BoardItem[…])`, `renderBoardMarkdown(board: RawBoard, items: readonly BoardItem[…], truncated: boolean)`, `reshapeItem(raw: RawItem)`, `stripHtml(html: string)`
- imports: `tools/alm/integrations/shared/auth.ts`, `tools/alm/integrations/shared/http-client.ts`, `tools/alm/integrations/shared/read-runtime.ts`
- imported by: `tools/alm/integrations/miro/write-miro.ts`

## tools/alm/integrations/miro/write-miro.ts
- purpose: WRITE to Miro: create sticky notes on a board, or update one note's text.
- exports: `WriteMeta`, `WriteMetaType`, `buildNotePayload(meta: WriteMetaType, text: string, index: number)`, `notePosition(index: number)`, `splitNotes(body: string)`
- imports: `tools/alm/integrations/miro/read-miro.ts`, `tools/alm/integrations/shared/auth.ts`, `tools/alm/integrations/shared/http-client.ts`, `tools/alm/integrations/shared/line-diff.ts`, `tools/alm/integrations/shared/read-runtime.ts`, `tools/alm/integrations/shared/write-runtime.ts`

## tools/alm/integrations/shared/adf.ts
- purpose: ADF (Atlassian Document Format) → Markdown converter.
- exports: `AdfMark`, `AdfNode`, `adfToMarkdown(input: AdfNode | string | null | undefined)`, `adfToMarkdownSafe(raw: unknown)`, `codeSpan(text: string)`, `fencedBlock(content: string, language)`, `flatLine(text: string)`, `longestBacktickRun(text: string)`
- imported by: `tools/alm/integrations/browser-inspector/read-browser-inspector.ts`, `tools/alm/integrations/confluence/read-confluence.ts`, `tools/alm/integrations/confluence/write-confluence.ts`, `tools/alm/integrations/jira/read-jira.ts`, `tools/alm/integrations/jira/write-jira.ts`, `tools/alm/integrations/shared/jira-reshape.ts`, `tools/alm/integrations/shared/markdown-to-adf.ts`, `tools/alm/integrations/xray/read-xray.ts`

## tools/alm/integrations/shared/auth.ts
- purpose: Token loading.
- exports: `AuthConfig`, `E_AUTH_MISSING`, `authHeaderFor(auth: AuthConfig)`, `defaultGitLabProject()`, `defaultJiraProject()`, `loadConfluenceAuth()`, `loadFigmaAuth()`, `loadGitLabAuth()`, `loadJiraAuth()`, `loadMiroAuth()`, `loadSonarAuth()`, `resetUserConfigCacheForTests()`
- imports: `tools/alm/integrations/shared/errors.ts`, `tools/alm/integrations/shared/user-config.ts`
- imported by: `tools/alm/integrations/confluence/read-confluence.ts`, `tools/alm/integrations/confluence/write-confluence.ts`, `tools/alm/integrations/figma/read-figma.ts`, `tools/alm/integrations/gitlab/read-gitlab.ts`, `tools/alm/integrations/gitlab/write-gitlab.ts`, `tools/alm/integrations/jira/read-jira.ts`, `tools/alm/integrations/jira/write-jira.ts`, `tools/alm/integrations/miro/read-miro.ts`, `tools/alm/integrations/miro/write-miro.ts`, `tools/alm/integrations/shared/http-client.ts`, `tools/alm/integrations/sonar/read-sonar.ts`, `tools/alm/integrations/xray/read-xray.ts`

## tools/alm/integrations/shared/confluence-cql.ts
- purpose: Pure helpers for assembling Confluence CQL (Confluence Query Language) search strings.
- exports: `BuildLabelCqlInput`, `buildLabelSearchCql(input: BuildLabelCqlInput)`, `escapeCqlString(value: string)`
- imported by: `tools/alm/integrations/confluence/read-confluence.ts`

## tools/alm/integrations/shared/errors.ts
- purpose: Typed error hierarchy shared by every pipeline.
- exports: `AuthError`, `ExtractError`, `NetworkError`, `NotFoundError`, `RateLimitError`, `SecurityError`, `UpstreamError`
- imported by: `tools/alm/integrations/shared/auth.ts`, `tools/alm/integrations/shared/http-client.ts`, `tools/alm/integrations/xray/read-xray.ts`

## tools/alm/integrations/shared/field-registry.ts
- purpose: Field registry — discovers Jira's custom-field metadata and maps `customfield_10042` to a human-readable shape `{ id, name, type, value }`.
- exports: `FieldMeta`, `FieldRegistry`, `ReshapedField`, `createJiraFieldRegistry(http: HttpClient, options: {…})`, `reshapeFieldValue(meta: FieldMeta | undefined, raw: unknown, // Required on purpose: the optional form fell back to 'unknown' — the exact
  // indistinguishable-field collapse the docblock above condemns, reachable by
  // any caller that simply forgot the argument.
  fieldId: string)`
- imports: `tools/alm/integrations/shared/http-client.ts`
- imported by: `tools/alm/integrations/jira/read-jira.ts`, `tools/alm/integrations/shared/jira-reshape.ts`

## tools/alm/integrations/shared/figma-node-tree.ts
- purpose: Pure helpers for bounding a Figma document node tree before it reaches the consumer.
- exports: `PrunedForest`, `countNodes(children: readonly unknown[…], depth)`, `pruneNodeTree(children: readonly unknown[…], maxNodes: number)`
- imported by: `tools/alm/integrations/figma/read-figma.ts`

## tools/alm/integrations/shared/figma-tokens.ts
- purpose: Pure emitters for Figma design tokens → CSS variables / SCSS variables / TS const.
- exports: `FigmaResolvedType`, `RawFigmaColor`, `RawFigmaVariable`, `RawFigmaVariableCollection`, `RawVariablesResponse`, `Token`, `TokenKind`, `emitCss(tokens: readonly Token[…])`, `emitForFormat(tokens: readonly Token[…], format: 'css' | 'scss' | 'ts')`, `emitScss(tokens: readonly Token[…])`, `emitTs(tokens: readonly Token[…])`, `mapFigmaVariables(raw: RawVariablesResponse)`
- imported by: `tools/alm/integrations/figma/read-figma.ts`

## tools/alm/integrations/shared/gitlab-reshape.ts
- purpose: Reshape raw GitLab MR / Issue / Pipeline responses into a token-friendly canonical form.
- exports: `CanonicalGitLabIssue`, `CanonicalMr`, `CanonicalPipeline`, `encodeProject(project: string)`, `reshapeGitLabIssue(raw: RawGitLabIssue)`, `reshapeGitLabMr(raw: RawMr)`, `reshapeGitLabPipeline(raw: RawPipeline)`
- imported by: `tools/alm/integrations/gitlab/read-gitlab.ts`, `tools/alm/integrations/gitlab/write-gitlab.ts`

## tools/alm/integrations/shared/http-client.ts
- purpose: Tiny HTTP client over native fetch.
- exports: `DEFAULT_TIMEOUT_MS`, `HttpClient`, `HttpClientOptions`, `HttpRequest`, `ResponseMeta`, `assertHostnameAllowed(url: string)`, `buildUrl(baseUrl: string, path: string, query?: HttpRequest[…])`, `createHttpClient(auth: AuthConfig, options: HttpClientOptions)`, `createNamedHttpClient(name: string, auth: AuthConfig)`
- env: `EXTRACT_ALLOW_PRIVATE_HOSTS`, `EXTRACT_HTTP_CONCURRENCY`
- imports: `tools/alm/integrations/shared/auth.ts`, `tools/alm/integrations/shared/errors.ts`, `tools/alm/integrations/shared/http-log.ts`, `tools/alm/integrations/shared/lru-cache.ts`, `tools/alm/integrations/shared/run-identity.ts`, `tools/alm/integrations/shared/version.ts`
- imported by: `tools/alm/integrations/confluence/read-confluence.ts`, `tools/alm/integrations/confluence/write-confluence.ts`, `tools/alm/integrations/figma/read-figma.ts`, `tools/alm/integrations/gitlab/read-gitlab.ts`, `tools/alm/integrations/gitlab/write-gitlab.ts`, `tools/alm/integrations/jira/read-jira.ts`, `tools/alm/integrations/jira/write-jira.ts`, `tools/alm/integrations/miro/read-miro.ts`, `tools/alm/integrations/miro/write-miro.ts`, `tools/alm/integrations/shared/field-registry.ts`, `tools/alm/integrations/sonar/read-sonar.ts`, `tools/alm/integrations/xray/read-xray.ts`

## tools/alm/integrations/shared/http-log.ts
- purpose: JSONL z KAŻDĄ próbą żądania HTTP i jej odpowiedzią, w osobnym pliku per przebieg.
- exports: `HttpLogAttempt`, `HttpLogEntry`, `HttpLogger`, `createHttpLogger(scriptName: string, env: NodeJS.ProcessEnv)`, `httpLogEntry(attempt: HttpLogAttempt, now: Date)`
- env: `EXTRACT_HTTP_LOG`, `EXTRACT_HTTP_LOG_DIR`
- imported by: `tools/alm/integrations/shared/http-client.ts`

## tools/alm/integrations/shared/jira-reshape.ts
- purpose: Reshape a raw Jira issue into a token-friendly canonical form.
- exports: `CanonicalIssue`, `IssueRef`, `issueRefLine(ref: IssueRef)`, `reshapeJiraIssue(raw: RawIssue, registry: FieldRegistry)`
- imports: `tools/alm/integrations/shared/adf.ts`, `tools/alm/integrations/shared/field-registry.ts`
- imported by: `tools/alm/integrations/jira/read-jira.ts`, `tools/alm/integrations/xray/read-xray.ts`

## tools/alm/integrations/shared/line-diff.ts
- purpose: A minimal line diff for the `apply` pipelines' dry-run output.
- exports: `diffLines(before: string, after: string)`
- imported by: `tools/alm/integrations/miro/write-miro.ts`, `tools/alm/integrations/shared/write-runtime.ts`

## tools/alm/integrations/shared/lru-cache.ts
- purpose: Tiny TTL + LRU cache, dependency-free.
- exports: `LruCache`
- imported by: `tools/alm/integrations/shared/http-client.ts`

## tools/alm/integrations/shared/markdown-to-adf.ts
- purpose: Markdown → ADF (Atlassian Document Format), the WRITE-side twin of `adf.ts`.
- exports: `AdfDoc`, `markdownToAdf(markdown: string)`, `parseInline(source: string, inherited: readonly AdfMark[…])`
- imports: `tools/alm/integrations/shared/adf.ts`
- imported by: `tools/alm/integrations/confluence/write-confluence.ts`, `tools/alm/integrations/jira/write-jira.ts`

## tools/alm/integrations/shared/okf.ts
- purpose: OKF v0.1 bundle writer for the `extract-*` pipelines (render format `'okf'`).
- exports: `OKF_BUNDLE_DIR`, `OkfConceptInput`, `OkfFmValue`, `OkfLogEntry`, `insertOkfLogEntry(entry: OkfLogEntry, priorLog?: string)`, `okfFrontmatter(entries: readonly (readonly […])[…])`, `okfLogDate(stampOrIso: string)`, `okfScalar(value: string)`, `renderOkfConcept(concept: OkfConceptInput, stamp: string)`, `renderOkfIndex(args: {…})`, `writeOkfBundle(args: {…})`
- imports: `tools/alm/integrations/shared/read-runtime.ts`, `tools/alm/integrations/shared/version.ts`
- imported by: `tools/alm/integrations/confluence/read-confluence.ts`, `tools/alm/integrations/jira/read-jira.ts`

## tools/alm/integrations/shared/read-runtime.ts
- purpose: Shared helpers for `integrations/<source>/extract-<source>.ts`.
- exports: `ManifestRun`, `OffsetPage`, `OffsetWalk`, `PIPELINE_CONCURRENCY`, `ReadArgs`, `ReadRun`, `RenderFormat`, `SIDECAR_DEFAULT_CHARS`, `STAMP_PATTERN`, `WrittenFile`, `assertSafeBasename(basename: string)`, `assertUniqueSnapshotNames(config: {…}, ctx: z.RefinementCtx)`, `buildManifest`, `createScriptLogger(scriptName: string)`, `defaultConfigPath(source: string)`, `defaultOutputDir(source: string)`, `escapeTableCell(value: string)`, `formatSchemaIssues(error: z.ZodError)`, `formatStamp(date: Date)`, `loadJsonConfig`, `mapWithConcurrency`, `mdTable(headers: readonly string[…], rows: readonly (readonly string[…])[…])`, `parseCursorFromLink(linkOrUndefined: string | undefined)`, `parseReadArgs(argv: readonly string[…], defaultConfigPath: string, env: Record<string, string | undefined>)`, `renderFormatsSchema`, `renderFormatsWithOkfSchema`, `runIfMain(scriptName: string, fileUrl: string, main: ())`, `snapshotNameSchema`, `startReadRun`, `walkOffsetPages`, `warnIfTruncated(log: (msg: string), truncated: boolean, detail: string)`, `writeManifest(dir: string, manifest: unknown)`, `writePipelineOutputs(args: {…})`
- env: `EXTRACT_STAMP`
- imports: `tools/alm/integrations/shared/run-identity.ts`, `tools/alm/integrations/shared/version.ts`
- imported by: `tools/alm/integrations/browser-inspector/read-browser-inspector.ts`, `tools/alm/integrations/confluence/read-confluence.ts`, `tools/alm/integrations/confluence/write-confluence.ts`, `tools/alm/integrations/figma/read-figma.ts`, `tools/alm/integrations/gitlab/read-gitlab.ts`, `tools/alm/integrations/gitlab/write-gitlab.ts`, `tools/alm/integrations/jira/read-jira.ts`, `tools/alm/integrations/jira/write-jira.ts`, `tools/alm/integrations/miro/read-miro.ts`, `tools/alm/integrations/miro/write-miro.ts`, `tools/alm/integrations/shared/okf.ts`, `tools/alm/integrations/shared/write-runtime.ts`, `tools/alm/integrations/sonar/read-sonar.ts`, `tools/alm/integrations/xray/read-xray.ts`

## tools/alm/integrations/shared/run-identity.ts
- purpose: Identity of ONE run, for outbound attribution.
- exports: `getCorrelationId(env: Record<string, string | undefined>)`, `getRunUser()`, `resetCorrelationIdForTests()`, `sanitizeHeaderValue(value: string)`
- env: `EXTRACT_CORRELATION_ID`, `USER`, `USERNAME`
- imported by: `tools/alm/integrations/shared/http-client.ts`, `tools/alm/integrations/shared/read-runtime.ts`

## tools/alm/integrations/shared/sonar-reshape.ts
- purpose: Reshape raw Sonar issues / hotspots / measures into token-friendly canonical forms.
- exports: `CanonicalHotspot`, `CanonicalSonarIssue`, `SonarImpact`, `reshapeHotspot(raw: RawHotspot)`, `reshapeSonarIssue(raw: RawSonarIssue)`
- imported by: `tools/alm/integrations/sonar/read-sonar.ts`

## tools/alm/integrations/shared/user-config.ts
- purpose: Cross-platform user-profile config loader for the upstream credentials.
- exports: `UserConfig`, `UserConfigSchema`, `getUserConfigPath()`, `loadUserConfig()`
- env: `EXTRACT_CONFIG_DIR`, `EXTRACT_CONFIG_PATH`, `XDG_CONFIG_HOME`
- imported by: `tools/alm/integrations/shared/auth.ts`

## tools/alm/integrations/shared/version.ts
- purpose: Version of the extract tooling.
- exports: `getRepoVersion()`
- imported by: `tools/alm/integrations/shared/http-client.ts`, `tools/alm/integrations/shared/okf.ts`, `tools/alm/integrations/shared/read-runtime.ts`, `tools/alm/integrations/shared/write-runtime.ts`

## tools/alm/integrations/shared/write-runtime.ts
- purpose: Shared runtime for the WRITE pipelines (`integrations/<source>/write-<source>.ts`).
- exports: `DRY_RUN_FOOTER`, `MarkdownInput`, `ProvenanceAction`, `WriteArgs`, `WriteMode`, `assertWriteMode(declared: WriteMode | undefined, actual: WriteMode, describe: string)`, `loadMarkdownInput`, `logUpdatePreview(log: (msg: string), args: {…})`, `mapLinesOutsideFences(text: string, transform: (line: string))`, `parseMarkdownInput`, `parseWriteArgs(argv: readonly string[…])`, `prepareBodyWithLog(log: (msg: string), body: string, action: ProvenanceAction)`, `prepareCommentBodyWithLog(log: (msg: string), rawBody: string, labels: {…})`, `provenanceLine(action: ProvenanceAction)`, `stripTrailingProvenance(body: string)`, `updatedBodyOrUndefined(input: {…})`, `withProvenance(body: string, action: ProvenanceAction)`
- imports: `tools/alm/integrations/shared/line-diff.ts`, `tools/alm/integrations/shared/read-runtime.ts`, `tools/alm/integrations/shared/version.ts`
- imported by: `tools/alm/integrations/confluence/write-confluence.ts`, `tools/alm/integrations/gitlab/write-gitlab.ts`, `tools/alm/integrations/jira/write-jira.ts`, `tools/alm/integrations/miro/write-miro.ts`

## tools/alm/integrations/sonar/read-sonar.ts
- purpose: deterministic SonarQube / SonarCloud data pipeline.
- exports: `HotspotsSummary`, `IssuesSummary`, `MeasuresSummary`, `QualityGateSummary`, `ReadConfig`, `paginateSonar`, `renderHotspotsMarkdown(summary: HotspotsSummary)`, `renderIssuesMarkdown(summary: IssuesSummary)`, `renderMeasuresMarkdown(summary: MeasuresSummary)`, `renderQualityGateMarkdown(qg: QualityGateSummary)`
- imports: `tools/alm/integrations/shared/auth.ts`, `tools/alm/integrations/shared/http-client.ts`, `tools/alm/integrations/shared/read-runtime.ts`, `tools/alm/integrations/shared/sonar-reshape.ts`

## tools/alm/integrations/xray/read-xray.ts
- purpose: batch extraction from Xray for Jira (Server/DC, Xray as a Jira PLUGIN) into on-disk snapshots.
- exports: `ReadConfig`, `chunkKeys(keys: readonly string[…], size: number)`, `renderExecutionsMarkdown(summary: ExecutionsSummary)`, `renderTestsMarkdown(summary: TestsSummary)`, `reshapeRun(raw: RawRun)`, `reshapeTest(raw: RawTest, envelope: Omit<IssueRef, 'type'>)`
- imports: `tools/alm/integrations/shared/adf.ts`, `tools/alm/integrations/shared/auth.ts`, `tools/alm/integrations/shared/errors.ts`, `tools/alm/integrations/shared/http-client.ts`, `tools/alm/integrations/shared/jira-reshape.ts`, `tools/alm/integrations/shared/read-runtime.ts`

## tools/alm/scripts/read.mjs
- purpose: one entry point for every read pipeline.
- exports: `DIST`, `E_READ_NOT_BUILT`, `E_READ_USAGE`, `ROOT`, `discoverPipelines(dist, prefix) → Array<{name: string, entry: string}>`, `plan({…})`, `predictConfigPath(name, argv)`, `runDispatcher(decision, check)`, `selectSource(pipelines, name, spec) → {error: {code: string, exit: number, message: string}} | {c…`
- imported by: `tools/alm/scripts/write.mjs`

## tools/alm/scripts/write.mjs
- purpose: one entry point for BOTH write commands, `create` and `update`, over the `write-<source>` pipelines.
- exports: `E_WRITE_NOT_BUILT`, `E_WRITE_USAGE`, `plan({…})`
- imports: `tools/alm/scripts/read.mjs`

## tools/browser-inspector/bin/browser-inspector.mjs
- purpose: the entry the agent runs (DESIGN.md §2.1 / §3.1).
- imports: `tools/browser-inspector/src/cli.mjs`, `tools/browser-inspector/src/client.mjs`

## tools/browser-inspector/src/auth.mjs
- purpose: log in ONCE, run every snapshot already logged in (DESIGN.md §2.3, §2.6, §3.3; a port of the auth block of the ALM tool's read-browser pipe…
- exports: `AuthError`, `E_AUTH`, `OAUTH_TIMEOUT_MS`, `TOKEN_EXPIRY_MARGIN_MS`, `ensureSession(auth, options) → Promise<SessionInfo>`, `metaPath(statePath)`, `oauthRequestBody(oauth, source) → Record<string, string>`, `oauthStorageState(store, accessToken)`, `oauthTokenUrl(oauth) → string`, `resolveAuthValues(auth, source) → { values: Record<string, string>, secretValues: string[], m…`, `resolveStatePath(auth, baseDir)`, `sessionUsable(stat, nowMs, maxAgeMinutes) → { usable: boolean, reason: string }`, `storageStateFor(snapshot, session) → string | undefined`, `tokenExpiresAt(tokenResponse, nowMs) → number | undefined`, `tokenUsable(meta, nowMs) → { usable: boolean, reason: string }`
- imports: `tools/browser-inspector/src/isolation.mjs`, `tools/browser-inspector/src/recorder.mjs`, `tools/browser-inspector/src/redact.mjs`, `tools/browser-inspector/src/steps.schema.mjs`
- types only: `tools/browser-inspector/src/types.d.ts`
- imported by: `tools/browser-inspector/src/flow.mjs`, `tools/browser-inspector/src/keeper.requests.mjs`

## tools/browser-inspector/src/capture.mjs
- purpose: screenshots, the final evidence and `evaluate` (DESIGN.md §2.2, §3.3, §6).
- exports: `ELEMENTS_CAP`, `EVIDENCE_CAP_MS`, `EXTRACT_CAP`, `TEXT_CAP`, `evaluateWithTimeout(cdp, expression, options) → Promise<string>`, `exceptionText(details) → string`, `finalEvidence(ctx, snapshot, run) → Promise<Evidence & { screenshot?: string, title?: string, f…`, `finalScreenshotName(snapshot, run) → 'page' | 'final' | undefined`, `mapEvaluateResult(response) → string`, `pageEvidence(page, options) → Promise<Evidence>`, `pngSize(buffer) → { width: number, height: number } | undefined`, `saveScreenshot(page, cdp, file, options) → Promise<{ file: string, write: Promise<void>, width?: numbe…`, `screenshotFast(page, cdp, options) → Promise<{ buffer: Buffer, width?: number, height?: number, …`, `stringifyResult(value) → string`
- imports: `tools/browser-inspector/src/deadline.mjs`
- types only: `tools/browser-inspector/src/types.d.ts`
- imported by: `tools/browser-inspector/src/flow.mjs`, `tools/browser-inspector/src/steps.run.mjs`

## tools/browser-inspector/src/cli.mjs
- purpose: the pure argv parser of `browser-inspector` (DESIGN.md §3.1): two entrances, one grammar.
- exports: `CONTROL_COMMANDS`, `CliError`, `STAMP_PATTERN`, `bindPositionals(positionals, argvSpec, command, help) → Record<string, any>`, `formatStamp(date) → string`, `parseArgs(argv, steps) → ParsedArgs`, `parseSessionCommand(command, args, steps) → { name: string, step: Record<string, unknown>, options: Rec…`, `splitFlags(args, spec, scope) → { positionals: string[], flags: Record<string, any> }`, `suggest(word, candidates) → string | undefined`, `usage(command) → string`
- imports: `tools/browser-inspector/src/steps.schema.mjs`
- types only: `tools/browser-inspector/src/types.d.ts`
- imported by: `tools/browser-inspector/bin/browser-inspector.mjs`, `tools/browser-inspector/src/client.mjs`, `tools/browser-inspector/src/keeper.requests.mjs`, `tools/browser-inspector/src/report.mjs`, `tools/browser-inspector/src/session.mjs`

## tools/browser-inspector/src/client.mjs
- purpose: the process the agent actually runs (DESIGN.md §2.4): parse, resolve, connect, print.
- exports: `CONNECT_RETRY_MS`, `CONNECT_TIMEOUT_MS`, `CONTROL_TIMEOUT_MS`, `DOCTOR_JOB_TIMEOUT_MS`, `INLINE_FILE_MAX`, `KeeperUnavailableError`, `REQUEST_TIMEOUT_MS`, `computeIdentity(input) → Identity`, `connectOnce(pipe) → Promise<net.Socket>`, `doctor(input) → Promise<{ line: string, survives: boolean, spawnToListenMs:…`, `ensureKeeper(identity, options) → Promise<{ socket: net.Socket, token: string, spawned: boole…`, `exchange(socket, request, onProgress, options) → Promise<KeeperDone>`, `isScriptComment(line)`, `main(argv, io) → Promise<number>`, `packageVersion() → string`, `readFileEntry(file, bases, where) → KeeperFile`, `readPidFile(file) → { pid: number, pipe: string, token: string, listeningAt?: n…`, `requestTimeout(env, override) → number`, `resolveValues(parsed, input) → { values: Record<string, string>, secretValues: string[], f…`, `runInProcess(request, options) → Promise<KeeperDone>`, `runViaKeeper(request, options) → Promise<KeeperDone>`, `spawnKeeper(identity, env) → number | undefined`, `splitCommandLine(line) → string[]`
- subscribes: `child:error`, `rl:line`, `shell:error`, `shell:exit`, `socket:close`, `socket:connect`, `socket:error`
- env: `BROWSER_INSPECTOR_CONNECT_TIMEOUT_MS`, `BROWSER_INSPECTOR_ENGINE_MODULE`, `BROWSER_INSPECTOR_IDLE_MS`, `BROWSER_INSPECTOR_REQUEST_TIMEOUT_MS`, `BROWSER_INSPECTOR_SESSION`, `BROWSER_INSPECTOR_SOCKET`, `BROWSER_INSPECTOR_TMPDIR`
- imports: `tools/browser-inspector/src/cli.mjs`, `tools/browser-inspector/src/config.mjs`, `tools/browser-inspector/src/keeper.mjs`, `tools/browser-inspector/src/keeper.requests.mjs`, `tools/browser-inspector/src/paths.mjs`, `tools/browser-inspector/src/print.mjs`
- types only: `tools/browser-inspector/src/cli.mjs`, `tools/browser-inspector/src/types.d.ts`
- imported by: `tools/browser-inspector/bin/browser-inspector.mjs`, `tools/browser-inspector/src/session.mjs`

## tools/browser-inspector/src/config.mjs
- purpose: loading, validating and linting a batch config (DESIGN.md §3.3, §3.4).
- exports: `ConfigError`, `DEFAULTS`, `lintConfig(config) → { findings: LintFinding[], lines: string[] }`, `loadConfig(configPath, cwd) → Record<string, any>`, `parseConfig(raw, options) → Record<string, any>`
- imports: `tools/browser-inspector/src/paths.mjs`, `tools/browser-inspector/src/steps.schema.mjs`
- imported by: `tools/browser-inspector/src/client.mjs`, `tools/browser-inspector/src/keeper.requests.mjs`

## tools/browser-inspector/src/deadline.mjs
- purpose: `withDeadline` and `degradeTo`, ported from the TypeScript browser-inspector.
- exports: `DeadlineError`, `degradeTo(fallback, promise, ms, label) → Promise<T>`, `isDeadline(error)`, `withDeadline(promise, ms, label) → Promise<T>`
- imported by: `tools/browser-inspector/src/capture.mjs`, `tools/browser-inspector/src/flow.mjs`, `tools/browser-inspector/src/lanes.mjs`, `tools/browser-inspector/src/session.mjs`, `tools/browser-inspector/src/steps.ctx.mjs`, `tools/browser-inspector/src/steps.run.mjs`

## tools/browser-inspector/src/engine.mjs
- purpose: ONE engine on playwright-core for both entrances (DESIGN.md §2.2, §2.3, §5, §6).
- exports: `createEngine(first, hooks)`
- env: `BROWSER_INSPECTOR_MAX_JOBS`, `BROWSER_INSPECTOR_MAX_RSS_MB`
- imports: `tools/browser-inspector/src/flow.mjs`, `tools/browser-inspector/src/lanes.mjs`, `tools/browser-inspector/src/paths.mjs`, `tools/browser-inspector/src/recorder.mjs`, `tools/browser-inspector/src/session.mjs`, `tools/browser-inspector/src/steps.ctx.mjs`, `tools/browser-inspector/src/steps.run.mjs`
- types only: `tools/browser-inspector/src/flow.mjs`, `tools/browser-inspector/src/lanes.mjs`, `tools/browser-inspector/src/session.mjs`, `tools/browser-inspector/src/types.d.ts`

## tools/browser-inspector/src/flow.mjs
- purpose: the batch half of the engine (DESIGN.md §2.2, §5, §6).
- exports: `createFlowRunner(input)`
- imports: `tools/browser-inspector/src/auth.mjs`, `tools/browser-inspector/src/capture.mjs`, `tools/browser-inspector/src/deadline.mjs`, `tools/browser-inspector/src/isolation.mjs`, `tools/browser-inspector/src/lanes.mjs`, `tools/browser-inspector/src/recorder.mjs`, `tools/browser-inspector/src/redact.mjs`, `tools/browser-inspector/src/report.mjs`, `tools/browser-inspector/src/schedule.mjs`, `tools/browser-inspector/src/steps.ctx.mjs`, `tools/browser-inspector/src/steps.run.mjs`, `tools/browser-inspector/src/steps.schema.mjs`
- types only: `tools/browser-inspector/src/auth.mjs`, `tools/browser-inspector/src/lanes.mjs`, `tools/browser-inspector/src/types.d.ts`
- imported by: `tools/browser-inspector/src/engine.mjs`

## tools/browser-inspector/src/isolation.mjs
- purpose: the PURE half of "one persistent tab, scrubbed in place" (DESIGN.md §2.3).
- exports: `DEFAULT_VIEWPORT`, `GEN_MARKER`, `GEN_SCRIPT(generation) → string`, `SCRUB_STORAGE_TYPES`, `clearableOrigins(origins) → string[]`, `needsFreshContext(snapshot, options) → boolean`, `scrubPlan(state) → ScrubOp[]`
- types only: `tools/browser-inspector/src/types.d.ts`
- imported by: `tools/browser-inspector/src/auth.mjs`, `tools/browser-inspector/src/flow.mjs`, `tools/browser-inspector/src/lanes.mjs`

## tools/browser-inspector/src/keeper.mjs
- purpose: the warm browser's process (DESIGN.md §2.5), and the one request handler that the `--no-daemon` / fallback path runs in-process without a s…
- exports: `DEFAULT_ENGINE_MODULE`, `IDLE_MS_DEFAULT`, `KEEPER_PATH`, `LOCK_YOUNG_MS`, `LOG_MAX_BYTES`, `MAX_JOBS_DEFAULT`, `MAX_RSS_MB_DEFAULT`, `PROBE_TIMEOUT_MS`, `RSS_CHECK_EVERY`, `SESSION_TTL_MS_DEFAULT`, `acquireLock(lockPath, pid, options) → Promise<boolean>`, `createContext(options)`, `createQueues()`, `holderAnswers(file, holder, options) → Promise<boolean>`, `isAlive(pid)`, `loadEngine(spec, browserOpts, hooks) → Promise<EngineLike>`, `probePipe(pipe, timeoutMs) → Promise<boolean>`, `startKeeper(options)`
- subscribes: `process:uncaughtException`, `process:unhandledRejection`, `rl:line`, `server:connection`, `server:error`, `socket:connect`, `socket:error`
- env: `BROWSER_INSPECTOR_ENGINE_MODULE`, `BROWSER_INSPECTOR_IDLE_MS`, `BROWSER_INSPECTOR_MAX_JOBS`, `BROWSER_INSPECTOR_MAX_RSS_MB`, `BROWSER_INSPECTOR_SESSION_TTL_MS`, `BROWSER_INSPECTOR_TMPDIR`
- imports: `tools/browser-inspector/src/keeper.requests.mjs`, `tools/browser-inspector/src/paths.mjs`, `tools/browser-inspector/src/print.mjs`, `tools/browser-inspector/src/redact.mjs`
- types only: `tools/browser-inspector/src/types.d.ts`
- imported by: `tools/browser-inspector/src/client.mjs`

## tools/browser-inspector/src/keeper.requests.mjs
- purpose: what ONE request is and what it does (DESIGN.md §2.5, §3, §5).
- exports: `EngineUnavailableError`, `PROTOCOL_VERSION`, `done(exit, lines, files, extra) → KeeperDone`, `handleRequest(request, ctx) → Promise<KeeperDone>`, `messageOf(error)`, `statusOf(eng)`
- imports: `tools/browser-inspector/src/auth.mjs`, `tools/browser-inspector/src/cli.mjs`, `tools/browser-inspector/src/config.mjs`, `tools/browser-inspector/src/paths.mjs`, `tools/browser-inspector/src/print.mjs`, `tools/browser-inspector/src/redact.mjs`, `tools/browser-inspector/src/report.mjs`, `tools/browser-inspector/src/schedule.mjs`
- types only: `tools/browser-inspector/src/auth.mjs`, `tools/browser-inspector/src/cli.mjs`, `tools/browser-inspector/src/keeper.mjs`, `tools/browser-inspector/src/types.d.ts`
- imported by: `tools/browser-inspector/src/client.mjs`, `tools/browser-inspector/src/keeper.mjs`

## tools/browser-inspector/src/lanes.mjs
- purpose: the browser and its lanes: launch, `scratch[0..N-1]`, the scrub, health, recycling (DESIGN.md §2.2, §2.3).
- exports: `BrowserMissingError`, `DEFAULT_TIMEOUT_MS`, `E_BROWSER_MISSING`, `FAST_HEADLESS_ARGS`, `LANE_IDLE_MS_DEFAULT`, `MAX_JOBS_DEFAULT`, `MAX_RSS_MB_DEFAULT`, `RSS_CHECK_EVERY`, `SCRUB_OP_MS_DEFAULT`, `createLanePool(input)`, `launchBrowser(browser, options) → Promise<{ browser: any, channel: string, args: string[], la…`, `launchPlan(browser, env) → { attempts: { channel?: string, executablePath?: string }[]…`, `processRssMbAsync(pids) → Promise<number>`
- env: `BROWSER_INSPECTOR_BROWSER_ARGS`, `BROWSER_INSPECTOR_BROWSER_PATH`, `BROWSER_INSPECTOR_CHANNEL`, `BROWSER_INSPECTOR_LANE_IDLE_MS`, `BROWSER_INSPECTOR_SCRUB_OP_MS`
- imports: `tools/browser-inspector/src/deadline.mjs`, `tools/browser-inspector/src/isolation.mjs`, `tools/browser-inspector/src/recorder.mjs`
- types only: `tools/browser-inspector/src/recorder.mjs`, `tools/browser-inspector/src/types.d.ts`
- imported by: `tools/browser-inspector/src/engine.mjs`, `tools/browser-inspector/src/flow.mjs`

## tools/browser-inspector/src/paths.mjs
- purpose: where the keeper lives and whether it lives at all (DESIGN.md §2.5).
- exports: `CI_VARS`, `DEFAULT_OUTPUT_DIR`, `PORTABLE_MARKER`, `collectIdentity(input) → IdentityParts`, `daemonEnabled(env, options) → boolean`, `fnv1a(text) → string`, `identityHash(parts) → string`, `isCI(env) → boolean`, `lockFile(hash, tmpdir)`, `logFile(hash, tmpdir)`, `packageVersion(dir, fallback) → string`, `pidFile(hash, tmpdir)`, `pipeName(hash, options) → string`, `playwrightCoreVersion(packageDir) → string`, `resolveOutputDir(outputDir, baseDir) → string`, `sessionDir(out, name)`, `srcStamp(dir) → number`
- env: `BROWSER_INSPECTOR_BROWSER_ARGS`, `BROWSER_INSPECTOR_BROWSER_PATH`, `BROWSER_INSPECTOR_CHANNEL`, `BROWSER_INSPECTOR_DAEMON`, `BROWSER_INSPECTOR_SOCKET`, `BROWSER_INSPECTOR_UNSAFE`, `HTTPS_PROXY`, `HTTP_PROXY`, `NO_PROXY`, `USER`, `USERNAME`, `XDG_RUNTIME_DIR`
- imported by: `tools/browser-inspector/src/client.mjs`, `tools/browser-inspector/src/config.mjs`, `tools/browser-inspector/src/engine.mjs`, `tools/browser-inspector/src/keeper.mjs`, `tools/browser-inspector/src/keeper.requests.mjs`, `tools/browser-inspector/src/session.mjs`

## tools/browser-inspector/src/print.mjs
- purpose: the shape of every stdout line of a session (DESIGN.md §4.4), pure.
- exports: `EVAL_INLINE_MAX`, `KEEPER_UNAVAILABLE(reason)`, `MAX_LINE`, `REF_NOT_FOUND`, `SEP`, `formatBytes(bytes)`, `formatConsoleEntry(entry)`, `formatDeltas(before, after, options) → string[]`, `formatDialogStatus(policy, last)`, `formatDoctor(r)`, `formatEval(text, file) → string[]`, `formatExport(count, file)`, `formatFail(head, reason, parts)`, `formatLine(status, head, parts) → string`, `formatMs(ms) → string`, `formatNetBody(r)`, `formatNetEntry(entry, baseOrigin)`, `formatNetSummary(r) → string[]`, `formatNewEntries(lines, what) → string[]`, `formatOk(head, parts)`, `formatOpen(r)`, `formatOverflow(hidden, file)`, `formatShot(file, width, height)`, `relPath(file, cwd) → string`, `sliceUnits(text, max) → string`, `truncate(text, max) → string`, `urlDisplay(url, baseOrigin)`
- imported by: `tools/browser-inspector/src/client.mjs`, `tools/browser-inspector/src/keeper.mjs`, `tools/browser-inspector/src/keeper.requests.mjs`, `tools/browser-inspector/src/report.mjs`, `tools/browser-inspector/src/session.mjs`, `tools/browser-inspector/src/snapshot.mjs`, `tools/browser-inspector/src/steps.run.mjs`

## tools/browser-inspector/src/recorder.mjs
- purpose: the ONE set of page listeners, attached once per tab (DESIGN.md §2.2).
- exports: `BODY_LIMIT`, `BODY_READ_MS`, `BODY_TYPES`, `CONSOLE_CAP`, `DIALOG_CAP`, `FAILED_REQUEST_CAP`, `NETWORK_CAP`, `PAGE_ERROR_CAP`, `attachRecorder(page, options) → Recorder`, `createRecorder(options) → Recorder`, `errorMessage(error)`, `originOf(url) → string | null`, `summarize(recorder) → { console: { entries: ConsoleEntry[], total: number, trunca…`
- subscribes: `page:console`, `page:crash`, `page:dialog`, `page:framenavigated`, `page:pageerror`, `page:popup`, `page:request`, `page:requestfailed`, `page:requestfinished`, `page:response`
- types only: `tools/browser-inspector/src/types.d.ts`
- imported by: `tools/browser-inspector/src/auth.mjs`, `tools/browser-inspector/src/engine.mjs`, `tools/browser-inspector/src/flow.mjs`, `tools/browser-inspector/src/lanes.mjs`, `tools/browser-inspector/src/session.mjs`, `tools/browser-inspector/src/steps.ctx.mjs`

## tools/browser-inspector/src/redact.mjs
- purpose: ONE function for every place a secret could surface (DESIGN.md §2.6).
- exports: `MASK`, `maskSnapshotEntries(entries, options) → E[]`, `maskSnapshotValues(text, options) → string`, `redact(text, secretValues) → string`, `redactDeep(value, secretValues) → T`, `redactWith(text, forms) → string`, `secretForms(secretValues) → string[]`
- imported by: `tools/browser-inspector/src/auth.mjs`, `tools/browser-inspector/src/flow.mjs`, `tools/browser-inspector/src/keeper.mjs`, `tools/browser-inspector/src/keeper.requests.mjs`, `tools/browser-inspector/src/session-log.mjs`, `tools/browser-inspector/src/session.mjs`, `tools/browser-inspector/src/snapshot.mjs`, `tools/browser-inspector/src/steps.ctx.mjs`, `tools/browser-inspector/src/steps.run.mjs`

## tools/browser-inspector/src/report.mjs
- purpose: report.md / report.json, elements.md, JUnit, the two manifests and the artifact writer (DESIGN.md §5).
- exports: `CAPS`, `INLINE_VALUE`, `SCRIPT`, `SOURCE`, `artifactFiles(report) → Record<string, string>`, `buildManifest(run, results) → Manifest & { source: string, startedAt: string, finishedAt:…`, `buildReport(input) → BuiltReport`, `buildSnapshotManifest(report, snapshot) → SnapshotManifest`, `failureOf(report) → string | undefined`, `formatStepError(error) → string`, `renderElementsMd(report) → string`, `renderJUnit(suite, snapshots, options) → string`, `renderReportMd(report) → string`, `writeArtifacts(dir, report, files, options) → Promise<{ written: string[], ms: number }>`
- imports: `tools/browser-inspector/src/cli.mjs`, `tools/browser-inspector/src/print.mjs`
- types only: `tools/browser-inspector/src/types.d.ts`
- imported by: `tools/browser-inspector/src/flow.mjs`, `tools/browser-inspector/src/keeper.requests.mjs`

## tools/browser-inspector/src/schedule.mjs
- purpose: which lane a snapshot goes to (DESIGN.md §2.3).
- exports: `estimateSnapshot(snapshot) → number`, `planLanes(snapshots, parallel) → number[]`
- imported by: `tools/browser-inspector/src/flow.mjs`, `tools/browser-inspector/src/keeper.requests.mjs`

## tools/browser-inspector/src/session-log.mjs
- purpose: the session journal (`journal.jsonl`) and its export to a batch config (DESIGN.md §4.5).
- exports: `ExportError`, `JOURNAL_FILE`, `appendJournal(file, entry, options) → JournalEntry & { at: string }`, `exportFlow(entries, options) → ExportResult`, `flowNameFrom(file) → string`, `formatJournalLine(entry, secretValues) → string`, `journalLineCount(file)`, `journalPath(sessionDir)`, `normalizeEntry(entry, secretValues) → JournalEntry & { at: string }`, `readJournal(file) → JournalEntry[]`, `writeFlowExport(file, config, options) → string`
- imports: `tools/browser-inspector/src/redact.mjs`, `tools/browser-inspector/src/steps.schema.mjs`
- types only: `tools/browser-inspector/src/types.d.ts`
- imported by: `tools/browser-inspector/src/session.mjs`

## tools/browser-inspector/src/session.mjs
- purpose: the interactive half of the engine (DESIGN.md §4).
- exports: `createSessions(input)`
- subscribes: `page:close`, `page:popup`, `page:request`
- env: `BROWSER_INSPECTOR_STEP_TIMEOUT_MS`, `BROWSER_INSPECTOR_UNSAFE`
- imports: `tools/browser-inspector/src/cli.mjs`, `tools/browser-inspector/src/client.mjs`, `tools/browser-inspector/src/deadline.mjs`, `tools/browser-inspector/src/paths.mjs`, `tools/browser-inspector/src/print.mjs`, `tools/browser-inspector/src/recorder.mjs`, `tools/browser-inspector/src/redact.mjs`, `tools/browser-inspector/src/session-log.mjs`, `tools/browser-inspector/src/steps.ctx.mjs`, `tools/browser-inspector/src/steps.run.mjs`, `tools/browser-inspector/src/steps.schema.mjs`, `tools/browser-inspector/src/webmcp.mjs`
- types only: `tools/browser-inspector/src/lanes.mjs`, `tools/browser-inspector/src/recorder.mjs`, `tools/browser-inspector/src/types.d.ts`
- imported by: `tools/browser-inspector/src/engine.mjs`

## tools/browser-inspector/src/settle.mjs
- purpose: `waitUntil: "settled"` (DESIGN.md §2.2): `load` + a quiet window with no request in flight, capped, and never failing.
- exports: `CAP_MS_DEFAULT`, `POLL_MS`, `QUIET_MS_DEFAULT`, `waitSettled(page, recorder, options) → Promise<{ settled: boolean, ms: number }>`
- types only: `tools/browser-inspector/src/types.d.ts`
- imported by: `tools/browser-inspector/src/steps.ctx.mjs`

## tools/browser-inspector/src/snapshot.mjs
- purpose: pure functions over the FULL `page.ariaSnapshot({ mode: 'ai' })` (DESIGN.md §4.2–§4.3).
- exports: `CONTEXT_ROLES`, `FIND_MAX`, `INTERACTIVE_ROLES`, `REF_PATTERN`, `RefNotFoundError`, `SEMANTIC_ROLES`, `aroundRef(aiYaml, ref, options) → string[]`, `boxJoin(boxesYaml, walk) → { entries: SidecarEntry[], interactive: number, matched: nu…`, `compactLines(aiYaml, options) → string[]`, `compactSnapshot(aiYaml, options) → string`, `diffSnapshot(prev, next) → { added: string[], removed: string[] }`, `findInSnapshot(aiYaml, text, options) → { lines: string[], total: number }`, `implicitRole(e) → string`, `locatorFor(e, unique) → string | undefined`, `locatorForElement(el) → string | undefined`, `namesContext(nodes, node) → string | undefined`, `parseSnapshot(yaml) → SnapNode[]`, `resolveRef(page, ref, options) → Promise<{ selector: string, refreshed: boolean, snapshot?: …`, `sensitiveRefs(entries) → string[]`, `sidecarFromPage(page, boxesYaml) → Promise<SidecarEntry[]>`, `textUnder(nodes, node, max) → string`, `uniqueIn(walk) → (kind: 'testid'|'id'|'nameAttr'|'href', value: string) => b…`, `valueOf(nodes, node) → string | undefined`, `walkInteractive() → WalkEntry[]`
- imports: `tools/browser-inspector/src/print.mjs`, `tools/browser-inspector/src/redact.mjs`
- types only: `tools/browser-inspector/src/types.d.ts`
- imported by: `tools/browser-inspector/src/steps.ctx.mjs`, `tools/browser-inspector/src/steps.run.mjs`

## tools/browser-inspector/src/steps.ctx.mjs
- purpose: the ONE step context every runner sees, and the one place a step is run (DESIGN.md §8, the helpers named in docs/handoff/WP2.md).
- exports: `STEP_GRACE_MS`, `makeStepContext(input) → StepContext & Record<string, any>`, `navigate(ctx, url, waitUntil, timeoutMs)`, `resolveSelector(ctx, step, field) → Promise<string>`, `runStep(ctx, step, index) → Promise<StepResult>`, `writeSnapshotFiles(ctx, text, base) → Promise<string[]>`
- imports: `tools/browser-inspector/src/deadline.mjs`, `tools/browser-inspector/src/recorder.mjs`, `tools/browser-inspector/src/redact.mjs`, `tools/browser-inspector/src/settle.mjs`, `tools/browser-inspector/src/snapshot.mjs`, `tools/browser-inspector/src/steps.run.mjs`, `tools/browser-inspector/src/steps.schema.mjs`
- types only: `tools/browser-inspector/src/recorder.mjs`, `tools/browser-inspector/src/types.d.ts`
- imported by: `tools/browser-inspector/src/engine.mjs`, `tools/browser-inspector/src/flow.mjs`, `tools/browser-inspector/src/session.mjs`

## tools/browser-inspector/src/steps.run.mjs
- purpose: `RUNNERS[name] = async (ctx, step) => …`, the engine-side twin of `STEPS` (DESIGN.md §3.2).
- exports: `BODY_LINES_MAX`, `NET_LIST_MAX`, `RUNNERS`, `SNAP_MAX_DEFAULT`, `durableSelector(ctx, ref) → Promise<{ selector?: string, inFrame: boolean }>`, `fileContent(ctx, name) → Buffer`, `frameFor(ctx, selector) → any`, `globToRegExp(pattern) → RegExp`
- imports: `tools/browser-inspector/src/capture.mjs`, `tools/browser-inspector/src/deadline.mjs`, `tools/browser-inspector/src/print.mjs`, `tools/browser-inspector/src/redact.mjs`, `tools/browser-inspector/src/snapshot.mjs`, `tools/browser-inspector/src/steps.schema.mjs`, `tools/browser-inspector/src/webmcp.mjs`
- types only: `tools/browser-inspector/src/types.d.ts`
- imported by: `tools/browser-inspector/src/engine.mjs`, `tools/browser-inspector/src/flow.mjs`, `tools/browser-inspector/src/session.mjs`, `tools/browser-inspector/src/steps.ctx.mjs`

## tools/browser-inspector/src/steps.schema.mjs
- purpose: the ONE step table, client side (DESIGN.md §3.2, §4, §7).
- exports: `ALL_SPELLINGS`, `ARTIFACT_NAME`, `FIELD_TYPES`, `MODIFIERS`, `REF_PATTERN`, `STEPS`, `STEP_NAMES`, `WAIT_UNTIL`, `checkField(value, type, path) → string | undefined`, `describeStep(step) → string`, `helpFor(nameOrAlias) → string | undefined`, `isRef(value) → value is string`, `parseFieldType(type) → { base: string, optional: boolean, values?: string[] }`, `refFieldsOf(step, def) → string[]`, `resolveStepName(nameOrAlias) → string | undefined`, `splitPoint(pair)`, `stepNames(where) → string[]`, `validateStep(step, where, ctx) → string[]`, `validateSteps(steps, where, options) → string[]`, `valueArg(raw, flags) → { value: string } | { valueFromEnv: string }`
- types only: `tools/browser-inspector/src/types.d.ts`
- imported by: `tools/browser-inspector/src/auth.mjs`, `tools/browser-inspector/src/cli.mjs`, `tools/browser-inspector/src/config.mjs`, `tools/browser-inspector/src/flow.mjs`, `tools/browser-inspector/src/session-log.mjs`, `tools/browser-inspector/src/session.mjs`, `tools/browser-inspector/src/steps.ctx.mjs`, `tools/browser-inspector/src/steps.run.mjs`

## tools/browser-inspector/src/webmcp.mjs
- purpose: the in-page half of `browser-inspector tools` / `browser-inspector call` (WebMCP).
- exports: `WEBMCP_GLOBAL`, `WEBMCP_SHIM_SCRIPT`
- imported by: `tools/browser-inspector/src/session.mjs`, `tools/browser-inspector/src/steps.run.mjs`

## tools/hooks/deny-writes.mjs
- purpose: PreToolUse hook of the read-only agents (code-reviewer-anthropic/-b/-c, code-reviewer-ui, doc-reviewer): whatever the agent's `tools:` list…
- exports: `READ_TOOLS`, `decide(tool) → string | null`
- imports: `tools/hooks/lib/payload.mjs`

## tools/hooks/format-on-edit.mjs
- purpose: PostToolUse hook: runs oxfmt on the file an EDIT tool just wrote.
- exports: `EDIT_TOOLS`, `formatTarget(tool, file, root) → string | null`
- imports: `tools/hooks/lib/payload.mjs`

## tools/hooks/guard-commands.mjs
- purpose: PreToolUse hook: deny destructive shell commands before they run.
- exports: `collectCommands(input) → string[]`, `decide(input) → string | null`, `gitReason(args) → string | null`, `inspect(line) → string | null`, `normalize(line) → string`, `segments(line) → string[]`, `tokenize(segment) → string[]`, `unwrap(argv) → { program: string, args: string[], encoded: boolean }`
- imports: `tools/hooks/lib/payload.mjs`

## tools/hooks/handoff.mjs
- purpose: PreCompact hook: before the client compacts the conversation, save a short resume artefact to tmp/handoff/<stamp>_<session>.md: branch, wor…
- imports: `tools/hooks/lib/payload.mjs`, `tools/scripts/stamp.mjs`

## tools/hooks/lib/payload.mjs
- purpose: what every hook needs and none should re-implement: the repository root, the stdin payload parsed defensively, the entrypoint guard and the…
- exports: `ALLOW`, `ROOT`, `denyDecision(reason) → string`, `isMain(metaUrl) → boolean`, `parsePayload(raw) → Record<string, any>`, `readStdin() → Promise<string>`, `toolCall(payload) → { tool: string, input: Record<string, any> }`
- subscribes: `stdin:data`, `stdin:end`
- imported by: `tools/hooks/deny-writes.mjs`, `tools/hooks/format-on-edit.mjs`, `tools/hooks/guard-commands.mjs`, `tools/hooks/handoff.mjs`, `tools/hooks/session-stop.mjs`

## tools/hooks/session-stop.mjs
- purpose: Stop hook: after an agent session ends, run the cheap gates and report.
- imports: `tools/hooks/lib/payload.mjs`

## tools/scripts/affected.mjs
- purpose: run one target for the projects a change touches: the `nx affected` this repository deliberately does not have, in one dependency-free scri…
- exports: `ROOT_TRIGGERS`, `TARGETS`, `affectedProjects(changed, workspace, graph) → { affected: string[], reason: string }`, `buildGraph(workspace, repo) → Map<string, Set<string>>`, `changedFiles(base, repo) → string[] | null`, `commandsFor(project, target, repo) → string[][]`, `expectedEmpty(project, target) → boolean`, `listFiles(repo, dir) → string[]`, `main(argv, repo) → number`, `mergeBaseFor(base, repo) → string | null`, `parseArgs(argv) → { target?: string, all: boolean, base?: string, cache: bool…`, `readWorkspace(repo) → Workspace`, `taskHash(project, graph, workspace, target, repo) → string`
- env: `CB_TASK_CACHE`
- imports: `tools/scripts/display-command.mjs`, `tools/scripts/lib/repo.mjs`, `tools/scripts/lib/scan.mjs`
- imported by: `tools/scripts/route.mjs`

## tools/scripts/check-glossary.mjs
- purpose: GLOSSARY.md maps words to identifiers; this gate checks that every identifier it names still exists (part of `npm run verify`).
- exports: `GLOSSARY_FILE`, `checkGlossary(repo) → { ok: boolean, code: number, problems: string[], checked: n…`, `parseMappings(markdown) → { term: string, ref: string }[]`, `resolveMapping(repo, {…}) → string | null`
- imports: `tools/scripts/lib/repo.mjs`

## tools/scripts/check-instruction-sync.mjs
- purpose: The instruction block quoted in AGENTS.md IS the fixed cost of a tool's side of an agent session: one blockquote that tells the agent how t…
- exports: `AGENTS_FILE`, `BLOCKS`, `BYTE_LIMIT`, `COPILOT_FILE`, `TOTAL_BYTE_LIMIT`, `checkInstructionSync(root, {…}) → Promise<{ ok: boolean, message: string }>`, `extractInstruction(markdown, name) → string | null`, `sizeInBytes(text) → number`
- imports: `tools/scripts/lib/repo.mjs`

## tools/scripts/check-pins.mjs
- purpose: Offline, deterministic gate over tools/scripts/pins.config.mjs — one of the first steps of `npm run verify`, next to `oxfmt --check`.
- exports: `bareVersion(spec) → string | null`, `checkPins(root) → { ok: boolean, message: string, problems: string[] }`, `compareVersions(a, b) → number`, `discoverManifests(root)`, `proseLag(text, id, pinned) → {line: number, found: string}[]`, `readDeclarations(root, manifests) → Map<string, {spec: string, where: string}[]>`, `tagProblems(pin, version, root) → string[]`, `walkText(root, frozen) → string[]`, `workspacePatterns(root) → string[]`
- imports: `tools/scripts/lib/repo.mjs`, `tools/scripts/lib/scan.mjs`, `tools/scripts/pins.config.mjs`
- types only: `tools/scripts/pins.config.mjs`
- imported by: `tools/scripts/check-upstream.mjs`

## tools/scripts/check-secrets.mjs
- purpose: the pre-commit look at STAGED additions for anything that is a credential: Atlassian and GitLab tokens (this repository talks to both), Git…
- exports: `PATTERNS`, `findSecrets(text, where) → string[]`, `stagedAdditions(repo) → Map<string, string>`
- imports: `tools/scripts/lib/repo.mjs`

## tools/scripts/check-upstream.mjs
- purpose: the calendar half of the currency doctrine.
- exports: `STATE_FILE`, `acknowledge(state, verdicts, id, nowMs) → { state: State, acknowledged: string[] }`, `checkUpstream({…}) → Promise<{ verdicts: Verdict[], nextState: State }>`, `daysBetween(earlierMs, laterMs) → number`, `evaluatePin(pin, {…}) → Verdict`, `fetchLatest(id) → Promise<string | null>`, `nextState(previous, {…}) → StateEntry | undefined`
- imports: `tools/scripts/check-pins.mjs`, `tools/scripts/lib/repo.mjs`, `tools/scripts/pins.config.mjs`
- types only: `tools/scripts/pins.config.mjs`

## tools/scripts/display-command.mjs
- purpose: how a spawned command is echoed to a human: `node` for the running Node binary (its absolute path is noise and differs per machine), reposi…
- exports: `displayCommand(command, repo) → string`, `displayPart(part, repo) → string`
- imported by: `tools/scripts/affected.mjs`, `tools/scripts/verify.mjs`

## tools/scripts/doctor.mjs
- purpose: environment diagnostics (0 credits, NOT part of `npm run verify`).
- env: `BROWSER_INSPECTOR_BROWSER_PATH`, `EXTRACT_CONFIG_DIR`, `EXTRACT_CONFIG_PATH`, `LOCALAPPDATA`, `PLAYWRIGHT_BROWSERS_PATH`, `XDG_CONFIG_HOME`
- imports: `tools/scripts/lib/repo.mjs`

## tools/scripts/guard-forbidden.mjs
- purpose: the things this repository has decided NOT to have (part of `npm run verify`).
- exports: `FORBIDDEN_PACKAGES`, `FORBIDDEN_PATHS`, `FORBIDDEN_WORDS`, `IGNORE_MARK`, `findForbiddenWords(text, file) → string[]`, `guardForbidden(repo, files) → { ok: boolean, problems: string[], scanned: number }`, `trackedFiles(repo) → string[] | null`
- imports: `tools/scripts/lib/repo.mjs`
- imported by: `tools/scripts/validate-ai-config.mjs`

## tools/scripts/index-code.mjs
- purpose: the repository's dependency index, for LLM-driven development.
- exports: `INDEX_FILE`, `buildIndex(files) → string`, `condenseParams(raw) → string`, `generateIndex(root) → string`, `insideStringLiteral(code, index) → boolean`, `insideTemplateLiteral(code, index) → boolean`, `listSourceFiles(root) → string[]`, `parseEnvKnobs(source, code) → string[]`, `parseExports(source) → string[]`, `parseImports(source, fromFile, code) → string[]`, `parsePurpose(source) → string`, `parseSignatures(source) → Map<string, string>`, `parseSubscriptions(source, code) → string[]`, `parseTypeImports(source, fromFile) → string[]`, `resolveTypeImport(root, spec) → string`, `returnType(block) → string`, `stripBlockComments(source) → string`, `templateLiteralMap(code) → Uint8Array`
- imports: `tools/scripts/lib/repo.mjs`, `tools/scripts/lib/scan.mjs`

## tools/scripts/lib/md-table.mjs
- purpose: one markdown table reader for the scripts that read or edit SDD tables (plan, run-log, review reports).
- exports: `cells(line) → string[]`, `listCell(cell) → string[]`, `parseTable(text, accept) → Table | null`, `renderRow(row) → string`, `replaceRows(text, table, rows) → string`
- imported by: `tools/scripts/review-merge.mjs`, `tools/scripts/sdd.mjs`, `tools/scripts/validate-sdd.mjs`

## tools/scripts/lib/repo.mjs
- purpose: what every script in tools/scripts needs and none should re-implement: the repository root, the entrypoint guard, JSONC reading and the fla…
- exports: `COMMITTED_DOCS`, `REPO`, `frontmatter(text, options) → Record<string, string> | null`, `isMain(metaUrl) → boolean`, `readJsonc(file) → any`, `stripJsonComments(text) → string`, `unquote(value) → string`
- imported by: `tools/scripts/affected.mjs`, `tools/scripts/check-glossary.mjs`, `tools/scripts/check-instruction-sync.mjs`, `tools/scripts/check-pins.mjs`, `tools/scripts/check-secrets.mjs`, `tools/scripts/check-upstream.mjs`, `tools/scripts/doctor.mjs`, `tools/scripts/guard-forbidden.mjs`, `tools/scripts/index-code.mjs`, `tools/scripts/new-project.mjs`, `tools/scripts/review-draw.mjs`, `tools/scripts/review-merge.mjs`, `tools/scripts/route.mjs`, `tools/scripts/sdd.mjs`, `tools/scripts/setup-hooks.mjs`, `tools/scripts/stack.mjs`, `tools/scripts/stamp.mjs`, `tools/scripts/validate-ai-config.mjs`, `tools/scripts/validate-sdd.mjs`, `tools/scripts/verify.mjs`, `tools/scripts/workflow-specify.mjs`

## tools/scripts/lib/scan.mjs
- purpose: which directories a tree walk must not enter, and at what depth.
- exports: `SKIP_ANYWHERE`, `SKIP_AT_ROOT`, `skipDirectory(name, depth, alsoAnywhere) → boolean`
- imported by: `tools/scripts/affected.mjs`, `tools/scripts/check-pins.mjs`, `tools/scripts/index-code.mjs`

## tools/scripts/new-project.mjs
- purpose: the ONE way an application or a library is added to this workspace (0 credits).
- exports: `LIB_TYPES`, `allocatePort(name, taken, requested) → number`, `existingE2ePorts(repo)`, `newApplication(name, {…}) → number`, `newLibrary(spec, {…}) → number`
- imports: `tools/scripts/lib/repo.mjs`, `tools/scripts/workspace.config.mjs`

## tools/scripts/pins.config.mjs
- purpose: the single declaration site for every dependency version in this repository.
- exports: `FROZEN_ALWAYS`, `PINS`
- imported by: `tools/scripts/check-pins.mjs`, `tools/scripts/check-upstream.mjs`

## tools/scripts/review-draw.mjs
- purpose: which seats read THIS change: `review.seatsPerReview` seats of the `review.seats` pool, drawn at random (0 credits).
- exports: `DRAW_FILE`, `committedCategoryFor(dir, repo) → string | null`, `drawForDirectory(dir, {…}) → { draw: Draw, recorded: boolean }`, `drawSeats(items, count, random) → T[]`, `formatDraw(draw) → string`, `readDraw(file) → Draw | null`, `reviewPool(repo) → { seats: [string, string][], seatsPerReview: number }`, `runCli(argv) → number`
- imports: `tools/scripts/lib/repo.mjs`, `tools/scripts/stamp.mjs`
- imported by: `tools/scripts/review-merge.mjs`

## tools/scripts/review-merge.mjs
- purpose: the readings of one change, from several model families, into one table (0 credits).
- exports: `SEVERITY`, `VERDICTS`, `expandInputs(inputs) → string[]`, `expectedFamilies(inputs, repo) → string[]`, `findingsTable(markdown) → { header: string[], rows: string[][] } | null`, `mergeReviews(reports, seatFamilies) → Merged`, `parseArgs(argv) → { inputs: string[], out: string | null, slug: string }`, `parseReport(markdown, family) → Report | null`, `renderMerged(merged, {…}) → string`, `reviewSeatFamilies(repo) → string[]`, `runCli(argv) → number`, `severityOf(cell) → Severity | null`
- imports: `tools/scripts/lib/md-table.mjs`, `tools/scripts/lib/repo.mjs`, `tools/scripts/review-draw.mjs`

## tools/scripts/route.mjs
- purpose: who touches a path, answered from tools/scripts/routing.config.mjs (0 credits).
- exports: `ORCHESTRATOR_FILE`, `ROUTING_END`, `ROUTING_START`, `extractRoutingBlock(markdown) → string | null`, `formatRouting(routing) → string`, `globToRegExp(glob) → RegExp`, `normalizePath(file) → string`, `renderRoutingTable(seats) → string`, `reviewSeats(repo) → [string, string][]`, `routePath(file, rules) → { agent: string | null, what: string, glob: string } | null`, `routePaths(files, rules) → Routing`, `runCli(argv) → number`, `syncOrchestrator(repo, {…}) → { fresh: boolean, problem: string | null }`
- imports: `tools/scripts/affected.mjs`, `tools/scripts/lib/repo.mjs`, `tools/scripts/routing.config.mjs`
- types only: `tools/scripts/routing.config.mjs`
- imported by: `tools/scripts/validate-ai-config.mjs`, `tools/scripts/validate-sdd.mjs`

## tools/scripts/routing.config.mjs
- purpose: WHO touches WHAT, declared once.
- exports: `BY_PATH`, `BY_WORK`, `REVIEW_SEATS_ROW`
- imported by: `tools/scripts/route.mjs`

## tools/scripts/sdd.mjs
- purpose: the SDD tables edited by a script, not by a model (0 credits).
- exports: `STATUSES`, `acField(task, lines, specPath) → string`, `acLines(specText) → Map<number, string>`, `nextTask(tasks) → Task | null`, `parseArgs(argv) → { command: string, positional: string[], flags: Record<stri…`, `readPlan(text) → Plan | null`, `renderBrief(task, ac) → string`, `runCli(argv) → number`, `updateLog(text, entry) → string | null`, `updateTask(text, id, change) → { text: string, task: Task } | null`
- imports: `tools/scripts/lib/md-table.mjs`, `tools/scripts/lib/repo.mjs`
- types only: `tools/scripts/lib/md-table.mjs`

## tools/scripts/setup-hooks.mjs
- purpose: arms the committed git hooks: `git config core.hooksPath .githooks`.
- exports: `setupHooks({…}) → { code: number, message: string }`
- imports: `tools/scripts/lib/repo.mjs`

## tools/scripts/stack.mjs
- purpose: the tech-stack canon: one AUTOGEN block in docs/tech-stack.md regenerated from package.json, so that no version number is ever typed into p…
- exports: `BEGIN`, `END`, `blockData(text) → string`, `renderBlock(pkg) → string`, `runStack(mode, repo) → { code: number, message: string }`
- imports: `tools/scripts/lib/repo.mjs`

## tools/scripts/stamp.mjs
- purpose: reading the `YYYY-MM-DD_HH-MM` stamp out of an artifact name.
- exports: `STAMP_TIMEZONE`, `nowStamp(now, timeZone) → string`, `stampToEpoch(year, month, day, hour, minute, timeZone) → number`
- imports: `tools/scripts/lib/repo.mjs`
- imported by: `tools/hooks/handoff.mjs`, `tools/scripts/review-draw.mjs`, `tools/scripts/validate-sdd.mjs`, `tools/scripts/workflow-specify.mjs`

## tools/scripts/validate-ai-config.mjs
- purpose: the gate over the GitHub Copilot configuration (0 credits; pre-commit, session-stop hook and `npm run verify`).
- exports: `mcpServerConfigs(repo) → Record<string, { type?: string, command?: string, args?: st…`, `mcpServers(repo) → string[]`, `parseList(value) → string[]`, `patternHeads(pattern) → string[]`, `validateAiConfig(repo) → { ok: boolean, code: number, problems: string[], summary: s…`
- imports: `tools/scripts/guard-forbidden.mjs`, `tools/scripts/lib/repo.mjs`, `tools/scripts/route.mjs`

## tools/scripts/validate-sdd.mjs
- purpose: the SDD hygiene gate (0 credits, part of `npm run verify`).
- exports: `agentNames(cell) → string[]`, `firstTableHeader(text) → string[]`, `frontmatter(text)`, `planRouteProblems(text, where) → string[]`, `tableColumn(text, column) → string[]`, `validateSdd(repo) → { ok: boolean, code: number, problems: string[], summary: s…`
- imports: `tools/scripts/lib/md-table.mjs`, `tools/scripts/lib/repo.mjs`, `tools/scripts/route.mjs`, `tools/scripts/stamp.mjs`

## tools/scripts/verify.mjs
- purpose: THE Definition of Done: every gate of the repository, in one order, first red stops.
- exports: `CODE`, `STATIC`, `parseArgs(argv) → { static: boolean, affected: boolean, full: boolean, base?:…`, `projectSteps({…}) → Step[]`, `runSteps(steps) → number`
- env: `FORCE_COLOR`
- imports: `tools/scripts/display-command.mjs`, `tools/scripts/lib/repo.mjs`

## tools/scripts/workflow-specify.mjs
- purpose: the deterministic "specify" step of the SDD ladder (0 credits).
- exports: `VERBS`, `parseArgs(argv) → Record<string, string | true>`, `specify({…}) → { code: number, lines: string[], files: string[] }`
- imports: `tools/scripts/lib/repo.mjs`, `tools/scripts/stamp.mjs`

## tools/scripts/workspace.config.mjs
- purpose: the names a company changes when it adopts this template, in ONE place.
- exports: `ALIAS_SCOPE`, `DEFAULT_BRANCH`, `PREFIX`
- imported by: `tools/scripts/new-project.mjs`

## tools/testing/serve-static.mjs
- purpose: a tiny static server with SPA fallback for end-to-end tests over a BUILT application (`dist/apps/<app>/browser`), so the e2e job serves the…
- exports: `handler(root) → import('node:http').RequestListener`, `main(argv) → number`, `resolveRequest(root, pathname) → Resolution`

## tools/testing/vitest-angular.config.mts
- purpose: the shared Vitest configuration of every Angular project, referenced from angular.json as `test.options.runnerConfig` (written there by `np…
- env: `CB_PROJECT`
