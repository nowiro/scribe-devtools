# scribe-devtools

Narzędzia deweloperskie w duchu scribe (repozytorium siostrzane, `../scribe`): skrypty
zamiast serwerów MCP, wyniki na dysku, zero schematów narzędzi w kontekście agenta.

Pierwsze narzędzie: **browser-inspector 2** (binarka `browser-inspector`) — patrzenie na aplikację webową przez
prawdziwy, systemowy Chrome/Edge, z dwoma wejściami do jednej tabeli kroków:

| wejście | do czego | co dostaje agent |
| --- | --- | --- |
| `browser-inspector <config.json> [--stamp X]` | **batch**: flow z configu JSON, drop-in dla bramki app-factory; wynik w `<outputDir>/<stamp>/<snapshot>/report.md` + `report.json` | jedna linia stdout na snapshot + `report.md` do przeczytania |
| `browser-inspector <komenda> [args]` | **sesja interaktywna**: `browser-inspector open <url>`, `browser-inspector find <tekst>`, `browser-inspector click e45`, `browser-inspector snap`, `browser-inspector export flow.json` | jedna linia stdout na komendę |

Ciepła przeglądarka żyje w **keeperze** — lokalnym procesie Node z named pipe (Windows) /
unix socketem, który startuje sam przy pierwszym użyciu i gaśnie po 30 min bezczynności. Agent go
nie widzi: dalej uruchamia CLI i czyta pliki. Bez keepera (`--no-daemon`, CI) batch wykonuje się
w procesie — ten sam kod, ten sam `report.json`.

Projekt i kontrakty: [docs/DESIGN.md](docs/DESIGN.md). Kryteria: [docs/ACCEPTANCE.md](docs/ACCEPTANCE.md).
Plan wdrożenia: [docs/PLAN.md](docs/PLAN.md). Kroki: [docs/STEPS.md](docs/STEPS.md) (generowane).
Szablon flow: [packages/browser-inspector/templates/flow.md](packages/browser-inspector/templates/flow.md).
Instrukcje dla agentów pracujących w repo: [AGENTS.md](AGENTS.md). Pomiar: [bench/RAPORT.md](bench/RAPORT.md),
[bench/BUDGET.md](bench/BUDGET.md) (oba generowane przez `npm run bench`).

## Dlaczego

Serwer MCP Playwrighta kosztuje agenta definicje ~70 narzędzi w każdej sesji i domyślny „settle”
po każdej akcji; stary browser-inspector ze scribe nie kosztował nic, ale nie umiał „spojrzeć,
potem kliknąć”. `browser-inspector` robi jedno i drugie: batch jak stary runner (ten sam config, ten sam
`report.json`), sesja na refach `eN` z pełnego snapshotu a11y jak MCP — i w obu przypadkach do
kontekstu agenta trafia **tylko to, co przeczyta z dysku**. Liczby (czas, tokeny, iloraz wobec
`@playwright/mcp`) pochodzą wyłącznie z `npm run bench` — blok na końcu tego pliku i
`bench/RAPORT.md`; nic tu nie jest wpisane ręcznie.

## Instalacja

Wymagania: Node ≥ 22, systemowy Chrome albo Edge (nic nie jest pobierane — `playwright-core` nie
ma pobierania przeglądarek), npm.

```
git clone <repo> scribe-devtools
cd scribe-devtools
npm ci            # .npmrc: ignore-scripts=true, engine-strict=true
npm run prepare   # uzbraja hook pre-commit (npm install go NIE uruchamia — ignore-scripts)
npm run verify    # bramki: prettier, vitest, tsc, CODE-INDEX, STEPS.md, instrukcja, smoke
```

Wywołanie bez `browser-inspector` na PATH: `node packages/browser-inspector/bin/browser-inspector.mjs …` albo `npm run browser-inspector -- …`.
W innym projekcie (np. app-factory) dodaj skrypt
`"browser-inspector": "node ../scribe-devtools/packages/browser-inspector/bin/browser-inspector.mjs"` i wołaj **`pnpm browser-inspector …`**.
Przeglądarkę wybiera `browser.channel` w configu albo `BROWSER_INSPECTOR_CHANNEL` (`chrome` → `msedge`, pierwszy
znaleziony); `BROWSER_INSPECTOR_BROWSER_PATH` wskazuje plik wykonywalny wprost.

