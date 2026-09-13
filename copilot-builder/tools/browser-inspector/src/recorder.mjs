// recorder.mjs — the ONE set of page listeners, attached once per tab (DESIGN.md §2.2).
//
// Attached BEFORE the first navigation, because the interesting errors fire during load, and
// attached ONCE, because the lane's tab lives across runs — a listener per run would count every
// console line twice after the second run. Per-run state is cleared by `reset()`; the origins the
// tab visited survive it until the scrub has cleared them (`resetOrigins()`).
//
// Bodies: a `browser-inspector net <n> --body` needs the response body of a request that is long gone, so the
// recorder keeps json/text bodies up to 64 KB as they arrive — in a SESSION, where `net <n> --body`
// reads them. A batch turns them off (`captureBodies` is opt-in there): nothing in a report renders a
// body, and `size` comes from `request.sizes()` instead.
// Secrets never enter here — the keeper redacts on the way OUT (`redact.mjs`), one place for all.

/** @typedef {import('./types.js').PageLike} PageLike */
/** @typedef {import('./types.js').RecorderLike} RecorderLike */
/** @typedef {import('./types.js').ConsoleEntry} ConsoleEntry */
/** @typedef {import('./types.js').NetEntry} NetEntry */
/** @typedef {import('./types.js').DialogEntry} DialogEntry */
/** @typedef {import('./types.js').TabEntry} TabEntry */

/**
 * The concrete recorder this module builds: `RecorderLike` (the shared contract) with the optional
 * members present, so the engine and the tests can use `bodies` and `sinceLast` without a guard.
 * @typedef {RecorderLike & {
 *   bodies: Map<number, string>,
 *   sinceLast: (kind: 'console' | 'net' | 'dialogs', cursor: number) => { entries: any[], cursor: number },
 *   failed: NetEntry[],
 *   failedTotal: number,
 *   navigations: number,
 *   crashed: boolean,
 *   serviceWorkerSeen: boolean,
 *   dialogPolicy: { action: 'accept' | 'dismiss', text?: string, once?: boolean },
 *   trigger: string | undefined,
 *   captureBodies: boolean,
 *   bodyLimit: number,
 *   pending: Promise<unknown>[],
 *   seq: number,
 *   now: () => number,
 *   reset: () => void,
 *   resetOrigins: () => void,
 *   settle: () => Promise<void>,
 * } & Record<string, any>} Recorder
 */

/** Caps on captured evidence — every one of them is marked in the report when it bites. */
export const CONSOLE_CAP = 500;
export const NETWORK_CAP = 500;
export const FAILED_REQUEST_CAP = 100;
export const PAGE_ERROR_CAP = 100;
export const DIALOG_CAP = 100;
/** Response bodies kept for `browser-inspector net <n> --body`: json and text only, up to this many bytes. */
export const BODY_LIMIT = 64 * 1024;
/**
 * One body read gets this long. `response.text()` on a stream that never ends (SSE, long-poll,
 * chunked keep-alive) would otherwise hold `settle()` — and with it the report — forever.
 */
export const BODY_READ_MS = 2000;

/**
 * What is worth keeping: JSON (any `+json`), plain text, HTML, XML, CSV. NOT `text/javascript` /
 * `text/css`: on an app-factory build those are the bundles (840 KB chunks, per snapshot, per run)
 * pulled through the CDP pipe while the steps are still running — nothing an agent asks
 * `browser-inspector net <n> --body` for. Streams (`text/event-stream`) are excluded by type as well.
 */
export const BODY_TYPES =
  /^(?:application\/(?:json|[a-z0-9.+-]*\+json|xml)|text\/(?:plain|html|xml|csv|markdown|tab-separated-values))$/iu;
const STREAM_TYPES = /^text\/event-stream$/iu;
/** A console / pageerror line that betrays a service-worker registration on a blocking context. */
const SW_SIGNAL = /ServiceWorker|serviceWorker\.register|navigator\.serviceWorker/u;

