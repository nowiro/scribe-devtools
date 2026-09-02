#!/usr/bin/env node
// bench.mjs — the orchestration: one task (bench/task.mjs), every `bi` variant of DESIGN.md §9 as
// real processes (bi-run.mjs), three MCP variants (mcp-run.mjs), the same 300 ms gap on both
// sides, medians + p90, the correctness gate on every variant, and the generated files:
// RAPORT.md, WYNIKI.md, BUDGET.md, bench/out/results.json and the BENCH:START/END block of the
// root README. Nothing in those files is typed by hand.
//
//   npm run bench [-- --only bi|mcp] [--reps 3] [--warm 10] [--assert-speedup 5] [--skip-app-factory]
//
// `--only` writes `.partial` files — half a measurement must not silently replace the committed
// reports. `--assert-speedup N` exits 1 when the MEDIAN of `bi-warm` is not at least N× faster
// than the median of MCP naive warm (opt-in, not part of `npm run verify`).
//
// Ports: 4300 (the form) and 4311–4314 (app-factory builds). The app-factory smoke gate uses the
// same ports, so the bench takes `docs/handoff/ports.lock` for its duration and waits for a live
// holder before starting.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  APP_FACTORY_APPS,
  COMMAND_PNPM,
  appFactoryFixture,
  batchTokens,
  benchEnv,
  keeperSurvivesShell,
  prepareAppFactoryConfig,
  prepareBatchConfig,
  runAppFactory,
  runBatch,
  runInteractive,
  stopKeeper,
  timeCold,
  timeFirst,
  timeWarm,
} from './bi-run.mjs';
import { renderBudget } from './budget.mjs';
import { mcpVersion, runVariant, timeVariant } from './mcp-run.mjs';
import { renderRaport, renderReadmeBlock, renderWyniki } from './raport.mjs';
import { APP_PORT, serveStatic, startServer } from './serve.mjs';
import { checkFindings } from './task.mjs';
import { REPO, isAlive, makeStamp, sleep, stats } from './time-run.mjs';
import { measure } from './tokens.mjs';

const BENCH_DIR = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(BENCH_DIR, 'out');
const LOCK = path.join(REPO, 'docs', 'handoff', 'ports.lock');

/** How many sessions a day the fixed-cost projection assumes. A parameter, not revealed truth. */
export const SESSIONS_PER_DAY = 10;
export const WORKDAYS = 22;

/**
 * @param {string} name
 * @param {string | undefined} fallback
 */
function flag(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}
const has = (/** @type {string} */ name) => process.argv.includes(`--${name}`);

/**
 * `docs/handoff/ports.lock`: `{ pid, ports, since, what }`. A live holder makes the bench wait
 * (up to 10 minutes); a dead holder is stale and taken over.
 * @param {string[]} ports
 */
async function takePortsLock(ports) {
  fs.mkdirSync(path.dirname(LOCK), { recursive: true });
  const deadline = Date.now() + 10 * 60_000;
  for (;;) {
    let holder;
    try {
      holder = JSON.parse(fs.readFileSync(LOCK, 'utf8'));
    } catch {
      holder = undefined;
    }
    if (!holder || !isAlive(Number(holder.pid)) || Number(holder.pid) === process.pid) break;
    if (Date.now() > deadline)
      throw new Error(
        `ports ${ports.join(', ')} held by pid ${String(holder.pid)} (${String(holder.what)}) for 10 min — aborting`,
      );
    process.stdout.write(`[bench] waiting: ports held by pid ${String(holder.pid)} (${String(holder.what)})\n`);
    await sleep(5000);
  }
  fs.writeFileSync(
    LOCK,
    `${JSON.stringify({ pid: process.pid, ports, since: new Date().toISOString(), what: 'bench/bench.mjs' }, null, 2)}\n`,
    'utf8',
  );
  return () => {
    try {
      const holder = JSON.parse(fs.readFileSync(LOCK, 'utf8'));
      if (Number(holder.pid) === process.pid) fs.rmSync(LOCK, { force: true });
    } catch {
      // Already gone.
    }
  };
}

/** @param {string} text */
const log = (text) => process.stdout.write(`[bench] ${text}\n`);

