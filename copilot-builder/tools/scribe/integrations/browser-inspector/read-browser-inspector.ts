#!/usr/bin/env node
/**
 * read-browser-inspector — web pages through a real browser, as a script instead of the
 * Playwright MCP server.
 *
 * Why a script, when an MCP server for this exists
 * ------------------------------------------------
 * The same arithmetic as the rest of this repository: a server's tool
 * definitions are a fixed cost paid on every `tools/list`, whether or not the
 * session touches a browser that day. A script costs zero definition tokens and
 * leaves its whole result on disk, where reading it is a file read.
 *
 * What this deliberately does NOT replace: **live** step-by-step browsing,
 * where an agent looks at the page before deciding the next click. Keeping a
 * browser alive between calls means a persistent process answering requests —
 * that IS a server, and pretending a script can be one would only reinvent MCP
 * badly. The `flow` snapshot covers the scripted middle ground: the whole
 * sequence is written up front, runs in one batch, and is iterated by editing
 * the config and re-running.
 *
 * Two snapshot types:
 *   - `type: "page"` → open one URL; capture screenshot, console, page text and the
 *     interactive-elements map.
 *   - `type: "flow"` → open a URL, run steps (goto / click / fill / press / hover /
 *     select / scroll / wait / waitFor / screenshot / extract / evaluate), then capture
 *     the same final evidence.
 *
 * The batchable 80% of the Playwright MCP server, deliberately covered here:
 *   - `extract` and `evaluate` steps capture NAMED values into the report — the agent
 *     reads a specific element or expression result without parsing the whole page text;
 *   - the **interactive-elements map** (on by default, `captureElements: false` to skip)
 *     lists every visible link, button and form control with an accessible name and a
 *     ready selector — the same information the MCP server's page snapshot provides, and
 *     the reason an agent can write the NEXT flow iteration without guessing selectors.
 * The remaining 20% — live, look-then-click browsing — is exactly the part that needs a
 * persistent process, i.e. the server this repository chose not to run.
 *
 * A failing step is a RESULT, not a crash: the report records `completed:
 * false` with the step and its error, the final screenshot still happens
 * (that is the debugging gold), and the run exits 0 — the extraction itself
 * succeeded. Broken pages are exactly what this pipeline exists to document.
 *
 * The browser is the system Chrome or Edge, found via playwright-core's
 * `channel` — no 300 MB download, no lifecycle script (this workspace blocks
 * them anyway; `playwright-core` is the flavour without a postinstall).
 * `browser.executablePath` overrides everything for a custom binary.
 *
 * No SSRF guard here, on purpose: unlike the API pipelines, hitting
 * `localhost` is a PRIMARY use case (verify the dev server renders), and the
 * config author is the operator. The config file is gitignored like every
 * other extract config.
 *
 * Secrets never enter the config: a `fill` step takes `valueFromEnv` naming an
 * environment variable, so a login flow references `MY_APP_PASSWORD` and the
 * value stays out of every file.
 *
 * Output: `<outputDir>/<stamp>/<snapshot>/` with `report.json` (+ `.md`),
 * `*.png` screenshots, and `_manifest.json`.
 *
 * Run: `npm run read -- browser-inspector [path/to/read.config.browser-inspector.json]`
 */
import { join } from 'node:path';
import { z } from 'zod';
import { chromium, type Browser, type Page } from 'playwright-core';

import { fencedBlock } from '../shared/adf.js';
import {
  assertSafeBasename,
  assertUniqueSnapshotNames,
  createScriptLogger,
  defaultOutputDir,
  mdTable,
  renderFormatsSchema,
  runIfMain,
  snapshotNameSchema,
  startReadRun,
  writeManifest,
  writePipelineOutputs,
} from '../shared/read-runtime.js';

const SCRIPT_NAME = 'read-browser-inspector';
const log = createScriptLogger(SCRIPT_NAME);

const E_BROWSER_MISSING = 'E_BROWSER_MISSING';

// ── Config ───────────────────────────────────────────────────────────────────

/** Any absolute URL a browser can open — http(s) for sites, file: for local fixtures. */
const urlSchema = z
  .string()
  .min(1)
  .refine((value) => URL.canParse(value), { message: 'must be an absolute URL (http://, https:// or file://)' });

