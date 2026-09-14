# copilot-builder — instrukcje dla agenta

Ten plik dokleja się do każdego żądania (`chat.useAgentsMdFile`). Zasady globalne stoją w
`.github/copilot-instructions.md`, reguły ścieżkowe w `.github/instructions/*.instructions.md`, procedury
w `.github/prompts/`, metodyka w `docs/sdd/methodology.md`.

**copilot-builder** to szablon monorepo **Angular 22** (workspace Angular CLI, `apps/` + `libs/`, bez Nx)
przygotowany do pracy z **GitHub Copilotem w VS Code**, z **GitLab CI** i natywnymi hookami gita.
Repozytorium startuje CZYSTE — bez aplikacji; pierwszą dodaje `npm run new:app -- <nazwa>`.
Zasada nadrzędna: **co może być skryptem, JEST skryptem** (0 kredytów) — scaffold, bramy, snapshoty
ALM i przeglądarka to `npm run …`, a agent płaci wyłącznie za treść, której nie da się wyprowadzić
deterministycznie.

## Komendy

| Komenda                                                | Co robi                                                                                 |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| `npm ci && npm run prepare`                            | instalacja (Node 24) i uzbrojenie hooków (`ignore-scripts` pomija `prepare` przy install) |
| `npm run verify`                                       | **definicja ukończenia** — wszystkie bramy, pierwszy czerwony przerywa                  |
| `npm run verify:affected`                              | bramy statyczne + lint/typecheck/test projektów dotkniętych zmianą (hook pre-push)      |
| `npm run verify:full`                                  | `verify` + e2e wszystkich aplikacji                                                     |
| `npm run affected -- <lint\|typecheck\|test\|build\|e2e> [--all] [--base=<ref>]` | jeden target dla dotkniętych projektów; cache zadań w `.cache/tasks/` |
| `npm run new:app -- <nazwa>`                           | nowa aplikacja `apps/<nazwa>` + `apps/<nazwa>-e2e` (Playwright)                        |
| `npm run new:lib -- <zakres>/<typ>-<nazwa>`            | nowa biblioteka `libs/<zakres>/<typ>-<nazwa>`, alias `@cb/<zakres>/<typ>-<nazwa>`      |
| `npm run workflow:specify -- --verb=<v> --slug=<s>`    | scaffold spec + plan + run-log SDD (lokalne)                                            |
| `npm run route -- <ścieżki>` / `-- --changed` / `-- --sync` | kto dotyka których plików (z `tools/scripts/routing.config.mjs`); `--sync` regeneruje tabelę routingu orkiestratora |
| `npm run review:merge -- <katalog\|pliki> [--slug s] [--out plik]` | scala raporty miejsc review w jedną tabelę: liczba zgodnych rodzin, konflikty 🔴/🟢, werdykt najgorszy z trzech |
| `npm run alm:read -- <źródło> [config] [--stamp X]`    | snapshot Jira (z Xray — pluginem testów w Jirze)/Confluence/GitLab/Sonar/Figma/Miro/WWW do `.scribe/`                |
| `npm run alm:create\|alm:update -- <źródło> <plik.md>` | publikacja Markdownu z front matter (dry-run; `--yes` zapisuje)                         |
| `npm run browser-inspector -- <config.json>` / `-- open <url>` | flow batch albo sesja interaktywna w systemowym Chrome/Edge                      |
| `npm run code-index`                                   | regeneracja `CODE-INDEX.md`                                                             |
| `npm run doctor`                                       | diagnostyka środowiska (Node, hooki, Biome, przeglądarka, poświadczenia ALM)            |
| `npm run check:upstream`                               | (online, poza `verify`) które piny są w tyle za `latest` i od kiedy                      |

## Bramy — uruchamiaj PRZED uznaniem zmiany za skończoną

`npm run verify` = kolejność poniżej; brama tańsza stoi wcześniej.

