# Handoff WP1 → WP2–WP9 — kontrakty zamrożone

WP1 dostarczył rdzeń czysty: tabelę `STEPS`, parser CLI, loader configu, tożsamość keepera, format
stdout, redakcję, plan izolacji, deadline i typy. Poniżej **dokładne nazwy eksportów i kształty**,
których inne pakiety mają używać. Wszystko jest w `packages/browser-inspector/src/`; typy w
`src/types.d.ts` (w JSDoc: `/** @typedef {import('./types.js').PageLike} PageLike */` — tsc
rozwiązuje `./types.js` do `types.d.ts`).

Testy WP1: `npx vitest run packages/browser-inspector/test` (8 plików, 124 testy), `prettier --check`,
`tsc --noEmit` (całe repo, exit 0), `gen-steps-doc --check`, `index-code --check` — zielone.
`docs/STEPS.md` wygenerowany (`npm run docs`), `CODE-INDEX.md` zregenerowany.

**Prośba (plik współdzielony, nieedytowany przez WP1):** do `CHANGELOG.md` sekcji `Unreleased` dopisać:
`- WP1: kontrakty i moduły czyste — STEPS (45 kroków), parseArgs, loadConfig/lintConfig, paths (identityHash,
pipeName, isCI, daemonEnabled), print, redact, scrubPlan/needsFreshContext/GEN_SCRIPT, withDeadline, types.d.ts;
docs/STEPS.md generowany (AC-8, AC-12, AC-14, AC-16, AC-20).`

## `src/steps.schema.mjs` — tabela kroków (klient + silnik)

Eksporty: `STEPS`, `STEP_NAMES` (tablica, kolejność tabeli), `stepNames({ batch?, session? })`,
`resolveStepName(nameOrAlias)`, `ALL_SPELLINGS`, `validateSteps(steps, where, { mode })`,
`validateStep(step, where, ctx)`, `describeStep(step)`, `helpFor(nameOrAlias)`, `refFieldsOf(step, def)`,
`checkField(value, type, path)`, `parseFieldType(type)`, `FIELD_TYPES`, `valueArg(raw, flags)`,
`isRef(value)`, `REF_PATTERN`, `ARTIFACT_NAME`, `MODIFIERS`, `WAIT_UNTIL`.

Kształt wpisu (`StepDef`):

```js
STEPS.click = {
  kind: 'action' | 'query' | 'control',   // action → delty w linii stdout, query → treść, control → samo ok
  aliases: ['open'],                       // tylko w sesji (open→goto, shot→screenshot, get→extract, eval→evaluate, snap→snapshot)
  batch: true,                             // wolno w configu (`steps[].do`)
  session: true,                           // wolno jako `bi <name>`
  argv: ['target', 'value?', 'files...'],  // pozycyjne: wymagane / `?` opcjonalne / `...` reszta (ostatnie)
  flags: { double: 'bool', mod: 'list' },  // flagi sesji; `bool` bez wartości
  config: { selector: 'string?', ref: 'ref?', count: 'int?' },  // pola configu = kształt kroku (także w sesji!)
  validate: (s, where, { mode }) => string | string[] | undefined,  // reguły krzyżowe; `mode`: 'batch'|'session'|'auth'
  describe: (s) => 'click e12 (double)',   // nigdy wartość fill — tylko `(literal)` / `(from env NAZWA)`
  help: 'click <eN|selector> [--double] [--right] [--mod ctrl,shift]',
  fromArgv: (positionals, flags) => ({ ref: 'e12', count: 2 }),  // buduje krok w kształcie configu
};
```