const waitUntilSchema = z.enum(['load', 'domcontentloaded', 'networkidle']).default('load');

/** Screenshot / step names become file basenames — same alphabet as snapshot names. */
const artifactNameSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]*$/)
  .max(64);

const GotoStep = z.strictObject({ do: z.literal('goto'), url: urlSchema, waitUntil: waitUntilSchema });
const ClickStep = z.strictObject({ do: z.literal('click'), selector: z.string().min(1) });
const FillStep = z.strictObject({
  do: z.literal('fill'),
  selector: z.string().min(1),
  /** Literal value — for anything that is not a secret. */
  value: z.string().optional(),
  /** Name of an environment variable holding the value — for anything that is. */
  valueFromEnv: z.string().min(1).optional(),
});
const PressStep = z.strictObject({ do: z.literal('press'), key: z.string().min(1) });
const WaitForStep = z.strictObject({
  do: z.literal('waitFor'),
  selector: z.string().min(1),
  state: z.enum(['attached', 'visible', 'hidden', 'detached']).default('visible'),
});
const ScreenshotStep = z.strictObject({
  do: z.literal('screenshot'),
  name: artifactNameSchema,
  fullPage: z.boolean().default(false),
});
const HoverStep = z.strictObject({ do: z.literal('hover'), selector: z.string().min(1) });
const SelectStep = z.strictObject({ do: z.literal('select'), selector: z.string().min(1), value: z.string().min(1) });
const ScrollStep = z.strictObject({
  do: z.literal('scroll'),
  /** Scroll an element into view… */
  selector: z.string().min(1).optional(),
  /** …or the page to an edge. Exactly one of the two (validated in the superRefine). */
  to: z.enum(['top', 'bottom']).optional(),
});
const WaitStep = z.strictObject({ do: z.literal('wait'), ms: z.number().int().min(50).max(10_000) });
/** Captures the element's text under `name` in the report — a targeted read, not a page dump. */
const ExtractStep = z.strictObject({ do: z.literal('extract'), name: artifactNameSchema, selector: z.string().min(1) });
/**
 * Captures the RESULT of a page-context JS expression under `name`. The expression is
 * operator-written config, same trust level as the flow itself — the danger to guard is
 * not the operator scripting their own page, it is a secret leaking into the report,
 * and `evaluate` has no access to any (secrets live in env vars the PAGE never sees).
 */
const EvaluateStep = z.strictObject({
  do: z.literal('evaluate'),
  name: artifactNameSchema,
  expression: z.string().min(1).max(2000),
});

const StepSchema = z.discriminatedUnion('do', [
  GotoStep,
  ClickStep,
  FillStep,
  PressStep,
  WaitForStep,
  ScreenshotStep,
  HoverStep,
  SelectStep,
  ScrollStep,
  WaitStep,
  ExtractStep,
  EvaluateStep,
]);
export type Step = z.infer<typeof StepSchema>;

const baseSnapshot = {
  name: snapshotNameSchema,
  url: urlSchema,
  waitUntil: waitUntilSchema,
  /** Navigation deadline. Steps use `stepTimeoutMs`. */
  navTimeoutMs: z.number().int().min(1000).max(120_000).default(30_000),
  viewport: z
    .strictObject({
      width: z.number().int().min(200).max(4000),
      height: z.number().int().min(200).max(4000),
    })
    .default({ width: 1280, height: 720 }),
  fullPage: z.boolean().default(false),
  /** The interactive-elements map in the report — on by default, off for huge pages. */
  captureElements: z.boolean().default(true),
  render: renderFormatsSchema,
} as const;

const PageSnapshot = z.strictObject({ ...baseSnapshot, type: z.literal('page') });
const FlowSnapshot = z.strictObject({
  ...baseSnapshot,
  type: z.literal('flow'),
  steps: z.array(StepSchema).min(1).max(50),
  stepTimeoutMs: z.number().int().min(100).max(60_000).default(10_000),
});

const SnapshotConfig = z.discriminatedUnion('type', [PageSnapshot, FlowSnapshot]);
type Snapshot = z.infer<typeof SnapshotConfig>;

