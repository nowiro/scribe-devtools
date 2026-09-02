// capture.mjs — screenshots, the final evidence and `evaluate` (DESIGN.md §2.2, §3.3, §6).
//
// Screenshots go through CDP `Page.captureScreenshot({ optimizeForSpeed })` (14–30 ms measured
// against 38–44 for `page.screenshot`), the file write is queued and awaited only before the report
// is written. `fullPage`, an element shot and a non-Chromium page fall back to Playwright. The final
// evidence is ONE in-page evaluate (text + element map + element count) — every round trip is a
// millisecond of the 546 ms budget. `evaluate` is CDP `Runtime.evaluate` with its own `timeout` for
// the synchronous part AND `withDeadline` for a promise that never resolves; the result maps 1:1 to
// what the old `page.evaluate(expression)` produced, and a thrown error becomes
// `Error: <first line>` — the exact string the app-factory gate compares today.

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { degradeTo, withDeadline } from './deadline.mjs';

/** @typedef {import('./types.js').PageLike} PageLike */
/** @typedef {import('./types.js').CdpLike} CdpLike */
/** @typedef {import('./types.js').ExtractedValue} ExtractedValue */

/** Caps on captured evidence — the report marks every one that bites. */
export const TEXT_CAP = 20_000;
export const EXTRACT_CAP = 5000;
export const ELEMENTS_CAP = 100;
/** Ceiling on each final-evidence read (screenshot, evaluate, title) — see `finalEvidence`. */
export const EVIDENCE_CAP_MS = 10_000;

/**
 * Cap one captured value; the cap is marked, never silent.
 * @param {string} raw
 * @returns {ExtractedValue}
 */
export const capExtract = (raw) => ({ value: raw.slice(0, EXTRACT_CAP), truncated: raw.length > EXTRACT_CAP });

// ── Screenshots ──────────────────────────────────────────────────────────────

/**
 * Width and height of a PNG from its IHDR chunk — the session line prints `1280x2140` without
 * decoding the image.
 * @param {Buffer} buffer
 * @returns {{ width: number, height: number } | undefined}
 */
export function pngSize(buffer) {
  if (buffer.length < 24 || buffer.readUInt32BE(0) !== 0x89504e47) return undefined;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

/**
 * @typedef {object} ShotOptions
 * @property {'png' | 'jpeg'} [format]
 * @property {number} [quality] jpeg only
 * @property {boolean} [fullPage]
 * @property {string} [selector] element shot (Playwright path)
 * @property {string} [mark] selector of an element to outline for the shot (`--mark eN`)
 * @property {number} [timeoutMs]
 */

/**
 * Outline an element for the duration of `fn` — `shot --mark eN` is the batchable stand-in for the
 * MCP server's highlight/hide_highlight pair.
 * @template T
 * @param {PageLike} page
 * @param {string | undefined} selector
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
async function withMark(page, selector, fn) {
  if (!selector) return fn();
  const target = page.locator(selector).first();
  const restore = await target
    .evaluate((/** @type {any} */ el) => {
      const previous = el.style.outline;
      el.style.outline = '3px solid #ff2d55';
      return previous;
    })
    .catch(() => undefined);
  try {
    return await fn();
  } finally {
    await target
      .evaluate((/** @type {any} */ el, previous) => void (el.style.outline = previous ?? ''), restore ?? '')
      .catch(() => {});
  }
}

/**
 * The viewport shot through CDP when possible, Playwright otherwise. Returns the image bytes; the
 * caller decides where they go (a queued write in batch, a numbered file in a session).
 * @param {PageLike} page
 * @param {CdpLike | null | undefined} cdp the tab's CDP session; `null` on a non-Chromium page
 * @param {ShotOptions} [options]
 * @returns {Promise<{ buffer: Buffer, width?: number, height?: number, via: 'cdp' | 'playwright' }>}
 */
