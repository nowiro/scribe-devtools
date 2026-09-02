# Handoff WP6 → WP5, WP7, WP8, WP9 — komendy sesyjne i `bi script`

WP6 dostarczył sekcję sesyjną `src/engine.mjs` (`runCommand`, `runScript`, `exportFlow`, `session`,
`closeSession`, `openSession`; rejestr sesji, ramki, karty, dialogi, delty, dziennik), sekcję sesyjną
`src/steps.run.mjs` (`find`, `snap` z filtrami, `console`, `net`, `net <n>`, `fetch` jako odpowiedź,
`dialog` bez polityki = pokaż, `tabs`, `routes`, `locator`, `trace`, `video`, `run --file` pod `BI_UNSAFE=1`,
`close`, `eval` z polityką inline/plik), `fixtures/tabs.html`, `test/session.test.mjs` (22 testy na FakePage)
i część sesyjną `test/smoke/smoke.test.mjs` (2 testy na prawdziwym Chrome przez prawdziwego keepera i
`bi script --no-daemon`). Keeper i klient (WP5) **nie wymagały zmian** — wołają `runCommand` / `runScript` /
`exportFlow` / `session` / `closeSession` przez `?.`, a silnik je teraz ma.

Zielone (2026-09-02): `npx vitest run --project unit` — 21 plików, **333 testy**; `npx vitest run --project smoke`
— 16/16 (część sesyjna: `bi up` → 45 komend → `bi doctor` → `bi close` → `bi stop` w ≈ 9 s, `bi script`
w ≈ 3 s); `tsc --noEmit` — 0 błędów w całym repo; `prettier --check` na plikach WP6; `index-code --check`
(CODE-INDEX.md zregenerowany); `gen-steps-doc --check`.

**Prośba (plik współdzielony, nieedytowany przez WP6):** do `CHANGELOG.md` sekcji `Unreleased` dopisać:
`- WP6: sesja interaktywna — runCommand (jedna linia ≤ 160 znaków / ≤ 40 tokenów z deltami navigated / dom Δ /
el a→b / +N console.error / +N net failed / dialog), sesje po nazwie na własnym kontekście, open z snap.md/json,
find/snap (--max 25, --diff, --around, --grep, --names, --all), console/net od ostatniego wywołania, net <n> --body/--req,
fetch, frame jako zakres CSS, tabs/tab z popupami, dialog wg polityki z beforeunload auto-accept, shot --mark,
eval --file/--el z eval-NNN.txt, locator, trace, video (open --video), run --file tylko pod BI_UNSAFE=1 (exit 2),
close, dziennik journal.jsonl z selektorem rozwiązanym przy akcji, export, runScript (bi script, adresy script[n]),
fixtures/tabs.html, smoke sesyjny przez keepera (AC-8, AC-9, AC-14, AC-15).`

## Interfejs silnika (to, co woła keeper WP5)

