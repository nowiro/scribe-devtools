---
description: 'Nowa aplikacja lub biblioteka: skrypt new:app / new:lib, weryfikacja, indeks, pierwszy ekran; nigdy ręczny ng generate'
agent: orchestrator
---

# /new-project

Wejście od człowieka: aplikacja (`<nazwa>`) albo biblioteka (`<zakres>/<typ>-<nazwa>`, typ to `feature`, `ui`,
`data-access` albo `util`). Brak jednego z tych pól: STOP z jednym pytaniem.

1. Aplikacja: `npm run new:app -- <nazwa> [--port=<n>]`. Powstaje `apps/<nazwa>` i `apps/<nazwa>-e2e`.
   Biblioteka: `npm run new:lib -- <zakres>/<typ>-<nazwa>`. Powstaje `libs/<zakres>/<typ>-<nazwa>` i alias
   `@cb/<zakres>/<typ>-<nazwa>`.
2. `npm run affected -- lint`, `npm run affected -- typecheck`, `npm run affected -- test`. Aplikacja: także
   `npm run affected -- build` i `npm run affected -- e2e`.
3. `npm run code-index`. `npm run verify -- --static`.
4. Brief do `code-angular`: pierwszy ekran albo API biblioteki według spec. Placeholder ze scaffoldu nie jest produktem.
5. Krok C: komunikat `feat(apps): add <nazwa> application` albo `feat(libs): add <zakres>/<typ>-<nazwa> library`,
   commit przez `scm-git`.

Nigdy `ng generate application|library` wprost. Nigdy ręczna edycja `angular.json` pod nowy projekt.
