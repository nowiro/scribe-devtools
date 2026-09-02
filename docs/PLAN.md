# Plan wdrożenia — browser-inspector 2 (scribe-devtools), wersja po recenzjach

Zasady dla równoległych agentów: każdy pakiet ma **wyłączną własność plików**, własne testy i jawne zależności. Interfejsy dzielone (`PageLike`, kształt wpisu STEPS w dwóch plikach, protokół keepera bez `env`, kształt `report.json` z `timing.mode/tab/queuedMs/scrubMs/cacheHits`, `scrubPlan` ops) są spisane w `docs/DESIGN.md` §2–5 i **zamrożone przez WP1**. Każdy pakiet kończy się zielonym `npm run verify` w swoim zakresie (prettier 120/LF, vitest, tsc --checkJs, CODE-INDEX) i wpisem w `CHANGELOG.md` (`Unreleased`). Repo `D:/github/scribe-devtools` ma już `.git`, `.npmrc`, `prettier.config.mjs`, `.editorconfig`, `.gitattributes` — WP0 ich nie nadpisuje. Sondy rewizyjne (`probe-tab*.mjs`, `tok.mjs`) trafiają do `bench/probes/` w WP0 jako dowód liczb z DESIGN.md.

## Faza 0 — fundament (sekwencyjnie, 1 agent)

### WP0 · scaffold repo
**Pliki:** `package.json` (workspaces `packages/*`, `bench`; skrypty `verify`, `test`, `smoke`, `docs`, `code-index`, `portable`, `bench`), `vitest.config.mts`, `tsconfig.json` (checkJs, noEmit, `types: ["node"]`), `.githooks/pre-commit`, `scripts/index-code.mjs` (port), `scripts/portable-zip.mjs` (port + marker `PORTABLE`), `scripts/check-instruction-sync.mjs`, `scripts/gen-steps-doc.mjs` (szkielet), `AGENTS.md`, `CLAUDE.md`, `README.md`, `CHANGELOG.md`, `docs/DESIGN.md`, `packages/browser-inspector/package.json` (bin `browser-inspector`, `playwright-core` **"1.62.1"** exact, engines ≥ 22), `bench/package.json` (`@playwright/mcp` "0.0.80", `gpt-tokenizer`), `bench/probes/*.mjs`.
**Testy:** `scripts/index-code.spec.mjs`; `npm run verify` zielone na pustym pakiecie.
**DoD:** `npm ci` (ignore-scripts) + `npm run verify`; hook przez `prepare`.

### WP1 · kontrakty i moduły czyste (rdzeń)
**Pliki:** `src/steps.schema.mjs` (pełna lista nazw z `kind/argv/flags/config/validate/describe/help`; walidacja „`ref` bez wcześniejszego `snapshot`”), `src/cli.mjs`, `src/config.mjs` (`loadConfig`, `lintConfig` — dla `wait ms` proponuje `waitFor`/`wait --text`, nie `settled`), `src/paths.mjs` (`identityHash` fnv1a z realpath + srcStamp + proxy, `pipeName`, `pidFile`, `lockFile`, `isCI`, `daemonEnabled`), `src/print.mjs`, `src/redact.mjs`, `src/isolation.mjs` (**tylko** `scrubPlan(state)` → lista ops, `needsFreshContext`, `GEN_SCRIPT(gen)`), `src/deadline.mjs`, `src/types.d.ts`, `fixtures/app-factory.config.json`.
**Testy:** `test/cli.test.mjs`, `test/config.test.mjs` (fixture app-factory bez zmian; `value` w `auth.login` = błąd; `ref` bez `snapshot` = błąd; ścieżka `snapshots[i].steps[j]`), `test/steps-describe.test.mjs`, `test/print.test.mjs`, `test/redact.test.mjs`, `test/paths.test.mjs` (hash zmienia się z wersją pw-core, Node major, realpath, srcStamp, `HTTP_PROXY`; `isCI` dla 8 zmiennych; `BROWSER_INSPECTOR_DAEMON=1` wygrywa), `test/isolation.test.mjs` (plan dla 1 i 4 originów, popupów, crash → `newTab`; brak `about:blank`).
**Zależy od:** WP0. **Odblokowuje:** wszystko poniżej.

## Faza 1 — równolegle (5 agentów), po WP1

