# Szablon merge requesta w GitLabie

Pipeline GitLaba renderuje każdy MR jako `mr-<iid>.md` — tytuł, gałęzie, stan i opis tak,
jak został napisany. Recenzent i agent czytają to samo, więc opis pisze się raz, dla obu:
co się zmieniło, po co i jak zobaczyć, że działa.

Szkielet poniżej można wkleić żywcem do repozytorium produktowego jako
`.gitlab/merge_request_templates/Default.md`.

## Publikacja z pliku (create / update)

```markdown
---
project: grupa/aplikacja
type: mr
sourceBranch: feat/retry # nowy MR wymaga obu gałęzi
targetBranch: main
draft: true # tylko przy TWORZENIU MR (prefiks tytułu)
# edycja istniejącego: zamiast gałęzi i draft daj `iid: 7` — draft przy
# edycji jest odrzucany głośno, bo GitLab zmienia go wyłącznie przez tytuł
---
```

```bash
npm run alm:create -- gitlab ./mr.md
```

(edycja istniejącego MR-a: `iid: 7` zamiast gałęzi i komenda `update`; komentarz pod
MR-em: `iid: 7` + `comment: true`, treść pliku staje się notką)

## Tytuł

Tryb rozkazujący, zgodny z tematem głównego commita, jeśli taki jest. Prefiks `Draft:` dopóki
MR nie jest gotowy — GitLab blokuje na nim przycisk merge, co bije komentarz „proszę nie
mergować", którego nikt nie czyta.

## Szkielet opisu

```markdown
## Co

Jeden akapit: zmiana widziana spoza diffa.

## Po co

Powód istnienia — podlinkuj issue, incydent albo stronę decyzji.
Jeśli odpowiedź jest w całości w podlinkowanym issue, wystarczy jedna linia i link.

## Jak zweryfikować

1. Dokładne komendy albo kliknięcia. Recenzent, który nie może zweryfikować,
   recenzuje sam diff.
2. Jak wygląda „działa" — output, zrzut ekranu, linia loga.

## Ryzyka / wycofanie

Co może się zepsuć i jak to cofnąć (revert? feature flag? konfiguracja?).

Closes #<issue>
```

## Zasady, które mają znaczenie

- **`Closes #123` jest nośne** — GitLab zamyka issue przy merge'u i łączy oba, a powiązanie
  jest w obu snapshotach. Bez niego issue zostaje otwarte i kłamie.
- **Opis aktualizuje się, gdy MR skręca.** Review zmienia kierunek; opis opisujący rewizję 1
  pod diffem rewizji 7 jest gorszy niż żaden.
- **Małe MR-y biją MR-y z sekcjami.** Jeśli „Co" potrzebuje trzech akapitów, to zwykle są
  dwa MR-y.
