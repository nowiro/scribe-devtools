---
description: 'Plan: tabela zadań | id | title | agent | paths | done_when | status | AC | commit | z agentem wyznaczonym przez route dla paths, triadą testową i commitem per zadanie'
agent: orchestrator
---

# /plan — plan zadań ze spec

Wejście: spec `clarified` (`docs/specs/<slug>/spec.md`). Wyjście: wypełniona tabela w
`docs/plans/<stempel>_<verb>-<slug>.md` (`doc-spec`).

1. Jedno zadanie na obszar, nie jedno na wszystko: kolumnę `agent` wyznacza ŚCIEŻKA dotykanego pliku —
   `npm run route -- <ścieżki>` odpowiada z `tools/scripts/routing.config.mjs` (0 kredytów); „—" albo brak
   reguły to STOP-AND-ASK, nie zgadywanie właściciela. Te ścieżki wpisujesz w kolumnę `paths` — z niej
   `npm run sdd -- brief` buduje brief, a `npm run sdd:check` (C5) sprawdza, że `agent` równa się `route`.
2. Każde zadanie służy jakiemuś AC (traceability `plan.<verb>.<slug>` ↔ `spec.<slug>`); zadanie bez AC to
   YAGNI, AC bez zadania to dziura.
3. Triada testowa obowiązkowa przy zmianie zachowania: scenariusze z AC, unit (Vitest), e2e (Playwright,
   matryca viewportów) — trzy wiersze, nie jeden.
4. `done_when` jest komendą albo obserwowalnym stanem (`npm run affected -- test` zielone; plik istnieje),
   nie przymiotnikiem.
5. Zadania klasy ryzyka (auth, rozliczenia, migracja, współbieżność, dane osobowe) dostają wiersz review
   przez trzy miejsca `code-reviewer-anthropic` + `code-reviewer-openai` + `code-reviewer-moonshot` (main, trzy rodziny modeli)
   PRZED implementacją.
6. Nowa biblioteka/aplikacja w planie ma wiersz z komendą `npm run new:lib|new:app`, nigdy „utwórz ręcznie".
7. Kolumna `commit` startuje pusta (`—`); zadanie `done` dostaje SHA commita wykonanego przez `scm-git`
   (`/implement`) — plan jest listą zadań ze statusem i śladem w historii.

Sprawdź `npm run sdd:check` (kolumny tabeli, nazwy agentów z rosteru) i zapisz krok w run-logu.
Następny krok: `/analyze <slug>`.
