// budget.mjs — BUDGET.md: the phases of DESIGN.md §6 next to what `report.json.timing` and
// `_manifest.json.timing` measured, per column (`bi-warm`, `bi-warm-tight`, `bi-first`, `bi-cold`),
// with `queuedMs` / `scrubMs` / `cacheHits` on their own rows, and a red mark on every phase that
// drifts more than 25 % from the design and every ratio below 5.0 (AC-19). The numbers of the
// design column are the table of §6, grouped the way the engine reports them; the numbers of the
// measurement column are medians over the samples of the variant — never a single run.
import { fmt } from './tokens.mjs';
import { stats } from './time-run.mjs';

export const COLUMNS = /** @type {const} */ (['bi-warm', 'bi-warm-tight', 'bi-first', 'bi-cold']);

/** @typedef {typeof COLUMNS[number]} Column */
/** @typedef {{ wallMs: number, timing: any, manifestTiming: any }} Sample */

/**
 * @typedef {object} Phase
 * @property {string} key
 * @property {string} label
 * @property {Partial<Record<Column, number | null>>} design `null` = the design has no number here
 * @property {(s: Sample) => number} measure
 */

const n = (/** @type {unknown} */ v) => Number(v) || 0;

/**
 * DESIGN.md §6, rows grouped as the engine reports them. The design total of each column is the
 * table's own total (546 / 561 / 1 469 / 1 618), not the sum of the groups — the groups are a
 * reading of the table, the totals are its promise.
 * @type {{ totals: Record<Column, number>, mcp: { warm: number, first: number, leanSettle: number }, ratios: Record<string, number>, phases: Phase[], fresh: number, appFactory: { unchanged: [number, number], settledP1: number, settledP3: [number, number] }, scrubBetween: [number, number] }}
 */
export const DESIGN_BUDGET = {
  totals: { 'bi-warm': 546, 'bi-warm-tight': 561, 'bi-first': 1469, 'bi-cold': 1618 },
  mcp: { warm: 2900, first: 3600, leanSettle: 1000 },
  ratios: { 'bi-warm': 5.3, 'bi-warm-tight': 5.2, 'bi-first': 2.4, 'bi-cold': 2.2, 'bi-warm-fresh': 3.1 },
  fresh: 932,
  appFactory: { unchanged: [8000, 10000], settledP1: 2500, settledP3: [1300, 1600] },
  scrubBetween: [12, 35],
  phases: [
    {
      key: 'client',
      label:
        'klient: start (72) + pipe (5) + dispatch (2) + wydruk i wyjście (6); `bi-first`: + import playwright-core (270), bo klient czeka na keepera w tym czasie; `bi-cold`: + context/browser.close (200)',
      design: { 'bi-warm': 85, 'bi-warm-tight': 85, 'bi-first': 355, 'bi-cold': 277 },
      measure: (s) => s.wallMs - n(s.manifestTiming?.clientMs) - n(s.manifestTiming?.keeperStartMs),
    },
    {
      key: 'keeperStart',
      label: 'spawn keepera → nasłuch (`_manifest.timing.keeperStartMs`)',
      design: { 'bi-warm': null, 'bi-warm-tight': null, 'bi-first': 45, 'bi-cold': null },
      measure: (s) => n(s.manifestTiming?.keeperStartMs),
    },
    {
      key: 'queued',
      label: 'queuedMs — scrub poprzedniego przebiegu w kolejce lane’u, po odpowiedzi (§6)',
      design: { 'bi-warm': 0, 'bi-warm-tight': 15, 'bi-first': null, 'bi-cold': null },
      measure: (s) => n(s.timing?.queuedMs),
    },
    {
      key: 'scrub',
      label:
        'scrubMs — scrub w stoperze przebiegu (tylko siatka bezpieczeństwa `runFlow`; między snapshotami jednego batchu)',
      design: { 'bi-warm': 0, 'bi-warm-tight': 0, 'bi-first': null, 'bi-cold': null },
      measure: (s) => n(s.timing?.scrubMs),
    },
    {
      key: 'launch',
      label: 'launch Chrome (300) + kontekst i strona (115); `bi-cold`: + import playwright-core (270) w procesie',
      design: { 'bi-warm': 0, 'bi-warm-tight': 0, 'bi-first': 415, 'bi-cold': 685 },
      measure: (s) => n(s.manifestTiming?.clientMs) - n(s.timing?.totalMs) - n(s.timing?.queuedMs),
    },
    {
      key: 'goto',
      label: 'goto `load` (ta sama karta 55 / świeży kontekst 250)',
      design: { 'bi-warm': 55, 'bi-warm-tight': 55, 'bi-first': 250, 'bi-cold': 250 },
      measure: (s) => n(s.timing?.gotoMs),
    },
    {
      key: 'steps',
      label:
        '18 kroków: waitFor 10 + 5×click 220 + 4×fill 40 + select 12 + waitFor 40 + 6×extract/evaluate 12 + 2×screenshot 50',
      design: { 'bi-warm': 384, 'bi-warm-tight': 384, 'bi-first': 384, 'bi-cold': 384 },
      measure: (s) => n(s.timing?.stepsMs),
    },
    {
      key: 'capture',
      label: 'dowód końcowy (el-count + title/text/elements)',
      design: { 'bi-warm': 12, 'bi-warm-tight': 12, 'bi-first': 12, 'bi-cold': 12 },
      measure: (s) => n(s.timing?.captureMs),
    },
    {
      key: 'write',
      label: 'oczekiwanie na zapisy + report.json/md, elements.md, text.txt, manifesty',
      design: { 'bi-warm': 10, 'bi-warm-tight': 10, 'bi-first': 10, 'bi-cold': 10 },
      measure: (s) => n(s.timing?.writeMs),
    },
  ],
};

