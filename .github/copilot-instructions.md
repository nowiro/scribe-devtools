# Instrukcje dla GitHub Copilota w tym repozytorium

Źródłem prawdy jest [AGENTS.md](../AGENTS.md) — VS Code ładuje go razem z tym plikiem (`chat.useAgentsMdFile`),
więc ten plik go nie powtarza: niesie kartę repo w dwóch zdaniach, jedną regułę, której AGENTS.md nie ma, i
kanoniczną kopię bloków instrukcji obu narzędzi. Reguły per obszar plików: `.github/instructions/*.instructions.md`;
przepływy: `/migrate-from-mcp-playwright`, `/browser-session`, `/perf-optimize`; bramki jako zadania VS Code:
Terminal → Run Task (`verify`, `claims`, `portable`, `code-index`, `browser-inspector: doctor|up|stop`,
`nx-angular-inspector: help`).

**scribe-devtools**: skrypty zamiast serwerów MCP, wyniki na dysku. `packages/browser-inspector/` — binarka
**browser-inspector** (flow batch z configu JSON + sesja na refach `eN`, playwright-core z systemowym Chrome/Edge);
`packages/nx-angular-inspector/` — binarka **nx-angular-inspector** (graf Nx jako źródło prawdy, zero zależności
runtime, tylko nx >= 23 i angular >= 22). Repozytorium jest minimalne: kod narzędzi, skrypty, instrukcje i
ustawienia Copilota — bez testów, benchmarku i dokumentacji projektowej.

- Pełne nazwy narzędzi wszędzie (binarki, skrypty, zmienne środowiskowe, pipe, teksty) — skróty są zakazane.
- Zanim zaczniesz szukać w drzewie, przeczytaj [CODE-INDEX.md](../CODE-INDEX.md) (gdzie co jest) i
  [GLOSSARY.md](../GLOSSARY.md) (jak to się nazywa); otwieraj tylko to, co nazwą.

## Blok instrukcji `browser-inspector`

Co do znaku równy blokowi w `AGENTS.md` (`scripts/check-instruction-sync.mjs` w `pnpm run verify`; limit 200 tokenów
o200k). Repozytorium aplikacji kopiuje go STĄD bez zmian — każde dopisane zdanie to koszt w każdej sesji.

<!-- INSTRUCTION:START -->

> Przeglądarka: `browser-inspector <config.json> [--stamp X]` wykonuje flow, wynik w `<outputDir>/<stamp>/<snapshot>/report.md` (nagłówek, `## errors`, `## values`; `## steps` tylko przy FAIL); nieudany krok = wynik, exit 0. Sesja: `browser-inspector open <url>`, `browser-inspector find <tekst>` / `browser-inspector snap` dają refy `eN`; `browser-inspector click|fill|form|press|select|wait|shot|eval|console|net …` drukują jedną linię (exit 1 = FAIL); `browser-inspector export flow.json` zapisuje sesję jako config.

<!-- INSTRUCTION:END -->

## Blok instrukcji `nx-angular-inspector` (nazwane znaczniki)

Równy co do znaku blokowi w `AGENTS.md`; limit 200 tokenów na blok, 400 na wszystkie razem.

<!-- INSTRUCTION:nx-angular-inspector:START -->

> Nx/Angular: `nx-angular-inspector env` · `projects [nazwa]` · `graph <projekt> [--reverse]` · `affected [--base <ref>]` · `gen [wzorzec|kolekcja:generator]` · `guide` · `run <projekt>:<target>` · `serve [wait|stop] <projekt>`. Każda drukuje JEDNĄ linię (exit 1 = FAIL) zakończoną ścieżką pliku z całością w `.ws/` — odpowiedź jest w tym pliku, nie powtarzaj komendy; `projects <nazwa>` odpowiada samą linią. Komendy z grafu dopisują świeżość (`świeże`|`nieświeże`), `--fresh` przelicza. Tylko nx >= 23 i angular >= 22.

<!-- INSTRUCTION:nx-angular-inspector:END -->
