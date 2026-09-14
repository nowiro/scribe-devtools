---
description: 'Wendorowane narzędzie browser-inspector: przeglądarka przez skrypt (flow batch i sesja na refach), wynik na dysku'
applyTo: 'tools/browser-inspector/**'
---

# browser-inspector (`tools/browser-inspector/`)

Kod wendorowany: czysty ESM `.mjs` z typami w JSDoc (`tsc --checkJs` w `npm run typecheck`), jedna
zależność runtime — `playwright-core` (exact, `tools/scripts/pins.config.mjs`) — i systemowy Chrome/Edge.

- **Czytasz, nie przepisujesz.** Zmiana to decyzja człowieka z wpisem w `tools/browser-inspector/README.md`.
- Klient (`bin/browser-inspector.mjs`, `src/client.mjs`, `src/cli.mjs`, `src/steps.schema.mjs`, `src/paths.mjs`,
  `src/print.mjs`) NIGDY nie importuje `playwright-core` ani modułów silnika — budżet startu klienta.
- Sekrety tylko przez środowisko (`valueFromEnv`, `--env`, `@{NAZWA}`); literał w configu jest błędem
  walidacji, nie udogodnieniem. Raport powtarza NAZWĘ zmiennej, nigdy wartość.
- Nieudany krok to wynik w raporcie (exit 0 w batchu), nie wyjątek; błąd środowiska to jasny komunikat.
- Wynik zawsze na dysku (`.browser-inspector/`, gitignorowany) — komenda drukuje jedną
  linię i ścieżkę; nie wciągaj strony do kontekstu.
- Gramatyka kroków i flag: `npm run browser-inspector -- help [krok]`; szablon flow: `templates/flow.md`.
