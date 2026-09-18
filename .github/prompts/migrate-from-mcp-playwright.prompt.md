# /migrate-from-mcp-playwright — zastąp serwer MCP Playwrighta narzędziem browser-inspector

Pracujesz w repozytorium aplikacji (**Nx monorepo**, `apps/*`, `pnpm` albo `npm`), które dziś daje
agentowi dostęp do przeglądarki przez serwer MCP `@playwright/mcp`. Zastąp go narzędziem
**browser-inspector** z repozytorium `scribe-devtools`: skrypt zamiast serwera, wynik na dysku,
zero definicji narzędzi w kontekście. Pracuj krok po kroku; po każdym kroku uruchom to, co
napisałeś. Nie zgaduj — gdy czegoś nie ma (build, port, ścieżka), zatrzymaj się i zapytaj.

## 0. Rozpoznanie (nic nie edytuj)

1. Znajdź konfigurację MCP Playwrighta: `.vscode/mcp.json` (klucz `servers.playwright`),
   `.mcp.json`, `mcp.json` w ustawieniach użytkownika, wzmianki `@playwright/mcp` w
   `package.json`, `AGENTS.md`, `.github/copilot-instructions.md`, `.github/instructions/*`.
2. Wypisz aplikacje z `apps/` (bez projektów `*-e2e`), ich builder (`@angular/build:application`
   → `dist/apps/<app>/browser`, inne → `dist/apps/<app>`), port `serve` z `project.json` oraz
   `port smoke` = 4311, 4312, … nadawany po kolei (poza zakresem portów `serve`, żeby nie kolidować
   z działającym `nx serve`) i istniejące scenariusze przeglądarkowe (specy e2e, prompty, notatki), które
   agent wykonywał przez MCP — to jest lista flow do przepisania.
3. Sprawdź, czy obok repo leży `../scribe-devtools` z zainstalowanymi zależnościami — po `pnpm install`
   istnieje `../scribe-devtools/packages/browser-inspector/node_modules/playwright-core/package.json`
   (pnpm nie kładzie `playwright-core` w korzeniowym `node_modules`; w rozpakowanym zipie leży
   w `node_modules/playwright-core` w korzeniu) — albo czy masz zip
   `download/scribe-devtools-portable-<wersja>.zip`. Wymagania: Node ≥ 22 i systemowy
   Chrome/Edge (nic nie jest pobierane).

Wyjście kroku 0: tabela `aplikacja | builder | katalog builda | port serve | port smoke | scenariusze do przepisania`
i lista plików z konfiguracją MCP. Pokaż ją i czekaj na „dalej".

## 1. Narzędzie obok repo

- Klon: `git clone <url scribe-devtools> ../scribe-devtools`, potem w `../scribe-devtools`:
  `pnpm install --frozen-lockfile && pnpm run prepare` (repo ma tylko `pnpm-lock.yaml`, więc `npm ci` nie
  zadziała; `.npmrc` ma `ignore-scripts=true` — to celowe, dlatego `prepare` wołasz jawnie). Alternatywnie
  zbuduj zip portable (`pnpm run portable` → `download/`,
  `node packages/browser-inspector/bin/browser-inspector.mjs help` działa z rozpakowanego zipa bez menedżera
  pakietów).
- W `package.json` aplikacji dodaj skrypt:
  `"browser-inspector": "node ../scribe-devtools/packages/browser-inspector/bin/browser-inspector.mjs"`
  i od tej pory wołaj **`pnpm browser-inspector …`** (npm: `npm run browser-inspector -- …`).
- Sprawdź: `pnpm browser-inspector help` i `pnpm browser-inspector doctor` (keeper startuje,
  przeżywa zamknięcie powłoki, drugi call jest ciepły).

## 2. Config flow: `read.config.browser-inspector.json` w korzeniu repo

Jeden snapshot per aplikacja jako start (`type: "page"` — zrzut, konsola, sieć, mapa elementów),
potem flow przepisane ze scenariuszy z kroku 0. Gramatyka kroków: `pnpm browser-inspector help [krok]`
(pola configu i flagi jednego kroku, bez czytania źródeł); przykłady:
`../scribe-devtools/packages/browser-inspector/templates/flow.md`.

