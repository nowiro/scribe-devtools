---
type: run
id: 'run.{{verb}}.{{slug}}'
status: in-progress
date: '{{date}}'
stamp: '{{stamp}}'
title: '{{verb}} — {{slug}}'
---

# Run-log: {{verb}} — {{slug}} · {{stamp}}

> Artefakt SDD, lokalny (`docs/runs/`). Zapis jednej iteracji: kto (agent), na czym (tier), z jakim
> wynikiem (ścieżka artefaktu albo komenda bramy). Domyka go sekcja „Weryfikacja końcowa".

Powiązane: spec `docs/specs/{{slug}}/spec.md` · plan `docs/plans/{{stamp}}_{{verb}}-{{slug}}.md`.

## Kroki

| #   | krok (SDD)         | agent                       | tier   | wynik / artefakt                          | status |
| --- | ------------------ | --------------------------- | ------ | ----------------------------------------- | ------ |
| 0   | intake             | doc-intake                  | fast     | verb, slug, AC, klasa ryzyka              | todo   |
| 1   | specify (scaffold) | — (skrypt)                  | 0      | spec + plan + run-log                     | done   |
| 2   | clarify            | orchestrator            | fast  | `[?]` domknięte, `status: clarified`      | todo   |
| 3   | plan               | doc-spec                    | base     | tabela zadań                              | todo   |
| 4   | analyze            | orchestrator            | fast  | GO / NO-GO                                | todo   |
| 5   | implement          | code-angular / code-tooling | base/fast  | kod lint-clean                            | todo   |
| 6   | testy              | code-tester-unit + code-tester-e2e | fast/base | unit + e2e zielone                    | todo   |
| 7   | bramy              | code-verifier               | fast     | `npm run verify`                          | todo   |
| 8   | review             | code-reviewer-anthropic + code-reviewer-openai + code-reviewer-moonshot + doc-reviewer | main-*/base | APPROVED / NO-GO (trzy tabele scalone) | todo   |
| 9   | DoD                | orchestrator            | fast  | wszystkie punkty `/dod` ✅                | todo   |

> Commity: każde zadanie planu `done` ma SHA w kolumnie `commit` planu (wykonuje `scm-git`, tylko pliki
> zadania); push wykonuje człowiek po DoD. STOP (`doc-reviewer`, STOP-AND-ASK) kończy turę — odpowiedź
> operatora zapisz tu jako wiersz, zanim drabina ruszy dalej.

## Napotkane problemy

> Pełny ślad problemów (build / lint / test / runtime) i napraw. Brak problemów → jeden wiersz „none".

| #   | krok | problem | przyczyna | naprawa | status |
| --- | ---- | ------- | --------- | ------- | ------ |
| 1   | [?]  | [?]     | [?]       | [?]     | [?]    |

## Koszty (opcjonalnie)

| agent | tier | kroki | uwagi (model zaobserwowany, gdy różny od tieru) |
| ----- | ---- | ----- | ------------------------------------------------ |
| [?]   | [?]  | [?]   | [?]                                              |

## Weryfikacja końcowa

- **Diff vs spec/AC:** [?] każde AC dowiezione, bez regresji i scope-creep
- **`npm run verify`:** [?] wynik pełnej bramy
- **Testy:** [?] scenariusze pokrywają każde AC · unit + e2e zielone · zero `.skip`/`.only`
- **Działa end-to-end:** [?] realnie działa (browser-inspector / e2e), nie tylko zielone testy
- **Werdykt:** [?] go / no-go + jedno zdanie uzasadnienia