| Krok                       | Co pilnuje                                                                                              |
| -------------------------- | ------------------------------------------------------------------------------------------------------- |
| `format:check`             | Biome (TS/JS/JSON/CSS; 120 kolumn, LF, pojedyncze cudzysłowy). Markdown i szablony HTML — bez formatera |
| `check:pins`               | `tools/scripts/pins.config.mjs` jedynym miejscem deklaracji wersji; każda zależność ma wiersz z `why`; reguła TAG: tag obrazu Playwrighta w CI = pin |
| `guard:forbidden`          | brak plików innych asystentów, GitHub Actions, Nx, Prettiera, Husky, drugiego lockfile'a               |
| `ai:validate`              | roster ↔ pliki agentów, tiery ↔ modele, uprawnienia wg roli, jeden widoczny agent, MCP tylko u `mcp-gateway`; hook `deny-writes` u ról read-only, komendy hooków tylko `node tools/hooks/*.mjs`, zakaz `web`, serwer MCP z `node_modules`, tabela routingu kompletna i równa `routing.config.mjs`, trzy miejsca review na trzech rodzinach modeli (A1–A19) |
| `sdd:check`                | nazwy i wiersze INDEX artefaktów commitowanych; front matter spec/plan, `[?]`, agenci z rosteru         |
| `stack:check`              | blok AUTOGEN w `docs/tech-stack.md` zgodny z `package.json`                                             |
| `code-index --check`       | świeżość `CODE-INDEX.md`                                                                                |
| `check:instructions`       | bloki instrukcji `AGENTS.md` ≡ `.github/copilot-instructions.md`, ≤ 600 bajtów każdy                    |
| `check:glossary`           | każdy odnośnik w `GLOSSARY.md` wskazuje żywą ścieżkę albo symbol                                        |
| `typecheck`                | `tsc --checkJs` nad `tools/**` (JSDoc) i `tsc` nad `tools/scribe/integrations`                          |
| `lint`                     | ESLint: angular-eslint, typescript-eslint (typed), granice modułów `@cb/*`, sonarjs, unicorn i spółka   |
| `test`                     | Vitest: `tools/scripts`, `tools/hooks`, `tools/testing` i `tools/scribe` (`vitest.tools.config.mts`)    |
| `affected typecheck/test/build` | projekty workspace przez `affected.mjs` (`--all` w `verify`, dotknięte w `verify:affected`)        |

## Artefakty GENEROWANE — nigdy nie edytuj ręcznie

| Plik                                  | Regeneruje                       | Kiedy                                            |
| ------------------------------------- | -------------------------------- | ------------------------------------------------ |
| `CODE-INDEX.md`                       | `npm run code-index` (hook)      | każda zmiana `.mjs`/`.ts` w `tools/**`, nowy projekt |
| blok AUTOGEN w `docs/tech-stack.md`   | `npm run stack:sync`             | każda zmiana wersji w `package.json`             |
| `tools/scripts/upstream-state.json`   | `npm run check:upstream`         | zegar zaległości pinów — commituje się jak lockfile |
| `angular.json`, `tsconfig.json` (projekty, aliasy) | `npm run new:app` / `new:lib` | nowy projekt — nie ręcznie                     |
| tabela routingu w `.github/agents/orchestrator.agent.md` (blok ROUTING) | `npm run route -- --sync` | każda zmiana `tools/scripts/routing.config.mjs` albo `review.seats` |

## Punkty synchronizacji (zmiana w jednym wymaga zmiany w drugim)

- bloki `INSTRUCTION:browser-inspector` i `INSTRUCTION:scribe` niżej ↔ `.github/copilot-instructions.md`;
- roster w `.github/models-registry.json` ↔ pliki `.github/agents/*.agent.md` ↔ tabela rosteru niżej
  ↔ tabela routingu w `orchestrator` (generowana z `tools/scripts/routing.config.mjs`, brama A19);
- trzy miejsca review (`review.seats` w rejestrze) ↔ trzy różne `family` w `models` (A18) ↔ sekcja „Review"
  w `orchestrator` i prompt `/review`;
