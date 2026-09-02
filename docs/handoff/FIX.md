# Handoff FIX → wszystkie WP — poprawki po przeglądzie kodu (20 uwag)

Zastosowane w drzewie roboczym po recenzji dwóch agentów. Każda uwaga ma test regresyjny; poniżej
co zmieniło się w kontrakcie między pakietami i gdzie implementacja świadomie odbiega od DESIGN.md
(albo od poprzednich handoffów) — z powodem.

## Zmiany interfejsu silnika (`docs/handoff/WP5.md`, `EngineLike` w `keeper.mjs`)

| element                        | zmiana                                                                                                                                                                                                                             |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ctx.runJob(key, fn)`          | **odrzuca** `EngineUnavailableError` (`code` = kod silnika, np. `E_BROWSER_MISSING`, albo `E_ENGINE`) zamiast zwracać `KeeperDone`; `runBatch` mapuje na `FAIL <code>: …`, sesja/skrypt/eksport przez `engineOr()`                 |
| `ctx.afterAnswer(key, eng, fn)` | nowe: praca kolejkowana na tym samym kluczu z WNĘTRZA zadania — scrub lane’u po odpowiedzi; następny klient płaci ją jako `queuedMs`; po jej końcu keeper ponownie uzbraja idle i sprawdza recykling                              |
| `ctx.persistent`               | `true` w keeperze, `false` na ścieżce w procesie (`fallback`/`no-daemon`) — tam scrub po odpowiedzi nie ma sensu (przeglądarka zamyka się zaraz po `done`)                                                                         |
| `engine.scrubIfDirty(lane)`    | nowe: scrub tylko brudnego, niezajętego lane’u (`{ ms: 0, plan: [], ops: [] }` na czystym); keeper woła to (albo `scrub`, gdy silnik nie ma `scrubIfDirty`)                                                                        |
| `engine.scrub(lane)`           | zwraca dodatkowo `ops: [{ op, ms }]` — koszt każdej operacji; operacje > 50 ms trafiają do logu keepera                                                                                                                             |
| `engine.sampleRss()`           | nowe: próbka RSS przeglądarki + rendererów w tle, cache dla `status().browserRssMb`; keeper woła co `RSS_CHECK_EVERY` (10) zadań po odpowiedzi                                                                                     |
| `engine.status()`              | **nie spawnuje procesu** (kontrakt: `modeFor()` woła to na starcie każdego zadania); `browserRssMb`/`rssMb` = cache, `pids[]`, `maxJobs`, `maxRssMb`                                                                               |
| `engine.recycle()`             | bez zmian w sygnaturze, ale `runFlow` już go NIE woła; `closeBrowser()` kończy wszystkie sesje (`endSession`) zanim zamknie przeglądarkę                                                                                            |
| `createEngine` opcje           | `scrubOpMs` (`BI_SCRUB_OP_MS`, 2000), `rssOf(pids)` (wstrzykiwany sampler dla testów)                                                                                                                                              |
| `Session`                      | `secretValues: Set<string>` (suma od `open`), `writes: Promise` (łańcuch dziennik/console/net — `close`/`export`/`endSession` czekają), `journalSeq`                                                                                |
| `session-log.mjs`              | `formatJournalLine(entry, secretValues)`, `journalLineCount(file)` (eksporty); `appendJournal` zostaje dla innych wywołujących                                                                                                     |
| `NetEntry.bodySkipped`         | `'stream' \| 'type' \| 'too large' \| 'timeout'` — powód braku ciała; `bi net <n> --body` drukuje `(no body captured: <powód>)`                                                                                                       |
| klient                         | `exchange(socket, request, onProgress, { timeoutMs })`; `BI_REQUEST_TIMEOUT_MS` (10 min, każda linia z keepera resetuje); `bi stop`/`bi status` bez keepera dopisują `stale pid file <ścieżka>`                                    |
| `paths.mjs`                    | `IdentityParts.unsafe` (`BI_UNSAFE === '1'`) wchodzi do `identityHash`                                                                                                                                                              |
| `steps.schema.mjs`             | `splitPoint(pair)` (eksport) — pierwszy `=` na głębokości 0 poza cudzysłowami                                                                                                                                                       |
| fake engine (testy)            | `BI_FAKE_LAUNCH_FAIL=1` (createEngine odrzuca jak brak Chrome), `BI_FAKE_SCRUB_MS`, `BI_FAKE_RSS_MB`; `scrubIfDirty`, `sampleRss`, `runFlow` loguje `storageState`, `fill` → `get` echo (test sumy sekretów)                        |

## Odstępstwa od DESIGN.md (do naniesienia w dokumencie przez właściciela WP1/WP8)

1. **§2.5 hash tożsamości** — dodany składnik `BI_UNSAFE` (`'unsafe'` w tekście hasha). Powód (uwaga 10):
   bramka `bi run --file` czytała env KEEPERA (odziedziczone po powłoce, która go spawnowała), nie klienta;
   z `BI_UNSAFE` w hashu keeper „unsafe” to osobny proces i zwykły klient nigdy go nie trafia.
2. **§2.2 rejestrator, ciała `application/json|text/*`** — zawężone do JSON (`+json`, `application/xml`),
   `text/plain|html|xml|csv|markdown|tab-separated-values`; `text/javascript`, `text/css` i
   `text/event-stream` NIE są czytane (uwagi 7 i 18: bundle app-factory 840 KB na snapshot przez pipe,
   `response.text()` na SSE nigdy nie wraca). `content-length` > 64 KB pomijany przed odczytem; każdy
   odczyt i `settle()` ≤ `BODY_READ_MS` (2000).
3. **§2.3 krok 2 (`DOMStorage.clear`)** — zastąpiony `Runtime.evaluate` w stronie (`sessionStorage.clear();
   localStorage.clear()` z `try`), bo mierzony CDP `DOMStorage.clear` zawieszał się na ~500 ms w 1 scrubie
   na 3–5 (uwaga 14); `clearOrigin` i skrypt generacji pokrywają to samo.
4. **§2.2/§2.5 recykling po `BI_MAX_JOBS`/RSS** — decyzja wyłącznie keepera (uwaga 5); silnik w
   `runFlow` nie recyklinguje. Należny recykling pod otwartą sesją albo zajętym lane’em jest
   ODROCZONY (`recycle deferred: N sessions open`) i wykonuje się po najbliższym zadaniu, które zostawi
   pustą kolejkę i zero sesji.
5. **§2.5 stale pid/lock** — „`kill(pid, 0)` żyje” nie wystarcza (recykling pidów po restarcie, `%TEMP%`
   przeżywa restart): plik > `LOCK_YOUNG_MS` (5 s) z żywym pidem, który nie odpowiada na pipe w 200 ms, jest
   stary. Porównanie `processStartAt` z czasem startu żywego procesu NIE jest zaimplementowane (Node nie
   daje go bez `tasklist`/`ps` na ścieżce startu) — sonda pipe’a je zastępuje.
6. **Komentarz w `session-log.mjs` („synchronous on purpose”)** — dziennik sesji jest teraz dopisywany na
   łańcuchu per sesja (`fs.promises.appendFile`), nieczekanym przed odpowiedzią; `export`, `close`
   i `endSession` czekają na łańcuch, a numeracja `seq` jest w pamięci (`journalSeq`, start z
   `journalLineCount` istniejącego pliku). Testy jednostkowe czekają `engine.session(name).writes`
   przed odczytem pliku.

## Uwagi pominięte / częściowo

- **Uwaga 19 (pierwszy `click` po `goto` 440–472 ms w ~30 % ciepłych przebiegów)** — POMINIĘTA: recenzja nie
  wskazała defektu w kodzie, tylko hipotezę (retry actionability po `load`); proponowane „rAF przed
  pierwszą akcją” to dodatkowy `await` na gorącej ścieżce (§6, reguła 7) o nieudowodnionym zysku.
  Zostaje do sondy z `DEBUG=pw:api` w `bench/probes/`; per-krokowe p90 w BUDGET.md to zmiana raportu
  WP9 poza zakresem poprawek.
- **RAPORT.md / BUDGET.md / WYNIKI.md / blok BENCH w README** — NIE zregenerowane (wymagają pełnego
  `npm run bench` z MCP); liczby opisują build sprzed poprawek. Generator (`bench/budget.mjs`,
  `bench/raport.mjs`) ma już nowy tekst: osobne wiersze `queuedMs` / `scrubMs`, opis `bi-warm-tight`,
  poprawny parytet. Następny `npm run bench` zapisze aktualne wartości; oczekiwane: `scrubMs` ≈ 0 w
  `bi-warm`, `queuedMs` ≈ 10–20 w `bi-warm-tight`, p90 bez zawieszeń `DOMStorage.clear`.

## Testy regresyjne (wszystkie zielone, `npm run verify`)

- `keeper.test.mjs`: batch/sesja z silnikiem, który nie wstał (keeper i `--no-daemon`); stary lock/pid z
  ŻYWYM pidem po 60 s; młody lock zaufany; `bi stop` nazywa stary plik pid; recykling odroczony pod sesją
  i wykonany po `close`; próbka RSS po 10 zadaniach; scrub po odpowiedzi = `queuedMs` następnego;
  `auth` z pliku stanu → `storageState` per snapshot (bez dla `auth: false`); logowanie, którego nie da
  się wykonać → `FAIL E_AUTH`, zero przebiegów; sekret z `fill` redagowany w późniejszym `get`.
- `engine.test.mjs`: `recycle()` na wyłączność keepera (trzy przebiegi przy `maxJobs: 2` bez recyklingu,
  sesja kończona przy recyklingu), `status()` bez procesu + `sampleRss`, deadline operacji scrubu →
  odbudowa karty (`tab: new`), `ops` i `scrubIfDirty`, `runBatch` z `auth` (plik stanu → `newContext`
  ze `storageState`).
- `session.test.mjs`: sekret utrzymany przez całą sesję (`get --value`, `eval`, `snap.*`, dziennik).
- `recorder.test.mjs`: bundle/CSS/za duże/SSE bez odczytu z powodem, zawieszony odczyt nie trzyma `settle()`.
- `client.test.mjs`: keeper, który milczy → `BI_REQUEST_TIMEOUT_MS` (sesja `exit 2`, batch fallback).
- `cli.test.mjs` (`form` z selektorami atrybutowymi), `paths.test.mjs` (`BI_UNSAFE` w hashu),
  `bench.test.mjs` (parytet 23/1/2/1 na prawdziwym DESIGN.md), `auth.smoke.test.mjs` (login przez
  `bin/bi.mjs`, port 4565).