/**
 * The cap timers race against body reads and `settle()`, and the read usually wins in a few ms —
 * the loser must not keep the process alive: unref'd, so an in-process run (`--no-daemon`, CI,
 * fallback) exits when the report is written instead of up to `BODY_READ_MS` later (measured:
 * every `browser-inspector-cold` paid ~1.5 s of idle wait for three finished body reads). While the browser is
 * connected its pipe keeps the loop alive, so the timer still fires when a read really hangs.
 */
const sleep = (/** @type {number} */ ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms).unref();
  });

/** First line of an error — the report keeps one line per problem. */
export const errorMessage = (/** @type {unknown} */ error) =>
  error instanceof Error ? (error.message.split('\n')[0] ?? error.message) : String(error);

/**
 * `http://host:port` of a URL, `null` for anything CDP cannot clear per origin (about:blank,
 * data:, file:, an unparsable string).
 * @param {string | undefined | null} url
 * @returns {string | null}
 */
export function originOf(url) {
  if (typeof url !== 'string') return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.origin : null;
  } catch {
    return null;
  }
}

/**
 * @typedef {object} RecorderOptions
 * @property {boolean} [captureBodies] keep json/text response bodies (default true; the batch half
 *   passes `false` — see `flow.mjs`, and `config.mjs` for the snapshot default)
 * @property {number} [bodyLimit] bytes per body (default 64 KB)
 * @property {number} [bodyReadMs] cap on one body read and on `settle()` (default `BODY_READ_MS`)
 * @property {Recorder} [into] an existing recorder to attach a second page (popup, `tab new`) to
 * @property {() => number} [now] clock, injectable for tests
 */

/**
 * Create the store every page of a lane/session reports into. Exported separately so a popup or
 * a new tab can be attached to the SAME store (`attachRecorder(popup, { into })`).
 * @param {RecorderOptions} [options]
 * @returns {Recorder}
 */
export function createRecorder(options = {}) {
  const now = options.now ?? Date.now;
  /** @type {Recorder} */
  const recorder = {
    console: [],
    consoleTotal: 0,
    pageErrors: [],
    network: [],
    networkTotal: 0,
    failed: [],
    failedTotal: 0,
    dialogs: [],
    tabs: [],
    visitedOrigins: [],
    inFlight: 0,
    bodies: new Map(),
    /** Main-frame navigations since reset — the session line says `navigated` when this moved. */
    navigations: 0,
    /** The renderer died since the last reset/scrub — the scrub rebuilds the tab. */
    crashed: false,
    /**
     * The page tried to register a service worker — on the scratch context (`serviceWorkers:
     * 'block'`) that means the app under test ran WITHOUT it, and the report header says `sw=blocked`.
     */
    serviceWorkerSeen: false,
    /** The policy the dialog listener applies: `browser-inspector dialog accept --text x --once`. */
    dialogPolicy: { action: 'dismiss' },
    /** Set by the engine before an action so a dialog entry can say what triggered it. */
    trigger: undefined,
    captureBodies: options.captureBodies !== false,
    bodyLimit: options.bodyLimit ?? BODY_LIMIT,
    bodyReadMs: options.bodyReadMs ?? BODY_READ_MS,
    /** Fire-and-forget body reads; `settle()` awaits them before a report is written. */
    pending: [],
    seq: 0,
    now,
    /**
     * Entries after `cursor` — `browser-inspector console` / `browser-inspector net` print only what is new since the last call.
     * @param {'console' | 'net' | 'dialogs'} kind @param {number} cursor
     */
    sinceLast(kind, cursor) {
      const source = kind === 'net' ? recorder.network : kind === 'console' ? recorder.console : recorder.dialogs;
      const from = Math.min(Math.max(cursor, 0), source.length);
      return { entries: source.slice(from), cursor: source.length };
    },
    /** Per-run state back to zero; the visited origins stay until the scrub has cleared them. */
    reset() {
      recorder.console = [];
      recorder.consoleTotal = 0;
      recorder.pageErrors = [];
      recorder.network = [];
      recorder.networkTotal = 0;
      recorder.failed = [];
      recorder.failedTotal = 0;
      recorder.dialogs = [];
      recorder.tabs = [];
      recorder.inFlight = 0;
      recorder.bodies = new Map();
      recorder.navigations = 0;
      recorder.serviceWorkerSeen = false;
      recorder.pending = [];
      recorder.trigger = undefined;
      recorder.dialogPolicy = { action: 'dismiss' };
    },
    /** After a scrub the tab is clean — nothing to clear next time until it navigates again. */
    resetOrigins() {
      recorder.visitedOrigins = [];
      recorder.crashed = false;
    },
    /**
     * Await the body reads still in flight (best-effort, never a failure) — bounded, so a report is
     * always written even when a read is stuck behind an open stream.
     */
    async settle() {
      const waiting = recorder.pending;
      recorder.pending = [];
      if (waiting.length === 0) return;
      await Promise.race([Promise.allSettled(waiting), sleep(recorder.bodyReadMs ?? BODY_READ_MS)]);
    },
  };
  return recorder;
}

