# Handoff FINAL → WP10 — weryfikacja końcowa (2026-09-02)

Zakres: `npm run verify`, bramka app-factory (`CI=true` i keeper dwa razy z rzędu), `npm run bench --workspace bench -- --assert-speedup 5`,
diagnoza największej fazy w BUDGET.md, sprzątanie keepera i `chrome.exe`. Poniżej co się zmieniło w kodzie (dwie rzeczy), dlaczego
i jakie są liczby.

## Zmiany w drzewie

| plik | zmiana | powód |
| --- | --- | --- |
| `packages/browser-inspector/src/engine.mjs` | `FAST_HEADLESS_ARGS` = `--disable-frame-rate-limit --disable-gpu-vsync` **`--disable-gpu-compositing`** | stall 80–490 ms sekundę po każdym `load` (niżej) |
| `packages/browser-inspector/src/recorder.mjs` | zegary-capy (`sleep` dla `BODY_READ_MS`) są `unref()` | `--no-daemon` wychodził do 2 s po raporcie (niżej: `bi-cold`) |
| `packages/browser-inspector/test/session.test.mjs` | asercja `net --all --tail 1` toleruje `[01] ms` | flaky: pierwszy `npm run verify` padł na `1 ms` zamiast `0 ms` (tik zegara między `request` a `requestfailed`); wcześniejsza asercja w tym samym teście już tolerowała oba |
| `CHANGELOG.md` | wpisy w `Unreleased / Fixed` | — |

Żadnej zmiany w `docs/DESIGN.md`: §2.2 wymienia dwie flagi jako domyślne; trzecia jest tym samym mechanizmem (`fastHeadless: false`
wyłącza wszystkie trzy), wchodzi do hasha tożsamości keepera (`args`) i do `engine.flags` w `report.json`, więc stary keeper nie jest
trafiany, a raport mówi, z czym jechał. Budżet §6 nadal nie liczy żadnej z flag.

## Diagnoza: `bi-warm` 746 ms vs `bi-warm-tight` 355 ms (pierwszy przebieg benchu, przed poprawką)

Pierwszy `npm run bench -- --assert-speedup 5` przeszedł na styku: **5,06×** (mediana `bi-warm` 746 ms wobec MCP naive warm
3 774 ms), przy `bi-warm-tight` 355 ms i p90 `bi-warm` 777 ms. W `report.json` ciepłych przebiegów z przerwą 300 ms w każdym
wolnym przebiegu JEDNA faza miała +300…440 ms: albo `gotoMs` (406–440 zamiast 20), albo pierwszy `click [data-testid=submit]`
(316–434 zamiast 40) — nigdy obie. Bez przerwy (`tight`) stall trafiał poza stoper (raz w `waitFor`: 411 ms).

Sondy w `%TEMP%/claude/.../scratchpad/probe-*.mjs` (czysty playwright-core, bez `bi`, ten sam Chrome 152 headless):

1. `probe-idle.mjs`: stall pojawia się także bez keepera, z flagami i bez nich, w `goto`, `click` i `Page.captureScreenshot`
   — więc nie jest to scrub, kolejka ani klient.
2. `probe-timeline.mjs` (poll `page.evaluate('1')` co 20 ms po `load`): stall zawsze **+1000 ms po `load`** (994–1023),
   80–490 ms, w ~60 % nawigacji; poll `Browser.getVersion` przez sesję browser-level w tym samym czasie: 1–2 ms → blokuje się
   wątek główny **renderera**, nie proces przeglądarki. `--disable-features=SpareRendererForSitePerProcess` nic nie zmienia,
   liczba procesów `chrome.exe` się nie zmienia.
3. `probe-trace.mjs` (CDP `Tracing.start`, kategorie `toplevel,cc,gpu,devtools.timeline`): najdłuższe zadanie to
   `ThreadControllerImpl::RunTask` z `chrome_task_annotator: { delay_policy: FLEXIBLE_NO_SOONER, task_delay_us: 1000000 }`,
   `src_file: third_party/blink/renderer/platform/widget/widget_base.cc` (250–290 ms na wątku głównym renderera), w tym czasie
   na wątku kompozytora `cc/trees/proxy_main.cc Stop` (250–280 ms) i w procesie GPU `GPUTask` (`renderer_pid` = ten renderer,
   200–280 ms), potem `SetLayerTreeFrameSink` (200 ms). Czyli: sekundę po `load` Blink zwalnia LayerTreeFrameSink widgetu,
   `ProxyMain::Stop` czeka synchronicznie na kompozytor, a ten na proces GPU (SwiftShader/ANGLE); następny paint tworzy sink
   od nowa.
