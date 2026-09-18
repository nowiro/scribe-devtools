# /rewrite-to-native — czy przepisać indeksowanie (albo inny skrypt narzędziowy) na Rust lub inny język

Masz skrypt narzędziowy w Node (np. generator `CODE-INDEX.md`) i pytanie „czy nie szybciej w Ruście?".
Odpowiedź ma być liczbą, nie opinią. W tym runie niczego nie przepisujesz: mierzysz, rozkładasz czas na
składniki, wyczerpujesz tańsze opcje, potem decyzja z tabelą. Komendy w składni bash (Git Bash); w
PowerShellu `Measure-Command { node … }`. **Nie commituj i nie pushuj bez zgody.**

Zasada nadrzędna: przepisanie w tym samym runtime zmienia tylko czas obliczeń w procesie; binarka natywna
usuwa dodatkowo start runtime'u (kilka ms zamiast ok. 85 ms Node). Gita, dysku i narzutu Nx nie zmieni nic.
Zanim padnie słowo „Rust", te składniki mają być zmierzone osobno.

Wszystkie komendy uruchamiaj z katalogu projektu, który skrypt indeksuje (tam, gdzie leży jego
`package.json`; dla projektu zagnieżdżonego, np. `copilot-builder/`, to ten podkatalog). `<skrypt>` to ścieżka
skryptu względem tego katalogu, np. `tools/scripts/index-code.mjs`.

## 0. Pomiar (nic nie edytuj)

1. Gdzie i jak często skrypt biega (cały projekt bez Markdownu, bo `verify` bywa skryptem w `tools/`, a hook,
   CI i `.vscode/tasks.json` wołają skrypt przez `npm run`):
   `git grep -n -E "<nazwa-pliku-skryptu>|<nazwa-skryptu-npm>" -- . ':!*.md'`
   (np. `"index-code|code-index"`; w repo z projektem zagnieżdżonym dołóż `':!<podkatalog>'`, inaczej zliczysz
   jego wywołania) → hook pre-commit, `verify`, CI, watch/IDE. Zapisz częstość: raz na commit / raz na
   `verify` / co zapis pliku.
2. Ściana: 5 przebiegów, mediana, **zawsze z `--check`** — bez niego skrypt nadpisuje `CODE-INDEX.md`, a krok 0
   niczego nie edytuje. Mierz `--check` oraz, jeśli repo woła `--staged`, `--staged --check`; tryb zapisu to ten
   sam przebieg plus jeden `writeFileSync`, nie mierz go osobno:
   ```bash
   for i in 1 2 3 4 5; do s=$(date +%s%N); node <skrypt> --check >/dev/null 2>&1; e=$(date +%s%N); echo $(( (e-s)/1000000 )); done | sort -n
   ```
   Jeśli na czystym drzewie `--check` mówi „fresh", a `--staged --check` „STALE", eksport staged jest zepsuty
   (np. projekt zagnieżdżony w większym repo: `git checkout-index -a` eksportuje całe repo nadrzędne ze
   ścieżkami z prefiksem katalogu projektu). Zapisz to w raporcie jako błąd poza zakresem pomiaru i nie mierz
   tego trybu; podłogę z punktu 3 zmierz mimo to.
3. Podłoga runtime'u: ta sama pętla dla `node -e 0`. Dla `--staged` osobno `git checkout-index -a --prefix=<tmp>/`
   i `rm -rf <tmp>`.