/**
 * Attach the listeners of one page to a store. Returns the store, so `attachRecorder(page)` is
 * the one-liner for a lane tab and `attachRecorder(popup, { into })` adds a popup to it.
 * @param {PageLike} page
 * @param {RecorderOptions} [options]
 * @returns {Recorder}
 */
export function attachRecorder(page, options = {}) {
  const recorder = options.into ?? createRecorder(options);
  const now = recorder.now ?? Date.now;
  /** @type {WeakMap<object, NetEntry & { startedAt: number }>} */
  const byRequest = new WeakMap();

  page.on('console', (message) => {
    recorder.consoleTotal += 1;
    if (recorder.console.length >= CONSOLE_CAP) return;
    let location;
    try {
      const at = message.location?.();
      if (at?.url) location = `${at.url}:${String(at.lineNumber ?? 0)}`;
    } catch {
      // A console message from a detached frame has no location — the text still counts.
    }
    const text = message.text();
    if (SW_SIGNAL.test(text)) recorder.serviceWorkerSeen = true;
    recorder.console.push({ type: message.type(), text, ...(location ? { location } : {}), at: now() });
  });

  page.on('pageerror', (error) => {
    const text = errorMessage(error);
    if (SW_SIGNAL.test(text)) recorder.serviceWorkerSeen = true;
    if (recorder.pageErrors.length < PAGE_ERROR_CAP) recorder.pageErrors.push(text);
  });

  page.on('request', (request) => {
    recorder.networkTotal += 1;
    recorder.inFlight += 1;
    recorder.seq += 1;
    /** @type {NetEntry & { startedAt: number }} */
    const entry = {
      id: recorder.seq,
      method: request.method(),
      url: request.url(),
      resourceType: request.resourceType?.() ?? 'other',
      startedAt: now(),
    };
    if (entry.resourceType === 'serviceworker') recorder.serviceWorkerSeen = true;
    byRequest.set(request, entry);
    if (recorder.network.length < NETWORK_CAP) recorder.network.push(entry);
  });

  page.on('response', (response) => {
    const request = response.request();
    const entry = byRequest.get(request);
    const status = response.status();
    const headers = safeHeaders(response);
    const contentType = headers['content-type'];
    if (entry) {
      entry.status = status;
      if (contentType) entry.contentType = contentType.split(';')[0].trim();
      const length = Number(headers['content-length']);
      if (Number.isFinite(length)) entry.size = length;
    }
    // A 4xx/5xx is a failure too, though the request "succeeded" — Playwright does not count it
    // as requestfailed, and it is the most common shape of a broken backend.
    if (status >= 400) recordFailure(recorder, entry, request, `HTTP ${String(status)}`);
    if (recorder.captureBodies && entry && entry.contentType) {
      // Decided BEFORE the read, and the reason kept: `browser-inspector net <n> --body` then says why there is
      // no body instead of "(no body captured)". `text()` on a stream never returns; a 840 KB
      // bundle would cross the pipe only to be cut to 64 KB.
      const type = entry.contentType;
      const skip = STREAM_TYPES.test(type)
        ? 'stream'
        : !BODY_TYPES.test(type)
          ? 'type'
          : entry.size !== undefined && entry.size > recorder.bodyLimit
            ? 'too large'
            : undefined;
      if (skip) entry.bodySkipped = skip;
      else {
        const read = Promise.race([
          Promise.resolve().then(() => response.text()),
          sleep(recorder.bodyReadMs ?? BODY_READ_MS).then(() => undefined),
        ])
          .then((text) => {
            if (typeof text !== 'string') {
              entry.bodySkipped = 'timeout';
              return;
            }
            const limit = recorder.bodyLimit;
            recorder.bodies.set(entry.id, text.length > limit ? text.slice(0, limit) : text);
            if (entry.size === undefined) entry.size = Buffer.byteLength(text);
          })
          .catch(() => {
            // A redirect or a body Chrome already dropped has no text; the entry stays without one.
          });
        recorder.pending.push(read);
      }
    }
  });

  page.on('requestfinished', (request) => {
    recorder.inFlight = Math.max(0, recorder.inFlight - 1);
    const entry = byRequest.get(request);
    if (!entry) return;
    entry.ms = now() - entry.startedAt;
    // `size` WITHOUT reading the body. `Content-Length` covers the easy case, but a `chunked`
    // response has none — and that used to leave `Buffer.byteLength(text)` from the body read as the
    // only source, which is why a batch that renders no body still waited for every one of them.
    // `request.sizes()` reads `Network.loadingFinished.encodedDataLength`, which playwright-core
    // already has in memory by the time this handler runs: no extra round trip. It rides
    // `recorder.pending` (bounded by `settle()`), never a bare await, because `internalSizes()` also
    // waits for the raw response headers and a missing `responseReceivedExtraInfo` would hang it.
    // Bytes ON THE WIRE, so compressed and framed — `types.d.ts` says so on `NetEntry.size`. Lands
    // only for a request that FINISHED during the run: one still in flight when the report is built
    // keeps neither `ms` nor `size`, and that is the tail a batch deliberately stopped waiting for.
    if (entry.size !== undefined || typeof request.sizes !== 'function') return;
    recorder.pending.push(
      Promise.resolve()
        .then(() => request.sizes())
        .then((sizes) => {
          const bytes = Number(sizes?.responseBodySize);
          // A response served from cache reports `encodedDataLength - headersSize` without a floor,
          // so it can come out zero or negative: no number is better than a wrong one.
          if (Number.isFinite(bytes) && bytes > 0 && entry.size === undefined) entry.size = bytes;
        })
        .catch(() => {
          // A request Chrome dropped, or an engine whose `Request` has no `sizes()` — the entry
          // simply keeps no size, exactly as before this line existed.
        }),
    );
  });

  page.on('requestfailed', (request) => {
    recorder.inFlight = Math.max(0, recorder.inFlight - 1);
    const entry = byRequest.get(request);
    const failure = safeCall(() => request.failure()?.errorText) ?? 'unknown';
    if (entry) entry.ms = now() - entry.startedAt;
    recordFailure(recorder, entry, request, failure);
  });

  page.on('dialog', (dialog) => {
    const type = dialog.type();
    const message = dialog.message();
    const policy = recorder.dialogPolicy ?? { action: 'dismiss' };
    // `beforeunload` is ALWAYS accepted — dismissing it blocks every navigation that follows.
    const accept = type === 'beforeunload' || policy.action === 'accept';
    const action = accept ? 'accepted' : 'dismissed';
    const done = accept
      ? dialog.accept(type === 'prompt' && policy.text !== undefined ? policy.text : undefined)
      : dialog.dismiss();
    Promise.resolve(done).catch(() => {
      // The dialog may already be gone (page navigated away); nothing to handle.
    });
    if (recorder.dialogs.length < DIALOG_CAP) {
      /** @type {DialogEntry} */
      const entry = { type, message, action, ...(recorder.trigger ? { trigger: recorder.trigger } : {}) };
      recorder.dialogs.push(entry);
    }
    if (policy.once && type !== 'beforeunload') recorder.dialogPolicy = { action: 'dismiss' };
  });

  page.on('popup', (popup) => {
    /** @type {TabEntry} */
    const entry = { url: safeCall(() => popup.url()) ?? '', title: '', openedAt: now() };
    recorder.tabs.push(entry);
    // The title arrives with the document; a popup that never loads keeps an empty one.
    const titled = Promise.resolve()
      .then(() => popup.waitForLoadState?.('domcontentloaded', { timeout: 2000 }))
      .then(() => popup.title())
      .then((title) => {
        entry.title = title;
        entry.url = safeCall(() => popup.url()) ?? entry.url;
      })
      .catch(() => {});
    recorder.pending.push(titled);
  });

  page.on('framenavigated', (frame) => {
    const main = safeCall(() => page.mainFrame?.());
    if (main !== undefined && frame !== main) return;
    if (main === undefined && safeCall(() => frame.parentFrame?.()) != null) return;
    recorder.navigations += 1;
    const origin = originOf(safeCall(() => frame.url()));
    if (origin && !recorder.visitedOrigins.includes(origin)) recorder.visitedOrigins.push(origin);
  });

  page.on('crash', () => {
    recorder.crashed = true;
  });

  return recorder;
}

