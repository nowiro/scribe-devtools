---
type: decision
id: 'adr.scm-subagent-commits-plan-tasks'
status: accepted
date: '2026-09-14'
stamp: '2026-09-14_09-05'
title: 'ADR — ukończone zadanie planu commituje subagent scm-git, nie człowiek'
---

# ADR: commit zadania przez `scm-git`

Zmienia niezmiennik 10 karty Copilota (`.github/copilot-instructions.md`), który brzmiał „agent proponuje
commit, nigdy go nie wykonuje".

## Kontekst

Plan SDD to lista zadań ze statusem, a każde ukończone zadanie ma odpowiadać jednemu commitowi
`type(scope): subject`. Gdy commit wykonuje człowiek, propozycje zbierają się na końcu tury w jeden
zbiorczy commit albo giną; historia przestaje odpowiadać planowi, a review per commit i `git bisect`
tracą sens. Agent, który commituje, potrzebuje jednak ścisłych granic: nie wolno mu stage'ować cudzych
zmian, obchodzić hooków ani ruszać historii.

## Decyzja

**Ukończone zadanie planu (`done_when` zielone, `status → done`) commituje subagent `scm-git` — jedyny
agent z prawem do `git commit`; SHA trafia do kolumny `commit` planu i do run-logu. Push i tag pozostają
przy człowieku.**

1. Rola `scm` w rejestrze: `execute` bez `edit` i bez `agent`; tier junior. `scm-git` stage'uje wyłącznie
   ścieżki wymienione w zleceniu, nigdy `git add -A` ani `.`; obcy plik w drzewie = STOP.
2. Hooki gita (`.githooks/`: skan sekretów, indeks ze stage'a, Biome, `ai:validate`, commitlint) są bramą
   commita; czerwony hook wraca do orkiestratora jako wynik. `--no-verify`, `--amend`, `rebase`,
   `reset --hard`, `push`, `tag` i zmiana konfiguracji gita są poza zakresem agenta; `guard-commands`
   blokuje force push, `--no-verify` i obejście `core.hooksPath` niezależnie od intencji.
3. Plan niesie kolumnę `commit`; zadanie bez SHA nie jest `done`. Komunikat układa `doc-intake`
   (scope z `commitlint.config.mjs`).

## Odrzucone alternatywy

| Alternatywa                                                  | Powód odrzucenia                                                                                                                                  |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| commit przez orkiestratora                                   | ma `edit` i `agent`; agent, który edytuje i commituje, commituje własne pomyłki bez cudzego spojrzenia — osobny agent z samym `execute` ma mniejszą powierzchnię |
| commit przez wykonawcę zadania (`code-*`)                    | pięć agentów z prawem do historii zamiast jednego; brak jednego miejsca, w którym pilnuje się, co wchodzi do stage'a                                |
| jeden commit na koniec tury przez człowieka (stan poprzedni) | historia nie odpowiada planowi; propozycje commitów giną; review per commit i bisect bez wartości                                                 |
| autocommit z hooka po każdej edycji                          | commit bez zielonej bramy i bez komunikatu z sensem; historia z szumu                                                                             |

## Konsekwencje

- Niezmiennik 10 karty Copilota brzmi teraz: commit zadania wykonuje `scm-git` po zielonej bramie; push
  i tag wykonuje człowiek. `/implement`, `/dod`, `/plan`, metodyka i szablony planu/run-logu nazywają ten krok.
- Nowy agent w rosterze, wiersz w tabeli routingu, `AGENTS.md`, `README.md`; rola `scm` w rejestrze.
- Człowiek nadal decyduje, co wychodzi z maszyny (push); historia lokalna jest granularna i zgodna
  z planem.
