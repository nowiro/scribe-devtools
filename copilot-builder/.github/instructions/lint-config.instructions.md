---
description: 'Konfiguracja lintów i formatera: ESLint flat config, Biome, commitlint'
applyTo: 'eslint.config.mjs,eslint.plugins.mjs,eslint.rules.mjs,biome.jsonc,commitlint.config.mjs'
---

# Konfiguracja lintów i formatera

Właściciel: `code-tooling`. Brama: `npm run lint && npm run format:check`.

- `--max-warnings=0` jest nienegocjowalne: reguła jest `error` albo jej nie ma.
- Presety pluginów żyją w `eslint.plugins.mjs` (CO i NA JAKICH plikach), dostrojenie zespołu w
  `eslint.rules.mjs` (KTÓRE progi i wyłączenia, z powodem przy każdej regule). Reguła wyłączona bez
  powodu wróci przy aktualizacji pluginu jako „ciekawe, czemu to było wyłączone".
- Kolejność warstw: ignorowanie → bazowa → językowa (typed TS) → frameworkowa (Angular) → presety →
  dostrojenie → granice modułów. Odwrócenie po cichu gasi reguły z warstwy niżej.
- Granice modułów to `no-restricted-imports` z wzorcami aliasów `@cb/*` — jedna kompletna lista wzorców
  per warstwa (reguła nie jest scalana między warstwami).
- Biome formatuje TS/JS/JSON/CSS; Markdown i szablony HTML formatuje nikt (biome.jsonc mówi dlaczego).
  Zmiana liczb w `biome.jsonc` (120 kolumn, pojedyncze cudzysłowy, przecinki końcowe) to zmiana całego
  drzewa i wymaga ADR-u.
- `scope-enum` commitlinta opisuje OBSZAR repozytorium, nie nazwę projektu.
