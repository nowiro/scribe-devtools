// bench.test.mjs — the pure parts of the bench and the pin of @playwright/mcp. No browser, no
// keeper, no server: what runs here must be green on a machine without Chrome.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { TOKEN_LIMIT, extractInstruction } from '../scripts/check-instruction-sync.mjs';
import { INSTRUCTION, findingsFromReport, parseRefs, pipeNameFor, refOf } from './browser-inspector-run.mjs';
import { COLUMNS, DESIGN_BUDGET, compareWithDesign, rangeVerdict, renderBudget, verdict } from './budget.mjs';
import { mcpVersion, readDefinition, refFor } from './mcp-run.mjs';
import { paritySummary, renderRaport, renderReadmeBlock } from './raport.mjs';
import { safePath } from './serve.mjs';
import { EXPECTED, FLOW_STEPS, browserInspectorConfig, checkFindings } from './task.mjs';
import { chromeDescendants, makeStamp, stats } from './time-run.mjs';
import { countTokens, measure, total } from './tokens.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MCP_PIN = '0.0.80';

describe('pin @playwright/mcp', () => {
  /** The example configs carry `//` comments (JSONC), so a plain JSON.parse would choke on them. */
  const readJsonc = (/** @type {string} */ file) =>
    JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\s*\/\/.*$/gmu, ''));

  test(`bench/package.json and both MCP example configs pin ${MCP_PIN}`, () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(REPO, 'bench', 'package.json'), 'utf8'));
    expect(pkg.devDependencies['@playwright/mcp']).toBe(MCP_PIN);
    const mcpJson = readJsonc(path.join(REPO, '.mcp.playwright.example.json'));
    expect(mcpJson.mcpServers.playwright.args).toContain(`@playwright/mcp@${MCP_PIN}`);
    const vscode = readJsonc(path.join(REPO, '.vscode', 'mcp.playwright.example.json'));
    expect(vscode.servers.playwright.args).toContain(`@playwright/mcp@${MCP_PIN}`);
  });
  test('no live MCP config ships in the repository — the server would cost 4069 tokens per agent request', () => {
    expect(fs.existsSync(path.join(REPO, '.mcp.json'))).toBe(false);
    expect(fs.existsSync(path.join(REPO, '.vscode', 'mcp.json'))).toBe(false);
  });
  test('the installed @playwright/mcp is the pinned version', () => {
    expect(mcpVersion()).toBe(MCP_PIN);
  });
});

describe('INSTRUCTION', () => {
  test('equals the AGENTS.md block character for character', () => {
    const agents = fs.readFileSync(path.join(REPO, 'AGENTS.md'), 'utf8');
    expect(extractInstruction(agents)).toBe(INSTRUCTION);
  });
  test('costs at most TOKEN_LIMIT (200) o200k tokens (AC-6)', () => {
    expect(countTokens(INSTRUCTION)).toBeLessThanOrEqual(TOKEN_LIMIT);
  });
});

