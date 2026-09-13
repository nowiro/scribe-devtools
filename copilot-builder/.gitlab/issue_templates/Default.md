<!--
Issue jest SPECYFIKACJĄ: mówi CO i DLACZEGO, nigdy JAK (od „jak" jest merge request).
Jedno issue = jeden samodzielnie testowalny przyrost. Niejasność zaznacz markerem
[DO WYJAŚNIENIA: pytanie] wprost w treści — implementacja (człowieka i agenta) nie startuje,
dopóki marker stoi. Ten szkielet renderuje się 1:1 w snapshocie `npm run alm:read -- gitlab`
i jest wejściem do `npm run workflow:specify` po stronie repozytorium.
-->

## Kontekst

Czemu teraz i co zostaje zepsute, jeśli tego nie zrobimy. Podlinkuj pochodzenie —
incydent, zgłoszenie, dyskusję.

## Zakres

1. Co dokładnie się zmienia, z punktu widzenia użytkownika albo systemu — nigdy „jak".
2. Lista numerowana — kryteria, MR i review odwołują się do „punktu 2", nie do parafrazy.

## Kryteria akceptacji

- [ ] Weryfikowalne zdania — każdy checkbox to sprawdzenie, które ktoś może wykonać.
- [ ] „Zakładając / gdy / wtedy" tam, gdzie zachowanie zależy od stanu.
- [ ] Mierzalne tam, gdzie się da (czas, procent, liczba), bez nazw technologii.

## Przypadki brzegowe

- Granice: puste wejście, równoległość, częściowa awaria, restart w połowie.
- Niewiadomą zaznacz `[DO WYJAŚNIENIA: pytanie]` zamiast zgadywać.

## Poza zakresem

Czego to issue celowo nie obejmuje.

## Założenia

Zależności i decyzje domyślne, na których opierają się kryteria.

/label ~"type::feature"