export const ReadConfig = z
  .strictObject({
    outputDir: z.string().min(1).default(defaultOutputDir('browser-inspector')),
    /**
     * Which browser binary to drive. `executablePath` wins over `channel`;
     * with neither, `chrome` then `msedge` are tried — one of the two exists on
     * practically every desktop this repo runs on.
     */
    browser: z
      .strictObject({
        channel: z.enum(['chrome', 'msedge']).optional(),
        executablePath: z.string().min(1).optional(),
        headless: z.boolean().default(true),
      })
      .default({ headless: true }),
    snapshots: z.array(SnapshotConfig).min(1),
  })
  // A fill step must say where its value comes from — exactly one of the two.
  // Validated here rather than on the step schema, because a refined object
  // cannot be a discriminated-union member; the issue path still points at the
  // exact step thanks to `loadJsonConfig`'s `snapshots[i].steps[j]` rendering.
  .superRefine((config, ctx) => {
    config.snapshots.forEach((snapshot, i) => {
      if (snapshot.type !== 'flow') return;
      // Names are file/report keys: a screenshot writes `<name>.png`, extract and
      // evaluate share one extracts map — a duplicate silently destroys the earlier
      // step's evidence while the report lists the name twice as if both existed.
      const screenshotNames = new Set<string>();
      const captureNames = new Set<string>();
      snapshot.steps.forEach((step, j) => {
        if (step.do === 'screenshot') {
          if (screenshotNames.has(step.name)) {
            ctx.addIssue({
              code: 'custom',
              path: ['snapshots', i, 'steps', j],
              message: `duplicate screenshot name "${step.name}" — the later capture would overwrite the earlier file`,
            });
          }
          screenshotNames.add(step.name);
        }
        if (step.do === 'extract' || step.do === 'evaluate') {
          if (captureNames.has(step.name)) {
            ctx.addIssue({
              code: 'custom',
              path: ['snapshots', i, 'steps', j],
              message: `duplicate capture name "${step.name}" — extract and evaluate share one namespace`,
            });
          }
          captureNames.add(step.name);
        }
        if (step.do === 'fill') {
          const sources = [step.value, step.valueFromEnv].filter((v) => v !== undefined).length;
          if (sources !== 1) {
            ctx.addIssue({
              code: 'custom',
              path: ['snapshots', i, 'steps', j],
              message: 'a fill step needs exactly one of "value" or "valueFromEnv"',
            });
          }
        }
        if (step.do === 'scroll') {
          const targets = [step.selector, step.to].filter((v) => v !== undefined).length;
          if (targets !== 1) {
            ctx.addIssue({
              code: 'custom',
              path: ['snapshots', i, 'steps', j],
              message: 'a scroll step needs exactly one of "selector" or "to"',
            });
          }
        }
        // `final.png` is the automatic end-of-flow capture. A step allowed to claim
        // the name had its evidence silently overwritten by that capture, while the
        // report listed final.png twice as if both existed.
        if (step.do === 'screenshot' && step.name === 'final') {
          ctx.addIssue({
            code: 'custom',
            path: ['snapshots', i, 'steps', j],
            message: 'the name "final" is reserved for the automatic end-of-flow screenshot — pick another name',
          });
        }
      });
    });
  })
  .superRefine(assertUniqueSnapshotNames);

// ── Report shape ─────────────────────────────────────────────────────────────

/** Caps on captured evidence. Every one of them is marked in the report when it bites. */
const CONSOLE_CAP = 500;
const FAILED_REQUEST_CAP = 100;
const TEXT_CAP = 20_000;
const EXTRACT_CAP = 5000;
const ELEMENTS_CAP = 100;

interface ConsoleEntry {
  readonly type: string;
  readonly text: string;
  readonly location?: string;
}
interface FailedRequest {
  readonly url: string;
  readonly failure: string;
}
interface StepResult {
  readonly index: number;
  readonly description: string;
  readonly ok: boolean;
  readonly error?: string;
}
interface ExtractedValue {
  readonly value: string;
  readonly truncated: boolean;
}
interface ElementEntry {
  /** `a`, `button`, `select`, `input[password]`, … */
  readonly kind: string;
  /** Accessible name, best-effort: aria-label, visible text, placeholder, title. */
  readonly name: string;
  /** A selector that FINDS the element again: #id, [data-testid], [name], or a short positional path. */
  readonly selector: string;
  readonly href?: string;
  readonly disabled?: boolean;
}

