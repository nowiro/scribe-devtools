# Handoff WP3 → WP2/WP4/WP6/WP8 — snapshot i refy

WP3 dostarczył `src/snapshot.mjs` (funkcje czyste nad PEŁNYM `page.ariaSnapshot({ mode: 'ai' })`),
fixture'y wygenerowane **prawdziwym** playwright-core 1.62.1 i Chrome na buildach app-factory
(`fixtures/snapshots/`), strony `fixtures/iframe.html` i `fixtures/relabel.html` oraz testy
`test/snapshot.test.mjs` (33) i `test/snapshot-tokens.test.mjs` (4, gpt-tokenizer o200k).

**Wznowienie 2026-09-02 (drugi przebieg WP3):** stan z pierwszego podejścia zweryfikowany — fixture'y zregenerowane
ponownie z żywego Chrome i **bajt w bajt identyczne** (`bookstore.ai.yml` 952 linii / 47 948 B, box-join 139/139,
`aria-ref=f1e3` klika w ramce z rodzica, stary ref po zmianie etykiety: count 1 → po pełnym snapshocie 0 w 4 ms).
Dopisane pod kontrakt silnika WP2 (`EngineOptions.snapshotTools`): alias `entries` dla `sidecar`, `sidecarFromPage(page, yaml)`,
`snapshotArtifacts(yaml, entries, opts)` — sekcja „Wiring do silnika” niżej.

Testy WP3: `npx vitest run packages/browser-inspector/test/snapshot.test.mjs packages/browser-inspector/test/snapshot-tokens.test.mjs`
(37 testów zielonych), `npx prettier --check` na `src/snapshot.mjs` i obu testach — zielone, `tsc --noEmit` bez
błędów w `snapshot.mjs` (błędy w `client.mjs`, `keeper.mjs`, `recorder.mjs` są w plikach innych WP — patrz niżej).

Regeneracja fixture'ów: `node packages/browser-inspector/fixtures/snapshots/generate.mjs` (porty 4531–4533,
serwer statyczny z `.js → text/javascript`; skrypt drukuje też fakty sprawdzone na żywym drzewie).

**Prośba (pliki współdzielone, nieedytowane przez WP3):** do `CHANGELOG.md` sekcji `Unreleased` dopisać:
`- WP3: snapshot i refy — parseSnapshot, compactSnapshot/compactLines (952 → 41 linii, fold powtarzalnych
rodzeństw), boxJoin (sidecar snap.json, 139/139 na bookstore), findInSnapshot (≤ 10), diffSnapshot, aroundRef,
namesContext (--names, ≤ 60 znaków), locatorFor/locatorForElement/uniqueIn, walkInteractive, resolveRef
(aria-ref literalnie, count() → jeden pełny snapshot → FAIL bez czekania); fixture'y bookstore/wizard z prawdziwego
Chrome (AC-9, AC-10).` `CODE-INDEX.md` zregenerowano (`npm run code-index`) — plik generowany, hook i tak go nadpisze.

## Liczby z fixture'ów (prawdziwy Chrome, 2026-09-02)

| pomiar | wynik |
| --- | --- |
| `bookstore.ai.yml` | **952 linii, 47 948 B, 829 refów** — co do linii i bajta jak w DESIGN.md (47,8 KB / 952) |
| refy `ai` vs `ai+boxes` vs `page.ariaSnapshot` vs `locator('body').ariaSnapshot` | identyczne (829/829) |
| linie interaktywne (INTERACTIVE_ROLES) | **139** (136 z `- rola` na początku linii + 3 z kluczem cytowanym YAML-em, bo nazwa ma `:`) |
| box-join | **139/139** (element znaleziony); selektor trwały dla 106 (33 bezimienne linki-okładki dzielą `href` z linkiem tytułu → brak jednoznacznego selektora, `selector?` opcjonalne) |
| kompakt bookstore | **41 linii** (limit 90) |
| tokeny o200k kompaktu | 25 linii **381** (limit 450), 40 linii **614** (limit 700), całość 647 |
| `find koszyk` | 10 linii z 34 trafień |
| `wizard.ai.yml` | 106 linii, refy **`f1eN`** (drugi dokument na tej samej karcie), kompakt 11 linii |
| walk (`walkInteractive`) na bookstore | 158 elementów |

## Eksporty `src/snapshot.mjs`

