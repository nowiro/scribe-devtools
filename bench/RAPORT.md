# RAPORT.md — browser-inspector 2 vs @playwright/mcp: czas i tokeny

To samo zadanie QA na tym samym formularzu (`bench/task.mjs`, 18 kroków), wykonane przez `browser-inspector` w każdym wariancie z
DESIGN.md §9 i przez serwer MCP Playwrighta w trzech wariantach, zmierzone dwiema miarami: **ile czasu** od `spawn` do
`exit` prawdziwego procesu klienta i **ile tokenów** wchodzi do okna kontekstu agenta. Raport generuje `npm run bench` —
każda liczba niżej pochodzi z przebiegu, żadna nie jest wpisana ręcznie.

Środowisko: 2026-09-02T11:53:14.713Z · 11th Gen Intel(R) Core(TM) i7-11850H @ 2.50GHz (16 rdzeni, 32 GB) · win32 10.0.26200 · Node 26.5.0 · browser-inspector 0.1.0 · playwright-core 1.62.1 · Chrome/152 · @playwright/mcp 0.0.80 (24 narzędzi w `tools/list`).
Powtórzenia: cold/first ×3, warm n=10 po obu stronach, przerwa 300 ms po obu stronach.

## Tabela nagłówkowa

| wariant | mediana | p90 | n · tryb | × vs MCP naive | × vs MCP lean | × vs MCP lean `--timeout-settle 100` |
| --- | ---: | ---: | --- | ---: | ---: | ---: |
| browser-inspector-warm | **321 ms** | 338 ms | 10 · `warm` | **9,1×** | **10,6×** | **3,1×** |
| browser-inspector-warm-tight | **315 ms** | 336 ms | 10 · `warm` | **9,3×** | **10,8×** | **3,2×** |
| browser-inspector-first | **1402 ms** | 1410 ms | 3 · `first` | **2,6×** (vs 1. przebieg) | **2,9×** (vs 1. przebieg) | **1,2×** (vs 1. przebieg) |
| browser-inspector-cold | **1471 ms** | 1478 ms | 3 · `no-daemon` | **2,5×** (vs 1. przebieg) | **2,8×** (vs 1. przebieg) | **1,2×** (vs 1. przebieg) |
| browser-inspector-warm-fresh | **743 ms** | 757 ms | 10 · `warm` | **3,9×** | **4,6×** | **1,3×** |
| browser-inspector-first, first-ever (pierwsze w tym przebiegu benchu, n=1, poza ilorazami) | 1392 ms | — | 1 · `first` | — | — | — |
| MCP naive (agent poznaje ekran) | 2920 ms (warm) | 2934 ms | 10 · 1. przebieg 3626 ms | — | — | — |
| MCP lean (agent zna selektory) | 3398 ms (warm) | 3420 ms | 10 · 1. przebieg 4135 ms | — | — | — |
| MCP lean `--timeout-settle 100` | 993 ms (warm) | 1012 ms | 10 · 1. przebieg 1728 ms | — | — | — |

**Wniosek z tabeli:** ścieżka ciepła `browser-inspector-warm` (mediana 321 ms, p90 338 ms) jest **9,1× vs domyślne** ustawienia MCP (naive warm 2920 ms), 10,6× vs MCP lean i **~3,1× vs zestrojony settle 100** (993 ms) — dwie trzecie różnicy to domyślna polityka `--timeout-settle 500` serwera po każdej akcji, nie architektura. 5× jest własnością **każdego wywołania po pierwszym**; `browser-inspector-first` (1402 ms) i `browser-inspector-cold` (1471 ms) to fizyka startu Chrome i są raportowane osobno, poza progiem 5×.

```mermaid
xychart-beta
    title "Czas zadania (ms, mediany, cieplo)"
    x-axis ["browser-inspector-warm", "browser-inspector-warm-tight", "browser-inspector-warm-fresh", "MCP naive", "MCP lean", "MCP lean settle 100"]
    y-axis "ms" 0 --> 4000
    bar [321, 315, 743, 2920, 3398, 993]
```