4. Czas w procesie, bez startu Node: zapisz sondę do pliku w katalogu tymczasowym (nie jako `node -e`, patrz
   Pułapki) i uruchom `node <tmp>/split.mjs . <skrypt>`. Sonda mierzy w jednym procesie walk (`listSourceFiles`),
   odczyt plików i całe `generateIndex(root)`; **obliczenia = `generateIndex` − walk − odczyt**. `generateIndex`
   wymaga katalogu projektu jako argumentu; bez niego rzuca `TypeError`.
   ```js
   import { readFileSync } from 'node:fs';
   import path from 'node:path';
   import { pathToFileURL } from 'node:url';
   const [root, script] = process.argv.slice(2);
   const m = await import(pathToFileURL(path.resolve(root, script)).href);
   const median = (xs) => [...xs].sort((a, b) => a - b)[xs.length >> 1];
   const [walk, read, whole] = [[], [], []];
   let files = [], bytes = 0;
   for (let i = 0; i < 5; i += 1) {
     let t = performance.now(); files = m.listSourceFiles(root); walk.push(performance.now() - t);
     t = performance.now(); bytes = 0;
     for (const f of files) bytes += readFileSync(path.join(root, f)).length;
     read.push(performance.now() - t);
     t = performance.now(); m.generateIndex(root); whole.push(performance.now() - t);
   }
   const [w, r, g] = [median(walk), median(read), median(whole)];
   console.log(`pliki ${files.length} · ${(bytes / 1e6).toFixed(2)} MB · walk ${w.toFixed(1)} · odczyt ${r.toFixed(1)}` +
     ` · generateIndex ${g.toFixed(1)} · obliczenia ${(g - w - r).toFixed(1)} ms`);
   ```
5. Rozkład na funkcje: każdy eksportowany parser na tym samym korpusie, 3 rundy, tabela `funkcja | ms`.
   Parsery z parametrem `code` (źródło z wygaszonymi komentarzami) mierz z `code` policzonym przed pomiarem,
   a `stripBlockComments` jako osobny wiersz — inaczej każdy parser liczy wygaszanie jeszcze raz.
6. Szukaj kwadratów, nie języka: skan od początku pliku per trafienie (`for (let i = 0; i < index…)` w
   funkcji wołanej w pętli po `matchAll`); regexp zaczynający się od identyfikatora
   (`([A-Za-z_$][\w$.]*)\s*\.…`, próbowany przy każdym identyfikatorze w pliku); ta sama transformacja
   liczona kilka razy na plik (`stripBlockComments` w kilku parserach); `slice(0, index)` w pętli;
   `replace(/[^\n]/gu, ' ')` (zamiana per znak).

Wyjście kroku 0: tabela `składnik | ms | % ściany` — start runtime'u (punkt 3), git/dysk (tylko `--staged`),
ładowanie modułu i porównanie z indeksem (= ściana − start − `generateIndex`), walk, odczyt, obliczenia —
plus tabela per funkcja i lista kwadratów jako `plik:funkcja`. Pokaż i czekaj na „dalej".

## 1. Decyzja — progi

Obliczenia ≥ 1 s przed naprawą kwadratów → najpierw krok 2.3 i zmierz ponownie, dopiero potem tabela.
Wiersze sprawdzaj od góry, pierwszy pasujący rozstrzyga; wyjątek: przebieg przy każdym zapisie pliku
(watch, IDE) wygrywa z wierszem 1.

| Wynik pomiaru | Werdykt |
|---|---|
| start runtime'u ≥ 40% ściany | zysk z przepisania to start, nie język; górna granica = ściana bez gita/dysku − ok. 20 ms (binarka natywna); najpierw nie uruchamiać wcale (krok 2.1), potem inny runtime (krok 2.5: tylko gdy repo już go ma; start zmierz tą samą pętlą co `node -e 0`, np. `bun -e 0`) |
| obliczenia < 1 s na realnym korpusie, przebieg raz na commit / `verify` | nie przepisuj; napraw kwadraty w JS (krok 2.3) i zmierz ponownie |
| obliczenia 1–5 s po naprawie kwadratów, przebieg raz na commit / `verify` | nadal nie; pokaż udział w `verify` — w bramie liczonej w dziesiątkach sekund to szum |
| obliczenia > 5 s po naprawie kwadratów (przy ok. 14–17 ms/MB parserów to korpus rzędu 300–350 MB) **albo** przebieg przy każdym zapisie pliku (watch, IDE) | kandydat; najpierw natywna biblioteka z npm (krok 2.4), własny kod dopiero po niej |
| potrzebny prawdziwy parser (AST, typy) zamiast regexpów | to nie jest pytanie o język — gotowy parser (`oxc-parser` przez napi, API TypeScriptu), nie własny |

