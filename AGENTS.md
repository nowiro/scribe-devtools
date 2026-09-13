# Instrukcje dla agenta pracującego w tym repozytorium

To repozytorium to **scribe-devtools**: narzędzia deweloperskie w duchu scribe — skrypty
zamiast serwerów MCP, wyniki na dysku, „banalnie proste". Dwie części:

- `packages/browser-inspector/` — **browser-inspector 2**, binarka `browser-inspector`: flow batch z configu
  JSON (drop-in dla bramki app-factory) i sesja interaktywna na refach `eN`, jedna tabela
  kroków (`STEPS`), jeden silnik na playwright-core z systemowym Chrome/Edge, ciepła
  przeglądarka w lokalnym keeperze. Projekt: [docs/DESIGN.md](docs/DESIGN.md) — to jest
  kontrakt; plan pakietów: [docs/PLAN.md](docs/PLAN.md); kryteria: [docs/ACCEPTANCE.md](docs/ACCEPTANCE.md);
  jak używać: [README.md](README.md), szablon flow: [packages/browser-inspector/templates/flow.md](packages/browser-inspector/templates/flow.md).
- `packages/nx-angular-inspector/` — binarka `nx-angular-inspector`: to, co odpowiadają `ng mcp` i
  `nx-mcp`, bez serwera MCP. Graf Nx jako źródło prawdy, stempel świeżości, fallback do CLI, zero
  zależności runtime. Wspierane **tylko** nx >= 23 i angular >= 22. Rozpoznanie i projekt:
  [docs/research/NX-ANGULAR-MCP.html](docs/research/NX-ANGULAR-MCP.html).
- `bench/` — pomiar czasu i tokenów `browser-inspector` kontra `@playwright/mcp` (przypięte 0.0.80).

Proza po polsku (README, AGENTS, CHANGELOG, docs), identyfikatory i komentarze w kodzie po
angielsku (komentarz mówi DLACZEGO, nie co). Kod to czysty ESM `.mjs` bez kroku budowania; typy
przez JSDoc, sprawdzane `tsc --checkJs`. Tylko wbudowane moduły Node i `playwright-core`.

## Instrukcja dla agenta używającego `browser-inspector` (koszt stały, mierzony)

Ten blok jest cytowany co do znaku przez `INSTRUCTION` w `bench/browser-inspector-run.mjs` oraz w
`.github/copilot-instructions.md` (kopia dla Copilota i dla repozytoriów aplikacji) i policzony
w benchu jako koszt stały (limit **200 tokenów o200k** — AC-6; zmierzone 158). Limit był 150 —
podniesiony, bo pełna nazwa `browser-inspector` zamiast skrótu kosztuje tokeny i właściciel je
płaci świadomie; blok ma być tak krótki, jak pełna nazwa pozwala. Zmieniasz go tu → zmieniasz
tam; `scripts/check-instruction-sync.mjs` w `npm run verify` pilnuje równości.

<!-- INSTRUCTION:START -->
> Przeglądarka: `browser-inspector <config.json> [--stamp X]` wykonuje flow, wynik w `<outputDir>/<stamp>/<snapshot>/report.md` (nagłówek, `## errors`, `## values`; `## steps` tylko przy FAIL); nieudany krok = wynik, exit 0. Sesja: `browser-inspector open <url>`, `browser-inspector find <tekst>` / `browser-inspector snap` dają refy `eN`; `browser-inspector click|fill|form|press|select|wait|shot|eval|console|net …` drukują jedną linię (exit 1 = FAIL); `browser-inspector export flow.json` zapisuje sesję jako config.
<!-- INSTRUCTION:END -->

## Instrukcja dla agenta używającego `nx-angular-inspector` (koszt stały, mierzony)

Ten sam mechanizm, własne **nazwane** znaczniki — regex bramki łapie pierwszy NIENAZWANY blok, więc
drugi musi się nazwać. Kopia w `.github/copilot-instructions.md`, porównywana znak po znaku.
Limit 200 tokenów na blok (zmierzone 195) i **400 na wszystkie razem** (dziś 353): agent czyta każdy
blok, więc sam limit per blok pozwalałby rość kosztowi stałemu o jedno narzędzie naraz, nie czerwieniąc
nigdy żadnej bramki. Blok nie wymienia `docs` — tej komendy jeszcze nie ma, a instrukcja opisuje to, co działa,
nie plan. `affected` nie zastępuje niczego z żadnego serwera MCP: żaden go nie ma. **Blok jest
blisko sufitu** (195 z 200) — `docs` nie zmieści się bez skrócenia czegoś innego, i to jest
zamierzone: limit ma zmuszać do wyboru, a nie ustępować.

