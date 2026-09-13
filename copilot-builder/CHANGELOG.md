# Changelog

Historia zmian szablonu. SemVer; wersja w `package.json`. Sekcja `Unreleased` rośnie razem ze zmianą,
nie przy tagowaniu. Wydanie: podbij `version`, przenieś `Unreleased` do sekcji z datą, tag `vX.Y.Z`.

## [Unreleased]

### Added

- Workspace Angular 22 (Angular CLI, `apps/` + `libs/`, bez Nx) z `npm run new:app` / `new:lib`,
  `affected.mjs` (graf z `angular.json` i aliasów, cache zadań) i `verify.mjs` jako definicją ukończenia.
- Konfiguracja GitHub Copilota: jeden widoczny `orchestrator-sdd`, ukryty roster `code-*` / `doc-*` /
  `mcp-gateway`, rejestr modeli z tierami, instrukcje ścieżkowe, prompty drabiny SDD, hooki.
- Metodyka SDD (`docs/sdd/`) ze scaffoldem `workflow:specify` i bramą `sdd:check`; artefakty lokalne.
- Wendorowane narzędzia: `tools/scribe` (snapshoty i zapis ALM) i `tools/browser-inspector`
  (przeglądarka przez skrypt), z blokami instrukcji synchronizowanymi bramą.
- GitLab CI (`.gitlab-ci.yml`) z cache bez usług zewnętrznych, affected na MR, build raz, e2e na artefakcie;
  szablony issue (spec) i MR (DoD).
- Biome jako formater, ESLint flat config (angular-eslint, typescript-eslint, sonarjs, unicorn…),
  commitlint, natywne hooki gita, piny wersji w jednym miejscu (`pins.config.mjs`) z bramą i zegarem
  zaległości.
- Sześć ADR-ów w `docs/decisions/` dokumentujących powyższe decyzje.