Pytania do właściciela, zanim padnie „tak": kto utrzymuje drugi toolchain; skąd binarka na każdą platformę
(Windows dev, Linux CI, repozytoria generowane z szablonu); czy tanie modele z rosteru mają procedurę na
ten język; czy oszczędność `X ms × przebiegów dziennie` jest warta tych kosztów.

## 2. Tańsze opcje, w tej kolejności (każda: pomiar przed/po tym samym protokołem)

1. Nie uruchamiać: w hooku tylko, gdy `git diff --cached --name-only` trafia w indeksowane katalogi;
   `--check` w `verify` zostaje.
2. Cache po treści: hash plików korpusu → pomiń regenerację, gdy równy.
3. Kwadraty w JS, bez zmiany API — pięć wzorców, każdy z tym, po czym go poznać i dlaczego działa:

   | wzorzec | przed | po | dlaczego szybciej |
   |---|---|---|---|
   | regexp od identyfikatora | `/([A-Za-z_$][\w$.]*)\s*\.\s*(?:on\|once\|addListener)\s*\(…/g` | `/\.\s*(?:on\|once\|addListener)\s*\(…/g` + odczyt odbiorcy wstecz trzema pętlami `while`: po białych znakach, po `[\w$.]`, potem dosunięcie startu do przodu do `[A-Za-z_$]` | stary wzorzec jest próbowany przy każdym identyfikatorze w pliku: zjada zachłannie cały łańcuch, nie znajduje `.on(`, cofa się znak po znaku (rzędu k² prób na identyfikator długości k), przesuwa o jeden znak i od nowa; nowy zaczyna od literalnej kropki i odrzuca każdą pozycję po 1–2 znakach, a trafień jest kilkadziesiąt na cały korpus (31 w 53 modułach korzenia, najwięcej 10 w jednym) |
   | zamiana per znak | `block.replace(/[^\n]/gu, ' ')` | `block.split('\n').map((l) => ' '.repeat(l.length)).join('\n')` | jedno dopasowanie i jedno wywołanie maszynerii zamiany na każdy znak komentarza (setki tysięcy na korpus) → kilka operacji na linię, spacje alokowane hurtem |
   | ta sama transformacja w kilku parserach | każdy `parseX` woła `stripBlockComments(source)` | `generateIndex` liczy raz, parsery dostają `parseX(source, code = stripBlockComments(source))` | wartość domyślna parametru zachowuje stare wywołania i testy; koszt spada z N× do 1× na plik |
   | skan od początku pliku per trafienie | `insideTemplateLiteral(code, index)` liczy backticki od 0 do `index` w pętli po `matchAll` | `templateLiteralMap(code)` — jeden przebieg, `Uint8Array` z parzystością dla każdego indeksu, odczyt O(1) | M trafień × N znaków → N + M; zmierzone 249 wywołań skanujących ponownie 1 mln znaków |
   | kopia prefiksu pliku per trafienie | `source.slice(0, match.index).replace(/\s+$/u, '')` przy każdym eksporcie, potem `endsWith('*/')` i `lastIndexOf('/**')` na kopii | cofanie od `match.index` tylko po białych znakach (`while (end > 0 && /\s/u.test(source[end - 1])) end -= 1`), potem `source.startsWith('*/', end - 2)` i `source.lastIndexOf('/**', end - 3)` na oryginale | kopia całego prefiksu plus regexp `\s+$` bez kotwicy na początku, próbowany przy każdym ciągu białych znaków i odrzucany na `$` — koszt eksportu równy długości pliku do niego; po zmianie równy długości jego bloku JSDoc |

   Jak szukać: `matchAll` / `replace` z callbackiem wołanym w pętli po trafieniach; `for (let i = 0; i < index…)`
   w funkcji wołanej z pętli; `slice(0, index)` albo regexp z `$` bez `^` na wyniku `slice` w pętli; regexp,
   którego pierwszy token to klasa znaków, nie literał; ta sama funkcja czysta wołana z kilku miejsc na tym
   samym wejściu. Po zmianie: stary i nowy moduł zaimportowane obok siebie na tym samym korpusie (jak
   zdobyć stary moduł: Pułapki), `old.generateIndex(root) === nowy.generateIndex(root)`, zero różniących się
   linii wyjścia, per parser tabela przed/po. Wynik na korzeniu scribe-devtools (53 moduły, 0,83 MB, stary
   i nowy moduł w jednej serii): subskrypcje 15,1 → 0,5 ms, wygaszanie 2 × 3,5 → 1 × 1,4 ms, importy 4,3 →
   2,2 ms, env 4,8 → 2,9 ms (importy i env wołane samodzielnie, więc każda z tych liczb zawiera własne
   wygaszanie; z `code` przekazanym z `generateIndex` to 0,8 i 1,6 ms), sygnatury 9,8 → 1,9 ms,
   `generateIndex` 47 → 17 ms. Funkcja, która po wydzieleniu pętli przekroczy limit złożoności lintera
   (sonarjs `cognitive-complexity`), dostaje prywatne funkcje pomocnicze — nieeksportowane, więc indeks się
   nie zmienia.
