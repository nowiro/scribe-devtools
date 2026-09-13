# Runbook `/perf-optimize` zastosowany do tego repozytorium

Data przeglądu: 2026-09-13. Punkt wyjścia: `.github/prompts/perf-optimize.prompt.md` — runbook wydajności i DX napisany
dla **repozytorium aplikacji** (Angular + Nx + Vitest + Playwright + ESLint, pipeline GitLab CI). Ten dokument mówi, co
z niego dotyczy `scribe-devtools`, co repozytorium ma od dawna, co zostało w tej rundzie zmierzone i odrzucone, i co
jedno zostało wdrożone. Jest odpowiednikiem §7 [OPTIMIZATION-REVIEW.md](OPTIMIZATION-REVIEW.md) dla warstwy narzędziowej:
istnieje po to, żeby następna runda nie wymyśliła tego samego od nowa.

**Ograniczenie metodyczne.** Pomiary powstały w kontenerze Linux o czterech rdzeniach, a repozytorium jest rozwijane na
Windows na maszynie szesnastordzeniowej. Wiarygodne są więc **delty A/B mierzone naprzemiennie w jednym przebiegu**,
nie liczby bezwzględne; każdą powtórzono co najmniej dwa razy. Żaden pomiar nie dotyczy `npm run smoke` ani benchu —
kontener nie ma systemowego Chrome ani Edge, a bench jest porównaniem z serwerem MCP na jednej maszynie i z jednego dnia.

## 1. Czego runbook w tym repozytorium nie dotyczy

Runbook zakłada stos, którego tu po prostu nie ma. To nie jest brak do nadrobienia, tylko inna klasa projektu: tu nie ma
aplikacji, jest para binarek na czystym ESM bez kroku budowania.

| obszar runbooka                                                | dlaczego nie dotyczy                                                                                                                                              |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Angular (buildery, zoneless, `@defer`, budżety)                | Nie ma Angulara ani żadnego frontendu. `bench/app/` to statyczna strona pod testem, nie aplikacja tego repo.                                                      |
| Nx (`affected`, `targetDefaults`, `namedInputs`, cache)        | Nie ma Nx. Są dwa workspace'y npm i sześć projektów Vitesta — graf, którym steruje jeden plik konfiguracyjny.                                                     |
| Nx Cloud (zakaz i strażnik)                                    | Nie ma czego zakazywać: żadnego śladu `nx-cloud`, `nxCloudId`, `NX_CLOUD_*`. Strażnik pilnowałby nieobecności rzeczy, której nikt nie próbuje dodać.              |
| ESLint (trzy tiery wtyczek, typed linting, `--cache`)          | Nie ma ESLinta. Reguły jakości niesie tu `tsc --checkJs` na typach z JSDoc plus przeglądy w `docs/` — dołożenie ESLinta to decyzja projektowa, nie optymalizacja. |
| Playwright test runner (sharding, `storageState`, `webServer`) | `@playwright/test` nie jest zależnością. Jest `playwright-core` jako silnik **produktu**, a testy e2e tego repo to `npm run smoke` na prawdziwym Chrome.          |
| GitLab CI                                                      | Repozytorium świadomie nie ma CI: bramki są lokalne (`npm run verify`), wydanie ręczne. Dopisanie pipeline'u byłoby zmianą procesu, nie przyspieszeniem go.       |
| pnpm / Yarn                                                    | Menedżer to npm z `package-lock.json`; runbook zakazuje migracji, więc bloki pnpm i Yarn są martwe.                                                               |

## 2. Co runbook proponuje, a repozytorium ma od dawna

Sprawdzone plik po pliku, nie z pamięci.

| pozycja runbooka                        | stan tutaj                                                                                                                                                               |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `.gitattributes` z `* text=auto eol=lf` | Jest, razem z klasami plików wymuszonymi jawnie i `package-lock.json` oznaczonym jako generowany i bez diffu.                                                            |
| `.gitignore` kompletny                  | Jest, z komentarzem przy każdej pozycji i bliźniakami w `.prettierignore` tam, gdzie wynik przebiegu narzędzia inaczej czerwieniłby bramkę.                              |
| Natywne hooki (`core.hooksPath`)        | Jest `.githooks/pre-commit` uzbrajany przez `npm run prepare`; żadnego Husky.                                                                                            |
| `.vscode/settings.json` z wykluczeniami | Jest: `files.exclude`, `search.exclude`, `files.watcherExclude` na wyniki przebiegów, `typescript.tsdk` na workspace'owy kompilator, prompt files i instrukcje włączone. |
| Instalacja „frozen"                     | `npm ci`; lockfile w repo; `.npmrc` z `engine-strict=true` i `ignore-scripts=true`.                                                                                      |
| `skipLibCheck`                          | Jest w `tsconfig.json`.                                                                                                                                                  |
| Jedno źródło wersji                     | `scripts/pins.config.mjs` + bramka `check-pins` — mocniejsze niż to, o co runbook prosi: pilnuje nie tylko manifestów, ale i prozy cytującej wersję.                     |

