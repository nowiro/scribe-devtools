# Szablon strony w Confluence

Pipeline Confluence renderuje każdą stronę jako `<pageId>.md` — tytuł, etykiety i treść
przekonwertowaną z formatu storage Confluence do Markdownu. Nagłówki przeżywają jako sekcje
`##`; strona napisana jako jedna nieprzerwana ściana tekstu jest snapshotowana jako jedna
nieprzerwana ściana tekstu.

Najwięcej troski należy się tutaj etykietom: snapshot typu `label` ekstrahuje **po
etykiecie**, więc etykiety są uchwytem ekstrakcji. Uzgodnijcie krótką listę (`adr`, `spec`,
`runbook`) i używajcie jej konsekwentnie — nieoetykietowana strona decyzyjna jest niewidzialna
dla ekstraktu zawężonego etykietą.

Snapshot czyta nie tylko człowiek — z tych plików składa się brief agenta. Trzy reguły
Spec-Driven Development ([spec-kit](https://github.com/github/spec-kit)), wspólne
z szablonami issue, robią największą różnicę w tym, co AI ze strony zrozumie:

- **Zdania normatywne odróżniaj od opowieści.** W specyfikacji „musi / powinien / może" to
  słowa kluczowe — agent odróżni wymaganie od narracji tylko wtedy, gdy odróżnia je język.
- **Numeruj wymagania** (FR-1, FR-2…). Zadanie w Jirze i MR odwołują się do numeru, nie do
  parafrazy — dopiero to spina spec → zadanie → kod w łańcuch, po którym da się przejść.
- **Niejasność zaznaczaj, nie zgaduj:** `[DO WYJAŚNIENIA: pytanie]` wprost w treści. Bez
  markera agent czyta otwartą kwestię tak samo jak podjętą decyzję.

## Publikacja z pliku (create / update)

```markdown
---
space: DOCS # nowa strona: klucz przestrzeni (opcjonalnie parentId)
parentId: '123' # edycja istniejącej: zamiast nich `id: "456"`
labels: [adr] # etykiety nadawane od razu — to uchwyt ekstrakcji
---
```

```bash
npm run alm:create -- confluence ./strona.md
```

## Tytuł

Fraza rzeczownikowa, którą ktoś wpisałby w wyszukiwarkę: `Niezawodność uploadów — decyzja
o ponowieniach`, a nie `Notatki 2026-08` ani `Różne`. Tytuł to jedyna część strony widoczna
w listingu snapshotu `tree`, więc musi nieść tożsamość strony sam.

## Szkielet strony

```text
Status: szkic | przyjęte | zastąpione przez <link>     (jedna linia na samej górze)
Właściciel: <osoba>    Ostatni przegląd: <data>

TL;DR
  Maksymalnie trzy zdania. Czytelnik, który zatrzyma się tutaj, i tak powinien
  wyjść z decyzją albo sednem — nie z "to skomplikowane".

Kontekst
  Sytuacja, przez którą ta strona jest potrzebna. Liczby i linki, nie przymiotniki.

<Treść>
  Dla decyzji (ADR): rozważone opcje, decyzja i dlaczego — łącznie z tym,
  czemu przegrały opcje przegrane.
  Dla specyfikacji: zachowanie, sekcjami, od najczęściej używanego. Wymagania
  jako lista numerowana (FR-1, FR-2…) w języku „musi/powinien" — co, nigdy „jak".
  Dla runbooka: numerowane kroki, każdy jest komendą albo sprawdzeniem.

Założenia
  Na czym opiera się treść: zależności, stan systemów, decyzje domyślne.
  Złamane założenie wysyła stronę do przeglądu — nie do cichego ignorowania.

Konsekwencje / kontynuacje
  Co staje się prawdą po przyjęciu — łącznie z nieprzyjemnymi częściami,
  i klucze zadań Jira z pracą do dokończenia.

Linki
  Epik/zadania w Jirze, MR-y w GitLabie, powiązane strony.
```

## Wypełniony przykład

> **Niezawodność uploadów — decyzja o ponowieniach**
> Etykiety: `adr`, `reports`
>
> Status: przyjęte · Właściciel: A. Kowalska · Ostatni przegląd: 2026-08-20
>
> **TL;DR** — Nocne uploady raportów dostają po naszej stronie 3 ponowienia z backoffem;
> nie przechodzimy w tym kwartale na asynchroniczne API vendora. Porażki, które przetrwają
> ponowienia, alarmują #ops-reports.
>
> **Kontekst** — Od migracji storage'u (INC-2201) ~2% uploadów pada na przejściowych 503;
> ETA poprawki u vendora to Q1 2027…
>
> **Opcje** — (1) ponowienia po stronie klienta, (2) asynchroniczne API vendora,
> (3) zaakceptowanie strat. Asynchroniczne API przegrywa kosztem integracji w tym kwartale;
> akceptacja 2% strat przegrywa zaufaniem na koniec miesiąca…
>
> **Założenia** — 503 są przejściowe (wg INC-2201 mediana poniżej minuty); poprawka vendora
> nie przyjdzie przed Q1 2027 — gdy przyjdzie, strona wraca do przeglądu.
>
> **Konsekwencje** — Klucze idempotencji na uploadach (PROJ-341); wykrywanie duplikatów
> staje się testowalne; wracamy do tematu, gdy vendor wypuści poprawkę.
>
> **Linki** — PROJ-341, reports!482, INC-2201

## Zasada, która ma znaczenie

Jedna strona, jeden cel. Strona w połowie będąca specyfikacją, a w połowie notatkami ze
spotkania, ekstrahuje się jako obie i służy jako żadna — rozdziel ją, oetykietuj każdą połowę
i połącz linkami.
