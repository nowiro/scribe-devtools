---
name: review-procedure
description: Procedura review kodu dla orkiestratora (krok 7 drabiny SDD) — lista zmienionych plików, losowanie miejsc (review:draw), ten sam brief do każdego miejsca, zapis raportów, scalanie (review:merge), decyzje po kolorach; osobno przegląd wizualny zrzutów na pięciu szerokościach.
---

# Review. 9 kroków

1. `npm run route -- --changed`. Wynik to lista zmienionych plików (bez linii `—`).
2. `npm run stamp`. Katalog review: `docs/runs/<stempel>_review-<slug>/` (lokalny, gitignorowany).
3. `npm run review:draw -- docs/runs/<stempel>_review-<slug>`. Wynik: jedna linia na miejsce, `<agent>  <rodzina>`.
   Miejsc nie dobierasz sam. Ponowne uruchomienie drukuje to samo losowanie.
4. Ten sam brief do każdego miejsca z kroku 3, równolegle:
   - PLIKI = lista z kroku 1;
   - AC = kryteria ze spec;
   - baza diffu = merge-base z gałęzią domyślną;
   - ZWRÓĆ = tabela `| Plik | Linia | Problem | 🔴🟡🟢 | Sugestia |` + werdykt **APPROVED** /
     **APPROVED z uwagami** / **NO-GO**.
   Żadne miejsce nie dostaje raportu innego miejsca.
5. Każdy zwrócony raport zapisz bez zmian jako `docs/runs/<stempel>_review-<slug>/<rodzina>.md`
   (rodzina z kroku 3, np. `anthropic.md`).
6. `npm run review:merge -- docs/runs/<stempel>_review-<slug> --slug <slug> --out docs/reviews/<stempel>_review-<slug>.md`.
7. Przeczytaj tylko plik wynikowy: linię `**Werdykt scalony: …**`, wiersze z 🔴, sekcje „Konflikty"
   i „Uwagi scalania". Raportów źródłowych nie czytasz.
8. Decyzje:
   - 🔴 z `2×` albo więcej: zadanie planu dla właściciela ścieżki (`npm run route`);
   - 🔴 z `1×`: STOP z pytaniem „czy prawdziwe?";
   - wiersz w „Konfliktach": STOP z pytaniem;
   - 🟡: pytanie do człowieka w tej samej liście;
   - 🟢: nic;
   - uwaga „brak raportu rodziny …": review niepełny, STOP. Nie zastępujesz miejsca innym agentem.
     Nie losujesz ponownie.
9. Brief do `doc-spec`: dopisz do raportu wylosowane miejsca (`draw.json`) i model zaobserwowany w każdym.
   Brief do `doc-intake`: wiersz w `docs/INDEX.md`.

# Przegląd wizualny. Gdy zmienił się ekran

1. Config flow: `read.config.browser-inspector.json` w korzeniu repozytorium (gitignorowany). Dla każdej
   szerokości z `ui.viewports` rejestru (360, 768, 1024, 1440, 1920) trzy kroki: `resize`, `screenshot`
   z `fullPage`, `evaluate` z wyrażeniem `document.documentElement.scrollWidth > document.documentElement.clientWidth`.
2. `npm run browser-inspector -- read.config.browser-inspector.json --stamp <slug>`.
3. Brief do `code-reviewer-ui`: ścieżki zrzutów z `.browser-inspector/<slug>/`, ścieżka makiety, AC,
   wartości z `evaluate`.
4. 🔴 z raportu: zadanie dla `code-angular`. Reszta jak w review.
