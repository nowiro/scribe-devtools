---
description: 'Testy jednostkowe Vitest: co testować w aplikacji na sygnałach, forma, ścieżka błędu'
applyTo: '**/*.spec.ts,**/*.spec.mjs'
---

# Testy jednostkowe

Właściciel: `code-tester-unit`. Runner: Vitest — w aplikacjach i bibliotekach przez
`@angular/build:unit-test` (`npm run affected -- test`, progi pokrycia w `tools/testing/vitest-angular.config.mts`),
dla narzędzi przez `vitest.tools.config.mts` (`npm test`).

## Co testujemy

1. **Logikę, która ma reguły** — obliczenia, filtrowanie, sortowanie, odmiana liczebników, schematy Signal Forms.
2. **Granice** — parsowanie odpowiedzi (Zod), mapowanie kontrakt → domena, obsługa błędu 4xx/5xx.
3. **Zachowania, nie strukturę DOM** — test sprawdza, że po kliknięciu poszła akcja, nie że przycisk ma klasę.

## Czego nie testujemy

Szablonów bez logiki, wartości przekazanych wprost z wejścia na wyjście, stylów.

## Forma

- Nazwa testu jest zdaniem po polsku mówiącym, co ma być prawdą.
- Przypadki brzegowe wprost: 0, 1, 2, 12, 22 dla liczebników; pusty, jednoelementowy, pełny dla list.
- Dane w teście jawne — współdzielony fabrykator ukrywa to, co test bada.
- Ścieżka błędu obok ścieżki sukcesu (to ona wykrywa `value()` bez `hasValue()`).
- `TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] })`;
  po akcji `await fixture.whenStable()`; dla store'ów bez komponentu `await Promise.resolve(); TestBed.tick();`.
- Zero `sleep` / `waitForTimeout`; zero `.only` / `.skip` w commicie; `http.verify()` tam, gdzie
  twierdzisz, że żądań nie ma.
- Defekt naprawia się od testu czerwonego (repro-first); test zostaje na stałe.
