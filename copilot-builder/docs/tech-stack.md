# Tech stack — kanon wersji

Jedyne miejsce, w którym wersje narzędzi są pokazane człowiekowi. Blok AUTOGEN utrzymuje
`npm run stack:sync` (hook pre-commit), a `npm run stack:check` (w `npm run verify`) nie przepuszcza
rozjazdu z `package.json`. Powód każdej wersji i polityka bumpów: `tools/scripts/pins.config.mjs`
(brama `npm run check:pins`, kalendarz `npm run check:upstream`).

## Wersje (autogen)

<!-- AUTOGEN:STACK BEGIN -->

| Składnik | Wersja (źródło: package.json) |
| --- | --- |
| node (engines) | `>=24` |
| @angular/core | `22.1.6` |
| @angular/cli | `22.1.8` |
| typescript | `6.0.3` |
| vitest | `4.1.11` |
| @playwright/test | `1.62.1` |
| eslint | `10.10.0` |
| angular-eslint | `22.5.0` |
| oxlint | `1.83.0` |
| oxfmt | `0.68.0` |
| @commitlint/cli | `21.2.2` |
| zod | `4.6.4` |
| playwright-core | `1.62.1` |

<!-- AUTOGEN:STACK END -->

## Decyzje stackowe (ręczne)

| Obszar              | Decyzja                                                                                                   | Źródło                                                        |
| ------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Runtime             | Node z `.nvmrc`, `engine-strict`; npm jako menedżer pakietów; `ignore-scripts=true`                       | [ADR runtime i wersje](decisions/2026-09-13_21-35_adr-node-24-and-pinned-versions.md) |
| Monorepo            | workspace Angular CLI (`angular.json`, `apps/`, `libs/`) bez Nx; `affected` i cache zadań własnym skryptem | [ADR bez Nx](decisions/2026-09-13_21-30_adr-angular-cli-workspace-without-nx.md) |
| Angular             | standalone, zoneless, sygnały, Signal Forms, natywny control flow; biblioteki ze źródeł przez alias `@cb/*` | `.github/instructions/angular.instructions.md`               |
| Formatowanie        | oxfmt (TS/JS/JSON/CSS/YAML, szablony HTML); Markdown bez formatera z wyboru                                | [ADR oxc](decisions/2026-09-16_10-27_adr-oxc-oxfmt-and-oxlint.md) |
| Lint                | oxlint: ESLint core, TypeScript (typed, oxlint-tsgolint), unicorn, import, promise, vitest + wtyczki JS sonarjs, regexp, security, n, eslint-comments, playwright; ESLint tylko angular-eslint | `oxlint.config.mts`, `oxlint.plugins.mts`, `oxlint.rules.mts`, `eslint.config.mjs` |
| Testy               | Vitest (`@angular/build:unit-test` w projektach, `vitest.tools.config.mts` dla narzędzi); Playwright e2e po zbudowanej aplikacji | `tools/testing/`                                       |
| Hooki i CI          | `.githooks` przez `core.hooksPath`; GitLab CI; zero GitHub Actions                                        | [ADR hooki i CI](decisions/2026-09-13_21-32_adr-native-git-hooks-and-gitlab-ci.md) |
| ALM i przeglądarka  | skrypty (`tools/alm`, `tools/browser-inspector`); MCP tylko przez `mcp-gateway`                        | [ADR skrypty zamiast MCP](decisions/2026-09-13_21-33_adr-scripts-instead-of-mcp-servers.md) |
| Copilot             | jeden widoczny orkiestrator, roster `code-*`/`doc-*`/`mcp-*`, tiery w `.github/models-registry.json`     | [ADR roster](decisions/2026-09-13_21-34_adr-copilot-roster-and-model-tiers.md) |
