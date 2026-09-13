---
type: plan
id: 'plan.{{verb}}.{{slug}}'
status: draft
date: '{{date}}'
stamp: '{{stamp}}'
title: '{{verb}} — {{slug}}'
---

# Plan: {{verb}} — {{slug}}

> Artefakt SDD, lokalny (`docs/plans/`). Traceability: `plan.{{verb}}.{{slug}}` ↔ `spec.{{slug}}`
> (`docs/specs/{{slug}}/spec.md`). Każde zadanie służy jakiemuś AC; każde AC ma zadanie testowe.

## Zadania

> Kolumnę `agent` wyznacza ŚCIEŻKA dotykanego pliku (tabela routingu w `orchestrator-sdd`), nie etap
> drabiny; nazwy wyłącznie z rosteru (`.github/models-registry.json`) — `npm run sdd:check` to sprawdza.
> Wiersze niżej to WZORZEC: jedno zadanie na obszar. Wiersz bez zastosowania kasuj albo oznacz `n/a` z powodem.
> Ukończony krok: `status → done` + jeden proponowany commit (`type(scope): subject`).

| id   | title                                            | agent            | done_when                                                   | status | AC       |
| ---- | ------------------------------------------------ | ---------------- | ----------------------------------------------------------- | ------ | -------- |
| T000 | intake: klasyfikacja i kompletność AC            | doc-intake       | verb i slug jednoznaczne, AC numerowane, STOP przy niejasności | todo | —        |
| T001 | spec bez `[?]` (clarify)                         | doc-spec         | `status: clarified`, `npm run sdd:check` zielony            | todo   | wszystkie |
| T002 | implementacja — kod aplikacji / bibliotek        | code-angular     | `npm run affected -- lint` i `-- typecheck` zielone         | todo   | AC1, AC2 |
| T003 | scenariusze testów z AC (happy, edge, błąd)      | code-tester-unit | scenariusze spisane per AC                                  | todo   | wszystkie |
| T004 | testy jednostkowe (Vitest)                       | code-tester-unit | `npm run affected -- test` zielone, progi pokrycia trzymane | todo   | AC1, AC2 |
| T005 | e2e (Playwright, matryca viewportów)             | code-tester-e2e  | `npm run affected -- e2e` zielone po `-- build`             | todo   | AC1      |
| T006 | przegląd wizualny (gdy zmienia się ekran)        | code-reviewer-ui | raport 🔴🟡🟢, 🔴 wraca do właściciela                       | todo   | —        |
| T007 | bramy                                            | code-verifier    | `npm run verify` zielone                                    | todo   | —        |
| T008 | review kodu i prozy                              | code-reviewer + doc-reviewer | APPROVED w `docs/reviews/` (wiersz w `docs/INDEX.md`) | todo | —     |
| T009 | DoD i domknięcie run-logu                        | orchestrator-sdd | `/dod` wszystkie punkty ✅                                  | todo   | —        |

## Pytania otwarte

[?] Decyzje projektowe, ryzyka, ADR-y (jeśli decyzja jest nieodwracalna — `/adr`).
