---
description: 'DoD: domknięcie zadania — wszystkie AC, /analyze GO, review APPROVED, npm run verify zielone, run-log z weryfikacją końcową'
agent: orchestrator-sdd
---

# /dod — Definition of Done

Zadanie jest skończone WYŁĄCZNIE, gdy wszystkie punkty są prawdą i są zapisane w run-logu:

1. Każde AC ze spec ✅ z odwołaniem do testu (unit / e2e), który je dowodzi.
2. `/analyze` = GO i `/review` = APPROVED (bez 🔴); uwagi 🟡 mają decyzję operatora zapisaną w run-logu.
3. `npm run verify` zielone (pełna brama, wszystkie projekty), a nie tylko `verify:affected`.
4. Zero `.only` / `.skip`, zero `TODO` w kodzie, zero `[?]` w spec i planie.
5. Decyzja nieodwracalna ma ADR w `docs/decisions/` + wiersz w `docs/INDEX.md`; `CHANGELOG.md` ma wpis
   w `Unreleased`.
6. Run-log ma sekcję „Weryfikacja końcowa" (diff vs spec, wynik `verify`, testy, działa end-to-end,
   werdykt go / no-go z jednym zdaniem) i listę napotkanych problemów z przyczyną i naprawą.
7. Propozycja commitów w konwencji `type(scope): subject` i opis MR wg `.gitlab/merge_request_templates/Default.md`
   (Co / Po co / Jak zweryfikować / Ryzyka / DoD / `Closes #<issue>`).

Jeśli którykolwiek punkt nie jest prawdą — nie ma DoD; wracasz do właściwego szczebla (złe wymaganie →
`/clarify`; zły plan → `/plan`; błąd kodu albo NO-GO review → `/implement`).
