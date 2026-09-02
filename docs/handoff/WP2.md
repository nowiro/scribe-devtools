# Handoff WP2 → WP5, WP6, WP7, WP8, WP9 — silnik batch, rejestrator, izolacja

WP2 dostarczył `src/engine.mjs` (połowa batchowa: launch, lane'y `scratch[0..N-1]` z trwałą kartą,
`spare`, `runFlow`, `finishRun`, `applyScrub`, zdrowie), `src/recorder.mjs`, `src/settle.mjs`,
`src/capture.mjs`, `src/steps.run.mjs` (sekcja batch, 45 kluczy ≡ `STEPS`), fixture'y
`form/slow/dialog/upload/drag/routes/storage.html`, serwer fixture'ów `test/smoke/fixture-server.mjs`
oraz testy: `test/engine.test.mjs` (29, FakePage), `test/settle.test.mjs` (7), `test/recorder.test.mjs` (12),
`test/smoke/smoke.test.mjs` (12 na prawdziwym Chrome, porty 4501–4502).

Zielone (2026-09-02): `npx vitest run --project unit` — 19 plików, **286 testów** (razem z testami WP1/3/4/5;
`test/client.test.mjs` przechodzi — fallback in-process importuje już prawdziwy silnik); `npx vitest run --project smoke`
— 12/12, trzy razy z rzędu (≈ 12 s); `tsc --noEmit` — **0 błędów w całym repo**; `prettier --check` na plikach WP2;
`node scripts/index-code.mjs --check` (CODE-INDEX.md zregenerowany); `gen-steps-doc --check`. Sprawdzone też
ręcznie end-to-end: `node bin/bi.mjs read.config.json --no-daemon --stamp 2026-09-02_10-00` (klient WP5 →
`keeper.handleRequest` in-process → ten silnik) daje `ok strona · 1 153 ms` / `FAIL zgloszenie · step 4 "evaluate boom"
— Error: uczen widzi przycisk nauczyciela`, `report.json/md`, `_manifest.json` per snapshot i per przebieg, sekret
z `valueFromEnv` nigdzie w plikach.

**Prośba (plik współdzielony, nieedytowany przez WP2):** do `CHANGELOG.md` sekcji `Unreleased` dopisać:
`- WP2: silnik batch — createEngine (chrome → msedge, E_BROWSER_MISSING z listą prób), lane'y scratch z jedną
trwałą kartą szorowaną w miejscu (applyScrub 1:1 z scrubPlan, 5–10 ms/origin), spare prewarm, runFlow (kroki pod
withDeadline, dowód końcowy, report.json/md + _manifest.json), finishRun (manifest przebiegu, JUnit), zdrowie
(crash → nowa karta, disconnected, recykling BI_MAX_JOBS/RSS); rejestrator (since-last, ciała ≤ 64 KB, cacheHits,
tabs[], sw=blocked); settled; CDP-zrzuty; evaluate przez Runtime.evaluate z mapowaniem wyniku; RUNNERS dla 45 kroków;
fixture'y i smoke na prawdziwym Chrome (AC-1, AC-7, AC-9, AC-11, AC-13, AC-15, AC-16).`

## Liczby zmierzone (Chrome 152 headless, fixture'y przez node:http, 2026-09-02)

| pomiar | wynik |
| --- | --- |
| `chromium.launch({ channel: 'chrome' })` | 175–180 ms |
| goto `load` na tej samej karcie, ten sam origin (storage.html / form.html) | 26–40 ms |
| pierwsze goto na nowy origin na tej samej karcie | 750–935 ms (site isolation; DESIGN §6 mówi 75–320 — tu ciężej) |
| scrub między snapshotami (1 origin / 2 originy) | 5–10 ms / ≤ 50 ms (asercja AC-11 w smoke) |
| `waitUntil: settled` vs `networkidle` na `slow.html?delay=300` | ≈ 450 vs ≈ 830 ms (Δ ≈ 380; AC-16 ≥ 150) |
| `Page.crash` → następny przebieg z nową kartą (`tab: new`) | ≈ 450 ms cały przebieg |
| `chrome://crash` | **zabija całą przeglądarkę** (nie sam renderer) — patrz odstępstwa |

