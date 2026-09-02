# Handoff WP7 → WP2, WP5, WP8 — auth i storageState

WP7 dostarczył `src/auth.mjs` (port bloku auth ze skryby: logowanie formularzem RAZ + `storageState`,
OAuth `password`/`client_credentials` na `tokenUrl` albo Keycloak `{ url, realm }`, świeżość sesji po
mtime i po ważności tokenu, `auth: false` per snapshot), `fixtures/login.html` (SPA za bramą: sesja w
localStorage + ciasteczko, drugie wejście przez token JWT pod `access_token`), `fixtures/kc-token.mjs`
(stub endpointu tokenu w kształcie Keycloaka) oraz testy `test/auth.test.mjs` (25, bez przeglądarki;
port 4562 + 4564) i `test/smoke/auth.smoke.test.mjs` (2, prawdziwy Chrome; porty 4561 + 4563).

Zielone (2026-09-02): `npx vitest run packages/browser-inspector/test/auth.test.mjs`,
`npx vitest run --project smoke packages/browser-inspector/test/smoke/auth.smoke.test.mjs`,
`prettier --check` na plikach WP7, `tsc --noEmit` — 0 błędów w plikach WP7 (`src/auth.mjs`,
`test/auth.test.mjs`, `test/smoke/auth.smoke.test.mjs`, `fixtures/kc-token.mjs`; błędy w drzewie leżą
w plikach innych WP — patrz „Stan drzewa”). `CODE-INDEX.md` zregenerowany (`node scripts/index-code.mjs`).

**Prośba (plik współdzielony, nieedytowany przez WP7):** do `CHANGELOG.md` sekcji `Unreleased` dopisać:
`- WP7: auth i storageState — ensureSession (logowanie formularzem RAZ przez RUNNERS silnika na świeżym
kontekście z serviceWorkers 'allow', OAuth password/client_credentials na tokenUrl albo Keycloak → storageState
zbudowany ręcznie + meta z ważnością tokenu, reuse pliku wg maxAgeMinutes i expires_in/exp), storageStateFor
(auth: false = widok anonimowy), AuthError E_AUTH bez wartości sekretów; fixture'y login.html i kc-token.mjs;
smoke: login raz → dwa snapshoty zalogowane, trzeci anonimowy (AC-11, AC-14).`

## `src/auth.mjs` — eksporty

| eksport | sygnatura | uwagi |
| --- | --- | --- |
| `ensureSession(auth, options?)` | `→ Promise<SessionInfo>` | patrz niżej; rzuca `AuthError` |
| `storageStateFor(snapshot, session)` | `→ string \| undefined` | `undefined` przy `snapshot.auth === false` albo bez sesji — **to** idzie do `laneOpts.storageState` |
| `resolveAuthValues(auth, { values?, env? })` | `→ { values, secretValues, missing }` | adresy jak u klienta (`auth.login.steps[j].value`, `auth.login.steps[j].fields[k].value`, `auth.oauth.<pole>`); brakujące **nazwane** (`APP_PASS (auth.login.steps[1].value)`) |
| `sessionUsable(stat, nowMs, maxAgeMinutes)` | `→ { usable, reason }` | świeżość po mtime (port 1:1) |
| `tokenUsable(meta, nowMs)` | `→ { usable, reason }` | świeżość po `<state>.meta.json.expiresAtMs` z marginesem `TOKEN_EXPIRY_MARGIN_MS` (30 s) |
| `tokenExpiresAt(tokenResponse, nowMs)` | `→ number \| undefined` | `expires_in` → `exp` z JWT → `undefined` |
| `oauthTokenUrl(oauth)` | `→ string` | `tokenUrl` wprost albo `<url>/realms/<realm>/protocol/openid-connect/token` |
| `oauthRequestBody(oauth, { values?, env? })` | `→ Record<string,string>` | `values['auth.oauth.password']` wygrywa nad `env[passwordFromEnv]`; brak = `AuthError` z nazwą zmiennej |
| `oauthStorageState(store, accessToken)` | `→ { cookies: [], origins: [{ origin, localStorage: [{ name: key, value }] }] }` | |
| `resolveStatePath(auth, baseDir?)`, `metaPath(statePath)` | | ścieżka pliku sesji względem **katalogu configu** (jak `outputDir`), meta = `<state>.meta.json` |
| `AuthError` (`.code === 'E_AUTH'`, `.exit === 2`, `.step?`), `E_AUTH`, `TOKEN_EXPIRY_MARGIN_MS`, `OAUTH_TIMEOUT_MS` (15 s) | | |

`SessionInfo = { storageState: <ścieżka absolutna>, method: 'file' | 'login' | 'oauth', reused: boolean, reason, expiresAtMs? }`.

