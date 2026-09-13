## Co

Jeden akapit: zmiana widziana spoza diffa.

## Po co

Powód istnienia — podlinkuj issue, incydent albo decyzję (ADR w `docs/decisions/`).
Jeśli odpowiedź jest w całości w podlinkowanym issue, wystarczy jedna linia i link.

## Jak zweryfikować

1. Dokładne komendy albo kliknięcia. Recenzent, który nie może zweryfikować, recenzuje sam diff.
2. Jak wygląda „działa" — output, zrzut ekranu, linia loga.

## Ryzyka / wycofanie

Co może się zepsuć i jak to cofnąć (revert? flaga? konfiguracja?).

## Definition of Done

- [ ] `npm run verify` zielone lokalnie; pipeline zielony.
- [ ] Każde kryterium akceptacji z issue ma test (unit albo e2e) i jest odhaczone w issue.
- [ ] Spec bez otwartych `[?]`; plan zaktualizowany (`docs/plans/`, lokalnie).
- [ ] Zmiana zachowania ma test; decyzja nieodwracalna ma ADR w `docs/decisions/` + wiersz w `docs/INDEX.md`.
- [ ] Zero `.only` / `.skip`, zero `TODO` w kodzie (zadania żyją w issue).
- [ ] Commity w konwencji `type(scope): subject` (commitlint), gałąź `type/slug`.

Closes #<issue>
