---
description: 'Clarify: wszystkie [?] ze spec jako jedna lista pytań z opcjami i rekomendacją; po odpowiedziach status draft → clarified'
agent: orchestrator
---

# /clarify

Wejście od człowieka: slug. Wykonujesz krok 3 procedury orkiestratora.

1. Przeczytaj `docs/specs/<slug>/spec.md`. Zbierz wszystkie `[?]`.
2. Jedna tabela: `| # | Pytanie | Opcje | Rekomendacja + dlaczego | Wpływ (zakres / koszt / bezpieczeństwo) |`.
   Każde pytanie ma opcje i rekomendację. Człowiek wybiera, nie projektuje.
3. STOP. Zakończ turę.
4. Po odpowiedzi: brief do `doc-spec`: nanieś odpowiedzi, usuń `[?]`, zmień `status: draft` na `clarified`.
5. `npm run sdd:check`. `npm run sdd -- log RUN --step 2 --agent orchestrator --tier fast --result "clarified"`.
6. Odpowiedź sprzeczna z AC albo z ADR: nie nanosisz. STOP z tym jednym pytaniem.
