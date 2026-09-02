// mcp-run.mjs — the same task through `@playwright/mcp` 0.0.80, in the variants the header table
// of RAPORT.md needs (port of demo/bench in scribe, DESIGN.md §9):
//
//   - `naive`  — the agent does not know the page. It has to SEE it to get a `ref` to click:
//                navigate, snapshot, actions, snapshot after every state change. That is what the
//                first approach to an unknown screen looks like, and what most sessions look like;
//   - `lean`   — the agent already knows the selectors (`target` also takes a plain CSS selector)
//                and uses `browser_find` instead of full snapshots. The best possible case for MCP —
//                and it is treated as such;
//   - `lean --timeout-settle 100` — the same `lean` with the server's 500 ms post-action settle
//                cut to 100 ms: two thirds of the time difference is that default policy, not the
//                architecture, and the report says so with a number.
//
// What is measured is the TEXT of every tool response: exactly what an MCP client pastes into the
// model's context window. The scenario (`performNaive` / `performLean`) is separated from who
// starts the server — the token run (fresh server) and the time run (one server, repeated task)
// drive the SAME code, not two copies.
import { createRequire } from 'node:module';
import path from 'node:path';
import { initialize, startMcp, textOf } from './mcp-client.mjs';
import { APP_URL, INPUT } from './task.mjs';
import { sleep } from './time-run.mjs';

const require = createRequire(import.meta.url);

/** `cli.js` of the pinned `@playwright/mcp` — resolved from the bench workspace, wherever npm hoisted it. */
export function mcpCli() {
  return path.join(path.dirname(require.resolve('@playwright/mcp/package.json')), 'cli.js');
}

export function mcpVersion() {
  return String(require('@playwright/mcp/package.json').version);
}

/**
 * @param {string} outputDir
 * @param {string[]} [extra]
 */
export function mcpArgs(outputDir, extra = []) {
  return [
    mcpCli(),
    '--browser',
    'chrome',
    '--headless',
    '--isolated',
    '--viewport-size',
    '1280,720',
    '--output-dir',
    outputDir,
    ...extra,
  ];
}

/**
 * The `ref` of an element in a snapshot — exactly the work the model has to do on the MCP side:
 * read the tree and find the right line. After a navigation between documents the server prefixes
 * refs with a frame id (`f1e12`), so the pattern accepts any token, not only digits after `e`.
 * @param {string} snapshot
 * @param {RegExp} pattern
 */
export function refFor(snapshot, pattern) {
  for (const line of snapshot.split('\n')) {
    if (!pattern.test(line)) continue;
    const ref = /\[ref=([^\]\s]+)\]/u.exec(line);
    if (ref) return ref[1];
  }
  // The snapshot goes into the message: without it "no ref" does not say whether the page is
  // different or just not rendered yet — two very different fixes.
  throw new Error(`no ref for ${String(pattern)} in the snapshot:\n${snapshot.slice(0, 600)}`);
}

/**
 * The confirmation renders a `<dl>` — the value sits one line below the term in the snapshot,
 * and the line still carries its `[ref=eN]` marker. The same parsing a model has to perform.
 * @param {string} snapshot
 * @param {string} term
 */
export function readDefinition(snapshot, term) {
  const lines = snapshot.split('\n');
  const index = lines.findIndex((line) =>
    line
      .replace(/\[[^\]]*\]/gu, '')
      .trim()
      .endsWith(term),
  );
  if (index < 0) return undefined;
  const next = (lines[index + 1] ?? '').replace(/\[[^\]]*\]/gu, '');
  return next.split(':').slice(1).join(':').trim() || undefined;
}

/**
 * @typedef {object} McpCall
 * @property {string} tool
 * @property {string} request JSON of the arguments — what the model writes
 * @property {string} response text of the result — what enters the context
 * @property {number} ms
 */

/**
 * One call: records the request and the full response as context items.
 * @param {ReturnType<typeof startMcp>} mcp
 * @param {McpCall[]} calls
 */