export async function screenshotFast(page, cdp, options = {}) {
  const format = options.format ?? 'png';
  const quality = format === 'jpeg' ? (options.quality ?? 80) : undefined;
  return withMark(page, options.mark, async () => {
    if (cdp && !options.fullPage && !options.selector) {
      try {
        const result = await cdp.send('Page.captureScreenshot', {
          format,
          ...(quality !== undefined ? { quality } : {}),
          optimizeForSpeed: true,
        });
        const buffer = Buffer.from(result.data, 'base64');
        return { buffer, ...(format === 'png' ? pngSize(buffer) : {}), via: 'cdp' };
      } catch {
        // A detached CDP session or a page mid-navigation: Playwright's path still works.
      }
    }
    const shotOptions = {
      type: format,
      ...(quality !== undefined ? { quality } : {}),
      ...(options.timeoutMs ? { timeout: options.timeoutMs } : {}),
    };
    const buffer = options.selector
      ? await page.locator(options.selector).first().screenshot?.(shotOptions)
      : await page.screenshot({ ...shotOptions, fullPage: options.fullPage === true });
    const bytes = /** @type {Buffer} */ (buffer);
    return { buffer: bytes, ...(format === 'png' ? pngSize(bytes) : {}), via: 'playwright' };
  });
}

/**
 * Capture and queue the write. `write` resolves when the file is on disk; the engine awaits every
 * queued write before `report.json`, never between steps.
 * @param {PageLike} page
 * @param {CdpLike | null | undefined} cdp
 * @param {string} file absolute path
 * @param {ShotOptions} [options]
 * @returns {Promise<{ file: string, write: Promise<void>, width?: number, height?: number, bytes: number }>}
 */
export async function saveScreenshot(page, cdp, file, options = {}) {
  const shot = await screenshotFast(page, cdp, options);
  const write = mkdir(path.dirname(file), { recursive: true }).then(() => writeFile(file, shot.buffer));
  return { file, write, width: shot.width, height: shot.height, bytes: shot.buffer.length };
}

// ── Final evidence: text, element map, element count — ONE evaluate ─────────

/**
 * The in-page half of the evidence, as a function Playwright serializes. `caps` arrive as the
 * argument so the page never sees a constant it could not reach. Every selector it emits FINDS the
 * element again: `#id`, then `[data-testid]`, then `[name]`, then a positional path anchored at an
 * `#id` ancestor or `body` — a fragment without an anchor used to match another element elsewhere.
 * @param {{ textCap: number, elementsCap: number, wantText: boolean, wantElements: boolean }} caps
 */
