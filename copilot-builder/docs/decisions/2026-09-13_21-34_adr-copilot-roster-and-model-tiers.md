---
type: decision
id: 'adr.copilot-roster-and-model-tiers'
status: accepted
date: '2026-09-13'
stamp: '2026-09-13_21-34'
title: 'ADR — jeden widoczny orkiestrator, ukryty roster code-* / doc-* / mcp-*, modele przez tiery'
---

# ADR: roster Copilota i polityka modeli

## Kontekst

Roster agentów Copilota jest kodem: każdy widoczny agent to pozycja, którą człowiek musi wybrać w
pickerze; każda nazwa modelu wpisana w plik agenta omija politykę kosztową organizacji; agent z prawem
zapisu, który miał tylko czytać, unieważnia review. Potrzebny był kształt, który da się zwalidować skryptem.

## Decyzja

1. **Dokładnie jeden agent widoczny** — `orchestrator-sdd`. Cała reszta ma `user-invocable: false` i pracuje
   przez delegację z listy `agents:` orkiestratora. Człowiek zaczyna zawsze od tego samego miejsca.
2. **Nazwy po domenie**, nie po roli: `code-*` (kod: `code-angular`, `code-tooling`, `code-tester-unit`,
   `code-tester-e2e`, `code-verifier`, `code-reviewer`, `code-reviewer-ui`), `doc-*` (proza: `doc-intake`,
   `doc-spec`, `doc-reviewer`), `mcp-*` (`mcp-gateway`). Z nazwy widać, czy zlecenie dotknie kodu, czy prozy.
3. **Rola żyje w rejestrze** (`.github/models-registry.json` → `agents.roster`) i niesie uprawnienia:
   reviewer i triager bez `edit`/`execute` (reviewer dodatkowo z hookiem `deny-writes` — lista narzędzi jest
   prośbą, hook egzekucją), writer z `edit`, tester z `edit` + `execute`, verifier z `execute`, orchestrator
   z `agent`, integration z `execute` + serwery MCP.
4. **Modele przez tiery**: `T1` (mechanika, tanio), `T2` (kod i spec), `T3` (architektura i security,
   rzadko), `vision` (zrzuty). Nazwa modelu stoi WYŁĄCZNIE w `tiers` rejestru; `description` agenta zaczyna
   się od tagu tieru, a `model:` musi być tym, co rejestr przypisuje. Zmiana planu Copilota organizacji to
   zmiana `policy.enabled` i `tiers` — nigdy plików agentów.
5. **Routing po ścieżce pliku**: tabela w `orchestrator-sdd` mówi, kto dotyka czego; zadanie dotykające
   trzech obszarów to trzy zlecenia.

Wszystko powyżej sprawdza `npm run ai:validate` (A1–A17), także w hooku pre-commit i po zakończeniu sesji.

## Odrzucone alternatywy

| Alternatywa                                   | Powód odrzucenia                                                                                 |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| kilku widocznych agentów (orkiestrator, reviewer, writer) | człowiek wybiera niewłaściwego agenta do zadania; review T3 przez delegację ma ten sam efekt, a picker zostaje czysty |
| nazwy `<rola>-<przedmiot>` (`writer-angular`) | rola i domena mieszają się w nazwie; zespół chciał odróżniać kod od prozy jednym spojrzeniem        |
| model per agent w pliku agenta                | dwanaście miejsc do zmiany przy zmianie planu; cichy drenaż kosztów, gdy tani agent dostanie drogi model |
| jeden agent „od wszystkiego"                  | jeden zestaw reguł dla kodu, testów, prozy i MCP; brak ograniczeń uprawnień per rola                |

## Konsekwencje

- Nowy agent = wiersz w rosterze rejestru + plik `.github/agents/<nazwa>.agent.md` + wiersz w `AGENTS.md`
  + (dla writerów) wiersz w tabeli routingu orkiestratora — inaczej `ai:validate` jest czerwony.
- Model T3 przez delegację może zostać ograniczony przez klienta do modelu sesji; orkiestrator zapisuje
  w run-logu model zaobserwowany, gdy różni się od tieru.
