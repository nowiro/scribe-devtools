# CODE-INDEX

Dependency map of this repository — generated, do not edit by hand.
Regenerate: `npm run code-index` (the pre-commit hook does it on every commit;
`npm run verify` fails when this file is stale). One section per module:
what it **exports** (with the inputs and output of every function), what it **subscribes to**,
what it **imports** and **who imports it** — read this before grepping.

Modules: 52.

## packages/browser-inspector/bin/browser-inspector.mjs
- imports: `packages/browser-inspector/src/cli.mjs`, `packages/browser-inspector/src/client.mjs`

## packages/browser-inspector/src/auth.mjs
- exports: `AuthError`, `E_AUTH`, `OAUTH_TIMEOUT_MS`, `TOKEN_EXPIRY_MARGIN_MS`, `ensureSession(auth, options) → Promise<SessionInfo>`, `metaPath(statePath)`, `oauthRequestBody(oauth, source) → Record<string, string>`, `oauthStorageState(store, accessToken)`, `oauthTokenUrl(oauth) → string`, `resolveAuthValues(auth, source) → { values: Record<string, string>, secretValues: string[], m…`, `resolveStatePath(auth, baseDir)`, `sessionUsable(stat, nowMs, maxAgeMinutes) → { usable: boolean, reason: string }`, `storageStateFor(snapshot, session) → string | undefined`, `tokenExpiresAt(tokenResponse, nowMs) → number | undefined`, `tokenUsable(meta, nowMs) → { usable: boolean, reason: string }`
- imports: `packages/browser-inspector/src/isolation.mjs`, `packages/browser-inspector/src/recorder.mjs`, `packages/browser-inspector/src/redact.mjs`, `packages/browser-inspector/src/steps.schema.mjs`, `packages/browser-inspector/src/types.js`
- imported by: `packages/browser-inspector/src/flow.mjs`, `packages/browser-inspector/src/keeper.requests.mjs`

## packages/browser-inspector/src/capture.mjs
- exports: `ELEMENTS_CAP`, `EVIDENCE_CAP_MS`, `EXTRACT_CAP`, `TEXT_CAP`, `evaluateWithTimeout(cdp, expression, options) → Promise<string>`, `exceptionText(details) → string`, `finalEvidence(ctx, snapshot, run) → Promise<Evidence & { screenshot?: string, title?: string, f…`, `finalScreenshotName(snapshot, run) → 'page' | 'final' | undefined`, `mapEvaluateResult(response) → string`, `pageEvidence(page, options) → Promise<Evidence>`, `pngSize(buffer) → { width: number, height: number } | undefined`, `saveScreenshot(page, cdp, file, options) → Promise<{ file: string, write: Promise<void>, width?: numbe…`, `screenshotFast(page, cdp, options) → Promise<{ buffer: Buffer, width?: number, height?: number, …`, `stringifyResult(value) → string`
- imports: `packages/browser-inspector/src/deadline.mjs`, `packages/browser-inspector/src/types.js`
- imported by: `packages/browser-inspector/src/flow.mjs`, `packages/browser-inspector/src/steps.run.mjs`

## packages/browser-inspector/src/cli.mjs
- exports: `CONTROL_COMMANDS`, `CliError`, `STAMP_PATTERN`, `bindPositionals(positionals, argvSpec, command, help) → Record<string, any>`, `formatStamp(date) → string`, `parseArgs(argv, steps) → ParsedArgs`, `parseSessionCommand(command, args, steps) → { name: string, step: Record<string, unknown>, options: Rec…`, `splitFlags(args, spec, scope) → { positionals: string[], flags: Record<string, any> }`, `suggest(word, candidates) → string | undefined`, `usage(command) → string`
- imports: `packages/browser-inspector/src/steps.schema.mjs`, `packages/browser-inspector/src/types.js`
- imported by: `packages/browser-inspector/bin/browser-inspector.mjs`, `packages/browser-inspector/src/client.mjs`, `packages/browser-inspector/src/keeper.requests.mjs`, `packages/browser-inspector/src/report.mjs`, `packages/browser-inspector/src/session.mjs`