/**
 * @param {Recorder} recorder
 * @param {NetEntry | undefined} entry
 * @param {any} request
 * @param {string} failure
 */
function recordFailure(recorder, entry, request, failure) {
  if (entry?.failure !== undefined) {
    // The SAME request can fail twice: a 4xx/5xx whose body never arrives fires `response` and
    // then `requestfailed`. Counting and listing it twice inflated `net N (M failed)`, printed
    // `## errors` in duplicate and pushed real failures out of the cap; overwriting the first
    // reason lost the HTTP status the entry was recorded for. One entry, both reasons.
    if (entry.failure !== failure) entry.failure = `${entry.failure} → ${failure}`;
    return;
  }
  if (entry) entry.failure = failure;
  recorder.failedTotal += 1;
  if (recorder.failed.length >= FAILED_REQUEST_CAP) return;
  recorder.failed.push(
    entry ?? {
      id: 0,
      method: safeCall(() => request.method()) ?? 'GET',
      url: safeCall(() => request.url()) ?? '',
      failure,
    },
  );
}

/** @param {any} response @returns {Record<string, string>} */
function safeHeaders(response) {
  const headers = safeCall(() => response.headers());
  if (!headers || typeof headers !== 'object') return {};
  /** @type {Record<string, string>} */
  const out = {};
  for (const [key, value] of Object.entries(headers)) out[key.toLowerCase()] = String(value);
  return out;
}

