// isolation.mjs — the PURE half of "one persistent tab, scrubbed in place" (DESIGN.md §2.3).
//
// `scrubPlan(state)` turns what the lane knows about itself (popups, a crash, the visited origins,
// the current generation) into an ordered list of operations; `applyScrub` in the engine executes
// them through CDP and the context API. Keeping the decision out of the engine makes it a unit test:
// one origin, four origins, a popup, a crash — each is a table row, not a browser run.
//
// What the plan never contains: a navigation to `about:blank` (measured: no gain, 10–20 ms in the
// queue) and a new tab unless the renderer crashed (a fresh tab costs 160 ms on the next goto,
// the renderer dies with the tab). The previous document STAYS loaded until the next `goto`.

/** @typedef {import('./types.js').LaneState} LaneState */
/** @typedef {import('./types.js').ScrubOp} ScrubOp */

/** The one key an application can see in sessionStorage; the report header names it (`gen=<n>`). */
export const GEN_MARKER = '__bi_gen';

/** Default viewport — the old runner's default and what `resetContext` restores. */
export const DEFAULT_VIEWPORT = Object.freeze({ width: 1280, height: 720 });

/**
 * `Storage.clearDataForOrigin` types cleared per visited origin. Not `all`: `all` would also drop
 * the HTTP cache and the code cache, which are exactly what the warm path keeps on purpose.
 */
export const SCRUB_STORAGE_TYPES = 'cookies,local_storage,indexeddb,cache_storage,service_workers,websql';

/**
 * The generation script installed with `Page.addScriptToEvaluateOnNewDocument`: the first document
 * of every origin in a new generation clears its sessionStorage — the one store
 * `Storage.clearDataForOrigin` cannot reach, because sessionStorage is per tab. The marker makes
 * the script idempotent within a generation (an SPA reloading itself keeps its state).
 * @param {number} generation
 * @returns {string}
 */
export function GEN_SCRIPT(generation) {
  const gen = JSON.stringify(String(generation));
  return (
    `(() => { try { const s = window.sessionStorage; const k = ${JSON.stringify(GEN_MARKER)}; ` +
    `if (s.getItem(k) !== ${gen}) { s.clear(); s.setItem(k, ${gen}); } } catch (e) {} })();`
  );
}

/**
 * Origins worth a `clearOrigin`: http(s) only, deduplicated, in first-visit order. `about:blank`,
 * `null` (opaque), `file:` and data URLs have nothing CDP can clear per origin.
 * @param {readonly (string | null | undefined)[]} origins
 * @returns {string[]}
 */
export function clearableOrigins(origins) {
  const out = [];
  for (const origin of origins) {
    if (typeof origin !== 'string' || !/^https?:\/\//u.test(origin)) continue;
    if (!out.includes(origin)) out.push(origin);
  }
  return out;
}

/**
 * The ordered scrub for one lane. Cost per DESIGN.md: popup 20 ms each, DOMStorage.clear 1–4,
 * generation swap 1, clearDataForOrigin 1/origin, context resets ~10, resetNavigationHistory 2;
 * a crashed tab is rebuilt (+215 ms, `timing.tab = "new"`).
 * @param {LaneState} state
 * @returns {ScrubOp[]}
 */
export function scrubPlan(state) {
  /** @type {ScrubOp[]} */
  const ops = [];
  // 1. Popups (`context.on('page')`) go first — a popup keeps its own renderer alive and its own
  //    sessionStorage; the report already recorded them in `tabs[]`.
  for (const entry of state.pages ?? []) {
    if (!entry.isLaneTab) ops.push({ op: 'closePage', page: entry.page, reason: 'popup' });
  }
  const crashed = state.crashed === true;
  // 2. A crashed renderer cannot answer `DOMStorage.clear` — rebuild the tab instead.
  if (crashed) ops.push({ op: 'newTab', reason: 'crash' });
  // 3. The current origin's session+local storage, in place (works only for the origin the tab is on).
  const current = crashed ? null : clearableOrigins([state.currentOrigin])[0];
  if (current) ops.push({ op: 'domStorageClear', origin: current });
  // 4. New generation: the init script is re-registered on the (possibly new) tab's CDP session.
  ops.push({ op: 'setGeneration', generation: (state.generation ?? 0) + 1 });
  // 5. Every origin this tab visited — cookies, localStorage, IndexedDB, cache storage, SW, websql —
  //    without being on the origin. Includes the current one: DOMStorage.clear left cookies alone.
  for (const origin of clearableOrigins([...(state.visitedOrigins ?? []), state.currentOrigin])) {
    ops.push({ op: 'clearOrigin', origin, storageTypes: SCRUB_STORAGE_TYPES });
  }
  // 6. Context-level state the previous run may have changed: cookies, permissions, routes, offline,
  //    headers, geolocation, emulated media, viewport, dialog policy, default timeouts.
  ops.push({ op: 'resetContext', viewport: { ...(state.viewport ?? DEFAULT_VIEWPORT) }, dialogs: 'dismiss' });
  // 7. `back` in the next run must not reach the previous run's pages. A new tab starts with an
  //    empty history, so the reset is skipped there.
  if (!crashed) ops.push({ op: 'resetNavigationHistory' });
  return ops;
}

/**
 * Whether a snapshot must run in a fresh context from the spare pool instead of the shared
 * scratch lane: explicit `isolation: "fresh"`, an authenticated run (`auth` / `storageState`),
 * video (recorded per context) or the `--fresh` switch.
 * @param {{ isolation?: string, auth?: unknown, storageState?: unknown, video?: unknown }} snapshot
 * @param {{ fresh?: boolean, auth?: unknown }} [options] `auth` = config-level auth block (if any)
 * @returns {boolean}
 */
export function needsFreshContext(snapshot, options = {}) {
  if (options.fresh === true) return true;
  if (snapshot.isolation === 'fresh') return true;
  if (snapshot.video === true) return true;
  if (typeof snapshot.storageState === 'string' && snapshot.storageState !== '') return true;
  // `auth: false` on a snapshot opts out of the config-level session (the anonymous view).
  const authInPlay =
    (options.auth !== undefined && options.auth !== null && options.auth !== false) || snapshot.auth === true;
  if (authInPlay && snapshot.auth !== false) return true;
  return false;
}
