# Handoff WP9 → WP8, WP10 (i WP1/WP5/WP6 — obserwacje) — bench i BUDGET.md

WP9 dostarczył cały katalog `bench/` (poza `package.json` WP0 i `probes/README.md`): `serve.mjs`,
`task.mjs`, `tokens.mjs`, `time-run.mjs`, `bi-run.mjs` (`INSTRUCTION`, warianty), `mcp-client.mjs`,
`mcp-run.mjs`, `raport.mjs`, `budget.mjs`, `bench.mjs`, `bench.test.mjs`, `app/` (strona benchu),
oraz `.mcp.json` i `.vscode/mcp.json` z pinem `@playwright/mcp@0.0.80`. Wygenerowane z pomiaru:
`bench/RAPORT.md`, `bench/WYNIKI.md`, `bench/BUDGET.md`, blok `BENCH:START/END` w `README.md`
(surowe dane w `bench/out/results.json`, poza repo).

Zielone (2026-09-02): `npx vitest run --project bench` (30 testów, bez przeglądarki), `prettier --check`
na plikach WP9, `tsc --noEmit` — 0 błędów w `bench/**`, `node scripts/check-instruction-sync.mjs`
(blok AGENTS.md ≡ `INSTRUCTION`, 146 tokenów). `npm run bench` (`--reps 3 --warm 10`) przebiegł do
końca na tej maszynie — liczby w sekcji „Wynik” niżej.

**Prośba (plik współdzielony, nieedytowany przez WP9):** do `CHANGELOG.md` sekcji `Unreleased` dopisać:
`- WP9: bench — bi (cold, first z first-ever osobno, warm n≥10 z przerwą 300 ms, warm-tight, warm-fresh,
interactive naive/lean, keeper-survives-shell cmd/bash/pwsh, app-factory parallel 1/3 bez zmian i po
settled) vs @playwright/mcp 0.0.80 (naive, lean, lean --timeout-settle 100) na jednym zadaniu z bramką
checkFindings; tokeny o200k po obu stronach; RAPORT.md z tabelą nagłówkową, WYNIKI.md, BUDGET.md
(fazy vs §6, queuedMs/scrubMs/cacheHits, > 25 % i iloraz < 5,0 czerwone), blok BENCH w README,
--assert-speedup na medianie; pin 0.0.80 w trzech plikach pilnowany testem (AC-3, AC-4, AC-5, AC-6, AC-19).`

## Jak uruchomić

```
npm run bench                                  # wszystko: bi + MCP, reps 3, warm n=10, app-factory z ../app-factory
npm run bench -- --only bi | --only mcp        # połówka → pliki .partial (nie nadpisują commitowanych)
npm run bench -- --reps 3 --warm 10            # powtórzenia cold/first · n ścieżki ciepłej (obie strony)
npm run bench -- --assert-speedup 5            # exit 1, gdy mediana bi-warm < 5× mediany MCP naive warm (albo tryb ≠ warm)
npm run bench -- --skip-app-factory            # bez buildów app-factory (albo BENCH_APP_FACTORY=<katalog>)
```

Porty: **4300** (formularz) i **4311–4314** (buildy app-factory: nowiro, business-wizard, bookstore,
school-journal z `<app-factory>/dist/apps/<app>/browser`, MIME `.js → text/javascript`). Bench bierze
`docs/handoff/ports.lock` (`{ pid, ports, since, what }`) na czas przebiegu i czeka do 10 min na żywego
posiadacza; martwy lock (pid nie żyje) jest przejmowany. **WP8**: bramka app-factory / `test/compat`
powinna robić to samo (zapisać lock z własnym pid, sprawdzić cudzy) — inaczej dwa procesy na 4311 dają
`EADDRINUSE` i fałszywe wyniki.

Środowisko każdego `bi` w benchu (`benchEnv`): zmienne `BI_*` i CI wyrzucone, `BI_DAEMON=1`,
`BI_SOCKET=\\.\pipe\bi-bench-<pid>-<rnd>` (POSIX: socket w `bench/out/bi/tmp`), `BI_TMPDIR=bench/out/bi/tmp`,
`BI_CHANNEL=chrome`, `BI_IDLE_MS=900000`. Bench nigdy nie dotyka domyślnego pipe’a użytkownika.

