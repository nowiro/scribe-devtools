// nx-angular-inspector-run.mjs — the `nx-angular-inspector` side of the measurement: a realistic
// session as REAL child processes of `bin/nx-angular-inspector.mjs`, timed from `spawn` to exit,
// with the tokens the agent would pay (the instruction block, the commands, the stdout, and the
// files it actually reads) and the freshness verdict of every run validated.
//
// `INSTRUCTION` is the fixed cost of this side and must equal the blockquote in AGENTS.md character
// for character (`scripts/check-instruction-sync.mjs` in `npm run verify`). Without this file the
// gate had only two of the three copies to compare, and said so — `(bez benchu)`.
//
// What is NOT here, deliberately: a comparison against `ng mcp` and `nx-mcp`. Both are spawned
// through `npx` and downloaded from the registry, so a measurement of them is a measurement of
// somebody's network on the day it ran. The numbers for those two live in the research report,
// where they carry the date and the machine they were taken on. This harness measures OUR side,
// which is the half that has to stay honest as the code changes.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { measure, total } from './tokens.mjs';

const REPO = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
export const BIN = path.join(REPO, 'packages', 'nx-angular-inspector', 'bin', 'nx-angular-inspector.mjs');
export const FIXTURES = path.join(REPO, 'packages', 'nx-angular-inspector', 'fixtures', 'generate.mjs');

export const INSTRUCTION =
  'Nx/Angular: `nx-angular-inspector env` · `projects [nazwa]` · `graph <projekt> [--reverse]` · `affected [--base <ref>]` · `gen [wzorzec|kolekcja:generator]` · `guide` · `run <projekt>:<target>` · `serve [wait|stop] <projekt>`. Każda drukuje JEDNĄ linię (exit 1 = FAIL) zakończoną ścieżką pliku z całością w `.ws/` — odpowiedź jest w tym pliku, nie powtarzaj komendy; `projects <nazwa>` odpowiada samą linią. Komendy z grafu dopisują świeżość (`świeże`|`nieświeże`), `--fresh` przelicza. Tylko nx >= 23 i angular >= 22.';

/**
 * The session, as an agent would actually work: find out where it is, list the projects, look at
 * one, follow an edge, then ask what can be generated.
 *
 * `reads` names the artefact the agent opens afterwards — the whole point of writing to `.ws/` is
 * that a line is cheap and the file is opened ONLY when the answer is not on the line, so a
 * measurement that ignored the reads would flatter this tool by exactly the amount it saves.
 */
export const COMMANDS = Object.freeze([
  { argv: ['env'], reads: null },
  { argv: ['projects'], reads: '.ws/projects.md' },
  { argv: ['projects', 'portal'], reads: null },
  { argv: ['graph', 'portal'], reads: '.ws/graph-portal.md' },
  { argv: ['gen'], reads: '.ws/gen.md' },
]);

/** Environment variables that would make a run measure somebody's CI instead of this machine. */
export const CI_VARS = Object.freeze([
  'CI',
  'GITHUB_ACTIONS',
  'GITLAB_CI',
  'TF_BUILD',
  'JENKINS_URL',
  'TEAMCITY_VERSION',
  'BUILDKITE',
  'CIRCLECI',
]);

/**
 * A clean environment for a run: no CI markers, no inherited output directory, no colour.
 * @param {string} [outDir]
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {NodeJS.ProcessEnv}
 */
export function benchEnv(outDir, env = process.env) {
  /** @type {NodeJS.ProcessEnv} */
  const clean = { ...env, NO_COLOR: '1', FORCE_COLOR: '0' };
  for (const name of CI_VARS) delete clean[name];
  delete clean.NX_ANGULAR_INSPECTOR_OUT;
  if (outDir !== undefined) clean.NX_ANGULAR_INSPECTOR_OUT = outDir;
  return clean;
}

/**
 * Build the fixture workspace the session runs against.
 *
 * A generated fixture, not `../app-factory`: the benchmark must produce the same number tomorrow,
 * and a workspace somebody is working in does not. The absolute numbers are therefore smaller than
 * a real workspace would give; the SHAPE of the answer — one line, the bulk on disk — is what this
 * measures, and that does not depend on the size.
 * @param {string} dir
 * @returns {Promise<string>} the workspace root
 */
export async function makeFixture(dir) {
  const { makeWorkspace } = await import(
    new URL('../packages/nx-angular-inspector/fixtures/generate.mjs', import.meta.url).href
  );
  return makeWorkspace(path.join(dir, 'nx-angular'), 'nx-angular');
}

/**
 * One command as a child process, timed from spawn to exit.
 * @param {object} options
 * @param {string} options.root workspace to run in
 * @param {readonly string[]} options.argv
 * @param {NodeJS.ProcessEnv} [options.env]
 * @returns {Promise<{ argv: string[], line: string, exit: number, ms: number }>}
 */
