---
description: 'ADR: zapis decyzji, której nie cofa się bez śladu (kontekst, decyzja, odrzucone alternatywy, konsekwencje); nazwa ze stemplem i wiersz w docs/INDEX.md'
agent: orchestrator
---

# /adr

Wejście od człowieka: decyzja do zapisania. ADR piszesz dla wyboru, który zamyka drogę odwrotu (biblioteka,
format danych, kontrakt, proces), dla odstępstwa od istniejącego ADR i dla zmiany zasady
z `.github/copilot-instructions.md`.

1. `npm run stamp`.
2. Brief do `doc-spec`: napisz `docs/decisions/<stempel>_adr-<slug>.md` z front matterem (`type: decision`,
   `id: adr.<slug>`, `status: accepted`, `date`, `stamp`, `title`) i sekcjami: Kontekst, Decyzja (jedno zdanie
   wytłuszczone, potem szczegóły), Odrzucone alternatywy (tabela z powodem), Konsekwencje (co się zmienia
   i która brama tego pilnuje).
3. Nowy ADR zastępuje starszy: w starszym `status: superseded` i pole `superseded_by`. ADR nie kasujesz.
4. Brief do `doc-intake`: wiersz do `docs/INDEX.md`. Brief do `doc-spec`: wpisz ten wiersz.
5. `npm run sdd:check`.
6. Decyzja zmienia zasadę z `.github/copilot-instructions.md`: brief do `doc-spec` na zmianę tej zasady
   w tym samym zadaniu.
