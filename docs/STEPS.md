# Kroki `bi` — tabela STEPS

Generowane z `packages/browser-inspector/src/steps.schema.mjs` — nie edytuj ręcznie. Regeneracja: `npm run docs`
(hook pre-commit robi to sam; `npm run verify` pada, gdy plik jest nieświeży).

Te same nazwy w configu batchu (`steps[].do`) i w sesji (`bi <krok> …`); aliasy działają tylko w sesji.
`kind` steruje linią stdout: `action` drukuje delty (`dom Δ`, `el 61→63`, `+1 console.error`),
`query` drukuje treść, `control` samo `ok`. Kolumna „gdzie” mówi, czy krok wolno wpisać do configu
(`config`), wywołać w sesji (`sesja`), czy jedno i drugie. `bi help <krok>` drukuje ten sam wiersz.

Kroków: 45.

## Tabela

| krok | aliasy | kind | gdzie | sesja: `bi …` | pola configu | flagi sesji |
| --- | --- | --- | --- | --- | --- | --- |
| `goto` | `open` | `action` | config + sesja | `open <url> [--wait load\|settled\|networkidle] [--video]` | `url: url`, `waitUntil: enum:load,domcontentloaded,networkidle,settled?`, `video: bool?` | `--wait: enum:load,domcontentloaded,networkidle,settled`, `--video` |
| `back` | — | `action` | config + sesja | `back` | — | — |
| `forward` | — | `action` | config + sesja | `forward` | — | — |
| `reload` | — | `action` | config + sesja | `reload [--wait load\|settled\|networkidle]` | `waitUntil: enum:load,domcontentloaded,networkidle,settled?` | `--wait: enum:load,domcontentloaded,networkidle,settled` |
| `click` | — | `action` | config + sesja | `click <eN\|selector> [--double] [--right] [--mod ctrl,shift]` | `selector: string?`, `ref: ref?`, `button: enum:left,right,middle?`, `count: int?`, `modifiers: list?` | `--double`, `--right`, `--mod: list` |
| `fill` | — | `action` | config + sesja | `fill <eN\|selector> <text\|@{ENV}> [--env NAME] [--enter]` | `selector: string?`, `ref: ref?`, `value: text?`, `valueFromEnv: string?`, `enter: bool?` | `--enter`, `--env: string` |
| `type` | — | `action` | config + sesja | `type <eN\|selector> <text\|@{ENV}> [--env NAME] [--slowly]` | `selector: string?`, `ref: ref?`, `value: text?`, `valueFromEnv: string?`, `slowly: bool?` | `--slowly`, `--env: string` |
| `form` | — | `action` | config + sesja | `form <eN\|selector>=<text\|@{ENV}> …   e.g. form e3="Jan" e5=@{APP_PASS}` | `fields: array` | — |
| `press` | — | `action` | config + sesja | `press <key> [--el eN\|selector]     e.g. press Enter, press Control+a` | `key: string`, `selector: string?`, `ref: ref?` | `--el: string` |
| `hover` | — | `action` | config + sesja | `hover <eN\|selector>` | `selector: string?`, `ref: ref?` | — |
| `select` | — | `action` | config + sesja | `select <eN\|selector> <value[,value…]>` | `selector: string?`, `ref: ref?`, `value: string?`, `values: list?` | — |
| `check` | — | `action` | config + sesja | `check <eN\|selector>` | `selector: string?`, `ref: ref?` | — |
| `uncheck` | — | `action` | config + sesja | `uncheck <eN\|selector>` | `selector: string?`, `ref: ref?` | — |
| `drag` | — | `action` | config + sesja | `drag <eN\|selector> <eN\|selector>` | `from: target`, `to: target` | — |
| `upload` | — | `action` | config + sesja | `upload <eN\|selector> <file> [file…]   (files are read by the client, relative to its cwd)` | `selector: string?`, `ref: ref?`, `files: list` | — |
| `scroll` | — | `action` | config + sesja | `scroll <eN\|selector> \| scroll --to top\|bottom \| scroll top\|bottom` | `selector: string?`, `ref: ref?`, `to: enum:top,bottom?` | `--to: enum:top,bottom` |
| `mouse` | — | `action` | config + sesja | `mouse click\|move <x> <y> \| mouse drag <x> <y> <toX> <toY> \| mouse wheel <dy> [dx] \| mouse down\|up [--button right]` | `action: enum:click,move,down,up,wheel,drag`, `x: number?`, `y: number?`, `toX: number?`, `toY: number?`, `dx: number?`, `dy: number?`, `button: enum:left,right,middle?` | `--button: enum:left,right,middle` |
| `wait` | — | `control` | config + sesja | `wait --text <t> \| --gone <t> \| --url <pattern> \| --sel <selector> \| --ms <n> \| wait <ms>` | `ms: int?`, `text: string?`, `textGone: string?`, `url: string?`, `selector: string?` | `--ms: int`, `--text: string`, `--gone: string`, `--url: string`, `--sel: string` |
| `waitFor` | — | `control` | config + sesja | `waitFor <eN\|selector> [--state attached\|visible\|hidden\|detached]` | `selector: string?`, `ref: ref?`, `state: enum:attached,visible,hidden,detached?` | `--state: enum:attached,visible,hidden,detached` |
| `screenshot` | `shot` | `query` | config + sesja | `shot [name] [--full] [--el eN\|selector] [--jpeg [--quality 80]] [--mark eN]` | `name: name?`, `fullPage: bool?`, `selector: string?`, `ref: ref?`, `format: enum:png,jpeg?`, `quality: int?`, `mark: ref?` | `--full`, `--el: string`, `--jpeg`, `--quality: int`, `--mark: string` |
| `pdf` | — | `query` | config + sesja | `pdf [name]` | `name: name?` | — |
| `extract` | `get` | `query` | config + sesja | `get <eN\|selector> [--value] [--name key]` | `name: name?`, `selector: string?`, `ref: ref?`, `value: bool?` | `--value`, `--name: string` |
| `evaluate` | `eval` | `query` | config + sesja | `eval <expression…> \| eval --file s.js [--el eN] [--timeout ms] [--name key]` | `name: name?`, `expression: string?`, `file: string?`, `selector: string?`, `ref: ref?`, `timeout: int?` | `--file: string`, `--el: string`, `--timeout: int`, `--name: string` |
| `snapshot` | `snap` | `query` | config + sesja | `snap [--max 25] [--diff] [--around eN] [--grep text] [--names] [--all]` | `name: name?`, `max: int?`, `diff: bool?`, `around: ref?`, `grep: string?`, `names: bool?`, `all: bool?` | `--max: int`, `--diff`, `--around: string`, `--grep: string`, `--names`, `--all` |
| `find` | — | `query` | sesja | `find <text…> [--names]` | `text: string`, `names: bool?` | `--names` |
| `verify` | — | `query` | config + sesja | `verify visible\|hidden\|text\|value\|count\|list <eN\|selector> [expected…] \| verify url <pattern> \| verify title <text>  [--soft]` | `kind: enum:visible,hidden,text,value,list,url,title,count`, `selector: string?`, `ref: ref?`, `text: string?`, `value: text?`, `items: list?`, `url: string?`, `title: string?`, `count: int?`, `soft: bool?` | `--soft` |
| `resize` | — | `control` | config + sesja | `resize <width>x<height>     e.g. resize 1280x720` | `width: int`, `height: int` | — |
| `route` | — | `control` | config + sesja | `route <pattern> --block \| --status 500 [--body '{"e":1}'] \| --file resp.json \| --delay 300 [--content-type t]` | `url: string`, `block: bool?`, `status: int?`, `body: text?`, `file: string?`, `delay: int?`, `contentType: string?` | `--block`, `--status: int`, `--body: text`, `--file: string`, `--delay: int`, `--content-type: string` |
| `unroute` | — | `control` | config + sesja | `unroute [pattern]` | `url: string?` | — |
| `routes` | — | `query` | sesja | `routes` | — | — |
| `offline` | — | `control` | config + sesja | `offline on\|off` | `on: bool` | — |
| `fetch` | — | `query` | config + sesja | `fetch <url> [--method POST] [--body data] [--header k:v,k2:v2] [--name key]` | `url: string`, `method: string?`, `body: text?`, `headers: object?`, `name: name?` | `--method: string`, `--body: text`, `--header: list`, `--name: string` |
| `dialog` | — | `control` | config + sesja | `dialog accept\|dismiss [--text "prompt answer"] [--once]   \|   dialog   (show policy + last dialog)` | `action: enum:accept,dismiss?`, `text: string?`, `once: bool?` | `--text: string`, `--once` |
| `tab` | — | `control` | config + sesja | `tab new [url] \| tab <n> \| tab close` | `action: enum:new,select,close`, `index: int?`, `url: url?` | — |
| `tabs` | — | `query` | sesja | `tabs` | — | — |
| `frame` | — | `control` | config + sesja | `frame main \| frame <n> \| frame <selector>    (scope for CSS selectors, eval, extract — refs need no frame)` | `frame: string` | — |
| `storage` | — | `query` | config + sesja | `storage cookies\|local\|session list\|get\|set\|del\|clear [key] [value\|@{ENV}] [--env NAME] [--name key]` | `kind: enum:cookies,local,session`, `op: enum:list,get,set,del,clear`, `key: string?`, `value: text?`, `valueFromEnv: string?`, `name: name?` | `--env: string`, `--name: string` |
| `state` | — | `control` | config + sesja | `state save\|load <file.json>` | `op: enum:save,load`, `file: string` | — |
| `console` | — | `query` | sesja | `console [--level info\|warn\|error] [--errors] [--all] [--tail N]` | `level: enum:info,warn,error?`, `all: bool?`, `tail: int?` | `--level: enum:info,warn,error`, `--errors`, `--all`, `--tail: int` |
| `net` | — | `query` | sesja | `net [--failed] [--all] [--tail N] \| net <n> [--body] [--req]` | `n: int?`, `failed: bool?`, `all: bool?`, `tail: int?`, `body: bool?`, `req: bool?` | `--failed`, `--all`, `--tail: int`, `--body`, `--req` |
| `trace` | — | `control` | sesja | `trace start \| trace stop [file.zip]     (batch: "trace": true on the snapshot)` | `action: enum:start,stop`, `file: string?` | — |
| `video` | — | `control` | sesja | `video start\|stop     (start = fresh context; batch: "video": true on the snapshot)` | `action: enum:start,stop` | — |
| `locator` | — | `query` | sesja | `locator <eN>     (durable selector: data-testid → #id → [name] → role=)` | `ref: ref` | — |
| `run` | — | `control` | sesja | `run --file script.mjs     (BI_UNSAFE=1 only — runs code in the keeper, RCE-equivalent)` | `file: string` | `--file: string` |
| `close` | — | `control` | sesja | `close     (ends the session; the keeper stays)` | — | — |