export interface WebReport {
  readonly name: string;
  readonly startUrl: string;
  readonly finalUrl?: string;
  readonly title?: string;
  /** False when navigation or a step failed; the error sits on the step or in `navigationError`. */
  readonly completed: boolean;
  readonly navigationError?: string;
  readonly console: { readonly entries: readonly ConsoleEntry[]; readonly total: number; readonly truncated: boolean };
  readonly pageErrors: readonly string[];
  readonly failedRequests: { readonly entries: readonly FailedRequest[]; readonly truncated: boolean };
  readonly text: { readonly content: string; readonly truncated: boolean };
  readonly steps?: readonly StepResult[];
  /** Named values captured by `extract` / `evaluate` steps. */
  readonly extracts?: Readonly<Record<string, ExtractedValue>>;
  /** The interactive-elements map — what an agent needs to write the next flow iteration. */
  readonly elements?: {
    readonly entries: readonly ElementEntry[];
    readonly total: number;
    readonly truncated: boolean;
  };
  readonly screenshots: readonly string[];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const errorMessage = (error: unknown): string =>
  error instanceof Error ? (error.message.split('\n')[0] ?? error.message) : String(error);

type BrowserConfig = z.infer<typeof ReadConfig>['browser'];

/**
 * Launch the system browser. Every attempt and its failure is collected, so
 * the E_BROWSER_MISSING message says what was actually tried instead of a bare
 * "could not launch" — the difference between a fixable message and a shrug.
 */
async function launchBrowser(config: BrowserConfig): Promise<Browser> {
  const attempts: string[] = [];
  const options = { headless: config.headless };
  if (config.executablePath) {
    try {
      return await chromium.launch({ ...options, executablePath: config.executablePath });
    } catch (error) {
      attempts.push(`executablePath ${config.executablePath}: ${errorMessage(error)}`);
    }
  } else {
    for (const channel of config.channel ? [config.channel] : (['chrome', 'msedge'] as const)) {
      try {
        return await chromium.launch({ ...options, channel });
      } catch (error) {
        attempts.push(`channel ${channel}: ${errorMessage(error)}`);
      }
    }
  }
  throw new Error(
    `${E_BROWSER_MISSING}: no usable browser.\n` +
      attempts.map((a) => `  tried ${a}`).join('\n') +
      '\nInstall Google Chrome or Microsoft Edge, or point browser.executablePath at a Chromium binary.',
  );
}

/**
 * Resolve what a fill step types. Env resolution happens at RUN time, not at
 * parse time, so a config referencing `MY_APP_PASSWORD` parses fine on a
 * machine that does not have the secret — it only fails when the flow actually
 * needs to type it, and then it names the variable.
 */
export function resolveFillValue(step: { value?: string; valueFromEnv?: string }): string {
  if (step.value !== undefined) return step.value;
  const name = step.valueFromEnv ?? '';
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`fill step needs env variable ${name}, and it is not set`);
  }
  return value;
}

/** One line per step for the report — never echoes a fill VALUE, only its origin. */
export function describeStep(step: Step): string {
  switch (step.do) {
    case 'goto':
      return `goto ${step.url}`;
    case 'click':
      return `click ${step.selector}`;
    case 'fill':
      return `fill ${step.selector} ${step.valueFromEnv ? `(from env ${step.valueFromEnv})` : '(literal)'}`;
    case 'press':
      return `press ${step.key}`;
    case 'waitFor':
      return `waitFor ${step.selector} (${step.state})`;
    case 'screenshot':
      return `screenshot ${step.name}`;
    case 'hover':
      return `hover ${step.selector}`;
    case 'select':
      return `select ${step.selector} = ${step.value}`;
    case 'scroll':
      return `scroll ${step.selector ?? step.to ?? ''}`;
    case 'wait':
      return `wait ${String(step.ms)}ms`;
    case 'extract':
      return `extract ${step.name} ← ${step.selector}`;
    case 'evaluate':
      // The expression itself is in the config; the report line stays one line.
      return `evaluate ${step.name}`;
  }
}

/** Cap one captured value; the cap is marked, never silent. */
const capExtract = (raw: string): ExtractedValue => ({
  value: raw.slice(0, EXTRACT_CAP),
  truncated: raw.length > EXTRACT_CAP,
});

