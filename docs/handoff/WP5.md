# Handoff WP5 → WP2, WP6, WP8, WP9 — keeper, klient, doctor

WP5 dostarczył trzy pliki procesu: `bin/bi.mjs` (wejście), `src/client.mjs` (proces agenta),
`src/keeper.mjs` (ciepła przeglądarka) oraz hook `test/hooks/trace-loads.mjs`. Silnik jest
wstrzykiwany przez mały interfejs (niżej), więc wszystkie testy WP5 jadą na **fake'u** po
prawdziwym named pipe / unix sockecie — bez Chrome. Ten sam keeper przetestowany ręcznie z
prawdziwym `src/engine.mjs` (WP2) i Chrome 152: `first` → `warm` (scrub 9 ms), `--parallel 2`,
`status`, `doctor`, `stop` — działa bez zmian w silniku.

Testy WP5 (38, zielone): `npx vitest run packages/browser-inspector/test/keeper.test.mjs
packages/browser-inspector/test/client.test.mjs packages/browser-inspector/test/client-imports.test.mjs`;
opt-in `BI_PERF=1 npx vitest run --project perf` (`bi help` mediana z 5 = **75 ms**, próg 120).
`prettier --check` i `tsc --noEmit` na plikach WP5 zielone (całe repo: patrz „Odstępstwa”).

**Prośba (plik współdzielony, nieedytowany przez WP5):** do `CHANGELOG.md` sekcji `Unreleased` dopisać:
`- WP5: keeper (lock O_EXCL, nasłuch przed silnikiem, token, NDJSON bez env, kolejki lane:<n>/session:<name>
z queuedMs, idle 30 min, TTL sesji, recykling, status/doctor, log bez sekretów), klient (spawn → retry → fallback
tylko dla batchu, resolveValues/secretValues/files w kliencie, kody wyjścia), bin/bi.mjs bez playwright-core;
test/hooks/trace-loads.mjs (AC-8, AC-12, AC-13, AC-14).`

## `bin/bi.mjs` — jak rozdziela wejścia

Plik importuje statycznie **tylko** `src/cli.mjs` (a przez niego `steps.schema.mjs`). `bi help [cmd]`,
`bi --help`, brak argumentów → `usage()` bez ładowania klienta. Wszystko inne → `import('../src/client.mjs')`
→ `main(argv)` → kod wyjścia. Klient statycznie importuje `node:*` + `cli`, `config`, `paths`, `print`
i **nigdy** `keeper.mjs`, `engine.mjs`, `steps.run.mjs`, `playwright-core` (test
`client-imports.test.mjs` sprawdza graf pod hookiem `--import` dla `help`, komendy sesji bez keepera
i `lint-config`).

| wejście | ścieżka |
| --- | --- |
| `bi <config.json> …` (batch), `bi script <plik>` | `daemonEnabled(env, { noDaemon })` → keeper (`runViaKeeper`: connect → spawn odłączonego keepera → retry co 25 ms do 3 s); brak keepera po 3 s → linia `keeper: fallback · <powód>` i **ten sam handler w procesie** (`runInProcess` → `import('./keeper.mjs')` → `createContext({ mode: 'fallback' })` → `handleRequest`); `--no-daemon` / `BI_DAEMON=0` / CI → od razu w procesie, `timing.mode = 'no-daemon'` |
| `bi <komenda sesji> …`, `bi export …` | wyłącznie keeper; `BI_DAEMON=0`/CI bez `BI_DAEMON=1` → `exit 2` + `KEEPER_UNAVAILABLE('keeper disabled …')` **bez spawnu**; keeper nie wstał → `exit 2` + `KEEPER_UNAVAILABLE(<powód>)`; nigdy przeglądarka w procesie |
| `bi up` | keeper ze spawnem, czeka na `engine ready` (`ok keeper up · pid · hash · pipe`) |
| `bi status`, `bi stop` | keeper **bez** spawnu (timeout 500 ms); brak → `keeper not running · hash · pipe` / `ok keeper not running …`, exit 0 |
| `bi doctor` | w kliencie (`doctor()`): `cmd.exe /c` (win) albo `sh -c` uruchamia `bi up` z `BI_SOCKET=<pipe>-doctor-<pid>-<rnd>`; po wyjściu powłoki nowy `status` z tego procesu = przeżył; potem `open about:blank`/`close` w sesji `__doctor` (gdy silnik ma `runCommand`), `stop`. Linia z `formatDoctor`; exit 0 przy `yes`, 1 przy `no` |
| `bi version`, `bi lint-config` | w kliencie, bez keepera |

