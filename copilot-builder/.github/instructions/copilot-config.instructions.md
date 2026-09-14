---
description: 'Konfiguracja GitHub Copilota: agenci, instrukcje, prompty, hooki, rejestr modeli — kod, nie proza'
applyTo: '.github/**'
---

# Konfiguracja Copilota (`.github/`)

Właściciel: `code-tooling` (mechanika) i `doc-spec` (treść prompta / agenta). Brama: `npm run ai:validate`
(reguły A1–A19 w `tools/scripts/validate-ai-config.mjs`). Po zmianie agentów: **Reload Window** w VS Code.

- Roster żyje w `.github/models-registry.json` (`agents.roster`: rola, tier, widoczność) — plik agenta bez
  wpisu w rosterze i wpis bez pliku są usterką. Nazwy `<domena>-<przedmiot>`: `code-*`, `doc-*`, `scm-*`, `mcp-*`;
  jedyny widoczny koordynator to gołe `orchestrator`.
- Dokładnie jeden agent widoczny (`user-invocable: true`): `orchestrator`. Reszta pracuje przez
  delegację (`agents:` orkiestratora).
- `description` każdego agenta ma stały szablon: `<tier> · <rola>. Wejście: … Wyjście: … Nigdy: …` —
  orkiestrator (tier `fast`) wybiera wykonawcę po tym opisie, więc opis mówi, co agent bierze, co zwraca
  i czego nie robi; plik orkiestratora jest procedurą z dokładnymi komendami, nie opisem.
- `model:` to nazwa, którą rejestr przypisuje tierowi z rosteru — zmiana modelu to zmiana rejestru
  (`tiers`), nigdy pliku agenta. `description` zaczyna się od tagu tieru (`fast ·`, `base ·`, `main-<rodzina> ·`, `vision ·`).
- Review kodu to trzy miejsca z `review.seats` rejestru na trzech RÓŻNYCH rodzinach modeli (`models.*.family`),
  ten sam brief i zakres; miejsce nazywa się po rodzinie, którą obiecuje (`code-reviewer-<rodzina>`, tier
  `main-<rodzina>`), a A18 sprawdza, że model za tierem jest z tej rodziny i że trzy rodziny są różne —
  zmiana dostawcy to zmiana nazwy agenta, tieru i wpisu w `review.seats`.
- `tools:` wynika z roli (`agents.roles` w rejestrze): reviewer/triager bez `edit` i `execute`, writer z
  `edit`, tester z `edit` + `execute`, verifier z `execute`, scm z `execute` bez `edit` (`scm-git` — jedyny
  `git commit`), orchestrator z `agent`. Reviewer ma dodatkowo
  hook `deny-writes` — lista narzędzi jest prośbą, hook jest egzekucją.
- Tabela routingu w `orchestrator.agent.md` (blok `ROUTING:START/END`) jest generowana z
  `tools/scripts/routing.config.mjs` (`npm run route -- --sync`); ręczna edycja tabeli to usterka (A19) —
  zmieniasz konfigurację, a reguły stoją od szczegółowej do ogólnej (pierwsze dopasowanie wygrywa).
- Serwery MCP z `.vscode/mcp.json` wymienia na liście `tools:` wyłącznie `mcp-gateway`.
- Instrukcje (`instructions/*.instructions.md`) mają `applyTo` wskazujący istniejące ścieżki; prompty
  (`prompts/*.prompt.md`) mają `description`; hooki (`hooks/*.json`) wskazują istniejące skrypty w `tools/hooks/`.
- `copilot-instructions.md` jest kartą always-on: każda linia kosztuje przy każdej turze — reguła
  ścieżkowa idzie do instrukcji, reguła roli do agenta, procedura do prompta.
