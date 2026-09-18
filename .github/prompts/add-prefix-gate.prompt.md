# /add-prefix-gate — dodaj pomiar i limit stałego prefiksu agentów

Pracujesz w repozytorium z konfiguracją agentów AI (GitHub Copilot w VS Code, Claude Code albo Codex CLI). Dodaj
bramę, która mierzy stały prefiks każdego agenta w bajtach i czerwienieje, gdy agent przekroczy limit. Stały prefiks
to bajty wysyłane przy każdym żądaniu agenta, zanim zadanie doda słowo. Wzór to `check-prefix.mjs` z szablonu
copilot-builder w repozytorium `scribe-devtools`: `copilot-builder/tools/scripts/check-prefix.mjs` i jego spec.
Komendy w składni bash (Git Bash). **Nie commituj i nie pushuj bez zgody.**

Zasada nadrzędna: brama mierzy tylko to, czym repozytorium steruje i co host dokłada do każdego żądania. Czego nie
mierzy (prompt systemowy hosta, wstępy indeksu, schematy narzędzi, pliki warunkowe), to mówi w swoim wyjściu.

## 0. Rozpoznanie (nic nie edytuj)

1. Host: `git ls-files | grep -E '^\.github/agents/|^\.claude/agents/|^AGENTS\.md$|^CLAUDE\.md$|^\.codex/'`.
2. Brama repo: `git grep -n -E '"verify"|verify\.mjs' -- package.json '**/package.json'`. Zapisz, jak jest
   zbudowana: lista kroków w skrypcie Node albo łańcuch `&&` w `package.json`.
3. Istniejące bramy bajtowe: `git grep -n -i -E "byte|bajt|BYTE_LIMIT" -- 'tools/**' 'scripts/**'`.
4. Źródło: `../scribe-devtools/copilot-builder/tools/scripts/check-prefix.mjs` i `check-prefix.spec.mjs`. Brak
   katalogu `../scribe-devtools` → STOP i zapytaj o klon. Skrypt importuje:
   - z `lib/repo.mjs`: `REPO` (korzeń repo), `isMain`, `frontmatter(text)` (płaski czytnik frontmattera)
     i `stripJsonComments` (wycina komentarze JSONC, pomija stringi);
   - z `check-instruction-sync.mjs`: `sizeInBytes` (= `Buffer.byteLength(text, 'utf8')`);
   - z `validate-ai-config.mjs`: `parseList` (`['a', 'b']` albo pojedyncza wartość → tablica).
   Helper jest w repo → użyj go. Nie ma → skopiuj do skryptu tylko tę funkcję. Nie importuj całego
   `validate-ai-config.mjs` z innego repo, bo wciąga kolejne moduły. Brak Vitesta → pomiń spec i zapisz to
   w raporcie.

Wyjście kroku 0: host, plik bramy, helpery (są / do skopiowania). Pokaż i czekaj na „dalej".

## 1. Części prefiksu dla hosta

| host | `own` | `shared` | `index` | `skills` | `agents` |
| --- | --- | --- | --- | --- | --- |
| VS Code Copilot (`.github/agents/*.agent.md`; podagent tak samo) | treść bez frontmattera | z korzenia `.github/copilot-instructions.md` (przełącznik `github.copilot.chat.codeGeneration.useInstructionFiles`), `AGENTS.md` (`chat.useAgentsMdFile`), `CLAUDE.md` i `CLAUDE.local.md` (`chat.useClaudeMdFile`), wszystkie domyślnie włączone; treść instrukcji z `applyTo` równym `**`, `**/*` albo `*` | ścieżka, opis i `applyTo` każdego `.github/instructions/*.instructions.md`, gdy agent ma narzędzie odczytu albo terminala | nazwa, opis i ścieżka każdego skilla z opisem i bez `disable-model-invocation: true`, pod tym samym warunkiem | nazwa, opis i `argument-hint` każdego agenta z `agents:`, gdy agent ma narzędzie podagenta; brak listy albo `'*'` = wszyscy bez `disable-model-invocation: true` |
| Claude Code (`.claude/agents/*.md`) | treść bez frontmattera | łańcuch `CLAUDE.md`, `.claude/CLAUDE.md`, `CLAUDE.local.md` z importami `@` do 4 poziomów i `.claude/rules/*.md` bez `paths:`; pomiń, gdy agent ma `omitClaudeMd` | — | `description` i `when_to_use` każdego skilla (każdy do 1 536 znaków) | treści skilli z `skills:` agenta |
| Codex CLI (jedna sesja) | — | `AGENTS.md` od korzenia gita do cwd, łącznie do 32 KiB | — | nazwa, opis i ścieżka każdego skilla | — |

