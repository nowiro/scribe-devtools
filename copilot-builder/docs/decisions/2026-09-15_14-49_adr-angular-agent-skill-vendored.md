---
type: decision
id: 'adr.angular-agent-skill-vendored'
status: accepted
date: '2026-09-15'
stamp: '2026-09-15_14-49'
title: 'ADR — oficjalne referencje Angulara (angular/skills) wendorowane jako skill angular-developer'
---

# ADR: skill `angular-developer` z przypiętym commitem upstream

## Kontekst

Angular publikuje skille agentowe w repozytorium angular/skills: `angular-developer` (indeks i 40 referencji,
około 170 kB) oraz `angular-new-app`. Zalecana instalacja to `npx skills add`, czyli kod bez pinu. Część
treści jest sprzeczna z regułami szablonu: `ng new` i `npx`, `ng add` (Tailwind, Material, frameworki e2e),
formularze reaktywne i template-driven, serwer MCP przez `npx -y @angular/cli mcp`, `@angular/aria` jako nowa
zależność. Reszta to aktualna, oficjalna wiedza o komponentach, sygnałach, DI, routingu, pipes, stylach
i testach, której `angular.instructions.md` nie powtarza.

## Decyzja

**Referencje `angular-developer` są skopiowane do `.github/skills/angular-developer/references/`
z przypiętym commitem upstream (`a7f8256`, 2026-09-13), bez siedmiu plików sprzecznych z regułami szablonu.
Indeks `SKILL.md` jest własny, po polsku, i mówi, że instrukcje szablonu wygrywają. `angular-new-app` nie jest
wendorowany.**

1. Wykluczone: `mcp.md`, `tailwind-css.md`, `reactive-forms.md`, `template-driven-forms.md`, `e2e-testing.md`,
   `cli.md`, `angular-aria.md`.
2. Referencje czyta się, nie zmienia. Routing odpowiada „—", jak dla narzędzi wendorowanych. Aktualizacja to
   nowy commit wpisany w `SKILL.md`, te same wykluczenia, decyzja człowieka.
3. `code-angular` czyta jeden plik referencji na obszar, gdy brief wychodzi poza `angular.instructions.md`.

## Odrzucone alternatywy

| Alternatywa                          | Powód odrzucenia                                                                              |
| ------------------------------------ | --------------------------------------------------------------------------------------------- |
| `npx skills add`                     | kod bez pinu; każda instalacja inna; pliki sprzeczne z szablonem wchodzą w całości              |
| odnośnik do angular.dev zamiast kopii | agenci nie mają narzędzia `web`; treść musi być w repozytorium                                 |
| przepisanie referencji po polsku     | 150 kB prozy do utrzymania; kopia verbatim jest tania i diffowalna względem upstream            |
| `angular-new-app`                    | duplikuje `npm run new:app` i wymusza `npx` oraz `ng new`                                       |

## Konsekwencje

- Skill ładuje się na żądanie; koszt stały to jego opis na liście skilli.
- Proza referencji jest po angielsku. To wyjątek od reguły języka, jak komentarze w kodzie wendorowanym.
- `guard:forbidden` i `check:instructions` obejmują też te pliki; `ai:validate` nie sprawdza treści skilli.

## Powiązane

- `.github/skills/angular-developer/SKILL.md`, `.github/agents/code-angular.agent.md`
- [ADR — neutralne nazwy narzędzi](2026-09-14_14-35_adr-neutral-tool-names.md)
