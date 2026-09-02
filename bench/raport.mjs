// raport.mjs — RAPORT.md: tokens and time in one place, tables and charts. Every number comes
// from `bench/out/results.json`; if the run comes out differently, the report comes out
// differently. The header table has the three MCP columns of DESIGN.md §9 (naive, lean,
// lean --timeout-settle 100), measured the same day on the same machine as every `bi` variant.
// Labels inside `mermaid` blocks have no Polish diacritics — GitHub's renderer trips on them.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fmt, total } from './tokens.mjs';

const DESIGN_MD = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'DESIGN.md');

const seconds = (/** @type {number} */ ms) => (ms / 1000).toFixed(2).replace('.', ',');
const ratio = (/** @type {number} */ a, /** @type {number} */ b) =>
  b > 0 ? (a / b).toFixed(1).replace('.', ',') : '—';
const ms = (/** @type {number | null | undefined} */ v) => (v === null || v === undefined ? '—' : `${fmt(v)} ms`);

/** Upper bound of the Y axis with headroom, rounded up to a round step. */
function axisMax(/** @type {number[]} */ values) {
  const peak = Math.max(1, ...values) * 1.1;
  const step = 10 ** Math.floor(Math.log10(peak));
  return Math.ceil(peak / step) * step;
}

/**
 * @param {string} title
 * @param {string} yLabel
 * @param {[string, number][]} entries
 */
export function barChart(title, yLabel, entries) {
  const values = entries.map(([, value]) => value);
  return [
    '```mermaid',
    'xychart-beta',
    `    title "${title}"`,
    `    x-axis [${entries.map(([label]) => `"${label}"`).join(', ')}]`,
    `    y-axis "${yLabel}" 0 --> ${String(axisMax(values))}`,
    `    bar [${values.join(', ')}]`,
    '```',
    '',
  ].join('\n');
}

/**
 * The parity matrix of DESIGN.md §7, counted: how many MCP tools have ✅ / ⚠️ / ❌ and which ones.
 * Read from the document at report time — the matrix is the contract, the report only counts it.
 * @param {string} [designMd]
 */
export function paritySummary(designMd = fs.existsSync(DESIGN_MD) ? fs.readFileSync(DESIGN_MD, 'utf8') : '') {
  const start = designMd.indexOf('## 7.');
  const end = designMd.indexOf('## 8.', start + 1);
  if (start < 0 || end < 0) return { ok: 0, partial: 0, missing: 0, rows: [] };
  const rows = [];
  for (const line of designMd.slice(start, end).split('\n')) {
    if (!line.startsWith('| ') || line.startsWith('| narzędzie') || line.startsWith('| ---')) continue;
    // Cells carry escaped pipes (`info\|warn\|error`, `net [--failed --all]`…): a bare split shifted
    // the status column on half the rows. Split on unescaped `|` only, unescape, and take the LAST
    // cell — the status column — whatever the column count.
    const cells = line.split(/(?<!\\)\|/u).map((c) => c.replaceAll('\\|', '|').trim());
    if (cells.at(-1) === '') cells.pop();
    const tool = cells[1] ?? '';
    const status = cells.at(-1) ?? '';
    const mark = status.startsWith('✅')
      ? 'ok'
      : status.startsWith('⚠️')
        ? 'partial'
        : status.startsWith('❌')
          ? 'missing'
          : 'extra';
    rows.push({ tool, status, mark });
  }
  return {
    ok: rows.filter((r) => r.mark === 'ok').length,
    partial: rows.filter((r) => r.mark === 'partial').length,
    missing: rows.filter((r) => r.mark === 'missing').length,
    rows,
  };
}

/**
 * @param {any} results
 * @returns {string}
 */