Treść instrukcji dołączanej przez pasujący plik zadania (`applyTo` bez wildcardu, `paths:`) nie wchodzi do sumy.
Tryb `--table` wypisuje ją osobno z rozmiarem.

## 2. Skrypt

1. Skopiuj `check-prefix.mjs` i `check-prefix.spec.mjs` do katalogu skryptów bram repo.
2. Dostosuj importy do helperów z kroku 0.4. Zostaw bez zmian: bajty przez `Buffer.byteLength(text, 'utf8')`,
   odczyt ustawień przez `stripJsonComments`, który pomija stringi, a potem wyrażenie regularne (VS Code przyjmuje
   przecinki na końcu, `JSON.parse` nie), FAIL na frontmatterze nie do zmierzenia, jedną linię `ok …` albo
   `FAIL …`, kody wyjścia 0 / 1 / 2, tryb `--table` i przyjmowanie samego `--` od pnpm.
3. Host inny niż VS Code: zmień funkcję, która buduje części, według wiersza z kroku 1. Spec dostaje po jednym
   przypadku na każdą część.
4. Uruchom `node <skrypt> --table`. `ERR_MODULE_NOT_FOUND` → wróć do kroku 0.4. Zapisz największy wynik zwykłego
   agenta i wynik orkiestratora.

## 3. Limity

1. Limit zwykłego agenta: największy wynik × 1,1, zaokrąglony w dół do pełnego 1 000 B
   (copilot-builder: 20 919 → 23 000 B, orkiestrator 37 447 → 41 000 B).
2. Agent większy z założenia (orkiestrator): osobny limit w `CAPS` z komentarzem, który podaje powód.
3. Limitów nie ustawiaj poniżej dzisiejszych wyników. Brama ma zatrzymać wzrost, a przycięcie to osobna zmiana
   (`/harness-audit`, krok 5).

## 4. Podpięcie

1. Skrypt npm `check:prefix`, krok w bramie `verify` po innych bramach statycznych i auto-zatwierdzenie komendy
   w `.vscode/settings.json`, jeśli repo je prowadzi.
2. Lista bram w `AGENTS.md` albo `CLAUDE.md`, jeśli repo ją prowadzi. Ten wpis też powiększa prefiks, więc uruchom
   bramę ponownie i dopiero wtedy przepisz liczby do dokumentów.
3. ADR (albo odpowiednik w repo) z tabelą pomiaru, listą części mierzonych i niemierzonych oraz odrzuconymi
   alternatywami: tokeny zamiast bajtów, jeden limit na cały roster, zgadywanie instrukcji warunkowych.
4. Sprawdź jednego agenta w widoku hosta: VS Code → kontrolka okna kontekstu w polu czatu albo Chat Debug View,
   Claude Code → `/context`. Zapisz stosunek bajtów do tokenów w ADR.

## 5. Weryfikacja

1. Spec skryptu, format, lint, typecheck i cała brama repo zielone.
2. Test ręczny: dopisz do pliku wspólnego tyle znaków, żeby agent przekroczył limit, uruchom bramę, ma dać `FAIL`
   z nazwą agenta i rozbiciem na części. Przywróć plik.

## Kryteria ukończenia

- `check:prefix` w bramie `verify`, jedna linia wyniku, `--table` z rozbiciem i instrukcjami warunkowymi.
- Limity z pomiaru z kroku 3, powód przy każdym wyjątku.
- ADR z pomiarem, stosunkiem bajtów do tokenów dla jednego agenta i listą części poza pomiarem.

## Pułapki (sprawdzone)

- `text.length` liczy znaki UTF-16, nie bajty. Polski tekst wyszedłby tańszy niż na dysku.
- Stripper komentarzy JSONC, który nie pomija stringów, psuje `.vscode/settings.json` z globami
  (`"**/tools/hooks/**"`) i `tsconfig.json` z aliasem `"@x/*"` przed globem `src/**/*.ts`.
- Płaski czytnik frontmattera mierzy `description: >-` i listę blokową pod `agents:` albo `tools:` jako 0–2 bajty.
  Brama ma dać FAIL z nazwą pliku, nie zaniżoną liczbę.
- W VS Code `description` agenta nie trafia do jego własnego okna. Trafia do okna agenta, który może go wywołać.
- Podagent VS Code dostaje te same pliki wspólne co rodzic: narzędzie podagenta uruchamia ten sam kolektor
  instrukcji. Harness „Copilot" (Agent Host) buduje kontekst po swojemu: mierz go osobno.
- Skrypt w szablonie z bramą słów (`guard:forbidden`) nie może zawierać zakazanych nazw w komentarzach.
