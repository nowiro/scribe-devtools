---
description: 'Wendorowane narzędzie browser-inspector: przeglądarka przez skrypt (flow batch i sesja na refach), wynik na dysku'
applyTo: 'tools/browser-inspector/**'
---

# browser-inspector (`tools/browser-inspector/`)

Kod wendorowany: czysty ESM `.mjs` z typami w JSDoc (`tsc --checkJs` w `npm run typecheck`), jedna zależność
runtime `playwright-core` (exact, `tools/scripts/pins.config.mjs`), systemowy Chrome albo Edge.

## Reguły

1. Czytasz, nie zmieniasz. Poprawka to decyzja człowieka z wpisem w `tools/browser-inspector/README.md`.
2. Klient (`bin/browser-inspector.mjs`, `src/client.mjs`, `src/cli.mjs`, `src/steps.schema.mjs`, `src/paths.mjs`,
   `src/print.mjs`) nigdy nie importuje `playwright-core` ani modułów silnika.
3. Sekrety tylko przez środowisko (`valueFromEnv`, `--env`, `@{NAZWA}`). Literał w configu to błąd walidacji.
   Raport powtarza nazwę zmiennej, nigdy wartość.
4. Nieudany krok to wynik w raporcie (exit 0 w batchu), nie wyjątek. Błąd środowiska to jasny komunikat.
5. Wynik zawsze na dysku (`.browser-inspector/`, gitignorowany). Komenda drukuje jedną linię i ścieżkę.
   Strony nie wciągasz do kontekstu.
6. Lista kroków i flag: `npm run browser-inspector -- help [krok]`. Szablon flow: `templates/flow.md`.