**Klucze (45), w tej kolejności:** goto, back, forward, reload, click, fill, type, form, press, hover,
select, check, uncheck, drag, upload, scroll, mouse, wait, waitFor, screenshot, pdf, extract, evaluate,
snapshot, find, verify, resize, route, unroute, routes, offline, fetch, dialog, tab, tabs, frame, storage,
state, console, net, trace, video, locator, run, close.
`batch: false` (tylko sesja): find, routes, tabs, console, net, trace, video, locator, run, close.
**`RUNNERS` w `steps.run.mjs` musi mieć dokładnie te klucze** (test równości — WP2/WP6). Sugestia:
WP2 dodaje runnery batchowe, a dla kroków `batch: false` wpis rzucający `session only` do czasu WP6,
żeby test równości kluczy był zielony od razu.

Typy pól (`FIELD_TYPES`): `string` (niepusty), `text` (może być pusty), `int`, `number`, `bool`, `list`
(tablica stringów; w sesji po przecinku), `enum:a,b`, `ref` (`eN`/`f<seq>eN`), `target` (ref albo selektor
— `drag.from/to`), `url`, `name` (`[a-z0-9][a-z0-9-]*`, ≤ 64), `object`, `array`, `any`; sufiks `?` = opcjonalne.

Kształty kroków, o które pyta silnik (kształt configu = kształt kroku z sesji):

- cel: `{ selector }` **albo** `{ ref }` (dokładnie jedno) — `ctx.sel(step)` rozwiązuje; `press` ma cel opcjonalny.
- wartości: `fill`/`type` → `{ value }` albo `{ valueFromEnv }` (uwaga: `type` używa **`value`**, nie `text`,
  żeby adresowanie wartości było jedno); `form` → `{ fields: [{ selector|ref, value|valueFromEnv }] }`;
  `storage set` → `{ kind, op:'set', key, value|valueFromEnv }`; `select` → `{ value }` albo `{ values: [] }`.
- `click` → `{ button?: 'left'|'right'|'middle', count?: 1|2|3, modifiers?: ['ctrl','shift','alt','meta'] }`
  (mapowanie na Playwright: `MODIFIERS`).
- `wait` → dokładnie jedno z `{ ms | text | textGone | url | selector }`; `waitFor` → `{ selector|ref, state? }`.
- `screenshot` → `{ name?, fullPage?, selector?|ref?, format?: 'png'|'jpeg', quality?, mark?: ref }`
  (w batchu `name` wymagane; `final` zarezerwowane).
- `extract` → `{ name?, selector|ref, value?: bool }`; `evaluate` → `{ name?, expression?, file?, selector?|ref?, timeout? }`
  (batch: `name` + `expression` wymagane; `file` tylko w sesji — treść przysyła klient w `files`).
- `snapshot` → `{ name?, max?, diff?, around?, grep?, names?, all? }`; `find` → `{ text, names? }`.
- `verify` → `{ kind: visible|hidden|text|value|list|url|title|count, selector?|ref?, text?, value?, items?, url?, title?, count?, soft? }`.
- `route` → `{ url, block?, status?, body?, file?, delay?, contentType? }` (co najmniej jeden efekt);
  `unroute` → `{ url? }`; `offline` → `{ on: bool }`; `fetch` → `{ url, method?, body?, headers?, name? }`.
- `dialog` → `{ action?: accept|dismiss, text?, once? }` (batch: `action` wymagane; sesja bez `action` = pokaż politykę).
- `tab` → `{ action: new|select|close, index?, url? }`; `frame` → `{ frame: 'main'|'<n>'|selektor }`.
- `mouse` → `{ action: click|move|down|up|wheel|drag, x?, y?, toX?, toY?, dx?, dy?, button? }`.
- `storage` → `{ kind: cookies|local|session, op: list|get|set|del|clear, key?, value?, valueFromEnv?, name? }`.
- `state` → `{ op: save|load, file }`; `trace` → `{ action: start|stop, file? }`; `video` → `{ action }`;
  `console` → `{ level?, all?, tail? }`; `net` → `{ n?, failed?, all?, tail?, body?, req? }`; `locator` → `{ ref }`;
  `run` → `{ file }`; `resize` → `{ width, height }`; `goto` → `{ url, waitUntil?, video? }`; `reload` → `{ waitUntil? }`.