async function main() {
  const only = flag('only', undefined);
  if (only !== undefined && !['bi', 'mcp'].includes(only)) throw new Error(`--only: "bi" or "mcp", not "${only}"`);
  const REPS = Number(flag('reps', '3'));
  const WARM = Number(flag('warm', '10'));
  if (!Number.isInteger(REPS) || REPS < 1)
    throw new Error(`--reps: a positive integer, not "${String(flag('reps', '3'))}"`);
  if (!Number.isInteger(WARM) || WARM < 1)
    throw new Error(`--warm: a positive integer, not "${String(flag('warm', '10'))}"`);
  const assertSpeedup = flag('assert-speedup', undefined);
  const skipAppFactory = has('skip-app-factory');

  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  const fixture = skipAppFactory || only === 'mcp' ? undefined : appFactoryFixture();
  const ports = [String(APP_PORT), ...(fixture ? APP_FACTORY_APPS.map((a) => String(a.port)) : [])];
  const releaseLock = await takePortsLock(ports);
  const servers = [await startServer()];
  if (fixture) for (const app of fixture.roots) servers.push(await serveStatic(app.root, app.port));
  log(`serving ${servers.map((s) => s.url).join(', ')}`);

  /** @type {any} */
  const results = {
    meta: {
      date: new Date().toISOString(),
      node: process.versions.node,
      os: {
        platform: process.platform,
        release: os.release(),
        cpu: os.cpus()[0]?.model?.trim() ?? '',
        cores: os.cpus().length,
        memGb: Math.round(os.totalmem() / 2 ** 30),
      },
      versions: { mcp: mcpVersion() },
      reps: REPS,
      warmN: WARM,
      only: only ?? null,
    },
    bi: {},
    mcp: {},
  };
  try {
    if (only !== 'mcp') results.bi = await measureBi({ REPS, WARM, fixture });
    if (only !== 'bi') results.mcp = await measureMcp({ WARM });
  } finally {
    for (const s of servers) await s.close();
    releaseLock();
  }
  results.meta.versions.bi = results.bi?.batchSample?.engine?.bi ?? results.bi?.versions?.bi;
  results.meta.versions.playwrightCore = results.bi?.batchSample?.engine?.['playwright-core'];
  results.meta.versions.browser = results.bi?.batchSample?.engine?.browser;

  fs.writeFileSync(path.join(OUT, 'results.json'), `${JSON.stringify(results, null, 2)}\n`, 'utf8');
  const suffix = only ? '.partial' : '';
  fs.writeFileSync(path.join(BENCH_DIR, `WYNIKI${suffix}.md`), renderWyniki(results), 'utf8');
  fs.writeFileSync(path.join(BENCH_DIR, `RAPORT${suffix}.md`), renderRaport(results), 'utf8');
  fs.writeFileSync(path.join(BENCH_DIR, `BUDGET${suffix}.md`), renderBudget(results), 'utf8');
  if (!only) updateReadme(path.join(REPO, 'README.md'), renderReadmeBlock(results));
  log(
    `done → bench/WYNIKI${suffix}.md, bench/RAPORT${suffix}.md, bench/BUDGET${suffix}.md${only ? '' : ', README.md (BENCH block)'}, bench/out/results.json`,
  );

  const warm = results.bi?.warm?.stats?.median;
  const naive = results.mcp?.time?.find((/** @type {any} */ t) => t.name === 'mcp-naive')?.warm?.median;
  if (warm && naive)
    log(`bi-warm ${String(warm)} ms vs MCP naive warm ${String(naive)} ms → ${(naive / warm).toFixed(2)}×`);
  if (assertSpeedup !== undefined) {
    const need = Number(assertSpeedup);
    if (!warm || !naive) throw new Error('--assert-speedup needs both sides measured (no --only)');
    const speedup = naive / warm;
    const modesOk = results.bi.warm.validModes;
    if (speedup < need || !modesOk) {
      process.stderr.write(
        `[bench] FAIL speedup ${speedup.toFixed(2)}× < ${String(need)}× (bi-warm median ${String(warm)} ms, p90 ${String(results.bi.warm.stats.p90)} ms; MCP naive warm median ${String(naive)} ms${modesOk ? '' : `; modes ${results.bi.warm.modes.join(',')}`})\n`,
      );
      process.exitCode = 1;
      return;
    }
    log(`ok speedup ${speedup.toFixed(2)}× ≥ ${String(need)}× (p90 bi-warm ${String(results.bi.warm.stats.p90)} ms)`);
  }
}

/**
 * The `bi` side, in the order DESIGN.md §9 lists the variants: cold (no keeper), first (keeper in
 * the stopwatch), then the warm family on the keeper `bi-first` left running, the interactive
 * sessions on the same keeper, app-factory, and the shell survival probes on their own pipes.
 * @param {{ REPS: number, WARM: number, fixture: ReturnType<typeof appFactoryFixture> }} options
 */
