---
type: decision
id: 'adr.native-git-hooks-and-gitlab-ci'
status: accepted
date: '2026-09-13'
stamp: '2026-09-13_21-32'
title: 'ADR — natywne hooki gita zamiast Husky; GitLab CI jako jedyne CI; bez GitHub Actions'
---

# ADR: natywne hooki i GitLab CI

## Kontekst

Bramy repozytorium muszą działać w dwóch miejscach: na maszynie dewelopera przed commitem i pushem oraz
na runnerach GitLaba firmy. Husky i lint-staged były dotąd standardem hooków; GitHub Actions nie wchodzi
w grę, bo kod żyje na GitLabie, a drugie CI to drugie miejsce, w którym lista bram się rozjeżdża.

## Decyzja

**Hooki są natywne:** trzy pliki `#!/bin/sh` w `.githooks/` (pre-commit: skan sekretów w stage'u, indeks kodu
i kanon wersji regenerowane ze STAGE'A, Biome na stage'u, `ai:validate`; commit-msg: commitlint; pre-push:
`verify:affected`), uzbrajane przez
`git config core.hooksPath .githooks` w `npm run prepare` (`tools/scripts/setup-hooks.mjs`). Zero zależności —
Husky robił dla nas dokładnie tę jedną linię `git config`. Biome ma `--staged`, więc lint-staged jest zbędny.

**CI jest jedno — GitLab (`.gitlab-ci.yml`).** Joby uruchamiają te same komendy `npm run …`, które człowiek
wpisuje lokalnie — obie połowy bramy, gdzie brama ma połowę narzędziową i projektową (`npm run lint`
i `affected -- lint`); nowa brama najpierw trafia do `tools/scripts/verify.mjs`, potem do joba. Merge request
weryfikuje projekty dotknięte zmianą, gałąź domyślna i harmonogram — wszystko. Cache: npm z klucza
lockfile'a oraz klucz per job (`tools-<job>-<gałąź>`, GitLab trzyma jedno archiwum per klucz) z fallbackiem
na gałąź domyślną — bez żadnej usługi zewnętrznej. Build raz, e2e na artefakcie; raporty junit i pokrycie
per projekt (`reports/junit-<projekt>.xml`, `coverage/<projekt>/`). Nocny harmonogram: `check:upstream`
(WARN) i `npm audit` (brama). `.github/workflows/` jest zabronione (`npm run guard:forbidden`).

## Odrzucone alternatywy

| Alternatywa                          | Powód odrzucenia                                                                                     |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| Husky + lint-staged                  | dwie zależności i skrypt `prepare`, żeby ustawić jedną opcję gita; `.npmrc` ma `ignore-scripts`, więc i tak wymagałyby ręcznego uzbrojenia |
| pre-push z pełnym `npm run verify`   | przy dziesięciu aplikacjach minuty na każdym pushu → omijany `--no-verify`; affected daje uczciwą odpowiedź w sekundach |
| GitHub Actions równolegle do GitLaba | koszt minut i drugi opis bram; platformą firmy jest GitLab                                            |
| brak hooków, tylko CI                | pierwszy sygnał po kilku minutach zamiast po sekundach; historia z commitami „fix lint”              |

## Konsekwencje

- `npm run prepare` raz po klonie (dokumentacja: `docs/dev-setup.md`); `npm run doctor` mówi, gdy zapomniano.
- Obraz Node w CI podąża za `.nvmrc`; obraz Playwrighta za `@playwright/test` — reguła TAG w `check:pins` porównuje tag
  obrazu z pinem, więc bump jednego bez drugiego jest czerwony przed pierwszym jobem.
- Wydanie jest ręczne, po tagu — CI buduje i weryfikuje, nigdy nie publikuje.
