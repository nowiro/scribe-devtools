---
description: 'Plan: tabela zadań | id | title | agent | paths | done_when | status | AC | commit | z agentem z route, zadaniem testowym per AC i commitem per zadanie'
agent: orchestrator
---

# /plan

Wejście od człowieka: slug. Warunek: spec `clarified`. Wykonujesz krok 4 procedury orkiestratora.

1. Wypisz ścieżki plików, które zmieni zadanie. `npm run route -- <ścieżki>`. Linia `—`: STOP.
2. Brief do `doc-spec` z wynikiem `route`: wypełnij tabelę zadań w `docs/plans/<stempel>_<verb>-<slug>.md`.
   Zasady dla tabeli:
   - jedno zadanie na agenta z wyniku `route`; `paths` = jego ścieżki; `agent` = jego nazwa;
   - każde zadanie służy jakiemuś AC; każde AC ma zadanie testowe (`code-tester-unit`; zmiana ekranu: także
     `code-tester-e2e`);
   - `done_when` to komenda albo obserwowalny stan, np. `npm run affected -- test zielone`;
   - nowa aplikacja lub biblioteka: wiersz z komendą `npm run new:app` / `new:lib`;
   - kolumna `commit` = `—`.
3. Klasa ryzyka inna niż „brak": `npm run review:draw -- docs/runs/<stempel>_review-<slug>-pre`. Zadanie
   „review przed implementacją" z kolumną `agent` = agenci z wyniku połączeni ` + `.
4. `npm run sdd:check`. `npm run sdd -- log RUN --step 3 --agent doc-spec --tier base --result "plan"`.
5. Następny krok: `/analyze <slug>`.
