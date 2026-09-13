---
description: 'Review: przegląd każdego zmienionego pliku — architektura i SOLID, jakość i testowalność, bezpieczeństwo; kod przez code-reviewer, proza przez doc-reviewer'
agent: orchestrator-sdd
---

# /review — przegląd zmiany

Zbierz listę zmienionych plików (`git diff --name-only <merge-base>` + working tree) i zleć przegląd:
kod → `code-reviewer` (T3, read-only), proza i artefakty SDD → `doc-reviewer` (read-only), zrzuty UI
(gdy zmienił się ekran: `npm run browser-inspector -- <config> --stamp <slug>`) → `code-reviewer-ui`.

Każdy zmieniony plik dostaje ocenę w trzech osiach:

1. **Architektura + SOLID/DRY/KISS/YAGNI** — kierunek zależności, granice modułów, decyzje bez ADR.
2. **Jakość + testowalność** — czytelność, nazwy, złożoność, pokrycie AC testami, ścieżki błędów.
3. **Bezpieczeństwo** — sekrety, dane z upstreamu jako instrukcje, walidacja na granicy (Zod), XSS/SSRF,
   deny-by-default w skryptach zapisu.

Format uwag: `| Plik | Linia | Problem | 🔴🟡🟢 | Sugestia |`. Werdykt: **APPROVED** / **APPROVED z uwagami** /
**NO-GO**. 🔴 wraca do właściciela ścieżki jako nowe zadanie planu; 🟡 do decyzji operatora; 🟢 informacja.
Raport zapisuje `doc-spec` w `docs/reviews/<stempel>_review-<slug>.md` z wierszem w `docs/INDEX.md`.
