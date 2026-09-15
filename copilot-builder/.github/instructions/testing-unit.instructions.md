---
description: 'Testy jednostkowe Vitest: co testować w aplikacji na sygnałach, forma, ścieżka błędu'
applyTo: '**/*.spec.ts,**/*.spec.mjs'
---

# Testy jednostkowe

Właściciel: `code-tester-unit`. Runner: Vitest. W aplikacjach i bibliotekach przez `@angular/build:unit-test`
(`npm run affected -- test`, progi pokrycia w `tools/testing/vitest-angular.config.mts`). Dla narzędzi przez
`vitest.tools.config.mts` (`npm test`).

## Co testujesz

1. Logikę z regułami: obliczenia, filtrowanie, sortowanie, odmiana liczebników, schematy Signal Forms.
2. Granice: parsowanie odpowiedzi (Zod), mapowanie kontrakt → domena, obsługa błędu 4xx i 5xx.
3. Zachowanie, nie strukturę DOM: po kliknięciu poszła akcja, nie „przycisk ma klasę".

## Czego nie testujesz

Szablonów bez logiki, wartości przepisanych z wejścia na wyjście, stylów.

## Reguły

1. Nazwa testu to zdanie po polsku, które mówi, co ma być prawdą.
2. Przypadki brzegowe wprost: 0, 1, 2, 12, 22 dla liczebników; pusty, jednoelementowy, pełny dla list.
3. Dane w teście jawne. Bez współdzielonego fabrykatora.
4. Ścieżka błędu obok ścieżki sukcesu.
5. `TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] })`. Po akcji
   `await fixture.whenStable()`. Dla store'ów bez komponentu `await Promise.resolve(); TestBed.tick();`.
6. Bez `sleep` i `waitForTimeout`. Bez `.only` i `.skip`. `http.verify()` tam, gdzie twierdzisz, że żądań nie ma.
7. Defekt naprawiasz od testu czerwonego. Test zostaje na stałe.