Reguły flow (`validateSteps`, tryb `batch`): `ref` (także `drag.from/to` i `form.fields[k].ref`) dopiero po
kroku `snapshot`; nazwy zrzutów unikalne; `extract`/`evaluate`/`storage.name`/`fetch.name` dzielą jedną
przestrzeń; `final` zarezerwowane. Tryb `auth`: `fill` wyłącznie `valueFromEnv`. Tryb `session`: refy zawsze OK.
Komunikaty mają prefiks `where` (`snapshots[1].steps[2].selector: …`).

## `src/cli.mjs` — parser argv (czysty)

Eksporty: `parseArgs(argv, STEPS?)`, `parseSessionCommand(command, args, STEPS?)`, `splitFlags(args, spec, scope)`,
`bindPositionals(...)`, `usage(command?)`, `suggest(word, candidates)`, `formatStamp(date)` (Europe/Warsaw),
`STAMP_PATTERN`, `CONTROL_COMMANDS`, `CliError` (`.exit === 2`).

`parseArgs` zwraca (zawsze jeden z):

```js
{ mode: 'help', command? } | { mode: 'version' }
{ mode: 'up'|'status'|'stop'|'doctor', options: {} }
{ mode: 'batch', configPath, options: { stamp?, only: [], parallel?, fresh, junit?, failOnIncomplete, noDaemon } }
{ mode: 'session', command: 'goto', alias: 'open', step: { do: 'goto', url }, options: { session?, out?, soft } }
{ mode: 'script', file, options: { out?, noDaemon } }
{ mode: 'export', file, options: { session?, force } }
{ mode: 'lint-config', configPath }
```

Błąd parsowania = `throw new CliError(message)`; klient drukuje `message` i kończy `exit` (2). W sesji
`@{NAZWA}` / `--env NAZWA` stają się `valueFromEnv` **już w parserze** — rozwiązanie z env jest zadaniem
klienta (WP5), parser nie dotyka `process.env`. `bi run --file s.mjs` to krok sesji; `bi run <cfg.json>` to batch.

## `src/config.mjs`

Eksporty: `loadConfig(configPath, cwd?)`, `parseConfig(raw, { configPath?, cwd? })`, `lintConfig(config)`,
`DEFAULTS`, `ConfigError` (`.errors: string[]`, `.code === 'E_CONFIG'`, `.file`).

`loadConfig` zwraca znormalizowany config: `outputDir` **absolutny, względem pliku configu**; `parallel`,
`settleMs`, `browser { headless, fastHeadless, motion, channel?, executablePath?, args? }`, `auth?` (z
`maxAgeMinutes: 60, reuse: true`), `snapshots[]` z domyślnymi (`waitUntil: 'load'`, `viewport 1280×720`,
`navTimeoutMs 30000`, `stepTimeoutMs 10000`, `captureElements true`, `captureNetwork true`,
`captureSnapshot false`, `captureBodies true`, `render ['json','markdown']`, `isolation 'reuse'`,
`finalScreenshot 'auto'`, `dialogs 'dismiss'`, `settleMs`), kroki **bez zmian**; `configPath` absolutny.
Nowe pola snapshotu: `isolation`, `finalScreenshot`, `captureSnapshot`, `captureBodies`, `dialogs`,
`routes[]` (kształt kroku `route`), `settleMs`, `trace`, `video`, `storageState`, `auth: false`.
`lintConfig(config)` → `{ findings: [{ kind, path, message }], lines: string[] }` — `lines` to dokładnie
trzy zdania z DESIGN §3.4 (na fixture app-factory: 4× networkidle, 7× wait ms/4200 ms, `parallel: 3`).

## `src/paths.mjs` (klient, tylko node:fs/os/path)