```mermaid
xychart-beta
    title "Czas zadania na zimno (ms, mediany)"
    x-axis ["browser-inspector-first", "browser-inspector-cold", "MCP naive 1. przebieg", "MCP lean 1. przebieg"]
    y-axis "ms" 0 --> 5000
    bar [1402, 1471, 3626, 4135]
```

## Tokeny (o200k)

Dwie kolumny, bo mieszanie ich zaciera obraz. **Stały** płaci się w KAŻDEJ sesji, zanim padnie pierwsze pytanie: po stronie
MCP definicje narzędzi z `tools/list` (+ `initialize`), po stronie `browser-inspector` blok instrukcji w AGENTS.md. **Zmienny** płaci się za
wykonanie zadania: po stronie MCP argumenty i tekst odpowiedzi każdego wywołania, po stronie `browser-inspector` komendy, stdout i
przeczytany w całości `report.md` (batch) albo same linie stdout (sesja — zrzuty to pliki, których agent nie czyta).

| wariant | stały | zmienny | razem na sesję |
| --- | ---: | ---: | ---: |
| **browser-inspector batch** — `browser-inspector read.config.json`, stdout, cały `report.md` | 158 | 256 | **414** |
| browser-inspector batch przez `pnpm browser-inspector` (skrypt pakietu) | 158 | 258 | **416** |
| **browser-inspector-interactive-naive** — gołe `browser-inspector snap`, potem refy (17 komend) | 158 | 641 | **799** |
| **browser-inspector-interactive-lean** — `browser-inspector find` + selektory (17 komend) | 158 | 454 | **612** |
| MCP Playwright — agent poznaje ekran | 4069 | 2745 | **6814** |
| MCP Playwright — agent zna selektory | 4069 | 1430 | **5499** |

```mermaid
xychart-beta
    title "Tokeny na sesje z jednym przebiegiem zadania"
    x-axis ["browser-inspector batch", "browser-inspector batch (pnpm browser-inspector)", "browser-inspector-interactive-naive", "browser-inspector-interactive-lean", "MCP naive", "MCP lean"]
    y-axis "tokeny" 0 --> 8000
    bar [414, 416, 799, 612, 6814, 5499]
```

Batch `browser-inspector` kosztuje **414** tokenów na sesję wobec 6814 (MCP naive) i 5499 (MCP lean) — **16,5×** / 13,3× mniej. Sam koszt stały: 158 vs 4069.

### Gdzie idą tokeny (najdroższe pozycje kosztu zmiennego)

**browser-inspector batch**

| pozycja | tokeny |
| --- | ---: |
| report.md w całości | 223 |
| stdout przebiegu | 27 |
| komenda agenta (browser-inspector read.config.json) | 6 |

**browser-inspector batch (pnpm browser-inspector)**

| pozycja | tokeny |
| --- | ---: |
| report.md w całości | 223 |
| stdout przebiegu | 27 |
| komenda agenta (pnpm browser-inspector read.config.json) | 8 |

**browser-inspector-interactive-naive**

| pozycja | tokeny |
| --- | ---: |
| ← snap stdout | 223 |
| ← console stdout | 64 |
| → browser-inspector form "e10=Jan Kowalski" e12=jan.kowalski@example.com "e24=Formularz nie zapisuje zgloszenia po kliknieciu Wyslij." | 45 |
| ← open stdout | 35 |
| ← shot stdout | 28 |

**browser-inspector-interactive-lean**

| pozycja | tokeny |
| --- | ---: |
| ← console stdout | 64 |
| → browser-inspector form "#name=Jan Kowalski" #email=jan.kowalski@example.com "#description=Formularz nie zapisuje zgloszenia po kliknieciu Wyslij." | 43 |
| ← open stdout | 35 |
| ← shot stdout | 28 |
| ← shot stdout | 27 |

**mcp-naive**

| pozycja | tokeny |
| --- | ---: |
| ← browser_snapshot (odpowiedź) | 579 |
| ← browser_snapshot (odpowiedź) | 492 |
| ← browser_snapshot (odpowiedź) | 315 |
| ← browser_click (odpowiedź) | 126 |
| ← browser_click (odpowiedź) | 124 |

