# Przegląd wydajności `browser-inspector` — v0.1.0

Data przeglądu: 2026-09-02. Stan kodu: `scribe-devtools` od `a5bbd5f` (stan wyjściowy) do `a6ecf98` (HEAD w chwili
zamknięcia); tag `v0.1.0` wskazuje wydanie sprzed tej rundy. Numery linii odnoszą się do stanu `a6ecf98`; ścieżki
`src/…` i `test/…` oznaczają `packages/browser-inspector/src/…` i `…/test/…`. W trakcie przeglądu drzewo przesunęło się
o pięć commitów — refaktor silnika na moduły (`646bfad`), pakiet wydajnościowy (`7bcc9c0`), dwie naprawy liczników
(`a439a6f`), sam ten dokument (`30dc3e6`) i wdrożenie punktów 3 i 5 planu (`a6ecf98`) — więc część ustaleń jest już
**zamknięta**; każde takie mówi o tym wprost i podaje pomiar przed/po.

Przegląd prowadzono w dwóch rundach po cztery niezależne soczewki. Runda druga dostała listę ustaleń rundy pierwszej z
zakazem odkrywania ich ponownie, więc numeracja nie ma dziur po duplikatach.

## 1. Zakres i metoda

### 1.1 Dwie waluty

`browser-inspector` płaci za swoją tezę w dwóch walutach naraz i obie są mierzone w `npm run bench`:

- **milisekundy** — czas od `spawn` do `exit` prawdziwego procesu klienta, rozbity na fazy w `report.json.timing`
  i porównany z budżetem §6 DESIGN.md w `bench/BUDGET.md`;
- **tokeny o200k** — to, co realnie wchodzi do okna kontekstu agenta: blok instrukcji jako koszt stały, komendy, stdout
  i cały `report.md`.

Optymalizacja, która skraca czas kosztem tokenów (albo odwrotnie), nie jest optymalizacją — jest przesunięciem kosztu.
Dlatego obie osi mają w tym dokumencie własne soczewki i własne ustalenia.

### 1.2 Sześć soczewek

| prefiks  | co bada                                                                                        |
| -------- | ---------------------------------------------------------------------------------------------- |
| `CLIENT` | start procesu klienta, tożsamość, protokół, `spawn → listen` keepera                           |
| `ENGINE` | fazy przebiegu: launch, `goto`, kroki, dowód końcowy, zapisy, scrub, przydział lane'ów         |
| `STEPS`  | wnętrze `steps.run.mjs` i `snapshot.mjs` — obiegi do przeglądarki i złożoność czystych funkcji |
| `TOKENS` | koszt kontekstu: `report.md`, `elements.md`, kompakt snapshotu, linie stdout, blok instrukcji  |
| `LIFE`   | co się dzieje po ośmiu godzinach: pamięć, uchwyty, dysk, procesy, degradacja ciepłej ścieżki   |
| `GATE`   | bramki, testy, punkty synchronizacji, świeżość dokumentów                                      |

### 1.3 Zakres i czego świadomie nie mierzono

W zakresie: `packages/browser-inspector/**`, `bench/**`, `scripts/**`, artefakty w `bench/out/` (86 plików
`report.json`, `_manifest.json` z ośmiu przebiegów app-factory), buildy app-factory obok repozytorium.

Poza zakresem: koszt aplikacji pod testem jako cel optymalizacji (mierzony, ale wyłącznie po to, żeby **oddzielić** go od
naszego narzutu — patrz §5), wydajność samego Chrome, alternatywne silniki. Nie mierzono też niczego, co §11 DESIGN.md
opisuje jako zmierzone i odrzucone; lista tamtych decyzji jest w §7 tego dokumentu razem z tym, co odrzuciła ta runda.

**Ograniczenie metodyczne, które trzeba znać przy czytaniu liczb.** Cztery soczewki pracowały równolegle na jednej
maszynie i miały zakaz uruchamiania przeglądarki oraz benchu — inaczej mierzyłyby siebie nawzajem. Dlatego: liczby
bezwzględne z ich sond są zawyżone i oznaczone jako takie, wiarygodne są **delty A/B mierzone naprzemiennie w jednym
przebiegu** oraz fakty z kodu i z artefaktów leżących na dysku. Każdy pomiar, na którym opiera się decyzja, został
powtórzony na spokojnej maszynie po zamknięciu rundy — te są oznaczone `CONFIRMED`.

## 2. Werdykt w pięciu zdaniach

Ciepła ścieżka jest wyciśnięta i to nie w niej leżą pieniądze: na zadaniu referencyjnym zostało ~320 ms, z czego połowa
to bootstrap Node'a i sterowanie przeglądarką, a jedyny wiersz budżetu z realnym zapasem okazał się czekaniem na ciała
odpowiedzi, których batch nigdzie nie renderuje. Na **prawdziwej** aplikacji obraz jest inny i ważniejszy: nasz narzut
to ~20 % przebiegu, koszt aplikacji ~28 %, a **54 % to siedem kroków `wait ms` w configu** — największa pojedyncza
pozycja pomiaru nie jest ani w naszym kodzie, ani w aplikacji. Dwa liczniki nie mierzyły niczego: `cacheHits` opierał
się na metodzie, której nie ma w playwright-core 1.62.1, a timer bezczynności keepera był resetowany co 30 sekund przez
zamiatanie sesji — oba przeżyły, bo testy sprawdzały własne atrapy zamiast rzeczywistości, i oba są już naprawione.
Największy pojedynczy zysk czasowy, jaki został do wzięcia, to zrzuty `fullPage` idące wolną ścieżką Playwrighta zamiast
CDP (808 ms wobec 17–66 ms), a największy tokenowy — pozycyjne ścieżki CSS w `elements.md`, które zjadają 63 % pliku
droższego niż cały `report.md`. Dwie pozycje z planu — czytanie ciał odpowiedzi w batchu i przydział lane'ów po kolei —
są już zamknięte i zmierzone (`a6ecf98`): razem ze zmianami wcześniejszymi ciepła ścieżka zeszła z 348 na 304 ms, a
iloraz wobec MCP naive z 8,3× na 10,1×. Nic z tego nie wymaga zmiany architektury: wszystkie otwarte pozycje to zmiany
punktowe, a trzy z nich wymagają decyzji właściciela wyłącznie dlatego, że dotykają kontraktu raportu albo obietnic
zapisanych w DESIGN.md.

## 3. Tabela ustaleń

Werdykt: `CONFIRMED` — potwierdzone w kodzie i powtórzone pomiarem na spokojnej maszynie; `MEASURED` — zmierzone przez
soczewkę na obciążonej maszynie albo policzone z artefaktów, mechanizm potwierdzony w kodzie; `HYPOTHESIS` — mechanizm
w kodzie pewny, wielkość zysku niezmierzona. Kolumna „zysk” podaje jednostkę właściwą dla soczewki (ms / tokeny / inne).