`identityHash(parts)` (fnv1a, 8 hex) z `IdentityParts = { pkgVersion, pwVersion, nodeMajor, channel,
executablePath, headless, args, browserArgsEnv, httpProxy, httpsProxy, noProxy, binRealpath, srcStamp }`;
`collectIdentity({ packageDir, env?, browser?, nodeMajor? })` zbiera je z drzewa (wersja playwright-core z
`package.json` przez fs — bez importu; `srcStamp` = max mtime `src/**`, `''` przy markerze `PORTABLE`;
honoruje `BI_CHANNEL`, `BI_BROWSER_PATH`, `BI_BROWSER_ARGS`, proxy). `pipeName(hash, { platform?, env?,
user?, uid?, tmpdir? })` (`BI_SOCKET` wygrywa; win32 `\\.\pipe\bi-<user>-<hash>`, inaczej
`$XDG_RUNTIME_DIR|tmpdir/bi-<uid>-<hash>.sock`), `pidFile/lockFile/logFile(hash, tmpdir?)`,
`sessionDir(out, name='default')`, `resolveOutputDir(outputDir, baseDir)`, `defaultOutputDir()`,
`DEFAULT_OUTPUT_DIR`, `isCI(env)`, `CI_VARS`, `daemonEnabled(env, { noDaemon? })` (`BI_DAEMON=1` > CI),
`fnv1a`, `srcStamp(dir)`, `playwrightCoreVersion(packageDir)`, `PORTABLE_MARKER`.

## `src/print.mjs` (linie stdout, czyste)

`formatLine(status, head, parts)`, `formatOk(head, parts)`, `formatFail(head, reason, parts)`,
`formatDeltas(before, after, { baseOrigin? })` → `string[]` (`navigated → refs f1eN (bi snap)` | `url /cart "Koszyk"`
| `dom Δ`, potem `el a→b`/`el a`, `+N console.error`, `+N net failed`, `dialog …`), `truncate(text, max=160)`,
`formatMs(1390) → '1 390'`, `formatBytes`, `relPath(file, cwd)` (forward slashes), `urlDisplay(url, baseOrigin?)`,
`formatOpen`, `formatShot`, `formatOverflow(hidden, file)`, `formatNewEntries(lines, what='new')`,
`formatConsoleEntry`, `formatNetEntry`, `formatNetSummary`, `formatNetBody`, `formatDialogStatus`, `formatExport`,
`formatDoctor`, `formatEval(text, file?)`, stałe `SEP`, `MAX_LINE`, `EVAL_INLINE_MAX` (300), `REF_NOT_FOUND`,
`KEEPER_UNAVAILABLE(reason)`. Próbki z DESIGN §4.4 reprodukowane co do znaku i zmierzone ≤ 40 tok.
`before/after` dla delt: `{ url, title, el, consoleErrors, netFailed }` + `after.navigated/frameSeq/domChanged/dialogs`.

## `src/redact.mjs`

`redact(text, secretValues)` (raw + JSON-escaped + URL-encoded, najdłuższe najpierw), `redactDeep(value, secrets)`,
`maskSnapshotValues(text, { secretValues?, sensitiveRefs? })` (YAML aria **i** kompakt `snap.md`; refy z
`sensitiveRefs` tracą wartość całkiem), `maskSnapshotEntries(entries, opts)` (sidecar: wpis `sensitive: true`
albo ref w `sensitiveRefs` traci `value`), `secretForms`, `MASK` (`***`). **WP3**: box-join ma oznaczać
`type=password` / `autocomplete=one-time-code` jako `sensitive: true` w sidecarze i podać ich refy jako `sensitiveRefs`.

## `src/isolation.mjs` (tylko część czysta — `applyScrub` należy do WP2)

`scrubPlan(state: LaneState) → ScrubOp[]`, gdzie `LaneState = { pages: [{ page, isLaneTab }], crashed,
currentOrigin, visitedOrigins, generation, viewport? }`. **Nazwy ops, w tej kolejności:**