describe('task', () => {
  test('the flow has the 18 steps of DESIGN.md §6 in the listed order', () => {
    expect(FLOW_STEPS.map((s) => s.do)).toEqual([
      'waitFor',
      'click',
      'extract',
      'extract',
      'screenshot',
      'fill',
      'fill',
      'select',
      'click',
      'fill',
      'click',
      'click',
      'waitFor',
      'extract',
      'extract',
      'extract',
      'evaluate',
      'screenshot',
    ]);
  });
  test('browserInspectorConfig carries the flow and the output dir', () => {
    const config = browserInspectorConfig({ outputDir: './x' });
    expect(config.outputDir).toBe('./x');
    expect(config.snapshots[0].steps).toHaveLength(18);
  });
  const COMPLETE = {
    ticketId: 'ALM-1001',
    category: 'zmiana',
    priority: 'krytyczny',
    emailError: 'Podaj poprawny adres e-mail.',
    consoleError: 'Failed to load resource\n[zgloszenia] zapis nie powiodl sie: HTTP 404',
    screenshots: 2,
  };
  test('the gate passes a complete set of facts', () => {
    expect(checkFindings(COMPLETE)).toEqual([]);
  });
  test('the gate catches a missing console error — a blind variant is not a cheaper one', () => {
    const { consoleError, ...blind } = COMPLETE;
    expect(checkFindings(blind)).toEqual(['consoleError: undefined']);
  });
  test('the gate catches too few screenshots and a wrong ticket', () => {
    expect(checkFindings({ ...COMPLETE, screenshots: 1 })).toEqual(['screenshots: 1 < 2']);
    expect(checkFindings({ ...COMPLETE, ticketId: 'ALM-1002' })).toEqual([
      `ticketId: ALM-1002 != ${EXPECTED.ticketId}`,
    ]);
  });
  test('findingsFromReport reads report.json the way the agent reads report.md', () => {
    const report = {
      extracts: {
        'numer-zgloszenia': { value: 'ALM-1001' },
        kategoria: { value: 'zmiana' },
        priorytet: { value: 'krytyczny' },
        'blad-email': { value: 'Podaj poprawny adres e-mail.' },
      },
      console: {
        entries: [
          { type: 'warning', text: 'x' },
          { type: 'error', text: 'Failed to load resource' },
          { type: 'error', text: '[zgloszenia] zapis nie powiodl sie: HTTP 404' },
        ],
      },
      screenshots: ['walidacja.png', 'potwierdzenie.png', 'final.png'],
    };
    const findings = findingsFromReport(report);
    expect(findings.screenshots).toBe(2);
    expect(checkFindings(findings)).toEqual([]);
  });
});

describe('time-run', () => {
  test('stats: median and p90 (nearest rank)', () => {
    expect(stats([5, 1, 3])).toEqual({ n: 3, min: 1, max: 5, median: 3, p90: 5 });
    expect(stats([1, 2, 3, 4])).toMatchObject({ median: 3, p90: 4 });
    expect(stats([...Array(10).keys()].map((i) => i + 1))).toMatchObject({ n: 10, median: 6, p90: 9 });
    expect(stats([])).toEqual({ n: 0, min: 0, max: 0, median: 0, p90: 0 });
  });
  test('makeStamp is a valid --stamp and unique per repetition', () => {
    const base = new Date(2026, 8, 2, 10, 58);
    expect(makeStamp(0, base)).toBe('2026-09-02_10-58');
    expect(makeStamp(2, base)).toBe('2026-09-02_11-00');
    expect(makeStamp(0, base)).toMatch(/^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}$/u);
  });
  test('chromeDescendants follows the tree transitively', () => {
    const procs = [
      { pid: 10, ppid: 1 },
      { pid: 11, ppid: 10 },
      { pid: 12, ppid: 11 },
      { pid: 20, ppid: 2 },
    ];
    expect(chromeDescendants(1, procs).sort()).toEqual([10, 11, 12]);
    expect(chromeDescendants(3, procs)).toEqual([]);
  });
  test('pipeNameFor: a Windows named pipe or a socket under tmpdir', () => {
    const name = pipeNameFor('browser-inspector-x', '/tmp');
    if (process.platform === 'win32') expect(name).toBe('\\\\.\\pipe\\browser-inspector-x');
    else expect(name).toBe(path.join('/tmp', 'browser-inspector-x.sock'));
  });
});