### WP2 · silnik batch, rejestrator, izolacja (agent A)
**Pliki:** `src/engine.mjs` (`createEngine` — skład), `src/lanes.mjs` (`createLanePool`, `launchBrowser`, lane’y `scratch[0..N-1]` z trwałą kartą, `spare`, `applyScrub` wykonujący ops z `scrubPlan` przez CDP/kontekst, zdrowie: `crash`, `disconnected`, recykling `BROWSER_INSPECTOR_MAX_JOBS`/RSS), `src/steps.ctx.mjs` (`makeStepContext`, `runStep`), `src/flow.mjs` (`runFlow` ze scrubem między snapshotami, `runBatch`, `finishRun`), `src/recorder.mjs` (since-last, bodies ≤ 64 KB, `cacheHits`, `tabs[]`), `src/settle.mjs`, `src/capture.mjs` (CDP-zrzut z fallbackiem, `finalEvidence` z regułami `page.png`/`final.png`, `evaluateWithTimeout` + mapowanie wyniku + `withDeadline`), `src/steps.run.mjs` — sekcja batch (goto/back/forward/reload/click/fill/type/form/press/hover/select/check/uncheck/drag/upload/scroll/wait/waitFor/screenshot/pdf/extract/evaluate/verify(+list, soft)/resize/route/unroute/dialog/tab/mouse/storage/state/snapshot/trace/video), `fixtures/form.html`, `slow.html`, `dialog.html`, `upload.html`, `drag.html`, `routes.html`, `storage.html`.
**Testy:** `test/engine.test.mjs` z `FakePage` (mapowanie; porażka → `completed:false` + `final.png`; `page` → `page.png`; sukces z ostatnim zrzutem → bez `final.png`; scrub między snapshotami wywołany N−1 razy; `evaluate` przez `cdp.send('Runtime.evaluate')` + deadline; mapowanie `undefined`/string/obiekt/DOM node/`throw` → forma `Error: …`), `test/settle.test.mjs`, `test/recorder.test.mjs`, `test/smoke/smoke.test.mjs` część batch (prawdziwy Chrome, `--no-daemon`: 12 kroków na `form.html`, dialog, upload, drag, route; **izolacja**: snapshot A ustawia localStorage+sessionStorage+cookie na dwóch originach fixture, B nic nie widzi, `history.length === 1`; `[ref=e` i klik przez `aria-ref=`).
**Zależy od:** WP1.

### WP3 · snapshot i refy (agent B)
**Pliki:** `src/snapshot.mjs` (`compactSnapshot`, `boxJoin`, `findInSnapshot`, `diffSnapshot`, `aroundRef`, `namesContext`, `locatorFor`, `resolveRef` — pełny snapshot `ai`, nigdy poddrzewo), `fixtures/snapshots/bookstore.ai.yml` + `bookstore.boxes.yml` + `walk.json`, `fixtures/snapshots/wizard.ai.yml`, `fixtures/iframe.html`, `fixtures/relabel.html`.
**Testy:** `test/snapshot.test.mjs` (952 linii → ≤ 90 linii; box-join 100 %; `find` ≤ 10 linii; `diff`; `--names` dopisuje przodka ≤ 60 znaków; `f3e7` przechodzi dosłownie), test tokenowy (gpt-tokenizer devDep): kompakt 25 linii ≤ 450 tok., 40 linii ≤ 700; smoke (w WP6): ref sprzed `verify list`/`find` nadal się rozwiązuje; zmiana etykiety → stary ref FAIL < 100 ms; ref z iframe rozwiązuje się bez `frame`.
**Zależy od:** WP1.

### WP4 · raport, manifesty, JUnit, eksport (agent C)
**Pliki:** `src/report.mjs` (`renderReportMd` §5.1 z nagłówkiem warunkowym `final:/sw=blocked/motion/tab new/fallback`, `## verify`, `renderElementsMd`, `renderJUnit`, `buildManifest` run-level + per snapshot, `writeArtifacts`), `src/session-log.mjs` (`appendJournal`, `exportFlow` → nowy plik, `--force`, refy → selektory, `valueFromEnv`).
**Testy:** `test/report.test.mjs` (sukces ≤ 200 tok. o200k na danych z §5.1 — dokładnie 187 na próbce; porażka z `## steps`; `navigationError` nieobecne w JSON; `steps[i].error` w formie `Error: …`; `tabs[]`), `test/export.test.mjs` (dziennik → config parsuje się; sekret nigdy w pliku; refy zamienione na selektory — test negatywny; odmowa nadpisania), `test/junit.test.mjs`.
**Zależy od:** WP1.

