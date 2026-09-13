---
description: 'Testy end-to-end Playwright w apps/*-e2e: ścieżki użytkownika po zbudowanej aplikacji'
applyTo: 'apps/*-e2e/**'
---

# Testy e2e (Playwright)

Właściciel: `code-tester-e2e`. Brama: `npm run affected -- build && npm run affected -- e2e`. Konfigurację
i test dymny generuje `npm run new:app`; serwer statyczny nad `dist/` to `tools/testing/serve-static.mjs`.

- Scenariusz to ŚCIEŻKA UŻYTKOWNIKA, nie pojedynczy komponent — to należy do testu jednostkowego i jest tam
  o rząd wielkości tańsze.
- Lokatory: `getByRole` > `getByLabel` > `getByTestId` > CSS. Brak dostępnej nazwy to zlecenie dla
  `code-angular`, nie powód do selektora po klasie.
- Web-first assertions (`toBeVisible`, `toHaveCount`); zero `waitForTimeout`, zero `networkidle`.
- Test niezależny od kolejności i cudzego stanu (`fullyParallel`); dane przez API/fixture, nie przez UI.
- Matryca viewportów z `.github/models-registry.json` (`ui.viewports`) na każdym nowym ekranie; brak
  poziomego scrolla jest asercją.
- Zero `.only` / `.skip` w commicie; `retries` tylko na CI. Flaky test to usterka do naprawy, nie do
  ukrycia liczbą prób.
- Scenariusz najpierw eksploruj sesją `npm run browser-inspector -- open <url>` (`find`, `click eN`,
  `snap`), potem `export flow.json`; do Playwright przepisujesz to, co ma zostać bramą.
