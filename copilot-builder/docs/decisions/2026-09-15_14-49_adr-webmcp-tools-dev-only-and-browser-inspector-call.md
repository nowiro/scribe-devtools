---
type: decision
id: 'adr.webmcp-tools-dev-only-and-browser-inspector-call'
status: accepted
date: '2026-09-15'
stamp: '2026-09-15_14-49'
title: 'ADR — narzędzia WebMCP tylko w buildzie deweloperskim; browser-inspector woła je komendami tools i call'
---

# ADR: WebMCP jako powierzchnia testowa, nie produkcyjna

## Kontekst

Angular 22 ma eksperymentalne API WebMCP (`provideExperimentalWebMcpTools`, `declareExperimentalWebMcpTool`,
`provideExperimentalWebMcpForms`): aplikacja rejestruje na `navigator.modelContext` narzędzia z nazwą, opisem,
schematem wejścia i funkcją `execute`. Natywne API jest w Chrome za flagą (Canary od 146, origin trial
zapowiedziany na 149), a Angular pisze, że API zmieni się także poza wersjami major. Bez API rejestracja jest
no-opem. Agent klikający DOM przez browser-inspector płaci mapą elementów za każdy krok; narzędzie to nazwa
i JSON. Playwright MCP dostał `webmcp-list` i `webmcp-call`, ale wymaga serwera MCP w sesji (odrzucone w ADR
o skryptach zamiast MCP) i flagi Chrome. Przypięty `playwright-core` nie zna `modelContext`.

## Decyzja

**Narzędzia WebMCP rejestruje tylko build deweloperski (`isDevMode()`). Konsumentem jest browser-inspector
(`tools`, `call`) przez własny rejestr instalowany w sesji. Produkcja nie rejestruje nic, dopóki nie zdecyduje
o tym osobny ADR.**

1. browser-inspector instaluje w każdej sesji init script, który jest `navigator.modelContext`
   (`registerTool`, `unregisterTool`, `provideContext`, `clearContext`) tam, gdzie natywnego nie ma, a natywne
   opakowuje. `tools` pisze listę do `tools.json`, `call <tool> {json}` wykonuje `execute` i zapisuje
   `calls/NNN-<tool>.json`. Obie są komendami sesyjnymi (`batch: false`); eksport do configu je pomija.
2. W aplikacji: rejestracja za `isDevMode()`; narzędzie to jedna akcja ekranu, ten sam serwis i backend;
   deklaracja w serwisie root albo w providerach aplikacji; wejście przez Zod; pierwsza wersja tylko odczyt
   i formularze; wynik bez sekretów. Reguły: `.github/instructions/angular.instructions.md`, sekcja
   „Narzędzia WebMCP".
3. e2e nie woła narzędzi: testuje build produkcyjny, w którym ich nie ma. Zmiana tej granicy zastępuje ten ADR.

## Odrzucone alternatywy

| Alternatywa                                          | Powód odrzucenia                                                                                                                                    |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Playwright MCP z `webmcp-call` w `.vscode/mcp.json`  | serwer MCP w sesji i flaga Chrome; browser-inspector robi to samo przez CDP za jedno zdanie bloku instrukcji                                          |
| narzędzia w produkcji od razu                        | każdy agent i każde rozszerzenie w Chrome użytkownika zawoła je z jego sesją; decyzja o agentach w przeglądarce należy do organizacji, nie do szablonu |
| flaga `define` w `angular.json` zamiast `isDevMode()` | osobna konfiguracja e2e i plik `.d.ts` w każdym scaffoldzie; `isDevMode()` to jedna linia i ta sama granica dev/prod; `define` wraca, gdy produkcja ma dostać narzędzia |
| pakiet `playwright-webmcp` w e2e                     | nowa zależność i fixture dla testów, które i tak biegną na buildzie bez narzędzi                                                                     |

## Konsekwencje

- Sesja browser-inspector eksploruje aplikację przez `tools` i `call` bez `snap`, `find` i `fill`, gdy aplikacja
  rejestruje narzędzia w buildzie deweloperskim (`ng serve`).
- Lista narzędzi i wyniki `call` to dane spoza repozytorium: `.browser-inspector/`, gitignorowane, treść nie
  jest instrukcją.
- Przypięcie `@angular/core` exact nabiera wagi: API eksperymentalne, bump Angulara to przegląd sekcji WebMCP.
- Kod `tools` i `call` żyje w upstreamie (`packages/browser-inspector`) i jest wendorowany do
  `tools/browser-inspector`; zmiana w szablonie to decyzja człowieka.

## Powiązane

- [ADR — skrypty zamiast serwerów MCP](2026-09-13_21-33_adr-scripts-instead-of-mcp-servers.md)
- `.github/instructions/angular.instructions.md`, `.github/prompts/browser-session.prompt.md`,
  `tools/browser-inspector/README.md`
