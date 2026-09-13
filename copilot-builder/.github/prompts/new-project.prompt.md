---
description: 'Nowa aplikacja lub biblioteka: skrypt new:app / new:lib, potem lista rzeczy do zrobienia (routing, aliasy, testy, e2e) — nigdy ręczny ng generate'
agent: orchestrator-sdd
---

# /new-project — aplikacja albo biblioteka w workspace

1. Ustal z operatorem: aplikacja (`<nazwa>`; SSR jest poza zakresem szablonu — osobna decyzja z ADR) czy biblioteka (`<zakres>/<typ>-<nazwa>`,
   typ ∈ `feature | ui | data-access | util` — typ wyznacza, co biblioteka może importować).
2. Uruchom skrypt (deterministyczny; przywraca `package.json`, ustawia runner testów, alias do źródeł, `OnPush`):
   - `npm run new:app -- <nazwa> [--port=<n>]` → `apps/<nazwa>` + `apps/<nazwa>-e2e` (Playwright, test dymny na matrycy viewportów z rejestru)
   - `npm run new:lib -- <zakres>/<typ>-<nazwa>` → `libs/<zakres>/<typ>-<nazwa>`, alias `<ALIAS_SCOPE>/<zakres>/<typ>-<nazwa>` (`tools/scripts/workspace.config.mjs`)
3. Zweryfikuj: `npm run affected -- lint`, `npm run affected -- typecheck`, `npm run affected -- test`,
   dla aplikacji także `npm run affected -- build` i `npm run affected -- e2e`.
4. `npm run code-index` (indeks pokazuje `public-api.ts` / `app.routes.ts` nowego projektu) i `npm run verify -- --static`.
5. Zleć `code-angular` pierwszy realny ekran / API biblioteki wg spec — placeholder ze scaffoldu nie jest produktem.
6. Propozycja commita: `feat(apps): add <nazwa> application` / `feat(libs): add <zakres>/<typ>-<nazwa> library`.

Nigdy `ng generate application|library` wprost i nigdy ręczne edycje `angular.json` pod nowy projekt.
