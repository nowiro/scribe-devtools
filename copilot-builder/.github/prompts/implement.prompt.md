---
description: 'Implement: zadania planu po kolei; brief ze skryptu, jeden agent na zadanie, brama przez code-verifier, commit przez scm-git, wiersz run-logu'
agent: orchestrator
---

# /implement

Wejście od człowieka: slug. Warunek: `/analyze` = GO. Wykonujesz krok 6 procedury orkiestratora dla
`docs/plans/<stempel>_<verb>-<slug>.md`, zadanie po zadaniu, potem krok C po każdym zadaniu.

Przypomnienie kolejności dla jednego zadania:

1. `npm run sdd -- next PLAN`.
2. `npm run sdd -- task PLAN <id> --status in-progress`.
3. `npm run sdd -- brief PLAN <id>`. Wyślij dosłownie do agenta z linii `AGENT:`.
4. Brief do `code-verifier` z komendą BRAMA.
5. `ok`: `npm run sdd -- task PLAN <id> --status done`, potem krok C (komunikat od `doc-intake`, commit
   przez `scm-git`, `--commit <sha7>`, wiersz run-logu).
6. `FAIL`: druga próba u tego samego agenta. Drugi `FAIL`: STOP.

Po ostatnim zadaniu: brief do `code-verifier` z `npm run verify:affected`. `ok`: krok 7 (`/review`).
