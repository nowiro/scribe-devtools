---
description: 'Specify: scaffold spec, planu i run-logu skryptem i wypełnienie spec treścią z intake, z [?] zamiast domysłów'
agent: orchestrator
---

# /specify

Wejście od człowieka: blok intake (verb, slug, cel, AC). Wykonujesz krok 2 procedury orkiestratora.

1. `npm run workflow:specify -- --verb=<verb> --slug=<slug> --title="<cel>"`. Powstają
   `docs/specs/<slug>/spec.md`, `docs/plans/<stempel>_<verb>-<slug>.md`, `docs/runs/<stempel>_<slug>.md`.
   Istniejący slug dostaje `-v2`.
2. Brief do `doc-spec`: wypełnij spec z bloku intake. Sekcje: Kontekst, User story, Kryteria akceptacji
   (zakładając / gdy / wtedy, bez technologii), Zakres i poza zakresem, Wejścia i kontrakty, Metryki sukcesu,
   Ryzyka, Pytania otwarte. Każda niepewność jako `[?]`.
3. `npm run sdd:check`.
4. `npm run sdd -- log RUN --step 1 --agent doc-spec --tier base --result "spec, [?]: <liczba>"`.
5. `[?]` większe od 0: `/clarify <slug>`. Równe 0: `/plan <slug>`.
