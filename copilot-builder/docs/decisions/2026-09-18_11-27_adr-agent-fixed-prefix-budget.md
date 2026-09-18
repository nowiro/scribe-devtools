---
type: decision
id: 'adr.agent-fixed-prefix-budget'
status: accepted
date: '2026-09-18'
stamp: '2026-09-18_11-27'
title: 'ADR — stały prefiks agenta mierzony w bajtach i ograniczony bramą'
---

# ADR: stały prefiks agenta mierzony w bajtach i ograniczony bramą

## Kontekst

Każde żądanie agenta wysyła od nowa stały prefiks: prompt systemowy hosta, schematy narzędzi, treść pliku agenta,
pliki instrukcji włączone zawsze, indeks instrukcji i skilli oraz karty podagentów. O jego rozmiarze decyduje
harness, nie model. Praca „Prompt-Induced Waste in Coding Agents" (arXiv:2608.01347) porównała dwa harnessy na tych
samych trójkach model–zadanie–prompt. Harness z prefiksem 12–15 razy większym robił 2–7 razy więcej tur i kosztował
5–30 razy więcej na udane zadanie przy porównywalnej skuteczności. Zadania miały najwyżej cztery pliki, więc skala
dla dużych zadań jest niesprawdzona.

Szablon miał bramę bajtową tylko dla bloków instrukcji narzędzi (`check:instructions`, 600 B na blok, 1300 B razem).
Nikt nie mierzył całego prefiksu per agent.

Co VS Code dokłada do każdego żądania, ustaliliśmy z dokumentacji i z kodu rozszerzenia (stan z 2026-09; pliki
`computeAutomaticInstructions.ts`, `runSubagentTool.ts`, `agentPrompt.tsx` w repozytorium `microsoft/vscode`):

- treść pliku agenta trafia do każdego żądania; `description` agenta nie trafia do jego własnego okna;
- `.github/copilot-instructions.md`, `AGENTS.md`, `CLAUDE.md` i `CLAUDE.local.md` z korzenia trafiają do każdego
  żądania, każdy pod własnym przełącznikiem, wszystkie domyślnie włączone;
- podagent dostaje te same pliki, bo narzędzie podagenta uruchamia ten sam kolektor instrukcji;
- instrukcja z `applyTo` dołącza treść tylko wtedy, gdy pasuje plik dołączony do żądania; wzorce `**`, `**/*`
  i `*` pasują zawsze, także u podagenta;
- agent z narzędziem odczytu plików albo terminala dostaje indeks: ścieżkę, opis i `applyTo` każdego pliku
  instrukcji oraz nazwę, opis i ścieżkę każdego skilla; treść skilla dopiero przy użyciu;
- agent z narzędziem podagenta dostaje blok z nazwą, opisem i `argument-hint` każdego agenta, którego może
  wywołać; brak listy `agents:` albo `'*'` oznacza wszystkich agentów bez `disable-model-invocation: true`;
- schematy narzędzi wracają co turę, a ich rozmiaru host nie publikuje.

Pomiar z 2026-09-18:

| agent | treść pliku | część wspólna | karty podagentów | razem |
| --- | ---: | ---: | ---: | ---: |
| `orchestrator` | 13 668 B | 18 546 B | 5 233 B | 37 447 B |
| największy podagent (`code-reviewer-ui`) | 2 373 B | 18 546 B | 0 B | 20 919 B |
| najmniejszy podagent (`code-verifier`) | 993 B | 18 546 B | 0 B | 19 539 B |

Część wspólna to `AGENTS.md` (11 115 B), `.github/copilot-instructions.md` (3 611 B), indeks dwunastu plików
instrukcji (2 238 B) i karty pięciu skilli (1 582 B).

## Decyzja

1. `npm run check:prefix` (`tools/scripts/check-prefix.mjs`) liczy dla każdego agenta pięć części:
   - `own` — treść pliku agenta bez frontmattera;
   - `shared` — pliki z korzenia wymienione wyżej, o ile `.vscode/settings.json` ich nie wyłącza, i treść każdej
     instrukcji z wildcardem w `applyTo`;
   - `index` — ścieżka, opis i `applyTo` każdego pliku instrukcji, gdy agent ma narzędzie odczytu albo terminala;
   - `skills` — nazwa, opis i ścieżka każdego skilla, który model może wywołać, pod tym samym warunkiem;
   - `agents` — nazwa, opis i `argument-hint` każdego agenta, którego agent może wywołać.