1. `{ op: 'closePage', page, reason: 'popup' }` — per strona ≠ karta lane’u (wcześniej do `report.json.tabs[]`);
2. `{ op: 'newTab', reason: 'crash' }` — tylko po `crashed` (close + newPage, `timing.tab = 'new'`);
3. `{ op: 'domStorageClear', origin }` — CDP `DOMStorage.clear` session+local bieżącego originu (pomijany po crashu);
4. `{ op: 'setGeneration', generation }` — `Page.removeScriptToEvaluateOnNewDocument` + `addScriptToEvaluateOnNewDocument(GEN_SCRIPT(generation))` (wymaga `Page.enable`);
5. `{ op: 'clearOrigin', origin, storageTypes }` — CDP `Storage.clearDataForOrigin`, per odwiedzony origin http(s), bez duplikatów;
6. `{ op: 'resetContext', viewport, dialogs: 'dismiss' }` — clearCookies, clearPermissions, unrouteAll, setOffline(false),
   setExtraHTTPHeaders({}), setGeolocation(null), emulateMedia(null…), viewport, polityka dialogów, default timeouts;
7. `{ op: 'resetNavigationHistory' }` — CDP; pomijany po `newTab`.

Nigdy `about:blank`, nigdy `goto`. Pozostałe eksporty: `needsFreshContext(snapshot, { fresh?, auth? })`,
`GEN_SCRIPT(gen)`, `GEN_MARKER` (`__bi_gen`), `DEFAULT_VIEWPORT`, `SCRUB_STORAGE_TYPES`, `clearableOrigins`.

## `src/deadline.mjs`

`withDeadline(promise, ms, label)` (rzuca `DeadlineError`, `.code === 'E_DEADLINE'`, komunikat
`<label> timed out after <ms>ms`), `degradeTo(fallback, promise, ms, label)`, `isDeadline(error)`.

## `src/types.d.ts` — typy współdzielone

`PageLike` (metody z DESIGN §8 + `uncheck`, `keyboard`; sygnatury luźne, `[extra: string]: any`), `LocatorLike`,
`ContextLike`, `CdpLike { send(method, params?) }`, `RecorderLike` (`console`, `consoleTotal`, `pageErrors`,
`network`, `networkTotal`, `dialogs`, `tabs`, `visitedOrigins`, `inFlight`, `cacheHits`, `cacheHitsDocument`,
`bodies?`, `sinceLast?`), `StepContext`, `StepCapture`, `SessionState`, `StepDef`, `Step`, `StepResult`,
`Report`, `Timing`, `EngineInfo`, `Manifest`, `SnapshotManifest`, `KeeperRequest`, `KeeperResponse`
(`KeeperProgress | KeeperDone`), `KeeperFile`, `ScrubOp`, `LaneState`, `ConsoleEntry`, `NetEntry`, `DialogEntry`, `TabEntry`.

**`ctx` (StepContext) przekazywany do `RUNNERS[name](ctx, step)`:**

```js
ctx = {
  page, context, cdp: { send }, dir, timeoutMs,
  capture: { screenshots: [], extracts: {}, verifications: [], pending?: [] },
  recorder,
  sel: async (step, field = 'ref'|'selector') => selector,   // count() przed akcją, 1 odświeżenie snapshotu, FAIL z REF_NOT_FOUND
  values: { 'snapshots[3].steps[4].value': '…', 'argv.fill.value': '…' },  // od klienta, pod adresami kroków
  address: 'snapshots[3].steps[4]',                          // adres bieżącego kroku
  value: (field = 'value', step?) => string,                 // values[`${address}.${field}`] ?? step[field]; brak → błąd nazwany
  secretValues: [], redact: (text) => string,
  files: { '<ścieżka jak w kroku>': { base64?, path?, size } },
  mode: 'batch' | 'session', session?, snapshot?, lines?,
};
```

