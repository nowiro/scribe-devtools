---
description: 'GitLab CI i szablony GitLab: te same bramy co npm run verify, cache bez usług zewnętrznych, build raz'
applyTo: '.gitlab-ci.yml,.gitlab/**'
---

# GitLab CI (`.gitlab-ci.yml`, `.gitlab/`)

Właściciel: `code-tooling`. Sprawdzenie składni przed commitem: CI Lint w GitLabie albo lokalnie
`node -e "import('yaml').then(m=>m.parse(require('fs').readFileSync('.gitlab-ci.yml','utf8')))"`.

## Reguły

1. Każdy job uruchamia komendę, którą człowiek wpisuje lokalnie (`npm run …`). Logiki tylko w YAML-u nie ma.
   Nowa brama najpierw trafia do `tools/scripts/verify.mjs`, potem do joba.
2. Cache: npm (`.cache/npm`, klucz z `package-lock.json`) i narzędzia (`.angular/cache`, `.cache/*`)
   z `fallback_keys` na gałąź domyślną. Bez zdalnego cache'u. Bez usług zewnętrznych.
3. MR weryfikuje projekty dotknięte zmianą (`--base=$CI_MERGE_REQUEST_DIFF_BASE_SHA`). Gałąź domyślna
   i harmonogram weryfikują wszystko (`--all`). `GIT_DEPTH: 0`, bo `affected` liczy merge-base.
4. Build raz: `dist/` jest artefaktem joba `build`. Job `e2e` go używa.
5. Tag obrazu Playwrighta równa się wersji `@playwright/test` z `package.json`. `npm run check:pins` to sprawdza.
6. Build i testy nie potrzebują sekretów. Joba publikacji nie ma. Wydanie jest ręczne, po tagu.
7. Zero GitHub Actions. `.github/workflows/` jest zabronione (`npm run guard:forbidden`).
8. Szablony `.gitlab/issue_templates/*.md` i `merge_request_templates/*.md` to spec i lista DoD. Zmiana ich
   struktury to zmiana procesu SDD (`docs/sdd/methodology.md`).
