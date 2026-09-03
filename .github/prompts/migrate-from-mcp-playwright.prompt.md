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
   → `dist/apps/<app>/browser`, inne → `dist/apps/<app>`), porty z `project.json`/`serve` i
   istniejące scenariusze przeglądarkowe (specy e2e, prompty, notatki), które agent wykonywał
   przez MCP — to jest lista flow do przepisania.
3. Sprawdź, czy obok repo leży `../scribe-devtools` (z `node_modules/playwright-core`) albo czy
   masz zip `download/scribe-devtools-portable-<wersja>.zip`. Wymagania: Node ≥ 22 i systemowy
   Chrome/Edge (nic nie jest pobierane).

Wyjście kroku 0: tabela `aplikacja | builder | katalog builda | port | scenariusze do przepisania`
i lista plików z konfiguracją MCP. Pokaż ją i czekaj na „dalej".

## 1. Narzędzie obok repo

- Klon: `git clone <url scribe-devtools> ../scribe-devtools && cd ../scribe-devtools && npm ci && npm run prepare`
  (`.npmrc` ma `ignore-scripts=true` — to celowe). Alternatywnie zbuduj zip portable
  (`npm run portable` → `download/`, `node packages/browser-inspector/bin/browser-inspector.mjs help`
  działa z rozpakowanego zipa bez npm).
- W `package.json` aplikacji dodaj skrypt:
  `"browser-inspector": "node ../scribe-devtools/packages/browser-inspector/bin/browser-inspector.mjs"`
  i od tej pory wołaj **`pnpm browser-inspector …`** (npm: `npm run browser-inspector -- …`).
  Inna lokalizacja narzędzia: zmienna `SCRIBE_DEVTOOLS_DIR`.
- Sprawdź: `pnpm browser-inspector help` i `pnpm browser-inspector doctor` (keeper startuje,
  przeżywa zamknięcie powłoki, drugi call jest ciepły).

## 2. Config flow: `read.config.browser-inspector.json` w korzeniu repo

Jeden snapshot per aplikacja jako start (`type: "page"` — zrzut, konsola, sieć, mapa elementów),
potem flow przepisane ze scenariuszy z kroku 0. Gramatyka kroków źródłowo:
`../scribe-devtools/packages/browser-inspector/src/steps.schema.mjs`, przykłady:
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

Zasady: porty w configu = porty serwera statycznego z kroku 3 (jedna tabela); `waitUntil: "settled"`
zamiast `networkidle`; `waitFor` zamiast `wait ms`; **sekrety tylko przez `valueFromEnv`** —
literał hasła w configu to błąd; `data-testid` przed `#id` przed selektorami strukturalnymi;
nieudany krok to wynik w raporcie (exit 0), nie wyjątek. Config commituj — to smoke aplikacji,
nie prywatne zapytania. `pnpm browser-inspector lint-config read.config.browser-inspector.json`
podpowiada migracje.

## 3. Bramka `smoke:browser` (Nx build → serwer statyczny → flow → werdykt)

Napisz `tools/scripts/smoke-browser.mjs` (Node, zero zależności, cross-platform) na wzór
`app-factory/tools/scripts/smoke-browser.mjs`:

1. dla każdej aplikacji z tabeli: brak `dist/apps/<app>/browser/index.html` → komunikat z komendą
   naprawczą (`pnpm nx build <app> --configuration=production`) i exit 3;
2. serwer statyczny per aplikacja (`node:http`, **tabela MIME z `.js → text/javascript`** — bez
   niej moduły Angulara nie wykonają się i strona będzie pusta; fallback SPA na `index.html`);
3. `findRunner()`: `SCRIBE_DEVTOOLS_DIR` → `../scribe-devtools/packages/browser-inspector/bin/browser-inspector.mjs`;
   brak `node_modules/playwright-core` → komunikat `npm ci --prefix <dir>`;
