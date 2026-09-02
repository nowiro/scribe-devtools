# RENAME — `bi` → `browser-inspector` (obszar `src`, stan po zmianie)

Zasada właściciela: skrót `bi` nie występuje nigdzie w aplikacji — zawsze pełna nazwa `browser-inspector`. Ten plik jest
kontraktem dla pozostałych obszarów (testy, docs, bench, portable, app-factory): nazwy niżej są **dokładnie** tym, co
dziś zapisuje `packages/browser-inspector/src` i `bin`. Brak aliasów zgodności dla `BI_*` (narzędzie ma jeden dzień —
czysty break, w CHANGELOG jako BREAKING).

## Binarka i skrypty

| było                                                     | jest                                                                       |
| -------------------------------------------------------- | -------------------------------------------------------------------------- |
| `packages/browser-inspector/bin/bi.mjs`                  | `packages/browser-inspector/bin/browser-inspector.mjs` (`git mv`)          |
| `package.json` pakietu: `"bin": { "bi": "bin/bi.mjs" }`  | `"bin": { "browser-inspector": "bin/browser-inspector.mjs" }`              |
| root `package.json`: skrypt `"bi"`                       | skrypt `"browser-inspector"` (`npm run browser-inspector -- …`)            |
| app-factory `package.json`: skrypt `"bi"` (`pnpm bi …`)  | skrypt `"browser-inspector"` (`pnpm browser-inspector …`) — obszar app-factory |
| shim portable `bi.cmd` / `bi`                            | `browser-inspector.cmd` / `browser-inspector` — obszar portable            |

## Zmienne środowiskowe (prefiks `BI_` → `BROWSER_INSPECTOR_`, każda bez wyjątku)

Czytane przez `src/` (produkt):

```
BROWSER_INSPECTOR_DAEMON             BROWSER_INSPECTOR_SOCKET             BROWSER_INSPECTOR_TMPDIR
BROWSER_INSPECTOR_IDLE_MS            BROWSER_INSPECTOR_SESSION_TTL_MS     BROWSER_INSPECTOR_SESSION
BROWSER_INSPECTOR_UNSAFE             BROWSER_INSPECTOR_ENGINE_MODULE      BROWSER_INSPECTOR_STEP_TIMEOUT_MS
BROWSER_INSPECTOR_CHANNEL            BROWSER_INSPECTOR_BROWSER_PATH       BROWSER_INSPECTOR_BROWSER_ARGS
BROWSER_INSPECTOR_MAX_JOBS           BROWSER_INSPECTOR_MAX_RSS_MB         BROWSER_INSPECTOR_LANE_IDLE_MS
BROWSER_INSPECTOR_SCRUB_OP_MS        BROWSER_INSPECTOR_REQUEST_TIMEOUT_MS BROWSER_INSPECTOR_CONNECT_TIMEOUT_MS
```

Czytane wyłącznie przez testy, hooki, skrypty i bench (do zmiany w tych obszarach — `src/` ich nie zna):

```
BROWSER_INSPECTOR_TRACE_LOADS        BROWSER_INSPECTOR_PERF               BROWSER_INSPECTOR_PERF_BUDGET_MS
BROWSER_INSPECTOR_PERF_CLIENT_MS     BROWSER_INSPECTOR_SKIP_SMOKE         BROWSER_INSPECTOR_FAKE_LOG
BROWSER_INSPECTOR_FAKE_LAUNCH_FAIL   BROWSER_INSPECTOR_FAKE_LAUNCH_MS     BROWSER_INSPECTOR_FAKE_SCRUB_MS
BROWSER_INSPECTOR_FAKE_RSS_MB
```

Nazwy `BI_ALLOW*`, `BI_ENV_ALLOW`, `BI_SECRET_*`, `BI_RANGE`, `BI_KEEPER_ENV`, `BI_FILES_ROOT`, `BI_UNSAFE_ALLOW` istnieją
tylko jako propozycje w `docs/SECURITY-REVIEW.md` (plik nietykalny) — nie ma ich w kodzie.

