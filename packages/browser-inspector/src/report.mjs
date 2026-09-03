// report.mjs — report.md / report.json, elements.md, JUnit, the two manifests and the artifact writer
// (DESIGN.md §5).
//
// report.md is written for an agent that reads it whole: ~190 o200k tokens on the §5.1 sample, of
// which half are the extracted values themselves. Everything that is not a verdict, an error or a
// value stays on disk (`elements.md`, `text.txt`, `report.json`) and the footer names it. `## steps`
// appears only when the flow failed — on success the step list is what the agent already wrote in
// the config. report.json is a SUPERSET of both old shapes (`WebReport` of the TypeScript runner and
// the skryba report): `completed`, `steps[{ description, ok, error }]`, `extracts`, `console.entries`,
// `navigationError` only when navigation failed — `evaluateReports()` in app-factory reads exactly
// those and must keep working unchanged.

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { formatStamp } from './cli.mjs';
import { formatMs, sliceUnits, urlDisplay } from './print.mjs';

/** @typedef {import('./types.js').Report} Report */
/** @typedef {import('./types.js').StepResult} StepResult */
/** @typedef {import('./types.js').Timing} Timing */
/** @typedef {import('./types.js').EngineInfo} EngineInfo */
/** @typedef {import('./types.js').Manifest} Manifest */
/** @typedef {import('./types.js').SnapshotManifest} SnapshotManifest */
/** @typedef {import('./types.js').ConsoleEntry} ConsoleEntry */
/** @typedef {import('./types.js').NetEntry} NetEntry */
/** @typedef {import('./types.js').Verification} Verification */
/** @typedef {import('./types.js').ExtractedValue} ExtractedValue */

/**
 * The report as this module builds it: the frozen `Report` plus the one header flag the recorder
 * may set — `sw=blocked` prints only when the page actually tried to register a service worker
 * on a context that blocks them (every reused lane does; printing it on every report would be noise).
 * @typedef {Report & { serviceWorkerBlocked?: boolean }} BiReport
 */

/** Caps on captured evidence — each one is marked in the JSON (`truncated`) when it bites. */
export const CAPS = Object.freeze({
  console: 500,
  failedRequests: 100,
  text: 20_000,
  extract: 5000,
  elements: 100,
  /** `## errors` lists at most this many lines per kind; the rest is a count pointing at report.json. */
  errorLines: 10,
});

export const SOURCE = 'browser-inspector';
export const SCRIPT = 'browser-inspector';

/** @param {unknown} text */
const firstLine = (text) => String(text).split('\n')[0] ?? '';

/**
 * `Error: uczen widzi przycisk nauczyciela` — the form the app-factory gate prints and its spec
 * fixes. An Error keeps its name (`TimeoutError: …`), a bare string gets `Error: ` in front unless it
 * already carries a name (the CDP `exceptionDetails.description` does). One line, always.
 * @param {unknown} error
 * @returns {string}
 */
export function formatStepError(error) {
  if (error instanceof Error) {
    const message = firstLine(error.message).trim();
    const name = error.name || 'Error';
    return message.startsWith(`${name}:`) ? message : `${name}: ${message}`;
  }
  const text = firstLine(error).trim();
  return /^(?:[A-Za-z][A-Za-z0-9_$]*)?Error:/u.test(text) ? text : `Error: ${text}`;
}

/** @param {string | undefined} url */
function originOf(url) {
  try {
    return url === undefined ? undefined : new URL(url).origin;
  } catch {
    return undefined;
  }
}

/** `HTTP 404` → `404`; anything else (`net::ERR_CONNECTION_REFUSED`) as it is. @param {string} failure */
const shortFailure = (failure) => failure.replace(/^HTTP\s+(\d{3})$/u, '$1');

// ── buildReport ──────────────────────────────────────────────────────────────

