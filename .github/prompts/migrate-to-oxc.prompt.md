# /migrate-to-oxc — przenieś lint i formatowanie z ESLint / Prettier / Biome na oxlint + oxfmt

Pracujesz w repozytorium TypeScript (często **Nx monorepo z Angularem**, `pnpm`). Przenieś formatowanie na
**oxfmt**, a lint na **oxlint**; ESLint zostaje tylko tam, gdzie oxlint nie umie (szablony i reguły Angulara),
i tylko jeśli właściciel tak zdecyduje. Pracuj krok po kroku; po każdym kroku uruchom to, co zmieniłeś.
Nie zgaduj: gdy czegoś brakuje albo narzędzie nie działa, zatrzymaj się i zapytaj. **Nie commituj i nie
pushuj bez zgody.**

Zasada nadrzędna: każda reguła starego lintu kończy jako (a) ta sama reguła w nowym configu, (b) świadomie
zmieniona z powodem w komentarzu, albo (c) wpis na liście utraconych reguł. Nic nie znika po cichu.

## 0. Rozpoznanie i pomiar bazowy (nic nie edytuj)

1. Spis: `git ls-files | grep -E 'eslint\.config|\.eslintrc|prettier|biome|\.oxfmtrc|\.oxlintrc'`
   (też configi zagnieżdżone w projektach), pluginy i presety w `package.json`, `lint-staged`, `.husky/*`,
   `nx.json` (`@nx/eslint/plugin`, `targetDefaults.lint`, `namedInputs`), `project.json` z `@nx/eslint:lint`,
   `.vscode`/`.idea`, CI, skrypty w `tools/` czytające configi lintu, instrukcje agentów (`.github/**`,
   `AGENTS.md`), generator/szablony emitujące configi, liczba dyrektyw
   `git grep -c -E 'eslint-disable|prettier-ignore'`.
2. Efektywne reguły: `pnpm exec eslint --print-config <plik>` dla po jednym pliku z każdego rodzaju
   (kod pakietu, komponent, `.html`, szablon inline, spec, spec e2e, skrypt `.mjs`, config `.mts`, każda
   biblioteka z własnym configiem — z katalogu, z którego odpala ją target). Zapisz zrzuty: to lista kontrolna
   parytetu na koniec.
3. Pomiar bazowy (bez innych obciążeń, `NX_DAEMON=false`, 1 rozgrzewka + 3 przebiegi, mediana): lint całego
   repo, `nx run-many -t lint --skip-nx-cache`, lint 2–3 pojedynczych projektów, `format:check`, komendy
   `lint-staged` ręcznie na 3 plikach, `pnpm verify`; do tego bajty wyjścia bram na zielono i przy jednym
   błędzie (to koszt tokenów agenta).

Wyjście kroku 0: tabela `narzędzie | configi | pliki/projekty | czas bazowy` + lista rzeczy do decyzji.
Pokaż i czekaj na „dalej".

## 1. Decyzje właściciela (zapytaj, nie zakładaj)

| Pytanie | Opcje | Domyślnie |
|---|---|---|
| Angular | A: ESLint tylko dla angular-eslint (szablony `.html` + inline i reguły TS); B: bez ESLint (traci szablony, a11y, `component-selector`, `prefer-signals`…) | A |
| Ostrzeżenia | `denyWarnings` / `--max-warnings=0` (reguła = błąd albo off) czy warny przepuszczane | blokują |
| Markdown | formatować (oxfmt dopełnia tabele — więcej bajtów w plikach czytanych przez agentów) czy nie | nie |
| Generator | czy generowane projekty też przechodzą na oxc | tak |
| Granice Nx | skrypt-bramka zamiast `@nx/enforce-module-boundaries` | tak |

## 2. Formatter: oxfmt

- Dodaj `oxfmt` z **dokładną** wersją (0.x — format może się zmieniać między wersjami).
- `.oxfmtrc.json`: przepisz opcje Prettiera (`printWidth`, `singleQuote`, `trailingComma`, `endOfLine`…),
  `"sortPackageJson": false`, `ignorePatterns` z `.prettierignore`, `overrides` dla bibliotek z innym stylem.
- Kolejność importów: `sortImports` (`groups`, `customGroups` np. `@angular/**`, `internalPattern`,
  `newlinesBetween`) zamiast pluginu Prettiera / `import/order`; zawsze sortuje alfabetycznie w grupie.
- Tailwind: `sortTailwindcss.stylesheet` musi wskazywać **czysty `.css`** (przy `.scss` sortowanie jest
  błędne i 16× ostrzeżenie „points to a preprocessor file” w każdym `format:check`). Motyw przenieś do
  wspólnego `tailwind-theme.css`, importowanego przez wejście Sass i przez `tailwind.css` tylko dla
  formatera. Dowód: CSS po buildzie identyczny bajt w bajt.
- Skrypty: `oxfmt --disable-nested-config …` / `oxfmt --check --disable-nested-config …`.
- Uruchom raz na całym repo, policz zmienione pliki, przejrzyj próbkę diffu, usuń Prettiera i jego pluginy.