4. Natywna biblioteka z npm zamiast własnego Rusta: `oxc-parser` (napi) do AST, `ripgrep` do skanów,
   `@napi-rs/*`. Zero własnej binarki, zero drugiego toolchaina.
5. Inny runtime (Bun/Deno) tylko gdy start runtime'u dominuje **i** repo już go ma; jego start zmierz tą samą
   pętlą co `node -e 0` w kroku 0.3, zanim wpiszesz go do raportu.
6. Własny Rust/Go/Zig: ostatni, z kosztami z kroku 1 i portem testów. Regexpy z lookahead/lookbehind
   (`(?!\s*from)`) crate `regex` odrzuca — wzorce do przepisania, nie do przeniesienia.

Po każdej opcji: wyjście identyczne bajt w bajt (`git diff --stat -- CODE-INDEX.md`; jedyny dopuszczalny
diff to wpis samego skryptu, gdy zmieniły się jego sygnatury), testy skryptu, format, lint, typecheck,
brama repo.

## 3. Raport

Tabela `wariant | ściana (mediana z 5) | w procesie | oszczędność na przebieg | oszczędność dziennie przy
N przebiegach | koszt`; decyzja jednym zdaniem z liczbą; commity wg konwencji repo (skrypt i zregenerowany
indeks w jednym).

Orientacyjnie (copilot-builder, 98 modułów, 1,36 MB, Node 26, laptop i7, 2026-09-17/18): ściana 196 ms =
start Node 88 + ładowanie modułu i zapis indeksu ok. 20 + `generateIndex` 90 (w tym walk i odczyt plików
ok. 6 ms). `--staged` dokłada do ściany ok. 150–160 ms (mediana różnic w parach `--check` / `--staged
--check`; eksport przez `spawnSync` i `rmSync` w procesie, zmierzony w repo zagnieżdżonym, gdzie obejmuje
całe repo nadrzędne); osobne komendy z kroku 0.3 pokazują więcej (`git checkout-index` ok. 200 ms,
`rm -rf` ok. 95 ms), bo doliczają start procesów. Wszystkie pięć wzorców z kroku 2.3: `generateIndex`
94 → 35 ms (stary i nowy moduł w jednej serii), `parseSubscriptions` 30 → 1 ms, `parseSignatures`
13,8 → 2,7 ms, `stripBlockComments` 3 × 10 → 1 × 6 ms; ściana: pierwsze cztery 196 → 155 ms (−21%), piąty
osobno 170 → 162 ms; wyjście identyczne, 10 testów zielonych. Podłoga w JS: start Node 84–88 ms plus
ładowanie modułu i zapis indeksu ok. 20 ms oraz walk i odczyt ok. 6 ms, czyli ok. 115 ms nawet przy zerowych
obliczeniach. Szacunek Rusta: ok. 20 ms ściany razem z IO, czyli ok. 0,11–0,14 s oszczędności na commit —
prawie cała ze startu Node, nie z języka — za drugi toolchain, binarki per platforma i port testów.
Werdykt: nie.

