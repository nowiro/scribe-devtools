# Szablon flow dla `browser-inspector`

`browser-inspector` patrzy na aplikację webową przez prawdziwy Chrome/Edge i **cały wynik zostawia w plikach**.
Dwa wejścia do jednej tabeli kroków ([docs/STEPS.md](../../../docs/STEPS.md)):

- **batch** — `browser-inspector flow.json [--stamp X]`: flow z configu, wynik w
  `<outputDir>/<stamp>/<snapshot>/report.md` (nagłówek, `## errors`, `## values`; `## steps` tylko
  przy porażce) + `report.json`, `elements.md`, `text.txt`, zrzuty. Pętla: **uruchom → przeczytaj
  `report.md` → popraw flow → uruchom ponownie**. To jest ścieżka bramki CI.
- **sesja** — `browser-inspector open <url>`, `browser-inspector find <tekst>`, `browser-inspector click e45`, `browser-inspector snap`: „spójrz, potem kliknij”
  na refach `eN` z pełnego snapshotu a11y; jedna linia stdout na komendę. Sesję kończy
  `browser-inspector export flow.json`, który zapisuje ją jako config batchu — i od tej chwili powtarza się bez agenta.

Nieudany krok to **wynik, nie crash**: raport mówi, który krok padł i czemu, `final.png` powstaje,
a batch kończy się kodem 0 (`--fail-on-incomplete` daje 1). Kod 2 = błąd fatalny (config, brak
przeglądarki, nieznana flaga).

## Szkielet configu

```json
{
  "outputDir": "./.scribe-devtools/browser-inspector",
  "parallel": 1,
  "snapshots": [
    {
      "name": "logowanie-i-saldo",
      "type": "flow",
      "url": "http://localhost:3000/login",
      "waitUntil": "settled",
      "steps": [
        { "do": "fill", "selector": "#email", "value": "qa@example.com" },
        { "do": "fill", "selector": "#password", "valueFromEnv": "APP_PASSWORD" },
        { "do": "click", "selector": "button[type=submit]" },
        { "do": "waitFor", "selector": "[data-testid=dashboard]" },
        { "do": "verify", "kind": "text", "selector": "[data-testid=saldo]", "text": "1 250,00 zł", "soft": true },
        { "do": "extract", "name": "saldo", "selector": "[data-testid=saldo]" },
        { "do": "evaluate", "name": "liczba-wierszy", "expression": "document.querySelectorAll('tr').length" },
        { "do": "scroll", "to": "bottom" },
        { "do": "screenshot", "name": "koniec", "fullPage": true }
      ]
    }
  ]
}
```

Pola snapshotu poza `name`/`type`/`url`/`steps`: `waitUntil` (`load` domyślnie; `settled` = load +
100 ms ciszy w sieci, szybsze od `networkidle`, które jest honorowane 1:1), `fullPage`, `viewport`,
`stepTimeoutMs` (10 000), `navTimeoutMs` (30 000), `captureElements` (`elements.md`),
`captureSnapshot` (`snap.md` + `snap.json`), `captureBodies` (ciała odpowiedzi ≤ 64 KB — w batchu domyślnie WYŁĄCZONE, bo raport ich nie renderuje),
`isolation: "reuse" | "fresh"` (świeży kontekst zamiast szorowanej karty), `finalScreenshot:
"auto" | "always" | "never"`, `dialogs: "dismiss" | "accept"`, `routes[]` (blokady/podmiany
odpowiedzi przed pierwszym `goto`), `trace`, `video`, `auth: false`. `type: "page"` = samo wejście
i `page.png`. Stary config (skryba, `networkidle`, `wait ms`) parsuje się bez zmian —
`browser-inspector lint-config flow.json` podpowiada, co warto zmienić.

## Kroki, po które sięga się najczęściej

Pełna lista z polami i flagami sesji: [docs/STEPS.md](../../../docs/STEPS.md) (`browser-inspector help <krok>`
drukuje ten sam wiersz). Te same nazwy w configu (`steps[].do`) i w sesji (`browser-inspector <krok> …`).

