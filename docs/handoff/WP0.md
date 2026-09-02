# Handoff WP0 → kolejne pakiety

Notatki ze szkieletu dla WP1–WP10. Nic tu nie jest prośbą o zmianę cudzego pliku — to fakty
o fundamencie, które trzeba znać, zanim zacznie się pisać kod.

## Ustalenia (co jest i jak działa)

- **`npm install` nie uruchamia `prepare`** (`.npmrc`: `ignore-scripts=true`) — hook pre-commit
  uzbraja jawne `npm run prepare`. Zapisane w AGENTS.md i README.
- **`node_modules/.bin/bi` nie istnieje** po `npm install`, bo `packages/browser-inspector/bin/bi.mjs`
  jeszcze nie ma (WP5). npm nie protestuje. Po dodaniu pliku WP5 powinien raz przebiec `npm install`,
  żeby dostać shim `.bin/bi`; `npm run bi -- …` (skrypt w korzeniu) działa bez shimu.
- **vitest** (`vitest.config.mts`): projekty `unit` (`packages/**/test/**/*.test.mjs` bez `smoke/`,
  `compat/`, `perf/`), `scripts` (`scripts/**/*.test.mjs`), `bench` (`bench/**/*.test.mjs`),
  `smoke` (`packages/**/test/smoke/**/*.test.mjs`), `compat` (`packages/**/test/compat/**/*.test.mjs`),
  `perf` tylko przy `BI_PERF=1` (`packages/**/test/perf/**/*.perf.test.mjs`). `passWithNoTests: true`,
  bo pusty projekt to etap planu. `npm run smoke` = `vitest run --project smoke`.
  **`BI_SKIP_SMOKE=1` musi obsłużyć sam test smoke** (WP2: `describe.skipIf(process.env.BI_SKIP_SMOKE)`),
  skrypt npm go nie interpretuje.
- **tsc** (`tsconfig.json`): `allowJs` + `checkJs` + `noEmit`, `NodeNext`, `strict: true`, ale
  **`noImplicitAny: false`** — parametr bez JSDoc jest `any` bez błędu, każdy zadeklarowany typ jest
  sprawdzany ściśle. Sprawdzone: `n.toUpperCase()` na `@param {number}` pada (TS 7.0.2 działa z
  `checkJs`). `lib` ma `DOM` (callbacki `page.evaluate`). Wykluczone: `**/fixtures/**`, `bench/app`,
  `bench/probes`, `bench/out`. `packages/**/*.d.ts` jest w `include` — `src/types.d.ts` (WP1) będzie
  sprawdzany.
- **CODE-INDEX** (`scripts/index-code.mjs`): indeksuje `.mjs` pod `packages/*/src`, `packages/*/bin`,
  `scripts`, `bench` (bez `test/`, `fixtures/`, `probes/`, `app/`, `out/`, `templates/`, plików
  `*.test.mjs`/`*.spec.mjs`). Widzi importy statyczne i **dynamiczne** `import('./x.mjs')`.
  Regex, nie parser: **komentarz w źródle nie może zawierać dosłownego `from './cos.mjs'`**, bo
  trafi do mapy jako import.
- **docs/STEPS.md** (`scripts/gen-steps-doc.mjs`): szkielet renderuje tabelę z `STEPS`
  (`kind`, `argv`, `flags`, `config`, `help`). Gdy `src/steps.schema.mjs` nie istnieje, oba tryby
  kończą się 0 z komunikatem. Po WP1 hook i `npm run docs` zaczną pisać plik; WP8 może zmienić
  rendering — plik jest generowany, więc zmiana renderera = regeneracja.
- **check-instruction-sync**: blok w AGENTS.md między `<!-- INSTRUCTION:START -->` i
  `<!-- INSTRUCTION:END -->` (146 tokenów o200k, limit 150). Gdy `bench/bi-run.mjs` powstanie
  (WP9), musi eksportować `INSTRUCTION` **identyczne** z blokiem (bez `> `, linie łączone `\n`;
  blok jest jednoliniowy). Import `bench/bi-run.mjs` jest dynamiczny — moduł nie może mieć
  efektów ubocznych przy imporcie (guard `process.argv[1] === fileURLToPath(import.meta.url)`).
- **portable** (`scripts/portable-zip.mjs`): `stagePortable(root, staging)` (eksport, do testu WP8)
  kopiuje `packages/browser-inspector/{package.json,README.md,bin,src,templates,fixtures}`
  (bez `test/`), `node_modules/playwright-core`, pisze `packages/browser-inspector/PORTABLE`
  (marker dla `identityHash` w `paths.mjs` — WP1: pomijaj `srcStamp`, gdy plik istnieje),
  `bi.cmd`, `bi`, `README-PORTABLE.md`. `--stage <dir>` = tylko kopia, bez zipa; zip przez
  `Compress-Archive` (Windows) / `zip` (POSIX). Nazwa: `scribe-devtools-portable-<wersja>.zip`
  (ignorowana przez `*-portable-*.zip` w `.gitignore`).
- **Prettier**: `docs/DESIGN.md`, `docs/PLAN.md`, `docs/ACCEPTANCE.md`, `docs/handoff/`, README,
  AGENTS, generowane pliki i `**/fixtures/**` są w `.prettierignore`. Cała reszta (w tym
  `*.test.mjs`, `bench/*.mjs`, `tsconfig.json`) przechodzi przez `prettier --check`.
- **Wersje**: `typescript ^7.0.2` (jak scribe), `vitest ^4.1.11`, `prettier ^3.9.6`,
  `@types/node ^22`, `gpt-tokenizer ^4` w korzeniu (dla testów tokenowych WP3/WP4 — import:
  `gpt-tokenizer/encoding/o200k_base`). `playwright-core` exact `1.62.1` w pakiecie i w `bench`,
  `@playwright/mcp` exact `0.0.80` w `bench` — jeden hoistowany egzemplarz każdego w
  `node_modules/`.

## Prośby do innych pakietów

- **WP5**: po utworzeniu `bin/bi.mjs` przebiec `npm install` (shim `.bin/bi`); plik bez BOM,
  z shebangiem `#!/usr/bin/env node`.
- **WP9**: `bench/bi-run.mjs` eksportuje `INSTRUCTION` równe blokowi z AGENTS.md; skrypt
  `bench` w `bench/package.json` to `node bench.mjs` (zmień, jeśli wejście nazywa się inaczej —
  to plik WP0, ale `bench/package.json` może być edytowany przez WP9 bez pytania).
- **WP2** (smoke): honoruj `BI_SKIP_SMOKE=1` w teście, nie w skrypcie npm.

## Odstępstwa od DESIGN/PLAN

- PLAN.md mówi o `scripts/index-code.spec.mjs`; zgodnie z `vitest.config.mts` test nazywa się
  `scripts/index-code.test.mjs` (projekt `scripts`, wzorzec `*.test.mjs` jak w pakietach).
- PLAN.md: „sondy rewizyjne trafiają do `bench/probes/` w WP0" — katalog ma tylko README
  z listą sond, których dotyczy; skrypty nie są odtwarzane z pamięci (sonda bez zmierzonego
  wyniku nie jest dowodem). Do uzupełnienia przy WP9/WP10 z oryginałów.
