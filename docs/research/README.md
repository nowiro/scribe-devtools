# docs/research

Raporty z rozpoznania — stan wiedzy z konkretnego dnia, na konkretnej maszynie. **Nie są
specyfikacją i nie są gatowane.** Każdy niesie własną legendę proweniencji; liczba bez
znacznika `[Z]` nie jest pomiarem.

| plik | zakres | data | maszyna odniesienia |
| --- | --- | --- | --- |
| [NX-ANGULAR-MCP.html](NX-ANGULAR-MCP.html) | Część I: zastąpienie `ng mcp` i `nx-mcp` skryptem `nx-angular-inspector`. Część II: doktryna aktualności repo (ZWINIĘCIE / POCHODZENIE / SONDA, plan WP0–WP14). | 2026-09-03 | Windows 11, Node 26.5.0, `../app-factory` (nx 23.1.1, `@angular/cli` 22.1.6) |

## Jak czytać

Otwórz plik w przeglądarce — to jeden samodzielny dokument, bez zależności poza Google Fonts.
Wersja opublikowana: <https://claude.ai/code/artifact/7dee072c-f339-4965-86b0-d0eb3ffee8ed>.
Kopia tutaj ma dodany prolog `<!doctype>` / `<meta charset>`, którego wersja opublikowana
dostaje od hosta — poza tym treść jest ta sama.

## Czego tu nie ma, celowo

Nie commitujemy surowych szkiców z fazy rozpoznania. Weryfikacja adwersarialna obaliła w nich
m.in.: rozmiar digestu generatora (podane 1 268 tokenów, zmierzone **121**), koszt sesji MCP
(podane 13 400–17 000, faktyczne **~9 700** przy tej konfiguracji), Chrome na `windows-latest`
(podane 151, w obrazie `win25/20260830.247` jest **152**), czas `npm ci` (podane 60–120 s,
zmierzone **4,6–8,5 s**) i przyczynę awarii `nx_available_plugins` (nie układ katalogów nx 23,
tylko upstreamowe 404 plus **brakujący `catch`**). Poprawione wartości są w raporcie powyżej,
w sekcji „Co obaliła weryfikacja". Szkice zostały odrzucone, żeby te liczby nie krążyły dalej.

## Zakres wsparcia

`nx-angular-inspector` z Części I obsługuje **tylko** nx >= 23 i angular >= 22. Workspace poniżej
progu albo bez żadnego z tych dwóch — w tym samo `scribe-devtools` — dostaje jedną linię `FAIL`.
