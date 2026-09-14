# INDEX — artefakty `docs/`

Rejestr artefaktów commitowanych w `docs/` (decyzje i raporty review). Wiersz jest obowiązkowy —
`npm run sdd:check` odrzuca artefakt bez wpisu. Artefakty lokalne (`docs/specs/`, `docs/plans/`, `docs/runs/`)
są gitignorowane i tu nie trafiają. Format: `| data | kategoria | plik | streszczenie |`.

| data             | kategoria | plik                                                                                                                     | streszczenie                                                                                          |
| ---------------- | --------- | ------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| 2026-09-13 21:30 | decisions | [2026-09-13_21-30_adr-angular-cli-workspace-without-nx.md](decisions/2026-09-13_21-30_adr-angular-cli-workspace-without-nx.md) | workspace Angular CLI bez Nx: graf i affected ze skryptu, cache zadań w `.cache/`, biblioteki ze źródeł |
| 2026-09-13 21:31 | decisions | [2026-09-13_21-31_adr-biome-instead-of-prettier.md](decisions/2026-09-13_21-31_adr-biome-instead-of-prettier.md)         | Biome jedynym formaterem; Markdown i szablony HTML świadomie bez formatera                             |
| 2026-09-13 21:32 | decisions | [2026-09-13_21-32_adr-native-git-hooks-and-gitlab-ci.md](decisions/2026-09-13_21-32_adr-native-git-hooks-and-gitlab-ci.md) | natywne hooki (`.githooks`) zamiast Husky; GitLab CI jedynym CI; zero GitHub Actions                 |
| 2026-09-13 21:33 | decisions | [2026-09-13_21-33_adr-scripts-instead-of-mcp-servers.md](decisions/2026-09-13_21-33_adr-scripts-instead-of-mcp-servers.md) | ALM i przeglądarka przez skrypty (scribe, browser-inspector); MCP tylko przez `mcp-gateway`           |
| 2026-09-13 21:34 | decisions | [2026-09-13_21-34_adr-copilot-roster-and-model-tiers.md](decisions/2026-09-13_21-34_adr-copilot-roster-and-model-tiers.md) | jeden widoczny orkiestrator, roster `code-*`/`doc-*`/`mcp-*`, modele przez tiery w rejestrze          |
| 2026-09-13 21:35 | decisions | [2026-09-13_21-35_adr-node-24-and-pinned-versions.md](decisions/2026-09-13_21-35_adr-node-24-and-pinned-versions.md)     | Node 24, npm, TypeScript 6.0 pod Angular 22, wersje przypięte dokładnie w `pins.config.mjs`           |
| 2026-09-14 08:45 | decisions | [2026-09-14_08-45_adr-review-by-three-model-families.md](decisions/2026-09-14_08-45_adr-review-by-three-model-families.md) | review kodu = ten sam brief do trzech miejsc na trzech rodzinach modeli (weryfikacja krzyżowa); brama A18 |
| 2026-09-14 09:05 | decisions | [2026-09-14_09-05_adr-scm-subagent-commits-plan-tasks.md](decisions/2026-09-14_09-05_adr-scm-subagent-commits-plan-tasks.md) | ukończone zadanie planu commituje `scm-git` (tylko pliki zadania, hooki jako brama); push i tag — człowiek |
