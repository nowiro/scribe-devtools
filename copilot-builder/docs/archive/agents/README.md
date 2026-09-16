# Archiwum: wycofane definicje agentów

Dwa pliki, które istniały wyłącznie na gałęzi `claude/copilot-builder-setup-ikqbya`
(commity `aaf336b` i `754fec9`) i nigdy nie trafiły na `main` — treść tego szablonu
weszła do historii inną drogą, commitem `04ae6c1`. Leżą tu, żeby dało się tę gałąź
usunąć bez utraty zapisu, jak wyglądał poprzedni kształt rosteru.

**To nie są działające definicje agentów.** Trzymamy je pod `docs/`, poza katalogiem
`.github/agents/`, celowo: `validate-ai-config.mjs` czyta wyłącznie ten drugi i oba
pliki odrzuca — sprawdzone, cztery naruszenia naraz:

| reguła | co mówi |
| --- | --- |
| A3 (×2) | żaden z nich nie jest w rosterze `.github/models-registry.json` |
| A9 | `orchestrator-sdd` deleguje do nieznanego agenta `code-reviewer` |
| A13 | `code-reviewer` ma `deny-writes`, ale jego rola może edytować |

Używają też słownika tierów `T2` / `T3`, którego repozytorium już nie ma — zastąpiły go
`fast` / `base` / `main-<rodzina>`.

## Co je zastąpiło

| plik tutaj | następca na `main` |
| --- | --- |
| `code-reviewer.agent.md` | cztery miejsca rodzinowe: `code-reviewer-anthropic`, `code-reviewer-openai`, `code-reviewer-moonshot`, `code-reviewer-google` — review jest krzyżową weryfikacją kilku rodzin modeli, nie jednym czytaniem, a `review:draw` losuje z tej puli |
| `orchestrator-sdd.agent.md` | `orchestrator.agent.md` — ten sam przepływ SDD, roster po zmianie tierów i po rozbiciu review |

Żadna zdolność nie została utracona przy tej zamianie; te pliki są zapisem drogi, nie
materiałem do przywrócenia. Gdyby kiedyś miały wrócić do `.github/agents/`, wymagają
wpisania do rosteru i naprawy A9 oraz A13 — czyli świadomej decyzji o cofnięciu
rozbicia review, nie przeniesienia pliku.
