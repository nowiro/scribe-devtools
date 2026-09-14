---
description: 'Specify: scaffold spec/plan/run-log skryptem (0 kredytów) i wypełnienie spec treścią z intake, z [?] zamiast domysłów'
agent: orchestrator
---

# /specify — spec z intake

1. Uruchom scaffold (deterministyczny, 0 kredytów):
   `npm run workflow:specify -- --verb=<verb> --slug=<slug> --title="<tytuł>"` — powstają
   `docs/specs/<slug>/spec.md`, `docs/plans/<stempel>_<verb>-<slug>.md`, `docs/runs/<stempel>_<slug>.md`
   (lokalne, gitignorowane). Istniejący slug dostaje `-v2`.
2. Zleć `doc-spec` wypełnienie spec z bloku intake: Kontekst, User story, Kryteria akceptacji
   (zakładając / gdy / wtedy, mierzalne, bez technologii), Wejścia i kontrakty, Metryki sukcesu,
   Non-goals, Pytania otwarte. Każda niepewność = `[?]`, nie założenie.
3. Sprawdź `npm run sdd:check` (front matter, `id: spec.<slug>`, `status: draft`).
4. Zapisz krok „specify" w run-logu.

Wyjście: ścieżki trzech artefaktów, liczba `[?]` i następny krok: `/clarify <slug>`. Spec bez `[?]`
przechodzi od razu do `/plan`.
