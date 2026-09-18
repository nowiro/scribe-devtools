# scribe-devtools

Narzędzia deweloperskie w duchu scribe: skrypty zamiast serwerów MCP, wyniki na dysku, zero
schematów narzędzi w kontekście agenta. Repozytorium jest minimalne i nastawione na VS Code
i GitHub Copilota: kod obu narzędzi, skrypty, instrukcje dla agenta i ustawienia Copilota — bez
testów, benchmarku i dokumentacji projektowej. Te części żyją tylko w historii, w gałęziach
sprzed scalenia; kod jest ten sam.

Dwa narzędzia, dwie binarki:

| binarka | co robi |
| --- | --- |
| `browser-inspector` | patrzenie na aplikację webową przez systemowy Chrome/Edge: batch flow z configu JSON (`browser-inspector <config.json>`) albo sesja interaktywna na refach `eN` (`browser-inspector open <url>`, `find`, `click e45`, `snap`, `export flow.json`) |
| `nx-angular-inspector` | to, co odpowiadają `ng mcp` i `nx-mcp`, bez serwera MCP: graf Nx jako źródło prawdy, zero zależności runtime (`nx-angular-inspector env`, `projects`, `graph <projekt>`, `affected`, `gen`, `run <projekt>:<target>`, `serve`) |

Obie drukują jedną linię stdout na komendę (prefiks `ok` / `FAIL`) i, gdy odpowiedź jest większa niż
linia, ścieżkę do pliku z całością zamiast wypisywania jej wprost.

## Instalacja

Wymagania: Node ≥ 22, pnpm; dla `browser-inspector` — systemowy Chrome albo Edge (nic nie jest
pobierane, `playwright-core` nie ma pobierania przeglądarek).

```bash
git clone <repo> scribe-devtools
cd scribe-devtools
pnpm install --frozen-lockfile   # .npmrc: ignore-scripts=true, engine-strict=true
pnpm run prepare                 # uzbraja hook pre-commit (instalacja go NIE uruchamia — ignore-scripts)
pnpm run verify                  # bramki: oxfmt, oxlint, check-pins, tsc, CODE-INDEX, sync instrukcji, claims
```

Bez binarek na PATH: `node packages/browser-inspector/bin/browser-inspector.mjs …` /
`node packages/nx-angular-inspector/bin/nx-angular-inspector.mjs …`, albo
`pnpm run browser-inspector -- …` / `pnpm run nx-angular-inspector -- …`.

## browser-inspector

```
$ browser-inspector read.config.browser-inspector.json --stamp 2026-09-02_10-00
ok strona-glowna · 1 773 ms
ok 1/1 completed · 1 773 ms · warm · .scribe-devtools/browser-inspector/2026-09-02_10-00

$ browser-inspector open http://localhost:4313/
ok open "Księgarnia" · el 61 · err 0 · session/default/snap.md

$ browser-inspector find koszyk
e45 button "Otwórz koszyk" [data-testid=header-cart-button]

$ browser-inspector click e45
ok click e45 · url /cart "Koszyk" · el 63→23

$ browser-inspector tools
2 tools · .scribe-devtools/browser-inspector/session/default/tools.json
addToCart · Dodaje produkt do koszyka
registerUser · Rejestruje użytkownika

$ browser-inspector call addToCart '{"sku":"A-1"}'
ok call addToCart · Dodano A-1 · session/default/calls/001-addtocart.json · dom Δ

$ browser-inspector export flows/koszyk.json
ok export 3 steps → flows/koszyk.json (refs → data-testid/#id/role=)
```

Ciepła przeglądarka żyje w **keeperze** — lokalnym procesie z named pipe (Windows) / unix
socketem, startuje sam przy pierwszym użyciu, gaśnie po bezczynności (`browser-inspector doctor`
sprawdza, czy przeżywa wyjście powłoki). Sekrety wyłącznie przez środowisko (`valueFromEnv`
w configu, `@{NAZWA}` / `--env` w sesji) — literał hasła w configu jest błędem walidacji. Kody
wyjścia batcha: **0** zawsze (nieudany krok to wynik w raporcie), **1** tylko z
`--fail-on-incomplete`, **2** przy błędzie fatalnym środowiska. Pełna lista komend, flag i pól
configu: `browser-inspector help`; szablon flow z przykładami:
[packages/browser-inspector/templates/flow.md](packages/browser-inspector/templates/flow.md).

## nx-angular-inspector

```
$ nx-angular-inspector env
ok env · nx 23.1.0 (świeże) · angular 22.0.0 · .ws/env.txt

$ nx-angular-inspector graph moja-app --reverse
ok graph moja-app --reverse · 4 projekty (świeże) · .ws/graph-moja-app.txt

$ nx-angular-inspector affected --base main
ok affected --base main · 2 projekty (świeże) · .ws/affected.txt
```