async function measureBi({ REPS, WARM, fixture }) {
  const outDir = path.join(OUT, 'bi');
  const env = benchEnv(outDir);
  const { configPath } = prepareBatchConfig(path.join(outDir, 'batch'));
  /** @type {import('./bi-run.mjs').BenchContext} */
  const ctx = { env, cwd: outDir, outDir, configPath, log };
  /** @type {any} */
  const bi = {};
  try {
    log(`bi: cold ×${String(REPS)}`);
    bi.cold = await timeCold(ctx, REPS);
    log(`bi: first (first-ever + ×${String(REPS)})`);
    bi.first = await timeFirst(ctx, REPS);
    log(`bi: warm n=${String(WARM)}, gap 300 ms`);
    bi.warm = await timeWarm(ctx, { name: 'bi-warm', n: WARM, gapMs: 300, day: 3 });
    log(`bi: warm-tight n=${String(WARM)}, no gap`);
    bi.tight = await timeWarm(ctx, { name: 'bi-warm-tight', n: WARM, gapMs: 0, day: 4 });
    log(`bi: warm-fresh n=${String(WARM)}, --fresh`);
    bi.fresh = await timeWarm(ctx, { name: 'bi-warm-fresh', n: WARM, gapMs: 300, extraArgs: ['--fresh'], day: 5 });

    // Tokens: one more warm run, read the way the agent reads it (stdout + the whole report.md).
    await sleep(300);
    const sample = await runBatch(ctx, { stamp: makeStamp(0, new Date(2000, 0, 6, 0, 0)) });
    bi.batchTokens = batchTokens(sample);
    bi.batchTokensPnpm = batchTokens(sample, { command: COMMAND_PNPM });
    bi.batchSample = {
      dir: sample.dir,
      stdout: sample.stdout.trimEnd(),
      wallMs: sample.wallMs,
      mode: sample.mode,
      completed: sample.completed,
      problems: sample.problems,
      engine: sample.report.engine,
      reportMdTokens: measure('report.md', sample.reportMd).tokens,
    };

    bi.interactive = [];
    for (const kind of /** @type {const} */ (['naive', 'lean'])) {
      log(`bi: interactive ${kind}`);
      try {
        bi.interactive.push(await runInteractive(kind, ctx));
      } catch (error) {
        // A failed session is a result (the gate lists it), not the end of the measurement.
        const message = error instanceof Error ? error.message.split('\n')[0] : String(error);
        log(`bi-interactive-${kind} failed: ${message}`);
        bi.interactive.push({
          name: `bi-interactive-${kind}`,
          kind,
          commands: [],
          wallMs: 0,
          commandMs: stats([]),
          findings: {},
          problems: [message.slice(0, 200)],
          tokens: { fixed: [], variable: [] },
        });
      }
    }

    if (fixture) {
      try {
        bi.appFactory = await measureAppFactory(ctx, fixture, REPS);
      } catch (error) {
        const message = error instanceof Error ? error.message.split('\n')[0] : String(error);
        bi.appFactory = { available: false, reason: `run failed: ${message}` };
        log(`app-factory failed: ${message}`);
      }
    } else {
      bi.appFactory = {
        available: false,
        reason: `no app-factory config/builds under ${String(process.env.BENCH_APP_FACTORY ?? '../app-factory')} (or --skip-app-factory)`,
      };
    }
  } finally {
    await stopKeeper(ctx);
  }
  log('bi: keeper-survives-shell');
  bi.shells = await keeperSurvivesShell(ctx);
  return bi;
}

/**
 * app-factory: the 6 snapshots with `--parallel 1` and `3`, the config unchanged and with
 * `networkidle` → `settled`, `min(2, REPS)` runs each (the first run of a lane pays its context).
 * @param {import('./bi-run.mjs').BenchContext} ctx
 * @param {NonNullable<ReturnType<typeof appFactoryFixture>>} fixture
 * @param {number} REPS
 */
