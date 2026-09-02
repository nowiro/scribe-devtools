# BUDGET.md — budżet czasu z DESIGN.md §6 vs pomiar

Generowany przez `npm run bench` (2026-09-02T09:26:31.484Z). Kolumna „projekt” to tabela §6 DESIGN.md pogrupowana tak,
jak silnik raportuje fazy (`report.json.timing`: `queuedMs`, `scrubMs`, `gotoMs`, `stepsMs`, `captureMs`, `writeMs`, `totalMs`;
`_manifest.json.timing`: `keeperStartMs`, `launchMs`, `clientMs`; stoper benchu: `spawn → exit` klienta). Kolumna „pomiar” to
**mediana** z próbek wariantu, nigdy pojedynczy przebieg. 🔴 = rozjazd > 25 % od projektu (dla projektu 0: > 25 ms) albo iloraz < 5,0.

## Fazy przebiegu (18 kroków `bench/task.mjs`)

Tryby przebiegów: browser-inspector-warm n=10, każdy `warm` · browser-inspector-warm-tight n=10, każdy `warm` · browser-inspector-first n=3, każdy `first` · browser-inspector-cold n=3, każdy `no-daemon`.

| faza | browser-inspector-warm (projekt / pomiar) | browser-inspector-warm-tight | browser-inspector-first | browser-inspector-cold |
| --- | ---: | ---: | ---: | ---: |
| klient: start (72) + pipe (5) + dispatch (2) + wydruk i wyjście (6); `browser-inspector-first`: + import playwright-core (270), bo klient czeka na keepera w tym czasie; `browser-inspector-cold`: + context/browser.close (200) | 85 / **103** (+21 %) | 85 / **96** (+13 %) | 355 / **364** (+3 %) | 277 / **247** (−11 %) |
| spawn keepera → nasłuch (`_manifest.timing.keeperStartMs`) | — / **0** (—) | — / **0** (—) | 45 / **45** (+0 %) | — / **0** (—) |
| 🔴 queuedMs — scrub poprzedniego przebiegu w kolejce lane’u, po odpowiedzi (§6) | 0 / **0** (0) | 🔴 15 / **0** (−100 %) | — / **0** (—) | — / **0** (—) |
| scrubMs — scrub w stoperze przebiegu (tylko siatka bezpieczeństwa `runFlow`; między snapshotami jednego batchu) | 0 / **0** (0) | 0 / **0** (0) | — / **0** (—) | — / **0** (—) |
| 🔴 launch Chrome (300) + kontekst i strona (115); `browser-inspector-cold`: + import playwright-core (270) w procesie | 0 / **3** (+3 ms) | 0 / **4** (+4 ms) | 🔴 415 / **166** (−60 %) | 🔴 685 / **411** (−40 %) |
| 🔴 goto `load` (ta sama karta 55 / świeży kontekst 250) | 🔴 55 / **21** (−62 %) | 🔴 55 / **20** (−64 %) | 🔴 250 / **341** (+36 %) | 🔴 250 / **346** (+38 %) |
| 🔴 18 kroków: waitFor 10 + 5×click 220 + 4×fill 40 + select 12 + waitFor 40 + 6×extract/evaluate 12 + 2×screenshot 50 | 🔴 384 / **155** (−60 %) | 🔴 384 / **156** (−59 %) | 🔴 384 / **237** (−38 %) | 🔴 384 / **236** (−39 %) |
| 🔴 dowód końcowy (el-count + title/text/elements) | 🔴 12 / **3** (−75 %) | 🔴 12 / **2** (−83 %) | 🔴 12 / **5** (−58 %) | 🔴 12 / **6** (−50 %) |
| 🔴 oczekiwanie na zapisy + report.json/md, elements.md, text.txt, manifesty | 🔴 10 / **48** (+380 %) | 🔴 10 / **46** (+360 %) | 🔴 10 / **18** (+80 %) | 🔴 10 / **28** (+180 %) |
| 🔴 **razem** (klient spawn → exit) | 🔴 546 / **333** (−39 %) | 🔴 561 / **326** (−42 %) | 1469 / **1373** (−7 %) | 1618 / **1465** (−9 %) |

Uwagi do odczytu: scrub poprzedniego przebiegu keeper wykonuje **w kolejce lane’u po odpowiedzi** (`afterAnswer`), więc z
przerwą 300 ms jest poza stoperem (`queuedMs` 0, `scrubMs` 0), a bez przerwy (`browser-inspector-warm-tight`) czeka na niego następny klient
i płaci go jako `queuedMs` (§6: 15). `scrubMs` > 0 tylko wtedy, gdy siatka bezpieczeństwa w `runFlow` zastała brudny lane — między
snapshotami jednego batchu (legalnie w stoperze, §2.3) albo przy `--no-daemon`. Wiersz „klient” dla `browser-inspector-cold` obejmuje zamknięcie
przeglądarki, bo `--no-daemon` nie rozdziela tych dwóch rzeczy w żadnym pliku.

