---
description: 'DoD: domknięcie zadania; wszystkie AC, analyze GO, review APPROVED, npm run verify zielone, run-log z weryfikacją końcową'
agent: orchestrator
---

# /dod

Wejście od człowieka: slug. Wykonujesz krok 9 procedury orkiestratora. Zadanie jest skończone tylko wtedy,
gdy każdy punkt jest prawdą i stoi w run-logu:

1. Każde AC ze spec ma ✅ i nazwę testu (unit albo e2e), który je dowodzi.
2. `/analyze` = GO. Review = APPROVED (bez 🔴). Każde 🟡 ma decyzję człowieka w run-logu.
3. `npm run verify` zielone (pełne, nie `verify:affected`).
4. Zero `.only`, `.skip` i `TODO` w kodzie. Zero `[?]` w spec i planie.
5. Decyzja nieodwracalna ma ADR w `docs/decisions/` i wiersz w `docs/INDEX.md`. `CHANGELOG.md` ma wpis w `Unreleased`.
6. Run-log ma sekcję „Weryfikacja końcowa" (diff vs spec, wynik `verify`, testy, działa end-to-end, werdykt
   go / no-go z jednym zdaniem) i tabelę problemów z przyczyną i naprawą.
7. Każde zadanie planu ma SHA w kolumnie `commit`. Opis MR według `.gitlab/merge_request_templates/Default.md`
   jest gotowy. Push robi człowiek.

Punkt nie jest prawdą: nie ma DoD. Wróć do właściwego kroku: złe wymaganie → krok 3, zły plan → krok 4,
błąd kodu albo NO-GO review → krok 6.
