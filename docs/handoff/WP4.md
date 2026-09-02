# Handoff WP4 → WP2, WP5, WP6, WP8, WP9 — raport, manifesty, JUnit, eksport

WP4 dostarczył `src/report.mjs` i `src/session-log.mjs` z testami `test/report.test.mjs`,
`test/export.test.mjs`, `test/junit.test.mjs` (39 testów, bez przeglądarki). Próbka `report.md`
z DESIGN §5.1 renderuje się **co do znaku** i kosztuje **187 tokenów o200k** (test pilnuje ≤ 200
i dokładnie 187). Zielone: `npx vitest run packages/browser-inspector/test/{report,export,junit}.test.mjs`,
`prettier --check` na plikach WP4, `tsc --noEmit` bez błędów w plikach WP4 (18 błędów w drzewie leży w
`engine.mjs`, `recorder.mjs`, `steps.run.mjs`, `test/recorder.test.mjs`, `test/keeper.test.mjs`,
`test/fixtures/keeper-harness.mjs` — WP2/WP5), `CODE-INDEX.md` zregenerowany (`node scripts/index-code.mjs`).

**Druga runda WP4 (po sprawdzeniu kodu WP2):** `runFlow` zwraca gotowy `Report`, więc `elements.md` / `text.txt`
nie miały producenta na tej ścieżce — dodany `artifactFiles(report)` i wyprowadzanie w `writeArtifacts` (sekcja niżej).
Reszta bez zmian.

**Prośba (plik współdzielony, nieedytowany przez WP4):** do `CHANGELOG.md` sekcji `Unreleased` dopisać:
`- WP4: raport i artefakty — buildReport/renderReportMd (§5.1, 187 tokenów na próbce; ## steps tylko przy FAIL,
## verify tylko przy soft FAIL, nagłówek warunkowy), renderElementsMd, renderJUnit, buildManifest/buildSnapshotManifest
(stempel Europe/Warsaw, konwencja read-runtime), writeArtifacts (czeka na zapisy zrzutów przed report.json);
dziennik sesji appendJournal/readJournal i eksport exportFlow/writeFlowExport (refy → selektory, valueFromEnv,
odmowa nadpisania bez --force) (AC-1, AC-7, AC-14).`

**Prośba do WP1 (`src/types.d.ts`):** dopisać do `Report` pole `serviceWorkerBlocked?: boolean` (patrz
„sw=blocked” niżej). Do tego czasu `report.mjs` używa lokalnego typu `BiReport = Report & { serviceWorkerBlocked?: boolean }`.

## `src/report.mjs` — eksporty

`buildReport(input) → { report, files }`, `renderReportMd(report)`, `renderElementsMd(report)`,
`renderJUnit(suite, snapshots)`, `buildManifest(run, results)`, `buildSnapshotManifest(report, snapshot)`,
`writeArtifacts(dir, report, files?, options?)`, `artifactFiles(report)`, `formatStepError(error)`, `failureOf(report)`,
`CAPS` (`console 500`, `failedRequests 100`, `text 20000`, `extract 5000`, `elements 100`, `errorLines 10`),
`SOURCE` (`browser-inspector`), `SCRIPT` (`bi`).

### Co WP2 (`runFlow`) / WP6 ma podać do `buildReport(input)` — kształt `ReportInput`

