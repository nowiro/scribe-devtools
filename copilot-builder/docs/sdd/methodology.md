# SDD (Spec-Driven Development) — metodyka tego repozytorium

Kanon pracy z GitHub Copilotem w tym workspace. Warstwa wykonywalna: `npm run workflow:specify`
(scaffold, 0 kredytów), `npm run sdd:check` (brama w `npm run verify`), prompty `/intake`, `/specify`,
`/clarify`, `/plan`, `/analyze`, `/checklist`, `/implement`, `/review`, `/dod`, `/adr` w `.github/prompts/`
oraz roster agentów w `.github/models-registry.json`. Szablony: [`templates/`](templates/).

## Drabina

```text
intake → specify → clarify → plan → analyze (go/no-go) → implement → review → test → DoD
```

| Szczebel  | Kto                                      | Artefakt / mechanizm                                                             |
| --------- | ---------------------------------------- | -------------------------------------------------------------------------------- |
| intake    | `doc-intake` (junior) przez `/intake`        | blok intake: verb, slug, cel, AC, zakres, klasa ryzyka; niejasność → **STOP**   |
| specify   | skrypt `npm run workflow:specify`        | `docs/specs/<slug>/spec.md` (z `[?]`), plan, run-log — **0 kredytów**            |
| clarify   | `/clarify` → operator odpowiada          | `[?]` domknięte, `status: draft → clarified`                                     |
| plan      | `doc-spec` (mid) przez `/plan`            | tabela `id · title · agent · done_when · status · AC · commit`, agent po ŚCIEŻCE pliku (`npm run route`)    |
| analyze   | `/analyze` (read-only)                   | GO / NO-GO + blockery; otwarte `[?]` = NO-GO                                    |
| checklist | `/checklist` (read-only, opcjonalnie)    | ☑/☐ jakości przed pierwszą linią kodu                                            |
| implement | `code-*` przez delegację (`/implement`)  | kod + testy; jedno zlecenie = jeden wykonawca = jedna brama                      |
| commit    | `scm-git` (junior) po każdym zadaniu `done`  | `git commit` plików zadania, `type(scope): subject`; SHA w kolumnie `commit` planu |
| review    | `code-reviewer-anthropic` + `code-reviewer-openai` + `code-reviewer-moonshot` (ten sam brief, trzy rodziny modeli), `doc-reviewer` | `docs/reviews/<stempel>_review-<slug>.md` — trzy tabele scalone skryptem `npm run review:merge` (liczba zgodnych rodzin, konflikty, werdykt najgorszy z trzech) |
| test      | `code-tester-unit`, `code-tester-e2e`    | Vitest + Playwright; progi pokrycia z `tools/testing/vitest-angular.config.mts` |
| DoD       | `/dod`                                   | `npm run verify` zielone + run-log domknięty                                     |

Odpowiednik spec-kit: `constitution` = `copilot-instructions.md` + `instructions/*`; `specify`, `plan`,
`tasks` = skrypt + `/plan`; `clarify`, `analyze`, `checklist`, `implement` = prompty o tych nazwach.
spec-kit jest inspiracją, nie zależnością.

## Reguła progu

- **Pytanie albo trywialna edycja w 1 pliku** → ścieżka bezpośrednia, bez artefaktów.
- **≥ 2 pliki LUB zmiana zachowania** → pełna drabina.

Ceremonia założona na drobiazgu kosztuje więcej niż drobiazg; drobiazg bez ceremonii, który okazał się
zmianą zachowania, wraca na drabinę od `/specify`.

## Polityka artefaktów

`docs/specs/`, `docs/plans/`, `docs/runs/` są **lokalne i gitignorowane** — to materiał roboczy jednego
zadania na jednej maszynie, nie dokumentacja projektu. Do repozytorium trafiają wyłącznie:
`docs/decisions/` (ADR), `docs/reviews/` (raporty review) — z nazwą `YYYY-MM-DD_HH-MM_<slug>.md` i wierszem
w `docs/INDEX.md` — oraz `CHANGELOG.md`. Kontraktem z zespołem jest issue w GitLabie (szablon
`.gitlab/issue_templates/Default.md` = spec), a nie plik w `docs/specs/`; publikuje go `/alm-publish`.