export function renderReportMarkdown(report: WebReport): string {
  const lines: string[] = [];
  lines.push(`# ${report.name} — ${report.title ?? report.startUrl}`);
  lines.push('');
  lines.push(
    `- **URL**: ${report.startUrl}${report.finalUrl && report.finalUrl !== report.startUrl ? ` → ${report.finalUrl}` : ''}`,
  );
  lines.push(
    `- **Completed**: ${report.completed ? 'yes' : `NO${report.navigationError ? ` — ${report.navigationError}` : ''}`}`,
  );
  const errors = report.console.entries.filter((e) => e.type === 'error').length;
  const warnings = report.console.entries.filter((e) => e.type === 'warning').length;
  lines.push(
    `- **Console**: ${report.console.total} entr${report.console.total === 1 ? 'y' : 'ies'} (${errors} error(s), ${warnings} warning(s))${report.console.truncated ? ' — TRUNCATED' : ''}`,
  );
  if (report.screenshots.length > 0) lines.push(`- **Screenshots**: ${report.screenshots.join(', ')}`);
  lines.push('');

  const problems = [
    ...report.pageErrors.map((e) => `- pageerror: ${e}`),
    ...report.console.entries.filter((e) => e.type === 'error').map((e) => `- console.error: ${e.text}`),
  ];
  if (problems.length > 0) {
    lines.push('## Errors', '', ...problems, '');
  }

  if (report.failedRequests.entries.length > 0) {
    lines.push('## Failed requests', '');
    for (const r of report.failedRequests.entries) lines.push(`- ${r.url} — ${r.failure}`);
    if (report.failedRequests.truncated) lines.push(`- … capped at ${FAILED_REQUEST_CAP}`);
    lines.push('');
  }

  if (report.steps && report.steps.length > 0) {
    lines.push('## Steps', '');
    for (const s of report.steps) {
      lines.push(
        `- ${s.ok ? 'ok ' : 'FAIL'} ${String(s.index + 1).padStart(2)}. ${s.description}${s.error ? ` — ${s.error}` : ''}`,
      );
    }
    lines.push('');
  }

  if (report.extracts && Object.keys(report.extracts).length > 0) {
    lines.push('## Extracted values', '');
    for (const [name, value] of Object.entries(report.extracts)) {
      lines.push(
        `### ${name}${value.truncated ? ` (first ${EXTRACT_CAP} chars)` : ''}`,
        '',
        fencedBlock(value.value),
        '',
      );
    }
  }

  if (report.elements && report.elements.entries.length > 0) {
    lines.push(
      `## Interactive elements (${report.elements.total}${report.elements.truncated ? `, listed ${ELEMENTS_CAP}` : ''})`,
      '',
    );
    // mdTable escapes every cell (backslashes and newlines too, not just pipes) —
    // the hand-rolled row only half-escaped and a selector with a backslash could
    // still reshape the table.
    lines.push(
      mdTable(
        ['#', 'element', 'text', 'selector'],
        report.elements.entries.map((element, index) => {
          const label = `${element.name}${element.href ? ` → ${element.href}` : ''}${element.disabled ? ' (disabled)' : ''}`;
          return [String(index + 1), `\`${element.kind}\``, label, `\`${element.selector}\``];
        }),
      ),
    );
    lines.push('');
  }

  if (report.text.content.length > 0) {
    lines.push(`## Page text${report.text.truncated ? ` (first ${TEXT_CAP} chars)` : ''}`, '');
    lines.push(fencedBlock(report.text.content));
    lines.push('');
  }

  return lines.join('\n');
}

// ── Capture ──────────────────────────────────────────────────────────────────

interface Recorder {
  readonly console: ConsoleEntry[];
  consoleTotal: number;
  readonly pageErrors: string[];
  readonly failedRequests: FailedRequest[];
  failedRequestsTotal: number;
}

/** Attach listeners BEFORE navigation — the interesting errors fire during load. */
function record(page: Page): Recorder {
  const recorder: Recorder = {
    console: [],
    consoleTotal: 0,
    pageErrors: [],
    failedRequests: [],
    failedRequestsTotal: 0,
  };
  page.on('console', (message) => {
    recorder.consoleTotal += 1;
    if (recorder.console.length >= CONSOLE_CAP) return;
    const location = message.location();
    recorder.console.push({
      type: message.type(),
      text: message.text(),
      ...(location.url ? { location: `${location.url}:${String(location.lineNumber)}` } : {}),
    });
  });
  page.on('pageerror', (error) => {
    recorder.pageErrors.push(errorMessage(error));
  });
  page.on('requestfailed', (request) => {
    recorder.failedRequestsTotal += 1;
    if (recorder.failedRequests.length >= FAILED_REQUEST_CAP) return;
    recorder.failedRequests.push({ url: request.url(), failure: request.failure()?.errorText ?? 'unknown' });
  });
  return recorder;
}