```json
{
  "outputDir": "./.scribe-devtools/browser-inspector",
  "parallel": 3,
  "snapshots": [
    {
      "name": "portal-strona",
      "type": "page",
      "url": "http://localhost:4311/",
      "waitUntil": "settled",
      "fullPage": true
    },
    {
      "name": "portal-logowanie",
      "type": "flow",
      "url": "http://localhost:4311/login",
      "waitUntil": "settled",
      "steps": [
        { "do": "fill", "selector": "[data-testid=login-email]", "value": "qa@example.com" },
        { "do": "fill", "selector": "[data-testid=login-password]", "valueFromEnv": "PORTAL_QA_PASSWORD" },
        { "do": "click", "selector": "[data-testid=login-submit]" },
        { "do": "waitFor", "selector": "[data-testid=dashboard]" },
        { "do": "extract", "name": "powitanie", "selector": "h1" },
        { "do": "screenshot", "name": "po-zalogowaniu" }
      ]
    }
  ]
}
```

Zasady: port w `url` każdego snapshotu = `port smoke` tej aplikacji z tabeli kroku 0 (nigdy `port serve`);
te same pary trafiają w kroku 3 do tablicy `APPS` w `tools/scripts/smoke-browser.mjs`, jedynego źródła portów
w kodzie, i tylko aplikacje, które mają snapshot w configu; `waitUntil: "settled"`
zamiast `networkidle`; `waitFor` zamiast `wait ms`; **sekrety tylko przez `valueFromEnv`** — narzędzie
odrzuca literał `value` TYLKO w `auth.login`/`auth.oauth`; w `snapshots[].steps` (zwykły flow) literał hasła
przejdzie walidację i `lint-config` nic nie powie. Sprawdź sam: `grep -n '"value"' read.config.browser-inspector.json`
i każde trafienie przy polu hasła, tokenu lub klucza zamień na `"valueFromEnv": "NAZWA_ZMIENNEJ"`;
`data-testid` przed `#id` przed selektorami strukturalnymi;
nieudany krok to wynik w raporcie (exit 0), nie wyjątek. Config commituj — to smoke aplikacji,
nie prywatne zapytania. `pnpm browser-inspector lint-config read.config.browser-inspector.json`
podpowiada tylko migracje `networkidle`/`wait ms`/`parallel`, sekretów nie sprawdza.

## 3. Bramka `smoke:browser` (Nx build → serwer statyczny → flow → werdykt)

Napisz `tools/scripts/smoke-browser.mjs` (Node, zero zależności, cross-platform):

1. na początku skryptu tablica `APPS = [{ name, dir, port }]` przepisana z tabeli kroku 0: `dir` = kolumna
   „katalog builda” (`dist/apps/<app>/browser` dla `@angular/build:application`, `dist/apps/<app>` dla innych
   builderów — nie wpisuj ścieżki na sztywno), `port` = `port smoke`; tylko aplikacje ze snapshotem w configu.
   Dla każdego wpisu z `APPS`: brak `<dir>/index.html` → komunikat z komendą naprawczą
   (`pnpm nx build <app> --configuration=production`) i exit 3;
2. serwer statyczny per aplikacja z `APPS` na jej `port`, serwujący pliki z jej `dir` (`node:http`,
   **tabela MIME z `.js → text/javascript`** — bez niej moduły Angulara nie wykonają się i strona będzie pusta;
   fallback SPA na `<dir>/index.html`);
3. `findRunner()`: `SCRIBE_DEVTOOLS_DIR` → `../scribe-devtools/packages/browser-inspector/bin/browser-inspector.mjs`
   (tu `dir` = znaleziony katalog scribe-devtools, nie `dir` z `APPS`);
   runner nie znaleziony → komunikat „sklonuj scribe-devtools obok repo albo ustaw `SCRIBE_DEVTOOLS_DIR`” i exit 3;
   gotowość: `createRequire(path.join(dir, 'packages/browser-inspector/package.json')).resolve('playwright-core/package.json')`
   w `try/catch` (`createRequire` z `node:module`; tak samo robi `resolvePlaywrightCore` w
   `../scribe-devtools/scripts/portable-zip.mjs`, działa dla klonu z pnpm i dla rozpakowanego zipa). **Nie**
   sprawdzaj `<dir>/node_modules/playwright-core` — pnpm go tam nie kładzie i bramka zgłaszałaby brak po każdej
   instalacji. Błąd resolve → komunikat `pnpm install --frozen-lockfile --dir <dir>` i exit 3 (ten sam kod co
   brak builda w punkcie 1 — problem środowiska, nie wynik smoke);
