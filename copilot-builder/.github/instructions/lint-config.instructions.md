---
description: 'Konfiguracja lintów i formatera: oxlint, angular-eslint, oxfmt, commitlint'
applyTo: 'oxlint.config.mts,oxlint.plugins.mts,oxlint.rules.mts,eslint.config.mjs,.oxfmtrc.jsonc,commitlint.config.mjs'
---

# Konfiguracja lintów i formatera

Właściciel: `code-tooling`. Brama: `npm run lint && npm run format:check`.

## Reguły

1. `denyWarnings` w oxlint i `--max-warnings=0` w ESLint. Reguła jest `error` albo jej nie ma.
2. Wszystkie reguły poza Angularem stoją w oxlint. Presety pluginów stoją w `oxlint.plugins.mts` (co i na jakich
   plikach). Dostrojenie stoi w `oxlint.rules.mts` (progi i wyłączenia). Każde wyłączenie ma komentarz z powodem.
3. `eslint.config.mjs` ma TYLKO angular-eslint (szablony `.html` i szablony inline). oxlint nie parsuje szablonów.
   Reguły innej wtyczki w ESLint nie dodajesz — dwa lintery nie mogą mieć dwóch opinii o jednej linii.
4. Kolejność warstw oxlint: presety (bazowa, TypeScript, pluginy), dostrojenie, granice modułów. Nie zmieniasz kolejności.
5. Warstwę oxlint tworzysz wyłącznie przez `layer(files, rules)`. `plugins` i `jsPlugins` wylicza on z nazw reguł.
   Ręcznie wpisana warstwa gubi opcje reguł natywnych (oxlint 1.83).
6. Reguła presetu, której oxlint nie ma, trafia do `NOT_IN_OXLINT` z powodem. oxlint odrzuca konfigurację z nieznaną
   regułą — czytaj komunikat `Rule 'x' not found`.
7. Granice modułów to `no-restricted-imports` z wzorcami aliasów `@cb/*`. Jedna pełna lista wzorców na warstwę.
8. oxfmt formatuje TS, JS, JSON, CSS, YAML i szablony HTML. Markdown jest wyłączony w `ignorePatterns` z wyboru.
   Zmiana liczb w `.oxfmtrc.jsonc` (120 kolumn, pojedyncze cudzysłowy, przecinki końcowe) wymaga ADR.
9. `scope-enum` commitlinta opisuje obszar repozytorium, nie nazwę projektu.