| metoda | kontrakt |
| --- | --- |
| `runCommand(name, step, ctx)` | `ctx = { command, alias, options, cwd, out, values, secretValues, files, mode, queuedMs, redact, log }` (dokładnie to, co wysyła `keeper.runSession`). Zwraca `{ exit, lines, files, timing: { totalMs, stepMs } }`. Nigdy nie rzuca dla problemu ze stroną: nieudany krok = `FAIL <head> · <powód>` z `exit 1`. Wyjątki: brak sesji dla komendy innej niż `open` → `exit 1` `FAIL click e1 · no open session "default" → bi open <url>`; `run --file` bez `BI_UNSAFE=1` → `exit 2` (odmowa PRZED wykonaniem czegokolwiek); zamknięty silnik → rzut |
| `runScript(lines, ctx)` | `lines` = wszystkie linie pliku (komentarze i puste zachowują numerację), `ctx.session` = nazwa; każda linia przez `splitCommandLine` + `parseSessionCommand` (WP5/WP1), adres wartości `script[<indeks linii>]`; **stop na pierwszym niezerowym exit** (jak łańcuch `&&`; `--soft` w linii nie zatrzymuje); błąd parsowania linii → `FAIL script:<nr> · <komunikat>` `exit 2`. Sesja po skrypcie zostaje otwarta, chyba że skrypt ma `close` (w `--no-daemon` proces i tak kończy się z przeglądarką) |
| `exportFlow(name, { file, force, cwd, out, secretValues? })` | `readJournal` → `exportFlow` (WP4) → `writeFlowExport`; `ok export 9 steps → flows/koszyk.json (refs → data-testid/#id/role=)`; `ExportError` (w tym `E_EXISTS` bez `--force`) → `FAIL export · <powód>` `exit 2`. Działa też na zamkniętej sesji (dziennik na dysku pod `sessionDir(out, name)`) |
| `session(name)` | obiekt `Session` albo `undefined` (keeper synchronizuje rejestr po każdej komendzie) |
| `closeSession(name)` | = `endSession`: zamyka kontekst, zapisuje wideo, usuwa z rejestru; idempotentne; woła je TTL keepera i `engine.close()` |
| `openSession(name, { cwd, out?, video?, secretValues? })` | eksport pomocniczy (testy, bench) — to, co `runCommand` robi przy pierwszym `open` |
| `status().sessions[]`, `status().routes` | `[{ name, cwd, out, dir, commands, tabs, openedAt, lastUsedAt }]`; `routes` = suma aktywnych route'ów wszystkich sesji (prośba WP5 spełniona) |

## Model sesji (`engine.mjs`, typ `Session`)

- **Klucz = tylko nazwa** (DESIGN §4.5; PLAN/zlecenie mówiły `cwd|name` — DESIGN wygrywa: `cd` w powłoce albo
  subagent z innym cwd nie otwiera drugiej sesji). `cwd` komendy jest zapamiętywany per komenda i służy tylko do
  ścieżek względnych w linii i do `ctx.cwd` runnerów.
- Sesja = **własny kontekst** z puli `spare` (`freshContext`; `serviceWorkers: 'allow'`), nigdy lane `scratch`
  (scrub zabiłby refy). `open --video` tworzy kontekst z `recordVideo` w `<dir>/video`; plik `video/session.webm`
  powstaje przy `close` / `video stop` (playwright kończy nagranie dopiero po zamknięciu strony).
- Jeden `StepContext` na całą sesję (`makeStepContext({ mode: 'session' })`), odświeżany per komenda (`values`,
  `files`, `secretValues`, `address = argv.<nazwa kanoniczna>` albo `script[n]`, `lines = []`). Stan między
  komendami: `ctx.frame` (zakres CSS), `ctx.routes`, `ctx.lastSnapshot` (`{ text, entries, compact, at }` —
  `writeSnapshotFiles` dokłada teraz `compact`), `session.prevCompact` (do `--diff`), `shotSeq/evalSeq/fetchSeq/runSeq`,
  kursory `console`/`net`/`pageErrors`, `flushed` (ile poszło do `console.jsonl` / `net.jsonl`).
- Każda karta sesji jest „uzbrajana” (`armSessionPage`): własna sesja CDP z `Page.enable` (zrzuty CDP, `Runtime.evaluate`),
  hook `page.on('popup')` (popup wchodzi do TEGO SAMEGO rejestratora i sam jest uzbrajany), hook `page.on('request')`
  zapamiętujący nagłówki i `postData` (rejestrator WP2 ich nie trzyma; `net <n> --req` czyta stąd; cap 500),
  `page.on('close')` zwalnia sesję CDP. Po `tab new/select/close` `ctx.cdp` podąża za `ctx.page`.
- Skrypt init kontekstu (`context.addInitScript`): licznik `MutationObserver` w `window.__bi_dom` — `dom Δ` kosztuje
  jeden odczyt w sondzie po komendzie. Tabela STEPS nadal nie ma `addInitScript` — to wewnętrzny skrypt sesji (§4.2).
