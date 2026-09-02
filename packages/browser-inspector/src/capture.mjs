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
import { sliceUnits } from './print.mjs';

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
 * Above this, a single `Page.captureScreenshot` is past Chrome's texture limit and fails; the shot
 * falls back to Playwright, which stitches. 16384 is the limit on the GPU backends Chrome ships.
 */
const MAX_CAPTURE_PX = 16_384;

/**
 * Cap one captured value; the cap is marked, never silent.
 * @param {string} raw
 * @returns {ExtractedValue}
 */
export const capExtract = (raw) => ({ value: sliceUnits(raw, EXTRACT_CAP), truncated: raw.length > EXTRACT_CAP });

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
 * @property {{ locator(selector: string): any }} [root] where `selector` and `mark` resolve — the frame
 *   scope of `browser-inspector frame <n>`, the page by default
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
 * @param {{ locator(selector: string): any } | undefined} [root]
 * @returns {Promise<T>}
 */
async function withMark(page, selector, fn, root) {
  if (!selector) return fn();
  const target = (root ?? page).locator(selector).first();
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
  // A CSS selector under a `frame <n>` scope only exists in THAT document: resolving it on the
  // page took the shot of a like-named element in the main frame, or timed out looking for one.
  const scope = options.root ?? page;
  return withMark(
    page,
    options.mark,
    async () => {
      // The element shot stays on Playwright's path (it needs the locator); everything else, INCLUDING
      // `fullPage`, goes through CDP. `fullPage` used to be excluded here, which sent the most
      // expensive screenshot in the tree down the slow path — but the measurement says the reason is
      // not the round trips it saves. A/B on the tallest page in the fixtures (bookstore, 1280×6335):
      // CDP 222 ms, Playwright 713 ms, identical dimensions — and the SAME CDP clip with
      // `optimizeForSpeed: false` costs 731 ms. The whole 491 ms is the PNG encoder, and the trade it
      // buys is on disk: 3488 KB against 2045 KB for the same image. Viewport shots already make that
      // trade (§2.2), so a full-page shot making a different one would be the odd case, not this.
      if (cdp && !options.selector) {
        try {
          const clip = options.fullPage ? await documentClip(cdp) : undefined;
          // No metrics, no clip: rather than guess, fall through to the path that does not need them.
          if (!options.fullPage || clip) {
            const result = await cdp.send('Page.captureScreenshot', {
              format,
              ...(quality !== undefined ? { quality } : {}),
              optimizeForSpeed: true,
              ...(clip ? { clip, captureBeyondViewport: true } : {}),
            });
            const buffer = Buffer.from(result.data, 'base64');
            return { buffer, ...(format === 'png' ? pngSize(buffer) : {}), via: 'cdp' };
          }
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
        ? await scope.locator(options.selector).first().screenshot?.(shotOptions)
        : await page.screenshot({ ...shotOptions, fullPage: options.fullPage === true });
      const bytes = /** @type {Buffer} */ (buffer);
      return { buffer: bytes, ...(format === 'png' ? pngSize(bytes) : {}), via: 'playwright' };
    },
    scope,
  );
}

/**
 * The whole document as a screenshot clip, in CSS pixels. `cssContentSize` is what
 * `Page.getLayoutMetrics` reports for the layout viewport's content — the same rectangle
 * `fullPage` means. `undefined` when the metrics look wrong (a page mid-navigation answers with
 * zeros), because a clip of zero height would produce an empty image where the slow path produces
 * a correct one.
 * @param {CdpLike} cdp
 * @returns {Promise<{ x: number, y: number, width: number, height: number, scale: number } | undefined>}
 */
async function documentClip(cdp) {
  const metrics = await cdp.send('Page.getLayoutMetrics');
  const size = metrics?.cssContentSize ?? metrics?.contentSize;
  const width = Math.ceil(Number(size?.width));
  const height = Math.ceil(Number(size?.height));
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return undefined;
  // Chrome refuses a capture past its texture limit and answers with an error; the guard keeps that
  // case on Playwright's path, which stitches instead of failing.
  if (height > MAX_CAPTURE_PX || width > MAX_CAPTURE_PX) return undefined;
  return { x: 0, y: 0, width, height, scale: 1 };
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
  const selector =
    'a[href], button, input, select, textarea, summary, [role="button"], [role="link"], [role="tab"], [onclick]';
  /** @type {(Document | ShadowRoot)[]} */
  const roots = [document];
  /** @type {Element[]} */
  const nodes = [];
  for (let r = 0; r < roots.length; r += 1) {
    // The aria tree the agent reads walks open shadow roots; an element map that stops at the light
    // DOM answered `el 0` for a page whose whole form lives in a web component.
    for (const host of roots[r].querySelectorAll('*')) if (host.shadowRoot) roots.push(host.shadowRoot);
    for (const el of roots[r].querySelectorAll(selector)) nodes.push(el);
  }
  // Counted over EVERY root, because Playwright's CSS pierces open shadow roots: an `id` repeated
  // in two web components (perfectly legal — each shadow root is its own tree) is one selector
  // pointing at two elements, and the map promises the opposite. A duplicate `data-testid` on the
  // rows of a table did the same in the light DOM.
  const countAll = (/** @type {string} */ sel) => {
    let n = 0;
    for (const root of roots) {
      try {
        n += root.querySelectorAll(sel).length;
      } catch {
        return 2; // an unparseable selector is never "the one" — fall through to the path
      }
    }
    return n;
  };
  const selectorFor = (/** @type {Element} */ el) => {
    const unique = (/** @type {string} */ sel) => countAll(sel) === 1;
    if (el.id) {
      const byId = `#${CSS.escape(el.id)}`;
      if (unique(byId)) return byId;
    }
    const testId = el.getAttribute('data-testid');
    if (testId) {
      const byTestId = `[data-testid="${escapeAttr(testId)}"]`;
      if (unique(byTestId)) return byTestId;
    }
    const nameAttr = el.getAttribute('name');
    if (nameAttr) {
      const byName = `${el.tagName.toLowerCase()}[name="${escapeAttr(nameAttr)}"]`;
      if (unique(byName)) return byName;
    }
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
      const anchor = node.parentElement?.id ? `#${CSS.escape(node.parentElement.id)}` : undefined;
      if (anchor && unique(anchor)) {
        parts.unshift(anchor);
        return parts.join(' > ');
      }
      if (node.parentElement) {
        node = node.parentElement;
        continue;
      }
      // A shadow root has no parent element: hop to its host. Playwright's CSS engine pierces open
      // shadow roots on the descendant combinator, not on `>`, so the boundary is a space.
      const host = /** @type {any} */ (node.getRootNode())?.host;
      if (!host) break;
      return `${selectorFor(host)} ${parts.join(' > ')}`;
    }
    parts.unshift('body');
    return parts.join(' > ');
  };
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
  // Cache hits from the Resource Timing API, in the round trip that is happening anyway. Chrome
  // sets `deliveryType: 'cache'` on an entry served from the HTTP cache (memory or disk); the
  // `transferSize === 0 && decodedBodySize > 0` pair is the pre-`deliveryType` spelling of the same
  // thing and covers a browser that does not report it. A cross-origin entry without
  // Timing-Allow-Origin also reports `transferSize: 0`, but with `decodedBodySize: 0` — hence both
  // halves of the condition. Counted per DOCUMENT (the buffer is cleared on navigation), which is
  // what the question behind the number asks: did THIS run's page come out of the warm cache.
  const cached = (/** @type {any} */ e) =>
    e.deliveryType === 'cache' || (e.transferSize === 0 && e.decodedBodySize > 0);
  let cacheHits = 0;
  let cacheHitsDocument = 0;
  try {
    for (const entry of performance.getEntriesByType('resource')) if (cached(entry)) cacheHits += 1;
    // `responseStatus > 0` = a real response. Chrome's own error page (`chrome-error://…`, the
    // document after ERR_CONNECTION_REFUSED) reports `deliveryType: 'cache'` with `transferSize: 0`
    // and a large body, so a failed navigation used to answer "the document came from cache" — the
    // one number whose whole point is warning about a stale build.
    const nav = /** @type {any} */ (performance.getEntriesByType('navigation')[0]);
    if (nav && (nav.responseStatus ?? 0) > 0 && cached(nav)) {
      cacheHits += 1;
      cacheHitsDocument = 1;
    }
  } catch {
    // A document without the Resource Timing API answers "no hits", never breaks the report.
  }
  // One unit back when the cap lands between the two halves of a surrogate pair — the file would
  // otherwise get U+FFFD and the JSON `\ud83d`, neither of them the character the page had.
  const cut = Math.min(caps.textCap, full.length);
  const head = full.charCodeAt(cut - 1);
  return {
    text: full.slice(0, head >= 0xd800 && head <= 0xdbff ? cut - 1 : cut),
    textLength: full.length,
    elements,
    count,
    cacheHits,
    cacheHitsDocument,
  };
}

/**
 * @typedef {object} Evidence
 * @property {{ content: string, truncated: boolean, length: number }} text `length` = before the in-page cap
 * @property {{ entries: any[], total: number, truncated: boolean } | undefined} elements
 * @property {number} elCount visible interactive elements — the `el 61→63` delta of a session line
 * @property {{ hits: number, document: number }} [cache] responses this document took from the HTTP cache
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
  const empty = {
    text: { content: '', truncated: false, length: 0 },
    elements: wantElements ? undefined : undefined,
    elCount: 0,
    cache: { hits: 0, document: 0 },
  };
  const timeoutMs = options.timeoutMs ?? 5000;
  const caps = { textCap: TEXT_CAP, elementsCap: ELEMENTS_CAP, wantText, wantElements };
  const raw = await degradeTo(undefined, page.evaluate(evidenceInPage, caps), timeoutMs, 'final evidence');
  if (!raw || typeof raw !== 'object') return empty;
  const text = typeof raw.text === 'string' ? raw.text : '';
  const textLength = typeof raw.textLength === 'number' ? raw.textLength : text.length;
  const entries = Array.isArray(raw.elements) ? raw.elements : [];
  // Child frames are counted, not listed: an app embedded in an iframe used to report `el 1` for a
  // page with a whole form in it. Their selectors resolve only under a `frame <n>` scope, and this
  // map promises selectors that find the element from the page — so the count says the map is
  // partial (`truncated`) and the snapshot stays the way into the frame (DESIGN.md §5.1).
  // Cache hits stay the MAIN document's, which is the question that number answers.
  const children = typeof page.frames === 'function' ? page.frames().slice(1) : [];
  const inFrames = await Promise.all(
    children.map((frame) =>
      degradeTo(
        0,
        Promise.resolve()
          .then(() => frame.evaluate(evidenceInPage, { ...caps, wantText: false, wantElements: false }))
          .then((r) => (typeof r?.count === 'number' ? r.count : 0)),
        timeoutMs,
        'frame evidence',
      ).catch(() => 0),
    ),
  );
  const count = (typeof raw.count === 'number' ? raw.count : entries.length) + inFrames.reduce((a, b) => a + b, 0);
  return {
    // `length` travels with the flag: the text arrives ALREADY cut, so nothing downstream can
    // recompute either of them — the report used to say `truncated: false` for every long page.
    text: { content: text, truncated: textLength > text.length, length: textLength },
    elements: wantElements ? { entries, total: count, truncated: count > entries.length } : undefined,
    elCount: count,
    cache: {
      hits: typeof raw.cacheHits === 'number' ? raw.cacheHits : 0,
      document: typeof raw.cacheHitsDocument === 'number' ? raw.cacheHitsDocument : 0,
    },
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
  // A function or a symbol that never reached the serializing round trip: `page.evaluate` gave
  // `undefined` for both, so the report says `undefined` and not an empty string.
  if (result.type === 'function' || result.type === 'symbol') return 'undefined';
  throw new Error(`evaluate result is not serializable (${String(result.description ?? result.type ?? 'unknown')})`);
}

/** @param {unknown} error */
const bareCdpMessage = (error) =>
  (error instanceof Error ? error.message : String(error))
    .replace(/^cdpSession\.send: /u, '')
    .replace(/^Protocol error \([^)]*\): /u, '')
    .split('\n')[0];

