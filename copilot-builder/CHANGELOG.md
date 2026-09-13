# Changelog

Historia zmian szablonu. SemVer; wersja w `package.json`. Sekcja `Unreleased` rośnie razem ze zmianą,
nie przy tagowaniu. Wydanie: podbij `version`, przenieś `Unreleased` do sekcji z datą, tag `vX.Y.Z`.

## [Unreleased]

### Added

- Workspace Angular 22 (Angular CLI, `apps/` + `libs/`, bez Nx) z `npm run new:app` / `new:lib`,
  `affected.mjs` (graf z `angular.json` i aliasów, cache zadań) i `verify.mjs` jako definicją ukończenia.
- Konfiguracja GitHub Copilota: jeden widoczny `orchestrator-sdd`, ukryty roster `code-*` / `doc-*` /
  `mcp-gateway`, rejestr modeli z tierami, instrukcje ścieżkowe, prompty drabiny SDD, hooki.
- Metodyka SDD (`docs/sdd/`) ze scaffoldem `workflow:specify` i bramą `sdd:check`; artefakty lokalne.
- Wendorowane narzędzia: `tools/scribe` (snapshoty i zapis ALM) i `tools/browser-inspector`
  (przeglądarka przez skrypt), z blokami instrukcji synchronizowanymi bramą.
- GitLab CI (`.gitlab-ci.yml`) z cache bez usług zewnętrznych, affected na MR, build raz, e2e na artefakcie;
  szablony issue (spec) i MR (DoD).
- Biome jako formater, ESLint flat config (angular-eslint, typescript-eslint, sonarjs, unicorn…),
  commitlint, natywne hooki gita, piny wersji w jednym miejscu (`pins.config.mjs`) z bramą i zegarem
  zaległości.
- Sześć ADR-ów w `docs/decisions/` dokumentujących powyższe decyzje.
- Pre-commit: skan sekretów w stage'u (`check:secrets`), indeks kodu i kanon wersji regenerowane ze stage'a.
- `tools/scripts/workspace.config.mjs` — jedno miejsce prefiksu selektorów, zakresu aliasów i gałęzi domyślnej;
  `tools/scripts/lib/repo.mjs` i `tools/hooks/lib/payload.mjs` — wspólne pomocniki zamiast kopii.
- Testy narzędzi: `affected` na prawdziwych repozytoriach git, walidator konfiguracji Copilota na kopii
  konfiguracji, hooki na macierzy komend, serwer e2e, synchronizacja instrukcji, generator.

### Fixed (po niezależnym przeglądzie architektura / jakość / bezpieczeństwo)

- `affected`: brak bazy do porównania oznacza „wszystko”, nieistniejący `--base` to błąd (exit 2) — koniec
  cichego zielonego `pre-push`; ścieżki z polskimi znakami czytane bez cytowania; krawędzie ze `styles`/`assets`;
  linia komendy w hashu cache.
- CI: job `lint` uruchamia też `npm run lint` (narzędzia), klucz cache per job, raporty junit i pokrycie per
  projekt (`CB_PROJECT`), artefakty e2e zakotwiczone w korzeniu, nocny `npm audit` jako brama.
- Hooki: `guard-commands` parsuje komendę (segmenty, argv, wrappery `sudo`/`sh -c`/`cmd /c`/PowerShell) zamiast
  dopasowywać regex do linii; `deny-writes` jako allowlista narzędzi czytających; `format-on-edit` tylko po
  narzędziach edycji i po ścieżce bezwzględnej.
- `.vscode/settings.json`: denylista edycji obejmuje każdy plik, który auto-zatwierdzona komenda terminala
  wykonuje jako kod.
- `ai:validate` A13–A17: hook `deny-writes` u ról read-only, kształt komend hooków, zakaz `web`, serwer MCP
  z `node_modules` (bez `npx`), kompletna tabela routingu orkiestratora; `ng mcp --read-only`.
- `check:pins`: reguła TAG (tag obrazu Playwrighta ↔ pin) zamiast nieużywanych `mirrors`/`argv`; `sdd:check`
  nie rozbija `n/a` na agentów `n` i `a`; `serve-static` odpowiada 400/404 zamiast paść lub serwować
  `index.html` jako `.js`, nie podąża za dowiązaniami poza katalog.
- Generator: transakcyjny (rollback `angular.json`/`tsconfig.json` i katalogów), port e2e z nazwy (bez kolizji
  między gałęziami), walidacja `--prefix`, `--port`.
- Dokumentacja zgodna z kodem (pre-commit, `tsc --incremental`, liczby, Xray jako plugin Jiry).