function evidenceInPage(caps) {
  const escapeAttr = (/** @type {string} */ v) => v.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
  const selectorFor = (/** @type {Element} */ el) => {
    if (el.id) return `#${CSS.escape(el.id)}`;
    const testId = el.getAttribute('data-testid');
    if (testId) return `[data-testid="${escapeAttr(testId)}"]`;
    const nameAttr = el.getAttribute('name');
    if (nameAttr) return `${el.tagName.toLowerCase()}[name="${escapeAttr(nameAttr)}"]`;
    /** @type {string[]} */
    const parts = [];
    /** @type {Element | null} */
    let node = el;
    while (node && node.tagName !== 'BODY') {
      let nth = 1;
      for (let s = node.previousElementSibling; s; s = s.previousElementSibling) {
        if (s.tagName === node.tagName) nth += 1;
      }
      parts.unshift(`${node.tagName.toLowerCase()}:nth-of-type(${String(nth)})`);
      if (node.parentElement?.id) {
        parts.unshift(`#${CSS.escape(node.parentElement.id)}`);
        return parts.join(' > ');
      }
      node = node.parentElement;
    }
    parts.unshift('body');
    return parts.join(' > ');
  };
  const nodes = document.querySelectorAll(
    'a[href], button, input, select, textarea, summary, [role="button"], [role="link"], [role="tab"], [onclick]',
  );
  /** @type {{ kind: string, name: string, selector: string, href?: string, disabled?: boolean }[]} */
  const elements = [];
  let count = 0;
  for (const el of nodes) {
    if (el.getClientRects().length === 0) continue; // invisible — unclickable, so unlisted
    count += 1;
    if (!caps.wantElements || elements.length >= caps.elementsCap) continue;
    const input = /** @type {HTMLInputElement} */ (el);
    const tag = el.tagName.toLowerCase();
    const kind = tag === 'input' ? `input[${input.type || 'text'}]` : tag;
    // `||`, not `??`: an input's innerText is '' and the empty string must fall through.
    const name = (
      el.getAttribute('aria-label') ||
      /** @type {HTMLElement} */ (el).innerText ||
      input.placeholder ||
      el.getAttribute('title') ||
      ''
    )
      .trim()
      .replace(/\s+/gu, ' ')
      .slice(0, 80);
    const href = tag === 'a' ? (el.getAttribute('href') ?? '').slice(0, 200) : '';
    elements.push({
      kind,
      name,
      selector: selectorFor(el),
      ...(href !== '' ? { href } : {}),
      ...(input.disabled ? { disabled: true } : {}),
    });
  }
  const full = caps.wantText ? (document.body?.innerText ?? '') : '';
  return {
    text: full.slice(0, caps.textCap),
    textLength: full.length,
    elements,
    count,
  };
}

/**
 * @typedef {object} Evidence
 * @property {{ content: string, truncated: boolean }} text
 * @property {{ entries: any[], total: number, truncated: boolean } | undefined} elements
 * @property {number} elCount visible interactive elements — the `el 61→63` delta of a session line
 */

/**
 * Text, element map and element count in one round trip; a page that crashed or navigated away
 * mid-read yields the empty shape — the report survives.
 * @param {PageLike} page
 * @param {{ elements?: boolean, text?: boolean, timeoutMs?: number }} [options]
 * @returns {Promise<Evidence>}
 */
export async function pageEvidence(page, options = {}) {
  const wantElements = options.elements !== false;
  const wantText = options.text !== false;
  /** @type {Evidence} */
  const empty = { text: { content: '', truncated: false }, elements: wantElements ? undefined : undefined, elCount: 0 };
  const raw = await degradeTo(
    undefined,
    page.evaluate(evidenceInPage, { textCap: TEXT_CAP, elementsCap: ELEMENTS_CAP, wantText, wantElements }),
    options.timeoutMs ?? 5000,
    'final evidence',
  );
  if (!raw || typeof raw !== 'object') return empty;
  const text = typeof raw.text === 'string' ? raw.text : '';
  const textLength = typeof raw.textLength === 'number' ? raw.textLength : text.length;
  const entries = Array.isArray(raw.elements) ? raw.elements : [];
  const count = typeof raw.count === 'number' ? raw.count : entries.length;
  return {
    text: { content: text, truncated: textLength > text.length },
    elements: wantElements ? { entries, total: count, truncated: count > entries.length } : undefined,
    elCount: count,
  };
}

/** @param {PageLike} page @param {number} [timeoutMs] */
export const pageText = async (page, timeoutMs) => (await pageEvidence(page, { elements: false, timeoutMs })).text;

/** @param {PageLike} page @param {number} [timeoutMs] */
export const elementsMap = async (page, timeoutMs) =>
  (await pageEvidence(page, { text: false, timeoutMs })).elements ?? { entries: [], total: 0, truncated: false };

/**
 * Which final screenshot a snapshot gets (DESIGN.md §3.3): `type: "page"` always `page.png`;
 * a flow with `finalScreenshot: "auto"` gets `final.png` on failure and skips it on success only
 * when the last EXECUTED step was itself a screenshot; `"always"` / `"never"` say so.
 * @param {{ type?: string, finalScreenshot?: string }} snapshot
 * @param {{ completed: boolean, lastStepWasScreenshot: boolean }} run
 * @returns {'page' | 'final' | undefined}
 */
