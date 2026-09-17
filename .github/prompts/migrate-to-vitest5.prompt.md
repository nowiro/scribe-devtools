# /migrate-to-vitest5 — podnieś Vitest 4 → 5 w repozytorium Nx + Angular

Pracujesz w repozytorium TypeScript (**Nx monorepo z Angularem**, `pnpm`), które testuje Vitestem 4.
Podnieś runner do **Vitest 5** razem z każdą paczką `@vitest/*` z repo (`@vitest/coverage-v8`, `@vitest/ui`…
— każda ma peer `vitest` **dokładnie** tej samej wersji, para nierozdzielna). Pracuj krok po kroku; po każdym
kroku uruchom to, co zmieniłeś. Nie zgaduj: gdy czegoś brakuje albo narzędzie nie działa, zatrzymaj się
i zapytaj. **Nie commituj i nie pushuj bez zgody.** Nazwy `apps/`, `libs/`, `@scope`, `versions.ts` to
przykłady — weź je z repo. W PowerShellu zmienną ustaw osobno: `$env:NX_DAEMON='false'; pnpm exec nx …`.

Zasada nadrzędna: każda różnica w liczbie testów, w pokryciu albo w zachowaniu runnera ma wybrzmieć
w run-logu z `plik:linia` i naprawą. „Przeszło" bez liczb nie jest wynikiem.

## 0. Rozpoznanie i baseline (nic nie edytuj)

1. Runnery — jak repo uruchamia Vitest (każdy rodzaj osobno):
   `git grep -n -E "vitest( run|\")|@nx/vitest|@angular/build:unit-test" -- package.json nx.json project.json '**/project.json' .github .gitlab-ci.yml`
   oraz `git ls-files | grep -E 'vitest\.config\.'`. Rodzaje: skrypty w korzeniu (`vitest.config.mts`, progi
   coverage), biblioteki z własnym configiem (`cd lib && vitest run`), projekty Nx przez `nx:run-commands` →
   `vitest run` (config per projekt, `@analogjs/vite-plugin-angular`), executor `@nx/vitest:test` / plugin
   `@nx/vitest/plugin`, appki Angulara przez executor **`@angular/build:unit-test`** z `runner: 'vitest'`
   (własne `setupFiles`), generator/szablony emitujące piny i `vitest.config`.
2. Wersje i peery (`npm view <pakiet>@<zainstalowana> peerDependencies engines --json`): cel =
   `npm view vitest dist-tags` → `latest`; **każda** paczka `@vitest/*` z repo
   (`git grep -h -o -E '"@vitest/[a-z0-9-]+"' -- package.json '*/package.json' | sort -u`) ma peer `vitest`
   dokładny; `@angular/build` (22.1 deklaruje `^4.0.8`, dopiero 22.2 dodaje `^5`); `@nx/vitest` (23.2
   deklaruje `^3 || ^4`); `@analogjs/vite-plugin-angular` / `@analogjs/vitest-angular`; `vitest-axe`; `vite`
   (Vitest 5 wymaga `^6.4 || ^7 || ^8`) i `node` z `engines` (`^22.12 || ^24 || >=26`). Gdzie siedzi pin:
   `package.json`, `catalog:` / `overrides` w `pnpm-workspace.yaml`; `minimumReleaseAge` /
   `minimumReleaseAgeExclude` — świeże `vitest@5.x` może być blokowane. Tryb pnpm:
   `strict-peer-dependencies` / `peerDependencyRules` w `.npmrc` lub `pnpm-workspace.yaml` — odmowa czy tylko
   ostrzeżenie.