## packages/browser-inspector/src/client.mjs
- exports: `CONNECT_RETRY_MS`, `CONNECT_TIMEOUT_MS`, `CONTROL_TIMEOUT_MS`, `DOCTOR_JOB_TIMEOUT_MS`, `INLINE_FILE_MAX`, `KeeperUnavailableError`, `REQUEST_TIMEOUT_MS`, `computeIdentity(input) → Identity`, `connectOnce(pipe) → Promise<net.Socket>`, `doctor(input) → Promise<{ line: string, survives: boolean, spawnToListenMs:…`, `ensureKeeper(identity, options) → Promise<{ socket: net.Socket, token: string, spawned: boole…`, `exchange(socket, request, onProgress, options) → Promise<KeeperDone>`, `isScriptComment(line)`, `main(argv, io) → Promise<number>`, `packageVersion() → string`, `readFileEntry(file, bases, where) → KeeperFile`, `readPidFile(file) → { pid: number, pipe: string, token: string, listeningAt?: n…`, `requestTimeout(env, override) → number`, `resolveValues(parsed, input) → { values: Record<string, string>, secretValues: string[], f…`, `runInProcess(request, options) → Promise<KeeperDone>`, `runViaKeeper(request, options) → Promise<KeeperDone>`, `spawnKeeper(identity, env) → number | undefined`, `splitCommandLine(line) → string[]`
- subscribes: `child:error`, `rl:line`, `shell:error`, `shell:exit`, `socket:close`, `socket:connect`, `socket:error`
- imports: `packages/browser-inspector/src/cli.mjs`, `packages/browser-inspector/src/config.mjs`, `packages/browser-inspector/src/keeper.mjs`, `packages/browser-inspector/src/keeper.requests.mjs`, `packages/browser-inspector/src/paths.mjs`, `packages/browser-inspector/src/print.mjs`, `packages/browser-inspector/src/types.js`
- imported by: `packages/browser-inspector/bin/browser-inspector.mjs`, `packages/browser-inspector/src/session.mjs`

## packages/browser-inspector/src/config.mjs
- exports: `ConfigError`, `DEFAULTS`, `lintConfig(config) → { findings: LintFinding[], lines: string[] }`, `loadConfig(configPath, cwd) → Record<string, any>`, `parseConfig(raw, options) → Record<string, any>`
- imports: `packages/browser-inspector/src/paths.mjs`, `packages/browser-inspector/src/steps.schema.mjs`
- imported by: `packages/browser-inspector/src/client.mjs`, `packages/browser-inspector/src/keeper.requests.mjs`

## packages/browser-inspector/src/deadline.mjs
- exports: `DeadlineError`, `degradeTo(fallback, promise, ms, label) → Promise<T>`, `isDeadline(error)`, `withDeadline(promise, ms, label) → Promise<T>`
- imported by: `packages/browser-inspector/src/capture.mjs`, `packages/browser-inspector/src/flow.mjs`, `packages/browser-inspector/src/lanes.mjs`, `packages/browser-inspector/src/session.mjs`, `packages/browser-inspector/src/steps.ctx.mjs`, `packages/browser-inspector/src/steps.run.mjs`

## packages/browser-inspector/src/engine.mjs
- exports: `createEngine(first, hooks)`
- imports: `packages/browser-inspector/src/flow.mjs`, `packages/browser-inspector/src/lanes.mjs`, `packages/browser-inspector/src/paths.mjs`, `packages/browser-inspector/src/recorder.mjs`, `packages/browser-inspector/src/session.mjs`, `packages/browser-inspector/src/steps.ctx.mjs`, `packages/browser-inspector/src/steps.run.mjs`, `packages/browser-inspector/src/types.js`

## packages/browser-inspector/src/flow.mjs
- exports: `createFlowRunner(input)`
- imports: `packages/browser-inspector/src/auth.mjs`, `packages/browser-inspector/src/capture.mjs`, `packages/browser-inspector/src/deadline.mjs`, `packages/browser-inspector/src/isolation.mjs`, `packages/browser-inspector/src/lanes.mjs`, `packages/browser-inspector/src/recorder.mjs`, `packages/browser-inspector/src/redact.mjs`, `packages/browser-inspector/src/report.mjs`, `packages/browser-inspector/src/schedule.mjs`, `packages/browser-inspector/src/steps.ctx.mjs`, `packages/browser-inspector/src/steps.run.mjs`, `packages/browser-inspector/src/steps.schema.mjs`, `packages/browser-inspector/src/types.js`
- imported by: `packages/browser-inspector/src/engine.mjs`

## packages/browser-inspector/src/isolation.mjs
- exports: `DEFAULT_VIEWPORT`, `GEN_MARKER`, `GEN_SCRIPT(generation) → string`, `SCRUB_STORAGE_TYPES`, `clearableOrigins(origins) → string[]`, `needsFreshContext(snapshot, options) → boolean`, `scrubPlan(state) → ScrubOp[]`
- subscribes: `context:page`
- imports: `packages/browser-inspector/src/types.js`
- imported by: `packages/browser-inspector/src/auth.mjs`, `packages/browser-inspector/src/flow.mjs`, `packages/browser-inspector/src/lanes.mjs`

