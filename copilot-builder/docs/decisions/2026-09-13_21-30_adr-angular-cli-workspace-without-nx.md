---
type: decision
id: 'adr.angular-cli-workspace-without-nx'
status: accepted
date: '2026-09-13'
stamp: '2026-09-13_21-30'
title: 'ADR — monorepo Angular CLI bez Nx; cache i affected własnymi narzędziami'
---

# ADR: workspace Angular CLI zamiast Nx

## Kontekst

Repozytorium ma docelowo pomieścić jedno monorepo Angular z około dziesięcioma aplikacjami i
bibliotekami współdzielonymi. Nx daje cztery rzeczy: graf projektów, `affected`, cache zadań i generatory.
Nx Cloud jest w organizacji zabroniony, więc zdalny cache i Nx Agents — największa część wartości Nx w CI —
odpadają z góry. Reszta ma koszt: `nx.json` i `project.json` per projekt, wtyczki `@nx/*` sprzężone
z wersją Angulara (osobny cykl wydań, osobne migracje), daemon i własny cache na dysku, drugi zestaw
poleceń (`nx run`) obok `ng`, drugi rejestr wiedzy dla agenta. Serwer MCP Nx (`nx-mcp`) wnosiłby
schematy narzędzi do każdej sesji Copilota.

## Decyzja

**Workspace Angular CLI (`angular.json` z wieloma projektami, `apps/` i `libs/`) bez Nx.** To, co z Nx
było naprawdę używane, jest odtworzone małymi skryptami bez zależności:

| Potrzeba              | Rozwiązanie                                                                                                                        |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| graf projektów        | `tools/scripts/affected.mjs` czyta `angular.json` i aliasy `tsconfig.json` (`paths`); import aliasu = krawędź; `<app>-e2e` → `<app>`; `styles`/`assets`/`scripts` builda wskazujące inny projekt = krawędź |
| `affected`            | zmiany względem merge-base (`git diff`) + working tree; zmiana pliku korzenia (manifest, lockfile, konfiguracje) = wszystkie projekty; brak bazy do porównania (świeży klon, inna gałąź domyślna) = wszystkie projekty, a nieistniejący `--base` to błąd (exit 2), nigdy „nic do zrobienia” |
| cache zadań           | dla `lint`, `typecheck`, `test` (bez outputów): hash treści projektu, jego zależności, plików korzenia i samej linii komendy → marker w `.cache/tasks/`; GitLab CI przenosi `.cache/` per job i gałąź |
| cache builda          | natywny cache Angular CLI (`.angular/cache`, `cli.cache.environment: all`) — również w CI                                          |
| cache lintera / tsc   | `eslint --cache` (`.cache/eslint`), `tsc --incremental` (`.cache/tsc`), cache Vite (`.cache/vite`)                                  |
| generatory            | `npm run new:app` / `new:lib` (`tools/scripts/new-project.mjs`) nad `ng generate` z post-procesingiem                              |
| granice modułów       | `no-restricted-imports` na wzorcach aliasów `@cb/<zakres>/<typ>` (`eslint.rules.mjs`) — typ biblioteki w nazwie                    |
| biblioteki            | konsumowane ze ŹRÓDEŁ przez alias; target `build` (ng-packagr) tylko do publikacji — `affected build` buduje wyłącznie aplikacje |

## Odrzucone alternatywy

| Alternatywa                                  | Powód odrzucenia                                                                                                              |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Nx z lokalnym cache, bez Nx Cloud            | koszt utrzymania wtyczek i migracji przy każdym wydaniu Angulara; cache lokalny daje w CI to samo, co katalog `.cache/` w GitLabie |
| Nx tylko dla `affected` i grafu              | jeden skrypt bez zależności robi to samo na `angular.json`; brak drugiego runnera i drugiego rejestru dla agenta                 |
| Turborepo / moon                             | kolejny runner z własnym plikiem konfiguracji per projekt; problem był w Nx Cloud, nie w braku runnera                          |
| osobne repozytorium per aplikacja            | dziesięć kopii konfiguracji Copilota, lintów i CI; współdzielone biblioteki przez publikację zamiast z źródeł                    |

## Konsekwencje

- Dodanie projektu to `npm run new:app|new:lib`, nigdy `ng generate` wprost ani ręczna edycja `angular.json`.
- `npm run affected -- <target>` jest komendą pierwszego wyboru lokalnie (pre-push: `verify:affected`)
  i w pipeline'ach MR; gałąź domyślna weryfikuje wszystko (`--all`).
- Cache zadań nie przywraca outputów — dlatego `build` i `e2e` nigdy nie są cache'owane, a `dist/`
  przechodzi między jobami jako artefakt.
- Gdyby zespół kiedyś zdecydował inaczej, `nx init` adoptuje istniejący `angular.json`; ten ADR wtedy
  dostaje `status: superseded`.

## Powiązane

- `tools/scripts/affected.mjs`, `tools/scripts/new-project.mjs`, `eslint.rules.mjs`
- [ADR — natywne hooki i GitLab CI](2026-09-13_21-32_adr-native-git-hooks-and-gitlab-ci.md)
