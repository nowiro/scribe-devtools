---
description: 'Style CSS aplikacji i bibliotek: tokeny, mobile-first, kontrast, focus'
applyTo: 'apps/**/*.css,libs/**/*.css'
---

# Style (`*.css`)

Właściciel: `code-angular`. Format: Biome (`npm run format`). Preprocesora nie ma. Natywny CSS ma zagnieżdżanie,
zmienne i `@layer`.

## Reguły

1. Tokeny, nie wartości. Kolory, odstępy, promienie, typografia przez zmienne CSS (`var(--cb-*)`) zdefiniowane
   raz w stylach globalnych aplikacji albo w `libs/shared/ui`.
2. Mobile-first: reguła bazowa opisuje najwęższy ekran. `@media` tylko z `min-width`. Progi z `ui.viewports`
   w `.github/models-registry.json` (360, 768, 1024, 1440, 1920), wpisane jako liczby, bo `var()` nie działa
   w `@media`.
3. Motyw jasny i ciemny: `prefers-color-scheme` jako domyślny sygnał plus nadpisanie atrybutem z korzenia
   (przełącznik w aplikacji wygrywa z systemem).
4. Kontrast co najmniej 4,5:1 dla tekstu i 3:1 dla elementów interaktywnych. Widoczny focus. Nigdy
   `outline: none` bez zamiennika.
5. Bez `!important`. Wyjątek: nadpisanie biblioteki zewnętrznej, z komentarzem, czego dotyczy.
6. Najwyżej 3 poziomy zagnieżdżenia.
7. `:host { display: block }` jest domyślne (`displayBlock` w `angular.json`).
