// routing.config.mjs — WHO touches WHAT, declared once.
//
// The orchestrator's routing table used to be prose in its agent file: a human could follow it, a
// script could not, and `/plan` filled the `agent` column from memory. This file is the declaration.
// `route.mjs` answers `npm run route -- <paths>` from it, renders the table the orchestrator carries
// (`npm run route -- --sync`, between ROUTING markers) and `ai:validate` (A19) refuses a table that
// drifted from this file — so the prose can never disagree with what the script answers.
//
// Two kinds of rows. BY_PATH: the FIRST matching glob wins, so specific rules stand before general
// ones — the e2e tree before `**/*.spec.ts`, a spec before the directory it lives in, the vendored
// trees before `tools/**`. `agent: null` means "nobody": vendored code is read, not rewritten, and a
// generated file is regenerated — both are a decision for a human, and `route` says so with exit 1.
// BY_WORK: work with no file of its own (running gates, review, commits, MCP). The review seats are
// NOT listed here — they come from `review.seats` of the registry, so renaming a vendor is one edit.
//
// Globs: `**` any number of segments (also none), `*` inside one segment, `?` one character; a pattern
// without `/` is anchored at the repository root (`tsconfig*.json` is the root file, not every one).

/** @typedef {{ agent: string | null, globs: readonly string[], what: string }} PathRule */
/** @typedef {{ agent: string, what: string }} WorkRule */

/** Placeholder agent of the BY_WORK row that expands to one row per seat of `review.seats`. */
export const REVIEW_SEATS_ROW = '<review.seats>';

/** @type {readonly PathRule[]} first match wins */
export const BY_PATH = Object.freeze([
  {
    agent: null,
    globs: ['tools/alm/**', 'tools/browser-inspector/**'],
    what: 'narzędzia wendorowane — czyta się, nie przepisuje; poprawka to decyzja człowieka',
  },
  {
    agent: null,
    globs: ['.github/skills/angular-developer/references/**'],
    what: 'referencje Angulara wendorowane z angular/skills (commit w SKILL.md) — czyta się, nie przepisuje',
  },
  {
    agent: null,
    globs: ['CODE-INDEX.md'],
    what: 'generowany (`npm run code-index`, hook pre-commit) — nie edytuj',
  },
  { agent: 'code-tester-e2e', globs: ['apps/*-e2e/**'], what: 'Playwright' },
  { agent: 'code-tester-unit', globs: ['**/*.spec.ts', '**/*.spec.mjs'], what: 'testy jednostkowe Vitest' },
  { agent: 'code-angular', globs: ['apps/**', 'libs/**'], what: 'kod aplikacji i bibliotek (`.ts`, `.html`, `.css`)' },
  {
    agent: 'code-tooling',
    globs: [
      'tools/**',
      '.githooks/**',
      '.gitlab-ci.yml',
      '.gitlab/**',
      'eslint.config.mjs',
      'oxlint.*.mts',
      '.oxfmtrc.jsonc',
      'angular.json',
      'tsconfig*.json',
      'vitest.tools.config.mts',
      'package.json',
      'package-lock.json',
      'commitlint.config.mjs',
      '.npmrc',
      '.nvmrc',
      '.gitignore',
      '.gitattributes',
      '.editorconfig',
      '.vscode/**',
      '.github/hooks/**',
      '.github/models-registry.json',
    ],
    what: 'skrypty, hooki, konfiguracje lintów i workspace, CI, rejestr modeli',
  },
  {
    agent: 'doc-spec',
    globs: ['.github/**'],
    what: 'treść promptów, agentów, instrukcji i skilli (mechanika front matteru — `applyTo`, `tools:` — to zlecenie dla `code-tooling`)',
  },
  {
    agent: 'doc-spec',
    globs: ['docs/**', 'README.md', 'GLOSSARY.md', 'CHANGELOG.md', 'AGENTS.md'],
    what: 'spec, plan, run-log, ADR, raporty review, proza dla ludzi',
  },
]);

/** @type {readonly WorkRule[]} in the order the table shows them */
export const BY_WORK = Object.freeze([
  { agent: 'code-verifier', what: 'uruchamianie bram i triaż ich wyniku' },
  {
    agent: REVIEW_SEATS_ROW,
    what: 'review kodu w rodzinie <rodzina> — ten sam brief i pełny zakres co pozostałe miejsca — read-only',
  },
  {
    agent: 'code-reviewer-ui',
    what: 'przegląd wizualny zrzutów z browser-inspectora na pięciu szerokościach — read-only',
  },
  { agent: 'doc-intake', what: 'klasyfikacja zgłoszenia, streszczenia, commit message, wiersz w `docs/INDEX.md`' },
  {
    agent: 'doc-reviewer',
    what: 'przegląd dokumentacji i makiet (spec, plan, README, ADR) — read-only, werdykt STOP kończy turę',
  },
  { agent: 'scm-git', what: 'commit ukończonego zadania planu (stage wskazanych plików, `git commit`)' },
  { agent: 'mcp-gateway', what: 'dane z serwera MCP (`.vscode/mcp.json`)' },
]);
