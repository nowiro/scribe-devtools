---
applyTo: '**/*.md'
---

# Dokumentacja (README, AGENTS, docs/, templates/, CHANGELOG)

- Proza po polsku; identyfikatory, ścieżki, komendy i nazwy zmiennych po angielsku, w backtickach.
  Pełna nazwa **browser-inspector** — skrót `bi` jest zakazany także w prozie.
- Żadnej liczby o czasie ani tokenach wpisanej ręcznie: liczby pochodzą z `npm run bench`
  (`bench/RAPORT.md`, `bench/BUDGET.md`, blok `BENCH:START/END` w README). Jeśli zmieniasz pomiar,
  uruchom bench — nie przepisuj liczb.
- Generowane i nie do ręcznej edycji: `CODE-INDEX.md`, `docs/STEPS.md`, `bench/RAPORT.md`,
  `bench/WYNIKI.md`, `bench/BUDGET.md`, blok BENCH w README, `download/*.zip` — patrz tabela
  w AGENTS.md. `docs/handoff/*.md` to notatki historyczne pakietów roboczych (nie aktualizuj wstecz).
- `docs/DESIGN.md` jest kontraktem: próbki stdout §4.4 i `report.md` §5.1 reprodukują testy co do
  znaku — zmiana próbki wymaga zmiany testu i kodu, nie tylko dokumentu.
- Blok instrukcji w AGENTS.md (między `INSTRUCTION:START/END`) jest MIERZONY jako koszt stały i
  cytowany co do bajtu w benchu i w `.github/copilot-instructions.md`; zmieniasz w jednym miejscu →
  zmieniasz we wszystkich (`node scripts/check-instruction-sync.mjs`).
- `CHANGELOG.md`: wpis do `Unreleased` razem ze zmianą, z odwołaniem do `AC-n`/`WPn`; sekcja
  `Changed — BREAKING` dla zmian nazw, flag, kształtu raportu.
- README i AGENTS są poza prettierem (ręcznie zawijane tabele); pozostałe pliki `.md` formatuje
  prettier (120 kolumn) — `npm run verify` sprawdza.
