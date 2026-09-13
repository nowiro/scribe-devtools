---
description: 'Plan: tabela zadań | id | title | agent | done_when | status | z agentem wyznaczonym po ŚCIEŻCE pliku i triadą testową'
agent: orchestrator-sdd
---

# /plan — plan zadań ze spec

Wejście: spec `clarified` (`docs/specs/<slug>/spec.md`). Wyjście: wypełniona tabela w
`docs/plans/<stempel>_<verb>-<slug>.md` (`doc-spec`).

1. Jedno zadanie na obszar, nie jedno na wszystko: kolumnę `agent` wyznacza ŚCIEŻKA dotykanego pliku
   (tabela routingu `orchestrator-sdd`) — `code-angular` dla `apps/**`, `libs/**`; `code-tester-unit`
   dla `*.spec.ts`; `code-tester-e2e` dla `apps/*-e2e/**`; `code-tooling` dla `tools/**` i konfiguracji;
   `doc-spec` dla `docs/**`.
2. Każde zadanie służy jakiemuś AC (traceability `plan.<verb>.<slug>` ↔ `spec.<slug>`); zadanie bez AC to
   YAGNI, AC bez zadania to dziura.
3. Triada testowa obowiązkowa przy zmianie zachowania: scenariusze z AC, unit (Vitest), e2e (Playwright,
   matryca viewportów) — trzy wiersze, nie jeden.
4. `done_when` jest komendą albo obserwowalnym stanem (`npm run affected -- test` zielone; plik istnieje),
   nie przymiotnikiem.
5. Zadania klasy ryzyka (auth, rozliczenia, migracja, współbieżność, dane osobowe) dostają wiersz
   `code-reviewer` (T3) PRZED implementacją.
6. Nowa biblioteka/aplikacja w planie ma wiersz z komendą `npm run new:lib|new:app`, nigdy „utwórz ręcznie".

Sprawdź `npm run sdd:check` (kolumny tabeli, nazwy agentów z rosteru) i zapisz krok w run-logu.
Następny krok: `/analyze <slug>`.
