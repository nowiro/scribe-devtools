# Instrukcje dla GitHub Copilota w tym repozytorium

Źródłem prawdy jest [AGENTS.md](../AGENTS.md) (VS Code ładuje go przez `chat.useAgentsMdFile`); ten plik
niesie tylko to, co Copilot ma wiedzieć w każdej rozmowie, i kanoniczną kopię bloków instrukcji niżej.
Reguły per obszar plików: `.github/instructions/*.instructions.md`; gotowe przepływy: `/migrate-from-mcp-playwright`
i `/browser-session` z `.github/prompts/`; bramki jako zadania VS Code: Terminal → Run Task (`verify`,
`portable`, `code-index`, `browser-inspector: doctor|up|stop`, `nx-angular-inspector: help`).

## Co to jest

**scribe-devtools**: narzędzia deweloperskie w duchu scribe — skrypty zamiast serwerów MCP, wyniki na
dysku, czytane wybiórczo. `packages/browser-inspector/` to binarka **browser-inspector** (flow batch z
configu JSON + sesja interaktywna na refach `eN`, playwright-core z systemowym Chrome/Edge, ciepła
przeglądarka w lokalnym keeperze); `packages/nx-angular-inspector/` to binarka **nx-angular-inspector**
(graf Nx jako źródło prawdy, zero zależności runtime, tylko nx >= 23 i angular >= 22). Ta gałąź
(`copilot`) jest minimalna: kod narzędzi, skrypty, instrukcje i ustawienia Copilota — bez testów,
benchmarku i dokumentacji projektowej.

## Blok instrukcji dla agenta używającego `browser-inspector`

Ten blok jest co do znaku równy blokowi w `AGENTS.md` (`scripts/check-instruction-sync.mjs` w
`npm run verify` sprawdza równość; limit 200 tokenów o200k). Repozytorium aplikacji, które przechodzi
z MCP Playwrighta, kopiuje go do swojego `.github/copilot-instructions.md` bez zmian — każde dopisane
zdanie to koszt w każdej sesji.

<!-- INSTRUCTION:START -->

> Przeglądarka: `browser-inspector <config.json> [--stamp X]` wykonuje flow, wynik w `<outputDir>/<stamp>/<snapshot>/report.md` (nagłówek, `## errors`, `## values`; `## steps` tylko przy FAIL); nieudany krok = wynik, exit 0. Sesja: `browser-inspector open <url>`, `browser-inspector find <tekst>` / `browser-inspector snap` dają refy `eN`; `browser-inspector click|fill|form|press|select|wait|shot|eval|console|net …` drukują jedną linię (exit 1 = FAIL); `browser-inspector export flow.json` zapisuje sesję jako config.

<!-- INSTRUCTION:END -->

## Blok instrukcji `nx-angular-inspector` (własne nazwane znaczniki)

Równy co do znaku blokowi w `AGENTS.md`. Znaczniki są nazwane, bo regex bramki łapie pierwszy nienazwany blok.
Limit 200 tokenów na blok, 400 na wszystkie razem.

<!-- INSTRUCTION:nx-angular-inspector:START -->

> Nx/Angular: `nx-angular-inspector env` · `projects [nazwa]` · `graph <projekt> [--reverse]` · `affected [--base <ref>]` · `gen [wzorzec|kolekcja:generator]` · `guide` · `run <projekt>:<target>` · `serve [wait|stop] <projekt>`. Każda drukuje JEDNĄ linię (exit 1 = FAIL) zakończoną ścieżką pliku z całością w `.ws/` — odpowiedź jest w tym pliku, nie powtarzaj komendy; `projects <nazwa>` odpowiada samą linią. Komendy z grafu dopisują świeżość (`świeże`|`nieświeże`), `--fresh` przelicza. Tylko nx >= 23 i angular >= 22.

<!-- INSTRUCTION:nx-angular-inspector:END -->

## Zasady, których Copilot nie może złamać

- Pełne nazwy narzędzi wszędzie (binarki, skrypty, zmienne środowiskowe, pipe, teksty) — skróty
  są zakazane.
- Proza po polsku (README, AGENTS, komunikaty dla użytkownika); identyfikatory i komentarze w kodzie
  po angielsku, komentarz mówi DLACZEGO. Czysty ESM `.mjs`, typy JSDoc, tylko wbudowane moduły Node
  ≥ 22 i (dla browser-inspectora) `playwright-core` przypięty exact — żadnej nowej zależności bez
  wiersza w `scripts/pins.config.mjs`.
- Sekrety wyłącznie przez `valueFromEnv` / `--env` / `@{NAZWA}`; żaden config, prompt ani fixture
  nie zawiera hasła.
- Nieudany krok flow to wynik w raporcie (exit 0), nie wyjątek; nigdy `networkidle` domyślnie; żadnych
  ścieżek DELETE.
- Generowanych nie edytuj ręcznie: `CODE-INDEX.md`, `download/*.zip` — regeneruje
  `npm run code-index | portable` albo hook pre-commit.
- Przed oddaniem zmiany: `npm run verify` zielone (prettier 120 kolumn LF, `tsc --checkJs`, świeżość
  `CODE-INDEX.md`, sync bloków instrukcji, `check-pins`). Ta gałąź nie ma testów ani benchmarku —
  granice, które gdzie indziej pilnuje test (import klienta browser-inspectora, kształt raportu),
  sprawdzaj ręcznie przy review.
- Nie commituj `.scribe-devtools/`, `read.config.*.json` (poza `examples/`) i nie ruszaj `download/`
  ręcznie.
