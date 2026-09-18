# copilot-builder — komendy, roster, granice

Ten plik czyta każdy agent przy każdym żądaniu. Zasady ogólne stoją w `.github/copilot-instructions.md`.

**copilot-builder** to szablon monorepo Angular 22 (workspace Angular CLI, `apps/` + `libs/`, bez Nx)
dla GitHub Copilota w VS Code, z GitLab CI i natywnymi hookami gita. Repozytorium startuje bez aplikacji.
Reguła: co może być skryptem, jest skryptem. Agent płaci tylko za treść, której skrypt nie wyprowadzi.

## Komendy

| Komenda                                                                       | Co robi                                                                    |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `npm ci && npm run prepare`                                                   | instalacja (Node 24) i uzbrojenie hooków gita                              |
| `npm run verify`                                                              | wszystkie bramy; definicja ukończenia; pierwsza czerwona przerywa          |
| `npm run verify:affected`                                                     | bramy statyczne + lint/typecheck/test dotkniętych projektów                |
| `npm run verify:full`                                                         | `verify` + e2e wszystkich aplikacji                                        |
| `npm run affected -- <lint\|typecheck\|test\|build\|e2e> [--all] [--base=<ref>]` | jeden target dla dotkniętych projektów; cache w `.cache/tasks/`         |
| `npm run new:app -- <nazwa>`                                                  | nowa aplikacja `apps/<nazwa>` + `apps/<nazwa>-e2e`                         |
| `npm run new:lib -- <zakres>/<typ>-<nazwa>`                                   | nowa biblioteka `libs/<zakres>/<typ>-<nazwa>`, alias `@cb/<zakres>/<typ>-<nazwa>` |
| `npm run workflow:specify -- --verb=<v> --slug=<s> --title="<t>"`             | scaffold spec + plan + run-log (lokalne)                                   |
| `npm run sdd -- next\|brief\|task\|log …`                                     | plan i run-log przez skrypt (skill `sdd-scripts`)                          |
| `npm run route -- <ścieżki>` / `-- --changed`                                 | kto dotyka których plików                                                  |
| `npm run review:draw -- <katalog>`                                            | losuje miejsca review, zapisuje `draw.json`                                |
| `npm run review:merge -- <katalog> --slug <s> --out <plik>`                   | scala raporty miejsc review w jedną tabelę                                 |
| `npm run stamp`                                                               | stempel `YYYY-MM-DD_HH-MM` do nazw artefaktów                              |
| `npm run alm:read -- <źródło> [config] [--stamp X]`                           | snapshot Jira/Confluence/GitLab/Sonar/Figma/Miro do `.alm/`                |
| `npm run alm:create\|alm:update -- <źródło> <plik.md>`                        | publikacja Markdownu (dry-run; `--yes` zapisuje)                           |
| `npm run browser-inspector -- <config.json>` / `-- open <url>`                | flow batch albo sesja w systemowym Chrome/Edge                             |
| `npm run code-index`                                                          | regeneracja `CODE-INDEX.md`                                                |
| `npm run doctor`                                                              | diagnostyka środowiska                                                     |
| `npm run check:upstream`                                                      | (online, poza `verify`) piny w tyle za `latest`                            |

## Bramy

`npm run verify` uruchamia po kolei: `format:check`, `check:pins`, `guard:forbidden`, `ai:validate`, `sdd:check`,
`stack:check`, `code-index --check`, `check:instructions`, `check:prefix`, `check:glossary`, `typecheck`, `lint`,
`test`, `affected typecheck`, `affected test`, `affected build`. Każdą uruchomisz osobno przez `npm run <nazwa>`.
Co pilnuje każda z nich, mówi nagłówek jej skryptu w `tools/scripts/`.

## Pliki generowane. Nie edytuj ich ręcznie

| Plik                                                      | Regeneruje                           |
| --------------------------------------------------------- | ------------------------------------ |
| `CODE-INDEX.md`                                           | `npm run code-index` (hook pre-commit) |
| blok AUTOGEN w `docs/tech-stack.md`                       | `npm run stack:sync`                 |
| `tools/scripts/upstream-state.json`                       | `npm run check:upstream`             |
| `angular.json`, `tsconfig.json` (projekty, aliasy)        | `npm run new:app` / `new:lib`        |
| tabela routingu w `.github/agents/orchestrator.agent.md`  | `npm run route -- --sync`            |

## Zmiana w jednym miejscu wymaga zmiany w drugim

- bloki `INSTRUCTION:*` niżej i w `.github/copilot-instructions.md` (identyczne co do znaku);
- `.github/models-registry.json` (roster, tiery, `review.seats`), pliki `.github/agents/*.agent.md` i tabela rosteru niżej;
- serwery w `.vscode/mcp.json` i lista `tools:` agenta `mcp-gateway`;
- wersja `@playwright/test` i tag obrazu Playwrighta w `.gitlab-ci.yml`;
- `tools/scripts/workspace.config.mjs` (`PREFIX`, `ALIAS_SCOPE`, `DEFAULT_BRANCH`) i `angular.json` (`schematics.*.prefix`);
- `.nvmrc`, `engines.node`, obraz `node:` w `.gitlab-ci.yml`, `@types/node`.

## Roster

Jeden agent widoczny: `orchestrator`. Reszta dostaje zlecenia od niego. Rola i tier stoją w
`.github/models-registry.json`. Review kodu czyta `review.seatsPerReview` miejsc z puli `review.seats`,
wylosowanych przez `npm run review:draw`. Każde miejsce to inna rodzina modeli.