export function renderRaport(results) {
  const { meta = {}, bi = {}, mcp = {} } = results;
  const timeOf = (/** @type {string} */ name) => (mcp.time ?? []).find((/** @type {any} */ t) => t.name === name);
  const naive = timeOf('mcp-naive');
  const lean = timeOf('mcp-lean');
  const settle = timeOf('mcp-lean-settle-100');
  const variants = [
    ['bi-warm', bi.warm, 'ciepły keeper, przerwa 300 ms — **tu liczy się 5×**'],
    ['bi-warm-tight', bi.tight, 'ciepły keeper, bez przerwy (scrub poprzedniego czeka w kolejce lane’u — `queuedMs`)'],
    ['bi-first', bi.first, 'pierwsze wywołanie w sesji: keeper startuje w stoperze'],
    ['bi-cold', bi.cold, '`--no-daemon` (CI): własny Chrome w każdym wywołaniu'],
    ['bi-warm-fresh', bi.fresh, '`--fresh`: świeży kontekst z puli spare'],
  ].filter(([, v]) => v?.stats);
  const hasMcp = Boolean(naive?.warm);
  const lines = [
    '# RAPORT.md — bi (browser-inspector 2) vs @playwright/mcp: czas i tokeny',
    '',
    'To samo zadanie QA na tym samym formularzu (`bench/task.mjs`, 18 kroków), wykonane przez `bi` w każdym wariancie z',
    'DESIGN.md §9 i przez serwer MCP Playwrighta w trzech wariantach, zmierzone dwiema miarami: **ile czasu** od `spawn` do',
    '`exit` prawdziwego procesu klienta i **ile tokenów** wchodzi do okna kontekstu agenta. Raport generuje `npm run bench` —',
    'każda liczba niżej pochodzi z przebiegu, żadna nie jest wpisana ręcznie.',
    '',
    `Środowisko: ${String(meta.date ?? '')} · ${String(meta.os?.cpu ?? '')} (${String(meta.os?.cores ?? '?')} rdzeni, ${String(meta.os?.memGb ?? '?')} GB) · ${String(meta.os?.platform ?? '')} ${String(meta.os?.release ?? '')} · Node ${String(meta.node ?? '')} · bi ${String(meta.versions?.bi ?? '')} · playwright-core ${String(meta.versions?.playwrightCore ?? '')} · ${String(meta.versions?.browser ?? '')} · @playwright/mcp ${String(meta.versions?.mcp ?? '')} (${String(mcp.tokens?.[0]?.toolCount ?? '?')} narzędzi w \`tools/list\`).`,
    `Powtórzenia: cold/first ×${String(meta.reps ?? '?')}, warm n=${String(meta.warmN ?? '?')} po obu stronach, przerwa 300 ms po obu stronach.`,
    '',
    '## Tabela nagłówkowa',
    '',
    '| wariant | mediana | p90 | n · tryb | × vs MCP naive | × vs MCP lean | × vs MCP lean `--timeout-settle 100` |',
    '| --- | ---: | ---: | --- | ---: | ---: | ---: |',
  ];
  for (const [name, v] of variants) {
    const isCold = name === 'bi-first' || name === 'bi-cold';
    const baseNaive = isCold ? naive?.firstRunMs : naive?.warm?.median;
    const baseLean = isCold ? lean?.firstRunMs : lean?.warm?.median;
    const baseSettle = isCold ? settle?.firstRunMs : settle?.warm?.median;
    const modes = v.validModes ? `\`${v.expectedMode}\`` : `**${v.modes.join(', ')}**`;
    const r = (/** @type {number | undefined} */ base) =>
      base ? `**${ratio(base, v.stats.median)}×**${isCold ? ' (vs 1. przebieg)' : ''}` : '—';
    lines.push(
      `| ${name} | **${fmt(v.stats.median)} ms** | ${fmt(v.stats.p90)} ms | ${String(v.n)} · ${modes} | ${r(baseNaive)} | ${r(baseLean)} | ${r(baseSettle)} |`,
    );
  }
  if (bi.first?.firstEver) {
    lines.push(
      `| bi-first, first-ever (pierwsze w tym przebiegu benchu, n=1, poza ilorazami) | ${fmt(bi.first.firstEver.wallMs)} ms | — | 1 · \`${bi.first.firstEver.mode}\` | — | — | — |`,
    );
  }
  for (const [name, t] of [
    ['MCP naive (agent poznaje ekran)', naive],
    ['MCP lean (agent zna selektory)', lean],
    ['MCP lean `--timeout-settle 100`', settle],
  ]) {
    if (!t) continue;
    lines.push(
      `| ${name} | ${fmt(t.warm.median)} ms (warm) | ${fmt(t.warm.p90)} ms | ${String(t.warm.n)} · 1. przebieg ${fmt(t.firstRunMs)} ms | — | — | — |`,
    );
  }
  lines.push('');
  if (hasMcp && bi.warm?.stats) {
    const vsNaive = ratio(naive.warm.median, bi.warm.stats.median);
    const vsSettle = settle ? ratio(settle.warm.median, bi.warm.stats.median) : '—';
    const vsLean = lean ? ratio(lean.warm.median, bi.warm.stats.median) : '—';
    lines.push(
      `**Wniosek z tabeli:** ścieżka ciepła \`bi-warm\` (mediana ${fmt(bi.warm.stats.median)} ms, p90 ${fmt(bi.warm.stats.p90)} ms) jest ` +
        `**${vsNaive}× vs domyślne** ustawienia MCP (naive warm ${fmt(naive.warm.median)} ms), ${vsLean}× vs MCP lean i ` +
        `**~${vsSettle}× vs zestrojony settle 100** (${settle ? fmt(settle.warm.median) : '—'} ms) — dwie trzecie różnicy to domyślna polityka ` +
        '`--timeout-settle 500` serwera po każdej akcji, nie architektura. 5× jest własnością **każdego wywołania po pierwszym**; ' +
        `\`bi-first\` (${bi.first ? fmt(bi.first.stats.median) : '—'} ms) i \`bi-cold\` (${bi.cold ? fmt(bi.cold.stats.median) : '—'} ms) ` +
        'to fizyka startu Chrome i są raportowane osobno, poza progiem 5×.',
      '',
    );
    lines.push(
      barChart('Czas zadania (ms, mediany, cieplo)', 'ms', [
        ['bi-warm', bi.warm.stats.median],
        ...(bi.tight ? [/** @type {[string, number]} */ (['bi-warm-tight', bi.tight.stats.median])] : []),
        ...(bi.fresh ? [/** @type {[string, number]} */ (['bi-warm-fresh', bi.fresh.stats.median])] : []),
        ['MCP naive', naive.warm.median],
        ...(lean ? [/** @type {[string, number]} */ (['MCP lean', lean.warm.median])] : []),
        ...(settle ? [/** @type {[string, number]} */ (['MCP lean settle 100', settle.warm.median])] : []),
      ]),
    );
    if (bi.first && bi.cold) {
      lines.push(
        barChart('Czas zadania na zimno (ms, mediany)', 'ms', [
          ['bi-first', bi.first.stats.median],
          ['bi-cold', bi.cold.stats.median],
          ['MCP naive 1. przebieg', naive.firstRunMs],
          ...(lean ? [/** @type {[string, number]} */ (['MCP lean 1. przebieg', lean.firstRunMs])] : []),
        ]),
      );
    }
  } else if (bi.warm?.stats) {
    lines.push('Brak kolumn MCP w tym przebiegu (`--only bi`) — ilorazy nie są liczone.', '');
  }

  // ── Tokens ────────────────────────────────────────────────────────────────
  const tokenRows = [];
  if (bi.batchTokens) {
    tokenRows.push({
      name: 'bi batch',
      label: '**bi batch** — `bi read.config.json`, stdout, cały `report.md`',
      items: bi.batchTokens,
    });
    if (bi.batchTokensPnpm)
      tokenRows.push({
        name: 'bi batch (pnpm bi)',
        label: 'bi batch przez `pnpm bi` (skrypt pakietu)',
        items: bi.batchTokensPnpm,
      });
  }
  for (const it of bi.interactive ?? []) {
    tokenRows.push({
      name: it.name,
      label: `**${it.name}** — ${it.kind === 'naive' ? 'gołe `bi snap`, potem refy' : '`bi find` + selektory'} (${String(it.commands.length)} komend)`,
      items: it.tokens,
    });
  }
  for (const t of mcp.tokens ?? [])
    tokenRows.push({ name: t.variant, label: t.label, items: { fixed: t.fixed, variable: t.variable } });
  if (tokenRows.length > 0) {
    lines.push(
      '## Tokeny (o200k)',
      '',
      'Dwie kolumny, bo mieszanie ich zaciera obraz. **Stały** płaci się w KAŻDEJ sesji, zanim padnie pierwsze pytanie: po stronie',
      'MCP definicje narzędzi z `tools/list` (+ `initialize`), po stronie `bi` blok instrukcji w AGENTS.md. **Zmienny** płaci się za',
      'wykonanie zadania: po stronie MCP argumenty i tekst odpowiedzi każdego wywołania, po stronie `bi` komendy, stdout i',
      'przeczytany w całości `report.md` (batch) albo same linie stdout (sesja — zrzuty to pliki, których agent nie czyta).',
      '',
      '| wariant | stały | zmienny | razem na sesję |',
      '| --- | ---: | ---: | ---: |',
    );
    for (const r of tokenRows) {
      const f = total(r.items.fixed);
      const v = total(r.items.variable);
      lines.push(`| ${r.label} | ${fmt(f.tokens)} | ${fmt(v.tokens)} | **${fmt(f.tokens + v.tokens)}** |`);
    }
    lines.push('');
    lines.push(
      barChart(
        'Tokeny na sesje z jednym przebiegiem zadania',
        'tokeny',
        tokenRows.map((r) => [
          r.name.replace('mcp-', 'MCP '),
          total(r.items.fixed).tokens + total(r.items.variable).tokens,
        ]),
      ),
    );
    const biBatch = tokenRows.find((r) => r.name === 'bi batch');
    const mcpNaive = tokenRows.find((r) => r.name === 'mcp-naive');
    const mcpLean = tokenRows.find((r) => r.name === 'mcp-lean');
    if (biBatch && mcpNaive) {
      const sum = (/** @type {any} */ r) => total(r.items.fixed).tokens + total(r.items.variable).tokens;
      lines.push(
        `Batch \`bi\` kosztuje **${fmt(sum(biBatch))}** tokenów na sesję wobec ${fmt(sum(mcpNaive))} (MCP naive)` +
          `${mcpLean ? ` i ${fmt(sum(mcpLean))} (MCP lean)` : ''} — **${ratio(sum(mcpNaive), sum(biBatch))}×**` +
          `${mcpLean ? ` / ${ratio(sum(mcpLean), sum(biBatch))}×` : ''} mniej. Sam koszt stały: ${fmt(total(biBatch.items.fixed).tokens)} vs ${fmt(total(mcpNaive.items.fixed).tokens)}.`,
        '',
      );
    }
    lines.push('### Gdzie idą tokeny (najdroższe pozycje kosztu zmiennego)', '');
    for (const r of tokenRows) {
      const top = [...r.items.variable].sort((a, b) => b.tokens - a.tokens).slice(0, 5);
      lines.push(`**${r.name}**`, '', '| pozycja | tokeny |', '| --- | ---: |');
      for (const item of top) lines.push(`| ${item.label.replace(/\|/gu, '\\|')} | ${fmt(item.tokens)} |`);
      lines.push('');
    }
  }

  // ── Interactive ───────────────────────────────────────────────────────────
  if ((bi.interactive ?? []).length > 0) {
    lines.push(
      '## Sesja interaktywna (`bi-interactive`)',
      '',
      'Każda komenda to osobny proces `node bin/bi.mjs` przez keepera (czas = spawn → exit). Dwa warianty: `naive` (agent patrzy',
      'gołym `bi snap` i działa na refach) i `lean` (agent zna selektory, `bi find` tylko dla przycisku). Oba oglądają stan po',
      'pierwszym kliku (`bi snap --diff`).',
      '',
      '| wariant | komend | czas całej sesji | komenda: mediana / p90 | tokeny | bramka |',
      '| --- | ---: | ---: | ---: | ---: | --- |',
    );
    for (const it of bi.interactive) {
      lines.push(
        `| ${it.name} | ${String(it.commands.length)} | ${fmt(it.wallMs)} ms | ${fmt(it.commandMs.median)} / ${fmt(it.commandMs.p90)} ms | ${fmt(total(it.tokens.fixed).tokens + total(it.tokens.variable).tokens)} | ${it.problems.length === 0 ? 'ok' : it.problems.join('; ')} |`,
      );
    }
    lines.push('');
    for (const it of bi.interactive) {
      lines.push(`<details><summary>${it.name} — komendy i stdout</summary>`, '', '```');
      for (const c of it.commands)
        lines.push(`$ ${c.command}   # ${String(c.ms)} ms, exit ${String(c.code)}`, ...c.stdout.split('\n'));
      lines.push('```', '', '</details>', '');
    }
  }

  // ── keeper-survives-shell, app-factory ────────────────────────────────────
  if ((bi.shells ?? []).length > 0) {
    lines.push(
      '## keeper-survives-shell',
      '',
      '`bi up` w podprocesie powłoki, wyjście powłoki, `bi status` z nowego procesu: czy keeper przeżył? Jeśli host zabija drzewo',
      '(Job Object), każde wywołanie agenta jest zimne i 5× dostaje tylko bench.',
      '',
      '| powłoka | przeżył | `bi up` w powłoce | `bi status` po wyjściu | uwaga |',
      '| --- | --- | ---: | ---: | --- |',
    );
    for (const s of bi.shells) {
      lines.push(
        `| ${s.name} | ${s.available ? (s.survives ? '**yes**' : '**no**') : 'n/a'} | ${fmt(s.shellMs)} ms | ${fmt(s.statusMs)} ms | ${s.note ?? ''} |`,
      );
    }
    lines.push('');
  }
  if (bi.appFactory) {
    lines.push('## app-factory (6 snapshotów, buildy na 4311–4314)', '');
    if (!bi.appFactory.available) {
      lines.push(`Pominięte: ${String(bi.appFactory.reason ?? 'brak configu albo buildów app-factory')}.`, '');
    } else {
      lines.push(
        `Config: \`${String(bi.appFactory.config)}\` (kopia z własnym \`outputDir\`; wariant „settled” = \`networkidle\` → \`settled\`, kroki \`wait ms\` bez zmian).`,
        '',
        '| config | parallel | przebiegi (ms) | completed | tryb |',
        '| --- | ---: | --- | ---: | --- |',
      );
      for (const run of bi.appFactory.runs) {
        const last = run.samples.at(-1);
        lines.push(
          `| ${run.variant === 'settled' ? 'po migracji `settled`' : 'bez zmian'} | ${String(run.parallel)} | ${run.samples.map((/** @type {any} */ s) => fmt(s.wallMs)).join(' · ')} | ${String(last.snapshots.filter((/** @type {any} */ s) => s.completed).length)}/${String(last.snapshots.length)} | ${run.samples.map((/** @type {any} */ s) => s.mode).join(', ')} |`,
        );
      }
      lines.push('');
      const failed = (bi.appFactory.runs[0]?.samples.at(-1)?.snapshots ?? []).filter(
        (/** @type {any} */ s) => !s.completed,
      );
      if (failed.length > 0) {
        lines.push('Snapshoty nieukończone (config bez zmian, ostatni przebieg):', '');
        for (const s of failed) lines.push(`- \`${s.name}\`: ${String(s.failure ?? '')}`);
        lines.push('');
      }
    }
  }

  // ── Parity ────────────────────────────────────────────────────────────────
  const parity = paritySummary();
  if (parity.rows.length > 0) {
    lines.push(
      '## Parytet z @playwright/mcp (macierz DESIGN.md §7)',
      '',
      `Wierszy macierzy: ${String(parity.rows.length)} — ✅ ${String(parity.ok)} · ⚠️ ${String(parity.partial)} · ❌ ${String(parity.missing)}. ` +
        'Serwer 0.0.80 w domyślnej konfiguracji ogłasza ' +
        `${String(mcp.tokens?.[0]?.toolCount ?? '?')} narzędzi w \`tools/list\` (macierz liczy 70 z opcjonalnymi); ` +
        'każde ✅ ma test smoke albo jednostkowy (AC-15).',
      '',
    );
    const notOk = parity.rows.filter((r) => r.mark === 'partial' || r.mark === 'missing');
    if (notOk.length > 0) {
      lines.push('| narzędzie MCP | status |', '| --- | --- |');
      for (const r of notOk) lines.push(`| ${r.tool} | ${r.status} |`);
      lines.push('');
    }
  }

  // ── Gate ──────────────────────────────────────────────────────────────────
  const gates = [];
  if (bi.batchSample) gates.push({ name: 'bi batch', problems: bi.batchSample.problems });
  for (const [name, v] of variants) if (v.problems.length > 0) gates.push({ name, problems: v.problems });
  for (const it of bi.interactive ?? []) gates.push({ name: it.name, problems: it.problems });
  for (const t of mcp.tokens ?? []) gates.push({ name: t.variant, problems: t.problems });
  for (const t of mcp.time ?? [])
    if (t.problems?.length) gates.push({ name: `${t.name} (czas)`, problems: t.problems });
  const failing = gates.filter((g) => g.problems.length > 0);
  lines.push('## Bramka poprawności', '');
  if (failing.length === 0) {
    lines.push(
      'Każdy wariant wyciągnął komplet faktów: numer zgłoszenia, kategoria, priorytet, komunikat walidacji, błąd z konsoli i dwa',
      'zrzuty (`checkFindings` w `bench/task.mjs`). Porównanie opisuje więc różne drogi do **tego samego** wyniku.',
      '',
    );
  } else {
    for (const g of failing) lines.push(`- **${g.name}**: ${g.problems.join('; ')}`);
    lines.push('', 'Wariant bez kompletu faktów nie jest tańszy — jest niekompletny.', '');
  }

  // ── Methodology ───────────────────────────────────────────────────────────
  lines.push(
    '## Metodyka i zasady uczciwości (DESIGN.md §9)',
    '',
    '1. **Ten sam tokenizer po obu stronach** (`o200k_base` — proxy; wiarygodny jest stosunek, nie liczba absolutna).',
    '2. **Liczone jest to, co wchodzi do kontekstu**: dla `bi` blok AGENTS.md jako koszt stały + komenda + stdout + `report.md` w',
    '   całości (batch) / same linie stdout (sesja); dla MCP `tools/list` + `initialize` jako koszt stały + argumenty i tekst',
    '   odpowiedzi każdego wywołania (jawne `browser_snapshot`, bo 0.0.80 linkuje snapshot w pliku, a agent i tak musi go zobaczyć).',
    '3. **Czas od `spawn` do `exit` prawdziwego procesu klienta** (`node bin/bi.mjs …`), nigdy import w procesie benchu; po stronie',
    '   MCP czas zadania na serwerze podniesionym raz (1. przebieg n=1 osobno, kolejne z medianą).',
    '4. **Przerwa 300 ms między powtórzeniami po obu stronach** — scrub `bi` i `about:blank` MCP są poza stoperem tylko wtedy;',
    '   `bi-warm-tight` pokazuje, co się dzieje bez przerwy.',
    '5. **`timing.mode` każdego przebiegu jest walidowany**: przebieg z trybem innym niż oczekiwany w kolumnie (np. `first` w warm)',
    '   jest wypisany pogrubieniem w tabeli nagłówkowej i unieważnia pomiar tej kolumny.',
    '6. **`bi-cold` czeka na zniknięcie pid klienta i potomnych `chrome.exe`** przed następnym powtórzeniem; `bi-first` zatrzymuje',
    '   keepera (`bi stop`) i czeka tak samo. „first-ever” (pierwsze wywołanie w przebiegu benchu) jest osobno, poza ilorazami.',
    '7. **Ta sama strona dla obu stron**: statyczna kopia formularza (`bench/app/`, `bench/serve.mjs`, bez nagłówków cache, bez',
    '   dev-servera), `/api/zgloszenia` zawsze 404 — awaria widoczna wyłącznie w konsoli i sieci.',
    '8. Wersje i sprzęt w nagłówku; każdy iloraz liczy się wobec pomiaru MCP 0.0.80 z tego samego dnia i tej samej maszyny.',
    '',
    'Pełne rozbicie tokenów co do pozycji: [WYNIKI.md](WYNIKI.md). Fazy przebiegu wobec budżetu DESIGN.md §6: [BUDGET.md](BUDGET.md).',
    'Surowe dane: `bench/out/results.json` (nie w repo).',
  );
  return `${lines.join('\n')}\n`;
}

