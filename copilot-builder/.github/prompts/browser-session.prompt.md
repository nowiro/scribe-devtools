---
description: 'Sesja przeglądarkowa browser-inspector: spójrz na stronę, potem kliknij — refy eN, jedna linia na komendę, wynik na dysku; eksport flow.json'
agent: orchestrator
---

# /browser-session — spójrz na stronę, potem kliknij

Masz do zbadania działającą aplikację pod adresem podanym przez operatora (domyślnie `http://localhost:4200/`
po `node node_modules/@angular/cli/bin/ng.js serve <app>`). Używasz sesji interaktywnej **browser-inspector**
— komend w powłoce, z których każda drukuje jedną linię. Wszystko większe niż linia (zrzuty, snapshoty,
konsola, sieć) leży w `.scribe-devtools/browser-inspector/session/<nazwa>/` i czytasz to wybiórczo.

Pętla pracy (każda komenda przez `npm run browser-inspector -- …`):

1. `open <url>` — tytuł, liczba elementów, błędy konsoli, ścieżka `snap.md`.
2. `find <tekst>` — refy `eN` elementów o pasującej nazwie; pełny snapshot: `snap` (`--max 40`, `--diff`, `--around eN`).
3. Akcje: `click eN`, `fill eN <tekst>` (`--enter`), `form "eA=x" "eB=y"`, `select eN <wartość>`, `press Enter`,
   `hover eN`, `wait --sel <selektor>` / `wait --text <tekst>`. Linia odpowiedzi niesie delty (`navigated`,
   `dom Δ`, `el a→b`, `+N console.error`); `exit 1` = FAIL (martwy ref → `snap` i nowy ref).
4. Dowody: `shot <nazwa>` (PNG), `get <selektor>`, `console --errors`, `net 5`, `eval "<wyrażenie>"`.
5. Koniec: `export flow.json` zapisuje sesję jako config batch (refy → trwałe selektory, `--env` → `valueFromEnv`); `close`.

Zasady: hasła i tokeny wyłącznie przez `--env NAZWA` albo `@{NAZWA}`; żadnego `eval` modyfikującego
aplikację bez zgody operatora; czytaj z dysku tylko to, czego potrzebujesz. Znany scenariusz przestaje być
klikaniem — trafia do `read.config.browser-inspector.json` (batch) albo do `apps/<app>-e2e` (`code-tester-e2e`).

Wyjście: krótki raport (co sprawdzono, co działa, co padło z linią FAIL i ścieżką dowodu) + `flow.json`,
gdy scenariusz wart jest powtarzania. Zrzuty do oceny wizualnej dostaje `code-reviewer-ui`.