Każda komenda kończy się ścieżką pliku w `.ws/` z całą odpowiedzią — odpowiedź jest w tym pliku,
nie w powtórzeniu komendy. Stempel świeżości chodzi po katalogach (18 ms), `--deep` dokłada mtime
plików. Wspierane tylko nx >= 23 i angular >= 22 — starsze wersje dają czytelny komunikat, nie
zgadywanie. Pełna lista komend: `nx-angular-inspector help`; zasady workspace'u i koszt ich przeczytania:
`nx-angular-inspector guide`.

## Wersja portable

Bez menedżera pakietów, bez builda: `pnpm run portable` pakuje oba narzędzia do
`download/scribe-devtools-portable-<wersja>.zip` (+ sidecar `.sha256`), wersja tylko z
`package.json` korzenia, build deterministyczny. Po rozpakowaniu: `browser-inspector.cmd` /
`./browser-inspector`, `nx-angular-inspector.cmd` / `./nx-angular-inspector`, albo
`node packages/<narzędzie>/bin/<narzędzie>.mjs help`.

## GitHub Copilot i VS Code

- `.github/copilot-instructions.md` — karta repo i kanoniczna kopia bloków instrukcji obu narzędzi
  (ta sama, którą kopiuje repozytorium aplikacji; `pnpm run verify` pilnuje równości z `AGENTS.md`).
- `.github/instructions/*.instructions.md` — reguły per obszar plików (`source`, `scripts`,
  `docs`, `nx-angular-inspector`), dołączane automatycznie według `applyTo`.
- `.github/prompts/`: `/migrate-from-mcp-playwright` prowadzi migrację repozytorium aplikacji
  (Nx monorepo) z serwera MCP Playwrighta na `browser-inspector`; `/browser-session` to pętla
  „spójrz, potem kliknij" dla sesji interaktywnej; `/perf-optimize` to runbook wydajności i DX dla
  repozytorium aplikacji — indeks kodu i słownik pojęć pod ograniczanie kontekstu, cache Nx bez Nx
  Cloud, `affected`, natywne hooki, pipeline GitLab CI; `/migrate-to-oxc` przenosi lint i formatowanie
  z ESLint / Prettier / Biome na oxlint + oxfmt (Nx + Angular, z pomiarem przed i po);
  `/migrate-to-vitest5` podnosi Vitest 4 → 5 (grep zmian łamiących, baseline per runner, appki na
  `@angular/build:unit-test`, para SDD plan + run-log); `/rewrite-to-native` rozstrzyga liczbami, czy
  skrypt narzędziowy (np. indeksowanie) warto przepisać na Rust lub inny język — rozkład ściany na
  start runtime'u, git i obliczenia, progi decyzji, tańsze opcje w kolejności; `/harness-audit` rozstrzyga,
  czy agent zawodzi przez model, czy przez harness (stały prefiks per agent, frazy bez zysku, awarie przypisane
  do styków, kontrakt podagenta, konfigurować czy budować); `/add-prefix-gate` przenosi bramę `check:prefix`
  z copilot-builder do innego repo (VS Code Copilot, Claude Code, Codex CLI).
- `.vscode/tasks.json` — bramki i komendy narzędzi jako zadania (Terminal → Run Task);
  `.vscode/settings.json` włącza oxc (oxfmt jako formater, oxlint), prompt files, instrukcje
  i `AGENTS.md`; `.vscode/extensions.json` poleca oxc i Copilot Chat.

Instrukcje dla agentów pracujących w tym repo: [AGENTS.md](AGENTS.md). Agent zaczyna sesję od
dwóch plików: [CODE-INDEX.md](CODE-INDEX.md) mówi, gdzie co jest, a [GLOSSARY.md](GLOSSARY.md),
jak to się nazywa — proza jest po polsku, identyfikatory po angielsku.

## Skrypty

| skrypt | co robi |
| --- | --- |
| `pnpm run verify` | wszystkie bramki (patrz AGENTS.md) |
| `pnpm run typecheck` | `tsc --noEmit` z `checkJs` |
| `pnpm run claims` | uruchamia obie binarki i sprawdza obietnice z prozy (jedna linia, limit 120 znaków, kody wyjścia) |
| `pnpm run code-index` | regeneracja `CODE-INDEX.md` |
| `pnpm run portable` | zip portable obu narzędzi |
| `pnpm run browser-inspector -- <args>` / `pnpm run nx-angular-inspector -- <args>` | narzędzie bez PATH |

## Układ repozytorium

```
packages/browser-inspector/      # bin/browser-inspector.mjs, src/, templates/
packages/nx-angular-inspector/   # bin/nx-angular-inspector.mjs, src/
scripts/                         # index-code, check-claims, check-instruction-sync, check-pins, check-upstream, portable-zip
.github/                         # copilot-instructions.md, instructions/, prompts/
CODE-INDEX.md                    # generowana mapa modułów — czytaj na starcie sesji
GLOSSARY.md                      # słownik pojęć i nazw — czytaj na starcie sesji
```
