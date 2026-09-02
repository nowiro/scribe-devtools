# browser-inspector 2 — projekt (docs/DESIGN.md), wersja po dwóch recenzjach

Repozytorium: `D:/github/scribe-devtools` (workspace `packages/browser-inspector`, bench w `bench/`), binarka `browser-inspector`. Proza po polsku, identyfikatory i komentarze w kodzie po angielsku. Wersja **finalna po dwóch recenzjach adwersarialnych**: każdy bloker został wchłonięty albo odrzucony z uzasadnieniem w §11. Największa zmiana: model izolacji batchu (§2.3). Recenzje wykazały, że scrub kontekstu wpadał do stopera następnego wywołania; sonda rewizyjna wykazała, że proponowany przez recenzentów ping-pong dwóch kart kosztuje więcej niż problem, który rozwiązuje (goto na świeżej karcie 215–243 ms vs 49–74 ms na tej samej). Rozwiązanie: **jedna trwała karta, szorowana w miejscu** (CDP `DOMStorage.clear` + skrypt generacji + `Page.resetNavigationHistory`), scrub ≈ 12–35 ms.

**Skąd liczby.** Trzy źródła: tabela właściciela (Chrome headless, statyczny Angular; node 72, import playwright-core 250, launch 440, newPage 122, goto fresh 289 / cached 49, click 44, screenshot 90, close 178), sondy projektowe z 2026-09-01 rano (`probe7–11.mjs`, `client-time.mjs`, `pipe-probe2.mjs`) i **sondy rewizyjne z 2026-09-01 po recenzjach** (`probe-tab.mjs`, `probe-tab2.mjs`, `probe-tab3.mjs`, `tok.mjs`; aplikacje app-factory 4311–4314 serwowane kopią `serveStatic` ze `smoke-browser.mjs`; skrypty trafiają do `bench/probes/`). Gdzie źródła się różnią, budżet bierze liczbę **gorszą** (medianę) i nazywa różnicę.

| pomiar (mediany) | wynik |
| --- | --- |
| start `node -e 0` / klient z samymi `node:*` / `import playwright-core` | 44 / 48 (**budżet 72**, właściciel) / 268 ms |
| spawn odłączonego keepera → nasłuch na named pipe · round trip żądanie/odpowiedź | 45 ms · 0,3–1,6 ms |
| `chromium.launch({channel:'chrome'})` · newContext · newPage · newCDPSession | 158–174 (**budżet 300**, pesymistycznie 440) · 8–11 · 63–105 · 1–2 ms |
| goto `load` na **tej samej karcie**, ten sam origin: wizard / bookstore; z `about:blank` po drodze | **49–58 (med 53)** / 62–74 (med 72); bez zmiany (50 / 62) |
| goto `load` na **świeżej karcie** w reużytym kontekście (stara zamknięta / stara żywa / standby otwarta przed zamknięciem brudnej) | **215–262 / 234–259 / 212–221** — renderer ginie z kartą |
| goto `load` w **świeżym kontekście** (nowa partycja): wizard / bookstore | 190–220 / **441** |
| pierwsze wejście na inny origin na tej samej karcie (4311→4312→4313→4314) | 74–320 ms (2. przebieg: 122 / 74 / 211 / 136) — site isolation, nie cache |
| `networkidle` (ta sama karta): 4311 / 4312 / 4313 / 4314 | 760 / **2 056** / 714 / 666 ms |
| CDP `DOMStorage.clear` (session+local, bieżący origin) · dla innego originu | 1–4 ms, działa · `Frame not found` |
| CDP `Page.addScriptToEvaluateOnNewDocument` (skrypt generacji; wymaga `Page.enable` na tej sesji CDP) add / swap · czyści sessionStorage każdego originu przy pierwszym dokumencie nowej generacji | 1 / 1 ms · potwierdzone (dwa originy wyczyszczone, w tej samej generacji zachowane) |
| CDP `Page.resetNavigationHistory` (history.length 33 → 1) · zamknięcie popupu · pełny scrub kontekstu dla 4 originów | 2 ms · 20 ms · **34 ms** |
| click na Material: bez flag / z `--disable-frame-rate-limit --disable-gpu-vsync` | 45–58 / 25–54 ms (**budżet 44**, właściciel) |
| fill · evaluate · extract · waitFor (render kroku Angulara) · evaluate liczący elementy interaktywne | 7–9 · 1 · 2 · 70–88 · **6** ms |
| zrzut viewportu: PW / CDP `Page.captureScreenshot({optimizeForSpeed})` PNG / JPEG q80 / PW fullPage | 38–44 / 14–30 (**budżet 25**) / 14–29 / 67–88 ms |
| `ariaSnapshot({mode:'ai'})`: wizard / bookstore (47,8 KB, 952 linii) · box-join ref→selektor | 26 / 85 ms · 16 ms, 136/136 |
| CDP `Runtime.evaluate({timeout:200})` na `while(true){}` · `browser.close()` | „Execution was terminated” po ~205 ms, strona żyje · 162–169 ms |
| **tokeny o200k próbek z tego dokumentu** (ten sam tokenizer co bench): `report.md` §5.1 / blok AGENTS.md §8 / linia sesji / linia snapshotu bez–z `--names` / `browser-inspector snap` 25 linii / 40 linii | **187 / 158 / 18–27 / 19–31 / ~370 / ~590** |

**Fakty z `playwright-core` 1.62.1 (coreBundle.js), sprawdzone przed tą wersją:** (a) silnik `aria-ref` = `_lastAriaSnapshotForQuery.info.get(ref)` + `element.isConnected` — rozwiązuje refy z mapy **ostatniego** `ariaSnapshot` w danej ramce, nie z elementu; (b) `ariaSnapshotWithRefs` nadpisuje tę mapę przy **każdym** wywołaniu (dowolny węzeł, dowolny tryb); (c) `computeAriaRef`: element dostaje nowy ref, gdy zmieni się jego `role` **lub** `name`; (d) prefiks `f<seq>` to `frameSeq` dokumentu — `_jumpToAriaRefFrameIfNeeded` kieruje `aria-ref=f3e7` do ramki o `frame.seq === 3`, więc refy z iframe’ów w pełnym snapshocie `ai` rozwiązują się bez przełączania zakresu; (e) `ariaSnapshot` z `selector` i trybem ≠ `ai` idzie w tryb `default`; (f) Chrome startuje z `--remote-debugging-pipe` — brak portu TCP.

---

## 1. Teza

Serwer MCP Playwrighta kosztuje agenta ~4 tys. tokenów definicji w każdej sesji i 500 ms „settle” po każdej akcji (domyślne `--timeout-settle 500` w 0.0.80); stary browser-inspector nie kosztował nic, ale nie umiał „spojrzeć, potem kliknąć”. `browser-inspector` robi jedno i drugie z **jedną tabelą kroków** (`STEPS`) wykonywaną przez **jeden silnik** na playwright-core, do której prowadzą **dwa wejścia**: `browser-inspector <config.json>` (batch, drop-in dla bramki app-factory) i `browser-inspector <komenda>` (pętla interaktywna na refach z publicznego `page.ariaSnapshot({ mode: 'ai' })`). Ciepła przeglądarka żyje w **keeperze** — zwykłym lokalnym procesie Node z named pipe/unix socketem, który startuje sam przy pierwszym użyciu, gaśnie po bezczynności i którego agent nigdy nie widzi: agent dalej uruchamia CLI i czyta pliki, zero schematów narzędzi w kontekście. Zarzut „trwały proces to serwer” dotyczył kosztu definicji i reinwencji MCP; keeper nie płaci ani jednego, ani drugiego.

Liczby, uczciwie: ścieżka ciepła mieści 18-krokowe flow benchu w **546 ms budżetu = 5,3× vs MCP warm 2,9 s** (próg 5× = 580 ms, **margines 34 ms = 6 %**) i 6,6× vs 1. przebieg MCP 3,6 s — ale tylko **1,8× vs `mcp-lean --timeout-settle 100`** (1,0 s), bo dwie trzecie różnicy to domyślna polityka settle serwera, nie architektura; ta kolumna stoi w tabeli nagłówkowej RAPORT.md. Wywołania bez przerwy (`browser-inspector-warm-tight`) płacą scrub poprzedniego przebiegu w kolejce: 561 ms = 5,2×. Ścieżka zimna to **1,47 s** (pierwsze wywołanie w sesji, keeper startuje w stoperze; 2,4×) albo **1,62 s** (`--no-daemon`, CI; 2,2×) — start Chrome jest fizyką, nie architekturą. Tokeny (o200k): batch ≈ **365** na sesję (146 stałe + ~220 zmienne), sesja interaktywna ≈ **550** bez pełnego `browser-inspector snap`, ≈ **950** z jednym, ≈ 1 700 z trzema — wobec 5 549–6 747 MCP.

---

## 2. Architektura

### 2.1 Model procesów

```
agent ──sh──▶ node bin/browser-inspector.mjs <cmd>       klient: node:net/fs/path/child_process/os, 72 ms budżetu, BEZ playwright-core i BEZ steps.run
                 │  NDJSON po \\.\pipe\browser-inspector-<user>-<hash>  (Windows) / $XDG_RUNTIME_DIR|tmpdir/browser-inspector-<uid>-<hash>.sock
                 ▼
        browser-inspector-keeper (src/keeper.mjs)          playwright-core + systemowy Chrome/Edge; jeden na użytkownika × tożsamość (§2.5)
          ├─ scratch[0]     — kontekst batchowy + JEDNA trwała karta, szorowana w miejscu po każdym przebiegu (goto 55 ms)
          ├─ scratch[1..N-1] — lane’y --parallel N: takie same konteksty, tworzone na żądanie, zamykane po 5 min bezczynności
          ├─ spare          — jedna gotowa para kontekst+strona (prewarm) dla --fresh / auth / video
          └─ session:<name> — kontekst + karty + dziennik sesji interaktywnej (klucz = tylko nazwa, §4.5)
```

