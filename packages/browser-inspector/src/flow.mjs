// flow.mjs — the batch half of the engine (DESIGN.md §2.2, §5, §6).
//
// `runFlow` is one snapshot end to end: the lane (or a fresh context), the navigation, the steps
// under a deadline, the final evidence, `report.json`/`report.md` and the manifest on disk.
// `runBatch` is every snapshot of a config over `parallel` lanes in one process (the `--no-daemon`
// path; the keeper has its own queue per lane and calls `runFlow` + `finishRun` itself), and
// `finishRun` writes what a run leaves behind after its snapshots: `_manifest.json` and `--junit`.
//
// Separate from `engine.mjs`: everything here is composed of the lane pool (`lanes.mjs`) and the
// step context (`steps.ctx.mjs`), and owns no state of its own — which is why a failing page is a
// result and never an exception (only `E_BROWSER_MISSING` and a closed engine escape).

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { ensureSession, resolveAuthValues, storageStateFor } from './auth.mjs';
import { finalEvidence } from './capture.mjs';
import { withDeadline } from './deadline.mjs';
import { DEFAULT_VIEWPORT, needsFreshContext } from './isolation.mjs';
import { DEFAULT_TIMEOUT_MS } from './lanes.mjs';
import { attachRecorder, errorMessage, summarize } from './recorder.mjs';
import { buildManifest, buildReport, formatStepError, renderJUnit, writeArtifacts } from './report.mjs';
import { makeStepContext, navigate, runStep } from './steps.ctx.mjs';
import { RUNNERS } from './steps.run.mjs';
import { resolveStepName } from './steps.schema.mjs';

/** @typedef {import('./types.js').CdpLike} CdpLike */
/** @typedef {import('./types.js').Step} Step */
/** @typedef {import('./types.js').StepResult} StepResult */
/** @typedef {import('./types.js').Report} Report */
/** @typedef {import('./types.js').Timing} Timing */
/** @typedef {import('./types.js').TimingMode} TimingMode */
/** @typedef {import('./lanes.mjs').Lane} Lane */
/** @typedef {import('./lanes.mjs').LanePool} LanePool */

const now = () => performance.now();
const ms = (/** @type {number} */ from) => Math.round(now() - from);

/** `snapshots[3]` → 3; anything else → undefined. */
const indexFromAddress = (/** @type {unknown} */ address) => {
  const match = typeof address === 'string' ? /^snapshots\[(\d+)\]$/u.exec(address) : null;
  return match ? Number(match[1]) : undefined;
};

/**
 * @typedef {object} LaneOptions
 * @property {number} [lane] lane index (default 0)
 * @property {boolean} [fresh] `--fresh`
 * @property {TimingMode} [mode]
 * @property {number} [queuedMs]
 * @property {number} [snapshotIndex] for value addresses `snapshots[i].steps[j]`
 * @property {string} [address] the keeper's spelling of the same: `snapshots[i]`
 * @property {Record<string, string>} [values]
 * @property {string[]} [secretValues]
 * @property {Record<string, { path?: string, base64?: string, size: number }>} [files]
 * @property {string} [cwd]
 * @property {string} [stamp] the run stamp — goes into `_manifest.json`
 * @property {string} [storageState] session file for a fresh context (auth)
 * @property {unknown} [auth] the config-level auth block, for `needsFreshContext`
 * @property {Record<string, any>} [config] the whole normalized config (the keeper sends it; `auth` is read from it)
 * @property {(line: string) => void} [log]
 */

/**
 * @typedef {object} FlowResult
 * @property {string} name
 * @property {string} dir
 * @property {boolean} completed
 * @property {number} ms
 * @property {string[]} files absolute paths written
 * @property {Timing} timing
 * @property {string} [failure]
 * @property {Report} report
 */