## Typy pól

Sufiks `?` = pole opcjonalne. Nieznane pole w kroku to błąd walidacji (ścieżka `snapshots[i].steps[j].pole`).

| typ | znaczenie |
| --- | --- |
| `string` | non-empty string |
| `text` | string (may be empty) |
| `int` | integer |
| `number` | number |
| `bool` | true \| false (flag without a value in a session) |
| `list` | array of strings (comma-separated in a session) |
| `enum:a,b` | one of the listed words |
| `ref` | aria ref `eN` / `f<seq>eN` from the last snapshot |
| `target` | ref or Playwright selector |
| `url` | absolute URL |
| `name` | artifact name `[a-z0-9][a-z0-9-]*` |
| `object` | JSON object |
| `array` | JSON array |
| `any` | anything |

## Reguły wspólne

- Wartości (`fill`, `type`, `form`, `storage set`): dokładnie jedno z `value` / `valueFromEnv`; w `auth.login.steps` wyłącznie `valueFromEnv`.
  W sesji: `@{NAZWA}` albo `--env NAZWA` → `valueFromEnv`; `@literal` bez klamry zostaje literałem.
- Cel (`selector` / `ref`): dokładnie jedno; w configu `ref` wolno użyć dopiero po kroku `snapshot` w tym samym flow (wcześniej mapa refów jest pusta).
- Nazwy artefaktów (`name`): `[a-z0-9][a-z0-9-]*`, unikalne w flow; `final` zarezerwowane; `extract`, `evaluate`, `storage --name` i `fetch --name` dzielą jedną przestrzeń `extracts`.
- `describe` kroku nigdy nie echuje wartości — tylko jej pochodzenie (`(literal)` / `(from env NAZWA)`).