## Tożsamość keepera (formaty nazw — `src/paths.mjs`)

| co                     | format                                                                            |
| ---------------------- | --------------------------------------------------------------------------------- |
| named pipe (Windows)   | `\\.\pipe\browser-inspector-<user>-<hash>`                                        |
| unix socket (POSIX)    | `$XDG_RUNTIME_DIR` albo tmpdir `/browser-inspector-<uid>-<hash>.sock`             |
| plik pid               | `<tmpdir>/browser-inspector-<key>.json` = `{ pid, pipe, token, version, startedAt, binPath, … }` |
| lock                   | `<tmpdir>/browser-inspector-<key>.lock`                                           |
| log                    | `<tmpdir>/browser-inspector-<key>.log`                                            |
| `key`                  | `hash` albo `hash-<fnv1a(BROWSER_INSPECTOR_SOCKET)>` — bez zmian                  |
| tytuł procesu keepera  | `process.title = 'browser-inspector-keeper'` (nowe; wcześniej tytułu nie było)    |
| argv keepera           | `node src/keeper.mjs --hash … --pipe … --key … --browser … --engine … --bin <ścieżka> --pw …` (`--bi` → `--bin`) |
| pipe sondy `doctor`    | `<pipe>-doctor-<pid>-<losowe>` — bez zmian poza prefiksem pipe’a                  |
| katalogi wyjściowe     | `.scribe-devtools/browser-inspector/…` — bez zmian (już pełna nazwa)              |

Tmpdir sond i testów: `browser-inspector-*` (dawne `bi-test-*`, `bi-portable-*`, `bi-wp4-*` … — obszar testów/portable).

## Identyfikatory w kodzie, które zmieniły nazwę (widoczne w plikach wyjściowych / protokole)

| było                                        | jest                                                      | gdzie                                                    |
| ------------------------------------------- | --------------------------------------------------------- | -------------------------------------------------------- |
| `identity.biPath`, `info.biPath`, `options.biPath` | `binPath`                                          | `client.mjs`, `keeper.mjs`, `print.mjs` (`formatDoctor`) |
| `engine.bi` w `report.json` (`EngineInfo.bi`) | `engine['browser-inspector']`                           | `engine.mjs`, `types.d.ts`; DESIGN §5 pokazuje `"engine": { "bi": … }` — do poprawki w docs |
| `versions.bi` (silnik)                      | `versions['browser-inspector']`                           | `engine.mjs`                                             |
| `SCRIPT = 'bi'` → `tooling.script` w `report.json` | `'browser-inspector'`                              | `report.mjs`                                             |
| JUnit: `<testsuites name="bi">`, `classname="bi.<suite>"` | `name="browser-inspector"`, `classname="browser-inspector.<suite>"` | `report.mjs`                            |
| JUnit z batchu bez configu: `bi.xml` suite  | `browser-inspector`                                       | `engine.mjs`                                             |
| linia statusu keepera: `bi 0.1.0 · playwright-core …` | `browser-inspector 0.1.0 · playwright-core …`   | `keeper.mjs` (`statusLines`)                             |
| stderr klienta: `bi: <błąd>`                | `browser-inspector: <błąd>`                               | `bin/browser-inspector.mjs`, `client.mjs`                |

Nie zmienione, bo nie są nazwą narzędzia: `BIN_PATH`, `binRealpath`, `binFile` (słowo „bin”), `bench` itd. Helper testów
`bi(args, h)` z `test/fixtures/keeper-harness.mjs` jest wewnętrzny — obszar testów decyduje (`runBrowserInspector` jest
tańsze niż wyjaśnianie skrótu).

## Stdout — linie, które zmieniły treść (limit 160 znaków / 40 tokenów o200k, zmierzone)

