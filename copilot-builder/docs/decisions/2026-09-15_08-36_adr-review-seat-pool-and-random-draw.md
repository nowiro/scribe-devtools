---
type: decision
id: 'adr.review-seat-pool-and-random-draw'
status: accepted
date: '2026-09-15'
stamp: '2026-09-15_08-36'
title: 'ADR — pula miejsc review większa niż jeden review; miejsca do review losuje skrypt (review.seatsPerReview)'
---

# ADR: pula miejsc review i losowanie miejsc do jednego review

Uzupełnia [ADR o review przez trzy rodziny modeli](2026-09-14_08-45_adr-review-by-three-model-families.md);
tamten ADR pozostaje w mocy: miejsca dostają ten sam brief i pełny zakres, różnią się wyłącznie rodziną
modelu, brama A18 pilnuje, że rodziny są różne. Zmienia się liczba miejsc w puli i to, ile z nich czyta
jeden review.

## Kontekst

Rejestr miał dokładnie trzy miejsca review i każdy review szedł do wszystkich trzech. Dołożenie czwartej
rodziny (`google`) w tym kształcie oznaczałoby cztery odczyty przy każdym review — o jedną trzecią drożej —
albo wybór trzech z czterech przez orkiestratora, czyli przez model na tierze `fast`, który poproszony
o „losowo" bierze pierwsze nazwy, jakie pamięta, i za każdym razem te same. Więcej rodzin w puli jest
wartością (ślepe plamy dostawców rotują między review), ale koszt jednego review ma zostać stały i nie
może zależeć od tego, co model uzna za losowe.

## Decyzja

**`review.seats` w `.github/models-registry.json` jest PULĄ miejsc; `review.seatsPerReview` mówi, ile z nich
czyta jeden review; które — losuje skrypt `npm run review:draw`, a losowanie jest zapisane i czytane przez
`review:merge`.**

1. Czwarte miejsce `code-reviewer-google` (tier `main-google`, rodzina `google`) wchodzi do puli na tych
   samych zasadach co pozostałe: rola `reviewer`, `user-invocable: false`, hook `deny-writes`, plik agenta
   z tego samego szablonu, nazwa po rodzinie.
2. `npm run review:draw -- <katalog review>` losuje `review.seatsPerReview` miejsc z puli (bez zwracania,
   w kolejności rejestru), drukuje `<agent>  <rodzina>` po jednym w linii i zapisuje `draw.json` w katalogu.
   Ponowne uruchomienie nad tym samym katalogiem drukuje zapisane losowanie i nie losuje — briefy mogły
   już wyjść; nowe losowanie to usunięcie pliku przez człowieka.
3. `npm run review:merge -- <katalog>` czyta `draw.json` jako listę rodzin, które mają oddać raport; bez
   pliku oczekuje całej puli. Brak raportu wylosowanej rodziny i raport rodziny spoza losowania są uwagami
   scalania, jak dotąd — orkiestrator na „brak raportu rodziny" robi STOP i nie losuje ponownie.
4. Brama `ai:validate` A20: `review.seatsPerReview` jest liczbą całkowitą od 2 do rozmiaru puli. Wartość
   równa rozmiarowi puli = każde miejsce czyta każdy review (dotychczasowy kształt). Dziś: pula cztery,
   review trzy — koszt review bez zmian, rodziny rotują.
5. Wiersz „review przed implementacją" w planie (klasa ryzyka) dostaje agentów z `review:draw` nad
   katalogiem `docs/runs/<stempel>_review-<slug>-pre`, nie listę z pamięci.

## Odrzucone alternatywy

| Alternatywa                                          | Powód odrzucenia                                                                                                              |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| cztery miejsca, każdy review do wszystkich           | koszt review rośnie z każdą rodziną w puli; pula przestaje być tania w rozbudowie                                              |
| orkiestrator wybiera miejsca                         | model `fast` „losuje" tak samo za każdym razem; wybór bez zapisu, więc `review:merge` nie wie, czego oczekiwać                 |
| stała rotacja (kolejny review = kolejna trójka)      | wymaga stanu między review (licznik w repozytorium); losowanie ze skryptu nie potrzebuje niczego poza rejestrem                |
| liczba miejsc w promptcie `/review` zamiast w rejestrze | druga prawda obok rejestru; brama nie miałaby czego pilnować                                                               |

## Konsekwencje

- Katalog review (`docs/runs/<stempel>_review-<slug>/`) zawiera `draw.json` obok raportów; `doc-spec` dopisuje
  wylosowane miejsca do raportu scalonego w `docs/reviews/`.
- Zmiana liczby miejsc w jednym review to jedna liczba w rejestrze pod bramą; nowa rodzina to jedno miejsce
  więcej w puli (agent z szablonu, tier `main-<rodzina>`, wpis w `review.seats`), bez zmiany kosztu review.
- Teksty, które mówiły „trzy miejsca", mówią „miejsca z puli `review.seats`" i „`review.seatsPerReview`";
  liczby stoją tylko w rejestrze.
- Rodzina `google` podlega polityce planu Copilota jak każda inna — model tieru `main-google` musi być na
  liście `policy.enabled` (A2); gdy plan go nie wystawia, miejsce znika z puli tak samo jak `moonshot`
  w poprzednim ADR.
- Nowy skrypt `tools/scripts/review-draw.mjs` (z testem), `review-merge.mjs` czyta `draw.json`, reguła A20
  w `validate-ai-config.mjs` (z testem); roster, `AGENTS.md`, `README.md`, `GLOSSARY.md`, metodyka, skill
  `sdd-scripts`, prompty `/review` i `/plan`, procedura orkiestratora (review w 9 krokach).
