# Changelog

Historia zmian szablonu. SemVer; wersja w `package.json`. Sekcja `Unreleased` rośnie razem ze zmianą,
nie przy tagowaniu. Wydanie: podbij `version`, przenieś `Unreleased` do sekcji z datą, tag `vX.Y.Z`.

## [Unreleased]

### Added

- Workspace Angular 22 (Angular CLI, `apps/` + `libs/`, bez Nx) z `npm run new:app` / `new:lib`,
  `affected.mjs` (graf z `angular.json` i aliasów, cache zadań) i `verify.mjs` jako definicją ukończenia.
- Konfiguracja GitHub Copilota: jeden widoczny `orchestrator`, ukryty roster `code-*` / `doc-*` /
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

### Changed

- Review kodu to weryfikacja krzyżowa przez trzy rodziny modeli zamiast jednego `code-reviewer`:
  `code-reviewer-anthropic`, `code-reviewer-openai`, `code-reviewer-moonshot` dostają ten sam brief i pełny zakres, różnią się
  wyłącznie rodziną modelu (tiery `main-anthropic` / `main-openai` / `main-moonshot`, `review.seats` w rejestrze); orkiestrator scala
  trzy tabele z liczbą zgodnych rodzin, `ai:validate` A18 odrzuca dwa miejsca na jednej rodzinie. ADR
  w `docs/decisions/`.
- Widoczny orkiestrator nazywa się `orchestrator` (było `orchestrator-sdd`); wzorzec nazw w rejestrze
  dopuszcza gołe `orchestrator` dla jedynego koordynatora.
- `code-reviewer-ui` ocenia zrzuty na pięciu szerokościach `ui.viewports` względem makiety: odstępy,
  wyrównania w pionie i poziomie, nachodzenie i obcięcie, scroll, stany; pomiary z flow browser-inspectora
  (`resize`, `screenshot`, `evaluate`). `code-tester-e2e` asertuje brak nachodzenia i dojście scrolla do końca.
- Nowy agent `scm-git` (rola `scm`, fast): ukończone zadanie planu commituje agent — tylko pliki zadania,
  hooki gita jako brama, bez push / amend / `--no-verify`; plan ma kolumnę `commit`, zadanie bez SHA nie jest
  `done`. Niezmiennik „agent nigdy nie commituje" zastąpiony (ADR); push i tag zostają przy człowieku.
- Brama STOP: werdykt **STOP** `doc-reviewer` (dokumentacja, makiety, AC ↔ makieta) i każdy STOP-AND-ASK
  kończą turę orkiestratora — lista pytań i czekanie na odpowiedź operatora, bez delegacji do tego czasu.
- Skill `mermaid-diagrams` (`.github/skills/`): diagramy w `.md` w Mermaid — typ do treści, reguły nazw,
  sprawdzenie renderu; `doc-spec` je pisze, `doc-reviewer` sprawdza; rozszerzenie podglądu w `.vscode/extensions.json`.
- Tiery mają ludzkie nazwy: `fast` (mechanika), `base` (kod i spec), `main-<rodzina>` (miejsca review, po
  jednym na rodzinę modelu), `vision`; miejsca review nazwane po rodzinie (`code-reviewer-anthropic`,
  `code-reviewer-openai`, `code-reviewer-moonshot`) — `review.seats` mówi, którą rodzinę miejsce obiecuje,
  A18 sprawdza obietnicę.
- Routing i scalanie review jako skrypty (0 kredytów): `tools/scripts/routing.config.mjs` jest jedynym źródłem
  „kto dotyka czego", `npm run route -- <ścieżki>` (także `--changed`) odpowiada z niego, a tabela w pliku
  orkiestratora jest generowana (`npm run route -- --sync`) i pilnowana bramą A19. `npm run review:merge`
  łączy raporty trzech miejsc review w jedną tabelę z liczbą zgodnych rodzin, konfliktami 🔴/🟢 i werdyktem
  najgorszym z trzech — orkiestrator czyta wynik, nie trzy tabele.
- Orkiestrator na tierze `fast`: jego plik jest procedurą (krok 0 „co przyszło → co robisz", kroki 1–9
  drabiny z warunkiem wejścia, dokładnymi komendami i wyjściem, stały szablon briefu, review w 8 krokach, krok
  commit, jedyny kształt STOP, format run-logu, lista „nigdy"), a opis każdego subagenta ma szablon
  „wejście / wyjście / nigdy" — tani model orkiestruje po procedurze, nie po wyczuciu.
- Miejsca review na tańszym modelu każdej rodziny: niezależność bierze się z rodzin, nie z flagowych modeli,
  więc rejestr wskazuje tańsze modele tej samej rodziny (wg cennika GitHuba z 2026-09-14 trzy odczyty kosztują
  około 2,4× mniej), a dwa najdroższe modele zniknęły z polityki rejestru — brama A2 nie pozwoli wskazać ich tierem.
- Słabsze modele w każdym tierze (`base` i miejsca review na najtańszych modelach swoich rodzin) i to, co pozwala
  im sobie radzić: `npm run sdd -- next|brief|task|log` (tools/scripts/sdd.mjs) wybiera zadanie, buduje brief
  z wiersza planu i AC ze spec, zmienia status i SHA zadania, dopisuje wiersz run-logu — model nie edytuje
  tabel; plan ma kolumnę `paths`, a `sdd:check` (C5) sprawdza, że `agent` równa się `route` dla tych ścieżek;
  wykonawcy, verifier i doc-spec mają sztywny wzór zwrotu (PLIKI / BRAMA / UWAGI); brief bez PLIKI, AC albo
  BRAMA to `STOP — brakuje`; skill `sdd-scripts` z tabelą komend; wspólny parser tabel `lib/md-table.mjs`.

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