/**
 * @typedef {object} ReportInput
 * @property {string} name
 * @property {string} startUrl
 * @property {string} [finalUrl]
 * @property {string} [title]
 * @property {boolean} [completed] derived from `navigationError` and the steps when absent
 * @property {unknown} [navigationError] an Error or a string; `undefined` = navigation succeeded
 * @property {readonly { index: number, description: string, ok: boolean, ms?: number, error?: unknown }[]} [steps]
 * @property {number} [skipped]
 * @property {Readonly<Record<string, string | ExtractedValue>>} [extracts]
 * @property {readonly Verification[]} [verifications]
 * @property {readonly ConsoleEntry[]} [console]
 * @property {number} [consoleTotal]
 * @property {readonly string[]} [pageErrors]
 * @property {readonly NetEntry[]} [network]
 * @property {number} [networkTotal]
 * @property {readonly NetEntry[]} [failed] the recorder's own failure list — it survives the cap on `network`
 * @property {number} [failedTotal] failures the recorder counted, cap or no cap (drives `truncated`)
 * @property {readonly import('./types.js').DialogEntry[]} [dialogs]
 * @property {readonly import('./types.js').TabEntry[]} [tabs]
 * @property {readonly string[]} [screenshots]
 * @property {string} [text] already capped by the page — `textTruncated`/`textLength` carry what was cut
 * @property {boolean} [textTruncated]
 * @property {number} [textLength] length before the cap
 * @property {readonly any[]} [elements] interactive elements `{ kind, name, selector, href?, disabled? }`
 * @property {number} [elementsTotal]
 * @property {boolean} [captureElements] `false` drops `elements.md` and the `elements` block
 * @property {Timing} timing
 * @property {EngineInfo} engine
 * @property {string} [final] name of the screenshot that doubles as the final one (`koszyk.png`)
 * @property {boolean} [serviceWorkerBlocked]
 * @property {Readonly<Record<string, string>>} [files] extra artifact kinds → file names (`snapshot: 'snap.md'`)
 */

/**
 * @typedef {object} BuiltReport
 * @property {BiReport} report
 * @property {Record<string, string>} files text artifacts to write next to report.json (`elements.md`, `text.txt`, `values/<name>.txt`)
 */

/**
 * Assemble the report from what the engine collected. Every cap is applied here, `navigationError`
 * exists only when navigation failed, every step error takes the `Error: …` form, and long values
 * come back as files so the JSON stays readable.
 * @param {ReportInput} input
 * @returns {BuiltReport}
 */