3. Grep pod zmiany łamiące Vitest 5 — zapisz trafienia, to lista kontrolna kroku 3. Domyślny pathspec
   każdej komendy: `-- '*.spec.*' '*.test.*' '*vitest.config.*'` (pomija docs/ i run-logi), chyba że punkt
   podaje inny.
   - `clearMocks` domyślnie `true` (historia mocków czyszczona przed testem) — skala ryzyka:
     `git grep -h -o -E "toHaveBeenCalledTimes|\.mock\.calls|toHaveBeenCalledOnce" … | sort | uniq -c`;
     mocki modułowe: `git grep -l -E "^vi\.(mock|hoisted)\(" …` → czy `beforeEach` woła `vi.clearAllMocks()`
     albo mock powstaje w teście.
   - niezaczekane `.resolves` / `.rejects` teraz **failują**: `git grep -n -B2 -E "\.(resolves|rejects)\b" …`
     → każde trafienie bez `await` / `return` w tej linii ani 2 wyżej = do naprawy (forma wieloliniowa:
     `).rejects` bez `expect(` w linii).
   - usunięte `test.sequential` / `describe.sequential`: `(describe|test|it)\.sequential`.
   - zagnieżdżone `vi.mock` / `vi.unmock` / `vi.hoisted` rzucają: `^\s+vi\.(mock|unmock|hoisted)\(`.
   - `expect.poll` odrzuca po timeoucie; `bench` przepisany: `expect\.poll|\bbench\(`.
   - `VITEST_POOL_ID` / `VITEST_WORKER_ID` liczone od 1: `VITEST_(POOL|WORKER)_ID`.
   - usunięte wejścia `vitest/*`; `@vitest/expect` / `@vitest/runner` przestarzałe (scalone do `vitest`) →
     import z `vitest`:
     `git grep -n -E "from ['\"](vitest/(coverage|reporters|environments|snapshot|runners|suite|mocker|internal/module-runner)|@vitest/(expect|runner))['\"]" -- '*.ts' '*.mts' '*.js' '*.mjs'`.
   - reportery: domyślny katalog `.vitest/` (json/junit), html `outputDir` zamiast `outputFile`:
     `reporters|outputFile|outputDir` w configach.
   - `testNamePattern` po pełnej nazwie z separatorem ` > `:
     `git grep -n -E "testNamePattern|vitest[^&|]* -t " -- package.json '**/project.json' .gitlab-ci.yml .github`
     (w Nx `-t` = `--targets`, ignoruj).
   - `test.projects` dziedziczą config root (`extends: true`, tablice doklejane); progi coverage per glob bez
     `perFile`; `browser.api` / `browser.isolate` na top level: `projects:|extends:|perFile|browser\.(api|isolate)`.
   - config **nieszukany** w katalogach nadrzędnych: dla każdego runnera z `cwd` (`cd lib`, `nx:run-commands`)
     `ls <cwd>/vitest.config.*` — brak = domyślny `include`, cicha zmiana zestawu.
   - `coverage.include` / `exclude` po ścieżkach względnych (katalog = rekurencyjnie):
     `git grep -n -A4 "coverage:" -- '*vitest.config.*'` → wpisy `include` / `exclude`.
   - `toThrow('')` pasuje do każdego komunikatu: `toThrow\(''\)` → `/^$/`.
   - Node API (`resolveConfig` zwraca config Vite): `resolveConfig|startVitest|createVitest` w `tools/`.
