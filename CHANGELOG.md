# Changelog

Format: [Keep a Changelog](https://keepachangelog.com/pl/1.1.0/), wersjonowanie SemVer.
Wpisy odwołują się do kryteriów `AC-n` z `docs/ACCEPTANCE.md` i pakietów `WPn` z `docs/PLAN.md`.

## Unreleased

### Changed

- **Konfiguracja MCP Playwrighta to przykład, nie żywy plik.** `.vscode/mcp.json` → `.vscode/mcp.playwright.example.json`,
  `.mcp.json` → `.mcp.playwright.example.json`. Żywy plik wkładał 24 schematy narzędzi (4069 tokenów o200k, pomiar w
  `bench/RAPORT.md`) do każdej rozmowy Copilota albo Claude Code, gdy serwer był zaufany — czyli dokładnie ten koszt, przed
  którym `/migrate-from-mcp-playwright` ostrzega repozytoria aplikacji, a którego to repo samo nie unikało. Bench sam
  uruchamia przypięty serwer (`bench/mcp-run.mjs`) i tych plików nie czytał. Pin `@playwright/mcp` jest dalej lustrowany
  przez `check-pins` (wiersz `argv` wskazuje przykłady); `bench.test.mjs` sprawdza, że żywej konfiguracji w repo nie ma,
  a `.gitignore` nie pozwala jej scommitować po ręcznym skopiowaniu.
- **`AGENTS.md` bez „Punktów synchronizacji” i „Wydania”** — obie sekcje (~1500 tokenów) przeniesione dosłownie do
  `docs/MAINTAINING.md`; w AGENTS.md zostaje wskaźnik. Plik ładuje się w każdej rozmowie, a te reguły są potrzebne przy
  zmianie kontraktu między modułami albo przy wydaniu. `AGENTS.md`: 6943 → 5486 tokenów.
- **`.github/copilot-instructions.md` to karta repo + bloki instrukcji, bez powtarzania AGENTS.md** (1391 → 916 tokenów).
  VS Code ładuje oba pliki naraz (`chat.useAgentsMdFile`), więc ~450 tokenów reguł było płacone dwa razy. Karta opisuje
  teraz oba narzędzia. Instrukcje per obszar plików mówią o pełnych nazwach obu narzędzi (nie „skrót `bi`”), a
  `source.instructions.md` obejmuje oba pakiety i wiersz w `pins.config.mjs`. Prompt migracji: bez `SCRIBE_DEVTOOLS_DIR`
  (żaden kod go nie czyta), bez odwołania do prywatnego app-factory, gramatyka kroków przez `browser-inspector help
[krok]`, kopia bloku z `copilot-instructions.md`. `settings.json` bez wycofanego `chat.promptFiles`; `tasks.json` z
  zadaniem `nx-angular-inspector: help`.
- **browser-inspector: `report.md` nie inlinuje długich wartości.** Wartość dłuższa niż 300 znaków albo 6 linii idzie
  do `values/<name>.txt`, a `## values` dostaje wskaźnik z liczbą znaków (`INLINE_VALUE` w `report.mjs`). Do tej pory
  granicą był `CAPS.extract` = 5000 znaków, więc jeden 40-liniowy extract robił z ~200-tokenowego raportu raport na 790
  tokenów. Nagłówek z więcej niż trzema zrzutami podaje liczbę i dwa pierwsze (`shots 8: krok-0.png krok-1.png …`).
  `report.json` bez zmian. Linia po nawigacji bez `(browser-inspector snap)`, linia zwinięcia snapshotu bez
  `· browser-inspector find <text>` — obie podpowiedzi są w bloku instrukcji, a kosztowały 6–7 tokenów za każdym razem.
  `browser-inspector version` odpowiada z `bin` bez ładowania klienta (~6 ms). Redakcja sekretów liczy formy raz na
  zbiór (`redactWith`), nie na każdą linię stdout; log keepera liczy bajty zamiast `existsSync` + `statSync` na wpis.
- **nx-angular-inspector: błąd składni komendy to jedna linia `FAIL`.** `graph` bez argumentu drukował 11 linii pomocy
  (153 tokeny); teraz `FAIL graph · brakuje argumentu <projekt> · nx-angular-inspector help graph` (exit 2, jak dotąd).
  Nieznana komenda i nieznana flaga też z prefiksem `FAIL` i w tym samym kształcie; `help <literówka>` to jedna linia
  zamiast całej tabeli (472 → 28 tokenów). `help` podaje plik wyjściowy na linii wywołania (`→ .ws/env.md`) zamiast
  zdania per verb (463 → ~360 tokenów). Linia `env` bez `demon …` — stan demona zostaje w `env.md`, bo kod sam mówi, że
  o świeżości nie dowodzi niczego. Ścieżka `.ws/` względna z `../`, gdy cwd jest w podkatalogu workspace (do trzech
  poziomów; dalej absolutna). `env.md`: lista plików inferujących w jednej linii (była 40 % pliku), ścieżka grafu
  względna; `gen.md` bez ścieżki absolutnej. Stempel świeżości: jeden przebieg `readdir` zamiast trzech przy `--deep`,
  projekt zagnieżdżony w już przeszukanym korzeniu (`.` z `nx init`) nie jest czytany drugi raz.
- **`check-instruction-sync --require-all` w `npm run verify`.** Blok nieobecny w OBU plikach był „pominięty” (tryb dla
  repozytorium aplikacji bez tego narzędzia) — tu oznaczał bramkę rozbrojoną przez skasowanie obu kopii. Na gałęzi
  `copilot`, która nie ma testu asertującego obecność bloków, przechodziłoby to jako `ok`. Test na nowy tryb.
- **`portable-zip`: zamrożenie po tagu tylko dla zipa śledzonego przez git** (`isTracked`). Na gałęzi z ignorowanym
  `download/` drugi `npm run portable` pod otagowaną wersją oddawał pierwszy build zamiast nowego kodu. `README-PORTABLE.md`
  wylicza faktycznie spakowane katalogi zamiast stałej listy.

### Fixed

- **`package-lock.json` nie znał workspace'u `@scribe-devtools/nx-angular-inspector`** (pakiet doszedł w 77e36c6, lock
  został z 6dacdf5) — `npm ci` na świeżym klonie padał z `EUSAGE`. Przeliczony `npm install --package-lock-only`;
  `.gitattributes -diff` na lockfile ukrywał różnicę w przeglądzie.

### Added

- **`nx-angular-inspector` w zipie portable — JEDEN zip, JEDNA wersja, oba narzędzia.**
  `scripts/portable-zip.mjs` przepisany z pojedynczego `PACKAGE` na tablicę `PACKAGES`:
  `readVersion` sprawdza teraz WSZYSTKIE pakiety wobec wersji korzenia, nie tylko pierwszy —
  bump dotykający tylko jednego manifestu i tak wywala build (test na to: nx-angular-inspector
  zostawiony w tyle łapie się dokładnie tak samo jak wcześniej browser-inspector). Sprzężenie
  jest świadome, nie przeoczone: to koszt trzymania dwóch narzędzi w jednym wydaniu — bugfix
  dotykający tylko jednego z nich i tak podbija wersję drugiego. `nx-angular-inspector` ma zero
  zależności runtime, więc jego wpis w zipie to tylko `bin` + `src` + `package.json` — bez
  kopiowania `node_modules` (playwright-core zostaje wyłącznie dla browser-inspectora). Marker
  `PORTABLE` i para shimów (`.cmd` / POSIX) dostał **każdy** pakiet; `unixMode` w zapisie zipa
  rozpoznaje teraz oba shimy jako wykonywalne, nie tylko `browser-inspector`. Sprawdzone ręcznie
  end-to-end na tej maszynie: staging → `help` obu narzędzi z rozpakowanego drzewa → prawdziwy
  zbudowany zip → rozpakowany → `help` obu narzędzi ponownie. Wydany `v0.1.0` **nie jest
  dotknięty** — zamrożony zip zostaje bez zmian (sprawdzone: `git status` czyste po próbie
  przebudowy bez `--force`); `nx-angular-inspector` pojawi się dopiero w następnym wydaniu, przy
  świadomym podbiciu obu manifestów. 5 nowych/rozszerzonych testów w `portable-zip.test.mjs`.
- **Tryb `--check` dla `fixtures/snapshots/generate.mjs`** (browser-inspector) + nowa bramka
  `test/compat/golden-fixtures.test.mjs`. Do tej pory generator by lift jedynym sposobem zapisania
  czterech plików golden i zawsze je NADPISYWAŁ — zmiana gramatyki `aria` w playwright-core
  przemalowałaby je po cichu, a `test/snapshot.test.mjs`, który czyta je z dysku jako prawdę,
  zostałby zielony przez dryf, który ma wykrywać. `--check` renderuje tym samym silnikiem i
  porównuje bajt w bajt zamiast pisać, zgłaszając numer pierwszej różniącej się linii;
  sprawdzone ręcznie na tej maszynie w obie strony (brak dryfu → `ok`, dopisana linia →
  `FAIL … linii 5`, exit 1). Ten sam warunek pominięcia co `smoke-gate.test.mjs` (brak buildów
  app-factory obok repo → pominięte z komunikatem). Zamyka P1 z doktryny aktualności
  (`docs/research/NX-ANGULAR-MCP.html`).
- **`scripts/check-upstream.mjs`** — kalendarzowa połowa doktryny aktualności, dopełnienie
  `check-pins`. Pyta rejestr npm o `dist-tags.latest` i mierzy, od kiedy pin jest za latest — **od
  `firstSeenBehind`, nie od daty wydania `latest`** (ta resetuje się przy każdym release'ie
  niezależnie od tego, czy jesteśmy jedną wersją w tyle czy dziesięcioma). Zegar żyje w
  commitowanym `scripts/upstream-state.json` i **nie przesuwa się przy samym uruchomieniu** — inaczej
  alarm zerowałby sam siebie za każdym sprawdzeniem; jest na to test. WARN dopiero po przekroczeniu
  `staleDays` z wiersza pinu, exit 1 tylko z `--strict` (przy wydaniu — dopisane do procedury w
  AGENTS.md). `--ack <id|all>` to zapis decyzji człowieka „widziałem, zostaję”, nie bump — działa
  tylko na pinie, który faktycznie jest za latest. Zmierzone na żywo: `vitest` (4.1.11 → 5.0.0) i
  `@types/node` (22.20.1 → 26.4.1, celowo za latest — `pins.config.mjs` mówi dlaczego) są dziś jedynymi
  dwoma z siedmiu pinów za latest, żaden jeszcze nie przekroczył progu. 18 testów, żaden nie dotyka
  sieci — `checkUpstream` przyjmuje wstrzykiwany `fetch`.