Skala (ten sam indekser na app-factory: 15 aplikacji + e2e, 49 bibliotek plus 2 katalogi MCP bez projektu
Nx, 2068 plików w repo, po wszystkich pięciu wzorcach): jak zaprojektowano (narzędzia + poziom mapy
apps/libs) 113 modułów (49 tools, 15 apps, 49 libs), 0,42 MB, `generateIndex` ok. 35–40 ms, z czego walk
ok. 15–18 ms, odczyt ok. 5 ms, same parsery ok. 8 ms; najgorszy przypadek — każdy plik `.ts/.mts/.mjs` bez
speców pod `apps/`, `libs/`, `tools/` — 725 plików, 2,96 MB, same parsery (bez walku i odczytu) 42–48 ms.
Aplikacja to jeden `app.routes.ts`, biblioteka jeden `public-api.ts`; z liczbą aplikacji rośnie głównie walk
(przegląda całe `apps/` i `libs/`, żeby znaleźć pliki mapy), nie parsery. Koszt parserów liniowy, ok.
14–17 ms/MB, próg 5 s z kroku 1 wypada przy ok. 300–350 MB źródeł. Wcześniej urywa się budżet kontekstu
czytelnika (indeks 725 modułów ma ok. 200 kB), nie czas generowania.

## Kryteria ukończenia

- Tabela składników ściany z procentami; kwadraty nazwane `plik:funkcja`.
- Każda zastosowana opcja z kroku 2 ma pomiar przed/po i dowód identyczności wyjścia.
- Decyzja o języku zapisana z liczbą (oszczędność na przebieg × częstość) i listą kosztów;
  „Rust byłby szybszy" bez liczb nie jest wynikiem.

## Pułapki (sprawdzone)

- `/usr/bin/time` nie istnieje w Git Bash — `date +%s%N`; w PowerShellu `Measure-Command`.
- Wstawka `node -e "…"` w bash gubi `\` (np. `'\\'` w teście backticka) — sondy pomiarowe zapisuj do pliku
  w katalogu tymczasowym; import pliku spoza repo na Windows wymaga URL-a `file:///D:/…`
  (`pathToFileURL`), nie ścieżki.
- Stary moduł obok nowego: przed commitem `git show HEAD:<skrypt> > <tmp>/old.mjs`, po commicie
  `git show <commit>~1:<skrypt> > <tmp>/old.mjs` (`<skrypt>` względem korzenia repo gita). Jeśli skrypt ma
  względne importy (`./lib/….mjs`, np. w copilot-builder), w kopii zamień je na
  `file:///<repo>/<katalog-skryptu>/lib/….mjs`, inaczej `ERR_MODULE_NOT_FOUND`. W jednym procesie zaimportuj
  oba moduły i porównaj `generateIndex(root)` oraz parsery.
- A/B ściany starej i nowej wersji: `git stash push -- <skrypt> <indeks>`, pomiar z `--check`, `git stash pop`
  — stash ograniczony ścieżkami nie rusza innych zmian w drzewie. Tylko do ściany; wyjście porównuj
  modułami obok siebie.
- Ściana z różnych dni i sesji nie jest porównywalna: ten sam kod dał 155 ms jednego dnia i 170 ms
  następnego. Przed i po zawsze w jednej serii, jedna po drugiej.
- Test ze `symlinkSync` pada na Windows bez trybu dewelopera (`EPERM`) — środowisko, nie zmiana; zaznacz
  w raporcie zamiast naprawiać.
- Wpis indeksu dla samego skryptu zmienia się, gdy zmieniasz sygnatury eksportów — oczekiwany diff,
  regeneruj i commituj razem ze skryptem.