## `createEngine` — dwa spellingi, jeden silnik

```js
import { createEngine } from './engine.mjs';
// własny: engine tests, bench, smoke
const engine = createEngine({ browser, env, log, launch?, maxJobs?, maxRssMb?, laneIdleMs?, prewarm?, prelaunch?, onDisconnected? });
// keepera (docs/handoff/WP5.md): createEngine(browserOpts, { log, env })
const engine = createEngine({ channel: 'chrome', headless: true, args: [] }, { log, env });
```

Pierwszy argument bez żadnego klucza silnika (`browser, env, launch, maxJobs, maxRssMb, laneIdleMs, onDisconnected,
log, prewarm, prelaunch`) jest traktowany jako `BrowserOptions` (`channel, executablePath, headless, args,
fastHeadless, motion`). `launch` = wstrzyknięcie przeglądarki (testy: `createFakeBrowser()` z `test/fake-browser.mjs`).
Silnik startuje przeglądarkę **od razu** (`ready` = obietnica launchu; `E_BROWSER_MISSING` wypływa przez `await engine.ready`,
czyli w keeperze przez `loadEngine`); `prelaunch: false` wyłącza.

Zwracany obiekt:

| pole | opis |
| --- | --- |
| `ready` | Promise launchu (keeper czeka przed pierwszym zadaniem) |
| `versions` | `{ bi, 'playwright-core' }` |
| `runFlow(snapshot, dir, laneOpts)` | patrz niżej → `FlowResult` |
| `finishRun(run)` | `<runDir>/_manifest.json` (+ JUnit gdy `run.options.junit`) → `{ files, manifest }` |
| `runBatch(config, { stamp, only?, parallel?, fresh?, mode?, values?, secretValues?, files?, cwd?, storageState?, junit?, onSnapshot? })` | in-process cały config przez lane'y + `finishRun` → `{ stamp, runDir, snapshots: FlowResult[], manifest, files, timing }` (keeper ma własną kolejkę i woła `runFlow`/`finishRun` sam) |
| `scrub(laneOrIndex)` → `{ ms, plan }`, `applyScrub(lane, plan)`, `laneState(lane)` | scrub w miejscu (plan z `isolation.scrubPlan`) |
| `getLane(index)` | trwały lane (`{ index, context, page, cdp, recorder, generation, dirty, busy, tab, jobs, scrubErrors }`) |
| `freshContext({ viewport?, storageState?, video? })` | para z puli `spare` albo nowy kontekst (`serviceWorkers: 'allow'`) |
| `makeStepContext(input)`, `runStep(ctx, step, index)`, `resolveSelector(ctx, step, field?)`, `navigate(ctx, url, waitUntil?, timeoutMs?)`, `writeSnapshotFiles(ctx, yaml, base)` | klocki dla WP6 |
| `status()` (alias `stats()`) | `{ connected, channel, browser: 'Chrome/152', browserRssMb, rssMb, pwVersion, pid, launches, launchMs, jobs, jobsSinceLaunch, scrubs, routes: 0, spare, lanes: [{ index, dirty, busy, jobs, generation, scrubErrors, lastUsedAt }] }` — klucze `launches`/`browserRssMb`/`pwVersion`/`lanes` czyta keeper |
| `recycle()` | `browser.close()` + launch (keeper woła między zadaniami) |
| `on('disconnected', cb)` | przeglądarka zniknęła; keeper robi `exit(1)`, w procesie następny `runFlow` relaunchuje (`mode: 'first'`, `tab: 'new'`) |
| `warm()`, `close()`, `browser`, `lanes`, `RUNNERS` | |

## `runFlow(snapshot, dir, laneOpts)` → `FlowResult`

`snapshot` = znormalizowany wpis z `loadConfig`/`parseConfig` (domyślne pola muszą być obecne — smoke używa
`parseConfig` właśnie po to). `laneOpts` (wszystko opcjonalne):