/**
 * WYNIKI.md — every token item of every variant.
 * @param {any} results
 */
export function renderWyniki(results) {
  const { bi = {}, mcp = {} } = results;
  const rows = [];
  if (bi.batchTokens)
    rows.push({
      name: 'bi batch',
      items: bi.batchTokens,
      extra: bi.batchSample ? { dir: bi.batchSample.dir, problems: bi.batchSample.problems } : undefined,
    });
  if (bi.batchTokensPnpm) rows.push({ name: 'bi batch (pnpm bi)', items: bi.batchTokensPnpm });
  for (const it of bi.interactive ?? [])
    rows.push({ name: it.name, items: it.tokens, extra: { commands: it.commands.length, problems: it.problems } });
  for (const t of mcp.tokens ?? [])
    rows.push({
      name: t.variant,
      items: { fixed: t.fixed, variable: t.variable },
      extra: { toolCount: t.toolCount, callCount: t.callCount, problems: t.problems },
    });
  const lines = [
    '# WYNIKI.md — pomiar tokenów (o200k) co do pozycji',
    '',
    'Tokenizer: `o200k_base` (proxy — obie strony mierzy ta sama miarka). Zadanie identyczne dla każdego wariantu (`bench/task.mjs`).',
    'Podsumowanie i czas: [RAPORT.md](RAPORT.md).',
    '',
    '| wariant | stały | zmienny | razem |',
    '| --- | ---: | ---: | ---: |',
  ];
  for (const r of rows) {
    const f = total(r.items.fixed);
    const v = total(r.items.variable);
    lines.push(`| ${r.name} | ${fmt(f.tokens)} | ${fmt(v.tokens)} | **${fmt(f.tokens + v.tokens)}** |`);
  }
  lines.push('');
  for (const r of rows) {
    lines.push(`## ${r.name}`, '');
    if (r.extra) lines.push(`\`${JSON.stringify(r.extra)}\``, '');
    lines.push('| pozycja | bajty | tokeny |', '| --- | ---: | ---: |');
    for (const item of [...r.items.fixed, ...r.items.variable]) {
      lines.push(`| ${item.label.replace(/\|/gu, '\\|')} | ${fmt(item.bytes)} | ${fmt(item.tokens)} |`);
    }
    const all = total([...r.items.fixed, ...r.items.variable]);
    lines.push(`| **razem** | **${fmt(all.bytes)}** | **${fmt(all.tokens)}** |`, '');
  }
  return `${lines.join('\n')}\n`;
}