Tożsamość: `computeIdentity({ env, browser })` = `collectIdentity` + `identityHash` z `paths.mjs`
(hash zmienia się po edycji `src/**` — ręcznie potwierdzone: `f4151036` → `40579700` po edycji
`client.mjs`). `BI_SOCKET` zmienia pipe i **klucz plików** pid/lock/log (`<hash>-<fnv(BI_SOCKET)>`), nie hash —
dwa agenty z dwoma keeperami nie dzielą locka. `BI_TMPDIR` (nowe, testowe) nadpisuje `os.tmpdir()` dla plików
pid/lock/log, żeby równoległe testy nie widziały swoich keeperów.

## Protokół keepera (NDJSON po pipe, `src/types.d.ts`: `KeeperRequest` / `KeeperProgress` / `KeeperDone`)

Żądanie — jedna linia:

```json
{ "v": 1, "token": "<64 hex z pliku pid>", "cwd": "D:/x", "argv": ["fill", "e3", "@{APP_PASS}", "--session", "s"],
  "values": { "argv.fill.value": "…" }, "secretValues": ["…"], "files": { "photo.bin": { "base64": "…", "size": 4 } },
  "session": "s", "out": "./.scribe/browser-inspector" }
```

- **Bez `env`** — żądanie z polem `env` dostaje `exit 2` (`FAIL keeper: the protocol carries no env …`); zły
  token → `exit 2` + `bad token`; zły kształt → `malformed request`. Tylko pierwsza linia połączenia jest czytana.
- `values` = wartości rozwiązane w **kliencie** pod adresami: batch `snapshots[i].steps[j].value`,
  `snapshots[i].steps[j].fields[k].value`, `auth.login.steps[j].value`, `auth.oauth.<pole>` (z `<pole>FromEnv`);
  sesja `argv.<komenda>.value`, `argv.form.fields[k].value`; skrypt `script[<nr linii od 0>].value` /
  `script[n].fields[k].value` (linie dzieli `splitCommandLine` z `client.mjs` — **WP6 musi dzielić tą samą
  funkcją**, inaczej adresy nie trafią; komentarze `#` i puste linie zachowują numerację).
- `secretValues` = każda wartość pochodząca z env (także `auth.oauth`); keeper pamięta je per proces i redaguje
  (`redact()`) linie stdout, log, `_manifest.json`, JUnit i wszystko, co przechodzi przez `ctx.redact`.
- `files` = pliki czytane przez klienta względem **jego** cwd (batch: cwd, potem katalog configu): `upload.files[]`,
  `evaluate.file`, `route.file` (kroki i `snapshot.routes[]`), `run.file`, `state load`, plik `script`; ≤ 1 MB
  jako `base64`, większe jako `{ path, size }` absolutny. Brak pliku = `exit 2` w kliencie z adresem.
- Odpowiedzi: `{ "progress": { snapshot, completed, ms, index, total } }` po każdym snapshotcie batchu (klient
  drukuje `ok|FAIL <nazwa> · <ms> ms` tylko gdy `total > 1`), potem `{ "done": true, exit, lines, files, mode,
  timing: { mode, totalMs, queuedMs, … } }`. Klient drukuje `lines`, kończy `exit`.

Pliki keepera (`os.tmpdir()` albo `BI_TMPDIR`): `bi-<klucz>.json` = `{ pid, pipe, token, version, hash, key,
startedAt, listeningAt, processStartAt, biPath }` (tryb 0600 — na Windows chroni ACL `%TEMP%`), `bi-<klucz>.lock`
(`O_EXCL`, pid w środku), `bi-<klucz>.log` (obcinany > 1 MB, redagowany). Cykl życia zgodnie z DESIGN §2.5:
lock → (stale pid/socket sprząta **keeper** po `kill(pid, 0)`) → `listen` → plik pid → `import` silnika i launch;
`EEXIST`/`EADDRINUSE` → exit 0; `disconnected` → exit 1; `SIGINT`/`SIGTERM`/`bi stop`/idle → `close()` silnika,
usunięcie plików, exit 0. Idle (`BI_IDLE_MS`, 1 800 000) liczony od końca ostatniego zadania **i tylko** przy
pustych kolejkach i braku sesji; sesja podtrzymuje do `BI_SESSION_TTL_MS` (3 600 000) od ostatniej komendy;
`BI_MAX_JOBS` (200) / `BI_MAX_RSS_MB` (1024) → `engine.recycle()` między zadaniami przy pustej kolejce,
następne zadanie ma `mode: 'first'`.

Kolejki: `createQueues()` — łańcuch obietnic per klucz `lane:<n>` (batch, snapshot `k` → lane `k % parallel`)
i `session:<name>` (komendy, `script`, `export`); różne klucze równolegle; `queuedMs` = czas czekania na
poprzednika (test: dwa `wait 300` na jednej sesji → drugi `queuedMs ≥ 250`, na dwóch sesjach < 560 ms łącznie).

