// session.mjs — the interactive half of the engine (DESIGN.md §4).
//
// A session is its own context (never a scratch lane — a scrub would kill the agent's refs), one
// recorder for all its tabs, ONE step context that lives across commands (frame scope, routes, the
// last snapshot, the shot counter) and a journal on disk. Keyed by NAME only (§4.5): a `cd` in the
// agent's shell must not open a second session behind its back.
//
// Separate from `engine.mjs`: `runCommand` (one `browser-inspector click|fill|snap …`), `runScript`
// (`browser-inspector script <file>` — the same commands in one process) and `exportFlow` (the
// journal → a batch config) all sit on the same three things the batch half uses: the lane pool's
// fresh context, the step context of `steps.ctx.mjs` and `RUNNERS`. `engine.mjs` keeps the registry
// alive across commands and closes it before the browser goes away.

import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

import { CliError, parseSessionCommand } from './cli.mjs';
import { isScriptComment, splitCommandLine } from './client.mjs';
import { degradeTo, withDeadline } from './deadline.mjs';
import { DEFAULT_OUTPUT_DIR, sessionDir } from './paths.mjs';
import {
  formatDeltas,
  formatExport,
  formatFail,
  formatOk,
  formatOpen,
  formatShot,
  relPath,
  truncate,
} from './print.mjs';
import { attachRecorder, errorMessage, originOf } from './recorder.mjs';
import { redact } from './redact.mjs';
import {
  ExportError,
  exportFlow,
  formatJournalLine,
  journalLineCount,
  journalPath,
  readJournal,
  writeFlowExport,
} from './session-log.mjs';
import { makeStepContext, runStep } from './steps.ctx.mjs';
import { durableSelector } from './steps.run.mjs';
import { STEPS, describeStep, refFieldsOf, resolveStepName } from './steps.schema.mjs';
import { WEBMCP_SHIM_SCRIPT } from './webmcp.mjs';

/** @typedef {import('./types.js').PageLike} PageLike */
/** @typedef {import('./types.js').CdpLike} CdpLike */
/** @typedef {import('./recorder.mjs').Recorder} Recorder */
/** @typedef {import('./types.js').StepContext} StepContext */
/** @typedef {import('./types.js').Step} Step */
/** @typedef {import('./types.js').TimingMode} TimingMode */
/** @typedef {import('./lanes.mjs').LanePool} LanePool */

const now = () => performance.now();
const ms = (/** @type {number} */ from) => Math.round(now() - from);

/**
 * @typedef {object} CommandContext
 * @property {string} [command] canonical name
 * @property {string} [alias] as typed (`open`, `snap`)
 * @property {{ session?: string, out?: string, soft?: boolean }} [options]
 * @property {string} cwd
 * @property {string} [out] absolute output dir (the keeper resolved `--out`)
 * @property {Record<string, string>} [values]
 * @property {string[]} [secretValues]
 * @property {Record<string, any>} [files]
 * @property {TimingMode} [mode]
 * @property {number} [queuedMs]
 * @property {(text: string) => string} [redact]
 * @property {(line: string) => void} [log]
 */

/**
 * @param {{
 *   pool: LanePool,
 *   env: NodeJS.ProcessEnv,
 *   log: (line: string) => void,
 *   isClosed: () => boolean,
 * }} input
 */
