# CODE-INDEX

Dependency map of this repository — generated, do not edit by hand.
Regenerate: `npm run code-index` (the pre-commit hook does it on every commit;
`npm run verify` fails when this file is stale). One section per module:
what it **exports**, what it **imports** and **who imports it** — read this before grepping.

Modules: 34.

## bench/bench.mjs
- exports: `SESSIONS_PER_DAY`, `WORKDAYS`
- imports: `bench/browser-inspector-run.mjs`, `bench/budget.mjs`, `bench/mcp-run.mjs`, `bench/raport.mjs`, `bench/serve.mjs`, `bench/task.mjs`, `bench/time-run.mjs`, `bench/tokens.mjs`

## bench/browser-inspector-run.mjs
- exports: `APP_FACTORY_APPS`, `CI_VARS`, `COMMAND`, `COMMAND_PNPM`, `INSTRUCTION`, `appFactoryDir`, `appFactoryFixture`, `batchTokens`, `benchEnv`, `chromeDescendants`, `chromeProcesses`, `findingsFromReport`, `isAlive`, `keeperSurvivesShell`, `parseRefs`, `pipeNameFor`, `prepareAppFactoryConfig`, `prepareBatchConfig`, `readKeeperInfo`, `refOf`, `runAppFactory`, `runBatch`, `runInteractive`, `stopKeeper`, `timeCold`, `timeFirst`, `timeWarm`
- imports: `bench/task.mjs`, `bench/time-run.mjs`, `bench/tokens.mjs`
- imported by: `bench/bench.mjs`

## bench/budget.mjs
- exports: `COLUMNS`, `DESIGN_BUDGET`, `compareWithDesign`, `phaseRow`, `rangeVerdict`, `renderBudget`, `verdict`
- imports: `bench/time-run.mjs`, `bench/tokens.mjs`
- imported by: `bench/bench.mjs`

## bench/mcp-client.mjs
- exports: `initialize`, `startMcp`, `textOf`
- imported by: `bench/mcp-run.mjs`

## bench/mcp-run.mjs
- exports: `VARIANTS`, `mcpArgs`, `mcpCli`, `mcpVersion`, `performLean`, `performNaive`, `readDefinition`, `refFor`, `runVariant`, `timeVariant`
- imports: `bench/mcp-client.mjs`, `bench/task.mjs`, `bench/time-run.mjs`
- imported by: `bench/bench.mjs`

## bench/raport.mjs
- exports: `barChart`, `paritySummary`, `renderRaport`, `renderReadmeBlock`, `renderWyniki`
- imports: `bench/tokens.mjs`
- imported by: `bench/bench.mjs`

## bench/serve.mjs
- exports: `APP_PORT`, `APP_ROOT`, `safePath`, `serveStatic`, `startServer`
- imported by: `bench/bench.mjs`

## bench/task.mjs
- exports: `APP_URL`, `EXPECTED`, `FLOW_STEPS`, `INPUT`, `SNAPSHOT_NAME`, `browserInspectorConfig`, `checkFindings`
- imported by: `bench/bench.mjs`, `bench/browser-inspector-run.mjs`, `bench/mcp-run.mjs`

## bench/time-run.mjs
- exports: `BIN`, `REPO`, `chromeDescendants`, `chromeProcesses`, `isAlive`, `makeStamp`, `readJson`, `sleep`, `spawnBrowserInspector`, `stats`, `waitForChromeGone`
- imported by: `bench/bench.mjs`, `bench/browser-inspector-run.mjs`, `bench/budget.mjs`, `bench/mcp-run.mjs`

## bench/tokens.mjs
- exports: `bytesOf`, `countTokens`, `fmt`, `measure`, `total`
- imported by: `bench/bench.mjs`, `bench/browser-inspector-run.mjs`, `bench/budget.mjs`, `bench/raport.mjs`

## packages/browser-inspector/bin/browser-inspector.mjs
- imports: `packages/browser-inspector/src/cli.mjs`, `packages/browser-inspector/src/client.mjs`

## packages/browser-inspector/src/auth.mjs
- exports: `AuthError`, `E_AUTH`, `OAUTH_TIMEOUT_MS`, `TOKEN_EXPIRY_MARGIN_MS`, `ensureSession`, `metaPath`, `oauthRequestBody`, `oauthStorageState`, `oauthTokenUrl`, `resolveAuthValues`, `resolveStatePath`, `sessionUsable`, `storageStateFor`, `tokenExpiresAt`, `tokenUsable`
- imports: `packages/browser-inspector/src/isolation.mjs`, `packages/browser-inspector/src/recorder.mjs`, `packages/browser-inspector/src/redact.mjs`, `packages/browser-inspector/src/steps.schema.mjs`, `packages/browser-inspector/src/types.js`
- imported by: `packages/browser-inspector/src/engine.mjs`, `packages/browser-inspector/src/keeper.mjs`

