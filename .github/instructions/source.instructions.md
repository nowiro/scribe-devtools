---
applyTo: 'packages/**/src/**/*.mjs,packages/**/bin/**/*.mjs'
---

# Kod narzędzia (`packages/browser-inspector/src`, `bin`)

- Czysty ESM `.mjs`, bez kroku budowania; typy przez JSDoc (`tsc --checkJs --noEmit` jest bramką).
  Tylko wbudowane moduły Node ≥ 22 i `playwright-core` (przypięty exact) — żadnej nowej zależności.
- Komentarze po angielsku i mówią **dlaczego**, nie co; identyfikatory po angielsku; komunikaty dla
  użytkownika po polsku, jedna linia ≤ 160 znaków, prefiks `ok` / `FAIL`.
- Klient (`bin/browser-inspector.mjs`, `src/client.mjs`, `src/cli.mjs`, `src/steps.schema.mjs`,
  `src/paths.mjs`, `src/print.mjs`) NIGDY nie importuje `playwright-core`, modułów silnika
  (`engine.mjs`, `lanes.mjs`, `flow.mjs`, `session.mjs`, `steps.ctx.mjs`) ani
  `steps.run.mjs` — budżet startu klienta pilnuje test `client-imports`.
- Pełna nazwa **browser-inspector** wszędzie: binarka, skrypty, zmienne `BROWSER_INSPECTOR_*`, nazwy
  pipe'a i plików keepera, teksty pomocy. Skrót `bi` jest zakazany.
- Sekrety wyłącznie przez `valueFromEnv` / `--env` / `@{NAZWA}`; wartość rozwiązuje klient, keeper
  redaguje ją jedną funkcją `redact()`; nic nie loguje wartości. Krok `run --file` tylko pod
  `BROWSER_INSPECTOR_UNSAFE=1` i tylko w sesji.
- Nieudany krok flow to wynik w raporcie (exit 0), nie wyjątek; błąd fatalny (config, przeglądarka,
  brak zmiennej) to exit 2 z komunikatem, który mówi, co zrobić.
- Domyślnie nigdy `networkidle` (jest `settled`), zrzuty przez CDP, jedna reużywana karta
  szorowana `scrubPlan`/`applyScrub` między przebiegami — DESIGN.md §2–§6 jest kontraktem; zmiana
  kontraktu to najpierw zmiana DESIGN.md.
- Każdy nowy krok to komplet: wpis w `STEPS` (`steps.schema.mjs`), runner w `steps.run.mjs`, test
  z `FakePage` i regeneracja `docs/STEPS.md` (`npm run docs`).
