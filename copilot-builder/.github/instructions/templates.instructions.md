---
description: 'Szablony Angulara: natywny control flow, semantyczny HTML, dostępność, data-testid'
applyTo: 'apps/**/*.html,libs/**/*.html'
---

# Szablony (`*.html`)

Właściciel: `code-angular`. Brama: `npm run affected -- lint` (angular-eslint template + accessibility).
Formatera dla szablonów nie ma (Biome nie zna bloków `@if`) — wcięcia trzymasz ręcznie, po 2 spacje.

- `@if` / `@for … track` / `@switch` / `@defer`; `*ngIf`, `*ngFor`, `[ngClass]`, `[ngStyle]` to kod
  do migracji, nie do pisania. `@for` zawsze z `track` po polu modelu.
- Zero logiki w szablonie: warunek złożony w `@if` oznacza brakujący `computed` w klasie.
- Natywny element przed `div` z rolą: `<button type="button">`, `<a>`, `<nav>`, `<main>`, `<section aria-labelledby>`.
  `(click)` na `div` bez `tabindex`/`role`/obsługi klawiatury jest usterką dostępności.
- Każdy `<img>` ma `alt` (opisowy albo pusty dla dekoracyjnych); obraz przez `ngSrc`.
- Pole formularza ma `<label for>`; `placeholder` nie jest etykietą. Błąd pola jest powiązany z polem
  (`aria-describedby`) i ogłaszany (`role="alert"`).
- Ikona bez tekstu ma `aria-label`; dekoracyjna — `aria-hidden="true"`.
- Element interaktywny ma `data-testid` (lokatory e2e: `getByRole` > `getByLabel` > `getByTestId`).
- Każdy widok z danymi ma stan loading / empty / error.
- Elementy bez treści są samozamykające (`<router-outlet />`).