`--no-daemon` (albo `BROWSER_INSPECTOR_DAEMON=0`, albo automatycznie na CI — §2.5): klient importuje `src/engine.mjs` sam i wykonuje **batch** w procesie — ten sam kod, bez gniazda. To ścieżka bramki CI (`smoke-browser.mjs` pod `CI=true`) i ścieżka awaryjna, gdy keeper nie wstaje. **Komendy sesyjne nie mają fallbacku** (recenzja #2: `browser-inspector open` w procesie kończyłby się zamknięciem przeglądarki, a `browser-inspector click e5` kłamałby „ref not found”): bez keepera kończą się `exit 2` i linią `FAIL keeper unavailable: <powód> — sessions need the keeper (browser-inspector up | doctor); batch: --no-daemon`. Dla CI bez keepera jest `browser-inspector script <plik>` — lista komend sesji wykonana w jednym procesie (§3.1). Test pilnuje identyczności `report.json` z obu ścieżek batchu modulo `timing`/`engine`.

### 2.2 Silnik (`src/engine.mjs` + `lanes` / `steps.ctx` / `flow` / `session`, `src/recorder.mjs`, `src/isolation.mjs`)

`engine.mjs` jest miejscem składania: `lanes.mjs` (przeglądarka i jej lane’y), `steps.ctx.mjs` (kontekst kroku
i `runStep`), `flow.mjs` (połowa batch) i `session.mjs` (połowa sesyjna). Obie połowy dzielą pulę i kontekst
kroku i nic więcej — dlatego `click` w batchu i `browser-inspector click` to ten sam RUNNER.

`createEngine(browserOpts)` → `{ runFlow(snapshot, dir, laneOpts), runCommand(session, step, args), runScript(lines), session(name), scrub(lane), close() }`.

- `launchBrowser()`: `chromium.launch({ channel: 'chrome' | 'msedge', headless, args })` z kolejnością prób i `E_BROWSER_MISSING` z listą prób; `browser.executablePath` / `BROWSER_INSPECTOR_BROWSER_PATH` wygrywa; `BROWSER_INSPECTOR_BROWSER_ARGS` nadpisuje flagi w całości. Domyślne `args` w headless: `--disable-frame-rate-limit --disable-gpu-vsync` (`browser.fastHeadless: false` wyłącza) — dźwignia mierzona osobno, **budżet §6 jej nie zakłada**. `browser.motion: "reduce"` jest opcją (sonda: zero zysku, zmienia aplikację), widoczną w nagłówku raportu jako `motion=reduce`.
- **Rejestrator** (`src/recorder.mjs`): podpięty RAZ na stronę przed nawigacją (`console`, `pageerror`, `request/requestfinished/requestfailed`, `response`, `dialog`, `popup`, `framenavigated`, `crash`); kursory „od ostatniego wywołania” per sesja; przechowuje ciała odpowiedzi ≤ 64 KB dla `application/json|text/*` (`captureBodies: false` wyłącza) dla `browser-inspector net <n> --body`; nigdy nie loguje wartości sekretów (§2.6).
- Każdy krok jedzie przez `withDeadline` (port z wersji TS). `evaluate`/`eval` = CDP `Runtime.evaluate({ expression, returnByValue: true, awaitPromise: true, timeout })` **opięte także `withDeadline`**, bo `timeout` CDP przerywa tylko część synchroniczną — wisząca obietnica kończy się deadlinem kroku (strona żyje). Mapowanie wyniku 1:1 ze starym `page.evaluate(expression)`: `undefined` → literał `undefined`, string → bez zmian, reszta → `JSON.stringify`; wartość nieserializowalna (DOM node) → FAIL kroku z komunikatem CDP; wyjątek → FAIL z `exceptionDetails.exception.description` obciętym do pierwszej linii (`Error: uczen widzi przycisk nauczyciela` — dokładnie forma, którą drukuje dziś bramka; fixture w `test/compat`).
- Zrzuty viewportu: CDP `Page.captureScreenshot({ format, quality, optimizeForSpeed: true })`; `fullPage`, element i nie-Chromium → `page.screenshot`. PNG domyślnie, JPEG opt-in (w CDP nie jest szybszy). Zapis asynchroniczny równolegle z krokami; przed `report.json` keeper czeka na wszystkie zapisy.
- `waitUntil: "settled"` = `load` + 100 ms bez żądań w locie (licznik z rejestratora) + cap `settleMs` (2000, nigdy nie pada). `networkidle` honorowane 1:1.
- **Zdrowie**: `browser.on('disconnected')` ⇒ keeper `exit(1)`; `page.on('crash')` na karcie scratch ⇒ lane `unhealthy`, scrub odbudowuje kartę (close + newPage; `timing.tab = "new"`); po `BROWSER_INSPECTOR_MAX_JOBS` (200) zadaniach albo RSS Chrome > `BROWSER_INSPECTOR_MAX_RSS_MB` (1024) keeper **między zadaniami** robi `browser.close()` + nowy launch (następne wywołanie ma `timing.mode = "first"`).

### 2.3 Konteksty, izolacja, poprawność — jedna karta, szorowana w miejscu

Decyzja wydajnościowa: batch jedzie na **jednym reużywanym kontekście `scratch` i jednej trwałej karcie**. Sonda rewizyjna rozstrzygnęła trzy warianty: (1) ta sama karta: goto 49–74 ms; (2) świeża karta w tym samym kontekście — także standby otwarta przed zamknięciem brudnej, czyli ping-pong z obu recenzji: 212–262 ms, bo renderer ginie razem z kartą; (3) świeży kontekst: 190–441 ms. Wariant (1) to dokładnie przypadek `@playwright/mcp --isolated` (jedna karta, `about:blank` między zadaniami), więc bench jest symetryczny.

`scrubLane(lane)` — plan liczony czystą funkcją `scrubPlan(state)` (`src/isolation.mjs`, testowana jednostkowo), wykonywany **po odpowiedzi do klienta, w kolejce lane’u** (następny klient czeka na jego koniec — czas raportowany jako `timing.queuedMs`, §6) oraz **między snapshotami jednego batchu** (w stoperze przebiegu; recenzja #2: nowiro-jezyk zostawia język w storage, dziennik-nauczyciel — zalogowanego nauczyciela; bez scrubu w środku batchu `dziennik-uczen` pada na `waitFor [data-testid=dashboard-anonymous]`). Kroki i koszt (sonda):

1. zamknięcie stron innych niż karta lane’u (popupy z `context.on('page')`, wcześniej zapisane w `report.json.tabs[]`) — 20 ms/szt., zwykle 0;
2. CDP `DOMStorage.clear` dla bieżącego originu (session + local) — 1–4 ms;
3. **skrypt generacji**: `Page.removeScriptToEvaluateOnNewDocument` + `addScriptToEvaluateOnNewDocument` z nowym numerem generacji (sesja CDP karty ma `Page.enable`): pierwszy dokument każdego originu w nowej generacji robi `sessionStorage.clear()` i zapisuje marker `__bi_gen` — 1 ms; to jedyne, czego `Storage.clearDataForOrigin` nie umie (sessionStorage jest per karta), potwierdzone sondą dla dwóch originów; marker to jeden klucz widoczny dla aplikacji (nagłówek raportu `gen=<n>`; purystom zostaje `isolation: "fresh"`);
4. per odwiedzony origin (z `framenavigated`): CDP `Storage.clearDataForOrigin({ storageTypes: 'cookies,local_storage,indexeddb,cache_storage,service_workers,websql' })` — 1 ms/origin, bez bycia na originie;
5. kontekst: `clearCookies`, `clearPermissions`, `unrouteAll`, `setOffline(false)`, `setExtraHTTPHeaders({})`, `setGeolocation(null)`, `page.emulateMedia({ colorScheme: null, reducedMotion: null, media: null })`, viewport domyślny, polityka dialogów `dismiss`, `setDefaultTimeout/NavigationTimeout` domyślne — razem z 4. dla 4 originów **34 ms**, dla jednego ≈ 12 ms;
6. CDP `Page.resetNavigationHistory` — 2 ms; `back` w następnym przebiegu nie wejdzie do poprzedniego;
7. `serviceWorkers: 'block'` tylko na `scratch` (nic do sprzątania; **`allow` w kontekstach `fresh`**, bo blokada zmienia PWA pod testem względem obu starych runnerów i MCP — nagłówek raportu mówi `sw=blocked`).

Dokument poprzedniego przebiegu **zostaje załadowany** aż do następnego `goto` (nawigacja do `about:blank` nic nie daje — goto po `about:blank` 50/62 ms, bez różnicy — a kosztuje 10–20 ms w kolejce); `beforeunload` poprzedniej strony jest auto-akceptowany (§4.5). W tabeli STEPS nie ma `exposeFunction`/`exposeBinding`/`addInitScript` — są nieusuwalne per kontekst. Browser-wide i **nieczyszczone ani przez scrub, ani przez `--fresh`, ani przez MCP**: HSTS, cache uwierzytelnienia HTTP, cache DNS — zapisane w README.

Co zostaje celowo: cache HTTP, code-cache V8, ciepły renderer. Statyczny `serveStatic` app-factory nie wysyła `ETag`/`Last-Modified`/`Cache-Control` (sprawdzone), więc Chrome nic z niego nie cache’uje; **nginx/`serve` wysyłają `Last-Modified` i heurystyczna świeżość (10 % wieku) może podać stary `index.html` po rebuildzie** — dlatego silnik liczy `cacheHits` (`timing.cacheHits`, osobno `cacheHitsDocument`) — z **Resource Timing API strony**, w tym samym przelocie co dowód końcowy (`capture.mjs`), a nie z rejestratora: `response.fromCache()` **nie istnieje** w playwright-core 1.62.1, więc licznik oparty na nim raportował 0 w każdym zmierzonym przebiegu, a `safeCall` połykał wyjątek. Wpis jest trafieniem, gdy `deliveryType === 'cache'` albo `transferSize === 0 && decodedBodySize > 0`; liczone per dokument, bo bufor Resource Timing zeruje się przy nawigacji. BUDGET.md czerwieni wiersz > 0 dla dokumentu głównego, a `isolation: "fresh"` / `--fresh` daje świeży kontekst z puli spare + `Network.clearBrowserCache`. `report.json.timing` mówi `ctx: reused | fresh`, `tab: kept | new`.

`needsFreshContext(snapshot)` = `isolation === 'fresh'` ∨ `auth`/`storageState` ∨ `video` ∨ `--fresh`. `--parallel N`: lane’y `scratch[1..N-1]` są **takimi samymi trwałymi kontekstami** (nie świeżymi — świeży kontekst kosztuje 190–441 ms na pierwszym goto), tworzone przy pierwszym użyciu, szorowane tak samo, zamykane po `BROWSER_INSPECTOR_LANE_IDLE_MS` (300 000). Dla app-factory z `parallel: 3` czas ≈ max(lane), nie sum(flow). Domyślnie `parallel: 1`.

### 2.4 Klient (`bin/browser-inspector.mjs` + `src/client.mjs`)

Importuje wyłącznie `node:net`, `node:fs`, `node:path`, `node:child_process`, `node:os` oraz `src/steps.schema.mjs`, `src/cli.mjs`, `src/config.mjs`, `src/paths.mjs`, `src/print.mjs` — **nigdy** `playwright-core` ani modułu silnika (`engine.mjs`, `lanes.mjs`, `flow.mjs`, `session.mjs`, `steps.ctx.mjs`, `steps.run.mjs`). Hash tożsamości to FNV-1a w JS (bez `node:crypto`). Strażnicy (recenzje #1/#2: bez nich start klienta cicho rośnie z 48 do 300 ms i teza pada): `test/client-imports.test.mjs` uruchamia `node --import=./test/hooks/trace-loads.mjs bin/browser-inspector.mjs help` i sprawdza listę załadowanych modułów; `test/perf/client-start.perf.test.mjs`: mediana z 5 × `spawn(node bin/browser-inspector.mjs help)` ≤ 120 ms.

Protokół: jedna linia JSON żądania `{ v: 1, token, cwd, argv, values, secretValues, files, session, out }`, linie `{ progress }` (batch: jedna na zakończony snapshot) i `{ done: true, exit, lines, files }`. **Bez `env`** (recenzja #2): klient rozwiązuje `valueFromEnv` / `--env NAZWA` / `@{NAZWA}` u siebie i wysyła **tylko** wartości pod adresami kroków (`values: { "snapshots[3].steps[4].value": "…", "argv.fill.value": "…" }`) plus `secretValues` (wartości pochodzące z env), które keeper trzyma per zadanie/sesja i **redaguje** (`***`) wszędzie (§2.6). Pliki (`route --file`, `upload`, `eval --file`, `state load`, `script`) czyta **klient** względem swojego cwd i wysyła treść (≤ 1 MB, base64) albo ścieżkę absolutną (większe uploady) — keeper może mieć inne cwd i uprawnienia. Klient parsuje argv z tabeli `STEPS` (schemat), więc literówka pada w kliencie; drukuje `lines`, kończy kodem `exit`; przy `keeper: fallback` (tylko batch) dopisuje to do stdout i `timing.mode`.

### 2.5 Keeper — cykl życia (`src/keeper.mjs`, `src/paths.mjs`)

| aspekt | decyzja |
| --- | --- |
| tożsamość | `hash = fnv1a(pkgVersion \| playwright-core version \| node major \| channel \| executablePath \| headless \| args \| BROWSER_INSPECTOR_BROWSER_ARGS \| HTTP_PROXY \| HTTPS_PROXY \| NO_PROXY \| realpath(bin/browser-inspector.mjs) \| srcStamp)`; `srcStamp` = max mtime plików `src/**` (pomijany, gdy w katalogu pakietu leży marker `PORTABLE` z zipa) — dwa checkouty tej samej wersji i edycja `src/` w developmencie dostają **inny pipe**; keeper ze starym kodem nie jest już trafiany (recenzja #1: WP5/WP6 byłyby flaky od pierwszego dnia); `browser-inspector status` drukuje hash i ścieżkę |
| plik pid | `os.tmpdir()/browser-inspector-<hash>.json` = `{ pid, pipe, token, version, startedAt, binPath }`; token = 32 losowe bajty (`crypto.randomBytes` w **keeperze**, klient tylko czyta plik); pierwsza linia każdego połączenia musi go nieść. Na POSIX tryb `0600` jest realny; **na Windows `fs.mode` nic nie znaczy** — token chroni ACL katalogu `%TEMP%` użytkownika i tak jest to napisane w README, nie „0600” |
| nadpisania | `BROWSER_INSPECTOR_SOCKET=<pipe>` (dwa agenty, dwa keepery), `BROWSER_INSPECTOR_DAEMON=0` / `--no-daemon`, `BROWSER_INSPECTOR_DAEMON=1` (jawne odwrócenie wykrycia CI), `BROWSER_INSPECTOR_IDLE_MS`, `BROWSER_INSPECTOR_SESSION_TTL_MS`, `BROWSER_INSPECTOR_LANE_IDLE_MS`, `BROWSER_INSPECTOR_MAX_JOBS`, `BROWSER_INSPECTOR_MAX_RSS_MB`, `BROWSER_INSPECTOR_BROWSER_PATH`, `BROWSER_INSPECTOR_BROWSER_ARGS`, `BROWSER_INSPECTOR_CHANNEL`, `BROWSER_INSPECTOR_SESSION`, `BROWSER_INSPECTOR_UNSAFE` |
| wykrywanie CI | `isCI(env)` = którakolwiek z `CI`, `GITHUB_ACTIONS`, `GITLAB_CI`, `TF_BUILD`, `JENKINS_URL`, `TEAMCITY_VERSION`, `BUILDKITE`, `CIRCLECI` (czysta funkcja, testowana) ⇒ bez keepera; `BROWSER_INSPECTOR_DAEMON=1` wygrywa. **Nigdy `isTTY`** (Bash Claude Code nie jest TTY) |
| start | klient: connect → ENOENT/ECONNREFUSED → **nigdy nie unlinkuje** gniazda → `spawn(process.execPath, [keeper.mjs], { detached: true, stdio: 'ignore', windowsHide: true }).unref()` → retry connect co 25 ms do 3 s. Keeper: bierze lockfile `browser-inspector-<hash>.lock` przez `O_EXCL` (z pid), sam sprząta stale socket/pid (po `kill(pid, 0)`), **nasłuchuje NAJPIERW** (45 ms od spawnu), potem `import('./engine.mjs')` i `launch`; zadania kolejkują się za `browserReady`. Wyścig POSIX z recenzji #1 jest wykluczony, bo klient nie unlinkuje; wyścig dwóch keeperów kończy się `EEXIST` na locku → exit 0 |
| auto-start | dla KAŻDEJ komendy, także `browser-inspector <config.json>`; `browser-inspector up` jawnie jako hook `SessionStart` agenta |
| awaria startu | brak połączenia po 3 s ⇒ **batch** wykonuje się w procesie (`keeper: fallback`, `timing.mode = "fallback"`); **sesja** ⇒ `exit 2` z komunikatem (§2.1) |
| bezczynność | `BROWSER_INSPECTOR_IDLE_MS` domyślnie **1 800 000 (30 min)** — pętla agent↔człowiek ma dłuższe przerwy, 5 min zamieniało większość „drugich” wywołań w `first` (1,47 s); koszt ~150–250 MB RAM widać w `browser-inspector status` (RSS). Timer liczony **od końca ostatniego zadania i tylko przy pustych kolejkach**; otwarta sesja podtrzymuje do `BROWSER_INSPECTOR_SESSION_TTL_MS` (3 600 000) od ostatniej komendy; `browser-inspector close` zamyka od razu |
| zdrowie | §2.2: `disconnected` ⇒ exit 1; `crash` ⇒ odbudowa karty lane’u; recykling po `BROWSER_INSPECTOR_MAX_JOBS`/RSS; `browser.isConnected()` przed każdym zadaniem |
| współbieżność | kolejka per klucz: `lane:<n>`, `session:<name>`; równoległy batch czeka i dostaje `timing.queuedMs`; named pipe w Windows przy zajętym keeperze czeka w `WaitNamedPipe` (kolejka, nie wyścig) |
| przetrwanie powłoki | sprawdzone empirycznie tylko w Bash Claude Code (heartbeat żył w następnym wywołaniu). VS Code / Copilot CLI / pnpm z Job Object mogą zabić drzewo (Node nie ustawia `CREATE_BREAKAWAY_FROM_JOB`) — wtedy każde wywołanie jest zimne + 45 ms spawnu. Dlatego: `browser-inspector doctor` (spawn keepera → wyjście powłoki → connect z nowego procesu; drukuje `keeper survives shell: yes|no`, czasy, hash, ścieżkę), `timing.mode ∈ warm|first|fallback|no-daemon` w **każdym** `report.json`, wariant benchu `keeper-survives-shell` |
| sterowanie | `browser-inspector up`, `browser-inspector status` (pid, hash, ścieżka, wersje, RSS, zadania od startu, sesje z cwd/out, lane’y, route’y), `browser-inspector stop`, `browser-inspector doctor`; log `os.tmpdir()/browser-inspector-<hash>.log` (obcinany przy 1 MB) — nigdy wartości sekretów |

### 2.6 Sekrety i bezpieczeństwo

`value` w krokach `auth.login` = błąd walidacji; `auth.oauth` wyłącznie `*FromEnv`; `valueFromEnv` rozwiązywane w kliencie w czasie przebiegu (config parsuje się bez sekretu; brak zmiennej jest nazwany, `exit 2`). Składnia w sesji: `--env NAZWA` albo `@{NAZWA}` w `fill`/`form` (literały zaczynające się od `@` bez klamry są literałami; `@{FOO}` bez zmiennej = błąd nazwany, nie wpisanie „@{FOO}” do formularza). `describe` echuje tylko nazwę zmiennej. Keeper trzyma `secretValues` per zadanie/sesja i **redaguje** je (`redact()` z `src/redact.mjs`, jedna funkcja) w: stdout, `journal.jsonl`, logu, `report.md/json`, `snap.md/snap.json` (wartości textboxów), `extract`, `eval`, `text.txt`, `console.jsonl`, `net.jsonl`, eksporcie (tam `valueFromEnv`); pola `type=password` i `autocomplete=one-time-code` **nigdy** nie mają `= wartość` w snapshocie. Jeden test przechodzi przez `fill/form/storage set/eval` i sprawdza wszystkie miejsca. Transport tylko lokalny, z tokenem, bez `env`. Nie ma ścieżek DELETE poza `storage … clear` w piaskownicy własnego kontekstu. `eval`/`evaluate` wykonuje JS **w kontekście strony**; `browser-inspector run --file s.mjs` (`export default async (page, context) => …` w keeperze) istnieje **wyłącznie w sesji pod `BROWSER_INSPECTOR_UNSAFE=1`** i jest jawnie nazwane RCE-równoważnym jak `run_code_unsafe` MCP — nigdy w configu batchu ani w CI.

---

## 3. CLI i schemat configu

### 3.1 Dwa wejścia, jedna gramatyka

```
browser-inspector <config.json> [--stamp X] [--only nazwa] [--parallel N] [--fresh] [--junit f.xml] [--fail-on-incomplete] [--no-daemon]   # batch (alias: browser-inspector run …)
browser-inspector <komenda> [args] [--session NAME] [--out DIR] [--soft]                                                                  # sesja interaktywna (wymaga keepera)
browser-inspector script <plik> [--out DIR] [--no-daemon]            # lista komend sesji (jedna na linię) w JEDNYM procesie — CI bez keepera
browser-inspector up | status | stop | doctor | help [komenda] | export <flow.json> [--session NAME] [--force] | lint-config <config.json>
```

Pierwszy argument kończący się na `.json` = batch, więc wywołanie bramki app-factory `node <pipeline> <config> --stamp X` działa **bez zmiany argumentów** (`--stamp X` i `--stamp=X`, wzorzec `YYYY-MM-DD_HH-MM` jak w `read-runtime`; bench generuje poprawny stempel zamiast `--stamp bench`). Nieznana flaga jest błędem (exit 2). `browser-inspector` na PATH nie jest założeniem: README i AGENTS.md app-factory dokumentują skrypt `"browser-inspector": "node ../scribe-devtools/packages/browser-inspector/bin/browser-inspector.mjs"` (`pnpm browser-inspector …`); bench liczy tokeny obu form komendy.

### 3.2 Tabela kroków — jedno źródło prawdy, dwa pliki

`src/steps.schema.mjs` (importowany przez **klienta**: `kind`, `argv`, `flags`, `config`, `validate`, `describe`, `help`) i `src/steps.run.mjs` (importowany **tylko przez silnik**: `RUNNERS[name] = async (ctx, s) => …`). Test pilnuje `Object.keys(RUNNERS)` ≡ `Object.keys(STEPS)`.

```js
// steps.schema.mjs
export const STEPS = {
  click: {
    kind: 'action',                                          // action | query | control — steruje deltami w linii stdout
    argv: ['target'],                                        // pozycyjne w sesji: browser-inspector click e12
    flags: { double: 'bool', right: 'bool', mod: 'list' },   // browser-inspector click e12 --double --mod ctrl,shift
    config: { selector: 'string?', ref: 'ref?', button: 'enum:left,right,middle?', count: 'int?', modifiers: 'list?' },
    validate: (s, where) => needOneOf(s, where, ['selector', 'ref']),
    describe: (s) => `click ${targetOf(s)}${s.count === 2 ? ' (double)' : ''}`,   // nigdy nie echuje wartości fill
    help: 'click <eN|selector> [--double] [--right] [--mod ctrl,shift]',
  },
};
// steps.run.mjs
export const RUNNERS = {
  click: async (ctx, s) =>
    ctx.page.click(await ctx.sel(s), { timeout: ctx.timeoutMs, clickCount: s.count ?? 1, button: s.button ?? 'left', modifiers: s.modifiers }),
};
```

`ctx.sel(s)`: `s.ref` (`e12`, `f3e7`) → `aria-ref=<ref>` **dosłownie**, poprzedzone `locator.count()`; 0 trafień ⇒ pełny `page.ariaSnapshot({ mode: 'ai' })` (odświeża mapę refów: element o tej samej roli i nazwie dostaje ten sam ref), ponowne `count()`, dalej 0 ⇒ `FAIL … ref e12 not found (gone, label changed or other frame) → browser-inspector snap` **od razu**, bez czekania na actionability; `s.selector` → selektor Playwrighta bez zmian (`css`, `text=`, `role=`, `mat-option:has-text('…')`). Ta sama tabela waliduje config (`snapshots[i].steps[j]: …`), parsuje argv, opisuje krok w raporcie, generuje `browser-inspector help <krok>` i `docs/STEPS.md`. **Walidacja**: `ref` w configu batchu bez wcześniejszego kroku `snapshot` w tym samym flow = błąd (`mapa refów pusta`), a `export` zawsze zamienia refy na selektory (test negatywny).

Pełna lista (te same nazwy w configu i CLI; stare nazwy zachowane): `goto` (sesja: `open`), `back`, `forward`, `reload`, `click`, `fill` (`value` | `valueFromEnv`; `--enter`; `--env`), `type` (`--slowly`), `form` (`e3="Jan" e5=@{APP_PASS}`), `press`, `hover`, `select`, `check`, `uncheck`, `drag`, `upload`, `scroll`, `wait` (`ms` | `text` | `textGone` | `url`), `waitFor` (selektor + `state`), `screenshot` (`shot`; `fullPage`, `ref`/`selector`, `format`, `quality`, `mark`), `pdf`, `extract` (`get`; `--value`), `evaluate` (`eval`; `expression`, `timeout`, `--file`, `--el`), `snapshot` (`snap`), `find`, `verify` (`visible` | `hidden` | `text` | `value` | `list` | `url` | `title` | `count`; `soft`), `resize`, `route` / `unroute` / `routes`, `offline`, `fetch`, `dialog`, `tab` / `tabs`, `frame`, `mouse`, `storage` (`cookies` | `local` | `session` × `list` | `get` | `set` | `del` | `clear`), `state` (`save` | `load`), `console` (`--level`), `net` (`net <n> [--body] [--req]`), `trace`, `video`, `locator`, `run` (sesja, `BROWSER_INSPECTOR_UNSAFE=1`), `close`.

`verify kind: list` = `{ do: 'verify', kind: 'list', selector|ref, items: […] }`: każdy `items[i]` jest widocznym tekstem potomka w podanej kolejności. `verify` zatrzymuje flow jak każdy krok; `soft: true` (sesja: `--soft`) zapisuje wynik do `verifications[]`, nie zmienia `completed`, a `report.md` dostaje sekcję `## verify` z wierszami FAIL.

### 3.3 Config batch — zgodność z app-factory

Obecny `read.config.browser-inspector.json` (6 snapshotów, `networkidle`, `wait ms`, `mat-option:has-text`, `evaluate` rzucający) parsuje się **bez zmian** i daje ten sam katalog `<outputDir>/<stamp>/<name>/report.json`; jest fixture’em. Honorowane pola: `outputDir`, `browser{channel, executablePath, headless, args}`, `auth{storageState, login|oauth, maxAgeMinutes, reuse}`, `snapshots[{name, type: page|flow, url, waitUntil, fullPage, viewport, steps, stepTimeoutMs, navTimeoutMs, captureElements, captureNetwork, auth: false, render}]`. Nowe pola są opcjonalne:

```json
{
  "outputDir": "./.scribe-devtools/browser-inspector",
  "parallel": 3,
  "browser": { "channel": "chrome", "headless": true, "fastHeadless": true, "motion": "no-preference" },
  "snapshots": [
    {
      "name": "bookstore-zakupy", "type": "flow", "url": "http://localhost:4313/",
      "waitUntil": "settled", "isolation": "reuse", "finalScreenshot": "auto", "captureSnapshot": false, "captureBodies": true,
      "dialogs": "dismiss", "routes": [{ "url": "**/api/recommendations", "block": true }], "stepTimeoutMs": 8000,
      "steps": [
        { "do": "fill", "selector": "#mat-input-0", "value": "Harry", "enter": true },
        { "do": "wait", "text": "Harry Potter" },
        { "do": "click", "selector": "[data-testid=card-add-to-cart]" },
        { "do": "verify", "kind": "text", "selector": "[data-testid=header-cart-button]", "text": "1", "soft": true },
        { "do": "fill", "selector": "#email", "valueFromEnv": "SHOP_EMAIL" },
        { "do": "click", "selector": "[data-testid=header-cart-button]" },
        { "do": "verify", "kind": "url", "url": "**/cart" },
        { "do": "snapshot", "name": "koszyk" },
        { "do": "screenshot", "name": "koszyk", "fullPage": true },
        { "do": "screenshot", "name": "karta", "selector": "ais-shop-cart-line", "format": "jpeg", "quality": 80 },
        { "do": "storage", "kind": "local", "op": "get", "key": "cart", "name": "koszyk-ls" },
        { "do": "pdf", "name": "koszyk" }
      ]
    }
  ]
}
```

Domyślne: `waitUntil: "load"`, `isolation: "reuse"`, `captureElements: true` → `elements.md`, `captureSnapshot: false`, `captureBodies: true`, `dialogs: "dismiss"`, `parallel: 1`, `settleMs: 2000`. **Zrzuty**: `type: "page"` → zawsze `page.png` (z `fullPage` snapshotu), jak stary runner; `type: "flow"` z `finalScreenshot: "auto"` → `final.png` **zawsze przy porażce**, przy sukcesie pomijany tylko, gdy ostatni WYKONANY krok był zrzutem (nagłówek `report.md` mówi wtedy `final: koszyk.png`); `"always"` / `"never"` jawnie. Nazwa `final` zarezerwowana; nazwy artefaktów `^[a-z0-9][a-z0-9-]*$`.

### 3.4 Migracja app-factory (opcjonalna) i policzony czas

`browser-inspector lint-config read.config.browser-inspector.json` drukuje: `4× waitUntil "networkidle" → "settled" (−500…−1900 ms każdy; sonda: 666–2056 ms)`, `7× wait ms (razem 4200 ms snu) → waitFor <selector> / wait --text` (animacje Material 600–700 ms — `settled` ich **nie** widzi, więc lint nie proponuje `settled` dla tych kroków), `parallel: 3 (6 flow → 3 lane)`. Bez migracji wszystko działa jak dziś (`networkidle` 1:1): **≈ 8–10 s wall** (4 × networkidle 0,7–2,1 s + 4,2 s snu + ~0,7 s kroków i zrzutów + 5 scrubów × 12–35 ms) — na tym configu 5× nie ma i dokument tego nie obiecuje; po migracji ≈ 2,5 s sekwencyjnie i **≈ 1,3–1,6 s z `parallel: 3`** (lane 1–2 płacą raz 115 + 190–441 ms świeżego kontekstu, potem są ciepłe). To wybór autora configu, nie narzędzia.

### 3.5 Kody wyjścia

Batch: **0** zawsze (nieudany krok to wynik w raporcie), **1** tylko z `--fail-on-incomplete`, **2** przy błędzie fatalnym (config, `E_BROWSER_MISSING`, nieznana flaga). Sesja: **0** ok, **1** FAIL (łańcuch `&&` się zatrzymuje; `--soft` → 0), **2** fatalny (w tym brak keepera).

---

## 4. Sesja interaktywna

### 4.1 Pętla agenta

```
browser-inspector open http://localhost:4313/      → 1 linia + snap.md/snap.json na dysku
browser-inspector find koszyk                        → ≤10 linii z refami (główny sposób patrzenia)
browser-inspector click e45                          → 1 linia z deltami; snap odświeżany leniwie
browser-inspector snap --diff                        → tylko linie dodane/usunięte od poprzedniego snap
browser-inspector shot koszyk && browser-inspector console          → ścieżka pliku; nowe wpisy konsoli od ostatniego wywołania
browser-inspector export flows/koszyk.json           → dziennik sesji → config flow do powtarzania bez agenta
```

### 4.2 Refy — semantyka wg coreBundle, nie założona

- **Ref = (element, rola, nazwa) z OSTATNIEGO snapshotu w danej ramce.** Przeżywa zmiany DOM w SPA, dopóki element jest podłączony i zachowuje rolę i nazwę (sonda: `e172` → `e172`); zmiana etykiety („Dodaj do koszyka” → „W koszyku”) daje **nowy ref**, stary jest martwy mimo tego samego elementu; nawigacja dokumentu daje nowy `frameSeq` (refy `f1eN`, `f2eN`), stare przestają się rozwiązywać.
- **Reguła keepera: w sesji wykonuje się WYŁĄCZNIE pełny `page.ariaSnapshot({ mode: 'ai', boxes: true })`** — każdy snapshot poddrzewa, z `depth` albo w trybie `default` nadpisałby mapę i unieważnił wszystkie inne refy (fałszywe „ref not found”). `--around`, `--grep`, `--max`, `--diff`, `verify list` i `find` są **filtrami w JS po pełnym YAML**. Test regresji: po `verify list` i `find` ref sprzed nadal się rozwiązuje.
- `sel()` robi `count()` przed akcją; 0 ⇒ pełny snapshot ⇒ `count()` ⇒ 0 ⇒ `FAIL` w kilkadziesiąt ms z podpowiedzią (smoke: zmiana etykiety po kliknięciu → stary ref FAIL < 100 ms).
- Linia akcji mówi, czy warto patrzeć znowu: `navigated` (refy nieważne — `browser-inspector snap`), `dom Δ` (licznik `MutationObserver` ze skryptu init sesji), `el 61→63` (1 evaluate, 6 ms), `+1 console.error`, `+2 net failed`, `dialog …`. Pełny `ariaSnapshot` (26–85 ms) wykonuje się dopiero przy `snap`/`find` albo gdy `count()` nie znajdzie refa.

### 4.3 Format snapshotu (`src/snapshot.mjs`, funkcje czyste)

`snap.full.yml` = surowe `ariaSnapshot({ mode: 'ai', boxes: true })`. `snap.json` = sidecar `[{ ref, role, name, selector?, box }]` z **box-joinu**: jeden in-page `evaluate` zbiera prostokąty i trwałe selektory (`data-testid` → `#id` → `[name]`) elementów interaktywnych, a linie drzewa łączy się po zaokrąglonym `[box=…]` (136/136, 16 ms). `snap.md` = `compactSnapshot()`: zostają linie z `[ref=` o rolach interaktywnych (button, link, textbox, searchbox, combobox, option, checkbox, radio, switch, tab, menuitem, slider, spinbutton) i semantycznych (heading, alert, status, dialog, img z nazwą) oraz liście tekstu pod alert/status; wycięte `generic` bez nazwy, `[cursor=pointer]`, `[box]`; `- /url:` zwinięte do ` → /cart`; selektor z sidecara na końcu linii. Bez `--names` linia nie niesie kontekstu (19 tok.); `--names` dopisuje w nawiasie nazwę najbliższego przodka `article|li|[role=listitem]|section` (jego pierwszy heading albo `aria-label`, ≤ 60 znaków; 31 tok.). Bookstore: 952 linii YAML → ~80 linii:

```
e11 link "Księgarnia" → /
e15 link "Katalog" → /katalog
e39 textbox "Szukaj produktów…"
e41 button "Szukaj" [data-testid=search-submit]
h2 "Nowości"
e112 button "Dodaj do koszyka" [data-testid=card-add-to-cart]
```

`browser-inspector snap` drukuje ten widok z **`--max 25`** (≈ 370 tok.; `--max 40` ≈ 590 — więcej niż `browser_snapshot` MCP 534, dlatego nie jest domyślne; nadmiar: `…+55 lines · session/default/snap.md`), `--diff`, `--around e45` (sąsiedztwo w kompakcie), `--grep tekst`, `--names`, `--all` (pełne drzewo do pliku, nie na stdout). `browser-inspector find <tekst>` = `findInSnapshot()` po pełnym YAML (także po tekście liści), do 10 linii kompaktu — ~40–100 tok.

### 4.4 Dokładny stdout (każda linia ≤ 40 tokenów o200k; zmierzone 18–27)

```
$ browser-inspector open http://localhost:4313/
ok open "Księgarnia" · el 61 · err 0 · session/default/snap.md

$ browser-inspector find koszyk
e45 button "Otwórz koszyk" [data-testid=header-cart-button]
e112 button "Dodaj do koszyka" [data-testid=card-add-to-cart]

$ browser-inspector click e112
ok click e112 · dom Δ · el 61→63 · +1 console.error

$ browser-inspector click e45
ok click e45 · url /cart "Koszyk" · el 63→23

$ browser-inspector fill e39 Harry --enter
ok fill e39 · navigated → refs f1eN (browser-inspector snap) · el 58

$ browser-inspector snap --max 3
f1e11 link "Księgarnia" → /
f1e39 textbox "Szukaj produktów…" = Harry
f1e41 button "Szukaj" [data-testid=search-submit]
…+55 lines · session/default/snap.md

$ browser-inspector console --level error
1 new: error [cart] POST /api/cart → 404

$ browser-inspector net --failed
3 new · 1 failed: #7 POST /api/cart 404 12 ms

$ browser-inspector net 7 --body
404 application/json 41 B · session/default/net/7.txt
{"error":"cart not found"}

$ browser-inspector eval document.title
"Koszyk"

$ browser-inspector shot koszyk --full
ok shot session/default/shots/004-koszyk.png 1280x2140

$ browser-inspector click e99
FAIL click e99 · ref not found (gone, label changed or other frame) → browser-inspector snap     # exit 1

$ browser-inspector dialog
policy dismiss · last: confirm "Usunąć?" → dismissed (browser-inspector click e12)

$ browser-inspector export flows/koszyk.json
ok export 9 steps → flows/koszyk.json (refs → data-testid/#id/role=)

$ browser-inspector doctor
ok keeper survives shell: yes · spawn→listen 45 ms · first job 1 390 ms · warm 470 ms · hash 3f9a1c2e · D:/github/scribe-devtools/packages/browser-inspector/bin/browser-inspector.mjs
```

Zasady (`src/print.mjs`, testowane): jedna linia na sukces, ≤ 160 znaków, prefiks `ok | FAIL`, separator ` · `, ścieżki względne do cwd; `console`, `net`, `find`, `snap`, `eval` (≤ 300 znaków, dłuższe → `eval-NNN.txt`), `extract` drukują treść, bo treść JEST wynikiem; `console --level info|warn|error` (poziom włącza cięższe, jak MCP), `--errors` = `--level error`; `console`/`net` drukują **tylko wpisy od ostatniego wywołania** z prefiksem `N new:` (`--all`, `--failed`, `--tail N`); `net <n>` drukuje status, typ, rozmiar i ≤ 20 linii ciała (`--req` = nagłówki żądania), całość do `net/<n>.txt`.

### 4.5 Pliki sesji, dialogi, karty, ramki, eksport

**Klucz sesji = tylko nazwa** (`--session`, `BROWSER_INSPECTOR_SESSION`, domyślnie `default`) per keeper — nie `<cwd>|<name>`, bo `cd` w Bash albo subagent z innym cwd tworzyłby drugą sesję bez ostrzeżenia. Katalog `out` ustalany przy `browser-inspector open` (`--out`, domyślnie `./.scribe-devtools/browser-inspector`) i zapamiętany w sesji; `browser-inspector status` pokazuje `session default · cwd D:/x · out …`. `<out>/session/<name>/`: `snap.md`, `snap.full.yml`, `snap.json`, `journal.jsonl` (komenda, wynik, ms, url, **selektor rozwiązany przy akcji**), `console.jsonl`, `net.jsonl`, `net/<n>.txt`, `shots/NNN-<name>.png`, `pdf/`, `eval-NNN.txt`, `trace.zip`, `video/`. Tylko najnowszy snapshot — historia w dzienniku.

- **Dialogi**: polityka PRZED akcją (`browser-inspector dialog accept|dismiss [--text …] [--once]`, domyślnie `dismiss`), każdy dialog logowany i pokazany w linii; `beforeunload` jest **zawsze akceptowany** (inaczej blokuje nawigację) z wpisem `· dialog beforeunload → accepted`; `browser-inspector dialog` bez argumentów = polityka + ostatni dialog. Zero blokad w keeperze.
- **Karty**: `browser-inspector tabs`, `browser-inspector tab new [url]`, `browser-inspector tab 2`, `browser-inspector tab close`; popupy przez `context.on('page')`; w batchu popupy trafiają do `report.json.tabs[] = [{ url, title, openedAt }]`, zanim scrub je zamknie.
- **Ramki**: pełny snapshot `ai` **zawiera iframe’y** z refami `f<seq>eN`, które rozwiązują się bez przełączania (fakt (d)); `browser-inspector frame 2` / `browser-inspector frame main` zmienia zakres tylko dla **selektorów CSS/tekstowych, `eval`, `extract`** (`frame.locator`), nigdy nie robi snapshotu poddrzewa.
- **Route**: `browser-inspector route "**/api/*" --block | --status 500 --body '{"e":1}' | --file odp.json | --delay 300`, `browser-inspector unroute [wzorzec]`, `browser-inspector routes`; `browser-inspector offline on|off`; `browser-inspector fetch <url> [--method] [--body]` = `fetch` w kontekście strony.
- **Eksport** (`src/session-log.mjs → exportFlow`): każda akcja na refie zapisuje selektor rozwiązany **w chwili akcji** (`locator('aria-ref=eN').evaluate(locatorFor)`, 14 ms) z preferencją `[data-testid=…]` → `#id` → `[name=…]` → `role=button[name="…"]`; wartości z `--env`/`@{NAZWA}` stają się `valueFromEnv`; eksport pisze **nowy plik** (istniejący wymaga `--force`); test: żadna wartość sekretu nie ląduje w eksporcie, dzienniku, raporcie ani stdout.
- **`browser-inspector script plik.txt`**: te same linie co w powłoce, jedna na linię, wykonane w jednym procesie (bez keepera, `--no-daemon` honorowane); stdout = te same linie; exit = pierwszy niezerowy; jedyna ścieżka sesyjna dla CI.

---

## 5. Raport i artefakty batch

`<outputDir>/<stamp>/<snapshot>/`: `report.md`, `report.json`, `_manifest.json` (per snapshot: `{ name, type, url, completed, screenshots, timing }` — konwencja `read-runtime.writeManifest`, bo narzędzia scribe czytają snapshoty), `elements.md`, `text.txt` (cap 20 000), `snap.md` + `snap.json` (gdy `captureSnapshot` albo krok `snapshot`), `page.png` (type page) / `*.png|jpg|pdf`, `trace.zip`, `video.webm`; `<outputDir>/<stamp>/_manifest.json` = `{ stamp, config, version, timing: { mode, keeperStartMs?, launchMs?, clientMs }, snapshots: [{ name, completed, dir, ms, ctx, tab, lane, queuedMs, scrubMs, cacheHits, failure? }] }`.

### 5.1 `report.md` — celowany z natury (**187 tokenów o200k** na próbce niżej, z czego ~90 to same wartości)

```
# zgloszenie-serwisowe — OK 18/18 · 446 ms · warm reused
http://localhost:4300/ "Zgłoszenie serwisowe" · console 3 (1 err) · net 12 (1 failed) · shots walidacja.png potwierdzenie.png

## errors
- console.error [zgloszenia] zapis nie powiodl sie: 404
- POST /api/zgloszenia → 404

## values
blad-email: Podaj poprawny adres e-mail
licznik-niepoprawnych: 3
numer-zgloszenia: ALM-1001
kategoria: zmiana
priorytet: krytyczny
formularz-zamkniety: formularz zniknal, potwierdzenie widoczne

more: elements.md (21) · text.txt · report.json
```

Przy porażce nagłówek to `# wizard-formularz — FAIL 9/16 · 1 812 ms · warm reused · final.png`, a sekcja `## steps` listuje dwa kroki przed nieudanym, nieudany i `skipped 11–16` (próbka: 139 tok.). Nagłówek dostaje `sw=blocked`, `motion=reduce`, `final: koszyk.png`, `tab new`, `fallback` tylko wtedy, gdy zachodzą. Wartości wieloliniowe w płotkach; > 5 000 znaków → `values/<name>.txt`. Sekcja `## verify` tylko przy miękkich porażkach. Stary celowany odczyt: 567 tokenów; tu cały plik ≈ 190.

### 5.2 `report.json` — nadzbiór obu starych kształtów, zawsze poprawny JSON

```json
{
  "name": "zgloszenie-serwisowe", "startUrl": "http://localhost:4300/", "finalUrl": "http://localhost:4300/", "title": "Zgłoszenie serwisowe",
  "completed": true,
  "steps": [
    { "index": 0, "description": "waitFor [data-testid=request-form] (visible)", "ok": true, "ms": 6 },
    { "index": 5, "description": "fill [data-testid=field-name] (literal)", "ok": true, "ms": 9 }
  ],
  "skipped": 0,
  "extracts": { "numer-zgloszenia": { "value": "ALM-1001", "truncated": false } },
  "verifications": [{ "index": 3, "kind": "text", "ok": true, "soft": true }],
  "console": { "entries": [{ "type": "error", "text": "[zgloszenia] zapis nie powiodl sie: 404", "location": "main.js:12" }], "total": 3, "truncated": false },
  "pageErrors": [],
  "network": { "total": 12, "failed": [{ "id": 7, "method": "POST", "url": "http://localhost:4300/api/zgloszenia", "failure": "HTTP 404" }] },
  "failedRequests": { "entries": [{ "url": "http://localhost:4300/api/zgloszenia", "failure": "HTTP 404" }], "truncated": false },
  "dialogs": [], "tabs": [],
  "screenshots": ["walidacja.png", "potwierdzenie.png"],
  "text": { "content": "…", "truncated": false },
  "elements": { "entries": [{ "kind": "button", "name": "Wyślij zgłoszenie", "selector": "[data-testid=\"submit\"]" }], "total": 21, "truncated": false },
  "files": { "elements": "elements.md", "text": "text.txt" },
  "timing": { "mode": "warm", "ctx": "reused", "tab": "kept", "lane": 0, "queuedMs": 0, "scrubMs": 14, "gotoMs": 53, "stepsMs": 371, "captureMs": 12, "writeMs": 9, "totalMs": 446, "cacheHits": 0, "cacheHitsDocument": 0 },
  "engine": { "browser-inspector": "0.1.0", "playwright-core": "1.62.1", "browser": "Chrome/140", "flags": ["--disable-frame-rate-limit", "--disable-gpu-vsync"], "motion": "no-preference", "serviceWorkers": "block", "generation": 41 }
}
```

`navigationError` pojawia się **wyłącznie**, gdy nawigacja padła (nigdy `undefined`); `evaluateReports()` ze `smoke-browser.mjs` czyta `completed`, `steps[].description/ok/error`, `navigationError ?? …` — bez zmian. `steps` zawiera kroki wykonane (stary kształt), `skipped` mówi, ile pominięto; `steps[i].error` ma formę `Error: uczen widzi przycisk nauczyciela`.

---

## 6. Budżet czasu

Flow benchu (`demo/skryba/read.config.json`, 18 kroków): waitFor, click, 2×extract, screenshot, 3×fill, select, click, fill, 2×click, waitFor, 3×extract, evaluate, screenshot. Koszty jednostkowe = liczba **gorsza** z {właściciel, sonda rano, sonda rewizyjna} po medianach: klient 72 (właściciel; sonda 48), click 44 (właściciel), goto na tej samej karcie 55 (sonda rewizyjna wizard med 53; właściciel 49), CDP-zrzut 25, pipe 5, fill 10, dowód końcowy 12 (el-count 6 + title/text/elements 6), launch 300 (sonda 158–186, właściciel 440 — wiersz „pesymistycznie”). Flagi frame-rate są domyślnie włączone, ale budżet ich **nie liczy**.

| faza | warm, przerwa ≥ 250 ms (`browser-inspector-warm`) | warm bez przerwy (`browser-inspector-warm-tight`) | 1. wywołanie w sesji (`browser-inspector-first`) | `--no-daemon` (CI, `browser-inspector-cold`) |
| --- | ---: | ---: | ---: | ---: |
| start klienta (node + `node:*` + steps.schema) | 72 | 72 | 72 | 72 |
| spawn keepera → nasłuch | — | — | 45 | — |
| connect + token + żądanie/odpowiedź po pipe | 5 | 5 | 5 | — |
| dispatch, kolejka, adresowanie wartości | 2 | 2 | 2 | — |
| **queuedMs: scrub poprzedniego przebiegu w kolejce lane’u** (1 origin: DOMStorage.clear 1 + swap generacji 1 + clearDataForOrigin 1 + resety kontekstu ~10 + resetNavigationHistory 2) | 0 | **15** | — | — |
| import playwright-core | 0 | 0 | 270 | 270 |
| launch Chrome | 0 | 0 | 300 | 300 |
| kontekst + strona (10 + 105) | 0 | 0 | 115 | 115 |
| goto `load` (ta sama karta 55 / świeży kontekst 250) | 55 | 55 | 250 | 250 |
| waitFor `[data-testid=request-form]` | 10 | 10 | 10 | 10 |
| 5 × click à 44 | 220 | 220 | 220 | 220 |
| 4 × fill à 10 | 40 | 40 | 40 | 40 |
| select | 12 | 12 | 12 | 12 |
| waitFor `[data-testid=confirmation]` | 40 | 40 | 40 | 40 |
| 5 × extract + 1 × evaluate à 2 | 12 | 12 | 12 | 12 |
| 2 × screenshot CDP PNG à 25 (zapis asynchroniczny) | 50 | 50 | 50 | 50 |
| dowód końcowy (el-count 6 + title/text/elements 6); `final.png` pominięty (`auto`) | 12 | 12 | 12 | 12 |
| `writeMs`: ogon zapisu zrzutów (`shotsMs`) + zaległe odczyty ciał przez recorder (`settleMs`) | 10 | 10 | 10 | 10 |
| odpowiedź + wydruk + wyjście klienta | 6 | 6 | 6 | 5 |
| context.close + browser.close | — | — | — | 200 |
| **razem** | **546** | **561** | **1 469** | **1 618** |
| vs MCP warm 2 900 / 1. przebieg 3 600 | **5,3× / 6,6×** | 5,2× / 6,4× | 2,4× (vs 3 600) | 2,2× (vs 3 600) |
| vs `mcp-lean --timeout-settle 100` warm 1 000 | **1,8×** | 1,8× | — | — |
| pesymistycznie: launch 440 | — | — | 1 609 (2,2×) | 1 758 (2,0×) |

Wiersze poza flow benchu (do BUDGET.md, z osobnym pomiarem):

| sytuacja | koszt | uwaga |
| --- | ---: | --- |
| pierwsze wejście na **inny origin** na tej samej karcie | 75–320 | site isolation: nowy renderer per site; spare renderer Chrome pomaga raz |
| goto po `--fresh` / lane pierwszy raz / auth / video (świeży kontekst, prewarm z puli spare) | 190–441 | `browser-inspector-warm-fresh` ≈ 546 − 55 + 441 = 932 ms = **3,1×** — ścieżka izolacyjnie świeża 5× nie robi i dokument tego nie obiecuje |
| scrub między snapshotami jednego batchu (w stoperze) | 12–35 | 1 origin ≈ 12, 4 originy 34; popup +20/szt.; karta po `crash` +215 (`tab: new`) |
| app-factory, 6 snapshotów, `parallel: 1`, config bez zmian | ≈ 8 000–10 000 | 4 × networkidle (666–2056) + 4 200 snu + kroki; §3.4 |
| app-factory po migracji (`settled`, `waitFor`), `parallel: 1` / `3` | ≈ 2 500 / 1 300–1 600 | lane 1–2 płacą raz świeży kontekst |

Wnioski liczone, nie życzone:

- **Warm 546 ms = 5,3×, margines 34 ms (6 %) — nazwany, nie ukryty.** Zjada go jedna pauza GC albo skan Defendera na `report.json`; dlatego bench liczy medianę z n ≥ 10, raportuje p90, a BUDGET.md czerwieni każdą fazę z rozjazdem > 25 % **oraz iloraz < 5,0**. Dźwignie mierzone osobno: flagi frame-rate (click ~32 ⇒ ~486 ms, 6,0× — domyślnie włączone, więc **pomiar prawdopodobnie wyjdzie 480–500 ms**; budżet 546 to gwarancja projektowa, nie oczekiwana wartość), CDP-zrzut (bez niego +38 ⇒ 584 ms, 4,97× — poniżej progu, stąd CDP jest domyślne), reużycie karty (świeża karta +160 ⇒ 706 ms, 4,1×; świeży kontekst ⇒ 3,1×), prewarm (−115 na każdym świeżym kontekście), `settled` (dotyczy app-factory, nie flow benchu).
- **`browser-inspector-warm-tight` 561 ms = 5,2×**: scrub poprzedniego przebiegu wchodzi do `queuedMs` następnego, gdy klient N+1 łączy się < 15 ms po odpowiedzi dla N; oba warianty są w RAPORT.md, `queuedMs` i `scrubMs` są w `timing` i w BUDGET.md osobno.
- **Zimno nie robi 5× w żadnym projekcie na playwright-core**: import + launch + kontekst + świeże goto = 935 ms > cały próg 720 ms. `browser-inspector-first` 1,47 s = 2,4×, `browser-inspector-cold` 1,62 s = 2,2× — obie raportowane osobno, obie nie gorsze od starej skryby (1,6 s). 5× jest własnością **każdego wywołania po pierwszym** (keeper żyje 30 min od ostatniego użycia, 60 min z otwartą sesją) albo pierwszego po `browser-inspector up`.
- **Windows**: pierwsze uruchomienie po restarcie (Defender na świeżym `chrome.exe`/`node.exe`) jest droższe; bench raportuje „steady-state cold” z n ≥ 3 medianą, a „first-ever” osobno, poza ilorazami.

**Tokeny** (o200k, mierzone na próbkach z tego dokumentu i w benchu): batch = blok AGENTS.md **158** + komenda ~10 + stdout ~25 + `report.md` **187** ≈ **380 na sesję** (stara skryba 767, MCP 5 549–6 747 ⇒ 15–18×). Sesja interaktywna naive (`open, find, click, snap --diff, form, click, wait, get×3, console, shot×2`; linie 18–27 tok., `find` ~40, `snap --diff` ~60) = 158 + ~400 ≈ **560**; z jednym gołym `browser-inspector snap` (~370) ≈ **960**; agent robiący `snap` po każdej z trzech nawigacji ≈ **1 700** — nadal 4× taniej niż MCP naive (6 747), a jeden `browser-inspector snap` (370) jest tańszy niż jeden `browser_snapshot` MCP (534). Wariant `pnpm browser-inspector` zamiast `browser-inspector` dodaje ~4 tok. na komendę.

---

## 7. Macierz parytetu vs `@playwright/mcp` 0.0.80 (70 narzędzi)

| narzędzie MCP | krok configu | komenda sesji | status |
| --- | --- | --- | --- |
| navigate / navigate_back / reload | `goto` / `back` / `forward` / `reload` | `open` / `back` / `forward` / `reload` | ✅ |
| click (double, right, modifiers) | `click` {button, count, modifiers} | `click [--double] [--right] [--mod]` | ✅ |
| type / press_key / hover / select_option | `type` {slowly} / `fill` / `press` / `hover` / `select` | `type` / `fill [--enter]` / `press` / `hover` / `select` | ✅ |
| fill_form | `form` {fields[{selector\|ref, value\|valueFromEnv}]} | `form e3="Jan" e5=@{APP_PASS}` | ✅ |
| drag / drop / file_upload | `drag` / `upload` (plik czyta klient) | `drag` / `upload` | ✅ |
| snapshot / find / generate_locator | `snapshot` {name} → `snap.md/json`; `elements.md` zawsze | `snap [--max 25 --diff --around --grep --names --all]` / `find` / `locator eN` | ✅ (tylko pełny snapshot `ai`, filtry w JS) |
| take_screenshot (page / fullPage / element, png / jpeg) / pdf_save | `screenshot` {fullPage, ref\|selector, format, quality} / `pdf` | `shot [--full] [--el eN] [--jpeg]` / `pdf` | ✅ |
| console_messages (level) | zawsze w raporcie | `console [--level info\|warn\|error] [--all --tail]` | ✅ |
| network_requests / **network_request** / network_state_set | `console`, `network`, `captureNetwork`, `captureBodies` / `fetch` / `offline` | `net [--failed --all]` / **`net <n> [--body] [--req]`** / `fetch` / `offline on\|off` | ✅ |
| route / route_list / unroute | `routes[]` (przed goto) + `route` / `unroute` | `route` / `routes` / `unroute` | ✅ |
| wait_for (text / textGone / time) | `wait` {ms\|text\|textGone\|url} + `waitFor` (selektor — MCP tego nie ma) | `wait --text\|--gone\|--ms\|--url\|--sel` | ✅ |
| handle_dialog | `dialogs` (polityka) + `dialog` (następny) | `dialog accept\|dismiss [--text] [--once]`, `dialog` (pokaż) | ✅ (polityka przed akcją; `beforeunload` auto-accept) |
| tabs (list / new / select / close) | `tab` {action, target, url}; popupy w `tabs[]` | `tabs` / `tab new\|<n>\|close` | ✅ |
| resize | `resize` | `resize WxH` | ✅ |
| evaluate | `evaluate` {expression, timeout} (CDP `Runtime.evaluate` + `withDeadline`) | `eval <expr> [--el eN]` | ✅ |
| run_code_unsafe | — (odrzucone w configu bramki) | `run --file s.mjs` pod `BROWSER_INSPECTOR_UNSAFE=1` | ⚠️ tylko sesja, jawnie RCE-równoważne |
| storage_state / set_storage_state | `state` {save\|load} + `auth.storageState` | `state save\|load plik` | ✅ |
| cookie_* (5), localstorage_* (5), sessionstorage_* (5) | `storage` {kind, op, key, value\|valueFromEnv, name} | `storage cookies\|local\|session list\|get\|set\|del\|clear` | ✅ (15 narzędzi = 1 krok) |
| verify_element_visible / text_visible / list_visible / value | `verify` {kind: visible\|hidden\|text\|value\|list\|url\|title\|count, soft} | `verify … [--soft]` | ✅ (+ url, title, count, soft) |
| highlight / hide_highlight | `screenshot` {mark: ref} | `shot --mark eN` | ✅ przez artefakt |
| mouse_click_xy / move_xy / drag_xy / down / up / wheel | `mouse` {action, x, y, toX, toY, dy} | `mouse click\|move\|down\|up\|wheel\|drag …` | ✅ |
| start/stop_tracing | `trace: true` | `trace start\|stop [plik.zip]` | ✅ |
| start/stop_video | `video: true` (wymusza `fresh`) | `open --video` | ✅ |
| close / get_config | koniec snapshotu / `_manifest.json` | `close` / `status` | ✅ |
| install | — | — | ❌ celowo: systemowy Chrome/Edge |
| resume, annotate, video_chapter, video_show/hide_actions | — | — | ❌ celowo: `page.pause()` i kosmetyka nagrań headed |
| (brak w MCP) | `extract`, `waitFor` na selektor, `auth.*`, `--junit`, `--fail-on-incomplete`, `--stamp`, `--parallel`, `settled`, exit 0 przy nieudanym kroku, `soft` | `export`, `script`, `doctor`, `lint-config`, `frame` | — |

---

## 8. Repozytorium, moduły, testy, bramki, pakowanie, app-factory

```
scribe-devtools/
  package.json                      # workspaces: ["packages/*", "bench"]; scripts: verify, test, smoke, docs, code-index, portable, bench
  .npmrc (ignore-scripts, engine-strict) · prettier.config.mjs (120 kol., LF) · .editorconfig · .gitattributes
  AGENTS.md · CLAUDE.md → AGENTS.md · README.md · CHANGELOG.md · CODE-INDEX.md (generowany) · docs/DESIGN.md · docs/STEPS.md (generowany)
  vitest.config.mts · tsconfig.json (checkJs, noEmit) · .githooks/pre-commit
  scripts/index-code.mjs · scripts/portable-zip.mjs · scripts/check-instruction-sync.mjs · scripts/gen-steps-doc.mjs
  packages/browser-inspector/
    package.json                    # @scribe-devtools/browser-inspector, "bin": { "browser-inspector": "bin/browser-inspector.mjs" }, playwright-core "1.62.1" (exact), engines >=22
    bin/browser-inspector.mjs                      # wejście: parseArgs → keeper (sesja, batch) | in-process (batch --no-daemon, script)
    src/cli.mjs                     # parseArgs(argv, STEPS) → { mode, command|configPath, options } — czysta
    src/steps.schema.mjs            # STEPS: kind/argv/flags/config/validate/describe/help — importowane przez klienta
    src/steps.run.mjs               # RUNNERS: run(ctx, s) per krok — importowane tylko przez silnik
    src/config.mjs                  # loadConfig(path, cwd): stary schemat + nowe pola; walidacja refów; lintConfig()
    src/engine.mjs                  # createEngine: skład czterech części niżej, status, close, listenery (`disconnected`)
    src/lanes.mjs                   # createLanePool: launch, lane'y scratch/spare, scrub, RSS, recykling, launchPlan/launchBrowser
    src/steps.ctx.mjs               # makeStepContext + runStep: jeden kontekst, który widzi każdy RUNNER (batch i sesja)
    src/flow.mjs                    # createFlowRunner: runFlow (jeden snapshot), runBatch (cały config), finishRun (manifest, JUnit)
    src/session.mjs                 # createSessions: openSession, runCommand, runScript, exportFlow, dziennik sesji
    src/recorder.mjs                # attachRecorder(page): console/net/dialog/popup/crash, since-last, bodies ≤ 64 KB
    src/isolation.mjs               # scrubPlan(state) → ops (czysta), applyScrub(lane, plan), needsFreshContext, GEN_SCRIPT
    src/settle.mjs                  # waitSettled(page, recorder, { quietMs, capMs })
    src/capture.mjs                 # screenshotFast (CDP), finalEvidence, elementsMap, pageText, evaluateWithTimeout (+ mapowanie wyniku)
    src/snapshot.mjs                # compactSnapshot, boxJoin, findInSnapshot, diffSnapshot, aroundRef, namesContext, locatorFor, resolveRef
    src/report.mjs                  # renderReportMd, renderElementsMd, renderJUnit, buildManifest (run + per snapshot), writeArtifacts
    src/session-log.mjs             # appendJournal, exportFlow(journal) → config — czyste
    src/print.mjs                   # formatLine, deltas, truncate — czyste
    src/redact.mjs                  # redact(text, secretValues), maskSnapshotValues — jedna funkcja dla wszystkich miejsc
    src/auth.mjs                    # ensureSession (login/oauth/storageState) — port ze skryby
    src/keeper.mjs                  # net server, lock O_EXCL, NDJSON, token, kolejki, idle/TTL, prewarm, lane’y, recykling
    src/keeper.requests.mjs         # protokół (wersja, `done`, EngineUnavailableError) + handleRequest i cztery uchwyty zadań
    src/client.mjs                  # connect/spawn/retry/fallback(batch only), resolveValues, files, doctor, print, exit
    src/paths.mjs                   # identityHash (fnv1a), pipeName, pidFile, lockFile, sessionDir, outputDir, isCI, daemonEnabled
    src/deadline.mjs                # withDeadline, degradeTo (z wersji TS)
    src/types.d.ts                  # PageLike, StepContext, StepDef, Report, Manifest, KeeperRequest/Response, Timing
    test/*.test.mjs                 # vitest z FakePage (PageLike)
    test/client-imports.test.mjs    # graf modułów klienta: nigdy playwright-core / engine|lanes|flow|session|steps.ctx|steps.run.mjs
    test/keeper.*.test.mjs          # prawdziwy pipe na losowej nazwie, silnik = fake; identity, idle, queues, secrets
    test/compat/smoke-gate.test.mjs # spawn bin/browser-inspector.mjs <config app-factory> --stamp X: --no-daemon, keeper ×2, --parallel 3; kopia evaluateReports()
    test/smoke/smoke.test.mjs       # prawdziwy Chrome: fixtures/*.html przez node:http, flow + sesja przez keepera + izolacja
    test/perf/*.perf.test.mjs       # opt-in (BROWSER_INSPECTOR_PERF=1): client-start ≤ BROWSER_INSPECTOR_PERF_CLIENT_MS (120)
    test/hooks/trace-loads.mjs      # hook --import rejestrujący załadowane moduły
    fixtures/form.html · dialog.html · upload.html · drag.html · tabs.html · iframe.html · slow.html · routes.html · storage.html · relabel.html
    templates/flow.md               # dokument dla agenta (port templates/browser-inspector-flow.md)
  bench/                            # gpt-tokenizer, @playwright/mcp "0.0.80" (exact), app/, probes/, serve.mjs, bench.mjs, browser-inspector-run.mjs, mcp-run.mjs, mcp-client.mjs, tokens.mjs, time-run.mjs, task.mjs, raport.mjs, budget.mjs
```

**Interfejs testowalności.** `run(ctx, step)` dostaje `ctx = { page, context, cdp, dir, timeoutMs, capture, recorder, sel, values, session, redact }`, gdzie `page` spełnia `PageLike` (JSDoc typedef: goto, click, fill, type, press, hover, selectOption, check, setInputFiles, dragAndDrop, waitForSelector, waitForFunction, waitForTimeout, screenshot, pdf, evaluate, locator, ariaSnapshot, title, url, goBack, goForward, reload, setViewportSize, emulateMedia, route, unroute, on/off, frames, mouse) i `cdp = { send }`. `FakePage` rejestruje wywołania i wstrzykuje błędy — pokrywa mapowanie krok→wywołanie, porażkę → `completed:false` + `final.png`, `describe` bez wartości, walidację (config app-factory jako fixture), raport, kompaktowanie i box-join (fixture YAML bookstore), `find`, `diff`, `exportFlow`, `scrubPlan`, `needsFreshContext`, parser CLI, protokół keepera, redakcję. Smoke z przeglądarką jest jeden.

**Bramki.** `npm run verify` = `prettier --check` → `vitest run` (unit + keeper + compat + client-imports) → `tsc --noEmit` (checkJs) → `index-code --check` → `gen-steps-doc --check` → `check-instruction-sync` (blok w AGENTS.md ≡ `INSTRUCTION` w `bench/browser-inspector-run.mjs`) → `smoke` (`BROWSER_INSPECTOR_SKIP_SMOKE=1` tylko bez Chrome). Hook pre-commit regeneruje CODE-INDEX.md i docs/STEPS.md.

**Pakowanie.** Bez bundlera: `npm run portable` pakuje `packages/browser-inspector` + `node_modules/playwright-core` + marker `PORTABLE` + shim `browser-inspector.cmd`/`browser-inspector`; po rozpakowaniu `node packages/browser-inspector/bin/browser-inspector.mjs` działa z Node ≥ 22 i systemowym Chrome/Edge. Wydanie jak w scribe: CHANGELOG `Unreleased` → wersja → tag → `gh release create` z zipem.

**Integracja z app-factory** (PR ~25 linii + spec, nie „3 linie”): nowa funkcja `findRunner(env, exists, root)` w `smoke-browser.mjs` z tabelą kandydatów `[{ dir: env.SCRIBE_DEVTOOLS_DIR, pipeline: 'packages/browser-inspector/bin/browser-inspector.mjs', ready: 'node_modules/playwright-core/package.json', fix: 'npm ci --prefix <dir>' }, { dir: '../scribe-devtools', … }, { dir: findScribeDir(...), pipeline: 'integrations/dist/browser-inspector/read-browser-inspector.js', ready: <pipeline>, fix: 'npm --prefix <dir> run build' }]` zwracająca `{ dir, pipeline, fixCommand }`; `findScribeDir` **zostaje bez zmian** (jej spec też), `findRunner` dostaje własne przypadki (`SCRIBE_DEVTOOLS_DIR` wygrywa, potem `../scribe-devtools`, potem scribe). Wywołanie `spawn(node, [pipeline, CONFIG, ...forwarded])` zostaje literalnie. Pod `CI=true` bramka jedzie bez keepera; lokalnie z keeperem. Do `package.json` app-factory: skrypt `"browser-inspector"`; do AGENTS.md app-factory: dwa zdania o `pnpm browser-inspector`. Config i `evaluateReports` nietknięte; `test/compat/smoke-gate.test.mjs` powtarza dokładnie tę ścieżkę odczytu, dwa razy z rzędu przez keepera (drugi przebieg: `dziennik-uczen.completed === true`, `nowiro-jezyk.extracts['naglowek-pl']` po polsku) i z `--parallel 3` (identyczny zbiór `completed`).

**Instrukcja w AGENTS.md** (koszt stały **158 tokenów** o200k przy limicie **200** — AC-6; limit podniesiony ze 150, bo właściciel płaci tokenami za pełną nazwę `browser-inspector` zamiast skrótu; mierzony co do znaku, ≡ `INSTRUCTION` benchu):

> Przeglądarka: `browser-inspector <config.json> [--stamp X]` wykonuje flow, wynik w `<outputDir>/<stamp>/<snapshot>/report.md` (nagłówek, `## errors`, `## values`; `## steps` tylko przy FAIL); nieudany krok = wynik, exit 0. Sesja: `browser-inspector open <url>`, `browser-inspector find <tekst>` / `browser-inspector snap` dają refy `eN`; `browser-inspector click|fill|form|press|select|wait|shot|eval|console|net …` drukują jedną linię (exit 1 = FAIL); `browser-inspector export flow.json` zapisuje sesję jako config.

---

## 9. Bench — jak powstanie RAPORT.md

`bench/` dziedziczy metodykę i kod z `demo/bench` (mcp-client.mjs, mcp-run.mjs, tokens.mjs — o200k jako proxy, task.mjs z bramką `checkFindings`: numer, kategoria, priorytet, komunikat walidacji, błąd konsoli, 2 zrzuty), fixture = statyczny build formularza demo w `bench/app/` (commitowany dist, `serve.mjs`). `@playwright/mcp` przypięte na **0.0.80** w `bench/package.json` ↔ `.mcp.json` ↔ `.vscode/mcp.json` (test); baseline 0.0.79 z RAPORT.md scribe dostaje kolumnę porównawczą, ale **każdy iloraz liczy się wobec pomiaru 0.0.80 z tego samego dnia i tej samej maszyny**.

| wariant | jak mierzony | co pokazuje |
| --- | --- | --- |
| `browser-inspector-cold` (`--no-daemon`) | `browser-inspector stop`, czekanie na zniknięcie pid **i** potomnych `chrome.exe` (do 2 s), × 3, mediana od `spawn` do `exit` | ścieżka CI |
| `browser-inspector-first` | `browser-inspector stop`, potem 1 wywołanie z keeperem — start keepera W stoperze (× 3, mediana; „first-ever” po restarcie n=1, poza ilorazami) | 1. użycie w sesji |
| `browser-inspector-warm` | po `browser-inspector-first`: **n ≥ 10** wywołań z przerwą **300 ms** między nimi, mediana + p90; keeper i karta ciepłe | 2.+ użycie — tu liczy się 5× |
| `browser-inspector-warm-tight` | jak wyżej **bez przerwy** (następny `spawn` natychmiast po `exit`); `queuedMs` z `report.json` raportowany osobno | koszt scrubu w kolejce |
| `browser-inspector-warm-fresh` | jak `browser-inspector-warm` z `--fresh` | izolacja świeża, jawnie < 5× |
| `browser-inspector-interactive` | `open, find, click, snap --diff, form, click, wait, get×3, console, shot×2` + wariant z jednym gołym `browser-inspector snap` — każda komenda osobnym procesem `node`; tokeny = komendy + stdout + przeczytane pliki | parytet z MCP naive |
| `keeper-survives-shell` | `browser-inspector up` w podprocesie powłoki (`cmd /c`, `bash -c`, `pwsh -c`), wyjście powłoki, `browser-inspector status` z nowego procesu | czy 5× dostanie agent, nie tylko bench |
| `app-factory` | 6 snapshotów app-factory (kopia configu + buildów) z `parallel: 1` i `3`, config bez zmian i po `lint-config` | to, na czym testuje właściciel |
| `mcp-naive`, `mcp-lean`, **`mcp-lean --timeout-settle 100`** | serwer raz, 1. przebieg (n=1) + mediana kolejnych z przerwą 300 ms; reset `about:blank` przed stoperem | trzy kolumny w **tabeli nagłówkowej** RAPORT.md |
| sondy | `browser-inspector-warm` bez flag frame-rate; z `motion: reduce`; ze zrzutem PW zamiast CDP; `browser-inspector` vs `pnpm browser-inspector` (tokeny) | skąd biorą się różnice |

Zasady uczciwości (spisane w RAPORT.md, generowane): ten sam tokenizer po obu stronach; liczone jest to, co wchodzi do kontekstu (dla `browser-inspector`: blok AGENTS.md jako koszt stały + komendy + stdout + `report.md` w całości); czas od `spawn` do `exit` prawdziwego procesu klienta; przerwa 300 ms między powtórzeniami **po obu stronach** (bo scrub `browser-inspector` i `about:blank` MCP są poza stoperem tylko wtedy); `browser-inspector-warm-tight` pokazuje, co się dzieje bez przerwy; sprzęt, wersje i `timing.mode` każdego przebiegu w nagłówku (przebieg z `mode ≠ warm` w kolumnie warm unieważnia pomiar). `bench/budget.mjs` generuje **BUDGET.md** z `report.json.timing` i `_manifest.json`: kolumna „projekt §6” obok „pomiar”, `queuedMs`/`scrubMs`/`cacheHits` osobno, każda faza z rozjazdem > 25 % i **każdy iloraz < 5,0** jako czerwony wiersz. `npm run bench` pisze `RAPORT.md`, `WYNIKI.md`, `BUDGET.md`, `bench/out/results.json` i blok `BENCH:START/END` w README; `npm run bench -- --assert-speedup 5` asertuje na **medianie** `browser-inspector-warm` wobec mediany `mcp-naive` warm i raportuje p90 (opt-in, nie w `verify`). Liczba „5×” w README jest ilorazem z pomiaru, nigdy z tego dokumentu.

---

## 10. Ryzyka i mitygacje

| ryzyko | mitygacja |
| --- | --- |
| margines 5× (34 ms, 6 %) zjedzą inne maszyny / cięższe aplikacje / GC / Defender | mediana n ≥ 10 + p90; dźwignie mierzone osobno; flagi domyślnie włączone (oczekiwane 480–500 ms); BUDGET.md pokazuje fazę, która odjechała; próg dotyczy zadania referencyjnego; `browser-inspector-warm-tight` i `--fresh` raportowane jako niższe ilorazy, nie ukrywane |
| baseline miękki (2/3 różnicy to `--timeout-settle 500`) | kolumna `mcp-lean --timeout-settle 100` w nagłówku RAPORT.md; wniosek pisany jako „5× vs domyślne, 1,8× vs zestrojony” |
| keeper nie przeżywa powłoki (Job Object) → każde wywołanie zimne | `browser-inspector doctor`, `timing.mode` w każdym raporcie, wariant `keeper-survives-shell`; README: `browser-inspector up` jako hook SessionStart |
| stary keeper po edycji `src/` / dwa checkouty | hash z `realpath(bin/browser-inspector.mjs)` + `srcStamp`; `browser-inspector status` drukuje hash |
| refy: mapa ostatniego snapshotu, zmiana etykiety = nowy ref, `f<seq>` po nawigacji | wyłącznie pełny snapshot `ai`; filtry w JS; `count()` przed akcją; test regresji „ref sprzed `verify list` żyje”; smoke „zmiana etykiety → FAIL < 100 ms”; playwright-core przypięty exact |
| brud między przebiegami na jednej karcie | `scrubPlan` testowany; smoke: A ustawia localStorage+sessionStorage+cookie+route+dialog, B nic nie widzi; compat: app-factory dwa razy przez keepera; `Page.resetNavigationHistory`; `tab: kept\|new` w raporcie |
| marker `__bi_gen` w sessionStorage widoczny dla aplikacji | jeden klucz, nazwany w nagłówku raportu; `isolation: "fresh"` dla purystów |
| stale cache po rebuildzie (nginx/serve z `Last-Modified`) | `cacheHitsDocument` w raporcie + czerwony wiersz w BUDGET.md; `--fresh` = nowy kontekst + `Network.clearBrowserCache` |
| `serviceWorkers: 'block'` zmienia aplikację | tylko na scratch; `allow` w `fresh`; `sw=blocked` w nagłówku |
| sekrety w gnieździe / w artefaktach | protokół bez `env`; `secretValues` + `redact()` we wszystkich miejscach; pola password bez wartości w snapshocie; jeden test |
| osierocony keeper na runnerze CI | lista `isCI`; `BROWSER_INSPECTOR_DAEMON=1` jawnie; idle 30 min; `browser-inspector stop` |
| keeper nie wstaje (brak Chrome, lock, antywirus) | nasłuch przed importem; 3 s retry → batch w procesie z `keeper: fallback`; sesja: `exit 2` z instrukcją; `E_BROWSER_MISSING` z listą prób |
| wisząca strona / nierozwiązana obietnica w `evaluate` | `withDeadline` na każdym kroku i wokół `Runtime.evaluate`; `timeout` CDP przerywa część synchroniczną; kontekst sesji zamykany, przeglądarka żyje |
| renderer crash / wzrost RSS po setkach flow | `page.on('crash')` → odbudowa karty; recykling po `BROWSER_INSPECTOR_MAX_JOBS`/RSS między zadaniami |
| wielkie drzewa a11y (48 KB) w kontekście | `snap --max 25`, `find`, `--diff`; pełne drzewo tylko do pliku |
| `settled` za wcześnie (animacje Material, wolny backend) | cap + `waitFor`/`wait --text`; `networkidle` 1:1; `lint-config` proponuje `waitFor`, nie `settled`, dla `wait ms` |
| start klienta cicho rośnie | `client-imports.test` + perf-test `browser-inspector help` ≤ 120 ms |
| dryf docs ↔ kod | `docs/STEPS.md` generowany z `STEPS` (test świeżości), `browser-inspector help` z tej samej tabeli, instrukcja AGENTS.md ≡ `INSTRUCTION` benchu |
| kompatybilność `report.json` / bramki | config app-factory jako fixture; `smoke-gate.test` z kopią `evaluateReports()`; `navigationError` tylko gdy istnieje; forma `steps[i].error` przypięta |

### Gdzie celowo NIE dodajemy

Transportu MCP/HTTP, bundlera, zoda (tabela STEPS jest schematem), własnego silnika selektorów/CDP-engine, ping-pongu kart (zmierzone: gorszy), `about:blank` między przebiegami (zmierzone: bez zysku), lean-click z `force: true`, kroku wykonującego pliki `.mjs` z configu (zostaje tylko `browser-inspector run` w sesji pod `BROWSER_INSPECTOR_UNSAFE=1`), retry/asercji frameworkowych, Firefoksa/WebKita, `Cache-Control: max-age=0`, `reducedMotion` i JPEG jako domyślnych, „inteligentnego” settle po akcji w batchu, `isTTY` do czegokolwiek.

---

## 11. Odrzucone uwagi (z uzasadnieniem)

| uwaga | decyzja |
| --- | --- |
| Obie recenzje: **ping-pong dwóch kart scratch** (odpowiedź z czystej, scrub brudnej w tle) | **Odrzucone po pomiarze**: goto na świeżej karcie w reużytym kontekście = 212–262 ms (renderer ginie z kartą), wobec 49–74 ms na tej samej karcie — ping-pong kosztowałby +160 ms na każdym przebiegu, żeby oszczędzić ≤ 15 ms w kolejce. Zamiast tego: scrub w miejscu (`DOMStorage.clear` + skrypt generacji + `resetNavigationHistory`) 12–35 ms, i tak raportowany jako `queuedMs` w `browser-inspector-warm-tight` |
| Recenzja #2: scrub między snapshotami batchu „~110 ms: clearDataForOrigin + nowa karta” | Przyjęty co do zasady (scrub między snapshotami jest obowiązkowy i w stoperze), ale bez nowej karty: 12–35 ms |
| Recenzja #2: `findScribeDir` ma zwracać `{ dir, pipeline, fixCommand }` | Zamiast zmiany sygnatury (łamie istniejący spec) — nowa `findRunner()` z tabelą kandydatów; `findScribeDir` i jej spec nietknięte |
| Recenzja #1: perf-test `browser-inspector help` ≤ 100 ms | Próg testu **120 ms** (mediana z 5), bo 100 ms jest flaky na obciążonej maszynie; budżet i tak liczy klienta po 72 ms, a BUDGET.md pokazuje zmierzoną medianę |
| Recenzja #2: `BUILD_ID` na liście CI | Nie — `BUILD_ID` bywa ustawiane poza CI (Netlify, lokalne skrypty); Jenkins jest pokryty przez `JENKINS_URL` |
| Recenzja #2: kontekst nazw w `find` z przodka (domyślnie) | Przyjęte tylko pod `--names` (recenzja #1 zmierzyła +12 tok. na linię); źródło zdefiniowane w §4.3 |
| Recenzja #1: `snap --depth` jako filtr | Nie ma `--depth` — kompakt i tak spłaszcza wcięcie; `--around` i `--grep` pokrywają potrzebę bez nowego pojęcia |
| Recenzja #2: sessionStorage wymaga nowej karty | Nieprawda po sondzie: `DOMStorage.clear` (bieżący origin) + skrypt generacji na `Page.addScriptToEvaluateOnNewDocument` (pozostałe originy) czyszczą go w miejscu; test izolacji pokrywa oba originy |