| krok                                                                                     | do czego                                                                                                                    |
| ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `goto` (sesja: `open`), `back`, `reload`                                                 | nawigacja; `waitUntil` per krok                                                                                             |
| `click`, `hover`, `press`, `type`, `fill`                                                | akcje; cel to `selector` (Playwright: css, `text=`, `mat-option:has-text('…')`) **albo** `ref` (`e12`)                      |
| `form`                                                                                   | kilka pól naraz: `fields: [{ selector\|ref, value\|valueFromEnv }]`                                                         |
| `select`, `check`, `uncheck`, `upload`, `drag`                                           | `<select>`, checkboxy, pliki (czytane po stronie klienta), przeciąganie                                                     |
| `wait` (`text` / `textGone` / `url` / `ms`), `waitFor` (selektor + `state`)              | czekanie; `waitFor` zamiast `wait ms` przy animacjach                                                                       |
| `verify` (`visible`, `hidden`, `text`, `value`, `list`, `url`, `title`, `count`; `soft`) | asercja; `soft` nie zatrzymuje flow, ląduje w `## verify`                                                                   |
| `extract` (sesja: `get`), `evaluate` (`eval`)                                            | **tekst elementu / wynik JS pod nazwą** → `## values`; `evaluate`, które rzuca, to nieudany krok                            |
| `screenshot` (`shot`), `pdf`                                                             | nazwany zrzut (`fullPage`, `selector`, `jpeg`), PDF                                                                         |
| `snapshot` (`snap`)                                                                      | pełny snapshot a11y → `snap.md` (kompakt z refami) + `snap.json`; w configu refy wolno użyć dopiero po nim                  |
| `storage`, `state`, `route`, `offline`, `dialog`, `tab`, `frame`, `resize`, `mouse`      | cookies/localStorage/sessionStorage, storageState, blokady sieci, dialogi, karty, ramki (zakres CSS), viewport, współrzędne |

## Przykład z życia: logowanie per rola i bramka uprawnień

Dwa flow logują się na **różne role** (mock-login na Material select) i bramkują uprawnienia
w obie strony — obecność przez `waitFor`, **brak** przez `evaluate`, które rzuca:

```json
{
  "outputDir": "./.scribe-devtools/browser-inspector",
  "parallel": 2,
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

- **Lista loginów per uprawnienia** to osobny flow na rolę — te same kroki, inny profil (przy
  prawdziwym formularzu: inne zmienne w `valueFromEnv`, np. `APP_ADMIN_*` / `APP_VIEWER_*`; przy
  SSO Keycloaka formularz po przekierowaniu to zwykła strona: `waitFor` na `#kc-form-login`,
  `fill` `#username`/`#password`, `click` `#kc-login` — albo blok `auth` niżej, który loguje RAZ).
- **Komponenty JS to nadal kliknięcia.** Material select otwiera opcje w nakładce poza formularzem —
  klik w select, potem klik w `mat-option:has-text('…')`.
- **Brak uprawnienia też jest asercją.** `waitFor` bramkuje tylko obecność; `evaluate`, które RZUCA,
  gdy element istnieje, robi z wycieku uprawnień nieudany krok (`steps[i].error` =
  `Error: uczen widzi przycisk nauczyciela`) i z całego przebiegu porażkę bramy.
- Drugi flow zaczyna od **czystej karty** — między snapshotami (i między przebiegami przez keeper)
  storage, cookies, historia i route'y są szorowane; nauczyciel z pierwszego flow nie „przecieka”
  do ucznia. Purystom zostaje `isolation: "fresh"`.

## Sesja → flow: zapis tego, co agent wyklikał

```
browser-inspector open http://localhost:4313/                # ok open "Księgarnia" · el 61 · err 0 · …/session/default/snap.md
browser-inspector find koszyk                                # e45 button "Otwórz koszyk" [data-testid=header-cart-button]
browser-inspector fill e39 Harry --enter                     # ok fill e39 · navigated → refs f1eN (browser-inspector snap) · el 58
browser-inspector snap --diff                                # tylko linie dodane/usunięte od poprzedniego widoku
browser-inspector click e112 && browser-inspector get e45    # ok click e112 · dom Δ · el 61→63   /   "1"
browser-inspector export flows/koszyk.json                   # ok export 5 steps → flows/koszyk.json (refs → data-testid/#id/role=)
```