/**
 * Drift verdict: red when the measurement is more than 25 % away from a positive design number,
 * or more than 25 ms above a design of 0 (a "0" phase that costs 300 ms is a broken promise even
 * though 300 / 0 is not a percentage).
 * @param {number | null | undefined} design
 * @param {number} measured
 * @returns {{ red: boolean, drift: string }}
 */
export function verdict(design, measured) {
  if (design === null || design === undefined) return { red: false, drift: '—' };
  if (design === 0) return { red: measured > 25, drift: measured > 0 ? `+${fmt(measured)} ms` : '0' };
  const ratio = (measured - design) / design;
  const pct = `${ratio >= 0 ? '+' : '−'}${String(Math.round(Math.abs(ratio) * 100))} %`;
  return { red: Math.abs(ratio) > 0.25, drift: pct };
}

/**
 * The medians of a phase over the samples of every column.
 * @param {Phase} phase
 * @param {Partial<Record<Column, { samples: Sample[] } | undefined>>} variants
 */
export function phaseRow(phase, variants) {
  /** @type {Partial<Record<Column, { design: number | null, measured: number | null, red: boolean, drift: string }>>} */
  const cells = {};
  for (const column of COLUMNS) {
    const design = phase.design[column] ?? null;
    const samples = variants[column]?.samples ?? [];
    const measured = samples.length > 0 ? stats(samples.map(phase.measure)).median : null;
    const v = measured === null ? { red: false, drift: '—' } : verdict(design, measured);
    cells[column] = { design, measured, ...v };
  }
  return { key: phase.key, label: phase.label, cells };
}

/**
 * The whole comparison, data only (the test checks it, the renderer prints it).
 * @param {any} results `bench/out/results.json`
 */
