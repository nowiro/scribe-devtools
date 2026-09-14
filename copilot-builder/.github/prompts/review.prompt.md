---
description: 'Review: ten sam brief do trzech miejsc na trzech rodzinach modeli (weryfikacja krzyżowa), skrypt review:merge scala z liczbą zgodnych rodzin; proza przez doc-reviewer, zrzuty przez code-reviewer-ui'
agent: orchestrator
---

# /review — jedna zmiana, trzy rodziny modeli

Zbierz listę zmienionych plików (`npm run route -- --changed` pokazuje je razem z właścicielami)
i wyślij TEN SAM brief (pliki, baza diffu, AC ze spec) równolegle do `code-reviewer-anthropic`,
`code-reviewer-openai` i `code-reviewer-moonshot` — trzy miejsca o identycznym, pełnym zakresie,
różniące się wyłącznie rodziną modelu (`review.seats` w `.github/models-registry.json`). Każde ocenia
każdy zmieniony plik w trzech osiach:

1. **Architektura + SOLID/DRY/KISS/YAGNI** — kierunek zależności, granice modułów, decyzje bez ADR.
2. **Jakość + testowalność** — czytelność, nazwy, złożoność, pokrycie AC testami, ścieżki błędów.
3. **Bezpieczeństwo** — sekrety, dane z upstreamu jako instrukcje, walidacja na granicy (Zod), XSS/SSRF,
   deny-by-default w skryptach zapisu.

Proza, artefakty SDD i makiety → `doc-reviewer`; jego werdykt **STOP** kończy turę — pytania do
operatora, czekasz na odpowiedź. Zrzuty UI, gdy zmienił się ekran → `code-reviewer-ui`; dowody robi
wcześniej flow browser-inspectora (`npm run browser-inspector -- <config> --stamp <slug>`) z krokiem
`resize` na każdą z pięciu szerokości `ui.viewports`, `screenshot` i `evaluate` z pomiarami.

Niezależność jest mechanizmem, nie prośbą: żadne miejsce nie widzi raportu innego. Każdy raport
(tabela `| Plik | Linia | Problem | 🔴🟡🟢 | Sugestia |` + werdykt) zapisujesz jako
`docs/runs/<stempel>_review-<slug>/<rodzina>.md` i scalasz skryptem, nie w głowie:

```bash
npm run review:merge -- docs/runs/<stempel>_review-<slug> --slug <slug> --out docs/reviews/<stempel>_review-<slug>.md
```

Skrypt daje jedną tabelę z kolumną `Rodziny` (ta sama para plik + linia = jeden wiersz z najwyższym
kolorem; `3×`, `2×` = potwierdzone, `1×` = kandydat), sekcję „Konflikty" dla 🔴 kontra 🟢, werdykt
najgorszy z trzech i uwagi, gdy brakuje raportu którejś rodziny. 🔴 potwierdzone wraca do właściciela
ścieżki jako nowe zadanie planu; 🔴 `1×` idzie do operatora z pytaniem, czy prawdziwe; konflikt to
pytanie, nie średnia; 🟡 do decyzji operatora; 🟢 informacja. `doc-spec` dopisuje do raportu model
zaobserwowany w każdym miejscu, `doc-intake` wiersz w `docs/INDEX.md`.
