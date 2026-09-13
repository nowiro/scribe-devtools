---
description: 'Reguły kodu Angular 22 w aplikacjach i bibliotekach: sygnały, standalone, OnPush, Signal Forms, granice modułów'
applyTo: 'apps/**/*.ts,libs/**/*.ts'
---

# Kod Angulara (`apps/**`, `libs/**`)

Właściciel: `code-angular`. Brama: `npm run affected -- lint`, `npm run affected -- typecheck`,
`npm run affected -- test`, `npm run affected -- build`. `applyTo` obejmuje też `*.spec.ts` i `apps/*-e2e/**`
(glob nie zna negacji) — tam pierwszeństwo mają `testing-unit` i `testing-e2e`; poniższe zdania dotyczą
kodu produkcyjnego.

## Zdania normatywne

1. Komponent jest standalone; `NgModule` nie powstaje. <!-- N-001 -->
2. Komponent ma `changeDetection: ChangeDetectionStrategy.OnPush`. <!-- N-002 -->
3. Wstrzykiwanie przez `inject()`; konstruktor pusty albo wyłącznie z efektami. Pola `readonly`. <!-- N-003 -->
4. Wejścia i wyjścia to `input()` / `input.required()` / `output()` / `model()`, nie dekoratory. <!-- N-004 -->
5. Stan współdzielony między szablonem a klasą jest sygnałem (`signal`, `computed`, `linkedSignal`);
   dane asynchroniczne przez `resource()` / `httpResource()`. Ręczna subskrypcja tylko tam, gdzie
   źródłem jest strumień zdarzeń (SSE, zdarzenia DOM). <!-- N-005 -->
6. Odczyt wartości zasobu jest poprzedzony sprawdzeniem — `@if (res.hasValue())` / `res.value()` po
   `hasValue()`, nigdy `res.value()!`. <!-- N-006 -->
7. Magazynem stanu jest klasa `@Injectable` z sygnałami. NgRx, `BehaviorSubject` jako store i `Subject`
   jako szyna zdarzeń są usterką. <!-- N-007 -->
8. Formularze budują `form(model, schema)` z `@angular/forms/signals`, wiązanie `[formField]`,
   walidacja w schemacie (`required`, `validate`, `validateTree`, `applyEach`, `validateStandardSchema` z Zod).
   `FormGroup`, `FormControl`, `ngModel` nie występują w nowym kodzie. <!-- N-008 -->
9. Zero `any` i zero `as` na granicy danych: parsuj (Zod), nie rzutuj. Publiczne API biblioteki jest
   otypowane. <!-- N-009 -->
10. Aplikacja jest zoneless (domyślne od v21): nic nie polega na `NgZone`; zmiana stanu poza sygnałem
    i zdarzeniem szablonu musi przejść przez sygnał albo `markForCheck()`. <!-- N-010 -->
11. Import bibliotek wyłącznie przez alias `@cb/<zakres>/<typ>[-<nazwa>]`; kierunek zależności
    feature → ui, data-access, util · ui → ui, util · data-access → data-access, util · util → util.
    Nikt nie importuje `src/` innego projektu. Pilnuje `eslint.rules.mjs`. <!-- N-011 -->
12. `@angular/material` i `@angular/cdk` (gdy zespół je wprowadzi) importuje wyłącznie `libs/shared/ui`;
    reszta widzi komponenty `cb-*`. <!-- N-012 -->
13. Trasy są leniwe (`loadComponent` / `loadChildren`); ciężkie bloki poniżej linii zgięcia w `@defer`;
    obrazy przez `NgOptimizedImage`. <!-- N-013 -->
14. Kod SSR-safe nawet w aplikacji bez SSR: `window`, `document`, `localStorage` przez `inject(DOCUMENT)`
    albo `afterNextRender()`, nigdy w konstruktorze. <!-- N-014 -->

## Uzasadnienie

Zdania 1–4 zdejmują koszt rosnący liniowo z liczbą komponentów. Zdania 5–8 i 10 pilnują JEDNEGO modelu
stanu w całej aplikacji: dwa modele naraz kosztują więcej niż każdy z nich osobno, a w zoneless stan
poza sygnałem to ekran, który się nie odświeża. Zdanie 11 jest architekturą monorepo bez Nx — alias
mówi, czym biblioteka ma być, a lint sprawdza, czy kod jej odpowiada. Zdanie 12 sprowadza wymianę
biblioteki komponentów do pracy w jednym katalogu.

## Nowy projekt

Aplikacja: `npm run new:app -- <nazwa>` (tworzy też `apps/<nazwa>-e2e`). Biblioteka:
`npm run new:lib -- <zakres>/<typ>-<nazwa>`. Nigdy `ng generate application|library` wprost —
skrypt przywraca `package.json`, ustawia runner testów, alias do źródeł i `OnPush`.
