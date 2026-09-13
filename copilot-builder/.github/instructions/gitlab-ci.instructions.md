---
description: 'GitLab CI i szablony GitLab: te same bramy co npm run verify, cache bez usług zewnętrznych, build raz'
applyTo: '.gitlab-ci.yml,.gitlab/**'
---

# GitLab CI (`.gitlab-ci.yml`, `.gitlab/`)

Właściciel: `code-tooling`. Weryfikacja: edytor pipeline'u GitLaba (CI Lint) przed commitem; lokalnie
`node -e "import('yaml').then(m=>m.parse(require('fs').readFileSync('.gitlab-ci.yml','utf8')))"`.

- Każdy job uruchamia komendę, którą człowiek wpisuje lokalnie (`npm run …`) — żadnej logiki tylko w YAML-u.
  Nowa brama najpierw trafia do `tools/scripts/verify.mjs`, potem do joba.
- Cache: npm (`.cache/npm`, klucz z `package-lock.json`) i narzędzia (`.angular/cache`, `.cache/*`) z
  `fallback_keys` na gałąź domyślną. Żadnego zdalnego cache'u zadań, żadnej usługi zewnętrznej.
- MR weryfikuje projekty dotknięte zmianą (`--base=$CI_MERGE_REQUEST_DIFF_BASE_SHA`), gałąź domyślna
  i harmonogram — wszystko (`--all`). `GIT_DEPTH: 0`, bo `affected` liczy merge-base.
- Build raz: `dist/` jest artefaktem joba `build`, job `e2e` go konsumuje.
- Obraz Playwrighta niesie wersję równą `@playwright/test` z `package.json` — komentarz obok tagu cytuje
  ją, a `npm run check:pins` łapie rozjazd.
- Sekrety nie są potrzebne do builda ani testów; brak joba publikacji — wydanie jest ręczne, po tagu.
- Zero GitHub Actions (`.github/workflows/` jest zabronione — `npm run guard:forbidden`).
- Szablony `.gitlab/issue_templates/*.md` i `merge_request_templates/*.md` są specyfikacją (CO i DLACZEGO)
  i listą DoD — zmiana ich struktury to zmiana procesu SDD (`docs/sdd/methodology.md`).
