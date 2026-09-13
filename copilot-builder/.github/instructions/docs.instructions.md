---
description: 'Dokumentacja i artefakty SDD: proza po polsku, fakty zamiast ozdobników, nazwy ze stemplem, indeks'
applyTo: 'docs/**/*.md,README.md,AGENTS.md,GLOSSARY.md,CHANGELOG.md'
---

# Dokumentacja

Właściciele: proza procesu (spec, plan, run-log, ADR, review) — `doc-spec`; streszczenia, wiersze
`docs/INDEX.md`, commit message — `doc-intake`; przegląd — `doc-reviewer`. Brama: `npm run sdd:check`,
`npm run check:glossary`, `npm run stack:check`.

- Proza po polsku, bez ozdobników: zdanie niesie fakt albo powód, inaczej nie ma go w dokumencie.
  Identyfikatory, ścieżki, komendy po angielsku, w backtickach.
- Wersje narzędzi NIE stoją w prozie — jedyne miejsce to blok AUTOGEN w `docs/tech-stack.md`
  (`npm run stack:sync`). Nazwy modeli NIE stoją nigdzie poza `.github/models-registry.json` (tiery).
- Artefakty commitowane (`docs/decisions/`, `docs/reviews/`) mają nazwę `YYYY-MM-DD_HH-MM_<slug>.md`
  ze stemplem z realnego zegara i wiersz w `docs/INDEX.md`. Artefakty lokalne (`docs/specs/`,
  `docs/plans/`, `docs/runs/`) są gitignorowane — nie linkuj ich z dokumentów commitowanych jako źródła prawdy.
- ADR ma sekcje: Kontekst, Decyzja, Odrzucone alternatywy (z powodem), Konsekwencje. Decyzji się nie
  kasuje — status `superseded` i wskazanie następcy.
- `CODE-INDEX.md` jest generowany (`npm run code-index`) — nie edytuj ręcznie. `GLOSSARY.md` mapuje
  słowa na identyfikatory; każdy odnośnik w kolumnie „gdzie w kodzie" musi istnieć (brama).
- Bloki `INSTRUCTION:<narzędzie>:START/END` w `AGENTS.md` ≡ kopie w `.github/copilot-instructions.md`
  (limit 600 bajtów na blok) — `npm run check:instructions`.
- Sekcja „Powiązane" na końcu dłuższego dokumentu — dwa, trzy odnośniki, żeby dokument miał wyjście.