/**
 * @template T
 * @param {() => T} fn
 * @returns {T | undefined}
 */
function safeCall(fn) {
  try {
    return fn();
  } catch {
    return undefined;
  }
}

/**
 * The report's view of a recorder (DESIGN.md §5.2): console with its cap, page errors, network
 * totals with the failed list, the old `failedRequests` shape for the app-factory gate, dialogs,
 * popups and the cache counters.
 * @param {Recorder} recorder
 * @returns {{
 *   console: { entries: ConsoleEntry[], total: number, truncated: boolean },
 *   pageErrors: string[],
 *   network: { total: number, failed: NetEntry[] },
 *   failedRequests: { entries: { url: string, failure: string }[], truncated: boolean },
 *   dialogs: DialogEntry[],
 *   tabs: TabEntry[],
 * }}
 */
export function summarize(recorder) {
  const failed = /** @type {NetEntry[]} */ (recorder.failed ?? []).map((entry) => {
    const { startedAt: _dropped, ...rest } = /** @type {any} */ (entry);
    return rest;
  });
  return {
    console: {
      entries: recorder.console.map(({ at: _at, ...entry }) => entry),
      total: recorder.consoleTotal,
      truncated: recorder.consoleTotal > recorder.console.length,
    },
    pageErrors: [...recorder.pageErrors],
    network: { total: recorder.networkTotal, failed },
    failedRequests: {
      entries: failed.map((entry) => ({ url: entry.url, failure: entry.failure ?? 'unknown' })),
      truncated: (recorder.failedTotal ?? failed.length) > failed.length,
    },
    dialogs: [...recorder.dialogs],
    tabs: [...recorder.tabs],
  };
}
