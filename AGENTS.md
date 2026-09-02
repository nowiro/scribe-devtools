# Instrukcje dla agenta pracującego w tym repozytorium

To repozytorium to **scribe-devtools**: narzędzia deweloperskie w duchu scribe — skrypty
zamiast serwerów MCP, wyniki na dysku, „banalnie proste". Dwie części:

- `packages/browser-inspector/` — **browser-inspector 2**, binarka `bi`: flow batch z configu
  JSON (drop-in dla bramki app-factory) i sesja interaktywna na refach `eN`, jedna tabela
  kroków (`STEPS`), jeden silnik na playwright-core z systemowym Chrome/Edge, ciepła
  przeglądarka w lokalnym keeperze. Projekt: [docs/DESIGN.md](docs/DESIGN.md) — to jest
  kontrakt; plan pakietów: [docs/PLAN.md](docs/PLAN.md); kryteria: [docs/ACCEPTANCE.md](docs/ACCEPTANCE.md);
  jak używać: [README.md](README.md), szablon flow: [packages/browser-inspector/templates/flow.md](packages/browser-inspector/templates/flow.md).
- `bench/` — pomiar czasu i tokenów `bi` kontra `@playwright/mcp` (przypięte 0.0.80).

Proza po polsku (README, AGENTS, CHANGELOG, docs), identyfikatory i komentarze w kodzie po
angielsku (komentarz mówi DLACZEGO, nie co). Kod to czysty ESM `.mjs` bez kroku budowania; typy
przez JSDoc, sprawdzane `tsc --checkJs`. Tylko wbudowane moduły Node i `playwright-core`.

## Instrukcja dla agenta używającego `bi` (koszt stały, mierzony)

Ten blok jest cytowany co do znaku przez `INSTRUCTION` w `bench/bi-run.mjs` i policzony
w benchu jako koszt stały (limit 150 tokenów o200k — AC-6). Zmieniasz go tu → zmieniasz
tam; `scripts/check-instruction-sync.mjs` w `npm run verify` pilnuje równości.

<!-- INSTRUCTION:START -->
> Przeglądarka: `bi <config.json> [--stamp X]` wykonuje flow, wynik w `<outputDir>/<stamp>/<snapshot>/report.md` (nagłówek, `## errors`, `## values`; `## steps` tylko przy FAIL); nieudany krok = wynik, exit 0. Sesja: `bi open <url>`, `bi find <tekst>` / `bi snap` dają refy `eN`; `bi click|fill|form|press|select|wait|shot|eval|console|net …` drukują jedną linię (exit 1 = FAIL); `bi export flow.json` zapisuje sesję jako config.
<!-- INSTRUCTION:END -->

## Bramki — uruchamiaj PRZED uznaniem zmiany za skończoną