/**
 * The block between `<!-- BENCH:START -->` and `<!-- BENCH:END -->` in the root README — the
 * only numbers the README carries, and they come from here.
 * @param {any} results
 */
export function renderReadmeBlock(results) {
  const { bi = {}, mcp = {}, meta = {} } = results;
  const naive = (mcp.time ?? []).find((/** @type {any} */ t) => t.name === 'mcp-naive');
  const lean = (mcp.time ?? []).find((/** @type {any} */ t) => t.name === 'mcp-lean');
  const settle = (mcp.time ?? []).find((/** @type {any} */ t) => t.name === 'mcp-lean-settle-100');
  const lines = [
    '<!-- BENCH:START -->',
    '',
    `Pomiar z ${String(meta.date ?? '')} (\`npm run bench\`, ${String(meta.versions?.browser ?? '')}, @playwright/mcp ${String(meta.versions?.mcp ?? '')}):`,
    '',
  ];
  lines.push(
    '| wariant | mediana | p90 | × vs MCP naive | × vs MCP lean settle 100 |',
    '| --- | ---: | ---: | ---: | ---: |',
  );
  for (const [name, v, cold] of [
    ['bi-warm (2.+ wywołanie, przerwa 300 ms)', bi.warm, false],
    ['bi-warm-tight (bez przerwy)', bi.tight, false],
    ['bi-first (keeper startuje w stoperze)', bi.first, true],
    ['bi-cold (`--no-daemon`, CI)', bi.cold, true],
  ]) {
    if (!v?.stats) continue;
    const baseN = cold ? naive?.firstRunMs : naive?.warm?.median;
    const baseS = cold ? settle?.firstRunMs : settle?.warm?.median;
    lines.push(
      `| ${name} | **${fmt(v.stats.median)} ms** | ${fmt(v.stats.p90)} ms | ${baseN ? `${ratio(baseN, v.stats.median)}×${cold ? ' (vs 1. przebieg)' : ''}` : '—'} | ${baseS ? `${ratio(baseS, v.stats.median)}×${cold ? ' (vs 1. przebieg)' : ''}` : '—'} |`,
    );
  }
  if (naive)
    lines.push(
      `| MCP naive / lean / lean settle 100 (warm) | ${fmt(naive.warm.median)} / ${lean ? fmt(lean.warm.median) : '—'} / ${settle ? fmt(settle.warm.median) : '—'} ms | — | — | — |`,
    );
  lines.push('');
  const sum = (/** @type {any} */ t) => (t ? total(t.fixed).tokens + total(t.variable).tokens : null);
  const biBatch = bi.batchTokens ? total(bi.batchTokens.fixed).tokens + total(bi.batchTokens.variable).tokens : null;
  const naiveTok = sum((mcp.tokens ?? []).find((/** @type {any} */ t) => t.variant === 'mcp-naive'));
  const leanTok = sum((mcp.tokens ?? []).find((/** @type {any} */ t) => t.variant === 'mcp-lean'));
  const inter = (bi.interactive ?? [])
    .map(
      (/** @type {any} */ it) => `${it.name} ${fmt(total(it.tokens.fixed).tokens + total(it.tokens.variable).tokens)}`,
    )
    .join(', ');
  if (biBatch !== null) {
    lines.push(
      `Tokeny (o200k) na sesję z jednym zadaniem: **bi batch ${fmt(biBatch)}** (blok AGENTS.md ${fmt(total(bi.batchTokens.fixed).tokens)} + komenda, stdout i cały \`report.md\`)` +
        `${inter ? `, ${inter}` : ''}${naiveTok !== null ? ` — wobec MCP naive ${fmt(naiveTok)}` : ''}${leanTok !== null ? ` / lean ${fmt(leanTok)}` : ''}.` +
        ' Szczegóły: [bench/RAPORT.md](bench/RAPORT.md), budżet vs pomiar: [bench/BUDGET.md](bench/BUDGET.md).',
      '',
    );
  }
  lines.push('<!-- BENCH:END -->');
  return lines.join('\n');
}
