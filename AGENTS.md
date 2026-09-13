# Instrukcje dla agenta pracującego w tym repozytorium

To repozytorium to **scribe-devtools**: narzędzia deweloperskie w duchu scribe — skrypty
zamiast serwerów MCP, wyniki na dysku, „banalnie proste". Ta gałąź (`copilot`) to minimalna
wersja pod GitHub Copilota: sam kod narzędzi, skrypty, instrukcje i ustawienia Copilota/VS Code —
bez testów, benchmarku i długiej dokumentacji projektowej.

- `packages/browser-inspector/` — binarka `browser-inspector`: flow batch z configu JSON
  (drop-in dla bramki app-factory) i sesja interaktywna na refach `eN`, jedna tabela
  kroków (`STEPS`), jeden silnik na playwright-core z systemowym Chrome/Edge, ciepła
  przeglądarka w lokalnym keeperze. Jak używać: [README.md](README.md), szablon flow:
  [packages/browser-inspector/templates/flow.md](packages/browser-inspector/templates/flow.md).
- `packages/nx-angular-inspector/` — binarka `nx-angular-inspector`: to, co odpowiadają `ng mcp` i
  `nx-mcp`, bez serwera MCP. Graf Nx jako źródło prawdy, stempel świeżości, fallback do CLI, zero
  zależności runtime. Wspierane **tylko** nx >= 23 i angular >= 22.

Proza po polsku (README, AGENTS), identyfikatory i komentarze w kodzie po
angielsku (komentarz mówi DLACZEGO, nie co). Kod to czysty ESM `.mjs` bez kroku budowania; typy
przez JSDoc, sprawdzane `tsc --checkJs`. Tylko wbudowane moduły Node i (dla browser-inspectora)
`playwright-core`.

## Instrukcja dla agenta używającego `browser-inspector`

Ten blok jest cytowany co do znaku przez `INSTRUCTION` w `.github/copilot-instructions.md`
(kopia dla Copilota i dla repozytoriów aplikacji). Zmieniasz go tu → zmieniasz tam;
`scripts/check-instruction-sync.mjs` w `npm run verify` pilnuje równości i limitu 200 tokenów o200k.

<!-- INSTRUCTION:START -->
> Przeglądarka: `browser-inspector <config.json> [--stamp X]` wykonuje flow, wynik w `<outputDir>/<stamp>/<snapshot>/report.md` (nagłówek, `## errors`, `## values`; `## steps` tylko przy FAIL); nieudany krok = wynik, exit 0. Sesja: `browser-inspector open <url>`, `browser-inspector find <tekst>` / `browser-inspector snap` dają refy `eN`; `browser-inspector click|fill|form|press|select|wait|shot|eval|console|net …` drukują jedną linię (exit 1 = FAIL); `browser-inspector export flow.json` zapisuje sesję jako config.
<!-- INSTRUCTION:END -->

## Instrukcja dla agenta używającego `nx-angular-inspector`

Ten sam mechanizm, własne **nazwane** znaczniki — regex bramki łapie pierwszy NIENAZWANY blok, więc
drugi musi się nazwać. Kopia w `.github/copilot-instructions.md`, porównywana znak po znaku.
Limit 200 tokenów na blok i **400 na wszystkie razem**: agent czyta każdy blok, więc sam limit
per blok pozwalałby rość kosztowi stałemu o jedno narzędzie naraz, nie czerwieniąc nigdy żadnej
bramki.

<!-- INSTRUCTION:nx-angular-inspector:START -->
> Nx/Angular: `nx-angular-inspector env` · `projects [nazwa]` · `graph <projekt> [--reverse]` · `affected [--base <ref>]` · `gen [wzorzec|kolekcja:generator]` · `guide` · `run <projekt>:<target>` · `serve [wait|stop] <projekt>`. Każda drukuje JEDNĄ linię (exit 1 = FAIL) zakończoną ścieżką pliku z całością w `.ws/` — odpowiedź jest w tym pliku, nie powtarzaj komendy; `projects <nazwa>` odpowiada samą linią. Komendy z grafu dopisują świeżość (`świeże`|`nieświeże`), `--fresh` przelicza. Tylko nx >= 23 i angular >= 22.
<!-- INSTRUCTION:nx-angular-inspector:END -->

Znane granice `nx-angular-inspector` (stempel świeżości a edycja pliku, twardy limit 120 znaków, prywatny
kontrakt `project-graph.json`, brak `docs`):
[.github/instructions/nx-angular-inspector.instructions.md](.github/instructions/nx-angular-inspector.instructions.md)
— Copilot dołącza go sam, gdy edytujesz ten pakiet.

## Bramki — uruchamiaj PRZED uznaniem zmiany za skończoną

