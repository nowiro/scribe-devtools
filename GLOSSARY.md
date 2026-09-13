# GLOSSARY — słowa tego repozytorium i ich nazwy w kodzie

Proza tutaj jest po polsku, a identyfikatory po angielsku, więc szukanie słowa z rozmowy wprost
w kodzie często nic nie znajduje. Ten plik jest mapą w obie strony: od słowa do symbolu, żeby
zamienić prośbę na wyszukiwanie, i od symbolu do słowa, żeby odpowiedzieć językiem, który druga
strona rozpozna. Czyta się go razem z [CODE-INDEX.md](CODE-INDEX.md) na starcie sesji: indeks mówi
**gdzie** coś jest, ten plik mówi, **jak to się nazywa**.

Wiersz trafia tu tylko wtedy, gdy sama nazwa nie wystarcza: identyfikator różni się od słowa
mówionego, słowo znaczy dwie rzeczy w dwóch miejscach, ma odrzucone synonimy albo pojęcie nie ma
jednego symbolu. Nazwy oczywiste są w indeksie, nie tutaj.

**Znaczenia pisze człowiek, mapowania sprawdza bramka.** Każdą ścieżkę i każdy symbol z kolumny
„w kodzie" weryfikuje `node scripts/check-claims.mjs` — po zmianie nazwy symbolu bramka czerwieni
się, zamiast zostawić słownik, który cicho zgnił.

## browser-inspector

| termin            | znaczenie                                                                                                  | w kodzie                                                    | nie mów                       |
| ----------------- | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ----------------------------- |
| keeper            | lokalny proces, który trzyma ciepłą przeglądarkę między wywołaniami i przyjmuje zadania po nazwanym potoku | `packages/browser-inspector/src/keeper.mjs`, `startKeeper`  | demon, serwer, daemon         |
| lane              | jedno stanowisko równoległego wykonania: własny kontekst i własna karta, przydzielane przebiegowi          | `packages/browser-inspector/src/lanes.mjs`                  | wątek, worker, slot           |
| scrub             | czyszczenie stanu trwałej karty MIĘDZY przebiegami, tańsze niż nowy kontekst                               | `packages/browser-inspector/src/isolation.mjs`              | reset, cleanup, czyszczenie   |
| settle            | własna strategia czekania na uspokojenie strony, wstawiana zamiast `networkidle`                           | `packages/browser-inspector/src/settle.mjs`                 | networkidle, idle             |
| ref               | uchwyt `eN` do elementu z OSTATNIEGO snapshotu drzewa dostępności, nie selektor CSS                        | `resolveRef`, `packages/browser-inspector/src/snapshot.mjs` | id, uchwyt, handle            |
| stempel przebiegu | `--stamp YYYY-MM-DD_HH-MM`: katalog wyników jednego uruchomienia batcha                                    | `STAMP_PATTERN`, `packages/browser-inspector/src/paths.mjs` | timestamp, znacznik czasu     |
| snapshot (config) | wpis w configu: jedna strona albo jeden flow do wykonania                                                  | `packages/browser-inspector/src/config.mjs`                 | scenariusz, test              |
| snapshot (strona) | zrzut drzewa dostępności strony, z którego biorą się refy `eN`                                             | `packages/browser-inspector/src/snapshot.mjs`               | zrzut ekranu, screenshot      |
| flow              | nazwany scenariusz kroków w configu, przeciwieństwo `type: "page"`                                         | `packages/browser-inspector/src/flow.mjs`                   | scenariusz, przypadek testowy |
| krok              | jedna operacja z tabeli `STEPS`, ta sama nazwa w configu i w sesji                                         | `STEPS`, `packages/browser-inspector/src/steps.schema.mjs`  | akcja, komenda                |
| wykonawca kroku   | funkcja, która krok naprawdę wykonuje; tabela musi mieć te same klucze co `STEPS`                          | `RUNNERS`, `packages/browser-inspector/src/steps.run.mjs`   | handler, implementacja        |
| batch             | tryb wsadowy: flow z pliku JSON, wynik na dysk, nieudany krok to wynik, nie wyjątek                        | `packages/browser-inspector/src/flow.mjs`                   | wsad, run                     |
| sesja             | tryb interaktywny: komendy po jednej, stan trzyma keeper                                                   | `packages/browser-inspector/src/session.mjs`                | REPL, tryb live               |

## nx-angular-inspector

| termin             | znaczenie                                                                                                            | w kodzie                                                    | nie mów            |
| ------------------ | -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ------------------ |
| stempel świeżości  | tani odcisk drzewa, który mówi, czy zapisany graf Nx jest jeszcze prawdą; INNE znaczenie niż stempel przebiegu wyżej | `packages/nx-angular-inspector/src/stamp.mjs`               | hash, cache key    |
| świeże / nieświeże | werdykt stempla dopisywany do linii odpowiedzi komend czytających graf                                               | `packages/nx-angular-inspector/src/stamp.mjs`               | aktualne, ważne    |
| przewodnik         | odpowiedź komendy `guide`: gdzie w workspace leżą zasady dla agenta i ile kosztuje ich przeczytanie                  | `findGuides`, `packages/nx-angular-inspector/src/guide.mjs` | dokumentacja, help |

## Repozytorium i bramki

| termin          | znaczenie                                                                                 | w kodzie                             | nie mów                |
| --------------- | ----------------------------------------------------------------------------------------- | ------------------------------------ | ---------------------- |
| bramka          | krok `pnpm run verify`, który ma prawo zatrzymać zmianę; bramka wskazuje, nie przepisuje  | `package.json`, `scripts/`           | test, lint, CI         |
| pin             | wiersz deklarujący wersję jednej zależności i mówiący, co się psuje przy jej zmianie      | `PINS`, `scripts/pins.config.mjs`    | wersja, zależność      |
| obietnica       | zdanie, które proza podaje jako fakt o zachowaniu binarki, sprawdzane przez bramkę claims | `scripts/check-claims.mjs`           | asercja, test          |
| blok instrukcji | fragment AGENTS.md liczony w tokenach i kopiowany znak w znak do instrukcji Copilota      | `scripts/check-instruction-sync.mjs` | prompt, systemowy      |
| portable        | jeden zip niosący OBA narzędzia pod jedną wersją, do użycia bez menedżera pakietów        | `scripts/portable-zip.mjs`           | paczka, release, build |
| indeks          | `CODE-INDEX.md`: mapa modułów z wejściem, wyjściem i subskrypcjami zdarzeń                | `scripts/index-code.mjs`             | dokumentacja, API docs |