function recorder(mcp, calls) {
  return async (/** @type {string} */ name, /** @type {object} */ args) => {
    const request = JSON.stringify({ name, arguments: args });
    const t0 = performance.now();
    const { result } = await mcp.request('tools/call', { name, arguments: args });
    const text = textOf(result);
    if (/^### Error/mu.test(text)) throw new Error(`${name}: ${text}`);
    calls.push({ tool: name, request, response: text, ms: Math.round(performance.now() - t0) });
    return text;
  };
}

/** @typedef {(name: string, args: object) => Promise<string>} Call */

/**
 * "The agent sees this screen for the first time." An action response does not carry the
 * snapshot inline — it links a `.yml` in the output directory. The agent has to see it anyway to
 * get a `ref`, so the explicit `browser_snapshot` is counted: the same content, only inline.
 * @param {Call} call
 * @param {(name: string) => string} shot screenshot path (different in every repetition)
 */
export async function performNaive(call, shot) {
  await call('browser_navigate', { url: APP_URL });
  const snapshot1 = await call('browser_snapshot', {});
  const submitRef = refFor(snapshot1, /button "Wyślij zgłoszenie"/u);

  await call('browser_click', { element: 'przycisk Wyslij zgloszenie', target: submitRef });
  // The state changed: to read the validation messages, the agent has to look.
  const snapshot2 = await call('browser_snapshot', {});
  const emailError = /Podaj poprawny adres e-mail[^\n]*/u.exec(snapshot2)?.[0];
  await call('browser_take_screenshot', { filename: shot('naive-walidacja'), scale: 'css' });

  // Refs after a re-render may differ — they come from the fresh snapshot.
  await call('browser_type', {
    element: 'pole Imie i nazwisko',
    target: refFor(snapshot2, /textbox "Imię i nazwisko"/u),
    text: INPUT.name,
  });
  await call('browser_type', {
    element: 'pole E-mail',
    target: refFor(snapshot2, /textbox "E-mail"/u),
    text: INPUT.email,
  });
  await call('browser_select_option', {
    element: 'lista Kategoria',
    target: refFor(snapshot2, /combobox "Kategoria"/u),
    values: [INPUT.categoryLabel],
  });
  await call('browser_click', { element: 'radio Krytyczny', target: refFor(snapshot2, /radio "Krytyczny"/u) });
  await call('browser_type', {
    element: 'pole Opis',
    target: refFor(snapshot2, /textbox "Opis"/u),
    text: INPUT.description,
  });
  await call('browser_click', { element: 'checkbox zgody', target: refFor(snapshot2, /checkbox "Zgadzam/u) });
  await call('browser_click', {
    element: 'przycisk Wyslij zgloszenie',
    target: refFor(snapshot2, /button "Wyślij zgłoszenie"/u),
  });

  const snapshot3 = await call('browser_snapshot', {});
  await call('browser_take_screenshot', { filename: shot('naive-potwierdzenie'), scale: 'css' });
  // The console is a separate call and a separate result in the context — `browser-inspector` has it in the report.
  const consoleDump = await call('browser_console_messages', { onlyErrors: true });

  return {
    ticketId: /ALM-\d+/u.exec(snapshot3)?.[0],
    category: readDefinition(snapshot3, 'Kategoria'),
    priority: readDefinition(snapshot3, 'Priorytet'),
    emailError,
    consoleError: consoleDump,
  };
}

/**
 * "The agent already knows the selectors" — the cheapest possible road through MCP.
 * @param {Call} call
 * @param {(name: string) => string} shot
 */
export async function performLean(call, shot) {
  await call('browser_navigate', { url: APP_URL });
  await call('browser_click', { element: 'przycisk Wyslij', target: '[data-testid=submit]' });
  const errorHit = await call('browser_find', { text: 'Podaj poprawny adres e-mail' });
  await call('browser_take_screenshot', { filename: shot('lean-walidacja'), scale: 'css' });

  await call('browser_fill_form', {
    fields: [
      { target: '[data-testid=field-name]', name: 'Imie i nazwisko', type: 'textbox', value: INPUT.name },
      { target: '[data-testid=field-email]', name: 'E-mail', type: 'textbox', value: INPUT.email },
      { target: '[data-testid=field-category]', name: 'Kategoria', type: 'combobox', value: INPUT.categoryLabel },
      { target: '[data-testid=priority-krytyczny]', name: 'Priorytet krytyczny', type: 'radio', value: 'true' },
      { target: '[data-testid=field-description]', name: 'Opis', type: 'textbox', value: INPUT.description },
      { target: '[data-testid=field-consent]', name: 'Zgoda', type: 'checkbox', value: 'true' },
    ],
  });
  await call('browser_click', { element: 'przycisk Wyslij', target: '[data-testid=submit]' });
  // Three targeted reads through evaluate instead of a whole snapshot.
  const ticketId = await call('browser_evaluate', {
    function: '() => document.querySelector("[data-testid=ticket-id]").textContent',
  });
  const category = await call('browser_evaluate', {
    function: '() => document.querySelector("[data-testid=ticket-category]").textContent',
  });
  const priority = await call('browser_evaluate', {
    function: '() => document.querySelector("[data-testid=ticket-priority]").textContent',
  });
  await call('browser_take_screenshot', { filename: shot('lean-potwierdzenie'), scale: 'css' });
  const consoleDump = await call('browser_console_messages', { onlyErrors: true });

  const valueOf = (/** @type {string} */ text) => /### Result\n"?([^"\n]*)"?/u.exec(text)?.[1]?.trim();
  return {
    ticketId: valueOf(ticketId),
    category: valueOf(category),
    priority: valueOf(priority),
    emailError: /Podaj poprawny adres e-mail[^\n]*/u.exec(errorHit)?.[0],
    consoleError: consoleDump,
  };
}

export const VARIANTS = { naive: performNaive, lean: performLean };

/**
 * TOKENS: a fresh server, one run of the task, everything recorded.
 * @param {'naive' | 'lean'} variant
 * @param {string} outputDir
 * @param {string[]} [extra]
 */
export async function runVariant(variant, outputDir, extra = []) {
  const mcp = startMcp(process.execPath, mcpArgs(outputDir, extra));
  /** @type {McpCall[]} */
  const calls = [];
  const call = recorder(mcp, calls);
  try {
    const init = await initialize(mcp);
    const list = await mcp.request('tools/list', {});
    const findings = await VARIANTS[variant](call, (name) => path.join(outputDir, `${name}.png`));
    return {
      variant: `mcp-${variant}`,
      extra,
      init: JSON.stringify(init),
      definitions: JSON.stringify(list.result),
      toolCount: list.result.tools.length,
      calls,
      findings: {
        ...findings,
        // Counted from the ACTUAL calls: a constant "2" would keep lying after a scenario edit,
        // and the gate exists to catch exactly such an edit.
        screenshots: calls.filter((c) => c.tool === 'browser_take_screenshot').length,
      },
    };
  } finally {
    mcp.close();
    await mcp.exited;
  }
}

/**
 * TIME: the server is started ONCE, the task repeated: the first run is cold (the first navigation
 * launches Chrome), the next ones ride a warm process and an open browser. Between repetitions a
 * navigation to `about:blank` resets the page OUTSIDE the stopwatch (the form is gone after the
 * task and `browser_navigate` to the same URL would not reload it) and the bench waits `gapMs`
 * (300 ms, DESIGN.md §9 — the same gap as on the `browser-inspector` side).
 * @param {'naive' | 'lean'} variant
 * @param {string} outputDir
 * @param {number} reps runs after the first one
 * @param {{ extra?: string[], gapMs?: number }} [options]
 */
export async function timeVariant(variant, outputDir, reps, options = {}) {
  const extra = options.extra ?? [];
  const gapMs = options.gapMs ?? 300;
  const spawnedAt = performance.now();
  const mcp = startMcp(process.execPath, mcpArgs(outputDir, extra));
  /** @type {McpCall[]} */
  const calls = [];
  const call = recorder(mcp, calls);
  try {
    await initialize(mcp);
    const handshakeMs = Math.round(performance.now() - spawnedAt);
    const toolsAt = performance.now();
    await mcp.request('tools/list', {});
    const toolsListMs = Math.round(performance.now() - toolsAt);

    /** @type {number[]} */
    const taskMs = [];
    const problems = [];
    for (let rep = 0; rep <= reps; rep += 1) {
      if (rep > 0) {
        await call('browser_navigate', { url: 'about:blank' });
        await sleep(gapMs);
      }
      const at = performance.now();
      const findings = await VARIANTS[variant](call, (name) => path.join(outputDir, `t${String(rep)}-${name}.png`));
      taskMs.push(Math.round(performance.now() - at));
      if (!findings.ticketId) problems.push(`rep ${String(rep)}: no ticket id`);
    }
    return { variant: `mcp-${variant}`, extra, gapMs, handshakeMs, toolsListMs, taskMs, problems };
  } finally {
    mcp.close();
    await mcp.exited;
  }
}
