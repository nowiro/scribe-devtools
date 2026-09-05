---
applyTo: '**/*.md'
---

# Dokumentacja (README.md, AGENTS.md, .github/)

- Proza po polsku; identyfikatory, ścieżki, komendy i nazwy zmiennych po angielsku, w backtickach.
  Pełne nazwy narzędzi — **browser-inspector**, **nx-angular-inspector** — skróty w prozie są
  zakazane.
- Generowany i nie do ręcznej edycji: `CODE-INDEX.md` (`npm run code-index`, patrz tabela
  w AGENTS.md).
- Bloki `INSTRUCTION…START/END` w AGENTS.md ≡ ich kopie w `.github/copilot-instructions.md`
  (`node scripts/check-instruction-sync.mjs --require-all`).
- README.md i AGENTS.md są poza prettierem (ręcznie zawijane); pozostałe pliki `.md` formatuje
  prettier (120 kolumn) — `npm run verify` sprawdza.
