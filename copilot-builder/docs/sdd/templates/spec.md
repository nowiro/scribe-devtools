---
type: spec
id: 'spec.{{slug}}'
status: draft
title: '{{title}}'
verb: '{{verb}}'
created: '{{date}}'
---

# Spec: {{title}}

> Artefakt SDD, lokalny (`docs/specs/`, gitignorowany). Kształt: `docs/sdd/templates/spec.md`.
> Domknij `[?]` przez `/clarify`, zanim powstanie plan (`status: clarified`). Hierarchia prawdy: AC > makieta > domysł.

## Kontekst

[?] Jaki problem albo potrzebę adresujemy i dlaczego teraz? Skąd zgłoszenie (issue, incydent, decyzja)?

## User story

[?] Jako <persona> chcę <zdolność>, żeby <wynik>.

## Kryteria akceptacji

[?] Zakładając / gdy / wtedy — mierzalne, bez nazw technologii. Numerowane: AC1, AC2, … (plan i testy odwołują się do numeru).

## Zakres i poza zakresem

[?] Lista numerowana tego, co się zmienia z punktu widzenia użytkownika albo systemu; osobno to, czego celowo nie robimy (YAGNI).

## Wejścia i kontrakty

[?] Dane wejściowe, API, makiety (ścieżki), biblioteki (`@cb/<zakres>/<typ>-<nazwa>`), których zmiana dotyka.

## Metryki sukcesu

[?] Liczby, nie hasła: pokrycie dotkniętych projektów, liczba scenariuszy e2e, budżet porcji startowej.

## Ryzyka i klasa ryzyka

[?] auth · rozliczenia · migracja schematu · współbieżność · dane osobowe · brak — klasa ryzyka wymusza review `code-reviewer` przed implementacją.

## Pytania otwarte

[?] Wszystko, co wymaga decyzji przed implementacją — `/clarify` domyka.
