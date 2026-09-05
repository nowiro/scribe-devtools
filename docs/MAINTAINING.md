# Utrzymanie: punkty synchronizacji i wydanie

Te dwie sekcje mieszkały w `AGENTS.md`, który Copilot i Claude Code ładują w KAŻDEJ rozmowie — a potrzebne są
tylko wtedy, gdy zmieniasz kontrakt między modułami albo tniesz wydanie. Tu kosztują tokeny raz, na życzenie.
`AGENTS.md` wskazuje na ten plik; reguły są te same.

## Punkty synchronizacji (zmiana w jednym wymaga zmiany w drugim)

- blok instrukcji `nx-angular-inspector` ↔ `INSTRUCTION` w `bench/nx-angular-inspector-run.mjs`
  ↔ jego kopia w `.github/copilot-instructions.md` (nazwane znaczniki, trzy kopie znak w znak).
- blok instrukcji `browser-inspector` w `AGENTS.md` ↔ `INSTRUCTION` w `bench/browser-inspector-run.mjs` ↔ blok w
  `.github/copilot-instructions.md` — MIERZONY koszt stały;
  rozjazd = pomiar kłamie (bramka `check-instruction-sync`).
- `STEPS` w `src/steps.schema.mjs` ↔ `RUNNERS` w `src/steps.run.mjs` — test równości kluczy
  (`test/engine.test.mjs`); klient importuje tylko schemat, silnik tylko runnery;
  `docs/STEPS.md` i `browser-inspector help` renderują tę samą tabelę.
- `PageLike` w `src/types.d.ts` ↔ `FakePage` w testach ↔ wywołania w `steps.run.mjs`.
- protokół keepera (`KeeperRequest/Response`, bez `env`) ↔ `src/client.mjs` ↔ `src/keeper.requests.mjs`;
  adresy wartości (`snapshots[i].steps[j].value`, `argv.<cmd>.value`, `script[n].value`) ↔
  `ctx.value()` w silniku; linie `browser-inspector script` dzieli `splitCommandLine` z `client.mjs` po obu stronach.
- `scrubPlan` (ops) w `src/isolation.mjs` ↔ `applyScrub` w `src/lanes.mjs`.
- kształt `report.json` (`completed`, `steps[].description/ok/error`, `navigationError` tylko gdy
  jest, `timing.mode/ctx/tab/queuedMs/scrubMs/cacheHits`) ↔ `bench/budget.mjs` ↔ kopia
  `evaluateReports()` w `test/compat/smoke-gate.test.mjs` ↔ `tools/scripts/smoke-browser.mjs`
  w app-factory.
- `findRunner` w `tools/scripts/smoke-browser.mjs` (app-factory) ↔ jej spec ↔ układ tego repo
  (`packages/browser-inspector/bin/browser-inspector.mjs`, `node_modules/playwright-core`) — przeniesienie
  binarki wymaga PR w app-factory.
- fixture `packages/browser-inspector/fixtures/app-factory.config.json` ≡ `read.config.browser-inspector.json`
  w app-factory (porty 4311–4314 → test przepisuje na 4571–4574).
- **wszystkie wersje zależności**: `scripts/pins.config.mjs` ≡ manifesty ≡ linie komend ≡ proza
  (bramka `check-pins`). Nowa zależność bez wiersza = FAIL — kontrola, która nie wie, czego nie
  sprawdza, czyta się jak pokrycie, będąc jego brakiem. Poniższe dwa punkty są tego szczególnym
  przypadkiem i zostają, bo mówią **co** się psuje, czego bramka powiedzieć nie umie.
- wersja `@playwright/mcp`: `bench/package.json` ↔ `.mcp.json` ↔ `.vscode/mcp.json` (test).
- `playwright-core` przypięty **exact** `1.62.1`, podłoga `minSupported: '1.62.1'`,
  w `packages/browser-inspector` i `bench` (fakty o `aria-ref` w DESIGN.md dotyczą tej wersji);
  tożsamość keepera liczy tę wersję; `stagePortable` odmawia, gdy `node_modules` ma inną —
  i dlatego zakres zamiast gołego numeru wywala **każdy** build portable (`portable-zip.mjs`
  porównuje string manifestu `!==`).
- tabela budżetu §6 DESIGN.md ↔ `bench/budget.mjs` (`DESIGN_BUDGET`).
- README „Sesja" (próbki stdout) ↔ `src/print.mjs` (test reprodukuje próbki DESIGN §4.4 co do znaku).

## Wydanie (wersjonowanie: SemVer, historia: CHANGELOG.md)

1. Dopisuj do `CHANGELOG.md` sekcji `Unreleased` RAZEM ze zmianą, nie przy tagowaniu;
   odwołuj się do numerów `AC-n` z `docs/ACCEPTANCE.md` i pakietów `WPn` z `docs/PLAN.md`.
2. Wydanie: podbij `version` w korzeniu **i w OBU pakietach**
   (`packages/browser-inspector/package.json`, `packages/nx-angular-inspector/package.json`) — jeden
   zip, jedna wersja repo-wide; build zipa odmawia, gdy którykolwiek się różni od korzenia
   (`portable-zip.mjs#readVersion`, sprawdza wszystkie wpisy `PACKAGES`, nie tylko pierwszy).
   Bugfix dotykający tylko jednego narzędzia i tak wymaga podbicia obu — to jest koszt
   trzymania ich w jednym zipie, świadomie zaakceptowany, nie przeoczony. Wersję czyta się
   wyłącznie z `package.json` → przenieś
   `Unreleased` do nowej sekcji z datą → `npm run verify` (z buildami app-factory obok, żeby
   `compat` nie był pominięty) → `node scripts/check-upstream.mjs --strict` (kalendarzowa połowa
   doktryny aktualności — tu, i tylko tu, WARN staje się FAIL; commit zmieniony
   `scripts/upstream-state.json`, jeśli coś się zmieniło) → `npm run bench -- --assert-speedup 5` (RAPORT.md z kolumną
   `mcp-lean --timeout-settle 100` i `browser-inspector-warm-tight`; blok BENCH w README) → commit (hook buduje
   `download/scribe-devtools-portable-<wersja>.zip` + `.sha256` i dodaje je do commita) →
   tag `vX.Y.Z` → push z tagiem →
   `gh release create vX.Y.Z download/scribe-devtools-portable-<wersja>.zip download/…zip.sha256 --title ... --notes ...`.
3. Bramka app-factory: `pnpm smoke:browser` z `CI=true` (bez keepera) i lokalnie z keeperem
   **dwa razy z rzędu**, wszystkie 6 snapshotów `completed` — dopiero potem PR w app-factory
   (`findRunner`, skrypt `browser-inspector`, dwa zdania w AGENTS.md) jest scalany.
4. Zip portable JEST commitowany: każda wersja zostaje w `download/` (asset Release'a to ten sam
   plik, sumę kontrolną niesie sidecar `.sha256`). Starych zipów nie usuwaj — „każda wersja
   istnieje w repo" to reguła, nie wygoda. **Zip wydanej wersji jest zamrożony**: gdy istnieje tag
   `v<wersja>`, hook go nie przebudowuje (komunikat „wersja … jest wydana”). Rozwój toczy się dalej pod
   numerem wydanej wersji aż do podbicia przy następnym wydaniu — zamrożony jest tylko wydany zip,
   nie drzewo; `node scripts/portable-zip.mjs --force` przebudowuje mimo to.
