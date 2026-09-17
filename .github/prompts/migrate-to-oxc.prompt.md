# /migrate-to-oxc — przenieś lint i formatowanie z ESLint / Prettier / Biome na oxlint + oxfmt

Pracujesz w repozytorium TypeScript (często **Nx monorepo z Angularem**, `pnpm`). Przenieś formatowanie na
**oxfmt**, a lint na **oxlint**; ESLint zostaje tylko tam, gdzie oxlint nie umie (szablony i reguły Angulara),
i tylko jeśli właściciel tak zdecyduje. Pracuj krok po kroku; po każdym kroku uruchom to, co zmieniłeś.
Nie zgaduj: gdy czegoś brakuje albo narzędzie nie działa, zatrzymaj się i zapytaj. **Nie commituj i nie
pushuj bez zgody.** Ścieżki `apps/`, `libs/`, `@scope` i prefiks selektora to przykłady — weź je z repo.

Zasada nadrzędna: każda reguła starego lintu kończy jako (a) ta sama reguła w nowym configu, (b) świadomie
zmieniona z powodem w komentarzu, albo (c) wpis na liście utraconych reguł. Nic nie znika po cichu.

## 0. Rozpoznanie i pomiar bazowy (nic nie edytuj)

1. Spis: `git ls-files | grep -E 'eslint\.config|\.eslint(rc|ignore)|prettier|biome|\.oxfmtrc|\.oxlintrc'`
   (też configi zagnieżdżone w projektach), pluginy i presety w `package.json`, `lint-staged`, `.husky/*`,
   `nx.json` (`@nx/eslint/plugin`, `targetDefaults.lint`, `namedInputs`), `project.json` z `@nx/eslint:lint`,
   `.vscode`/`.idea`, CI, skrypty w `tools/` czytające configi lintu, kod generowany z nagłówkiem
   `/* eslint-disable */`, instrukcje agentów (`.github/**`, `AGENTS.md`), generator/szablony emitujące
   configi, dyrektywy: `git grep -h -o -E 'eslint-disable|prettier-ignore' | sort | uniq -c`.
2. Efektywne reguły: `pnpm exec eslint --print-config <plik>` dla po jednym pliku z każdego rodzaju
   (kod pakietu, komponent, `.html`, szablon inline, spec, spec e2e, skrypt `.mjs`, config `.mts`, każda
   biblioteka z własnym configiem — z katalogu, z którego odpala ją target). Zapisz zrzuty: to lista kontrolna
   parytetu na koniec.
3. Pomiar bazowy (bez innych obciążeń, `NX_DAEMON=false`, 1 rozgrzewka + 3 przebiegi, mediana): lint całego
   repo, `nx run-many -t lint --skip-nx-cache`, lint 2–3 pojedynczych projektów, `format:check`, komendy
   `lint-staged` ręcznie na 3 plikach, brama repo (np. `pnpm verify`); do tego bajty wyjścia bram na zielono
   i przy jednym błędzie (to koszt tokenów agenta).

Wyjście kroku 0: tabela `narzędzie | configi | pliki/projekty | czas bazowy` + lista rzeczy do decyzji.
Pokaż i czekaj na „dalej".

## 1. Decyzje właściciela (zapytaj, nie zakładaj)

| Pytanie | Opcje | Domyślnie |
|---|---|---|
| Angular | A: ESLint tylko dla angular-eslint (szablony `.html` + inline i reguły TS); B: bez ESLint (traci szablony, a11y, `component-selector`, `prefer-signals`…) | A |
| Ostrzeżenia | `denyWarnings` / `--max-warnings=0` (reguła = błąd albo off) czy warny przepuszczane | blokują |
| Markdown | formatować (oxfmt dopełnia tabele — więcej bajtów w plikach czytanych przez agentów) czy nie | nie |
| Generator | czy generowane projekty też przechodzą na oxc | tak |
| Granice | bramka zamiast `@nx/enforce-module-boundaries` / warstwy `no-restricted-imports` bez Nx | tak |

Pokaż odpowiedzi i czekaj na „dalej".

## 2. Formatter: oxfmt