4. Flagi: `--disable-gpu` i `--disable-gpu-compositing` — **zero stalli w 6/6 nawigacji**; `--in-process-gpu` — bez zmian;
   `--enable-features=DisableReleaseOfFrameSink` (strzał) — bez zmian. `--disable-gpu` wyłącza WebGL (nowiro ma THREE.js), więc
   wybór to `--disable-gpu-compositing`: kompozycja programowa, WebGL nadal działa. `probe-idle.mjs` z tą flagą: goto 16–39,
   click 18–48, zrzut CDP 19–27 ms dla przerw 0/300/600/1000 ms, bez ani jednego stalla.

Po poprawce smoke 18/18 i compat 6/6 (nowiro-strona z WebGL `completed`), bramka app-factory keeper warm 10,2 s (było 12,2 s).

## Wyniki

### `npm run verify`

Pierwszy przebieg: 1 test padł (`session.test.mjs` `net … 1 ms`) — poprawiony jak wyżej. Drugi przebieg (przed flagą): zielony,
27 plików / 416 testów, tsc 0, CODE-INDEX i STEPS świeże, instruction sync 146 tokenów, smoke 18/18, 1 min 41 s.
Trzeci przebieg (po fladze): zielony. Czwarty (po `unref()` w recorderze): 1 test padł — `keeper.test.mjs` „an open session
blocks idle until `bi close`” (`BI_IDLE_MS=200`; keeper zgasł, zanim `bi open` pod pełnym obciążeniem 27 plików + Chrome
dotarł do niego — `armIdle` uzbraja 200 ms po `bi up`, spawn klienta pod obciążeniem bywa dłuższy); ten sam plik 3 × zielony
w izolacji (28/28), fake silnik nie importuje `recorder.mjs`, więc to wyścig harnessu, nie regresja — do rozważenia w WP5:
`BI_IDLE_MS` ≥ 1000 w tym teście albo `bi open` przed pierwszym uzbrojeniem idle. Piąty przebieg (finalny, ten sam kod):
**zielony** — 27 plików / 416 testów, tsc 0, CODE-INDEX i STEPS świeże, instruction sync 146 tokenów, smoke 18/18, 1 min 30 s.

### Bramka app-factory (`D:/github/app-factory`, Chrome 152, buildy z `dist/apps`)

Przed flagą (stemple `2026-09-02_11-01..03`): `CI=true` 6/6, 13 341 ms `clientMs`, `mode no-daemon`; keeper #1 6/6, 14 098 ms,
`first` (`keeperStartMs 45`, `launchMs 180`); keeper #2 6/6, 12 230 ms, `warm`.

Po fladze (stemple `2026-09-02_12-01..03`), per snapshot `completed` / `totalMs` (`report.json.timing`):

| snapshot | `CI=true` (no-daemon) | keeper #1 (first) | keeper #2 (warm) |
| --- | ---: | ---: | ---: |
| nowiro-strona | ✓ 3 957 (tab new) | ✓ 2 118 (tab new) | ✓ 1 390 |
| nowiro-jezyk | ✓ 1 484 | ✓ 1 412 | ✓ 1 474 |
| wizard-formularz | ✓ 3 060 | ✓ 3 040 | ✓ 3 051 |
| bookstore-zakupy | ✓ 3 592 | ✓ 3 690 | ✓ 3 427 |
| dziennik-nauczyciel | ✓ 465 | ✓ 486 | ✓ 500 |
| dziennik-uczen | ✓ 348 | ✓ 375 | ✓ 370 |
| **razem `clientMs`** | **13 334** | **11 321** | **10 233** |

Wszędzie `ctx: reused`, `cacheHits 0/0`, `scrubMs` 5–53 ms, proces `pnpm` 18,3 / 14,5 / 11,5 s. Config bez migracji
(4× `networkidle`, 4 200 ms `wait ms`), więc ≈ 10–13 s jak w WP8/WP9, nie 8–10 s z §3.4.

## Diagnoza 2: `bi-cold` 3 257 ms (projekt 1 618; WP9 mierzył 1 909)

BUDGET.md po drugim benchu: wiersz „klient + browser.close” dla `bi-cold` **2 086 ms** (projekt 277). Pomiar bezpośredni
(`node bin/bi.mjs cold.config.json --no-daemon`): `clientMs` 1 158–1 205 ms, wall 3 285–3 340 ms — 2,1 s poza silnikiem.
`probe-close.mjs`: `browser.close()` w czystym playwright-core 100–400 ms, więc nie zamknięcie. `probe-handles.mjs`
(import `client.mjs`, `await main(...)`, `process.getActiveResourcesInfo()`): po `main` zostają **3 × `Timeout`**, naturalne
wyjście po **1 529 ms** — to `setTimeout(process.exit, 2000).unref()` z `bin/bi.mjs` (komentarz w `finish()` przewidywał
„zbłąkany uchwyt” tylko w fallbacku, a płacił każdy przebieg CI). Zegary to `sleep(BODY_READ_MS)` w `recorder.mjs`
(`Promise.race` z `response.text()` — linia 281 — i z `settle()` — linia 187): odczyt wygrywa w kilka ms, przegrany 2-sekundowy
zegar zostaje ref’owany. Po `unref()`: naturalne wyjście **0 ms** (3 przebiegi), `main` 1 377–1 578 ms.

