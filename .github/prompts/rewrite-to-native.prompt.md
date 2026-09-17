# /rewrite-to-native — czy przepisać indeksowanie (albo inny skrypt narzędziowy) na Rust lub inny język

Masz skrypt narzędziowy w Node (np. generator `CODE-INDEX.md`) i pytanie „czy nie szybciej w Ruście?".
Odpowiedź ma być liczbą, nie opinią. W tym runie niczego nie przepisujesz: mierzysz, rozkładasz czas na
składniki, wyczerpujesz tańsze opcje, potem decyzja z tabelą. Komendy w składni bash (Git Bash); w
PowerShellu `Measure-Command { node … }`. **Nie commituj i nie pushuj bez zgody.**

Zasada nadrzędna: język zmienia tylko czas obliczeń w procesie. Startu runtime'u, gita, dysku i narzutu
Nx nie zmieni. Zanim padnie słowo „Rust", te składniki mają być zmierzone osobno.

## 0. Pomiar (nic nie edytuj)

1. Gdzie i jak często skrypt biega:
   `git grep -n -E "<nazwa-skryptu>" -- package.json .githooks .husky '**/project.json' .gitlab-ci.yml .github`
   → hook pre-commit, `verify`, CI, watch/IDE. Zapisz częstość: raz na commit / raz na `verify` / co zapis pliku.
2. Ściana: 5 przebiegów, mediana, w każdym trybie, którym repo woła skrypt (`--check`, zapis, `--staged`):
   `for i in 1 2 3 4 5; do s=$(date +%s%N); node <skrypt> --check >/dev/null 2>&1; e=$(date +%s%N); echo $(( (e-s)/1000000 )); done | sort -n`
3. Podłoga runtime'u: to samo dla `node -e 0`. Dla `--staged` osobno `git checkout-index -a --prefix=<tmp>/`
   i `rm -rf <tmp>`.
4. Czas w procesie (bez startu Node): `node --input-type=module -e "import { generateIndex } from
   './<skrypt>'; …"` z `performance.now()` wokół wywołania, 5 powtórzeń.
5. Rozkład na funkcje: każdy eksportowany parser na tym samym korpusie, 3 rundy, tabela `funkcja | ms`;
   obok liczba plików i bajtów korpusu (`listSourceFiles` + suma `readFileSync().length`).
6. Szukaj kwadratów, nie języka: skan od początku pliku per trafienie (`for (let i = 0; i < index…)` w
   funkcji wołanej w pętli po `matchAll`); regexp zaczynający się od identyfikatora
   (`([A-Za-z_$][\w$.]*)\s*\.…`, próbowany przy każdym identyfikatorze w pliku); ta sama transformacja
   liczona kilka razy na plik (`stripBlockComments` w trzech parserach); `slice(0, index)` w pętli;
   `replaceAll(/[^\n]/gu, ' ')` (wywołanie zwrotne per znak).

Wyjście kroku 0: tabela `składnik | ms | % ściany` (start runtime'u, git/dysk, ładowanie modułu + walk,
obliczenia) + tabela per funkcja + lista kwadratów jako `plik:funkcja`. Pokaż i czekaj na „dalej".

## 1. Decyzja — progi

| Wynik pomiaru | Werdykt |
|---|---|
| start runtime'u ≥ 40% ściany | język nic nie da; co najwyżej inny runtime (Bun: start ok. 10 ms) albo nie uruchamiać wcale (krok 2.1) |
| obliczenia < 1 s na realnym korpusie, przebieg raz na commit / `verify` | nie przepisuj; napraw kwadraty w JS (krok 2.3) i zmierz ponownie |
| obliczenia 1–5 s po naprawie kwadratów, przebieg raz na commit | nadal nie; pokaż udział w `verify` — w bramie liczonej w dziesiątkach sekund to szum |
| obliczenia > 5 s po naprawie kwadratów **albo** przebieg przy każdym zapisie pliku (watch, IDE) **albo** korpus > ~50 MB / > 10 tys. plików | kandydat; najpierw natywna biblioteka z npm (krok 2.4), własny kod dopiero po niej |
| potrzebny prawdziwy parser (AST, typy) zamiast regexpów | to nie jest pytanie o język — gotowy parser (`oxc-parser` przez napi, API TypeScriptu), nie własny |

