---
description: 'Publikacja do ALM przez scribe: spec → issue/MR GitLab albo zadanie Jira z pliku Markdown; dry-run domyślny, --yes tylko na polecenie'
agent: orchestrator-sdd
---

# /alm-publish — spec jako issue, zadanie albo strona

1. Plik wejściowy to Markdown z front matter wg szablonu z `tools/scribe/templates/`
   (`gitlab-issue.md`, `gitlab-mr.md`, `jira-issue.md`, `confluence-page.md`) — `doc-spec` składa go ze spec:
   Kontekst, Zakres (lista numerowana), Kryteria akceptacji (checkboxy), Przypadki brzegowe, Poza zakresem,
   Założenia. Niejasność jako `[DO WYJAŚNIENIA: pytanie]`, nigdy domysł.
2. Front matter decyduje, czym plik JEST: `key:` / `iid:` / `id:` = aktualizacja, brak = nowy element,
   `comment: true` = komentarz. Komenda musi się z tym zgadzać (`alm:create` vs `alm:update`).
3. Dry-run: `npm run alm:create -- gitlab ./issue.md` (albo `alm:update`) — pokaż operatorowi wynik
   (przy aktualizacji diff względem żywego elementu).
4. `--yes` dodajesz WYŁĄCZNIE po wyraźnym, bieżącym poleceniu człowieka. Zapis dokleja linię
   proweniencji; kasowania nie ma.
5. Po zapisie: `npm run alm:read -- gitlab` i zapisz w run-logu identyfikator utworzonego elementu.