- **15 nazwanych luk w pokryciu testów `nx-angular-inspector`** z audytu adwersarialnego (2026-09-03),
  domknięte: sortowanie w `indexGraph` na nieposortowanym wejściu, `gen <wzorzec>` bez dwukropka,
  gałąź dokumentów workspace i deduplikacja w `guide`, trzy gałęzie `run` (kod bez rozpoznanych
  błędów, brak zainstalowanego nx, PRAWDZIWY `ETIMEDOUT` na milisekundowym budżecie —
  `runTarget` dostał parametr `timeoutMs`), gałąź pliku wspólnego i `defaultBase` z `nx.json` w
  `affected`, druga połowa progu Angulara (`angular.json` bez `@angular/core`), przełącznik
  `NX_WORKSPACE_DATA_DIRECTORY`, weryfikacja `readdirSync` w `writeOut` (odtworzona pułapka NTFS
  ADS przez prawdziwy dwukropek w ścieżce, nie mock), trzy gałęzie `daemonState`
  (wyłączony/pid żyje/martwy), powierzchnia `generators.mjs` poza jedną kolekcją z fixture'a
  (sortowanie, `private: true`, `MANIFEST_NAMES`, scalanie pisowni `generators`/`schematics`),
  escapowanie metaznaków i goła `**` na końcu wzorca w dopasowywaniu, `--root` wskazujący
  podkatalog workspace, i jedna linia `FAIL` zamiast stosu wywołań, gdy runner rzuci nieoczekiwanym
  wyjątkiem (odtworzone przez plik blokujący `mkdirSync(.ws/)`, prawdziwy `EEXIST`). Fixture'owy
  stub `nx` dostał dwa nowe, jawnie NIEobecne w grafie tryby (`utils:fail-plain`, `utils:hang`) —
  `run` nie sprawdza grafu, więc nie muszą tam być. `nxJson`/`stripToJson` w `nxcli.mjs` okazały się
  mieć dokładnie jednego wywołującego — same siebie, martwe też w produkcji — więc zostały USUNIĘTE
  zamiast otestowane; ten kod nikogo już nie woła. 51 nowych testów pakietu (191 razem).
- **`packages/nx-angular-inspector/` — binarka `nx-angular-inspector`**: to, co odpowiadają `ng mcp` i `nx-mcp`,
  bez serwera MCP. Pięć komend (`env`, `projects [nazwa|glob]`, `graph <projekt> [--reverse]`,
  `gen [wzorzec|kolekcja:generator]`, `guide`), każda drukuje jedną linię i pisze całość do `.ws/`.
  Zero zależności runtime, brak keepera: zmierzony floor to **115 ms**, z czego **86 ms** to sam start
  Node'a — keeper mógłby uratować najwyżej te 86 ms i kosztowałby identity hash, lock, nazwany pipe,
  sondę martwego pidu i doctora. W browser-inspectorze arytmetyka szła w drugą stronę i keeper był
  jedynym wyjściem.
- **`bench/nx-angular-inspector-run.mjs` — harness pomiarowy nowego narzędzia.** Domyka dziurę, o której
  bramka instrukcji mówiła wprost: blok był porównywany w dwóch kopiach zamiast trzech (`(bez benchu)`).
  Zmierzone na wygenerowanym fixture, sesja pięciu komend: **koszt stały 195 tok**, zmienny 411 tok,
  razem **606 tok** — z czego same linie stdout to **125 tok**, a 259 to pliki z `.ws/`, czytane tylko tam,
  gdzie linia nie jest odpowiedzią. Dla porównania koszt stały samych serwerów, zanim padnie pierwsze
  pytanie: 4 979 (`ng mcp`) + 358 (`nx-mcp --minimal`) = **5 337 tok** — wg pomiaru z raportu rozpoznania
  z 2026-09-03, nie przeliczanego tutaj.
  Czas: `projects` mediana **90 ms**, podłoga samego Node-a **64 ms**, nasza praca **26 ms** — i to jest
  liczba, która przesądza o braku keepera w v1: demon mógłby uratować najwyżej te 64 ms.
  `cacheModes` jest **bramką ważności**, nie ozdobą: przebieg, który spadł do CLI, UNIEWAŻNIA pomiar,
  zamiast zaniżyć medianę kolumny cache'owanej — jest na to test.
  Czego tu **nie ma, celowo**: porównania z `ng mcp` i `nx-mcp` na żywo. Oba idą przez `npx` i rejestr, więc
  ich pomiar jest pomiarem czyjejś sieci tego dnia; ich liczby zostają w raporcie, gdzie niosą datę i maszynę.

- **`serve [wait|stop] <projekt>`** — serwer dev startowany w tle, oczekiwany i zatrzymywany, bez trzymania
  terminala i bez wieszania się. Trzy własności, które uzasadniają złożoność tego modułu:
  dziecko jest **odczepione**, a jego wyjście idzie prosto na deskryptor, który potem zamykamy (na Windows
  odziedziczony potok trzyma rodzica przy życiu, a otwarty uchwyt blokuje log);
  `wait` **zawsze się kończy** — timeout to FAIL z ostatnimi liniami logu i ścieżką, a serwer, który padnie
  w trakcie czekania, jest zauważony od razu, nie odczekany do deadline'u (zmierzone: 174 ms zamiast 30 s);
  `stop` ubija **drzewo** — `nx run <p>:serve` jest rodzicem prawdziwego serwera, a zabicie samego rodzica
  zostawia zajęty port. Test to sprawdza dosłownie: pyta port HTTP-em przed i po `stop`.
  Sen w pętli oczekiwania to `Atomics.wait`, bo każdy inny czasownik tego narzędzia jest synchroniczny,
  a promise w środku ścieżki, której cały kontrakt brzmi „jedna linia i wyjście", byłby ciężarem bez powodu.
- **Fixture dostaje namiastkę serwera dev** (`fixtures/dev-server.cjs`) w trzech trybach: `ready` (bindnie port
  i ogłasza się), `hang` (pisze, ale nigdy nie mówi że gotowy) i `die` (pada z błędem kompilacji). `wait`,
  który tylko się udaje, nie dowodzi niczego. Port jest **efemeryczny** (`listen(0)`), więc pakiet nie rezerwuje
  zakresu portów i równoległe przebiegi nie wchodzą sobie w drogę.
- **Arność komend wynika z kolumny `args`** w tabeli czasowników, zamiast osobnego pola: dwa miejsca na
  to samo to dwa miejsca do rozjechania się, a tekst pomocy i tak jest z tej kolumny generowany.

- **`affected [--base <ref>]` i `run <projekt>:<target>`** w `nx-angular-inspector`. `affected` nie zastępuje
  niczego z żadnego serwera MCP — żaden go nie ma. Trzy kroki, każdy testowany osobno: `git diff --name-only
  <base>...HEAD` (trzy kropki, czyli wobec merge-base — dwie kropki uznałyby każdy commit, który wpadł na `main`,
  za zmianę tej gałęzi), mapowanie po **najdłuższym prefiksie segmentowym** roota, i **domknięcie zależnych**.
  Domknięcie jest połową, o której się zapomina: zmiana liścia dotyka każdej aplikacji, która go konsumuje,
  a odpowiedź wymieniająca samą bibliotekę to ten rodzaj błędu, który przechodzi review i potem pomija build.
- **Dopasowanie ścieżek zakotwiczone na SEGMENTACH** (`src/glob.mjs`). Naiwny matcher podciągowy testuje
  `tools/testing/**/*.ts` przeciw `tools/scripts/x.spec.mjs` i mówi „tak", bo pozwolił gwiazdce zjeść ukośnik —
  jedna pomyłka, która na prawdziwym workspace zamienia 21 dotkniętych projektów w 80. Osobno: `libs/ui` nie
  zagarnia `libs/ui-kit`, a projekt zagnieżdżony wygrywa z rodzicem.
- **`run` zdejmuje ANSI przed zapisem** (45-51 % tokenów kolorowego logu, których agent i tak nie widzi)
  i wyciąga **maksymalnie pięć** unikalnych linii błędu, pomijając banery podsumowania. Na linii jest liczba
  błędów i PIERWSZY z nich, przycięty do 40 znaków — limit 120 znaków i limit 40 tokenów to dwa różne limity,
  a błąd kompilatora obok ścieżki jest dość gęsty, żeby przejść pierwszy i oblać drugi (zmierzone: 120 znaków
  = 41 tokenów).
- **Fixture'y dostają namiastkę binarki `nx`** (`fixtures/nx-stub.cjs`, kopiowana — nie wklejana jako napis —
  do `node_modules/nx/bin/nx.js`). Dzięki niej testowalne są wreszcie dwie ścieżki, które OPUSZCZAJĄ proces:
  fallback do CLI (`--fresh` → `przeliczone`, nieznana `version` → `nieznany format` i odpowiedź mimo to)
  oraz `run`. `portal:build` zawodzi tam CELOWO i W KOLORZE, żeby zdejmowanie ANSI miało co żuć.

- **Graf Nx jako źródło prawdy, `project.json` nie**: `readGraph` asertuje `version` (`"6.0"` — jedyna znana
  przy nx >= 23), nieznany kształt to werdykt `nieznany format` i fallback do `nx graph --file`, nigdy
  nadziejny parse. To dokładnie ta awaria, która położyła `nx-mcp` 0.25.0 na nx 23 — z tą różnicą, że tam
  nie było ani asercji, ani fallbacku. Na fixturze 5 z 8 targetów istnieje wyłącznie w grafie.
- **Stempel świeżości zamiast wiary w demona**: `świeże ⟺ mtime(graf) >= max(mtime po zbiorze wejść)`,
  gdzie zbiór to konfiguracja korzenia, per projekt katalog roota + `project.json` + `package.json`
  - kuratorowana lista plików inferujących, oraz **katalogi nadrzedne rootow** — bez tego wiersza nowy
    projekt byłby niewidzialny za pewnym siebie `świeże`. Żywotność demona nie jest dowodem w żadną stronę
    i nie jest używana do niczego; `env` ją tylko raportuje, obok listy plików inferujących — bo to znana
    luka, a luka, którą widać, jest luką, którą da się obejść (`--fresh`).
- **Próg wsparcia sprawdzany raz, w `detect.mjs`, zanim cokolwiek ruszy**: nx >= 23, angular >= 22,
  a workspace, który nie jest ani jednym, ani drugim — jedna linia FAIL, bez trzeciej gałęzi
  ekosystemowej. Sześć generowanych fixture'ów (`fixtures/generate.mjs`): trzy gałęzie detekcji i trzy
  progu; te trzy negatywne są jedynym, co czyni próg czymś więcej niż komentarzem. 77 testów pakietu.
- **Drugi blok instrukcji w AGENTS.md**, między **nazwanymi** znacznikami
  `<!-- INSTRUCTION:nx-angular-inspector:START -->` — regex bramki łapie pierwszy nienazwany blok, a stary
  blok nazwy dostać nie może, bo skopiowały go już repozytoria aplikacji. `check-instruction-sync`
  chodzi teraz po tablicy `BLOCKS`, dostał **`TOTAL_TOKEN_LIMIT = 400`** obok limitu 200 na blok
  (dziś 158 + 164 = 322) — sam limit per blok pozwalałby kosztowi stałemu rość o jedno narzędzie naraz,
  nie czerwieniąc nigdy żadnej bramki — i pomija blok nieobecny w OBU plikach, przy asercji w teście,
  że w TYM repo obecne są oba.

- **`scripts/pins.config.mjs` + bramka `scripts/check-pins.mjs`** (WP0 doktryny aktualności, `docs/research/`):
  jedno miejsce, w którym wersja zależności jest deklarowana, i offline'owa bramka jako **drugi krok `verify`**,
  zaraz po `prettier`. Pilnuje czterech rzeczy, których zielony zestaw testów nie pilnował: META (każda z 7
  zależności w 3 manifestach ma wiersz — i odwrotnie; nowa paczka bez wiersza = FAIL), SHAPE (`exact` = goły numer,
  `caret` = `^`), FLOOR (`minSupported`) i SYNC (lustra + `@playwright/mcp@<wersja>` w `.mcp.json` i
  `.vscode/mcp.json`). Piąta, LAG, jest tą, po którą to powstało: podbicie `playwright-core` wskazuje dziś **28
  linii prozy** cytujących starą wersję — w tym `docs/DESIGN.md:27`, gdzie mieszka sześć faktów o `aria-ref`
  odczytanych z bundle'a 1.62.1. Bramka **wskazuje, nie przepisuje**: połowa tych linii to zdania o zachowaniu
  („`response.fromCache()` nie istnieje w playwright-core 1.62.1”), więc podmiana numeru zamieniłaby zdanie prawdziwe
  na fałszywe z nowym numerem. `pins:ignore` w linii zwalnia świadomy cytat starej wersji; `CHANGELOG.md`,
  `docs/handoff/` i `docs/research/` są zamrożone globalnie, bo wersja jest tam zapisem zdarzenia.