```js
const { report, files } = buildReport({
  name, startUrl, finalUrl?, title?,
  completed?,              // domyślnie: brak navigationError ∧ wszystkie kroki ok
  navigationError?,        // Error ALBO string — TYLKO gdy nawigacja padła (undefined = sukces); w JSON pojawia się wyłącznie wtedy
  steps: [{ index, description, ok, ms?, error? }],   // error: Error albo string — buildReport normalizuje do `Error: …` (formatStepError)
  skipped,                 // liczba kroków pominiętych po porażce (stare `steps` = tylko wykonane)
  extracts: { 'numer-zgloszenia': 'ALM-1001' | { value, truncated } },   // string wystarczy; > 5000 znaków → files['values/<name>.txt'] + truncated w JSON
  verifications: [{ index, kind, ok, soft, detail? }],
  console: recorder.console, consoleTotal: recorder.consoleTotal, pageErrors: recorder.pageErrors,
  network: recorder.network, networkTotal: recorder.networkTotal,   // failed = failure !== undefined ∨ status ≥ 400 (failure: 'HTTP 404')
  dialogs: recorder.dialogs, tabs: recorder.tabs,                  // popupy PRZED scrubem (report.json.tabs[])
  screenshots: ['walidacja.png', 'potwierdzenie.png'],             // nazwy plików w katalogu snapshotu; 'final.png' / 'page.png' też tu
  text,                    // pageText — cap 20 000 tu (text.txt = to samo, capowane)
  elements, elementsTotal?, captureElements?,   // [{ kind, name, selector, href?, disabled? }]; captureElements:false → bez elements.md i bloku
  timing: { mode, ctx, tab, lane, queuedMs, scrubMs, gotoMs, stepsMs, captureMs, writeMs, totalMs, cacheHits, cacheHitsDocument },
  engine: { bi, 'playwright-core', browser, flags, motion, serviceWorkers, generation },
  final?,                  // nazwa zrzutu, który był OSTATNIM wykonanym krokiem przy sukcesie ('koszyk.png') → nagłówek `final: koszyk.png`
  serviceWorkerBlocked?,   // true, gdy rejestrator widział próbę rejestracji SW na kontekście z serviceWorkers:'block' → nagłówek `sw=blocked`
  files?,                  // dodatkowe rodzaje artefaktów → nazwy plików, np. { snapshot: 'snap.md' } → stopka `more:` je wymienia
});
// files = { 'elements.md': …, 'text.txt': …, 'values/<name>.txt': … } — teksty do zapisania obok report.json
```

`formatStepError`: `new Error('uczen widzi…')` → `Error: uczen widzi…`; `TimeoutError` zachowuje nazwę
(`TimeoutError: Timeout 8000ms exceeded.`, pierwsza linia); string `Error: …` z CDP zostaje; goły string
dostaje prefiks `Error: `. **WP2**: wynik `Runtime.evaluate` z wyjątkiem podaj jako string
`exceptionDetails.exception.description` obcięty do pierwszej linii — buildReport nie doda drugiego prefiksu.

### Nagłówek `report.md` — kiedy pojawiają się flagi

`# <name> — OK 18/18 · 446 ms · warm reused` — `mode ctx` z `timing` (więc `fallback reused` przy fallbacku,
`no-daemon reused` w CI). Dalej, tylko gdy zachodzą, w tej kolejności: `tab new` (`timing.tab === 'new'`),
`motion=reduce` (`engine.motion`), `sw=blocked` (**`report.serviceWorkerBlocked === true`**, NIE samo
`engine.serviceWorkers === 'block'` — próbka §5.1 ma `block` w JSON i brak flagi w nagłówku, więc flaga
na każdym reużytym lane byłaby szumem; WP2/rejestrator ustawia ją, gdy widzi żądanie `resourceType === 'serviceworker'`
albo `pageerror`/`console.error` z `ServiceWorker` na kontekście blokującym), `final.png` (gdy `screenshots`
zawiera `final.png` — porażka albo `finalScreenshot: 'always'`), inaczej `final: <nazwa>` (gdy `input.final`).
`gen=<n>` z §2.3 NIE jest w nagłówku (kosztowałby tokeny na każdym raporcie; jest w `report.json.engine.generation`).

Licznik `ok/total`: `total = steps.length + skipped`, `ok` = kroki z `ok: true`; przy `type: page` (0 kroków)
bez licznika. Druga linia: `<startUrl>[ → <finalUrl jako ścieżka na tym samym originie>] "<title>" · console N[ (k err)]
· net M[ (f failed)][ · shots a.png b.png]`. `## errors`: `- navigation …`, `- pageerror …`, `- console.error …`,
`- POST /api/x → 404` (do 10 na rodzaj, reszta liczona). `## values`: jedna linia, wieloliniowe w płotkach,
> 5000 → `name: values/name.txt (5 000+ chars)`. `## verify` tylko miękkie FAIL. `## steps` tylko `completed:false`:
dwa kroki przed nieudanym, nieudany (`- FAIL 10. <opis> — Error: …`), `- skipped 11–16`. Stopka
`more: elements.md (21) · text.txt[ · snap.md] · report.json`.

### `writeArtifacts(dir, report, files, options)` — kolejność zapisu

