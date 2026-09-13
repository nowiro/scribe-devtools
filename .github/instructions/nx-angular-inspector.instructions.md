---
applyTo: 'packages/nx-angular-inspector/**'
---

# Znane granice `nx-angular-inspector` — nazwane, nie ukryte

- **Tani stempel świeżości nie widzi edycji istniejącego pliku.** Krawędzie grafu biorą się z importów, a zmiana
  `import` w pliku, który już istnieje, nie rusza mtime żadnego katalogu (sprawdzone na NTFS). Domyślny stempel
  chodzi po katalogach — **18 ms**, łapie dodanie, usunięcie i zmianę nazwy pliku oraz nowy projekt gdziekolwiek.
  `--deep` dokłada mtime plików — **275 ms** przy 20 000 plików. Obie liczby zmierzone; wybór należy do wołającego,
  a `env` drukuje tę lukę.
- **Limit 120 znaków na linię jest twardy** i pilnuje go `formatLine`, który **nigdy nie tnie dwóch ostatnich
  części** (werdyktu i ścieżki).
- **`project-graph.json` to prywatny kontrakt Nx.** Asertujemy `version` (`"6.0"`); nieznana wartość to werdykt
  `nieznany format` i fallback do CLI — wolniej, nigdy źle.
- **`docs` nie istnieje.** Wymagałoby klucza Algolii osadzonego w angular.dev, który może się zrotować, i endpointu
  nx.dev — czyli dokładnie tego cichego dryfu, przed którym ostrzega instrukcja. Blok instrukcji jest przy tym blisko
  sufitu (600 bajtów, zajęte 550): `docs` nie zmieści się bez skrócenia czegoś innego, i to jest zamierzone.
- **Każda odpowiedź to jedna linia `ok`/`FAIL`** zakończona ścieżką pliku w `.ws/`; błąd składni komendy to też jedna
  linia `FAIL <verb> · … · nx-angular-inspector help <verb>` (exit 2), nigdy pełna tabela pomocy.