| ID       | Waga   | Plik:linia                         | Werdykt          | Zysk                       | Status        | Opis                                                                                                                   |
| -------- | ------ | ---------------------------------- | ---------------- | -------------------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------- |
| ENGINE-1 | high   | `src/recorder.mjs:260` (był)       | CONFIRMED, repro | —                          | **zamknięte** | `cacheHits` liczony przez `response.fromCache()`, metodę nieistniejącą w playwright-core 1.62.1 — 0 w 86 raportach.    |
| LIFE-1   | high   | `src/keeper.mjs:448` (był)         | CONFIRMED, repro | —                          | **zamknięte** | Zamiatanie sesji co 30 s resetowało 30-minutowy timer bezczynności — keeper nie wychodził nigdy.                       |
| ENGINE-2 | high   | `src/capture.mjs:98`               | MEASURED         | 0,6–1,0 s / przebieg       | otwarte       | `fullPage` z definicji omija szybką ścieżkę CDP; zrzut koszyka 808 ms wobec 17–66 ms przez CDP.                        |
| ENGINE-3 | high   | `src/recorder.mjs:189` (był)       | CONFIRMED, repro | 45 ms (−19 %)              | **zamknięte** | `recorder.settle()` czekał na ciała, których batch nie renderuje; `captureBodies` opt-in → 232 → 187 ms, `settleMs` 0. |
| CONFIG-1 | high   | `fixtures/app-factory.config.json` | CONFIRMED        | 3,5–4,0 s / przebieg       | do decyzji    | Siedem kroków `wait ms` = 4248 ms zmierzonego snu, 54 % przebiegu app-factory; `waitFor` robi to samo w 28 ms.         |
| CLIENT-1 | high   | `src/cli.mjs:49` (był)             | CONFIRMED, A/B   | 13 ms / wywołanie          | **zamknięte** | `new Intl.DateTimeFormat` w ciele modułu — 12 ms ICU w każdym procesie klienta, który stempla nie używa.               |
| ENGINE-4 | medium | `src/keeper.requests.mjs:284`      | CONFIRMED, repro | −10 % zmierzone            | **zamknięte** | `lane = k % parallel` sadzał dwa najdłuższe snapshoty na jednym lane'ie; `planLanes` (offline LPT) to naprawia.        |
| TOKENS-1 | medium | `src/capture.mjs:150`              | MEASURED         | 2982 tok. (−63 %)          | otwarte       | Pozycyjne ścieżki CSS w `elements.md`; 43 ze 100 wpisów to bezimienne linki, dla których ścieżka jest całą treścią.    |
| TOKENS-2 | medium | `src/report.mjs:42`                | MEASURED         | do 1750 tok.               | otwarte       | `extract` wchodzi inline do `report.md` do 5000 znaków ≈ 1950 tokenów w pliku projektowanym na 190.                    |
| STEPS-1  | medium | `src/session.mjs:277`              | MEASURED         | 2–3 ms × komenda           | otwarte       | `resolveRef` i `durableSelector` rozwiązują ten sam ref dwa razy: 5 komunikatów CDP zamiast 2.                         |
| STEPS-4  | medium | `src/snapshot.mjs:345`             | MEASURED         | 187 ms @ 4000 węzłów       | otwarte       | `namesContext` × `firstLabelUnder` jest kwadratowe w jednym nienazwanym kontenerze.                                    |
| STEPS-5  | medium | `src/snapshot.mjs:908`             | MEASURED         | 54 ms @ 2000 węzłów        | otwarte       | `boxJoin` degraduje do kwadratowego, gdy boxy dryfują między `ariaSnapshot` a `walkInteractive`.                       |
| LIFE-2   | medium | `src/paths.mjs:98`                 | MEASURED         | —                          | otwarte       | Każda edycja `src/` to nowa tożsamość i nowy keeper; `status`/`stop` widzą tylko bieżącą.                              |
| LIFE-3   | medium | `src/recorder.mjs:299`             | MEASURED, repro  | 225 MB / 8 h               | otwarte       | W sesji `console`/`network` zamarzają na 500, a `bodies` rośnie bez capa — 1200 ciał, 700 nieosiągalnych.              |
| LIFE-7   | medium | `src/flow.mjs:119`                 | CONFIRMED        | —                          | otwarte       | Kontekst `fresh` wycieka przy każdym wyjątku między utworzeniem a `close()` — brak `try/finally`.                      |
| CORR-1   | medium | `src/client.mjs:667`               | MEASURED         | —                          | otwarte       | `status`/`stop`/`doctor` liczą tożsamość bez `config.browser` — nie widzą keepera batcha z własną przeglądarką.        |
| GATE-1   | medium | `package.json:16` (był)            | CONFIRMED        | ~30 s Chrome / bramkę      | **zamknięte** | `vitest run` uruchamiał `smoke`, a `verify` wołał go zaraz drugi raz.                                                  |
| GATE-2   | medium | `test/keeper.test.mjs` (był)       | CONFIRMED        | `unit` 17,5 → 8,75 s       | **zamknięte** | Jeden plik testowy był 70 % czasu projektu `unit`; vitest zrównolegla po plikach.                                      |
| GATE-3   | medium | `src/client.mjs:716`               | CONFIRMED        | —                          | otwarte       | `PROTOCOL_VERSION` w trzech kopiach (keeper, klient ×2, test) — podbicie wersji nie zapala żadnej bramki.              |
| ENGINE-5 | low    | `src/flow.mjs:253`                 | CONFIRMED        | —                          | **zamknięte** | `writeMs` rozbity na `shotsMs`/`settleMs`; etykieta wiersza budżetu mówiła o zapisach, których tam nie ma.             |
| CLIENT-2 | low    | `src/client.mjs:51`                | MEASURED         | do 25 ms na `first`        | otwarte       | `CONNECT_RETRY_MS = 25` kwantyzuje oczekiwanie: keeper gotowy o ~60 ms jest odbierany o 75 ms.                         |
| CLIENT-3 | low    | `src/keeper.mjs:25`                | MEASURED         | 22–26 ms na `first`        | otwarte       | Cały graf `keeper.requests.mjs` ładuje się przed `listen`, choć przed pierwszym żądaniem jest zbędny.                  |
| CLIENT-4 | low    | `src/client.mjs:17`                | MEASURED         | 2,4 ms / wywołanie         | otwarte       | `node:child_process` i `config.mjs` statyczne w kliencie, nieużywane na ciepłej ścieżce sesyjnej.                      |
| ENGINE-6 | low    | `src/report.mjs:624`               | CONFIRMED        | 1–3 ms / snapshot          | otwarte       | Trzy ostatnie zapisy w `writeArtifacts` są szeregowe, choć nie mają zależności.                                        |
| ENGINE-7 | low    | `src/lanes.mjs:556`                | CONFIRMED        | ~25 ms na lane app-factory | otwarte       | `resetContext` to osiem szeregowych `await` bez wzajemnych zależności.                                                 |
| STEPS-2  | low    | `src/steps.run.mjs:258`            | MEASURED         | 2,35 ms / `snap`           | otwarte       | `snapshotLines` liczy kompakt drugi raz, choć `writeSnapshotFiles` właśnie go zapisało do `ctx.lastSnapshot`.          |
| STEPS-3  | low    | `src/steps.run.mjs:580`            | MEASURED         | 7 ms + 102 KB I/O          | otwarte       | `find` parsuje YAML czterokrotnie i przepisuje trzy pliki, które `open` właśnie zapisało.                              |
| STEPS-6  | low    | `src/steps.ctx.mjs:84`             | CONFIRMED        | 1–3 ms + stabilność        | otwarte       | `ariaSnapshot` i `walkInteractive` sekwencyjnie — ta przerwa produkuje dryf boxów z STEPS-5.                           |
| STEPS-7  | low    | `src/snapshot.mjs:463`             | MEASURED         | ~30 % renderu              | otwarte       | Fold w `renderTree` liczy poddrzewa dwa razy: O(n × głębokość).                                                        |
| STEPS-8  | low    | `src/snapshot.mjs:222`             | MEASURED         | 3,7 ms / `snap --grep`     | otwarte       | Ten sam YAML parsowany 3–4 razy na komendę; brak cache po tekście.                                                     |
| STEPS-9  | low    | `src/session.mjs:339`              | HYPOTHESIS       | 2–6 ms / komenda           | otwarte       | `probePage` to trzeci przelot po dokumencie w komendach, które już go przeszły.                                        |
| STEPS-10 | low    | `src/steps.run.mjs:1025`           | CONFIRMED        | 3 komunikaty               | otwarte       | `RUNNERS.locator` liczy trwały selektor dwa razy; `tabs` czyta tytuły sekwencyjnie.                                    |
| STEPS-11 | low    | `src/session.mjs:146`              | HYPOTHESIS       | koszt strony               | do decyzji    | `__bi_dom` obserwuje cały dokument z `attributes` i `characterData` dla jednego booleana.                              |
| TOKENS-3 | low    | `src/snapshot.mjs:327`             | MEASURED         | 99 tok. (−25 %)            | otwarte       | Generowane `#mat-*` w kompakcie; nietrwałe (numeracja idzie za kolejnością instancjonowania).                          |
| TOKENS-4 | low    | `src/snapshot.mjs:582`             | MEASURED         | 86 tok. (−72 %)            | otwarte       | `find` nie zwija identycznych linii; limit 10 trafień wyczerpują klony — to też błąd użyteczności.                     |
| TOKENS-5 | low    | `AGENTS.md:27`                     | MEASURED         | 15 tok. / sesję            | otwarte       | Blok INSTRUCTION: 158 → 143 bez utraty faktu (nazwa dwa razy zamiast sześciu).                                         |
| TOKENS-6 | low    | `src/print.mjs:225`                | CONFIRMED        | 40 tok. / `console`        | otwarte       | `formatConsoleEntry` nie przyjmuje `baseOrigin`, choć bliźniacze `formatNetEntry` tak; plus duplikat linii Chrome.     |
| TOKENS-7 | low    | `src/report.mjs:275`               | MEASURED         | 6–12 tok. / raport         | otwarte       | Nagłówek dopisuje `final:`, a linia niżej i tak drukuje tę samą nazwę w `shots`.                                       |
| TOKENS-8 | info   | `docs/ACCEPTANCE.md:10`            | CONFIRMED        | —                          | otwarte       | AC-6 dopuszcza 420 tokenów, zmierzone 414 — jeden dodatkowy `console.error` wywala bramkę.                             |
| LIFE-4   | low    | `src/lanes.mjs:706`                | MEASURED         | —                          | otwarte       | Lista pidów zamrożona w chwili launchu — próg RSS z czasem mierzy coraz mniejszą część przeglądarki.                   |
| LIFE-5   | low    | `src/keeper.mjs:33`                | MEASURED         | —                          | otwarte       | Progi 200 zadań / 1024 MB bez uzasadnienia pomiarowego; przy otwartej sesji recykling nie zachodzi nigdy.              |
| LIFE-6   | low    | `src/keeper.mjs:372`               | MEASURED         | —                          | do decyzji    | Unia sekretów z całego życia procesu maskuje tekst w każdej późniejszej sesji.                                         |
| LIFE-8   | low    | `src/lanes.mjs:659`                | CONFIRMED        | —                          | otwarte       | Lane'y zbierane tylko po przebiegu batcha; lane 0 nigdy — `laneIdleMs` jest deklaracją bez zegara.                     |
| LIFE-9   | low    | —                                  | MEASURED         | ~64 MB / dzień             | otwarte       | Brak retencji w `.scribe-devtools/`: 3,0–3,4 MB na przebieg bramki, PNG to 94 % objętości.                             |
| LIFE-10  | low    | `src/session-log.mjs:125`          | MEASURED         | 10–50 ms / `open`          | otwarte       | `journalLineCount` czyta cały dziennik synchronicznie; dziennik przeżywa zamknięcie sesji.                             |
| LIFE-11  | low    | `src/keeper.mjs:639`               | MEASURED         | 0,16 ms / linia            | otwarte       | Log keepera: 3 syscalle synchroniczne na linię, kasowanie do zera przy 1 MB — i to jedyne miejsce sygnałów degradacji. |
| GATE-4   | low    | `src/keeper.mjs:375`               | CONFIRMED        | —                          | otwarte       | Dwa parsery tej samej zmiennej: `MAX_JOBS=0` daje keeperowi 0, a `status` pokaże 200.                                  |
| GATE-5   | low    | `src/capture.mjs:255`              | CONFIRMED        | —                          | otwarte       | Siedem eksportów bez ani jednego użytkownika; część trzyma przy życiu tabela w ACCEPTANCE.md.                          |
| GATE-6   | low    | `src/session.mjs:18`               | CONFIRMED        | —                          | otwarte       | `session.mjs → client.mjs` to jedyna krawędź wskazująca w złą stronę; strażnik jest jednokierunkowy.                   |
| GATE-7   | low    | `scripts/index-code.mjs:69`        | CONFIRMED        | —                          | otwarte       | CODE-INDEX liczy importy typów JSDoc jako krawędzie runtime — pokazuje cykl, którego nie ma.                           |
| GATE-8   | low    | `tsconfig.json:39`                 | CONFIRMED        | —                          | otwarte       | `test/fixtures/**` wypada spod prettiera i `tsc`, a mieszka tam `fake-engine.mjs` i harness.                           |
| CORR-2   | low    | `src/client.mjs:436`               | MEASURED         | —                          | otwarte       | `exchange` po cichu zjada nieparsowalną linię — keeper spoza NDJSON daje 10-minutowy timeout zamiast błędu.            |