- Dodaj `oxfmt` z **dokładną** wersją (0.x — format może się zmieniać między wersjami).
- `.oxfmtrc.json`: start od `oxfmt --migrate=prettier` (albo `biome`), potem sprawdź opcje (`printWidth`,
  `singleQuote`, `trailingComma`, `endOfLine`…), `"sortPackageJson": false`, `ignorePatterns` z
  `.prettierignore`, `overrides` dla bibliotek z innym stylem.
- Kolejność importów: `sortImports` (`groups`, `customGroups` np. `@angular/**`, `internalPattern`,
  `newlinesBetween`) zamiast pluginu Prettiera / `import/order`; zawsze sortuje alfabetycznie w grupie. Po
  włączeniu policz pliki zmienione tylko przez sortowanie; > 0 = pokaż liczbę i czekaj (naiwne mapowanie
  z `@trivago/prettier-plugin-sort-imports` dało 335 plików).
- Tailwind: `sortTailwindcss.stylesheet` musi wskazywać **czysty `.css`** — ścieżka `.scss` daje ostrzeżenie
  przy każdym uruchomieniu, a sortowanie nie zna utility Tailwinda ani motywu. Motyw przenieś do wspólnego
  `tailwind-theme.css`, ładowanego przez wejście Sass i przez `tailwind.css` tylko dla formatera. Dowód: CSS
  po buildzie identyczny bajt w bajt.
- Skrypty: `oxfmt --disable-nested-config …` / `oxfmt --check --disable-nested-config …`.
- `prettier-ignore` w `.md`, `.html` i inline `template:` zostaje pod tą nazwą (oxfmt nie zna tam
  `oxfmt-ignore`).
- Uruchom raz na całym repo, policz zmienione pliki, przejrzyj próbkę diffu. Od razu przełącz formatowe
  komendy `lint-staged` na oxfmt (inaczej hook cofa formatowanie). Prettiera i pluginy usuń, gdy
  `git grep -l -E "['\"]prettier['\"]|eslint-(config|plugin)-prettier"` nic nie zwraca.

Pokaż liczbę zmienionych plików + próbkę diffu i czekaj na „dalej".

## 3. Linter: oxlint

1. Pakiety z dokładnymi wersjami: `oxlint` + `oxlint-tsgolint` (parą; reguły z typami liczy typescript-go 7,
   nie TypeScript projektu — różnice są możliwe, np. `outDir` bez `rootDir` to błąd: dopisz `rootDir`
   w tsconfigach projektów i szablonach generatora).
2. **Jeden config w korzeniu** (`oxlint.config.mts`), zawsze `--disable-nested-config` w skryptach — oxlint
   i oxfmt ładują zagnieżdżone configi nawet pod `ignorePatterns`, a `options.typeAware` działa tylko
   w korzeniu.
3. Układ plików: `oxlint.config.mts` (options, ignorePatterns, lista warstw) + `oxlint.plugins.mts` (zbiory
   plików, `layer()`, `NOT_IN_OXLINT`, `LOST_WITH_ESLINT`) + `oxlint.presets.mts` (**same dane**: presety
   przepisane z `@eslint/js`, `typescript-eslint`… z wersją źródła) + `oxlint.rules.mts` (strojenie zespołu,
   powód przy każdej regule, granice importów). Zmiana reguły = edycja `oxlint.rules.mts`.
4. `layer(files, rules)` wylicza `plugins`/`jsPlugins` z nazw reguł. Bez tego oxlint (1.83) gubi opcje reguły
   natywnej w override, który nie włącza jej pluginu, gdy gdziekolwiek są `jsPlugins`. Opcje reguły nie łączą
   się między warstwami — późniejsza zastępuje całą wartość (`no-restricted-imports`: wszystkie grupy w jednej
   warstwie).
5. Korzeń: `plugins: []`, `categories: { correctness: 'off' }` (reguły włączają tylko warstwy). `options`:
   `typeAware: true`, `denyWarnings: true`, `reportUnusedDisableDirectives: 'error'`,
   `respectEslintDisableDirectives: false` (dyrektywy `eslint-disable` w `.ts` należą wtedy tylko do ESLint).
   `ignorePatterns` kotwicz jak `.gitignore` (`coverage/**`, nie `**/coverage/**`, jeśli w `src/` bywa folder
   o tej nazwie).