## Interfejs silnika (`EngineLike` w `keeper.mjs`)

Keeper ładuje moduł z `BI_ENGINE_MODULE` (domyślnie `./engine.mjs`; ścieżka względna do `src/`, absolutna, albo
nazwa pakietu) i woła **`createEngine({ browser, env, log, onDisconnected })`** — dokładnie sygnaturę, którą
`src/engine.mjs` już ma. Potem czeka na `engine.ready` (jeśli jest) albo raz na `engine.warm()` (launch; błąd
= `engine failed` w logu, każde zadanie odpowiada `exit 2` `FAIL keeper: engine unavailable: <powód>`, `bi up`
też). Co keeper woła (wszystko poza `runFlow` i `close` opcjonalne, sprawdzane `?.`):

| metoda | kto dostarcza | kontrakt |
| --- | --- | --- |
| `runFlow(snapshot, dir, laneOpts)` | WP2 ✅ | `laneOpts = { lane, mode, queuedMs, fresh, values, secretValues, files, cwd, stamp, runDir, config, configPath, auth, snapshotIndex, address, index, total, redact, log }`. Zwraca **`Report`** (§5.2) — wtedy keeper pisze `report.json/md`, `elements.md`, `text.txt`, `_manifest.json` snapshotu przez `writeArtifacts` (WP4) z `render` snapshotu i `redact` — **albo** `FlowResult { completed, ms?, files?, timing?, failure? }` (fake), wtedy nic nie dopisuje. Rzut z `code: E_BROWSER_MISSING`/`E_CONFIG` = fatalny, `exit 2`; inny rzut = snapshot `completed: false` |
| `runCommand(name, step, ctx)` | **WP6** | `step` z parsera (kształt configu), `ctx = { command, alias, options, cwd, out, values, secretValues, files, mode, queuedMs, redact, log }`; zwraca `{ exit, lines, files?, timing? }`; rzut → `exit 2` `FAIL <alias> · <pierwsza linia>`. Keeper: `--soft` zamienia `exit 1` na 0, linie redaguje, `session:<name>` w kolejce |
| `session(name)` | **WP6** | stan sesji albo `undefined`; keeper po każdej komendzie **synchronizuje rejestr** z silnikiem (sesja nieotwarta/zamknięta nie podtrzymuje idle); bez tej metody keeper zakłada „otwarta, dopóki nie `close`” |
| `closeSession(name)` | **WP6** | wołane przy TTL; ma zamknąć kontekst sesji |
| `runScript(lines, ctx)` | **WP6** | `lines` = wszystkie linie pliku (z komentarzami — indeksy = adresy `script[n]`), `ctx = { session, cwd, out, values, secretValues, files, mode, queuedMs, redact, log }`; zwraca `{ exit, lines, files? }` (exit = pierwszy niezerowy) |
| `exportFlow(name, { file, force, cwd, out })` | **WP6** (z `session-log.mjs` WP4) | `{ exit, lines, files? }`; `file` absolutny |
| `status()` albo `stats()` | WP2 ✅ (`stats`) | `{ launches, launchMs, lanes, routes?, browser, rssMb|browserRssMb, pwVersion? }` — `launches` steruje `mode: first|warm`, `rssMb` recyklingiem, reszta linią `bi status` |
| `versions` | WP2 ✅ | `{ bi, 'playwright-core' }` — druga linia `bi status` |
| `recycle()` | WP2 ✅ | `browser.close()` + launch między zadaniami |
| `close()` | WP2 ✅ | przy `stop`/idle/sygnale (5 s cap) |
| `onDisconnected` (opcja) | WP2 ✅ | keeper loguje i kończy `exit 1` |

Manifest przebiegu `<outputDir>/<stamp>/_manifest.json` i `--junit` pisze **keeper** (`buildManifest`,
`renderJUnit` z WP4; `timing: { mode, keeperStartMs? (tylko `first`), launchMs? (ze `stats().launchMs`),
clientMs }` — `clientMs` to czas żądanie→odpowiedź mierzony w keeperze, prawdziwy czas klienta jest większy o
connect i druk; **WP9** bierze czas klienta ze stopera `spawn→exit`, nie stąd). Dla `FlowResult` bez raportu wpis
manifestu ma zera w brakujących polach `timing` (nigdy `undefined`) i `failure` z `FlowResult.failure`.

Fake do testów: `test/fixtures/fake-engine.mjs` (log wywołań w `BI_FAKE_LOG`, `wait --ms` naprawdę śpi,
`goto`/`close` otwiera/zamyka sesję, `click e404` = martwy ref, `fill` echuje długość wartości, `BI_FAKE_LAUNCH_MS`
opóźnia `ready`). Harness: `test/fixtures/keeper-harness.mjs` (`makeEnv` = własny pipe, `BI_TMPDIR`, fake; `bi()`,
`rawRequest()`, `stopKeeper()` — zabija osierocone keepery po teście).