4. `spawn(process.execPath, [runner, config, '--stamp', stamp, ...args])` (asynchronicznie —
   `spawnSync` zablokowałby pętlę zdarzeń serwerów); pod `CI=true` narzędzie samo jedzie bez keepera;
5. odczyt `<outputDir>/<stamp>/<snapshot>/report.json`, `evaluateReports()`: brak raportu albo
   `completed !== true` → `FAIL <snapshot>: <navigationError | krok "…" — błąd>` i exit 1;
6. spec `smoke-browser.spec.mjs` dla czystych funkcji (`evaluateReports`, `findRunner`, `stampArg`).

Skrypty: `"smoke:browser": "node tools/scripts/smoke-browser.mjs"`; w CI job z `CI=true` po
buildach (`pnpm nx run-many -t build --configuration=production`). Uruchom lokalnie dwa razy z rzędu
(drugi przebieg ciepły) i raz pod `CI=true` — wszystkie snapshoty `completed`.

## 4. Instrukcje dla Copilota i sprzątanie MCP

- Do `.github/copilot-instructions.md` (i `AGENTS.md`, jeśli jest) wklej **dokładnie** blok
  instrukcji z `../scribe-devtools/AGENTS.md` (między `INSTRUCTION:START/END`) — to cały koszt
  stały narzędzia w każdej sesji; nie dopisuj do niego własnych zdań, dopisz osobny akapit
  o `pnpm smoke:browser`.
- Skopiuj `../scribe-devtools/.github/prompts/browser-session.prompt.md` do `.github/prompts/`
  (pętla „spójrz, potem kliknij" jako `/browser-session`).
- Usuń wpis `playwright` z `.vscode/mcp.json` / `.mcp.json` i wzmianki `@playwright/mcp`
  z instrukcji. Jeśli zespół chce zostawić serwer do rzadkiego, ręcznego rozpoznania, przenieś go
  do osobnego pliku konfiguracji i napisz w instrukcjach, kiedy go podpinać — domyślnie ma nie
  ładować 24 definicji narzędzi do każdej sesji.

## 5. Sesja interaktywna zamiast `browser_snapshot`

Do rozpoznania nieznanego ekranu (to, co dotąd robił MCP):

```
pnpm browser-inspector open http://localhost:4311/
pnpm browser-inspector find "Zaloguj"
pnpm browser-inspector click e45
pnpm browser-inspector snap --diff
pnpm browser-inspector export flow.json      # sesja → config, wartości z --env jako valueFromEnv
```

Każda komenda drukuje jedną linię (`exit 1` = FAIL), zrzuty i snapshoty lądują w
`.scribe-devtools/browser-inspector/session/<nazwa>/`. Wyeksportowany flow dopisz do configu z kroku 2.

## Kryteria ukończenia

- `pnpm smoke:browser` zielone lokalnie (2× z rzędu) i pod `CI=true`; wszystkie snapshoty `completed`.
- Żadnego `@playwright/mcp` w konfiguracji MCP repo ani w instrukcjach; blok browser-inspector
  w `.github/copilot-instructions.md` identyczny ze źródłem.
- Config bez literałów sekretów; `.scribe-devtools/` w `.gitignore` (wyniki to dane aplikacji).
- README: sekcja „Smoke przeglądarkowy" (jak zbudować, jak uruchomić, gdzie są raporty, jak
  dopisać flow z sesji).
- `pnpm run verify` (albo odpowiednik) zielone.

## Czego nie robić

- Nie instaluj `playwright`/`@playwright/test` „przy okazji" — narzędzie używa systemowego
  Chrome/Edge przez `playwright-core` z własnego katalogu.
- Nie wpisuj haseł ani tokenów do configu, promptów ani instrukcji.
- Nie uruchamiaj `browser-inspector run --file` (RCE-równoważne) bez jawnej decyzji operatora
  i `BROWSER_INSPECTOR_UNSAFE=1`.