Ślad procesu po stronie zespołu: opis MR (`.gitlab/merge_request_templates/Default.md`) z odhaczonym DoD
i raport review w `docs/reviews/`, gdy review wykonał agent.

## STOP-AND-ASK (twarda brama)

Na KAŻDYM szczeblu: niejasne / sprzeczne / niekompletne → STOP, nie zgaduj — jedna skonsolidowana lista
pytań z opcjami, rekomendacją i wpływem (zakres / koszt / bezpieczeństwo). Trzy przypadki: niejednoznaczność
(dwie sprzeczne interpretacje AC), sprzeczność (AC kontra kod albo ADR), decyzja ważąca na zakresie (nowa
zależność, zmiana schematu, złamanie kontraktu). Wszystko inne agent rozstrzyga sam i zapisuje w run-logu
jako założenie. Hierarchia prawdy: **AC > makieta > domysł**. STOP kończy turę: orkiestrator wypisuje
pytania i czeka na odpowiedź operatora — bez delegacji i edycji do tego czasu. Werdykt **STOP**
`doc-reviewer` (dokumentacja, makiety, AC ↔ makieta) jest tą samą bramą.

## Ścieżka defektu (`fix`) — repro-first

1. Failing test PRZED poprawką (Vitest albo Playwright); defekt nieodtwarzalny → STOP.
2. Diagnoza z indeksu (`CODE-INDEX.md`) i z artefaktów (raport browser-inspectora, snapshot ALM), hipoteza
   zapisana w spec.
3. Poprawka minimalna (KISS) przez właściciela ścieżki.
4. Regresja: failing test zielony + `npm run verify`; test zostaje w repozytorium na stałe.
5. Ta sama brama czerwona dwa razy → eskalacja do `code-reviewer-anthropic` (senior-anthropic) i operatora, nie trzecia próba.

## Zadanie `done` = commit przez `scm-git`

Plan to lista zadań ze statusem (`todo` / `in-progress` / `done` / `n/a`) i kolumną `commit`. Ukończone
zadanie (`done_when` zielone): `status → done` w tabeli planu, wiersz w run-logu (agent, tier, artefakt,
wynik bramy), komunikat `type(scope): subject` od `doc-intake` (scope z `commitlint.config.mjs`) i commit
przez `scm-git` — jedynego agenta z prawem do `git commit`; SHA w kolumnie `commit`. Zadanie bez commita
nie jest `done`. Push i tag wykonuje człowiek po `/dod`.

## Koniec pętli

Pętla kończy się WYŁĄCZNIE, gdy: wszystkie AC ✅ · `/analyze` = GO · review APPROVED (bez 🔴) ·
`npm run verify` = PASS · run-log ma „Weryfikację końcową". Retry: złe wymaganie → `/clarify`; zły plan →
`/plan`; błąd kodu albo NO-GO review → `/implement`.

## Wersjonowanie zadań

Slug istnieje (`docs/specs/<slug>/`) → scaffolder nie nadpisuje, tworzy `<slug>-v2`, `-v3`… — nowa
iteracja ma własny spec, plan i run-log.

## Komendy

| Komenda                                                        | Krok      | Efekt                                                   |
| -------------------------------------------------------------- | --------- | ------------------------------------------------------- |
| `npm run workflow:specify -- --verb=<verb> --slug=<slug> [--title]` | specify | scaffold spec + plan + run-log (lokalne), 0 kredytów   |
| `/clarify <slug>`                                              | clarify   | domyka `[?]`, `status: clarified`                       |
| `/analyze <slug>`                                              | analyze   | GO / NO-GO (read-only)                                  |
| `npm run sdd:check`                                            | brama     | nazwy, INDEX, front matter, `[?]`, agenci z rosteru     |
| `npm run verify`                                               | DoD       | wszystkie bramy repozytorium                            |

## Powiązane

- [`templates/spec.md`](templates/spec.md), [`templates/plan.md`](templates/plan.md), [`templates/run.md`](templates/run.md)
- `.github/agents/orchestrator.agent.md` — tabela routingu i kontrakt zlecenia
- `.gitlab/issue_templates/Default.md` — issue jako specyfikacja
