---
description: 'Dokumentacja i artefakty SDD: proza po polsku, fakty zamiast ozdobników, nazwy ze stemplem, indeks'
applyTo: 'docs/**/*.md,README.md,AGENTS.md,GLOSSARY.md,CHANGELOG.md'
---

# Dokumentacja

Właściciel prozy procesu (spec, plan, run-log, ADR, review): `doc-spec`. Streszczenia, wiersze `docs/INDEX.md`
i komunikaty commitów: `doc-intake`. Przegląd: `doc-reviewer`. Brama: `npm run sdd:check`, `npm run check:glossary`,
`npm run stack:check`.

## Reguły

1. Proza po polsku. Zdanie niesie fakt albo powód. Inne zdania kasujesz.
2. Identyfikatory, ścieżki i komendy po angielsku, w backtickach.
3. Wersji narzędzi nie wpisujesz w prozę. Stoją tylko w bloku AUTOGEN w `docs/tech-stack.md` (`npm run stack:sync`).
4. Nazw modeli nie wpisujesz nigdzie poza `.github/models-registry.json`. Piszesz tier.
5. Plik w `docs/decisions/` albo `docs/reviews/` nazywa się `YYYY-MM-DD_HH-MM_<slug>.md` (stempel
   z `npm run stamp`) i ma wiersz w `docs/INDEX.md`.
6. `docs/specs/`, `docs/plans/`, `docs/runs/` są lokalne i gitignorowane. Nie linkujesz ich z dokumentów
   commitowanych jako źródła prawdy.
7. ADR ma sekcje: Kontekst, Decyzja, Odrzucone alternatywy (z powodem), Konsekwencje. ADR nie kasujesz:
   `status: superseded` i pole `superseded_by`.
8. `CODE-INDEX.md` jest generowany. Nie edytujesz go. W `GLOSSARY.md` każdy odnośnik w kolumnie
   „gdzie w kodzie" musi istnieć.
9. Bloki `INSTRUCTION:<narzędzie>:START/END` w `AGENTS.md` i w `.github/copilot-instructions.md` są identyczne,
   każdy do 600 bajtów.
10. Diagram: blok ```mermaid według skilla `.github/skills/mermaid-diagrams/SKILL.md`. Diagram opisujący kod
    zmienia się razem z kodem.
11. Dłuższy dokument kończy sekcja „Powiązane" z dwoma, trzema odnośnikami.
