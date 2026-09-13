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
| 0   | intake             | doc-intake                  | T1     | verb, slug, AC, klasa ryzyka              | todo   |
| 1   | specify (scaffold) | — (skrypt)                  | 0      | spec + plan + run-log                     | done   |
| 2   | clarify            | orchestrator-sdd            | T2     | `[?]` domknięte, `status: clarified`      | todo   |
| 3   | plan               | doc-spec                    | T2     | tabela zadań                              | todo   |
| 4   | analyze            | orchestrator-sdd            | T2     | GO / NO-GO                                | todo   |
| 5   | implement          | code-angular / code-tooling | T2/T1  | kod lint-clean                            | todo   |
| 6   | testy              | code-tester-unit + code-tester-e2e | T1/T2 | unit + e2e zielone                    | todo   |
| 7   | bramy              | code-verifier               | T1     | `npm run verify`                          | todo   |
| 8   | review             | code-reviewer + doc-reviewer | T3/T2 | APPROVED / NO-GO                          | todo   |
| 9   | DoD                | orchestrator-sdd            | T2     | wszystkie punkty `/dod` ✅                | todo   |

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
