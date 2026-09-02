# Handoff WP8 → WP9, WP10 — zgodność, docs, pakowanie, app-factory

WP8 dostarczył bramkę zgodności `test/compat/smoke-gate.test.mjs`, test portable
`scripts/portable-zip.test.mjs`, `templates/flow.md`, README/AGENTS/CHANGELOG w wersji
„po wszystkich pakietach” oraz integrację z app-factory (drzewo robocze, **bez commitu**).
Wznowienie po przerwanym pierwszym podejściu: drzewo zastane było zielone (unit 22 plików /
338 testów, tsc 0, prettier ok) — nic z cudzych plików nie wymagało naprawy; poniżej stan
po WP8.

**`npm run verify` — zielone end-to-end (2026-09-02, 1 min 39 s):** prettier ok, vitest 27 plików /
395 testów (unit, scripts z portable, bench WP9, smoke 16, compat 6), `tsc --noEmit` 0 błędów,
`CODE-INDEX.md` i `docs/STEPS.md` świeże, `AGENTS.md` blok ≡ `INSTRUCTION` w `bench/bi-run.mjs`
(146 tokenów o200k — WP9 zdążył dołożyć plik, więc sprawdzenie nie jest już trywialne), smoke
16/16 ponownie. Jeden przebieg wcześniej `tsc` padł na `bench/bench.mjs` w trakcie edycji przez WP9
(niedomknięty string, 13 s przed sprawdzeniem) — po 20 s zielony; nie mój plik.

## Bramka app-factory — wyniki (Chrome 152 headless, 2026-09-02, buildy z `D:/github/app-factory/dist`)

`pnpm smoke:browser` w app-factory (po `findRunner`), wszystkie 6 snapshotów `completed`:

| przebieg | `_manifest.json.timing` | `clientMs` (keeper/silnik) | proces `pnpm` |
| --- | --- | --- | --- |
| `CI=true` (bez keepera) | `mode: no-daemon`, `launchMs 264` | 14 751 ms | ≈ 21,6 s (w tym `pnpm prepare`/husky) |
| lokalnie, keeper #1 | `mode: first`, `keeperStartMs 50`, `launchMs 197` | 13 813 ms | ≈ 17,1 s |
| lokalnie, keeper #2 | `mode: warm` | 11 880 ms | ≈ 13,2 s |

Per snapshot (keeper #2, warm): nowiro-strona 1 773 ms, nowiro-jezyk 1 984, wizard-formularz
3 120, bookstore-zakupy 4 119, dziennik-nauczyciel 483, dziennik-uczen 378; `scrubMs` 7–18 ms,
`tab: kept`, `ctx: reused` dla wszystkich. Config **bez migracji** (4× `networkidle`, 4 200 ms snu) —
DESIGN §3.4 szacował 8–10 s; tu ≈ 12–15 s, bo pierwsze wejście na każdy z 4 originów na tej samej
karcie kosztuje 0,75–1,0 s (site isolation; WP2 zmierzył to samo), nie 75–320 ms.

`test/compat/smoke-gate.test.mjs` (porty 4571–4574, własny pipe z `keeper-harness.makeEnv()` bez
`BI_ENGINE_MODULE`): `--no-daemon` 14,7 s, keeper #1 (`first`) 14,4 s, keeper #2 (`warm`) 12,6 s,
`--parallel 3` (`warm`) **7,2 s** — trzy lane'y `0/1/2`, ten sam zbiór `completed`; drugi przebieg
przez keeper: `dziennik-uczen.completed === true`, `naglowek-pl` = „Doradztwo IT, które działa.”.
Cały plik ≈ 59 s.

## Co zmieniłem poza własnymi plikami

- **Nic w `packages/browser-inspector/src`, `bin`, `keeper`** — bramka przeszła na kodzie WP2–WP7
  bez poprawek. Zmiany tylko w plikach WP8 + `CODE-INDEX.md` (regeneracja; WP9 dołożył `bench/*.mjs`).
- **app-factory** (drzewo robocze, do osobnego PR — patrz procedura wydania w AGENTS.md):
  `tools/scripts/smoke-browser.mjs` (`findRunner(env, exists, root)` → `{ dir, pipeline, fixCommand }`;
  kandydaci `SCRIBE_DEVTOOLS_DIR` → `../scribe-devtools` → scribe przez **niezmienioną**
  `findScribeDir`; `main()` drukuje `fixCommand` zamiast stacktrace'u; `spawn(node, [pipeline, CONFIG,
  ...forwarded])` literalnie jak było), `tools/scripts/smoke-browser.spec.mjs` (4 przypadki `findRunner`,
  stare testy nietknięte — 11/11), `package.json` (skrypt `"bi"`), `AGENTS.md` (akapit o `pnpm bi`
  w sekcji weryfikatorów bram). `prettier --check` app-factory na tych plikach zielony.

## Ustalenia i odstępstwa

- **`report.json` „identyczne modulo timing/engine”** (AC-2) w teście oznacza: bez `timing`, `engine`,
  `steps[].ms`, `console.entries[].at`, `network.failed[].{id,startedAt,ms}` **oraz** bez trzech rzeczy,
  które nie zależą od trybu, tylko od stanu przeglądarki/animacji: ostrzeżeń konsoli (sterownik GPU
  loguje `THREE.WebGLProgram … X4122` tylko przy pierwszej kompilacji shaderów na świeżym rendererze),
  błędu `favicon.ico` 404 (Chrome pobiera ikonę raz per origin i pamięta porażkę browser-wide —
  business-wizard nie ma favicon.ico), treści `text.txt` i wierszy `mat-option` w `elements`
  (dowód końcowy czyta stronę, gdy overlay Material selecta jeszcze gaśnie). Pozostałe pola — w tym
  `extracts`, `steps`, `console.error`, `network`, `screenshots`, reszta `elements` — są równe co do bajta.
- **`queuedMs` w batchu sekwencyjnym rośnie** z każdym snapshotem (k-ty czeka na k−1 w kolejce lane'u:
  0 → 1 777 → 3 765 → … → 11 498 ms w przebiegu warm). To semantyka „czekanie w kolejce lane'u”
  z DESIGN §6, ale dla **jednego** przebiegu z 6 snapshotami suma `queuedMs` nie jest kosztem
  keepera. **WP9 (`budget.mjs`)**: wiersz `queuedMs` per snapshot bierz z `_manifest.json`, ale do
  ilorazów i „scrub w kolejce” (`bi-warm-tight`) używaj `queuedMs` **pierwszego** snapshotu przebiegu
  (indeks 0) — tylko on mierzy czekanie na poprzednie wywołanie klienta.
- **Pierwszy snapshot każdego przebiegu przez keeper ma `scrubMs > 0`** (scrub poprzedniego przebiegu
  wykonuje się leniwie na początku następnego — WP2), więc `bi-warm` nie płaci scrubu w `queuedMs`,
  tylko w `scrubMs` snapshotu 0. Do BUDGET.md wchodzi jedno i drugie osobno (DESIGN §6).
- **Test portable robi zip naprawdę** (Compress-Archive + Expand-Archive ≈ 5 s) — AC-20 mówi o zipie,
  a archiwizacja jest tania; batch `--no-daemon` na `file://…/fixtures/form.html` z rozpakowanego
  drzewa bierze `playwright-core` z jego `node_modules` (`engine['playwright-core'] === '1.62.1'`).
  `BI_SKIP_SMOKE=1` pomija tylko tę część z przeglądarką.
