// steps.ctx.mjs — the ONE step context every runner sees, and the one place a step is run
// (DESIGN.md §8, the helpers named in docs/handoff/WP2.md).
//
// Separate from `engine.mjs` because none of it touches the browser pool: given a page, a context,
// a CDP session and a recorder, these five functions are the whole contract between the engine's
// two halves (batch `runFlow` in `flow.mjs`, the interactive session in `session.mjs`) and
// `RUNNERS`. Both halves build their context here, so a runner cannot tell which one called it —
// that identity is what keeps `browser-inspector click` and a batch `click` the same code.

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { degradeTo, withDeadline } from './deadline.mjs';
import { attachRecorder, errorMessage } from './recorder.mjs';
import { maskSnapshotEntries, maskSnapshotValues, redact } from './redact.mjs';
import { waitSettled } from './settle.mjs';
import { boxJoin, compactSnapshot, resolveRef, sensitiveRefs, sidecarFromPage } from './snapshot.mjs';
import { RUNNERS, frameFor } from './steps.run.mjs';
import { describeStep, resolveStepName } from './steps.schema.mjs';

/** @typedef {import('./types.js').PageLike} PageLike */
/** @typedef {import('./types.js').ContextLike} ContextLike */
/** @typedef {import('./types.js').CdpLike} CdpLike */
/** @typedef {import('./recorder.mjs').Recorder} Recorder */
/** @typedef {import('./types.js').StepContext} StepContext */
/** @typedef {import('./types.js').Step} Step */
/** @typedef {import('./types.js').StepResult} StepResult */

/** A step's deadline sits above the Playwright timeout of the action so the action's own message wins. */
export const STEP_GRACE_MS = 2000;

const now = () => performance.now();
const ms = (/** @type {number} */ from) => Math.round(now() - from);

/**
 * `ctx.sel(step)`: a ref resolves to `aria-ref=<ref>` literally, after a `count()` precheck and
 * ONE full-snapshot refresh (an element with the same role and name gets the same ref back);
 * still nothing → `RefNotFoundError` at once, no actionability wait (`resolveRef`, WP3). A
 * selector passes through verbatim. `field` narrows the lookup to `ref` or `selector`.
 * @param {StepContext & Record<string, any>} ctx
 * @param {Step} step
 * @param {string} [field]
 * @returns {Promise<string>}
 */
export async function resolveSelector(ctx, step, field) {
  if (step.ref !== undefined && field !== 'selector') {
    const resolved = await resolveRef(ctx.page, String(step.ref));
    if (resolved.refreshed && typeof resolved.snapshot === 'string') {
      ctx.lastSnapshot = { text: resolved.snapshot, at: Date.now() };
    }
    return resolved.selector;
  }
  if (step.selector !== undefined && field !== 'ref') return String(step.selector);
  throw new Error('the step needs a selector or a ref');
}

/**
 * Navigate on the lane tab with the snapshot's `waitUntil`: `settled` = `load` + the quiet window
 * counted by the recorder; `networkidle` and the rest 1:1.
 * @param {StepContext & Record<string, any>} ctx
 * @param {string} url
 * @param {string | undefined} waitUntil
 * @param {number} [timeoutMs]
 */
export async function navigate(ctx, url, waitUntil, timeoutMs) {
  const wait = waitUntil ?? ctx.snapshot?.waitUntil ?? 'load';
  await ctx.page.goto(url, {
    waitUntil: wait === 'settled' ? 'load' : wait,
    timeout: timeoutMs ?? ctx.timeoutMs,
  });
  if (wait === 'settled') await ctx.settle();
}

/**
 * The snapshot files of DESIGN.md §4.3 / §5, from ONE `ariaSnapshot({ mode: 'ai', boxes: true })`
 * text (WP3's recommended order): `snap.full.yml` raw, `snap.json` the box-joined sidecar,
 * `snap.md` the compact view — sensitive fields and secrets masked in both.
 * @param {StepContext & Record<string, any>} ctx
 * @param {string} text
 * @param {string} base file basename without extension (`snap`, `snap-koszyk`)
 * @returns {Promise<string[]>} files written, relative to `ctx.dir`
 */
