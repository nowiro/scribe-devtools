# Handoff do app-factory: siedem kroków `wait ms` → warunki

Prośba do repozytorium `app-factory`, nie zmiana w tym repo. Patch leży obok, gotowy do zastosowania:

```bash
git apply /ścieżka/do/scribe-devtools/docs/handoff/app-factory-wait.patch
```

Dotyczy `read.config.browser-inspector.json` w korzeniu app-factory. Sprawdzony `git apply --check` na czystym
drzewie app-factory 2026-09-02; w tamtym repozytorium nic nie zostało zmienione (AGENTS.md: zmiany tam idą osobnym PR).

## Dlaczego

Przegląd wydajności ([docs/OPTIMIZATION-REVIEW.md](../OPTIMIZATION-REVIEW.md), ustalenie CONFIG-1) rozłożył przebieg
batcha app-factory na czynniki. Z 7908 ms czasu silnika **4248 ms to siedem kroków `wait ms`** — 54 %, największa
pojedyncza pozycja całego pomiaru, i nie jest to ani koszt narzędzia (~20 %), ani koszt aplikacji (~28 %). Kalibracja
leży w tym samym pliku: snapshoty `dziennik-*` używają wyłącznie `waitFor` i ta sama klasa przejścia — klik w Material
select, po którym pojawia się nowy pulpit — kosztuje tam **28 ms zamiast 709**.

`browser-inspector lint-config` na tym configu **już** to drukuje („7× wait ms (razem 4200 ms snu)”), więc brakowało
tylko migracji.

## Pomiar

Ten sam config, naprzemiennie, na buildach z `dist/apps/*/browser`, przez `bin/browser-inspector.mjs` z tego repo:

| przebieg | bazowy    | zmigrowany | zysk               |
| -------- | --------: | ---------: | -----------------: |
| warm     | 8897 ms   | **6217 ms**| −2680 ms (**−30 %**) |
| first    | 11 591 ms | **8859 ms**| −2732 ms (−24 %)   |

Warunek bezpieczeństwa, bez którego liczby nic nie znaczą: **6/6 `completed` w każdym przebiegu i wszystkie 13
wyciągniętych wartości identyczne co do znaku** — `krok 1 / 6`, `krok 2 / 6`, `Gotowe`, `en`, `shopping_cart\n1`,
`Witaj, Ewa!`, `Witaj, Anna!`, `brak przycisku nauczyciela`, oba nagłówki nowiro i karta produktu. Config robi dokładnie
to samo, tylko przestaje spać.

## Co na co

| było                                | jest                                                        | dlaczego akurat to                                              |
| ----------------------------------- | ----------------------------------------------------------- | --------------------------------------------------------------- |
| `wait 500` po zmianie języka        | `waitFor html[lang=en]`                                     | następny krok czyta `document.documentElement.lang`               |
| `wait 600` po wejściu w kafelek     | `wait --text "krok 1 / 6"`                                  | następny `evaluate` wyciąga ten napis regexem                     |
| `wait 700` po kroku wizarda         | `wait --text "krok 2 / 6"`                                  | jw.                                                               |
| `wait 700` po powrocie na pulpit    | `wait --text "Gotowe"`                                      | następny `evaluate` sprawdza dokładnie to słowo                   |
| `wait 700` po wyszukaniu            | `waitFor ais-shop-product-card`                             | następny krok wyciąga ten element                                 |
| `wait 400` po dodaniu do koszyka    | `waitFor [data-testid=header-cart-button]:has-text('1')`    | licznik koszyka ma pokazać 1; `:has-text()` jest już w tym configu |

**Siódmy sen zostaje**: `wait 600` przed zrzutem koszyka. To animacja szuflady, której żaden `waitFor` nie zobaczy —
element jest w DOM, zanim skończy się przesuwać, więc wycięcie dałoby zrzut w połowie ruchu. Sen, który ma powód,
zostaje snem.

## Zastrzeżenia

Selektory sprawdzone na buildach obok repozytorium ze stanu 2026-09-02. Gdyby aplikacje się od tego czasu zmieniły,
najbardziej wrażliwy z całej szóstki jest `:has-text('1')` na liczniku koszyka; pozostałe celują w to samo, co i tak
czyta następny krok, więc rozjazd zgłosiłby się jako błąd tego kroku, a nie jako cichy fałsz.

Po scaleniu: `pnpm smoke:browser` **dwa razy z rzędu**, tak jak wymaga procedura wydania — druga iteracja jest dowodem,
że scrub między przebiegami działa.

Migracja `waitUntil: networkidle` → `settled` jest osobną sprawą i tego patcha nie dotyczy (mierzona w benchu jako
wariant „po migracji settled”, ~2 s na przebieg); można ją zrobić tym samym PR-em albo później.
