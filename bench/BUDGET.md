# BUDGET.md — budżet czasu z DESIGN.md §6 vs pomiar

Generowany przez `npm run bench` (2026-09-02T02:10:21.641Z). Kolumna „projekt” to tabela §6 DESIGN.md pogrupowana tak,
jak silnik raportuje fazy (`report.json.timing`: `queuedMs`, `scrubMs`, `gotoMs`, `stepsMs`, `captureMs`, `writeMs`, `totalMs`;
`_manifest.json.timing`: `keeperStartMs`, `launchMs`, `clientMs`; stoper benchu: `spawn → exit` klienta). Kolumna „pomiar” to
**mediana** z próbek wariantu, nigdy pojedynczy przebieg. 🔴 = rozjazd > 25 % od projektu (dla projektu 0: > 25 ms) albo iloraz < 5,0.

## Fazy przebiegu (18 kroków `bench/task.mjs`)

Tryby przebiegów: bi-warm n=10, każdy `warm` · bi-warm-tight n=10, każdy `warm` · bi-first n=3, każdy `first` · bi-cold n=3, każdy `no-daemon`.

| faza | bi-warm (projekt / pomiar) | bi-warm-tight | bi-first | bi-cold |
| --- | ---: | ---: | ---: | ---: |
| 🔴 klient: start (72) + pipe (5) + dispatch (2) + wydruk i wyjście (6); `bi-first`: + import playwright-core (270), bo klient czeka na keepera w tym czasie; `bi-cold`: + context/browser.close (200) | 🔴 85 / **109** (+28 %) | 85 / **96** (+13 %) | 355 / **367** (+3 %) | 277 / **248** (−10 %) |
| spawn keepera → nasłuch (`_manifest.timing.keeperStartMs`) | — / **0** (—) | — / **0** (—) | 45 / **52** (+16 %) | — / **0** (—) |
| 🔴 queuedMs — scrub poprzedniego przebiegu w kolejce lane’u, po odpowiedzi (§6) | 0 / **0** (0) | 🔴 15 / **0** (−100 %) | — / **0** (—) | — / **0** (—) |
| scrubMs — scrub w stoperze przebiegu (tylko siatka bezpieczeństwa `runFlow`; między snapshotami jednego batchu) | 0 / **0** (0) | 0 / **0** (0) | — / **0** (—) | — / **0** (—) |
| 🔴 launch Chrome (300) + kontekst i strona (115); `bi-cold`: + import playwright-core (270) w procesie | 0 / **4** (+4 ms) | 0 / **7** (+7 ms) | 🔴 415 / **177** (−57 %) | 🔴 685 / **420** (−39 %) |
| 🔴 goto `load` (ta sama karta 55 / świeży kontekst 250) | 🔴 55 / **23** (−58 %) | 🔴 55 / **25** (−55 %) | 🔴 250 / **349** (+40 %) | 🔴 250 / **350** (+40 %) |
| 🔴 18 kroków: waitFor 10 + 5×click 220 + 4×fill 40 + select 12 + waitFor 40 + 6×extract/evaluate 12 + 2×screenshot 50 | 🔴 384 / **169** (−56 %) | 🔴 384 / **179** (−53 %) | 🔴 384 / **222** (−42 %) | 🔴 384 / **850** (+121 %) |
| 🔴 dowód końcowy (el-count + title/text/elements) | 🔴 12 / **3** (−75 %) | 🔴 12 / **3** (−75 %) | 🔴 12 / **6** (−50 %) | 🔴 12 / **6** (−50 %) |
| 🔴 oczekiwanie na zapisy + report.json/md, elements.md, text.txt, manifesty | 🔴 10 / **42** (+320 %) | 🔴 10 / **44** (+340 %) | 🔴 10 / **21** (+110 %) | 🔴 10 / **27** (+170 %) |
| 🔴 **razem** (klient spawn → exit) | 🔴 546 / **358** (−34 %) | 🔴 561 / **355** (−37 %) | 1469 / **1385** (−6 %) | 🔴 1618 / **2077** (+28 %) |

