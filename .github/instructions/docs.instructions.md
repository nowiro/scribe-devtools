---
applyTo: '**/*.md'
---

# Dokumentacja (README, AGENTS, docs/, templates/, CHANGELOG)

- Proza po polsku; identyfikatory, ścieżki, komendy i nazwy zmiennych po angielsku, w backtickach.
  Pełne nazwy narzędzi — **browser-inspector**, **nx-angular-inspector** — skróty w prozie są zakazane.
- Żadnej liczby o czasie ani tokenach wpisanej ręcznie: liczby pochodzą z `npm run bench`
  (`bench/RAPORT.md`, `bench/BUDGET.md`, blok `BENCH:START/END` w README). Jeśli zmieniasz pomiar,
  uruchom bench — nie przepisuj liczb.
- Generowane i nie do ręcznej edycji: `CODE-INDEX.md`, `docs/STEPS.md`, `bench/RAPORT.md`,
  `bench/WYNIKI.md`, `bench/BUDGET.md`, blok BENCH w README, `download/*.zip` — patrz tabela
  w AGENTS.md. `docs/handoff/*.md` to notatki historyczne pakietów roboczych (nie aktualizuj wstecz).
- `docs/DESIGN.md` jest kontraktem: próbki stdout §4.4 i `report.md` §5.1 reprodukują testy co do
  znaku — zmiana próbki wymaga zmiany testu i kodu, nie tylko dokumentu.
- Bloki `INSTRUCTION…START/END` w AGENTS.md ≡ `INSTRUCTION` w benchu ≡ kopie w `.github/copilot-instructions.md`
  — MIERZONY koszt stały (`node scripts/check-instruction-sync.mjs --require-all`).
- `CHANGELOG.md`: wpis do `Unreleased` razem ze zmianą, z odwołaniem do `AC-n`/`WPn`; sekcja
  `Changed — BREAKING` dla zmian nazw, flag, kształtu raportu.
- README i AGENTS są poza prettierem (ręcznie zawijane tabele); pozostałe pliki `.md` formatuje
  prettier (120 kolumn) — `npm run verify` sprawdza.