| linia (po zmianie)                                                                                                          | znaki | tok. |
| --------------------------------------------------------------------------------------------------------------------------- | ----: | ---: |
| `ok fill e39 · navigated → refs f1eN (browser-inspector snap) · el 58`                                                      |    68 |   23 |
| `FAIL click e99 · ref not found (gone, label changed or other frame) → browser-inspector snap`                              |    92 |   22 |
| `policy dismiss · last: confirm "Usunąć?" → dismissed (browser-inspector click e12)`                                        |    82 |   21 |
| `FAIL keeper unavailable: <reason> — sessions need the keeper (browser-inspector up \| doctor); batch works with --no-daemon` |   — |   — |
| … z `<reason>` = `disabled (BROWSER_INSPECTOR_DAEMON=0 or CI)` (dawne `keeper disabled (BI_DAEMON=0 or CI; BI_DAEMON=1 overrides)`) | 157 | 39 |
| … z `<reason>` = `ECONNREFUSED`                                                                                              |   126 |   28 |
| `… ×32 similar (e228–e1220): "The Lord of the Rings", "1984", "The Hobbit" … · browser-inspector find <text>`               |   107 |   36 |
| `FAIL keeper: bad token (stale pid file? browser-inspector doctor)`                                                          |    65 |   16 |
| `ok keeper survives shell: yes · spawn→listen 45 ms · first job 1 390 ms · warm 470 ms · hash 3f9a1c2e · <ścieżka bin>`     |   182 |   55 |

Linia `doctor` była i jest jedynym wyjątkiem od 160 znaków (ścieżka absolutna jest jej sensem); `test/print.test.mjs`
sprawdza ją progiem 60 tokenów — z pełną nazwą w ścieżce wychodzi 55, próg zostaje. Druga linia `browser-inspector status`
(wersje + ścieżka bin) ma tę samą naturę — zależy od długości checkoutu (tu 164 znaki).

`KEEPER_UNAVAILABLE` zmienił słowa wokół nazwy: `session needs keeper (bi up, bi doctor)` → `sessions need the keeper
(browser-inspector up | doctor)`; powód z `client.mjs` skrócono o dopisek `BI_DAEMON=1 overrides` (jest w README).
Wzorce w `test/print.test.mjs` (`KEEPER_UNAVAILABLE('ECONNREFUSED')`, `formatDoctor({ biPath })`), `test/report.test.mjs`
(`EngineInfo.bi`), `test/junit.test.mjs` (`name="bi"`), `test/fixtures/fake-engine.mjs` (`engine: { bi: 'fake' }`) i
README/DESIGN §4.4 muszą przyjąć powyższe brzmienia.

Tekst `help` (`browser-inspector help`): cztery linie gramatyki mają 153 / 122 / 123 / 140 znaków; wyrównanie kolumn z
nawiasami skrócono o pięć spacji, treść bez zmian.

## Co robi i czego nie robi obszar `src`

- Zrobione: `git mv bin/bi.mjs bin/browser-inspector.mjs`; `package.json` pakietu (`bin`, opis); root `package.json`
  (skrypt `browser-inspector`, opis); każdy `src/*.mjs` i `src/types.d.ts` (zmienne, prefiksy, help, podpowiedzi stdout,
  komunikaty błędów, komentarze); `process.title` keepera. `node bin/browser-inspector.mjs help` działa, `prettier --check`
  na zmienionych plikach przechodzi, `tsc --noEmit` jest czysty dla `src/` (dwa błędy zostają w `test/print.test.mjs:145`
  `biPath` i `test/report.test.mjs:46` `bi` — obszar testów).
- `grep -rnE "\bbi\b|BI_|\bbi[-.]" src bin package.json` zwraca **nic**.
- Nie ruszone: `test/**`, `scripts/**`, `bench/**`, README, AGENTS.md, CHANGELOG, DESIGN/ACCEPTANCE/STEPS, CODE-INDEX.md
  (generowany — `node scripts/index-code.mjs` po scaleniu), `docs/SECURITY-REVIEW.md`, `download/`.