## Co mierzy który wariant (DESIGN §9 → kod)

| wariant | funkcja | jak |
| --- | --- | --- |
| `bi-cold` | `timeCold` | `bi stop` + czekanie na pid i potomne `chrome.exe`, potem `--no-daemon` × reps; po każdym przebiegu czekanie na `chrome.exe` klienta (PowerShell `Win32_Process`, `ps` na POSIX) |
| `bi-first` | `timeFirst` | `bi stop` (+ czekanie) przed każdym; keeper startuje w stoperze; `#0` = first-ever (osobno w RAPORT, poza ilorazami), mediana z kolejnych `reps` |
| `bi-warm` / `-tight` / `-fresh` | `timeWarm` | n wywołań z przerwą 300 / 0 / 300 ms (`--fresh`); `timing.mode === 'warm'` walidowany per przebieg |
| tokeny batch | `batchTokens` | `INSTRUCTION` (stały) + `bi read.config.json` + stdout + cały `report.md`; wariant `pnpm bi` osobno |
| `bi-interactive-naive/lean` | `runInteractive` | 17 komend przez keepera, każda osobnym procesem; tokeny = komendy + stdout (bez plików); sesja `BI_SESSION=bench-<kind>` |
| `keeper-survives-shell` | `keeperSurvivesShell` | `bi up` w `cmd /d /s /c`, `bash -c`, `pwsh -Command` z własnym `BI_SOCKET`; po wyjściu powłoki `bi status` z procesu benchu |
| `app-factory` | `measureAppFactory` | kopia `read.config.browser-inspector.json` z `outputDir ./runs`, `--parallel 1` i `3`, bez zmian i z `networkidle → settled`; 2 przebiegi każdy |
| MCP naive / lean / lean settle 100 | `runVariant` (tokeny) / `timeVariant` (czas) | serwer raz, 1. przebieg n=1, potem n z przerwą 300 ms i `about:blank` poza stoperem |

Stemple: `makeStamp(rep, base)` — minuta = numer powtórzenia (`YYYY-MM-DD_HH-MM` wymaga unikalności
per przebieg; dziesięć przebiegów w jednej minucie zegara nadpisywałoby `report.json`).

## Wynik (2026-09-02, ta maszyna; pełne liczby w bench/RAPORT.md i BUDGET.md)

`node bench/bench.mjs --reps 3 --warm 10` (Chrome/152, i7-11850H, Win 11, Node 26.5, @playwright/mcp 0.0.80 —
24 narzędzia w `tools/list`), bramka `checkFindings` zielona w każdym wariancie, `timing.mode` zgodny w każdym przebiegu:

| wariant | mediana | p90 | × vs MCP naive warm 3 788 ms | × vs lean settle 100 (1 666 ms) |
| --- | ---: | ---: | ---: | ---: |
| bi-warm (n=10, przerwa 300 ms) | **435 ms** | 706 ms | **8,7×** | 3,8× |
| bi-warm-tight (n=10, bez przerwy) | 420 ms | 473 ms | 9,0× | 4,0× |
| bi-warm-fresh (`--fresh`) | 839 ms | 892 ms | 4,5× | 2,0× |
| bi-first (n=3; first-ever 2 565 ms osobno) | 1 676 ms | 2 012 ms | 2,8× vs 1. przebieg MCP 4 706 | — |
| bi-cold (`--no-daemon`, n=3) | 1 909 ms | 2 002 ms | 2,5× vs 1. przebieg | — |
| MCP naive / lean / lean settle 100 (warm, n=10) | 3 788 / 3 802 / 1 666 ms | 3 805 / 4 021 / 1 773 | — | — |

Tokeny (o200k, na sesję z jednym zadaniem): **bi batch 400** (146 stałe + 4 komenda + 27 stdout + 223 `report.md`;
`pnpm bi` 402), bi-interactive-naive **755** (z gołym `bi snap`), bi-interactive-lean **558**, MCP naive **6 842**,
MCP lean **5 521** (koszt stały MCP 4 069). AC-6: blok 146 ≤ 150 ✓, batch 400 ≤ 400 ✓ (na styk — `report.md` ma 223 tok.,
nie 187 z próbki, bo niesie też linię `console.error Failed to load resource…` przeglądarki i „Niepoprawnych pól: 4”),
sesja naive bez gołego snap = lean 558 ≤ 600 ✓, z jednym snap 755 ≤ 1 000 ✓.

