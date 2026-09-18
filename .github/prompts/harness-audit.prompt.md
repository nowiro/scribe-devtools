# /harness-audit — czy zawodzi model, czy harness: zmierz, zlokalizuj, napraw warstwę wokół modelu

Pracujesz w repozytorium, w którym agenci AI (GitHub Copilot w VS Code, Claude Code, Copilot CLI albo Codex CLI)
robią pracę według plików konfiguracji. Pytanie operatora brzmi: „agent działa słabo albo drogo — zmienić model czy
harness?". Harness to wszystko wokół modelu: instrukcje zawsze włączone, pliki agentów, skille, narzędzia, briefy
podagentów, bramy i pamięć. W tym runie mierzysz i klasyfikujesz, a zmieniasz tylko to, na co operator powie „dalej".
Komendy w składni bash (Git Bash). **Nie commituj i nie pushuj bez zgody.**

Zasada nadrzędna: zanim padnie „weźmy mocniejszy model", zmierz harness. Ten sam model na tym samym zadaniu kosztował
5–30 razy więcej na udane zadanie tylko przez harness: prefiks 12–15 razy większy i 2–7 razy więcej tur
(arXiv:2608.01347, zadania do czterech plików). Każdy wniosek w raporcie ma liczbę i `plik:linia`.

## 0. Rozpoznanie (nic nie edytuj)

1. Host i pliki. Znajdź, które z tych plików istnieją:
   `git ls-files | grep -E '^(AGENTS\.md|CLAUDE\.md|CLAUDE\.local\.md|GEMINI\.md)$|^\.github/(copilot-instructions\.md|agents/|instructions/|skills/|prompts/|hooks/)|^\.claude/|^\.agents/|^\.codex/|^\.vscode/(settings|mcp)\.json$|^\.mcp\.json$'`
2. Z tabeli niżej wybierz wiersze hostów, których pliki istnieją. Tabela mówi, co trafia do okna przy **każdym**
   żądaniu, a co warunkowo.

| host | zawsze w oknie | warunkowo | jak zobaczyć liczbę hosta |
| --- | --- | --- | --- |
| VS Code Copilot (także podagent) | treść pliku agenta (bez frontmattera); z korzenia `.github/copilot-instructions.md`, `AGENTS.md`, `CLAUDE.md`, `CLAUDE.local.md` (każdy pod przełącznikiem, domyślnie włączone); treść instrukcji z `applyTo` równym `**`, `**/*` albo `*`; przy narzędziu odczytu albo terminala indeks: ścieżka, opis i `applyTo` każdego `*.instructions.md` oraz nazwa, opis i ścieżka każdego skilla; przy narzędziu podagenta karty agentów (nazwa, opis, `argument-hint`); schematy narzędzi | treść `*.instructions.md`, gdy plik dołączony do żądania pasuje do `applyTo`; treść skilla (przy użyciu); prompt (na `/nazwa`) | kontrolka okna kontekstu w polu czatu; podpowiedź w stopce odpowiedzi (tokeny wejścia, cache, wyjścia); Chat Debug View; Agent Debug Logs |
| Claude Code | prompt systemowy i narzędzia hosta; łańcuch `CLAUDE.md` od korzenia do cwd z importami `@` (do 4 poziomów); `.claude/rules` bez `paths:`; `MEMORY.md` (200 linii / 25 KB); opis i `when_to_use` każdego skilla; nazwy narzędzi MCP | zagnieżdżone `CLAUDE.md` i reguły z `paths:` (przy odczycie pliku); treść skilla; schematy MCP przez wyszukiwanie narzędzi | `/context`, `/usage` |
| podagent Claude Code | własny prompt z `.claude/agents/<nazwa>.md`; cały łańcuch `CLAUDE.md` (bez `omitClaudeMd`); treści skilli z `skills:` | to, co przeczyta | metadane zwrotu do rodzica |
| Copilot CLI i agent w chmurze | `copilot-instructions.md`, `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`; w CLI także opisy skilli | `*.instructions.md` z `applyTo`; `AGENTS.md` zagnieżdżone | CLI: `/context`; chmura: brak |
| Codex CLI | `AGENTS.md` od korzenia gita do cwd, łącznie do 32 KiB (`project_doc_max_bytes`); lista skilli do 2% okna | `SKILL.md` przy wyborze | `/status` (tylko suma) |

   W VS Code brak listy `agents:` albo `'*'` oznacza karty wszystkich agentów bez `disable-model-invocation: true`.
   Harness „Copilot" w VS Code (Agent Host) buduje kontekst po swojemu i nie czyta promptów: mierz go osobno.
3. Częstość: ile sesji i żądań dziennie ma każdy agent. Źródło: run-logi, historia czatu, liczba zadań w planach.
   Brak danych: zapisz „nieznana" i licz dla 1 sesji × 30 żądań.

