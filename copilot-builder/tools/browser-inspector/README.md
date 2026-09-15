# browser-inspector — przeglądarka przez skrypt (narzędzie wendorowane)

Patrzenie na aplikację webową przez **systemowy Chrome/Edge** bez serwera MCP: flow batch z configu JSON
(zrzuty, konsola, sieć, mapa elementów, nazwane ekstrakty → `report.md`) albo sesja interaktywna na refach
`eN` (`open`, `find`, `click e45`, `fill`, `snap`, `tools`, `call`, `export flow.json`) — jedna linia stdout na komendę
(`ok` / `FAIL`), całość na dysku w `.browser-inspector/`. Ciepła przeglądarka żyje
w lokalnym **keeperze**, który startuje sam i gaśnie po bezczynności; na CI (`CI`, `GITLAB_CI`, …) keepera
nie ma — komendy biegną w procesie.

```bash
npm run browser-inspector -- help                    # pełna lista komend, kroków i flag
npm run browser-inspector -- doctor                  # czy keeper startuje i przeżywa wyjście powłoki
npm run browser-inspector -- read.config.browser-inspector.json --stamp smoke
npm run browser-inspector -- open http://localhost:4200/
npm run browser-inspector -- find koszyk             # e45 button "Otwórz koszyk" [data-testid=…]
npm run browser-inspector -- click e45
npm run browser-inspector -- tools                   # narzędzia WebMCP strony (build dev), całość w tools.json
npm run browser-inspector -- call addToCart {"sku":"A-1"}   # wynik w calls/001-addtocart.json
npm run browser-inspector -- export flows/koszyk.json
```

Szablon flow z przykładami: [templates/flow.md](templates/flow.md). Sekrety wyłącznie przez środowisko
(`valueFromEnv`, `--env NAZWA`, `@{NAZWA}`) — literał hasła w configu jest błędem walidacji. Kody wyjścia
batcha: 0 zawsze (nieudany krok to wynik w raporcie), 1 tylko z `--fail-on-incomplete`, 2 przy błędzie
środowiska. Prompt sesji dla Copilota: `/browser-session`.

Jedyna zależność runtime — `playwright-core` (exact, w `package.json` korzenia; wersja jest częścią
tożsamości keepera i czyta wewnętrzne API playwrighta, dlatego pin jest dokładny). Typy w JSDoc,
sprawdzane `npm run typecheck`.

## Pochodzenie i zmiany względem źródła

Kod pochodzi z narzędzia **browser-inspector** (pakiet `0.1.0`), przeniesionego do tego repozytorium.
Zasada: **czytamy, nie przepisujemy**. Zmiany: manifest `package.json` zredukowany do nazwy, wersji i `bin`
(zależność deklaruje korzeń); wywołanie przez `npm run browser-inspector -- …`; katalog wyników to
`.browser-inspector/` — w źródle był to podkatalog katalogu nazwanego po pakiecie źródłowym, a szablon nie niesie
tej nazwy (`npm run guard:forbidden`, ADR w `docs/decisions/`), stąd `DEFAULT_OUTPUT_DIR` w `src/paths.mjs`,
`outputDir` w `src/config.mjs` i kontrola `storageState` w `src/auth.mjs` różnią się od źródła. Zmienne
`BROWSER_INSPECTOR_*` bez zmian.
