---
name: read-index-first
description: Zanim zaczniesz szukać w drzewie repozytorium, przeczytaj CODE-INDEX.md (gdzie co jest) i GLOSSARY.md (jak to się nazywa); otwieraj tylko pliki, które któryś z nich nazwie.
---

# Najpierw indeks, potem drzewo

Użyj tej procedury na starcie każdego zadania dotykającego więcej niż jednego pliku albo pytania
„gdzie jest X".

1. Przeczytaj `CODE-INDEX.md` — sekcja per moduł: po co jest, co eksportuje (z wejściem i wyjściem
   funkcji), co importuje i kto importuje jego. Rozmiar jest podany w `AGENTS.md`, żebyś mógł
   zdecydować, czy czytasz całość.
2. Gdy nie znasz nazwy, sięgnij do `GLOSSARY.md` — proza jest po polsku, identyfikatory po
   angielsku, więc szukanie słowa wprost często nic nie daje; słownik mapuje w obie strony.
3. Otwórz wyłącznie pliki nazwane przez indeks albo słownik. Wróć do wyszukiwania dopiero wtedy,
   gdy żaden z nich nie odpowiada — indeks ma oszczędzić przeszukiwanie, nie zastąpić je, gdy wiesz,
   czego szukasz.
4. Dla aplikacji i bibliotek indeks pokazuje poziom mapy (`public-api.ts`, `app.routes.ts`); w głąb
   projektu schodzisz od tych plików, nie od `grep` po `apps/**`.

Nie edytuj `CODE-INDEX.md` ręcznie — jest generowany (`npm run code-index`, hook pre-commit).
