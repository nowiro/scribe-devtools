---
description: 'Publikacja do ALM przez skrypty alm:*: spec jako issue/MR GitLab, zadanie Jira albo strona Confluence z pliku Markdown; dry-run domyślny, --yes tylko na polecenie'
agent: orchestrator
---

# /alm-publish

Wejście od człowieka: co opublikować (spec, opis MR) i gdzie (`gitlab`, `jira`, `confluence`).

1. Brief do `doc-spec`: złóż plik Markdown z front matterem według szablonu z `tools/alm/templates/`
   (`gitlab-issue.md`, `gitlab-mr.md`, `jira-issue.md`, `confluence-page.md`). Sekcje: Kontekst, Zakres (lista
   numerowana), Kryteria akceptacji (checkboxy), Przypadki brzegowe, Poza zakresem, Założenia. Niejasność
   jako `[DO WYJAŚNIENIA: pytanie]`.
2. Front matter mówi, czym plik jest: `key:` / `iid:` / `id:` = aktualizacja (`alm:update`), brak = nowy element
   (`alm:create`), `comment: true` = komentarz.
3. Dry-run: `npm run alm:create -- <źródło> <plik.md>` albo `npm run alm:update -- <źródło> <plik.md>`.
   Pokaż człowiekowi wynik (przy aktualizacji diff).
4. `--yes` dodajesz tylko po wyraźnym poleceniu człowieka w tej rozmowie. Usuwania nie ma.
5. Po zapisie: `npm run alm:read -- <źródło>` i wiersz w run-logu z identyfikatorem utworzonego elementu.