## packages/browser-inspector/src/keeper.mjs
- exports: `DEFAULT_ENGINE_MODULE`, `IDLE_MS_DEFAULT`, `KEEPER_PATH`, `LOCK_YOUNG_MS`, `LOG_MAX_BYTES`, `MAX_JOBS_DEFAULT`, `MAX_RSS_MB_DEFAULT`, `PROBE_TIMEOUT_MS`, `RSS_CHECK_EVERY`, `SESSION_TTL_MS_DEFAULT`, `acquireLock(lockPath, pid, options) → Promise<boolean>`, `createContext(options)`, `createQueues()`, `holderAnswers(file, holder, options) → Promise<boolean>`, `isAlive(pid)`, `loadEngine(spec, browserOpts, hooks) → Promise<EngineLike>`, `probePipe(pipe, timeoutMs) → Promise<boolean>`, `startKeeper(options)`
- subscribes: `process:uncaughtException`, `process:unhandledRejection`, `rl:line`, `server:connection`, `server:error`, `socket:connect`, `socket:error`
- imports: `packages/browser-inspector/src/keeper.requests.mjs`, `packages/browser-inspector/src/paths.mjs`, `packages/browser-inspector/src/print.mjs`, `packages/browser-inspector/src/redact.mjs`, `packages/browser-inspector/src/types.js`
- imported by: `packages/browser-inspector/src/client.mjs`, `packages/browser-inspector/src/keeper.requests.mjs`

## packages/browser-inspector/src/keeper.requests.mjs
- exports: `EngineUnavailableError`, `PROTOCOL_VERSION`, `done(exit, lines, files, extra) → KeeperDone`, `handleRequest(request, ctx) → Promise<KeeperDone>`, `messageOf(error)`, `statusOf(eng)`
- imports: `packages/browser-inspector/src/auth.mjs`, `packages/browser-inspector/src/cli.mjs`, `packages/browser-inspector/src/config.mjs`, `packages/browser-inspector/src/keeper.mjs`, `packages/browser-inspector/src/paths.mjs`, `packages/browser-inspector/src/print.mjs`, `packages/browser-inspector/src/redact.mjs`, `packages/browser-inspector/src/report.mjs`, `packages/browser-inspector/src/schedule.mjs`, `packages/browser-inspector/src/types.js`
- imported by: `packages/browser-inspector/src/client.mjs`, `packages/browser-inspector/src/keeper.mjs`

## packages/browser-inspector/src/lanes.mjs
- exports: `BrowserMissingError`, `DEFAULT_TIMEOUT_MS`, `E_BROWSER_MISSING`, `FAST_HEADLESS_ARGS`, `LANE_IDLE_MS_DEFAULT`, `MAX_JOBS_DEFAULT`, `MAX_RSS_MB_DEFAULT`, `RSS_CHECK_EVERY`, `SCRUB_OP_MS_DEFAULT`, `createLanePool(input)`, `launchBrowser(browser, options) → Promise<{ browser: any, channel: string, args: string[], la…`, `launchPlan(browser, env) → { attempts: { channel?: string, executablePath?: string }[]…`, `processRssMbAsync(pids) → Promise<number>`
- imports: `packages/browser-inspector/src/deadline.mjs`, `packages/browser-inspector/src/isolation.mjs`, `packages/browser-inspector/src/recorder.mjs`, `packages/browser-inspector/src/types.js`
- imported by: `packages/browser-inspector/src/engine.mjs`, `packages/browser-inspector/src/flow.mjs`, `packages/browser-inspector/src/session.mjs`

## packages/browser-inspector/src/paths.mjs
- exports: `CI_VARS`, `DEFAULT_OUTPUT_DIR`, `PORTABLE_MARKER`, `collectIdentity(input) → IdentityParts`, `daemonEnabled(env, options) → boolean`, `fnv1a(text) → string`, `identityHash(parts) → string`, `isCI(env) → boolean`, `lockFile(hash, tmpdir)`, `logFile(hash, tmpdir)`, `packageVersion(dir, fallback) → string`, `pidFile(hash, tmpdir)`, `pipeName(hash, options) → string`, `playwrightCoreVersion(packageDir) → string`, `resolveOutputDir(outputDir, baseDir) → string`, `sessionDir(out, name)`, `srcStamp(dir) → number`
- imported by: `packages/browser-inspector/src/client.mjs`, `packages/browser-inspector/src/config.mjs`, `packages/browser-inspector/src/engine.mjs`, `packages/browser-inspector/src/keeper.mjs`, `packages/browser-inspector/src/keeper.requests.mjs`, `packages/browser-inspector/src/session.mjs`