### `ensureSession(auth, options)` — kontrakt

```js
import { ensureSession, storageStateFor } from './auth.mjs';
const session = await ensureSession(config.auth, {
  engine,                       // wymagany dla auth.login: { freshContext, makeStepContext, runStep } — silnik WP2 pasuje 1:1
  baseDir: path.dirname(config.configPath),   // auth.storageState względem configu; domyślnie process.cwd()
  values, secretValues,         // z żądania klienta (adresy jak wyżej); czego klient nie przysłał, bierze z `env`
  env: process.env,             // fallback tylko dla wołających bez klienta (bench, smoke, runBatch)
  log,                          // linie: `auth: session from file … (session from 12 min ago)`, `auth: login (no saved session) → <url>`,
                                //        `auth: oauth password (…) → <tokenUrl>`, `auth: session saved → <plik>`, `auth: WARNING … outside .scribe-devtools/`
});
// potem per snapshot:
engine.runFlow(snapshot, dir, { ...laneOpts, auth: config.auth, storageState: storageStateFor(snapshot, session) });
```

Kolejność: `stat(plik)` → `sessionUsable` (mtime vs `maxAgeMinutes`, domyślnie 60) → dla OAuth dodatkowo
`tokenUsable(meta)` → `reuse !== false && usable` ⇒ `{ method: 'file', reused: true }` bez przeglądarki i bez sieci.
Inaczej `resolveAuthValues` (brak zmiennej = `AuthError` **przed** dotknięciem przeglądarki), potem:

- **login**: `engine.freshContext({ viewport })` (spare albo nowy kontekst, `serviceWorkers: 'allow'`, nigdy lane
  scratch), `context.newCDPSession(page)`, `attachRecorder(page)`, `engine.makeStepContext({ mode: 'batch', values,
  secretValues, dir: dirname(statePath), timeoutMs: login.stepTimeoutMs ?? 10000, snapshot: { waitUntil } })`,
  `ctx.navigate(login.url, login.waitUntil ?? 'load', login.navTimeoutMs ?? 30000)`, kroki przez `engine.runStep`
  z `ctx.address = 'auth.login.steps[j]'` (te same RUNNERS, ten sam deadline, to samo `ctx.value()`), pierwsza
  porażka = `AuthError('login failed at step 3 (click [data-testid=login-submit]): <komunikat>', step)`;
  `context.storageState({ path })`; kontekst zamykany w `finally`.
- **oauth**: `fetch` (Node) `POST` `application/x-www-form-urlencoded` z `AbortSignal.timeout(15 s)`; błędy nazwane
  z endpointem: `OAuth <url>: HTTP 401 — {"error":"invalid_grant",…}`, `… the response is not JSON: <120 znaków>`,
  `… the response has no access_token`, `… no response after 15000 ms`; plik stanu + `<state>.meta.json`
  `{ expiresAtMs, obtainedAt }`.

Sekrety: każda linia logu i każdy komunikat błędu przechodzi przez `redact(text, secretValues)` (secretValues =
przysłane przez klienta ∪ rozwiązane z env); test jednostkowy i smoke asertują brak hasła w logu, błędach,
`report.json/md`, `text.txt` i pliku stanu (fixture zapisuje użytkownika, nie hasło).

## Prośby do innych pakietów (integracja — to WP7 zrobić nie mógł bez cudzych plików)

Dziś `engine.runFlow` **honoruje** `laneOpts.storageState` (kontekst `fresh` z `storageState`, WP2), keeper i
`runBatch` przekazują `auth: config.auth`, ale **nikt nie woła `ensureSession`** — bez poniższych dwóch zmian
`bi <config.json>` z `auth` jedzie na świeżym kontekście BEZ sesji (każdy snapshot pokaże ekran logowania).

- **WP5 (`src/keeper.mjs`, obsługa batchu)**: przed pierwszym `runFlow` przebiegu (poza kolejką lane'ów, raz na
  żądanie) `const session = config.auth ? await ensureSession(config.auth, { engine, baseDir: path.dirname(configPath),
  values, secretValues, log: ctx.log }) : undefined;` (import `../src/auth.mjs` jest lekki: `node:fs/promises`,
  `node:path`, `isolation`, `recorder`, `redact`, `steps.schema`). `AuthError` (`code: 'E_AUTH'`) = fatalny jak
  `E_BROWSER_MISSING`: `done(2, ['FAIL auth: ' + message])`. Do `laneOpts` każdego snapshotu:
  `storageState: storageStateFor(snapshot, session)`. Klient już dziś wysyła `values['auth.login.steps[j].value']`
  i `values['auth.oauth.<pole>']` oraz `secretValues` (docs/handoff/WP5.md) — nic w kliencie do zmiany.
  Ścieżka in-process (`runInProcess` → ten sam `handleRequest`) dostaje to samo za darmo.
