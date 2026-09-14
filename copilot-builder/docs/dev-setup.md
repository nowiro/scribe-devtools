# Środowisko dewelopera i projekt GitLab

## Maszyna dewelopera

1. **Node 24** — wersja z `.nvmrc`; `nvm use` / `fnm use` / `volta pin` czytają ten plik. `engine-strict=true`
   w `.npmrc` zatrzymuje instalację na starszym Node zamiast pozwolić na błąd składni w cudzym pliku.
2. `npm ci` — instalacja z lockfile'a; `ignore-scripts=true` oznacza, że żadna zależność nie uruchamia
   skryptu instalacyjnego (binaria natywne Biome, esbuild i lightningcss przychodzą jako pakiety platformowe).
3. `npm run prepare` — **raz po klonie**: ustawia `core.hooksPath = .githooks` (pre-commit, commit-msg,
   pre-push). `npm install` tego nie zrobi (ignore-scripts); `npm run doctor` przypomina.
4. Playwright (e2e lokalnie): `node node_modules/@playwright/test/cli.js install chromium` — raz na maszynę,
   przy każdej zmianie wersji `@playwright/test`. Na CI robi to obraz Playwrighta.
5. `browser-inspector` używa **systemowego Chrome albo Edge** (nic nie pobiera); inna binarka przez
   `BROWSER_INSPECTOR_BROWSER_PATH`.
6. Poświadczenia ALM (`npm run alm:read`): `~/.config/extract/config.json` (Windows:
   `%USERPROFILE%\.config\extract\config.json`) albo zmienne `JIRA_BASE_URL` / `JIRA_EMAIL` / `JIRA_TOKEN`,
   `GITLAB_BASE_URL` / `GITLAB_TOKEN`, `CONFLUENCE_*`, `SONAR_*`. Nigdy w repozytorium. Szczegóły i tokeny
   o minimalnym zakresie: `tools/alm/INSTRUKCJA.md`.
7. VS Code: zainstaluj rozszerzenia polecane w `.vscode/extensions.json` (Biome, ESLint, Angular Language
   Service, Vitest, Playwright, Copilot Chat, EditorConfig). Ustawienia workspace'u są w repozytorium;
   preferencje osobiste trzymaj w profilu użytkownika.

### Windows

- **Dev Drive** (ReFS) na repozytoria i cache npm — kilkadziesiąt tysięcy plików w `node_modules` na NTFS
  z Defenderem kosztuje minuty przy każdym `npm ci`. Wykluczenia Defendera: `node_modules`, `.angular`,
  `.cache`, `dist`, katalog cache npm.
- `git config --global core.longpaths true` (ścieżki w `node_modules` przekraczają 260 znaków).
- `git config --global core.autocrlf false` — `.gitattributes` już wymusza LF; autocrlf tylko przeszkadza.
- Hooki `.githooks/*` to `sh` — Git for Windows dostarcza go; nic więcej nie trzeba instalować.
- Zmienne środowiskowe (`NODE_COMPILE_CACHE`, poświadczenia ALM) ustawiaj jako zmienne użytkownika —
  muszą istnieć ZANIM wystartuje terminal albo VS Code.

### Szybsze lokalne pętle (opcjonalnie)

- `NODE_COMPILE_CACHE=<repo>/.cache/node-compile` — Node zapisuje bytecode V8 załadowanych modułów, więc
  kolejny start `eslint`, `vitest`, `tsc` i CLI Angulara pomija parsowanie (CI ma to ustawione).
- `git config core.fsmonitor true`, `core.untrackedCache true`, `git maintenance start` — `git status` w dużym
  repo w milisekundach.
- `npm run affected -- test` zamiast pełnego `npm test` po zmianie w jednym projekcie; cache zadań w
  `.cache/tasks/` pomija zielone przebiegi na identycznych wejściach (`--no-cache` wymusza).

## Projekt GitLab

1. **Merge request pipelines**: Settings → Merge requests → „Pipelines must succeed"; workflow w
   `.gitlab-ci.yml` uruchamia pipeline dla MR, gałęzi domyślnej, harmonogramu i tagu (bez duplikatów
   branch + MR).
2. **Runnery**: docker executor z obrazem `node:24-bookworm-slim` i (job `e2e`) obrazem Playwrighta;
   dostęp do rejestru npm albo lustro przez zmienną CI/CD `npm_config_registry`. Tagi runnerów dopisz
   w `default.tags` albo per job — plik celowo ich nie zakłada.