## packages/browser-inspector/src/print.mjs
- exports: `EVAL_INLINE_MAX`, `KEEPER_UNAVAILABLE(reason)`, `MAX_LINE`, `REF_NOT_FOUND`, `SEP`, `formatBytes(bytes)`, `formatConsoleEntry(entry)`, `formatDeltas(before, after, options) → string[]`, `formatDialogStatus(policy, last)`, `formatDoctor(r)`, `formatEval(text, file) → string[]`, `formatExport(count, file)`, `formatFail(head, reason, parts)`, `formatLine(status, head, parts) → string`, `formatMs(ms) → string`, `formatNetBody(r)`, `formatNetEntry(entry, baseOrigin)`, `formatNetSummary(r) → string[]`, `formatNewEntries(lines, what) → string[]`, `formatOk(head, parts)`, `formatOpen(r)`, `formatOverflow(hidden, file)`, `formatShot(file, width, height)`, `relPath(file, cwd) → string`, `sliceUnits(text, max) → string`, `truncate(text, max) → string`, `urlDisplay(url, baseOrigin)`
- imported by: `packages/browser-inspector/src/client.mjs`, `packages/browser-inspector/src/keeper.mjs`, `packages/browser-inspector/src/keeper.requests.mjs`, `packages/browser-inspector/src/report.mjs`, `packages/browser-inspector/src/session.mjs`, `packages/browser-inspector/src/snapshot.mjs`, `packages/browser-inspector/src/steps.run.mjs`

## packages/browser-inspector/src/recorder.mjs
- exports: `BODY_LIMIT`, `BODY_READ_MS`, `BODY_TYPES`, `CONSOLE_CAP`, `DIALOG_CAP`, `FAILED_REQUEST_CAP`, `NETWORK_CAP`, `PAGE_ERROR_CAP`, `attachRecorder(page, options) → Recorder`, `createRecorder(options) → Recorder`, `errorMessage(error)`, `originOf(url) → string | null`, `summarize(recorder) → { console: { entries: ConsoleEntry[], total: number, trunca…`
- subscribes: `page:console`, `page:crash`, `page:dialog`, `page:framenavigated`, `page:pageerror`, `page:popup`, `page:request`, `page:requestfailed`, `page:requestfinished`, `page:response`
- imports: `packages/browser-inspector/src/types.js`
- imported by: `packages/browser-inspector/src/auth.mjs`, `packages/browser-inspector/src/engine.mjs`, `packages/browser-inspector/src/flow.mjs`, `packages/browser-inspector/src/lanes.mjs`, `packages/browser-inspector/src/session.mjs`, `packages/browser-inspector/src/steps.ctx.mjs`

## packages/browser-inspector/src/redact.mjs
- exports: `MASK`, `maskSnapshotEntries(entries, options) → E[]`, `maskSnapshotValues(text, options) → string`, `redact(text, secretValues) → string`, `redactDeep(value, secretValues) → T`, `redactWith(text, forms) → string`, `secretForms(secretValues) → string[]`
- imported by: `packages/browser-inspector/src/auth.mjs`, `packages/browser-inspector/src/flow.mjs`, `packages/browser-inspector/src/keeper.mjs`, `packages/browser-inspector/src/keeper.requests.mjs`, `packages/browser-inspector/src/session-log.mjs`, `packages/browser-inspector/src/session.mjs`, `packages/browser-inspector/src/snapshot.mjs`, `packages/browser-inspector/src/steps.ctx.mjs`, `packages/browser-inspector/src/steps.run.mjs`

## packages/browser-inspector/src/report.mjs
- exports: `CAPS`, `INLINE_VALUE`, `SCRIPT`, `SOURCE`, `artifactFiles(report) → Record<string, string>`, `buildManifest(run, results) → Manifest & { source: string, startedAt: string, finishedAt:…`, `buildReport(input) → BuiltReport`, `buildSnapshotManifest(report, snapshot) → SnapshotManifest`, `failureOf(report) → string | undefined`, `formatStepError(error) → string`, `renderElementsMd(report) → string`, `renderJUnit(suite, snapshots, options) → string`, `renderReportMd(report) → string`, `writeArtifacts(dir, report, files, options) → Promise<{ written: string[], ms: number }>`
- imports: `packages/browser-inspector/src/cli.mjs`, `packages/browser-inspector/src/print.mjs`, `packages/browser-inspector/src/types.js`
- imported by: `packages/browser-inspector/src/flow.mjs`, `packages/browser-inspector/src/keeper.requests.mjs`

## packages/browser-inspector/src/schedule.mjs
- exports: `estimateSnapshot(snapshot) → number`, `planLanes(snapshots, parallel) → number[]`
- imported by: `packages/browser-inspector/src/flow.mjs`, `packages/browser-inspector/src/keeper.requests.mjs`

## packages/browser-inspector/src/session-log.mjs
- exports: `ExportError`, `JOURNAL_FILE`, `appendJournal(file, entry, options) → JournalEntry & { at: string }`, `exportFlow(entries, options) → ExportResult`, `flowNameFrom(file) → string`, `formatJournalLine(entry, secretValues) → string`, `journalLineCount(file)`, `journalPath(sessionDir)`, `normalizeEntry(entry, secretValues) → JournalEntry & { at: string }`, `readJournal(file) → JournalEntry[]`, `writeFlowExport(file, config, options) → string`
- imports: `packages/browser-inspector/src/redact.mjs`, `packages/browser-inspector/src/steps.schema.mjs`, `packages/browser-inspector/src/types.js`
- imported by: `packages/browser-inspector/src/session.mjs`

