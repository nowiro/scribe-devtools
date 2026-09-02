# WYNIKI.md — pomiar tokenów (o200k) co do pozycji

Tokenizer: `o200k_base` (proxy — obie strony mierzy ta sama miarka). Zadanie identyczne dla każdego wariantu (`bench/task.mjs`).
Podsumowanie i czas: [RAPORT.md](RAPORT.md).

| wariant | stały | zmienny | razem |
| --- | ---: | ---: | ---: |
| bi batch | 146 | 254 | **400** |
| bi batch (pnpm bi) | 146 | 256 | **402** |
| bi-interactive-naive | 146 | 599 | **745** |
| bi-interactive-lean | 146 | 412 | **558** |
| mcp-naive | 4069 | 2745 | **6814** |
| mcp-lean | 4069 | 1430 | **5499** |

## bi batch

`{"dir":"D:\\github\\scribe-devtools\\bench\\out\\bi\\batch\\runs\\2000-01-06_00-00\\zgloszenie-serwisowe","problems":[]}`

| pozycja | bajty | tokeny |
| --- | ---: | ---: |
| instrukcja w AGENTS.md (blok INSTRUCTION) | 437 | 146 |
| komenda agenta (bi read.config.json) | 19 | 4 |
| stdout przebiegu | 65 | 27 |
| report.md w całości | 692 | 223 |
| **razem** | **1213** | **400** |

## bi batch (pnpm bi)

| pozycja | bajty | tokeny |
| --- | ---: | ---: |
| instrukcja w AGENTS.md (blok INSTRUCTION) | 437 | 146 |
| komenda agenta (pnpm bi read.config.json) | 24 | 6 |
| stdout przebiegu | 65 | 27 |
| report.md w całości | 692 | 223 |
| **razem** | **1218** | **402** |

## bi-interactive-naive

`{"commands":17,"problems":[]}`

| pozycja | bajty | tokeny |
| --- | ---: | ---: |
| instrukcja w AGENTS.md (blok INSTRUCTION) | 437 | 146 |
| → bi open http://localhost:4300/ | 30 | 9 |
| ← open stdout | 106 | 33 |
| → bi snap | 7 | 2 |
| ← snap stdout | 708 | 223 |
| → bi click e28 | 12 | 4 |
| ← click stdout | 22 | 7 |
| → bi snap --diff | 14 | 4 |
| ← snap stdout | 66 | 16 |
| → bi get [data-testid=error-email] | 32 | 9 |
| ← get stdout | 28 | 8 |
| → bi shot walidacja | 17 | 5 |
| ← shot stdout | 86 | 25 |
| → bi form "e10=Jan Kowalski" e12=jan.kowalski@example.com "e24=Formularz nie zapisuje zgloszenia po kliknieciu Wyslij." | 117 | 43 |
| ← form stdout | 26 | 8 |
| → bi select e14 zmiana | 20 | 6 |
| ← select stdout | 22 | 7 |
| → bi click e22 | 12 | 4 |
| ← click stdout | 22 | 7 |
| → bi click e26 | 12 | 4 |
| ← click stdout | 22 | 7 |
| → bi click e28 | 12 | 4 |
| ← click stdout | 22 | 7 |
| → bi wait --sel [data-testid=confirmation] | 40 | 10 |
| ← wait stdout | 34 | 8 |
| → bi get [data-testid=ticket-id] | 30 | 9 |
| ← get stdout | 8 | 5 |
| → bi get [data-testid=ticket-category] | 36 | 9 |
| ← get stdout | 6 | 2 |
| → bi get [data-testid=ticket-priority] | 36 | 10 |
| ← get stdout | 9 | 4 |
| → bi console --errors | 19 | 4 |
| ← console stdout | 212 | 64 |
| → bi shot potwierdzenie | 21 | 6 |
| ← shot stdout | 90 | 26 |
| **razem** | **2393** | **745** |

## bi-interactive-lean

`{"commands":17,"problems":[]}`

| pozycja | bajty | tokeny |
| --- | ---: | ---: |
| instrukcja w AGENTS.md (blok INSTRUCTION) | 437 | 146 |
| → bi open http://localhost:4300/ | 30 | 9 |
| ← open stdout | 105 | 33 |
| → bi find Wyślij | 15 | 5 |
| ← find stdout | 53 | 17 |
| → bi click e28 | 12 | 4 |
| ← click stdout | 22 | 7 |
| → bi snap --diff | 14 | 4 |
| ← snap stdout | 65 | 16 |
| → bi get [data-testid=error-email] | 32 | 9 |
| ← get stdout | 28 | 8 |
| → bi shot walidacja | 17 | 5 |
| ← shot stdout | 85 | 25 |
| → bi form "#name=Jan Kowalski" #email=jan.kowalski@example.com "#description=Formularz nie zapisuje zgloszenia po kliknieciu Wyslij." | 131 | 41 |
| ← form stdout | 26 | 8 |
| → bi select #category zmiana | 26 | 6 |
| ← select stdout | 28 | 7 |
| → bi click [data-testid=priority-krytyczny] | 41 | 12 |
| ← click stdout | 51 | 15 |
| → bi click #consent | 17 | 5 |
| ← click stdout | 27 | 8 |
| → bi click e28 | 12 | 4 |
| ← click stdout | 22 | 7 |
| → bi wait --sel [data-testid=confirmation] | 40 | 10 |
| ← wait stdout | 34 | 8 |
| → bi get [data-testid=ticket-id] | 30 | 9 |
| ← get stdout | 8 | 5 |
| → bi get [data-testid=ticket-category] | 36 | 9 |
| ← get stdout | 6 | 2 |
| → bi get [data-testid=ticket-priority] | 36 | 10 |
| ← get stdout | 9 | 4 |
| → bi console --errors | 19 | 4 |
| ← console stdout | 212 | 64 |
| → bi shot potwierdzenie | 21 | 6 |
| ← shot stdout | 89 | 26 |
| **razem** | **1836** | **558** |

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

