---
description: 'Checklist: brama jakości przed implementacją (wymagania, testy, kod, a11y, proces, DoD); ☑/☐ z opisem weryfikacji (tylko odczyt)'
agent: orchestrator
---

# /checklist

Wejście od człowieka: slug. Uruchamiasz po `/analyze`, przed `/implement`. Nic nie edytujesz.

Przejdź listę i przy każdym punkcie wpisz ☑ albo ☐, jak to sprawdziłeś i kto naprawia (agent):

1. **Wymagania**: każde AC testowalne i jednoznaczne; zero `[?]`; każde AC ma zadanie i test.
2. **Testy**: scenariusze z każdego AC (happy, edge, błąd); elementy interaktywne mają `data-testid`;
   defekt ma test czerwony przed poprawką.
3. **Kod**: standalone, sygnały, OnPush, natywny control flow, Signal Forms; alias `@cb/*` i kierunek zależności;
   tokeny CSS; mobile-first.
4. **A11y**: semantyczny HTML, landmarki, etykiety, widoczny focus, kontrast AA, brak poziomego scrolla.
5. **Proces**: nowa aplikacja lub biblioteka przez `npm run new:*`; nowa zależność ma wiersz w `pins.config.mjs`;
   decyzja nieodwracalna ma ADR.
6. **DoD**: `npm run verify` zielone, run-log z sekcją „Weryfikacja końcowa", review bez 🔴.

Zwrot: tabela `☑ / ☐ | pozycja | jak zweryfikować | właściciel`. Otwarty punkt krytyczny = `no-go`.
Wtedy wróć do `/clarify` albo do właściciela punktu, zanim powstanie kod.