| eksport | sygnatura | uwagi |
| --- | --- | --- |
| `parseSnapshot(yaml)` | `→ SnapNode[]` | płaska lista w kolejności dokumentu: `{ index, depth, parent, kind: 'node'\|'text', role, name?, ref?, attrs, box?, text?, url?, placeholder?, children[] }`; toleruje CRLF, komentarze, klucze cytowane `'…'`/`"…"`, `\"` w nazwach |
| `compactLines(aiYaml, opts?)` | `→ string[]` | `opts = { sidecar?, entries?, names?, grep?, fold? }` (`entries` = alias `sidecar`, nazwa z `snapshotTools.compact` silnika); `grep` filtruje widok ROZWINIĘTY (bez foldu) |
| `compactSnapshot(aiYaml, opts?)` | `→ string` | `snap.md` = `compactLines` złączone `\n` + końcowy `\n` (`''` dla pustego) |
| `findInSnapshot(aiYaml, text, opts?)` | `→ { lines: string[], total: number }` | po pełnym drzewie: nazwa, tekst inline, `/url`, `/placeholder`, liście `text:`; wynik = linia kompaktu węzła (albo najbliższego widocznego przodka), dla trafienia bez widocznego przodka `<ref> <rola> "<tekst ≤ 80>"`; dedupe po refie; `opts.max` (domyślnie `FIND_MAX` = 10), `opts.names`, `opts.sidecar` |
| `diffSnapshot(prev, next)` | `→ { added: string[], removed: string[] }` | wejście: tablice linii kompaktu albo stringi z `\n`; różnica zbiorów z zachowaniem kolejności |
| `aroundRef(aiYaml, ref, opts?)` | `→ string[]` | `opts.n` (5) linii przed i po w widoku ROZWINIĘTYM (sięga za fold); `[]` gdy refa nie ma |
| `namesContext(nodes, node)` | `→ string \| undefined` | etykieta najbliższego przodka o roli `article\|listitem\|region\|group\|row`: jego nazwa → pierwszy `heading` → pierwszy nazwany `link`/`img` (nigdy nazwa samego węzła); ≤ 60 znaków, obcięte `…` |
| `textUnder(nodes, node, max=200)` | `→ string` | tekst pod węzłem (inline + liście), NIE nazwy |
| `boxJoin(boxesYaml, walk)` | `→ { entries: SidecarEntry[], interactive, matched }` | `walk` = tablica z `walkInteractive` (ramka główna) albo `{ main, frames: { '<seq>': [...] } }`; `entries` = `snap.json` |
| `sensitiveRefs(entries)` | `→ string[]` | refy z `sensitive: true` → `maskSnapshotValues(text, { sensitiveRefs })` z `redact.mjs` |
| `sidecarFromPage(page, boxesYaml)` | `→ Promise<SidecarEntry[]>` | **kształt `snapshotTools.boxJoin(page, yaml)` silnika**: `page.evaluate(walkInteractive)` + `frame.evaluate(walkInteractive)` dla każdego `iframe` z drzewa (i-ty iframe z refami ↔ `page.frames().slice(1)[i]`), potem `boxJoin`; **nigdy** `ariaSnapshot`; ramka odmawiająca `evaluate` → bez selektora; strona bez `frames()` (FakePage) → sama ramka główna |
| `snapshotArtifacts(boxesYaml, entries, opts?)` | `→ { full, md, entries, sensitive }` | trzy pliki z jednego snapshotu, już zredagowane (`redact.mjs`): `full` = YAML z `***` i bez wartości pól sensitive, `md` = kompakt, `entries` = `snap.json` bez `value` dla sensitive; `opts = CompactOptions & { secretValues? }` |
| `locatorFor(entry, unique?)` | `→ string \| undefined` | `[data-testid="x"]` → `#id` / `[id="…"]` → `[name="x"]` → `a[href="…"]` → `role=<rola>[name="…"]`; kandydat odrzucony przez `unique(kind, value)` przechodzi do następnego |
| `uniqueIn(walk)` | `→ (kind, value) => boolean` | predykat jednoznaczności atrybutu w spacerze (4 linki nawigacji dzielą `data-testid=desktop-nav-link` → żaden nie dostaje go jako selektora) |
| `locatorForElement(el)` | in-page, `→ string \| undefined` | **do `locator('aria-ref=eN').evaluate(locatorForElement)`** (eksport §4.5); ta sama preferencja, jednoznaczność przez `ownerDocument.querySelectorAll(sel).length === 1`; samowystarczalna (test pilnuje, że nie odwołuje się do modułu) |
| `walkInteractive()` | in-page, `→ WalkEntry[]` | **do `page.evaluate(walkInteractive)`** (i `frame.evaluate` dla iframe'ów); `{ tag, type?, role?, testid?, id?, nameAttr?, href?, label?, box: [x,y,w,h], sensitive?, disabled? }`; `box` zaokrąglony `Math.round` jak `[box=…]` snapshotu; `sensitive` dla `type=password` i `autocomplete=one-time-code` |
| `implicitRole(walkEntry)` | `→ string` | rola domniemana z tagu/typu (a[href]→link, input[checkbox]→checkbox, select→combobox, …) — rozstrzyga link i przycisk w nim o tym samym boxie |
| `resolveRef(page, ref, opts?)` | `→ Promise<{ selector, refreshed, snapshot? }>` | patrz niżej; rzuca `RefNotFoundError` |
| `RefNotFoundError` | `class extends Error` | `.message === REF_NOT_FOUND` z `print.mjs` (`ref not found (gone, label changed or other frame) → bi snap`), `.code = 'E_REF_NOT_FOUND'`, `.ref` |
| stałe | `INTERACTIVE_ROLES`, `SEMANTIC_ROLES`, `CONTEXT_ROLES`, `FIND_MAX`, `REF_PATTERN` | `REF_PATTERN` ≡ `steps.schema.mjs` (`/^(?:f\d+)?e\d+$/u`) |

Typy JSDoc do importu: `import('./snapshot.mjs').SnapNode | WalkEntry | SidecarEntry | CompactOptions`.

### `resolveRef` — dokładna semantyka (dla `ctx.sel` w WP2)

1. `ref` niezgodny z `REF_PATTERN` → `RefNotFoundError` bez dotykania strony.
2. `selector = 'aria-ref=' + ref` **dosłownie** (`f3e7` też — `_jumpToAriaRefFrameIfNeeded` kieruje do ramki `seq === 3`).
3. `page.locator(selector).count()` > 0 → `{ selector, refreshed: false }` — zero snapshotów.
4. inaczej JEDEN `page.ariaSnapshot({ mode: 'ai', boxes: opts.boxes ?? true })` (pełna strona, nigdy locator/poddrzewo/`depth`)
   → `count()` > 0 → `{ selector, refreshed: true, snapshot }` (tekst do odświeżenia `session.lastSnapshot`/`snap.*`).
5. dalej 0 → `throw new RefNotFoundError(ref)` **od razu**, bez czekania na actionability (test: < 100 ms na FakePage).

## Dokładny format linii kompaktu (`snap.md`, `bi snap`, `bi find`)

```
<ref> <rola> "<nazwa>" [<atrybuty>] → <url> [<selektor>] = <wartość> (<kontekst>)
h<poziom> "<nazwa>"                                   # nagłówki: bez refa (jak próbka DESIGN §4.3)
… ×<N> similar (<pierwszy ref>–<ostatni ref>): "<etykieta>", "<etykieta>", "<etykieta>" … · bi find <text>
```

Reguły (każdy element opcjonalny poza `<ref> <rola>`):

- `<ref>` — `eN` albo `f<seq>eN` **dosłownie** z YAML; `<rola>` — rola z YAML bez zmian.
- `"<nazwa>"` — nazwa dostępna (cudzysłowy i `\` escape'owane `\"`, `\\`); bez nazwy: `/placeholder` (textbox),
  a dla ról interaktywnych tekst pod węzłem ≤ 40 znaków (`e58 link "Zobacz katalog arrow_forward" → /`).
- `[<atrybuty>]` — tylko `[checked]`/`[checked=mixed]`, `[disabled]`, `[expanded]`, `[selected]`, `[pressed]`, w tej
  kolejności. **Wycięte**: `[ref=…]`, `[box=…]`, `[cursor=pointer]`, `[active]`, `[level=N]` (idzie do `hN`).
- `→ <url>` — tylko `link` z `- /url:` (odcudzysłowione: `"#main-content"` → `#main-content`).
- `[<selektor>]` — z sidecara, tylko krótkie formy: `[data-testid=x]` (bez cudzysłowów, gdy wartość to `[\w.:-]+`,
  inaczej `[data-testid="a b"]`), `#id` / `[id="…"]`, `[name=x]`. `a[href=…]` i `role=…` **nie są** pokazywane
  (linia i tak niesie rolę i nazwę; pełny selektor jest w `snap.json`).
- `= <wartość>` — tylko role `textbox|searchbox|combobox|spinbutton|slider` z tekstem inline (`- textbox "…" [ref=e39]: Harry`);
  **nigdy** dla refów `sensitive` z sidecara. Kolejność `[selektor] = wartość` jest zgodna z `COMPACT_VALUE_LINE`
  w `redact.mjs` (`maskSnapshotValues` rozpoznaje kompakt i obcina `= …` dla `sensitiveRefs`, redaguje resztę).
- `alert|status|dialog|alertdialog` — `e5 status: Zapisano` (cały tekst pod węzłem ≤ 200 znaków po `: `; nazwa w `"…"` gdy jest).
- `(<kontekst>)` — tylko z `names: true` (`--names`), z `namesContext`, ≤ 60 znaków.
- Które węzły zostają: role z `INTERACTIVE_ROLES` z refem; `heading`; `img` z nazwą; `alert|status|dialog|alertdialog`;
  **oraz nazwane węzły z `[cursor=pointer]` o roli ≠ `generic`** (kroki wizarda to `listitem "Otwórz krok 1: …" [cursor=pointer]`
  — bez tej reguły kompakt wizarda nie miałby żadnego celu kliknięcia). Landmarki (`banner`, `navigation`, `main`, …),
  `generic`, `paragraph`, `list`, `listitem` bez pointera — wycięte.
- **Fold** (odstępstwo, patrz niżej): pod jednym rodzicem ciąg ≥ 3 kolejnych rodzeństw o identycznej strukturze
  kompaktu (role + atrybuty, bez nazw/refów/url) kosztujący razem ≥ 12 linii → pierwszy element w całości + jedna
  linia `… ×N similar (…)`. Wyłączany przez `fold: false` i przez `grep`; `aroundRef` i `find` działają na drzewie, nie na foldzie.

Próbka (bookstore, pierwsze linie i fold):

```
e4 link "Przejdź do treści" → #main-content [data-testid=skip-to-content]
e11 link "Księgarnia" → / [data-testid=header-brand]
e15 link "Katalog" → /
e39 textbox "Szukaj produktów…" [data-testid=search-input]
e41 button "Szukaj" [data-testid=search-submit]
e45 button "Otwórz koszyk" [data-testid=header-cart-button]
h1 "Twoja kolejna ulubiona książka"
e81 button "Gatunek" [expanded] #mat-expansion-panel-header-0
e95 checkbox "Literatura" #mat-mdc-checkbox-1-input
e186 combobox "Sortuj" [data-testid=catalogue-sort]
e197 link → /book/book-013
e199 img "Bloomsbury Harry Potter and the Philosopher's Stone"
e207 link "Harry Potter and the Philosopher's Stone" → /book/book-013
e221 button "add_shopping_cart Do koszyka"
… ×32 similar (e228–e1220): "HarperCollins The Lord of the…", "Penguin 1984", "HarperCollins The Hobbit" … · bi find <text>
```

## `snap.json` (sidecar z `boxJoin`)

`[{ ref, role, name, selector?, box?: [x,y,w,h], url?, sensitive?: true }]` — jeden wpis na każdy węzeł widoczny w kompakcie
z refem (interaktywne, nagłówki, img z nazwą, alert/status/dialog, nazwane pointer-y); `selector` tylko dla interaktywnych
i pointer-ów, gdy spacer znalazł element o tym samym `box` (najpierw zgodna rola, potem dowolny wolny, potem sąsiad ±1 px).
`matched === interactive` = 100 % na fixture. `boxJoin` **nie wymyśla** `sensitive` — źródłem jest `walkInteractive`
(`type=password`, `autocomplete=one-time-code`); sidecar z `sensitive: true` traci wartość w `snap.md` i w
`maskSnapshotEntries`/`maskSnapshotValues` (`redact.mjs`). Zalecana kolejność w keeperze przy `snap`:
`boxes = await page.ariaSnapshot({ mode: 'ai', boxes: true })` → `walk = await page.evaluate(walkInteractive)` →
`{ entries } = boxJoin(boxes, walk)` → `snap.full.yml = boxes`, `snap.json = maskSnapshotEntries(entries, …)`,
`snap.md = maskSnapshotValues(compactSnapshot(boxes, { sidecar: entries }), { sensitiveRefs: sensitiveRefs(entries), secretValues })`.
Koszt: snapshot z boxami 32–85 ms, walk ~6 ms, join < 5 ms w Node.

## Wiring do silnika (WP2 `EngineOptions.snapshotTools`, WP5 keeper, WP6 sesja)

`src/engine.mjs` (WP2) przyjmuje `snapshotTools: { compact(yaml, { entries }), boxJoin(page, yaml) }` i sam pisze
`snap*.full.yml` / `.md` / `.json`. Gotowe dopasowanie, bez adaptera:

```js
import { compactSnapshot, sidecarFromPage } from './snapshot.mjs';
createEngine({ ..., snapshotTools: { compact: compactSnapshot, boxJoin: sidecarFromPage } });
```

Dwie prośby do WP2 (plik `engine.mjs` / `steps.run.mjs`, nie edytowany przez WP3):

1. krok `snapshot` i `captureSnapshot` biorą dziś `ariaSnapshot({ mode: 'ai' })` **bez `boxes: true`** — bez boxów `boxJoin`
   nie ma po czym łączyć i `snap.json` nie dostanie żadnego selektora, a `snap.md` żadnego `[data-testid=…]`. Refy w `ai` i
   `ai+boxes` są identyczne (fakt 5), a `snap.full.yml` z `[box=…]` jest zgodny z §4.3 — proszę o `{ mode: 'ai', boxes: true }`
   w tych dwóch miejscach (koszt: 26 → 32 ms na wizardzie, 85 ms na bookstore w obu wariantach).
2. `writeSnapshot` zapisuje `snap.md`/`snap.json` **bez redakcji** — `snapshotArtifacts(text, entries, { secretValues: ctx.secretValues })`
   daje `{ full, md, entries }` już zredagowane (AC-10: pola password/one-time-code nigdy z wartością; AC-14: sekrety nigdzie).
   `resolveSelector` w silniku powiela `resolveRef` (bez `boxes`) — może importować `resolveRef`/`RefNotFoundError`, zachowanie jest 1:1.

`snapshot.mjs` importuje `print.mjs` (stała `REF_NOT_FOUND`) i `redact.mjs` — oba czyste, bez `node:*`; klient nigdy nie importuje
`snapshot.mjs` (`client-imports.test` zielony po zmianie).

## Fakty sprawdzone na żywym playwright-core 1.62.1 (istotne dla WP2/WP6)

1. **Stary ref po zmianie etykiety NIE jest martwy do następnego pełnego snapshotu.** `queryAll` silnika `aria-ref`
   = `_lastAriaSnapshotForQuery.info.get(ref)` + `element.isConnected` — bez sprawdzenia roli/nazwy (potwierdzone w
   `coreBundle.js`). Na `relabel.html`: po kliknięciu „Dodaj do koszyka" → „W koszyku" `locator('aria-ref=<stary>').count()`
   daje **1**, dopiero po `page.ariaSnapshot({ mode: 'ai' })` daje **0** (4 ms). DESIGN §4.2 mówi „stary jest martwy" —
   jest martwy **w mapie następnego snapshotu**. Konsekwencja dla AC-9 („zmiana etykiety → stary ref FAIL < 100 ms"):
   między klikiem zmieniającym etykietę a klikiem starego refa musi zajść pełny snapshot (`bi snap`/`bi find`
   albo odświeżenie po akcji w silniku); sam `resolveRef` odświeża mapę **tylko** gdy `count()` = 0. Smoke WP6
   powinien robić `bi click e6 && bi snap && bi click e6` (drugi → FAIL). `resolveRef` NIE robi snapshotu przed
   każdą akcją (26–85 ms — poza budżetem §6).
2. **Prefiks `f<seq>` dostaje także ramka główna po nawigacji** (drugi dokument na karcie → `f1eN`, kolejne → `f2eN`…;
   iframe'y zużywają numery sekwencji: po `iframe.html` z jedną ramką relabel dostał `f2eN`). Dlatego `boxJoin`
   rozpoznaje iframe po **przodku `iframe` w drzewie**, nie po prefiksie; `wizard.ai.yml` ma `f1eN` celowo.
3. **Iframe w pełnym snapshocie**: `- iframe [ref=e6]:` → pod nim `- generic [ref=f1e1]:` … `button "Przycisk w ramce" [ref=f1e3]`;
   `page.click('aria-ref=f1e3')` z rodzica działa bez przełączania ramki (fixture `iframe.html`, sprawdzone: output w ramce zmienia się).
4. Rendering: wpisana wartość = tekst inline `- textbox "Szukaj produktów…" [active] [ref=e39]: Harry` (`[active]` przed
   `[ref]`); `[checked] [active] [ref=…]` dla zaznaczonego checkboxa; `- /url: "#main-content"` cytowane, `- /url: /` nie;
   klucz z `:` w nazwie cytowany pojedynczo: `- 'listitem "Otwórz krok 1: Dane firmy" [ref=f1e13] [cursor=pointer]':`;
   `- /placeholder: …` jako dziecko textboxa; `- text: …` liście; `status [ref=…]: "0"` (liczby cytowane).
5. `page.ariaSnapshot` i `page.locator('body').ariaSnapshot` dają identyczny tekst i identyczne refy; `ai` i `ai+boxes` też
   (829/829) — keeper może brać jeden snapshot z boxami i używać go do wszystkiego.
6. Bookstore i wizard app-factory **mają** `data-testid` (`search-submit`, `header-cart-button`, `card-add-to-cart`, …) —
   są ustawiane z szablonu Angulara (grep po `data-testid="` w `main-*.js` nic nie znajdzie, atrybuty są w tablicach).
   `card-add-to-cart` powtarza się 33×, `desktop-nav-link` 4× — stąd reguła jednoznaczności w `locatorFor`.

## Odstępstwa od DESIGN/PLAN (z uzasadnieniem)

- **Fold rodzeństw** — nie ma go w §4.3, ale bez niego reguły filtrowania dają 139 linii interaktywnych + 7 nagłówków
  + 30 obrazków > 90 (AC-10) i 25 linii to głównie karty. Fold zostawia pierwszą kartę w całości i nazywa ukryte;
  `find`/`--grep`/`--around`/`--all` pokazują resztę. 41 linii, 381 tok./25 linii.
- Nagłówki bez refa (`h2 "Filtry"`) — dokładnie jak próbka §4.3; ref nagłówka jest w `snap.full.yml` i `snap.json`.
- Nazwane węzły z `[cursor=pointer]` zostają (bez samego tokena) — inaczej wizard nie miałby żadnej linii do kliknięcia.
- `locatorFor`: atrybut niejednoznaczny w dokumencie przechodzi do następnej preferencji (DESIGN podaje kolejność,
  nie mówi o duplikatach; selektor trafiający w 4 elementy to błąd strict mode w eksporcie).
- `findInSnapshot(aiYaml, text, opts)` (PLAN: `findInSnapshot(text)`) — funkcja czysta potrzebuje YAML-a; zwraca `{ lines, total }`,
  żeby `bi find` mógł wydrukować `…+N more`.
- `resolveRef` domyślnie bierze snapshot **z boxami** (`boxes: true`), żeby odświeżony tekst nadawał się na `snap.json`
  bez drugiego wywołania; `{ boxes: false }` daje czysty `ai`.

## Uwagi dla innych pakietów

- **WP2** (`ctx.sel`): `import { resolveRef, RefNotFoundError } from './snapshot.mjs'`; `FAIL` kroku = `error.message`
  (już w formie z §4.4). `snapshot` w batchu: sekwencja z sekcji `snap.json` wyżej.
- **WP4** (eksport): `locator('aria-ref=eN').evaluate(locatorForElement)` w chwili akcji; gdy zwróci `undefined`
  (bezimienny link-okładka), zostaje selektor z sidecara (`entries.find(e => e.ref === ref)?.selector`) albo `role=`.
- **WP6** (sesja): `sidecarFromPage` robi mapowanie iframe ↔ `page.frames()` za Ciebie; `compactLines` + `--max` po stronie komendy (`formatOverflow` z `print.mjs`); `--diff` =
  `diffSnapshot(compactLines(prev), compactLines(next))`; `--around` = `aroundRef`; `--grep` = `compactLines({ grep })`;
  `--all` = zapis `snap.full.yml`. Iframe'y: `page.frames()` → `frame.evaluate(walkInteractive)` → `boxJoin(yaml, { main, frames: { '<seq>': … } })`,
  gdzie `<seq>` to prefiks refów pod danym `iframe` w YAML (numer ramki nie jest dostępny z API — zmapuj po kolejności
  `iframe` w drzewie ↔ `page.frames().slice(1)`). Fakt 1 wyżej dotyczy smoke'a AC-9.
- **WP8** (docs/tsc): `tsc --noEmit` na całym repo pokazuje dziś błędy w `src/client.mjs` (382, 401, 402: `string[]` vs `string`),
  `src/keeper.mjs` (688, 743, 793: `JobResult | KeeperDone`), `src/recorder.mjs` (213: `bodies` possibly undefined) — pliki WP5/WP2,
  WP3 ich nie dotykał.