**mcp-lean**

| pozycja | tokeny |
| --- | ---: |
| → browser_fill_form (argumenty) | 195 |
| ← browser_fill_form (odpowiedź) | 131 |
| ← browser_click (odpowiedź) | 127 |
| ← browser_click (odpowiedź) | 125 |
| ← browser_console_messages (odpowiedź) | 118 |

## Sesja interaktywna (`browser-inspector-interactive`)

Każda komenda to osobny proces `node bin/browser-inspector.mjs` przez keepera (czas = spawn → exit). Dwa warianty: `naive` (agent patrzy
gołym `browser-inspector snap` i działa na refach) i `lean` (agent zna selektory, `browser-inspector find` tylko dla przycisku). Oba oglądają stan po
pierwszym kliku (`browser-inspector snap --diff`).

| wariant | komend | czas całej sesji | komenda: mediana / p90 | tokeny | bramka |
| --- | ---: | ---: | ---: | ---: | --- |
| browser-inspector-interactive-naive | 17 | 2366 ms | 112 / 143 ms | 799 | ok |
| browser-inspector-interactive-lean | 17 | 2229 ms | 105 / 147 ms | 612 | ok |

<details><summary>browser-inspector-interactive-naive — komendy i stdout</summary>

```
$ browser-inspector open http://localhost:4300/   # 544 ms, exit 0
ok open "Zgłoszenie serwisowe" · el 12 · err 0 · .scribe-devtools/browser-inspector/session/bench-naive/snap.md
$ browser-inspector snap   # 114 ms, exit 0
h1 "Zgłoszenie serwisowe"
e6 link "Na górę" → #top [data-testid=nav-top]
e7 link "Formularz" → #form [data-testid=nav-form]
e10 textbox "Imię i nazwisko" [data-testid=field-name]
e12 textbox "E-mail" [data-testid=field-email]
e14 combobox "Kategoria" [data-testid=field-category]
option "Awaria" [selected]
option "Pytanie"
option "Wniosek o zmianę"
e18 radio "Niski" [data-testid=priority-niski]
e20 radio "Normalny" [checked] [data-testid=priority-normalny]
e22 radio "Krytyczny" [data-testid=priority-krytyczny]
e24 textbox "Opis" [data-testid=field-description]
e26 checkbox "Zgadzam się na przetwarzanie danych" [data-testid=field-consent]
e28 button "Wyślij zgłoszenie" [data-testid=submit]
$ browser-inspector click e28   # 143 ms, exit 0
ok click e28 · dom Δ
$ browser-inspector snap --diff   # 104 ms, exit 0
0 changed · .scribe-devtools/browser-inspector/session/bench-naive/snap.md
$ browser-inspector get [data-testid=error-email]   # 104 ms, exit 0
Podaj poprawny adres e-mail.
$ browser-inspector shot walidacja   # 112 ms, exit 0
ok shot .scribe-devtools/browser-inspector/session/bench-naive/shots/001-walidacja.png 1280x720
$ browser-inspector form "e10=Jan Kowalski" e12=jan.kowalski@example.com "e24=Formularz nie zapisuje zgloszenia po kliknieciu Wyslij."   # 116 ms, exit 0
ok form 3 fields · dom Δ
$ browser-inspector select e14 zmiana   # 110 ms, exit 0
ok select e14 = zmiana
$ browser-inspector click e22   # 130 ms, exit 0
ok click e22 · dom Δ
$ browser-inspector click e26   # 131 ms, exit 0
ok click e26 · dom Δ
$ browser-inspector click e28   # 138 ms, exit 0
ok click e28 · dom Δ
$ browser-inspector wait --sel [data-testid=confirmation]   # 105 ms, exit 0
ok wait [data-testid=confirmation]
$ browser-inspector get [data-testid=ticket-id]   # 99 ms, exit 0
ALM-1001
$ browser-inspector get [data-testid=ticket-category]   # 99 ms, exit 0
zmiana
$ browser-inspector get [data-testid=ticket-priority]   # 99 ms, exit 0
krytyczny
$ browser-inspector console --errors   # 103 ms, exit 0
2 new:
error Failed to load resource: the server responded with a status of 404 (Not Found) (http://localhost:4300/api/zgloszenia:0)
error [zgloszenia] zapis nie powiodl sie: HTTP 404 (http://localhost:4300/:125)
$ browser-inspector shot potwierdzenie   # 112 ms, exit 0
ok shot .scribe-devtools/browser-inspector/session/bench-naive/shots/002-potwierdzenie.png 1280x720
```

