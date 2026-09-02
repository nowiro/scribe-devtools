// fake-engine.mjs — an engine with no browser, for the keeper/client tests (BROWSER_INSPECTOR_ENGINE_MODULE).
//
// It implements the interface from docs/handoff/WP5.md just far enough to observe the keeper:
// every call is appended as one JSON line to BROWSER_INSPECTOR_FAKE_LOG, `wait --ms N` really sleeps (queues and
// idle timers need a job that lasts), `goto` opens a session and `close` ends it, `click e404`
// fails like a dead ref, `runFlow` writes a report.json with the timing the keeper handed over
// and a journal that goes through the keeper's `redact` — so the secret tests can read what an
// engine would have written. `runFlow` returns the summary shape (`FlowResult`), not a full
// `Report`: the keeper synthesizes the manifest entry from `timing` and writes `_manifest.json`.
//
// Knobs (env): `BROWSER_INSPECTOR_FAKE_LAUNCH_MS` delays `ready`; `BROWSER_INSPECTOR_FAKE_LAUNCH_FAIL=1` makes `createEngine`
// reject like a missing Chrome (`E_BROWSER_MISSING` with the attempts list) and
// `BROWSER_INSPECTOR_FAKE_LAUNCH_FAIL_WHILE=<file>` only while that file exists — a Chrome busy with an
// update, fine again once the test removes the marker, which is the case a keeper that memoizes the
// failure can never recover from; `BROWSER_INSPECTOR_FAKE_SCRUB_MS`
// is how long the post-response `scrubIfDirty` takes (the next job on the lane waits for it).
import fs from 'node:fs';
import path from 'node:path';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** `createEngine` calls this process has seen — a test that expects a retry counts the attempts. */
let launchAttempts = 0;

