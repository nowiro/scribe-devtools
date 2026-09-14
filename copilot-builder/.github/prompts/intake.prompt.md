---
description: 'Intake zgłoszenia: klasyfikacja (verb, slug), kompletność kryteriów akceptacji, lista [?] — start drabiny SDD'
agent: orchestrator
---

# /intake — ustrukturyzowany intake zgłoszenia

Prowadzisz operatora przez intake nowego zadania. Zbierz KOMPLET przed scaffoldem; braki to pytania
teraz, nie założenia później.

1. **Źródło**: issue GitLaba (`npm run alm:read -- gitlab`, potem `.alm/gitlab/<stempel>/…/issue-<iid>.md`),
   zadanie Jiry (`npm run alm:read -- jira`) albo prompt operatora. Snapshot czytasz wybiórczo.
2. **Klasyfikacja** (`doc-intake`): verb ∈ `feature | fix | refactor | deps | chore | security | docs`,
   slug kebab-case ≤ 5 słów, klasa ryzyka (auth, rozliczenia, migracja, współbieżność, dane osobowe).
3. **Cel biznesowy** (1–2 zdania) i użytkownik końcowy.
4. **Kryteria akceptacji** — numerowane, mierzalne, testowalne; brak = `[?]`.
5. **Zakres i poza zakresem** — lista numerowana; MR i review odwołują się do „punktu 2".
6. **Ekrany / dane / kontrakty** — makiety (ścieżki), źródła danych (API, mock), encje, walidacje.
7. **Próg ceremonii**: ≥ 2 pliki albo zmiana zachowania → pełna drabina; inaczej ścieżka bezpośrednia
   (powiedz to wprost i zakończ).

Wyjście: blok intake (kształt z `doc-intake`) + komenda do wykonania przez operatora albo Ciebie:
`npm run workflow:specify -- --verb=<verb> --slug=<slug> --title="<tytuł>"`. Niejednoznaczna klasyfikacja
= STOP z listą pytań i rekomendacją.