```js
{ lane: 0, fresh: false, mode: 'warm'|'first'|'fallback'|'no-daemon', queuedMs: 0,
  snapshotIndex: 3 | address: 'snapshots[3]',         // adresy wartości: `${address}.steps[j].value`, `.fields[k].value`, `.routes[k]`
  values: { 'snapshots[3].steps[4].value': '…' }, secretValues: ['…'], files: { '<jak w kroku>': { base64?, path?, size } },
  cwd, stamp, storageState, auth | config: { auth },   // keeper przysyła cały `config` — `auth` brany stamtąd
  redact, log }                                        // keepera; silnik ma własne (redact z secretValues)
```

Wynik: `{ name, dir, completed, ms, files: [ścieżki absolutne], timing, failure?, report }`. `failure` =
`navigationError` albo `step 4 "evaluate boom" — Error: …` (to samo, co `failureOf` z report.mjs). `report` = pełny
`Report` po `buildReport` (już z `Error: ` w `steps[i].error`, `navigationError` tylko gdy istnieje). `mode` bez
`laneOpts.mode`: `first` dla pierwszego zadania po launchu, potem `warm`.

Na dysku po `runFlow`: `report.json`, `report.md` (wg `snapshot.render`), `elements.md`, `text.txt`, `values/<name>.txt`
(> 5000 znaków), `_manifest.json` (koperta read-runtime, `stamp` z `laneOpts.stamp`), zrzuty `<name>.png|jpg`,
`page.png` (type page) / `final.png` (reguły §3.3 w `capture.finalScreenshotName`), `snap.full.yml` + `snap.md` +
`snap.json` (krok `snapshot` bez nazwy albo `captureSnapshot: true`; z nazwą: `snap-<name>.*`), `<name>.pdf`,
`trace.zip` (`trace: true`), `video.webm` (`video: true` ⇒ fresh). `report.json.files`: `elements`, `text`,
`snapshot` / `snapshot-<name>` → `snap*.md`, `pdf-<name>`, `trace`, `video`.

Kolejność w przebiegu: `ensureBrowser` → recykling (między zadaniami) → lane (scrub, jeśli `dirty` po poprzednim
przebiegu — **scrub wykonuje się na początku następnego przebiegu**, nie na końcu poprzedniego; keeper może zamiast
tego wołać `engine.scrub(lane)` po odpowiedzi, a `runFlow` zobaczy `dirty: false`) → viewport → `recorder.reset()`,
polityka dialogów ze `snapshot.dialogs` → `routes[]` → `tracing.start` → goto (`settled` przez `settle.mjs`) →
`Page.resetNavigationHistory` (historia przebiegu zaczyna się tu; `history.length === 1`) → kroki (stop na pierwszej
porażce, `skipped`) → `tracing.stop` → `finalEvidence` (zrzut wg reguł, tekst, mapa elementów, tytuł — każdy z
deadlinem ≤ 10 s) → czekanie na zapisy zrzutów i ciał odpowiedzi (= `timing.writeMs`) → `buildReport` →
`writeArtifacts` (+ manifest) → `lane.dirty = true`.

## `ctx` przekazywany do `RUNNERS[name](ctx, step)`

Kontrakt z `types.d.ts` (`StepContext`) plus pomocniki silnika:

```js
ctx = {
  page, context, cdp: { send }, dir, timeoutMs,            // stepTimeoutMs snapshotu (10 000)
  capture: { screenshots: [], extracts: {}, verifications: [], pending: [] },
  recorder,                                                 // Recorder z recorder.mjs (bodies, sinceLast, dialogPolicy, trigger, crashed, serviceWorkerSeen…)
  sel: (step, field?) => Promise<selector>,                 // ref → resolveRef (WP3): count(), JEDEN pełny snapshot, RefNotFoundError; selector → dosłownie
  values, address: 'snapshots[3].steps[4]',                 // ustawiane przez runFlow przed każdym krokiem
  value: (field = 'value', step?) => string,                // values[`${address}.${field}`] ?? step[field]; brak → `value from env X was not resolved (is X set?)`
  secretValues, redact: (text) => string, files,
  mode: 'batch' | 'session', session?, snapshot?, lines?,   // lines tylko w sesji
  // pomocniki silnika:
  cwd, laneTab, snapshotIndex, stepIndex, step,             // step = bieżący krok (value() bez argumentu go czyta)
  frame,                                                    // zakres CSS (`bi frame 2`) — runnery używają root(ctx, sel): ref zawsze na page
  routes: [{ url, block, status, body, delay, handler }],   // do `bi routes` / `unroute <wzorzec>`
  written: ['snap.md', 'strona.pdf', …],                    // artefakty poza zrzutami → report.files
  lastSnapshot: { text, entries?, at }, lastShot: { file, width, height, bytes },
  loc: (selector) => Locator,                               // frame-aware
  navigate: (url, waitUntil?, timeoutMs?) => Promise<void>, // `settled` przez settle()
  settle: () => Promise<{ settled, ms }>,                   // cap = snapshot.settleMs ?? 2000
  artifact: (name, ext) => ({ file, rel }),                 // batch: `<dir>/<name>.<ext>`; sesja: `shots/NNN-<name>.<ext>` (session.shotSeq++)
  writeSnapshot: (yaml, step) => Promise<'snap.md'>,        // yaml z ariaSnapshot({ mode:'ai', boxes:true }) → snap.full.yml + snap.json (boxJoin) + snap.md (compact, maskowanie)
  setPage: (page) => void, attachPage: (page) => recorder,  // `tab new`, popupy
};
```

`form` adresuje pola jako `${address}.fields[k].value` przez tymczasową podmianę `ctx.address` (typ `value()` ma 2 argumenty,
jak w `types.d.ts`). `runStep` zwraca `{ index, description, ok, ms, error? }` z **gołym** komunikatem (`ref not found …`,
`Timeout 300ms exceeded.`); prefiks `Error: ` dokłada `buildReport` (`formatStepError`). Deadline kroku =
`max(step.timeout, timeoutMs) + wait.ms + 2000` (Playwright zdąży własnym komunikatem).

## Co WP6 musi dodać (sesja)

Keeper (WP5) próbuje z `?.`: `runCommand(name, step, ctx)`, `runScript(lines, ctx)`, `exportFlow(name, opts)`,
`session(name)`, `closeSession(name)` — dziś ich **nie ma** (keeper odpowiada `exit 2` „this engine has no session
commands"). Klocki gotowe: `getLane`/`freshContext` (sesja = własny kontekst, nie lane scratch), `makeStepContext({ mode:
'session', session, dir: sessionDir, … })`, `runStep`, `navigate`, `resolveSelector`, `writeSnapshotFiles(ctx, yaml, 'snap')`,
`recorder.sinceLast(kind, cursor)` (kursory w `session.cursors`), `recorder.dialogPolicy` (+ `trigger` ustawiany przez
`runStep` = opis kroku, wpada do `dialogs[].trigger`), `attachRecorder(popup, { into })`, `ctx.frame` (runnery
respektują zakres). Stuby `sessionOnly(...)` w `steps.run.mjs` (find, routes, tabs, console, net, trace, video, locator,
run, close) do zastąpienia; `dialog` bez `action` w sesji = pokaż politykę (dziś no-op); `status().routes` = 0 do
policzenia z sesji; `evaluate --file` czyta `ctx.files` (klient przysyła treść) — działa już dziś.

## Odstępstwa i fakty (z uzasadnieniem)

- **Refy na reużytej karcie mają prefiks `f<seq>`** od drugiego dokumentu (`f11e3`; WP3 fakt 2) — `[ref=e…]` bez
  prefiksu widać tylko na pierwszym dokumencie karty. Smoke asertuje `[ref=(?:f\d+)?e\d+]`; do strony idzie
  `aria-ref=<ref>` dosłownie i klik działa.
- **`chrome://crash` w headless Chrome 152 ubija całą przeglądarkę** (`disconnected`), nie sam renderer. Ścieżka
  „crash → nowa karta" jest testowana przez CDP `Page.crash` (renderer; `timing.tab = 'new'`, przebieg ≈ 450 ms), a
  ścieżka „przeglądarka zniknęła" osobno (`on('disconnected')` + relaunch przy następnym `runFlow`; keeper wg DESIGN
  robi `exit 1`).
