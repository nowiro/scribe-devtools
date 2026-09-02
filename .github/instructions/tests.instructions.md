---
applyTo: 'packages/**/test/**/*.mjs,scripts/**/*.test.mjs,bench/**/*.test.mjs'
---

# Testy (vitest: projekty `unit`, `scripts`, `bench`, `smoke`, `compat`)

- Test leży obok tego, co sprawdza; nazwa mówi, jaką regułę pilnuje (w stylu zdania), nie jaką
  funkcję woła. Przypadek negatywny to pierwszorzędny test: sekret nigdy w stdout/dzienniku/raporcie,
  literówka w configu pada z nazwą pola, martwy ref nie czeka na deadline.
- Bez przeglądarki: silnik za interfejsem `PageLike` → `FakePage` (rejestruje wywołania, wstrzykuje
  błędy). Keeper testuje się na prawdziwym pipe/gnieździe z fake'iem silnika przez
  `test/fixtures/keeper-harness.mjs` (`makeEnv()` daje unikalny `BROWSER_INSPECTOR_SOCKET` i `_TMPDIR`
  — dwa równoległe biegi nie mogą dzielić keepera).
- Z przeglądarką tylko projekty `smoke` i `compat`: kanał `chrome` z fallbackiem `msedge`, headless,
  fixture'y serwowane z `node:http` z tabelą MIME (`.js → text/javascript`, inaczej Angular nie
  wystartuje), własny zakres portów obszaru (AGENTS.md), sprzątanie keepera w `afterAll`.
- Żadnych progów w bezwzględnych milisekundach zależnych od obciążenia maszyny: mierz „bez czekania
  na deadline" względnie do `BROWSER_INSPECTOR_STEP_TIMEOUT_MS` albo przez brak wywołania, nie zegarem.
- Tokeny licz `gpt-tokenizer` (o200k) tam, gdzie DESIGN.md daje limit (linia ≤ 40, `report.md` ≤ 200,
  blok instrukcji ≤ limit z `scripts/check-instruction-sync.mjs`).
- Uruchamiaj celowo: `npx vitest run <plik>` w trakcie, `npm run verify` przed oddaniem.