## packages/browser-inspector/src/capture.mjs
- exports: `ELEMENTS_CAP`, `EVIDENCE_CAP_MS`, `EXTRACT_CAP`, `TEXT_CAP`, `capExtract`, `elementsMap`, `evaluateWithTimeout`, `exceptionText`, `finalEvidence`, `finalScreenshotName`, `mapEvaluateResult`, `pageEvidence`, `pageText`, `pngSize`, `saveScreenshot`, `screenshotFast`, `stringifyResult`
- imports: `packages/browser-inspector/src/deadline.mjs`, `packages/browser-inspector/src/types.js`
- imported by: `packages/browser-inspector/src/engine.mjs`, `packages/browser-inspector/src/steps.run.mjs`

## packages/browser-inspector/src/cli.mjs
- exports: `CONTROL_COMMANDS`, `CliError`, `STAMP_PATTERN`, `bindPositionals`, `formatStamp`, `parseArgs`, `parseSessionCommand`, `splitFlags`, `suggest`, `usage`
- imports: `packages/browser-inspector/src/steps.schema.mjs`, `packages/browser-inspector/src/types.js`
- imported by: `packages/browser-inspector/bin/browser-inspector.mjs`, `packages/browser-inspector/src/client.mjs`, `packages/browser-inspector/src/engine.mjs`, `packages/browser-inspector/src/keeper.mjs`, `packages/browser-inspector/src/report.mjs`

## packages/browser-inspector/src/client.mjs
- exports: `CONNECT_RETRY_MS`, `CONNECT_TIMEOUT_MS`, `INLINE_FILE_MAX`, `KeeperUnavailableError`, `REQUEST_TIMEOUT_MS`, `computeIdentity`, `connectOnce`, `doctor`, `ensureKeeper`, `exchange`, `isScriptComment`, `main`, `packageVersion`, `readFileEntry`, `readPidFile`, `resolveValues`, `runInProcess`, `runViaKeeper`, `spawnKeeper`, `splitCommandLine`
- imports: `packages/browser-inspector/src/cli.mjs`, `packages/browser-inspector/src/config.mjs`, `packages/browser-inspector/src/keeper.mjs`, `packages/browser-inspector/src/paths.mjs`, `packages/browser-inspector/src/print.mjs`, `packages/browser-inspector/src/types.js`
- imported by: `packages/browser-inspector/bin/browser-inspector.mjs`, `packages/browser-inspector/src/engine.mjs`

## packages/browser-inspector/src/config.mjs
- exports: `ConfigError`, `DEFAULTS`, `lintConfig`, `loadConfig`, `parseConfig`
- imports: `packages/browser-inspector/src/paths.mjs`, `packages/browser-inspector/src/steps.schema.mjs`
- imported by: `packages/browser-inspector/src/client.mjs`, `packages/browser-inspector/src/keeper.mjs`

## packages/browser-inspector/src/deadline.mjs
- exports: `DeadlineError`, `degradeTo`, `isDeadline`, `withDeadline`
- imported by: `packages/browser-inspector/src/capture.mjs`, `packages/browser-inspector/src/engine.mjs`, `packages/browser-inspector/src/steps.run.mjs`

## packages/browser-inspector/src/engine.mjs
- exports: `BrowserMissingError`, `E_BROWSER_MISSING`, `FAST_HEADLESS_ARGS`, `LANE_IDLE_MS_DEFAULT`, `MAX_JOBS_DEFAULT`, `MAX_RSS_MB_DEFAULT`, `RSS_CHECK_EVERY`, `SCRUB_OP_MS_DEFAULT`, `STEP_GRACE_MS`, `createEngine`, `isPortable`, `launchBrowser`, `launchPlan`, `processRssMb`, `processRssMbAsync`
- imports: `packages/browser-inspector/src/auth.mjs`, `packages/browser-inspector/src/capture.mjs`, `packages/browser-inspector/src/cli.mjs`, `packages/browser-inspector/src/client.mjs`, `packages/browser-inspector/src/deadline.mjs`, `packages/browser-inspector/src/isolation.mjs`, `packages/browser-inspector/src/paths.mjs`, `packages/browser-inspector/src/print.mjs`, `packages/browser-inspector/src/recorder.mjs`, `packages/browser-inspector/src/redact.mjs`, `packages/browser-inspector/src/report.mjs`, `packages/browser-inspector/src/session-log.mjs`, `packages/browser-inspector/src/settle.mjs`, `packages/browser-inspector/src/snapshot.mjs`, `packages/browser-inspector/src/steps.run.mjs`, `packages/browser-inspector/src/steps.schema.mjs`, `packages/browser-inspector/src/types.js`