Wersja **portable** (bez npm, bez builda): każda wydana wersja leży w repo jako
[`download/scribe-devtools-portable-<wersja>.zip`](download/) z sumą kontrolną w sidecarze `.sha256`
(ten sam plik jest assetem Release'a). Po rozpakowaniu `browser-inspector.cmd` / `./browser-inspector` albo
`node packages/browser-inspector/bin/browser-inspector.mjs help`. Zip zawiera pakiet, `node_modules/playwright-core`
i marker `PORTABLE` (keeper pomija wtedy stempel mtime źródeł w hashu tożsamości). Buduje go
`npm run portable` i hook pre-commit; wersja pochodzi wyłącznie z `package.json`, a build jest
deterministyczny (ten sam stan drzewa → te same bajty).

## Batch: `browser-inspector <config.json>`

```
browser-inspector read.config.browser-inspector.json --stamp 2026-09-02_10-00
ok nowiro-strona · 1 773 ms
ok nowiro-jezyk · 1 984 ms
FAIL dziennik-uczen · 10 088 ms
ok 5/6 completed · 11 880 ms · warm · .scribe-devtools/browser-inspector/2026-09-02_10-00
FAIL dziennik-uczen · step 4 "evaluate uprawnienia-ucznia" — Error: uczen widzi przycisk nauczyciela · .scribe-devtools/browser-inspector/2026-09-02_10-00/dziennik-uczen/report.md
```

Flagi: `--stamp YYYY-MM-DD_HH-MM` (katalog przebiegu; bez flagi — bieżący czas Europe/Warsaw),
`--only <nazwa>` (wielokrotnie), `--parallel N` (lane’y z trwałą kartą; domyślnie `parallel` z
configu albo 1), `--fresh` (świeży kontekst dla każdego snapshotu), `--junit plik.xml`,
`--fail-on-incomplete` (exit 1, gdy któryś snapshot nie jest `completed`), `--no-daemon`.
Kody wyjścia: **0** zawsze — nieudany krok to wynik w raporcie; **1** tylko z `--fail-on-incomplete`;
**2** przy błędzie fatalnym (config, brak przeglądarki, nieznana flaga, brak zmiennej dla
`valueFromEnv`, nieudane logowanie z bloku `auth`).

W katalogu snapshotu: `report.md` (nagłówek z `OK n/n` albo `FAIL k/n`, `## errors`, `## values`;
`## steps` tylko przy porażce, `## verify` tylko przy miękkich porażkach — jest celowany z natury
i czyta się go w całości), `report.json` (nadzbiór starego kształtu: `completed`, `steps[{
description, ok, error }]`, `navigationError` tylko gdy nawigacja padła, `extracts`, `console`,
`network`, `tabs`, `timing`, `engine`), `_manifest.json`, `elements.md` (mapa elementów
interaktywnych z selektorami), `text.txt`, zrzuty (`page.png` dla `type: page`; `final.png`
zawsze przy porażce flow), opcjonalnie `snap.md` + `snap.json`, `trace.zip`, `video.webm`.
Katalog przebiegu ma własny `_manifest.json` z `timing.mode` (`warm | first | fallback | no-daemon`)
i wpisem per snapshot (`ms`, `lane`, `queuedMs`, `scrubMs`, `cacheHits`, `failure`).

Config: stary schemat browser-inspectora ze scribe parsuje się **bez zmian** (`networkidle`,
`wait ms`, `mat-option:has-text`, `evaluate`, które rzuca). Nowe pola są opcjonalne: `parallel`,
`browser { channel, executablePath, headless, args, fastHeadless, motion }`, per snapshot
`waitUntil: "settled"` (load + krótka cisza w sieci; `networkidle` honorowane 1:1), `isolation:
"reuse" | "fresh"`, `finalScreenshot`, `captureSnapshot`, `captureBodies`, `dialogs`, `routes[]`,
`settleMs`, `trace`, `video`, `auth: false`. Pełna tabela kroków i pól: [docs/STEPS.md](docs/STEPS.md);
szablon z przykładami (role, `auth`, sesja → eksport): [templates/flow.md](packages/browser-inspector/templates/flow.md).

`browser-inspector lint-config <config.json>` drukuje sugestie migracji (na configu app-factory: `networkidle` →
`settled`, `wait ms` → `waitFor`/`wait --text`, `parallel: 3`) — bez migracji wszystko działa jak
dotąd, tylko wolniej.

Sekrety wyłącznie przez środowisko: `valueFromEnv` w configu, w sesji `@{NAZWA}` albo `--env NAZWA`
(`@literal` bez klamry jest literałem; `@{FOO}` bez zmiennej = exit 2 z nazwą). Wartość jest
rozwiązywana w kliencie i nigdy nie trafia do configu, raportu, dziennika, logu keepera ani
stdout — keeper dostaje ją pod adresem kroku i redaguje wszędzie (`***`); pola `password` /
`one-time-code` nigdy nie mają wartości w snapshocie. Literał `value` w `auth.login` jest
błędem walidacji.

## Sesja: `browser-inspector open`, `browser-inspector find`, `browser-inspector click eN`, `browser-inspector snap`

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
```

Zasady: jedna linia na sukces (prefiks `ok | FAIL`, separator ` · `, ścieżki względne do cwd —
domyślny `out` to `./.scribe-devtools/browser-inspector`, więc pełna linia `open` kończy się
`.scribe-devtools/browser-inspector/session/default/snap.md`); `find`, `snap`, `console`, `net`, `eval`,
`get` drukują treść, bo treść JEST wynikiem; `console`/`net` pokazują **tylko wpisy od
ostatniego wywołania** (`--all`, `--failed`, `--tail N`, `--level info|warn|error`); `snap`
domyślnie `--max 25` z markerem nadmiaru, `--diff` (od poprzedniego widoku), `--around eN`,
`--grep tekst`, `--names` (kontekst przodka), `--all` (pełne drzewo do pliku). Exit **0** ok,
**1** FAIL (łańcuch `&&` się zatrzymuje; `--soft` daje 0), **2** fatalny — w tym brak keepera.

Refy `eN` (`f<seq>eN` po nawigacji i w iframe’ach) pochodzą z **pełnego** `ariaSnapshot({ mode: 'ai' })`
— zmiana etykiety elementu daje nowy ref, stary kończy się `FAIL … ref not found` od razu, nie po
timeoucie; linia akcji mówi, kiedy patrzeć znowu (`navigated`, `dom Δ`, `el a→b`). Klucz sesji to
**tylko nazwa** (`--session`, `BROWSER_INSPECTOR_SESSION`, domyślnie `default`) — `cd` w powłoce nie otwiera drugiej
sesji. Pliki sesji: `<out>/session/<name>/` (`snap.md`, `snap.full.yml`, `snap.json`,
`journal.jsonl`, `console.jsonl`, `net.jsonl`, `net/<n>.txt`, `shots/`, `eval-NNN.txt`, `trace.zip`,
`video/`). Dialogi: polityka PRZED akcją (`browser-inspector dialog accept|dismiss [--text] [--once]`),
`beforeunload` zawsze akceptowany. `browser-inspector frame <n>` zmienia zakres tylko dla selektorów CSS,
`eval` i `extract` — refy z ramek rozwiązują się bez niego. `browser-inspector run --file s.mjs` (kod w keeperze)
istnieje wyłącznie pod `BROWSER_INSPECTOR_UNSAFE=1` i jest jawnie RCE-równoważny — nigdy w configu ani w CI.

`browser-inspector export flow.json` zapisuje dziennik sesji jako config batchu: refy → trwałe selektory
(`[data-testid=…]` → `#id` → `[name=…]` → `role=`), `@{NAZWA}` → `valueFromEnv`, istniejący plik
wymaga `--force`, ref bez trwałego selektora = odmowa z nazwą kroku (klikaj w elementy z etykietą,
nie w bezimienne `generic`). Dla CI bez keepera: `browser-inspector script plik.txt --no-daemon` wykonuje te same
linie w jednym procesie (stop na pierwszym FAIL, exit = pierwszy niezerowy).

## Keeper: `browser-inspector up`, `browser-inspector status`, `browser-inspector stop`, `browser-inspector doctor`

Keeper startuje sam przy pierwszym `browser-inspector` (także batchu). W sesji agenta warto go podnieść jawnie
jako hook **SessionStart**, żeby pierwsze wywołanie w sesji było już ciepłe — np. w
`.claude/settings.json`:

```json
{ "hooks": { "SessionStart": [{ "hooks": [{ "type": "command", "command": "pnpm browser-inspector up" }] }] } }
```

`browser-inspector status` drukuje pid, hash tożsamości, pipe, RSS, liczbę zadań, lane’y i sesje; `browser-inspector stop`
zamyka; `browser-inspector doctor` sprawdza, czy keeper **przeżywa wyjście powłoki** (część hostów — VS Code,
pnpm z Job Object — zabija drzewo procesów; wtedy każde wywołanie jest zimne):

```
$ browser-inspector doctor
ok keeper survives shell: yes · spawn→listen 45 ms · first job 1 390 ms · warm 470 ms · hash 3f9a1c2e · D:/github/scribe-devtools/packages/browser-inspector/bin/browser-inspector.mjs
```

Tożsamość keepera = hash z wersji pakietu, `playwright-core`, Node, kanału/ścieżki przeglądarki,
flag, proxy, `realpath(bin/browser-inspector.mjs)` i stempla mtime `src/**` — edycja źródeł albo drugi checkout
dostają **inny** pipe, stary keeper nie jest już trafiany. Plik pid (`browser-inspector-<hash>.json` z tokenem),
lock (`O_EXCL`) i log leżą w `os.tmpdir()`; token chroni połączenie (pierwsza linia każdego
żądania). **Na Windows tryb pliku `0600` nic nie znaczy — token chroni ACL katalogu `%TEMP%`
użytkownika**, więc keeper zakłada, że `%TEMP%` nie jest współdzielony między kontami.
`timing.mode` w każdym `report.json` mówi, którą ścieżką poszło zadanie (`warm`, `first` —
pierwsze po starcie keepera, `fallback` — keeper nie wstał w 3 s i batch poszedł w procesie,
`no-daemon`).

Co scrub między przebiegami czyści na trwałej karcie: localStorage, sessionStorage (skrypt
generacji per origin), cookies, IndexedDB, cache storage, service workery, historię nawigacji,
route’y, offline, nagłówki, geolokację, emulację mediów, viewport, politykę dialogów, popupy.
**Nie czyści — bo są browser-wide i nie czyści ich ani `--fresh`, ani `isolation: "fresh"`, ani
`@playwright/mcp`:** HSTS, cache uwierzytelnienia HTTP (Basic/NTLM), cache DNS, cache HTTP
(celowo — `cacheHitsDocument` w raporcie mówi, gdy dokument główny przyszedł z cache; `--fresh`
robi `Network.clearBrowserCache`). `serviceWorkers: 'block'` obowiązuje tylko na kartach batchu
(nagłówek raportu `sw=blocked`, gdy aplikacja próbowała rejestracji); sesje i konteksty `fresh`
mają `allow`.

Zmienne środowiskowe: `BROWSER_INSPECTOR_DAEMON=0` (bez keepera) / `BROWSER_INSPECTOR_DAEMON=1` (keeper mimo CI), `BROWSER_INSPECTOR_SOCKET`
(własny pipe — dwa agenty, dwa keepery), `BROWSER_INSPECTOR_SESSION`, `BROWSER_INSPECTOR_IDLE_MS` (30 min), `BROWSER_INSPECTOR_SESSION_TTL_MS`
(60 min), `BROWSER_INSPECTOR_LANE_IDLE_MS`, `BROWSER_INSPECTOR_MAX_JOBS`, `BROWSER_INSPECTOR_MAX_RSS_MB` (recykling przeglądarki **między
zadaniami, przy pustej kolejce, bez otwartej sesji i zajętego lane’u** — należny recykling czeka na
`browser-inspector close`; RSS Chrome + rendererów próbkowany w tle co 10 zadań, nigdy na ścieżce zadania),
`BROWSER_INSPECTOR_CHANNEL`, `BROWSER_INSPECTOR_BROWSER_PATH`, `BROWSER_INSPECTOR_BROWSER_ARGS`, `BROWSER_INSPECTOR_STEP_TIMEOUT_MS` (limit kroku sesji),
`BROWSER_INSPECTOR_SCRUB_OP_MS` (limit jednej operacji scrubu, 2000 — zawieszony renderer kończy się odbudową
karty, nie zawieszonym lane’em), `BROWSER_INSPECTOR_REQUEST_TIMEOUT_MS` (klient porzuca keepera bez żadnej linii
przez 10 min: batch idzie w procesie, sesja `exit 2`), `BROWSER_INSPECTOR_UNSAFE` (**wchodzi do hasha
tożsamości** — keeper z `BROWSER_INSPECTOR_UNSAFE=1` to osobny proces, którego zwykły klient nie trafi);
testowe: `BROWSER_INSPECTOR_TMPDIR` (pliki pid/lock/log), `BROWSER_INSPECTOR_CONNECT_TIMEOUT_MS`, `BROWSER_INSPECTOR_ENGINE_MODULE`,
`BROWSER_INSPECTOR_SKIP_SMOKE`, `BROWSER_INSPECTOR_PERF`, `APP_FACTORY_DIR`.

Pliki pid/lock w `%TEMP%` przeżywają restart, a Windows recyklinguje pidy: keeper uznaje plik z
„żywym” pidem za stary, gdy ma ponad 5 s i nikt nie odpowiada na pipe (sam go sprząta); `browser-inspector stop` /
`browser-inspector status` bez keepera wypisują ścieżkę takiego pliku.

## CI

Na runnerze CI (`CI`, `GITHUB_ACTIONS`, `GITLAB_CI`, `TF_BUILD`, `JENKINS_URL`, `TEAMCITY_VERSION`,
`BUILDKITE`, `CIRCLECI`) keeper nigdy nie startuje: batch idzie w procesie (`timing.mode:
no-daemon`), komendy sesyjne kończą się `exit 2` (`FAIL keeper unavailable…`) — dla CI jest
`browser-inspector script`. `--junit plik.xml` + `--fail-on-incomplete` robią z batchu bramę:

```
node ../scribe-devtools/packages/browser-inspector/bin/browser-inspector.mjs read.config.json --stamp "$STAMP" --junit browser-inspector.xml --fail-on-incomplete
```

Bramka app-factory (`pnpm smoke:browser`) woła `browser-inspector` dokładnie tak (stary argument `--stamp X`
bez zmian) i czyta `report.json` własną funkcją `evaluateReports()` — jej kopia jest testem
zgodności w tym repo (`test/compat/smoke-gate.test.mjs`: `--no-daemon`, keeper dwa razy z rzędu,
`--parallel 3`, identyczne `report.json`).

## VS Code i GitHub Copilot

Repozytorium jest przygotowane do pracy w VS Code z GitHub Copilotem (tryb agent) tak samo jak z Claude Code:

- `.github/copilot-instructions.md` — karta repo i kanoniczna kopia bloku instrukcji `browser-inspector` (ta sama,
  którą mierzy bench i którą kopiuje repozytorium aplikacji; `npm run verify` pilnuje równości trzech egzemplarzy);
  `.github/instructions/*.instructions.md` — reguły per obszar (`source`, `tests`, `docs`, `scripts-bench`) dołączane
  automatycznie według `applyTo`.
- Prompt files (`.github/prompts/`): `/migrate-from-mcp-playwright` prowadzi migrację repozytorium aplikacji (Nx
  monorepo) z serwera MCP Playwrighta na `browser-inspector` — opis w
  [PROMPT-MIGRACJA-MCP-PLAYWRIGHT.md](PROMPT-MIGRACJA-MCP-PLAYWRIGHT.md); `/browser-session` to pętla „spójrz, potem
  kliknij" dla sesji interaktywnej.
- `.vscode/tasks.json` — bramki jako zadania (Terminal → Run Task: `verify`, `test`, `smoke`, `bench`, `portable`,
  `docs`) i komendy narzędzia (`browser-inspector: doctor | up | stop | batch z fixture`); `.vscode/settings.json`
  włącza prettier, prompt files, instrukcje i AGENTS.md; `.vscode/extensions.json` poleca prettier, vitest i Copilot Chat.
- `.vscode/mcp.json` zawiera serwer `@playwright/mcp` wyłącznie na potrzeby benchu — do pracy z `browser-inspector`
  nie jest potrzebny, a w repozytorium aplikacji ma zniknąć (krok 4 promptu migracji).

## Migracja ze scribe (`integrations/browser-inspector`)

1. Config bez zmian; zamiast `node <scribe>/integrations/dist/browser-inspector/read-browser-inspector.js <config> --stamp X`
   wołaj `node <scribe-devtools>/packages/browser-inspector/bin/browser-inspector.mjs <config> --stamp X` (albo
   `pnpm browser-inspector <config> --stamp X`). Katalog wyniku, `report.json` (`completed`, `steps[].description/ok/error`,
   `navigationError`), `_manifest.json` — bez zmian; `report.md` jest krótszy (sekcje warunkowe).
2. `browser-inspector lint-config` mówi, co warto zmienić w configu (`settled`, `waitFor`, `parallel`). Nowe kroki:
   `verify`, `form`, `snapshot`, `storage`, `state`, `route`, `dialog`, `tab`, `frame`, `mouse`,
   `resize`, `pdf`, `fetch`, `offline`, `upload`, `drag`, `check`/`uncheck`, `type`, `back`/`forward`/`reload`.
3. Blok `auth` (login formularzem raz + `storageState`, OAuth/Keycloak) działa jak w scribe;
   `storageState` jest teraz względem **katalogu configu**, nie cwd.
4. Bramka `smoke-browser.mjs` w app-factory znajduje runner sama (`findRunner`: `SCRIBE_DEVTOOLS_DIR`,
   `../scribe-devtools`, potem stary scribe) — nic do zmiany poza sklonowaniem tego repo obok.
5. Nowość, której scribe nie miał: sesja interaktywna i `browser-inspector export` — patrz wyżej.

## Układ repozytorium

```
packages/browser-inspector/   # @scribe-devtools/browser-inspector — bin/browser-inspector.mjs, src/, test/, fixtures/, templates/
bench/                        # pomiar browser-inspector vs @playwright/mcp 0.0.80: RAPORT.md, WYNIKI.md, BUDGET.md, probes/
scripts/                      # index-code, gen-steps-doc, check-instruction-sync, portable-zip
docs/                         # DESIGN.md (kontrakt), PLAN.md, ACCEPTANCE.md, STEPS.md (generowane), handoff/
```

## Skrypty

| skrypt | co robi |
| --- | --- |
| `npm run verify` | wszystkie bramki (patrz AGENTS.md) |
| `npm test` / `npm run smoke` | vitest: projekty unit/scripts/bench/smoke/compat / tylko smoke na prawdziwej przeglądarce |
| `npm run typecheck` | `tsc --noEmit` z `checkJs` |
| `npm run code-index` / `npm run docs` | regeneracja `CODE-INDEX.md` / `docs/STEPS.md` |
| `npm run bench` | pomiar w `bench/` (RAPORT.md, WYNIKI.md, BUDGET.md, blok niżej) |
| `npm run portable` | zip portable |
| `npm run browser-inspector -- <args>` | `browser-inspector` bez PATH |

<!-- BENCH:START -->

Pomiar z 2026-09-02T13:00:45.840Z (`npm run bench`, Chrome/152, @playwright/mcp 0.0.80):

| wariant | mediana | p90 | × vs MCP naive | × vs MCP lean settle 100 |
| --- | ---: | ---: | ---: | ---: |
| browser-inspector-warm (2.+ wywołanie, przerwa 300 ms) | **304 ms** | 326 ms | 10,1× | 3,7× |
| browser-inspector-warm-tight (bez przerwy) | **296 ms** | 319 ms | 10,4× | 3,8× |
| browser-inspector-first (keeper startuje w stoperze) | **1372 ms** | 1375 ms | 2,6× (vs 1. przebieg) | 1,3× (vs 1. przebieg) |
| browser-inspector-cold (`--no-daemon`, CI) | **1521 ms** | 1523 ms | 2,4× (vs 1. przebieg) | 1,1× (vs 1. przebieg) |
| MCP naive / lean / lean settle 100 (warm) | 3066 / 3522 / 1115 ms | — | — | — |

Tokeny (o200k) na sesję z jednym zadaniem: **browser-inspector batch 414** (blok AGENTS.md 158 + komenda, stdout i cały `report.md`), browser-inspector-interactive-naive 799, browser-inspector-interactive-lean 612 — wobec MCP naive 6814 / lean 5499. Szczegóły: [bench/RAPORT.md](bench/RAPORT.md), budżet vs pomiar: [bench/BUDGET.md](bench/BUDGET.md).

<!-- BENCH:END -->
