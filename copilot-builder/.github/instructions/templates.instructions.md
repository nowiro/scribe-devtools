---
description: 'Szablony Angulara: natywny control flow, semantyczny HTML, dostępność, data-testid'
applyTo: 'apps/**/*.html,libs/**/*.html'
---

# Szablony (`*.html`)

Właściciel: `code-angular`. Brama: `npm run affected -- lint` (angular-eslint template + accessibility).
Formatera dla szablonów nie ma. Wcięcia po 2 spacje trzymasz sam.

## Reguły

1. `@if`, `@for … track`, `@switch`, `@defer`. `*ngIf`, `*ngFor`, `[ngClass]`, `[ngStyle]` nie występują w nowym
   kodzie. `@for` zawsze z `track` po polu modelu.
2. Bez logiki w szablonie. Złożony warunek w `@if` przenosisz do `computed` w klasie.
3. Natywny element przed `div` z rolą: `<button type="button">`, `<a>`, `<nav>`, `<main>`,
   `<section aria-labelledby>`. `(click)` na `div` bez `tabindex`, `role` i obsługi klawiatury jest usterką.
4. Każdy `<img>` ma `alt` (opisowy albo pusty dla dekoracyjnych). Obraz przez `ngSrc`.
5. Pole formularza ma `<label for>`. `placeholder` nie jest etykietą. Błąd pola jest powiązany z polem
   (`aria-describedby`) i ogłaszany (`role="alert"`).
6. Ikona bez tekstu ma `aria-label`. Dekoracyjna ma `aria-hidden="true"`.
7. Element interaktywny ma `data-testid`.
8. Każdy widok z danymi ma stan loading, empty i error.
9. Element bez treści jest samozamykający (`<router-outlet />`).