export function createSessions(input) {
  const { pool, env, log, isClosed } = input;

  // ── Sessions (DESIGN.md §4) ────────────────────────────────────────────────
  //
  // A session is its own context (never a scratch lane — a scrub would kill the agent's refs),
  // one recorder for all its tabs, ONE step context that lives across commands (frame scope,
  // routes, the last snapshot, the shot counter) and a journal on disk. Keyed by NAME only
  // (§4.5): a `cd` in the agent's shell must not open a second session behind its back.

  /**
   * @typedef {object} Session
   * @property {string} name
   * @property {string} dir `<out>/session/<name>`
   * @property {string} cwd cwd of the command that opened it
   * @property {string} out
   * @property {any} context
   * @property {PageLike} laneTab the first tab — `tab close` never closes it
   * @property {Recorder} recorder
   * @property {StepContext & Record<string, any>} ctx
   * @property {Map<any, CdpLike>} cdps one CDP session per tab (screenshots, evaluate)
   * @property {Map<number, { headers: Record<string, string>, postData?: string }>} requestMeta for `net <n> --req`
   * @property {number} shotSeq
   * @property {number} evalSeq
   * @property {number} commands
   * @property {number} docs main-frame documents on the current tab — the `f<seq>` hint after a navigation
   * @property {number} el last known interactive element count (`el a→b`)
   * @property {number} dom last known MutationObserver counter (`dom Δ`)
   * @property {string | undefined} title
   * @property {string | undefined} baseOrigin origin of the first `open` — deltas print paths on it
   * @property {string[] | undefined} prevCompact the compact view `snap --diff` compares against
   * @property {Record<string, number>} cursors since-last cursors of `console` / `net`
   * @property {Record<string, number>} flushed how much of console / net went to the jsonl files
   * @property {Record<string, { selector?: string, inFrame: boolean }> | undefined} resolving ref → what
   *   `durableSelector` found, per command
   * @property {string | undefined} videoDir
   * @property {number} openedAt
   * @property {number} lastUsedAt
   * @property {() => Promise<{ video?: string }>} end
   * @property {{ action: 'accept' | 'dismiss', text?: string, once?: boolean }} dialogPolicy
   * @property {Set<string>} secretValues every secret any command of this session carried (§2.6: per session, not per request)
   * @property {Promise<unknown>} writes the journal / console / net appends, chained in order and awaited only by `close` / `export`
   * @property {number} journalSeq
   * @property {string} sessionId stamped on every journal line — `export` covers THIS session only
   * @property {number} [fetchSeq]
   * @property {number} [runSeq]
   */

  /** @type {Map<string, Session>} */
  const sessions = new Map();
  /** A session step waits this long for an action before it is a FAIL (the config default). */
  const sessionTimeoutMs = Number(env.BROWSER_INSPECTOR_STEP_TIMEOUT_MS) || 10_000;

  /**
   * Counted by `probe` after every command: the roles an agent can act on. Kept as a selector
   * (one `querySelectorAll`, ~1 ms) rather than the element map of the final evidence, which
   * also serialises names and selectors.
   */
  const INTERACTIVE_SELECTOR =
    'a[href],button,input:not([type=hidden]),select,textarea,summary,[role=button],[role=link],' +
    '[role=checkbox],[role=radio],[role=tab],[role=menuitem],[role=option],[role=switch],[role=combobox],' +
    '[role=textbox],[role=slider],[role=spinbutton],[contenteditable=""],[contenteditable=true]';

  /**
   * The session's init script: a MutationObserver counter every document of the context gets,
   * so `dom Δ` costs one property read instead of a snapshot (§4.2). One global, prefixed.
   * It re-arms itself, because a page-opened popup gets the script ONCE — on its initial
   * `about:blank` — and Chrome then reuses that same `window` for the real navigation: the
   * observer stayed on the discarded document and `__bi_dom` answered a plausible 0 forever, so
   * no command inside a popup ever reported `dom Δ`. Both hooks are needed: the window-level
   * listeners catch the swap early (mutations during load are counted), the getter is the net for
   * a document that arrives without either event.
   */
  const DOM_COUNTER_SCRIPT =
    '(() => { const w = window; let n = 0; let doc; const arm = () => { if (doc === document) return; doc = document; n = 0;' +
    ' try { new MutationObserver((m) => { n += m.length; })' +
    '.observe(document, { subtree: true, childList: true, attributes: true, characterData: true }); } catch {} };' +
    ' try { Object.defineProperty(w, "__bi_dom", { configurable: true,' +
    ' get() { arm(); return n; }, set(v) { n = Number(v) || 0; } }); } catch { w.__bi_dom = 0; }' +
    ' arm(); w.addEventListener("DOMContentLoaded", arm); w.addEventListener("load", arm); })();';

  /**
   * In-page: the after-probe of a command. Named, so a FakePage can recognise it by `fn.name`.
   * @param {string} selector
   */
  function sessionProbe(selector) {
    /** @type {(Document | ShadowRoot)[]} */
    const roots = [document];
    let el = 0;
    for (let r = 0; r < roots.length; r += 1) {
      // Open shadow roots are part of what the agent can act on (the aria tree shows them), so a
      // count that stops at the light DOM answered `el 0` for a page built from web components.
      for (const host of roots[r].querySelectorAll('*')) if (host.shadowRoot) roots.push(host.shadowRoot);
      el += roots[r].querySelectorAll(selector).length;
    }
    return { el, dom: Number(/** @type {any} */ (window).__bi_dom ?? 0), title: document.title };
  }

  /** Console errors + page errors — what `err N` and `+N console.error` count. @param {Recorder} recorder */
  const errorCount = (recorder) =>
    recorder.console.filter((e) => e.type === 'error').length + recorder.pageErrors.length;

  /**
   * Every tab of a session gets its CDP session (`Page.enable` for screenshots and evaluate), a
   * popup hook that pulls the popup into the same recorder and arms it too, and a request hook
   * that keeps the request headers the recorder does not (for `net <n> --req`).
   * @param {Session} session @param {PageLike} page
   */
  async function armSessionPage(session, page) {
    if (session.cdps.has(page)) return;
    /** @type {CdpLike} */
    let cdp;
    try {
      cdp = await session.context.newCDPSession(page);
      await cdp.send('Page.enable').catch(() => {});
    } catch (error) {
      log(`session ${session.name}: no CDP session (${errorMessage(error)}) — screenshots via Playwright`);
      cdp = {
        send: async () => {
          throw new Error('no CDP session on this tab');
        },
      };
    }
    session.cdps.set(page, cdp);
    page.on('popup', (popup) => {
      attachRecorder(popup, { into: session.recorder });
      void armSessionPage(session, popup);
    });
    page.on('request', (request) => {
      // The recorder's own listener ran first (same page, registered earlier), so `seq` is this
      // request's id. Capped: the map is a convenience for `--req`, not an archive.
      const headers = typeof request.headers === 'function' ? request.headers() : {};
      const postData = typeof request.postData === 'function' ? (request.postData() ?? undefined) : undefined;
      session.requestMeta.set(session.recorder.seq, { headers, ...(postData ? { postData } : {}) });
      if (session.requestMeta.size > 500) {
        const oldest = session.requestMeta.keys().next().value;
        if (oldest !== undefined) session.requestMeta.delete(oldest);
      }
    });
    page.on('close', () => {
      session.cdps.delete(page);
      // A tab can die without a `tab close`: `window.close()` in a popup, an app closing its own
      // tab. `ctx.page` then pointed at a dead target and EVERY later command answered "Target
      // page … has been closed" — `open` included, because `goto` navigates the current tab — with
      // `tabs` listing live tabs and marking none of them as current.
      const ctx = session.ctx;
      if (!ctx || ctx.page !== page) return;
      const back = ctx.laneTab?.isClosed?.() === false ? ctx.laneTab : session.context.pages()[0];
      if (!back || back === page) return;
      ctx.setPage(back);
      const cdp = session.cdps.get(back);
      if (cdp) ctx.cdp = cdp;
      else void armSessionPage(session, back);
    });
  }

  /**
   * Create a session on `browser-inspector open`: a fresh context (the prewarmed spare, or a recording one for
   * `--video`), the recorder, the step context that every later command reuses.
   * @param {string} name
   * @param {{ cwd: string, out?: string, video?: boolean, secretValues?: string[] }} where
   * @returns {Promise<Session>}
   */
  async function openSession(name, where) {
    if (isClosed()) throw new Error('engine closed');
    await pool.ensureBrowser();
    const out = where.out ?? path.resolve(where.cwd, DEFAULT_OUTPUT_DIR);
    const dir = sessionDir(out, name);
    await mkdir(dir, { recursive: true });
    const videoDir = where.video ? path.join(dir, 'video') : undefined;
    const pair = await pool.freshContext({ video: videoDir });
    const recorder = attachRecorder(pair.page);
    await pair.context.addInitScript?.(DOM_COUNTER_SCRIPT).catch?.(() => {});
    // The WebMCP registry (`tools` / `call`) must exist before the page's first script registers a tool.
    await pair.context.addInitScript?.(WEBMCP_SHIM_SCRIPT).catch?.(() => {});
    /** @type {Session} */
    const session = {
      name,
      dir,
      cwd: where.cwd,
      out,
      context: pair.context,
      laneTab: pair.page,
      recorder,
      ctx: /** @type {any} */ (undefined),
      cdps: new Map(),
      requestMeta: new Map(),
      shotSeq: 0,
      evalSeq: 0,
      commands: 0,
      docs: 0,
      el: 0,
      dom: 0,
      title: undefined,
      baseOrigin: undefined,
      prevCompact: undefined,
      cursors: {},
      flushed: {},
      resolving: undefined,
      videoDir,
      openedAt: Date.now(),
      lastUsedAt: Date.now(),
      end: () => endSession(name),
      dialogPolicy: recorder.dialogPolicy,
      secretValues: new Set((where.secretValues ?? []).filter((v) => v !== '')),
      writes: Promise.resolve(),
      // A session reopened over yesterday's journal keeps numbering where it stopped.
      journalSeq: journalLineCount(journalPath(dir)),
      // …and marks its own lines, so `export` can tell them from the ones already in that file.
      sessionId: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    };
    await armSessionPage(session, pair.page);
    const ctx = makeStepContext({
      page: pair.page,
      context: pair.context,
      cdp: /** @type {CdpLike} */ (session.cdps.get(pair.page)),
      recorder,
      dir,
      timeoutMs: sessionTimeoutMs,
      mode: 'session',
      session,
      cwd: where.cwd,
      laneTab: pair.page,
      secretValues: [...session.secretValues],
      // The `tab` runner re-arms the CDP session inside the step; the post-command fix-up below
      // stays for the tabs a PAGE opens (a popup), which no step moved us onto.
      cdpFor: async (page) => {
        await armSessionPage(session, page);
        return session.cdps.get(page);
      },
    });
    ctx.unsafe = env.BROWSER_INSPECTOR_UNSAFE === '1';
    // The durable selector of a ref is captured WHEN the action resolves it (§4.5): the element is
    // there (`count() > 0` just passed) and may be gone right after the click.
    const baseSel = ctx.sel;
    ctx.sel = async (step, field) => {
      const selector = await baseSel(step, field);
      const ref = step.ref;
      if (typeof ref === 'string' && field !== 'selector' && session.resolving && !(ref in session.resolving)) {
        session.resolving[ref] = await durableSelector(ctx, ref);
      }
      return selector;
    };
    session.ctx = ctx;
    sessions.set(name, session);
    log(`session ${name} opened → ${dir}`);
    return session;
  }

  /**
   * End a session: close its context (a recording is complete only then — the video is saved
   * after the close), forget it. Idempotent.
   * @param {string} name
   * @returns {Promise<{ video?: string }>}
   */
  async function endSession(name) {
    const session = sessions.get(name);
    if (!session) return {};
    sessions.delete(name);
    // The journal and the jsonl logs are appended off the answer path — they must be complete
    // before the directory is read as a finished session.
    await session.writes.catch(() => undefined);
    const video = session.videoDir ? session.laneTab.video?.() : undefined;
    await session.context.close().catch(() => {});
    /** @type {{ video?: string }} */
    const result = {};
    if (video) {
      const file = path.join(session.videoDir ?? session.dir, 'session.webm');
      await video
        .saveAs(file)
        .then(() => video.delete().catch(() => {}))
        .then(() => {
          result.video = file;
        })
        .catch((/** @type {unknown} */ error) => log(`session ${name}: video not saved: ${errorMessage(error)}`));
    }
    log(`session ${name} closed after ${String(session.commands)} commands`);
    return result;
  }

  /**
   * The line's head: the command as the agent typed it plus its target (`click e112`, `fill e39`,
   * `open …` — never a fill value; `describeStep` already says `(literal)` / `(from env X)` instead,
   * and that suffix is a report detail, not a stdout one).
   * @param {string} alias @param {Step} step
   */
  function headOf(alias, step) {
    const described = describeStep(step).replace(/ \((?:literal|from env [^)]*|soft)\)/gu, '');
    const space = described.indexOf(' ');
    return space === -1 ? alias : `${alias}${described.slice(space)}`;
  }

  /**
   * What the page looks like after a command — ONE evaluate (~1 ms) with a short cap, so a hung
   * page costs a line without deltas, never a stuck agent.
   * @param {Session} session
   */
  async function probePage(session) {
    const page = session.ctx.page;
    const raw = await degradeTo(
      undefined,
      Promise.resolve()
        .then(() => page.evaluate(sessionProbe, INTERACTIVE_SELECTOR))
        .catch(() => undefined),
      1500,
      'session probe',
    );
    // Child frames pay only when there ARE child frames (§4.4 budgets one evaluate per command).
    // Without them an app embedded in an iframe answers `el 0` for a page with a whole form in
    // it, and `dom Δ` — the cheap "something changed" signal — never moves: the counter is
    // per-window and `page.evaluate` reads the main frame's.
    const children = typeof page.frames === 'function' ? page.frames().slice(1) : [];
    const inFrames = await Promise.all(
      children.map((frame) =>
        degradeTo(
          { el: 0, dom: 0 },
          Promise.resolve()
            .then(() => frame.evaluate(sessionProbe, INTERACTIVE_SELECTOR))
            .then((r) => ({ el: Number(r?.el ?? 0), dom: Number(r?.dom ?? 0) })),
          1500,
          'frame probe',
        ).catch(() => ({ el: 0, dom: 0 })),
      ),
    );
    const extra = inFrames.reduce((sum, r) => ({ el: sum.el + r.el, dom: sum.dom + r.dom }), { el: 0, dom: 0 });
    if (raw && typeof raw === 'object') {
      session.el = Number(raw.el ?? session.el) + extra.el;
      session.dom = Number(raw.dom ?? session.dom) + extra.dom;
      session.title = typeof raw.title === 'string' ? raw.title : session.title;
    }
    return { el: session.el, dom: session.dom, title: session.title, url: safeUrl(page) };
  }

  /** @param {PageLike} page */
  function safeUrl(page) {
    try {
      return page.url();
    } catch {
      return '';
    }
  }

  /**
   * Append what the recorder saw since the last flush to `console.jsonl` / `net.jsonl` — the
   * session's memory of what scrolled past, redacted, one line per entry.
   * @param {Session} session
   */
  function flushLogs(session) {
    const { recorder, ctx } = session;
    const lines = (/** @type {any[]} */ entries) => entries.map((e) => ctx.redact(JSON.stringify(e))).join('\n');
    const fromConsole = Math.min(session.flushed.console ?? 0, recorder.console.length);
    const fromNet = Math.min(session.flushed.net ?? 0, recorder.network.length);
    const newConsole = recorder.console.slice(fromConsole);
    const newNet = recorder.network.slice(fromNet).map((e) => {
      const { startedAt: _dropped, ...rest } = /** @type {any} */ (e);
      return rest;
    });
    session.flushed.console = recorder.console.length;
    session.flushed.net = recorder.network.length;
    const writes = [];
    if (newConsole.length > 0)
      writes.push(appendFile(path.join(session.dir, 'console.jsonl'), `${lines(newConsole)}\n`));
    if (newNet.length > 0) writes.push(appendFile(path.join(session.dir, 'net.jsonl'), `${lines(newNet)}\n`));
    return Promise.allSettled(writes);
  }

  /**
   * One session command (keeper: `runCommand(name, step, ctx)`, docs/handoff/WP5.md). Returns
   * `{ exit, lines, files, timing }` and never throws for a page problem: a failed step is
   * `FAIL <head> · <reason>` with exit 1; only a missing session, a refused `run` and a closed
   * engine answer differently.
   * @param {string} name session name
   * @param {Step} step the step as the parser built it (config shape)
   * @param {CommandContext} cmd
   * @param {string} [address] value address of the step (`argv.fill`, `script[3]`)
   * @returns {Promise<{ exit: number, lines: string[], files: string[], timing: { totalMs: number, stepMs: number } }>}
   */
  async function runCommand(name, step, cmd, address) {
    const started = now();
    if (isClosed()) throw new Error('engine closed');
    const canonical = resolveStepName(step.do) ?? String(step.do);
    const alias = cmd.alias ?? canonical;
    const def = STEPS[canonical];
    const head = headOf(alias, step);
    /** @type {Session | undefined} */
    let session = sessions.get(name);
    // Secrets are per SESSION (§2.6): a value filled from env three commands ago must still be
    // `***` in this command's `get --value`, `snap`, `eval`, journal and logs — so the redactor
    // reads the session's union, not the request's list.
    const secretsNow = () => (session ? [...session.secretValues] : (cmd.secretValues ?? []).filter((v) => v !== ''));
    const redactor = (/** @type {string} */ t) => {
      const own = redact(t, secretsNow());
      return cmd.redact ? cmd.redact(own) : own;
    };
    /** @param {number} exit @param {string[]} lines @param {string[]} [files] */
    const answer = (exit, lines, files = []) => ({
      exit,
      lines: lines.map(redactor),
      files,
      timing: { totalMs: ms(started), stepMs: 0 },
    });
    if (!def) return answer(2, [formatFail(head, `unknown command ${JSON.stringify(String(step.do))}`)]);

    if (!session) {
      if (canonical !== 'goto')
        return answer(1, [formatFail(head, `no open session "${name}" → browser-inspector open <url>`)]);
      session = await openSession(name, {
        cwd: cmd.cwd,
        out: cmd.out,
        video: step.video === true,
        secretValues: cmd.secretValues,
      });
    } else if (canonical === 'goto' && step.video === true && !session.videoDir) {
      return answer(1, [
        formatFail(
          head,
          'the session is not recording — browser-inspector close, then browser-inspector open <url> --video',
        ),
      ]);
    }
    if (canonical === 'run' && env.BROWSER_INSPECTOR_UNSAFE !== '1') {
      // Refused BEFORE anything runs, with exit 2: this is the one RCE-equivalent command (§2.6).
      return answer(2, [
        formatFail(head, 'refused: set BROWSER_INSPECTOR_UNSAFE=1 (the file runs inside the keeper — RCE-equivalent)'),
      ]);
    }
    for (const v of cmd.secretValues ?? []) if (typeof v === 'string' && v !== '') session.secretValues.add(v);

    const ctx = session.ctx;
    ctx.values = cmd.values ?? {};
    ctx.files = cmd.files ?? {};
    ctx.secretValues = [...session.secretValues];
    ctx.redact = (text) => redact(text, ctx.secretValues);
    ctx.cwd = cmd.cwd;
    ctx.address = address ?? `argv.${canonical}`;
    ctx.lines = [];
    ctx.written = [];
    ctx.capture.screenshots = [];
    ctx.capture.pending = [];
    ctx.capture.extracts = {};
    ctx.capture.verifications = [];
    ctx.unsafe = env.BROWSER_INSPECTOR_UNSAFE === '1';
    session.lastUsedAt = Date.now();
    session.commands += 1;
    session.resolving = {};
    const recorder = session.recorder;
    const before = {
      url: safeUrl(ctx.page),
      title: session.title,
      el: session.el,
      dom: session.dom,
      consoleErrors: errorCount(recorder),
      netFailed: recorder.failedTotal ?? 0,
      navigations: recorder.navigations,
      dialogs: recorder.dialogs.length,
      page: ctx.page,
    };

    const result = await runStep(ctx, step, session.commands);
    const stepMs = result.ms ?? 0;
    const stillOpen = sessions.get(name) === session;

    if (stillOpen) {
      // `tab new` / `tab <n>` / `tab close` moved `ctx.page`: the CDP session must follow it.
      if (ctx.page !== before.page) {
        await armSessionPage(session, ctx.page);
        ctx.cdp = /** @type {CdpLike} */ (session.cdps.get(ctx.page));
      }
      await Promise.allSettled(ctx.capture.pending ?? []);
    }

    /** @type {string[]} */
    let lines;
    /** @type {ReturnType<typeof formatDeltas>} */
    let deltas = [];
    let after = { url: before.url, title: before.title, el: before.el, dom: before.dom };
    if (stillOpen) {
      after = await probePage(session);
      const navigated = recorder.navigations > before.navigations && canonical !== 'tab';
      if (navigated) session.docs += recorder.navigations - before.navigations;
      if (canonical === 'goto' && !session.baseOrigin) session.baseOrigin = originOf(after.url) ?? undefined;
      deltas = formatDeltas(
        {
          url: before.url,
          title: before.title,
          el: before.el,
          consoleErrors: before.consoleErrors,
          netFailed: before.netFailed,
        },
        {
          url: after.url,
          title: after.title,
          // `el` only when it says something: after a navigation (a new count) or when it moved.
          el: canonical !== 'tab' && (navigated || after.el !== before.el) ? after.el : undefined,
          consoleErrors: errorCount(recorder),
          netFailed: recorder.failedTotal ?? 0,
          navigated,
          frameSeq: Math.max(1, session.docs - 1),
          domChanged: !navigated && after.dom !== before.dom,
          dialogs: /** @type {any[]} */ (recorder.dialogs.slice(before.dialogs)),
        },
        { baseOrigin: session.baseOrigin },
      );
    }

    if (!result.ok) {
      lines = [
        formatFail(
          head,
          result.error ?? 'failed',
          deltas.filter((d) => d.startsWith('dialog ')),
        ),
      ];
    } else if (canonical === 'goto') {
      // `open`: the snapshot files are written now (§4.1), so the next `find`/`click` has a map.
      let snapPath = '';
      try {
        const text = await withDeadline(
          ctx.page.ariaSnapshot({ mode: 'ai', boxes: true }),
          ctx.timeoutMs,
          'open snapshot',
        );
        ctx.lastSnapshot = { text, at: Date.now() };
        const md = await ctx.writeSnapshot(text, {});
        session.prevCompact = String(ctx.lastSnapshot?.compact ?? '')
          .split('\n')
          .filter((l) => l !== '');
        snapPath = relPath(path.join(session.dir, md), cmd.cwd);
      } catch (error) {
        log(`session ${name}: open snapshot failed: ${errorMessage(error)}`);
      }
      lines = [
        formatOpen({
          title: after.title ?? '',
          el: after.el,
          errors: Math.max(0, errorCount(recorder) - before.consoleErrors),
          snapPath,
        }),
      ];
    } else if (canonical === 'call') {
      // The runner leaves the tool's answer and the record file in `ctx.lines`; the deltas say what the
      // call did to the page (a navigation, a DOM change, a new console error).
      lines = [formatOk(head, [...ctx.lines, ...deltas])];
    } else if (canonical === 'screenshot') {
      const shot = ctx.lastShot;
      const file = shot ? relPath(path.join(session.dir, shot.file), cmd.cwd) : '';
      lines = [
        shot?.width !== undefined && shot?.height !== undefined
          ? formatShot(file, shot.width, shot.height)
          : formatOk(`${alias} ${file}`),
      ];
    } else if (canonical === 'pdf') {
      const file = ctx.written.find((f) => f.endsWith('.pdf'));
      lines = [formatOk(`${alias} ${file ? relPath(path.join(session.dir, file), cmd.cwd) : ''}`.trimEnd())];
    } else if (canonical === 'verify') {
      const verdict = ctx.capture.verifications.at(-1);
      lines = [verdict && !verdict.ok ? formatFail(head, `${verdict.detail ?? 'failed'} (soft)`) : formatOk(head)];
    } else if (typeof step.name === 'string' && ctx.capture.extracts[step.name]) {
      lines = [formatOk(head, [truncate(ctx.capture.extracts[step.name].value, 100)])];
    } else if (def.kind === 'query') {
      lines = ctx.lines.length > 0 ? [...ctx.lines] : [formatOk(head)];
    } else if (def.kind === 'action' || canonical === 'tab') {
      lines = [formatOk(head, deltas)];
    } else {
      lines =
        ctx.lines.length > 0
          ? [...ctx.lines]
          : [
              formatOk(
                head,
                deltas.filter((d) => d.startsWith('dialog ')),
              ),
            ];
    }
    lines = lines.map(redactor);

    // The journal: the step as parsed (never a resolved secret), the verdict, the selector the
    // action resolved for its ref(s) — what `browser-inspector export` replays tomorrow.
    /** @type {Record<string, string>} */
    const resolved = {};
    let selector;
    // A ref that lived in a child frame is recorded as such: the selector next to it is local to
    // that document, so `export` must refuse rather than write a step that replays somewhere else.
    let inFrame = false;
    for (const field of refFieldsOf(step, def)) {
      const ref = readRefPath(step, field);
      const found = typeof ref === 'string' ? session.resolving?.[ref] : undefined;
      if (found?.inFrame === true) inFrame = true;
      if (typeof found?.selector !== 'string') continue;
      if (field === 'ref') selector = found.selector;
      else resolved[field] = found.selector;
    }
    session.resolving = undefined;
    // The appends ride a per-session chain that the answer does not wait for (§6 budgets the
    // whole "writes" phase at 10 ms; a Defender scan on journal.jsonl must not sit in the agent's
    // stopwatch). Order is kept by the chain; `close` and `export` await it.
    session.journalSeq += 1;
    const journalLine = formatJournalLine(
      {
        seq: session.journalSeq,
        sid: session.sessionId,
        command: canonical,
        step,
        ok: result.ok,
        ms: stepMs,
        url: after.url,
        ...(after.title !== undefined ? { title: after.title } : {}),
        ...(selector !== undefined ? { selector } : {}),
        ...(Object.keys(resolved).length > 0 ? { resolved } : {}),
        ...(inFrame ? { inFrame: true } : {}),
        line: lines[0] ?? '',
        ...(result.ok ? {} : { error: result.error }),
      },
      ctx.secretValues,
    );
    const flushed = stillOpen ? flushLogs(session) : undefined;
    const target = session;
    session.writes = session.writes
      .then(async () => {
        await mkdir(target.dir, { recursive: true });
        await appendFile(journalPath(target.dir), journalLine, 'utf8');
        if (flushed) await flushed;
      })
      .catch((error) => log(`session ${name}: journal: ${errorMessage(error)}`));

    const files = [...ctx.written, ...ctx.capture.screenshots].map((f) => path.join(session.dir, f));
    return {
      exit: result.ok ? 0 : 1,
      lines,
      files,
      timing: { totalMs: ms(started), stepMs },
    };
  }

  /**
   * `fields[1].ref` / `ref` / `from` — the ref a `refFieldsOf` path points at.
   * @param {Step} step @param {string} fieldPath
   */
  function readRefPath(step, fieldPath) {
    const match = /^fields\[(\d+)\]\.ref$/u.exec(fieldPath);
    return match ? /** @type {any} */ (step.fields)?.[Number(match[1])]?.ref : step[fieldPath];
  }

  /**
   * `browser-inspector script <file>`: the lines of a session, one command each, run in one process. Values
   * arrive under `script[<line index>]` — split with the client's own `splitCommandLine`, so the
   * addresses agree (docs/handoff/WP5.md). Stops at the first FAIL like an `&&` chain would.
   * @param {string[]} lines every line of the file, comments included (indexes = addresses)
   * @param {CommandContext & { session?: string }} cmd
   */
  async function runScript(lines, cmd) {
    const name = cmd.session ?? 'default';
    /** @type {string[]} */
    const out = [];
    /** @type {string[]} */
    const files = [];
    let exit = 0;
    for (const [i, line] of lines.entries()) {
      if (isScriptComment(line)) continue;
      const argv = splitCommandLine(line);
      let parsed;
      try {
        parsed = parseSessionCommand(argv[0], argv.slice(1));
      } catch (error) {
        out.push(`FAIL script:${String(i + 1)} · ${errorMessage(error)}`);
        exit = error instanceof CliError ? error.exit : 2;
        break;
      }
      const result = await runCommand(
        name,
        /** @type {Step} */ (parsed.step),
        { ...cmd, alias: argv[0], command: parsed.name, options: parsed.options },
        `script[${String(i)}]`,
      );
      out.push(...result.lines);
      files.push(...result.files);
      const soft = parsed.options.soft === true && result.exit === 1;
      if (result.exit !== 0 && !soft) {
        exit = result.exit;
        break;
      }
    }
    return { exit, lines: out, files };
  }

  /**
   * `browser-inspector export <flow.json>`: the journal of a session → a batch config (WP4's `exportFlow`).
   * @param {string} name
   * @param {{ file: string, force?: boolean, cwd: string, out?: string, secretValues?: string[] }} opts
   */
  async function exportSession(name, opts) {
    const session = sessions.get(name);
    const dir = session?.dir ?? sessionDir(opts.out ?? path.resolve(opts.cwd, DEFAULT_OUTPUT_DIR), name);
    if (session) await session.writes.catch(() => undefined);
    const entries = readJournal(journalPath(dir));
    try {
      const secretValues = [...new Set([...(opts.secretValues ?? []), ...(session?.secretValues ?? [])])];
      const { config, count } = exportFlow(entries, { file: opts.file, secretValues });
      const written = writeFlowExport(opts.file, config, { force: opts.force === true });
      return { exit: 0, lines: [formatExport(count, relPath(written, opts.cwd))], files: [written] };
    } catch (error) {
      const exit = error instanceof ExportError ? error.exit : 2;
      return { exit, lines: [formatFail('export', errorMessage(error))], files: [] };
    }
  }

  return {
    sessions,
    runCommand,
    runScript,
    exportSession,
    openSession,
    endSession,
    /** Close every open session — the pool calls this before the browser goes away. */
    closeAll: async () => {
      // oxlint-disable-next-line unicorn/no-useless-spread -- a snapshot: endSession deletes from `sessions` and awaits, and a session opened during that await is not ours to close
      for (const name of [...sessions.keys()]) await endSession(name).catch(() => {});
    },
  };
}