export function compareWithDesign(results) {
  const bi = results.bi ?? {};
  /** @type {Partial<Record<Column, any>>} */
  const variants = { 'bi-warm': bi.warm, 'bi-warm-tight': bi.tight, 'bi-first': bi.first, 'bi-cold': bi.cold };
  const phases = DESIGN_BUDGET.phases.map((phase) => phaseRow(phase, variants));
  const total = phaseRow(
    { key: 'total', label: '**razem** (klient spawn → exit)', design: DESIGN_BUDGET.totals, measure: (s) => s.wallMs },
    variants,
  );

  const mcpTime = (/** @type {string} */ name) =>
    (results.mcp?.time ?? []).find((/** @type {any} */ t) => t.name === name);
  const naiveWarm = mcpTime('mcp-naive')?.warm?.median ?? null;
  const naiveFirst = mcpTime('mcp-naive')?.firstRunMs ?? null;
  const settleWarm = mcpTime('mcp-lean-settle-100')?.warm?.median ?? null;
  const ratioRows = [];
  for (const [name, variant] of [
    ['bi-warm', bi.warm],
    ['bi-warm-tight', bi.tight],
    ['bi-first', bi.first],
    ['bi-cold', bi.cold],
    ['bi-warm-fresh', bi.fresh],
  ]) {
    if (!variant?.stats) continue;
    const median = variant.stats.median;
    const vsFirst = name === 'bi-first' || name === 'bi-cold';
    const base = vsFirst ? naiveFirst : naiveWarm;
    const ratio = base ? base / median : null;
    const ratioSettle = settleWarm ? settleWarm / median : null;
    ratioRows.push({
      name,
      median,
      p90: variant.stats.p90,
      base,
      baseLabel: vsFirst ? 'MCP naive, 1. przebieg' : 'MCP naive warm',
      ratio,
      ratioSettle,
      design: DESIGN_BUDGET.ratios[name],
      red: ratio !== null && ratio < 5,
      validModes: variant.validModes,
    });
  }

  const cacheRows = COLUMNS.map((column) => ({
    column,
    cacheHits: variants[column]?.cacheHits?.median ?? null,
    cacheHitsDocument: variants[column]?.cacheHitsDocument?.median ?? null,
    red: (variants[column]?.cacheHitsDocument?.max ?? 0) > 0,
  }));

  const extras = [];
  if (bi.fresh?.stats) {
    const v = verdict(DESIGN_BUDGET.fresh, bi.fresh.stats.median);
    extras.push({
      label: '`bi-warm-fresh` (`--fresh`: świeży kontekst z puli spare, goto 190–441)',
      design: `${fmt(DESIGN_BUDGET.fresh)} ms`,
      measured: `${fmt(bi.fresh.stats.median)} ms (goto ${fmt(bi.fresh.gotoMs?.median ?? 0)} ms)`,
      ...v,
    });
  }
  const af = bi.appFactory;
  if (af?.available) {
    for (const run of af.runs ?? []) {
      const median = stats(run.samples.map((/** @type {any} */ s) => s.wallMs)).median;
      const migrated = run.variant === 'settled';
      let design;
      let v;
      if (!migrated) {
        design = DESIGN_BUDGET.appFactory.unchanged;
        v = rangeVerdict(design, median);
      } else if (run.parallel === 1) {
        design = [DESIGN_BUDGET.appFactory.settledP1, DESIGN_BUDGET.appFactory.settledP1];
        v = verdict(DESIGN_BUDGET.appFactory.settledP1, median);
      } else {
        design = DESIGN_BUDGET.appFactory.settledP3;
        v = rangeVerdict(design, median);
      }
      const completed = run.samples.at(-1)?.snapshots?.filter((/** @type {any} */ s) => s.completed).length ?? 0;
      const total = run.samples.at(-1)?.snapshots?.length ?? 0;
      extras.push({
        label: `app-factory, ${String(total)} snapshotów, \`--parallel ${String(run.parallel)}\`, config ${migrated ? 'po migracji `networkidle` → `settled`' : 'bez zmian'} (completed ${String(completed)}/${String(total)})`,
        design: design[0] === design[1] ? `≈ ${fmt(design[0])} ms` : `≈ ${fmt(design[0])}–${fmt(design[1])} ms`,
        measured: `${fmt(median)} ms (n=${String(run.samples.length)})`,
        ...v,
      });
      const scrubs = run.samples.flatMap((/** @type {any} */ s) =>
        s.snapshots.map((/** @type {any} */ x) => n(x.scrubMs)).filter((/** @type {number} */ x) => x > 0),
      );
      if (scrubs.length > 0 && !migrated && run.parallel === 1) {
        const scrubMedian = stats(scrubs).median;
        extras.push({
          label: 'scrub między snapshotami app-factory (`snapshots[].scrubMs`, 4 originy)',
          design: `${fmt(DESIGN_BUDGET.scrubBetween[0])}–${fmt(DESIGN_BUDGET.scrubBetween[1])} ms`,
          measured: `${fmt(scrubMedian)} ms (n=${String(scrubs.length)})`,
          ...rangeVerdict(DESIGN_BUDGET.scrubBetween, scrubMedian),
        });
      }
    }
  }
  return { phases, total, ratioRows, cacheRows, extras, naiveWarm, naiveFirst, settleWarm };
}