- Sonda po komendzie (`sessionProbe`, jeden `page.evaluate` z capem 1,5 s): `el` (`querySelectorAll` po liście ról
  interaktywnych), `dom`, `title`. Przed komendą nic nie jest odpytywane — „before” to wartości zapamiętane z
  poprzedniej sondy. Strona wisząca = linia bez delt, nigdy wiszący agent.
- Limit kroku sesji: `BI_STEP_TIMEOUT_MS` (domyślnie 10 000 jak `stepTimeoutMs` configu); `runStep` dokłada 2 s zapasu.

## Linia stdout (`runCommand` → `print.mjs`)

- `head` = `describeStep(step)` z pierwszym słowem zastąpionym aliasem, jak wpisał agent (`open`, `snap`, `shot`,
  `get`, `eval`), bez `(literal)` / `(from env X)` / `(soft)` — nigdy wartość `fill`.
- `kind: action` (goto/back/forward/reload/click/fill/type/form/press/hover/select/check/uncheck/drag/upload/scroll/
  mouse/wait/waitFor) → `ok <head> · <delty>`; `tab` też dostaje delty (`url /help "Sklep"`).
  Delty (`formatDeltas`, WP1): `navigated → refs f<seq>eN (bi snap)` gdy rejestrator policzył nawigację ramki głównej
  (`seq` = liczba dokumentów karty − 1, **przybliżenie**: iframe'y też zużywają numery sekwencji — WP3 fakt 2; to
  podpowiedź, nie adres), inaczej `url /cart "Koszyk"` przy zmianie URL w tym samym dokumencie, inaczej `dom Δ`;
  `el a→b` **tylko gdy liczba się zmieniła** albo po nawigacji (`el 58`) — bez zmiany nic (`ok fill e39` zostaje
  krótkie); `+N console.error` (console.error + pageerror), `+N net failed`, `dialog <typ> "…" → accepted|dismissed`.
- `goto`/`open` → `formatOpen`: `ok open "Tytuł" · el N · err N · <cwd-relative>/session/<name>/snap.md` — `open`
  robi pełny snapshot i pisze `snap.full.yml` + `snap.md` + `snap.json` (§4.1), `err` = błędy podczas tej komendy.
- `kind: query` → treść z `ctx.lines`: `find`, `snap`, `console`, `net`, `eval`, `get`, `storage`, `fetch`, `tabs`,
  `routes`, `locator`; z `--name` (`get --name x`, `eval --name x`, `storage --name`, `fetch --name`) → jedna linia
  `ok get x ← #sel · <wartość ≤ 100>` (wartość ląduje w `capture.extracts`, jak w batchu).
- `screenshot` → `formatShot` (`ok shot …/shots/001-koszyk.png 1280x720`; JPEG bez rozmiaru → `ok shot <plik>`);
  `pdf` → `ok pdf <plik>`; `verify` → `ok verify text [sel]` / `FAIL verify text [sel] · <detail> (soft)` (z `--soft`
  keeper i tak zamienia exit na 0; bez `--soft` runner rzuca → `FAIL verify text [sel] · verify text: <detail>`).
- `kind: control` (dialog/frame/resize/route/unroute/offline/state/trace/video/run/close) → linia z `ctx.lines`,
  gdy runner ją dał (`close`, `trace`, `video`, `run`), inaczej `ok <head>` (+ ewentualne `dialog …`).
- FAIL → `formatFail(head, error)` (powód ≤ 120 znaków) + tylko delty `dialog …`; `exit 1`.
- Ścieżki w liniach są **względne do cwd komendy** (reguła §4.4), więc domyślnie
  `.scribe-devtools/browser-inspector/session/default/snap.md`, nie `session/default/snap.md` z próbki — próbka zakładała
  `out` w cwd; mierzone: `ok open` z pełną ścieżką = 30 tok.

### Komendy sesyjne w `steps.run.mjs` — decyzje

