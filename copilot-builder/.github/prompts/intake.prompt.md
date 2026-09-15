---
description: 'Intake zgłoszenia: klasyfikacja (verb, slug), kompletność AC, lista [?]; start drabiny SDD'
agent: orchestrator
---

# /intake

Wejście od człowieka: tekst zgłoszenia, iid issue GitLaba albo klucz zadania Jiry. Wykonujesz krok 1 procedury
orkiestratora.

1. Issue GitLaba: `npm run alm:read -- gitlab`, potem plik `.alm/gitlab/<stempel>/…/issue-<iid>.md`.
   Zadanie Jiry: `npm run alm:read -- jira`, potem plik zadania. Prompt człowieka: bierzesz tekst wprost.
2. Brief do `doc-intake` z treścią albo ścieżką pliku. Dostajesz blok intake.
3. Blok ma sekcję STOP: krok S. Zakończ turę.
4. Blok bez STOP: podaj człowiekowi blok i komendę
   `npm run workflow:specify -- --verb=<verb> --slug=<slug> --title="<cel>"`. Przejdź do kroku 2.
5. Zmiana jednego pliku bez zmiany zachowania: powiedz to wprost i idź ścieżką bezpośrednią (krok 0).
