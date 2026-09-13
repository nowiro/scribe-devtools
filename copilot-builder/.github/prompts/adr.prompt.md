---
description: 'ADR: zapis decyzji architektonicznej (kontekst, decyzja, odrzucone alternatywy, konsekwencje) z nazwą ze stemplem i wierszem w docs/INDEX.md'
agent: orchestrator-sdd
---

# /adr — decyzja, której się nie cofa bez śladu

Powód ADR-u: wybór zamykający drogę odwrotu (biblioteka, format danych, kształt kontraktu, proces),
odstępstwo od istniejącego ADR-u albo zmiana niezmiennika z `copilot-instructions.md`.

1. Stempel z realnego zegara: `node -e "import('./tools/scripts/stamp.mjs').then(m=>console.log(m.nowStamp()))"`.
2. `doc-spec` pisze `docs/decisions/<stempel>_adr-<slug>.md` z front matterem
   (`type: decision`, `id: adr.<slug>`, `status: accepted`, `date`) i sekcjami: **Kontekst** (co wymusza decyzję),
   **Decyzja** (jedno zdanie wytłuszczone, potem szczegóły), **Odrzucone alternatywy** (tabela z powodem),
   **Konsekwencje** (co się zmienia w repozytorium, kto pilnuje — brama, jeśli istnieje).
3. Decyzji się nie kasuje: zastępowany ADR dostaje `status: superseded` i pole `superseded_by`.
4. `doc-intake` dopisuje wiersz w `docs/INDEX.md`; `npm run sdd:check` zielony.
5. Jeśli decyzja zmienia niezmiennik — zmiana w `.github/copilot-instructions.md` w tym samym MR.