## 3. Linter: oxlint

1. Pakiety z dokładnymi wersjami: `oxlint` + `oxlint-tsgolint` (parą; reguły z typami liczy typescript-go 7,
   nie TypeScript projektu — różnice są możliwe).
2. **Jeden config w korzeniu** (`oxlint.config.mts`), zawsze `--disable-nested-config` w skryptach i
   `oxc.disableNestedConfig` / `oxc.fmt.disableNestedConfig` w `.vscode/settings.json` — oxlint i oxfmt
   ładują zagnieżdżone configi nawet pod `ignorePatterns`, a `options.typeAware` działa tylko w korzeniu.
3. Układ plików: `oxlint.config.mts` (options, ignorePatterns, lista warstw) + `oxlint.plugins.mts` (zbiory
   plików, `layer()`, `NOT_IN_OXLINT`, `LOST_WITH_ESLINT`) + `oxlint.presets.mts` (**same dane**: presety
   przepisane z `@eslint/js`, `typescript-eslint`… z wersją źródła) + `oxlint.rules.mts` (strojenie zespołu,
   powód przy każdej regule, granice importów). Zmiana reguły = edycja `oxlint.rules.mts`.
4. `layer(files, rules)` wylicza `plugins`/`jsPlugins` z nazw reguł. Bez tego oxlint (1.83) gubi opcje reguły
   natywnej w override, który nie włącza jej pluginu, gdy gdziekolwiek są `jsPlugins`.
5. `options`: `typeAware: true`, `denyWarnings: true`, `reportUnusedDisableDirectives: 'error'`,
   `respectEslintDisableDirectives: false` (dyrektywy `eslint-disable` w `.ts` należą wtedy tylko do ESLint).
   `ignorePatterns` kotwicz jak `.gitignore` (`coverage/**`, nie `**/coverage/**`, jeśli w `src/` bywa folder
   o tej nazwie).
6. Pluginy JS (`jsPlugins`, alpha) dopuszczaj tylko po teście **bez zainstalowanego `eslint`** (scratch).
   Działały: `eslint-plugin-sonarjs`, `-playwright`, `-security`, `-n`. Nie ładują się (przez
   `@typescript-eslint/utils`): `@angular-eslint/eslint-plugin`, `@nx/eslint-plugin`, `rxjs-x`,
   `@vitest/eslint-plugin`, `jsdoc`. Reguły sonarjs wymagające typów (ok. 56 z 217) działają w oxlint bez typów
   — wyłącz je albo opisz; nazwa się zgadza, więc strata jest niewidoczna.
7. Reguła z presetu, której oxlint nie ma, psuje config („Rule not found”): wpisz ją do `NOT_IN_OXLINT` z
   powodem; moduł rzuca błąd, gdy wpis przestaje być używany.
8. Dyrektywy: `oxlint-disable-next-line typescript/<reguła> -- powód` (nazwy oxlint: `typescript/…`, nie
   `@typescript-eslint/…`); usuń te, które nic już nie wyciszają.
9. Parytet: porównaj reguły per rodzaj pliku ze zrzutami z kroku 0.2 (nazwa + opcje + ważność + zbiór plików).

## 4. ESLint tylko dla Angulara (wariant A)

