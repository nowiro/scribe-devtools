# copilot-builder

Szablon monorepo **Angular 22** dla zespołu pracującego z **GitHub Copilotem w VS Code**, z kodem na
**GitLabie** i pipeline'ami na **GitLab Runnerach**. Repozytorium startuje **czyste** — bez aplikacji —
i niesie wszystko, czego dziesięć aplikacji i biblioteki współdzielone będą potrzebować od pierwszego dnia:
workspace Angular CLI bez Nx, bramy jakości, natywne hooki gita, konfigurację Copilota z rosterem agentów,
metodykę SDD, snapshoty ALM i przeglądarkę przez skrypty zamiast serwerów MCP.

Cztery decyzje, z których wynika reszta (każda ma ADR w [`docs/decisions/`](docs/decisions/)):

1. **Bez Nx.** Workspace Angular CLI (`angular.json`, `apps/`, `libs/`); `affected` i cache zadań to jeden
   skrypt (`tools/scripts/affected.mjs`), cache builda to natywny cache Angular CLI, a GitLab przenosi
   `.cache/` między jobami. Żadnej usługi zewnętrznej.
2. **Bez Prettiera.** Biome formatuje TS/JS/JSON/CSS; Markdown i szablony HTML — nikt (świadomie).
3. **Skrypty zamiast serwerów MCP.** `npm run alm:read` robi snapshot Jiry/GitLaba/Confluence na dysk,
   `npm run browser-inspector` ogląda aplikację w systemowym Chrome; MCP zostaje wyłącznie za ukrytym
   subagentem `mcp-gateway`.
4. **Jeden widoczny agent.** Człowiek wybiera `orchestrator`; reszta rosteru (`code-*`, `doc-*`,
   `mcp-gateway`) pracuje przez delegację po ścieżce dotykanego pliku.

## Start

Wymagania: **Node 24** (`.nvmrc`), git, dla `browser-inspector` — systemowy Chrome albo Edge.

```bash
npm ci               # .npmrc: ignore-scripts=true, engine-strict=true
npm run prepare      # uzbraja hooki gita (instalacja ich NIE uruchamia — ignore-scripts)
npm run doctor       # Node, hooki, Biome, przeglądarka, poświadczenia ALM
npm run verify       # wszystkie bramy — definicja ukończenia
```

Pierwsza aplikacja i biblioteka:

```bash
npm run new:app -- portal                 # apps/portal + apps/portal-e2e (Playwright)
npm run new:lib -- shared/ui              # libs/shared/ui, alias @cb/shared/ui
npm run new:lib -- orders/feature-list    # libs/orders/feature-list, alias @cb/orders/feature-list
npm run affected -- test                  # Vitest tylko dla dotkniętych projektów
node node_modules/@angular/cli/bin/ng.js serve portal
```

Jak zbudować z tego nowe repozytorium firmy: skopiuj drzewo (bez `node_modules/`), `git init`, ustaw
`PREFIX`, `ALIAS_SCOPE` i `DEFAULT_BRANCH` w `tools/scripts/workspace.config.mjs` (ESLint, generator i
`affected` czytają stąd) oraz te same wartości w dwóch plikach, które nie importują JS-a: `angular.json`
(`schematics.*.prefix`) i `biome.jsonc` (`vcs.defaultBranch`); `git grep -n "cb\b\|@cb/"` pokazuje resztę
wystąpień w prozie i instrukcjach. Potem `policy.enabled` i `tiers` w `.github/models-registry.json` pod
plan Copilota organizacji, `tags:` runnerów w `.gitlab-ci.yml`, `npm run verify`, pierwszy commit.

## Komendy

| Komenda                                                | Co robi                                                                       |
| ------------------------------------------------------ | ----------------------------------------------------------------------------- |
| `npm run verify`                                       | wszystkie bramy w kolejności rosnącego kosztu; pierwszy czerwony przerywa      |
| `npm run verify:affected`                              | bramy statyczne + lint/typecheck/test dotkniętych projektów (hook pre-push)   |
| `npm run verify:full`                                  | `verify` + e2e wszystkich aplikacji                                            |
| `npm run affected -- <target> [--all] [--base=<ref>]`  | `lint`, `typecheck`, `test`, `build`, `e2e` dla dotkniętych projektów          |
| `npm run new:app -- <nazwa>`                           | nowa aplikacja z projektem e2e                                                 |
| `npm run new:lib -- <zakres>/<typ>-<nazwa>`            | nowa biblioteka (typ: `feature`, `ui`, `data-access`, `util`) z aliasem `@cb/*` |
| `npm run lint` / `format` / `typecheck` / `test`       | bramy pojedynczo (narzędzia + alm; projekty przez `affected`)               |
| `npm run workflow:specify -- --verb=<v> --slug=<s>`    | scaffold spec + plan + run-log SDD (lokalne)                                   |
| `npm run sdd -- next\|brief\|task\|log …`             | plan i run-log przez skrypt: następne zadanie, brief, status i SHA, wiersz run-logu |
| `npm run route -- <ścieżki>` / `-- --changed`           | kto dotyka których plików (jedno źródło: `tools/scripts/routing.config.mjs`)   |
| `npm run review:merge -- <katalog> [--out plik]`       | scala raporty trzech miejsc review: zgodne rodziny, konflikty, werdykt          |
| `npm run alm:read -- <źródło>`                         | snapshot ALM do `.alm/` (Jira z pluginem Xray, Confluence, GitLab, Sonar, Figma, Miro, WWW) |
| `npm run alm:create` / `alm:update -- <źródło> <plik>` | publikacja Markdownu (dry-run; `--yes` zapisuje)                               |
| `npm run browser-inspector -- …`                       | flow z configu albo sesja interaktywna na refach `eN`                          |
| `npm run code-index`                                   | regeneracja `CODE-INDEX.md` (hook pre-commit robi to sam)                      |
| `npm run check:upstream`                               | (online) piny w tyle za `latest` — raport, nie brama                           |

