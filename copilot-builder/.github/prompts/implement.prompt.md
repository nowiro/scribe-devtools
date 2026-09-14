---
description: 'Implement: delegacja zadań planu po ścieżce pliku, jedno zlecenie na wykonawcę, bramy per zadanie, run-log po każdym kroku'
agent: orchestrator
---

# /implement — wykonanie planu

Warunek wejścia: `/analyze` = GO. Wykonujesz plan `docs/plans/<stempel>_<verb>-<slug>.md` zadanie po zadaniu.

1. Zlecenie do wykonawcy (kontrakt z `orchestrator`): cel, pliki w zakresie, AC, brama do zaliczenia,
   budżet. Bez historii rozmowy; szablon startowy, gdy obszar go ma (`new:app`, `new:lib`, wzorce
   z `.github/instructions/`).
2. Kolejność: scaffold skryptem → `code-angular` (kod) → `code-tester-unit` (spec) → `code-tester-e2e`
   → `code-verifier` (bramy). Zadania niezależne mogą iść równolegle, wyniki scalasz Ty.
3. Po każdym zadaniu: `status → done` w planie, wiersz w run-logu (agent, tier, artefakt, wynik bramy),
   komunikat od `doc-intake` i commit przez `scm-git` (tylko pliki zadania) — SHA do kolumny `commit`.
   Jedno zadanie = jeden commit; zadanie bez SHA nie jest `done`.
4. Ta sama brama czerwona dwa razy u tego samego wykonawcy → STOP z listą pytań, nie trzecia próba;
   STOP kończy turę — czekasz na odpowiedź operatora.
5. Rozjazd planu z kodem → wygrywa plan; rozbieżność zapisujesz w planie i pytasz.
6. Kod produkcyjny nie powstaje bez testu w tym samym zadaniu albo w zadaniu sparowanym.

Wyjście po ostatnim zadaniu: `npm run verify:affected` zielone i przekazanie do `/review`.