## 4. Ustalenia szczegółowo

### 4.1 Zamknięte w tej rundzie

**CLIENT-1 — `Intl.DateTimeFormat` w ciele modułu (`7bcc9c0`).** Konstruktor formatera stempla ładował ICU i dane stref
przy każdym imporcie `cli.mjs`, czyli w **każdym** procesie klienta — a klient `formatStamp` nigdy nie woła: robi to
keeper przy `batch` i manifesty w `report.mjs`. Pomiar w świeżym procesie: konstrukcja 11,7–12,7 ms, samo
`formatToParts` 0,05 ms. Po przeniesieniu do leniwej inicjalizacji, A/B naprzemienne: import `cli.mjs` 15,2 → 3,9 ms,
`browser-inspector help` **78 → 65 ms** mediany z pięciu, bench `warm-tight` 326 → 316 ms. Uwaga, którą trzeba było
dopisać po pomiarze: zysk na `first`/`cold` **nie** jest podwójny — keeper przestał budować formater przed `listen`, ale
nadal buduje go przy pierwszym `batch`, więc te warianty zyskują tylko połowę klienta.

**ENGINE-5 — `writeMs` mierzył co innego, niż mówiła etykieta (`7bcc9c0`).** Wiersz budżetu z rozjazdem +380 % nazywał
się „oczekiwanie na zapisy + `report.json/md`, `elements.md`, `text.txt`, manifesty”, a `flow.mjs` obejmuje stoperem
wyłącznie `Promise.allSettled(pending)` + `recorder.settle()`; raporty lądują **po** zamrożeniu `timing` i kosztują 3 ms
(`clientMs − totalMs`). Licznik rozbity na `shotsMs` i `settleMs`, etykieta poprawiona w `bench/budget.mjs` i DESIGN §6.
To ustalenie samo w sobie nie daje milisekund — daje możliwość celowania, i natychmiast obaliło hipotezę, którą ta runda
niosła jako pewnik (patrz ENGINE-3).

