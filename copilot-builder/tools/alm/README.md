# alm — ALM przez skrypty (narzędzie wendorowane)

Snapshoty danych z **Jira, Confluence, GitLab, Sonar, Figma, Miro, Xray i stron WWW** do plików na dysku
(`.json` + `.md`) oraz **zapis** (create / update) Markdownu z front matter z powrotem do Jira / GitLab /
Confluence / Miro — zawsze najpierw dry-run z diffem, naprawdę po `--yes`, usuwania nie ma. Instrukcja
użytkownika: [INSTRUKCJA.md](INSTRUKCJA.md); porównanie kosztu z serwerami MCP: [MCP-VS-ALM.md](MCP-VS-ALM.md).

## Użycie w tym repozytorium

```bash
cp tools/alm/examples/read.config.jira.json .     # config w korzeniu, gitignorowany
npm run alm:read -- jira                             # buduje integracje i robi snapshot do .alm/jira/
npm run alm:create -- gitlab ./issue.md              # dry-run; --yes zapisuje
```

Poświadczenia: `~/.config/extract/config.json` albo zmienne środowiskowe (`JIRA_*`, `GITLAB_*`, …) —
nigdy w repozytorium. Zależności runtime (`playwright-core`, `yaml`, `zod`) i TypeScript deklaruje
`package.json` korzenia (piny w `tools/scripts/pins.config.mjs`).

## Układ

```text
integrations/<źródło>/read-<źródło>.ts   pipeline odczytu (TypeScript, kompilowany do dist/ przez npm run alm:build)
integrations/<źródło>/write-<źródło>.ts  pipeline zapisu (jira, gitlab, confluence, miro)
integrations/shared/                     klient HTTP z osłoną SSRF, auth, ADF ↔ Markdown, OKF, runtime
scripts/read.mjs · scripts/write.mjs     dyspozytory: odkrywają pipeline'y z dist/, nic nie rejestrują
examples/read.config.<źródło>.json        działający przykład każdego źródła (parsowany przez testy)
templates/*.md                           jak PISAĆ zadania, issue, MR, strony i tablice, żeby snapshot czytał się jak brief
```

Testy: `npm test` (Vitest, projekty `alm-scripts` i `alm-integrations`); typy: `npm run typecheck`.

## Pochodzenie i zmiany względem źródła

Kod pochodzi z zewnętrznego narzędzia ALM (wersja tooling `2.3.0`, patrz `integrations/shared/version.ts`), przeniesionego
do tego repozytorium jako część szablonu. Zasada: **czytamy, nie przepisujemy**; każda świadoma zmiana ma
wiersz tutaj.

| Zmiana                                                                   | Powód                                                                                          |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| komendy `npm run read|create|update|build` → `npm run alm:read|alm:create|alm:update|alm:build` | narzędzie żyje w `tools/alm/`, skrypty w `package.json` korzenia mają przestrzeń `alm:` |
| dyspozytory uruchamiają pipeline w katalogu WYWOŁANIA (`process.cwd()`), nie w `tools/alm/` | ścieżka względna configu znaczy to, co ma na myśli człowiek w korzeniu repozytorium        |
| usunięte `scripts/gh-fetch.mjs` (GitHub CLI) i `scripts/portable-zip.mjs`  | platformą jest GitLab (źródło `gitlab`); wydanie portable nie dotyczy szablonu                 |
| usunięte `CHANGELOG.md`, `PROMPT-INSTALACJA.md`, `demo/`                  | historia i instalacja samodzielnego repozytorium — bezprzedmiotowe wewnątrz monorepo           |
| formatowanie Biome zamiast Prettiera                                      | jeden formater w repozytorium (`biome.jsonc`)                                                  |
| nazwa narzędzia `alm`: katalog `tools/alm/`, dane w `.alm/<źródło>/`, projekty Vitest `alm-*`, blok `INSTRUCTION:alm`, linia proweniencji „za pomocą narzędzia alm v…" (tooling `2.3.0`) | szablon nie niesie nazwy własnej narzędzia źródłowego ani jego autora — `npm run guard:forbidden` (`FORBIDDEN_WORDS`), ADR w `docs/decisions/` |

Niezmienione celowo: katalog poświadczeń `~/.config/extract`, zmienne `EXTRACT_*`, nagłówki `X-Extract-*`
(stabilna infrastruktura). Linia proweniencji identyfikuje narzędzie w systemach upstream, więc niesie
nazwę z tego repozytorium (`alm`), nie nazwę źródła.