Pełna tabela bram i artefaktów generowanych: [AGENTS.md](AGENTS.md).

## Układ repozytorium

```text
apps/                       aplikacje (npm run new:app) + apps/<app>-e2e (Playwright)
libs/<zakres>/<typ>-<nazwa> biblioteki ze źródeł przez alias @cb/<zakres>/<typ>-<nazwa>
tools/scripts/              bramy, affected, verify, scaffold, piny, indeks kodu
tools/hooks/                hooki Copilota (guard-commands, deny-writes, format-on-edit, session-stop, handoff)
tools/testing/              współdzielona konfiguracja Vitest dla projektów, statyczny serwer e2e
tools/alm/               ALM przez skrypty (integracje TS, dyspozytory, przykłady, szablony treści)
tools/browser-inspector/    przeglądarka przez skrypt (playwright-core + systemowy Chrome/Edge)
docs/sdd/                   metodyka SDD i szablony spec/plan/run-log
docs/decisions/             ADR-y (nazwy ze stemplem, wiersz w docs/INDEX.md)
docs/tech-stack.md          kanon wersji (blok AUTOGEN)  ·  docs/dev-setup.md  środowisko dewelopera
.github/                    Copilot: karta, agenci, instrukcje, prompty, hooki, rejestr modeli, skill
.gitlab/ .gitlab-ci.yml     szablony issue (spec) i MR (DoD); pipeline
.githooks/                  pre-commit, commit-msg, pre-push (core.hooksPath)
AGENTS.md CODE-INDEX.md GLOSSARY.md   instrukcje agenta · indeks kodu (generowany) · słownik
```

## Praca z Copilotem — drabina SDD

`intake → specify → clarify → plan → analyze → implement → review → test → DoD`
([`docs/sdd/methodology.md`](docs/sdd/methodology.md)). Próg: zmiana ≥ 2 plików albo zmiana zachowania
idzie całą drabiną; pytanie lub trywialna edycja — wprost. Kroki mechaniczne są skryptami (0 kredytów):
`npm run workflow:specify` emituje spec, plan i run-log ze szablonów; `npm run sdd:check` pilnuje ich
kształtu. Prompty `/intake`, `/specify`, `/clarify`, `/plan`, `/analyze`, `/checklist`, `/implement`,
`/review`, `/dod`, `/adr` prowadzą przez szczeble; `/new-project`, `/browser-session`, `/alm-snapshot`,
`/alm-publish` obsługują narzędzia. Plan to lista zadań ze statusem; ukończone zadanie commituje `scm-git`,
push wykonuje człowiek. STOP (niejasność, AC ↔ makieta) kończy turę i czeka na odpowiedź operatora.

Artefakty SDD (`docs/specs/`, `docs/plans/`, `docs/runs/`) są **lokalne i gitignorowane** — kontraktem
z zespołem jest issue w GitLabie (szablon `.gitlab/issue_templates/Default.md` jest specyfikacją) i opis MR
z odhaczoną listą DoD. Do repozytorium trafiają ADR-y i raporty review.

### Roster

| Agent              | Tier   | Rola                                                                        |
| ------------------ | ------ | --------------------------------------------------------------------------- |
| `orchestrator`     | fast | **jedyny widoczny** — prowadzi drabinę według procedury, deleguje po ścieżce pliku |
| `code-angular`     | base     | kod aplikacji i bibliotek                                                   |
| `code-tooling`     | fast     | skrypty, konfiguracje, CI                                                   |
| `code-tester-unit` | fast     | testy jednostkowe Vitest                                                    |
| `code-tester-e2e`  | base     | Playwright                                                                  |
| `code-verifier`    | fast     | uruchamia bramy                                                             |
| `code-reviewer-anthropic`  | main-anthropic   | review kodu w rodzinie anthropic — pełny zakres, ten sam brief co pozostałe (tylko odczyt)    |
| `code-reviewer-openai`  | main-openai   | review kodu w rodzinie openai — ten sam brief i zakres (tylko odczyt)   |
| `code-reviewer-moonshot`  | main-moonshot   | review kodu w rodzinie moonshot — ten sam brief i zakres (tylko odczyt)   |
| `code-reviewer-ui` | vision | zrzuty na 5 szerokościach vs makieta i AC (tylko odczyt)                    |
| `doc-intake`       | fast     | klasyfikacja zgłoszenia, streszczenia, commit message                       |
| `doc-spec`         | base     | spec, plan, run-log, ADR, raporty review                                    |
| `doc-reviewer`     | base     | przegląd prozy (tylko odczyt)                                               |
| `mcp-gateway`      | fast     | jedyny dostęp do serwerów MCP (`.vscode/mcp.json`); zwraca artefakt + streszczenie |
| `scm-git`          | fast     | commituje ukończone zadanie planu (`git commit` plików zadania; bez push)   |

