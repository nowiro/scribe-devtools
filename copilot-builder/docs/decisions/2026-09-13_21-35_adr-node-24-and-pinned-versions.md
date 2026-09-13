---
type: decision
id: 'adr.node-24-and-pinned-versions'
status: accepted
date: '2026-09-13'
stamp: '2026-09-13_21-35'
title: 'ADR — Node 24, TypeScript 6.0 pod Angular 22, npm, wersje przypięte dokładnie w jednym miejscu'
---

# ADR: runtime i polityka wersji

## Kontekst

Wersje narzędzi rozjeżdżają się na trzy sposoby: między maszynami (zakresy `^` w manifeście), między
prozą a manifestem (liczba w README) i między manifestem a rzeczywistością upstreamu (pin, który nikt nie
przegląda). Angular 22 wiąże TypeScript twardo (peer `>=6.0 <6.1`) i Vitest do wersji 4, a TypeScript 7
(przepisany natywnie) jest już dostępny — bump „bo jest nowszy" wywraca kompilator szablonów.

## Decyzja

1. **Node 24** (`.nvmrc`, `engines.node >=24`, `engine-strict=true`, obraz `node:24` w CI); `@types/node` na
   tym samym majorze.
2. **npm** jako menedżer pakietów: przychodzi z Node, jeden lockfile, `ignore-scripts=true` (żaden pakiet nie
   uruchamia własnego skryptu instalacyjnego — binaria natywne rozwiązują się przez pakiety platformowe),
   `audit=false`/`fund=false` (audyt jest jobem harmonogramu, nie każdą instalacją).
3. **Każda zależność przypięta dokładnie** (bez `^`), a jedynym miejscem, gdzie wersja jest DEKLAROWANA
   z uzasadnieniem, jest `tools/scripts/pins.config.mjs`: `check:pins` (offline, w `verify`) pilnuje, że każdy
   pakiet manifestu ma wiersz i odwrotnie, że proza nie cytuje innej wersji niż pin, że komentarz przy obrazie
   Playwrighta w CI zgadza się z `@playwright/test`; `check:upstream` (online, harmonogram nocny, WARN) mówi,
   które piny są w tyle i od kiedy — decyzję „zostaję" zapisuje `--ack`.
4. **TypeScript 6.0.x i Vitest 4.x** dopóki `@angular/build` tego wymaga; framework Angular i CLI Angulara
   mają osobne wersje (osobne cykle wydań) — obie zapisane w pinach.
5. **Wersja nigdy w prozie**: jedyny obraz wersji dla człowieka to blok AUTOGEN w `docs/tech-stack.md`
   (`stack:sync` w pre-commit, `stack:check` w `verify`).

## Odrzucone alternatywy

| Alternatywa                    | Powód odrzucenia                                                                                     |
| ------------------------------ | ---------------------------------------------------------------------------------------------------- |
| pnpm                           | drugi instalator do zainstalowania na każdej maszynie i runnerze; npm z Node wystarcza przy jednym pakiecie |
| zakresy `^` w manifeście       | dwa `npm install` na dwóch maszynach dają dwa drzewa; lockfile to łata, nie decyzja                    |
| Renovate/Dependabot bez pinów  | nie ma tu żadnego; `check:upstream` + `--ack` to świadoma, ręczna aktualizacja z zapisem decyzji       |
| TypeScript 7                   | poza zakresem peer Angulara 22; wraca razem z majorem Angulara                                        |

## Konsekwencje

- Nowa zależność bez wiersza w `pins.config.mjs` = czerwony `verify`. Bump = zmiana pinu + wiersza + ewentualnie prozy, którą wskaże brama.
- Node 24 na maszynie dewelopera przez nvm / fnm / volta (`docs/dev-setup.md`); `npm run doctor` sprawdza.
