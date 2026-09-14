# Szablon tablicy w Miro

Pipeline Miro renderuje tablicę jako `board.md`: elementy pogrupowane po typie
(`sticky_note`, `card`, `frame`, `text`…), z tekstu zdjęte tagi HTML. Snapshot jest **tylko
do odczytu** i wiernie kopiuje to, co na tablicy jest — tablica-mgławica daje snapshot-
mgławicę. Poniższe zasady sprawiają, że zrzut czyta się jak dokument, a nie jak wysypane
karteczki.

## Konfiguracja ekstrakcji

```json
{
  "outputDir": "./.alm/miro",
  "snapshots": [{ "name": "warsztat-retro", "type": "board", "boardId": "uXjVN2wR8sY=", "maxItems": 2000 }]
}
```

`boardId` znajdziesz w adresie tablicy (`miro.com/app/board/<boardId>/`). Typ `boards`
(bez `boardId`) robi inwentarz wszystkich tablic — przydatny, żeby w ogóle znaleźć id.

## Publikacja karteczek z pliku (create / update)

Tablica przyjmuje też zapis — każdy punktor `- ` w treści pliku staje się jedną karteczką
(układaną w siatkę 5 na rząd), a `itemId` zamiast tego edytuje treść istniejącej:

```markdown
---
boardId: uXjVN2wR8sY=
frameId: '3458764' # opcjonalnie: ramka-rodzic
color: light_green # opcjonalnie: kolor z palety Miro
---

- retry uploadów wszedł przed czasem — dobra dekompozycja PROJ-341
- brakuje alertu na error rate po stronie vendora
```

```bash
npm run alm:create -- miro ./karteczki.md
```

(dry-run wypisuje każdą karteczkę; zapis po `--yes`; kasowania nie ma)

## Zasady, które czynią snapshot czytelnym

1. **Tekst, nie obrazki.** Ekstrakcja czyta `data.content` i `data.title` — treść wklejona
   jako screenshot albo narysowana strzałkami jest dla snapshotu **niewidzialna**. Decyzja
   zapisana na karteczce przeżywa; decyzja zapisana na zdjęciu flipcharta nie.
2. **Ramki (frames) to sekcje.** Nadawaj ramkom tytuły mówiące („Do zrobienia",
   „Zdecydowane", „Parking") — tytuł ramki jest w snapshocie, a elementy niosą `parentId`
   ramki, więc strukturę da się odtworzyć.
3. **Jedna karteczka, jedna myśl, pełnym zdaniem.** Karteczka „API!!" mówi coś tylko
   autorowi i tylko przez tydzień. Karteczka „API płatności zwraca 500 przy pustym
   koszyku — do naprawy przed demo" jest samodzielnym faktem.
4. **Klucze zadań w tekście.** Napisz `PROJ-123` na karteczce, która ma swoje zadanie —
   w snapshocie zostanie to powiązaniem, które agent umie połączyć ze snapshotem Jiry.
5. **Skasuj brudnopis przed ekstrakcją.** Snapshot liczy wszystko, także puste kształty
   („`image (14)`" bez żadnego tekstu to szum, który zaciemnia raport).

## Wypełniony przykład — jak to wygląda po ekstrakcji

> **Retro sprintu 42 — uXjVN2wR8sY=**
>
> ## frame (3)
>
> - Co poszło dobrze
> - Co poprawić
> - Akcje (PROJ-…)
>
> ## sticky_note (5)
>
> - Retry uploadów wszedł przed czasem — dobra dekompozycja PROJ-341
> - Za późno zauważyliśmy 503 od vendora — brakuje alertu na error rate
> - Akcja: alert na 5xx w #ops-reports, właściciel A. Kowalska, PROJ-350
> - …
