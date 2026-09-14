# Instrukcja — instalacja, uruchomienie, korzystanie

Narzędzie robi **zrzuty (snapshoty) danych** z Jira, Confluence, GitLab, Sonar, Figma,
tablic Miro, testów Xray i stron WWW — do plików na dysku (`.json` + `.md`), które można czytać, przeszukiwać
i podawać agentom AI jako kontekst. Potrafi też **zapisywać**: tworzyć i edytować zadania
w Jirze, issue i merge requesty w GitLabie, strony w Confluence oraz karteczki na
tablicach Miro — zawsze najpierw na niby (dry-run z diffem), a naprawdę dopiero po `--yes`.

## Instalacja

Wymagane: **Node.js 22+** (aktualne LTS; npm jest w zestawie) i git.

```bash
git clone <adres-repozytorium>
```

```bash
cd <katalog-repozytorium> && npm ci
```

Potem trzy kroki:

1. **Ustaw dostępy** — patrz sekcja [Dostępy i tokeny](#dostępy-i-tokeny) niżej.
2. **Skopiuj przykładowy config** z `examples/` do korzenia repozytorium i wpisz swoje
   dane (klucz projektu, zapytanie JQL itd.):

   ```bash
   cp examples/read.config.jira.json .
   ```

3. **Uruchom:**

   ```bash
   npm run alm:read -- jira
   ```

Wynik ląduje w `.alm/jira/<data>/<nazwa-snapshotu>/` — po jednym pliku `.md` (czytelny)
i `.json` (kompletny) na każde zadanie, plus `_manifest.json` z metadanymi przebiegu.

**Ważne: `--` po nazwie skryptu.** Bez niego npm połyka flagi (np. `--stamp`, `--yes`)
jako własne opcje — po cichu. Pozycyjne argumenty przechodzą i bez `--`, ale jeden nawyk
jest lepszy niż dwie reguły.

`npm run verify` uruchamia wszystkie testy i sprawdzenia; `npm run alm:read`, `npm run alm:create` i `npm run alm:update`
same budują projekt przed startem, więc osobne `npm run alm:build` nie jest potrzebne.

## Dostępy i tokeny

Poświadczenia ustawia się **raz na komputer** (nie per projekt), na dwa sposoby —
zmienna środowiskowa wygrywa z plikiem:

**Plik** `%USERPROFILE%\.config\extract\config.json` (na Linux/macOS:
`~/.config/extract/config.json`). Pełny przykład ze wszystkimi siedmioma sekcjami — sekcje
są opcjonalne, więc zostaw tylko te systemy, których używasz, a resztę usuń:

```json
{
  "jira": {
    "baseUrl": "https://twojafirma.atlassian.net",
    "email": "ty@twojafirma.pl",
    "token": "<token API Atlassian>"
  },
  "confluence": {
    "baseUrl": "https://twojafirma.atlassian.net",
    "email": "ty@twojafirma.pl",
    "token": "<token API Atlassian — może być ten sam co dla Jiry>"
  },
  "gitlab": {
    "project": "grupa/aplikacja",
    "baseUrl": "https://gitlab.twojafirma.pl/api/v4",
    "token": "<personal access token, zakres read_api (api, jeśli używasz zapisu)>"
  },
  "sonar": {
    "baseUrl": "https://sonar.twojafirma.pl",
    "token": "<token użytkownika>"
  },
  "figma": {
    "baseUrl": "https://api.figma.com",
    "token": "<personal access token>"
  },
  "miro": {
    "baseUrl": "https://api.miro.com",
    "token": "<token OAuth aplikacji deweloperskiej>"
  }
}
```

Źródło `xray` **nie ma własnej sekcji** — Xray jest tu wtyczką w Jirze (Server/DC),
więc jedzie w całości na sekcji `jira` (host Jiry, `/rest/raven`). Warto wiedzieć, że
same DEFINICJE testów (typ, scenariusz Cucumbera, kroki manualne jako JSON) mieszkają
w polach własnych Jiry — zwykły snapshot `jira` (`*all`) już je niesie na surowo; tym,
czego pola własne nie mają, są WYNIKI przebiegów, i po nie właśnie sięga `/rest/raven`.
Chmurowy Xray (osobna usługa z parą client id/secret) nie jest obsługiwany — jego klient
istniał do wydania v1.0.0 i stamtąd można go odzyskać, gdyby kiedyś wrócił temat.

Uwagi do przykładu:

- **Jira i Confluence** w chmurze Atlassian mają ten sam `baseUrl` (adres Twojej instancji)
  i akceptują ten sam token API.
- **Domyślny projekt** (`jira.project` — klucz, `gitlab.project` — ścieżka lub id; env:
  `JIRA_PROJECT` / `GITLAB_PROJECT`): pliki zapisu mogą wtedy pomijać `project:` we front
  matter — front matter zawsze wygrywa, a dry-run mówi, że użyto domyślnego.
- **GitLab**: `baseUrl` wskazuje na API, czyli z końcówką `/api/v4`; dla gitlab.com to
  `https://gitlab.com/api/v4`. Do samego czytania wystarczy zakres `read_api`; zapis
  (`create`/`update`) wymaga zakresu `api`.
- **Figma**: `baseUrl` to zawsze `https://api.figma.com` — nie adres pliku.
- **Miro**: `baseUrl` to zawsze `https://api.miro.com`; do odczytu wystarczy scope
  `boards:read`.
- **Xray**: bez własnej sekcji — wtyczka w Jirze, poświadczenia bierze z sekcji `jira`.
- Źródło **browser-inspector** nie ma sekcji — krok `fill` czyta nazwane zmienne środowiskowe.

**Zmienne środowiskowe** — nazwy według wzoru `<ŹRÓDŁO>_BASE_URL`, `<ŹRÓDŁO>_TOKEN`
(dla Jira i Confluence dodatkowo `<ŹRÓDŁO>_EMAIL`), np. `JIRA_BASE_URL`, `JIRA_EMAIL`,
`JIRA_TOKEN`. Zmienna nadpisuje odpowiadający jej klucz z pliku. Źródło `xray` używa
zmiennych `JIRA_*` — własnych nie ma.

Skąd wziąć token:

| System            | Gdzie                                                                              |
| ----------------- | ---------------------------------------------------------------------------------- |
| Jira / Confluence | https://id.atlassian.com/manage-profile/security/api-tokens                        |
| GitLab            | avatar → Preferences → Access tokens                                               |
| Sonar             | My Account → Security → Generate token                                             |
| Figma             | ustawienia konta → Security → Personal access tokens                               |
| Miro              | developers.miro.com → Create new app → zainstaluj w zespole → skopiuj token OAuth  |
| Xray              | bez własnego tokenu — wtyczka w Jirze, używa poświadczeń z wiersza Jira/Confluence |

**Log HTTP** — każda próba żądania i jej odpowiedź lądują w osobnym pliku JSONL:
`.alm/http-log/<skrypt>-<stempel>-<pid>.jsonl` (katalog zmienia `EXTRACT_HTTP_LOG_DIR`,
wyłącza `EXTRACT_HTTP_LOG=0`). Jedna linia = jedna próba, więc retry po 429/5xx widać
jako osobne wpisy; `correlationId` w linii to ten sam identyfikator, który idzie do
upstreamu w nagłówku `x-correlation-id` i do `_manifest.json`. Log niesie metodę, URL,
status, czasy i rozmiary — **nigdy nagłówki ani ciała**, więc sekrety nie mają którędy
wpłynąć (przypięte testem); mimo to URL-e zawierają JQL/zakresy, więc katalog jest
gitignorowany jak każde dane klienta.

Brakujący token nie kończy się stack trace'em — komunikat `E_AUTH_MISSING` podaje
dokładną ścieżkę i klucz, który trzeba uzupełnić.

Gdzie dokładnie leży plik (zawsze **profil użytkownika**, nigdy repozytorium — `git add .`
nie ma jak go dosięgnąć):

| System  | Ścieżka                                                                 |
| ------- | ----------------------------------------------------------------------- |
| Windows | `C:\Users\<ty>\.config\extract\config.json` (`%USERPROFILE%\.config\…`) |
| Linux   | `~/.config/extract/config.json` (honoruje `XDG_CONFIG_HOME`)            |
| macOS   | `~/.config/extract/config.json`                                         |

Utwardzenie dostępu do pliku — na Linux/macOS narzędzie samo ostrzega, gdy uprawnienia są
luźniejsze niż `0600`:

```bash
chmod 600 ~/.config/extract/config.json
```

Na Windows katalog profilu jest domyślnie prywatny; na maszynie współdzielonej można
dodatkowo ograniczyć plik do własnego konta:

```bash
icacls "%USERPROFILE%\.config\extract\config.json" /inheritance:r /grant:r "%USERNAME%:F"
```

Tokeny wystawiaj z **minimalnym zakresem**: do samego czytania wystarczy w GitLabie
`read_api`, a w Sonarze token typu „User"; zakres `api` (zapis) tylko tam, gdzie zespół
faktycznie używa zapisu (`create`/`update`).

## Codzienne użycie — odczyt (read)

| Co                                        | Komenda                                         |
| ----------------------------------------- | ----------------------------------------------- |
| lista dostępnych źródeł                   | `npm run alm:read`                                  |
| zrzut Jiry (config w korzeniu repo)       | `npm run alm:read -- jira`                          |
| wskazany config                           | `npm run alm:read -- jira ./moj.json`               |
| powtarzalny zrzut do tego samego katalogu | `npm run alm:read -- jira --stamp 2026-08-26_12-00` |
| zrzut strony WWW (przez Chrome/Edge)      | `npm run alm:read -- browser-inspector`             |

Co pobrać i skąd — decyduje plik `read.config.<źródło>.json`. Gotowy, działający
przykład każdego źródła leży w `examples\`; opis pól — w [README](README.md). Literówka
w kluczu to **głośny błąd z nazwą klucza**, nie cicho zignorowana opcja — to celowe.

Dwie rzeczy pod duże instancje: bardzo długi opis zadania albo strony **nie zapycha**
widoku `.md` — powyżej progu (`sidecarOverChars`) początek zostaje w `.md`, a całość
w `<zasób>.full.md` (`.json` zawsze pełny). A gdy token nie może czytać metadanych pól
(`/rest/api/3/field`), nazwy pól własnych Jiry podasz sam w configu:
`"fieldNames": { "customfield_10011": "Sprint" }`.

## Zapis — tworzenie i edycja treści (create i update)

Jira, GitLab, Confluence i Miro przyjmują też zapis. Piszesz **jeden plik Markdown**: u góry
front matter (dokąd to ma trafić), potem `# tytuł` i treść — dokładnie tak, jak uczą
szablony w `templates\`:

```markdown
---
project: PROJ
type: Task
labels: [reports]
---

# Ponawiaj nieudane uploady raportów

## Kontekst

Od migracji storage'u ~2% nocnych uploadów pada na przejściowym 503…
```

Potem dwa kroki — najpierw na niby, potem naprawdę:

| Krok                                | Komenda                                   |
| ----------------------------------- | ----------------------------------------- |
| dry-run nowego elementu             | `npm run alm:create -- jira zadanie.md`       |
| zapis nowego elementu               | `npm run alm:create -- jira zadanie.md --yes` |
| dry-run edycji (plik z `key:` itp.) | `npm run alm:update -- jira zadanie.md`       |
| zapis edycji                        | `npm run alm:update -- jira zadanie.md --yes` |

Skąd narzędzie wie, czy to nowy element, czy edycja? **Z pliku**: front matter z `key:`
(GitLab: `iid:`, Confluence/Miro: `id:`/`itemId:`) oznacza edycję, bez niego powstaje nowy
element. Wyjątek: `comment: true` (przy `key:`/`iid:`) TWORZY komentarz, więc to komenda
`create` — nie `update`, mimo klucza w pliku. Komenda `create`/`update` musi się z plikiem
zgadzać — pomyłka niczego nie wysyła, tylko wskazuje właściwą komendę.

Dry-run wypisuje, co by się stało — przy edycji istniejącego elementu pokazuje **diff**
względem tego, co wisi w systemie. Zapis następuje wyłącznie po `--yes`. Kasowania nie ma
w ogóle. Każdy zapis dokleja na końcu treści jedną linię proweniencji („_Utworzono /
Zaktualizowano / Dodano za pomocą narzędzia alm v…_") — widać ją już w dry-runie.

Co potrafi każde źródło (pola front matter):

- **jira** — nowe zadanie (`project` + `type`), edycja (`key: PROJ-123`), komentarz
  (`key` + `comment: true`), subtask lub zadanie pod epikiem (`parent: PROJ-100`, tylko
  przy create). Dodatkowo `labels`, `priority`, a przez `fields:` dowolne
  pola API — w tym pola własne i pluginowe (`customfield_…`).
- **gitlab** — issue i merge requesty: nowe (`project` + `type: issue|mr`; MR wymaga
  `sourceBranch` i `targetBranch`, `draft: true` robi szkic), edycja (`iid`), komentarz
  (`iid` + `comment: true`). `fields:` przekazuje dodatkowe parametry API
  (`milestone_id`, `assignee_ids`…).
- **confluence** — nowa strona (`space: DOCS`, opcjonalnie `parentId`), edycja (`id`).
  `labels` nadaje etykiety (są uchwytem ekstrakcji — nadawaj od razu).
- **miro** — karteczki na tablicy (`boardId`; każdy punktor `- ` w treści pliku to jedna
  karteczka, opcjonalnie `frameId` i `color`), edycja treści karteczki (`itemId`).

Każdy szablon w `templates\` zaczyna się od gotowego front matter do skopiowania.

## Co narzędzie może — a czego nie

| Źródło            | Odczyt                                                | Nowe                 | Edycja                                 |
| ----------------- | ----------------------------------------------------- | -------------------- | -------------------------------------- |
| Jira              | zadania, komentarze, worklog, changelog               | zadanie, komentarz   | tytuł, opis, etykiety, priorytet, pola |
| Confluence        | strony (pojedyncza, drzewo, po etykiecie)             | strona z etykietami  | tytuł, treść; etykiety tylko dokładane |
| GitLab            | issues, merge requesty, pipeline'y                    | issue, MR, komentarz | tytuł, opis, etykiety, dodatkowe pola  |
| Sonar             | quality gate, issues, hotspots, measures              | —                    | —                                      |
| Figma             | tokens, components, styles, podsumowanie              | —                    | —                                      |
| Miro              | lista tablic, elementy tablicy                        | karteczki na tablicy | treść karteczki                        |
| Xray              | testy (kroki, gherkin), egzekucje z przebiegami       | —                    | —                                      |
| browser-inspector | strona WWW: raport, mapa elementów, ekstrakty, zrzuty | —                    | —                                      |

**Usuwać nie można niczego** — narzędzie nie ma takiej funkcji w ogóle. Skasowanie
zadania, komentarza czy strony wykonuje się **wyłącznie ręcznie**, w Jirze / GitLabie / Confluence /
Miro. Tworzenie i edycja zawsze zaczynają się od dry-runu, a zapis wymaga `--yes`.

## Praca w VS Code i IntelliJ

W obu IDE wystarczy **wbudowany terminal** i komendy `npm run …` z tabel powyżej. Pętla
pracy przy zapisie: otwórz swoje `zadanie.md`, w terminalu `npm run alm:create -- jira
zadanie.md`, przeczytaj diff, dopisz `--yes`.

W IntelliJ można komendy raz podpiąć w Settings → Tools → **External Tools** (Program:
`npm`, Arguments: `run create -- jira $FilePath$`, Working directory: katalog
repozytorium) — od tej pory siedzą w menu Tools, także pod prawym przyciskiem.

## Najczęstsze problemy

| Komunikat / objaw                                | Znaczenie i rozwiązanie                                                           |
| ------------------------------------------------ | --------------------------------------------------------------------------------- |
| `E_AUTH_MISSING: …`                              | brak tokenu — komunikat podaje dokładnie, gdzie go wpisać                         |
| `unknown source "…"`                             | literówka w nazwie źródła — poprawna lista jest w tym samym komunikacie           |
| `missing config file …`                          | brak pliku konfiguracyjnego — skopiuj przykład z `examples\` i uzupełnij          |
| `front matter is not valid`                      | literówka w nagłówku pliku zapisu — błąd wymienia zły klucz po nazwie             |
| `missing input file` (create/update)             | zabrakło pliku Markdown w komendzie — `npm run alm:create -- jira zadanie.md`         |
| `E_READ_NOT_BUILT`                               | brak zbudowanych pipeline'ów — `npm run alm:build` (albo po prostu `npm run alm:read`)    |
| `--stamp` „nie działa"                           | zabrakło `--` po `read` — npm połknął flagę                                       |
| `E_BROWSER_MISSING` (źródło `browser-inspector`) | brak Chrome/Edge w systemie — zainstaluj przeglądarkę albo wskaż `executablePath` |