## queuedMs, scrubMs, cacheHits — osobno

| wariant | queuedMs (med / p90 / max) | scrubMs (med / p90 / max) | cacheHits (med) | cacheHitsDocument (max) |
| --- | ---: | ---: | ---: | ---: |
| browser-inspector-warm | 0 / 0 / 0 | 0 / 0 / 0 | 0 | 0 |
| browser-inspector-warm-tight | 0 / 0 / 0 | 0 / 0 / 0 | 0 | 0 |
| browser-inspector-warm-fresh | 0 / 0 / 0 | 0 / 0 / 0 | 0 | 0 |
| browser-inspector-first | 0 / 0 / 0 | 0 / 0 / 0 | 0 | 0 |
| browser-inspector-cold | 0 / 0 / 0 | 0 / 0 / 0 | 0 | 0 |

Czerwony wiersz tu oznacza `cacheHitsDocument > 0`: dokument główny podany z cache HTTP (serwer z `Last-Modified` i heurystyczną
świeżością potrafi oddać stary `index.html` po rebuildzie — §2.3); serwer benchu nie wysyła nagłówków cache, więc 0 jest oczekiwane.

## Ilorazy wobec MCP (mediany, ten sam dzień, ta sama maszyna)

MCP naive warm: **2893 ms** · MCP naive 1. przebieg: 3639 ms · MCP lean `--timeout-settle 100` warm: 980 ms.

| wariant browser-inspector | mediana | p90 | podstawa | iloraz (pomiar) | iloraz (projekt §6) | vs lean settle 100 |
| --- | ---: | ---: | --- | ---: | ---: | ---: |
| browser-inspector-warm | 333 ms | 347 ms | MCP naive warm 2893 ms | **8,7×** | 5,3× | 2,9× |
| browser-inspector-warm-tight | 326 ms | 341 ms | MCP naive warm 2893 ms | **8,9×** | 5,2× | 3,0× |
| 🔴 browser-inspector-first | 1373 ms | 1389 ms | MCP naive, 1. przebieg 3639 ms | **2,7×** | 2,4× | 0,7× |
| 🔴 browser-inspector-cold | 1465 ms | 1472 ms | MCP naive, 1. przebieg 3639 ms | **2,5×** | 2,2× | 0,7× |
| 🔴 browser-inspector-warm-fresh | 752 ms | 763 ms | MCP naive warm 2893 ms | **3,8×** | 3,1× | 1,3× |

🔴 przy ilorazie < 5,0 jest literalne (AC-19); dla `browser-inspector-first`, `browser-inspector-cold` i `browser-inspector-warm-fresh` projekt **nie obiecuje** 5× (kolumna
„projekt §6”: 2,4× / 2,2× / 3,1×) — czerwień mówi tam tylko „poniżej progu 5×”, nie „gorzej niż projekt”.

## Wiersze poza flow benchu (§6, druga tabela)

| sytuacja | projekt | pomiar | ocena |
| --- | ---: | ---: | --- |
| `browser-inspector-warm-fresh` (`--fresh`: świeży kontekst z puli spare, goto 190–441) | 932 ms | 752 ms (goto 390 ms) | −19 % |
| app-factory, 6 snapshotów, `--parallel 1`, config bez zmian (completed 6/6) | ≈ 8000–10 000 ms | 10 744 ms (n=2) | poza zakresem, w tolerancji |
| 🔴 scrub między snapshotami app-factory (`snapshots[].scrubMs`, 4 originy) | 12–35 ms | 6 ms (n=10) | −50 % poniżej dołu |
| 🔴 app-factory, 6 snapshotów, `--parallel 3`, config bez zmian (completed 6/6) | ≈ 8000–10 000 ms | 5027 ms (n=2) | −37 % poniżej dołu |
| 🔴 app-factory, 6 snapshotów, `--parallel 1`, config po migracji `networkidle` → `settled` (completed 6/6) | ≈ 2500 ms | 8707 ms (n=2) | +248 % |
| 🔴 app-factory, 6 snapshotów, `--parallel 3`, config po migracji `networkidle` → `settled` (completed 6/6) | ≈ 1300–1600 ms | 4355 ms (n=2) | +172 % ponad górę |

