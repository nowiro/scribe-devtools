# WYNIKI.md — pomiar tokenów (o200k) co do pozycji

Tokenizer: `o200k_base` (proxy — obie strony mierzy ta sama miarka). Zadanie identyczne dla każdego wariantu (`bench/task.mjs`).
Podsumowanie i czas: [RAPORT.md](RAPORT.md).

| wariant | stały | zmienny | razem |
| --- | ---: | ---: | ---: |
| browser-inspector batch | 158 | 256 | **414** |
| browser-inspector batch (pnpm browser-inspector) | 158 | 258 | **416** |
| browser-inspector-interactive-naive | 158 | 641 | **799** |
| browser-inspector-interactive-lean | 158 | 454 | **612** |
| mcp-naive | 4069 | 2745 | **6814** |
| mcp-lean | 4069 | 1430 | **5499** |

## browser-inspector batch

`{"dir":"D:\\github\\scribe-devtools\\bench\\out\\browser-inspector\\batch\\runs\\2000-01-06_00-00\\zgloszenie-serwisowe","problems":[]}`

| pozycja | bajty | tokeny |
| --- | ---: | ---: |
| instrukcja w AGENTS.md (blok INSTRUCTION) | 527 | 158 |
| komenda agenta (browser-inspector read.config.json) | 34 | 6 |
| stdout przebiegu | 65 | 27 |
| report.md w całości | 692 | 223 |
| **razem** | **1318** | **414** |

## browser-inspector batch (pnpm browser-inspector)

| pozycja | bajty | tokeny |
| --- | ---: | ---: |
| instrukcja w AGENTS.md (blok INSTRUCTION) | 527 | 158 |
| komenda agenta (pnpm browser-inspector read.config.json) | 39 | 8 |
| stdout przebiegu | 65 | 27 |
| report.md w całości | 692 | 223 |
| **razem** | **1323** | **416** |

## browser-inspector-interactive-naive

`{"commands":17,"problems":[]}`

| pozycja | bajty | tokeny |
| --- | ---: | ---: |
| instrukcja w AGENTS.md (blok INSTRUCTION) | 527 | 158 |
| → browser-inspector open http://localhost:4300/ | 45 | 11 |
| ← open stdout | 115 | 35 |
| → browser-inspector snap | 22 | 4 |
| ← snap stdout | 708 | 223 |
| → browser-inspector click e28 | 27 | 6 |
| ← click stdout | 22 | 7 |
| → browser-inspector snap --diff | 29 | 6 |
| ← snap stdout | 75 | 18 |
| → browser-inspector get [data-testid=error-email] | 47 | 11 |
| ← get stdout | 28 | 8 |
| → browser-inspector shot walidacja | 32 | 7 |
| ← shot stdout | 95 | 27 |
| → browser-inspector form "e10=Jan Kowalski" e12=jan.kowalski@example.com "e24=Formularz nie zapisuje zgloszenia po kliknieciu Wyslij." | 132 | 45 |
| ← form stdout | 26 | 8 |
| → browser-inspector select e14 zmiana | 35 | 8 |
| ← select stdout | 22 | 7 |
| → browser-inspector click e22 | 27 | 6 |
| ← click stdout | 22 | 7 |
| → browser-inspector click e26 | 27 | 6 |
| ← click stdout | 22 | 7 |
| → browser-inspector click e28 | 27 | 6 |
| ← click stdout | 22 | 7 |
| → browser-inspector wait --sel [data-testid=confirmation] | 55 | 12 |
| ← wait stdout | 34 | 8 |
| → browser-inspector get [data-testid=ticket-id] | 45 | 11 |
| ← get stdout | 8 | 5 |
| → browser-inspector get [data-testid=ticket-category] | 51 | 11 |
| ← get stdout | 6 | 2 |
| → browser-inspector get [data-testid=ticket-priority] | 51 | 12 |
| ← get stdout | 9 | 4 |
| → browser-inspector console --errors | 34 | 6 |
| ← console stdout | 212 | 64 |
| → browser-inspector shot potwierdzenie | 36 | 8 |
| ← shot stdout | 99 | 28 |
| **razem** | **2774** | **799** |

## browser-inspector-interactive-lean

`{"commands":17,"problems":[]}`