</details>

<details><summary>browser-inspector-interactive-lean — komendy i stdout</summary>

```
$ browser-inspector open http://localhost:4300/   # 521 ms, exit 0
ok open "Zgłoszenie serwisowe" · el 12 · err 0 · .scribe-devtools/browser-inspector/session/bench-lean/snap.md
$ browser-inspector find Wyślij   # 112 ms, exit 0
e28 button "Wyślij zgłoszenie" [data-testid=submit]
$ browser-inspector click e28   # 147 ms, exit 0
ok click e28 · dom Δ
$ browser-inspector snap --diff   # 105 ms, exit 0
0 changed · .scribe-devtools/browser-inspector/session/bench-lean/snap.md
$ browser-inspector get [data-testid=error-email]   # 97 ms, exit 0
Podaj poprawny adres e-mail.
$ browser-inspector shot walidacja   # 110 ms, exit 0
ok shot .scribe-devtools/browser-inspector/session/bench-lean/shots/001-walidacja.png 1280x720
$ browser-inspector form "#name=Jan Kowalski" #email=jan.kowalski@example.com "#description=Formularz nie zapisuje zgloszenia po kliknieciu Wyslij."   # 103 ms, exit 0
ok form 3 fields · dom Δ
$ browser-inspector select #category zmiana   # 88 ms, exit 0
ok select #category = zmiana
$ browser-inspector click [data-testid=priority-krytyczny]   # 108 ms, exit 0
ok click [data-testid=priority-krytyczny] · dom Δ
$ browser-inspector click #consent   # 122 ms, exit 0
ok click #consent · dom Δ
$ browser-inspector click e28   # 132 ms, exit 0
ok click e28 · dom Δ
$ browser-inspector wait --sel [data-testid=confirmation]   # 104 ms, exit 0
ok wait [data-testid=confirmation]
$ browser-inspector get [data-testid=ticket-id]   # 95 ms, exit 0
ALM-1001
$ browser-inspector get [data-testid=ticket-category]   # 99 ms, exit 0
zmiana
$ browser-inspector get [data-testid=ticket-priority]   # 91 ms, exit 0
krytyczny
$ browser-inspector console --errors   # 84 ms, exit 0
2 new:
error Failed to load resource: the server responded with a status of 404 (Not Found) (http://localhost:4300/api/zgloszenia:0)
error [zgloszenia] zapis nie powiodl sie: HTTP 404 (http://localhost:4300/:125)
$ browser-inspector shot potwierdzenie   # 109 ms, exit 0
ok shot .scribe-devtools/browser-inspector/session/bench-lean/shots/002-potwierdzenie.png 1280x720
```

</details>

## keeper-survives-shell

`browser-inspector up` w podprocesie powłoki, wyjście powłoki, `browser-inspector status` z nowego procesu: czy keeper przeżył? Jeśli host zabija drzewo
(Job Object), każde wywołanie agenta jest zimne i 5× dostaje tylko bench.

| powłoka | przeżył | `browser-inspector up` w powłoce | `browser-inspector status` po wyjściu | uwaga |
| --- | --- | ---: | ---: | --- |
| cmd | **yes** | 606 ms | 108 ms |  |
| bash | **yes** | 610 ms | 95 ms |  |
| pwsh | **yes** | 828 ms | 114 ms |  |

## app-factory (6 snapshotów, buildy na 4311–4314)

Config: `D:\github\app-factory\read.config.browser-inspector.json` (kopia z własnym `outputDir`; wariant „settled” = `networkidle` → `settled`, kroki `wait ms` bez zmian).

