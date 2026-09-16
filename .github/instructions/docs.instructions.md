---
applyTo: '**/*.md'
---

# Dokumentacja (README.md, AGENTS.md, .github/)

- Proza po polsku; identyfikatory, ścieżki, komendy i nazwy zmiennych po angielsku, w backtickach.
  Pełne nazwy narzędzi — **browser-inspector**, **nx-angular-inspector** — skróty w prozie są
  zakazane.
- Generowany i nie do ręcznej edycji: `CODE-INDEX.md` (`pnpm run code-index`, patrz tabela
  w AGENTS.md).
- Bloki `INSTRUCTION…START/END` w AGENTS.md ≡ ich kopie w `.github/copilot-instructions.md`
  (`node scripts/check-instruction-sync.mjs --require-all`).
- Plików `.md` **nie formatuje żadna bramka — z wyboru**: oxfmt umie Markdown, ale dopełnia każdą
  tabelę spacjami do najszerszej komórki (AGENTS.md +48 % bajtów) i wstawia puste linie w bloki
  `INSTRUCTION`, więc `**/*.md` stoi w `ignorePatterns` w `.oxfmtrc.jsonc`. 120 kolumn, jedno zdanie
  na linię i szerokość tabel trzymasz ręcznie, a EditorConfig pilnuje tylko LF, spacji i finalnej
  nowej linii.
- Rozmiary podawaj w **bajtach** (`kB` = 1000 bajtów), nigdy w tokenach: nic w tym repo nie liczy już
  tokenów, a liczba, której nie sprawdza bramka, zgnije. Rozmiary `CODE-INDEX.md` i `GLOSSARY.md`
  w AGENTS.md sprawdza `check-claims` (± 10 %) i muszą stać w tej samej linii co odnośnik.
