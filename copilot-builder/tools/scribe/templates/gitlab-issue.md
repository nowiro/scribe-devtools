# Szablon issue w GitLabie

Pipeline GitLaba renderuje każde issue jako `issue-<iid>.md` — tytuł, stan, etykiety i opis
tak, jak został napisany. Opisy w GitLabie już są Markdownem, więc co wpiszesz, to dokładnie
niesie snapshot: nagłówki stają się nawigowalnymi sekcjami, listy zadań zostają listami zadań.

Szkielet poniżej można wkleić żywcem do repozytorium produktowego jako
`.gitlab/issue_templates/Default.md` — GitLab zaproponuje go wtedy w wyborze szablonu opisu
przy każdym nowym issue.

Struktura jest ta sama co w [szablonie Jiry](jira-issue.md) i trzyma się Spec-Driven
Development ([spec-kit](https://github.com/github/spec-kit)): issue jest **specyfikacją** —
mówi _co_ i _dlaczego_, nigdy _jak_ (od „jak" jest MR). Jedno issue to jeden samodzielnie
testowalny przyrost — jeśli nie da się go zweryfikować end-to-end w oderwaniu od reszty,
podziel je. Niejasność zaznaczaj markerem `[DO WYJAŚNIENIA: pytanie]` wprost w treści;
implementacja — człowieka i agenta, któremu issue przypisano — nie startuje, dopóki
marker stoi.

## Publikacja z pliku (create / update)

```markdown
---
project: grupa/aplikacja # ścieżka albo numeryczne id; można pominąć przy domyślnym GITLAB_PROJECT / gitlab.project
type: issue # edycja istniejącego: dodaj `iid: 42`
labels: [team::reports] # komentarz: TYLKO project, type, `iid: 42` + `comment: true` (bez labels)
---
```

```bash
npm run alm:create -- gitlab ./issue.md
```

## Tytuł

Ta sama zasada co dla summary w Jirze: jedna linia w trybie rozkazującym, nazywająca
obserwowalną zmianę, ≤ 70 znaków. `Ponawiaj nieudane uploady raportów`, a nie `Naprawić
uploady` ani `Usprawnienia UploadService`.

## Szkielet opisu

```markdown
## Kontekst

Czemu teraz i co zostaje zepsute, jeśli tego nie zrobimy. Podlinkuj pochodzenie —
incydent, zgłoszenie z supportu, dyskusję.

## Zakres

1. Co dokładnie się zmienia, z punktu widzenia użytkownika albo systemu — nigdy „jak".
2. Lista numerowana — kryteria, MR i review odwołują się do „punktu 2", nie do parafrazy.

## Kryteria akceptacji

- [ ] Weryfikowalne zdania — każdy checkbox to sprawdzenie, które ktoś może wykonać.
- [ ] "Zakładając / gdy / wtedy" tam, gdzie zachowanie zależy od stanu.
- [ ] Mierzalne tam, gdzie się da (czas, procent, liczba), bez nazw technologii.

## Przypadki brzegowe

- Granice: puste wejście, równoległość, częściowa awaria, restart w połowie.
- Niewiadomą zaznacz `[DO WYJAŚNIENIA: pytanie]` zamiast zgadywać.

## Poza zakresem

Czego to issue celowo nie obejmuje.

## Założenia

Zależności i decyzje domyślne, na których opierają się kryteria.

/label ~"team::reports"
```

Dwa GitLabowe mechanizmy warte używania:

- **Listy zadań** (`- [ ]`) w Kryteriach akceptacji — GitLab pokazuje postęp na karcie issue,
  a snapshot zachowuje stan zaznaczenia.
- **Quick actions** (`/label`, `/milestone`) na końcu opisu — wykonują się przy zapisie
  i znikają z tekstu, więc szablon sam ustawia rutynowe pola.

## Pola

| Pole        | Zasada                                                                                     |
| ----------- | ------------------------------------------------------------------------------------------ |
| Etykiety    | lowercase, scoped tam, gdzie oś jest wykluczająca (`team::reports`, `severity::2`).        |
| Milestone   | Ustawiaj, gdy issue jest zaplanowane, nie gdy jest pisane — pusty milestone to informacja. |
| Przypisanie | Jedna osoba. „Przypisani wszyscy" ekstrahuje się dokładnie tak, jak czyta się „nikt".      |