| Agent                     | Tier           | Robi                                                                        |
| ------------------------- | -------------- | --------------------------------------------------------------------------- |
| `orchestrator`            | fast           | prowadzi drabinę SDD krok po kroku; deleguje; nie pisze kodu                |
| `code-angular`            | base           | kod w `apps/**`, `libs/**` (`.ts`, `.html`, `.css`, bez `*.spec.ts`)        |
| `code-tooling`            | fast           | `tools/**`, hooki, konfiguracje lintów, `angular.json`, CI                  |
| `code-tester-unit`        | fast           | `**/*.spec.ts`, `tools/**/*.spec.mjs`                                       |
| `code-tester-e2e`         | base           | `apps/*-e2e/**` (Playwright)                                                |
| `code-verifier`           | fast           | uruchamia bramę z briefu, zwraca `ok` albo `FAIL`                           |
| `code-reviewer-anthropic` | main-anthropic | review kodu, rodzina anthropic, tylko odczyt                                |
| `code-reviewer-openai`    | main-openai    | review kodu, rodzina openai, tylko odczyt                                   |
| `code-reviewer-moonshot`  | main-moonshot  | review kodu, rodzina moonshot, tylko odczyt                                 |
| `code-reviewer-google`    | main-google    | review kodu, rodzina google, tylko odczyt                                   |
| `code-reviewer-ui`        | vision         | ogląda zrzuty na 5 szerokościach, tylko odczyt                              |
| `doc-intake`              | fast           | blok intake, streszczenia, komunikat commita, wiersz `docs/INDEX.md`        |
| `doc-spec`                | base           | spec, plan, run-log, ADR, raport review (`docs/**`)                         |
| `doc-reviewer`            | base           | przegląd prozy i makiet, tylko odczyt; werdykt STOP kończy turę             |
| `mcp-gateway`             | fast           | jedyny dostęp do serwerów MCP; zwraca ścieżkę artefaktu + streszczenie      |
| `scm-git`                 | fast           | `git add` plików zadania + `git commit`; bez push                           |

## Granice

1. `tools/alm/**`, `tools/browser-inspector/**` i `.github/skills/angular-developer/references/**` czytasz, nie zmieniasz.
   Zmiana to decyzja człowieka.
2. Serwer MCP na liście `tools:` ma tylko `mcp-gateway`.
3. `.alm/`, `.browser-inspector/`, `.mcp-artifacts/`, `read.config.*.json` nigdy nie idą do commita.
4. Import między projektami tylko przez alias `@cb/...`. Kierunek: feature → ui, data-access, util ·
   ui → ui, util · data-access → data-access, util · util → util.
5. Sekrety tylko w środowisku albo w profilu użytkownika. Literał w configu to błąd.
6. `--yes` przy `alm:create|alm:update` tylko na wyraźne polecenie człowieka. Usuwania nie ma.
7. Nazwa modelu poza rejestrem i wersja w prozie poza blokiem AUTOGEN to usterka.
8. `git commit` robi tylko `scm-git`. Push i tag robi człowiek. Po STOP nikt nie pracuje dalej.

## Gdzie co jest

Najpierw czytasz [CODE-INDEX.md](CODE-INDEX.md) (≈ 64 kB: moduły, eksporty, importy, kto importuje)
i [GLOSSARY.md](GLOSSARY.md) (≈ 16 kB: słowa repo i ich nazwy w kodzie). Potem otwierasz tylko to, co wskażą.

Układ: `apps/` aplikacje (+ `apps/<app>-e2e`) · `libs/<zakres>/<typ>-<nazwa>` biblioteki · `tools/scripts`
bramy i scaffold · `tools/hooks` hooki Copilota · `tools/testing` runner Vitest i serwer e2e · `tools/alm` ALM ·
`tools/browser-inspector` przeglądarka · `docs/` metodyka, decyzje, kanon wersji · `.github/` Copilot ·
`.gitlab/` szablony issue/MR · `.githooks/` hooki gita.

## Blok instrukcji `browser-inspector`

Ten sam tekst stoi w `.github/copilot-instructions.md` (`npm run check:instructions`, limit 600 bajtów).

<!-- INSTRUCTION:browser-inspector:START -->
> Przeglądarka: `npm run browser-inspector -- <config.json> [--stamp X]` wykonuje flow, wynik w `<outputDir>/<stamp>/<snapshot>/report.md` (`## errors`, `## values`; `## steps` tylko przy FAIL); nieudany krok = wynik, exit 0. Sesja: `… open <url>`, `… find <tekst>` / `… snap` dają refy `eN`; `… click|fill|form|press|select|wait|shot|eval|console|net` drukują jedną linię (exit 1 = FAIL); `… tools` / `… call <tool> {json}` wołają narzędzia WebMCP strony; `… export flow.json` zapisuje sesję jako config. Wynik czytaj z dysku, nie wklejaj strony do kontekstu.
<!-- INSTRUCTION:browser-inspector:END -->

## Blok instrukcji `alm` (ALM)

<!-- INSTRUCTION:alm:START -->
> ALM (Jira i jej plugin Xray, Confluence, GitLab, Sonar, Figma, Miro): `npm run alm:read -- <źródło> [config.json] [--stamp X]` pisze snapshot do `.alm/<źródło>/<stamp>/<snapshot>/` (`_manifest.json` + `<zasób>.md|.json`); czytaj manifest, potem tylko potrzebne pliki. Zapis: `npm run alm:create|alm:update -- <źródło> <plik.md>` z front matter wg `tools/alm/templates/` — bez `--yes` dry-run z diffem; `--yes` tylko na wyraźne polecenie człowieka; usuwania nie ma.
<!-- INSTRUCTION:alm:END -->