/**
 * Race a page interaction against a hard deadline. `page.evaluate` (and everything
 * built on it) has NO timeout of its own, so a page whose main thread a step left
 * spinning would otherwise hang the run forever — with no report, no manifest, and
 * `browser.close()` never reached. Playwright cannot cancel the underlying call;
 * the runaway script dies with the browser at teardown, which the deadline lets
 * the run actually reach.
 */
async function withDeadline<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * {@link withDeadline} with a silent fallback — the final-evidence policy in ONE
 * place: a capture that cannot complete degrades to its empty shape instead of
 * failing a report whose whole job is documenting a broken page. The policy used
 * to be restated per capture, and a change to one copy would miss the others.
 */
async function degradeTo<T>(fallback: T, promise: Promise<T>, ms: number, label: string): Promise<T> {
  try {
    return await withDeadline(promise, ms, label);
  } catch {
    return fallback;
  }
}

async function captureText(page: Page): Promise<{ content: string; truncated: boolean }> {
  try {
    const full = await page.evaluate(() => document.body?.innerText ?? '');
    return { content: full.slice(0, TEXT_CAP), truncated: full.length > TEXT_CAP };
  } catch {
    // A page that crashed or navigated away mid-read still deserves a report.
    return { content: '', truncated: false };
  }
}

async function screenshotInto(page: Page, dir: string, basename: string, fullPage: boolean): Promise<string> {
  const file = `${assertSafeBasename(basename)}.png`;
  await page.screenshot({ path: join(dir, file), fullPage });
  return file;
}

interface StepCapture {
  readonly screenshots: string[];
  readonly extracts: Record<string, ExtractedValue>;
}

async function runStep(page: Page, step: Step, dir: string, timeoutMs: number, capture: StepCapture): Promise<void> {
  switch (step.do) {
    case 'goto': {
      await page.goto(step.url, { waitUntil: step.waitUntil, timeout: timeoutMs });
      return;
    }
    case 'click': {
      await page.click(step.selector, { timeout: timeoutMs });
      return;
    }
    case 'fill': {
      await page.fill(step.selector, resolveFillValue(step), { timeout: timeoutMs });
      return;
    }
    case 'press': {
      await page.keyboard.press(step.key);
      return;
    }
    case 'waitFor': {
      await page.waitForSelector(step.selector, { state: step.state, timeout: timeoutMs });
      return;
    }
    case 'screenshot': {
      capture.screenshots.push(await screenshotInto(page, dir, step.name, step.fullPage));
      return;
    }
    case 'hover': {
      await page.hover(step.selector, { timeout: timeoutMs });
      return;
    }
    case 'select': {
      await page.selectOption(step.selector, step.value, { timeout: timeoutMs });
      return;
    }
    case 'scroll': {
      if (step.selector !== undefined) {
        await page.locator(step.selector).first().scrollIntoViewIfNeeded({ timeout: timeoutMs });
      } else {
        // Deadline like every other page.evaluate — a main thread left spinning by
        // an earlier step used to hang HERE, the one evaluate the fix round missed.
        await withDeadline(
          page.evaluate(
            (edge) => window.scrollTo(0, edge === 'top' ? 0 : document.body.scrollHeight),
            step.to ?? 'bottom',
          ),
          timeoutMs,
          'scroll to page edge',
        );
      }
      return;
    }
    case 'wait': {
      await page.waitForTimeout(step.ms);
      return;
    }
    case 'extract': {
      const text = await page.locator(step.selector).first().innerText({ timeout: timeoutMs });
      capture.extracts[step.name] = capExtract(text.trim());
      return;
    }
    case 'evaluate': {
      // The deadline turns a non-terminating expression into a failed STEP — see
      // withDeadline for why the race is the only tool Playwright leaves us.
      const result: unknown = await withDeadline(page.evaluate(step.expression), timeoutMs, `evaluate "${step.name}"`);
      capture.extracts[step.name] = capExtract(
        result === undefined ? 'undefined' : typeof result === 'string' ? result : (JSON.stringify(result) ?? ''),
      );
      return;
    }
  }
}

