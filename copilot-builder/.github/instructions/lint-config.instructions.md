---
description: 'Konfiguracja lintów i formatera: ESLint flat config, Biome, commitlint'
applyTo: 'eslint.config.mjs,eslint.plugins.mjs,eslint.rules.mjs,biome.jsonc,commitlint.config.mjs'
---

# Konfiguracja lintów i formatera

Właściciel: `code-tooling`. Brama: `npm run lint && npm run format:check`.

## Reguły

1. `--max-warnings=0`. Reguła jest `error` albo jej nie ma.
2. Presety pluginów stoją w `eslint.plugins.mjs` (co i na jakich plikach). Dostrojenie stoi w `eslint.rules.mjs`
   (progi i wyłączenia). Każde wyłączenie ma komentarz z powodem.
3. Kolejność warstw: ignorowanie, bazowa, językowa (typed TS), frameworkowa (Angular), presety, dostrojenie,
   granice modułów. Nie zmieniasz kolejności.
4. Granice modułów to `no-restricted-imports` z wzorcami aliasów `@cb/*`. Jedna pełna lista wzorców na warstwę.
5. Biome formatuje TS, JS, JSON, CSS. Markdown i szablony HTML nie mają formatera. Zmiana liczb w `biome.jsonc`
   (120 kolumn, pojedyncze cudzysłowy, przecinki końcowe) wymaga ADR.
6. `scope-enum` commitlinta opisuje obszar repozytorium, nie nazwę projektu.