export function buildReport(input) {
  /** @type {Record<string, string>} */
  const files = {};
  const navigationError = input.navigationError === undefined ? undefined : formatStepError(input.navigationError);

  /** @type {StepResult[]} */
  const steps = (input.steps ?? []).map((step) => ({
    index: step.index,
    description: step.description,
    ok: step.ok,
    ...(step.ms !== undefined ? { ms: step.ms } : {}),
    ...(step.error !== undefined ? { error: formatStepError(step.error) } : {}),
  }));
  const completed = input.completed ?? (navigationError === undefined && steps.every((step) => step.ok));

  /** @type {Record<string, ExtractedValue>} */
  const extracts = {};
  for (const [name, raw] of Object.entries(input.extracts ?? {})) {
    const value = typeof raw === 'string' ? raw : raw.value;
    const truncated = typeof raw === 'string' ? false : raw.truncated;
    if (value.length > CAPS.extract) {
      // The JSON keeps the head, the file keeps the whole — report.md points at the file and says
      // how much is there. `length` is what makes that number true: the head alone always reads
      // "5 000+", whatever the value was.
      files[`values/${name}.txt`] = value;
      extracts[name] = {
        value: sliceUnits(value, CAPS.extract),
        truncated: true,
        length: value.length,
        ...(typeof raw !== 'string' && raw.hidden === true ? { hidden: true } : {}),
      };
    } else {
      extracts[name] = {
        value,
        truncated,
        ...(typeof raw !== 'string' && raw.hidden === true ? { hidden: true } : {}),
      };
    }
  }

  const consoleEntries = input.console ?? [];
  const consoleTotal = input.consoleTotal ?? consoleEntries.length;
  const network = input.network ?? [];
  // `input.failed` when the caller has the recorder's own failure list: `network` is capped at 500
  // ENTRIES, so a failure on the 501st request of a page fell out of the report entirely — and
  // `failedRequests.truncated`, counted from that same capped list, claimed the list was complete.
  const failed = (
    input.failed ?? network.filter((entry) => entry.failure !== undefined || (entry.status ?? 0) >= 400)
  ).map((entry) => ({ ...entry, failure: entry.failure ?? `HTTP ${String(entry.status)}` }));
  const failedTotal = input.failedTotal ?? failed.length;

  const text = input.text ?? '';
  const elements = input.captureElements === false ? undefined : (input.elements ?? []);
  const elementsTotal = input.elementsTotal ?? elements?.length ?? 0;

  /** @type {BiReport} */
  const report = {
    name: input.name,
    startUrl: input.startUrl,
    finalUrl: input.finalUrl ?? input.startUrl,
    ...(input.title !== undefined ? { title: input.title } : {}),
    completed,
    ...(navigationError !== undefined ? { navigationError } : {}),
    steps,
    skipped: input.skipped ?? 0,
    extracts,
    verifications: [...(input.verifications ?? [])],
    console: {
      entries: consoleEntries.slice(0, CAPS.console),
      total: consoleTotal,
      truncated: consoleEntries.length > CAPS.console || consoleTotal > CAPS.console,
    },
    pageErrors: [...(input.pageErrors ?? [])],
    network: { total: input.networkTotal ?? network.length, failed: failed.slice(0, CAPS.failedRequests) },
    failedRequests: {
      entries: failed.slice(0, CAPS.failedRequests).map((entry) => ({ url: entry.url, failure: entry.failure })),
      truncated: Math.max(failedTotal, failed.length) > Math.min(failed.length, CAPS.failedRequests),
    },
    dialogs: [...(input.dialogs ?? [])],
    tabs: [...(input.tabs ?? [])],
    screenshots: [...(input.screenshots ?? [])],
    // `input.textTruncated` because the page already cut at the cap before the text got here:
    // `text.length > CAPS.text` can then never be true and the report claimed a whole page.
    text: {
      content: sliceUnits(text, CAPS.text),
      truncated: input.textTruncated === true || text.length > CAPS.text,
      ...(input.textLength !== undefined && input.textLength > text.length ? { length: input.textLength } : {}),
    },
    ...(elements !== undefined
      ? {
          elements: {
            entries: elements.slice(0, CAPS.elements),
            total: elementsTotal,
            // Counted against what the report LISTS, not against the cap: elements inside child
            // frames are counted and never listed, so a map missing a whole embedded form used to
            // say `truncated: false` whenever the total stayed under the cap (DESIGN.md §5.1).
            truncated: elementsTotal > Math.min(elements.length, CAPS.elements),
          },
        }
      : {}),
    files: { ...(input.files ?? {}) },
    timing: { ...input.timing },
    engine: { ...input.engine },
    ...(input.final !== undefined ? { final: input.final } : {}),
    ...(input.serviceWorkerBlocked ? { serviceWorkerBlocked: true } : {}),
  };

  // `values/<name>.txt` above holds the WHOLE value; `artifactFiles` only knows the capped head, so
  // the entries built here win over the derived ones.
  return { report, files: { ...artifactFiles(report), ...files } };
}

/** Where the text artifacts live — `report.files` names them so the `more:` footer can point at them. */
const ARTIFACT_NAMES = Object.freeze({ elements: 'elements.md', text: 'text.txt' });