### Bench

Trzy przebiegi `npm run bench --workspace bench -- --assert-speedup 5` (Chrome 152, i7-11850H, Node 26.5, `@playwright/mcp`
0.0.80 — 24 narzędzia w `tools/list`; wszystkie z kodem 0, `checkFindings` zielone, `timing.mode` zgodny w każdym przebiegu):

| przebieg | bi-warm med / p90 | bi-warm-tight | bi-warm-fresh | bi-first | bi-cold | MCP naive / lean / lean settle 100 (warm) | iloraz |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| #1 stan zastany | 746 / 777 | 355 | 775 | 1 423 | 3 623 | 3 774 / 3 780 / 1 596 | **5,06×** (na styku) |
| #2 po `--disable-gpu-compositing` | **354 / 375** | 339 | 753 | 1 341 | 3 257 | 3 808 / 3 773 / 1 714 | **10,76×** |
| #3 po `unref()` zegarów (finalny, RAPORT/BUDGET/README) | **358 / 366** | 355 | 765 | 1 385 | **2 077** | 3 871 / 3 898 / 1 648 | **10,81×** |

Tokeny (o200k, na sesję z jednym zadaniem; identyczne w #1–#3, bo zależą od treści, nie czasu): **bi batch 400** (146 stałe +
254 zmienne; `pnpm bi` 402), bi-interactive-naive **745**, bi-interactive-lean **558**, **MCP naive 6 814**, **MCP lean 5 499**
(koszt stały MCP 4 069). AC-6: 146 ≤ 150 ✓, 400 ≤ 400 ✓ (na styku, jak w WP9), 558 ≤ 600 ✓, 745 ≤ 1 000 ✓.

Po #3 AC-5: `bi-first` 1 385 ms ≤ 1 600 ✓ (first-ever 1 408), `bi-cold` 2 077 ms > 1 750 ✗ (mediana z 3: 1 452 / 2 077 / 2 145;
BUDGET.md #3: klient + close 248 ms wobec projektu 277, launch + import 420 wobec 685, goto na świeżej karcie 349 wobec 250,
kroki 214 wobec 384 — rozrzut siedzi w pierwszym zrzucie po launchu i w `browser.close`, oba poza kodem `bi`). AC-3: 358 ≤ 580 ✓.

BUDGET.md (#2) — wiersze 🔴 poza wolniejszymi od projektu: fazy **szybsze** (kroki 161 vs 384, goto 24 vs 55, dowód 3 vs 12),
`queuedMs` 0 vs 15 dla `tight` (scrub po odpowiedzi kończy się przed startem następnego klienta ~100 ms), zapisy 46–48 vs 10
(`writeMs`: czekanie na zaległe zrzuty i ciała — jedyna faza ciepła realnie nad budżetem), `bi-first` goto na świeżej karcie
347 vs 250, `bi-cold` klient 2 086 vs 277 (naprawione wyżej). App-factory: `parallel 1` bez zmian 11 552 ms, `parallel 3`
5 180 ms, po `settled` 9 003 / 4 604 ms — jak w WP9: 4,2 s to `wait ms`, których lint nie zamienia.

## Obserwacje (bez zmian w kodzie)

- `timing.queuedMs` w batchu wielosnapshotowym rośnie kumulatywnie (snapshot k czeka na 0..k−1 w kolejce lane’u, także
  w `--no-daemon`): dla `dziennik-uczen` ≈ 12 000 ms. To zgodne z definicją „czas czekania na lane”, ale BUDGET.md czyta
  `queuedMs` jako „scrub poprzedniego klienta” — dla benchu (jeden snapshot) to to samo, dla app-factory nie. Do rozważenia
  w WP4/WP9: osobne pole albo liczenie od `enqueue` własnego batchu.
- `timing.writeMs` w bramce app-factory wynosi 0 we wszystkich snapshotach (zapisy zrzutów kończą się w trakcie kroków);
  w benchu 20–45 ms. Nie błąd, tylko semantyka „czekanie na zaległe zapisy”.
- `bi status` po bramce: `rss 110 MB (browser 964 MB)` — blisko `BI_MAX_RSS_MB` 1024; trzeci przebieg app-factory z rzędu
  może wywołać recykling (następne wywołanie `first`).
- `bi-cold` w benchu 3,3–4,3 s (WP9 miał 1,9 s): `report.json` pokazuje `click submit` 194–324 ms i zrzut `walidacja`
  212–730 ms w pierwszym przebiegu po launchu (rozgrzanie CDP screenshot / GPU) plus `browser.close`; po `--disable-gpu-compositing`
  patrz liczby wyżej.