| pozycja | bajty | tokeny |
| --- | ---: | ---: |
| instrukcja w AGENTS.md (blok INSTRUCTION) | 527 | 158 |
| → browser-inspector open http://localhost:4300/ | 45 | 11 |
| ← open stdout | 114 | 35 |
| → browser-inspector find Wyślij | 30 | 7 |
| ← find stdout | 53 | 17 |
| → browser-inspector click e28 | 27 | 6 |
| ← click stdout | 22 | 7 |
| → browser-inspector snap --diff | 29 | 6 |
| ← snap stdout | 74 | 18 |
| → browser-inspector get [data-testid=error-email] | 47 | 11 |
| ← get stdout | 28 | 8 |
| → browser-inspector shot walidacja | 32 | 7 |
| ← shot stdout | 94 | 27 |
| → browser-inspector form "#name=Jan Kowalski" #email=jan.kowalski@example.com "#description=Formularz nie zapisuje zgloszenia po kliknieciu Wyslij." | 146 | 43 |
| ← form stdout | 26 | 8 |
| → browser-inspector select #category zmiana | 41 | 8 |
| ← select stdout | 28 | 7 |
| → browser-inspector click [data-testid=priority-krytyczny] | 56 | 14 |
| ← click stdout | 51 | 15 |
| → browser-inspector click #consent | 32 | 7 |
| ← click stdout | 27 | 8 |
| → browser-inspector click e28 | 27 | 6 |
| ← click stdout | 22 | 7 |
| → browser-inspector wait --sel [data-testid=confirmation] | 55 | 12 |
| ← wait stdout | 34 | 8 |
| → browser-inspector get [data-testid=ticket-id] | 45 | 11 |
| ← get stdout | 8 | 5 |
| → browser-inspector get [data-testid=ticket-category] | 51 | 11 |
| ← get stdout | 6 | 2 |
| → browser-inspector get [data-testid=ticket-priority] | 51 | 12 |
| ← get stdout | 9 | 4 |
| → browser-inspector console --errors | 34 | 6 |
| ← console stdout | 212 | 64 |
| → browser-inspector shot potwierdzenie | 36 | 8 |
| ← shot stdout | 98 | 28 |
| **razem** | **2217** | **612** |

## mcp-naive

`{"toolCount":24,"callCount":15,"problems":[]}`

| pozycja | bajty | tokeny |
| --- | ---: | ---: |
| tools/list — definicje narzędzi | 18 512 | 4026 |
| initialize — dane serwera | 131 | 43 |
| → browser_navigate (argumenty) | 72 | 19 |
| ← browser_navigate (odpowiedź) | 225 | 79 |
| → browser_snapshot (argumenty) | 42 | 10 |
| ← browser_snapshot (odpowiedź) | 1495 | 492 |
| → browser_click (argumenty) | 92 | 26 |
| ← browser_click (odpowiedź) | 338 | 124 |
| → browser_snapshot (argumenty) | 42 | 10 |
| ← browser_snapshot (odpowiedź) | 1766 | 579 |
| → browser_take_screenshot (argumenty) | 141 | 38 |
| ← browser_take_screenshot (odpowiedź) | 265 | 84 |
| → browser_type (argumenty) | 107 | 29 |
| ← browser_type (odpowiedź) | 92 | 27 |
| → browser_type (argumenty) | 110 | 29 |
| ← browser_type (odpowiedź) | 105 | 30 |
| → browser_select_option (argumenty) | 120 | 30 |
| ← browser_select_option (odpowiedź) | 290 | 99 |
| → browser_click (argumenty) | 81 | 20 |
| ← browser_click (odpowiedź) | 268 | 94 |
| → browser_type (argumenty) | 139 | 40 |
| ← browser_type (odpowiedź) | 142 | 40 |
| → browser_click (argumenty) | 80 | 19 |
| ← browser_click (odpowiedź) | 263 | 92 |
| → browser_click (argumenty) | 92 | 26 |
| ← browser_click (odpowiedź) | 341 | 126 |
| → browser_snapshot (argumenty) | 42 | 10 |
| ← browser_snapshot (odpowiedź) | 926 | 315 |
| → browser_take_screenshot (argumenty) | 145 | 39 |
| ← browser_take_screenshot (odpowiedź) | 277 | 87 |
| → browser_console_messages (argumenty) | 67 | 14 |
| ← browser_console_messages (odpowiedź) | 355 | 118 |
| **razem** | **27 163** | **6814** |

## mcp-lean

`{"toolCount":24,"callCount":11,"problems":[]}`

| pozycja | bajty | tokeny |
| --- | ---: | ---: |
| tools/list — definicje narzędzi | 18 512 | 4026 |
| initialize — dane serwera | 131 | 43 |
| → browser_navigate (argumenty) | 72 | 19 |
| ← browser_navigate (odpowiedź) | 225 | 79 |
| → browser_click (argumenty) | 98 | 26 |
| ← browser_click (odpowiedź) | 348 | 125 |
| → browser_find (argumenty) | 74 | 18 |
| ← browser_find (odpowiedź) | 367 | 114 |
| → browser_take_screenshot (argumenty) | 140 | 37 |
| ← browser_take_screenshot (odpowiedź) | 262 | 81 |
| → browser_fill_form (argumenty) | 706 | 195 |
| ← browser_fill_form (odpowiedź) | 512 | 131 |
| → browser_click (argumenty) | 98 | 26 |
| ← browser_click (odpowiedź) | 351 | 127 |
| → browser_evaluate (argumenty) | 124 | 28 |
| ← browser_evaluate (odpowiedź) | 147 | 39 |
| → browser_evaluate (argumenty) | 130 | 28 |
| ← browser_evaluate (odpowiedź) | 151 | 36 |
| → browser_evaluate (argumenty) | 130 | 29 |
| ← browser_evaluate (odpowiedź) | 154 | 38 |
| → browser_take_screenshot (argumenty) | 144 | 38 |
| ← browser_take_screenshot (odpowiedź) | 274 | 84 |
| → browser_console_messages (argumenty) | 67 | 14 |
| ← browser_console_messages (odpowiedź) | 355 | 118 |
| **razem** | **23 572** | **5499** |

