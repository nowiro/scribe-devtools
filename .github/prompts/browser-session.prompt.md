# /browser-session — spójrz na stronę, potem kliknij (browser-inspector zamiast MCP Playwrighta)

Masz do zbadania działającą aplikację webową pod adresem podanym przez operatora (domyślnie
`http://localhost:4200/`). Użyj sesji interaktywnej **browser-inspector** — komend w powłoce,
z których każda drukuje jedną linię. Nie ma tu narzędzi MCP: przeglądarkę obsługuje skrypt,
a wszystko, co większe niż linia (zrzuty, snapshoty, konsola, sieć), leży na dysku w
`.scribe-devtools/browser-inspector/session/<nazwa>/` i czytasz to wybiórczo.

Pętla pracy:

1. `pnpm browser-inspector open <url>` — jedna linia: tytuł, liczba elementów, błędy konsoli,
   ścieżka `snap.md`.
2. `pnpm browser-inspector find <tekst>` — refy `eN` elementów z pasującą nazwą (≤ 10 linii);
   pełny, kompaktowy snapshot: `pnpm browser-inspector snap` (`--max 40`, `--diff` po akcji,
   `--around eN` w okolicy elementu).
3. Akcje na refach: `click eN`, `fill eN <tekst>` (`--enter`), `form "eA=x" "eB=y"`,
   `select eN <wartość>`, `press Enter`, `hover eN`, `wait --sel <selektor>` / `wait --text <tekst>`.
   Linia odpowiedzi niesie delty: `navigated`, `dom Δ`, `el a→b`, `+N console.error` — patrz
   ponownie (`snap --diff`) tylko wtedy, gdy linia mówi, że coś się zmieniło. `exit 1` = FAIL
   (np. martwy ref po przerysowaniu strony → zrób `snap` i weź nowy ref).
4. Dowody: `shot <nazwa>` (plik PNG), `get <selektor>` (tekst elementu), `console --errors`,
   `net 5`, `eval "<wyrażenie>"`.
5. Koniec: `pnpm browser-inspector export flow.json` zapisuje sesję jako config batch
   (refy → trwałe selektory, wartości z `--env` → `valueFromEnv`); `close` zamyka sesję.

Zasady:

- Hasła i tokeny wyłącznie przez `--env NAZWA` albo `@{NAZWA}` — nigdy literałem w komendzie
  (trafiłby do historii powłoki i do transkryptu).
- Nie używaj `run --file` ani `eval` z kodem, który modyfikuje aplikację, bez jawnej zgody
  operatora.
- Czytaj z dysku tylko to, czego potrzebujesz (`snap.md` po zmianie ekranu, `report.md` po
  batchu) — cały sens narzędzia to nie wciągać strony do kontekstu.
- Gdy scenariusz jest już znany, przestań klikać w sesji: wyeksportuj flow i dopisz go do
  `read.config.browser-inspector.json`, żeby `pnpm smoke:browser` powtarzał go bez agenta.

Wyjście: krótki raport — co sprawdzono, co działa, co padło (z linią FAIL i ścieżką dowodu),
oraz wyeksportowany `flow.json`, jeśli scenariusz wart jest powtarzania.
