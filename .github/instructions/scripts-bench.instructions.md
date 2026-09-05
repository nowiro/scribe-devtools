---
applyTo: 'scripts/**/*.mjs,bench/**/*.mjs,.githooks/*'
---

# Skrypty repo (`scripts/`), hook pre-commit i bench (`bench/`)

- Node `.mjs`, cross-platform (Windows 11 + macOS/Linux): `node:path`, `process.platform`; zero
  basha/PowerShella/`npx` w logice; żadnych wywołań LLM ze skryptów.
- Skrypty są bramkami `npm run verify` i mają tryb `--check` (świeżość artefaktu) obok trybu
  generującego: `index-code` (CODE-INDEX.md), `gen-steps-doc` (docs/STEPS.md),
  `check-instruction-sync` (blok AGENTS.md ≡ `INSTRUCTION` benchu ≡ `.github/copilot-instructions.md`,
  limit tokenów o200k), `portable-zip` (download/, deterministyczny, `.sha256`, wersja tylko z
  `package.json`, zip wydanej wersji zamrożony po tagu).
- Hook `.githooks/pre-commit` uruchamia je w kolejności code-index → steps-doc → portable i dodaje
  wyniki do commita; nie dopisuj do hooka niczego, co trwa dłużej niż kilka sekund albo wymaga sieci.
- Bench mierzy TO SAMO zadanie po obu stronach (`bench/task.mjs`, bramka `checkFindings`), czas od
  `spawn` do `exit` prawdziwego procesu klienta, tokeny tym samym tokenizerem; warianty
  `browser-inspector-warm|warm-tight|warm-fresh|first|cold|interactive-*` i MCP `naive|lean|lean
--timeout-settle 100`; pin `@playwright/mcp` w `bench/package.json` ↔ `.mcp.playwright.example.json` ↔
  `.vscode/mcp.playwright.example.json` (test; przykłady, nie żywa konfiguracja — żywy `mcp.json` kosztuje
  4069 tokenów na rozmowę). `--assert-speedup N` kończy się kodem 1 poniżej progu.
- RAPORT.md / WYNIKI.md / BUDGET.md / blok BENCH w README generuje wyłącznie `npm run bench`;
  zmieniasz generator → uruchamiasz bench, nie edytujesz wyników.
