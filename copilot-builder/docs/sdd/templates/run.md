---
type: run
id: 'run.{{verb}}.{{slug}}'
status: in-progress
date: '{{date}}'
stamp: '{{stamp}}'
title: '{{verb}} — {{slug}}'
---

# Run-log: {{verb}} — {{slug}} · {{stamp}}

> Artefakt SDD, lokalny (`docs/runs/`). Jeden wiersz po każdym kroku: kto (agent), na czym (tier), z jakim
> wynikiem (ścieżka artefaktu albo komenda bramy). Wiersze zmienia `npm run sdd -- log`. Domyka sekcja
> „Weryfikacja końcowa".

Powiązane: spec `docs/specs/{{slug}}/spec.md` · plan `docs/plans/{{stamp}}_{{verb}}-{{slug}}.md`.

## Kroki

| #   | krok (SDD)         | agent                              | tier      | wynik / artefakt                          | status |
| --- | ------------------ | ---------------------------------- | --------- | ----------------------------------------- | ------ |
| 0   | intake             | doc-intake                         | fast      | verb, slug, AC, klasa ryzyka              | todo   |
| 1   | specify (scaffold) | — (skrypt)                         | 0         | spec + plan + run-log                     | done   |
| 2   | clarify            | orchestrator                       | fast      | `[?]` domknięte, `status: clarified`      | todo   |
| 3   | plan               | doc-spec                           | base      | tabela zadań                              | todo   |
| 4   | analyze            | orchestrator                       | fast      | GO / NO-GO                                | todo   |
| 5   | implement          | code-angular / code-tooling        | base/fast | kod lint-clean, commit per zadanie        | todo   |
| 6   | testy              | code-tester-unit + code-tester-e2e | fast/base | unit + e2e zielone                        | todo   |
| 7   | bramy              | code-verifier                      | fast      | `npm run verify`                          | todo   |
| 8   | review             | miejsca z `review:draw` + doc-reviewer | main-*/base | APPROVED / NO-GO (tabele scalone)     | todo   |
| 9   | DoD                | orchestrator                       | fast      | wszystkie punkty `/dod` ✅                | todo   |

> Każde zadanie planu `done` ma SHA w kolumnie `commit` planu (commit robi `scm-git`, tylko pliki zadania).
> Push robi człowiek po DoD. Odpowiedź człowieka po STOP zapisz tu jako wiersz, zanim drabina ruszy dalej.

## Napotkane problemy

> Każdy problem (build, lint, test, runtime) i jego naprawa. Brak problemów: jeden wiersz „none".

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
