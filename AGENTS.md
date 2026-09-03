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

## Znane granice `nx-angular-inspector` — nazwane, nie ukryte

- **Tani stempel świeżości nie widzi edycji istniejącego pliku.** Krawiedzie grafu biorą się
  z importów, a zmiana `import` w pliku, który już istnieje, nie rusza mtime żadnego katalogu
  (sprawdzone na NTFS). Domyślny stempel chodzi po katalogach — **18 ms**, łapie dodanie, usunięcie
  i zmianę nazwy pliku oraz nowy projekt gdziekolwiek. `--deep` dokłada mtime plików — **275 ms**
  przy 20 000 plików. Obie liczby zmierzone; wybór należy do wołającego, a `env` drukuje tę lukę.
- **Limit 120 znaków na linię jest twardy** i pilnuje go `formatLine`, który **nigdy nie tnie
  dwóch ostatnich części** (werdyktu i ścieżki).
- **`project-graph.json` to prywatny kontrakt Nx.** Asertujemy `version` (`"6.0"`); nieznana wartość
  to werdykt `nieznany format` i fallback do CLI — wolniej, nigdy źle.
- **`docs` nie istnieje.** Wymagałoby klucza Algolii osadzonego w angular.dev, który może się
  zrotować, i endpointu nx.dev — czyli dokładnie tego cichego dryfu, przed którym ostrzega instrukcja
  wyżej. Blok instrukcji jest przy tym blisko sufitu (200 tokenów): `docs` nie zmieści się bez
  skrócenia czegoś innego, i to jest zamierzone.

## Bramki — uruchamiaj PRZED uznaniem zmiany za skończoną

| komenda | co pilnuje |
| --- | --- |
| `npm run verify` | wszystko poniżej, w tej kolejności |
| `prettier --check .` | format: 120 kolumn, LF, pojedyncze cudzysłowy (`.prettierignore`: proza z wąskimi tabelami, generowane) |
| `node scripts/check-pins.mjs` | `scripts/pins.config.mjs` to jedyne miejsce, gdzie wersja zależności jest **deklarowana**. Bramka jest offline i deterministyczna: META — każda zależność w każdym manifeście ma wiersz, i odwrotnie; SHAPE — `exact` znaczy goły numer, `caret` znaczy `^`; FLOOR — `minSupported` jako podłoga (`playwright-core >= 1.62.1`), która **nie** rozluźnia `exact`; LAG — proza cytująca inną wersję niż pin. Bramka **wskazuje, nie przepisuje**: świadomy cytat starej wersji zwalnia `pins:ignore` w linii |
| `tsc --noEmit` | typy z JSDoc (`checkJs`) w `packages/**`, `scripts/**` |
| `node scripts/index-code.mjs --check` | świeżość `CODE-INDEX.md` |
| `node scripts/check-instruction-sync.mjs` | każdy blok instrukcji ≡ jego kopia w `.github/copilot-instructions.md`; limit 200 tokenów na blok i 400 na wszystkie razem. Blok nieobecny w OBU plikach jest pomijany; obecny w jednym i brakujący w drugim to FAIL |

**Poza `npm run verify`, bo dotyka sieci:** `node scripts/check-upstream.mjs` — kalendarzowa połowa
doktryny aktualności, dopełnienie `check-pins`. Pyta rejestr npm o `dist-tags.latest` dla każdego
pinu i mierzy, od kiedy pin jest za `latest` — **od `firstSeenBehind`, nie od daty wydania
`latest`**, bo ta resetuje się przy każdym release'ie niezależnie od tego, czy jesteśmy jedną
wersją w tyle czy dziesięcioma. Zegar żyje w commitowanym `scripts/upstream-state.json` i przeżywa
między uruchomieniami: samo odpalenie skryptu **nie** przesuwa `firstSeenBehind`. WARN dopiero po
przekroczeniu `staleDays` z wiersza pinu; exit 1 tylko z `--strict`. WARN nie znaczy „błąd" —
`@types/node` jest przypięty na majorze 22 **celowo** (`pins.config.mjs` mówi dlaczego) i będzie
WARN-ował co `staleDays` bez końca; `--ack <id|all>` to zapis decyzji człowieka „widziałem,
zostaję" — resetuje zegar tylko dla pinu, który faktycznie jest za `latest`, i tylko wtedy, gdy
ktoś o to świadomie poprosi.

Ta gałąź nie ma zestawu testów ani benchmarku — nie ma więc `vitest run`, `npm run smoke` ani
projektu `compat` w `npm run verify`. Reguły, które gdzie indziej pilnuje test (granica importów
klienta browser-inspectora, kształt `report.json`, zgodność z app-factory), tu trzeba pilnować
ręcznie przy review — patrz [.github/instructions/source.instructions.md](.github/instructions/source.instructions.md).

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

- Nie commituj wyników: `.scribe-devtools/`, `read.config.*.json` (poza `examples/`) — to zrzuty
  i sesje cudzej aplikacji.
- Nie dodawaj ścieżek DELETE — jedyne czyszczenie to `storage … clear` w piaskownicy
  własnego kontekstu i scrub między przebiegami.
- Sekrety wyłącznie przez zmienne środowiskowe (`valueFromEnv`, `--env`, `@{NAZWA}`) —
  literał w `auth.login` ma być błędem walidacji; keeper nigdy nie dostaje `env`.
- Nie importuj `playwright-core` ani żadnego modułu silnika (`engine.mjs`, `lanes.mjs`, `flow.mjs`,
  `session.mjs`, `steps.ctx.mjs`, `steps.run.mjs`) w kliencie (`bin/browser-inspector.mjs`,
  `src/client.mjs`) — budżet startu klienta to 72 ms; ta gałąź nie ma testu `client-imports`, więc
  pilnuj tego ręcznie przy review.
- Nie używaj `networkidle` domyślnie, `isTTY` do czegokolwiek, ping-pongu kart ani
  `about:blank` między przebiegami.
- Nieudany krok to wynik w raporcie (exit 0 w batchu), nie wyjątek.
- Nie instaluj zależności z lifecycle scriptami bez namysłu — `.npmrc` ma `ignore-scripts=true`
  i to jest bezpiecznik, nie przeszkoda.
- Duże wyniki zostawiaj na dysku, nie w oknie kontekstu — to jest teza całego repo.

## Gdzie co jest

Mapa zależności: [CODE-INDEX.md](CODE-INDEX.md). Opis narzędzi i użycie: [README.md](README.md).

Copilot i VS Code: `.github/copilot-instructions.md` (karta repo + kopia bloków instrukcji),
`.github/instructions/*.instructions.md` (reguły per obszar plików), `.github/prompts/*.prompt.md`
(`/migrate-from-mcp-playwright` — migracja repozytorium aplikacji z MCP Playwrighta;
`/browser-session` — pętla sesji), `.vscode/tasks.json` (bramki i komendy narzędzia jako
zadania), `.vscode/settings.json` (prettier, prompt files, AGENTS.md).