Adresowanie wartości (WP5 ↔ WP2/WP6): batch `snapshots[i].steps[j].value`, `snapshots[i].steps[j].fields[k].value`,
`auth.login.steps[j].value`; sesja `argv.<command>.value`, `argv.form.fields[k].value`. Klient wysyła w `values`
**tylko** rozwiązane wartości `valueFromEnv` (i literały z argv może zostawić w kroku); `secretValues` = wszystkie
wartości pochodzące z env.

**Protokół keepera** (bez `env`): żądanie `{ v: 1, token, cwd, argv, values, secretValues, files, session?, out? }`;
odpowiedzi `{ progress: { snapshot, completed, ms, index, total } }` … `{ done: true, exit, lines, files, timing?, mode? }`.

**`Timing`**: `{ mode: 'warm'|'first'|'fallback'|'no-daemon', ctx: 'reused'|'fresh', tab: 'kept'|'new', lane, queuedMs,
scrubMs, gotoMs, stepsMs, captureMs, writeMs, totalMs, cacheHits, cacheHitsDocument }`.

## Odstępstwa i decyzje do wiadomości innych WP

- `type` używa `value`/`valueFromEnv` (nie `text`) — jedno adresowanie sekretów dla fill/type/form/storage.
- `find`, `routes`, `tabs`, `console`, `net`, `trace`, `video`, `locator`, `run`, `close` mają `batch: false`;
  `trace: true` / `video: true` w batchu to pola snapshotu, nie kroki.
- `bi run` jest dwuznaczne: `run <cfg.json>` = batch, każde inne `run …` = krok sesji (`--file`).
- `scripts/gen-steps-doc.mjs` (plik WP0, docelowo WP8) dostał prawdziwy rendering (7 kolumn + legenda typów
  + reguły wspólne); `docs/STEPS.md` wygenerowany. WP8 może zmienić rendering — plik jest generowany.
- `CODE-INDEX.md` zregenerowany (`node scripts/index-code.mjs`) — wpisy `src/types.js` w mapie importów to
  JSDoc `import('./types.js')` (regex indeksu widzi je jako importy); to `types.d.ts`, nie plik runtime.
- Test równości kluczy `STEPS` ↔ `RUNNERS` nie mógł powstać w WP1 (brak `steps.run.mjs`) — należy do WP2
  (`test/engine.test.mjs`) albo WP6.
- `docs/STEPS.md` trzeba regenerować po każdej zmianie `steps.schema.mjs` (`npm run docs`), inaczej
  `gen-steps-doc --check` w `verify` pada.

## Prośby do innych pakietów

- **WP2**: `applyScrub(lane, plan)` wykonuje ops z listy wyżej 1:1; `RUNNERS` z wszystkimi 45 kluczami
  (session-only jako stub do czasu WP6); `ctx.value()` i `ctx.address` wg kontraktu; mapowanie `modifiers`
  przez `MODIFIERS`; `waitUntil: 'settled'` przechodzi przez `settle.mjs`.
- **WP3**: sidecar `snap.json` z `sensitive: true` dla password/one-time-code; kompakt w formie
  `e39 textbox "…" = wartość` (tak parsuje `maskSnapshotValues`).
- **WP5**: hash z `collectIdentity` + `identityHash`; `pipeName`/`pidFile`/`lockFile`/`logFile`; `daemonEnabled`;
  `CliError.exit` → kod wyjścia; `KEEPER_UNAVAILABLE` z `print.mjs`; rozwiązywanie `valueFromEnv` z adresami jak wyżej.
- **WP6**: linie przez `print.mjs` (`formatOk` + `formatDeltas`, `formatNewEntries`, `formatNetSummary` …);
  `parseSessionCommand` z `cli.mjs` dla `bi script` (jedna linia = jedno argv; podział na argv robi WP6).
- **WP8**: `lintConfig(...).lines` drukowane 1:1 przez `bi lint-config`; `usage()`/`helpFor()` dla `bi help`.
