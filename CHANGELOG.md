# Changelog

Format: [Keep a Changelog](https://keepachangelog.com/pl/1.1.0/), wersjonowanie SemVer.
Wpisy odwołują się do kryteriów `AC-n` z `docs/ACCEPTANCE.md` i pakietów `WPn` z `docs/PLAN.md`.

## Unreleased

### Changed

- Domyślny katalog wyników to **`.scribe-devtools/`** (było `.scribe/`): `DEFAULT_OUTPUT_DIR`
  = `./.scribe-devtools/browser-inspector`, sesje w `.scribe-devtools/browser-inspector/session/<nazwa>`,
  ostrzeżenie `auth` o pliku sesji poza `.scribe-devtools/`; fixture, szablon flow, README, DESIGN,
  `.gitignore`/`.prettierignore` i testy przepisane. Jawny `outputDir` w configu (np. app-factory:
  `./.scribe/browser-inspector`) działa jak dotąd — to reguła dla wartości domyślnej.
- **Zip wydanej wersji jest zamrożony**: gdy istnieje tag `v<wersja>` i plik w `download/`, hook
  i `npm run portable` nie przebudowują go (`isFrozen`, komunikat „wersja … jest wydana”); nowy kod
  wymaga podbicia wersji, `--force` przebudowuje mimo to. Zip 0.1.0 przywrócony do bajtów z wydania
  (sha256 `81b2ce52…`, identyczny z assetem Release'a).
- Zip portable jest **śledzony w repo**: `download/scribe-devtools-portable-<wersja>.zip` + sidecar
  `.sha256` (format `sha256sum`), budowany przez hook pre-commit po `CODE-INDEX.md` i `docs/STEPS.md`
  oraz przez `npm run portable`; każda wydana wersja zostaje w `download/`. Build jest
  deterministyczny (własny zapis zipa w Node: stały znacznik czasu, posortowane wpisy, deflate 9,
  bez pól extra — bsdtar i `zip` zapisują atime/ctime, więc dwa buildy się różniły), dzięki czemu
  niezmieniony pakiet nie dokłada bloba do historii; `zipEntries` czyta katalog centralny bez
  zewnętrznego `tar`. Wersja pochodzi wyłącznie z `packages/browser-inspector/package.json`, a build
  odmawia, gdy korzeń podaje inną (`readVersion`). Testy: determinizm (dwa buildy → jeden hash),
  `buildPortable` z `changed`, separatory `/`, round-trip zip → unpack → `bi help`.

## 0.1.0 — 2026-09-02

Pierwsze wydanie: `bi` (browser-inspector 2) — zamiennik serwera MCP Playwrighta. Bench: bi-warm 358 ms vs MCP naive warm 3871 ms (10,8×), tokeny 400 vs 6814 na sesję; szczegóły w `bench/RAPORT.md`. Otwarte: AC-5 (bi-cold 2,08 s > 1,75 s), AC-6 na limicie (400 tokenów).

Zip portable pakuje bsdtar (`tar -a -cf`), nie `Compress-Archive`: cmdlet zapisywał nazwy wpisów z backslashami (157 ze 160 w pierwszym buildzie 0.1.0), przez co archiwum rozpakowywało się na Linuksie/macOS do płaskich plików; test round-trip sprawdza teraz separatory (`zipEntries`).

### Added

- WP0 — szkielet repozytorium: workspaces `packages/*` + `bench`, `packages/browser-inspector`
  (`bin: bi`, `playwright-core` przypięty exact 1.62.1, engines ≥ 22), `bench` (`@playwright/mcp`
  exact 0.0.80, `gpt-tokenizer`), `vitest.config.mts` z projektami unit/scripts/bench/smoke/compat
  (perf opt-in przez `BI_PERF=1`), `tsconfig.json` (`checkJs`, `noEmit`, NodeNext), hook
  `.githooks/pre-commit` (CODE-INDEX.md + docs/STEPS.md), skrypty `index-code` (port ze scribe
  na drzewo `.mjs`, z importami dynamicznymi), `portable-zip` (marker `PORTABLE`, shimy `bi`/`bi.cmd`,
  bez builda), `check-instruction-sync` (blok AGENTS.md ≡ `INSTRUCTION` benchu, limit 150 tokenów
  — AC-6, AC-18), `gen-steps-doc` (szkielet; AC-20), `AGENTS.md` z instrukcją dla agenta
  (146 tokenów o200k), `README.md`, `CLAUDE.md`, `bench/probes/README.md`.
- WP1: kontrakty i moduły czyste — STEPS (45 kroków), parseArgs, loadConfig/lintConfig, paths
  (identityHash, pipeName, isCI, daemonEnabled), print, redact, scrubPlan/needsFreshContext/GEN_SCRIPT,
  withDeadline, types.d.ts; docs/STEPS.md generowany (AC-8, AC-12, AC-14, AC-16, AC-20).
- WP2: silnik batch — createEngine (chrome → msedge, E_BROWSER_MISSING z listą prób), lane'y scratch
  z jedną trwałą kartą szorowaną w miejscu (applyScrub 1:1 z scrubPlan, 5–10 ms/origin), spare prewarm,
  runFlow (kroki pod withDeadline, dowód końcowy, report.json/md + _manifest.json), finishRun (manifest
  przebiegu, JUnit), zdrowie (crash → nowa karta, disconnected, recykling BI_MAX_JOBS/RSS); rejestrator
  (since-last, ciała ≤ 64 KB, cacheHits, tabs[], sw=blocked); settled; CDP-zrzuty; evaluate przez
  Runtime.evaluate z mapowaniem wyniku; RUNNERS dla 45 kroków; fixture'y i smoke na prawdziwym Chrome
  (AC-1, AC-7, AC-9, AC-11, AC-13, AC-15, AC-16).
- WP3: snapshot i refy — parseSnapshot, compactSnapshot/compactLines (952 → 41 linii, fold powtarzalnych
  rodzeństw), boxJoin (sidecar snap.json, 139/139 na bookstore), findInSnapshot (≤ 10), diffSnapshot,
  aroundRef, namesContext (--names, ≤ 60 znaków), locatorFor/locatorForElement/uniqueIn, walkInteractive,
  resolveRef (aria-ref literalnie, count() → jeden pełny snapshot → FAIL bez czekania); fixture'y
  bookstore/wizard z prawdziwego Chrome (AC-9, AC-10).
- WP4: raport i artefakty — buildReport/renderReportMd (§5.1, 187 tokenów na próbce; ## steps tylko
  przy FAIL, ## verify tylko przy soft FAIL, nagłówek warunkowy), renderElementsMd, renderJUnit,
  buildManifest/buildSnapshotManifest (stempel Europe/Warsaw, konwencja read-runtime), writeArtifacts
  (czeka na zapisy zrzutów przed report.json); dziennik sesji appendJournal/readJournal i eksport
  exportFlow/writeFlowExport (refy → selektory, valueFromEnv, odmowa nadpisania bez --force)
  (AC-1, AC-7, AC-14).
- WP5: keeper (lock O_EXCL, nasłuch przed silnikiem, token, NDJSON bez env, kolejki lane:<n>/session:<name>
  z queuedMs, idle 30 min, TTL sesji, recykling, status/doctor, log bez sekretów), klient (spawn → retry →
  fallback tylko dla batchu, resolveValues/secretValues/files w kliencie, kody wyjścia), bin/bi.mjs bez
  playwright-core; test/hooks/trace-loads.mjs (AC-8, AC-12, AC-13, AC-14).
- WP6: sesja interaktywna — runCommand (jedna linia ≤ 160 znaków / ≤ 40 tokenów z deltami navigated /
  dom Δ / el a→b / +N console.error / +N net failed / dialog), sesje po nazwie na własnym kontekście,
  open z snap.md/json, find/snap (--max 25, --diff, --around, --grep, --names, --all), console/net od
  ostatniego wywołania, net <n> --body/--req, fetch, frame jako zakres CSS, tabs/tab z popupami, dialog
  wg polityki z beforeunload auto-accept, shot --mark, eval --file/--el z eval-NNN.txt, locator, trace,
  video (open --video), run --file tylko pod BI_UNSAFE=1 (exit 2), close, dziennik journal.jsonl
  z selektorem rozwiązanym przy akcji, export, runScript (bi script, adresy script[n]), fixtures/tabs.html,
  smoke sesyjny przez keepera (AC-8, AC-9, AC-14, AC-15).
- WP7: auth i storageState — ensureSession (logowanie formularzem RAZ przez RUNNERS silnika na świeżym
  kontekście z serviceWorkers 'allow', OAuth password/client_credentials na tokenUrl albo Keycloak →
  storageState zbudowany ręcznie + meta z ważnością tokenu, reuse pliku wg maxAgeMinutes i expires_in/exp),
  storageStateFor (auth: false = widok anonimowy), AuthError E_AUTH bez wartości sekretów; fixture'y
  login.html i kc-token.mjs; smoke: login raz → dwa snapshoty zalogowane, trzeci anonimowy (AC-11, AC-14).
- WP8: zgodność, docs, pakowanie, app-factory — `test/compat/smoke-gate.test.mjs` (bramka app-factory
  przez `bin/bi.mjs` na buildach z `../app-factory`: `--no-daemon`, keeper dwa razy z rzędu — drugi
  przebieg dowodzi scrubu: `dziennik-uczen` completed, `naglowek-pl` po polsku — `--parallel 3`
  z identycznym zbiorem completed, `report.json` identyczne modulo timing/engine, forma
  `Error: uczen widzi przycisk nauczyciela` w `steps[].error`, `navigationError` tylko przy padniętej
  nawigacji, `bi lint-config` z trzema sugestiami; AC-1, AC-2, AC-16, AC-17), `scripts/portable-zip.test.mjs`
  (staging portable → `bi help`, `bi lint-config` i batch `--no-daemon` z rozpakowanego drzewa bez npm,
  zip → rozpakowanie → `bi help`; AC-20), `templates/flow.md` (port szablonu ze scribe na nową
  gramatykę: sesja → eksport, `auth`, `verify`, `parallel`), README (instalacja, `pnpm bi`, batch, sesja
  z próbkami stdout, `bi up` jako hook SessionStart, `bi doctor`, co browser-wide nie jest czyszczone,
  ACL `%TEMP%`, CI, migracja ze scribe), AGENTS.md (bramki, artefakty generowane, punkty synchronizacji
  z app-factory, procedura wydania z bramką app-factory), wpisy CHANGELOG WP1–WP7; integracja app-factory
  (drzewo robocze, bez commitu): `findRunner(env, exists, root)` w `tools/scripts/smoke-browser.mjs`
  (`SCRIBE_DEVTOOLS_DIR` → `../scribe-devtools` → scribe przez niezmienioną `findScribeDir`, `fixCommand`
  zamiast stacktrace'u), przypadki `findRunner` w spec, skrypt `"bi"` w package.json, dwa zdania
  w AGENTS.md; bramka `pnpm smoke:browser` zielona z `CI=true` i z keeperem dwa razy z rzędu (AC-1).

### Fixed

- Weryfikacja końcowa: `--disable-gpu-compositing` dołączone do domyślnych flag headless
  (`FAST_HEADLESS_ARGS`, opt-out `fastHeadless: false`). Trace Chrome 152 pokazał, że sekundę po każdym
  `load` opóźnione zadanie z `blink/.../widget_base.cc` zwalnia LayerTreeFrameSink renderera
  (`ProxyMain::Stop` → `SetLayerTreeFrameSink`), a runda do procesu GPU blokuje wątek główny na
  80–490 ms; ciepły przebieg startujący 300 ms po poprzednim trafiał dokładnie w to — mediana `bi-warm`
  746 ms wobec 355 ms `bi-warm-tight` (iloraz 5,06× na styku progu). Kompozycja programowa nie ma czego
  zwalniać; WebGL działa (nowiro w bramce compat), goto/click/zrzut bez zmian (16–48 ms). Diagnoza i
  sondy: `docs/handoff/FINAL.md` (AC-3).
- `--no-daemon` / CI / fallback kończyły się do 2 s po zapisaniu raportu: zegary-capy w `recorder.mjs`
  (`BODY_READ_MS`, przegrane w `Promise.race` z odczytem ciała i `settle()`) trzymały pętlę zdarzeń, aż
  `bin/bi.mjs` wymusił wyjście po 2 s (`bi-cold` 3 257 ms, z czego ~1,5 s bezczynnego czekania na trzy
  skończone odczyty). Zegary są `unref()` — proces wychodzi z chwilą zapisania raportu, a przy prawdziwie
  wiszącym odczycie pipe przeglądarki i tak trzyma pętlę, więc cap dalej działa (AC-5).
- `test/session.test.mjs`: asercja `net --all --tail 1` toleruje `0|1 ms` jak wcześniejsza w tym samym
  teście — tik zegara między `request` a `requestfailed` nie jest porażką.
- Przegląd kodu (20 uwag, `docs/handoff/FIX.md`): keeper — silnik, który nie wstał (`E_BROWSER_MISSING`,
  brak modułu), to wyjątek `EngineUnavailableError` zamiast linii `done` w slocie wyniku zadania; batch
  odpowiada `FAIL E_BROWSER_MISSING: …` z listą prób (także `--no-daemon`), sesja `FAIL keeper: engine
unavailable`, a `serve()` ma `try/catch/finally` — każde żądanie dostaje linię `done` i zamknięte gniazdo;
  klient ma stróża `BI_REQUEST_TIMEOUT_MS` (10 min bez linii z keepera → batch w procesie, sesja `exit 2`)
  (AC-12, AC-13).
- Sekrety per SESJA (§2.6): `Session.secretValues` to suma `secretValues` wszystkich komend od `open`;
  `get --value`, `eval`, `snap.md/json/full.yml`, `console/net.jsonl`, dziennik i eksport redagują tę sumę,
  keeper redaguje linie sesji zbiorem wszystkich sekretów procesu (AC-14).
- `auth` z configu jest WYKONYWANE: keeper (i `engine.runBatch`) wołają `ensureSession` raz przed
  lane’ami, każdy snapshot poza `auth: false` dostaje `storageStateFor` (`laneOpts.storageState`); porażka
  logowania to `FAIL E_AUTH: …` z `exit 2` bez ani jednego anonimowego przebiegu; smoke przez `bin/bi.mjs`
  (`--no-daemon` i keeper dwa razy: jedno logowanie, `login-count` 1) (AC-11).
- Recykling przeglądarki tylko przez keepera i tylko między zadaniami: `runFlow` nie recyklinguje (zamykał
  przeglądarkę pod innymi lane’ami `--parallel`), keeper wymaga pustej kolejki, zera sesji i wolnych
  lane’ów, należny recykling czeka (`recycle deferred: N sessions open`) i wykonuje się po `bi close`;
  `closeBrowser()` kończy sesje jawnie. RSS: pidy przeglądarki i rendererów z `SystemInfo.getProcessInfo`
  (playwright-core 1.62 nie ma `browser.process()` dla kanału), próbka `tasklist`/`ps` w tle co 10 zadań po
  odpowiedzi (`engine.sampleRss()`, jedna komenda dla wszystkich pidów), `status()` zwraca cache — nigdy
  proces na ścieżce zadania (AC-12).
- Scrub: każda operacja pod `withDeadline(BI_SCRUB_OP_MS = 2000)`; timeout = zawieszony renderer → plan
  liczony ponownie jako `crash` (nowa karta, `timing.tab = new`), lane nigdy nie wisi; `DOMStorage.clear`
  (mierzone zawieszenia ~500 ms w 1 scrubie na 3–5) zastąpione `Runtime.evaluate` w stronie (~1 ms); `scrub()`
  zwraca koszt każdej operacji (`ops`), wolne trafiają do logu. Keeper wykonuje scrub **po odpowiedzi w
  kolejce lane’u** (`afterAnswer`), więc `bi-warm` ma go poza stoperem, a `bi-warm-tight` płaci jako
  `queuedMs` (§2.3/§6); `runFlow` scrubuje tylko brudny lane (siatka bezpieczeństwa, między snapshotami
  jednego batchu). BUDGET dzieli wiersz na `queuedMs` i `scrubMs`.
- Rejestrator: ciała tylko JSON/`text/plain|html|xml|csv|markdown` (bundle JS/CSS z app-factory — 840 KB na
  snapshot — już nie przechodzą przez pipe), `content-length` > 64 KB i `text/event-stream` pomijane PRZED
  odczytem, każdy odczyt i `settle()` ograniczone `BODY_READ_MS` (2000) — raport zawsze się zapisze; powód w
  `NetEntry.bodySkipped`, `bi net <n> --body` drukuje `(no body captured: <powód>)`.
- Lock/pid: zapis atomowy (`tmp` + `link`), holder „żywy” wg `kill(pid, 0)` uznany za stary, gdy plik ma
  > 5 s i nie odpowiada na pipe (pid z recyklingu po restarcie); `bi stop`/`bi status` bez keepera nazywają
  > stary plik pid. `BI_UNSAFE` wchodzi do hasha tożsamości — keeper `unsafe` to osobny proces.
- `form`: para `<cel>=<wartość>` dzielona na pierwszym `=` poza nawiasami i cudzysłowami
  (`[data-testid=field-name]=Jan`, `input[name="q"]=x`, `e5=a=b`).
- `paritySummary` (RAPORT.md): komórki z `\|` nie przesuwają kolumny statusu — 23 ✅ · 1 ⚠️ · 2 ❌ na 27 wierszy
  (było 11 ✅), test na prawdziwym DESIGN.md.
- Zapisy poza stoperem: `_manifest.json` i JUnit przez `fs.promises` równolegle (przed `done`), dziennik i
  `console/net.jsonl` sesji na łańcuchu per sesja czekanym tylko przez `close`/`export`.
