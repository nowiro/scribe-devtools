---
type: decision
id: 'adr.biome-instead-of-prettier'
status: accepted
date: '2026-09-13'
stamp: '2026-09-13_21-31'
title: 'ADR — Biome jako jedyny formater; Markdown i szablony HTML bez formatera'
---

# ADR: Biome zamiast Prettiera

## Kontekst

Formater jest pierwszą bramą `npm run verify` i biegnie w hooku pre-commit na plikach ze stage'a — jego
czas i liczba jego konfiguracji decydują o tym, czy ludzie go omijają. Prettier obsługuje wszystko
(łącznie z Markdownem i szablonami Angulara), ale jest wolniejszy o rząd wielkości, wymaga wtyczek do
sortowania importów i drugiego pliku ignorowania, a zespół zdecydował go nie używać.

## Decyzja

**Biome jest jedynym formaterem repozytorium** (`biome.jsonc`: 120 kolumn, LF, pojedyncze cudzysłowy,
przecinki końcowe wszędzie — te same liczby, które dałby Prettier, więc zespół znający Prettiera widzi
ten sam kształt). Formatuje TypeScript, JavaScript, JSON/JSONC i CSS. Linter i sorter importów Biome są
wyłączone — linterem jest ESLint (angular-eslint, typescript-eslint, pluginy), a dwie opinie na linię to
gorzej niż jedna.

**Dwie luki są przyjęte świadomie i nie zasypywane drugim formaterem:**

- **Markdown** — Biome nie ma formatera Markdownu (schemat konfiguracji 2.x zna css, graphql, grit, html,
  javascript, json), a wtyczka tego nie nadrobi (wtyczki to wzorce GritQL na drzewie, którego `.md` nie ma).
  Prozę pilnuje review i EditorConfig (LF, spacje, finalna nowa linia).
- **Szablony Angulara (`.html`)** — formater HTML Biome jest eksperymentalny i nie rozumie bloków
  `@if` / `@for` / `@switch` / `@defer`; formater, który spłaszcza strukturę szablonu, jest gorszy niż brak.
  Poprawność i dostępność szablonów pilnują reguły angular-eslint (template + accessibility).

## Odrzucone alternatywy

| Alternatywa                       | Powód odrzucenia                                                                                     |
| --------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Prettier                          | decyzja zespołu; wolniejszy, dwa pliki konfiguracji i wtyczki dla tego, co Biome ma w binarce         |
| Biome dla kodu + Prettier dla .md/.html | dwa formatery, dwie konfiguracje, dwa rozszerzenia edytora — koszt większy niż wartość formatowania prozy |
| `dprint`                          | ta sama luka w Angularze, mniejsza społeczność, brak wtyczki VS Code używanej w zespole               |

## Konsekwencje

- `editor.defaultFormatter` = Biome dla całego workspace; dla Markdownu i HTML `formatOnSave` wyłączone.
- Wersja Biome jest jedną z ważniejszych do śledzenia (`check:upstream`): wydanie z formaterem Markdownu
  albo z obsługą control flow Angulara zamyka lukę za darmo i jest powodem do bumpu.
- Zmiana liczb w `biome.jsonc` to zmiana całego drzewa — wymaga nowego ADR-u.
