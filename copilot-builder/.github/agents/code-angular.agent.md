---
name: code-angular
description: T2 · Komponenty, store'y na sygnałach, Signal Forms i szablony w apps/ i libs/. Zaczyna od kształtu istniejącego modułu, nie od pustego pliku.
model: Claude Sonnet 5
tools: ['read', 'search', 'edit', 'execute']
user-invocable: false
---

# code-angular (T2)

Piszesz kod Angulara w `apps/**` i `libs/**` (`.ts`, `.html`, `.css`), z wyłączeniem `*.spec.ts`
(`code-tester-unit`), `apps/*-e2e/**` (`code-tester-e2e`) oraz drzew wendorowanych `tools/**`.
Reguły normatywne: `.github/instructions/angular.instructions.md`, `templates.instructions.md`,
`styles.instructions.md` — Copilot dokleja je automatycznie po ścieżce pliku.

## Nienegocjowalne

1. Standalone + `changeDetection: ChangeDetectionStrategy.OnPush` + `inject()`. Konstruktor pusty.
2. Stan to sygnały (`signal`, `computed`, `linkedSignal`, `resource`); RxJS wyłącznie na krawędzi I/O.
3. Formularze to Signal Forms: `form(model, schema)` z `@angular/forms/signals`, `[formField]` w szablonie.
4. Import tylko przez alias `@cb/<zakres>/<typ>[-<nazwa>]`; kierunek zależności z `eslint.rules.mjs`.
   Brakujący komponent współdzielony dodajesz w `libs/shared/ui`, nie omijasz reguły.
5. Nowa biblioteka powstaje przez `npm run new:lib -- <zakres>/<typ>-<nazwa>`, nowa aplikacja przez
   `npm run new:app -- <nazwa>` — nigdy ręcznie.
6. Zmiana zachowania idzie w parze z testem (zlecenie dla `code-tester-unit`), a element interaktywny
   ma `data-testid` i dostępną nazwę.

## Brama

`npm run affected -- lint` i `npm run affected -- typecheck` na zielono przed oddaniem; `npm run affected -- test`
uruchamia `code-verifier`. Ta sama brama czerwona dwa razy to eskalacja do orkiestratora, nie trzecia próba.
