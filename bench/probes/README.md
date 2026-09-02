# bench/probes — sondy projektowe

Tu trafiają jednorazowe skrypty pomiarowe, na których stoją liczby w `docs/DESIGN.md`
(tabela w nagłówku: goto na tej samej karcie vs świeżej, koszt scrubu kontekstu, CDP
`Page.captureScreenshot` vs `page.screenshot`, `Runtime.evaluate` z timeoutem, tokeny próbek).
DESIGN.md wymienia je z nazwy: `probe7–11.mjs`, `client-time.mjs`, `pipe-probe2.mjs`,
`probe-tab.mjs`, `probe-tab2.mjs`, `probe-tab3.mjs`, `tok.mjs`.

Zasady:

- sonda to dowód konkretnej liczby, nie część produktu — nie jest importowana przez nic,
  nie ma testów, nie jest w `CODE-INDEX.md` ani w `tsc` (wykluczona w `tsconfig.json`);
- każda sonda mówi w nagłówku, **którą** liczbę z DESIGN.md mierzy i jak ją uruchomić
  (zwykle `node bench/probes/<nazwa>.mjs` przy działającym `bench/serve.mjs` albo aplikacjach
  app-factory na portach 4311–4314);
- wyniki sond nie lądują w RAPORT.md — tam są wyłącznie warianty z `bench/bench.mjs`
  (DESIGN.md §9); sonda uzasadnia decyzję projektową, bench mierzy produkt.

Katalog jest w tej chwili pusty poza tym plikiem: skrypty sond zostaną skopiowane z ich
miejsca powstania (sesje pomiarowe z 2026-09-01) przy pierwszym wydaniu — nie są tu
odtwarzane z pamięci, bo sonda bez zmierzonego wyniku nie jest dowodem.
