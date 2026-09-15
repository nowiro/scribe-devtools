---
name: sdd-scripts
description: Komendy, którymi prowadzi się drabinę SDD bez edytowania tabel ręcznie — scaffold artefaktów, routing plików, następne zadanie, brief z planu, status i SHA zadania, wiersz run-logu, losowanie miejsc review, scalanie review. Użyj zawsze, gdy masz dotknąć planu, run-logu, routingu albo raportów review.
---

# Skrypty SDD — tabel nie edytuje się ręcznie

Każda z tych czynności ma komendę o stałym wyjściu. Model, który edytuje tabelę Markdown ręcznie,
gubi kolumnę albo pipe; skrypt nie. Gdy komenda kończy się kodem 1 albo 2, czytasz jej komunikat
i robisz dokładnie to, co mówi (uzupełnij kolumnę, podaj ścieżkę, zapytaj człowieka) — nie obchodzisz
jej ręczną edycją.

| Chcesz                                   | Komenda                                                                                 | Co dostajesz                                                        |
| ---------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| trzy artefakty nowego zadania            | `npm run workflow:specify -- --verb=<verb> --slug=<slug> --title="<tytuł>"`             | ścieżki spec, planu, run-logu (lokalne, gitignorowane)              |
| kto dotyka plików                        | `npm run route -- <ścieżki>` / `npm run route -- --changed`                             | `<agent>  <pliki>` per linia; `—` = człowiek decyduje (exit 1)      |
| które zadanie teraz                      | `npm run sdd -- next <plan.md>`                                                         | `T002  code-angular  todo  <tytuł>`; exit 1 = nic nie zostało       |
| brief dla zadania                        | `npm run sdd -- brief <plan.md> <id>`                                                   | blok AGENT / ZADANIE / PLIKI / AC / BRAMA / BUDŻET / ZWRÓĆ / NIE    |
| status albo SHA zadania                  | `npm run sdd -- task <plan.md> <id> --status <todo\|in-progress\|done\|n/a> [--commit <sha>]` | zmieniony jeden wiersz planu                                  |
| wiersz run-logu                          | `npm run sdd -- log <run.md> --step <n> --agent <a> --tier <t> --result "<tekst>" [--status <s>]` | zmieniony albo dopisany wiersz tabeli „Kroki"                |
| które miejsca czytają review             | `npm run review:draw -- <katalog review>`                                              | `<agent>  <rodzina>` per linia; `draw.json` w katalogu (ponowne uruchomienie: to samo) |
| scalone review wylosowanych miejsc       | `npm run review:merge -- <katalog> --slug <slug> --out <plik>`                          | jedna tabela z liczbą zgodnych rodzin, konflikty, werdykt           |
| stempel do nazwy artefaktu               | `node -e "import('./tools/scripts/stamp.mjs').then(m=>console.log(m.nowStamp()))"`      | `YYYY-MM-DD_HH-MM`                                                  |
| czy plan i spec są poprawne              | `npm run sdd:check`                                                                     | `ok` albo lista C1–C5 z plikiem i powodem                           |

## Kolumny planu

`| id | title | agent | paths | done_when | status | AC | commit |`. `paths` to pliki zadania —
z nich `npm run sdd -- brief` bierze PLIKI, a `npm run sdd:check` (C5) sprawdza, że `agent` równa się
wynikowi `npm run route` dla tych ścieżek. Zadanie bez plików (intake, review, DoD) ma `—`.
`done_when` to komenda albo obserwowalny stan — trafia do briefu jako BRAMA.

## Kolejność w kroku implement

```bash
npm run sdd -- next docs/plans/<plan>.md                     # T002  code-angular  todo  …
npm run sdd -- task docs/plans/<plan>.md T002 --status in-progress
npm run sdd -- brief docs/plans/<plan>.md T002               # wysyłasz DOSŁOWNIE do agenta z linii AGENT
# … wykonawca zwraca PLIKI / BRAMA / UWAGI; code-verifier potwierdza BRAMA …
npm run sdd -- task docs/plans/<plan>.md T002 --status done
# … scm-git zwraca "<sha7> <komunikat>" …
npm run sdd -- task docs/plans/<plan>.md T002 --commit <sha7>
npm run sdd -- log docs/runs/<run>.md --step 5 --agent code-angular --tier base --result "T002 ok, <sha7>"
```