Uwagi do odczytu: scrub poprzedniego przebiegu keeper wykonuje **w kolejce lane’u po odpowiedzi** (`afterAnswer`), więc z
przerwą 300 ms jest poza stoperem (`queuedMs` 0, `scrubMs` 0), a bez przerwy (`bi-warm-tight`) czeka na niego następny klient
i płaci go jako `queuedMs` (§6: 15). `scrubMs` > 0 tylko wtedy, gdy siatka bezpieczeństwa w `runFlow` zastała brudny lane — między
snapshotami jednego batchu (legalnie w stoperze, §2.3) albo przy `--no-daemon`. Wiersz „klient” dla `bi-cold` obejmuje zamknięcie
przeglądarki, bo `--no-daemon` nie rozdziela tych dwóch rzeczy w żadnym pliku.

## queuedMs, scrubMs, cacheHits — osobno

| wariant | queuedMs (med / p90 / max) | scrubMs (med / p90 / max) | cacheHits (med) | cacheHitsDocument (max) |
| --- | ---: | ---: | ---: | ---: |
| bi-warm | 0 / 0 / 0 | 0 / 0 / 0 | 0 | 0 |
| bi-warm-tight | 0 / 0 / 0 | 0 / 0 / 0 | 0 | 0 |
| bi-warm-fresh | 0 / 0 / 0 | 0 / 0 / 0 | 0 | 0 |
| bi-first | 0 / 0 / 0 | 0 / 0 / 0 | 0 | 0 |
| bi-cold | 0 / 0 / 0 | 0 / 0 / 0 | 0 | 0 |

Czerwony wiersz tu oznacza `cacheHitsDocument > 0`: dokument główny podany z cache HTTP (serwer z `Last-Modified` i heurystyczną
świeżością potrafi oddać stary `index.html` po rebuildzie — §2.3); serwer benchu nie wysyła nagłówków cache, więc 0 jest oczekiwane.

## Ilorazy wobec MCP (mediany, ten sam dzień, ta sama maszyna)

MCP naive warm: **3871 ms** · MCP naive 1. przebieg: 4860 ms · MCP lean `--timeout-settle 100` warm: 1648 ms.

| wariant bi | mediana | p90 | podstawa | iloraz (pomiar) | iloraz (projekt §6) | vs lean settle 100 |
| --- | ---: | ---: | --- | ---: | ---: | ---: |
| bi-warm | 358 ms | 366 ms | MCP naive warm 3871 ms | **10,8×** | 5,3× | 4,6× |
| bi-warm-tight | 355 ms | 370 ms | MCP naive warm 3871 ms | **10,9×** | 5,2× | 4,6× |
| 🔴 bi-first | 1385 ms | 1395 ms | MCP naive, 1. przebieg 4860 ms | **3,5×** | 2,4× | 1,2× |
| 🔴 bi-cold | 2077 ms | 2145 ms | MCP naive, 1. przebieg 4860 ms | **2,3×** | 2,2× | 0,8× |
| bi-warm-fresh | 765 ms | 789 ms | MCP naive warm 3871 ms | **5,1×** | 3,1× | 2,2× |

🔴 przy ilorazie < 5,0 jest literalne (AC-19); dla `bi-first`, `bi-cold` i `bi-warm-fresh` projekt **nie obiecuje** 5× (kolumna
„projekt §6”: 2,4× / 2,2× / 3,1×) — czerwień mówi tam tylko „poniżej progu 5×”, nie „gorzej niż projekt”.

## Wiersze poza flow benchu (§6, druga tabela)

| sytuacja | projekt | pomiar | ocena |
| --- | ---: | ---: | --- |
| `bi-warm-fresh` (`--fresh`: świeży kontekst z puli spare, goto 190–441) | 932 ms | 765 ms (goto 393 ms) | −18 % |
| app-factory, 6 snapshotów, `--parallel 1`, config bez zmian (completed 6/6) | ≈ 8000–10 000 ms | 12 114 ms (n=2) | poza zakresem, w tolerancji |
| scrub między snapshotami app-factory (`snapshots[].scrubMs`, 4 originy) | 12–35 ms | 9 ms (n=10) | poza zakresem, w tolerancji |
| 🔴 app-factory, 6 snapshotów, `--parallel 3`, config bez zmian (completed 6/6) | ≈ 8000–10 000 ms | 5273 ms (n=2) | −34 % poniżej dołu |
| 🔴 app-factory, 6 snapshotów, `--parallel 1`, config po migracji `networkidle` → `settled` (completed 6/6) | ≈ 2500 ms | 9480 ms (n=2) | +279 % |
| 🔴 app-factory, 6 snapshotów, `--parallel 3`, config po migracji `networkidle` → `settled` (completed 6/6) | ≈ 1300–1600 ms | 4496 ms (n=2) | +181 % ponad górę |

