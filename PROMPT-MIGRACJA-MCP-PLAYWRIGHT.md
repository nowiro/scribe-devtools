# Migracja innego repozytorium z MCP Playwrighta na browser-inspector — prompt dla VS Code + GitHub Copilot

Prompt jest jeden i leży tu:
[`.github/prompts/migrate-from-mcp-playwright.prompt.md`](.github/prompts/migrate-from-mcp-playwright.prompt.md).
Ten plik mówi tylko, jak go użyć.

## Jak użyć

1. Otwórz w VS Code repozytorium aplikacji (Nx monorepo, `apps/*`), które dziś podpina
   `@playwright/mcp`. Upewnij się, że obok niego leży `../scribe-devtools` po `npm ci` (albo
   rozpakowany zip z [`download/`](download/)).
2. Skopiuj do tamtego repo dwa pliki z tego:
   `.github/prompts/migrate-from-mcp-playwright.prompt.md` i
   `.github/prompts/browser-session.prompt.md` (VS Code: `chat.promptFiles` włączone —
   [`.vscode/settings.json`](.vscode/settings.json) w tym repo pokazuje ustawienia).
3. W Copilot Chat w trybie **agent** wpisz `/migrate-from-mcp-playwright` (albo wklej treść pliku
   jako wiadomość). Prompt prowadzi przez pięć kroków: rozpoznanie → narzędzie obok repo →
   `read.config.browser-inspector.json` → bramka `smoke:browser` (build Nx, serwer statyczny,
   werdykt, CI) → instrukcje Copilota i usunięcie serwera MCP. Po kroku 0 agent zatrzymuje się
   i pokazuje tabelę aplikacji — potwierdź „dalej".
4. Do codziennego „spójrz, potem kliknij" służy `/browser-session` (drugi prompt).

## Co dostaje tamten zespół

- `pnpm smoke:browser` — powtarzalna bramka bez agenta i bez tokenów (lokalnie z ciepłym
  keeperem, w CI pod `CI=true` bez keepera), raporty w `.scribe-devtools/browser-inspector/<stempel>/`.
- Blok instrukcji w `.github/copilot-instructions.md` zamiast definicji 24 narzędzi w każdej
  sesji — koszt stały mierzony w [`bench/RAPORT.md`](bench/RAPORT.md).
- Pętlę interaktywną na refach `eN` (jedna linia na komendę) tam, gdzie dotąd był `browser_snapshot`.

Wzorzec działającej integracji: `app-factory/tools/scripts/smoke-browser.mjs` (4 aplikacje Angular,
6 flow, `findRunner` z fallbackiem).