Pytania do właściciela, zanim padnie „tak": kto utrzymuje drugi toolchain; skąd binarka na każdą platformę
(Windows dev, Linux CI, repozytoria generowane z szablonu); czy tanie modele z rosteru mają procedurę na
ten język; czy oszczędność `X ms × przebiegów dziennie` jest warta tych kosztów.

## 2. Tańsze opcje, w tej kolejności (każda: pomiar przed/po tym samym protokołem)

1. Nie uruchamiać: w hooku tylko, gdy `git diff --cached --name-only` trafia w indeksowane katalogi;
   `--check` w `verify` zostaje.
2. Cache po treści: hash plików korpusu → pomiń regenerację, gdy równy.
3. Kwadraty w JS, bez zmiany API: parzystość backticków jednym przebiegiem (`Uint8Array` per plik)
   zamiast skanu per trafienie; regexp kotwiczony na rzadkim tokenie (`\.\s*on\s*\(`) z odczytem odbiorcy
   wstecz zamiast od identyfikatora; jedna transformacja na plik przekazywana parametrem
   (`parseX(source, code = strip(source))`); `' '.repeat(line.length)` zamiast `replaceAll(/[^\n]/gu, ' ')`.
4. Natywna biblioteka z npm zamiast własnego Rusta: `oxc-parser` (napi) do AST, `ripgrep` do skanów,
   `@napi-rs/*`. Zero własnej binarki, zero drugiego toolchaina.
5. Inny runtime (Bun/Deno) tylko gdy start runtime'u dominuje **i** repo już go ma.
6. Własny Rust/Go/Zig: ostatni, z kosztami z kroku 1 i portem testów. Regexpy z lookahead/lookbehind
   (`(?!\s*from)`) crate `regex` odrzuca — wzorce do przepisania, nie do przeniesienia.

Po każdej opcji: wyjście identyczne bajt w bajt (`git diff --stat -- CODE-INDEX.md`; jedyny dopuszczalny
diff to wpis samego skryptu, gdy zmieniły się jego sygnatury), testy skryptu, format, lint, typecheck,
brama repo.

## 3. Raport

Tabela `wariant | ściana (mediana z 5) | w procesie | oszczędność na przebieg | oszczędność dziennie przy
N przebiegach | koszt`; decyzja jednym zdaniem z liczbą; commity wg konwencji repo (skrypt i zregenerowany
indeks w jednym).

Orientacyjnie (copilot-builder, 98 modułów, 1,36 MB, Node 26, laptop i7, 2026-09-17): ściana 196 ms =
start Node 88 + moduł/walk/IO ok. 20 + obliczenia 90; `--staged` dokłada `git checkout-index` ok. 200 ms
i `rm` ok. 95 ms. Trzy poprawki z kroku 2.3: obliczenia 90 → 47 ms, ściana 196 → 155 ms (−21%),
`parseSubscriptions` 30 → 1 ms, `stripBlockComments` 3 × 10 → 1 × 6 ms, wyjście identyczne, 10 testów
zielonych. Szacunek Rusta: ok. 20 ms ściany, czyli 0,13–0,18 s oszczędności na commit za drugi toolchain,
binarki per platforma i port testów. Werdykt: nie.

## Kryteria ukończenia

- Tabela składników ściany z procentami; kwadraty nazwane `plik:funkcja`.
- Każda zastosowana opcja z kroku 2 ma pomiar przed/po i dowód identyczności wyjścia.
- Decyzja o języku zapisana z liczbą (oszczędność na przebieg × częstość) i listą kosztów;
  „Rust byłby szybszy" bez liczb nie jest wynikiem.

## Pułapki (sprawdzone)

- `/usr/bin/time` nie istnieje w Git Bash — `date +%s%N`; w PowerShellu `Measure-Command`.
- Wstawka `node -e "…"` w bash gubi `\` (np. `'\\'` w teście backticka) — prototypy pomiarowe zapisuj do
  pliku w katalogu tymczasowym; import pliku spoza repo na Windows wymaga `file:///D:/…`.
- A/B starej i nowej wersji: `git stash push -- <skrypt> <indeks>`, pomiar, `git stash pop` — stash
  ograniczony ścieżkami nie rusza innych zmian w drzewie.
- Test ze `symlinkSync` pada na Windows bez trybu dewelopera (`EPERM`) — środowisko, nie zmiana; zaznacz
  w raporcie zamiast naprawiać.
- Wpis indeksu dla samego skryptu zmienia się, gdy zmieniasz sygnatury eksportów — oczekiwany diff,
  regeneruj i commituj razem ze skryptem.
