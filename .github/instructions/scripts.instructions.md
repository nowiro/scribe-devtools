---
applyTo: 'scripts/**/*.mjs,.githooks/*'
---

# Skrypty repo (`scripts/`) i hook pre-commit

- Node `.mjs`, cross-platform (Windows 11 + macOS/Linux): `node:path`, `process.platform`; zero
  basha/PowerShella/`npx` w logice; żadnych wywołań LLM ze skryptów.
- Skrypty są bramkami `npm run verify` i mają tryb `--check` (świeżość artefaktu) obok trybu
  generującego, gdzie to ma sens: `index-code` (CODE-INDEX.md), `check-instruction-sync` (blok
  AGENTS.md ≡ `.github/copilot-instructions.md`, limit tokenów o200k), `check-pins` (offline,
  deterministyczny — `scripts/pins.config.mjs` to jedyne miejsce deklaracji wersji zależności),
  `check-upstream` (online, WARN, poza `verify` — kalendarzowa połowa doktryny aktualności),
  `portable-zip` (`download/`, deterministyczny, `.sha256`, wersja tylko z `package.json`; zamrożenie po tagu
  `v<wersja>` dotyczy tylko zipa śledzonego przez git — tu `download/` jest ignorowany, więc buduje zawsze).
- Hook `.githooks/pre-commit` regeneruje `CODE-INDEX.md` i dodaje go do commita. Nie dopisuj do
  hooka niczego, co trwa dłużej niż kilka sekund albo wymaga sieci — `npm run portable` zostaje
  poleceniem na żądanie, nie krokiem każdego commita.