4. Baseline na Vitest 4 — **każdy runner osobno, raz**, zapisz liczbę plików i testów, coverage (tam, gdzie są
   progi — tabela „All files"), czas i `RUN vX.Y.Z` z wyjścia: skrypty korzenia (`test`, `test:cov`), każda
   biblioteka z własnym configiem, `NX_DAEMON=false pnpm exec nx run-many -t test --skip-nx-cache`, każda appka
   na `@angular/build:unit-test` osobno (`pnpm exec nx run <app>:test --skip-nx-cache`), specy generatora (tylko
   jeśli mają osobną bramę poza rootem). Świeży worktree: skopiuj git-ignorowane fixture'y i katalogi wyjściowe
   (`test-results/`) **przed** baseline'em, inaczej porównanie jest fałszywe.

Wyjście kroku 0: tabela `runner | jak uruchamiany | config | pliki/testy | coverage | czas` + lista trafień
z kroku 3 + lista peerów poza zakresem. Pokaż i czekaj na „dalej".

## 1. Decyzje właściciela (zapytaj, nie zakładaj)

| Pytanie | Opcje | Domyślnie |
|---|---|---|
| Appki na `@angular/build:unit-test`, gdy `@angular/build` deklaruje peer `vitest ^4` | A: zostają na builderze, jeśli przejdą na v5 (ostrzeżenie peera do Angulara 22.2); B: przepiąć na `vitest run` + `@analogjs/vite-plugin-angular` jak biblioteki; C: czekać na Angular 22.2 | A |
| Projekty na `@nx/vitest:test` / `@nx/vitest/plugin`, gdy `@nx/vitest` deklaruje peer `vitest ^3 \|\| ^4` | A: zostają, jeśli przejdą na v5; B: przepiąć na `nx:run-commands` + `vitest run`; C: czekać na `@nx/vitest` z `^5` | A |
| pnpm odmawia przez peery | `peerDependencyRules.allowedVersions` najwęższy wpis z komentarzem **albo** stop | tylko przy odmowie |
| Generator | piny generowanych projektów też na 5 | tak |
| `.vitest/` w `.gitignore` | tylko gdy reporter/UI tam pisze | nie |

Pokaż odpowiedzi i czekaj na „dalej".

## 2. Bump

- Piny **dokładne** `vitest` i **każdej** paczki `@vitest/*` z kroku 0.2 na tę samą wersję, w korzeniu i w każdym
  zagnieżdżonym `package.json` (albo w `catalog:` / `overrides`, jeśli tam siedzi pin). `pnpm install`
  (aktualizuje lockfile) → `node -p "require('vitest/package.json').version"` musi dać `5.x.y` (tak samo
  `@vitest/coverage-v8`) → `pnpm install --frozen-lockfile` musi przejść. `RUN v4…` w kroku 3 = pin nie
  zadziałał, stop.
- Diff lockfile: tylko rodzina vitest i jej zależności tranzytywne — w górę `vitest`, `@vitest/coverage-v8`,
  `@vitest/mocker`, `@vitest/spy`; **wypadają** `@vitest/{expect,runner,snapshot,utils,pretty-format}` (scalone
  do `vitest`); `istanbul-lib-*` → `@vitest/istanbul-lib-*` (wypadają `html-escaper`, `make-dir`, `pathe`);
  nowe/podbite `tinybench`, `tinyexec`, `magic-string`, `picomatch`, `magicast`, `tinyrainbow`,
  `es-module-lexer`. Cokolwiek spoza tego grafu = stop. Klucze peer-resolucji `(vitest@…)` przepięte,
  **wersje tych paczek bez zmian** — sprawdź i zapisz.
- Ostrzeżenie „unmet peer" jest oczekiwane tylko od `@angular/build` i od `@nx/vitest` tylko zainstalowanego,
  nieużywanego jako executor (krok 0.1); **nie podbijaj** Angulara ani `@angular/build` do rc w tym runie.

Pokaż diff lockfile, wersje po instalacji i ostrzeżenia peerów; czekaj na „dalej".

## 3. Uruchom wszystko ponownie i napraw uczciwie

Każdy runner z kroku 0.4 jeszcze raz, liczby obok baseline'u. Fail klasyfikuj i naprawiaj wg tabeli;
globalne `clearMocks: false` / `mockReset: false` tylko z dowodem, że cały zestaw zakładał tę semantykę.

| objaw | przyczyna | naprawa |
|---|---|---|
| liczba wywołań mocka inna niż oczekiwana | `clearMocks=true`, test liczył na historię z poprzedniego testu | mock tworzony w teście albo `vi.clearAllMocks()` w `beforeEach` + poprawna asercja |
| „assertion was not awaited", test zielony na v4, czerwony na v5 | `.resolves` / `.rejects` bez `await` | dopisz `await` (także w formach wieloliniowych) |
| `sequential is not a function` | usunięte `*.sequential` | `{ concurrent: false }` |
| `vi.mock … must be at top level` | zagnieżdżone `vi.mock` / `vi.hoisted` | wynieś na poziom modułu |
| reporter pisze do `.vitest/` albo brak pliku w CI | nowe domyślne katalogi | jawny `outputFile` (json/junit) / `outputDir` (html) |
| `-t` nie trafia | pełna nazwa z ` > ` | popraw wzorzec |
| `expect.poll` odrzuca | timeout był maskowany | popraw warunek oczekiwania, nie wydłużaj na ślepo |
| setup uruchamia się dwa razy, projekt dostaje opcje roota | `extends` domyślnie `true`, tablice (`setupFiles`) doklejane, nie nadpisywane | `extends: false` na projekcie albo usuń duplikat |
| coverage delta przy równej liczbie testów | nowa semantyka ścieżek `coverage.include` / `exclude` | przepisz na ścieżki względne, progów nie ruszaj |
| spec-lustro pinu (np. `versions.spec.ts`) czerwony na `'4.x' ≠ '5.x'` | kanon generatora niepodbity | to krok 4 — nie edytuj specu, odnotuj i idź dalej |
| appka na `@angular/build:unit-test` nie startuje | builder z Vitest 5 poza peerem | stop — pokaż błąd buildera i wróć do decyzji z kroku 1; wariant B tylko po „dalej": skopiuj najbliższy config biblioteki z Analogiem (`plugins: [angular()]`, `jsdom`, wspólny setup TestBed), zmień tylko `root`, aliasy i `setupFiles` (dołóż dotychczasowe appki); target `test` → `nx:run-commands` `vitest run` z `cwd` appki i `outputs` coverage jak w bibliotekach |

- Coverage: `coverage.reportOnFailure` jest domyślnie `false` (tak samo w 4.x) — przy czerwonym teście tabela
  nie wychodzi. Mierz po kroku 4; jeśli wcześniej: `vitest run --coverage --exclude '<spec-lustro>'` i zapisz,
  że liczba jest z wykluczeniem (nieporównywalna co do setnych). Porównuj co do setnych, **progów nie
  obniżaj** — różnica to pytanie do właściciela.
- Podpowiedź Vitest 5 „Isolate N workers … faster with `isolate: false`" jest informacyjna; nie przełączaj
  bez pomiaru.
- Ciężki import w specu (np. config ESLint z Angularem) pod obciążeniem przekracza domyślne 5 s: jawny
  timeout na tym jednym `it`, nie globalny.

Pokaż tabelę baseline vs po bumpie (co do jednego testu) i listę naprawionych plików; czekaj na „dalej".

## 4. Generator i pliki pochodne

- Pin w kanonie generatora (np. `packages/templates/src/versions.ts`) → spec-lustro korzenia zielony; szablon
  `vitest.config` przejrzany pod opcje z kroku 0.3 (`reporters` + `outputFile` nadal top-level).
- Jeśli repo ma: bloki `AUTOGEN` stacku (`stack:sync` w korzeniu i w każdej bibliotece z własnym blokiem),
  tabele zależności i tech-stacku, `testing.md` per projekt („Vitest 4" → „Vitest 5"), CHANGELOG `[Unreleased]`.
- Martwe wpisy w `pnpm-workspace.yaml` (`minimumReleaseAgeExclude` dla 4.x) usuń, gdy nic ich nie czyta.

## 5. Weryfikacja i raport

1. Brama repo (np. `pnpm verify`), `NX_DAEMON=false pnpm exec nx run-many -t test,typecheck --skip-nx-cache`,
   verify każdej biblioteki z własnymi bramami, `pnpm install --frozen-lockfile`.
2. Run-log + plan (jeśli repo prowadzi parę SDD; inaczej run-log w miejscu przyjętym w repo): tabela peerów,
   tabela zmian łamiących `grep → trafienia → wynik na v5`, sekcja buildera Angulara z **oboma faktami**
   (działa / poza deklarowanym peerem), bramy, pomiary przed/po per runner, decyzje. Commity wg konwencji
   repo, np. osobno `chore(deps)` (piny, lockfile, kanon generatora, pliki pochodne) i `docs(sdd)` (plan,
   run-log, INDEX).

Orientacyjnie (Nx + Angular, 80 projektów, 36 runnerów, 2026-09-17): bump 4.1.11 → 5.0.1 bez zmiany żadnego
testu ani configu poza jednym jawnym timeoutem na ciężkim imporcie (sprzed migracji, patrz krok 3), appki na
`@angular/build:unit-test` 22.1.7 zielone z `RUN v5.0.1`, coverage co do setnych, czasy w szumie (mediany z 3:
root 3,9 → 3,6 s, `nx run-many -t test` 43 s w obie strony), lockfile +19 / −24 paczki.

## Kryteria ukończenia

- Każdy runner: liczba plików i testów równa baseline'owi (liczby po kroku 4; różnice opisane w run-logu
  z `plik:linia`).
