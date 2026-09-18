---
description: 'Konfiguracja GitHub Copilota: agenci, instrukcje, prompty, skille, hooki, rejestr modeli; jak pisać dla małego modelu'
applyTo: '.github/**'
---

# Konfiguracja Copilota (`.github/`)

Właściciel mechaniki (front matter, `tools:`, hooki, rejestr): `code-tooling`. Właściciel treści promptów,
agentów, instrukcji i skilli: `doc-spec`. Brama: `npm run ai:validate` (reguły A1–A20
w `tools/scripts/validate-ai-config.mjs`). Po zmianie agentów: Reload Window w VS Code.

## Jak pisać dla małego modelu

Każdy plik w `.github/` czyta tani model. Piszesz tak, żeby nie musiał się domyślać:

1. Jedno zdanie = jedna instrukcja. Tryb rozkazujący. Krótkie zdania.
2. Kroki numerowane, w kolejności wykonania. Każdy krok podaje dokładną komendę albo dokładną ścieżkę pliku.
3. Stały kształt zwrotu w bloku `text`. Model wypełnia szablon, nie wymyśla formatu.
4. Bez uzasadnień. Powód decyzji stoi w ADR w `docs/decisions/`, nie w instrukcji. Wyjątek: jedno krótkie
   zdanie, gdy bez niego model zrobi coś złego.
5. Bez odsyłaczy w łańcuchu. Gdy krok wymaga innego pliku, mówi: „Przeczytaj plik X. Wykonaj jego kroki 1–9".
6. Słowa z `GLOSSARY.md`. Nowe słowo dostaje definicję w słowniku na górze pliku.
7. Warunek i akcja w jednym zdaniu: „Zwrócił `FAIL`: STOP". Bez zagnieżdżonych „jeśli".
8. Tabela ma najwyżej 4 kolumny. Lista ma najwyżej 10 punktów. Dłuższa procedura idzie do skilla.
9. Plik agenta ma stałe sekcje: opis roli (2–3 zdania), Zasady, Jak pracujesz, Zwrot.
10. Prompt to wejście od człowieka plus numer kroku procedury orkiestratora plus to, co prompt dodaje.

## Reguły mechaniki

1. Roster żyje w `.github/models-registry.json` (`agents.roster`: rola, tier, widoczność). Plik agenta bez wpisu
   w rosterze i wpis bez pliku to usterka. Nazwy `<domena>-<przedmiot>`: `code-*`, `doc-*`, `scm-*`, `mcp-*`.
   Jedyny widoczny agent to `orchestrator` (`user-invocable: true`).
2. `description` agenta zaczyna się od tagu tieru (`fast ·`, `base ·`, `main-<rodzina> ·`, `vision ·`) i ma kształt
   `<tier> · <rola>. Wejście: … Wyjście: … Nigdy: …`. Orkiestrator wybiera agenta po tym opisie.
3. `model:` w pliku agenta to nazwa, którą rejestr przypisuje tierowi z rosteru. Zmiana modelu to zmiana
   `tiers` w rejestrze i tej jednej linii. Nigdzie indziej nazwa modelu nie stoi.
4. Miejsca review: `review.seats` w rejestrze, agent `code-reviewer-<rodzina>` na tierze `main-<rodzina>`. A18
   sprawdza, że model za tierem jest z tej rodziny i że rodziny są różne. A20 sprawdza `review.seatsPerReview`
   (od 2 do rozmiaru puli).
5. `tools:` wynika z roli (`agents.roles` w rejestrze): reviewer i triager bez `edit` i `execute`, writer z `edit`,
   tester z `edit` i `execute`, verifier z `execute`, scm z `execute` bez `edit`, orchestrator z `agent`.
   Reviewer i triager mają hook `deny-writes` (A13).
6. Tabela routingu w `orchestrator.agent.md` (blok `ROUTING:START/END`) jest generowana
   z `tools/scripts/routing.config.mjs` przez `npm run route -- --sync`. Ręczna edycja to usterka (A19).
7. Serwery MCP z `.vscode/mcp.json` wymienia na liście `tools:` tylko `mcp-gateway` (A8).
8. Instrukcja (`instructions/*.instructions.md`) ma `applyTo` na istniejącą ścieżkę. Prompt (`prompts/*.prompt.md`)
   ma `description`. Hook (`hooks/*.json`) wskazuje skrypt w `tools/hooks/`.
9. `copilot-instructions.md` i `AGENTS.md` czyta każdy agent przy każdym żądaniu. Reguła dla ścieżki idzie do
   instrukcji, reguła roli do agenta, procedura do prompta albo skilla. Stały prefiks każdego agenta mierzy
   `npm run check:prefix` (`-- --table` pokazuje rozbicie).
10. `skills/angular-developer/references/**` to kopia z angular/skills (commit w `SKILL.md`). Czytasz, nie
    zmieniasz. Aktualizacja: nowy commit, te same wykluczenia, decyzja człowieka.
