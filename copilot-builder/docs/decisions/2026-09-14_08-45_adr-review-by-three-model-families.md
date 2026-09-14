---
type: decision
id: 'adr.review-by-three-model-families'
status: accepted
date: '2026-09-14'
stamp: '2026-09-14_08-45'
title: 'ADR — review kodu jako weryfikacja krzyżowa przez trzy rodziny modeli'
---

# ADR: review kodu przez trzy rodziny modeli

Uzupełnia [ADR o rosterze i tierach](2026-09-13_21-34_adr-copilot-roster-and-model-tiers.md) (punkt 4 —
tiery — i rolę reviewer); tamten ADR pozostaje w mocy.

## Kontekst

Review kodu wykonywał jeden agent (`code-reviewer`) na jednym modelu z tieru senior. Jeden model ma jeden
zestaw ślepych plam, a druga i trzecia tura na tym samym modelu powtarza te same przeoczenia za tę samą
cenę. Przegląd tego szablonu przed pierwszym wydaniem (sekcja „Fixed" w `CHANGELOG.md`) został zrobiony
niezależnymi odczytami i każdy z nich znalazł usterki, których pozostałe nie zgłosiły. Wiarygodne jest
to, co przetrwa niezależną weryfikację — a „niezależny" musi być mechanizmem, który da się zwalidować
skryptem, nie prośbą w prompcie.

## Decyzja

**Review kodu to weryfikacja krzyżowa: trzy miejsca (`review.seats` w `.github/models-registry.json`)
dostają identyczny brief i identyczny pełny zakres, a różnią się wyłącznie rodziną modelu; orkiestrator
scala trzy tabele i liczy, ile rodzin zgłosiło to samo.**

1. Miejsca `code-reviewer-anthropic`, `code-reviewer-openai`, `code-reviewer-moonshot` — rola `reviewer`,
   `user-invocable: false`, hook `deny-writes`; ten sam zakres w każdym pliku agenta: architektura,
   jakość i testowalność, bezpieczeństwo, SOLID/DRY/KISS/YAGNI.
2. Miejsca i ich tiery nazywają się po rodzinie modelu (`code-reviewer-<rodzina>`, `senior-<rodzina>`),
   a `review.seats` w rejestrze mówi, którą rodzinę każde miejsce obiecuje. Brama `ai:validate` A18
   sprawdza, że model za tierem miejsca jest z obiecanej rodziny i że trzy rodziny są różne. Zmiana
   dostawcy to zmiana nazwy agenta, tieru i wpisu w `review.seats` — wszystko pod bramą; wymagane są
   trzy rodziny, nie ci trzej dostawcy.
3. Niezależność: brief identyczny (lista plików, baza diffu, AC), żadne miejsce nie dostaje raportu
   innego. Scalanie w `orchestrator`: ta sama para plik + linia to jeden wiersz z najwyższym kolorem
   i liczbą zgodnych miejsc — `3×` / `2×` potwierdzone, `1×` kandydat; 🔴 potwierdzone wraca do
   właściciela ścieżki, 🔴 `1×` idzie do operatora z pytaniem, czy prawdziwe; 🔴 kontra 🟢 to pytanie,
   nie średnia; werdykt scalony = najgorszy z trzech.
4. Run-log zapisuje model zaobserwowany w każdym miejscu. Dwa miejsca na jednej rodzinie (klient
   ograniczył model delegacji) = review niepełny — decyzja operatora, nie zastępstwo innym agentem.

## Odrzucone alternatywy

| Alternatywa                                                    | Powód odrzucenia                                                                                                                                 |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| jeden reviewer, trzy przebiegi                                 | te same ślepe plamy trzy razy; trzykrotny koszt bez niezależności                                                                                |
| trzech agentów na jednym modelu z różnymi promptami            | prompt zmienia pytanie, nie czytelnika; A18 nie miałoby czego pilnować                                                                           |
| podział soczewek: architektura / jakość / bezpieczeństwo po jednej rodzinie | każdy plik pod daną soczewką czyta jedna rodzina, więc zgodność miejsc nic nie mówi — weryfikacja wymaga, żeby każda rodzina odpowiedziała na to samo pytanie |
| reviewerzy widoczni w pickerze, człowiek wybiera               | picker przestaje mieć jedno wejście; niezależność zależy od tego, kogo człowiek kliknie                                                          |
| review przez model spoza rejestru (własny endpoint)            | łamie „nazwa modelu tylko w rejestrze" i politykę planu organizacji                                                                              |

## Konsekwencje

- Koszt review to trzy miejsca senior na wejściu; brief to lista plików i diff, nie historia rozmowy, a to,
  co rozstrzyga brama (`lint`, `typecheck`, `build`, `check:secrets`), nadal nie jest przedmiotem review.
- Rodzina `moonshot` to model open-weight hostowany przez GitHub, w planach Business i Enterprise
  domyślnie wyłączony — administrator włącza politykę albo miejsce moonshot zostaje zastąpione miejscem innej rodziny
  (nowa nazwa agenta, tieru i wpis w `review.seats`); brama pilnuje zgodności nazwy z rodziną i liczby rodzin.
- Nowa reguła A18 w `tools/scripts/validate-ai-config.mjs` (z testem); roster, `AGENTS.md`, `README.md`,
  `GLOSSARY.md`, metodyka i szablony SDD, prompt `/review` i tabela routingu nazywają trzy miejsca.
- Zadania klasy ryzyka dostają przed implementacją wiersz review przez trzy miejsca.
- `code-reviewer-ui` ocenia zrzuty na pięciu szerokościach `ui.viewports` (odstępy, wyrównania,
  nachodzenie, scroll, stany) względem makiety; pomiary dostarcza flow browser-inspectora.
