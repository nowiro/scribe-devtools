---
type: decision
id: 'adr.oxc-oxfmt-and-oxlint'
status: accepted
date: '2026-09-16'
stamp: '2026-09-16_10-27'
title: 'ADR — oxc: oxfmt zamiast Biome, oxlint dla wszystkich reguł poza Angularem'
---

# ADR: oxfmt i oxlint (oxc) zamiast Biome i większości ESLint

Zastępuje [ADR — Biome zamiast Prettiera](2026-09-13_21-31_adr-biome-instead-of-prettier.md).

## Kontekst

Biome formatował TS/JS/JSON/CSS, a ESLint trzymał wszystkie reguły: bazę JS, typescript-eslint z typami,
angular-eslint, sonarjs, unicorn, promise, regexp, security, import-x, n, vitest i playwright. Dwie luki
Biome były przyjęte świadomie: Markdown i szablony Angulara bez formatera. Typowany ESLint to najwolniejsza
część bramy, gdy w `apps/` i `libs/` pojawia się kod.

oxc dostarcza dwa narzędzia. oxfmt daje wynik w kształcie Prettiera (przechodzi jego testy zgodności JS/TS)
i formatuje także YAML, Markdown i szablony Angulara z control flow. oxlint ma natywnie ESLint core,
TypeScript (reguły z typami przez oxlint-tsgolint na TypeScript 7), unicorn, import, promise i vitest, a
wtyczki ESLint ładuje jako `jsPlugins` (alpha). oxlint nie ma parsera szablonów Angulara.

## Decyzja

1. **oxfmt jest jedynym formaterem** (`.oxfmtrc.jsonc`): te same liczby co wcześniej, czyli 120 kolumn, LF,
   pojedyncze cudzysłowy i przecinki końcowe. `sortPackageJson` jest wyłączone. Szablony `.html` są
   formatowane, bo `@if`, `@for`, `@switch`, `@defer` i `@let` wychodzą zagnieżdżone, nie spłaszczone.
2. **Markdown zostaje bez formatera z wyboru** (`**/*.md` w `ignorePatterns`). Na tym drzewie oxfmt zmienia
   56 plików i dokłada 24,5 kB (+4,9 %). Najwięcej dostają pliki czytane w każdej sesji:
   `orchestrator.agent.md` +7,6 kB (dopełnione tabele routingu, które `npm run route -- --sync` generuje
   bez dopełnienia) i `GLOSSARY.md` +6,6 kB. 27 z tych plików to wendorowane referencje skilla
   `angular-developer`, których się nie zmienia. oxfmt wstawia też puste linie wokół znaczników bloków
   instrukcji.
3. **oxlint trzyma wszystkie reguły poza Angularem** (`oxlint.config.mts`, `oxlint.plugins.mts`,
   `oxlint.rules.mts`). Presety `@eslint/js` i `typescript-eslint` są czytane z pakietów. Presety promise
   i vitest są wypisane. sonarjs, regexp, security, n, eslint-comments i playwright działają jako `jsPlugins`.
   Warstwę tworzy wyłącznie `layer(files, rules)`, bo oxlint 1.83 gubi opcje reguły natywnej w warstwie,
   która nie włącza jej wtyczki, jeśli jakakolwiek warstwa ładuje wtyczkę JS.
4. **ESLint zostaje tylko dla angular-eslint** (`eslint.config.mjs`): szablony `.html` i szablony inline.
   Obie konfiguracje nie mają wspólnych reguł, więc `eslint-plugin-oxlint` jest zbędny.
5. **`npm run lint` = `oxlint && eslint .`**. `affected lint`, `verify` i generator (`--fix`) wołają oba lintery.
6. **Generator dopisuje `rootDir: "src"`** w `tsconfig.lib.json` i `tsconfig.spec.json` biblioteki. TypeScript 7
   (oxlint-tsgolint) odrzuca `outDir` bez `rootDir`, a TypeScript 6 tylko to deprecjonował.

## Pomiary (aplikacja + 3 biblioteki z generatora, Windows, 16 wątków)

| brama                               | przed (Biome + ESLint)     | po (oxfmt + oxlint + angular-eslint) |
| ----------------------------------- | -------------------------- | ------------------------------------ |
| format check                        | 1,7 s                      | 0,4 s                                |
| lint na zimno (bez cache ESLint)    | 10,4 s                     | 5,4 s (oxlint 4,4 + ESLint 1,0)      |
| lint na ciepło (cache ESLint)       | 2,6 s                      | 5,3 s (oxlint nie ma cache)          |

oxlint rozkłada się tak: około 0,7 s to ładowanie `oxlint.config.mts` (import presetów), około 2,1 s to
wtyczka sonarjs w JS, a około 1,6 s to reszta (reguły natywne, tsgolint i pozostałe wtyczki JS). CI startuje
bez ciepłego cache, a `affected lint` pomija projekty z markerem w `.cache/tasks/`.

## Odrzucone alternatywy

| Alternatywa                                  | Powód odrzucenia                                                                                     |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| tylko oxlint, bez ESLint                     | znikają reguły szablonów Angulara z dostępnością; oxlint nie parsuje `.html` ani szablonów inline      |
| oxfmt tylko jako formater, ESLint bez zmian  | typowany ESLint zostaje najwolniejszą bramą na zimno                                                  |
| oxfmt także dla Markdownu                    | +7,6 kB w orkiestratorze ładowanym co sesję; walka z `route --sync`; zmiany w referencjach wendorowanych |
| `.oxlintrc.json` z `@oxlint/migrate`         | 48 kB wypisanych reguł (sonarjs sam 279); przy bumpie presetu lista gnije po cichu                    |
| `n` natywnie (`node`)                        | oxlint ma 1 z 14 reguł presetu, w tym brak `no-process-exit`, którego skrypty-bramy wymagają          |

## Konsekwencje

- Reguły presetów bez odpowiednika w oxlint są w `NOT_IN_OXLINT` z powodem. Moduł rzuca błąd, gdy wpis
  przestaje występować w presecie, a oxlint odrzuca konfigurację z nieznaną regułą.
- `@eslint-community/eslint-comments/no-unlimited-disable` w oxlint 1.83 raportuje złą linię albo wywraca się
  na przeliczeniu pozycji. Brama i tak jest czerwona, ale komunikat bywa mylący.
- `.oxfmtrc.jsonc` i `oxlint.*.mts` są wyzwalaczami korzenia w `affected`. `guard:forbidden` odrzuca
  `biome.json`, `biome.jsonc` i `@biomejs/biome`.
- Wersje `oxfmt`, `oxlint` i `oxlint-tsgolint` są przypięte dokładnie. oxlint i oxfmt są w wersjach
  wydawanych co tydzień, a `jsPlugins` nie podlegają semver.
- Zmiana liczb w `.oxfmtrc.jsonc` to zmiana całego drzewa — wymaga nowego ADR-u.

## Powiązane

- `.oxfmtrc.jsonc`, `oxlint.config.mts`, `oxlint.plugins.mts`, `oxlint.rules.mts`, `eslint.config.mjs`
- `.github/instructions/lint-config.instructions.md`, `tools/scripts/pins.config.mjs`