/**
 * The interactive-elements map — the batchable stand-in for the Playwright MCP server's
 * page snapshot. One in-page pass over every visible link, button and form control;
 * each entry carries an accessible name and a selector that finds the element again
 * (#id, then [data-testid], then [name], then a short positional path). Capped and the
 * cap is said — a map that silently lists half the buttons would send the next flow
 * iteration clicking at ghosts.
 */
async function collectElements(page: Page): Promise<{ entries: ElementEntry[]; total: number; truncated: boolean }> {
  try {
    const all = await page.evaluate(() => {
      const found: { kind: string; name: string; selector: string; href?: string; disabled?: boolean }[] = [];
      const escapeCss = (value: string): string => CSS.escape(value);
      // Attribute VALUES sit inside double quotes, so quotes and backslashes must be
      // escaped — a name like `user"x` used to produce a selector that throws on
      // parse, defeating the map's promise of ready-to-use selectors.
      const escapeAttr = (value: string): string => value.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
      const selectorFor = (element: Element): string => {
        if (element.id) return `#${escapeCss(element.id)}`;
        const testId = element.getAttribute('data-testid');
        if (testId) return `[data-testid="${escapeAttr(testId)}"]`;
        const nameAttr = element.getAttribute('name');
        if (nameAttr) return `${element.tagName.toLowerCase()}[name="${escapeAttr(nameAttr)}"]`;
        const parts: string[] = [];
        let node: Element | null = element;
        for (let depth = 0; node && depth < 3; depth += 1) {
          let nth = 1;
          let sibling = node.previousElementSibling;
          while (sibling) {
            if (sibling.tagName === node.tagName) nth += 1;
            sibling = sibling.previousElementSibling;
          }
          parts.unshift(`${node.tagName.toLowerCase()}:nth-of-type(${String(nth)})`);
          if (node.parentElement?.id) {
            parts.unshift(`#${escapeCss(node.parentElement.id)}`);
            break;
          }
          node = node.parentElement;
        }
        return parts.join(' > ');
      };
      const interactive = document.querySelectorAll(
        'a[href], button, input, select, textarea, summary, [role="button"], [role="link"], [role="tab"], [onclick]',
      );
      for (const element of interactive) {
        if (element.getClientRects().length === 0) continue; // invisible — unclickable, unlistable
        const asInput = element as HTMLInputElement;
        const tag = element.tagName.toLowerCase();
        const kind = tag === 'input' ? `input[${asInput.type || 'text'}]` : tag;
        const html = element as HTMLElement;
        // `||`, not `??`: an input's innerText is '' (present but useless), and the empty
        // string must fall through to the placeholder.
        const name = (
          element.getAttribute('aria-label') ||
          html.innerText ||
          asInput.placeholder ||
          element.getAttribute('title') ||
          ''
        )
          .trim()
          .replace(/\s+/gu, ' ')
          .slice(0, 80);
        const href = tag === 'a' ? (element.getAttribute('href') ?? '').slice(0, 200) : '';
        found.push({
          kind,
          name,
          selector: selectorFor(element),
          ...(href !== '' ? { href } : {}),
          ...('disabled' in element && asInput.disabled ? { disabled: true } : {}),
        });
      }
      return found;
    });
    return { entries: all.slice(0, ELEMENTS_CAP), total: all.length, truncated: all.length > ELEMENTS_CAP };
  } catch {
    // A crashed or navigated-away page yields no map; the rest of the report survives.
    return { entries: [], total: 0, truncated: false };
  }
}