/**
 * The text artifacts a finished `Report` implies: `elements.md` when the elements map was captured,
 * `text.txt` when the page had text, `values/<name>.txt` for every capped extract (the head the JSON
 * holds — the whole value exists only while `buildReport` still has it). Registers their names in
 * `report.files` (mutates that map on purpose: the footer of report.md and report.json must name
 * what is on disk). The engine's `runFlow` assembles the `Report` itself, so `writeArtifacts` calls
 * this instead of asking the caller to remember three files.
 * @param {BiReport} report
 * @returns {Record<string, string>} artifact file name → content
 */
export function artifactFiles(report) {
  /** @type {Record<string, string>} */
  const files = {};
  if (report.elements !== undefined) {
    report.files.elements ??= ARTIFACT_NAMES.elements;
    files[report.files.elements] = renderElementsMd(report);
  }
  if (report.text.content.length > 0) {
    report.files.text ??= ARTIFACT_NAMES.text;
    files[report.files.text] = report.text.content;
  }
  for (const [name, value] of Object.entries(report.extracts)) {
    // Only the head is left here — the whole value exists while `buildReport` still has it, and it
    // puts the file in `BuiltReport.files`, which wins over this one in `writeArtifacts`.
    if (value.truncated) files[`values/${name}.txt`] = value.value;
  }
  return files;
}

// ── report.md ────────────────────────────────────────────────────────────────

/** A value in `## values`: one line inline, several lines fenced, over the cap a file. */
/**
 * @param {string} name
 * @param {ExtractedValue} value
 * @returns {string[]}
 */
function renderValue(name, value) {
  // `(hidden)` because `innerText` answers with `textContent` for a node the page does not render:
  // without it the report presented a validation error nobody could see as observed screen text.
  const name_ = value.hidden === true ? `${name} (hidden)` : name;
  if (value.truncated) {
    // `length` = the whole value is in the file; without it the head is all anyone has, and the
    // number can only be a lower bound.
    const chars =
      typeof value.length === 'number' ? `${formatMs(value.length)} chars` : `${formatMs(value.value.length)}+ chars`;
    return [`${name_}: values/${name}.txt (${chars})`];
  }
  if (!value.value.includes('\n')) return [`${name_}: ${value.value}`];
  const fence = value.value.includes('```') ? '````' : '```';
  return [`${name_}:`, fence, value.value, fence];
}

/**
 * The header flags DESIGN.md §5.1 adds only when they hold, in this order.
 * @param {BiReport} report
 * @returns {string[]}
 */
function headerFlags(report) {
  const flags = [];
  if (report.timing.tab === 'new') flags.push('tab new');
  if (report.engine.motion === 'reduce') flags.push('motion=reduce');
  if (report.serviceWorkerBlocked) flags.push('sw=blocked');
  if (report.screenshots.includes('final.png')) flags.push('final.png');
  else if (report.final !== undefined) flags.push(`final: ${report.final}`);
  return flags;
}

/**
 * `## errors`: page errors, console errors, failed requests — each kind capped at `CAPS.errorLines`
 * with the remainder counted, so a page that logs 400 errors costs a dozen lines, not a page.
 * @param {BiReport} report
 * @returns {string[]}
 */
function errorLines(report) {
  const origin = originOf(report.startUrl);
  const lines = [];
  if (report.navigationError !== undefined) lines.push(`- navigation ${report.navigationError}`);
  /** @param {string[]} items @param {string} what */
  const capped = (items, what) => {
    lines.push(...items.slice(0, CAPS.errorLines));
    if (items.length > CAPS.errorLines)
      lines.push(`- … +${String(items.length - CAPS.errorLines)} ${what} (report.json)`);
  };
  capped(
    report.pageErrors.map((error) => `- pageerror ${firstLine(error)}`),
    'pageerror',
  );
  capped(
    report.console.entries
      .filter((entry) => entry.type === 'error')
      .map((entry) => `- console.error ${firstLine(entry.text)}`),
    'console.error',
  );
  capped(
    report.network.failed.map(
      (entry) => `- ${entry.method} ${urlDisplay(entry.url, origin)} → ${shortFailure(entry.failure ?? 'failed')}`,
    ),
    'failed requests',
  );
  return lines;
}