export async function writeSnapshotFiles(ctx, text, base) {
  // `sidecarFromPage`, not `boxJoin` over one main-frame walk: a walk that stops at the main
  // document leaves every node inside an iframe without a selector AND without `sensitive`, so a
  // password typed into an embedded login widget kept its value in snap.md and snap.full.yml.
  // The degraded shape is still the ref/role/name sidecar, never an empty one.
  const joined = await degradeTo(
    undefined,
    sidecarFromPage(ctx.page, text),
    Math.min(ctx.timeoutMs, 5000),
    'snapshot walk',
  );
  const entries = joined ?? boxJoin(text, []).entries;
  // A walk that did not run knows NOTHING about `type=password` / `autocomplete=one-time-code` —
  // the aria tree does not carry the DOM type. Degrading to "nothing is sensitive" turned a lost
  // round trip (a navigation mid-evaluate, a page that patched a DOM prototype) into a plain-text
  // password in snap.md and snap.full.yml, so unknown sensitivity cuts every value instead.
  const valuesUnknown = joined === undefined;
  const secretValues = ctx.secretValues;
  const mask = { sensitiveRefs: sensitiveRefs(entries), secretValues, maskAllValueRoles: valuesUnknown };
  const sidecar = maskSnapshotEntries(entries, { secretValues });
  const compact = maskSnapshotValues(compactSnapshot(text, { sidecar: entries }), mask);
  const files = [`${base}.full.yml`, `${base}.md`, `${base}.json`];
  await mkdir(ctx.dir, { recursive: true });
  await Promise.all([
    writeFile(path.join(ctx.dir, files[0]), maskSnapshotValues(text, mask), 'utf8'),
    writeFile(path.join(ctx.dir, files[1]), compact, 'utf8'),
    writeFile(path.join(ctx.dir, files[2]), `${JSON.stringify(sidecar, null, 2)}\n`, 'utf8'),
  ]);
  // `compact` is what `snap --diff` compares against next time (the session keeps it as
  // `prevCompact` when it prints); it is the masked text, so a diff never leaks a value either.
  // `valuesUnknown` travels with the entries so stdout (`maskLines`) applies the same policy.
  ctx.lastSnapshot = { text, entries, compact, at: Date.now(), ...(valuesUnknown ? { valuesUnknown } : {}) };
  return files;
}

/**
 * The ONE context every runner sees (DESIGN.md §8 + the helpers named in docs/handoff/WP2.md).
 * @param {{
 *   page: PageLike, context: ContextLike, cdp: CdpLike, recorder: Recorder,
 *   dir: string, timeoutMs: number, mode: 'batch' | 'session', snapshot?: any, session?: any,
 *   values?: Record<string, string>, secretValues?: string[], files?: Record<string, any>, cwd?: string,
 *   laneTab?: PageLike, snapshotIndex?: number,
 *   cdpFor?: (page: PageLike) => Promise<CdpLike | undefined>,
 * }} input
 * @returns {StepContext & Record<string, any>}
 */
