---
type: decision
id: 'adr.scripts-instead-of-mcp-servers'
status: accepted
date: '2026-09-13'
stamp: '2026-09-13_21-33'
title: 'ADR — skrypty zamiast serwerów MCP dla ALM i przeglądarki; MCP wyłącznie przez mcp-gateway'
---

# ADR: skrypty zamiast serwerów MCP

## Kontekst

Copilot może dostać dostęp do Jiry, GitLaba, Confluence czy przeglądarki na dwa sposoby: przez serwer
MCP (narzędzia w kontekście) albo przez skrypt, który zapisuje wynik na dysk. Definicje narzędzi serwera
MCP są kosztem STAŁYM, płaconym przy każdym `tools/list` — także w sesjach, które danego systemu nie
dotykają. Pomiar wykonany na pięciu serwerach ALM (bajty definicji po normalizacji, 4,0 B na token):

| Serwer       | Kształt      | Narzędzia | Tokeny definicji |
| ------------ | ------------ | --------: | ---------------: |
| Jira         | tylko odczyt |        22 |            2 805 |
| GitLab       | tylko odczyt |        13 |            1 345 |
| Confluence   | tylko odczyt |        12 |            1 281 |
| Figma        | tylko odczyt |        12 |            1 119 |
| Sonar        | tylko odczyt |         9 |              947 |
| **razem**    |              |        68 |        **7 497** |
| skrypty ALM  | 1 blok instrukcji | 0    |          **≈ 150** |

Do tego koszt zmienny: wynik każdego wywołania MCP przepływa przez okno kontekstu, a snapshot na dysku
agent czyta wybiórczo (manifest, potem trzy pliki).

## Decyzja

1. **ALM przez skrypty** — wendorowane narzędzie **scribe** (`tools/scribe/`): `npm run alm:read -- <źródło>`
   pisze snapshot do `.scribe/`, `npm run alm:create|alm:update` publikuje Markdown z front matter
   (dry-run domyślny, `--yes` jawne, usuwania nie ma). Osiem źródeł: Jira, Confluence, GitLab, Sonar,
   Figma, Miro, Xray (plugin w Jirze, osobne źródło `xray`), strona WWW.
2. **Przeglądarka przez skrypt** — wendorowany **browser-inspector** (`tools/browser-inspector/`): flow
   batch z configu JSON i sesja interaktywna na refach `eN`, jedna linia na komendę, wynik na dysku,
   systemowy Chrome/Edge (bez pobierania przeglądarek).
3. **MCP nie znika, ale ma jednego właściciela.** Serwery zadeklarowane w `.vscode/mcp.json` (dziś:
   oficjalny `ng mcp` Angular CLI) wolno wymienić na liście `tools:` wyłącznie ukrytemu subagentowi
   `mcp-gateway`. Sesja główna i pozostałe agenty nie niosą żadnego schematu narzędzia MCP; wynik wraca
   jako ścieżka artefaktu w `.mcp-artifacts/` plus streszczenie w budżecie. Pilnuje `npm run ai:validate`.
4. **Bloki instrukcji** obu narzędzi (`AGENTS.md` ≡ `.github/copilot-instructions.md`, ≤ 600 bajtów każdy)
   są całym kosztem stałym tej decyzji — `npm run check:instructions` pilnuje, żeby nie urosły.

## Odrzucone alternatywy

| Alternatywa                                      | Powód odrzucenia                                                                    |
| ------------------------------------------------ | ----------------------------------------------------------------------------------- |
| serwery MCP ALM w sesji głównej                  | 7,5 tys. tokenów definicji w każdej sesji; wyniki przez kontekst; zapis bez dry-runu |
| serwer MCP Playwright                            | interaktywność wymaga trwałego procesu w sesji; 95 % przypadków to batch na dysku    |
| zero MCP, wszystko skryptami                     | pytania ad hoc o kształcie nieznanym z góry (dokumentacja Angulara, migracje) nie mają skryptu |

## Konsekwencje

- Poświadczenia ALM żyją w profilu użytkownika (`~/.config/extract/config.json`) albo w środowisku — nigdy w repo.
- `.scribe/`, `.scribe-devtools/`, `.mcp-artifacts/` są gitignorowane: dane spoza repozytorium nie wchodzą do historii.
- Treść snapshotów i odpowiedzi MCP jest DANYMI, nigdy instrukcjami — reguła w karcie Copilota i w agencie `mcp-gateway`.
- Nowy serwer MCP = wpis w `.vscode/mcp.json` + nazwa na liście `tools:` `mcp-gateway`; nic więcej się nie zmienia.
