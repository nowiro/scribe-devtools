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

> Kolumnę `agent` wyznacza ŚCIEŻKA dotykanego pliku (`npm run route -- <ścieżki>`, źródło
> `tools/scripts/routing.config.mjs`), nie etap drabiny; nazwy wyłącznie z rosteru (`.github/models-registry.json`) — `npm run sdd:check` to sprawdza.
> Wiersze niżej to WZORZEC: jedno zadanie na obszar. Wiersz bez zastosowania kasuj albo oznacz `n/a` z powodem.
> `paths` = pliki zadania (z `npm run route`): z nich `npm run sdd -- brief` buduje PLIKI, a `sdd:check` (C5)
> sprawdza, że `agent` równa się wynikowi `route`. Statusy i SHA zmienia `npm run sdd -- task`, nie ręka.
> Ukończony krok: `status → done` + commit przez `scm-git` (`type(scope): subject`), SHA w kolumnie `commit`.

| id   | title                                            | agent            | paths | done_when                                                   | status | AC       | commit |
| ---- | ------------------------------------------------ | ---------------- | ----- | ----------------------------------------------------------- | ------ | -------- | ------ |
| T000 | intake: klasyfikacja i kompletność AC            | doc-intake       | — | verb i slug jednoznaczne, AC numerowane, STOP przy niejasności | todo | —        | — |
| T001 | spec bez `[?]` (clarify)                         | doc-spec         | — | `status: clarified`, `npm run sdd:check` zielony            | todo   | wszystkie | — |
| T002 | implementacja — kod aplikacji / bibliotek        | code-angular     | apps/<app>/src/**, libs/<zakres>/<typ>-<nazwa>/src/** | `npm run affected -- lint` i `-- typecheck` zielone         | todo   | AC1, AC2 | — |
| T003 | scenariusze testów z AC (happy, edge, błąd)      | code-tester-unit | — | scenariusze spisane per AC                                  | todo   | wszystkie | — |
| T004 | testy jednostkowe (Vitest)                       | code-tester-unit | **/*.spec.ts | `npm run affected -- test` zielone, progi pokrycia trzymane | todo   | AC1, AC2 | — |
| T005 | e2e (Playwright, matryca viewportów)             | code-tester-e2e  | apps/<app>-e2e/** | `npm run affected -- e2e` zielone po `-- build`             | todo   | AC1      | — |
| T006 | przegląd wizualny na 5 szerokościach (gdy zmienia się ekran) | code-reviewer-ui | — | raport 🔴🟡🟢 vs makieta (odstępy, wyrównania, nachodzenie, scroll), 🔴 wraca do właściciela | todo | — | — |
| T007 | bramy                                            | code-verifier    | — | `npm run verify` zielone                                    | todo   | —        | — |
| T008 | review kodu (trzy rodziny modeli) i prozy        | code-reviewer-anthropic + code-reviewer-openai + code-reviewer-moonshot + doc-reviewer | — | APPROVED scalone w `docs/reviews/` (wiersz w `docs/INDEX.md`) | todo | — | — |
| T009 | DoD i domknięcie run-logu                        | orchestrator | — | `/dod` wszystkie punkty ✅                                  | todo   | —        | — |

## Pytania otwarte

[?] Decyzje projektowe, ryzyka, ADR-y (jeśli decyzja jest nieodwracalna — `/adr`).