Wyjście kroku 0: lista hostów i plików, częstość per agent. Pokaż i czekaj na „dalej".

## 1. Stały prefiks per agent

1. Repo ma skrypt `check:prefix`: `npm run check:prefix -- --table` (albo `pnpm run check:prefix --table`).
   Przepisz tabelę.
2. Nie ma: przenieś bramę promptem `/add-prefix-gate` albo zmierz ręcznie bajty UTF-8 części z kolumny „zawsze
   w oknie". Pliki wspólne mierz w całości:
   `node -e "console.log(Buffer.byteLength(require('fs').readFileSync(process.argv[1], 'utf8')))" <plik>`
   Treść pliku agenta mierz bez frontmattera:
   ```bash
   BODY='const s=require("fs").readFileSync(process.argv[1],"utf8");const e=s.startsWith("---")?s.indexOf("\n---",3):-1;const b=e<0?s:s.slice(s.indexOf("\n",e+4)+1);console.log(Buffer.byteLength(b))'
   node -e "$BODY" <plik-agenta>
   ```
   Indeks, karty skilli i karty agentów to suma wybranych pól frontmattera; `path` dolicza ścieżkę pliku:
   ```bash
   FM='const [keys,...files]=process.argv.slice(1);let t=0;for(const f of files){const s=require("fs").readFileSync(f,"utf8");for(const k of keys.split(",")){if(k==="path"){t+=Buffer.byteLength(f);continue}const m=s.match(new RegExp("^"+k+":[ \\t]*(.*)$","m"));if(m)t+=Buffer.byteLength(m[1].trim().replace(/^(["\x27])(.*)\1$/,"$2"))}}console.log(t)'
   node -e "$FM" path,description,applyTo .github/instructions/*.instructions.md
   node -e "$FM" name,description,path .github/skills/*/SKILL.md
   node -e "$FM" name,description,argument-hint <pliki agentów z listy agents:>
   ```
   Wartość wieloliniowa (`>` albo `|`) nie jest liczona przez tę komendę: zmierz ją ręcznie.
3. Sprawdź jednego agenta w widoku hosta (kolumna ostatnia). Zapisz stosunek bajtów do tokenów. Nie dziel bajtów
   przez stałą w raporcie: podawaj bajty, a tokeny tylko z widoku hosta.

Wyjście: tabela `agent | treść | pliki wspólne | indeks | skille | podagenci | razem B | żądań dziennie | B × żądania`,
posortowana po ostatniej kolumnie. Pokaż i czekaj na „dalej".

## 2. Frazy, które kosztują bez zysku

1. Szukaj w plikach „zawsze w oknie" i w szablonach briefów:
   `git grep -n -i -E "think (deeply|hard|step by step)|ultrathink|(develop|consider|compare|propose) (and compare )?(several|multiple|a few) (distinct |different )?(approaches|options|solutions)|compare (their )?trade-?offs|myśl głęboko|przemyśl (to )?dokładnie|(opracuj|rozważ|porównaj|zaproponuj) (kilka|parę) (różnych )?(podejść|opcji|wariantów|rozwiązań)" -- '*.md' ':!.github/prompts/harness-audit.prompt.md'`
   Trafienia poza plikami z kolumny „zawsze w oknie" i poza szablonami briefów pomiń.
2. Każde trafienie to wiersz raportu z liczbą z pracy arXiv:2608.01347: polecenie „myśl głęboko" dawało 1,6–2,2×
   więcej tokenów rozumowania, a „opracuj kilka podejść" 2,4–7,4×. W obu przypadkach skuteczność nie rosła. Praca
   badała małe zadania i nie sprawdzała zadań zależnych od architektury. Rozgałęzienie w review albo projekcie
   architektury zostaw, ale opisz je w raporcie z kosztem.
3. Sprawdź też założenia bez podstaw w briefach („zakładam, że…", „na pewno działa jak…"). Ta sama praca pokazuje,
   że to jedyny znacznik ujemnie związany ze skutecznością (ρ = −0,19).

## 3. Awarie: model czy harness

1. Zbierz ostatnie porażki agentów, najwyżej 20: czerwone bramy po pracy agenta, werdykty NO-GO, STOP bez
   pytania, cofnięte commity. Źródła: run-logi, raporty review, historia CI.
2. Każdą przypisz do styku dwóch elementów (podejście z arXiv:2607.28802):

| styk | objaw | naprawa |
| --- | --- | --- |
| instrukcja → model | reguły sprzeczne albo niejasne; model wybrał jedną z dwóch | harness: jedna reguła, jedno miejsce |
| brief → podagent | brak zakresu plików, stanu końcowego albo budżetu prób | harness: szablon briefu |
| narzędzie → model | wynik narzędzia za duży, błąd bez komendy naprawy | harness: jedna linia wyniku, reszta na dysku |
| kontekst i pamięć → model | nieaktualna notatka, brak pliku, stara decyzja bez powodu | harness: indeks, data i powód przy decyzji |
| weryfikator → wynik | weryfikator domyślnie zatwierdza | harness: domyślnie FAIL |
| środowisko → wynik | niestabilna brama, brak narzędzia w systemie | środowisko, nie model |
| model sam | ten sam brief, różne rodziny modeli: pada tylko jedna | model |