- **Compat pomija się bez buildów app-factory** (`../app-factory/dist/apps/*/browser` albo
  `APP_FACTORY_DIR`) z ostrzeżeniem na stderr — na czystym klonie CI bez app-factory `npm run verify`
  jest zielony przez `passWithNoTests`, ale bramka zgodności wtedy **nie została sprawdzona**;
  procedura wydania (AGENTS.md) wymaga buildów obok.
- `bi lint-config` był już wpięty w kliencie (WP5: `lintConfig(...).lines` 1:1) — WP8 dodał tylko
  asercję AC-16 w compat i w teście portable.
- `scripts/gen-steps-doc.mjs` zostawiony w renderingu WP1 (7 kolumn + legenda + reguły) —
  `docs/STEPS.md` jest świeży; zmiana renderera nie była potrzebna.
- README nie zawiera żadnej liczby z pomiaru (AC-4): próbki stdout to próbki z DESIGN §4.4
  (reprodukowane testem `print.test.mjs`), a wartości ms w przykładzie batchu są ilustracją
  formatu linii, nie wynikiem benchu; liczby wchodzą wyłącznie do bloku `BENCH:START/END`.
- Bash Claude Code na Windows **zjada podwójne backslashe w heredocach** — `BI_SOCKET='\\.\pipe\x'`
  ustawiony z powłoki trafia do keepera jako `\.\pipe\x` i `listen` pada `EACCES`. Testy używają
  `keeper-harness.uniquePipe()`; w ręcznych próbach z powłoki ustaw pipe w Node (`String.raw`),
  nie w bashu.

## Prośby do innych pakietów

- **WP9**: `bench/bi-run.mjs` z `INSTRUCTION` już jest — `check-instruction-sync` przechodzi z
  równością (146 tokenów). Wariant `app-factory` benchu może użyć tego samego serwera statycznego
  co compat (`serveStatic` z `smoke-browser.mjs`, `.js → text/javascript`, fallback SPA) i portów
  spoza 4571–4579. Uwaga na `queuedMs` (wyżej). Zaobserwowane: bench uruchomiony z korzenia repo bez
  `BI_SOCKET` trafia w **domyślny** keeper dewelopera (ta sama tożsamość `5e31e3ba`, co keeper
  podniesiony przez `pnpm smoke:browser` w app-factory) — wariant `keeper-survives-shell` (3× `up`,
  `status`, `stop`) zatrzymał go w trakcie mojej pracy (log `%TEMP%/bi-5e31e3ba.log`, 00:45–00:46Z).
  Bench powinien dostać własny `BI_SOCKET`/`BI_TMPDIR`, jak testy, żeby nie gasić cudzej sesji.
- **WP10**: przed tagiem uruchom `pnpm smoke:browser` w app-factory z `CI=true` i lokalnie ×2 (tak jak
  wyżej), potem PR w app-factory z czterema plikami z drzewa roboczego (nie commitowałem).
- **WP2 (opcjonalnie)**: `timing.queuedMs` snapshotu k > 0 w batchu sekwencyjnym mógłby liczyć tylko
  czekanie na *inne* zadania keepera, nie na poprzedni snapshot tego samego przebiegu — wtedy
  BUDGET.md nie potrzebuje reguły „indeks 0”.
