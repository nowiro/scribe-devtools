# Szablon zadania w Jirze

Jak pisać zadanie, żeby człowiek mógł na jego podstawie działać — a jego snapshot
(`npm run alm:read -- jira`) czytał się jak samodzielny brief. Pipeline renderuje każde zadanie
jako `<KLUCZ>.md`: pola stają się listą na górze, a opis ląduje pod `## Description`
**słowo w słowo**. Snapshot mętnego zadania to wierna kopia mętności; struktura poniżej jest
tym, co czyni kopię wartą czytania.

Struktura trzyma się Spec-Driven Development ([spec-kit](https://github.com/github/spec-kit)):
zadanie jest **specyfikacją** — mówi _co_ i _dlaczego_, nigdy _jak_ (od „jak" jest MR).
Trzy zasady, które z tego wynikają:

- **Jedno zadanie = jeden samodzielnie testowalny przyrost.** Jeśli nie da się go
  zweryfikować end-to-end w oderwaniu od reszty, podziel je — priorytety mają sens tylko
  między zadaniami, które można dowieźć osobno.
- **Niejasność zaznaczaj, nie zgaduj.** Marker `[DO WYJAŚNIENIA: pytanie]` wprost w treści;
  implementacja nie startuje, dopóki marker stoi. Cichy domysł autora staje się cichym
  domysłem każdego agenta i człowieka, który zadanie czyta.
- **Kryteria mierzalne i bez nazw technologii** — kryterium ma przeżyć zmianę implementacji.

## Publikacja z pliku (create / update)

Ten szablon jest jednocześnie plikiem wejściowym zapisu (`create`, a z `key:` — `update`): dopisz na samej górze front
matter i opublikuj — najpierw dry-run, zapis po `--yes`:

```markdown
---
project: PROJ # nowe zadanie: project + type; project mozna pominac przy domyslnym JIRA_PROJECT / jira.project
type: Task # edycja istniejącego: zamiast nich `key: PROJ-123`
labels: [reports] # komentarz: TYLKO `key: PROJ-123` + `comment: true` (bez labels i fields)
parent: PROJ-100 # subtask (`type: Subtask`, w starszych projektach `Sub-task`) albo epik; tylko create
fields: # pola własne i pluginowe — żywcem do API
  customfield_10011: 'Sprint 42'
---
```

```bash
npm run alm:create -- jira ./zadanie.md
```

## Summary — tytuł

Jedna linia, w trybie rozkazującym, na tyle konkretna, żeby dała się rozpoznać w kolumnie
tablicy:

- nazwij **obserwowalną zmianę**, nie implementację: `Ponawiaj nieudane uploady raportów`,
  a nie `Dodać try/catch w UploadService`;
- bez ticketowej nowomowy w prefiksach (`[BE]`, `PILNE!!`) — od tego są typ, etykiety
  i priorytet;
- ≤ 70 znaków. Klucz (`PROJ-123`) jest identyfikatorem; summary jest znaczeniem.

## Opis — szkielet

Używaj prawdziwych nagłówków (Heading 2 w edytorze Jiry), nie pogrubionych linii — nagłówki
przeżywają renderowanie do Markdownu jako sekcje `##`, po których agent nawiguje po nazwie.

```text
Kontekst
  Czemu teraz i co zostaje zepsute, jeśli tego nie zrobimy. Jeden akapit.
  Podlinkuj pochodzenie: zgłoszenie z supportu, incydent, decyzję z Confluence.

Zakres
  Co dokładnie się zmienia, z punktu widzenia użytkownika albo systemu — nigdy „jak".
  Lista NUMEROWANA: kryteria, MR i review odwołują się potem do „punktu 2",
  nie do parafrazy.

Kryteria akceptacji
  - Weryfikowalne zdania — każde jest sprawdzeniem, które ktoś może wykonać.
  - "Zakładając / gdy / wtedy" tam, gdzie zachowanie zależy od stanu.
  - Mierzalne tam, gdzie się da (czas, procent, liczba) i bez nazw technologii.
  - Jeśli nie da się tego sprawdzić, to nie jest kryterium — przenieś do Kontekstu.

Przypadki brzegowe
  Co się dzieje na granicach: puste wejście, równoległość, częściowa awaria,
  restart w połowie. Niewiadomą zaznacz [DO WYJAŚNIENIA: pytanie] zamiast zgadywać.

Poza zakresem
  Czego to zadanie celowo NIE obejmuje, żeby nikt nie rozszerzał go po cichu
  komentarzem trzy tygodnie później.

Założenia
  Zależności, stan systemów i decyzje domyślne, na których opierają się kryteria.
  Nieoczywiste założenie zapisane tutaj jest tańsze niż odkryte na review.

Linki
  - Confluence: <strona decyzji albo specyfikacji>
  - GitLab: <MR, gdy już istnieje>
```

## Wypełniony przykład

> **Summary:** Ponawiaj nieudane uploady raportów zamiast je gubić
>
> **Kontekst**
> Od migracji storage'u (INC-2201) ~2% nocnych uploadów raportów pada na przejściowym 503
> i raport ginie po cichu — użytkownik dowiaduje się na koniec miesiąca.
> Decyzja o naprawie po naszej stronie: [Confluence: Niezawodność uploadów](https://example.atlassian.net/wiki/x).
>
> **Zakres**
>
> - Nieudane uploady są ponawiane do 3 razy z backoffem.
> - Przebieg, który wyczerpie ponowienia, pojawia się na kanale ops z id raportu.
>
> **Kryteria akceptacji**
>
> - Zakładając 503 przy pierwszej próbie, upload udaje się w późniejszej próbie
>   i użytkownik widzi dokładnie jeden raport.
> - Zakładając 4 kolejne 503, porażka jest widoczna na #ops-reports w ciągu 5 minut.
> - Brak duplikatów raportów na żadnej ścieżce ponowień (klucz idempotencji na uploadzie).
>
> **Przypadki brzegowe**
>
> - Worker pada między próbami: po restarcie licznik ponowień jest kontynuowany, nie zerowany.
> - [DO WYJAŚNIENIA: raport starszy niż 24 h jeszcze ponawiamy, czy oznaczamy jako utracony?]
>
> **Poza zakresem**
>
> - Ponawianie czegokolwiek poza uploadami; awarie samego generatora zostają jak są.
>
> **Założenia**
>
> - Endpoint storage'u jest idempotentny po kluczu od INC-2201 — bez tego trzecie
>   kryterium wymaga osobnego zadania po stronie platformy.
>
> **Linki**
>
> - Confluence: decyzja o niezawodności uploadów
> - GitLab: reports!482

## Pola

| Pole      | Zasada                                                                                             |
| --------- | -------------------------------------------------------------------------------------------------- |
| Typ       | `Bug` dodaje do Kontekstu kroki reprodukcji (dokładne wejście, oczekiwane, faktyczne); `Task` nie. |
| Priorytet | Ustawiaj świadomie albo wcale — tablica, na której wszystko jest High, nie ma priorytetów.         |
| Etykiety  | lowercase-kebab, z krótkiej uzgodnionej listy; etykiety to zakres JQL, więc bramkują ekstrakcję.   |
| Linki     | Używaj prawdziwych powiązań zadań (`blocks`, `relates to`) — przeżywają do JSON-a snapshotu.       |

Snapshot zachowuje komentarze, worklog i changelog — decyzje podjęte w komentarzach też są
ekstrahowane, ale decyzję zmieniającą Zakres albo Kryteria akceptacji należy **wedytować
w opis**, nie dopisywać jako komentarz #14.
