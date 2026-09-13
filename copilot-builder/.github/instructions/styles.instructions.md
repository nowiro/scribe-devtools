---
description: 'Style CSS aplikacji i bibliotek: tokeny, mobile-first, kontrast, focus'
applyTo: 'apps/**/*.css,libs/**/*.css'
---

# Style (`*.css`)

Właściciel: `code-angular`. Format: Biome (`npm run format`). Preprocesor nie jest używany — natywny
CSS ma zagnieżdżanie, zmienne i `@layer`; SCSS wprowadza drugi język i drugi formater.

- **Tokeny, nie wartości.** Kolory, odstępy, promienie, typografia przez zmienne CSS (`var(--cb-*)`)
  zdefiniowane raz w stylach globalnych aplikacji albo w `libs/shared/ui`. Literał w komponencie to
  dług szukany po całym repo przy zmianie motywu.
- **Mobile-first:** reguła bazowa opisuje najwęższy ekran, `@media` wyłącznie `min-width`, progi ze
  skali `.github/models-registry.json` → `ui.viewports` (360 / 768 / 1024 / 1440 / 1920). `var()` nie
  działa w `@media` — progi stoją jako literały.
- Motyw jasny i ciemny naraz: `prefers-color-scheme` jako domyślny sygnał plus jawne nadpisanie
  atrybutem z korzenia (przełącznik w aplikacji wygrywa z systemem).
- Kontrast ≥ 4,5:1 dla tekstu, ≥ 3:1 dla elementów interaktywnych; widoczny focus — nigdy
  `outline: none` bez zamiennika.
- Bez `!important` poza nadpisaniem biblioteki zewnętrznej (z komentarzem czego dotyczy i kiedy zniknie);
  maksymalnie 3 poziomy zagnieżdżenia.
- `:host { display: block }` jest domyślne (`displayBlock` w `angular.json`).