## packages/browser-inspector/src/session.mjs
- exports: `createSessions(input)`
- subscribes: `page:close`, `page:popup`, `page:request`
- imports: `packages/browser-inspector/src/cli.mjs`, `packages/browser-inspector/src/client.mjs`, `packages/browser-inspector/src/deadline.mjs`, `packages/browser-inspector/src/lanes.mjs`, `packages/browser-inspector/src/paths.mjs`, `packages/browser-inspector/src/print.mjs`, `packages/browser-inspector/src/recorder.mjs`, `packages/browser-inspector/src/redact.mjs`, `packages/browser-inspector/src/session-log.mjs`, `packages/browser-inspector/src/steps.ctx.mjs`, `packages/browser-inspector/src/steps.run.mjs`, `packages/browser-inspector/src/steps.schema.mjs`, `packages/browser-inspector/src/types.js`
- imported by: `packages/browser-inspector/src/engine.mjs`

## packages/browser-inspector/src/settle.mjs
- exports: `CAP_MS_DEFAULT`, `POLL_MS`, `QUIET_MS_DEFAULT`, `waitSettled(page, recorder, options) → Promise<{ settled: boolean, ms: number }>`
- imports: `packages/browser-inspector/src/types.js`
- imported by: `packages/browser-inspector/src/steps.ctx.mjs`

## packages/browser-inspector/src/snapshot.mjs
- exports: `CONTEXT_ROLES`, `FIND_MAX`, `INTERACTIVE_ROLES`, `REF_PATTERN`, `RefNotFoundError`, `SEMANTIC_ROLES`, `aroundRef(aiYaml, ref, options) → string[]`, `boxJoin(boxesYaml, walk) → { entries: SidecarEntry[], interactive: number, matched: nu…`, `compactLines(aiYaml, options) → string[]`, `compactSnapshot(aiYaml, options) → string`, `diffSnapshot(prev, next) → { added: string[], removed: string[] }`, `findInSnapshot(aiYaml, text, options) → { lines: string[], total: number }`, `implicitRole(e) → string`, `locatorFor(e, unique) → string | undefined`, `locatorForElement(el) → string | undefined`, `namesContext(nodes, node) → string | undefined`, `parseSnapshot(yaml) → SnapNode[]`, `resolveRef(page, ref, options) → Promise<{ selector: string, refreshed: boolean, snapshot?: …`, `sensitiveRefs(entries) → string[]`, `sidecarFromPage(page, boxesYaml) → Promise<SidecarEntry[]>`, `textUnder(nodes, node, max) → string`, `uniqueIn(walk) → (kind: 'testid'|'id'|'nameAttr'|'href', value: string) => b…`, `valueOf(nodes, node) → string | undefined`, `walkInteractive() → WalkEntry[]`
- imports: `packages/browser-inspector/src/print.mjs`, `packages/browser-inspector/src/redact.mjs`, `packages/browser-inspector/src/types.js`
- imported by: `packages/browser-inspector/src/steps.ctx.mjs`, `packages/browser-inspector/src/steps.run.mjs`

## packages/browser-inspector/src/steps.ctx.mjs
- exports: `STEP_GRACE_MS`, `makeStepContext(input) → StepContext & Record<string, any>`, `navigate(ctx, url, waitUntil, timeoutMs)`, `resolveSelector(ctx, step, field) → Promise<string>`, `runStep(ctx, step, index) → Promise<StepResult>`, `writeSnapshotFiles(ctx, text, base) → Promise<string[]>`
- imports: `packages/browser-inspector/src/deadline.mjs`, `packages/browser-inspector/src/recorder.mjs`, `packages/browser-inspector/src/redact.mjs`, `packages/browser-inspector/src/settle.mjs`, `packages/browser-inspector/src/snapshot.mjs`, `packages/browser-inspector/src/steps.run.mjs`, `packages/browser-inspector/src/steps.schema.mjs`, `packages/browser-inspector/src/types.js`
- imported by: `packages/browser-inspector/src/engine.mjs`, `packages/browser-inspector/src/flow.mjs`, `packages/browser-inspector/src/session.mjs`

