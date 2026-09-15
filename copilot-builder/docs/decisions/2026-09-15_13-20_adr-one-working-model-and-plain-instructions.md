---
type: decision
id: 'adr.one-working-model-and-plain-instructions'
status: accepted
date: '2026-09-15'
stamp: '2026-09-15_13-20'
title: 'ADR — jeden model roboczy (tier fast = base) i instrukcje pisane pod mały model'
---

# ADR: jeden model roboczy i instrukcje pod mały model

## Kontekst

Copilot rozlicza tokeny po cenniku dostawcy. Najtańszy model w pickerze organizacji kosztuje na wejściu około
dziesięć razy mniej niż droższy model rodziny anthropic i prawie cztery razy mniej niż model, który dotąd trzymał
tier `base`. Szablon od początku zakłada, że model nie improwizuje: procedury z dokładnymi komendami, tabele
przez skrypty, bramy jako definicja ukończenia, review krzyżowe przez kilka rodzin. Instrukcje były jednak pisane
dla mocnego modelu: długie zdania, uzasadnienie obok każdej reguły, odsyłacze w łańcuchu, procedura review
i przeglądu wizualnego wewnątrz pliku orkiestratora o rozmiarze 18 kB, stempel przez jednolinijkowiec `node -e`,
a kilkanaście komend SDD bez auto-zatwierdzenia, więc każde wywołanie kończyło się kliknięciem człowieka.

## Decyzja

**Tiery `fast` i `base` wskazują ten sam, najtańszy model z pickera. Miejsca review zostają na czterech
rodzinach. Każdy plik w `.github/` jest pisany tak, żeby wykonał go mały model.**

1. Rejestr: `fast`, `base` i miejsce review rodziny openai to jeden model. Miejsce anthropic to droższy model tej
   rodziny (jedyny wyjątek od „najtańszy w rodzinie", decyzja operatora z 2026-09-15). `vision` to jedyny model,
   za który rejestr ręczy jako czytający zrzuty. Nazwy modeli stoją tylko w rejestrze i w linii `model:` agentów (A5).
2. Zasady pisania stoją w sekcji „Jak pisać dla małego modelu" w `.github/instructions/copilot-config.instructions.md`:
   jedno zdanie = jedna instrukcja, kroki numerowane z dokładną komendą albo ścieżką, stały kształt zwrotu,
   bez uzasadnień (powód stoi w ADR), bez odsyłaczy w łańcuchu, tabele do 4 kolumn, warunek i akcja w jednym zdaniu.
3. Procedura review i przeglądu wizualnego wychodzi z pliku orkiestratora do skilla `review-procedure`. Krok 7
   procedury mówi: „przeczytaj plik, wykonaj kroki 1–9".
4. Prompt to wejście od człowieka plus numer kroku procedury orkiestratora plus to, co prompt dodaje. Prompt nie
   powtarza procedury.
5. Stempel daje `npm run stamp`. Komendy SDD (`sdd`, `route`, `review:draw`, `review:merge`, `workflow:specify`,
   `stamp`) i bramy statyczne są auto-zatwierdzane w `.vscode/settings.json`. Limit żądań na turę: 60.

## Odrzucone alternatywy

| Alternatywa                                          | Powód odrzucenia                                                                                                                              |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| droższy model na `base`, instrukcje bez zmian        | koszt każdego briefu kilka razy wyższy; instrukcje dalej wymagały domyślania się, więc i mocniejszy model gubił kroki                        |
| wszystkie miejsca review na jednym modelu            | jedna rodzina to jedno czytanie; A18 i ADR o review przez rodziny mówią, dlaczego to nie jest weryfikacja krzyżowa                            |
| cała procedura orkiestratora jako skille             | skill ładuje się, gdy model uzna go za pasujący; mały model nie robi tego niezawodnie; szkielet zostaje w pliku agenta, długie sekcje czyta jawnie w kroku |
| okno 1M jako sposób na „załadować wszystko"          | powyżej 200K wejście kosztuje podwójnie, a szablon trzyma wyniki na dysku, więc żadne żądanie nie potrzebuje takiego okna                     |

## Konsekwencje

- Kontekst always-on (`.github/copilot-instructions.md` + `AGENTS.md`) zmalał z 20,1 kB do 14,5 kB; plik
  orkiestratora z 18,2 kB do 14,2 kB, a 2,8 kB procedury review czyta się tylko w kroku 7. Każdy brief do
  subagenta płaci mniej.
- Gdy `base` na najtańszym modelu za często kończy się drugim `FAIL` i STOP, jedna edycja `tiers.base`
  w rejestrze przenosi kod na droższy model. Bramy się nie zmieniają.
- Nowy plik w `.github/` pisze się według sekcji „Jak pisać dla małego modelu". `doc-reviewer` sprawdza ją
  w przeglądzie.
- Szablony `docs/sdd/templates/` nie wymieniają miejsc review z nazwy: wpisuje je wynik `npm run review:draw`.

## Powiązane

- [ADR — roster i tiery](2026-09-13_21-34_adr-copilot-roster-and-model-tiers.md)
- [ADR — review przez rodziny modeli](2026-09-14_08-45_adr-review-by-three-model-families.md)
- [ADR — pula miejsc review i losowanie](2026-09-15_08-36_adr-review-seat-pool-and-random-draw.md)
- `.github/instructions/copilot-config.instructions.md`, `.github/skills/review-procedure/SKILL.md`