| komenda | co pilnuje |
| --- | --- |
| `npm run verify` | wszystko poniżej, w tej kolejności |
| `biome format .` | format: 120 kolumn, LF, pojedyncze cudzysłowy, przecinki końcowe wszędzie (`biome.jsonc`; wykluczenia — bliźniak dawnego `.prettierignore` — w `files.includes`). Zastąpił prettiera: te same liczby, ten sam styl, na tym drzewie różnica wyszła w JEDNEJ linii na 62 plikach. **Markdownu Biome nie formatuje** — schemat konfiguracji 2.x zna `css`, `graphql`, `grit`, `html`, `javascript` i `json`, sekcji `markdown` nie ma. Dziewięć plików prozy (`CLAUDE.md`, `.github/**/*.md`, `templates/flow.md`), które wcześniej pilnowała bramka, pilnuje teraz review; `README.md` i `AGENTS.md` były poza formaterem i wcześniej |
| `node scripts/check-pins.mjs` | `scripts/pins.config.mjs` to jedyne miejsce, gdzie wersja zależności jest **deklarowana**. Bramka jest offline i deterministyczna: META — każda zależność w każdym manifeście ma wiersz, i odwrotnie; SHAPE — `exact` znaczy goły numer, `caret` znaczy `^`; FLOOR — `minSupported` jako podłoga (`playwright-core >= 1.62.1`), która **nie** rozluźnia `exact`; LAG — proza cytująca inną wersję niż pin. Bramka **wskazuje, nie przepisuje**: świadomy cytat starej wersji zwalnia `pins:ignore` w linii |
| `tsc --noEmit` | typy z JSDoc (`checkJs`) w `packages/**`, `scripts/**` |
| `node scripts/index-code.mjs --check` | świeżość `CODE-INDEX.md` |
| `node scripts/check-instruction-sync.mjs --require-all` | każdy blok instrukcji ≡ jego kopia w `.github/copilot-instructions.md`; limit 200 tokenów na blok i 400 na wszystkie razem. Obecny w jednym i brakujący w drugim to FAIL; `--require-all` robi FAIL także z bloku brakującego w OBU plikach — bez tego skasowanie obu kopii przechodziłoby jako „pominięty” |

**Poza `npm run verify`, bo dotyka sieci:** `node scripts/check-upstream.mjs` — pyta rejestr npm o `latest` dla
każdego pinu i mierzy, od kiedy pin jest w tyle (zegar `firstSeenBehind` w commitowanym
`scripts/upstream-state.json`, nie data wydania `latest`). WARN po `staleDays` z wiersza pinu, exit 1 tylko ze
`--strict`; `--ack <id|all>` to świadoma decyzja „widziałem, zostaję". `@types/node` WARN-uje celowo
(`pins.config.mjs` mówi dlaczego). Reszta w nagłówku skryptu.

Ta gałąź nie ma testów ani benchmarku: reguły, które na `main` pilnuje test, tu pilnuje review — lista w
[.github/instructions/source.instructions.md](.github/instructions/source.instructions.md). Komentarze w kodzie
odwołują się do `docs/DESIGN.md §n`, `docs/handoff/WPn.md` i testów (`test/…`, `FakePage`) — to pliki gałęzi
`main`; kod jest ten sam, dokumentów tu nie ma.

Hook `.githooks/pre-commit` regeneruje `CODE-INDEX.md` przed każdym commitem. Uzbraja go
`npm run prepare` — **jawnie**, bo `.npmrc` ma `ignore-scripts=true` i `npm install` skryptu
`prepare` nie uruchamia.

## Artefakty GENEROWANE — nigdy nie edytuj ręcznie

| plik | regeneruje | kiedy |
| --- | --- | --- |
| `CODE-INDEX.md` | `npm run code-index` (albo hook) | każda zmiana `.mjs` w `packages/*/src`, `packages/*/bin`, `scripts` |
| `download/scribe-devtools-portable-<wersja>.zip` + `.sha256` | `npm run portable`, na żądanie | JEDEN zip niesie OBA narzędzia (`browser-inspector`, `nx-angular-inspector`) pod JEDNĄ wersją — korzeń i oba `packages/*/package.json` muszą się zgadzać, inaczej build odmawia; bajty deterministyczne |
| `scripts/upstream-state.json` | `node scripts/check-upstream.mjs` (dopisuje/kasuje wiersze, nie zastępuje pliku w całości) | za każdym uruchomieniem; commituje się jak lockfile — diff jest **zapisem decyzji**, nie tylko danymi |

Ręczna edycja któregokolwiek z nich to błąd — zostanie nadpisana albo obleje bramkę.

## Czego nie robić

- Nie commituj wyników: `.scribe-devtools/`, `read.config.*.json` — to zrzuty i sesje cudzej aplikacji.
- Nie dodawaj ścieżek DELETE — jedyne czyszczenie to `storage … clear` w piaskownicy
  własnego kontekstu i scrub między przebiegami.
- Sekrety wyłącznie przez zmienne środowiskowe (`valueFromEnv`, `--env`, `@{NAZWA}`) —
  literał w `auth.login` ma być błędem walidacji; keeper nigdy nie dostaje `env`.
- Nie importuj `playwright-core` ani żadnego modułu silnika (`engine.mjs`, `lanes.mjs`, `flow.mjs`,
  `session.mjs`, `steps.ctx.mjs`, `steps.run.mjs`) w kliencie (`bin/browser-inspector.mjs`,
  `src/client.mjs`) — budżet startu klienta to 72 ms.
- Nie używaj `networkidle` domyślnie, `isTTY` do czegokolwiek, ping-pongu kart ani
  `about:blank` między przebiegami.
- Nieudany krok to wynik w raporcie (exit 0 w batchu), nie wyjątek.
- Nie instaluj zależności z lifecycle scriptami bez namysłu — `.npmrc` ma `ignore-scripts=true`
  i to jest bezpiecznik, nie przeszkoda.
- Duże wyniki zostawiaj na dysku, nie w oknie kontekstu — to jest teza całego repo.

## Gdzie co jest

Mapa importów całego repo (≈ 6 k tokenów — czytaj, gdy potrzebujesz jej całej, nie zamiast wyszukiwania):
[CODE-INDEX.md](CODE-INDEX.md). Opis narzędzi i użycie: [README.md](README.md). Pliki Copilota i VS Code
(`.github/`, `.vscode/`): sekcja „GitHub Copilot i VS Code" w README.
