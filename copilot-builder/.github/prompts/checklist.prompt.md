---
description: 'Checklist: brama jakości PRZED implementacją — wymagania, testy, kod, a11y, DoD — ☑/☐ z opisem weryfikacji (tylko odczyt)'
agent: orchestrator
---

# /checklist — „czy budujemy na najwyższej jakości" (read-only, po /analyze)

Wygeneruj checklistę dla sluga z AC spec + twardych zasad repozytorium i przejdź ją. NIC nie edytuj.

1. **Wymagania** — każde AC testowalne i jednoznaczne; zero `[?]`; macierz AC ↔ zadanie ↔ test domknięta.
2. **Testy** — scenariusze z każdego AC (happy + edge + błąd); elementy interaktywne mają `data-testid`;
   dla defektów: failing test PRZED fixem.
3. **Kod** — standalone + sygnały + OnPush + natywny control flow + Signal Forms; alias `@cb/*` i kierunek
   zależności; tokeny CSS zamiast wartości; mobile-first (`min-width`, skala viewportów).
4. **A11y** — semantyczny HTML, landmarki, etykiety, widoczny focus, kontrast AA, brak poziomego scrolla.
5. **Proces** — nowa aplikacja/biblioteka przez `npm run new:*`; nowa zależność ma wiersz w `pins.config.mjs`;
   decyzja nieodwracalna ma ADR.
6. **DoD** — `npm run verify` zielone, run-log z sekcją „Weryfikacja końcowa", review bez 🔴.

Format: `☑ / ☐ | pozycja | jak zweryfikować | właściciel (agent)`. Dowolna niedomknięta pozycja
krytyczna = **no-go** (powrót do `/clarify` albo do specjalisty) zanim powstanie kod.