/**
 * `## steps` on failure: the two steps before the failed one, the failed one, and the skipped range.
 * @param {BiReport} report
 * @returns {string[]}
 */
function stepLines(report) {
  const total = report.steps.length + report.skipped;
  const failedAt = report.steps.findIndex((step) => !step.ok);
  const lines = [];
  if (failedAt === -1 && report.navigationError !== undefined) {
    lines.push(`- FAIL navigation — ${report.navigationError}`);
  } else {
    const from = Math.max(0, (failedAt === -1 ? report.steps.length : failedAt) - 2);
    const to = failedAt === -1 ? report.steps.length : failedAt + 1;
    for (const step of report.steps.slice(from, to)) {
      const n = String(step.index + 1);
      lines.push(
        step.ok
          ? `- ok ${n}. ${step.description}${step.ms !== undefined ? ` · ${formatMs(step.ms)} ms` : ''}`
          : `- FAIL ${n}. ${step.description} — ${step.error ?? 'failed'}`,
      );
    }
    if (failedAt === -1) lines.push('- incomplete');
  }
  if (report.skipped > 0) {
    const first = report.steps.length + 1;
    lines.push(`- skipped ${first === total ? String(total) : `${String(first)}–${String(total)}`}`);
  }
  return lines;
}

/**
 * Render report.md — DESIGN.md §5.1 character for character on the sample. Sections appear only
 * when they have content; `## steps` only when the flow did not complete; `## verify` only when a
 * soft verification failed.
 * @param {BiReport} report
 * @returns {string}
 */
export function renderReportMd(report) {
  const total = report.steps.length + report.skipped;
  const okCount = report.steps.filter((step) => step.ok).length;
  const verdict = `${report.completed ? 'OK' : 'FAIL'}${total > 0 ? ` ${String(okCount)}/${String(total)}` : ''}`;
  const head = [
    `# ${report.name} — ${verdict}`,
    `${formatMs(report.timing.totalMs)} ms`,
    `${report.timing.mode} ${report.timing.ctx}`,
    ...headerFlags(report),
  ].join(' · ');

  const origin = originOf(report.startUrl);
  const where =
    report.finalUrl && report.finalUrl !== report.startUrl
      ? `${report.startUrl} → ${urlDisplay(report.finalUrl, origin)}`
      : report.startUrl;
  const consoleErrors = report.console.entries.filter((entry) => entry.type === 'error').length;
  const netFailed = report.network.failed.length;
  const summary = [
    `${where}${report.title !== undefined ? ` ${JSON.stringify(report.title)}` : ''}`,
    `console ${String(report.console.total)}${consoleErrors > 0 ? ` (${String(consoleErrors)} err)` : ''}`,
    `net ${String(report.network.total)}${netFailed > 0 ? ` (${String(netFailed)} failed)` : ''}`,
    ...(report.screenshots.length > 0 ? [`shots ${report.screenshots.join(' ')}`] : []),
  ].join(' · ');

  const out = [head, summary];

  const errors = errorLines(report);
  if (errors.length > 0) out.push('', '## errors', ...errors);

  const values = Object.entries(report.extracts);
  if (values.length > 0) {
    out.push('', '## values');
    for (const [name, value] of values) out.push(...renderValue(name, value));
  }

  const softFailures = report.verifications.filter((v) => !v.ok && v.soft);
  if (softFailures.length > 0) {
    out.push('', '## verify');
    for (const v of softFailures) {
      const step = report.steps.find((s) => s.index === v.index);
      out.push(`- FAIL ${step?.description ?? `verify ${v.kind}`}${v.detail ? ` — ${firstLine(v.detail)}` : ''}`);
    }
  }

  if (!report.completed) out.push('', '## steps', ...stepLines(report));

  const more = [];
  if (report.files.elements) more.push(`${report.files.elements} (${String(report.elements?.total ?? 0)})`);
  if (report.files.text) {
    // A file that holds only the head says so here — the footer is the only place an agent reading
    // report.md alone learns that the rest of the page exists.
    const { length, content, truncated } = report.text;
    more.push(
      truncated && length !== undefined
        ? `${report.files.text} (${String(content.length)} of ${String(length)})`
        : report.files.text,
    );
  }
  if (report.files.snapshot) more.push(report.files.snapshot);
  more.push('report.json');
  out.push('', `more: ${more.join(' · ')}`, '');
  return out.join('\n');
}

