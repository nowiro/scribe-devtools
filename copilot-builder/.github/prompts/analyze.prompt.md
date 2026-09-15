---
description: 'Analyze: spójność spec, planu i repozytorium przed implementacją; GO albo NO-GO z blockerami (tylko odczyt)'
agent: orchestrator
---

# /analyze

Wejście od człowieka: slug. Wykonujesz krok 5 procedury orkiestratora. Nic nie edytujesz.

Sprawdź po kolei:

1. Każde AC ma zadanie w planie. Każde zadanie planu służy jakiemuś AC.
2. Kolumna `agent` każdego zadania równa się wynikowi `npm run route -- <paths>`.
3. Plan zgodny z każdym ADR w `docs/decisions/` (poza `status: superseded`) i z `docs/tech-stack.md`.
4. Zmienia się ekran: plan ma matrycę viewportów, mobile-first, a11y, stany loading / empty / error, `data-testid`.
5. Nowa zależność między bibliotekami zgodna z kierunkiem feature → ui, data-access, util. Nowa biblioteka ma typ w nazwie.
6. Zero `[?]` w spec i w planie.
7. `npm run sdd:check` i `npm run ai:validate` zielone.

Zwrot: `GO` albo `NO-GO` z listą blockerów `plik / linia / dlaczego / kto naprawia`.
Wynik zapisz: `npm run sdd -- log RUN --step 4 --agent orchestrator --tier fast --result "<GO|NO-GO>"`.