export function makeStepContext(input) {
  const secretValues = input.secretValues ?? [];
  /** @type {StepContext & Record<string, any>} */
  const ctx = {
    page: input.page,
    context: input.context,
    cdp: input.cdp,
    dir: input.dir,
    timeoutMs: input.timeoutMs,
    capture: { screenshots: [], extracts: {}, verifications: [], pending: [] },
    recorder: input.recorder,
    sel: (step, field) => resolveSelector(ctx, step, field),
    values: input.values ?? {},
    address: '',
    value: (field = 'value', step) => {
      const s = step ?? ctx.step ?? {};
      const sent = ctx.values[`${ctx.address}.${field}`];
      if (sent !== undefined) return sent;
      if (s[field] !== undefined) return String(s[field]);
      const envName = s[`${field}FromEnv`];
      if (typeof envName === 'string') {
        throw new Error(`${field} from env ${envName} was not resolved (is ${envName} set?)`);
      }
      throw new Error(`the step has no ${field}`);
    },
    secretValues,
    redact: (text) => redact(text, secretValues),
    files: input.files ?? {},
    mode: input.mode,
    session: input.session,
    snapshot: input.snapshot,
    lines: input.mode === 'session' ? [] : undefined,
    // ── engine helpers (documented in docs/handoff/WP2.md) ──
    cwd: input.cwd ?? process.cwd(),
    laneTab: input.laneTab ?? input.page,
    snapshotIndex: input.snapshotIndex ?? 0,
    stepIndex: 0,
    step: undefined,
    frame: undefined,
    routes: [],
    written: [],
    lastSnapshot: undefined,
    lastShot: undefined,
    loc: (selector) => (frameFor(ctx, selector) ?? ctx.page).locator(selector),
    navigate: (url, waitUntil, timeoutMs) => navigate(ctx, url, waitUntil, timeoutMs),
    settle: () => waitSettled(null, ctx.recorder, { capMs: ctx.snapshot?.settleMs ?? 2000 }),
    artifact: (name, ext) => {
      if (ctx.session) {
        ctx.session.shotSeq = (ctx.session.shotSeq ?? 0) + 1;
        const rel = path.posix.join('shots', `${String(ctx.session.shotSeq).padStart(3, '0')}-${name}.${ext}`);
        return { file: path.join(ctx.dir, rel), rel };
      }
      const rel = `${name}.${ext}`;
      return { file: path.join(ctx.dir, rel), rel };
    },
    writeSnapshot: async (text, step) => {
      const base = !ctx.session && typeof step?.name === 'string' ? `snap-${step.name}` : 'snap';
      const files = await writeSnapshotFiles(ctx, text, base);
      ctx.written.push(...files);
      return files[1];
    },
    setPage: (page) => {
      ctx.page = page;
      ctx.frame = undefined;
    },
    // `setPage` alone left `ctx.cdp` on the tab the step just LEFT, and CDP is what `eval` without
    // `--el` and every screenshot but an element one use — so after `tab new` the report mixed two
    // documents: `extract` from the new tab, `eval` and `final.png` from the old one. The session
    // re-arms after each command; a batch has to do it inside the step, hence this hook.
    rearmCdp: async () => {
      if (!input.cdpFor) return;
      const next = await input.cdpFor(ctx.page);
      if (next) ctx.cdp = next;
    },
    attachPage: (page) => attachRecorder(page, { into: /** @type {Recorder} */ (ctx.recorder) }),
  };
  return ctx;
}

/**
 * One step: the runner under a deadline that sits above the action's own timeout (so the
 * Playwright message wins over `timed out`), the result in the report's shape. Never throws.
 * @param {StepContext & Record<string, any>} ctx
 * @param {Step} step
 * @param {number} index
 * @returns {Promise<StepResult>}
 */
export async function runStep(ctx, step, index) {
  const description = describeStep(step);
  const name = resolveStepName(step.do);
  const started = now();
  ctx.step = step;
  ctx.stepIndex = index;
  ctx.recorder.trigger = description;
  try {
    const runner = name ? RUNNERS[name] : undefined;
    if (!runner) throw new Error(`unknown step ${JSON.stringify(step.do)}`);
    const extra = name === 'wait' && typeof step.ms === 'number' ? step.ms : 0;
    const budget = typeof step.timeout === 'number' ? Math.max(step.timeout, ctx.timeoutMs) : ctx.timeoutMs;
    await withDeadline(runner(ctx, step), budget + extra + STEP_GRACE_MS, description);
    return { index, description, ok: true, ms: ms(started) };
  } catch (error) {
    return { index, description, ok: false, ms: ms(started), error: errorMessage(error) };
  } finally {
    ctx.recorder.trigger = undefined;
  }
}