### WP5 · keeper, klient, doctor (agent D)
**Pliki:** `bin/browser-inspector.mjs`, `src/client.mjs` (connect → spawn → retry → fallback **tylko batch**; sesja bez keepera → exit 2; `resolveValues` + `secretValues` + `files`; `doctor`), `src/keeper.mjs` (lock `O_EXCL`, listen-first, token, NDJSON, kolejki `lane:<n>`/`session:<name>`, idle 30 min od końca zadania przy pustych kolejkach, TTL sesji, recykling, `status` z RSS/hash/ścieżką, log bez sekretów), `test/hooks/trace-loads.mjs`.
**Testy:** `test/keeper.{identity,idle,queues,secrets}.test.mjs` (prawdziwy pipe/socket, silnik = fake: dwa klienty → jeden keeper; lock → drugi keeper exit 0; zły token; stale pid/socket sprzątnięte przez keeper, nie klienta; idle-exit `BROWSER_INSPECTOR_IDLE_MS=200` tylko przy pustej kolejce; sesja blokuje idle; `BROWSER_INSPECTOR_SOCKET`; kolejka serializuje; `queuedMs` w odpowiedzi), `test/client.test.mjs` (batch fallback z `timing.mode = "fallback"`; sesja bez keepera → exit 2 + komunikat; żądanie nie zawiera `env`; `@{FOO}` bez zmiennej → exit 2; `@literal` zostaje literałem; pliki czytane przez klienta), `test/client-imports.test.mjs` (graf: nigdy `playwright-core` ani modułu silnika — `engine`/`lanes`/`flow`/`session`/`steps.ctx`/`steps.run`), `test/perf/client-start.perf.test.mjs` (`browser-inspector help` ≤ 120 ms mediana z 5), test: log keepera i dziennik bez wartości sekretów.
**Zależy od:** WP1 (fake silnik).

### WP6 · komendy sesyjne i `script` (agent E)
**Pliki:** `src/session.mjs` — `runCommand`/`openSession`/`runScript` (uzgodniona własność: WP6 dodaje `sessions`, `frames` (zakres CSS), `tabs`, polityki dialogów z `beforeunload` auto-accept, `console --level`, `net <n>`, delty), `src/steps.run.mjs` — kroki wyłącznie sesyjne (`open`, `snap`, `find`, `console`, `net`, `fetch`, `offline`, `frame`, `tabs`, `locator`, `close`, `shot --mark`, `eval --file/--el`, `run --file` pod `BROWSER_INSPECTOR_UNSAFE=1`), `fixtures/tabs.html`.
**Testy:** `test/session.test.mjs` z `FakePage` (delty; `console` tylko nowe; martwy ref → FAIL bez timeoutu; `snap --max 25` z markerem; `frame` nie robi snapshotu poddrzewa; dialog wg polityki; `tab`; `run` odrzucone bez `BROWSER_INSPECTOR_UNSAFE`), rozszerzenie smoke: 12 komend sesji na `form.html` + `tabs.html` + `iframe.html` + `relabel.html` przez keepera (`browser-inspector up` → komendy → `browser-inspector doctor` → `browser-inspector stop`), `browser-inspector script` w `--no-daemon`.
**Zależy od:** WP2, WP3, WP5 — startuje na `FakePage`, integruje na końcu.

### WP7 · auth i storageState (agent F, mały)
**Pliki:** `src/auth.mjs` (port ze skryby), `fixtures/kc-token.mjs`, `fixtures/login.html`.
**Testy:** `test/auth.test.mjs`; smoke: login raz → drugi snapshot zalogowany (kontekst `fresh`, `serviceWorkers: 'allow'`).
**Zależy od:** WP2.

## Faza 2 — integracja i bramki (2 agenty)

