---
type: plan
id: 'plan.{{verb}}.{{slug}}'
status: draft
date: '{{date}}'
stamp: '{{stamp}}'
title: '{{verb}} — {{slug}}'
---

# Plan: {{verb}} — {{slug}}

> Artefakt SDD, lokalny (`docs/plans/`). Spec: `docs/specs/{{slug}}/spec.md`.
> Każde zadanie służy jakiemuś AC. Każde AC ma zadanie testowe.

## Zadania

> Zasady tabeli: `agent` = wynik `npm run route -- <paths>` (nazwy tylko z rosteru); `paths` = pliki zadania
> (z nich `npm run sdd -- brief` buduje PLIKI); `done_when` = komenda albo obserwowalny stan; `commit` startuje
> jako `—`, SHA wpisuje `npm run sdd -- task`. Wiersze niżej to wzorzec: jedno zadanie na obszar. Wiersz bez
> zastosowania skasuj albo oznacz `n/a` z powodem. W T008 wpisz agentów z wyniku `npm run review:draw`
> połączonych ` + `, plus `doc-reviewer`. Statusy i SHA zmienia skrypt, nie ręka.

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
| T008 | review kodu (wylosowane rodziny modeli) i prozy  | code-reviewer-anthropic + code-reviewer-openai + code-reviewer-moonshot + doc-reviewer | — | APPROVED scalone w `docs/reviews/` (wiersz w `docs/INDEX.md`) | todo | — | — |
| T009 | DoD i domknięcie run-logu                        | orchestrator | — | `/dod` wszystkie punkty ✅                                  | todo   | —        | — |

## Pytania otwarte

[?] Decyzje projektowe, ryzyka, ADR-y (decyzja nieodwracalna: `/adr`).