4. `args = process.argv.slice(2).filter((a) => a !== '--')` (pnpm przekazuje dalej literalny `--`, a runner po
   nim traktuje resztę jako pozycyjne → „batch takes exactly one <config.json>”, exit 2);
   `stamp = stampArg(args) ?? buildStamp(new Date())`; `'--stamp', stamp` dopisz do `args` **tylko**, gdy
   `stampArg(args) === undefined` (dwa `--stamp` → wygrywa ostatni i raporty trafią gdzie indziej niż czyta
   bramka); potem `spawn(process.execPath, [runner, config, ...args])` (asynchronicznie — `spawnSync`
   zablokowałby pętlę zdarzeń serwerów); exit dziecka ≠ 0 → zamknij serwery i zwróć ten kod bez czytania
   raportów; pod `CI=true` narzędzie samo jedzie bez keepera.
   - `stampArg(args)`: wartość `--stamp X` albo `--stamp=X`, inaczej `undefined`.
   - `buildStamp(now)`: `new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(now).replace(' ', '_').replace(':', '-')`
     → `YYYY-MM-DD_HH-MM`; każdy inny kształt (ISO, `Date.now()`) runner odrzuca exit 2.
5. odczyt `<outputDir>/<stamp>/<snapshot>/report.json`, `evaluateReports()`: brak raportu albo
   `completed !== true` → `FAIL <snapshot>: <navigationError | krok "…" — błąd>` i exit 1;
6. spec `tools/scripts/smoke-browser.spec.mjs` dla czystych funkcji (`evaluateReports`, `findRunner`, `stampArg`,
   `buildStamp`) w runnerze testów, którego repo już używa; sprawdź, że jego `include` łapie ten plik
   (app-factory: Vitest, `include: [..., 'tools/**/*.spec.mjs']`). Skrypt eksportuje te funkcje i woła `main()`
   tylko przy bezpośrednim uruchomieniu — inaczej import w specu wystartuje serwery i runner:
   `const invokedDirectly = process.argv[1] !== undefined && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));`
   `if (invokedDirectly) process.exitCode = await main();`

Skrypty: `"smoke:browser": "node tools/scripts/smoke-browser.mjs"`. CI: jeśli repo ma już pipeline
(`.gitlab-ci.yml` albo istniejący plik w `.github/workflows/`), dopisz do niego job z `CI=true`, który najpierw
buduje (`pnpm nx run-many -t build --configuration=production`), potem uruchamia `pnpm smoke:browser`; jeśli
repo nie ma pipeline'u — nie twórz go (żadnych GitHub Actions ani `.github/workflows/`). Uruchom lokalnie dwa
razy z rzędu (drugi przebieg ciepły) i raz pod CI: Git Bash `CI=true pnpm smoke:browser`; PowerShell
`$env:CI='true'; pnpm smoke:browser; Remove-Item Env:CI` — wszystkie snapshoty `completed`.

## 4. Instrukcje dla Copilota i sprzątanie MCP

- Do `.github/copilot-instructions.md` (i `AGENTS.md`, jeśli jest) wklej **dokładnie** blok
  instrukcji z `../scribe-devtools/.github/copilot-instructions.md` (między `INSTRUCTION:START/END`) — to cały koszt
  stały narzędzia w każdej sesji; nie dopisuj do niego własnych zdań. Pod blokiem, w osobnym akapicie, dopisz
  dokładnie dwa zdania: jedno o `pnpm smoke:browser` oraz „W tym repo każde `browser-inspector …` z bloku
  wołaj jako `pnpm --reporter=silent browser-inspector …` (npm: `npm run -s browser-inspector -- …`) — binarki nie ma na PATH.”