/**
 * @param {unknown} error
 * @param {string} label
 * @param {number} timeoutMs
 */
function mapCdpError(error, label, timeoutMs) {
  const message = error instanceof Error ? error.message : String(error);
  // Chrome answers a `timeout` hit with "Internal error" / "Execution was terminated" — name the
  // real cause, the page is still alive. Only on the FIRST round trip: that is the one that carries
  // a CDP `timeout`.
  if (/Execution was terminated|Internal error/u.test(message)) {
    return new Error(`${label} timed out after ${String(timeoutMs)}ms (script terminated, page alive)`);
  }
  return new Error(bareCdpMessage(error));
}

/**
 * The second round trip carries no CDP `timeout` (a page that hangs is caught by `withDeadline` and
 * comes back as `E_DEADLINE` before this), so "Internal error" here means V8 refused to serialize
 * the value — a getter that threw while the result was being read. Calling that a timeout sent
 * every reader after a hang that never happened, and told them to raise `--timeout`.
 * @param {unknown} error
 * @param {any} result the `Runtime.evaluate` result descriptor of the value being read
 */
function mapSerializeError(error, result) {
  const message = error instanceof Error ? error.message : String(error);
  if (/Internal error/u.test(message)) {
    const what = String(result?.className ?? result?.description ?? result?.type ?? 'unknown');
    return new Error(`evaluate result is not serializable (${what})`);
  }
  return new Error(bareCdpMessage(error));
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
          // Serialized IN THE PAGE, not by `returnByValue`: CDP's own serializer enumerates own
          // enumerable properties and never calls `toJSON`, so `new Date(0)` came back as `{}` and
          // `{ stan: 1, od: new Date() }` as `{"stan":1,"od":{}}` — a step that looks fine with one
          // field silently emptied. `JSON.stringify` is what the old `page.evaluate` did (DESIGN.md
          // §2.2): a Date becomes its ISO string, a function and a symbol become `undefined`, and a
          // circular structure throws in the page, which fails the step exactly as it used to.
          functionDeclaration: 'function () { return JSON.stringify(this); }',
          returnByValue: true,
        }),
        timeoutMs,
        label,
      );
      return mapEvaluateResult(second);
    } catch (error) {
      if (error && typeof error === 'object' && /** @type {any} */ (error).code === 'E_DEADLINE') throw error;
      throw mapSerializeError(error, result);
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