## 3. Zmierzone i odrzucone w tej rundzie

| pomysł                                        | pomiar                                                                                                                                      | werdykt                                                                                                                                                                                           |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NODE_COMPILE_CACHE`                          | 1,3–2,4 ms, w szumie (pomiar z poprzedniej rundy)                                                                                           | Odrzucone **wcześniej** — §7 [OPTIMIZATION-REVIEW.md](OPTIMIZATION-REVIEW.md). Runbook stawia to na pierwszym miejscu; tu jest już zamknięte i nie wraca.                                         |
| `npm ci` z wyciszonym audytem i funding       | 2216 / 2026 ms bez flag wobec 2056 / 2087 ms z `--no-audit --no-fund --no-progress`                                                         | Odrzucone: różnicy nie ma. `.npmrc` zostaje przy dwóch liniach, obu o głośnym padaniu.                                                                                                            |
| `tsc --incremental` + `tsBuildInfoFile`       | 861 ms i 835 ms na dwóch kolejnych przebiegach                                                                                              | Odrzucone: typecheck kosztuje mniej niż sekundę i drugi przebieg nie jest wolniejszy od pierwszego. Nie ma czego przyspieszać, a przybyłby plik stanu.                                            |
| Vitest `pool: 'threads'` (+ `isolate: false`) | Pięć plików testowych przypisuje do `process.env`                                                                                           | Odrzucone: wątki dzielą **jeden** `process.env` w jednym procesie, więc te pliki zaczęłyby na siebie wpływać zależnie od kolejności. Domyślne `forks` zostają.                                    |
| Biome zamiast Prettiera                       | Biome 525 ms wobec Prettiera 2161 ms na tej samej powierzchni `.mjs` — ale `.md` Biome **pomija** („these paths were provided but ignored") | Odrzucone: 42 pliki Markdown to rdzeń tego repozytorium (README, AGENTS, docs, prompty). Formater, który ich nie widzi, nie jest zamiennikiem. Do tego zamiana to przeformatowanie całego drzewa. |
| `.nvmrc`                                      | —                                                                                                                                           | Odrzucone: byłaby to **druga** deklaracja wersji Node obok `engines.node`, nieobjęta `check-pins`, przy `engine-strict=true`, które i tak pada głośno na złym Node.                               |
| Pole `packageManager` + Corepack              | —                                                                                                                                           | Jak wyżej: kolejna wersja zadeklarowana poza `pins.config.mjs`. Bez CI, które by z niej korzystało, to sam koszt.                                                                                 |
| `knip` w bramce zależności                    | —                                                                                                                                           | Odrzucone: pięć zależności deweloperskich i cztery manifesty. Szósta zależność (z własnym wierszem w `pins.config.mjs`) po to, żeby pilnować pięciu, to zły interes.                              |

## 4. Wdrożone: `--cache` dla Prettiera

Jedyna pozycja, która obroniła się pomiarem. `prettier --check .` było najwolniejszą deterministyczną bramką w
`npm run verify` — wolniejszą niż typecheck i wszystkie skrypty razem wzięte.

| przebieg                           |   przed |      po |
| ---------------------------------- | ------: | ------: |
| pierwszy po `npm ci` (cache zimny) | 3400 ms | 3286 ms |
| drugi i każdy następny             | 3400 ms |  573 ms |
| trzeci                             | 3442 ms |  569 ms |

Cache leży w `node_modules/.cache/prettier`, więc `npm ci` go czyści i nie potrzebuje wpisu w `.gitignore` ani bliźniaka
w `.prettierignore`. Klucz cache'u to treść pliku i opcje, więc bramka **nie przestaje łapać** zepsutego formatowania:
sprawdzone przez dopisanie źle sformatowanej linii do pliku, który przed chwilą przeszedł — `[warn] scripts/pins.config.mjs`,
exit różny od zera. Zmiana dotyczy `verify`, `format` i `format:check`; wiersz tabeli bramek w `AGENTS.md` mówi o niej wprost.

## 5. Zostaje dla właściciela

- **Nowszy `playwright-core`.** Pin jest `exact`, a jego `why` żąda po bumpie regeneracji czterech golden fixtures i
  `npm run bench`. Bench musi powstać na maszynie właściciela z systemowym Chrome, bo cała jego wartość to porównanie
  z serwerem MCP z jednego dnia i jednej maszyny. Zegar `check-upstream` ma zapas; to decyzja, nie zaległość.
- **Hooki `commit-msg` i `pre-push`.** Runbook zakłada commitlint i `verify` przed pushem. Tutaj jest tylko
  `pre-commit`, który regeneruje artefakty. `pre-push` z pełnym `verify` kosztowałby przy każdym pushu smoke na
  prawdziwym Chrome — do rozważenia w wariancie bez smoke'a, ale to zmiana procesu, nie optymalizacja, więc nie została
  wprowadzona bez decyzji.