// ── elements.md ──────────────────────────────────────────────────────────────

/**
 * One line per interactive element, in the order the page lists them: `<n>. <kind> "<name>" [→ href]
 * [(disabled)] <selector>`. The selector is the point — it FINDS the element again in a config step.
 * @param {{ name: string, elements?: { entries: readonly any[], total: number, truncated: boolean } }} report
 * @returns {string}
 */
export function renderElementsMd(report) {
  const block = report.elements ?? { entries: [], total: 0, truncated: false };
  const lines = [
    `# elements — ${report.name} (${String(block.total)}${block.truncated ? `, listed ${String(block.entries.length)}` : ''})`,
    '',
  ];
  block.entries.forEach((element, i) => {
    const parts = [`${String(i + 1)}. ${String(element.kind)} ${JSON.stringify(firstLine(element.name ?? ''))}`];
    if (element.href) parts.push(`→ ${String(element.href)}`);
    if (element.disabled) parts.push('(disabled)');
    if (element.selector) parts.push(String(element.selector));
    lines.push(parts.join(' '));
  });
  if (block.entries.length === 0) lines.push('(none)');
  lines.push('');
  return lines.join('\n');
}

// ── JUnit ────────────────────────────────────────────────────────────────────

/**
 * Text as an XML 1.0 document may carry it. The four metacharacters become entities — and every
 * character the `Char` production forbids (a C0 byte other than TAB/LF/CR, U+FFFE/U+FFFF) becomes a
 * space FIRST: an `Error` a page threw with an ANSI colour code in it (ESC, U+001B) made the WHOLE
 * junit.xml unparseable, so CI dropped the entire run rather than one testcase.
 * @param {unknown} value
 */
const xml = (value) => {
  let safe = '';
  // Iterated by code point, so a surrogate pair survives whole.
  for (const ch of String(value)) {
    const code = ch.codePointAt(0) ?? 0;
    const allowed = code === 9 || code === 10 || code === 13 || (code >= 0x20 && code !== 0xfffe && code !== 0xffff);
    safe += allowed ? ch : ' ';
  }
  return safe.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
};

/**
 * `--junit f.xml`: the format every CI reads as a test tab. One `testcase` per snapshot; an
 * incomplete run is a `failure` naming the step that failed (or the navigation error). Without
 * this a batch is mute in CI — exit 0 by design, nobody notices.
 * Redaction happens HERE, before `xml()`, and not on the finished document: the escaper turns a
 * secret with `&`, `<`, `>` or `"` into an entity spelling `secretForms` does not know, so a
 * caller redacting the output masked nothing and shipped the password to the CI test tab.
 * @param {string} suite the config file basename
 * @param {readonly { name: string, completed: boolean, ms?: number, failure?: string, dir?: string }[]} snapshots
 * @param {{ redact?: (text: string) => string }} [options]
 * @returns {string}
 */
