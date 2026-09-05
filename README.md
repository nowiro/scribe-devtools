# scribe-devtools

Narzędzia deweloperskie w duchu scribe: skrypty zamiast serwerów MCP, wyniki na dysku, zero
schematów narzędzi w kontekście agenta. Gałąź `copilot` to minimalna wersja repozytorium: kod obu
narzędzi, skrypty, instrukcje dla agenta i ustawienia GitHub Copilota — bez testów, benchmarku
i dokumentacji projektowej.

Dwa narzędzia, dwie binarki:

| binarka | co robi |
| --- | --- |
| `browser-inspector` | patrzenie na aplikację webową przez systemowy Chrome/Edge: batch flow z configu JSON (`browser-inspector <config.json>`) albo sesja interaktywna na refach `eN` (`browser-inspector open <url>`, `find`, `click e45`, `snap`, `export flow.json`) |
| `nx-angular-inspector` | to, co odpowiadają `ng mcp` i `nx-mcp`, bez serwera MCP: graf Nx jako źródło prawdy, zero zależności runtime (`nx-angular-inspector env`, `projects`, `graph <projekt>`, `affected`, `gen`, `run <projekt>:<target>`, `serve`) |

Obie drukują jedną linię stdout na komendę (prefiks `ok` / `FAIL`) i, gdy odpowiedź jest większa niż
linia, ścieżkę do pliku z całością zamiast wypisywania jej wprost.

## Instalacja

Wymagania: Node ≥ 22, npm; dla `browser-inspector` — systemowy Chrome albo Edge (nic nie jest
pobierane, `playwright-core` nie ma pobierania przeglądarek).

```bash
git clone <repo> scribe-devtools
cd scribe-devtools
npm ci            # .npmrc: ignore-scripts=true, engine-strict=true
npm run prepare   # uzbraja hook pre-commit (npm install go NIE uruchamia — ignore-scripts)
npm run verify    # bramki: prettier, check-pins, tsc, CODE-INDEX, sync bloku instrukcji
```

Bez binarek na PATH: `node packages/browser-inspector/bin/browser-inspector.mjs …` /
`node packages/nx-angular-inspector/bin/nx-angular-inspector.mjs …`, albo
`npm run browser-inspector -- …` / `npm run nx-angular-inspector -- …`.

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

Bez npm, bez builda: `npm run portable` pakuje oba narzędzia do
`download/scribe-devtools-portable-<wersja>.zip` (+ sidecar `.sha256`), wersja tylko z
`package.json` korzenia, build deterministyczny. Po rozpakowaniu: `browser-inspector.cmd` /
`./browser-inspector`, `nx-angular-inspector.cmd` / `./nx-angular-inspector`, albo
`node packages/<narzędzie>/bin/<narzędzie>.mjs help`.

## GitHub Copilot i VS Code

- `.github/copilot-instructions.md` — karta repo i kanoniczna kopia bloków instrukcji obu narzędzi
  (ta sama, którą kopiuje repozytorium aplikacji; `npm run verify` pilnuje równości z `AGENTS.md`).
- `.github/instructions/*.instructions.md` — reguły per obszar plików (`source`, `scripts`,
  `docs`, `nx-angular-inspector`), dołączane automatycznie według `applyTo`.
- `.github/prompts/`: `/migrate-from-mcp-playwright` prowadzi migrację repozytorium aplikacji
  (Nx monorepo) z serwera MCP Playwrighta na `browser-inspector`; `/browser-session` to pętla
  „spójrz, potem kliknij" dla sesji interaktywnej.
- `.vscode/tasks.json` — bramki i komendy narzędzi jako zadania (Terminal → Run Task);
  `.vscode/settings.json` włącza prettier, prompt files, instrukcje i `AGENTS.md`;
  `.vscode/extensions.json` poleca prettier i Copilot Chat.

Instrukcje dla agentów pracujących w tym repo: [AGENTS.md](AGENTS.md).

## Skrypty

| skrypt | co robi |
| --- | --- |
| `npm run verify` | wszystkie bramki (patrz AGENTS.md) |
| `npm run typecheck` | `tsc --noEmit` z `checkJs` |
| `npm run code-index` | regeneracja `CODE-INDEX.md` |
| `npm run portable` | zip portable obu narzędzi |
| `npm run browser-inspector -- <args>` / `npm run nx-angular-inspector -- <args>` | narzędzie bez PATH |

## Układ repozytorium

```
packages/browser-inspector/      # bin/browser-inspector.mjs, src/, templates/
packages/nx-angular-inspector/   # bin/nx-angular-inspector.mjs, src/
scripts/                         # index-code, check-instruction-sync, check-pins, check-upstream, portable-zip
.github/                         # copilot-instructions.md, instructions/, prompts/
```
