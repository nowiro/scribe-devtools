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
- Plików `.md` **nie formatuje żadna bramka**: repozytorium formatuje Biome, a ten nie ma
  formatera Markdownu (schemat 2.x zna css, graphql, grit, html, javascript, json). README.md
  i AGENTS.md były ręcznie zawijane i poza formaterem także wcześniej; reszta prozy jest teraz
  na review — 120 kolumn i jedno zdanie na linię trzymaj ręcznie.