export function renderJUnit(suite, snapshots, options = {}) {
  const scrub = options.redact ?? ((/** @type {string} */ text) => text);
  const text = (/** @type {unknown} */ value) => xml(scrub(String(value)));
  const failures = snapshots.filter((s) => !s.completed).length;
  const seconds = (/** @type {number} */ ms) => (ms / 1000).toFixed(3);
  const totalMs = snapshots.reduce((sum, s) => sum + (s.ms ?? 0), 0);
  const cases = snapshots.map((s) => {
    const open = `    <testcase name="${text(s.name)}" classname="browser-inspector.${text(suite)}" time="${seconds(s.ms ?? 0)}">`;
    const out = s.dir ? `      <system-out>${text(s.dir)}</system-out>\n` : '';
    if (s.completed) return out ? `${open}\n${out}    </testcase>` : `${open}</testcase>`;
    return [
      open,
      `      <failure message="${text(s.failure ?? 'incomplete')}"></failure>`,
      out.trimEnd(),
      '    </testcase>',
    ]
      .filter((line) => line !== '')
      .join('\n');
  });
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<testsuites name="browser-inspector" tests="${String(snapshots.length)}" failures="${String(failures)}" time="${seconds(totalMs)}">`,
    `  <testsuite name="${text(suite)}" tests="${String(snapshots.length)}" failures="${String(failures)}" time="${seconds(totalMs)}">`,
    ...cases,
    '  </testsuite>',
    '</testsuites>',
    '',
  ].join('\n');
}

// ── Manifests ────────────────────────────────────────────────────────────────

/**
 * The failure a snapshot reports upward (manifest, JUnit): the navigation error, else the failed
 * step, else a bare `incomplete`. `undefined` for a completed run — the field is absent, not null.
 * @param {Pick<Report, 'completed' | 'navigationError' | 'steps'>} report
 * @returns {string | undefined}
 */
export function failureOf(report) {
  if (report.completed) return undefined;
  if (report.navigationError !== undefined) return report.navigationError;
  const step = report.steps.find((s) => !s.ok);
  return step ? `step ${String(step.index + 1)} "${step.description}" — ${step.error ?? 'failed'}` : 'incomplete';
}

/**
 * @typedef {object} RunInfo
 * @property {string} [stamp] `YYYY-MM-DD_HH-MM` (Europe/Warsaw); the clock when absent
 * @property {string} config absolute path of the config file
 * @property {string} version the package version
 * @property {string} [startedAt] ISO
 * @property {Manifest['timing']} timing
 */

/**
 * `<outputDir>/<stamp>/_manifest.json` — one per run, the shape DESIGN.md §5 fixes plus the
 * read-runtime envelope fields scribe tools already know (`source`, `runStartedAt`, `runFinishedAt`).
 * @param {RunInfo} run
 * @param {readonly { name: string, report: Pick<Report, 'completed' | 'navigationError' | 'steps' | 'timing'>, dir: string }[]} results
 * @returns {Manifest & { source: string, startedAt: string, finishedAt: string }}
 */
export function buildManifest(run, results) {
  const startedAt = run.startedAt ?? new Date().toISOString();
  return {
    stamp: run.stamp ?? formatStamp(new Date(startedAt)),
    config: run.config,
    version: run.version,
    source: SOURCE,
    startedAt,
    finishedAt: new Date().toISOString(),
    timing: { ...run.timing },
    snapshots: results.map(({ name, report, dir }) => {
      const failure = failureOf(report);
      return {
        name,
        completed: report.completed,
        dir,
        ms: report.timing.totalMs,
        ctx: report.timing.ctx,
        tab: report.timing.tab,
        lane: report.timing.lane,
        queuedMs: report.timing.queuedMs,
        scrubMs: report.timing.scrubMs,
        cacheHits: report.timing.cacheHits,
        ...(failure !== undefined ? { failure } : {}),
      };
    }),
  };
}

/**
 * @typedef {object} SnapshotInfo
 * @property {'page' | 'flow'} type
 * @property {string} url
 * @property {readonly string[]} [render]
 * @property {string} [stamp]
 * @property {string} [version]
 * @property {string} [startedAt]
 */

/**
 * `<outputDir>/<stamp>/<snapshot>/_manifest.json` — the read-runtime `writeManifest` convention
 * (`snapshot`, `source`, `stamp`, `runStartedAt`, `runFinishedAt`, `render`, `tooling`) with the
 * browser-inspector extras (`type`, `url`, `completed`, `screenshots`) and the new `timing`.
 * `name` doubles `snapshot` because DESIGN.md §5 names it so.
 * @param {Pick<Report, 'name' | 'completed' | 'screenshots' | 'timing' | 'navigationError' | 'steps'>} report
 * @param {SnapshotInfo} snapshot
 * @returns {SnapshotManifest}
 */
export function buildSnapshotManifest(report, snapshot) {
  const startedAt = snapshot.startedAt ?? new Date().toISOString();
  const failure = failureOf(report);
  return {
    snapshot: report.name,
    name: report.name,
    source: SOURCE,
    stamp: snapshot.stamp ?? formatStamp(new Date(startedAt)),
    runStartedAt: startedAt,
    runFinishedAt: new Date().toISOString(),
    render: [...(snapshot.render ?? ['json', 'markdown'])],
    tooling: { script: SCRIPT, version: snapshot.version ?? '0.0.0' },
    type: snapshot.type,
    url: snapshot.url,
    completed: report.completed,
    screenshots: [...report.screenshots],
    timing: { ...report.timing },
    ...(failure !== undefined ? { failure } : {}),
  };
}

// ── writeArtifacts ───────────────────────────────────────────────────────────

/** @typedef {string | Uint8Array | Promise<string | Uint8Array>} ArtifactContent */

/**
 * @typedef {object} WriteOptions
 * @property {readonly Promise<unknown>[]} [pending] screenshot writes queued by the fast path — awaited BEFORE report.json
 * @property {readonly string[]} [render] `json` / `markdown` — which report files to write (both by default)
 * @property {SnapshotInfo} [manifest] when given, `_manifest.json` is written next to the report
 * @property {(text: string) => string} [redact] applied to every text artifact, report.md and report.json
 * @property {boolean} [derive] `false` skips `artifactFiles(report)` — the caller supplies every text artifact itself
 */

/**
 * Write everything a snapshot produced into `dir`: the text artifacts (`elements.md`, `text.txt`,
 * `values/*.txt` — derived from the report unless given —, `snap.md`, …), the async screenshot
 * writes, then — only after all of those have landed — `report.json`, `report.md` and
 * `_manifest.json`. A reader that sees report.json can rely on every file it names being complete;
 * that is why the order is fixed and the pending writes are awaited here and not in the engine's
 * stopwatch.
 * @param {string} dir
 * @param {BiReport} report
 * @param {Readonly<Record<string, ArtifactContent>>} [files] extra artifacts; an entry here wins over a derived one
 * @param {WriteOptions} [options]
 * @returns {Promise<{ written: string[], ms: number }>}
 */
export async function writeArtifacts(dir, report, files = {}, options = {}) {
  const started = performance.now();
  const redact = options.redact ?? ((/** @type {string} */ text) => text);
  await mkdir(dir, { recursive: true });
  /** @type {string[]} */
  const written = [];
  const artifacts = options.derive === false ? files : { ...artifactFiles(report), ...files };

  /** @param {string} name @param {string | Uint8Array} content */
  const put = async (name, content) => {
    const target = path.join(dir, name);
    if (name.includes('/')) await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, typeof content === 'string' ? redact(content) : content);
    written.push(name);
  };

  await Promise.all([
    ...Object.entries(artifacts).map(async ([name, content]) => put(name, await content)),
    ...(options.pending ?? []),
  ]);

  const render = options.render ?? ['json', 'markdown'];
  if (render.includes('json')) await put('report.json', `${JSON.stringify(report, null, 2)}\n`);
  if (render.includes('markdown')) await put('report.md', renderReportMd(report));
  if (options.manifest) {
    await put('_manifest.json', `${JSON.stringify(buildSnapshotManifest(report, options.manifest), null, 2)}\n`);
  }
  return { written, ms: Math.round(performance.now() - started) };
}