async function measureAppFactory(ctx, fixture, REPS) {
  log('bi: app-factory parallel 1 / 3, config unchanged and with settled');
  const dir = path.join(ctx.outDir, 'app-factory');
  const runs = [];
  let day = 10;
  for (const migrate of [false, true]) {
    const cfg = prepareAppFactoryConfig(fixture.config, dir, { migrate });
    for (const parallel of [1, 3]) {
      const samples = [];
      for (let rep = 0; rep < Math.min(2, REPS); rep += 1) {
        await sleep(300);
        const s = await runAppFactory(
          { ...ctx, configPath: cfg },
          { configPath: cfg, parallel, stamp: makeStamp(rep, new Date(2000, 0, day, 0, 0)) },
        );
        log(
          `app-factory ${migrate ? 'settled' : 'unchanged'} --parallel ${String(parallel)} #${String(rep + 1)}: ${String(s.wallMs)} ms · ${String(s.snapshots.filter((x) => x.completed).length)}/${String(s.snapshots.length)} completed · ${s.mode}`,
        );
        samples.push(s);
      }
      day += 1;
      runs.push({
        variant: migrate ? 'settled' : 'unchanged',
        parallel,
        samples,
        median: stats(samples.map((s) => s.wallMs)).median,
      });
    }
  }
  return { available: true, dir: fixture.dir, config: fixture.config, runs };
}

/**
 * The MCP side: tokens on a fresh server (naive, lean), time on a server started once per variant
 * (naive, lean, lean --timeout-settle 100): first run n=1, then `WARM` runs with a 300 ms gap.
 * @param {{ WARM: number }} options
 */
async function measureMcp({ WARM }) {
  const outDir = path.join(OUT, 'mcp');
  fs.mkdirSync(outDir, { recursive: true });
  /** @type {any} */
  const mcp = { tokens: [], time: [] };
  for (const [variant, label] of /** @type {const} */ ([
    ['naive', 'MCP Playwright — agent poznaje ekran'],
    ['lean', 'MCP Playwright — agent zna selektory'],
  ])) {
    log(`mcp: tokens ${variant}`);
    const run = await runVariant(variant, outDir);
    mcp.tokens.push({
      variant: run.variant,
      label,
      fixed: [
        measure('tools/list — definicje narzędzi', run.definitions),
        measure('initialize — dane serwera', run.init),
      ],
      variable: run.calls.flatMap((call) => [
        measure(`→ ${call.tool} (argumenty)`, call.request),
        measure(`← ${call.tool} (odpowiedź)`, call.response),
      ]),
      toolCount: run.toolCount,
      callCount: run.calls.length,
      findings: run.findings,
      problems: checkFindings(run.findings),
    });
  }
  for (const [name, variant, extra] of /** @type {const} */ ([
    ['mcp-naive', 'naive', []],
    ['mcp-lean', 'lean', []],
    ['mcp-lean-settle-100', 'lean', ['--timeout-settle', '100']],
  ])) {
    log(`mcp: time ${name}, server once, 1 + ${String(WARM)} runs, gap 300 ms`);
    try {
      const raw = await timeVariant(variant, outDir, WARM, { extra: [...extra], gapMs: 300 });
      const warm = raw.taskMs.slice(1);
      mcp.time.push({
        name,
        extra: raw.extra,
        handshakeMs: raw.handshakeMs,
        toolsListMs: raw.toolsListMs,
        firstRunMs: raw.taskMs[0],
        warm: stats(warm.length ? warm : raw.taskMs),
        taskMs: raw.taskMs,
        problems: raw.problems,
      });
      log(`${name}: first ${String(raw.taskMs[0])} ms · warm median ${String(stats(warm).median)} ms`);
    } catch (error) {
      // A shorter settle has the right to fall over — that is a result about the mechanism, not a
      // failure of the run.
      mcp.time.push({
        name,
        extra: [...extra],
        error: String(error).split('\n')[0].slice(0, 200),
        problems: [String(error).split('\n')[0].slice(0, 120)],
      });
      log(`${name}: ${String(error).split('\n')[0]}`);
    }
  }
  return mcp;
}

/**
 * The README block is GENERATED from the measurement — the repository promises no number typed by
 * hand, and the README is where that promise breaks most easily.
 * @param {string} readmePath
 * @param {string} block
 */
function updateReadme(readmePath, block) {
  const START = '<!-- BENCH:START -->';
  const END = '<!-- BENCH:END -->';
  const readme = fs.readFileSync(readmePath, 'utf8');
  const start = readme.indexOf(START);
  const end = readme.indexOf(END);
  if (start < 0 || end < 0) {
    log('README.md without BENCH:START/END markers — the block was written to bench/out/README-block.md instead');
    fs.writeFileSync(path.join(OUT, 'README-block.md'), `${block}\n`, 'utf8');
    return;
  }
  fs.writeFileSync(readmePath, readme.slice(0, start) + block + readme.slice(end + END.length), 'utf8');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