describe('browser-inspector session output', () => {
  const SNAP = [
    'h1 "Zgłoszenie serwisowe"',
    'e10 textbox "Imię i nazwisko" [data-testid=field-name]',
    'e14 combobox "Kategoria" [data-testid=field-category]',
    'option "Awaria" [selected]',
    'e22 radio "Krytyczny" [data-testid=priority-krytyczny]',
    'f1e28 button "Wyślij zgłoszenie" [data-testid=submit]',
  ].join('\n');
  test('parseRefs reads refs, roles and names; refOf finds by role + name', () => {
    const refs = parseRefs(SNAP);
    expect(refs).toHaveLength(4);
    expect(refOf(refs, 'button', /^Wyślij/u)).toBe('f1e28');
    expect(refOf(refs, 'textbox', /^Imię/u)).toBe('e10');
    expect(() => refOf(refs, 'checkbox', /Zgadzam/u)).toThrow(/no checkbox/u);
  });
});

describe('mcp-run', () => {
  const SNAPSHOT = [
    '- main [ref=e3]:',
    '  - textbox "E-mail" [ref=e10]',
    '  - button "Wyślij zgłoszenie" [ref=e26] [cursor=pointer]',
    '  - term [ref=e38]: Kategoria',
    '  - definition [ref=e39]: zmiana',
  ].join('\n');
  test('refFor extracts the ref, also a frame-prefixed one', () => {
    expect(refFor(SNAPSHOT, /button "Wyślij zgłoszenie"/u)).toBe('e26');
    expect(refFor('  - button "Wyślij zgłoszenie" [ref=f1e26]', /button "Wyślij/u)).toBe('f1e26');
    expect(() => refFor(SNAPSHOT, /button "Nie ma"/u)).toThrow(/no ref/u);
  });
  test('readDefinition strips the [ref] marker from the value', () => {
    expect(readDefinition(SNAPSHOT, 'Kategoria')).toBe('zmiana');
    expect(readDefinition(SNAPSHOT, 'Priorytet')).toBeUndefined();
  });
});

describe('tokens', () => {
  test('measure counts bytes and tokens, total sums', () => {
    const items = [measure('a', 'hello'), measure('b', 'world')];
    expect(total(items).bytes).toBe(10);
    expect(total(items).tokens).toBeGreaterThanOrEqual(2);
  });
});

describe('serve', () => {
  const root = path.resolve('/srv/app');
  test('safePath never leaves the root, and a sibling with the same prefix does not pass', () => {
    expect(safePath(root, '/../../../etc/passwd').startsWith(root)).toBe(true);
    expect(safePath(root, '/main.js')).toBe(path.join(root, 'main.js'));
    const out = safePath(root, '/../app-evil/x');
    expect(out === root || out.startsWith(root + path.sep)).toBe(true);
  });
  test('a broken percent falls back to the root instead of throwing', () => {
    expect(safePath(root, '/%zz')).toBe(root);
  });
});

/** A results.json with one sample per column, built so that every phase is inspectable. */
function syntheticResults(overrides = {}) {
  const sample = (wallMs, timing, manifestTiming, mode) => ({
    wallMs,
    timing: { mode, ...timing },
    manifestTiming: { mode, ...manifestTiming },
    mode,
  });
  const variant = (name, expectedMode, samples) => ({
    name,
    n: samples.length,
    stats: stats(samples.map((s) => s.wallMs)),
    modes: samples.map((s) => s.mode),
    validModes: samples.every((s) => s.mode === expectedMode),
    expectedMode,
    problems: [],
    samples,
    queuedMs: stats(samples.map((s) => s.timing.queuedMs)),
    scrubMs: stats(samples.map((s) => s.timing.scrubMs)),
    gotoMs: stats(samples.map((s) => s.timing.gotoMs)),
    cacheHits: stats(samples.map(() => 0)),
    cacheHitsDocument: stats(samples.map((s) => s.timing.cacheHitsDocument ?? 0)),
  });
  const warmTiming = {
    queuedMs: 0,
    scrubMs: 8,
    gotoMs: 50,
    stepsMs: 380,
    captureMs: 10,
    writeMs: 12,
    totalMs: 460,
    cacheHits: 0,
    cacheHitsDocument: 0,
  };
  return {
    meta: { date: '2026-09-02', os: {}, versions: {} },
    browserInspector: {
      warm: variant('browser-inspector-warm', 'warm', [sample(540, warmTiming, { clientMs: 470 }, 'warm')]),
      tight: variant('browser-inspector-warm-tight', 'warm', [
        sample(560, { ...warmTiming, queuedMs: 10 }, { clientMs: 480 }, 'warm'),
      ]),
      first: variant('browser-inspector-first', 'first', [
        sample(
          1400,
          { ...warmTiming, gotoMs: 300, totalMs: 700 },
          { clientMs: 1300, keeperStartMs: 45, launchMs: 180 },
          'first',
        ),
      ]),
      cold: variant('browser-inspector-cold', 'no-daemon', [
        sample(1600, { ...warmTiming, gotoMs: 340, totalMs: 850 }, { clientMs: 1350 }, 'no-daemon'),
      ]),
      ...overrides,
    },
    mcp: {
      tokens: [],
      time: [
        {
          name: 'mcp-naive',
          firstRunMs: 3600,
          warm: { n: 3, median: 2900, p90: 3000, min: 2800, max: 3000 },
          problems: [],
        },
        {
          name: 'mcp-lean-settle-100',
          firstRunMs: 1500,
          warm: { n: 3, median: 1000, p90: 1100, min: 900, max: 1100 },
          problems: [],
        },
      ],
    },
  };
}

describe('budget', () => {
  test('DESIGN_BUDGET totals are the §6 totals', () => {
    expect(DESIGN_BUDGET.totals).toEqual({
      'browser-inspector-warm': 546,
      'browser-inspector-warm-tight': 561,
      'browser-inspector-first': 1469,
      'browser-inspector-cold': 1618,
    });
    expect(COLUMNS).toEqual([
      'browser-inspector-warm',
      'browser-inspector-warm-tight',
      'browser-inspector-first',
      'browser-inspector-cold',
    ]);
  });
  test('verdict: > 25 % drift is red, a design of 0 tolerates 25 ms', () => {
    expect(verdict(100, 120).red).toBe(false);
    expect(verdict(100, 130).red).toBe(true);
    expect(verdict(100, 70).red).toBe(true);
    expect(verdict(0, 20).red).toBe(false);
    expect(verdict(0, 40).red).toBe(true);
    expect(verdict(null, 999)).toEqual({ red: false, drift: '—' });
  });
  test('rangeVerdict: beyond either end by more than 25 % is red', () => {
    expect(rangeVerdict([190, 441], 300).red).toBe(false);
    expect(rangeVerdict([190, 441], 500).red).toBe(false);
    expect(rangeVerdict([190, 441], 600).red).toBe(true);
    expect(rangeVerdict([190, 441], 100).red).toBe(true);
  });
  test('compareWithDesign: phases come from timing/manifest medians, ratios from MCP medians', () => {
    const c = compareWithDesign(syntheticResults());
    const goto = /** @type {any} */ (c.phases.find((p) => p.key === 'goto'));
    expect(goto.cells['browser-inspector-warm']).toMatchObject({ design: 55, measured: 50, red: false });
    expect(goto.cells['browser-inspector-first']).toMatchObject({ design: 250, measured: 300, red: false });
    const client = /** @type {any} */ (c.phases.find((p) => p.key === 'client'));
    // wall 540 − clientMs 470 = 70 vs design 85 → −18 %, not red.
    expect(client.cells['browser-inspector-warm']).toMatchObject({ measured: 70, red: false });
    // wall 1400 − clientMs 1300 − keeperStartMs 45 = 55 vs 85 → −35 %, red.
    expect(client.cells['browser-inspector-first']).toMatchObject({ measured: 55, red: true });
    expect(c.total.cells['browser-inspector-warm']).toMatchObject({ design: 546, measured: 540 });
    const warm = c.ratioRows.find((r) => r.name === 'browser-inspector-warm');
    expect(warm.ratio).toBeCloseTo(2900 / 540, 3);
    expect(warm.red).toBe(false);
    const first = c.ratioRows.find((r) => r.name === 'browser-inspector-first');
    expect(first.baseLabel).toMatch(/1\. przebieg/u);
    expect(first.red).toBe(true);
  });
  test('renderBudget marks a slow warm run red on the total row and on the ratio row', () => {
    const slow = syntheticResults();
    slow.browserInspector.warm.samples[0].wallMs = 900;
    slow.browserInspector.warm.stats = stats([900]);
    const md = renderBudget(slow);
    expect(md).toMatch(/🔴 \*\*razem\*\*/u);
    expect(md).toMatch(/🔴 browser-inspector-warm \|/u);
    const fine = renderBudget(syntheticResults());
    expect(fine).not.toMatch(/🔴 browser-inspector-warm \|/u);
    expect(fine).toMatch(/## queuedMs, scrubMs, cacheHits/u);
  });
  test('renderBudget reddens cacheHitsDocument > 0', () => {
    const r = syntheticResults();
    r.browserInspector.warm.cacheHitsDocument = stats([1]);
    expect(renderBudget(r)).toMatch(/🔴 browser-inspector-warm \| /u);
  });
});

describe('raport', () => {
  test('the header table has the three MCP columns and the ratios come from the numbers', () => {
    const md = renderRaport(syntheticResults());
    expect(md).toMatch(
      /\| wariant \| mediana \| p90 \| n · tryb \| × vs MCP naive \| × vs MCP lean \| × vs MCP lean `--timeout-settle 100` \|/u,
    );
    expect(md).toMatch(/5,4×/u); // 2900 / 540
    expect(md).toMatch(/vs domyślne/u);
    expect(md).toMatch(/vs zestrojony settle 100/u);
  });
  test('an invalid mode in a warm column is shown in bold, not averaged away', () => {
    const r = syntheticResults();
    r.browserInspector.warm.modes = ['first'];
    r.browserInspector.warm.validModes = false;
    expect(renderRaport(r)).toMatch(/\*\*first\*\*/u);
  });
  test('the README block is delimited and carries the warm median', () => {
    const block = renderReadmeBlock(syntheticResults());
    expect(block.startsWith('<!-- BENCH:START -->')).toBe(true);
    expect(block.endsWith('<!-- BENCH:END -->')).toBe(true);
    expect(block).toMatch(/\*\*540 ms\*\*/u);
  });
  test('paritySummary counts the §7 matrix of DESIGN.md — escaped pipes inside cells included', () => {
    const parity = paritySummary();
    // 23 ✅ · 1 ⚠️ (run_code_unsafe) · 2 ❌ (install; resume/annotate/video_*) · 1 row of
    // browser-inspector extras.
    const extra = parity.rows.filter((r) => r.mark === 'extra').length;
    expect(parity.ok + parity.partial + parity.missing + extra).toBe(parity.rows.length);
    expect(parity.rows).toHaveLength(27);
    expect([parity.ok, parity.partial, parity.missing, extra]).toEqual([23, 1, 2, 1]);
    expect(parity.rows.some((r) => r.tool.includes('install'))).toBe(true);
    // A row whose cells carry `\|` keeps its status and its tool name.
    const console = parity.rows.find((r) => r.tool.startsWith('console_messages'));
    expect(console).toMatchObject({ tool: 'console_messages (level)', mark: 'ok' });
    const net = parity.rows.find((r) => r.tool.startsWith('network_requests'));
    expect(net?.mark).toBe('ok');
    expect(paritySummary('## 7.\n| a | b | c | ⚠️ x |\n| d\\|e | f | g\\|h | ✅ |\n## 8.').rows).toEqual([
      { tool: 'a', status: '⚠️ x', mark: 'partial' },
      { tool: 'd|e', status: '✅', mark: 'ok' },
    ]);
  });
});