- **`playwright-core` dostaje podłogę `minSupported: '1.62.1'`** — próg, nie zakres. Pin w obu manifestach zostaje
  **exact**, bo `scripts/portable-zip.mjs:84` porównuje string manifestu z wersją w `node_modules` przez `!==`:
  `>=1.62.1` wywaliłoby każdy build portable, zanim zdążyłoby cokolwiek zepsuć w silniku. 22 testy w
  `scripts/check-pins.test.mjs`, wszystkie na syntetycznych drzewach w `tmp` — test asertujący „to repo jest teraz
  czyste” zzielenieje w dniu, w którym bramka przestanie działać.

### Fixed

- **Próg czasowy w `bench/nx-angular-run.test.mjs` migotał pod dużym obciążeniem współbieżnym**
  (kilkadziesiąt równoległych testów tej sesji, w tym realny Chrome z innych pakietów): mediana
  `projects` skoczyła z ~90 ms do 415 ms, podłoga Node'a tylko do 171 ms, iloraz spadł do 0,41
  poniżej progu 0,5. Teza („spory kawałek zegara to start Node'a”) nadal się trzyma przy 41 % —
  próg obniżony do 0,3, z uzasadnieniem liczbowym w komentarzu zamiast gołej stałej.

**Audyt adwersarialny `nx-angular-inspector` (2026-09-03)**: 6 wymiarów × 252 agenty, 82 znaleziska,
52 przetrwały weryfikację przez trzech niezależnych sceptyków. Naprawione 26 usterek; 20 z 23 nowych
testów regresji **czerwieni się na kodzie sprzed poprawki** (sprawdzone przez schowanie `src/`), trzy
pozostałe to strażnicy przeciw mutacji, gdzie błąd był w teście, nie w kodzie.

- **Stempel świeżości widział za mało i mówił `świeże`.** Trzy dziury naraz: (a) żaden plik ani katalog
  wewnątrz projektu nie był w zbiorze wejściowym, więc nowy plik w `src/lib/` nie ruszył niczego;
  (b) pilnowany był wyłącznie BEZPOŚREDNI rodzic znanego korzenia, więc projekt dodany w nowym katalogu
  najwyższego poziomu był niewidzialny; (c) graf ze znacznikiem czasu w PRZYSZŁOŚCI (przestawiony zegar
  VM, przywrócenie z archiwum) spełniał porównanie z wszystkim na zawsze, a `formatAge` maskował to jako
  „graf 0 s". Teraz: rekurencyjne przejście po katalogach każdego projektu, WSZYSCY przodkowie aż do
  korzenia workspace, sam korzeń, i odmowa werdyktu `hit` dla grafu z przyszłości.
- **Nowy tryb `--deep` i nazwana granica taniego stempla.** Zmierzone na tej maszynie: przejście po
  **katalogach 18 ms** (łapie dodanie i usunięcie pliku), przejście po **plikach 275 ms** przy 20 000
  plików. Edycja `import` w ISTNIEJĄCYM pliku nie rusza mtime katalogu — sprawdzone — więc tani stempel
  jej nie widzi. To jest granica, nie błąd: `--deep` ją zamyka, `env` ją drukuje, a komentarz w
  `stamp.mjs` przestał twierdzić, że zbiór obejmuje „every path whose mtime can invalidate the graph".
- **`affected` gubił pliki.** Ścieżka spoza ASCII wracała z gita **zacytowana i zescapowana ósemkowo**
  (`"libs/ui/'"'"'Å¼Ã³ÅÄ.ts"`), a kod zamieniał te backslashe na separatory — plik
  tracił właściciela i projekt cicho wypadał z odpowiedzi. Zmiana nazwy pliku pokazywała **tylko nową
  ścieżkę**, więc projekt źródłowy nie trafiał do zarodków. Projekt zakorzeniony w korzeniu workspace
  (`ng new` pisze dokładnie taki: `root: ''`) **nigdy nie był właścicielem żadnego pliku**. Teraz
  `-c core.quotePath=false --no-renames -z` i właściciel w korzeniu jako ostatnia instancja.
- **Przycinanie linii zjadało dokładnie to, dla czego linia istnieje.** Ścieżka jest ostatnią częścią,
  więc to ona padała: `graph <długa-nazwa>` kończył się `.ws/gr…`, czyli poleceniem „przeczytaj plik",
  którego nie da się otworzyć. Gorzej: w `projects <projekt-z-44-targetami>` znikał werdykt
  `nieświeże`, a doktryna tej linii brzmi „cisza znaczy świeże" — agent dostawał pewną odpowiedź
  o nieświeżym grafie bez jednego znaku ostrzeżenia. Dwie ostatnie części są teraz nietykalne,
  a przycinane jest Środkowisko, ze znacznikiem `…`.
- **`run` kłamał o błędach.** Wzorzec łapiący słowo „error" trafiał w nazwy PRZECHODZĄCYCH testów
  (`✔ handles error responses gracefully`) i w podsumowania (`Tests: 1 failed, 127 passed`), które
  wypełniały limit pięciu i wypychały prawdziwy błąd poza linię. Licznik pokazywał `min(liczba, 5)`,
  więc build ze 147 błędami raportował „5 błędów". Jeden niedomknięty `ESC ]` kasował wszystko aż do
  następnego BEL — razem z błędami kompilatora w zapisanym logu. `stdout` i `stderr` sklejano bez
  nowej linii, więc ostatnia linia jednego zrastała się z pierwszą drugiego. Przekroczony `maxBuffer`
  raportowano jako „nx nie wystartowało" — przy 64 MB przechwyconego logu na dysku.
- **`ok` z kodem wyjścia 1.** `guide` bez dokumentów i `gen` bez trafień zwracały linię `ok …` i exit 1,
  a binarka kieruje wszystko z kodem ≠ 0 na stderr — agent czytający stdout dostawał CISZĘ przy pliku,
  który powstał i jest poprawny. Pusty wynik to nie błąd.
- **Zapis poza `.ws/`.** `run "..\..\..\evil:build"` naprawdę tworzył plik dwa poziomy nad korzeniem
  workspace: nazwa składana była z argv, sanityzowany był tylko ukośnik w przód, a asercja
  `readdirSync` przechodziła bez szemrania. Doszedł test zawierania się w katalogu i `safeSegment`
  na obu separatorach. Osobno: asercja zapisu porównywała nazwę **bajt w bajt na NTFS**, który jest
  case-insensitive — po `run Portal:build` każdy późniejszy `run portal:build` meldujeł FAIL dla builda,
  który przeszedł.
- **Sfabrykowane `0 projektów · świeże`.** Brak `nx.json` przy zainstalowanym Angularze bez `angular.json`,
  oraz `angular.json` z przecinkiem końcowym, dawały pusty model z werdyktem `hit` — pełne przekonanie
  bez zajrzenia do jakiegokolwiek źródła. Oba to teraz FAIL nazywający przyczynę. Podobnie `nx graph`
  kończące się kodem ≠ 0, które zdążyło zapisać plik, było przyjmowane jako sukces.
- **Drobiazgi z tą samą mechaniką cichej pomyłki**: flaga z wartością połykała następną flagę
  (`--root --deep` → root = `--deep`); `help <literówka>` kończył się kodem 0, a sama literówka kodem 2;
  `tags` jako napis rozsypywało się na jednoliterowe tagi, a jako liczba rzucało; `firstLine(stderr)`
  brało linijkę zerową, którą Nx zawsze zostawia pustą, więc prawdziwy powód ginieł; proces zabity
  sygnałem dawał komunikat „kodem null"; `relPath` normalizował tylko literę dysku.

**Czego ŚWIADOMIE nie naprawiono, i dlaczego:** limit 40 tokenów na linię **nie jest egzekwowany
w kodzie** — wymagałby tokenizera, a pakiet ma zero zależności runtime i to jest ważniejsze. Egzekwuje
go test na gęstej treści (pełny SHA, 44 targety, długa ścieżka), a `affected` skraca SHA do 12 znaków,
bo pełny kosztował 20 tokenów sam z siebie. Zostały też luki w POKRYCIU wskazane przez audyt
(gałęzie `daemonState`, powierzchnia `generators.mjs`, `NX_WORKSPACE_DATA_DIRECTORY`) — nazwane, nie
zamknięte.

- **Linia `FAIL` z `nx-angular-inspector` nie była przycinana.** Lokalny helper `fail()` składał napis ręcznie
  i omijał `formatFail`, więc `run portal:build` wypuścił linię 127-znakową przy limicie 120. Złapał to test
  budżetu linii, bo obejmuje **każdą** komendę, a nie próbkę.
- **`projects` w workspace z samym `angular.json`** raportowało `5/5 targetów z pluginów` — liczbę prawdziwą
  arytmetycznie i fałszywą co do znaczenia, bo tam targety SĄ zadeklarowane, tylko w `angular.json`. Ta część
  linii po prostu nie pada, gdy źródłem nie jest graf.

### Changed

- **Bench przeliczony przy `29c3119`**: ciepła ścieżka **315 → 275 ms**, `warm-tight` 296 → 265 ms, iloraz wobec
  domyślnego MCP **9,2× → 10,6×**, wobec zestrojonego (`--timeout-settle 100`) 3,0× → 3,6×; `first` 1603 → 1336 ms,
  `cold` 1694 → 1432 ms. Tokeny bez zmian (414 na przebieg batcha) — żadna z napraw audytu nie dotykała tego, co agent
  czyta. Artefakty `RAPORT.md`, `WYNIKI.md`, `BUDGET.md` i blok BENCH w README odpowiadają teraz wypchniętemu kodowi.
- **`docs/OPTIMIZATION-REVIEW.md` zaktualizowany po audycie**: LIFE-7 przeniesione do zamkniętych (audyt domknął je
  trzema klamrami `try/finally` i znalazł przy okazji cięższą siostrę, której przegląd nie zobaczył — lane
  współdzielony nie oddawał `busy`), werdykt §2 podaje nowy pomiar, a **16 cytowań `plik:linia` przeliczono po
  symbolach**, bo audyt przesunął numery w połowie plików. Sprawdzone i zapisane jako dalej otwarte mimo sąsiedniego
  kodu: LIFE-3 (`recorder.bodies` nadal bez capa), TOKENS-2 (próg inline `extract` nadal 5000 znaków), CORR-1
  (`status`/`stop` dalej liczą tożsamość bez `config.browser`), CORR-2 (`exchange` dalej po cichu zjada nieparsowalną
  linię).

### Fixed

- **Pole `type=password` BEZ `[ref=]` zostawiało wpisaną wartość** w `snap.md`, `snap.full.yml`
  i na stdout. Maska działa po refie (sidecar jest kluczowany refem), więc pole, któremu Playwright
  refu nie nadał — bo np. ma `pointer-events: none` — nie miało jak trafić na listę wrażliwych.
  Wartość, której sidecar nie potrafi potwierdzić, jest teraz cięta tak jak wrażliwa.

- **`afterName()` gubił się na nazwie, której Playwright NIE cytuje** (`/…/`) — zwracał 0, więc ref
  brał się ZNOWU z wnętrza nazwy. Dokładnie ten wektor, przed którym miała chronić łatka wyżej;
  trzecie podejście do tej samej rodziny błędu. `afterName` pomija teraz także formę niecytowaną.

- **Fail-closed po nieudanym obchodzie DOM był wszystko-albo-nic.** Obchód, który padł w JEDNEJ
  ramce potomnej, zostawiał hasło z tej ramki jawne — bo maskowanie awaryjne włączało się dopiero,
  gdy sidecar nie powiódł się w CAŁOŚCI. Teraz liczy się PER POLE: `boxJoin` znaczy `valueUnknown`
  każdy węzeł o roli niosącej wartość, dla którego obchód nie znalazł żadnego elementu. Trzy
  niezależne zgłoszenia. Nowy fixture `fixtures/iframe-hostile.html`.

- **Hasło w polu z `placeholder` zostawało jawne** — renderer przenosi wartość do liścia `- text:`
  pod węzłem, a maska tego slotu nie znała. `maskSnapshotValues` traktuje teraz wcięcie jak drzewo:
  wrażliwy klucz tnie także swoje dzieci.

- **Redakcja JUnit-a biegła PO escapowaniu XML** — sekret zawierający `&`, `<`, `>` albo `"` był już
  wtedy innym ciągiem znaków i przechodził przez `redact` nietknięty, prosto do `junit.xml`.
  `renderJUnit` redaguje teraz przed `xml()`, we wszystkich czterech polach.

- **`snapshots[i].storageState` rozwiązywał się względem cwd PROCESU**, nie katalogu configu —
  snapshot cicho startował na cudzym koncie albo bez sesji. Kotwiczony teraz do katalogu configu,
  tak jak `outputDir` i `auth.storageState`.

- **Odmowa eksportu refu z iframe (naprawa poprzedniej rundy) nigdy nie strzelała**: `normalizeEntry`
  nie przepisywało `inFrame` do dziennika, więc marker nie dojeżdżał do `journal.jsonl`. Do tego
  `durableSelector` na ścieżce zapasowej zawsze meldował `inFrame: false` — `false` znaczyło
  jednocześnie „nie w ramce", „degradacja" i „`catch`". Teraz trzy stany zamiast dwóch.

- **`browser.motion: "reduce"` nie działało wcale**, a nagłówek raportu i tak drukował
  `motion=reduce`. Scrub zerował `reducedMotion` na `null`, co Chrome rozumie jako `no-override`
  i kasuje też opcję kontekstu; `freshContext`/`prewarmSpare` nigdy jej nie ustawiały.

- **`planLanes` sadzało wszystkie snapshoty o zerowym szacunku na lane 0** — config złożony
  z samych `type: "page"` tracił równoległość mimo `parallel: N`. `estimateSnapshot` jest z definicji
  szacunkiem porządkującym, a było użyte jako rozmiar kosza w bin-packingu.

- **`BROWSER_INSPECTOR_CHANNEL=''` wyrzucało `browser.channel` z configu** i z tożsamości, i z
  uruchomienia: `collectIdentity` używało `??`, `launchPlan` `||`. Jedna semantyka po obu stronach:
  puste = nieustawione.

- **Żądanie, które odpowiada 4xx/5xx i dopiero potem pada na transporcie, było liczone dwa razy**,
  a status HTTP znikał z `failure`. `recordFailure` jest teraz idempotentne, a oba powody składane.

- **`extract` czytał tekst elementów, których strona nie renderuje** — raport twierdził, że widać
  błąd walidacji i potwierdzenie, których nie ma. Wybrany wariant to ADNOTACJA, nie twardy FAIL:
  wartość dostaje `hidden: true`, bo twardy FAIL łamałby bramkę zgodności z app-factory.

- **`upload` wysyłał `application/octet-stream` dla każdego pliku ≤ 1 MB** — typ MIME zależał od
  rozmiaru pliku, bo tylko ścieżka dyskowa wyprowadzała go z rozszerzenia.

- **`waitFor <ref> --state hidden|detached` kończyło się FAIL-em, gdy element został USUNIĘTY** —
  czyli dokładnie wtedy, gdy warunek jest spełniony.

- **Klikalny nagłówek (akordeon) był widoczny, ale nieadresowalny** — linia `heading` w kompakcie
  i w `find` nie niosła refa. **Zwijanie rodzeństwa gubiło nazwy**: menu 13 różnych linków zwijało
  się do jednego linku i trzech nazw, bo sygnatura zwijania ignoruje nazwy.

- **`snap`, `--grep` i `find` gubiły wpisaną wartość każdego pola z `placeholder`** (ta sama
  przyczyna co wyciek wyżej, drugi jej koniec).

- **Filtry sesyjne kroku `snapshot`** (`max`, `diff`, `grep`, `names`, `all`) **przechodziły
  walidację configu i nie robiły nic.**

- **`check-instruction-sync` po cichu wyrzucał linie bez `>`** spomiędzy znaczników, więc tekst
  dopisany do bloku instrukcji instruowałby agenta, nie kosztując nic w pomiarze AC-6.

- **`maskSnapshotValues` brało ref z NAZWY pola, nie z jego atrybutu.** Łatka niżej w tej samej
  sekcji zastąpiła regexp parserem, ale ref wyszukiwała jako pierwsze `[ref=…]` w kluczu — a nazwa
  dostępna może ten tekst zawierać dosłownie. Pole hasła o nazwie `Kod [ref=e9]` podstawiało cudzy
  ref, kontrola `sensitive` chybiała i **wartość znów zostawała jawna**; w drugą stronę kasowało
  wartość niewinnego pola. Pięć niezależnych zgłoszeń. `afterName()` przeskakuje teraz cytowany
  przebieg nazwy i czyta ref dopiero za nią.

- **`sidecarFromPage` parował węzły `<iframe>` z `page.frames()` po POZYCJI.** Pusta, ukryta albo
  zagnieżdżona ramka przesuwała cały join, więc pole hasła z ramki dostawało flagi obcego elementu
  — traciło `sensitive` i wyciekało. Funkcja była martwa do czasu naprawy sidecara wyżej, która ją
  ożywiła: **przetestowana** nie znaczyło **poprawna**. Każdy węzeł rozwiązuje teraz własną ramkę
  przez swój ref (`aria-ref=eN` → `contentFrame()`); parowanie pozycyjne zostaje jako fallback.

- **Kompakt wstawiał wpisaną wartość w miejsce NAZWY** dla pola bez etykiety, i doklejał ją jako
  sufiks kontenera. Oba sloty są poza tym, na co patrzy maska wartości, więc `sensitive: true` nic
  nie dawało. `textUnder` pomija role niosące wartość.

- **Degradacja chodzenia po DOM gubiła flagi `sensitive`** — a brak flagi znaczył jawne hasło.
  Teraz fail-closed: nieudany sidecar maskuje wartości WSZYSTKICH ról, które mogą je nieść.

- **`_manifest.json` i plik `--junit` pisały się bez redakcji** obok starannie zamaskowanego
  `report.json` — sekret z komunikatu kroku lądował jawnie w pliku obok.

- **`secretForms` znało trzy postacie sekretu zamiast sześciu.** Hasło ze spacją albo `!` nie było
  maskowane w ciele POST (zapis formularza koduje spację jako `+`) ani w nagłówku `Basic`. Doszedł
  zapis formularza, base64 i base64url.

- **`ctx.cdp` zostawał na starej karcie po `tab new` / `tab select`** — `eval` i `shot` czytały inną
  kartę niż ta, którą opisuje raport. Nowy `ctx.rearmCdp()` po każdym `setPage`.

- **Sesja zostawała na zamkniętej karcie:** popup, który zamyka się sam, blokował wszystkie dalsze
  komendy. Handler `page.on('close')` wraca na kartę lane'a.

- **`export` zamieniał ref z iframe (`f1eN`) na niekwalifikowany selektor** — odtworzony flow klikał
  INNY element i meldował `completed: true`. `durableSelector` zwraca teraz `inFrame`, liczone na
  żywym elemencie, nie z kształtu refa (prefiks `f<seq>` nosi też dokument główny po nawigacji).

- **`report.json.text.truncated` był zawsze `false`** — raport twierdził, że ma cały tekst strony,
  choć `text.txt` urwał się na 20 000 znaków. Flaga bierze się teraz z długości mierzonej W STRONIE.

- **`elements.truncated` liczyło się wobec capa, nie wobec tego, co raport listuje** — mapa strony
  z ramką twierdziła, że jest kompletna.

- **`selectorFor` w mapie elementów nie sprawdzał unikalności** — `elements.md` podawał selektory
  trafiające w INNY element (`#id` z shadow roota trafiał w light DOM).

- **`eval` i `shot --el` ignorowały zakres `frame <n>`**, choć DESIGN i pomoc kroku obiecują inaczej.

- **`globToRegExp` nie był globem Playwrighta** — `{a,b}` nie działało, a `?` znaczyło „dowolny
  znak", więc `route` i `wait --url` rozumiały ten sam wzorzec inaczej. Przepisane 1:1 na reguły
  `globToRegexPattern` z playwright-core 1.62.1.

- **`storageState` snapshotu był po cichu nadpisywany sesją `auth`** — snapshot startował na cudzym
  koncie. Taki config jest teraz odrzucany z komunikatem wskazującym obejście.

- **Zapis stanu sesji `auth` nie był atomowy** — równoległe przebiegi mogły zobaczyć plik w połowie.
  Nowy `writeAtomic` (zapis do `.tmp` + `rename`).

- **`el` w sesji nie schodziło do iframe'ów**, więc ta sama strona dawała `el 1` w sesji
  i `elements.total 3` w batchu. **`dom Δ` nie działało w popupie** — obserwator wisiał na
  `about:blank`, który nawigacja zastąpiła.

- **`invalid` nie było w `KEPT_ATTRS`** — po odrzuconej walidacji kompakt był identyczny, a
  `snap --diff` mówił „0 changed".

- **`video: true` w kroku `goto` przechodziło walidację i nie robiło nic.**

- **`loadConfig` nie zdejmował BOM-a** — config zapisany przez PowerShell padał z „not valid JSON".

- **Wartość pola hasła zostawała jawnie w `snap.full.yml`, gdy etykieta pola zawierała dwukropek.**
  Trzy niezależne agenty audytu wskazały to samo miejsce: `maskSnapshotValues` rozpoznawało linię
  wzorcem `- rola "nazwa" [ref=eN]: wartość`, w którym część na nazwę nie mogła przekroczyć `:`.
  Etykieta „Hasło:” — najzwyklejsza w polskim formularzu — kończyła dopasowanie, linia nie liczyła
  się jako niosąca wartość i **wpisane hasło szło na dysk i na stdout**. Gorszy wariant: gdy nazwa
  zawiera `: `, renderer cytuje CAŁY klucz (`'textbox "Kod: SMS" [ref=e5] [box=…]': 1`) i linia nie
  zaczyna się już od roli. Regexp zastąpiony parserem: `keyEnd()` skanuje klucz znak po znaku (klucz
  goły i cytowany, `''` w apostrofach, odwrotny ukośnik w cudzysłowie), ref rozpoznawany osobno
  (`[ref=…]` gdziekolwiek w kluczu), a linie **bez** wartości też przechodzą przez `redact` — sekret
  echem w nagłówku albo w URL już się nie prześlizguje.

- **Sidecar snapshotu widział tylko ramkę główną — hasło wpisane w `iframe` lądowało jawnie.**
  `writeSnapshotFiles` zszywało drzewo aria z walkiem DOM po samej ramce głównej, więc pole w ramce
  nie dostawało ani selektora, ani flagi `sensitive`, a jego wartość szła do `snap.md`,
  `snap.full.yml` i na stdout. Używa teraz `sidecarFromPage()` — funkcji, która istniała, była
  przetestowana i **martwa**. Znalezione przez porównanie z `@playwright/mcp`, nie przez lekturę.

- **Walk DOM nie wchodził w shadow root.** Web component z polem hasła dawał zero selektorów i brak
  flagi `sensitive`, więc hasło szło do `snap.md` i na stdout. Ślepe `querySelectorAll`
  (`walkInteractive`, `evidenceInPage`, sonda sesji) przechodzą teraz przez otwarte shadow rooty.
  Nowy fixture `fixtures/shadow.html`.

- **Przejściowy błąd startu silnika był memoizowany na całe życie keepera.** Odrzucona obietnica
  zostawała w `enginePromise`, więc jedno nieudane uruchomienie Chrome (antywirus, wyścig o lock)
  psuło **każdy kolejny** przebieg aż do restartu keepera, i żaden fallback się nie włączał.

- **`browser-inspector script` otwierał sesję, której keeper nie rejestrował.** Timer bezczynności ją
  zabijał, recykling zamykał pod nią przeglądarkę, a `status` pokazywał `sessions 0`. `runScript`
  woła teraz `touchSession` tak samo jak `runSession`.

- **`export` składał flow z całego dziennika.** Po `close` i ponownym `open` eksportował poprzednią
  sesję, z cudzym startowym URL. Linie dziennika są stemplowane `sid`, `exportFlow` bierze ostatnią
  sesję — świadomie po `sid`, a nie po wpisie `close`, bo sesja kończy się także przez TTL,
  `closeAll` i restart keepera.

- **`verify` z martwym refem był twardym FAIL-em także z `soft: true`**, i nie zostawiał wpisu
  w `verifications[]`. Nierozwiązany cel jest teraz werdyktem, nie wyjątkiem kroku.

- **`verify kind: text` i `kind: list` czytały tekst elementów, których strona nie renderuje.**
  `innerText` na nieukazanym węźle zwraca `textContent`, więc asercja przechodziła na zielono na
  ukrytym banerze błędu i na ukrytej karcie potwierdzenia. Widoczność sprawdzana przed tekstem.

- **`ctx.frame` przeżywał nawigację** — po `goto`/`reload` każdy krok z selektorem CSS padał na
  „Frame was detached”. Nowy `frameFor()` porzuca zakres wskazujący odłączoną ramkę.

- **Nieudane żądania powyżej 500. wpisu znikały z raportu, a `failedRequests.truncated` kłamało
  `false`.** `runFlow` omijało `summarize()` i czytało listę przyciętą capem `NETWORK_CAP`; bierze
  teraz własną listę rejestratora i liczy `truncated` z faktycznej liczby.

- **`values/<name>.txt` — plik, na który `report.md` wskazuje jako „całość wartości” — zawierał
  pierwsze 5000 znaków.** Wartość była cięta już przy przechwyceniu, więc reszty nie miał kto
  zapisać. Cięcie zostało wyłącznie w `buildReport`, które od początku umiało odłożyć całość na dysk.

- **`--junit` produkował niepoprawny XML.** Surowy znak sterujący ze strony (np. sekwencja ANSI
  w `console.error`) unieważniał cały plik dla parsera CI. `xml()` czyści znaki spoza produkcji
  `Char` XML 1.0, zachowując pary surogatów.

- **„Internal error” z serializującego obiegu CDP był raportowany jako timeout.** Krok padał w 1 ms,
  a raport twierdził, że strona wisiała przez cały budżet 10 s — diagnoza, na którą naturalną
  reakcją jest podbicie `--timeout`, co nigdy nie pomoże. Mapowanie rozdzielone: `mapCdpError`
  (z tłumaczeniem na timeout) zostaje przy `Runtime.evaluate`, który faktycznie niesie `timeout`,
  drugie wywołanie ma własny `mapSerializeError`. Repro na prawdziwym Chrome.

- **`evaluate` przez CDP przestało odwzorowywać `page.evaluate` 1:1** — `Date`, `Error`, funkcja
  i symbol schodziły do `{}`. Najgroźniejszy wariant: zagnieżdżona `Date` w poprawnie wyglądającym
  obiekcie. Drugi przelot serializuje w stronie przez `JSON.stringify`.

- **Nieudana nawigacja raportowała `cacheHits: 1`.** Wewnętrzna strona błędu Chrome
  (`chrome-error://chromewebdata/`) zgłasza `deliveryType: 'cache'` dla ciała, które sama zmyśliła.
  Wpis liczy się jako trafienie tylko przy `responseStatus > 0`.

- **Kontekst `fresh` wyciekał przy każdym wyjątku przed `close()`** (LIFE-7 z przeglądu wydajności),
  a jego cięższa siostra — lane **współdzielony** — nie oddawał `busy`, gdy rzucił scrub albo
  `setViewportSize`. Trzy klamry `try/finally`.

- **`--tail 0` w `console`/`net` drukowało wszystko zamiast nic** (`slice(-0) === slice(0)`), a przy
  `net --all` zdejmowało jeszcze domyślny cap — flaga budżetowa dawała **więcej** wyjścia niż jej brak.

- **Limity tekstu cięły w środku pary surogatów** — w `report.md` lądował znak zastępczy,
  w `report.json` osierocona połówka pary. Nowy `sliceUnits()` cofa się o jednostkę.

- **`status`/`stop`/`doctor` wisiały 10 minut** przy zaklinowanym keeperze zamiast poddać się po
  500 ms — `runViaKeeper` ignorowało `options.timeoutMs` dla nogi żądania.

- **`browser.fastHeadless` i `browser.motion` z configu nigdy nie docierały do silnika** i nie
  wchodziły w tożsamość keepera, więc dwa configi różniące się tylko nimi dzieliły jedną przeglądarkę.

- **`--only` żądało zmiennych środowiskowych i plików snapshotów, które właśnie wyklucza.**

- **Dwa kroki `snapshot` o tej samej nazwie po cichu nadpisywały swoje pliki** — `validateSteps`
  wykrywa to teraz tak jak duplikaty `screenshot`/`pdf`.

- **`el N`, `elements.md` i `text.txt` liczyły tylko ramkę główną**, więc raport aplikacji osadzonej
  w `iframe` twierdził, że strona jest prawie pusta. Licznik dolicza ramki potomne; **listowanie**
  zostaje przy ramce głównej świadomie — selektor z ramki potomnej nie rozwiązałby się ze strony,
  a kontrakt `evidenceInPage` obiecuje, że każdy wydany selektor znajduje element ponownie.

- **`snap --around` na żywym refie spoza kompaktu kłamało „ref nie w snapshocie”** — rozróżnia teraz
  ref martwy od żywego, ale niewidocznego w kompakcie.

### Changed

- **`fullPage` idzie wreszcie szybką ścieżką CDP — `captureMs` na `nowiro-strona` 614 → ~350 ms.**
  Warunek w `capture.mjs` wykluczał zrzuty całej strony z `Page.captureScreenshot`, więc najdroższy
  zrzut w całym drzewie szedł przez `page.screenshot({ fullPage: true })`. Teraz idzie przez CDP
  z `captureBeyondViewport` i klipem z `Page.getLayoutMetrics.cssContentSize`; na Playwrighcie
  zostaje zrzut elementu (potrzebuje lokatora), strona wyższa niż 16 384 px (limit tekstury Chrome —
  tam CDP odmawia, a Playwright zszywa) i strona o zerowych metrykach.
  **Pomiar poprawił premisę ustalenia**: A/B na najwyższej stronie fixture'ów (bookstore, 1280×6335)
  daje CDP 222 ms wobec Playwrighta 713 ms przy identycznych wymiarach — ale ten sam klip CDP
  z `optimizeForSpeed: false` kosztuje **731 ms**, czyli całe 491 ms to **enkoder PNG, a nie cztery
  obiegi**, które ścieżka Playwrighta dokłada. Kupujemy czas rozmiarem: 3488 KB wobec 2045 KB dla
  tego samego obrazu, na `nowiro-strona` 510 → ~850 KB. To ten sam wybór, który zrzuty viewportu
  robią od pierwszego dnia (§2.2), więc odwrócenie go dla `fullPage` byłoby wyjątkiem, nie regułą —
  ale jest to wybór, nie darmowy zysk, cofa się go jednym `optimizeForSpeed`, i wchodzi w interakcję
  z brakiem retencji w `.scribe-devtools/` (PNG to 94 % objętości tego katalogu). W benchu widać to
  wyłącznie na app-factory, bo zadanie referencyjne nie ma ani jednego zrzutu całej strony: `settled`
  - `parallel: 1` **9520 · 8970 → 8699 · 8142 ms**, `parallel: 3` 3805 · 3751 → **3575 · 3557 ms**;
    wariant `warm` samego benchu stoi w miejscu (304 → 315 ms przy MCP naive 3066 → 2886 — szum).

- **Batch przestał czytać ciała odpowiedzi (`captureBodies` jest tam opt-in) — przebieg zadania
  referencyjnego 232 → 187 ms (−19 %).** Rejestrator czytał `response.text()` dla każdej odpowiedzi
  json/text, a **nic w batchu ciała nie renderuje**: jedynym czytelnikiem `recorder.bodies` w całym
  drzewie jest sesyjne `net <n> --body`. Czekanie na te odczyty było mierzonym `settleMs` 41–57 ms
  z 232 ms przebiegu; teraz jest 0. Sesja bez zmian — tam ciała dalej są domyślnie czytane, bo tam
  ktoś o nie pyta. `auth` też przestał (jego kontekst jest wyrzucany zaraz po logowaniu i nikt nie
  woła na nim `settle()`, więc odczyt zostawał wiszący w kontekście, którego już nie ma).
- **`size` wpisu sieciowego nie zależy już od odczytu ciała**: bierze się z `Content-Length`, a przy
  `chunked` z `request.sizes()` — czyli z `encodedDataLength`, który playwright-core ma w pamięci od
  `Network.loadingFinished`, **bez dodatkowego obiegu**. Zmienia się znaczenie pola: bajty **na
  łączu** (skompresowane, z ramkowaniem) zamiast zdekodowanych — zmierzone na tym samym żądaniu 39
  zamiast 28. Granica, którą trzeba znać: żądanie **wciąż w locie** w chwili budowania raportu nie
  ma ani `ms`, ani `size` (oba wypełnia `requestfinished`, a batch na niego nie czeka) — status, URL
  i wpis w `## errors` są, bo przyszły z odpowiedzi. Opisane w `types.d.ts` i DESIGN §2.2.
- **Przydział snapshotów do lane'ów według kosztu, nie po kolei** (`src/schedule.mjs`, nowy moduł).
  `lane = k % parallel` sadzał snapshoty 0 i 3 na jednym lane'ie niezależnie od tego, ile trwają — na
  configu app-factory z `parallel: 3` daje to makespan 4,35 s przy optimum 3,22 s, choć DESIGN §2.3
  obiecuje „czas ≈ max(lane), nie sum(flow)”. `planLanes` robi offline LPT (najdroższe najpierw, do
  najmniej obciążonego lane'u) po szacunku liczonym **czystą funkcją z configu**
  (`Σ wait.ms + 100 × liczba kroków`) — nigdy z historii na dysku, bo to uczyniłoby `outputDir`
  wejściem planera. Policzone na prawdziwych medianach: 4,35 → 3,24 s (−26 %); **zmierzone** w benchu
  na app-factory `settled` + `parallel: 3`: **4279 · 4147 → 3805 · 3751 ms** (−10 %) — mniej niż
  rachunek, bo szacunek porządkuje snapshoty dobrze, ale nie zna ich prawdziwych czasów; cela
  `parallel: 1` jest z definicji nietknięta (plan jednego lane'u to identyczność). Zmienia się
  **wyłącznie numer lane'u**: kolejność wyników, `_manifest.json.snapshots[]`, JUnit i adresy
  `snapshots[i]` zostają kolejnością configu, a kolejność w obrębie lane'u też — dlatego scrub
  między snapshotami dalej jest w `scrubMs`, nie w `queuedMs` (własność, którą złamała odrzucona
  wcześniej próba z modelem „worker pull”). Przy równych szacunkach plan degeneruje się dokładnie do
  round-robin, więc wszystkie istniejące asercje o lane'ach zostały nietknięte.

### Fixed

- **Keeper wychodził z bezczynności dopiero po zabiciu procesu — timer był resetowany co 30 s.**
  `sweepSessions` (zamiatanie sesji po TTL) kończył się bezwarunkowym `armIdle()`, a `armIdle` kasuje
  timer i ustawia **pełny** budżet od nowa. Zamiatanie chodzi co `min(sessionTtlMs / 2, 30 s)`, czyli
  z domyślnymi ustawieniami co 30 s wobec budżetu 30 minut — deadline był więc przesuwany w
  nieskończoność i keeper (razem z Chrome, 150–960 MB) żył do restartu maszyny. Sonda bez przeglądarki,
  przeskalowana do tej samej proporcji: przy zamiataniu co 100 ms i budżecie 500 ms `onIdle` **nie
  wystrzelił ani razu**; przy zamiataniu co 30 s wystrzelił po 513 ms. Naprawa: zamiatanie uzbraja
  timer tylko wtedy, gdy faktycznie wygasiło sesję — zamiatanie, które nic nie zmieniło, nie jest
  aktywnością. Cały strojony wybór `IDLE_MS_DEFAULT = 30 min` (§2.5: „5 minut zamieniało większość
  drugich wywołań w zimne") dotąd nie miał żadnego znaczenia.
- **Test regresji, którego brakowało.** Istniejące testy nie mogły tego zobaczyć: ustawiały krótki
  `IDLE_MS` przy **domyślnym** `SESSION_TTL_MS`, więc w ciągu dwusekundowego testu zamiatanie nie
  odpalało ani razu. Nowy test odwraca proporcję na produkcyjną (zamiatanie co 100 ms, budżet 800 ms,
  ~8 zamiatań w oknie) i przechodzi przez prawdziwy proces keepera. Sprawdzone: oblewa na kodzie
  sprzed naprawy, przechodzi po niej.

- **`timing.cacheHits` mierzy wreszcie cokolwiek — dotąd był strukturalnie zerowy.** Rejestrator liczył
  trafienia cache'u przez `response.fromCache()`, a takiej metody **nie ma w playwright-core 1.62.1**
  (`grep` po całym pakiecie: zero trafień; `types.d.ts` zna tylko `fromServiceWorker()`). Wywołanie
  rzucało `TypeError`, `safeCall` je połykał, licznik zostawał na zerze — we **wszystkich 86 plikach
  `report.json`** w `bench/out/` `cacheHits` i `cacheHitsDocument` to `(0, 0)`. Metryka jest w kontrakcie
  `report.json` (punkt synchronizacji z app-factory w AGENTS.md), ma własną kolumnę w `bench/BUDGET.md`
  i podpiera tezę projektu z §2.3, że scrub zostawia cache HTTP — a nie mierzyła nic od początku.
  Źródłem jest teraz **Resource Timing API strony**, czytane w tym samym przelocie co dowód końcowy
  (`capture.mjs`), więc bez dodatkowego obiegu do przeglądarki: wpis liczy się jako trafienie, gdy
  `deliveryType === 'cache'` albo `transferSize === 0 && decodedBodySize > 0` (druga forma to zapis
  sprzed `deliveryType`; oba warunki razem odsiewają cross-origin bez `Timing-Allow-Origin`, które też
  raportuje `transferSize: 0`, ale z `decodedBodySize: 0`). Liczone per dokument, bo bufor Resource
  Timing zeruje się przy nawigacji.
- **Test, którego brak pozwolił temu przeżyć.** Stary test rejestratora budował atrapę odpowiedzi
  **z metodą `fromCache`**, której prawdziwy obiekt nie ma — sprawdzał więc własną atrapę. Zamiast niego
  smoke na prawdziwym Chrome: fixture `cache.html` linkuje `cacheable.css`, jedyny plik, który serwer
  testowy wysyła z `Cache-Control: max-age=60`; pierwszy przebieg ma `cacheHits: 0`, drugi na tym samym
  (wyszorowanym) lane'ie musi mieć `> 0`, a `cacheHitsDocument` zostaje `0`, bo dokument nagłówków
  cache'u nie ma. Asercja w obie strony — inaczej przechodziłaby na zepsutym liczniku.
- Przy okazji usunięte martwe pole `NetEntry.fromCache`: rejestrator je ustawiał, `report.json` go nie
  niósł (sprawdzone na artefaktach), czytały je wyłącznie testy.

### Changed

- **Start klienta o 13 ms krótszy: `Intl.DateTimeFormat` budowany leniwie** (`src/cli.mjs`). Konstruktor
  formatera stempla ładował ICU i dane stref w ciele modułu — **12 ms zmierzone** w świeżym procesie
  (`formatToParts` potem 0,05 ms) — a klient `formatStamp` nigdy nie woła: robi to tylko `keeper.requests.mjs`
  przy `batch` i manifesty w `report.mjs`. Płacił za to każdy proces klienta, bo `bin/browser-inspector.mjs`
  importuje `cli.mjs` zawsze. Zmierzone A/B: import `cli.mjs` 15,2 → 3,9 ms, `browser-inspector help`
  **78 → 65 ms** mediany z 5 (budżet 120), bench `browser-inspector-warm-tight` 326 → **316 ms**.
  Keeper przestał płacić ten koszt przed `listen` (buduje formater dopiero przy pierwszym `batch`),
  ale nadal go płaci na ścieżce żądania — więc `first` i `cold` zyskują tylko połowę klienta, co
  pomiar potwierdza: 1373 → 1393 i 1465 → 1509 ms mieszczą się w szumie tych wariantów.
- **`timing.writeMs` rozbity na `shotsMs` i `settleMs`** (`src/flow.mjs`, `types.d.ts`). Jeden wiersz
  BUDGET.md z rozjazdem +380 % nie mówił, w co celować; etykieta („oczekiwanie na zapisy + report.json/md…")
  była wręcz myląca, bo raporty lądują PO zamrożeniu `timing` i kosztują 3 ms. Pomiar na zadaniu benchu,
  5 przebiegów: **`shotsMs` = 0, `settleMs` = 41–57 ms** — całe te ~50 ms to `recorder.settle()`, czyli
  zaległe `Network.getResponseBody` dla ciał, których batch nigdzie nie renderuje (jedyny czytelnik
  `recorder.bodies` to sesyjne `net <n> --body`). Kontrola sufitu: ten sam przebieg z `captureBodies: false`
  daje `settleMs` 0 i **total 232 → 178 ms (−23 %)**, kosztem `size` przy odpowiedzi bez `Content-Length`.
  Etykieta wiersza w §6 i w `bench/budget.mjs` poprawiona; sama zmiana domyślnego `captureBodies` to
  decyzja o treści raportu i czeka na osobne rozstrzygnięcie.
- **Bramka nie uruchamia już smoke dwa razy**: `verify` woła `vitest run --project !smoke`, a `npm run smoke`
  zostaje jako osobny, ostatni krok. `vitest run` bez filtra brał wszystkie projekty łącznie ze `smoke`, więc
  prawdziwy Chrome jechał raz obok testów jednostkowych i drugi raz na końcu — a przy okazji obciążał maszynę
  na tyle, że testy z budżetem 200 ms migotały.
- **`test/keeper.test.mjs` (586 linii, 28 testów, 55 spawnów klienta) rozbity na cztery pliki** wzdłuż własnych
  bloków `describe`: `keeper.identity` (lock, token, stale files, doctor), `keeper.idle` (sesje, TTL, recykling,
  scrub po odpowiedzi), `keeper.queues` (serializacja, `queuedMs`, awarie silnika, brak przeglądarki) i
  `keeper.secrets` (log, dziennik, auth, sekret per sesja). Vitest zrównolegla po plikach, a jeden plik był
  70 % czasu projektu: **`unit` 17,5 → 8,75 s**, te same 355 testów. `writeConfig` i `AUTH` przeniesione do
  `test/fixtures/keeper-harness.mjs`, bo dzielą je teraz cztery pliki.

- **Silnik to pięć modułów zamiast jednego pliku na 2320 linii** — refaktor bez zmiany zachowania
  (te same 423 testy + 18 smoke, ten sam `report.json`). `src/engine.mjs` (242 linie) jest teraz
  wyłącznie miejscem składania: normalizuje dwa zapisy `createEngine`, spina części i trzyma to, czego
  żadna z nich nie może wiedzieć — flagę `closed`, listenery `on('disconnected')` i regułę „sesja nie
  przeżywa swojej przeglądarki” (`pool.setBeforeClose`). Wydzielone: `src/lanes.mjs` (`createLanePool` —
  launch, lane'y `scratch[0..N-1]`, `spare`, scrub, RSS, recykling, plus `launchPlan`/`launchBrowser` i
  stałe budżetów), `src/steps.ctx.mjs` (`makeStepContext`, `runStep`, `navigate`, `resolveSelector`,
  `writeSnapshotFiles` — jeden kontekst, który widzi każdy RUNNER, bez żadnego stanu puli),
  `src/flow.mjs` (`createFlowRunner`: `runFlow`, `runBatch`, `finishRun`) i `src/session.mjs`
  (`createSessions`: `openSession`, `runCommand`, `runScript`, `exportFlow`). Obie połowy dzielą pulę i
  kontekst kroku i nic więcej — to jest dowód, że batchowy `click` i `browser-inspector click` to ten sam
  kod (DESIGN §2.2). Pomiar po refaktorze (`npm run bench`): warm **333 ms** (było 348), warm-tight 326
  (333), first 1373 (1478), cold 1465 (1548) — **8,7×** wobec MCP naive (było 8,3×); w BUDGET.md ubył
  jeden czerwony wiersz, żaden nie doszedł. Publiczny obiekt `createEngine(...)` ma te same klucze co przedtem;
  `launchPlan`/`launchBrowser`/`FAST_HEADLESS_ARGS`/`E_BROWSER_MISSING` importuje się teraz z
  `src/lanes.mjs` (bez re-eksportu, żeby CODE-INDEX pokazywał prawdziwego właściciela).
- **Keeper rozdzielony na proces i żądanie**: `src/keeper.requests.mjs` (673 linie) to protokół
  (`PROTOCOL_VERSION`, linia `done`, `EngineUnavailableError`, `statusOf`) i `handleRequest` z czterema
  uchwytami zadań (batch, session, script, export); `src/keeper.mjs` (923 linie, było 1574) to sam proces:
  lock, listen, plik pid, log, kolejki, kontekst, ładowanie silnika, spawn. Zależność biegnie w jedną
  stronę — proces importuje żądania, nigdy odwrotnie. `runInProcess` w kliencie bierze `handleRequest`
  z nowego modułu (dalej dynamicznie, więc graf startu klienta bez zmian).
- **Jeden czytnik `package.json`**: `packageVersion(dir, fallback)` w `src/paths.mjs` zastąpił trzy kopie
  tej samej pętli try/catch (klient, silnik, keeper). Identyczność hasha tożsamości bez zmian (dalej `''`
  dla nieczytelnego pakietu, `'0.0.0'` tam, gdzie raport potrzebuje numeru).
- **Trzy testy `idle and sessions` przestały być wyścigiem z własnym klientem**: brały pid keepera
  spod `up`, a potem uruchamiały komendę klienta — start procesu klienta to 80–190 ms, więc na
  obciążonej maszynie budżet `BROWSER_INSPECTOR_IDLE_MS: 200` mijał przed połączeniem, keeper z `up`
  wychodził (`shutdown: idle` w logu) i klient stawiał drugiego. Dwa testy czytają pid PO komendzie
  otwierającej sesję (to ten keeper trzyma sesję), trzeci dostał budżet 600 ms. Zachowanie narzędzia
  bez zmian — mierzone: start klienta `browser-inspector help` 80 ms mediana z 5 (budżet 120),
  keeper nasłuchuje 54 ms po starcie (było 58).

- **Strażnik grafu klienta zna nowe moduły**: `test/client-imports.test.mjs` odrzuca teraz każdy moduł
  silnika (`engine`, `lanes`, `flow`, `session`, `steps.ctx`, `steps.run`), nie tylko wejście — bez tego
  rozbicie pliku otwierałoby cichą furtkę do 300 ms startu klienta (AC-13).

### Changed — BREAKING

- **Skrót `bi` znika z narzędzia — wszędzie pełna nazwa `browser-inspector`** (reguła właściciela; narzędzie
  ma jeden dzień, więc bez aliasów zgodności). Binarka: `bin/browser-inspector.mjs`,
  `"bin": { "browser-inspector" }`, skrypt `npm run browser-inspector` w korzeniu i `pnpm browser-inspector`
  w app-factory (było `bi`). Zmienne środowiskowe: prefiks `BROWSER_INSPECTOR_` zamiast `BI_` dla każdej bez
  wyjątku (`_DAEMON`, `_SOCKET`, `_TMPDIR`, `_IDLE_MS`, `_SESSION_TTL_MS`, `_SESSION`, `_UNSAFE`,
  `_ENGINE_MODULE`, `_STEP_TIMEOUT_MS`, `_CHANNEL`, `_BROWSER_PATH`, `_BROWSER_ARGS`, `_MAX_JOBS`,
  `_MAX_RSS_MB`, `_LANE_IDLE_MS`, `_SCRUB_OP_MS`, `_REQUEST_TIMEOUT_MS`, `_CONNECT_TIMEOUT_MS`; testowe
  `_TRACE_LOADS`, `_PERF`, `_PERF_CLIENT_MS`, `_SKIP_SMOKE`, `_FAKE_*`). Tożsamość keepera: pipe
  `\\.\pipe\browser-inspector-<user>-<hash>` / `browser-inspector-<uid>-<hash>.sock`, pliki pid/lock/log
  `browser-inspector-<hash>.*`, katalogi tymczasowe `browser-inspector-*`, tytuł procesu
  `browser-inspector-keeper`, argument `--bin` (było `--bi`). W plikach wyjściowych i protokole: `binPath`
  (było `biPath`), `engine['browser-inspector']` i `tooling.script` w `report.json`, JUnit
  `name="browser-inspector"` / `classname="browser-inspector.<suite>"`, prefiks błędów na stderr
  `browser-inspector:`. Podpowiedzi w stdout mówią `browser-inspector snap` / `browser-inspector up | doctor`
  (słowa wokół nazwy skrócone, żeby linie zostały ≤ 160 znaków / ≤ 40 tokenów; `KEEPER_UNAVAILABLE` brzmi
  `sessions need the keeper (browser-inspector up | doctor); batch: --no-daemon`, a powód nie powtarza
  nazwy pipe — `no keeper after 3 000 ms (no pid file)`; `browser-inspector status` ma cztery linie: nagłówek
  z pipe, `up`, `rss` / liczniki / wersje / sama ścieżka `bin/browser-inspector.mjs` — jedyna linia ponad
  160 znaków, jak w `doctor`; `keeper not running` podaje nieaktualny plik pid w osobnej linii). Zip portable: shimy `browser-inspector.cmd` /
  `browser-inspector`. Bench: warianty `browser-inspector-warm`, `-warm-tight`, `-warm-fresh`, `-first`,
  `-cold`, `-interactive-naive/lean`, moduł `bench/browser-inspector-run.mjs` (było `bench/bi-run.mjs`).
  Blok instrukcji w AGENTS.md przepisany z pełną nazwą: **158 tokenów o200k** (było 146), limit w
  `scripts/check-instruction-sync.mjs` i AC-6 podniesiony **ze 150 do 200** — właściciel świadomie płaci
  tokenami za pełną nazwę; blok zostaje tak krótki, jak nazwa pozwala. Katalogi wyjściowe
  `.scribe-devtools/browser-inspector/…` bez zmian (już były pełną nazwą). README, AGENTS.md, DESIGN
  (§2.1, §2.4, §2.5, §3.1, §4.4, §5, §8, §9), ACCEPTANCE (AC-1…AC-20), PLAN, szablon flow, `docs/STEPS.md`
  (generowany) i `.gitignore` (`.bi/` usunięte — nic go nie tworzy) przepisane. AGENTS.md §Wydanie: rozwój
  toczy się pod numerem wydanej wersji aż do podbicia przy następnym wydaniu — zamrożony jest tylko wydany zip.

### Fixed

- `browser-inspector stop` usuwa pliki pid i lock **przed** odpowiedzią `ok keeper stopping`, więc `status`
  wydany zaraz po `stop` mówi `keeper not running`, a nie `stale pid file` (keeper kończył się poprawnie,
  ale sprzątał dopiero po zamknięciu przeglądarki). Test: `stop` → `status` bez linii o pliku pid.

### Changed

- Domyślny katalog wyników to **`.scribe-devtools/`** (było `.scribe/`): `DEFAULT_OUTPUT_DIR`
  = `./.scribe-devtools/browser-inspector`, sesje w `.scribe-devtools/browser-inspector/session/<nazwa>`,
  ostrzeżenie `auth` o pliku sesji poza `.scribe-devtools/`; fixture, szablon flow, README, DESIGN,
  `.gitignore`/`.prettierignore` i testy przepisane. Jawny `outputDir` w configu (np. app-factory:
  `./.scribe/browser-inspector`) działa jak dotąd — to reguła dla wartości domyślnej.
- **Zip wydanej wersji jest zamrożony**: gdy istnieje tag `v<wersja>` i plik w `download/`, hook
  i `npm run portable` nie przebudowują go (`isFrozen`, komunikat „wersja … jest wydana”); nowy kod
  wymaga podbicia wersji, `--force` przebudowuje mimo to. Zip 0.1.0 przywrócony do bajtów z wydania
  (sha256 `81b2ce52…`, identyczny z assetem Release'a).
- Zip portable jest **śledzony w repo**: `download/scribe-devtools-portable-<wersja>.zip` + sidecar
  `.sha256` (format `sha256sum`), budowany przez hook pre-commit po `CODE-INDEX.md` i `docs/STEPS.md`
  oraz przez `npm run portable`; każda wydana wersja zostaje w `download/`. Build jest
  deterministyczny (własny zapis zipa w Node: stały znacznik czasu, posortowane wpisy, deflate 9,
  bez pól extra — bsdtar i `zip` zapisują atime/ctime, więc dwa buildy się różniły), dzięki czemu
  niezmieniony pakiet nie dokłada bloba do historii; `zipEntries` czyta katalog centralny bez
  zewnętrznego `tar`. Wersja pochodzi wyłącznie z `packages/browser-inspector/package.json`, a build
  odmawia, gdy korzeń podaje inną (`readVersion`). Testy: determinizm (dwa buildy → jeden hash),
  `buildPortable` z `changed`, separatory `/`, round-trip zip → unpack → `browser-inspector help`.

## 0.1.0 — 2026-09-02

Pierwsze wydanie: `bi` (browser-inspector 2) — zamiennik serwera MCP Playwrighta. Bench: bi-warm 358 ms vs MCP naive warm 3871 ms (10,8×), tokeny 400 vs 6814 na sesję; szczegóły w `bench/RAPORT.md`. Otwarte: AC-5 (bi-cold 2,08 s > 1,75 s), AC-6 na limicie (400 tokenów).

Zip portable pakuje bsdtar (`tar -a -cf`), nie `Compress-Archive`: cmdlet zapisywał nazwy wpisów z backslashami (157 ze 160 w pierwszym buildzie 0.1.0), przez co archiwum rozpakowywało się na Linuksie/macOS do płaskich plików; test round-trip sprawdza teraz separatory (`zipEntries`).

### Added

- WP0 — szkielet repozytorium: workspaces `packages/*` + `bench`, `packages/browser-inspector`
  (`bin: bi`, `playwright-core` przypięty exact 1.62.1, engines ≥ 22), `bench` (`@playwright/mcp`
  exact 0.0.80, `gpt-tokenizer`), `vitest.config.mts` z projektami unit/scripts/bench/smoke/compat
  (perf opt-in przez `BI_PERF=1`), `tsconfig.json` (`checkJs`, `noEmit`, NodeNext), hook
  `.githooks/pre-commit` (CODE-INDEX.md + docs/STEPS.md), skrypty `index-code` (port ze scribe
  na drzewo `.mjs`, z importami dynamicznymi), `portable-zip` (marker `PORTABLE`, shimy `bi`/`bi.cmd`,
  bez builda), `check-instruction-sync` (blok AGENTS.md ≡ `INSTRUCTION` benchu, limit 150 tokenów
  — AC-6, AC-18), `gen-steps-doc` (szkielet; AC-20), `AGENTS.md` z instrukcją dla agenta
  (146 tokenów o200k), `README.md`, `CLAUDE.md`, `bench/probes/README.md`.
- WP1: kontrakty i moduły czyste — STEPS (45 kroków), parseArgs, loadConfig/lintConfig, paths
  (identityHash, pipeName, isCI, daemonEnabled), print, redact, scrubPlan/needsFreshContext/GEN_SCRIPT,
  withDeadline, types.d.ts; docs/STEPS.md generowany (AC-8, AC-12, AC-14, AC-16, AC-20).
- WP2: silnik batch — createEngine (chrome → msedge, E_BROWSER_MISSING z listą prób), lane'y scratch
  z jedną trwałą kartą szorowaną w miejscu (applyScrub 1:1 z scrubPlan, 5–10 ms/origin), spare prewarm,
  runFlow (kroki pod withDeadline, dowód końcowy, report.json/md + _manifest.json), finishRun (manifest
  przebiegu, JUnit), zdrowie (crash → nowa karta, disconnected, recykling BI_MAX_JOBS/RSS); rejestrator
  (since-last, ciała ≤ 64 KB, cacheHits, tabs[], sw=blocked); settled; CDP-zrzuty; evaluate przez
  Runtime.evaluate z mapowaniem wyniku; RUNNERS dla 45 kroków; fixture'y i smoke na prawdziwym Chrome
  (AC-1, AC-7, AC-9, AC-11, AC-13, AC-15, AC-16).
- WP3: snapshot i refy — parseSnapshot, compactSnapshot/compactLines (952 → 41 linii, fold powtarzalnych
  rodzeństw), boxJoin (sidecar snap.json, 139/139 na bookstore), findInSnapshot (≤ 10), diffSnapshot,
  aroundRef, namesContext (--names, ≤ 60 znaków), locatorFor/locatorForElement/uniqueIn, walkInteractive,
  resolveRef (aria-ref literalnie, count() → jeden pełny snapshot → FAIL bez czekania); fixture'y
  bookstore/wizard z prawdziwego Chrome (AC-9, AC-10).
- WP4: raport i artefakty — buildReport/renderReportMd (§5.1, 187 tokenów na próbce; ## steps tylko
  przy FAIL, ## verify tylko przy soft FAIL, nagłówek warunkowy), renderElementsMd, renderJUnit,
  buildManifest/buildSnapshotManifest (stempel Europe/Warsaw, konwencja read-runtime), writeArtifacts
  (czeka na zapisy zrzutów przed report.json); dziennik sesji appendJournal/readJournal i eksport
  exportFlow/writeFlowExport (refy → selektory, valueFromEnv, odmowa nadpisania bez --force)
  (AC-1, AC-7, AC-14).
- WP5: keeper (lock O_EXCL, nasłuch przed silnikiem, token, NDJSON bez env, kolejki lane:<n>/session:<name>
  z queuedMs, idle 30 min, TTL sesji, recykling, status/doctor, log bez sekretów), klient (spawn → retry →
  fallback tylko dla batchu, resolveValues/secretValues/files w kliencie, kody wyjścia), bin/bi.mjs bez
  playwright-core; test/hooks/trace-loads.mjs (AC-8, AC-12, AC-13, AC-14).
- WP6: sesja interaktywna — runCommand (jedna linia ≤ 160 znaków / ≤ 40 tokenów z deltami navigated /
  dom Δ / el a→b / +N console.error / +N net failed / dialog), sesje po nazwie na własnym kontekście,
  open z snap.md/json, find/snap (--max 25, --diff, --around, --grep, --names, --all), console/net od
  ostatniego wywołania, net <n> --body/--req, fetch, frame jako zakres CSS, tabs/tab z popupami, dialog
  wg polityki z beforeunload auto-accept, shot --mark, eval --file/--el z eval-NNN.txt, locator, trace,
  video (open --video), run --file tylko pod BI_UNSAFE=1 (exit 2), close, dziennik journal.jsonl
  z selektorem rozwiązanym przy akcji, export, runScript (bi script, adresy script[n]), fixtures/tabs.html,
  smoke sesyjny przez keepera (AC-8, AC-9, AC-14, AC-15).
- WP7: auth i storageState — ensureSession (logowanie formularzem RAZ przez RUNNERS silnika na świeżym
  kontekście z serviceWorkers 'allow', OAuth password/client_credentials na tokenUrl albo Keycloak →
  storageState zbudowany ręcznie + meta z ważnością tokenu, reuse pliku wg maxAgeMinutes i expires_in/exp),
  storageStateFor (auth: false = widok anonimowy), AuthError E_AUTH bez wartości sekretów; fixture'y
  login.html i kc-token.mjs; smoke: login raz → dwa snapshoty zalogowane, trzeci anonimowy (AC-11, AC-14).
- WP8: zgodność, docs, pakowanie, app-factory — `test/compat/smoke-gate.test.mjs` (bramka app-factory
  przez `bin/bi.mjs` na buildach z `../app-factory`: `--no-daemon`, keeper dwa razy z rzędu — drugi
  przebieg dowodzi scrubu: `dziennik-uczen` completed, `naglowek-pl` po polsku — `--parallel 3`
  z identycznym zbiorem completed, `report.json` identyczne modulo timing/engine, forma
  `Error: uczen widzi przycisk nauczyciela` w `steps[].error`, `navigationError` tylko przy padniętej
  nawigacji, `bi lint-config` z trzema sugestiami; AC-1, AC-2, AC-16, AC-17), `scripts/portable-zip.test.mjs`
  (staging portable → `bi help`, `bi lint-config` i batch `--no-daemon` z rozpakowanego drzewa bez npm,
  zip → rozpakowanie → `bi help`; AC-20), `templates/flow.md` (port szablonu ze scribe na nową
  gramatykę: sesja → eksport, `auth`, `verify`, `parallel`), README (instalacja, `pnpm bi`, batch, sesja
  z próbkami stdout, `bi up` jako hook SessionStart, `bi doctor`, co browser-wide nie jest czyszczone,
  ACL `%TEMP%`, CI, migracja ze scribe), AGENTS.md (bramki, artefakty generowane, punkty synchronizacji
  z app-factory, procedura wydania z bramką app-factory), wpisy CHANGELOG WP1–WP7; integracja app-factory
  (drzewo robocze, bez commitu): `findRunner(env, exists, root)` w `tools/scripts/smoke-browser.mjs`
  (`SCRIBE_DEVTOOLS_DIR` → `../scribe-devtools` → scribe przez niezmienioną `findScribeDir`, `fixCommand`
  zamiast stacktrace'u), przypadki `findRunner` w spec, skrypt `"bi"` w package.json, dwa zdania
  w AGENTS.md; bramka `pnpm smoke:browser` zielona z `CI=true` i z keeperem dwa razy z rzędu (AC-1).

### Fixed

- Weryfikacja końcowa: `--disable-gpu-compositing` dołączone do domyślnych flag headless
  (`FAST_HEADLESS_ARGS`, opt-out `fastHeadless: false`). Trace Chrome 152 pokazał, że sekundę po każdym
  `load` opóźnione zadanie z `blink/.../widget_base.cc` zwalnia LayerTreeFrameSink renderera
  (`ProxyMain::Stop` → `SetLayerTreeFrameSink`), a runda do procesu GPU blokuje wątek główny na
  80–490 ms; ciepły przebieg startujący 300 ms po poprzednim trafiał dokładnie w to — mediana `bi-warm`
  746 ms wobec 355 ms `bi-warm-tight` (iloraz 5,06× na styku progu). Kompozycja programowa nie ma czego
  zwalniać; WebGL działa (nowiro w bramce compat), goto/click/zrzut bez zmian (16–48 ms). Diagnoza i
  sondy: `docs/handoff/FINAL.md` (AC-3).
- `--no-daemon` / CI / fallback kończyły się do 2 s po zapisaniu raportu: zegary-capy w `recorder.mjs`
  (`BODY_READ_MS`, przegrane w `Promise.race` z odczytem ciała i `settle()`) trzymały pętlę zdarzeń, aż
  `bin/bi.mjs` wymusił wyjście po 2 s (`bi-cold` 3 257 ms, z czego ~1,5 s bezczynnego czekania na trzy
  skończone odczyty). Zegary są `unref()` — proces wychodzi z chwilą zapisania raportu, a przy prawdziwie
  wiszącym odczycie pipe przeglądarki i tak trzyma pętlę, więc cap dalej działa (AC-5).
- `test/session.test.mjs`: asercja `net --all --tail 1` toleruje `0|1 ms` jak wcześniejsza w tym samym
  teście — tik zegara między `request` a `requestfailed` nie jest porażką.
- Przegląd kodu (20 uwag, `docs/handoff/FIX.md`): keeper — silnik, który nie wstał (`E_BROWSER_MISSING`,
  brak modułu), to wyjątek `EngineUnavailableError` zamiast linii `done` w slocie wyniku zadania; batch
  odpowiada `FAIL E_BROWSER_MISSING: …` z listą prób (także `--no-daemon`), sesja `FAIL keeper: engine
unavailable`, a `serve()` ma `try/catch/finally` — każde żądanie dostaje linię `done` i zamknięte gniazdo;
  klient ma stróża `BI_REQUEST_TIMEOUT_MS` (10 min bez linii z keepera → batch w procesie, sesja `exit 2`)
  (AC-12, AC-13).
- Sekrety per SESJA (§2.6): `Session.secretValues` to suma `secretValues` wszystkich komend od `open`;
  `get --value`, `eval`, `snap.md/json/full.yml`, `console/net.jsonl`, dziennik i eksport redagują tę sumę,
  keeper redaguje linie sesji zbiorem wszystkich sekretów procesu (AC-14).
- `auth` z configu jest WYKONYWANE: keeper (i `engine.runBatch`) wołają `ensureSession` raz przed
  lane’ami, każdy snapshot poza `auth: false` dostaje `storageStateFor` (`laneOpts.storageState`); porażka
  logowania to `FAIL E_AUTH: …` z `exit 2` bez ani jednego anonimowego przebiegu; smoke przez `bin/bi.mjs`
  (`--no-daemon` i keeper dwa razy: jedno logowanie, `login-count` 1) (AC-11).
- Recykling przeglądarki tylko przez keepera i tylko między zadaniami: `runFlow` nie recyklinguje (zamykał
  przeglądarkę pod innymi lane’ami `--parallel`), keeper wymaga pustej kolejki, zera sesji i wolnych
  lane’ów, należny recykling czeka (`recycle deferred: N sessions open`) i wykonuje się po `bi close`;
  `closeBrowser()` kończy sesje jawnie. RSS: pidy przeglądarki i rendererów z `SystemInfo.getProcessInfo`
  (playwright-core 1.62 nie ma `browser.process()` dla kanału), próbka `tasklist`/`ps` w tle co 10 zadań po
  odpowiedzi (`engine.sampleRss()`, jedna komenda dla wszystkich pidów), `status()` zwraca cache — nigdy
  proces na ścieżce zadania (AC-12).
- Scrub: każda operacja pod `withDeadline(BI_SCRUB_OP_MS = 2000)`; timeout = zawieszony renderer → plan
  liczony ponownie jako `crash` (nowa karta, `timing.tab = new`), lane nigdy nie wisi; `DOMStorage.clear`
  (mierzone zawieszenia ~500 ms w 1 scrubie na 3–5) zastąpione `Runtime.evaluate` w stronie (~1 ms); `scrub()`
  zwraca koszt każdej operacji (`ops`), wolne trafiają do logu. Keeper wykonuje scrub **po odpowiedzi w
  kolejce lane’u** (`afterAnswer`), więc `bi-warm` ma go poza stoperem, a `bi-warm-tight` płaci jako
  `queuedMs` (§2.3/§6); `runFlow` scrubuje tylko brudny lane (siatka bezpieczeństwa, między snapshotami
  jednego batchu). BUDGET dzieli wiersz na `queuedMs` i `scrubMs`.
- Rejestrator: ciała tylko JSON/`text/plain|html|xml|csv|markdown` (bundle JS/CSS z app-factory — 840 KB na
  snapshot — już nie przechodzą przez pipe), `content-length` > 64 KB i `text/event-stream` pomijane PRZED
  odczytem, każdy odczyt i `settle()` ograniczone `BODY_READ_MS` (2000) — raport zawsze się zapisze; powód w
  `NetEntry.bodySkipped`, `bi net <n> --body` drukuje `(no body captured: <powód>)`.
- Lock/pid: zapis atomowy (`tmp` + `link`), holder „żywy” wg `kill(pid, 0)` uznany za stary, gdy plik ma
  > 5 s i nie odpowiada na pipe (pid z recyklingu po restarcie); `bi stop`/`bi status` bez keepera nazywają
  > stary plik pid. `BI_UNSAFE` wchodzi do hasha tożsamości — keeper `unsafe` to osobny proces.
- `form`: para `<cel>=<wartość>` dzielona na pierwszym `=` poza nawiasami i cudzysłowami
  (`[data-testid=field-name]=Jan`, `input[name="q"]=x`, `e5=a=b`).
- `paritySummary` (RAPORT.md): komórki z `\|` nie przesuwają kolumny statusu — 23 ✅ · 1 ⚠️ · 2 ❌ na 27 wierszy
  (było 11 ✅), test na prawdziwym DESIGN.md.
- Zapisy poza stoperem: `_manifest.json` i JUnit przez `fs.promises` równolegle (przed `done`), dziennik i
  `console/net.jsonl` sesji na łańcuchu per sesja czekanym tylko przez `close`/`export`.