## packages/browser-inspector/src/steps.run.mjs
- exports: `BODY_LINES_MAX`, `NET_LIST_MAX`, `RUNNERS`, `SNAP_MAX_DEFAULT`, `durableSelector(ctx, ref) → Promise<{ selector?: string, inFrame: boolean }>`, `fileContent(ctx, name) → Buffer`, `frameFor(ctx, selector) → any`, `globToRegExp(pattern) → RegExp`
- imports: `packages/browser-inspector/src/capture.mjs`, `packages/browser-inspector/src/deadline.mjs`, `packages/browser-inspector/src/print.mjs`, `packages/browser-inspector/src/redact.mjs`, `packages/browser-inspector/src/snapshot.mjs`, `packages/browser-inspector/src/steps.schema.mjs`, `packages/browser-inspector/src/types.js`
- imported by: `packages/browser-inspector/src/engine.mjs`, `packages/browser-inspector/src/flow.mjs`, `packages/browser-inspector/src/session.mjs`, `packages/browser-inspector/src/steps.ctx.mjs`, `scripts/check-claims.mjs`

## packages/browser-inspector/src/steps.schema.mjs
- exports: `ALL_SPELLINGS`, `ARTIFACT_NAME`, `FIELD_TYPES`, `MODIFIERS`, `REF_PATTERN`, `STEPS`, `STEP_NAMES`, `WAIT_UNTIL`, `checkField(value, type, path) → string | undefined`, `describeStep(step) → string`, `helpFor(nameOrAlias) → string | undefined`, `isRef(value) → value is string`, `parseFieldType(type) → { base: string, optional: boolean, values?: string[] }`, `refFieldsOf(step, def) → string[]`, `resolveStepName(nameOrAlias) → string | undefined`, `splitPoint(pair)`, `stepNames(where) → string[]`, `validateStep(step, where, ctx) → string[]`, `validateSteps(steps, where, options) → string[]`, `valueArg(raw, flags) → { value: string } | { valueFromEnv: string }`
- imports: `packages/browser-inspector/src/types.js`
- imported by: `packages/browser-inspector/src/auth.mjs`, `packages/browser-inspector/src/cli.mjs`, `packages/browser-inspector/src/config.mjs`, `packages/browser-inspector/src/flow.mjs`, `packages/browser-inspector/src/session-log.mjs`, `packages/browser-inspector/src/session.mjs`, `packages/browser-inspector/src/steps.ctx.mjs`, `packages/browser-inspector/src/steps.run.mjs`, `scripts/check-claims.mjs`

## packages/nx-angular-inspector/bin/nx-angular-inspector.mjs
- imports: `packages/nx-angular-inspector/src/main.mjs`

## packages/nx-angular-inspector/src/affected.mjs
- exports: `DEFAULT_SHARED_GLOBALS`, `affectedProjects({…}) → { projects: string[], sharedHit: string | null }`, `changedFiles(root, base) → { ok: boolean, files: string[], error: string }`, `sharedGlobals(nxJson) → string[]`
- imports: `packages/nx-angular-inspector/src/glob.mjs`
- imported by: `packages/nx-angular-inspector/src/verbs.run.mjs`

## packages/nx-angular-inspector/src/cli.mjs
- exports: `CliError`, `parseArgs(argv) → Parsed`
- imports: `packages/nx-angular-inspector/src/verbs.schema.mjs`
- imported by: `packages/nx-angular-inspector/src/main.mjs`

## packages/nx-angular-inspector/src/detect.mjs
- exports: `MIN_ANGULAR`, `MIN_NX`, `detect(root) → Detected`, `installedVersion(root, id) → string | null`, `major(version) → number | null`, `versionParts(detected) → string[]`
- imports: `packages/nx-angular-inspector/src/paths.mjs`
- imported by: `packages/nx-angular-inspector/src/main.mjs`, `packages/nx-angular-inspector/src/verbs.run.mjs`, `packages/nx-angular-inspector/src/workspace.mjs`

## packages/nx-angular-inspector/src/generators.mjs
- exports: `MANIFEST_NAMES`, `describeType(property) → string`, `packageDirs(root) → { id: string, dir: string }[]`, `parseSpec(spec) → { collection: string, name: string } | null`, `scanGenerators(root) → { generators: Generator[], collections: number }`, `schemaOptions(schema) → { options: Option[], required: string[] }`
- imported by: `packages/nx-angular-inspector/src/verbs.run.mjs`

## packages/nx-angular-inspector/src/glob.mjs
- exports: `globToRegExp(pattern) → RegExp`, `matchesAny(file, patterns) → boolean`, `ownerOf(file, projects) → string | null`
- imported by: `packages/nx-angular-inspector/src/affected.mjs`

## packages/nx-angular-inspector/src/graph.mjs
- exports: `KNOWN_VERSIONS`, `UnsupportedGraph`, `indexGraph(raw) → Graph`, `inferredTargets(graph, root, readJson) → { total: number, inferred: number }`, `matchProjects(graph, pattern) → Project[]`, `readGraph(file) → Graph`
- imported by: `packages/nx-angular-inspector/src/verbs.run.mjs`, `packages/nx-angular-inspector/src/workspace.mjs`

## packages/nx-angular-inspector/src/guide.mjs
- exports: `findGuides(root) → Doc[]`
- imported by: `packages/nx-angular-inspector/src/verbs.run.mjs`

