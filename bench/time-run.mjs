// time-run.mjs — the stopwatch side of the bench: spawning `bi` as a REAL process and timing it
// from `spawn` to exit, valid stamps, waiting for Chrome to be gone between cold runs, and the
// statistics every variant reports (median + p90, n).
//
// Two rules keep the numbers honest:
//   1. `bi` is a real child process, never an import — the Node start, the pipe round trip and the
//      client's exit are what the agent pays on every call, and an in-process call would hide them;
//   2. cold and warm are separate numbers. `bi-cold` waits for the previous client's pid AND its
//      child `chrome.exe` processes to disappear (DESIGN.md §9), otherwise the second "cold" run
//      would inherit a warm renderer from the first.
import { execFile, spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const BIN = path.join(REPO, 'packages', 'browser-inspector', 'bin', 'bi.mjs');

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * @typedef {object} Stats
 * @property {number} n
 * @property {number} min
 * @property {number} max
 * @property {number} median
 * @property {number} p90
 */

/**
 * Median (middle of the sorted list, mean of the two middles for even n) and p90 (nearest-rank).
 * @param {number[]} values
 * @returns {Stats}
 */
export function stats(values) {
  if (values.length === 0) return { n: 0, min: 0, max: 0, median: 0, p90: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 1 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
  const rank = Math.max(1, Math.ceil(0.9 * sorted.length));
  return { n: sorted.length, min: sorted[0], max: sorted[sorted.length - 1], median, p90: sorted[rank - 1] };
}

/**
 * A stamp that passes `--stamp` validation (`YYYY-MM-DD_HH-MM`) and is unique per repetition:
 * the minute is the repetition counter, so ten runs in one wall-clock minute do not overwrite
 * each other's `report.json`.
 * @param {number} rep
 * @param {Date} [base]
 */
export function makeStamp(rep, base = new Date()) {
  const at = new Date(base.getTime() + rep * 60_000);
  const two = (n) => String(n).padStart(2, '0');
  return `${String(at.getFullYear())}-${two(at.getMonth() + 1)}-${two(at.getDate())}_${two(at.getHours())}-${two(at.getMinutes())}`;
}

/**
 * @typedef {object} BiRun
 * @property {number} code exit code
 * @property {string} stdout
 * @property {string} stderr
 * @property {string[]} lines non-empty stdout lines
 * @property {number} wallMs spawn → exit
 * @property {number} pid
 */

/**
 * One `node bin/bi.mjs …` process, timed from `spawn` to exit.
 * @param {string[]} args
 * @param {{ env: NodeJS.ProcessEnv, cwd: string }} options
 * @returns {Promise<BiRun>}
 */
export function spawnBi(args, { env, cwd }) {
  return new Promise((resolve, reject) => {
    const t0 = performance.now();
    const child = spawn(process.execPath, [BIN, ...args], {
      env,
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += String(chunk)));
    child.stderr.on('data', (chunk) => (stderr += String(chunk)));
    child.on('error', reject);
    child.on('close', (code) =>
      resolve({
        code: code ?? -1,
        stdout,
        stderr,
        lines: stdout.split(/\r?\n/u).filter((line) => line !== ''),
        wallMs: Math.round(performance.now() - t0),
        pid: child.pid ?? 0,
      }),
    );
  });
}

/**
 * The `chrome.exe` / `chrome` processes alive right now as `{ pid, ppid }` — the raw material for
 * "is the browser of that client gone yet". PowerShell on Windows (tasklist has no parent column),
 * `ps` elsewhere; a missing tool means an empty list, never an exception.
 * @returns {Promise<{ pid: number, ppid: number }[]>}
 */
export function chromeProcesses() {
  return new Promise((resolve) => {
    const done = (/** @type {string} */ out) => {
      const rows = [];
      for (const line of out.split(/\r?\n/u)) {
        const m = /^\s*(\d+)\s+(\d+)\s*$/u.exec(line);
        if (m) rows.push({ pid: Number(m[1]), ppid: Number(m[2]) });
      }
      resolve(rows);
    };
    if (process.platform === 'win32') {
      execFile(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          'Get-CimInstance Win32_Process -Filter "Name=\'chrome.exe\' or Name=\'msedge.exe\'" | ForEach-Object { "$($_.ProcessId) $($_.ParentProcessId)" }',
        ],
        { windowsHide: true, timeout: 10_000 },
        (error, stdout) => done(error ? '' : String(stdout)),
      );
    } else {
      execFile('ps', ['-eo', 'pid=,ppid=,comm='], { timeout: 10_000 }, (error, stdout) => {
        if (error) return done('');
        const kept = String(stdout)
          .split('\n')
          .filter((line) => /chrome|chromium|msedge/iu.test(line))
          .map((line) => line.trim().split(/\s+/u).slice(0, 2).join(' '));
        done(kept.join('\n'));
      });
    }
  });
}

/**
 * The transitive `chrome.exe` descendants of `pid` (Chrome's own children are chrome.exe too).
 * @param {number} pid
 * @param {{ pid: number, ppid: number }[]} processes
 */
export function chromeDescendants(pid, processes) {
  const found = new Set();
  let frontier = [pid];
  while (frontier.length > 0) {
    const next = [];
    for (const row of processes) {
      if (frontier.includes(row.ppid) && !found.has(row.pid)) {
        found.add(row.pid);
        next.push(row.pid);
      }
    }
    frontier = next;
  }
  return [...found];
}

/** @param {number} pid */
export function isAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return /** @type {NodeJS.ErrnoException} */ (error).code === 'EPERM';
  }
}

/**
 * Wait until the pids and their Chrome descendants are gone (`bi-cold` between repetitions, and
 * after `bi stop` before `bi-first`). Returns how long it took and whether it gave up.
 * @param {number[]} pids
 * @param {number} [timeoutMs]
 */
export async function waitForChromeGone(pids, timeoutMs = 2000) {
  const t0 = performance.now();
  for (;;) {
    const processes = await chromeProcesses();
    const lingering = pids.flatMap((pid) => chromeDescendants(pid, processes));
    const alive = pids.filter(isAlive);
    if (lingering.length === 0 && alive.length === 0) return { ms: Math.round(performance.now() - t0), clean: true };
    if (performance.now() - t0 > timeoutMs) {
      return { ms: Math.round(performance.now() - t0), clean: false, lingering, alive };
    }
    await sleep(50);
  }
}

/** @param {string} file */
export async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}
