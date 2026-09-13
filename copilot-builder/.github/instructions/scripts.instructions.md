---
description: 'Skrypty bram, hooki i narzędzia testowe: Node .mjs cross-platform, zero zależności, kody wyjścia jako kontrakt'
applyTo: 'tools/scripts/**,tools/hooks/**,tools/testing/**,.githooks/**'
---

# Skrypty repozytorium (`tools/`) i hooki

Właściciel: `code-tooling`. Brama: `npm run typecheck` (tsc `--checkJs` z JSDoc), `npm run lint`, `npm test`.

- Node `.mjs`, cross-platform (Windows 11 + macOS/Linux): `node:path`, `process.platform`; zero
  basha/PowerShella/`npx` w logice; żadnych wywołań LLM ze skryptów.
- Skrypt jest bramą: jedna linia `ok …`/`FAIL …` z prefiksem, kody wyjścia 0 pass · 1 naruszenie · 2 błąd
  użycia/środowiska; tryb `--check` obok trybu generującego, gdy artefakt jest generowany
  (`index-code`, `stack`).
- Typy przez JSDoc (`@param`, `@returns`, `@typedef`), komentarz nagłówkowy mówi PO CO i DLACZEGO —
  `index-code` bierze z niego pierwszy akapit jako `purpose` w `CODE-INDEX.md`.
- Nowa zależność = wiersz w `tools/scripts/pins.config.mjs` z `why`; wersja nigdy w prozie.
- Hook (`tools/hooks/*.mjs`) czyta payload ze stdin, odpowiada JSON-em na stdout, nigdy nie blokuje
  dłużej niż kilka sekund i nie wychodzi do sieci. `.githooks/*` to `#!/bin/sh` z `set -e`.
- Testy `*.spec.mjs` obok skryptu (Vitest, `vitest.tools.config.mts`); dane jawne, bez sieci.
- `tools/scribe/**` i `tools/browser-inspector/**` są wendorowane — mają własne README i zasady.