export function runOnce({ root, argv, env = benchEnv() }) {
  return new Promise((resolve, reject) => {
    const started = process.hrtime.bigint();
    const child = spawn(process.execPath, [BIN, ...argv], {
      cwd: root,
      shell: false,
      windowsHide: true,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (chunk) => (out += String(chunk)));
    child.stderr.on('data', (chunk) => (out += String(chunk)));
    child.on('error', reject);
    child.on('close', (code) => {
      const ms = Number(process.hrtime.bigint() - started) / 1e6;
      resolve({ argv: [...argv], line: out.trim(), exit: code ?? 1, ms });
    });
  });
}

/**
 * The whole session, in order, against one workspace.
 * @param {object} ctx
 * @param {string} ctx.root
 * @param {NodeJS.ProcessEnv} [ctx.env]
 * @returns {Promise<{ runs: {argv: string[], line: string, exit: number, ms: number, read: string}[], totalMs: number }>}
 */
export async function runScenario({ root, env = benchEnv() }) {
  /** @type {{argv: string[], line: string, exit: number, ms: number, read: string}[]} */
  const runs = [];
  let totalMs = 0;
  for (const step of COMMANDS) {
    const result = await runOnce({ root, argv: step.argv, env });
    // The file is read only when the answer was not on the line — which is the behaviour the
    // instruction block asks for, so it is the behaviour the measurement has to reproduce.
    const read = step.reads === null ? '' : readIfPresent(path.join(root, ...step.reads.split('/')));
    runs.push({ ...result, read });
    totalMs += result.ms;
  }
  return { runs, totalMs };
}

/**
 * What a session costs: the instruction block once, then every command, every line, every file read.
 * @param {{ runs: {argv: string[], line: string, read: string}[] }} sample
 * @returns {{ fixed: {label: string, bytes: number, tokens: number}[], variable: {label: string, bytes: number, tokens: number}[], totals: {fixed: {bytes: number, tokens: number}, variable: {bytes: number, tokens: number}, all: {bytes: number, tokens: number}} }}
 */
export function scenarioTokens(sample) {
  const fixed = [measure('blok INSTRUCTION w AGENTS.md', INSTRUCTION)];
  /** @type {{label: string, bytes: number, tokens: number}[]} */
  const variable = [];
  for (const run of sample.runs) {
    const name = `nx-angular-inspector ${run.argv.join(' ')}`;
    variable.push(measure(`→ ${name}`, name));
    variable.push(measure(`← stdout`, run.line));
    if (run.read !== '') variable.push(measure(`  plik z .ws/`, run.read));
  }
  return {
    fixed,
    variable,
    totals: { fixed: total(fixed), variable: total(variable), all: total([...fixed, ...variable]) },
  };
}

/**
 * The median of `reps` runs of one command, plus the bare Node floor for the same machine.
 *
 * The floor is measured, not assumed, and it is the number that decides whether a keeper process
 * would be worth building: if most of the wall clock is Node starting, a warm daemon can only ever
 * save the rest.
 * @param {object} options
 * @param {string} options.root
 * @param {readonly string[]} options.argv
 * @param {number} [options.reps]
 * @param {NodeJS.ProcessEnv} [options.env]
 * @returns {Promise<{ argv: string[], samples: number[], median: number, nodeFloor: number }>}
 */
export async function timeVerb({ root, argv, reps = 5, env = benchEnv() }) {
  /** @type {number[]} */
  const samples = [];
  for (let i = 0; i < reps; i++) samples.push((await runOnce({ root, argv, env })).ms);
  /** @type {number[]} */
  const floors = [];
  for (let i = 0; i < reps; i++) floors.push(await timeBareNode());
  return { argv: [...argv], samples, median: median(samples), nodeFloor: median(floors) };
}

/**
 * The freshness verdicts a session produced — the validity gate of the measurement.
 *
 * The analogue of `validModes` on the browser-inspector side: a run that fell through to the CLI
 * took 1,4 s instead of 0,1 s, and averaging it into a cached column produces a number that is
 * neither the cached path nor the cold one. The report must reject the sample, not smooth it.
 * @param {{ runs: {line: string}[] }} sample
 * @returns {{ modes: string[], valid: boolean }}
 */
export function cacheModes(sample) {
  const words = ['świeże', 'nieświeże', 'brak grafu', 'nieznany format', 'przeliczone'];
  const modes = sample.runs.map((run) => words.find((word) => run.line.includes(word)) ?? '');
  const graphRuns = modes.filter((mode) => mode !== '');
  return { modes, valid: graphRuns.length > 0 && graphRuns.every((mode) => mode === 'świeże') };
}

/** @param {string} file @returns {string} */
function readIfPresent(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

/** An empty Node process, to separate our work from the runtime's start-up. @returns {Promise<number>} */
function timeBareNode() {
  return new Promise((resolve, reject) => {
    const started = process.hrtime.bigint();
    const child = spawn(process.execPath, ['-e', '0'], { shell: false, windowsHide: true, stdio: 'ignore' });
    child.on('error', reject);
    child.on('close', () => resolve(Number(process.hrtime.bigint() - started) / 1e6));
  });
}

/** @param {readonly number[]} values @returns {number} */
export function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}