## Odstępstwa i decyzje

- `bi status`/`bi stop` **nie** spawnują keepera (DESIGN §2.5 mówi o auto-starcie „dla każdej komendy”; dla
  `status`/`stop` start po to, żeby powiedzieć „działam” / „zatrzymuję”, kosztowałby 1,5 s i zostawiał proces).
  `bi up`, batch, `script`, sesja, `export` spawnują.
- `bi doctor` ocenia przeżycie powłoki po `status` (każdy silnik), nie po `open` — z WP2 bez `runCommand` `open`
  daje `exit 2` i wynik byłby fałszywie `no`. `warm` w linii to `open`/`close` gdy silnik ma sesję, inaczej round
  trip `status` (u WP2: `warm 5 ms`).
- Redakcja w keeperze działa na **wszystkich** sekretach widzianych od startu procesu (nie tylko bieżącego
  zadania) — log jest jeden na keeper; koszt zerowy, ryzyko przecieku sekretów innego zadania mniejsze.
- Protokół ma dodatkowe pole odpowiedzi `mode` (obok `timing.mode`) — klient drukuje z `lines`, `mode` czyta test.
- `BI_CONNECT_TIMEOUT_MS` (testowe) skraca 3 s retry; `BI_TMPDIR` (testowe) przenosi pliki pid/lock/log.
- Nie ma osobnego testu „log i dziennik bez sekretów” — jest w `keeper.test.mjs` (`secrets`), razem z
  `report.json` fake'a przez `redact` keepera; pełny test AC-14 przez wszystkie artefakty należy do WP6/WP8 (smoke).
- `test/perf/client-start.perf.test.mjs` jest poza projektem `unit` (vitest.config wyklucza `test/perf/**`),
  uruchamiany tylko przy `BI_PERF=1` — zgodnie z konfiguracją WP0.
- `npm install --ignore-scripts` przebiegł raz (prośba WP0): `node_modules/.bin/bi{,.cmd,.ps1}` istnieją,
  `package-lock.json` bez zmian.
- `CODE-INDEX.md` zregenerowany (`node scripts/index-code.mjs`) — plik generowany, WP1/WP3 robiły to samo.
- `tsc --noEmit` na całym repo pada dziś na `test/snapshot.test.mjs(699)` (błąd składni w pliku WP3 w trakcie
  edycji) i przez to nie raportuje nic więcej; pliki WP5 sprawdzone osobnym tsconfigiem (te same opcje, `include`
  = pliki WP5 + `types.d.ts`) — zero błędów. Błędy z `docs/handoff/WP3.md` (client 382/401/402, keeper
  688/743/793) już nie występują.

## Prośby do innych pakietów

- **WP6**: dodać do obiektu z `createEngine` metody `runCommand`, `session`, `closeSession`, `runScript`,
  `exportFlow` wg tabeli wyżej; dzielić linie skryptu przez `splitCommandLine` z `client.mjs` (import jest
  bezpieczny — `client.mjs` to `node:*` + moduły czyste); komendy sesji dostają `ctx.values['argv.<cmd>.value']`
  i `ctx.files['<ścieżka jak w argv>']`; `out` sesji ustala keeper (`--out` przy pierwszej komendzie, potem
  zapamiętane) i przekazuje w `ctx.out`.
- **WP2**: nic do zmiany — sygnatura `createEngine(options)`, `runFlow` → `Report`, `stats()`, `versions`,
  `recycle()`, `close()`, `onDisconnected` są używane 1:1. Opcjonalnie `stats()` może podać `routes` (liczba
  aktywnych route'ów) do linii `bi status`.
- **WP8**: README/AGENTS — `bi up` jako hook `SessionStart`, `bi doctor` (`keeper survives shell: yes|no`),
  ACL `%TEMP%` zamiast 0600, `BI_SOCKET` dla dwóch agentów, `BI_TMPDIR`/`BI_CONNECT_TIMEOUT_MS` jako zmienne
  testowe; `test/compat/smoke-gate.test.mjs` może używać `keeper-harness.mjs` (`makeEnv` z
  `BI_ENGINE_MODULE` usuniętym → prawdziwy silnik). `bench/keeper-survives-shell` = to, co robi `doctor()`.
- **WP9**: `_manifest.json.timing.clientMs` to czas w keeperze — stoper benchu liczy `spawn→exit` klienta;
  `snapshots[].queuedMs/scrubMs/cacheHits` są z `report.timing` silnika.