export function finalScreenshotName(snapshot, run) {
  if (snapshot.type === 'page') return 'page';
  const policy = snapshot.finalScreenshot ?? 'auto';
  if (policy === 'never') return undefined;
  if (policy === 'always') return 'final';
  return run.completed && run.lastStepWasScreenshot ? undefined : 'final';
}

/**
 * The evidence every snapshot ends with: the final screenshot per the rules above (queued write),
 * text, element map, element count, title and URL — each degrading to its empty shape, never
 * failing a report whose whole job is documenting a broken page.
 * @param {{ page: PageLike, cdp?: CdpLike | null }} ctx
 * @param {{ type?: string, finalScreenshot?: string, fullPage?: boolean, captureElements?: boolean, navTimeoutMs?: number }} snapshot
 * @param {{ dir: string, completed: boolean, lastStepWasScreenshot: boolean }} run
 * @returns {Promise<Evidence & { screenshot?: string, title?: string, finalUrl: string, pending: Promise<void>[] }>}
 */
export async function finalEvidence(ctx, snapshot, run) {
  // Bounded by the navigation timeout but never above `EVIDENCE_CAP_MS`: the evidence of a hung
  // page is a degraded report in seconds, not a run that sits at the 30 s navigation limit three
  // times over (screenshot, evaluate, title) — 12 ms is the budget, 10 s the ceiling.
  const timeoutMs = Math.min(snapshot.navTimeoutMs ?? 30_000, EVIDENCE_CAP_MS);
  /** @type {Promise<void>[]} */
  const pending = [];
  const name = finalScreenshotName(snapshot, run);
  let screenshot;
  if (name) {
    try {
      const saved = await withDeadline(
        saveScreenshot(ctx.page, ctx.cdp, path.join(run.dir, `${name}.png`), {
          fullPage: snapshot.fullPage === true,
          timeoutMs,
        }),
        timeoutMs,
        'final screenshot',
      );
      pending.push(saved.write.catch(() => {}));
      screenshot = `${name}.png`;
    } catch {
      // A crashed renderer refuses the screenshot; the rest of the evidence is still worth writing.
    }
  }
  const evidence = await pageEvidence(ctx.page, { elements: snapshot.captureElements !== false, timeoutMs });
  const title = await degradeTo(undefined, ctx.page.title(), timeoutMs, 'title read');
  let finalUrl = '';
  try {
    finalUrl = ctx.page.url();
  } catch {
    // A closed page has no URL; the report keeps the start URL.
  }
  return {
    ...evidence,
    ...(screenshot ? { screenshot } : {}),
    ...(title !== undefined && title !== '' ? { title } : {}),
    finalUrl,
    pending,
  };
}

// ── evaluate through CDP ─────────────────────────────────────────────────────

/**
 * A thrown value as the report prints it: `Error: uczen widzi przycisk nauczyciela` — the
 * description's first line (which already carries the `Error:` prefix), a primitive's value, or
 * CDP's own text as the last resort.
 * @param {any} details `exceptionDetails` of a Runtime response
 * @returns {string}
 */
export function exceptionText(details) {
  const exception = details?.exception ?? {};
  if (typeof exception.description === 'string' && exception.description !== '') {
    return exception.description.split('\n')[0];
  }
  if (exception.value !== undefined) return String(exception.value);
  if (typeof exception.unserializableValue === 'string') return exception.unserializableValue;
  return String(details?.text ?? 'evaluate failed');
}

/**
 * Map a `Runtime.evaluate` / `Runtime.callFunctionOn` response to the string the report stores,
 * 1:1 with the old `page.evaluate(expression)`: `undefined` → the literal `undefined`, a string as
 * it is, everything else `JSON.stringify`; a DOM node is a failed step (the old runner's
 * "Unexpected value" without a hint), a thrown value a failed step with `Error: …`.
 * @param {{ result?: any, exceptionDetails?: any }} response
 * @returns {string}
 */