- `timing.writeMs` = czekanie na zakolejkowane zapisy zrzutów i ciała odpowiedzi; sam zapis `report.json/md`
  (kilka ms) jest po policzeniu `timing`, więc poza nim (DESIGN §6 liczy 10 ms na obie rzeczy).
- Dowód końcowy ma sufit **10 s na odczyt** (`EVIDENCE_CAP_MS`, zamiast `navTimeoutMs` 30 s ×3): raz na ~8
  przebiegów smoke zrzut `fullPage` przez Playwrighta wisiał 30 s (nie odtworzone w sondzie ani w 6 kolejnych
  przebiegach); z sufitem strona-wisielec kosztuje sekundy, nie minutę.
- `history.length` **wyrenderowane przez stronę przy load** pokazuje 2 (about:blank + dokument) także po scrubie;
  wartość żywa po goto = 1 (`resetNavigationHistory` jest po goto). Smoke i AC-11 sprawdzają wartość żywą.
- Ciasteczka nie są per port: `localhost:4501` i `:4502` dzielą słoik (drugi nadpisuje `bi-cookie`); izolacja i tak
  jest sprawdzana na obu originach dla localStorage/sessionStorage, a ciasteczko po scrubie znika.
- `form.html` po pustym submicie mówi „Niepoprawnych pól: 4" (name, email, description, consent); próbka DESIGN §5.1
  („3") pochodzi z demo z trzema polami — `bench/task.mjs` nie asertuje licznika.
- `report.files` dla pdf: `pdf-<name>` (nie `pdf`) — dwa pdf-y w jednym flow nie nadpisują klucza.
- Scrub wykonuje się leniwie na początku następnego `runFlow` (`lane.dirty`), więc w kolejce keepera `queuedMs` nie
  zawiera scrubu, chyba że keeper wywoła `engine.scrub(lane)` po odpowiedzi (wtedy `runFlow` nic nie szoruje).
- Nowy `serviceWorkerBlocked` w raporcie (prośba WP4): rejestrator ustawia `serviceWorkerSeen` przy żądaniu
  `resourceType === 'serviceworker'` albo linii konsoli/pageerror z `ServiceWorker`; silnik podaje flagę tylko na
  kontekście blokującym (lane scratch).
- Snapshot w batchu bierze `ariaSnapshot({ mode: 'ai', boxes: true })` (te same refy co bez boxów — WP3 fakt 5) i
  pisze trzy pliki sekwencją z WP3 (`walkInteractive` → `boxJoin` → `maskSnapshotEntries`/`maskSnapshotValues`);
  `snap.full.yml` też przechodzi przez maskowanie wartości wrażliwych.

## Prośby do innych pakietów

- **WP1 (`types.d.ts`)**: `Report.serviceWorkerBlocked?: boolean` (jak prosił WP4); `RecorderLike` może przyjąć pola
  z `Recorder` (`recorder.mjs`), żeby `bodies`/`sinceLast` nie były opcjonalne — silnik i testy używają typu `Recorder`.
- **WP5**: nic do zmiany — `createEngine(browserOpts, hooks)`, `ready`, `status()`, `finishRun`, `on('disconnected')`
  są zgodne z `keeper.mjs`; `laneOpts.address` i `laneOpts.config.auth` są honorowane. Jeśli keeper chce scrub w
  `queuedMs` (DESIGN §6 `bi-warm-tight`), po odpowiedzi klientowi niech woła `engine.scrub(lane)` w kolejce lane'u.
- **WP6**: lista wyżej; `test/smoke/smoke.test.mjs` i `fixture-server.mjs` są do rozszerzenia o część sesyjną
  (porty 4503–4519 wolne).
- **WP7**: `runFlow` z `laneOpts.storageState` albo `snapshot.storageState` / `config.auth` idzie w `fresh`
  (`needsFreshContext`), kontekst z `storageState` jest tworzony poza pulą `spare`.
- **WP8**: `test/compat/smoke-gate.test.mjs` może serwować buildy app-factory `startFixtureServer(port, { root })`
  (ma mapę MIME z `.js → text/javascript`); `FlowResult.files` to ścieżki absolutne.
- **WP9**: `report.json.timing` ma wszystkie pola §6; `scrubMs` jest w przebiegu, który szorował (drugi i kolejne).
