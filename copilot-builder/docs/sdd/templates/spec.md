---
type: spec
id: 'spec.{{slug}}'
status: draft
title: '{{title}}'
verb: '{{verb}}'
created: '{{date}}'
---

# Spec: {{title}}

> Artefakt SDD, lokalny (`docs/specs/`, gitignorowany). Każda niepewność to `[?]`. `[?]` domyka `/clarify`
> (`status: clarified`). Kolejność prawdy: AC, potem makieta, potem nic.

## Kontekst

[?] Jaki problem albo potrzebę adresujemy i dlaczego teraz? Skąd zgłoszenie (issue, incydent, decyzja)?

## User story

[?] Jako <persona> chcę <zdolność>, żeby <wynik>.

## Kryteria akceptacji

[?] Zakładając / gdy / wtedy. Mierzalne, bez nazw technologii. Numerowane: AC1, AC2, … (plan i testy odwołują się do numeru).

## Zakres i poza zakresem

[?] Lista numerowana tego, co się zmienia dla użytkownika albo systemu. Osobno to, czego celowo nie robimy.

## Wejścia i kontrakty

[?] Dane wejściowe, API, makiety (ścieżki), biblioteki (`@cb/<zakres>/<typ>-<nazwa>`), których zmiana dotyka.

## Metryki sukcesu

[?] Liczby, nie hasła: pokrycie dotkniętych projektów, liczba scenariuszy e2e, budżet porcji startowej.

## Ryzyka i klasa ryzyka

[?] auth · rozliczenia · migracja schematu · współbieżność · dane osobowe · brak. Klasa inna niż „brak" wymusza
review przed implementacją przez miejsca z `npm run review:draw`.

## Pytania otwarte

[?] Wszystko, co wymaga decyzji przed implementacją. `/clarify` domyka.