**GATE-1, GATE-2 — bramka (`7bcc9c0`).** `vitest run` bez filtra bierze wszystkie projekty łącznie ze `smoke`, po czym
`verify` woła `npm run smoke` drugi raz; poprawione na `vitest run --project !smoke`. Efekt uboczny ważniejszy od
oszczędności: prawdziwy Chrome przestał jechać obok testów jednostkowych, a to on obciążał maszynę na tyle, że testy z
budżetem 200 ms migotały. `test/keeper.test.mjs` (586 linii, 28 testów, 55 spawnów klienta) rozbity wzdłuż własnych
bloków `describe` na cztery pliki — vitest zrównolegla po plikach, a ten jeden był 70 % czasu projektu: `unit`
**17,5 → 8,75 s** przy tych samych 355 testach.

**ENGINE-1 — `cacheHits` nie mierzył niczego (`a439a6f`).** Rejestrator liczył trafienia przez `response.fromCache()`,
a takiej metody **nie ma** w playwright-core 1.62.1 (grep po całym pakiecie: zero trafień; `types.d.ts` zna tylko
`fromServiceWorker()`). Wywołanie rzucało `TypeError`, `safeCall` je połykał, licznik zostawał na zerze — we
**wszystkich 86 plikach `report.json`** w `bench/out/` `cacheHits` i `cacheHitsDocument` to `(0, 0)`. Metryka jest w
kontrakcie `report.json`, ma kolumnę w `bench/BUDGET.md` i podpiera tezę §2.3, że scrub zostawia cache HTTP — i nie
mierzyła nic od początku. Źródłem jest teraz Resource Timing API strony, czytane w tym samym przelocie co dowód końcowy,
więc bez dodatkowego obiegu.

**LIFE-1 — keeper nie wychodził z bezczynności (`a439a6f`).** `sweepSessions` kończyło się bezwarunkowym `armIdle()`, a
`armIdle` kasuje timer i ustawia **pełny** budżet od nowa. Zamiatanie chodzi co `min(sessionTtlMs / 2, 30 s)`, czyli
z domyślnymi ustawieniami co 30 s wobec budżetu 30 minut — deadline był przesuwany w nieskończoność i keeper razem
z Chrome (150–960 MB) żył do restartu maszyny. Sonda bez przeglądarki, przeskalowana do tej samej proporcji: przy
zamiataniu co 100 ms i budżecie 500 ms `onIdle` nie wystrzelił ani razu; przy zamiataniu co 30 s wystrzelił po 513 ms.
Naprawa: zamiatanie uzbraja timer tylko wtedy, gdy faktycznie wygasiło sesję.

**ENGINE-3 — batch przestał czytać ciała odpowiedzi (`a6ecf98`).** Rejestrator czytał `response.text()` dla każdej
odpowiedzi json/text, a **nic w batchu ciał nie renderuje**: jedynym czytelnikiem `recorder.bodies` w całym drzewie jest
sesyjne `net <n> --body` (`steps.run.mjs:935`). Zmierzone przed: `shotsMs` 0, `settleMs` 41–57 ms z `totalMs` ~232.
Po zmianie `captureBodies` na opt-in dla batchu: **232 → 187 ms (−19 %)**, `settleMs` 0, w benchu warm 321 → 304 ms
i iloraz 9,1× → 10,1×. Sesja bez zmian, bo tam ktoś o ciała pyta; `auth` też przestał, bo jego kontekst jest wyrzucany
zaraz po logowaniu i nikt nie woła na nim `settle()`. `size` nie zależy już od odczytu ciała — `Content-Length`, a przy
`chunked` `request.sizes()` (`encodedDataLength`, bez dodatkowego obiegu, zweryfikowane na żywo: 39 bajtów na łączu
wobec 28 zdekodowanych).

**Granica, której rekomendacja nie przewidziała, a pokazał ją dopiero pomiar po wdrożeniu.** Rekomendacja zakładała, że
`request.sizes()` zachowa `size` w każdym przypadku. Nie zachowuje: żądanie **wciąż w locie** w chwili budowania raportu
nie ma ani `ms`, ani `size`, bo oba wypełnia `requestfinished` — a to jest dokładnie ten ogon, którego przestaliśmy
czekać. W zadaniu benchu POST leci na ostatnim kliknięciu, więc trafia w ten przypadek wprost; z jednym krokiem oddechu
po kliknięciu `size` wraca. Nie da się mieć obu naraz: ogon jest oszczędnością. Status, URL i wpis w `## errors`
zostają, bo przychodzą z odpowiedzi. Zapisane w `types.d.ts`, DESIGN §2.2 i CHANGELOG zamiast obietnicy, że nic nie
tracimy — to jest cena tej pozycji i ma być widoczna.