| komenda | zachowanie |
| --- | --- |
| `snap` | ZAWSZE jeden pełny `ariaSnapshot({ mode: 'ai', boxes: true })` → `writeSnapshot` (3 pliki, maskowanie WP3/WP1) → filtry w JS: domyślnie kompakt `--max 25` + `…+N lines · <snap.md>`; `--diff` = `diffSnapshot(prevCompact, compact)` jako linie `+ …` / `- …` (`0 changed · <snap.md>` gdy nic); `--around eN` = `aroundRef` (`ref eN not in snapshot · …` gdy brak); `--grep`/`--names` = `compactLines` z opcjami; `--all` = **jedna linia** `ok snap N lines · <snap.full.yml> · <snap.md>` (drzewo do pliku, nie na stdout). `prevCompact` odświeżają `open`, `snap` i `find` |
| `find` | jeden pełny snapshot (pliki odświeżone) → `findInSnapshot` ≤ 10 linii; `0 matches for "x"`; `…+N more · narrow the text or bi snap --grep` |
| `console` | od ostatniego wywołania (kursory per sesja, także dla `pageerror`), `--all` = od początku sesji (`N total:`), `--level info|warn|error` = poziom i cięższe (`--errors` = `error`; `pageerror` liczy się jako error), `--tail N`; `formatNewEntries` |
| `net` | od ostatniego wywołania: `formatNetSummary({ newCount, failed })` (`--failed` = to samo, `--tail N` ogranicza listę porażek); `--all` = `N total[ · k failed]:` + ≤ 25 ostatnich (`--tail`), z `…M older` |
| `net <n>` | `rec.settle()` (ciało może być w locie) → `net/<n>.txt` = linia żądania, nagłówki żądania (`> k: v`), `postData`, status + typ, ciało; stdout: `formatNetBody` (+ `--req` nagłówki ≤ 20, `--body` ≤ 20 linii ciała, `(no body captured)` gdy rejestrator nic nie ma); brak wpisu → FAIL `net #n: no such request (bi net --all lists them)` |
| `fetch` | w sesji bez `--name`: nagłówek jak `net <n>` + ≤ 20 linii ciała, całość w `net/fetch-NNN.txt`; z `--name` / w batchu jak dotąd (JSON do extracts) |
| `eval` | wynik ≤ 300 znaków inline (`formatEval`), dłuższy → pierwsza linia + `…N chars · <eval-NNN.txt>`; `--file` czyta `ctx.files` (klient przysyła), `--el eN` przez `locator.evaluate` |
| `dialog` | bez argumentów: `formatDialogStatus(policy, last)`; z polityką: jak w batchu (`once`, `text`); `beforeunload` zawsze accepted (rejestrator WP2) |
| `tabs` / `tab` | `tabs`: jedna linia na kartę `<i>[*] "<tytuł ≤ 40>" <url>`; `tab new [url]` / `tab <n>` / `tab close` z runnera WP2 + uzbrojenie nowej karty przez silnik; karta lane'u (pierwsza) nigdy nie jest zamykana |
| `frame` | z runnera WP2 (`main` / `<n>` / selektor) — zmienia tylko `ctx.frame`; test pilnuje, że NIE wywołuje `ariaSnapshot` |
| `locator eN` | `ctx.sel` (żywy ref albo `REF_NOT_FOUND`) → `durableSelector`: `locator('aria-ref=eN').evaluate(locatorForElement)` z capem 1 s → fallback wpis sidecara (`selector` ?? `locatorFor(entry)`); brak → FAIL `no durable selector for eN (…)` |
| `routes` | `0 routes` albo linia na route: `<wzorzec> block | → 500 + body | → body | continue [+300 ms]` |
| `trace` | `start` → `context.tracing.start`; `stop [plik]` → `trace.zip` w katalogu sesji albo plik względem cwd; `ok trace stop · <plik>` |
| `video` | `start` = FAIL z podpowiedzią `bi open <url> --video` (kontekst nagrywający musi powstać przy `open`); `stop` = kończy sesję i zapisuje `video/session.webm` (`ok video stop · <plik> · session closed`) |
| `run --file` | silnik odmawia bez `BI_UNSAFE=1` (`exit 2`, nic nie jest zapisywane); z flagą: treść z `ctx.files` → `run-NNN.mjs` w katalogu sesji → `import()` → `export default async (page, context)` pod `withDeadline`; linia `ok run --file s.mjs[ · <wynik ≤ 100>]` |
| `close` | `session.end()` → `ok close · session <name> · N commands · <katalog>` |