| komenda | co pilnuje |
| --- | --- |
| `npm run verify` | wszystko poniżej, w tej kolejności |
| `prettier --check .` | format: 120 kolumn, LF, pojedyncze cudzysłowy (`.prettierignore`: proza z wąskimi tabelami, generowane, fixture'y) |
| `vitest run` | projekty `unit` (FakePage, keeper na prawdziwym pipe z fake'iem silnika, `client-imports`), `scripts` (CODE-INDEX, portable staging + `bi help` z rozpakowanego drzewa), `bench`, `smoke`, `compat` (perf tylko z `BI_PERF=1`) |
| `tsc --noEmit` | typy z JSDoc (`checkJs`) w `packages/**`, `scripts/**`, `bench/**` |
| `node scripts/index-code.mjs --check` | świeżość `CODE-INDEX.md` |
| `node scripts/gen-steps-doc.mjs --check` | świeżość `docs/STEPS.md` |
| `node scripts/check-instruction-sync.mjs` | blok wyżej ≡ `INSTRUCTION` w `bench/bi-run.mjs` (do czasu WP9 sprawdza tylko blok i limit tokenów) |
| `npm run smoke` | jeden smoke na prawdziwym Chrome/Edge: batch, izolacja dwóch originów, sesja przez keepera, `bi script`, auth (`BI_SKIP_SMOKE=1` tylko bez przeglądarki) |

Projekt `compat` (`test/compat/smoke-gate.test.mjs`) to bramka zgodności z app-factory: spawnuje
`bin/bi.mjs` na kopii `read.config.browser-inspector.json` z buildami serwowanymi z
`../app-factory/dist/apps/*/browser` (porty 4571–4574; `APP_FACTORY_DIR` nadpisuje położenie)
w trzech trybach i ocenia `report.json` kopią `evaluateReports()`. Bez buildów app-factory
obok repo test **pomija się z komunikatem** — na maszynie z buildami musi być zielony.

W trakcie pracy nad jednym pakietem uruchamiaj swoje testy (`npx vitest run <ścieżka>`) i
`npx prettier --check <pliki>`; pełne `npm run verify` przed oddaniem. Testy z prawdziwą
przeglądarką: kanał `chrome` z fallbackiem `msedge`, headless, własny zakres portów dla serwerów
fixture'ów (smoke WP2: 4501–4519, WP3 generator: 4531–4533, sesja WP6: 4541–4559, auth WP7:
4561–4564, compat WP8: 4571–4579) i unikalny pipe (`keeper-harness.makeEnv()` daje `BI_SOCKET`
+ `BI_TMPDIR`), żeby równoległe agenty nie dzieliły keepera.

Hook `.githooks/pre-commit` regeneruje `CODE-INDEX.md`, `docs/STEPS.md` i zip portable
w `download/` (w tej kolejności, przed każdym commitem). Uzbraja go `npm run prepare` —
**jawnie**, bo `.npmrc` ma `ignore-scripts=true` i `npm install` skryptu `prepare` nie uruchamia.
Build zipa wymaga `node_modules` (`npm ci`) i jest deterministyczny: ten sam stan drzewa daje te
same bajty, więc commit, który nie rusza pakietu, nie dokłada bloba do historii.

## Artefakty GENEROWANE — nigdy nie edytuj ręcznie

| plik | regeneruje | kiedy |
| --- | --- | --- |
| `CODE-INDEX.md` | `npm run code-index` (albo hook) | każda zmiana `.mjs` w `packages/*/src`, `packages/*/bin`, `scripts`, `bench` |
| `docs/STEPS.md` | `npm run docs` (albo hook) | każda zmiana `packages/browser-inspector/src/steps.schema.mjs` (także `help`/`config`/`flags` kroku) |
| `bench/RAPORT.md`, `bench/WYNIKI.md`, `bench/BUDGET.md`, blok `BENCH:START/END` w `README.md` | `npm run bench` | zmiana czegokolwiek w pomiarze, silniku albo kliencie |
| `fixtures/snapshots/*.yml`, `walk.json` | `node packages/browser-inspector/fixtures/snapshots/generate.mjs` | zmiana buildów app-factory albo wersji playwright-core |
| `download/scribe-devtools-portable-<wersja>.zip` + `.sha256` | `npm run portable` (albo hook) | każdy commit; wersja z `packages/browser-inspector/package.json` (korzeń musi się zgadzać), bajty deterministyczne — każda wydana wersja zostaje w repo |

Ręczna edycja któregokolwiek z nich to błąd — zostanie nadpisana albo obleje bramkę.
Żadna liczba w README/RAPORT nie jest wpisywana ręcznie: „5×" to iloraz z pomiaru.

## Punkty synchronizacji (zmiana w jednym wymaga zmiany w drugim)

- blok instrukcji wyżej ↔ `INSTRUCTION` w `bench/bi-run.mjs` — MIERZONY koszt stały;
  rozjazd = pomiar kłamie (bramka `check-instruction-sync`).
- `STEPS` w `src/steps.schema.mjs` ↔ `RUNNERS` w `src/steps.run.mjs` — test równości kluczy
  (`test/engine.test.mjs`); klient importuje tylko schemat, silnik tylko runnery;
  `docs/STEPS.md` i `bi help` renderują tę samą tabelę.
- `PageLike` w `src/types.d.ts` ↔ `FakePage` w testach ↔ wywołania w `steps.run.mjs`.
- protokół keepera (`KeeperRequest/Response`, bez `env`) ↔ `src/client.mjs` ↔ `src/keeper.mjs`;
  adresy wartości (`snapshots[i].steps[j].value`, `argv.<cmd>.value`, `script[n].value`) ↔
  `ctx.value()` w silniku; linie `bi script` dzieli `splitCommandLine` z `client.mjs` po obu stronach.
- `scrubPlan` (ops) w `src/isolation.mjs` ↔ `applyScrub` w silniku.
- kształt `report.json` (`completed`, `steps[].description/ok/error`, `navigationError` tylko gdy
  jest, `timing.mode/ctx/tab/queuedMs/scrubMs/cacheHits`) ↔ `bench/budget.mjs` ↔ kopia
  `evaluateReports()` w `test/compat/smoke-gate.test.mjs` ↔ `tools/scripts/smoke-browser.mjs`
  w app-factory.
- `findRunner` w `tools/scripts/smoke-browser.mjs` (app-factory) ↔ jej spec ↔ układ tego repo
  (`packages/browser-inspector/bin/bi.mjs`, `node_modules/playwright-core`) — przeniesienie
  binarki wymaga PR w app-factory.
- fixture `packages/browser-inspector/fixtures/app-factory.config.json` ≡ `read.config.browser-inspector.json`
  w app-factory (porty 4311–4314 → test przepisuje na 4571–4574).
- wersja `@playwright/mcp`: `bench/package.json` ↔ `.mcp.json` ↔ `.vscode/mcp.json` (test).
- `playwright-core` przypięty **exact** `1.62.1` w `packages/browser-inspector` i `bench`
  (fakty o `aria-ref` w DESIGN.md dotyczą tej wersji); tożsamość keepera liczy tę wersję;
  `stagePortable` odmawia, gdy `node_modules` ma inną.
- tabela budżetu §6 DESIGN.md ↔ `bench/budget.mjs` (`DESIGN_BUDGET`).
- README „Sesja" (próbki stdout) ↔ `src/print.mjs` (test reprodukuje próbki DESIGN §4.4 co do znaku).

## Wydanie (wersjonowanie: SemVer, historia: CHANGELOG.md)

1. Dopisuj do `CHANGELOG.md` sekcji `Unreleased` RAZEM ze zmianą, nie przy tagowaniu;
   odwołuj się do numerów `AC-n` z `docs/ACCEPTANCE.md` i pakietów `WPn` z `docs/PLAN.md`.
2. Wydanie: podbij `version` w `packages/browser-inspector/package.json` **i w korzeniu** (build
   zipa odmawia, gdy się różnią; wersję czyta się wyłącznie z `package.json`) → przenieś
   `Unreleased` do nowej sekcji z datą → `npm run verify` (z buildami app-factory obok, żeby
   `compat` nie był pominięty) → `npm run bench -- --assert-speedup 5` (RAPORT.md z kolumną
   `mcp-lean --timeout-settle 100` i `bi-warm-tight`; blok BENCH w README) → commit (hook buduje
   `download/scribe-devtools-portable-<wersja>.zip` + `.sha256` i dodaje je do commita) →
   tag `vX.Y.Z` → push z tagiem →
   `gh release create vX.Y.Z download/scribe-devtools-portable-<wersja>.zip download/…zip.sha256 --title ... --notes ...`.
3. Bramka app-factory: `pnpm smoke:browser` z `CI=true` (bez keepera) i lokalnie z keeperem
   **dwa razy z rzędu**, wszystkie 6 snapshotów `completed` — dopiero potem PR w app-factory
   (`findRunner`, skrypt `bi`, dwa zdania w AGENTS.md) jest scalany.
4. Zip portable JEST commitowany: każda wersja zostaje w `download/` (asset Release'a to ten sam
   plik, sumę kontrolną niesie sidecar `.sha256`). Starych zipów nie usuwaj — „każda wersja
   istnieje w repo" to reguła, nie wygoda.

## Czego nie robić

- Nie commituj wyników: `.scribe/`, `.bi/`, `bench/out/`, `read.config.*.json` (poza
  `fixtures/` i `examples/`) — to zrzuty i sesje cudzej aplikacji.
- Nie dodawaj ścieżek DELETE — jedyne czyszczenie to `storage … clear` w piaskownicy
  własnego kontekstu i scrub między przebiegami.
- Sekrety wyłącznie przez zmienne środowiskowe (`valueFromEnv`, `--env`, `@{NAZWA}`) —
  literał w `auth.login` ma być błędem walidacji; keeper nigdy nie dostaje `env`; żaden test
  ani fixture nie zawiera prawdziwego hasła.
- Nie importuj `playwright-core`, `engine.mjs` ani `steps.run.mjs` w kliencie (`bin/bi.mjs`,
  `src/client.mjs`) — budżet startu klienta to 72 ms, test `client-imports` pilnuje grafu.
- Nie używaj `networkidle` domyślnie, `isTTY` do czegokolwiek, ping-pongu kart ani
  `about:blank` między przebiegami — zmierzone i odrzucone (DESIGN.md §11).
- Nieudany krok to wynik w raporcie (exit 0 w batchu), nie wyjątek.
- Nie instaluj zależności z lifecycle scriptami bez namysłu — `.npmrc` ma `ignore-scripts=true`
  i to jest bezpiecznik, nie przeszkoda. Tylko wbudowane moduły Node i `playwright-core`.
- Nie dotykaj `D:/github/scribe` (repozytorium źródłowe portu) i nie commituj w app-factory
  z tego repo — zmiany tam idą osobnym PR.
- Duże wyniki zostawiaj na dysku, nie w oknie kontekstu — to jest teza całego repo.

## Gdzie co jest

Mapa zależności: [CODE-INDEX.md](CODE-INDEX.md). Projekt i kontrakty: [docs/DESIGN.md](docs/DESIGN.md).
Plan pakietów roboczych i własność plików: [docs/PLAN.md](docs/PLAN.md). Kryteria akceptacji:
[docs/ACCEPTANCE.md](docs/ACCEPTANCE.md). Kroki: [docs/STEPS.md](docs/STEPS.md) (generowane).
Prośby i ustalenia między pakietami roboczymi: `docs/handoff/<WPn>.md` — czytaj wszystkie przed
zmianą cudzego kontraktu. Wynik pomiaru: [bench/RAPORT.md](bench/RAPORT.md), budżet vs pomiar:
[bench/BUDGET.md](bench/BUDGET.md).