/** The same signature as `src/engine.mjs`: one options object `{ browser, env, log, onDisconnected }`. */
export async function createEngine(options = {}) {
  const browserOpts = options.browser ?? {};
  const logPath = process.env.BROWSER_INSPECTOR_FAKE_LOG;
  const record = (entry) => {
    if (!logPath) return;
    fs.appendFileSync(logPath, `${JSON.stringify({ at: Date.now(), ...entry })}\n`);
  };
  launchAttempts += 1;
  const failWhile = process.env.BROWSER_INSPECTOR_FAKE_LAUNCH_FAIL_WHILE;
  if (process.env.BROWSER_INSPECTOR_FAKE_LAUNCH_FAIL === '1' || (failWhile !== undefined && fs.existsSync(failWhile))) {
    record({ event: 'launch-failed', attempt: launchAttempts });
    const error = new Error(
      'E_BROWSER_MISSING: no usable browser.\n  tried channel chrome: not found\n  tried channel msedge: not found\n' +
        'Install Google Chrome or Microsoft Edge, or point browser.executablePath / BROWSER_INSPECTOR_BROWSER_PATH at a Chromium binary.',
    );
    error.code = 'E_BROWSER_MISSING';
    throw error;
  }
  const sessions = new Map();
  let launches = 1;
  let jobs = 0;
  let rssSamples = 0;
  const listeners = new Map();
  const launchDelay = Number(process.env.BROWSER_INSPECTOR_FAKE_LAUNCH_MS ?? 0);
  const scrubMs = Number(process.env.BROWSER_INSPECTOR_FAKE_SCRUB_MS ?? 0);
  /** Lanes a `runFlow` left dirty — `scrubIfDirty` clears them, like the engine's. */
  const dirty = new Set();
  record({ event: 'launch', browserOpts, pid: process.pid });

  const waitMs = (steps) =>
    (steps ?? []).reduce((sum, s) => sum + (s && s.do === 'wait' && Number.isInteger(s.ms) ? s.ms : 0), 0);

  /** `parseSessionCommand` as far as the keeper tests need it: one script line → one step. */
  const scriptStep = (line) => {
    const [alias, ...rest] = line.trim().split(/\s+/u);
    if (alias === 'open') return { do: 'goto', url: rest[0] };
    if (alias === 'wait') return { do: 'wait', ms: Number(rest[0]) };
    if (alias === 'click') return { do: 'click', ref: rest[0] };
    if (alias === 'fill') return { do: 'fill', ref: rest[0], value: rest[1] };
    return { do: alias };
  };

  const journal = (ctx, name, entry) => {
    const dir = path.join(ctx.out, 'session', name);
    fs.mkdirSync(dir, { recursive: true });
    const text = ctx.redact ? ctx.redact(JSON.stringify(entry)) : JSON.stringify(entry);
    fs.appendFileSync(path.join(dir, 'journal.jsonl'), `${text}\n`);
    return path.join(dir, 'journal.jsonl');
  };

  const engine = {
    ready: launchDelay > 0 ? sleep(launchDelay) : Promise.resolve(),
    async runFlow(snapshot, dir, laneOpts) {
      jobs += 1;
      record({
        event: 'runFlow',
        name: snapshot.name,
        lane: laneOpts.lane,
        mode: laneOpts.mode,
        queuedMs: laneOpts.queuedMs,
        address: laneOpts.address,
        valueKeys: Object.keys(laneOpts.values ?? {}),
        fileKeys: Object.keys(laneOpts.files ?? {}),
        ...(laneOpts.storageState !== undefined ? { storageState: laneOpts.storageState } : {}),
      });
      const t0 = performance.now();
      await sleep(waitMs(snapshot.steps));
      fs.mkdirSync(dir, { recursive: true });
      const completed = !snapshot.name.includes('fail');
      const fresh = laneOpts.fresh === true || laneOpts.storageState !== undefined;
      if (!fresh) dirty.add(laneOpts.lane ?? 0);
      const report = {
        name: snapshot.name,
        completed,
        steps: [],
        skipped: 0,
        // The values echo goes through the keeper's redact, like a real report would.
        extracts: { echo: { value: laneOpts.redact(JSON.stringify(laneOpts.values ?? {})), truncated: false } },
        timing: {
          mode: laneOpts.mode,
          lane: laneOpts.lane,
          queuedMs: laneOpts.queuedMs,
          ctx: fresh ? 'fresh' : 'reused',
          tab: 'kept',
          totalMs: Math.round(performance.now() - t0),
        },
        engine: { 'browser-inspector': 'fake', browser: 'Fake/1' },
      };
      const file = path.join(dir, 'report.json');
      fs.writeFileSync(file, JSON.stringify(report, null, 2));
      return {
        completed,
        ms: Math.round(performance.now() - t0),
        files: [file],
        timing: report.timing,
        ...(completed ? {} : { failure: 'step 1 failed on purpose' }),
      };
    },
    async scrubIfDirty(lane) {
      if (!dirty.has(lane)) return { ms: 0, plan: [] };
      dirty.delete(lane);
      if (scrubMs > 0) await sleep(scrubMs);
      // Logged when DONE: a test that waits for the event knows the lane queue is empty again.
      record({ event: 'scrub', lane, ms: scrubMs });
      return { ms: scrubMs, plan: [{ op: 'fake' }] };
    },
    async runCommand(name, step, ctx) {
      jobs += 1;
      record({
        event: 'runCommand',
        session: name,
        do: step.do,
        mode: ctx.mode,
        queuedMs: ctx.queuedMs,
        valueKeys: Object.keys(ctx.values ?? {}),
        fileKeys: Object.keys(ctx.files ?? {}),
        out: ctx.out,
      });
      if (step.do === 'goto') sessions.set(name, { name, url: step.url, openedAt: Date.now() });
      journal(ctx, name, { step, values: ctx.values ?? {} });
      if (step.do === 'wait' && Number.isInteger(step.ms)) await sleep(step.ms);
      if (step.do === 'close') {
        sessions.delete(name);
        return { exit: 0, lines: ['ok close'], files: [] };
      }
      if (step.do === 'click' && step.ref === 'e404') {
        return { exit: 1, lines: ['FAIL click e404 · ref not found (gone, label changed or other frame) → browser-inspector snap'] };
      }
      if (step.do === 'fill') {
        const value = ctx.values[`argv.fill.value`] ?? step.value ?? '';
        const open = sessions.get(name);
        if (open) open.filled = value;
        return { exit: 0, lines: [`ok fill ${step.ref ?? step.selector} (${String(value.length)} chars)`], files: [] };
      }
      if (step.do === 'extract') {
        // Echoes what an earlier `fill` put in — the keeper must redact it from the session's
        // union of secrets, not from this request's (empty) list.
        return { exit: 0, lines: [`ok get ${step.ref ?? step.selector} · ${String(sessions.get(name)?.filled ?? '')}`] };
      }
      return { exit: 0, lines: [`ok ${step.do}${step.url ? ` "${step.url}"` : ''} · session ${name}`], files: [] };
    },
    async runScript(lines, ctx) {
      record({ event: 'runScript', lines: lines.length, mode: ctx.mode, valueKeys: Object.keys(ctx.values ?? {}) });
      const name = ctx.session ?? 'default';
      const out = [];
      const files = [];
      let exit = 0;
      // Every line goes through `runCommand`, like `session.mjs` does: a script that says `open`
      // really opens the engine's session and one that says `close` really ends it. A fake that only
      // echoed the lines could not tell a keeper that registers the script's session from one that
      // does not.
      for (const line of lines) {
        if (line.trim() === '' || line.trim().startsWith('#')) continue;
        const result = await engine.runCommand(name, scriptStep(line), ctx);
        out.push(...result.lines);
        files.push(...(result.files ?? []));
        if (result.exit !== 0) {
          exit = result.exit;
          break;
        }
      }
      return { exit, lines: out, files };
    },
    async exportFlow(name, opts) {
      record({ event: 'exportFlow', session: name, file: opts.file, force: opts.force });
      if (fs.existsSync(opts.file) && !opts.force) return { exit: 1, lines: [`FAIL export ${opts.file} exists (--force)`] };
      fs.mkdirSync(path.dirname(opts.file), { recursive: true });
      fs.writeFileSync(opts.file, JSON.stringify({ snapshots: [] }));
      return { exit: 0, lines: [`ok export 0 steps → ${opts.file}`], files: [opts.file] };
    },
    session: (name) => sessions.get(name),
    sessions: () => [...sessions.values()],
    closeSession(name) {
      record({ event: 'closeSession', session: name });
      sessions.delete(name);
    },
    status: () => ({
      launches,
      jobs,
      lanes: [{ index: 0, busy: false, dirty: dirty.has(0) }],
      routes: 0,
      browser: 'Fake/1',
      browserRssMb: Number(process.env.BROWSER_INSPECTOR_FAKE_RSS_MB ?? 0),
      rssSamples,
      pwVersion: 'fake',
    }),
    async sampleRss() {
      rssSamples += 1;
      record({ event: 'sampleRss', jobs });
      return Number(process.env.BROWSER_INSPECTOR_FAKE_RSS_MB ?? 0);
    },
    async recycle() {
      launches += 1;
      record({ event: 'recycle', launches, sessions: sessions.size });
    },
    async close() {
      record({ event: 'close', jobs });
    },
    on(event, cb) {
      listeners.set(event, cb);
    },
    emit(event, ...args) {
      listeners.get(event)?.(...args);
    },
  };
  return engine;
}
