# Instrukcje dla GitHub Copilota w tym repozytorium

Źródłem prawdy jest [AGENTS.md](../AGENTS.md) (VS Code ładuje go przez `chat.useAgentsMdFile`); ten plik
niesie tylko to, co Copilot ma wiedzieć w każdej rozmowie, i kanoniczną kopię bloku instrukcji niżej.
Reguły per obszar plików: `.github/instructions/*.instructions.md`; gotowe przepływy: `/migrate-from-mcp-playwright`
i `/browser-session` z `.github/prompts/`; bramki jako zadania VS Code: Terminal → Run Task (`verify`, `test`, `smoke`,
`bench`, `portable`, `browser-inspector: doctor|up|stop`).

## Co to jest

**scribe-devtools**: narzędzia deweloperskie w duchu scribe — skrypty zamiast serwerów MCP, wyniki na dysku, czytane
wybiórczo. `packages/browser-inspector/` to binarka **browser-inspector** (flow batch z configu JSON + sesja interaktywna
na refach `eN`, playwright-core z systemowym Chrome/Edge, ciepła przeglądarka w lokalnym keeperze); `bench/` mierzy ją
kontra `@playwright/mcp`. Kontrakt: `docs/DESIGN.md`; kroki: `docs/STEPS.md` (generowany).

## Blok instrukcji dla agenta używającego narzędzia (koszt stały, mierzony w benchu)

Ten blok jest co do znaku równy blokowi w `AGENTS.md` i stałej `INSTRUCTION` w `bench/browser-inspector-run.mjs`
(`scripts/check-instruction-sync.mjs` w `npm run verify` sprawdza wszystkie trzy; limit 200 tokenów o200k, AC-6).
Repozytorium aplikacji, które przechodzi z MCP Playwrighta, kopiuje go do swojego `.github/copilot-instructions.md`
bez zmian — każde dopisane zdanie to koszt w każdej sesji.

<!-- INSTRUCTION:START -->

> Przeglądarka: `browser-inspector <config.json> [--stamp X]` wykonuje flow, wynik w `<outputDir>/<stamp>/<snapshot>/report.md` (nagłówek, `## errors`, `## values`; `## steps` tylko przy FAIL); nieudany krok = wynik, exit 0. Sesja: `browser-inspector open <url>`, `browser-inspector find <tekst>` / `browser-inspector snap` dają refy `eN`; `browser-inspector click|fill|form|press|select|wait|shot|eval|console|net …` drukują jedną linię (exit 1 = FAIL); `browser-inspector export flow.json` zapisuje sesję jako config.

<!-- INSTRUCTION:END -->

## Blok instrukcji `nx-angular-inspector` (koszt stały, własne nazwane znaczniki)

Równy co do znaku blokowi w `AGENTS.md`. Znaczniki są nazwane, bo regex bramki łapie pierwszy nienazwany blok.
Limit 200 tokenów na blok (zmierzone 184), 400 na wszystkie razem.

<!-- INSTRUCTION:nx-angular-inspector:START -->

> Nx/Angular: `nx-angular-inspector env` · `projects [nazwa]` · `graph <projekt> [--reverse]` · `affected [--base <ref>]` · `gen [wzorzec|kolekcja:generator]` · `guide` · `run <projekt>:<target>`. Każda drukuje JEDNĄ linię (exit 1 = FAIL) zakończoną ścieżką pliku z całością w `.ws/` — odpowiedź jest w tym pliku, nie powtarzaj komendy; `projects <nazwa>` odpowiada samą linią. Komendy z grafu dopisują świeżość (`świeże`|`nieświeże`), `--fresh` przelicza. Tylko nx >= 23 i angular >= 22.

<!-- INSTRUCTION:nx-angular-inspector:END -->

## Zasady, których Copilot nie może złamać

- Pełna nazwa **browser-inspector** wszędzie (binarka, skrypty, `BROWSER_INSPECTOR_*`, pipe, teksty); skrót `bi`
  jest zakazany.
- Proza po polsku (README, docs, CHANGELOG, komunikaty dla użytkownika); identyfikatory i komentarze w kodzie po
  angielsku, komentarz mówi DLACZEGO. Czysty ESM `.mjs`, typy JSDoc, tylko wbudowane moduły Node ≥ 22 i
  `playwright-core` przypięty exact — żadnej nowej zależności.
- Sekrety wyłącznie przez `valueFromEnv` / `--env` / `@{NAZWA}`; żaden test, fixture ani prompt nie zawiera hasła.
- Nieudany krok flow to wynik w raporcie (exit 0), nie wyjątek; nigdy `networkidle` domyślnie; żadnych ścieżek DELETE.
- Generowanych nie edytuj ręcznie: `CODE-INDEX.md`, `docs/STEPS.md`, `bench/RAPORT.md|WYNIKI.md|BUDGET.md`, blok
  `BENCH` w README, `download/*.zip` — regeneruje `npm run code-index|docs|bench|portable` albo hook pre-commit.
- Przed oddaniem zmiany: `npm run verify` zielone (prettier 120 kolumn LF, vitest, `tsc --checkJs`, świeżość
  artefaktów, sync bloku). Zmiana kontraktu zaczyna się od `docs/DESIGN.md`; wpis do `CHANGELOG.md` (`Unreleased`)
  idzie razem ze zmianą.
- Nie commituj `.scribe-devtools/`, `bench/out/`, `read.config.*.json` (poza `fixtures/`, `examples/`) i nie ruszaj
  `download/` wydanej wersji (zip zamrożony po tagu).