2. Jednostka to bajty UTF-8, jak w `check:instructions`.
3. Brama stoi w `npm run verify` po `check:instructions`. Limit to największy pomiar plus jedna dziesiąta,
   zaokrąglony w dół do tysiąca: 23 000 B na agenta, 41 000 B dla `orchestrator`. To miejsce na zdanie, nie na
   sekcję. Podniesienie limitu zmienia liczbę w `CAPS` razem z komentarzem, który podaje powód.
4. Frontmatter, którego płaski czytnik nie zmierzy (wartość wieloliniowa, lista blokowa w `agents:` albo
   `tools:`), daje FAIL z nazwą pliku zamiast zaniżonej liczby.
5. Poza pomiarem zostają prompt systemowy hosta, stałe wstępy, którymi host otacza indeks, schematy narzędzi
   i treść instrukcji dołączonej przez plik zadania. Wyjście bramy mówi to wprost.
   `npm run check:prefix -- --table` pokazuje rozbicie i osobną tabelę instrukcji warunkowych z rozmiarem.
6. Liczbę dla jednego agenta sprawdza widok hosta: kontrolka okna kontekstu w polu czatu, podpowiedź w stopce
   odpowiedzi (tokeny wejścia, cache i wyjścia), Chat Debug View albo Agent Debug Logs.

## Odrzucone alternatywy

| alternatywa | powód odrzucenia |
| --- | --- |
| tokeny zamiast bajtów | Node nie ma tokenizera, a każda rodzina z rosteru liczy tokeny inaczej; liczba wyliczona z bajtów byłaby zgadywaniem |
| jeden limit na cały roster | każda sesja płaci własny prefiks; limit łączny pozwala jednemu agentowi rosnąć kosztem innych |
| wliczanie instrukcji `applyTo` dla typowego zadania | zadanie nie jest znane z góry; zgadnięty zestaw plików udawałby pomiar |
| wliczanie wstępów indeksu i schematów narzędzi | ich treść zależy od wersji hosta, nie od repozytorium; brama mierzy to, czym repozytorium steruje |
| limity w `.github/models-registry.json` | rejestr trzyma tiery, role i politykę; limit to parametr bramy, jak `BYTE_LIMIT` w `check-instruction-sync.mjs` |
| przycięcie `AGENTS.md` w tej samej zmianie | to osobna decyzja; ten ADR daje liczbę, na której ją podjąć |

## Konsekwencje

- Zdanie dopisane do `AGENTS.md` albo `copilot-instructions.md` trafia do prefiksu każdego z szesnastu agentów,
  a opis nowego pliku instrukcji do indeksu każdego z nich. Brama pokazuje to w jednej linii.
- `AGENTS.md` to ponad połowa prefiksu każdego podagenta. Tabela komend i roster służą głównie orkiestratorowi,
  więc są kandydatem do przeniesienia. To wymaga osobnego ADR.
- Liczba z bramy jest dolną granicą. Szacunek schematów narzędzi z manifestu rozszerzenia, niepotwierdzony
  pomiarem, daje kilka kilobajtów na zestaw (`read`, `search`, `edit`, `execute`). Nowsze modele dostają część
  narzędzi z opóźnieniem, przez wyszukiwanie narzędzi.
- Cache promptów obniża cenę powtórzonego prefiksu, ale prefiks zajmuje okno tak samo. Host zamraża indeks na
  pierwszej turze, więc zmiana plików instrukcji w trakcie sesji trafia do niej jako osobna aktualizacja.

## Powiązane

- `tools/scripts/check-prefix.mjs`, `tools/scripts/check-instruction-sync.mjs`
- [ADR — jeden model roboczy i instrukcje pod mały model](2026-09-15_13-20_adr-one-working-model-and-plain-instructions.md)
- arXiv:2608.01347, arXiv:2607.28802; dokumentacja VS Code: custom agents, custom instructions, agent skills,
  subagents, chat debug view