<!-- INSTRUCTION:nx-angular-inspector:START -->
> Nx/Angular: `nx-angular-inspector env` · `projects [nazwa]` · `graph <projekt> [--reverse]` · `affected [--base <ref>]` · `gen [wzorzec|kolekcja:generator]` · `guide` · `run <projekt>:<target>` · `serve [wait|stop] <projekt>`. Każda drukuje JEDNĄ linię (exit 1 = FAIL) zakończoną ścieżką pliku z całością w `.ws/` — odpowiedź jest w tym pliku, nie powtarzaj komendy; `projects <nazwa>` odpowiada samą linią. Komendy z grafu dopisują świeżość (`świeże`|`nieświeże`), `--fresh` przelicza. Tylko nx >= 23 i angular >= 22.
<!-- INSTRUCTION:nx-angular-inspector:END -->

## Znane granice `nx-angular-inspector` — nazwane, nie ukryte

- **Tani stempel świeżości nie widzi edycji istniejącego pliku.** Krawiedzie grafu biorą się
  z importów, a zmiana `import` w pliku, który już istnieje, nie rusza mtime żadnego katalogu
  (sprawdzone na NTFS). Domyślny stempel chodzi po katalogach — **18 ms**, łapie dodanie, usunięcie
  i zmianę nazwy pliku oraz nowy projekt gdziekolwiek. `--deep` dokłada mtime plików — **275 ms**
  przy 20 000 plików. Obie liczby zmierzone; wybór należy do wołającego, a `env` drukuje tę lukę.
- **Limit 40 tokenów na linię nie jest egzekwowany w kodzie**, tylko testem. Egzekwowanie wymagałoby
  tokenizera w runtime, a pakiet ma zero zależności — to ważniejsze. Limit 120 ZNAKÓw jest twardy
  i pilnuje go `formatLine`, który **nigdy nie tnie dwóch ostatnich części** (werdyktu i ścieżki).
- **`project-graph.json` to prywatny kontrakt Nx.** Asertujemy `version` (`"6.0"`); nieznana wartość
  to werdykt `nieznany format` i fallback do CLI — wolniej, nigdy źle.
- **`docs` nie istnieje.** Wymagałoby klucza Algolii osadzonego w angular.dev, który może się
  zrotować, i endpointu nx.dev — czyli dokładnie tego cichego dryfu, przed którym ostrzega Część II
  raportu. Blok instrukcji jest przy tym na 195 z 200 tokenów: `docs` nie zmieści się bez skrócenia
  czegoś innego, i to jest zamierzone.

## Bramki — uruchamiaj PRZED uznaniem zmiany za skończoną

