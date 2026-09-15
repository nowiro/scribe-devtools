---
description: 'Skrypty bram, hooki i narzędzia testowe: Node .mjs cross-platform, zero zależności, kody wyjścia jako kontrakt'
applyTo: 'tools/scripts/**,tools/hooks/**,tools/testing/**,.githooks/**'
---

# Skrypty repozytorium (`tools/`) i hooki

Właściciel: `code-tooling`. Brama: `npm run typecheck` (tsc `--checkJs` z JSDoc), `npm run lint`, `npm test`.

## Reguły

1. Node `.mjs`. Działa na Windows, macOS i Linux: `node:path`, `process.platform`. Bez basha, PowerShella
   i `npx` w logice. Bez wywołań LLM ze skryptów.
2. Skrypt jest bramą: jedna linia `ok …` albo `FAIL …` z prefiksem. Kody wyjścia: 0 pass, 1 naruszenie,
   2 błąd użycia lub środowiska. Artefakt generowany ma tryb `--check` obok trybu generującego.
3. Typy przez JSDoc (`@param`, `@returns`, `@typedef`). Komentarz nagłówkowy mówi, po co skrypt jest
   i dlaczego. `index-code` bierze z niego pierwszy akapit do `CODE-INDEX.md`.
4. Nowa zależność = wiersz w `tools/scripts/pins.config.mjs` z `why`. Wersji nie wpisujesz w prozę.
5. Hook (`tools/hooks/*.mjs`) czyta payload ze stdin, odpowiada JSON-em na stdout, trwa najwyżej kilka sekund,
   nie wychodzi do sieci. `.githooks/*` to `#!/bin/sh` z `set -e`.
6. Test `*.spec.mjs` leży obok skryptu (Vitest, `vitest.tools.config.mts`). Dane jawne, bez sieci.
7. `tools/alm/**` i `tools/browser-inspector/**` są wendorowane. Mają własne README i zasady. Nie zmieniasz ich.