- `eslint` + `angular-eslint` (major = major Angulara) + `typescript-eslint` (angular-eslint wymaga go przy
  imporcie; nie wycinaj `eslint` ani `@typescript-eslint/type-utils` override'ami).
- `eslint.config.mjs`: globalnie ignoruj wszystko poza `apps/` i `libs/`; `.ts` → parser TS +
  `processInlineTemplates` + reguły `@angular-eslint/*` (selektory z prefiksem projektu, `prefer-standalone`,
  `prefer-signals`, `prefer-inject`, `use-lifecycle-interface`…); `.html` → `templateRecommended` +
  `templateAccessibility` + strojenie; `reportUnusedDisableDirectives: 'error'`; żadnej reguły JS/TS spoza
  Angulara (dwa lintery nie mogą mieć dwóch zdań o jednej linii).
- Filtr wejść: ESLint dostaje tylko `.html` i `.ts` z konstrukcjami, na które patrzą włączone reguły
  (dekoratory, `template:`, metody cyklu życia, `inputs`/`outputs`…). Dowód parytetu: te same zgłoszenia
  z filtrem i bez, na czystym kodzie i z posianymi błędami. Projekt bez takich plików nie ładuje ESLint.

## 5. Jedna brama: `tools/scripts/lint.mjs`

`node tools/scripts/lint.mjs [--fix] [--cache] [--no-boundaries] [ścieżki…]` — bez ścieżek całe repo.
- Zawsze wszystkie części: oxlint (proces potomny), ESLint (Node API, filtr z kroku 4), granice (krok 7).
  Nigdy `oxlint && eslint` — to chowa błędy szablonów, dopóki oxlint nie jest zielony.
- Bez `--fix` równolegle; z `--fix` oxlint **przed** ESLint (inaczej jedna poprawka nadpisze drugą).
- Wyjście buforowane w stałej kolejności, jedna linia na zgłoszenie `ścieżka:linia:kol: error reguła: opis`,
  sukces = jedna linia podsumowania; kod 1, gdy zawiodła którakolwiek część. Błąd grafu Nx nie może przerwać
  procesu przed wypisaniem reszty (`exitOnError: false`).
- `package.json`: `"lint": "node tools/scripts/lint.mjs --cache"`, `"lint:fix": "… --fix --cache"`.

## 6. Nx

- Usuń `@nx/eslint/plugin` i executory `@nx/eslint:lint`; generatory: `"linter": "none"`. `@nx/eslint` zostaje
  tranzytywnie (bez niego `nx g @nx/angular:library` pada) — nie wycinaj go override'em.
- `@nx/oxlint` (23.2) wciąga `eslint` i zakłada configi per projekt — zamiast tego lokalny plugin
  `tools/nx/lint-plugin.mjs` (`createNodes` na `**/project.json`) z jedną komendą
  `node tools/scripts/lint.mjs {projectRoot}` (bez `--cache`: równoległe taski pisałyby jeden plik cache).
- `targetDefaults.lint.inputs`: `default`, `^production`, configi oxlint (z presetami) i ESLint,
  `lint.mjs`, skrypty i dane granic, `tsconfig.base.json`, `.gitignore`, `externalDependencies` (oxlint,
  oxlint-tsgolint, pluginy JS, eslint, angular-eslint, typescript-eslint). Wyczyść `namedInputs` z configów
  ESLint/Prettiera.

## 7. Granice modułów bez ESLint

- `tools/nx/module-boundaries.mjs`: `depConstraints` przeniesione 1:1.
- Bramka (`arch-boundaries.mjs` + spec, jedno zgłoszenie na regułę): naruszenie tagów, import względny i
  absolutny do innego projektu, **głęboki alias** `@scope/lib/src/...` (przepuszczała go też reguła Nx),
  cykle, zależności buildable. Graf: `readCachedProjectGraph()` wewnątrz taska Nx, poza nim
  `createProjectGraphAsync()`. Tryb per projekt dla targetu `lint`; osobny krok w `verify` usuń, gdy lint
  pokrywa wszystko. Sprawdź, że każdy projekt ma tag objęty regułą (inaczej granica milczy).

## 8. Hooki, edytor, CI, generator

- `lint-staged`: `"*.{ts,mts,js,mjs,cjs,html}": ["node tools/scripts/lint.mjs --fix --no-boundaries",
  "oxfmt --disable-nested-config --no-error-on-unmatched-pattern"]`, osobno json/md/yml i css (stylelint).
- `.vscode`: polecaj `oxc.oxc-vscode` (i `dbaeumer.vscode-eslint` tylko w wariancie A), usuń Prettiera
  z polecanych; `editor.defaultFormatter: oxc.oxc-vscode`.
- Generator: emituje `.oxlintrc.json` (JSON, bez pluginów JS, chyba że je instaluje) i `.oxfmtrc.json`,
  przypięte wersje; test stabilności formatu przez API `format(fileName, source, options)` z `oxfmt`.
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

1. `pnpm verify`, `apps:lint`, `apps:typecheck`, `apps:test`, `apps:build` (e2e osobno).
2. Posiane błędy (wstaw, uruchom, przywróć dokładną treść): nieużywana zmienna, promise bez `await`,
   `(click)` bez obsługi klawiatury, zły prefiks selektora, import łamiący tag, głęboki alias, zły format —
   jeden `pnpm lint` pokazuje wszystkie naraz; `nx run <projekt>:lint` łapie granice.
3. Pomiar po tym samym protokołem co w kroku 0.3; raport: tabela przed/po (czasy, bajty wyjścia, rozmiary
   plików agentów), lista utraconych i odzyskanych reguł, ryzyka.

Punkt odniesienia (Nx + Angular, 80 projektów, laptop i7): lint całego repo 197 s → 15 s,
`nx run-many -t lint` 174 s → 55 s, pojedynczy projekt 2–3× szybciej, `pnpm verify` bez zmian (stary nie
lintował apps/libs), hook szybszy. oxlint nie ma cache — ciepły lint w małym repo bywa wolniejszy niż ESLint
z `--cache`.

## Pułapki (sprawdzone)

- Narzędzie zablokowane przez politykę systemu (np. Code Integrity blokuje `pnpm.exe`): stop i pytanie —
  żadnych zastępczych skryptów ani `--no-verify` bez zgody.
- `typescript-eslint` ogranicza wersję TypeScriptu (np. `<6.1.0`) — sprawdź peer range przed podbiciem TS.
- Worktree na Windows: krótka ścieżka (`D:\x\a`), `git -c core.longpaths=true`, sprzątanie przez
  `Remove-Item -LiteralPath '\\?\D:\x\a' -Recurse -Force`.
- oxlint na zielono nic nie wypisuje — liczby plików/reguł bierz z `-f json`.
- commitlint: temat małą literą (`docs(repo): adr-0021 …`, nie `ADR-0021 …`).