Tiery rozwijają się do nazw modeli wyłącznie w `.github/models-registry.json` — zmiana planu Copilota
w organizacji to zmiana `policy.enabled` i `tiers`, nie plików agentów. `npm run ai:validate` pilnuje
rosteru, uprawnień wg roli, jednego widocznego agenta, jednego właściciela MCP i tego, że trzy miejsca
review kodu (`review.seats`) stoją na trzech różnych rodzinach modeli — ten sam brief czytany przez trzy
rodziny to weryfikacja krzyżowa, więc niezależność jest bramą (A18), nie prośbą w prompcie.

## ALM i przeglądarka bez serwerów MCP

Definicje narzędzi serwera MCP to koszt stały każdej sesji (pięć serwerów ALM = ok. 7,5 tys. tokenów,
zanim padnie pierwsze pytanie — pomiar w ADR). Skrypt kosztuje jedno zdanie instrukcji:

- **alm** (`tools/alm/`): `npm run alm:read -- jira` zapisuje snapshot do `.alm/jira/<stempel>/`
  (`_manifest.json` z rozmiarami plików, `<klucz>.md` i `.json` per zadanie); agent czyta manifest, potem
  wybrane pliki. `npm run alm:create -- gitlab ./issue.md` publikuje Markdown z front matter — dry-run
  domyślnie, `--yes` zapisuje, usuwania nie ma. Poświadczenia w `~/.config/extract/config.json` albo w
  zmiennych `JIRA_*`, `GITLAB_*`… Instrukcja: [`tools/alm/INSTRUKCJA.md`](tools/alm/INSTRUKCJA.md).
- **browser-inspector** (`tools/browser-inspector/`): `npm run browser-inspector -- read.config.browser-inspector.json`
  wykonuje flow (zrzuty, konsola, sieć, mapa elementów) i pisze `report.md`; `-- open <url>`, `find`, `click eN`,
  `snap`, `export flow.json` to sesja interaktywna — jedna linia na komendę, wynik na dysku.

Oba narzędzia mają blok instrukcji w `AGENTS.md` (≤ 600 bajtów, synchronizowany z kartą Copilota bramą) —
to cały ich koszt w sesji.

## GitLab CI

[`.gitlab-ci.yml`](.gitlab-ci.yml): `install` (cache npm z klucza lockfile'a) → `static`, `lint`, `typecheck`,
`test` (równolegle) → `build` (raz, `dist/` jako artefakt) → `e2e` (obraz Playwrighta na artefakcie). Merge
request weryfikuje projekty dotknięte zmianą (`--base=$CI_MERGE_REQUEST_DIFF_BASE_SHA`), gałąź domyślna
i harmonogram — wszystko; harmonogram dodaje `check:upstream`. Cache narzędzi (`.angular/cache`, `.cache/*`)
per gałąź z fallbackiem na gałąź domyślną. Żadnych sekretów do builda i testów, żadnej publikacji —
wydanie jest ręczne, po tagu. Konfiguracja projektu GitLab: [`docs/dev-setup.md`](docs/dev-setup.md).

## Czego tu nie ma i dlaczego

- **Nx** — [ADR](docs/decisions/2026-09-13_21-30_adr-angular-cli-workspace-without-nx.md): Nx Cloud zabroniony,
  a to, co z Nx było używane, robi jeden skrypt nad `angular.json` (`tools/scripts/affected.mjs`).
- **Prettier** — [ADR](docs/decisions/2026-09-13_21-31_adr-biome-instead-of-prettier.md).
- **Husky, lint-staged, GitHub Actions** — [ADR](docs/decisions/2026-09-13_21-32_adr-native-git-hooks-and-gitlab-ci.md).
- **Serwery MCP ALM i Playwright w sesji** — [ADR](docs/decisions/2026-09-13_21-33_adr-scripts-instead-of-mcp-servers.md).
- **Aplikacje** — repozytorium jest szablonem; pierwszą tworzy `npm run new:app`.
- **Angular Material / biblioteka komponentów** — decyzja zespołu; gdy padnie, Material importuje wyłącznie
  `libs/shared/ui` (reguła już stoi w `eslint.rules.mjs`).

## Licencja

UNLICENSED — do użytku wewnętrznego organizacji, która ten szablon adoptuje.