## packages/nx-angular-inspector/src/main.mjs
- exports: `main(argv, {…}) → { line: string, exit: number }`
- imports: `packages/nx-angular-inspector/src/cli.mjs`, `packages/nx-angular-inspector/src/detect.mjs`, `packages/nx-angular-inspector/src/paths.mjs`, `packages/nx-angular-inspector/src/print.mjs`, `packages/nx-angular-inspector/src/verbs.run.mjs`, `packages/nx-angular-inspector/src/verbs.schema.mjs`
- imported by: `packages/nx-angular-inspector/bin/nx-angular-inspector.mjs`

## packages/nx-angular-inspector/src/nxcli.mjs
- exports: `CLI_TIMEOUT_MS`, `nxRun(root, args, env) → { ok: boolean, status: number, stdout: string, error: strin…`
- imports: `packages/nx-angular-inspector/src/paths.mjs`
- imported by: `packages/nx-angular-inspector/src/workspace.mjs`

## packages/nx-angular-inspector/src/out.mjs
- exports: `document({…}, body) → string`, `generatorPath(collection, generator) → string`, `safeSegment(segment) → string`, `writeOut(outDir, relative, text) → string`
- imported by: `packages/nx-angular-inspector/src/verbs.run.mjs`

## packages/nx-angular-inspector/src/paths.mjs
- exports: `findRoot(from) → string`, `graphFile(root, env) → string`, `nxBin(root)`, `outDir(root, env) → string`, `packageManifest(root, id) → string`, `walkUp(from, file) → string | null`, `workspaceDataDir(root, env) → string`
- imported by: `packages/nx-angular-inspector/src/detect.mjs`, `packages/nx-angular-inspector/src/main.mjs`, `packages/nx-angular-inspector/src/nxcli.mjs`, `packages/nx-angular-inspector/src/serve.mjs`, `packages/nx-angular-inspector/src/target.mjs`, `packages/nx-angular-inspector/src/verbs.run.mjs`, `packages/nx-angular-inspector/src/workspace.mjs`

## packages/nx-angular-inspector/src/print.mjs
- exports: `MAX_LINE`, `PROTECTED_TAIL`, `SEP`, `VERDICT`, `formatAge(ms) → string`, `formatFail(head, reason, parts)`, `formatInt(value) → string`, `formatLine(status, head, parts, protect) → string`, `formatOk(head, parts)`, `plural(n, forms) → string`, `relPath(file, cwd) → string`, `sliceUnits(text, max) → string`, `truncate(text, max) → string`
- imported by: `packages/nx-angular-inspector/src/main.mjs`, `packages/nx-angular-inspector/src/verbs.run.mjs`

## packages/nx-angular-inspector/src/serve.mjs
- exports: `DEFAULT_READY`, `DEFAULT_WAIT_MS`, `alive(pid) → boolean`, `lastLines(text, count) → string[]`, `logFile(outDir, project) → string`, `readState(outDir, project) → ServeState | null`, `startServe({…}) → { ok: boolean, state: ServeState | null, error: string }`, `stateFile(outDir, project) → string`, `stopServe({…}) → { ok: boolean, error: string }`, `tail(file, offset) → string`, `waitForServe({…}) → { status: 'ready' | 'timeout' | 'martwy', waitedMs: number,…`
- imports: `packages/nx-angular-inspector/src/paths.mjs`
- imported by: `packages/nx-angular-inspector/src/verbs.run.mjs`

## packages/nx-angular-inspector/src/stamp.mjs
- exports: `FUTURE_TOLERANCE_MS`, `INFERRING_FILES`, `ROOT_INPUTS`, `SKIP_DIRS`, `filesUnder(from, limit) → string[]`, `inputSet(root, projectRoots, deep) → string[]`, `mtime(file) → number | null`, `stampGraph({…}) → Stamp`
- imported by: `packages/nx-angular-inspector/src/verbs.run.mjs`, `packages/nx-angular-inspector/src/workspace.mjs`

## packages/nx-angular-inspector/src/target.mjs
- exports: `RUN_TIMEOUT_MS`, `errorSummary(log, max) → { shown: string[], total: number }`, `parseTargetSpec(spec) → { project: string, target: string } | null`, `runTarget(root, project, target, env, timeoutMs) → { status: number, log: string, error: string }`, `stripAnsi(text) → string`
- imports: `packages/nx-angular-inspector/src/paths.mjs`
- imported by: `packages/nx-angular-inspector/src/verbs.run.mjs`

