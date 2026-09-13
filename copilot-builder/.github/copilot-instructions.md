# copilot-builder — karta dla GitHub Copilota

Ten plik dokleja się do każdego żądania, więc każda linia jest płacona przy każdej turze. Zostaje tu
wyłącznie to, co obowiązuje wszędzie: reguły ścieżkowe mieszkają w `.github/instructions/`, reguły ról
w `.github/agents/`, procedury w `.github/prompts/`, komendy i roster w [AGENTS.md](../AGENTS.md)
(VS Code ładuje go razem z tym plikiem — `chat.useAgentsMdFile`).

## Niezmienniki

1. **Runner** — `npm run <skrypt>` albo `node <plik>.mjs`. Bez globalnych CLI, bez `npx` z ruchomą
   wersją, bez pnpm i yarn (lockfile to `package-lock.json`). Angular CLI: `node node_modules/@angular/cli/bin/ng.js`.
2. **Definicja ukończenia** — `npm run verify` na zielono. Bram się nie pomija, hooków nie obchodzi.
3. **Tylko Copilot** — jedno źródło kontekstu. Nie ma tu `CLAUDE.md`, `.claude/`, `.cursor/`, `.ai/`
   (pilnuje `npm run guard:forbidden`).
4. **Jeden widoczny agent** — `orchestrator-sdd`. Reszta rosteru jest ukryta i pracuje przez delegację;
   ścieżka dotykanego pliku wyznacza wykonawcę (tabela routingu w `orchestrator-sdd`).
5. **MCP wyłącznie przez `mcp-gateway`** — żaden inny agent nie ma serwera MCP na liście `tools:`.
   Wynik wraca jako ścieżka artefaktu w `.mcp-artifacts/` plus streszczenie. Do ALM i przeglądarki
   służą skrypty (bloki niżej), nie serwery.
6. **Modele po tierach** — `T1` / `T2` / `T3` / `vision` rozwijają się do nazw wyłącznie
   w `.github/models-registry.json`. Nazwa modelu wpisana gdziekolwiek indziej jest usterką.
7. **Angular 22 na sygnałach** — standalone, `OnPush`, `inject()`, `input()`/`output()`, natywny
   control flow, zoneless (domyślne), Signal Forms z `@angular/forms/signals`; bez NgRx, bez
   `BehaviorSubject` jako magazynu stanu. Szczegóły: `.github/instructions/angular.instructions.md`.
8. **Granice modułów** — alias `@cb/<zakres>/<typ>[-<nazwa>]`, typ ∈ `feature | ui | data-access | util`;
   kierunek zależności pilnuje `eslint.rules.mjs`. Nikt nie importuje `src/` innego projektu.
9. **Język** — proza (dokumentacja, komentarze, teksty UI) po polsku; identyfikatory, ścieżki, commity
   po angielsku. Komentarz mówi DLACZEGO, nie co.
10. **Conventional Commits** — `type(scope): subject`, scope z `commitlint.config.mjs`. Agent proponuje
    commit, nigdy go nie wykonuje.
11. **STOP-AND-ASK** — niejednoznaczność zmieniająca zakres, koszt albo bezpieczeństwo zatrzymuje pracę
    z jedną skonsolidowaną listą pytań z opcjami i rekomendacją. Nie zgaduj.
12. **Zacznij od indeksu** — [CODE-INDEX.md](../CODE-INDEX.md) mówi, GDZIE coś jest,
    [GLOSSARY.md](../GLOSSARY.md), JAK to się nazywa. Otwieraj tylko to, co któryś z nich nazwie.

## Blok instrukcji `browser-inspector`

Równy co do znaku blokowi w `AGENTS.md` (`npm run check:instructions`, limit 600 bajtów).

<!-- INSTRUCTION:browser-inspector:START -->

> Przeglądarka: `npm run browser-inspector -- <config.json> [--stamp X]` wykonuje flow, wynik w `<outputDir>/<stamp>/<snapshot>/report.md` (`## errors`, `## values`; `## steps` tylko przy FAIL); nieudany krok = wynik, exit 0. Sesja: `… open <url>`, `… find <tekst>` / `… snap` dają refy `eN`; `… click|fill|form|press|select|wait|shot|eval|console|net` drukują jedną linię (exit 1 = FAIL); `… export flow.json` zapisuje sesję jako config. Wynik czytaj z dysku, nie wklejaj strony do kontekstu.

<!-- INSTRUCTION:browser-inspector:END -->

## Blok instrukcji `scribe` (ALM)

<!-- INSTRUCTION:scribe:START -->

> ALM (Jira i jej plugin Xray, Confluence, GitLab, Sonar, Figma, Miro): `npm run alm:read -- <źródło> [config.json] [--stamp X]` pisze snapshot do `.scribe/<źródło>/<stamp>/<snapshot>/` (`_manifest.json` + `<zasób>.md|.json`); czytaj manifest, potem tylko potrzebne pliki. Zapis: `npm run alm:create|alm:update -- <źródło> <plik.md>` z front matter wg `tools/scribe/templates/` — bez `--yes` dry-run z diffem; `--yes` tylko na wyraźne polecenie człowieka; usuwania nie ma.

<!-- INSTRUCTION:scribe:END -->