export function mapEvaluateResult(response) {
  if (response.exceptionDetails) throw new Error(exceptionText(response.exceptionDetails));
  const result = response.result ?? {};
  if (result.type === 'undefined') return 'undefined';
  if (result.type === 'string') return String(result.value);
  if (result.subtype === 'node') {
    throw new Error(
      `evaluate returned a DOM node (${String(result.description ?? 'Node')}) — return a string or a JSON-serializable value`,
    );
  }
  if (typeof result.unserializableValue === 'string') return result.unserializableValue;
  if ('value' in result) return JSON.stringify(result.value) ?? '';
  if (result.type === 'function' || result.type === 'symbol') return '';
  throw new Error(`evaluate result is not serializable (${String(result.description ?? result.type ?? 'unknown')})`);
}

/**
 * @param {unknown} error
 * @param {string} label
 * @param {number} timeoutMs
 */
function mapCdpError(error, label, timeoutMs) {
  const message = error instanceof Error ? error.message : String(error);
  // Chrome answers a `timeout` hit with "Internal error" / "Execution was terminated" — name the
  // real cause, the page is still alive.
  if (/Execution was terminated|Internal error/u.test(message)) {
    return new Error(`${label} timed out after ${String(timeoutMs)}ms (script terminated, page alive)`);
  }
  const bare = message.replace(/^cdpSession\.send: /u, '').replace(/^Protocol error \([^)]*\): /u, '');
  return new Error(bare.split('\n')[0]);
}

/**
 * `Runtime.evaluate({ expression, awaitPromise, timeout })` under `withDeadline`. Primitives and
 * exceptions come back in ONE round trip; an object result is fetched by value in a second
 * `Runtime.callFunctionOn`, because a plain `returnByValue` turns a DOM node into `{}` (verified on
 * Chrome 152) and the report must fail that step, not record an empty object.
 * @param {CdpLike} cdp
 * @param {string} expression
 * @param {{ timeoutMs: number, label?: string }} options
 * @returns {Promise<string>}
 */
export async function evaluateWithTimeout(cdp, expression, options) {
  const timeoutMs = options.timeoutMs;
  const label = options.label ?? 'evaluate';
  let first;
  try {
    first = await withDeadline(
      cdp.send('Runtime.evaluate', { expression, returnByValue: false, awaitPromise: true, timeout: timeoutMs }),
      timeoutMs,
      label,
    );
  } catch (error) {
    if (error && typeof error === 'object' && /** @type {any} */ (error).code === 'E_DEADLINE') throw error;
    throw mapCdpError(error, label, timeoutMs);
  }
  const result = first?.result;
  if (!first?.exceptionDetails && result?.objectId && result.subtype !== 'node') {
    try {
      const second = await withDeadline(
        cdp.send('Runtime.callFunctionOn', {
          objectId: result.objectId,
          functionDeclaration: 'function () { return this; }',
          returnByValue: true,
        }),
        timeoutMs,
        label,
      );
      return mapEvaluateResult(second);
    } catch (error) {
      if (error && typeof error === 'object' && /** @type {any} */ (error).code === 'E_DEADLINE') throw error;
      throw mapCdpError(error, label, timeoutMs);
    } finally {
      cdp.send('Runtime.releaseObject', { objectId: result.objectId }).catch(() => {});
    }
  }
  return mapEvaluateResult(first);
}

/**
 * The old `page.evaluate` mapping for values that did NOT come through CDP (`eval --el eN` runs
 * through `locator.evaluate`, `fetch` through `page.evaluate`).
 * @param {unknown} value
 * @returns {string}
 */
export const stringifyResult = (value) =>
  value === undefined ? 'undefined' : typeof value === 'string' ? value : (JSON.stringify(value) ?? '');