1. `mkdir -p dir`; 2. **równolegle** pliki z `files` (`string | Uint8Array | Promise<…>` — zrzut z CDP może być
obietnicą bufora; podkatalogi jak `values/` tworzone) **i** `options.pending` (obietnice zapisów zrzutów zakolejkowane
przez `capture.pending`); 3. dopiero potem `report.json`, `report.md` (wg `options.render`, domyślnie oba),
`_manifest.json` (gdy `options.manifest = { type, url, stamp, version, startedAt?, render? }`).
`options.redact(text)` przechodzi przez każdy tekstowy artefakt, `report.md` i `report.json` — WP2 podaje
`ctx.redact`. Zwraca `{ written: string[], ms }` (`ms` → `timing.writeMs`, jeśli silnik chce; `timing` w raporcie
jest już zapisany, więc WP2 mierzy `writeMs` własnym stoperem wokół wywołania albo podaje szacunek).

**Ścieżka, którą faktycznie idzie WP2 (`runFlow` zwraca gotowy `Report`, nie `ReportInput`):** `writeArtifacts`
sam wyprowadza tekstowe artefakty z raportu przez `artifactFiles(report)` — `elements.md` (gdy `report.elements`
istnieje), `text.txt` (gdy `report.text.content` niepusty), `values/<name>.txt` dla każdego `extracts[name].truncated`
(głowa, którą trzyma JSON) — i dopisuje `report.files.elements = 'elements.md'` / `report.files.text = 'text.txt'`
(mutacja `report.files`, celowo: stopka `more:` i `report.json.files` mają nazywać to, co leży na dysku). Wpis podany
jawnie w `files` wygrywa nad wyprowadzonym; `options.derive: false` wyłącza wyprowadzanie. Wołający (WP5 `runInProcess`
/ keeper WP5 po `engine.runFlow` / WP8) robi więc tylko:

```js
const report = await engine.runFlow(snapshot, dir, laneOpts);          // WP2: zrzuty i pending już na dysku
await writeArtifacts(dir, report, {}, {
  redact: (t) => redact(t, secretValues),
  manifest: { type: snapshot.type, url: snapshot.url, stamp, version, startedAt },
});
```

`buildReport(input)` zostaje dla wołających, którzy mają luźne dane (testy, `bi script`, WP6) — jego `files`
niesie CAŁE wartości > 5000 znaków, czego `artifactFiles` z gotowego raportu odtworzyć nie może.

### Manifesty i JUnit (WP5 klient / WP8 bramka / WP9 budget)

`buildManifest({ stamp?, config, version, startedAt?, timing: { mode, keeperStartMs?, launchMs?, clientMs } },
[{ name, report, dir }])` → `{ stamp, config, version, source, startedAt, finishedAt, timing, snapshots: [{ name,
completed, dir, ms, ctx, tab, lane, queuedMs, scrubMs, cacheHits, failure? }] }` — `failure` z `failureOf(report)`:
`navigationError` albo `step 10 "<opis>" — Error: …`. Bez `stamp` → `formatStamp(new Date(startedAt))` (Europe/Warsaw,
`YYYY-MM-DD_HH-MM`, ta sama funkcja co w `cli.mjs`). **WP9** czyta `snapshots[].{queuedMs,scrubMs,cacheHits}` i
`timing.mode` stąd oraz `report.json.timing` per snapshot.

`buildSnapshotManifest(report, { type, url, stamp, version, startedAt?, render? })` → koperta read-runtime
(`snapshot`, `name`, `source: 'browser-inspector'`, `stamp`, `runStartedAt`, `runFinishedAt`, `render`,
`tooling: { script: 'bi', version }`) + `type`, `url`, `completed`, `screenshots`, `timing`, `failure?`.

`renderJUnit(suite, [{ name, completed, ms?, failure?, dir? }])` — `suite` = basename configu; `<testsuites name="bi">`,
`classname="bi.<suite>"`, `<failure message="…">` dla nieukończonych, `<system-out>` z katalogiem gdy podany.
**WP5**: `--junit f.xml` = `renderJUnit(path.basename(configPath), manifest.snapshots)` (kształt zgadza się 1:1).

## `src/session-log.mjs` — eksporty