### Dziennik i eksport

Po każdej komendzie `appendJournal(journalPath(dir), { command, step, ok, ms, url, title, selector, resolved, line, error })`
(WP4): `selector` = trwały selektor **rozwiązany w chwili akcji** — owinięty `ctx.sel` sesji woła `durableSelector`
zaraz po udanym `resolveRef` (element jest, `count() > 0` właśnie przeszło; po kliku mógłby zniknąć); `resolved` mapuje
`fields[k].ref`, `from`, `to`. Ref bez trwałego selektora (np. `generic` bez atrybutów) zostaje w dzienniku bez
`selector` i `bi export` odmawia **całości** z nazwaniem kroku (reguła WP4 — test negatywny) — agent powinien klikać
w refy elementów interaktywnych (`find` pokazuje `textbox`/`button` obok etykiet `generic`). `console.jsonl` /
`net.jsonl` dopisywane po każdej komendzie (redagowane), `eval-NNN.txt`, `net/<n>.txt`, `net/fetch-NNN.txt`,
`shots/NNN-<name>.png|jpg`, `run-NNN.mjs`, `trace.zip`, `video/session.webm`.

## Liczby (Chrome 152 headless, fixture'y przez node:http, 2026-09-02)

| pomiar | wynik |
| --- | --- |
| komenda sesji przez keepera (klient spawn → exit), `click`/`fill`/`get` | ≈ 110–160 ms, z czego silnik 2–40 ms (`journal.ms`) |
| `open` na nowy origin (site isolation + pełny snapshot + 3 pliki) | 350–600 ms; kolejne `open` w tym samym originie 40–80 ms |
| `find` / `snap` (pełny snapshot + walk + zapis) na fixture | 7–13 ms |
| martwy ref po zmianie etykiety (`click` → `snap` → `click <stary>`) | FAIL w **≤ 6 ms** w silniku (smoke: `journal.ms < 100`) |
| `shot` CDP viewport / `--full --mark` przez Playwrighta | 130 / 76 ms |
| pierwszy popup (`click` na `target=_blank`) | ≈ 500 ms (nowy renderer) |
| cały smoke sesyjny: `bi up` + 45 komend + `doctor` + `close` + `stop` | ≈ 9 s; `bi script --no-daemon` (10 linii, w tym launch Chrome) ≈ 1,4 s |

## Odstępstwa i decyzje (z uzasadnieniem)

- **Klucz sesji = nazwa** (nie `cwd|name` ze zlecenia) — DESIGN §4.5 wprost; `bi status` i tak pokazuje `cwd`/`out` sesji.
- **`el` tylko gdy się zmienił** albo po nawigacji — `formatDeltas` WP1 drukuje `el N` zawsze, gdy podany; silnik podaje
  `undefined` przy braku zmiany, bo `ok fill e39 · el 61` po każdej komendzie to 4 tokeny szumu × liczba komend.
- **`navigated → refs f<seq>eN`**: `seq` liczony z nawigacji ramki głównej od utworzenia karty; playwright numeruje
  też iframe'y, więc po stronie z ramkami prefiks może być wyższy. Linia jest podpowiedzią „zrób `bi snap`”, nie adresem.
- **Ścieżki względne do cwd**, nie do `out` (próbka §4.4 pokazuje `session/default/snap.md`, reguła mówi „względne do cwd”).
- **`bi script` zatrzymuje się na pierwszym FAIL** (DESIGN: „exit = pierwszy niezerowy” — pozostałe linie po
  nieudanym kliku i tak dotyczą stanu, którego nie ma; `--soft` w linii nie zatrzymuje).
