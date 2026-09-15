---
name: angular-developer
description: Oficjalne referencje Angulara (angular/skills) dla kodu w apps/** i libs/** — komponenty, sygnały, resource, HTTP, DI, routing, pipes, style, animacje, testy, konfiguracja środowiska. Użyj, gdy brief dotyczy obszaru, którego nie opisuje angular.instructions.md; czytaj jeden plik referencji na obszar.
metadata:
  upstream: https://github.com/angular/skills
  upstreamCommit: a7f825692db669dc97e2059fe2220cc4a3dc34a7
  upstreamDate: '2026-09-13'
  license: MIT, Copyright 2026 Google LLC
---

# angular-developer. Referencje Angulara do czytania na żądanie

Pliki w `references/` są skopiowane z repozytorium angular/skills (commit w nagłówku). Czytasz je, nie zmieniasz.
Są po angielsku. Aktualizacja to nowy commit upstream wpisany w tym pliku i te same wykluczenia. Decyduje człowiek.

## Zasady szablonu wygrywają

Gdy referencja mówi inaczej niż `.github/instructions/angular.instructions.md`, wygrywa instrukcja. W szczególności:

1. Aplikację i bibliotekę tworzy `npm run new:app` / `npm run new:lib`. Nigdy `ng new`, `npx`, `ng add`.
2. Angular CLI wołasz przez `node node_modules/@angular/cli/bin/ng.js`, nie `ng` ani `npx ng`.
3. Formularze to Signal Forms. Referencji o formularzach reaktywnych i template-driven tu nie ma.
4. Nowa zależność (na przykład `@angular/aria`, Tailwind, Material) to UWAGI dla orkiestratora, nie `ng add`.
5. Serwer MCP Angulara ma tylko `mcp-gateway`. Referencji o konfiguracji MCP tu nie ma.

## Który plik czytać

| Obszar                                        | Plik w `references/`                                                                                                   |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| komponent: budowa, metadane, control flow     | `components.md`                                                                                                        |
| wejścia `input()`, `model()`                  | `inputs.md`                                                                                                            |
| wyjścia `output()`                            | `outputs.md`                                                                                                           |
| host bindings                                 | `host-elements.md`                                                                                                     |
| nazwy plików i klas                           | `naming-conventions.md`                                                                                                |
| `signal`, `computed`, `untracked`             | `signals-overview.md`                                                                                                  |
| `linkedSignal`                                | `linked-signal.md`                                                                                                     |
| `resource`, `httpResource`                    | `resource.md`                                                                                                          |
| `effect`, `afterRenderEffect`                 | `effects.md`                                                                                                           |
| HttpClient, interceptory                      | `http-client.md`                                                                                                       |
| Signal Forms                                  | `signal-forms.md`                                                                                                      |
| DI: podstawy, serwisy, providery              | `di-fundamentals.md`, `creating-services.md`, `defining-providers.md`                                                  |
| DI: kontekst wstrzykiwania, hierarchia        | `injection-context.md`, `hierarchical-injectors.md`                                                                    |
| pipes                                         | `pipes.md`                                                                                                             |
| routing: definicja tras, lazy, outlety        | `define-routes.md`, `loading-strategies.md`, `show-routes-with-outlets.md`                                             |
| routing: nawigacja, guardy, resolvery         | `navigate-to-routes.md`, `route-guards.md`, `data-resolvers.md`                                                        |
| routing: cykl życia, SSR/SSG, animacje tras   | `router-lifecycle.md`, `rendering-strategies.md`, `route-animations.md`                                                |
| style komponentu, animacje CSS                | `component-styling.md`, `angular-animations.md`                                                                        |
| testy: podstawy, harnesses, router            | `testing-fundamentals.md`, `component-harnesses.md`, `router-testing.md`                                               |
| migracje `ng update`                          | `migrations.md`                                                                                                        |
| konfiguracja środowiska (build-time, runtime) | `environment-configuration.md`                                                                                         |

## Jak czytasz

1. Znajdź obszar w tabeli. Przeczytaj tylko ten plik.
2. Zastosuj regułę z pliku, chyba że `angular.instructions.md` mówi inaczej.
3. Nie czytaj całego katalogu.