/**
 * @param {{
 *   pool: LanePool,
 *   versions: Record<string, string>,
 *   env: NodeJS.ProcessEnv,
 *   log: (line: string) => void,
 *   isClosed: () => boolean,
 *   getEngine: () => any,
 * }} input the engine passes itself as `getEngine` — `auth` runs its login on the same engine
 */
export function createFlowRunner(input) {
  const { pool, versions, env, log, isClosed, getEngine } = input;

  // ── runFlow ────────────────────────────────────────────────────────────────

  /**
   * One snapshot (`type: page` or `flow`) → report.json/md, elements.md, text.txt, the screenshots
   * and `_manifest.json` in `dir` (DESIGN.md §5), and the keeper's `FlowResult`. Never throws for a
   * failing page — a failed step or navigation is a result; only `E_BROWSER_MISSING` and a closed
   * engine escape.
   * @param {Record<string, any>} snapshot a normalized snapshot config
   * @param {string} dir the snapshot's output directory
   * @param {LaneOptions} [laneOpts]
   * @returns {Promise<FlowResult>}
   */
  async function runFlow(snapshot, dir, laneOpts = {}) {
    const started = now();
    const startedAt = new Date().toISOString();
    if (isClosed()) throw new Error('engine closed');
    const launchedNow = await pool.ensureBrowser();
    await mkdir(dir, { recursive: true });
    const mode = laneOpts.mode ?? (launchedNow || pool.jobsSinceLaunch === 0 ? 'first' : 'warm');
    const auth = laneOpts.auth ?? laneOpts.config?.auth;
    const fresh = needsFreshContext(snapshot, { fresh: laneOpts.fresh, auth });
    const viewport = snapshot.viewport ?? DEFAULT_VIEWPORT;
    const snapshotIndex = laneOpts.snapshotIndex ?? indexFromAddress(laneOpts.address) ?? 0;

    /** @type {Lane} */
    let lane;
    let scrubMs = 0;
    let videoDir;
    if (fresh) {
      if (snapshot.video === true) videoDir = path.join(dir, '.video');
      const pair = await pool.freshContext({
        viewport,
        storageState: laneOpts.storageState ?? snapshot.storageState,
        video: videoDir,
      });
      lane = {
        index: laneOpts.lane ?? 0,
        context: pair.context,
        page: pair.page,
        cdp: /** @type {CdpLike} */ ({ send: async () => undefined }),
        recorder: attachRecorder(pair.page),
        generation: 0,
        genScriptId: undefined,
        dirty: false,
        busy: true,
        lastUsedAt: Date.now(),
        tab: 'new',
        jobs: 0,
        scrubErrors: [],
        fresh: true,
      };
      lane.cdp = await pair.context.newCDPSession(pair.page);
      await lane.cdp.send('Network.clearBrowserCache').catch(() => {});
    } else {
      lane = await pool.getLane(laneOpts.lane ?? 0);
      lane.busy = true;
      // Normally clean already: the keeper scrubs in the lane queue right after the previous
      // answer (the wait shows as `queuedMs`). This is the safety net — and the in-process
      // `runBatch` path, where the scrub between snapshots is legitimately in the stopwatch (§6).
      if (lane.dirty) scrubMs = (await pool.scrub(lane)).ms;
      const current = lane.page.viewportSize?.();
      if (!current || current.width !== viewport.width || current.height !== viewport.height) {
        await lane.page.setViewportSize(viewport);
      }
    }
    const recorder = lane.recorder;
    recorder.reset();
    recorder.captureBodies = snapshot.captureBodies !== false;
    recorder.dialogPolicy = { action: snapshot.dialogs === 'accept' ? 'accept' : 'dismiss' };
    const tab = lane.tab;
    lane.tab = 'kept';

    const ctx = makeStepContext({
      page: lane.page,
      context: lane.context,
      cdp: lane.cdp,
      recorder,
      dir,
      timeoutMs: snapshot.stepTimeoutMs ?? 10_000,
      mode: 'batch',
      snapshot,
      values: laneOpts.values,
      secretValues: laneOpts.secretValues,
      files: laneOpts.files,
      cwd: laneOpts.cwd,
      laneTab: lane.page,
      snapshotIndex,
    });
    const base = laneOpts.address ?? `snapshots[${String(snapshotIndex)}]`;

    /** @type {StepResult[]} */
    const steps = [];
    let completed = true;
    /** @type {string | undefined} */
    let navigationError;
    let stepsMs = 0;
    let lastStepWasScreenshot = false;
    /** @type {Record<string, string>} */
    const files = {};

    for (const [k, route] of (snapshot.routes ?? []).entries()) {
      ctx.address = `${base}.routes[${String(k)}]`;
      try {
        await RUNNERS.route(ctx, { do: 'route', ...route });
      } catch (error) {
        log(`route ${String(route.url)}: ${errorMessage(error)}`);
      }
    }
    if (snapshot.trace === true) {
      await lane.context.tracing?.start({ screenshots: true, snapshots: true }).catch(() => {});
    }

    const navStarted = now();
    try {
      await navigate(ctx, snapshot.url, snapshot.waitUntil, snapshot.navTimeoutMs ?? DEFAULT_TIMEOUT_MS);
      // The run's history starts HERE: `back` must never reach the previous run's document, which
      // is still the entry before this one on a reused tab (2 ms; a fresh tab has nothing behind).
      if (!fresh) await lane.cdp.send('Page.resetNavigationHistory').catch(() => {});
    } catch (error) {
      navigationError = errorMessage(error);
      completed = false;
    }
    const gotoMs = ms(navStarted);

    const stepList = /** @type {Step[]} */ (snapshot.type === 'flow' ? (snapshot.steps ?? []) : []);
    if (navigationError === undefined) {
      const stepsStarted = now();
      for (const [j, step] of stepList.entries()) {
        ctx.address = `${base}.steps[${String(j)}]`;
        const result = await runStep(ctx, step, j);
        steps.push(result);
        if (!result.ok) {
          // Stop at the first failure: later steps assume the state this one was meant to produce.
          completed = false;
          break;
        }
        lastStepWasScreenshot = resolveStepName(step.do) === 'screenshot';
      }
      stepsMs = ms(stepsStarted);
    }

    if (snapshot.trace === true) {
      await lane.context.tracing
        ?.stop({ path: path.join(dir, 'trace.zip') })
        .then(() => {
          files.trace = 'trace.zip';
        })
        .catch(() => {});
    }

    const captureStarted = now();
    const evidence = await finalEvidence(ctx, snapshot, { dir, completed, lastStepWasScreenshot });
    if (snapshot.captureSnapshot === true && !ctx.lastSnapshot) {
      try {
        const text = await withDeadline(ctx.page.ariaSnapshot({ mode: 'ai', boxes: true }), 5000, 'snapshot');
        await ctx.writeSnapshot(text, {});
      } catch {
        // A page that cannot be snapshotted still gets its report.
      }
    }
    const captureMs = ms(captureStarted);

    // The queued screenshot writes and the recorder's body reads are the `writeMs` of §6; the
    // report files themselves land after the timing is known (a few ms, unmeasured on purpose).
    // Split in two, because the sum alone cannot say which half to attack: `shotsMs` is the tail of
    // `saveScreenshot` (disk), `settleMs` is `Network.getResponseBody` for the bodies the recorder
    // still owes (a POST that answered late leaves its whole tail here).
    const writeStarted = now();
    await Promise.allSettled([...(ctx.capture.pending ?? []), ...evidence.pending]);
    const shotsMs = ms(writeStarted);
    const settleStarted = now();
    await recorder.settle();
    const settleMs = ms(settleStarted);
    const writeMs = ms(writeStarted);

    const screenshots = [...ctx.capture.screenshots, ...(evidence.screenshot ? [evidence.screenshot] : [])];
    // `report.json.files` maps a kind to a file (WP4): `snapshot` / `snapshot-<name>` → the compact
    // `snap*.md` (the sidecar and the raw YAML sit next to it), `pdf-<name>` → the pdf.
    for (const rel of ctx.written) {
      const snap = /^snap(?:-([a-z0-9-]+))?\.md$/u.exec(rel);
      if (snap) files[snap[1] ? `snapshot-${snap[1]}` : 'snapshot'] = rel;
      else if (rel.endsWith('.pdf')) files[`pdf-${rel.slice(0, -4)}`] = rel;
    }
    const summary = summarize(recorder);
    const lastShot =
      lastStepWasScreenshot && completed && !evidence.screenshot ? ctx.capture.screenshots.at(-1) : undefined;

    /** @type {Timing} */
    const timing = {
      mode,
      ctx: fresh ? 'fresh' : 'reused',
      tab,
      lane: lane.index,
      queuedMs: laneOpts.queuedMs ?? 0,
      scrubMs,
      gotoMs,
      stepsMs,
      captureMs,
      writeMs,
      shotsMs,
      settleMs,
      totalMs: ms(started),
      // From the page's Resource Timing API, collected inside `finalEvidence` (`capture.mjs`), not
      // from the recorder: `response.fromCache()` does not exist in playwright-core 1.62.1, so the
      // previous counter reported 0 for every run ever measured — the call threw and the guard
      // swallowed it. Counted per document, which is the question the number answers.
      cacheHits: evidence.cache?.hits ?? 0,
      cacheHitsDocument: evidence.cache?.document ?? 0,
    };

    const built = buildReport({
      name: snapshot.name,
      startUrl: snapshot.url,
      finalUrl: evidence.finalUrl || snapshot.url,
      ...(evidence.title !== undefined ? { title: evidence.title } : {}),
      completed,
      ...(navigationError !== undefined ? { navigationError } : {}),
      steps,
      skipped: stepList.length - steps.length,
      extracts: ctx.capture.extracts,
      verifications: ctx.capture.verifications,
      console: recorder.console,
      consoleTotal: recorder.consoleTotal,
      pageErrors: recorder.pageErrors,
      network: snapshot.captureNetwork === false ? [] : recorder.network,
      networkTotal: snapshot.captureNetwork === false ? 0 : recorder.networkTotal,
      dialogs: summary.dialogs,
      tabs: summary.tabs,
      screenshots,
      text: evidence.text.content,
      elements: evidence.elements?.entries ?? [],
      elementsTotal: evidence.elements?.total ?? 0,
      captureElements: snapshot.captureElements !== false,
      timing,
      engine: {
        'browser-inspector': versions['browser-inspector'],
        'playwright-core': versions['playwright-core'],
        browser: pool.browserLabel(),
        flags: pool.flags,
        motion: pool.motion,
        serviceWorkers: fresh ? 'allow' : 'block',
        generation: lane.generation,
      },
      ...(lastShot ? { final: lastShot } : {}),
      ...(!fresh && recorder.serviceWorkerSeen ? { serviceWorkerBlocked: true } : {}),
      files,
    });
    const report = /** @type {Report} */ (built.report);

    pool.noteJob(lane);
    lane.busy = false;
    if (fresh) {
      const video = snapshot.video === true ? lane.page.video?.() : undefined;
      await lane.context.close().catch(() => {});
      if (video) {
        await video
          .saveAs(path.join(dir, 'video.webm'))
          .then(() => video.delete().catch(() => {}))
          .then(() => {
            report.files.video = 'video.webm';
          })
          .catch(() => {});
      }
    } else {
      lane.dirty = true;
      void pool.reapIdleLanes();
    }

    const { written } = await writeArtifacts(dir, report, built.files, {
      render: snapshot.render,
      redact: ctx.redact,
      manifest: {
        type: snapshot.type === 'page' ? 'page' : 'flow',
        url: snapshot.url,
        stamp: laneOpts.stamp,
        version: versions['browser-inspector'],
        startedAt,
        render: snapshot.render,
      },
    });
    const failed = report.steps.find((s) => !s.ok);
    const failure =
      report.navigationError !== undefined
        ? report.navigationError
        : failed
          ? `step ${String(failed.index + 1)} "${failed.description}" — ${failed.error ?? 'failed'}`
          : undefined;
    return {
      name: snapshot.name,
      dir,
      completed: report.completed,
      ms: ms(started),
      files: [...written, ...screenshots, ...ctx.written].map((rel) => path.join(dir, rel)),
      timing,
      ...(failure !== undefined ? { failure } : {}),
      report,
    };
  }

  /**
   * After every snapshot of a run: `<runDir>/_manifest.json` (and `--junit`). The keeper calls it
   * with the flow results; `runBatch` below does the same in-process.
   * @param {{
   *   runDir: string, stamp: string, configPath?: string, config?: Record<string, any>, cwd?: string,
   *   options?: { junit?: string, [k: string]: any }, results: (Partial<FlowResult> & { name: string, dir: string })[],
   *   mode: TimingMode, totalMs?: number, startedAt?: string,
   * }} run
   * @returns {Promise<{ files: string[], manifest: import('./types.js').Manifest }>}
   */
  async function finishRun(run) {
    const configPath = run.configPath ?? run.config?.configPath ?? '';
    const results = run.results.map((r) => ({ name: r.name, dir: r.dir, report: r.report ?? stubReport(r) }));
    const manifest = buildManifest(
      {
        stamp: run.stamp,
        config: configPath,
        version: versions['browser-inspector'],
        ...(run.startedAt ? { startedAt: run.startedAt } : {}),
        timing: { mode: run.mode, launchMs: pool.launchMs, clientMs: run.totalMs ?? 0 },
      },
      results,
    );
    await mkdir(run.runDir, { recursive: true });
    const manifestFile = path.join(run.runDir, '_manifest.json');
    await writeFile(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    const files = [manifestFile];
    if (typeof run.options?.junit === 'string' && run.options.junit !== '') {
      const junitFile = path.resolve(run.cwd ?? process.cwd(), run.options.junit);
      await mkdir(path.dirname(junitFile), { recursive: true });
      await writeFile(
        junitFile,
        renderJUnit(path.basename(configPath || 'browser-inspector'), manifest.snapshots),
        'utf8',
      );
      files.push(junitFile);
    }
    return { files, manifest };
  }

  /**
   * A report-shaped stand-in for a flow whose `runFlow` threw (browser gone mid-run): the manifest
   * still lists the snapshot as incomplete with the reason.
   * @param {Partial<FlowResult> & { name: string }} r
   * @returns {Report}
   */
  function stubReport(r) {
    /** @type {Timing} */
    const timing = {
      mode: 'no-daemon',
      ctx: 'reused',
      tab: 'kept',
      lane: 0,
      queuedMs: 0,
      scrubMs: 0,
      gotoMs: 0,
      stepsMs: 0,
      captureMs: 0,
      writeMs: 0,
      totalMs: r.ms ?? 0,
      cacheHits: 0,
      cacheHitsDocument: 0,
      ...(r.timing ?? {}),
    };
    return {
      name: r.name,
      startUrl: '',
      finalUrl: '',
      completed: false,
      navigationError: formatStepError(r.failure ?? 'engine failure'),
      steps: [],
      skipped: 0,
      extracts: {},
      verifications: [],
      console: { entries: [], total: 0, truncated: false },
      pageErrors: [],
      network: { total: 0, failed: [] },
      failedRequests: { entries: [], truncated: false },
      dialogs: [],
      tabs: [],
      screenshots: [],
      text: { content: '', truncated: false },
      files: {},
      timing,
      engine: {
        'browser-inspector': versions['browser-inspector'],
        'playwright-core': versions['playwright-core'],
        browser: pool.browserLabel(),
        flags: pool.flags,
        motion: pool.motion,
        serviceWorkers: 'block',
        generation: 0,
      },
    };
  }

  /**
   * Every snapshot of a config over `parallel` lanes, in-process (the keeper has its own queue per
   * lane and calls `runFlow` + `finishRun` itself). Lanes pull the next snapshot in config order, so
   * `parallel: 3` on six flows costs ≈ max(lane), not sum(flow). Results come back in config order;
   * `onSnapshot` fires as each one finishes.
   * @param {Record<string, any>} config a normalized config (`loadConfig`)
   * @param {{
   *   stamp: string, outputDir?: string, only?: string[], parallel?: number, fresh?: boolean, mode?: TimingMode,
   *   values?: Record<string, string>, secretValues?: string[], files?: Record<string, any>, cwd?: string,
   *   storageState?: string, junit?: string, onSnapshot?: (result: FlowResult & { index: number }) => void | Promise<void>,
   * }} options
   */
  async function runBatch(config, options) {
    const started = now();
    const startedAt = new Date().toISOString();
    const outputDir = options.outputDir ?? config.outputDir;
    const runDir = path.join(outputDir, options.stamp);
    const wanted = /** @type {any[]} */ (config.snapshots).filter(
      (s) => !options.only || options.only.length === 0 || options.only.includes(s.name),
    );
    const laneCount = Math.max(1, Math.min(options.parallel ?? config.parallel ?? 1, wanted.length));
    /** @type {(FlowResult & { index: number })[]} */
    const results = [];
    await pool.ensureBrowser();
    // `auth`: log in ONCE before the lanes (or reuse the state file), then every snapshot that did
    // not opt out (`auth: false`) starts from that state. A direct engine caller may not have
    // resolved the `*FromEnv` values — `env` is the fallback here, never in the keeper (§2.4).
    let secretValues = options.secretValues ?? [];
    /** @type {import('./auth.mjs').SessionInfo | undefined} */
    let authSession;
    if (config.auth && !options.storageState) {
      const resolved = resolveAuthValues(config.auth, { values: options.values, env });
      secretValues = [...new Set([...secretValues, ...resolved.secretValues])];
      authSession = await ensureSession(config.auth, {
        engine: getEngine(),
        baseDir: path.dirname(config.configPath ?? path.resolve(options.cwd ?? process.cwd(), 'read.config.json')),
        values: options.values,
        secretValues,
        env,
        log,
      });
    }
    let next = 0;
    const worker = async (/** @type {number} */ laneIndex) => {
      for (;;) {
        const i = next;
        if (i >= wanted.length) return;
        next += 1;
        const snapshot = wanted[i];
        const dir = path.join(runDir, snapshot.name);
        const flow = await runFlow(snapshot, dir, {
          lane: laneIndex,
          fresh: options.fresh,
          mode: options.mode,
          snapshotIndex: config.snapshots.indexOf(snapshot),
          values: options.values,
          secretValues,
          files: options.files,
          cwd: options.cwd,
          stamp: options.stamp,
          storageState: options.storageState ?? storageStateFor(snapshot, authSession),
          auth: config.auth,
        });
        const result = { ...flow, index: i };
        results[i] = result;
        await options.onSnapshot?.(result);
      }
    };
    await Promise.all(Array.from({ length: laneCount }, (_, k) => worker(k)));
    const totalMs = ms(started);
    const finished = await finishRun({
      runDir,
      stamp: options.stamp,
      configPath: config.configPath,
      config,
      cwd: options.cwd,
      options: { junit: options.junit },
      results,
      mode: options.mode ?? (pool.launches > 0 && pool.jobs === results.length ? 'first' : 'warm'),
      totalMs,
      startedAt,
    });
    return {
      stamp: options.stamp,
      runDir,
      snapshots: results,
      manifest: finished.manifest,
      files: finished.files,
      timing: { mode: finished.manifest.timing.mode, launchMs: pool.launchMs, totalMs },
    };
  }

  return { runFlow, finishRun, runBatch };
}