**ENGINE-4 — lane'y przydzielane według kosztu (`a6ecf98`).** `lane = k % parallel` sadzał snapshoty 0 i 3 na jednym
lane'ie niezależnie od tego, ile trwają, choć DESIGN §2.3 obiecuje „czas ≈ max(lane), nie sum(flow)”. Nowy
`src/schedule.mjs`: `planLanes` robi offline LPT po szacunku liczonym **czystą funkcją z configu**
(`Σ wait.ms + 100 × liczba kroków`) — nigdy z historii na dysku, bo to uczyniłoby `outputDir` wejściem planera. Zmienia
się **wyłącznie numer lane'u**; kolejność wyników, `_manifest.json.snapshots[]`, JUnit i adresy `snapshots[i]` zostają
kolejnością configu, a kolejność w obrębie lane'u też — dlatego scrub między snapshotami dalej jest w `scrubMs`, nie
w `queuedMs` (własność, którą złamała odrzucona próba z modelem „worker pull”, §7). Przy równych szacunkach plan
degeneruje się dokładnie do round-robin, więc żadna istniejąca asercja o lane'ach nie wymagała zmiany.

**Rachunek obiecywał więcej, niż dowiózł pomiar.** Na prawdziwych medianach wychodziło 4,35 → 3,24 s (−26 %);
**zmierzone** w benchu na app-factory `settled` + `parallel: 3`: 4279 · 4147 → **3805 · 3751 ms (−10 %)**. Różnica bierze
się stąd, że szacunek dobrze **porządkuje** snapshoty, ale nie zna ich prawdziwych czasów. Lepsza kalibracja była
próbowana przy analizie (baza + dopłata za `networkidle` i `fullPage`) i wypadła **gorzej** — przy sześciu punktach
danych estymatory są nierozróżnialne, a jedyna solidna własność brzmi: każdy szacunek, który stawia dwa najcięższe
snapshoty na czele, wygrywa to samo. Dlatego funkcja została surowa i taka ma zostać. Cela `parallel: 1` jest z
definicji nietknięta, bo plan jednego lane'u to identyczność.