## packages/nx-angular-inspector/src/verbs.run.mjs
- exports: `RUNNERS`, `affected(ctx) → Outcome`, `env(ctx) → Outcome`, `gen(ctx) → Outcome`, `graph(ctx) → Outcome`, `guide(ctx) → Outcome`, `projects(ctx) → Outcome`, `run(ctx) → Outcome`, `serve(ctx) → Outcome`
- imports: `packages/nx-angular-inspector/src/affected.mjs`, `packages/nx-angular-inspector/src/detect.mjs`, `packages/nx-angular-inspector/src/generators.mjs`, `packages/nx-angular-inspector/src/graph.mjs`, `packages/nx-angular-inspector/src/guide.mjs`, `packages/nx-angular-inspector/src/out.mjs`, `packages/nx-angular-inspector/src/paths.mjs`, `packages/nx-angular-inspector/src/print.mjs`, `packages/nx-angular-inspector/src/serve.mjs`, `packages/nx-angular-inspector/src/stamp.mjs`, `packages/nx-angular-inspector/src/target.mjs`, `packages/nx-angular-inspector/src/workspace.mjs`
- imported by: `packages/nx-angular-inspector/src/main.mjs`

## packages/nx-angular-inspector/src/verbs.schema.mjs
- exports: `GLOBAL_FLAGS`, `VERBS`, `VERB_NAMES`, `findVerb(name) → Verb | undefined`, `usage(name) → string`
- imported by: `packages/nx-angular-inspector/src/cli.mjs`, `packages/nx-angular-inspector/src/main.mjs`

## packages/nx-angular-inspector/src/workspace.mjs
- exports: `loadModel({…}) → Model`, `readJsonOrNull(file) → any | null`
- imports: `packages/nx-angular-inspector/src/detect.mjs`, `packages/nx-angular-inspector/src/graph.mjs`, `packages/nx-angular-inspector/src/nxcli.mjs`, `packages/nx-angular-inspector/src/paths.mjs`, `packages/nx-angular-inspector/src/stamp.mjs`
- imported by: `packages/nx-angular-inspector/src/verbs.run.mjs`

## scripts/check-claims.mjs
- imports: `packages/browser-inspector/src/steps.run.mjs`, `packages/browser-inspector/src/steps.schema.mjs`

## scripts/check-instruction-sync.mjs
- exports: `AGENTS_FILE`, `BLOCKS`, `COPILOT_FILE`, `TOKEN_LIMIT`, `TOTAL_TOKEN_LIMIT`, `checkInstructionSync(root, {…}) → Promise<{ ok: boolean, message: string }>`, `countTokens(text) → Promise<number | null>`, `extractInstruction(markdown, name) → string | null`

## scripts/check-pins.mjs
- exports: `bareVersion(spec) → string | null`, `checkPins(root) → { ok: boolean, message: string, problems: string[] }`, `compareVersions(a, b) → number`, `discoverManifests(root) → string[]`, `proseLag(text, id, pinned) → {line: number, found: string}[]`, `readDeclarations(root, manifests) → Map<string, {spec: string, where: string}[]>`, `walkText(root, frozen) → string[]`
- imports: `scripts/pins.config.mjs`
- imported by: `scripts/check-upstream.mjs`

## scripts/check-upstream.mjs
- exports: `STATE_FILE`, `acknowledge(state, verdicts, id, nowMs) → { state: State, acknowledged: string[] }`, `checkUpstream({…}) → Promise<{ verdicts: Verdict[], nextState: State }>`, `daysBetween(earlierMs, laterMs) → number`, `evaluatePin(pin, {…}) → Verdict`, `fetchLatest(id) → Promise<string | null>`, `nextState(previous, {…}) → StateEntry | undefined`
- imports: `scripts/check-pins.mjs`, `scripts/pins.config.mjs`

## scripts/index-code.mjs
- exports: `INDEX_FILE`, `buildIndex(files) → string`, `condenseParams(raw) → string`, `generateIndex(root) → string`, `listSourceFiles(root) → string[]`, `parseExports(source) → string[]`, `parseImports(source, fromFile) → string[]`, `parseSignatures(source) → Map<string, string>`, `parseSubscriptions(source) → string[]`, `returnType(block) → string`
- subscribes: `receiver:event`

## scripts/pins.config.mjs
- exports: `FROZEN_ALWAYS`, `PINS`
- imported by: `scripts/check-pins.mjs`, `scripts/check-upstream.mjs`

## scripts/portable-zip.mjs
- exports: `DOWNLOAD_DIR`, `FIXED_MTIME`, `PACKAGES`, `PORTABLE_MARKER`, `buildPortable(root, outDir) → { version: string, playwrightVersion: string, zipPath: stri…`, `crc32(data) → number`, `gitTags(root) → string[]`, `isFrozen(version, tags, zipExists)`, `isTracked(root, file)`, `listFiles(dir) → string[]`, `readVersion(root) → string`, `sha256(file) → string`, `stagePortable(root, staging) → { version: string, playwrightVersion: string }`, `zipDirectory(staging, zipPath)`, `zipName(version)`
