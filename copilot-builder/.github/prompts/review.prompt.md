---
description: 'Review: ten sam brief do miejsc wylosowanych z puli rodzin modeli (review:draw), scalanie skryptem (review:merge); proza przez doc-reviewer, zrzuty przez code-reviewer-ui'
agent: orchestrator
---

# /review

Wejście od człowieka: slug. Warunek: `npm run verify:affected` zielone. Wykonujesz krok 7 procedury
orkiestratora:

1. Przeczytaj `.github/skills/review-procedure/SKILL.md`. Wykonaj kroki 1–9 z sekcji „Review".
2. Zmienił się ekran: wykonaj sekcję „Przegląd wizualny".
3. Proza, artefakty SDD i makiety: brief do `doc-reviewer`.
4. Werdykt zapisz: `npm run sdd -- log RUN --step 8 --agent orchestrator --tier fast --result "<werdykt>"`.

Zasady, których nie zmieniasz: miejsca losuje skrypt, nie Ty. Żadne miejsce nie widzi cudzego raportu.
Raporty scala skrypt. Czytasz tylko plik scalony. Brak raportu wylosowanej rodziny: STOP, bez ponownego
losowania.