- serwery w `.vscode/mcp.json` ↔ lista `tools:` agenta `mcp-gateway`;
- wersja `@playwright/test` ↔ tag obrazu Playwrighta w `.gitlab-ci.yml` (reguła TAG w `check:pins`);
- `PREFIX`, `ALIAS_SCOPE`, `DEFAULT_BRANCH` w `tools/scripts/workspace.config.mjs` ↔ `angular.json` (`schematics.*.prefix`)
  i `biome.jsonc` (`vcs.defaultBranch`) — dwa pliki, które nie importują JS-a;
- ścieżki raportów w generowanym `playwright.config.ts` (`../../reports`, `../../test-results`) i `CB_PROJECT`
  z `affected.mjs` (`reports/junit-<projekt>.xml`, `coverage/<projekt>/`) ↔ `artifacts` jobów w `.gitlab-ci.yml`;
- `.nvmrc` ↔ `engines.node` ↔ obraz `node:` w `.gitlab-ci.yml` ↔ `@types/node`.

## Roster

Jeden agent widoczny, reszta przez delegację. Rola i tier żyją w `.github/models-registry.json`. Review kodu
to ten sam brief do trzech miejsc na trzech rodzinach modeli (`review.seats`); orkiestrator scala i liczy zgodne rodziny.

| Agent               | Rola         | Tier   | Widoczny | Zakres                                                            |
| ------------------- | ------------ | ------ | -------- | ----------------------------------------------------------------- |
| `orchestrator`      | orchestrator | fast | **tak**  | procedura drabiny SDD krok po kroku: routing skryptem, briefy w stałym szablonie, STOP, commit przez `scm-git`, DoD |
| `code-angular`      | writer       | base     | nie      | `apps/**`, `libs/**` (`.ts`, `.html`, `.css`, bez `*.spec.ts`)   |
| `code-tooling`      | writer       | fast     | nie      | `tools/**`, hooki, konfiguracje lintów, `angular.json`, CI       |
| `code-tester-unit`  | tester       | fast     | nie      | `**/*.spec.ts`, `tools/**/*.spec.mjs`                             |
| `code-tester-e2e`   | tester       | base     | nie      | `apps/*-e2e/**` (Playwright)                                      |
| `code-verifier`     | verifier     | fast     | nie      | uruchamia bramy, raportuje pierwszą czerwoną                      |
| `code-reviewer-anthropic`   | reviewer     | main-anthropic   | nie      | review kodu w rodzinie anthropic — pełny zakres (architektura, jakość, bezpieczeństwo), ten sam brief co pozostałe dwa miejsca — tylko odczyt |
| `code-reviewer-openai`   | reviewer     | main-openai   | nie      | review kodu w rodzinie openai — ten sam brief i zakres — tylko odczyt |
| `code-reviewer-moonshot`   | reviewer     | main-moonshot   | nie      | review kodu w rodzinie moonshot — ten sam brief i zakres — tylko odczyt |
| `code-reviewer-ui`  | reviewer     | vision | nie      | zrzuty na 5 szerokościach vs makieta i AC: odstępy, wyrównania, nachodzenie, scroll — tylko odczyt |
| `doc-intake`        | triager      | fast     | nie      | klasyfikacja zgłoszenia, streszczenia, commit message, INDEX     |
| `doc-spec`          | writer       | base     | nie      | spec, plan, run-log, ADR, raporty review (`docs/**`)              |
| `doc-reviewer`      | reviewer     | base     | nie      | przegląd prozy i artefaktów SDD — tylko odczyt                    |
| `mcp-gateway`       | integration  | fast     | nie      | JEDYNY dostęp do serwerów MCP z `.vscode/mcp.json`; artefakt + streszczenie |
| `scm-git`           | scm          | fast     | nie      | `git add` wskazanych plików + `git commit` ukończonego zadania planu; bez push, amend, `--no-verify` |

## Granice, których nie wolno przekroczyć

1. `tools/scribe/**` i `tools/browser-inspector/**` — narzędzia wendorowane: czytane, nie przepisywane.
2. Nikt poza `mcp-gateway` nie ma serwera MCP na liście `tools:`; sesja główna startuje bez schematów narzędzi.
3. `.scribe/`, `.scribe-devtools/`, `.mcp-artifacts/`, `read.config.*.json` — dane spoza repozytorium; nigdy do commita.
4. Import między projektami wyłącznie przez alias `@cb/<zakres>/<typ>[-<nazwa>]`; kierunek zależności
   feature → ui, data-access, util · ui → ui, util · data-access → data-access, util · util → util.