3. **Cache**: distributed cache runnerów (S3/GCS/lokalny) — pipeline używa dwóch kluczy: npm z
   `package-lock.json` i `tools-<gałąź>` z fallbackiem na gałąź domyślną.
4. **Harmonogram** (CI/CD → Schedules): nocny — uruchamia pełny `verify` i `check:upstream` (raport
   zaległości pinów, WARN).
5. **Szablony**: `.gitlab/issue_templates/Default.md` (issue = specyfikacja SDD), `Bug.md`,
   `.gitlab/merge_request_templates/Default.md` (lista DoD). GitLab podpowiada je automatycznie.
6. **Ochrona gałęzi domyślnej**: tylko przez MR, „Pipelines must succeed", co najmniej jeden approve.
   Auto-cancel redundant pipelines włączony (`interruptible: true` w jobach).
7. **Zero sekretów** dla builda i testów. Token do `alm:read` w CI (gdyby snapshoty miały powstawać
   w pipeline'ie) — zmienna masked + protected, nigdy w repozytorium.
8. **Obrazy po digeście** (gdy jest lustro rejestru): tag `node:24-bookworm-slim` jest ruchomy; `docker buildx
   imagetools inspect node:24-bookworm-slim` podaje `sha256`, które wpisujesz jako `image: node:24-bookworm-slim@sha256:…`
   i bumpujesz razem z pinami. To samo dla obrazu Playwrighta w jobie `e2e`.
9. **Nocny `audit`**: `npm audit --audit-level=high --omit=dev` jest bramą harmonogramu (czerwony job = ktoś czyta
   raport), bo `.npmrc` wyłącza audit przy instalacji.

## Pliki workspace, których nie edytuje się ręcznie

- **`angular.json`** — rejestr projektów. Wpisy dodaje wyłącznie `npm run new:app` / `npm run new:lib`
  (generator Angular CLI + dopasowanie do tego repozytorium: target `test` na wspólnym runnerze Vitest,
  `outputPath` = `dist/apps/<nazwa>`, projekt e2e). `affected.mjs` czyta stąd graf projektów.
- **`tsconfig.json`** — plik „solution": `files` jest puste celowo, `references` wskazuje tsconfigi każdego
  projektu (`tsconfig.app.json`, `tsconfig.spec.json`, `tsconfig.lib.json`), a `compilerOptions.paths` to
  mapa granic monorepo — jeden alias na bibliotekę, zawsze do jej **źródeł** (`src/public-api.ts`), nigdy do
  `dist/`. Kształt aliasu `@cb/<zakres>/<typ>[-<nazwa>]` egzekwuje `eslint.rules.mjs` (kierunek zależności
  feature → ui/data-access/util). Plik jest czystym JSON-em bez komentarzy: Angular CLI przepisuje go przy
  każdym generatorze i komentarze by zgubił.
- **`CODE-INDEX.md`**, **`docs/tech-stack.md`** (blok AUTOGEN) — generowane; `npm run verify` pilnuje świeżości.

## Sekrety

Tokeny ALM (`JIRA_*`, `GITLAB_*`) żyją w zmiennych środowiskowych albo w `~/.config/extract/config.json`
(tryb `0600`), nigdy w repozytorium — `.gitignore` odrzuca `.env*`, `*.pem`, `*.key`, a hook pre-commit
(`npm run check:secrets`) zatrzymuje commit, w którym dodana linia wygląda jak token, klucz prywatny albo
przypisanie hasła. Linia, która świadomie pokazuje KSZTAŁT tokenu (dokumentacja, fixture), dostaje `secrets:ignore`.

## Aktualizacja wersji

`npm run check:upstream` (nocny job albo ręcznie) mówi, które piny są za `latest` i od kiedy. Bump to:
zmiana wersji w `package.json` → `npm install` → `npm run stack:sync` → `npm run verify` → ewentualne
poprawki prozy wskazane przez `check:pins` (LAG). Angular i jego CLI mają osobne wersje; TypeScript i Vitest
podążają za zakresem peer `@angular/build`. Decyzja „zostaję w tyle" to `npm run check:upstream -- --ack <pakiet>`
— commituje się jak lockfile.

## Powiązane

- [README.md](../README.md) — start i komendy
- [tech-stack.md](tech-stack.md) — kanon wersji
- [decisions/](decisions/) — ADR-y