- Coverage w każdym miejscu z progami: delta zapisana, progi nietknięte.
- `pnpm install --frozen-lockfile` zielony; ostrzeżenia peerów wypisane świadomie w run-logu.
- Kanon generatora, bloki stacku i docs mówią „5"; run-log zapisany (para SDD w INDEX, jeśli repo ją prowadzi).

## Pułapki (sprawdzone)

- `pnpm exec vitest run` z katalogu biblioteki **bez** `package.json` pada od drugiego uruchomienia
  (`ERR_PNPM_RECURSIVE_EXEC_NO_PACKAGE`), bo Vitest tworzy tam `node_modules/.vite` — używaj targetu Nx albo
  `node ../../node_modules/vitest/vitest.mjs run` (binarka jest tylko w korzeniu). Skrypty korzenia
  `cd libs/x && vitest run` działają — pułapka dotyczy `pnpm exec`.
- `git grep -c` liczy per plik; sumę daj przez `git grep -h -o … | sort | uniq -c`.
- Skrypt liczący graf Nx poza taskiem startuje daemona, który trzyma potok wyjścia — `NX_DAEMON=false`
  przy pomiarach i w skryptach.
- Narzędzie zablokowane przez politykę systemu (np. `pnpm.exe`): stop i pytanie, żadnych zastępczych
  skryptów ani `--no-verify` bez zgody.