- **`video start` nie istnieje w trakcie sesji** — playwright nagrywa per kontekst od pierwszej strony; `open --video`
  tworzy kontekst nagrywający, `video stop` = zamknięcie sesji (plik powstaje po zamknięciu strony).
- **`net <n>` bez `--body` drukuje sam nagłówek** (status, typ, rozmiar, plik) — ciało tylko z `--body`, nagłówki
  żądania tylko z `--req` (flagi istnieją w schemacie WP1, więc są opt-in; całość i tak leży w `net/<n>.txt`).
- **`verify --soft` w sesji** kosztuje pełny `stepTimeoutMs` (10 s), bo runner WP2 polluje do deadline'u zanim uzna
  porażkę — to samo, co w batchu; w smoke nie ma soft FAIL z tego powodu (jest w teście jednostkowym). Jeśli WP8 uzna,
  że agent potrzebuje szybszego „nie”, `BI_STEP_TIMEOUT_MS` skraca limit całej sesji.
- **`find` odświeża `prevCompact`** (zapisuje te same trzy pliki co `snap`), więc `snap --diff` po `find` porównuje z
  chwilą `find`, nie z ostatnim `snap` — zawsze „od ostatniego pełnego snapshotu”, czyli od ostatniego widoku, jaki agent dostał.
- **Import `client.mjs` w silniku** (`splitCommandLine`, `isScriptComment`) — wg prośby WP5, żeby adresy `script[n]`
  zgadzały się co do funkcji; `client.mjs` to `node:*` + moduły czyste, `client-imports.test` nadal zielony (klient nie
  importuje silnika, silnik importuje klienta — kierunek bez kosztu startu).
- **`page.on('request')` w sesji** dubluje nasłuch rejestratora tylko po to, by trzymać nagłówki żądania i `postData`
  (rejestrator WP2 ich nie ma; nie edytowałem `recorder.mjs`). Jeśli WP2 doda `headers`/`postData` do `NetEntry`,
  hook w `armSessionPage` można usunąć (`session.requestMeta`).
- Sesja nie robi `Page.resetNavigationHistory` ani scrubu — `back` w sesji ma widzieć historię agenta.

## Prośby do innych pakietów

- **WP2** (`recorder.mjs`, opcjonalnie): `NetEntry.requestHeaders` / `postData` — wtedy `session.requestMeta` znika.
- **WP5**: nic do zmiany. Uwaga: `bi doctor` robi teraz prawdziwe `open about:blank` / `close` w sesji `__doctor`
  (silnik ma `runCommand`), więc `warm` w linii doktora to koszt otwarcia sesji (kontekst z puli spare + snapshot pustej
  strony), ≈ 60–120 ms.
- **WP7**: sesja nie korzysta z `auth`; `state load <plik>` (runner WP2) działa w sesji dla bieżącego originu.
- **WP8** (README/AGENTS/templates): zasady z sekcji „Linia stdout” i tabeli komend; `BI_STEP_TIMEOUT_MS`,
  `BI_UNSAFE=1` (odmowa `exit 2`), `open --video` → `video stop`/`close`, `bi script` zatrzymuje się na pierwszym FAIL,
  refy elementów `generic` nie eksportują się (`find` pokazuje obok `textbox`/`button` z `[data-testid=…]`).
  `test/smoke/smoke.test.mjs` używa `keeper-harness.makeEnv()` z usuniętym `BI_ENGINE_MODULE` — ten sam wzorzec dla
  `test/compat/smoke-gate.test.mjs`. Porty sesji: 4541 (4542–4559 wolne).
- **WP9** (`bi-interactive`): każda komenda = `node bin/bi.mjs …` z `BI_SOCKET` benchu; linie do policzenia to
  dokładnie `done.lines`; `journal.jsonl.ms` = czas w silniku bez klienta i pipe'a; `snap` bez flag = 25 linii + marker.