**Wspólna diagnoza ENGINE-1 i LIFE-1, warta zapisania osobno.** Oba błędy przeżyły z tego samego powodu: **test
sprawdzał własną atrapę zamiast rzeczywistości**. Test rejestratora budował odpowiedź _z metodą_ `fromCache`, której
prawdziwy obiekt Playwrighta nie ma. Testy idle ustawiały krótki `IDLE_MS` przy **domyślnym** `SESSION_TTL_MS`, więc
w dwusekundowym teście zamiatanie nie odpalało ani razu. W obu przypadkach test przechodził na zepsutym kodzie i
przechodziłby dalej, gdyby kod zepsuć bardziej. Zastąpione testami, które mierzą rzecz: smoke na prawdziwym Chrome
(pierwszy przebieg `cacheHits: 0`, drugi na wyszorowanym lane'ie `> 0`) i test keepera z produkcyjną proporcją
zamiatanie : budżet — sprawdzone, że oblewa na kodzie sprzed naprawy.

### 4.2 Duże, otwarte

**ENGINE-2 — `fullPage` omija szybką ścieżkę CDP.** Warunek w `capture.mjs:98` brzmi `if (cdp && !options.fullPage &&
!options.selector)`, więc każdy zrzut całej strony idzie przez `page.screenshot({ fullPage: true })`. Z artefaktów
(mediany z ośmiu przebiegów): zrzuty przez CDP 17–66 ms, `screenshot koszyk (full)` na stronie 1280×6335 — **808 ms**.
Zastrzeżenie, które trzeba postawić obok tej liczby: `wizard` robi zrzut `fullPage` w 61 ms, więc to nie jest stała kara
za ścieżkę Playwrighta — koszt rośnie z wysokością strony i część z 808 ms to samo kodowanie PNG. Kierunek naprawy:
`Page.captureScreenshot({ captureBeyondViewport: true, clip: documentRect, optimizeForSpeed: true })`, fallback zostaje.
**Przed wdrożeniem wymagany A/B**, bo wielkość zysku jest niezmierzona — mechanizm jest pewny, liczba nie.

**CONFIG-1 — 54 % przebiegu app-factory to sen w configu.** Siedem kroków `wait ms` (500 + 600 + 700 + 700 + 700 + 400 + 600) daje **4248 ms** zmierzonego snu przy całym batchu ~7,9 s. Kalibracja leży w tym samym pliku: `dziennik-*` używa
wyłącznie `waitFor` i ta sama klasa przejścia kosztuje **28 ms** zamiast 709. `browser-inspector lint-config` **już** to
drukuje. Jedyny sen z uzasadnieniem to 600 ms przed zrzutem koszyka — animacja szuflady, której `waitFor` nie zobaczy.
To nie jest ustalenie o naszym kodzie, tylko o configu, który trzyma bramka — ale jest największą pojedynczą pozycją
całego pomiaru i dlatego stoi wysoko.

**TOKENS-1 — `elements.md` droższy niż cały raport.** Fallback `selectorFor` buduje pozycyjne ścieżki CSS w rodzaju
`#main-content > ais-bookstore-catalogue-page:nth-of-type(1) > … > a:nth-of-type(1)`: 42 takie ścieżki po ~74 tokeny.
Plik bookstore'a ma **4740 tokenów**, bez ścieżek 1758 (−63 %); dla `nowiro-strona` 1211 → 376. Do tego 43 ze 100 wpisów
to `a "" → /book/book-013` — bez nazwy, więc 74-tokenowa ścieżka jest jedynym, czym wpis jest, a ten sam link w
kompakcie kosztuje 10 tokenów. Stopka `more: elements.md (153)` wprost zaprasza do otwarcia pliku, który kosztuje 11×
więcej niż cała sesja batch.

### 4.3 Średnie

**STEPS-1 — każda komenda sesji z refem płaci 5 komunikatów zamiast 2.** `session.mjs:277` owija `ctx.sel`, więc po
`resolveRef` (1 komunikat) leci `durableSelector` = `locator.evaluate` (3 komunikaty w playwright-core 1.62.1:
`waitForSelector` → `handle.evaluate` → `handle.dispose`). Wynik trafia wyłącznie do dziennika i do `export`, nigdy do
stdout. `durableSelector` ma już fallback do sidecaru `snap.json`, a `boxJoin` policzył selektor dla 139/139 węzłów
bookstore'a — więc najtańsza naprawa to „najpierw sidecar, live tylko gdy refu tam nie ma”. Przy 40-komendowej pętli
agenta z ~25 komendami na refie to 75–150 ms.

**STEPS-4, STEPS-5, STEPS-7, STEPS-8 — złożoność czystych funkcji nad snapshotem.** `namesContext` × `firstLabelUnder`
jest kwadratowe w jednym nienazwanym kontenerze (250 → 1,08 ms, 4000 → **187,64 ms**, czyste ×4 na podwojenie);
`boxJoin` degraduje do kwadratowego, gdy żaden box nie trafia dokładnie (2000 → 54,22 ms wobec 4,50 ms przy trafieniach)
— a wyzwalacz jest systemowy, bo `ariaSnapshot` i `walkInteractive` to dwa osobne obiegi (STEPS-6) i dowolna animacja
między nimi przesuwa `y` całej strony; fold w `renderTree` liczy poddrzewa dwa razy (Σ głębokości = 7763 dla 866
węzłów); ten sam YAML parsowany jest 3–4 razy na komendę bez cache po tekście. Bookstore tego nie pokazuje — pokaże
dashboard z dużym gridem albo strona 10× większa.

**LIFE-3 — recorder sesji: dowody zamarzają, pamięć rośnie.** Recorder sesji powstaje raz i `reset()` nie jest na nim
wołany nigdy. `console` i `network` mają cap 500 — po jego osiągnięciu `sinceLast` zwraca **pusto na zawsze**, a
`net --all` drukuje `500 total` bez markera obcięcia. `bodies` capa nie ma wcale. Sonda na atrapie strony (1200
odpowiedzi po 8 KB): 500 dowodów, **1200 ciał (9,4 MB), 700 nieosiągalnych**, `recorder.pending` 1200. SPA z pollingiem
1 Hz osiąga cap po ~8 minutach; po 8 h to ~225 MB w stercie keepera. Najgorsza część nie jest wydajnościowa: agent widzi
`net: 0 new` i wnioskuje, że aplikacja nie wysyła żądań.

**LIFE-2 — osierocone keepery starych tożsamości.** `srcStamp` wlicza max mtime `src/**` do hasza, więc **każda edycja
`src/` to nowy keeper i nowy Chrome**. Komentarz w `paths.mjs` obiecuje, że stary „umrze z bezczynności” — co przed
naprawą LIFE-1 nie działo się nigdy, a po niej działa dopiero po 30 minutach. `status` i `stop` adresują wyłącznie
bieżącą tożsamość; nie ma enumeracji plików pid w `os.tmpdir()`. Dzień pracy nad `src/` to N keeperów × (~40 MB Node +
150–960 MB Chrome), diagnoza wymaga Menedżera zadań.

**LIFE-7 — kontekst `fresh` wycieka przy wyjątku.** `flow.mjs` tworzy kontekst i zamyka go ~220 linii dalej, bez
`try/finally` między nimi. Każdy rzut po drodze zostawia otwarty kontekst i jego renderer na całe życie keepera.
`auth.mjs` robi to poprawnie — wzorzec jest w repozytorium, tylko nie w tym miejscu.

**CORR-1 — `status`/`stop`/`doctor` nie widzą keepera batcha z własną przeglądarką.** `control()`, `runSessionLike()` i
`doctor()` wołają `computeIdentity({ env })` **bez** `config.browser`, a `runBatchLike()` przekazuje `config.browser`.
Config z `browser.channel: "msedge"` albo `headless: false` daje inny hasz, inny pipe — `browser-inspector stop`
odpowiada „keeper not running”, a keeper żyje 30 minut z otwartym Chrome. To nie jest ustalenie wydajnościowe, ale
wychodzi z tej samej analizy i nie jest opisane ani w README, ani w §2.5.

### 4.4 Drobne i porządkowe

`GATE-3` (`PROTOCOL_VERSION` w trzech kopiach — podbicie wersji odbija każde żądanie, a testy klienta zostają zielone,
bo mają własną kopię), `GATE-4` (dwa parsery tej samej zmiennej: `Number(env.X) || D` w silniku, `intEnv` w keeperze —
`MAX_JOBS=0` daje keeperowi 0, a `status` pokaże 200), `GATE-5` (siedem eksportów bez użytkownika: `pageText`,
`elementsMap`, `isPortable`, `processRssMb`, `WAIT_UNTIL`, `renderIndex`, `SESSIONS_PER_DAY` — a komentarz przy jednym
z nich mówi wprost, że istnieje, bo wymienia go tabela w ACCEPTANCE.md), `GATE-6` (`session.mjs → client.mjs` to jedyna
krawędź w złą stronę po refaktorze; `client-imports` jest jednokierunkowy i tego nie zobaczy), `GATE-7` (CODE-INDEX
liczy `import('…')` z komentarzy JSDoc jako krawędzie runtime i pokazuje cykl `keeper.requests → keeper`, którego nie
ma), `GATE-8` (`test/fixtures/**` wypada spod prettiera i `tsc`, a mieszka tam `fake-engine.mjs` — 197 linii, od których
zależy 28 testów keepera), `LIFE-4` (lista pidów zamrożona w chwili launchu), `LIFE-6` (unia sekretów z całego życia
procesu: hasło użyte o 9:00 maskuje słowo w snapshocie o 17:00, w innej sesji), `LIFE-8` (lane 0 nigdy nie jest
zbierany), `LIFE-9` (brak retencji, PNG to 94 % objętości), `LIFE-10` (`journalLineCount` czyta cały dziennik
synchronicznie przy każdym `open`), `LIFE-11` (log keepera kasowany do zera przy 1 MB — a to jedyne miejsce, gdzie
lądują sygnały degradacji ciepłej ścieżki), `CORR-2` (`exchange` zjada nieparsowalną linię).

## 5. Rozkład kosztu na prawdziwej aplikacji

To jest wynik, dla którego druga runda w ogóle powstała: bench mierzy formularz, na którym cały przebieg trwa 320 ms i
wszystko jest wyciśnięte, a realny użytkownik puszcza narzędzie na aplikacji Angulara. Suma czasu silnika dla batcha
sześciu snapshotów app-factory (wariant `settled`, `parallel: 1`): `goto` 1101 + `steps` 6282 + `capture` 525 =
**7908 ms**.

| składnik                                                 |   ms | udział | czyj koszt                          |
| -------------------------------------------------------- | ---: | -----: | ----------------------------------- |
| `wait ms` — siedem kroków snu                            | 4238 |   54 % | **defekt configu** (CONFIG-1)       |
| zrzuty ekranu (942 w krokach + ~473 w dowodzie końcowym) | 1415 |   18 % | **nasz narzut** (ENGINE-2)          |
| `goto`                                                   | 1101 |   14 % | aplikacja (bootstrap Angulara)      |
| realne sterowanie (fill/click/extract/evaluate/waitFor)  | 1102 |   14 % | aplikacja (actionability, animacje) |
| scrub + dowód końcowy                                    | ~150 |    2 % | nasz narzut (ENGINE-7)              |

**Faktyczne sterowanie przeglądarką to 14 % przebiegu.** Nasz narzut to ~20 %, z czego 1415 ms to jedna rzecz. Koszt
aplikacji (~28 %) jest poza zasięgiem narzędzia i nie należy na niego polować: `click mat-option:has-text(…)` = 171 ms
to animacja overlaya Angular Material plus actionability Playwrighta, i tak ma być.

Wniosek dla dokumentu, nie dla kodu: obietnica §6 „app-factory po migracji, `parallel: 1` ≈ 2500 ms” jest o ~1,8 s
optymistyczna, bo budżet nie policzył kodowania PNG. Albo wiersz §6 dostaje pozycję „zrzuty `fullPage`”, albo obietnica
wymaga CONFIG-1 **i** ENGINE-2 naraz.

## 6. Co działa dobrze

- **Scrub jest tańszy, niż zakłada projekt.** Zmierzone `scrubMs` to 5–6 ms dla jednego originu i 28–49 ms dla czterech,
  przy budżecie 12–35 ms; `queuedMs` = 0 we wszystkich wariantach, także `warm-tight`. Mechanizm „scrub po odpowiedzi”
  działa dokładnie tak, jak obiecuje §2.3.
- **Ciepła ścieżka trzyma budżet z zapasem.** `goto` 21 ms przy budżecie 55, kroki 155 ms przy 384, dowód końcowy 3 ms
  przy 12. Czerwone wiersze w BUDGET.md to w większości pesymizm budżetu, nie regres pomiaru — jedynym wierszem, który
  naprawdę wskazywał pracę, był `writeMs`, i ta praca jest opisana jako ENGINE-3.
- **Izolacja nie kosztuje wydajności.** `SCRUB_STORAGE_TYPES` celowo pomija `all`, więc cache HTTP i code cache V8
  zostają — to jest powód, dla którego ciepły `goto` kosztuje 21 ms zamiast 250. Od `a439a6f` jest to **sprawdzane**
  testem, a nie tylko deklarowane.
- **Protokół i tożsamość nie są wąskim gardłem.** Pełna droga pliku 1 MB przez base64 + JSON + parse to 2,6 ms;
  `collectIdentity` z 34 wywołaniami `fs` to 2,4–3,2 ms; podwójny `loadConfig` 0,198 ms. Trzy „oczywiste” cele
  optymalizacji okazały się szumem.
- **Podział silnika na moduły nie osłabił żadnego budżetu.** Po refaktorze: start klienta 80 ms mediana (przed 97),
  keeper nasłuchuje 54 ms po starcie (przed 58), wszystkie 423 testy i 18 smoke zielone bez zmiany zachowania.

## 7. Zmierzone i odrzucone

Ta sekcja istnieje po to, żeby następna runda nie wymyśliła tego samego od nowa. Odrzucenia z §11 DESIGN.md (ping-pong
kart, `about:blank` między przebiegami, nowa karta w scrubie, `DOMStorage.clear` przez CDP, JPEG, `force: true`, własny
silnik selektorów) obowiązują dalej i nie są tu powtarzane.

| pomysł                                                        | dlaczego odrzucony                                                                                                                                                                      |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Buforowanie `srcStamp` zamiast chodzenia po `src/**`          | Zmierzone 1,3 ms z 34 wywołań `fs`. Zamiennik (mtime katalogu) jest **niepoprawny** na NTFS: nie zmienia się przy edycji zawartości pliku.                                              |
| Binarny/length-prefixed transport zamiast NDJSON              | 2,6 ms dla najgorszego realnego przypadku (plik 1 MB). Protokół jest punktem synchronizacji; wymiana za 2 ms to zły interes.                                                            |
| Usunięcie podwójnego `loadConfig` (klient + keeper)           | 0,198 ms dla configu sześciu snapshotów. Usunięcie wymagałoby przesłania sparsowanego configu, czyli zmiany protokołu z §2.4.                                                           |
| `NODE_COMPILE_CACHE`                                          | 1,3–2,4 ms, w szumie — i wymagałoby, żeby zmienną ustawiał wołający agent.                                                                                                              |
| Prewarm jako lekarstwo na pierwszy `goto`                     | `warm-fresh` dostaje **prewarmowaną** parę kontekst+strona i ma najgorszy `goto` ze wszystkich wariantów (390 ms wobec 341 dla `first`).                                                |
| Worker pull w keeperze zamiast `k % parallel`                 | Ten sam makespan na configu referencyjnym; przenosi koszt scrubu ze `scrubMs` do `queuedMs`, łamiąc §2.3, wiersz BUDGET.md i asercję `smoke-gate`.                                      |
| Szacunek kosztu z poprzedniego `_manifest.json`               | Czyni `outputDir` **wejściem** planera — katalog opisany jako „zrzut, można skasować” zaczyna sterować przebiegiem; plus niedeterminizm w CI.                                           |
| Twardy cap na `settle()` (np. 10 ms) zamiast opt-in           | `size` i `bodySkipped` stają się zależne od wyścigu, a `comparable()` w bramce zgodności porównuje je między trzema trybami.                                                            |
| Czytanie ciał tylko dla `status >= 400`                       | Zysk **zero** na zadaniu referencyjnym: to właśnie POST 404 jest tym jednym odczytem, który kosztuje całe 40–55 ms.                                                                     |
| Przekazanie `pending` do `writeArtifacts`                     | `shotsMs` = 0 w pięciu przebiegach — nie ma czego nakładać. Hipoteza obalona własnym licznikiem w dniu, w którym powstał.                                                               |
| Zachowanie `ms`/`size` dla żądania w locie po wyłączeniu ciał | Zmierzone po wdrożeniu ENGINE-3: oba pola wypełnia `requestfinished`, a czekanie na nie JEST tą oszczędnością. Nie da się mieć obu naraz — granica jest udokumentowana, nie obchodzona. |
| Obniżenie progu perf-testu `browser-inspector help`           | §11 odrzuciło 100 ms jako flaky na obciążonej maszynie. To, że CLIENT-1 dał zapas, nie jest powodem, żeby wracać do odrzuconej decyzji.                                                 |

## 8. Plan

Kolejność: iloczyn zysku i pewności, przy czym pozycje zmieniające kontrakt wymagają decyzji właściciela niezależnie od
zysku.

### 8.1 Zamknięte w tej rundzie

| #   | Zmiana                                                                 | Zamyka                             | Commit    |
| --- | ---------------------------------------------------------------------- | ---------------------------------- | --------- |
| 1   | Leniwy `Intl.DateTimeFormat`, `writeMs` → `shotsMs`/`settleMs`, bramka | CLIENT-1, ENGINE-5, GATE-1, GATE-2 | `7bcc9c0` |
| 2   | `cacheHits` z Resource Timing API + smoke, idle bez resetu + regresja  | ENGINE-1, LIFE-1                   | `a439a6f` |
| 3   | `captureBodies` opt-in dla batchu + `size` z `request.sizes()`         | ENGINE-3                           | `a6ecf98` |
| 5   | `planLanes()` — offline LPT po szacunku z configu                      | ENGINE-4                           | `a6ecf98` |

### 8.2 Do 0.1.1 — wymaga decyzji właściciela

Numeracja zachowana z pierwszego wydania dokumentu, żeby odsyłacze w commitach i w CHANGELOG-u dalej wskazywały to samo.
Punkty 3 i 5 przeszły do §8.1.

| #   | Zmiana                                                                                      | Zamyka   | Zysk                 | Koszt |
| --- | ------------------------------------------------------------------------------------------- | -------- | -------------------- | ----- |
| 4   | `fullPage` przez CDP `captureBeyondViewport` (po A/B)                                       | ENGINE-2 | 0,6–1,0 s / przebieg | M     |
| 6   | Migracja `wait ms` → `waitFor` / `wait --text` w configu app-factory (PR po tamtej stronie) | CONFIG-1 | 3,5–4,0 s / przebieg | S     |

### 8.3 Do 0.2 — bez decyzji, do zrobienia

| #   | Zmiana                                                                                                     | Zamyka                         | Koszt |
| --- | ---------------------------------------------------------------------------------------------------------- | ------------------------------ | ----- |
| 7   | `durableSelector` z sidecaru zamiast live `evaluate`; `RUNNERS.locator` i `tabs` bez podwójnej pracy       | STEPS-1, STEPS-10              | S     |
| 8   | Cache parsowania YAML po tekście; `snapshotLines` z `ctx.lastSnapshot.compact`; `find` bez przepisywania   | STEPS-2, STEPS-3, STEPS-8      | S     |
| 9   | Memoizacja `firstLabelUnder`, indeks po zaokrąglonym `(x,y)` w `boxJoin`, `Promise.all` na snapshot+walk   | STEPS-4, STEPS-5, STEPS-6      | M     |
| 10  | `try/finally` wokół kontekstu `fresh`; cap na `recorder.bodies`; `net --all` z markerem obcięcia           | LIFE-7, LIFE-3                 | S     |
| 11  | Ścieżki pozycyjne w `elements.md` przycięte albo pomijane dla wpisów bez nazwy; próg `extract` 600 znaków  | TOKENS-1, TOKENS-2             | S     |
| 12  | `find` zwija klony; generowane `#id` pomijane w kompakcie; `formatConsoleEntry` z `baseOrigin`             | TOKENS-3, TOKENS-4, TOKENS-6   | S     |
| 13  | `PROTOCOL_VERSION` i limity z jednego miejsca; martwe eksporty; `command-line.mjs` zamiast krawędzi wstecz | GATE-3, GATE-4, GATE-5, GATE-6 | S     |
| 14  | `status --all` / `stop --all` po enumeracji plików pid; `status` z `heap`, `uptime`, ostrzeżeniem          | LIFE-2, LIFE-11                | M     |
| 15  | Tożsamość liczona z `config.browser` we wszystkich ścieżkach                                               | CORR-1                         | S     |

### 8.4 Czego świadomie nie robimy

- **Polowania na koszt aplikacji pod testem** (§5, 28 % przebiegu): `click` w Angular Material kosztuje 171 ms, bo tyle
  trwa animacja i actionability. Naszej strony tego kosztu tam nie ma.
- **Zmiany domyślnego okna ciszy `settled`** (100 ms): przy migracji z `networkidle` część kosztu **przesuwa się** z
  `goto` do pierwszego kroku (`extract` 41 → 140 ms na `nowiro-jezyk`), więc netto `settled` daje ~450 ms na snapshot,
  a nie ~500. To jest liczba do BUDGET.md, nie powód do strojenia progu.
- **Ograniczania `__bi_dom` bez decyzji produktowej** (STEPS-11): zawężenie obserwatora do `childList` zdejmie koszt na
  SPA z animacją, ale `dom Δ` przestanie wyłapywać zmiany czysto atrybutowe (`aria-expanded`) — a to bywa dokładnie ta
  zmiana, którą agent chce zobaczyć.
- **Skracania bramki zgodności poniżej trzech trybów.** ~51 s to cena trzech ścieżek kodu i dowodu scrubu między
  przebiegami; skrócenie idzie przez CONFIG-1 (config przestaje spać), nie przez cięcie pokrycia.
- **Retencji `.scribe-devtools/` jako części tej rundy** (LIFE-9): przegląd bezpieczeństwa zna to jako AGENT-11 i ma
  własny plan; ta runda dokłada tylko liczbę — 3,0–3,4 MB na przebieg bramki, PNG to 94 %.

## 9. Metoda

**Dwie rundy po cztery soczewki.** Runda pierwsza: ścieżka gorąca klienta i keepera, ścieżka gorąca silnika, tokeny,
architektura i bramki. Runda druga, po wdrożeniu części ustaleń: profil na prawdziwej aplikacji zamiast mikro-benchu,
wnętrze `steps.run.mjs` i `snapshot.mjs`, rozstrzygnięcie dwóch otwartych decyzji, trwałość długo żyjącego keepera.
Każda soczewka pracowała niezależnie, bez wiedzy o wynikach pozostałych; runda druga dostała listę ustaleń rundy
pierwszej z jawnym zakazem odkrywania ich ponownie i z odesłaniem do §11 DESIGN.md.

**Zasady pomiaru.** Soczewki miały zakaz uruchamiania przeglądarki i benchu — cztery procesy Chrome na jednej maszynie
mierzyłyby siebie nawzajem. Wolno im było: czytać kod, liczyć z artefaktów leżących na dysku (86 plików `report.json`,
`_manifest.json` z ośmiu przebiegów app-factory, fixture'y snapshotów), uruchamiać deterministyczne sondy bez
przeglądarki (atrapy stron, czyste funkcje, `spawnSync` samego Node'a) i mierzyć A/B naprzemiennie w jednym przebiegu.

**Weryfikacja.** Każde ustalenie, na którym opiera się decyzja albo commit, zostało powtórzone na spokojnej maszynie po
zamknięciu rundy — te noszą `CONFIRMED`. Trzy hipotezy nie przetrwały weryfikacji i są opisane jako odrzucone (§7):
przekazanie `pending` do `writeArtifacts` (obalone własnym licznikiem w dniu jego powstania), worker pull jako lekarstwo
na przydział lane'ów (oblało bramkę zgodności i zostało cofnięte), buforowanie `srcStamp` (zamiennik niepoprawny na
NTFS). Dwa liczniki naprawione w tej rundzie dostały testy sprawdzone w obie strony: oblewają na kodzie sprzed naprawy,
przechodzą po niej.

**Czego ten przegląd nie ustalił.** Wielkość zysku z ENGINE-2 (`fullPage` przez CDP) — mechanizm jest pewny, liczba
wymaga A/B na spokojnej maszynie. Zachowanie po ośmiu godzinach pracy (soczewka `LIFE`) opiera się na sondach
przeskalowanych i na czytaniu kodu; soak przez fake'owy silnik, opisany jako pierwszy pomiar do zrobienia, nie został
uruchomiony. Wpływ STEPS-11 (`__bi_dom`) na stronę pod testem jest hipotezą — wymaga pomiaru w przeglądarce na SPA
z animacją sterowaną z JS.