- Skopiuj `../scribe-devtools/.github/prompts/browser-session.prompt.md` do `.github/prompts/`
  (pętla „spójrz, potem kliknij" jako `/browser-session`).
- Usuń wpis `playwright` z `.vscode/mcp.json` / `.mcp.json` i wzmianki `@playwright/mcp`
  z instrukcji. Jeśli zespół chce zostawić serwer do rzadkiego, ręcznego rozpoznania, przenieś go
  do osobnego pliku konfiguracji i napisz w instrukcjach, kiedy go podpinać — domyślnie ma nie
  ładować ~26 definicji narzędzi do każdej sesji (README `@playwright/mcp`: 25 „Core automation” +
  `browser_tabs`; grupy `--caps` są opcjonalne). Wpisu `playwright` w `mcp.json` użytkownika (znalezionego
  w kroku 0) nie edytuj — to ustawienia poza repo: wypisz jego ścieżkę w podsumowaniu i poproś operatora,
  żeby sam usunął albo wyłączył ten serwer.

## 5. Sesja interaktywna zamiast `browser_snapshot`

Rozpoznanie nieznanego ekranu prowadzi `/browser-session` (skopiowany w kroku 4). Najpierw w osobnym
terminalu uruchom serwer deweloperski aplikacji: `pnpm nx serve <app>` (`port serve` z tabeli kroku 0, zwykle
4200; `port smoke` działa tylko w trakcie `pnpm smoke:browser`). W skrócie:

```
pnpm browser-inspector open http://localhost:<port serve>/
pnpm browser-inspector find "Zaloguj"
pnpm browser-inspector click e45
pnpm browser-inspector snap --diff
pnpm browser-inspector export flows/<app>-<scenariusz>.json   # sesja → config; nazwa pliku = nazwa snapshotu; wartości z --env jako valueFromEnv
```

Plik z eksportu to cały config z jednym snapshotem. Przenieś do tablicy `snapshots` configu z kroku 2
**tylko** obiekt `snapshots[0]`, nie cały plik. W jego `url` zamień `port serve` na `port smoke` tej aplikacji
z tabeli kroku 0 (np. `4200` → `4311`), zostaw ścieżkę. Uruchom
`pnpm browser-inspector lint-config read.config.browser-inspector.json`, potem `pnpm smoke:browser` (cała
bramka — z `--only` pozostałe snapshoty nie miałyby raportu i bramka by padła). Na koniec usuń plik z `flows/`.

## Kryteria ukończenia

- `pnpm smoke:browser` zielone lokalnie (2× z rzędu) i raz pod `CI=true` (komendy z kroku 3); wszystkie
  snapshoty `completed`.
- spec `smoke-browser.spec.mjs` zielony w runnerze testów repo (ten sam, który odpala `pnpm run verify`).
- Żadnego `@playwright/mcp` w domyślnie ładowanej konfiguracji MCP (`.vscode/mcp.json`, `.mcp.json`) ani
  w instrukcjach. Jedyny wyjątek (tylko gdy zespół zostawił serwer, krok 4): osobny plik konfiguracji i jedno
  zdanie w instrukcjach, kiedy go podpiąć. Blok browser-inspector w `.github/copilot-instructions.md`
  identyczny ze źródłem.
- `grep -n '"value"' read.config.browser-inspector.json` nie pokazuje żadnego hasła, tokenu ani klucza
  (sprawdzane ręcznie, narzędzie pilnuje tego tylko w `auth.login`); `.scribe-devtools/` w `.gitignore`
  (wyniki to dane aplikacji).
- README: sekcja „Smoke przeglądarkowy" (jak zbudować, jak uruchomić, gdzie są raporty, jak
  dopisać flow z sesji).
- `pnpm run verify` (albo odpowiednik) zielone.

## Czego nie robić

- Nie instaluj `playwright`/`@playwright/test` „przy okazji" — narzędzie używa systemowego
  Chrome/Edge przez `playwright-core` z własnego katalogu.
- Nie wpisuj haseł ani tokenów do configu, promptów ani instrukcji.
- Nie uruchamiaj `browser-inspector run --file` (RCE-równoważne) bez jawnej decyzji operatora
  i `BROWSER_INSPECTOR_UNSAFE=1`.
