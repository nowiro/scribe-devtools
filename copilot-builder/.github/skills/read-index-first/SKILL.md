---
name: read-index-first
description: Zanim zaczniesz szukać w drzewie repozytorium, przeczytaj CODE-INDEX.md (gdzie co jest) i GLOSSARY.md (jak to się nazywa); otwieraj tylko pliki, które któryś z nich nazwie.
---

# Najpierw indeks, potem drzewo

Użyj na starcie każdego zadania, które dotyka więcej niż jednego pliku, i przy każdym pytaniu „gdzie jest X".

1. Przeczytaj `CODE-INDEX.md`. Jedna sekcja na moduł: po co jest, co eksportuje, co importuje, kto go importuje.
2. Nie znasz nazwy: przeczytaj `GLOSSARY.md`. Proza jest po polsku, identyfikatory po angielsku.
   Słownik mapuje słowo na nazwę w kodzie i odwrotnie.
3. Otwórz tylko pliki, które indeks albo słownik nazwał. Szukaj w drzewie dopiero wtedy, gdy żaden z nich
   nie odpowiada.
4. W aplikacji i bibliotece zacznij od `public-api.ts` albo `app.routes.ts`. Nie od `grep` po `apps/**`.

Nie edytuj `CODE-INDEX.md` ręcznie. Generuje go `npm run code-index` (hook pre-commit).
