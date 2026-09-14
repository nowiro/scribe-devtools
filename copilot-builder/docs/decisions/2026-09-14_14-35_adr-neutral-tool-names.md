---
type: decision
id: 'adr.neutral-tool-names'
status: accepted
date: '2026-09-14'
stamp: '2026-09-14_14-35'
title: 'ADR — narzędzia wendorowane nazwane po funkcji; nazwy własne źródła zakazane bramą słów w guard:forbidden'
---

# ADR: neutralne nazwy narzędzi wendorowanych

## Kontekst

Narzędzie ALM (`tools/alm/`) i `browser-inspector` zostały przeniesione do szablonu z zewnętrznego
repozytorium. Do tej pory nazwa własna narzędzia źródłowego była nazwą katalogu, katalogów danych
(`.<nazwa>/`), projektów Vitest, markera bloku instrukcji, dokumentu porównawczego i linii proweniencji
dopisywanej do treści w Jirze, GitLabie, Confluence i Miro. Szablon adoptuje inna firma jako własne
monorepo: cudza marka w ścieżkach jest dla niej szumem, a proweniencja z obcą nazwą wychodzi na zewnątrz
przy każdym zapisie ALM i mówi, skąd wzięto narzędzia.

## Decyzja

1. **Narzędzia nazywają się po tym, co robią.** ALM to `alm`: katalog `tools/alm/`, dane w `.alm/<źródło>/`,
   projekty Vitest `alm-scripts` i `alm-integrations`, blok `INSTRUCTION:alm`, dokument `MCP-VS-ALM.md`,
   linia proweniencji „za pomocą narzędzia alm v…". Przeglądarka to `browser-inspector`: dane w
   `.browser-inspector/` (bez pośredniego katalogu nazwanego po pakiecie źródłowym; `auth/` i `session/`
   leżą w nim obok stempli).
2. **Nazwy własne narzędzia źródłowego i jego autora są zakazane w całym drzewie.** Lista `FORBIDDEN_WORDS`
   w `tools/scripts/guard-forbidden.mjs` jest sprawdzana w ścieżce i treści każdego śledzonego pliku
   (`git ls-files`, pliki binarne pomijane): całe słowo, bez względu na wielkość liter, z kropką, ukośnikiem,
   myślnikiem i podkreśleniem jako granicą — `describe` i `subscribes` przechodzą. Linia, która musi
   zacytować słowo (sama lista, jej spec), niesie `forbidden:ignore`.
3. **Wersja tooling ALM idzie do `2.3.0`** (`integrations/shared/version.ts`): linia proweniencji i domyślny
   katalog wyjściowy są obserwowalne z zewnątrz, więc to zmiana formatu, nie kosmetyka.
4. **Kopia `tools/browser-inspector/src` przestaje być bajt w bajt równa źródłu** — `DEFAULT_OUTPUT_DIR`,
   `outputDir` w `config.mjs`, kontrola `storageState` w `auth.mjs` i komentarze; wiersz o tym stoi w
   `tools/browser-inspector/README.md`, żeby przyszła synchronizacja ze źródłem wiedziała, co zachować.

## Odrzucone alternatywy

| Alternatywa                                             | Powód odrzucenia                                                                                                    |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| zostawić nazwę źródłową, zakazać tylko nowych wystąpień | proweniencja z obcą marką dalej wychodziłaby do Jiry i GitLaba przy każdym zapisie                                   |
| brama tylko na ścieżki (`FORBIDDEN_PATHS`)              | komentarz, nazwa projektu Vitest i linia proweniencji też są nośnikiem marki — ścieżka to najmniejsza część problemu |
| reguła ESLint                                           | większość wystąpień była w Markdownie, JSON-ie i YAML-u, których ESLint tu nie czyta                                 |

## Konsekwencje

- Nowe narzędzie wendorowane dostaje nazwę po funkcji i katalog danych `.<nazwa>/`; marka źródła zostaje w
  historii repozytorium źródłowego, nie tu.
- Nowe słowo zakazane = najpierw rename, potem wiersz w `FORBIDDEN_WORDS` — w odwrotnej kolejności `verify` jest
  czerwony do czasu renamu.
- `.alm/` i `.browser-inspector/` stoją w `.gitignore`, ustawieniach VS Code, wykluczeniach Biome i ESLint oraz
  w `check:pins` — jedna lista w pięciu miejscach, jak dotąd.