### WP8 · zgodność, docs, pakowanie, app-factory (agent A)
**Pliki:** `test/compat/smoke-gate.test.mjs` (spawn `bin/browser-inspector.mjs fixtures/app-factory.config.json --stamp <poprawny>` z lokalnym serwerem fixture’ów na 4 portach; kopia `evaluateReports()`; trzy przebiegi: `--no-daemon`, keeper ×2 z rzędu — drugi: `dziennik-uczen.completed === true`, `nowiro-jezyk.extracts['naglowek-pl']` po polsku — i `--parallel 3` z identycznym zbiorem `completed`; identyczność `report.json` daemon vs no-daemon modulo `timing/engine`), `scripts/gen-steps-doc.mjs` + `docs/STEPS.md`, `templates/flow.md`, `README.md` (instalacja, `pnpm browser-inspector`, `browser-inspector up` jako hook, `browser-inspector doctor`, co browser-wide nie jest czyszczone, ACL `%TEMP%`), AGENTS.md (blok ≡ `bench/browser-inspector-run.mjs`), `scripts/portable-zip.mjs` + test rozpakowania, `browser-inspector lint-config`, PR do app-factory: `smoke-browser.mjs` (`findRunner` + kandydaci + komunikat naprawczy), `smoke-browser.spec.mjs` (przypadki `findRunner`), `package.json` (skrypt `browser-inspector`), AGENTS.md app-factory (dwa zdania), opcjonalny commit migracji configu.
**Zależy od:** WP2–WP7.

### WP9 · bench i BUDGET.md (agent B)
**Pliki:** `bench/bench.mjs`, `bench/browser-inspector-run.mjs` (`INSTRUCTION`, warianty `browser-inspector-cold`, `browser-inspector-first`, `browser-inspector-warm` n ≥ 10 z przerwą 300 ms, `browser-inspector-warm-tight`, `browser-inspector-warm-fresh`, `browser-inspector-interactive` ×2, `keeper-survives-shell`, `app-factory` parallel 1/3), `bench/mcp-run.mjs` (naive, lean, lean settle 100; przerwa 300 ms), `bench/mcp-client.mjs`, `bench/task.mjs`, `bench/tokens.mjs`, `bench/time-run.mjs` (stempel poprawny, czekanie na `chrome.exe`, mediany + p90, „first-ever” osobno, `timing.mode` walidowany), `bench/raport.mjs` (tabela nagłówkowa z trzema kolumnami MCP), `bench/budget.mjs` (BUDGET.md: fazy vs §6, `queuedMs`/`scrubMs`/`cacheHits`, > 25 % i iloraz < 5,0 czerwone), `bench/app/`, `bench/serve.mjs`, `.mcp.json`, `.vscode/mcp.json`, `bench/bench.test.mjs`, `--assert-speedup` na medianie.
**Zależy od:** WP5, WP8.

## Faza 3 — wydanie (1 agent)

### WP10 · release 0.1.0
CHANGELOG `Unreleased` → `0.1.0`; `npm run verify`; `npm run bench -- --assert-speedup 5` (lokalnie; wynik do RAPORT.md z kolumną settle 100 i `browser-inspector-warm-tight`); `npm run portable`; tag `v0.1.0`; `gh release create` z zipem; PR w app-factory scalony po zielonym `pnpm smoke:browser` na obu ścieżkach (`CI=true` i lokalnie z keeperem, dwa razy z rzędu).

## Kolejność i równoległość

```
WP0 → WP1 → { WP2 ‖ WP3 ‖ WP4 ‖ WP5 ‖ (WP6 na FakePage) } → WP7 → { WP8 ‖ WP9 } → WP10
```

Punkty synchronizacji: kształt wpisu STEPS w `steps.schema.mjs` ↔ `RUNNERS` w `steps.run.mjs` (WP1 ↔ WP2/WP6; test równości kluczy), `PageLike` (WP1 ↔ WP2/WP3/WP6), protokół `KeeperRequest/Response` bez `env` (WP1 ↔ WP5), `scrubPlan` ops ↔ `applyScrub` (WP1 ↔ WP2), `report.json` (WP4 ↔ WP2/WP8), blok AGENTS.md ↔ `INSTRUCTION` (WP8 ↔ WP9), pin `@playwright/mcp` w 3 plikach (WP9), tabela §6 ↔ `bench/budget.mjs` (WP9), `findRunner` ↔ spec app-factory (WP8).