| config | parallel | przebiegi (ms) | completed | tryb |
| --- | ---: | --- | ---: | --- |
| bez zmian | 1 | 11 639 · 9543 | 6/6 | warm, warm |
| bez zmian | 3 | 5330 · 4695 | 6/6 | warm, warm |
| po migracji `settled` | 1 | 9022 · 8094 | 6/6 | warm, warm |
| po migracji `settled` | 3 | 4279 · 4147 | 6/6 | warm, warm |

## Parytet z @playwright/mcp (macierz DESIGN.md §7)

Wierszy macierzy: 27 — ✅ 23 · ⚠️ 1 · ❌ 2. Serwer 0.0.80 w domyślnej konfiguracji ogłasza 24 narzędzi w `tools/list` (macierz liczy 70 z opcjonalnymi); każde ✅ ma test smoke albo jednostkowy (AC-15).

| narzędzie MCP | status |
| --- | --- |
| run_code_unsafe | ⚠️ tylko sesja, jawnie RCE-równoważne |
| install | ❌ celowo: systemowy Chrome/Edge |
| resume, annotate, video_chapter, video_show/hide_actions | ❌ celowo: `page.pause()` i kosmetyka nagrań headed |

## Bramka poprawności

Każdy wariant wyciągnął komplet faktów: numer zgłoszenia, kategoria, priorytet, komunikat walidacji, błąd z konsoli i dwa
zrzuty (`checkFindings` w `bench/task.mjs`). Porównanie opisuje więc różne drogi do **tego samego** wyniku.

## Metodyka i zasady uczciwości (DESIGN.md §9)

1. **Ten sam tokenizer po obu stronach** (`o200k_base` — proxy; wiarygodny jest stosunek, nie liczba absolutna).
2. **Liczone jest to, co wchodzi do kontekstu**: dla `browser-inspector` blok AGENTS.md jako koszt stały + komenda + stdout + `report.md` w
   całości (batch) / same linie stdout (sesja); dla MCP `tools/list` + `initialize` jako koszt stały + argumenty i tekst
   odpowiedzi każdego wywołania (jawne `browser_snapshot`, bo 0.0.80 linkuje snapshot w pliku, a agent i tak musi go zobaczyć).
3. **Czas od `spawn` do `exit` prawdziwego procesu klienta** (`node bin/browser-inspector.mjs …`), nigdy import w procesie benchu; po stronie
   MCP czas zadania na serwerze podniesionym raz (1. przebieg n=1 osobno, kolejne z medianą).
4. **Przerwa 300 ms między powtórzeniami po obu stronach** — scrub `browser-inspector` i `about:blank` MCP są poza stoperem tylko wtedy;
   `browser-inspector-warm-tight` pokazuje, co się dzieje bez przerwy.
5. **`timing.mode` każdego przebiegu jest walidowany**: przebieg z trybem innym niż oczekiwany w kolumnie (np. `first` w warm)
   jest wypisany pogrubieniem w tabeli nagłówkowej i unieważnia pomiar tej kolumny.
6. **`browser-inspector-cold` czeka na zniknięcie pid klienta i potomnych `chrome.exe`** przed następnym powtórzeniem; `browser-inspector-first` zatrzymuje
   keepera (`browser-inspector stop`) i czeka tak samo. „first-ever” (pierwsze wywołanie w przebiegu benchu) jest osobno, poza ilorazami.
7. **Ta sama strona dla obu stron**: statyczna kopia formularza (`bench/app/`, `bench/serve.mjs`, bez nagłówków cache, bez
   dev-servera), `/api/zgloszenia` zawsze 404 — awaria widoczna wyłącznie w konsoli i sieci.
8. Wersje i sprzęt w nagłówku; każdy iloraz liczy się wobec pomiaru MCP 0.0.80 z tego samego dnia i tej samej maszyny.

Pełne rozbicie tokenów co do pozycji: [WYNIKI.md](WYNIKI.md). Fazy przebiegu wobec budżetu DESIGN.md §6: [BUDGET.md](BUDGET.md).
Surowe dane: `bench/out/results.json` (nie w repo).
