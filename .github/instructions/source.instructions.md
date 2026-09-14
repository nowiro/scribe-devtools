---
applyTo: 'packages/**/src/**/*.mjs,packages/**/bin/**/*.mjs'
---

# Kod narzędzi (`packages/*/src`, `packages/*/bin`)

- Czysty ESM `.mjs`, bez kroku budowania; typy przez JSDoc (`tsc --checkJs --noEmit` jest bramką).
  Tylko wbudowane moduły Node ≥ 22 i, dla browser-inspectora, `playwright-core` (przypięty exact) —
  nx-angular-inspector ma celowo zero zależności runtime. Żadnej nowej zależności bez dopisania
  wiersza w `scripts/pins.config.mjs` (bramka `check-pins` wywali build bez tego).
- Komentarze po angielsku i mówią **dlaczego**, nie co; identyfikatory po angielsku; komunikaty dla
  użytkownika po polsku, jedna linia, prefiks `ok` / `FAIL`, ścieżka do pliku z całością odpowiedzi
  zamiast wypisywania jej wprost, gdy jest większa niż linia.
- Pełne nazwy narzędzi wszędzie: binarki, skrypty, zmienne środowiskowe, nazwy pipe'ów i plików —
  skróty w kodzie i komunikatach są zakazane.
- W browser-inspectorze klient (`bin/browser-inspector.mjs`, `src/client.mjs`, `src/cli.mjs`,
  `src/config.mjs`, `src/steps.schema.mjs`, `src/paths.mjs`, `src/print.mjs`) NIGDY nie importuje
  `playwright-core`
  ani modułów silnika (`engine.mjs`, `lanes.mjs`, `flow.mjs`, `session.mjs`, `steps.ctx.mjs`,
  `steps.run.mjs`) — to jest budżet startu klienta, bez testu na tej gałęzi pilnuj tego ręcznie
  przy review.
- Sekrety wyłącznie przez zmienne środowiskowe albo jawny parametr — nic nie loguje wartości
  wprost, redakcja przechodzi przez jedną funkcję, nie przez rozproszone `if`.
- Nieudany krok/komenda to wynik w raporcie albo jedna linia `FAIL` (exit 1), nie nieobsłużony
  wyjątek; błąd fatalny środowiska (brak zależności, zła wersja, zły workspace) to jasny komunikat,
  który mówi, co zrobić — nie stos wywołań.
