# Szablon flow dla źródła browser-inspector

Źródło `browser-inspector` to zamiennik serwera MCP Playwrighta w części batchowalnej: flow zapisany
w configu wykonuje się w prawdziwym Chrome/Edge, a **cały wynik ląduje w plikach** —
`report.md` (kroki, nazwane ekstrakty, mapa elementów, konsola, tekst strony) i zrzuty
`*.png`. Pętla pracy nie jest „patrz i klikaj", tylko: **uruchom → przeczytaj raport →
popraw flow → uruchom ponownie**.

## Szkielet konfiguracji

```json
{
  "outputDir": "./.scribe/browser-inspector",
  "snapshots": [
    {
      "name": "logowanie-i-saldo",
      "type": "flow",
      "url": "http://localhost:3000/login",
      "steps": [
        { "do": "fill", "selector": "#email", "value": "qa@example.com" },
        { "do": "fill", "selector": "#password", "valueFromEnv": "APP_PASSWORD" },
        { "do": "click", "selector": "button[type=submit]" },
        { "do": "waitFor", "selector": "[data-testid=dashboard]" },
        { "do": "extract", "name": "saldo", "selector": "[data-testid=saldo]" },
        { "do": "evaluate", "name": "liczba-wierszy", "expression": "document.querySelectorAll('tr').length" },
        { "do": "scroll", "to": "bottom" },
        { "do": "screenshot", "name": "koniec" }
      ]
    }
  ]
}
```

## Kroki — pełna lista

| Krok         | Pola                                        | Do czego                                                 |
| ------------ | ------------------------------------------- | -------------------------------------------------------- |
| `goto`       | `url`, `waitUntil`                          | nawigacja w trakcie flow                                 |
| `click`      | `selector`                                  | kliknięcie                                               |
| `fill`       | `selector`, `value` **albo** `valueFromEnv` | wpisanie tekstu; sekrety zawsze przez env                |
| `press`      | `key`                                       | klawisz (`Enter`, `Tab`…)                                |
| `hover`      | `selector`                                  | najechanie (menu, tooltipy)                              |
| `select`     | `selector`, `value`                         | wybór opcji w `<select>`                                 |
| `scroll`     | `selector` **albo** `to`                    | przewinięcie do elementu albo krawędzi (`top`/`bottom`)  |
| `wait`       | `ms` (50–10000)                             | pauza na animację/debounce                               |
| `waitFor`    | `selector`, `state`                         | czekanie na element (`visible`/`hidden`/…)               |
| `screenshot` | `name`, `fullPage`                          | nazwany zrzut w dowolnym momencie                        |
| `extract`    | `name`, `selector`                          | **tekst elementu pod nazwą** → sekcja „Extracted values" |
| `evaluate`   | `name`, `expression`                        | **wynik wyrażenia JS pod nazwą** → tamże                 |

Nieudany krok to wynik, nie crash: raport mówi, który padł i czemu, końcowy zrzut i tak
powstaje, a przebieg kończy się kodem 0.

## Przykład z życia: logowanie per rola i bramka uprawnień

Scenariusz przetestowany na aplikacji z mock-loginem (picker profili na Material select):
dwa flow logują się na **różne role** i bramkują uprawnienia w obie strony — obecność
uprawnienia przez `waitFor`, a jego **brak** przez `evaluate`, które rzuca:

```json
{
  "outputDir": "./.scribe/browser-inspector",
  "snapshots": [
    {
      "name": "dziennik-nauczyciel",
      "type": "flow",
      "url": "http://localhost:4314/",
      "steps": [
        { "do": "waitFor", "selector": "[data-testid=dashboard-anonymous]" },
        { "do": "click", "selector": "[data-testid=journal-login-select]" },
        { "do": "click", "selector": "mat-option:has-text('Ewa Lewandowska')" },
        { "do": "waitFor", "selector": "[data-testid=dashboard-teacher-grades]" },
        { "do": "extract", "name": "powitanie", "selector": "h1" },
        { "do": "screenshot", "name": "po-zalogowaniu-nauczyciel" }
      ]
    },
    {
      "name": "dziennik-uczen",
      "type": "flow",
      "url": "http://localhost:4314/",
      "steps": [
        { "do": "waitFor", "selector": "[data-testid=dashboard-anonymous]" },
        { "do": "click", "selector": "[data-testid=journal-login-select]" },
        { "do": "click", "selector": "mat-option:has-text('Anna Kowalska')" },
        { "do": "waitFor", "selector": "[data-testid=dashboard-grades]" },
        {
          "do": "evaluate",
          "name": "uprawnienia-ucznia",
          "expression": "(() => { const n = document.querySelectorAll('[data-testid=dashboard-teacher-grades]').length; if (n !== 0) throw new Error('uczen widzi przycisk nauczyciela'); return 'brak przycisku nauczyciela'; })()"
        },
        { "do": "screenshot", "name": "po-zalogowaniu-uczen" }
      ]
    }
  ]
}
```

Trzy chwyty, które ten przykład ilustruje:

- **Lista loginów per uprawnienia** to osobny flow na rolę — te same kroki, inny profil
  (przy prawdziwym formularzu: inne zmienne w `valueFromEnv`, np. `APP_ADMIN_*` /
  `APP_VIEWER_*`; przy SSO Keycloaka formularz po przekierowaniu to zwykła strona:
  `waitFor` na `#kc-form-login`, `fill` `#username`/`#password`, `click` `#kc-login`).
- **Komponenty JS to nadal kliknięcia.** Material select otwiera opcje w nakładce poza
  formularzem — klik w select, potem klik w `mat-option:has-text('…')` (selektory
  Playwrighta, nie tylko czyste CSS).
- **Brak uprawnienia też jest asercją.** `waitFor` bramkuje tylko obecność; wyrażenie
  `evaluate`, które RZUCA, gdy element istnieje, robi z wycieku uprawnień nieudany krok —
  i z całego przebiegu porażkę bramy, nie ciche „completed".

## Zasady, które czynią flow utrzymywalnym

1. **Selektory bierz z mapy elementów.** Każdy raport (domyślnie) zawiera sekcję
   „Interactive elements": widoczne linki, przyciski i pola z gotowymi selektorami
   (`#id` → `[data-testid]` → `[name]` → ścieżka pozycyjna). Pierwszy przebieg może być
   samym `type: "page"` — po to, żeby mieć z czego pisać kroki.
2. **`extract` zamiast czytania całego tekstu strony.** Asercja „saldo wynosi X" to jeden
   nazwany ekstrakt, nie grep po dwudziestu tysiącach znaków sekcji „Page text".
3. **Sekrety wyłącznie `valueFromEnv`.** Wartość nigdy nie trafia do configu ani do
   raportu — raport echem podaje tylko NAZWĘ zmiennej (przypięte testem).
4. **Proś front o `data-testid`.** Selektor pozycyjny (`div:nth-of-type(3) > button`)
   pęka przy każdym refactoringu; `[data-testid=zapisz]` przeżywa wszystko.
5. **`--stamp` przy porównaniach.** Dwa przebiegi z tym samym stemplem piszą do tego
   samego katalogu — diff raportów przed/po zmianie to zwykły `git diff`/`diff`.

Czego flow celowo nie umie: żywego przeglądania „spójrz, potem kliknij" — to wymaga
trwałego procesu, czyli serwera, którego to narzędzie z założenia nie uruchamia.