- **WP2 (`src/engine.mjs`, `runBatch`)**: to samo dla wołających bez keepera (bench, WP8 compat): przed
  `Promise.all(workers)` `ensureSession(config.auth, { engine: { freshContext, makeStepContext, runStep }, baseDir:
  path.dirname(config.configPath ?? ''), values: options.values, secretValues: options.secretValues, env, log })`,
  w workerze `storageState: options.storageState ?? storageStateFor(snapshot, session)`. Uwaga: `needsFreshContext`
  (WP1) już daje `fresh` dla snapshotu z `auth`, więc **`snapshot.auth === false` + `isolation: 'fresh'`** bez
  `storageStateFor` dostałby sesję — dlatego plik idzie przez `storageStateFor`, nie z `session.storageState`.
- **WP8 (README/AGENTS/templates/flow.md)**: udokumentować blok `auth` (`storageState` względem configu, `login.steps`
  wyłącznie `valueFromEnv`, `oauth.*FromEnv`, `oauth.store { origin, key }`, `maxAgeMinutes`, `reuse`, `auth: false`
  per snapshot), plik sesji = żywe poświadczenia (`.scribe-devtools/` jest w `.gitignore`; poza nim keeper loguje
  ostrzeżenie), meta `<state>.meta.json` przy OAuth, `E_AUTH` → exit 2. `bi lint-config` może dodać wiersz
  „`auth.storageState` poza `.scribe-devtools/`” (opcjonalnie).
- **WP4 (opcjonalnie)**: stary raport skryby miał pole `session: 'z zapisanej sesji' | 'anonimowo'` tylko gdy
  `auth` było w grze; DESIGN §5.2 go nie wymienia, więc WP7 nic nie dodaje — `report.json.timing.ctx === 'fresh'` +
  `engine.serviceWorkers === 'allow'` mówią, że snapshot szedł na sesji. Gdyby WP8 chciał tę linię w nagłówku
  `report.md`, źródłem jest `laneOpts.storageState !== undefined` w `runFlow`.

## Odstępstwa od DESIGN/PLAN (z uzasadnieniem)

- Sygnatura `ensureSession(auth, options)` zamiast skrybowego `ensureSession(browser, auth)`: OAuth nie potrzebuje
  przeglądarki, a logowanie idzie przez `engine.freshContext`/`runStep` (te same RUNNERS, deadline i adresowanie
  wartości co flow), nie przez własną kopię pętli kroków — `engine` jest opcją.
- `auth.storageState` względem **katalogu configu** (`baseDir`), jak `outputDir` w `loadConfig`, nie względem cwd
  procesu jak w skrybie: keeper ma inne cwd niż klient, a bramka app-factory woła `bi` z innego katalogu niż config.
- `oauthRequestBody(oauth, { values, env })` (skryba: `(oauth, env)`): klient rozwiązuje `*FromEnv` u siebie i
  przysyła wartości pod `auth.oauth.<pole>` (protokół bez `env`, DESIGN §2.4) — `values` wygrywa, `env` jest
  fallbackiem dla wołających bez klienta.
- Login: **każdy** `fill` w `auth.login.steps` musi mieć `valueFromEnv` (także nazwa użytkownika) — tak waliduje
  `config.mjs` (`mode: 'auth'`, jak w skrybie); smoke używa `APP_USER` + `APP_PASS`. Wartość literalna jest
  możliwa tylko przy wołaniu silnika wprost (bez `parseConfig`).
- Meta OAuth zapisywane **zawsze** (`expiresAtMs: null`, gdy odpowiedź nie mówi o ważności) — skryba pisała je tylko
  przy znanej ważności; stały kształt pliku jest prostszy do czytania przez `bi status`/WP8.
- `AuthError.exit === 2` i `code 'E_AUTH'`: DESIGN §3.5 nie nazywa kodu dla porażki logowania; skryba rzucała gołym
  `Error` (proces padał). Tu nazwany kod, żeby keeper mógł go odróżnić od porażki kroku (wynik, exit 0).

## Stan drzewa przy oddaniu (nie pliki WP7)

- `src/steps.run.mjs` był w trakcie edycji przez WP6 (`sessionOnly is not defined` o 02:06) — przez kilka minut
  żaden test importujący silnik nie startował; testy WP7 zielone po ustabilizowaniu pliku (unit 25/25, smoke 2/2
  dwa razy z rzędu, ≈ 3,3 s).
- `tsc --noEmit` na całym repo: 16 błędów poza plikami WP7 (`src/steps.run.mjs` 14, `src/engine.mjs` 2 — sekcja
  sesyjna WP6 w trakcie pracy).