6. Pluginy JS (`jsPlugins`, alpha) tylko po teście poza repo (katalog scratch: `oxlint` + plugin, bez
   `eslint`, jedna reguła, plik z posianym naruszeniem): wynik = zgłoszenie tej reguły, samo załadowanie nie
   wystarcza. Sprawdzone: `eslint-plugin-sonarjs`, `-playwright`, `-security`. Wymagają `eslint`:
   `@angular-eslint/eslint-plugin`, `eslint-plugin-jsdoc`. vitest, jsdoc, import, unicorn, promise są natywne
   w oxlint: preset przepisz, braki (jsdoc: 15 reguł) wpisz do `NOT_IN_OXLINT`. Reguły sonarjs wymagające typów
   (ok. 56 z 217 włączonych) działają w oxlint bez typów — wyłącz je albo opisz; nazwa się zgadza, więc strata
   jest niewidoczna.
7. Reguła z presetu, której oxlint nie ma, psuje config („Rule not found”): wpisz ją do `NOT_IN_OXLINT` z
   powodem; moduł rzuca błąd, gdy wpis przestaje być używany. Ta sama nazwa ≠ te same opcje domyślne
   (`no-unused-vars` z samą ważnością ignoruje w oxlint `^_`) — w presetach podawaj jawne opcje ESLinta
   (`['error', { args: 'after-used' }]`).
8. Dyrektywy (zawsze `-- powód`): oxlint `// oxlint-disable-next-line typescript/<reguła>` (nie
   `@typescript-eslint/…`); wariant A, Angular w `.ts`: `// eslint-disable-next-line @angular-eslint/<reguła>`;
   szablon: tylko para `<!-- eslint-disable @angular-eslint/template/<reguła> -- powód -->` …
   `<!-- eslint-enable … -->` (`-next-line` nie trafia w atrybut w osobnej linii). Usuń te, które nic już
   nie wyciszają. Kod generowany: ten sam wpis ignore w oxlint, ESLint i oxfmt albo wycinanie nagłówka
   `/* eslint-disable */` w skrypcie generacji.
9. Parytet: jednorazowy skrypt w scratch — dla każdego pliku z 0.2 scal `rules` z warstw, których `files`
   pasuje, a `excludeFiles` nie (picomatch), i porównaj z `rules` zrzutu ESLint (po `@typescript-eslint/` →
   `typescript/`). Każda różnica → (a)/(b)/(c).

Pokaż listę utraconych reguł i czekaj na „dalej".

## 4. ESLint tylko dla Angulara (wariant A; w wariancie B pomiń, `lint.mjs` bez części ESLint)