Eksport zamienia refy na trwałe selektory (`[data-testid=…]` → `#id` → `[name=…]` → `role=`),
wartości z `@{NAZWA}`/`--env` na `valueFromEnv`, pomija komendy sesyjne bez odpowiednika w
configu (`find`, `console`, `net`) i **odmawia**, gdy jakiś ref nie ma trwałego selektora — klikaj
w elementy interaktywne z etykietą (`find` pokazuje je obok bezimiennych `generic`). Plik
eksportu to zwykły config: `browser-inspector flows/koszyk.json` od razu działa. Dla CI bez keepera te same
linie wykona `browser-inspector script plik.txt --no-daemon` (jedna komenda na linię, stop na pierwszym FAIL).

## Blok `auth` — logowanie raz, sesja z pliku

```json
{
  "auth": {
    "storageState": "./.scribe-devtools/auth/session.json",
    "maxAgeMinutes": 60,
    "login": {
      "url": "http://localhost:3000/login",
      "steps": [
        { "do": "fill", "selector": "#username", "valueFromEnv": "APP_USER" },
        { "do": "fill", "selector": "#password", "valueFromEnv": "APP_PASS" },
        { "do": "click", "selector": "button[type=submit]" },
        { "do": "waitFor", "selector": "[data-testid=dashboard]" }
      ]
    }
  }
}
```

Login wykonuje się **raz** na świeżym kontekście, `storageState` (ścieżka względem configu)
zapisuje sesję, kolejne przebiegi ją wczytują, dopóki plik jest młodszy niż `maxAgeMinutes`
(`reuse: false` wymusza logowanie). Zamiast `login` może być `oauth` (`password` /
`client_credentials`; `tokenUrl` albo Keycloak `{ url, realm }`; sekrety wyłącznie `*FromEnv`;
token w localStorage pod `store: { origin, key }`; ważność z `expires_in`/`exp` w
`<state>.meta.json`). `auth: false` na snapshotcie = widok anonimowy. Plik sesji to **żywe
poświadczenia**: trzymaj go w `.scribe-devtools/` (ignorowanym przez git), poza nim keeper ostrzega.
W `auth.login.steps` każdy `fill` musi mieć `valueFromEnv` — literał jest błędem walidacji.

## Zasady, które czynią flow utrzymywalnym

1. **Selektory bierz z `elements.md` albo z `browser-inspector find`.** Każdy raport (domyślnie) ma mapę
   elementów interaktywnych z gotowymi selektorami; pierwszy przebieg może być samym
   `type: "page"`. W sesji `find` daje ref **i** selektor w jednej linii.
2. **`extract`/`verify` zamiast czytania całego tekstu strony.** Asercja „saldo wynosi X” to jeden
   nazwany ekstrakt albo `verify text`, nie grep po `text.txt`.
3. **Sekrety wyłącznie przez env** (`valueFromEnv`, w sesji `@{NAZWA}` / `--env NAZWA`). Wartość
   nigdy nie trafia do configu, raportu, dziennika ani stdout — raport echem podaje tylko
   `(from env NAZWA)`; keeper redaguje ją wszędzie (`***`).
4. **Proś front o `data-testid`.** Selektor pozycyjny pęka przy każdym refactoringu;
   `[data-testid=zapisz]` przeżywa wszystko — i to on ląduje w eksporcie sesji.
5. **`waitFor`/`wait --text` zamiast `wait ms`.** Sen jest zawsze za długi albo za krótki; czekanie
   na element/tekst kończy się dokładnie wtedy, gdy strona jest gotowa (`browser-inspector lint-config` to
   wypunktuje).
6. **`--stamp` przy porównaniach.** Dwa przebiegi z tym samym stemplem piszą do tego samego
   katalogu — diff raportów przed/po zmianie to zwykły `diff`.
7. **`parallel: N`** dla kilku niezależnych flow — każdy lane to trwała karta; koszt to jeden świeży
   kontekst na lane przy pierwszym użyciu.