3. Reguła rozstrzygania: porażka powtarza się w dwóch rodzinach modeli na tym samym briefie → harness. Pada tylko
   jedna rodzina → model. Nie ma drugiej rodziny do porównania → zapisz „nierozstrzygnięte".

## 4. Kontrakt podagenta i orkiestracji

Sprawdź pliki agentów i szablony briefów. Każdy brak to wiersz raportu z `plik:linia`:

1. zakres: lista plików, które wolno zmienić, i zakaz zmian poza nią;
2. stały szablon zwrotu, który wypełnia model;
3. nazwane stany końcowe, np. `Success`, `No-op`, `Blocked`, `Stalled`, `Exhausted`;
4. budżet prób, a po nim STOP;
5. weryfikator, który przy wątpliwości zwraca FAIL;
6. rozgałęzienie powyżej 5 równoległych agentów ma zapisany powód i koszt;
7. proces (kolejność kroków, scalanie, losowanie) w skryptach, a nie w decyzjach modelu.

## 5. Plan napraw

Każda naprawa: co, `plik:linia`, zysk w bajtach × żądania dziennie albo liczba usuniętych porażek, ryzyko.
Kolejność: najpierw największy zysk przy najmniejszym ryzyku. Przepisy na przycięcie prefiksu:

- reguła dla ścieżki → instrukcja z `applyTo` (VS Code) albo reguła z `paths:` (Claude Code); pamiętaj, że jej
  opis i tak trafia do indeksu, więc opis ma jedno zdanie;
- procedura → skill albo prompt;
- uzasadnienie → ADR, w instrukcji najwyżej jedno zdanie;
- tabela komend i roster → plik orkiestratora, nie plik wspólny dla wszystkich;
- opis skilla i agenta → jedno zdanie z wejściem, wyjściem i zakazem;
- agent, który nie deleguje, bez narzędzia podagenta; delegujący z jawną listą `agents:` zamiast `'*'`.

Nie usuwaj reguły bezpieczeństwa bez zamiennika w skrypcie albo hooku.

## 6. Konfigurować czy budować własny harness

| wynik kroków 1–4 | werdykt |
| --- | --- |
| porażki leżą w stykach, które host pozwala zmienić (pliki, briefy, skrypty, hooki) | konfiguruj; nie buduj |
| host nie pozwala zmienić elementu, który powoduje powtarzalne porażki (pętla, kompaktowanie, uprawnienia) | kandydat na własny harness; najpierw zapytaj operatora |
| porażki nierozstrzygnięte | najpierw druga rodzina modeli na tym samym briefie, potem wróć do kroku 3 |

Własny harness oznacza własną pętlę, kompaktowanie, uprawnienia i koszt utrzymania. Nie zaczynaj go w tym runie.

## Raport

Tabele z kroków 1–4, plan z kroku 5 i werdykt z kroku 6 jednym zdaniem z liczbą. Zmiany dopiero po „dalej", jedna
naprawa na commit, a przy każdej pomiar prefiksu przed i po.

## Kryteria ukończenia

- Każdy agent ma liczbę prefiksu w bajtach i częstość (albo „nieznana").
- Jeden agent sprawdzony w widoku hosta, stosunek bajtów do tokenów zapisany.
- Każda porażka z kroku 3 ma styk i werdykt: model, harness, środowisko albo nierozstrzygnięte.
- Plan napraw ma zysk liczbowy przy każdej pozycji.

## Pułapki (sprawdzone)

- Bajty to nie tokeny. Tokeny podawaj tylko z widoku hosta, bo każda rodzina modeli liczy je inaczej.
- Cache promptów obniża cenę powtórzonego prefiksu, ale prefiks zajmuje okno tak samo. Każda zmiana pliku
  wspólnego unieważnia cache wszystkich agentów. VS Code zamraża indeks na pierwszej turze, a zmianę w trakcie
  sesji dosyła osobno.
- Artykuły o harnessach cytują liczby z prac naukowych niedokładnie. Przy liczbie w raporcie podaj pracę, nie
  artykuł. Przykład: „15× tokenów przy kilku podejściach" w jednym artykule to w pracy 2,4–7,4×.
- `.vscode/settings.json` ma klucze z globami (`"**/tools/**"`). Stripper komentarzy JSONC, który nie pomija
  stringów, czyta `/*` wewnątrz nich jako komentarz i psuje plik.
- W VS Code `description` pliku agenta nie trafia do jego własnego okna, ale trafia do okna agenta, który może
  go wywołać. Podagent dostaje te same pliki wspólne co rodzic.
