---
description: 'Konfiguracja GitHub Copilota: agenci, instrukcje, prompty, hooki, rejestr modeli — kod, nie proza'
applyTo: '.github/**'
---

# Konfiguracja Copilota (`.github/`)

Właściciel: `code-tooling` (mechanika) i `doc-spec` (treść prompta / agenta). Brama: `npm run ai:validate`
(reguły A1–A12 w `tools/scripts/validate-ai-config.mjs`). Po zmianie agentów: **Reload Window** w VS Code.

- Roster żyje w `.github/models-registry.json` (`agents.roster`: rola, tier, widoczność) — plik agenta bez
  wpisu w rosterze i wpis bez pliku są usterką. Nazwy `<domena>-<przedmiot>`: `orchestrator-*`, `code-*`,
  `doc-*`, `mcp-*`.
- Dokładnie jeden agent widoczny (`user-invocable: true`): `orchestrator-sdd`. Reszta pracuje przez
  delegację (`agents:` orkiestratora).
- `model:` to nazwa, którą rejestr przypisuje tierowi z rosteru — zmiana modelu to zmiana rejestru
  (`tiers`), nigdy pliku agenta. `description` zaczyna się od tagu tieru (`T1 ·`, `T2 ·`, `T3 ·`, `vision ·`).
- `tools:` wynika z roli (`agents.roles` w rejestrze): reviewer/triager bez `edit` i `execute`, writer z
  `edit`, tester z `edit` + `execute`, verifier z `execute`, orchestrator z `agent`. Reviewer ma dodatkowo
  hook `deny-writes` — lista narzędzi jest prośbą, hook jest egzekucją.
- Serwery MCP z `.vscode/mcp.json` wymienia na liście `tools:` wyłącznie `mcp-gateway`.
- Instrukcje (`instructions/*.instructions.md`) mają `applyTo` wskazujący istniejące ścieżki; prompty
  (`prompts/*.prompt.md`) mają `description`; hooki (`hooks/*.json`) wskazują istniejące skrypty w `tools/hooks/`.
- `copilot-instructions.md` jest kartą always-on: każda linia kosztuje przy każdej turze — reguła
  ścieżkowa idzie do instrukcji, reguła roli do agenta, procedura do prompta.
