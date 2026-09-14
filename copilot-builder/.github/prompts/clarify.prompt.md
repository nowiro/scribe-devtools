---
description: 'Clarify: zbierz wszystkie [?] ze spec jako JEDNĄ listę pytań z opcjami i rekomendacją; po odpowiedziach status draft → clarified'
agent: orchestrator
---

# /clarify — domknięcie znaczników `[?]`

Zbierz WSZYSTKIE `[?]` z `docs/specs/<slug>/spec.md` i zadaj operatorowi jako jedną skonsolidowaną
listę (nie serię pojedynczych pytań):

| # | Pytanie | Opcje | Rekomendacja + dlaczego | Wpływ (zakres / koszt / bezpieczeństwo) |

Zasady: każde pytanie domknięte opcjami, gdzie się da; zawsze z rekomendacją — operator wybiera, nie
projektuje. Pytanie bez proponowanej odpowiedzi i bez ceny jest odrzucane.

Po odpowiedziach (`doc-spec`): nanieś decyzje w spec (usuń `[?]`), zmień `status: draft → clarified`,
wypisz różnice, dopisz krok w run-logu. Konflikt odpowiedzi z istniejącym AC albo ADR → nie nanoś,
zgłoś STOP. `npm run sdd:check` musi być zielony (spec `clarified` nie ma `[?]`).
