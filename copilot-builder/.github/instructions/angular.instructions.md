---
description: 'Reguły kodu Angular 22 w aplikacjach i bibliotekach: sygnały, standalone, OnPush, Signal Forms, granice modułów, narzędzia WebMCP'
applyTo: 'apps/**/*.ts,libs/**/*.ts'
---

# Kod Angulara (`apps/**`, `libs/**`)

Właściciel: `code-angular`. Brama: `npm run affected -- lint`, `-- typecheck`, `-- test`, `-- build`.
Dla `*.spec.ts` obowiązuje `testing-unit.instructions.md`, dla `apps/*-e2e/**` `testing-e2e.instructions.md`.
Reguły niżej dotyczą kodu produkcyjnego. Obszar spoza tej listy (routing, DI, HTTP, pipes, animacje, SSR):
skill `.github/skills/angular-developer/SKILL.md`, jeden plik referencji na obszar.

## Reguły

1. Komponent jest standalone. `NgModule` nie powstaje.
2. Komponent ma `changeDetection: ChangeDetectionStrategy.OnPush`.
3. Zależności przez `inject()`. Konstruktor pusty. Pola `readonly`.
4. Wejścia i wyjścia: `input()`, `input.required()`, `output()`, `model()`. Nie dekoratory.
5. Stan między szablonem a klasą to sygnał: `signal`, `computed`, `linkedSignal`. Dane asynchroniczne przez
   `resource()` / `httpResource()`. Ręczna subskrypcja tylko dla strumienia zdarzeń (SSE, zdarzenia DOM).
6. Wartość zasobu czytasz po sprawdzeniu: `@if (res.hasValue())`, potem `res.value()`. Nigdy `res.value()!`.
7. Magazyn stanu to klasa `@Injectable` z sygnałami. NgRx, `BehaviorSubject` jako store i `Subject` jako
   szyna zdarzeń są usterką.
8. Formularz: `form(model, schema)` z `@angular/forms/signals`, wiązanie `[formField]`, walidacja w schemacie
   (`required`, `validate`, `validateTree`, `applyEach`, `validateStandardSchema` z Zod). `FormGroup`,
   `FormControl` i `ngModel` nie występują w nowym kodzie.
9. Bez `any`. Bez `as` na granicy danych: parsuj przez Zod. Publiczne API biblioteki jest otypowane.
10. Aplikacja jest zoneless. Nic nie polega na `NgZone`. Zmiana stanu poza sygnałem i zdarzeniem szablonu
    przechodzi przez sygnał albo `markForCheck()`.
11. Import biblioteki tylko przez alias `@cb/<zakres>/<typ>[-<nazwa>]`. Kierunek: feature → ui, data-access,
    util · ui → ui, util · data-access → data-access, util · util → util. Nigdy `src/` innego projektu.
12. `@angular/material` i `@angular/cdk` importuje tylko `libs/shared/ui`. Reszta używa komponentów `cb-*`.
13. Trasy leniwe: `loadComponent` / `loadChildren`. Ciężkie bloki poniżej zgięcia w `@defer`. Obrazy przez
    `NgOptimizedImage`.
14. `window`, `document`, `localStorage` przez `inject(DOCUMENT)` albo `afterNextRender()`. Nigdy w konstruktorze.

## Narzędzia WebMCP (eksperymentalne)

Angular 22 ma `provideExperimentalWebMcpTools`, `declareExperimentalWebMcpTool` (`@angular/core`)
i `provideExperimentalWebMcpForms` (`@angular/forms/signals`). Narzędzie ma `name`, `description`, `inputSchema`
i `execute`. Bez `navigator.modelContext` rejestracja nic nie robi. Sesja `npm run browser-inspector` instaluje
ten rejestr, więc `tools` i `call` widzą narzędzia aplikacji.

1. Rejestrujesz narzędzia tylko w buildzie deweloperskim: w `app.config.ts`
   `...(isDevMode() ? [provideExperimentalWebMcpTools(TOOLS)] : [])`, w serwisie `if (isDevMode())` przed
   `declareExperimentalWebMcpTool`. Build produkcyjny nie rejestruje nic. Zmiana tej reguły wymaga ADR.
2. Narzędzie odpowiada jednej akcji z ekranu i woła ten sam serwis co ekran. Nie ma narzędzi, które robią
   więcej niż ekran (operacje zbiorcze, funkcje administracyjne).
3. Narzędzia deklarujesz w serwisie root albo w providerach aplikacji, nie w komponencie. Nazwa jest unikalna
   w aplikacji.
4. `execute` parsuje wejście przez Zod, zanim czegokolwiek użyje. Angular nie sprawdza `inputSchema`.
5. Pierwsza wersja: narzędzia odczytu i formularze (`experimentalWebMcpTool: {name, description}` w opcjach
   `form(...)`). Bez usuwania i bez akcji nieodwracalnych.
6. `execute` zwraca `{content: [{type: 'text', text}]}`. Wynik nie zawiera sekretów ani danych innego użytkownika
   niż zalogowany.

## Nowy projekt

Aplikacja: `npm run new:app -- <nazwa>`. Biblioteka: `npm run new:lib -- <zakres>/<typ>-<nazwa>`.
Nigdy `ng generate application|library` wprost.