`appendJournal(file, entry, { secretValues })`, `readJournal(file)`, `normalizeEntry(entry, secretValues)`,
`exportFlow(entries, { name?, file?, secretValues? }) → { config, count, skipped }`, `writeFlowExport(file, config, { force })`,
`flowNameFrom(file)`, `journalPath(sessionDir)`, `JOURNAL_FILE`, `ExportError` (`.code: 'E_EXPORT' | 'E_EXISTS'`, `.exit === 2`).

### Co WP6 zapisuje po każdej komendzie sesji

```js
appendJournal(journalPath(session.dir), {
  command: 'click',                  // nazwa albo alias — normalizowana do kanonicznej ('open' → 'goto')
  step,                              // krok w kształcie configu z parsera (z `ref`, z `valueFromEnv` — NIGDY z rozwiązanym sekretem)
  ok, ms, url, title,                // stan po komendzie
  selector: '[data-testid=…]',       // dla `step.ref`: selektor rozwiązany PRZY AKCJI (`locatorFor`, WP3) — bez niego eksport tego kroku rzuca
  resolved: { 'fields[1].ref': '#email', from: '#card-1', to: '#drop' },   // dla form.fields[k].ref i drag.from/to (targety będące refami)
  line,                              // linia stdout (redagowana)
  error,                             // przy FAIL
}, { secretValues: ctx.secretValues });
```

Zapis synchroniczny (`appendFileSync`), `seq` nadawany z liczby linii, `at` ISO, `description` z `describeStep`;
pole `value` obok `valueFromEnv` jest usuwane (także w `fields[]`), całość przez `redactDeep`.

### `bi export` (WP5 klient → keeper WP6)

```js
const entries = readJournal(journalPath(session.dir));
const { config, count, skipped } = exportFlow(entries, { file, secretValues });
writeFlowExport(file, config, { force });          // E_EXISTS bez --force → exit 2
lines.push(formatExport(count, relPath(file, cwd)));   // print.mjs: `ok export 9 steps → flows/koszyk.json (refs → data-testid/#id/role=)`
```

Reguły eksportu: pierwsze udane `goto` → `snapshots[0].url` (+ `waitUntil`), kolejne `goto` → kroki; kroki z `ok:false`
pomijane; `batch:false` (find, console, net, tabs, routes, locator, trace, video, run, close) i `snapshot`,
`dialog` bez polityki, `eval --file` → `skipped[{ seq, command, reason }]`; pola sesyjne usuwane (`screenshot.mark`,
`goto.video`); nazwy wymagane w batchu wymyślane (`shot-1`, `extract-1`, `eval-1`, `pdf-1`), duplikaty rozwiązywane;
wynik przechodzi `validateSteps(mode:'batch')` i `redactDeep`. Ref bez selektora = `ExportError` (test negatywny),
nigdy cichy zapis refa. `parseConfig(config)` i `loadConfig(plik)` przechodzą (test).

## Odstępstwa i decyzje do wiadomości innych WP

- `sw=blocked` sterowane polem `report.serviceWorkerBlocked`, nie `engine.serviceWorkers` (uzasadnienie wyżej).
- `gen=<n>` nie trafia do nagłówka `report.md` (jest w JSON).
- `report.json.files` = `{ elements: 'elements.md', text: 'text.txt', snapshot?: 'snap.md', … }` — mapa rodzaj → plik
  (jak w starym `WebReport.files`), nie lista.
- `report.json.network.failed[]` niesie pełne `NetEntry` + `failure` (`HTTP 404` dla statusów ≥ 400); stary kształt
  `failedRequests.entries[{ url, failure }]` jest utrzymany obok.
- `values/<name>.txt` powstaje dla wartości > 5000 znaków (JSON trzyma pierwsze 5000 z `truncated: true`).
- `renderElementsMd` renderuje listę linii (`1. button "Wyślij" [data-testid="submit"]`), nie tabelę markdown ze
  starego raportu — plik jest osobny i czytany w całości, tabela kosztowała tokeny na ramkę.
- JUnit: `<testsuites name="bi">` / `classname="bi.<config>"` zamiast `skryba` — nazwa narzędzia się zmieniła.
- PLAN mówi „`## verify` z wierszami FAIL” — wiersz to `- FAIL <opis kroku> — <detail>`, gdzie `detail` podaje runner
  `verify` (WP2), np. `expected "1", got "0"`.