## packages/browser-inspector/src/isolation.mjs
- exports: `DEFAULT_VIEWPORT`, `GEN_MARKER`, `GEN_SCRIPT`, `SCRUB_STORAGE_TYPES`, `clearableOrigins`, `needsFreshContext`, `scrubPlan`
- imports: `packages/browser-inspector/src/types.js`
- imported by: `packages/browser-inspector/src/auth.mjs`, `packages/browser-inspector/src/engine.mjs`

## packages/browser-inspector/src/keeper.mjs
- exports: `DEFAULT_ENGINE_MODULE`, `EngineUnavailableError`, `IDLE_MS_DEFAULT`, `KEEPER_PATH`, `LOCK_YOUNG_MS`, `LOG_MAX_BYTES`, `MAX_JOBS_DEFAULT`, `MAX_RSS_MB_DEFAULT`, `PROBE_TIMEOUT_MS`, `PROTOCOL_VERSION`, `RSS_CHECK_EVERY`, `SESSION_TTL_MS_DEFAULT`, `acquireLock`, `createContext`, `createQueues`, `handleRequest`, `holderAnswers`, `isAlive`, `loadEngine`, `probePipe`, `spawnKeeper`, `startKeeper`
- imports: `packages/browser-inspector/src/auth.mjs`, `packages/browser-inspector/src/cli.mjs`, `packages/browser-inspector/src/config.mjs`, `packages/browser-inspector/src/paths.mjs`, `packages/browser-inspector/src/print.mjs`, `packages/browser-inspector/src/redact.mjs`, `packages/browser-inspector/src/report.mjs`, `packages/browser-inspector/src/types.js`
- imported by: `packages/browser-inspector/src/client.mjs`

## packages/browser-inspector/src/paths.mjs
- exports: `CI_VARS`, `DEFAULT_OUTPUT_DIR`, `PORTABLE_MARKER`, `collectIdentity`, `daemonEnabled`, `defaultOutputDir`, `fnv1a`, `identityHash`, `isCI`, `lockFile`, `logFile`, `pidFile`, `pipeName`, `playwrightCoreVersion`, `resolveOutputDir`, `sessionDir`, `srcStamp`
- imported by: `packages/browser-inspector/src/client.mjs`, `packages/browser-inspector/src/config.mjs`, `packages/browser-inspector/src/engine.mjs`, `packages/browser-inspector/src/keeper.mjs`

## packages/browser-inspector/src/print.mjs
- exports: `EVAL_INLINE_MAX`, `KEEPER_UNAVAILABLE`, `MAX_LINE`, `REF_NOT_FOUND`, `SEP`, `formatBytes`, `formatConsoleEntry`, `formatDeltas`, `formatDialogStatus`, `formatDoctor`, `formatEval`, `formatExport`, `formatFail`, `formatLine`, `formatMs`, `formatNetBody`, `formatNetEntry`, `formatNetSummary`, `formatNewEntries`, `formatOk`, `formatOpen`, `formatOverflow`, `formatShot`, `relPath`, `truncate`, `urlDisplay`
- imported by: `packages/browser-inspector/src/client.mjs`, `packages/browser-inspector/src/engine.mjs`, `packages/browser-inspector/src/keeper.mjs`, `packages/browser-inspector/src/report.mjs`, `packages/browser-inspector/src/snapshot.mjs`, `packages/browser-inspector/src/steps.run.mjs`

## packages/browser-inspector/src/recorder.mjs
- exports: `BODY_LIMIT`, `BODY_READ_MS`, `BODY_TYPES`, `CONSOLE_CAP`, `DIALOG_CAP`, `FAILED_REQUEST_CAP`, `NETWORK_CAP`, `PAGE_ERROR_CAP`, `attachRecorder`, `createRecorder`, `errorMessage`, `originOf`, `summarize`
- imports: `packages/browser-inspector/src/types.js`
- imported by: `packages/browser-inspector/src/auth.mjs`, `packages/browser-inspector/src/engine.mjs`

## packages/browser-inspector/src/redact.mjs
- exports: `MASK`, `maskSnapshotEntries`, `maskSnapshotValues`, `redact`, `redactDeep`, `secretForms`
- imported by: `packages/browser-inspector/src/auth.mjs`, `packages/browser-inspector/src/engine.mjs`, `packages/browser-inspector/src/keeper.mjs`, `packages/browser-inspector/src/session-log.mjs`, `packages/browser-inspector/src/snapshot.mjs`, `packages/browser-inspector/src/steps.run.mjs`