| komenda | co pilnuje |
| --- | --- |
| `npm run verify` | wszystko poniżej, w tej kolejności |
| `prettier --check . --cache` | format: 120 kolumn, LF, pojedyncze cudzysłowy (`.prettierignore`: proza z wąskimi tabelami, generowane, fixture'y). `--cache` (plik w `node_modules/.cache/prettier`, więc `npm ci` go czyści) pomija pliki o niezmienionej treści: 3400 ms → 730 ms na drugim przebiegu, zmierzone — patrz [docs/DX-REVIEW.md](docs/DX-REVIEW.md) |
| `node scripts/check-pins.mjs` | `scripts/pins.config.mjs` to jedyne miejsce, gdzie wersja zależności jest **deklarowana**. Bramka jest offline i deterministyczna (dlatego stoi tak wysoko): META — każda zależność w każdym manifeście ma wiersz, i odwrotnie; SHAPE — `exact` znaczy goły numer, `caret` znaczy `^`; FLOOR — `minSupported` jako podłoga (`playwright-core >= 1.62.1`), która **nie** rozluźnia `exact`; SYNC — lustra i linie komend (`@playwright/mcp@<wersja>` w `.mcp.playwright.example.json` i `.vscode/mcp.playwright.example.json`); LAG — proza cytująca inną wersję niż pin. Bramka **wskazuje, nie przepisuje**: część tych linii to twierdzenia o zachowaniu, więc podmiana numeru zrobiłaby z prawdy fałsz z nowym numerem. Świadomy cytat starej wersji zwalnia `pins:ignore` w linii. Pytanie „czy pin to nadal `latest`” jest kalendarzowe, wymaga sieci i **nie należy tutaj** |
| `vitest run --project !smoke` | projekty `unit` (FakePage, keeper na prawdziwym pipe z fake'iem silnika w czterech plikach, `client-imports`), `scripts` (CODE-INDEX, portable staging + `help` obu narzędzi z rozpakowanego drzewa), `bench`, `compat` (perf tylko z `BROWSER_INSPECTOR_PERF=1`). `smoke` jest wykluczony i idzie OSOBNO, na końcu (`npm run smoke`) — inaczej `vitest run` uruchamiał go drugi raz, a prawdziwy Chrome obok testów jednostkowych obciążał maszynę na tyle, że testy z budżetem 200 ms migotały |
| `tsc --noEmit` | typy z JSDoc (`checkJs`) w `packages/**`, `scripts/**`, `bench/**` |
| `node scripts/index-code.mjs --check` | świeżość `CODE-INDEX.md` |
| `node scripts/gen-steps-doc.mjs --check` | świeżość `docs/STEPS.md` |
| `node scripts/check-instruction-sync.mjs --require-all` | każdy blok instrukcji ≡ jego kopia w `.github/copilot-instructions.md` ≡ `INSTRUCTION` w benchu (gdy narzędzie ma harness); limit 200 tokenów na blok i 400 na wszystkie razem. Obecny w jednym i brakujący w drugim to FAIL; bez `--require-all` blok nieobecny w OBU plikach jest pomijany (checkout tego oprzyrządowania w repo bez tego narzędzia) — tu oba narzędzia są, więc `verify` wymaga obu bloków |
| `npm run smoke` | jeden smoke na prawdziwym Chrome/Edge: batch, izolacja dwóch originów, sesja przez keepera, `browser-inspector script`, auth (`BROWSER_INSPECTOR_SKIP_SMOKE=1` tylko bez przeglądarki) |

**Poza `npm run verify`, bo dotyka sieci:** `node scripts/check-upstream.mjs` — kalendarzowa połowa
doktryny aktualności, dopełnienie `check-pins`. Pyta rejestr npm o `dist-tags.latest` dla każdego
pinu i mierzy, od kiedy pin jest za `latest` — **od `firstSeenBehind`, nie od daty wydania
`latest`**, bo ta resetuje się przy każdym release'ie niezależnie od tego, czy jesteśmy jedną
wersją w tyle czy dziesięcioma. Zegar żyje w commitowanym `scripts/upstream-state.json` i przeżywa
między uruchomieniami: samo odpalenie skryptu **nie** przesuwa `firstSeenBehind` — inaczej alarm
zerowałby sam siebie za każdym sprawdzeniem. WARN dopiero po przekroczeniu `staleDays` z wiersza
pinu; exit 1 tylko z `--strict` (przy wydaniu). WARN nie znaczy „błąd" — `@types/node` jest
przypięty na majorze 22 **celowo** (`pins.config.mjs` mówi dlaczego) i będzie WARN-ował co
`staleDays` bez końca; `--ack <id|all>` to zapis decyzji człowieka „widziałem, zostaję" —
resetuje zegar tylko dla pinu, który faktycznie jest za `latest`, i tylko wtedy, gdy ktoś o to
świadomie poprosi.

Projekt `compat` (`test/compat/smoke-gate.test.mjs`) to bramka zgodności z app-factory: spawnuje
`bin/browser-inspector.mjs` na kopii `read.config.browser-inspector.json` z buildami serwowanymi z
`../app-factory/dist/apps/*/browser` (porty 4571–4574; `APP_FACTORY_DIR` nadpisuje położenie)
w trzech trybach i ocenia `report.json` kopią `evaluateReports()`. Bez buildów app-factory
obok repo test **pomija się z komunikatem** — na maszynie z buildami musi być zielony.

Ten sam projekt niesie `test/compat/golden-fixtures.test.mjs`: spawnuje
`fixtures/snapshots/generate.mjs --check`, który renderuje bookstore i business-wizard prawdziwym
zainstalowanym `playwright-core` i porównuje wynik z czterema plikami golden (`bookstore.ai.yml`,
`bookstore.boxes.yml`, `walk.json`, `wizard.ai.yml`) bajt w bajt, zamiast je nadpisywać. Bez tego
`generate.mjs` był jedynym sposobem zapisania tych plików i zawsze nadpisywał — zmiana gramatyki
`aria` w playwright-core przemalowałaby golden pliki po cichu, a `test/snapshot.test.mjs`, który
czyta je z dysku jako prawdę, zostałby zielony przez dryf, który ma wykrywać. Rozjazd → FAIL
z numerem pierwszej różniącej się linii; poprawka to `node fixtures/snapshots/generate.mjs`
(bez `--check`) **po przejrzeniu diffu** — nowa treść jest twierdzeniem o tym, co renderuje
przeglądarka TERAZ, nie automatyczną prawdą. Ten sam warunek pominięcia co wyżej.

W trakcie pracy nad jednym pakietem uruchamiaj swoje testy (`npx vitest run <ścieżka>`) i
`npx prettier --check <pliki>`; pełne `npm run verify` przed oddaniem. Testy z prawdziwą
przeglądarką: kanał `chrome` z fallbackiem `msedge`, headless, własny zakres portów dla serwerów
fixture'ów (smoke WP2: 4501–4519, WP3 generator: 4531–4533, sesja WP6: 4541–4559, auth WP7:
4561–4564, compat WP8: 4571–4579; `nx-angular-inspector` **nie rezerwuje zakresu** — jego
fixture serwera dev bierze port efemeryczny (`listen(0)`) i ogłasza go w logu, więc równoległe
przebiegi nie mogą sobie wejść w drogę) i unikalny pipe (`keeper-harness.makeEnv()` daje `BROWSER_INSPECTOR_SOCKET`
+ `BROWSER_INSPECTOR_TMPDIR`), żeby równoległe agenty nie dzieliły keepera.

Hook `.githooks/pre-commit` regeneruje `CODE-INDEX.md`, `docs/STEPS.md` i zip portable
w `download/` (w tej kolejności, przed każdym commitem). Uzbraja go `npm run prepare` —
**jawnie**, bo `.npmrc` ma `ignore-scripts=true` i `npm install` skryptu `prepare` nie uruchamia.
Build zipa wymaga `node_modules` (`npm ci`) i jest deterministyczny: ten sam stan drzewa daje te
same bajty, więc commit, który nie rusza pakietu, nie dokłada bloba do historii.

## Artefakty GENEROWANE — nigdy nie edytuj ręcznie

| plik | regeneruje | kiedy |
| --- | --- | --- |
| `CODE-INDEX.md` | `npm run code-index` (albo hook) | każda zmiana `.mjs` w `packages/*/src`, `packages/*/bin`, `scripts`, `bench` |
| `docs/STEPS.md` | `npm run docs` (albo hook) | każda zmiana `packages/browser-inspector/src/steps.schema.mjs` (także `help`/`config`/`flags` kroku) |
| `bench/RAPORT.md`, `bench/WYNIKI.md`, `bench/BUDGET.md`, blok `BENCH:START/END` w `README.md` | `npm run bench` | zmiana czegokolwiek w pomiarze, silniku albo kliencie |
| `fixtures/snapshots/*.yml`, `walk.json` | `node packages/browser-inspector/fixtures/snapshots/generate.mjs` (`--check` porównuje zamiast nadpisywać — `test/compat/golden-fixtures.test.mjs`) | zmiana buildów app-factory albo wersji playwright-core |
| `download/scribe-devtools-portable-<wersja>.zip` + `.sha256` | `npm run portable` (albo hook) | każdy commit; JEDEN zip niesie OBA narzędzia (`browser-inspector`, `nx-angular-inspector`) pod JEDNĄ wersją — korzeń i oba `packages/*/package.json` muszą się zgadzać, inaczej build odmawia; bajty deterministyczne — każda wydana wersja zostaje w repo |
| `scripts/upstream-state.json` | `node scripts/check-upstream.mjs` (dopisuje/kasuje wiersze, nie zastępuje pliku w całości) | za każdym uruchomieniem; commituje się jak lockfile — diff jest **zapisem decyzji**, nie tylko danymi |

Ręczna edycja któregokolwiek z nich to błąd — zostanie nadpisana albo obleje bramkę.
Żadna liczba w README/RAPORT nie jest wpisywana ręcznie: „5×" to iloraz z pomiaru.

## Punkty synchronizacji i wydanie — [docs/MAINTAINING.md](docs/MAINTAINING.md)

Co musi zmieniać się razem (bloki instrukcji ↔ bench ↔ Copilot, `STEPS` ↔ `RUNNERS`, protokół keepera,
kształt `report.json` ↔ app-factory, wszystkie wersje zależności) i procedura wydania (SemVer, CHANGELOG,
podbicie wersji w korzeniu i OBU pakietach, `check-upstream --strict`, bench, zamrożony zip, tag, release)
są w [docs/MAINTAINING.md](docs/MAINTAINING.md). Przeczytaj przed zmianą kontraktu między modułami i przed
tagiem. Tu jest tylko wskaźnik, bo ten plik ładuje się w każdej rozmowie, a tamte reguły są potrzebne w jednej
na dwadzieścia.

## Czego nie robić

- Nie commituj wyników: `.scribe-devtools/`, `bench/out/`, `read.config.*.json` (poza
  `fixtures/`) — to zrzuty i sesje cudzej aplikacji.
- Nie dodawaj ścieżek DELETE — jedyne czyszczenie to `storage … clear` w piaskownicy
  własnego kontekstu i scrub między przebiegami.
- Sekrety wyłącznie przez zmienne środowiskowe (`valueFromEnv`, `--env`, `@{NAZWA}`) —
  literał w `auth.login` ma być błędem walidacji; keeper nigdy nie dostaje `env`; żaden test
  ani fixture nie zawiera prawdziwego hasła.
- Nie importuj `playwright-core` ani żadnego modułu silnika (`engine.mjs`, `lanes.mjs`, `flow.mjs`,
  `session.mjs`, `steps.ctx.mjs`, `steps.run.mjs`) w kliencie (`bin/browser-inspector.mjs`,
  `src/client.mjs`) — budżet startu klienta to 72 ms, test `client-imports` pilnuje grafu.
- Nie używaj `networkidle` domyślnie, `isTTY` do czegokolwiek, ping-pongu kart ani
  `about:blank` między przebiegami — zmierzone i odrzucone (DESIGN.md §11).
- Nieudany krok to wynik w raporcie (exit 0 w batchu), nie wyjątek.
- Nie instaluj zależności z lifecycle scriptami bez namysłu — `.npmrc` ma `ignore-scripts=true`
  i to jest bezpiecznik, nie przeszkoda. Tylko wbudowane moduły Node i `playwright-core`.
- Nie dotykaj `D:/github/scribe` (repozytorium źródłowe portu) i nie commituj w app-factory
  z tego repo — zmiany tam idą osobnym PR.
- Duże wyniki zostawiaj na dysku, nie w oknie kontekstu — to jest teza całego repo.

## Gdzie co jest

Mapa zależności: [CODE-INDEX.md](CODE-INDEX.md). Projekt i kontrakty: [docs/DESIGN.md](docs/DESIGN.md).
Punkty synchronizacji i procedura wydania: [docs/MAINTAINING.md](docs/MAINTAINING.md).
Plan pakietów roboczych i własność plików: [docs/PLAN.md](docs/PLAN.md). Kryteria akceptacji:
[docs/ACCEPTANCE.md](docs/ACCEPTANCE.md). Kroki: [docs/STEPS.md](docs/STEPS.md) (generowane).
Prośby i ustalenia między pakietami roboczymi: `docs/handoff/<WPn>.md` — czytaj wszystkie przed
zmianą cudzego kontraktu. Wynik pomiaru: [bench/RAPORT.md](bench/RAPORT.md), budżet vs pomiar:
[bench/BUDGET.md](bench/BUDGET.md). Przeglądy: [docs/SECURITY-REVIEW.md](docs/SECURITY-REVIEW.md)
(bezpieczeństwo, 47 ustaleń) i [docs/OPTIMIZATION-REVIEW.md](docs/OPTIMIZATION-REVIEW.md)
(wydajność — ms i tokeny; §7 mówi, co już zmierzono i odrzucono, żeby nie wymyślać tego drugi raz).

Copilot i VS Code: `.github/copilot-instructions.md` (karta repo + kopia bloku instrukcji),
`.github/instructions/*.instructions.md` (reguły per obszar plików), `.github/prompts/*.prompt.md`
(`/migrate-from-mcp-playwright` — migracja repozytorium aplikacji z MCP Playwrighta, opis w
[PROMPT-MIGRACJA-MCP-PLAYWRIGHT.md](PROMPT-MIGRACJA-MCP-PLAYWRIGHT.md); `/browser-session` — pętla sesji;
`/perf-optimize` — runbook wydajności i DX dla repozytorium aplikacji, zastosowany do tego repo w
[docs/DX-REVIEW.md](docs/DX-REVIEW.md)),
`.vscode/tasks.json` (bramki i komendy narzędzia jako zadania), `.vscode/settings.json` (prettier, prompt files, AGENTS.md).