AC-3: 435 ms ≤ 580 ✓ (8,7× ≥ 5,0; `--assert-speedup 5` przeszłoby). AC-5: **bi-first 1 676 ms > 1 600** i **bi-cold
1 909 ms > 1 750** — oba ponad progiem (first-ever 2 565 ms); rozbicie w BUDGET.md: `goto` na świeżej karcie 355–366 ms
(projekt 250), klient + zamknięcie w `bi-cold` 378 ms (projekt 277). To sprawa silnika/keepera (WP2/WP5), nie benchu —
zgłaszam jako otwarte. keeper-survives-shell: cmd **yes**, bash **yes**, pwsh **yes**. app-factory (6/6 completed w
każdym przebiegu): bez zmian parallel 1 → 15,4 / 12,9 s, parallel 3 → 7,1 / 6,2 s; po `networkidle → settled` parallel 1
→ 11,4 / 10,9 s, parallel 3 → 8,1 / 6,1 s — sama migracja `waitUntil` nie daje 2,5 s z §3.4, bo 4,2 s to `wait ms`,
których lint nie zamienia automatycznie (potrzebny `waitFor` z selektorem od autora configu).

BUDGET.md ma 17 wierszy 🔴 — większość to fazy **szybsze** niż projekt (kroki 228 vs 384, goto 23 vs 55, dowód 4 vs 12),
czerwone literalnie przez > 25 % rozjazdu w dowolną stronę; wolniejsze od projektu są: klient (115 vs 85 — Node 26 na
tej maszynie startuje w ~100 ms), `writeMs` (19–31 vs 10), goto na świeżej karcie (355 vs 250) i cały `bi-first`/`bi-cold`.

## Odstępstwa od DESIGN/PLAN (z uzasadnieniem)

- **Strona benchu to kopia `fixtures/form.html`** (`bench/app/index.html`), nie build Angulara z
  `demo/app`: w `D:/github/scribe` nie ma `demo/app/dist` ani `node_modules`, a zbudowanie go wymagałoby
  `npm install` w cudzym drzewie. Fixture jest odbiciem `demo/app` (te same `data-testid`, walidacja,
  `POST /api/zgloszenia` → 404 widoczny tylko w konsoli), więc zadanie jest to samo. Konsekwencja: krok
  `evaluate formularz-zamkniety` sprawdza `form.hidden` (fixture chowa formularz, Angular go usuwał), a
  `licznik-niepoprawnych` daje „Niepoprawnych pól: 4” (cztery pola, nie trzy z próbki §5.1) — bramka
  `checkFindings` go nie asertuje (jak zapowiedział WP2).
- **Config benchu bez bloku `browser`** + `BI_CHANNEL=chrome` w env: `collectIdentity` liczy `channel`
  z `env.BI_CHANNEL ?? browser.channel ?? ''`, więc config z jawnym `"channel": "chrome"` ma INNY hash
  (i inny plik pid) niż `bi up` bez configu. Z `BI_SOCKET` obie tożsamości celują w ten sam pipe, drugi
  keeper dostaje `EADDRINUSE`, a klient po 3 s idzie w `fallback` — tak wyglądał pierwszy nieudany
  przebieg próbny. Obserwacja dla **WP5/WP1**: `bi up` jako hook `SessionStart` nie ogrzeje keepera
  dla configu z jawnym `browser.channel`; warto normalizować pusty channel do domyślnego (`chrome`)
  po obu stronach albo udokumentować w README (WP8).
- **Sesja interaktywna ma 17 komend, nie 13 z listy §9** (`open, find, click, snap --diff, form, click,
  wait, get×3, console, shot×2`): `form` wypełnia tylko pola tekstowe (WP2), więc select, radio i
  checkbox to osobne `select`/`click`/`click`; komunikat walidacji wymaga `get [data-testid=error-email]`
  (kompakt snapshotu nie pokazuje akapitów, więc `snap --diff` daje `0 changed`). Wariant naive ma gołe
  `bi snap` zamiast `find`; oba mają `snap --diff`. Tokeny liczone z komend i stdout — plików sesji
  agent w tym zadaniu nie czyta.