/**
 * A range from the design (`190–441`): red when the measurement is more than 25 % beyond either end.
 * @param {[number, number]} range
 * @param {number} measured
 */
export function rangeVerdict(range, measured) {
  const [lo, hi] = range;
  if (measured < lo * 0.75)
    return { red: true, drift: `−${String(Math.round((1 - measured / lo) * 100))} % poniżej dołu` };
  if (measured > hi * 1.25)
    return { red: true, drift: `+${String(Math.round((measured / hi - 1) * 100))} % ponad górę` };
  return { red: false, drift: measured < lo || measured > hi ? 'poza zakresem, w tolerancji' : 'w zakresie' };
}

const RED = '🔴';
const ms = (/** @type {number | null} */ v) => (v === null ? '—' : `${fmt(v)} ms`);
const x = (/** @type {number | null} */ v) => (v === null ? '—' : `${v.toFixed(1).replace('.', ',')}×`);

/**
 * BUDGET.md. Every number comes from `results` — the design column is the only hand-written one,
 * and it is DESIGN.md §6 verbatim.
 * @param {any} results
 */
export function renderBudget(results) {
  const c = compareWithDesign(results);
  const bi = results.bi ?? {};
  const modeNote = (/** @type {any} */ v, /** @type {string} */ expected) =>
    v?.samples?.length
      ? v.validModes
        ? `n=${String(v.n)}, każdy \`${expected}\``
        : `n=${String(v.n)}, **tryby: ${v.modes.join(', ')}**`
      : 'brak pomiaru';
  const lines = [
    '# BUDGET.md — budżet czasu z DESIGN.md §6 vs pomiar',
    '',
    `Generowany przez \`npm run bench\` (${String(results.meta?.date ?? '')}). Kolumna „projekt” to tabela §6 DESIGN.md pogrupowana tak,`,
    'jak silnik raportuje fazy (`report.json.timing`: `queuedMs`, `scrubMs`, `gotoMs`, `stepsMs`, `captureMs`, `writeMs`, `totalMs`;',
    '`_manifest.json.timing`: `keeperStartMs`, `launchMs`, `clientMs`; stoper benchu: `spawn → exit` klienta). Kolumna „pomiar” to',
    '**mediana** z próbek wariantu, nigdy pojedynczy przebieg. 🔴 = rozjazd > 25 % od projektu (dla projektu 0: > 25 ms) albo iloraz < 5,0.',
    '',
    '## Fazy przebiegu (18 kroków `bench/task.mjs`)',
    '',
    `Tryby przebiegów: bi-warm ${modeNote(bi.warm, 'warm')} · bi-warm-tight ${modeNote(bi.tight, 'warm')} · bi-first ${modeNote(bi.first, 'first')} · bi-cold ${modeNote(bi.cold, 'no-daemon')}.`,
    '',
    '| faza | bi-warm (projekt / pomiar) | bi-warm-tight | bi-first | bi-cold |',
    '| --- | ---: | ---: | ---: | ---: |',
  ];
  const cell = (/** @type {any} */ k) => {
    if (!k) return '—';
    if (k.measured === null) return `${k.design === null ? '—' : fmt(k.design)} / —`;
    return `${k.red ? `${RED} ` : ''}${k.design === null ? '—' : fmt(k.design)} / **${fmt(k.measured)}** (${k.drift})`;
  };
  for (const row of [...c.phases, c.total]) {
    const anyRed = COLUMNS.some((col) => row.cells[col]?.red);
    lines.push(
      `| ${anyRed ? `${RED} ` : ''}${row.label} | ${COLUMNS.map((col) => cell(row.cells[col])).join(' | ')} |`,
    );
  }
  lines.push('');
  lines.push(
    'Uwagi do odczytu: scrub poprzedniego przebiegu keeper wykonuje **w kolejce lane’u po odpowiedzi** (`afterAnswer`), więc z',
    'przerwą 300 ms jest poza stoperem (`queuedMs` 0, `scrubMs` 0), a bez przerwy (`bi-warm-tight`) czeka na niego następny klient',
    'i płaci go jako `queuedMs` (§6: 15). `scrubMs` > 0 tylko wtedy, gdy siatka bezpieczeństwa w `runFlow` zastała brudny lane — między',
    'snapshotami jednego batchu (legalnie w stoperze, §2.3) albo przy `--no-daemon`. Wiersz „klient” dla `bi-cold` obejmuje zamknięcie',
    'przeglądarki, bo `--no-daemon` nie rozdziela tych dwóch rzeczy w żadnym pliku.',
    '',
    '## queuedMs, scrubMs, cacheHits — osobno',
    '',
    '| wariant | queuedMs (med / p90 / max) | scrubMs (med / p90 / max) | cacheHits (med) | cacheHitsDocument (max) |',
    '| --- | ---: | ---: | ---: | ---: |',
  );
  for (const [name, v] of [
    ['bi-warm', bi.warm],
    ['bi-warm-tight', bi.tight],
    ['bi-warm-fresh', bi.fresh],
    ['bi-first', bi.first],
    ['bi-cold', bi.cold],
  ]) {
    if (!v?.stats) continue;
    const red = (v.cacheHitsDocument?.max ?? 0) > 0;
    const s = (/** @type {any} */ st) => (st ? `${fmt(st.median)} / ${fmt(st.p90)} / ${fmt(st.max)}` : '—');
    lines.push(
      `| ${red ? `${RED} ` : ''}${name} | ${s(v.queuedMs)} | ${s(v.scrubMs)} | ${fmt(v.cacheHits?.median ?? 0)} | ${fmt(v.cacheHitsDocument?.max ?? 0)} |`,
    );
  }
  lines.push(
    '',
    'Czerwony wiersz tu oznacza `cacheHitsDocument > 0`: dokument główny podany z cache HTTP (serwer z `Last-Modified` i heurystyczną',
    'świeżością potrafi oddać stary `index.html` po rebuildzie — §2.3); serwer benchu nie wysyła nagłówków cache, więc 0 jest oczekiwane.',
    '',
    '## Ilorazy wobec MCP (mediany, ten sam dzień, ta sama maszyna)',
    '',
  );
  if (c.naiveWarm === null) {
    lines.push('Brak pomiaru MCP w tym przebiegu (`--only bi`) — ilorazy nie są liczone.', '');
  } else {
    lines.push(
      `MCP naive warm: **${fmt(c.naiveWarm)} ms** · MCP naive 1. przebieg: ${ms(c.naiveFirst)} · MCP lean \`--timeout-settle 100\` warm: ${ms(c.settleWarm)}.`,
      '',
      '| wariant bi | mediana | p90 | podstawa | iloraz (pomiar) | iloraz (projekt §6) | vs lean settle 100 |',
      '| --- | ---: | ---: | --- | ---: | ---: | ---: |',
    );
    for (const r of c.ratioRows) {
      const flag = r.red ? `${RED} ` : '';
      const modes = r.validModes ? '' : ' (tryb ≠ oczekiwany!)';
      lines.push(
        `| ${flag}${r.name}${modes} | ${fmt(r.median)} ms | ${fmt(r.p90)} ms | ${r.baseLabel} ${ms(r.base)} | **${x(r.ratio)}** | ${x(r.design)} | ${x(r.ratioSettle)} |`,
      );
    }
    lines.push(
      '',
      '🔴 przy ilorazie < 5,0 jest literalne (AC-19); dla `bi-first`, `bi-cold` i `bi-warm-fresh` projekt **nie obiecuje** 5× (kolumna',
      '„projekt §6”: 2,4× / 2,2× / 3,1×) — czerwień mówi tam tylko „poniżej progu 5×”, nie „gorzej niż projekt”.',
      '',
    );
  }
  if (c.extras.length > 0) {
    lines.push(
      '## Wiersze poza flow benchu (§6, druga tabela)',
      '',
      '| sytuacja | projekt | pomiar | ocena |',
      '| --- | ---: | ---: | --- |',
    );
    for (const e of c.extras)
      lines.push(`| ${e.red ? `${RED} ` : ''}${e.label} | ${e.design} | ${e.measured} | ${e.drift} |`);
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}
