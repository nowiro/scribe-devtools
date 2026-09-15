---
description: 'Testy end-to-end Playwright w apps/*-e2e: ścieżki użytkownika po zbudowanej aplikacji'
applyTo: 'apps/*-e2e/**'
---

# Testy e2e (Playwright)

Właściciel: `code-tester-e2e`. Brama: `npm run affected -- build && npm run affected -- e2e`. Konfigurację
i test dymny tworzy `npm run new:app`. Serwer nad `dist/`: `tools/testing/serve-static.mjs`.

## Reguły

1. Scenariusz to ścieżka użytkownika. Pojedynczy komponent to test jednostkowy.
2. Lokatory w tej kolejności: `getByRole`, `getByLabel`, `getByTestId`, CSS. Brak dostępnej nazwy: zlecenie dla
   `code-angular`, nie selektor po klasie.
3. Asercje web-first (`toBeVisible`, `toHaveCount`). Bez `waitForTimeout`. Bez `networkidle`.
4. Test niezależny od kolejności i cudzego stanu (`fullyParallel`). Dane przez API albo fixture, nie przez UI.
5. Każdy nowy ekran na pięciu szerokościach z `ui.viewports` w `.github/models-registry.json`. Brak poziomego
   scrolla jest asercją.
6. Bez `.only` i `.skip`. `retries` tylko na CI. Flaky test naprawiasz, nie ukrywasz liczbą prób.
7. Nowy scenariusz najpierw sprawdź sesją `npm run browser-inspector -- open <url>` (`find`, `click eN`, `snap`),
   potem `export flow.json`. Do Playwright przepisz to, co ma zostać bramą.