async function processSnapshot(browser: Browser, snapshot: Snapshot, snapshotDir: string): Promise<WebReport> {
  const context = await browser.newContext({ viewport: snapshot.viewport });
  const page = await context.newPage();
  const recorder = record(page);
  const capture: StepCapture = { screenshots: [], extracts: {} };
  const { screenshots } = capture;
  const steps: StepResult[] = [];
  let navigationError: string | undefined;
  let completed = true;

  try {
    try {
      await page.goto(snapshot.url, { waitUntil: snapshot.waitUntil, timeout: snapshot.navTimeoutMs });
    } catch (error) {
      navigationError = errorMessage(error);
      completed = false;
    }

    if (navigationError === undefined && snapshot.type === 'flow') {
      for (const [index, step] of snapshot.steps.entries()) {
        const description = describeStep(step);
        try {
          await runStep(page, step, snapshotDir, snapshot.stepTimeoutMs, capture);
          steps.push({ index, description, ok: true });
        } catch (error) {
          // Stop at the first failure: later steps assume the state this one
          // was meant to produce, and running them anyway reports noise as if
          // it were signal. The final capture below still documents the wreck.
          steps.push({ index, description, ok: false, error: errorMessage(error) });
          completed = false;
          break;
        }
      }
    }

    // The final evidence is captured even for a failed navigation or flow —
    // the screenshot of the broken state is the most useful artifact produced.
    try {
      screenshots.push(
        await screenshotInto(page, snapshotDir, snapshot.type === 'flow' ? 'final' : 'page', snapshot.fullPage),
      );
    } catch {
      // A crashed renderer can refuse the screenshot; the report survives.
    }
    // Every final-evidence capture rides through degradeTo: a step that left the
    // page's main thread spinning (a runaway evaluate, a busy-looping app) used to
    // hang HERE — after the flow already recorded its failure — so the report the
    // whole pipeline exists to write never reached the disk.
    const text = await degradeTo(
      { content: '', truncated: false },
      captureText(page),
      snapshot.navTimeoutMs,
      'final page-text capture',
    );
    const elements = snapshot.captureElements
      ? await degradeTo<Awaited<ReturnType<typeof collectElements>> | undefined>(
          undefined,
          collectElements(page),
          snapshot.navTimeoutMs,
          'element-map capture',
        )
      : undefined;
    const title = await degradeTo<string | undefined>(undefined, page.title(), snapshot.navTimeoutMs, 'title read');

    return {
      name: snapshot.name,
      startUrl: snapshot.url,
      finalUrl: page.url(),
      ...(title !== undefined && title !== '' ? { title } : {}),
      completed,
      ...(navigationError !== undefined ? { navigationError } : {}),
      console: {
        entries: recorder.console,
        total: recorder.consoleTotal,
        truncated: recorder.consoleTotal > recorder.console.length,
      },
      pageErrors: recorder.pageErrors,
      failedRequests: {
        entries: recorder.failedRequests,
        truncated: recorder.failedRequestsTotal > recorder.failedRequests.length,
      },
      text,
      ...(snapshot.type === 'flow' ? { steps } : {}),
      ...(Object.keys(capture.extracts).length > 0 ? { extracts: capture.extracts } : {}),
      ...(elements ? { elements } : {}),
      screenshots,
    };
  } finally {
    await context.close();
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const run = await startReadRun({ scriptName: SCRIPT_NAME, source: 'browser-inspector', schema: ReadConfig, log });

  const browser = await launchBrowser(run.config.browser);
  log(`browser: ${browser.version()}`);
  let incomplete = 0;

  try {
    for (const snapshot of run.config.snapshots) {
      log(`snapshot "${snapshot.name}" (${snapshot.type}, ${snapshot.url})`);
      const snapshotDir = await run.snapshotDir(snapshot.name);

      const report = await processSnapshot(browser, snapshot, snapshotDir);
      if (!report.completed) {
        incomplete += 1;
        log(`  WARN: "${snapshot.name}" did not complete — see report.md`);
      }

      await writePipelineOutputs({
        dir: snapshotDir,
        basename: 'report',
        data: report,
        markdown: renderReportMarkdown(report),
        formats: snapshot.render,
      });
      await writeManifest(
        snapshotDir,
        run.manifest(snapshot, {
          type: snapshot.type,
          url: snapshot.url,
          completed: report.completed,
          screenshots: report.screenshots,
        }),
      );
    }
  } finally {
    await browser.close();
  }

  // A deliberate departure from the uniform closing line: the incomplete count is
  // this pipeline's headline number — a flow that failed mid-way IS the result.
  log(
    `done: ${String(run.config.snapshots.length)} snapshot(s), ${String(incomplete)} incomplete in ${run.elapsedMs()}ms`,
  );
}

await runIfMain(SCRIPT_NAME, import.meta.url, main);