- `eslint` + `angular-eslint` (major = major Angulara) + `typescript-eslint` (angular-eslint wymaga go przy
  imporcie; nie wycinaj `eslint` ani `@typescript-eslint/type-utils` override'ami).
- `eslint.config.mjs`: globalnie ignoruj wszystko poza katalogami z kodem Angulara; `.ts` → parser TS +
  `processInlineTemplates` + **jawna lista** reguł `@angular-eslint/*`, nie `tsRecommended` (podbicie pakietu
  nie może dołożyć reguły, której nie zna filtr) (selektory z prefiksem projektu, `prefer-standalone`,
  `prefer-signals`, `prefer-inject`, `use-lifecycle-interface`…); `.html` → `templateRecommended` +
  `templateAccessibility` + strojenie; `reportUnusedDisableDirectives: 'error'`; żadnej reguły JS/TS spoza
  Angulara (dwa lintery nie mogą mieć dwóch zdań o jednej linii).
- Filtr wejść (optymalizacja; bez niego ESLint dostaje wszystkie `.ts`/`.html` z zakresu i to jest stan
  bezpieczny): `.html` zawsze; `.ts`, gdy ma `class` i nazwę dekoratora/funkcji sygnału z reguł
  (`Component`, `Directive`, `Input`, `input`, `signal`…), albo `\u`, albo komentarz `eslint`. Dowód:
  zgłoszenia bez filtra = z filtrem, na czystym kodzie i z posianym błędem dla **każdej** włączonej reguły
  TS. Lista reguł eksportowana z `lint.mjs` + spec: lista w configu = lista filtra; nowa reguła = ponowne
  wyprowadzenie filtra. Projekt bez takich plików nie ładuje ESLint.

## 5. Jedna brama: `tools/scripts/lint.mjs`

`node tools/scripts/lint.mjs [--fix] [--cache] [--no-boundaries] [ścieżki…]` — bez ścieżek całe repo.
Do kroku 7 uruchamiaj z `--no-boundaries`.
- Zawsze wszystkie części: oxlint (proces potomny), ESLint (Node API, filtr z kroku 4), granice (krok 7).
  Nigdy `oxlint && eslint` — to chowa błędy szablonów, dopóki oxlint nie jest zielony.
- Bez `--fix` równolegle; z `--fix` oxlint **przed** ESLint (inaczej jedna poprawka nadpisze drugą).
- Wyjście buforowane w stałej kolejności, jedna linia na zgłoszenie `ścieżka:linia[:kol]: error reguła: opis`
  (granice: `boundaries/B<n>`, bez kolumny), sukces = jedna linia podsumowania; kod 1, gdy zawiodła którakolwiek
  część (ESLint przez Node API nie zna `maxWarnings`: czerwony przy każdej wiadomości, także warning, nie tylko
  `errorCount > 0`). Błąd grafu Nx nie może przerwać procesu przed wypisaniem reszty (`exitOnError: false`).
- `package.json`: `"lint": "node tools/scripts/lint.mjs --cache"`, `"lint:fix": "… --fix --cache"`.

## 6. Nx (tylko Nx; bez Nx `lint` = `lint.mjs`)

- Usuń `@nx/eslint/plugin` i executory `@nx/eslint:lint`; generatory: `"linter": "none"`. `@nx/eslint` zostaje
  tranzytywnie (bez niego `nx g @nx/angular:library` pada) — nie wycinaj go override'em.
- `@nx/oxlint` (23.2) wciąga `eslint` i zakłada configi per projekt — zamiast tego lokalny plugin
  `tools/nx/lint-plugin.mjs` (`createNodes` na plikach definiujących projekty: `project.json` i/lub
  `package.json`) z jedną komendą `node tools/scripts/lint.mjs {projectRoot}` (bez `--cache`: równoległe
  taski pisałyby jeden plik cache).
- `targetDefaults.lint.inputs`: `default`, `^production`, configi oxlint (z presetami) i ESLint,
  `lint.mjs`, skrypty i dane granic, `tsconfig.base.json`, `.gitignore`, `externalDependencies` (oxlint,
  oxlint-tsgolint, pluginy JS, eslint, angular-eslint, typescript-eslint, typescript, @nx/devkit). Wyczyść
  `namedInputs` z configów ESLint/Prettiera.

## 7. Granice modułów bez ESLint

Bez Nx: granice = warstwy `no-restricted-imports` w `oxlint.rules.mts` na kształcie aliasu i głębokim imporcie
(`@<scope>/*/*/src/*`), jedna warstwa na typ biblioteki z pełnym zestawem wzorców. Z Nx:
- `tools/nx/module-boundaries.mjs`: `depConstraints` i opcje reguły przeniesione 1:1.
- Bramka (`arch-boundaries.mjs` + spec, jedno zgłoszenie na regułę) musi pokryć każdą opcję reguły Nx ze
  starego configu: B1 import względny/absolutny przez granicę, B2 plik spoza projektów, B3 własny alias,
  B4 cykle, B5 import app/e2e, B6 buildable, B7 statyczny import biblioteki ładowanej leniwie, B8 tagi,
  B9 `bannedExternalImports`/`allowedExternalImports`, B10 głęboki alias `@scope/lib/src/...` (przepuszczała
  go też reguła Nx). Opcja nieobsłużona (np. `banTransitiveDependencies`, `checkNestedExternalImports`) → lista
  utraconych reguł.
- Graf: `process.env.NX_TASK_TARGET_PROJECT` → `readCachedProjectGraph()` (w `try`), inaczej albo przy błędzie
  `createProjectGraphAsync({ exitOnError })`. Tryb per projekt dla targetu `lint`; osobny krok w bramie repo
  usuń, gdy lint pokrywa wszystko. Sprawdź, że każdy projekt ma tag objęty regułą (inaczej granica milczy).

## 8. Hooki, edytor, CI, generator

- `lint-staged`: `"*.{ts,mts,js,mjs,cjs,html}": ["node tools/scripts/lint.mjs --fix --no-boundaries",
  "oxfmt --disable-nested-config --no-error-on-unmatched-pattern"]`, osobno json/md/yml i css (stylelint);
  hook: `lint-staged --config package.json` (lint-staged 17 czyta też zagnieżdżone `package.json`).
- `.vscode`: polecaj `oxc.oxc-vscode`, niepolecane `esbenp.prettier-vscode`; `editor.defaultFormatter:
  oxc.oxc-vscode`, `oxc.disableNestedConfig`, `oxc.fmt.disableNestedConfig`, `source.fixAll.oxc`; wariant A:
  `dbaeumer.vscode-eslint` + `eslint.validate: ["html", "typescript"]`.
- Generator: emituje `.oxlintrc.json` (JSON, bez pluginów JS, chyba że je instaluje) i `.oxfmtrc.json`,
  przypięte wersje; test stabilności formatu przez API `format(fileName, sourceText, options)` z `oxfmt`.
- Sprzątanie: usuń pakiety ESLint/Prettiera, których nic nie ładuje, martwe wpisy `allowBuilds`
  (np. `unrs-resolver`), `pnpm install --frozen-lockfile` musi przejść.

## 9. Dokumentacja i tekst dla agentów

- ADR: kontekst (pomiary bazowe), decyzja, konsekwencje z **pełną listą utraconych reguł** i pomiarami po.
  Historycznych zapisów (stare ADR, runy, plany, stare wpisy CHANGELOG) nie przepisuj; zmienia się najwyżej
  linia statusu.
- Pliki agentów krótkie i proceduralne: komendy, tabela „zgłoszenie z oxlint / eslint / granic → który plik
  edytować”, składnia dyrektyw w jednej linii na narzędzie, odnośnik do ADR zamiast historii.
  `applyTo` instrukcji lintu wskazuje nowe configi i `lint.mjs`.

## 10. Weryfikacja i raport

1. Brama repo (np. `pnpm verify`) i `nx run-many -t lint,typecheck,test,build` (lub odpowiedniki; e2e osobno).
2. Posiane błędy (wstaw, uruchom, przywróć dokładną treść): nieużywana zmienna, promise bez `await`,
   `(click)` bez obsługi klawiatury, zły prefiks selektora, import łamiący tag, głęboki alias, zły format —
   jeden `pnpm lint` pokazuje wszystkie naraz; `nx run <projekt>:lint` łapie granice.
3. Pomiar po tym samym protokołem co w kroku 0.3; raport: tabela przed/po (czasy, bajty wyjścia, rozmiary
   plików agentów), lista utraconych i odzyskanych reguł, ryzyka.

Orientacyjnie (Nx + Angular, 80 projektów, laptop i7, pomiar A/B z 2026-09-17): lint całego repo 197 s →
ok. 12 s, `nx run-many -t lint` bez cache 174 s → ok. 55 s, pojedynczy projekt 2–3× szybciej. oxlint nie ma
cache — ciepły lint w małym repo bywa wolniejszy niż ESLint z `--cache`; porównuj ten sam zakres plików.

## Kryteria ukończenia

- `pnpm lint`: jedna linia podsumowania; `format:check`: 0 plików do poprawy; posiane błędy z 10.2 w jednym
  przebiegu.
- Lista utraconych reguł pełna w ADR; brak zagnieżdżonych `.oxlintrc*` / `.oxfmtrc*` / `eslint.config.*`.
- `pnpm install --frozen-lockfile` przechodzi; `.vscode`, hook i generator zaktualizowane.

## Pułapki (sprawdzone)

- Narzędzie zablokowane przez politykę systemu (np. Code Integrity blokuje `pnpm.exe`): stop i pytanie —
  żadnych zastępczych skryptów ani `--no-verify` bez zgody.
- `typescript-eslint` ogranicza wersję TypeScriptu (np. `<6.1.0`) — sprawdź peer range przed podbiciem TS.
- oxlint na zielono nic nie wypisuje — liczby plików/reguł bierz z `-f json`.