- **`form` z selektorem atrybutowym nie działa**: `bi form "[data-testid=field-name]=Jan"` dzieli na
  pierwszym `=` → `page.fill: Unexpected token "" while parsing css selector "[data-testid"`. Wariant
  lean używa `#name`, `#email`, `#description`. Prośba do **WP1/WP6**: dzielić parę na ostatnim `=`
  poza nawiasem `[...]` albo honorować cudzysłów wokół celu; przypadek do `docs/STEPS.md` (WP8).
- **Scrub jest w stoperze także z przerwą 300 ms**: silnik szoruje leniwie na początku następnego
  `runFlow` (docs/handoff/WP2.md), keeper nie woła `engine.scrub(lane)` po odpowiedzi, więc `queuedMs`
  w `bi-warm-tight` wynosi 0, a `scrubMs` (5–10 ms) siedzi w każdym ciepłym przebiegu. BUDGET.md ma
  przez to jeden wiersz `queuedMs + scrubMs` (projekt 0 / 15) i oba osobno w tabeli niżej. Jeśli WP5
  doda scrub po odpowiedzi w kolejce lane’u (prośba WP2), wiersz zacznie się zgadzać z §6 bez zmian
  w benchu.
- **Faza „import playwright-core” w BUDGET.md**: dla `bi-first` import silnika dzieje się, gdy klient
  czeka na keepera (poza `clientMs` keepera), więc siedzi w wierszu „klient” (projekt 85 + 270 = 355);
  dla `bi-cold` w procesie (wiersz launch, projekt 685). Wiersz „klient” `bi-cold` obejmuje też
  `browser.close` (277) — `--no-daemon` nie rozdziela tych rzeczy w żadnym pliku.
- **`tools/list` serwera 0.0.80 w domyślnej konfiguracji ma 24 narzędzia**, nie 70 (70 = wszystkie,
  z opcjonalnymi capabilities); koszt stały MCP liczony jest z tego, co serwer naprawdę ogłasza
  (`--browser chrome --headless --isolated`). RAPORT.md pisze obie liczby.
- **Parytet** w RAPORT.md to zliczenie macierzy §7 z DESIGN.md w czasie generowania raportu
  (`paritySummary`), nie ręczna tabela — jedyne źródło statusów jest w DESIGN.md.
- Wariant „sondy” z §9 (`bi-warm` bez flag frame-rate, `motion: reduce`, zrzut PW zamiast CDP) nie jest
  w `npm run bench` — to sondy projektowe do `bench/probes/`, nie kolumny raportu (README probes).
- `docs/handoff/ports.lock` powstaje w `docs/handoff/` (jak w zleceniu); jest usuwany na końcu przebiegu
  i nie powinien trafić do commita (jeśli zostanie po przerwanym przebiegu, jest martwy i przejmowalny).

## Obserwacje dla innych pakietów

- **WP5 (keeper/klient)**: (1) tożsamość vs `browser.channel` w configu — wyżej; (2) `bi stop` na
  keeperze bez zadań odpowiada w ~90 ms, ale Chrome znika 300–500 ms później — bench czeka na potomne
  `chrome.exe`, `bi doctor`/testy mogą tego potrzebować przy szybkim `up` po `stop`.
- **WP2 (silnik)**: w ciepłym przebiegu `writeMs` (30–45 ms) jest 3–4× nad budżetem 10 ms, a
  `gotoMs` (17–25 ms) i `stepsMs` (170–290 ms) poniżej budżetu (55 / 384) — patrz BUDGET.md; zrzut
  `walidacja` w pierwszym przebiegu po launchu kosztuje 70–540 ms (rozgrzanie CDP screenshot), potem 30 ms.
- **WP8 (README/AGENTS)**: blok `BENCH:START/END` jest już w README i bench go nadpisuje; opis skryptu
  `npm run bench` z flagami wyżej; `ports.lock` jako protokół dla bramki compat.
- **WP10**: `npm run bench -- --assert-speedup 5` (lokalnie, bez innych przeglądarek w tle) przed tagiem;
  `bench/out/` jest w `.gitignore`, RAPORT/WYNIKI/BUDGET są commitowane.