5. Sekrety wyłącznie przez środowisko albo profil użytkownika; literał w configu jest błędem walidacji.
6. `--yes` przy `alm:create|alm:update` tylko na wyraźne, bieżące polecenie człowieka; usuwania nie ma.
7. Nazwa modelu poza `.github/models-registry.json`, wersja w prozie poza blokiem AUTOGEN — usterka.
8. `git commit` wykonuje wyłącznie `scm-git` (ukończone zadanie planu, tylko jego pliki); push i tag wykonuje
   człowiek. STOP (werdykt `doc-reviewer`, STOP-AND-ASK) kończy turę — bez delegacji do odpowiedzi operatora.

## Gdzie co jest

**Zacznij od tych dwóch, zanim zaczniesz szukać w drzewie.** Indeks mówi, GDZIE coś jest; słownik, JAK to
się nazywa. Rozmiary podane po to, żebyś mógł zdecydować, czy czytasz w całości:

- [CODE-INDEX.md](CODE-INDEX.md) — ≈ 53 kB — mapa modułów narzędzi i publicznych API projektów: po co
  każdy jest, co eksportuje (z wejściem i wyjściem funkcji), co importuje i kto importuje jego.
- [GLOSSARY.md](GLOSSARY.md) — ≈ 11 kB — słowa tego repo i ich nazwy w kodzie, w obie strony.

Układ: `apps/` aplikacje (+ `apps/<app>-e2e`) · `libs/<zakres>/<typ>-<nazwa>` biblioteki ·
`tools/scripts` bramy i scaffold (`lib/repo.mjs` — wspólne pomocniki, `workspace.config.mjs` — nazwy zmieniane
przy adopcji) · `tools/hooks` hooki Copilota (`lib/payload.mjs`) · `tools/testing` runner Vitest i serwer
e2e · `tools/scribe` ALM · `tools/browser-inspector` przeglądarka · `docs/` metodyka, decyzje, kanon
wersji · `.github/` Copilot · `.gitlab/` szablony issue/MR · `.githooks/` hooki gita.

## Blok instrukcji `browser-inspector`

Równy co do znaku blokowi w `.github/copilot-instructions.md` (`npm run check:instructions`, ≤ 600 bajtów).

<!-- INSTRUCTION:browser-inspector:START -->
> Przeglądarka: `npm run browser-inspector -- <config.json> [--stamp X]` wykonuje flow, wynik w `<outputDir>/<stamp>/<snapshot>/report.md` (`## errors`, `## values`; `## steps` tylko przy FAIL); nieudany krok = wynik, exit 0. Sesja: `… open <url>`, `… find <tekst>` / `… snap` dają refy `eN`; `… click|fill|form|press|select|wait|shot|eval|console|net` drukują jedną linię (exit 1 = FAIL); `… export flow.json` zapisuje sesję jako config. Wynik czytaj z dysku, nie wklejaj strony do kontekstu.
<!-- INSTRUCTION:browser-inspector:END -->

## Blok instrukcji `scribe` (ALM)

<!-- INSTRUCTION:scribe:START -->
> ALM (Jira i jej plugin Xray, Confluence, GitLab, Sonar, Figma, Miro): `npm run alm:read -- <źródło> [config.json] [--stamp X]` pisze snapshot do `.scribe/<źródło>/<stamp>/<snapshot>/` (`_manifest.json` + `<zasób>.md|.json`); czytaj manifest, potem tylko potrzebne pliki. Zapis: `npm run alm:create|alm:update -- <źródło> <plik.md>` z front matter wg `tools/scribe/templates/` — bez `--yes` dry-run z diffem; `--yes` tylko na wyraźne polecenie człowieka; usuwania nie ma.
<!-- INSTRUCTION:scribe:END -->
