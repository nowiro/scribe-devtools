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
- Pliki `.md` formatuje **prettier**, nie Biome: Biome nie ma formatera Markdownu (schemat 2.x zna
  css, graphql, grit, html, javascript, json). Bramka to `prettier --check "**/*.md"`, naprawa to
  `pnpm run format`. `proseWrap: 'preserve'` znaczy, że zawijania prettier NIE ruszy — 120 kolumn
  i jedno zdanie na linię nadal trzymasz ręcznie; prettier pilnuje tabel, list i nagłówków.
- Poza formaterem (`.prettierignore`): `README.md` i `AGENTS.md` — tabele zawężone ręcznie, prettier
  rozepchałby każdy wiersz do jednej długiej linii — oraz generowany `CODE-INDEX.md`. Tam szerokość
  jest w całości Twoja.