## packages/browser-inspector/src/report.mjs
- exports: `CAPS`, `SCRIPT`, `SOURCE`, `artifactFiles`, `buildManifest`, `buildReport`, `buildSnapshotManifest`, `failureOf`, `formatStepError`, `renderElementsMd`, `renderJUnit`, `renderReportMd`, `writeArtifacts`
- imports: `packages/browser-inspector/src/cli.mjs`, `packages/browser-inspector/src/print.mjs`, `packages/browser-inspector/src/types.js`
- imported by: `packages/browser-inspector/src/engine.mjs`, `packages/browser-inspector/src/keeper.mjs`

## packages/browser-inspector/src/session-log.mjs
- exports: `ExportError`, `JOURNAL_FILE`, `appendJournal`, `exportFlow`, `flowNameFrom`, `formatJournalLine`, `journalLineCount`, `journalPath`, `normalizeEntry`, `readJournal`, `writeFlowExport`
- imports: `packages/browser-inspector/src/redact.mjs`, `packages/browser-inspector/src/steps.schema.mjs`, `packages/browser-inspector/src/types.js`
- imported by: `packages/browser-inspector/src/engine.mjs`

## packages/browser-inspector/src/settle.mjs
- exports: `CAP_MS_DEFAULT`, `POLL_MS`, `QUIET_MS_DEFAULT`, `waitSettled`
- imports: `packages/browser-inspector/src/types.js`
- imported by: `packages/browser-inspector/src/engine.mjs`

## packages/browser-inspector/src/snapshot.mjs
- exports: `CONTEXT_ROLES`, `FIND_MAX`, `INTERACTIVE_ROLES`, `REF_PATTERN`, `RefNotFoundError`, `SEMANTIC_ROLES`, `aroundRef`, `boxJoin`, `compactLines`, `compactSnapshot`, `diffSnapshot`, `findInSnapshot`, `implicitRole`, `locatorFor`, `locatorForElement`, `namesContext`, `parseSnapshot`, `resolveRef`, `sensitiveRefs`, `sidecarFromPage`, `snapshotArtifacts`, `textUnder`, `uniqueIn`, `walkInteractive`
- imports: `packages/browser-inspector/src/print.mjs`, `packages/browser-inspector/src/redact.mjs`, `packages/browser-inspector/src/types.js`
- imported by: `packages/browser-inspector/src/engine.mjs`, `packages/browser-inspector/src/steps.run.mjs`

## packages/browser-inspector/src/steps.run.mjs
- exports: `BODY_LINES_MAX`, `NET_LIST_MAX`, `RUNNERS`, `SNAP_MAX_DEFAULT`, `durableSelector`, `fileContent`, `globToRegExp`
- imports: `packages/browser-inspector/src/capture.mjs`, `packages/browser-inspector/src/deadline.mjs`, `packages/browser-inspector/src/print.mjs`, `packages/browser-inspector/src/redact.mjs`, `packages/browser-inspector/src/snapshot.mjs`, `packages/browser-inspector/src/steps.schema.mjs`, `packages/browser-inspector/src/types.js`
- imported by: `packages/browser-inspector/src/engine.mjs`

## packages/browser-inspector/src/steps.schema.mjs
- exports: `ALL_SPELLINGS`, `ARTIFACT_NAME`, `FIELD_TYPES`, `MODIFIERS`, `REF_PATTERN`, `STEPS`, `STEP_NAMES`, `WAIT_UNTIL`, `checkField`, `describeStep`, `helpFor`, `isRef`, `parseFieldType`, `refFieldsOf`, `resolveStepName`, `splitPoint`, `stepNames`, `validateStep`, `validateSteps`, `valueArg`
- imports: `packages/browser-inspector/src/types.js`
- imported by: `packages/browser-inspector/src/auth.mjs`, `packages/browser-inspector/src/cli.mjs`, `packages/browser-inspector/src/config.mjs`, `packages/browser-inspector/src/engine.mjs`, `packages/browser-inspector/src/session-log.mjs`, `packages/browser-inspector/src/steps.run.mjs`

## scripts/check-instruction-sync.mjs
- exports: `AGENTS_FILE`, `BENCH_FILE`, `COPILOT_FILE`, `TOKEN_LIMIT`, `checkInstructionSync`, `countTokens`, `extractInstruction`

## scripts/gen-steps-doc.mjs
- exports: `DOC_FILE`, `SCHEMA_FILE`, `renderFromRepo`, `renderStepsDoc`

## scripts/index-code.mjs
- exports: `INDEX_FILE`, `buildIndex`, `generateIndex`, `listSourceFiles`, `parseExports`, `parseImports`, `renderIndex`

## scripts/portable-zip.mjs
- exports: `DOWNLOAD_DIR`, `FIXED_MTIME`, `PORTABLE_MARKER`, `buildPortable`, `crc32`, `gitTags`, `isFrozen`, `listFiles`, `readVersion`, `sha256`, `stagePortable`, `zipDirectory`, `zipEntries`, `zipName`
