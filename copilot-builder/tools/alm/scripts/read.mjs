#!/usr/bin/env node
// read.mjs — one entry point for every read pipeline.
//
// Vocabulary: a **source** is the upstream system (Jira, GitLab); an **integration** is the code
// that talks to it (a directory under `integrations/`). Everything user-facing here says "source",
// because the argument names the system, not our directory layout. The two used to be mixed, so the
// README said "source" while the tool answered "pick an integration".
//
// Why a dispatcher instead of per-source `package.json` entries
// -------------------------------------------------------------
// The read script used to point straight at the Jira pipeline — from the days when Jira was the
// only integration. At five pipelines back then, four of them were built into `dist/` and
// **unreachable by any command**: they existed, they compiled, and nobody could run them.
//
// The fix is not five `package.json` entries, because a list enumerating sources by name has
// already failed three times in this repository: `include` in `vitest.config.mts` (Confluence got
// zero tests), `include` in both `tsconfig` files (the build passed while compiling nothing) and
// this very script. Every time the same way — silently, without a warning, until the first check
// by hand.
//
// That is why the pipeline list is **discovered** from `dist/` instead of written down. A new
// source becomes reachable the moment its integration compiles; there is no second place to forget.
//
// Exit codes: 0 pass · 1 pipeline failure · 2 caller error (missing argument or unknown source) ·
// 3 not built (`dist/` empty — run `npm run alm:build`; `npm run alm:read` builds first by itself, so
// this code is reachable only when the script is invoked directly with `node`).

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const E_READ_USAGE = 'E_READ_USAGE';
export const E_READ_NOT_BUILT = 'E_READ_NOT_BUILT';

export const ROOT = path.resolve(fileURLToPath(import.meta.url), '..', '..');
export const DIST = path.join(ROOT, 'dist');

/**
 * Discovers pipelines in `dist/`: a directory that holds `<prefix>-<source>.js`.
 * Returns a sorted list so the help message is deterministic.
 *
 * The prefix parameter exists because there are two pipeline families now — `read-*`
 * and `write-*` (dispatched by `write.mjs`) — and both are discovered by the
 * same rule from the same `dist/`, so a new source shows up in both dispatchers the moment
 * it compiles.
 *
 * @returns {Array<{name: string, entry: string}>}
 */
export function discoverPipelines(dist = DIST, prefix = 'read') {
  if (!existsSync(dist)) return [];
  const found = [];
  for (const entry of readdirSync(dist, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === 'shared') continue;
    const script = path.join(dist, entry.name, `${prefix}-${entry.name}.js`);
    if (existsSync(script)) found.push({ name: entry.name, entry: script });
  }
  return found.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/**
 * The three usage branches BOTH dispatchers share — nothing built, no source
 * given, unknown source. The write.mjs header promises the two answer alike;
 * these lived as near-verbatim twins, one message improvement away from
 * `npm run alm:read` and `npm run alm:create` answering the same mistake differently.
 *
 * @param {Array<{name: string, entry: string}>} pipelines
 * @param {string|undefined} name
 * @param {{kind: string, dist: string, usageCode: string, notBuiltCode: string, example: string, hint: string}} spec
 * @returns {{error: {code: string, exit: number, message: string}} | {chosen: {name: string, entry: string}}}
 */
export function selectSource(pipelines, name, spec) {
  if (pipelines.length === 0) {
    return {
      error: {
        code: spec.notBuiltCode,
        exit: 3,
        message:
          `${spec.notBuiltCode}: there is not a single ${spec.kind} in ${path.relative(ROOT, spec.dist)}. ` +
          'Build the domain: `npm run alm:build`.',
      },
    };
  }
  const names = pipelines.map((p) => p.name).join(', ');
  if (name === undefined) {
    return {
      error: {
        code: spec.usageCode,
        exit: 2,
        message: `${spec.usageCode}: pick a source.\n  available: ${names}\nExample: ${spec.example}\n${spec.hint}`,
      },
    };
  }
  const chosen = pipelines.find((p) => p.name === name);
  if (chosen === undefined) {
    return {
      error: {
        code: spec.usageCode,
        exit: 2,
        message: `${spec.usageCode}: unknown source "${name}".\n  available: ${names}`,
      },
    };
  }
  return { chosen };
}

export function plan({ argv, dist = DIST }) {
  const [name, ...rest] = argv;
  const picked = selectSource(discoverPipelines(dist), name, {
    kind: 'pipeline',
    dist,
    usageCode: E_READ_USAGE,
    notBuiltCode: E_READ_NOT_BUILT,
    example: 'npm run alm:read -- jira ./read.config.jira.json',
    hint:
      '  (start from examples/read.config.jira.json — your own copy is not committed,\n' +
      '   because it carries JQL and project keys)',
  });
  if ('error' in picked) return picked.error;
  const chosen = picked.chosen;

  // Everything after the source name is forwarded VERBATIM. Passing only
  // `rest[0]` silently swallowed every other flag, so `--stamp` — which each
  // pipeline parses, and which is the only way to make a run reproducible — could
  // not be reached through the documented command at all.
  //
  // `config` is only what the dispatcher predicts the pipeline will read, for the
  // sake of the existence check below. It is NOT injected into the arguments: a
  // synthesised default in front of the caller's own path would win the "first
  // positional" race inside the pipeline and quietly run the wrong config.
  return {
    code: 'OK',
    exit: 0,
    pipeline: chosen,
    config: predictConfigPath(name, rest),
    args: [chosen.entry, ...rest],
  };
}

/**
 * Mirror of the pipelines' own argument scan (`parseReadArgs` in
 * `integrations/shared/read-runtime.ts`): the config path is the first
 * argument that is neither a flag nor the VALUE of one.
 *
 * The two must agree, which is why this is written as one list of the flags that
 * take a value rather than as "anything not starting with a dash". Guessing that
 * `--stamp 2026-08-23_12-00` contains a filename is exactly the mistake it
 * exists to avoid.
 */
const VALUE_FLAGS = new Set(['--config', '--stamp']);

export function predictConfigPath(name, argv) {
  let positional;
  let config;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const eq = arg.indexOf('=');
    const flag = eq === -1 ? arg : arg.slice(0, eq);
    // `--config` wins over a positional REGARDLESS of order, and the LAST occurrence
    // wins over earlier ones — both mirror parseReadArgs, where every `--config`
    // reassigns. Returning on the first one made the two disagree for
    // `--config a.json --config b.json`: the dispatcher existence-checked a.json
    // while the pipeline read b.json. An EXPLICIT empty value (`--config=`) stays ''
    // so the caller can reject it — resolving '' against ROOT yields the repo root,
    // a directory that always exists, and the guard passed vacuously.
    if (flag === '--config') {
      const value = eq === -1 ? argv[++i] : arg.slice(eq + 1);
      // A trailing `--config` has no value to predict — `undefined` skips the
      // existence check so the pipeline's accurate '--config requires a value'
      // surfaces instead of a guessed 'missing config file'.
      if (value === undefined) return undefined;
      config = value;
      continue;
    }
    if (VALUE_FLAGS.has(flag)) {
      const value = eq === -1 ? argv[i + 1] : arg.slice(eq + 1);
      // Missing OR empty value: parseReadArgs throws '--stamp requires a value' —
      // no prediction, so that accurate error surfaces instead of a guessed
      // 'missing config file'.
      if (value === undefined || value === '') return undefined;
      if (eq === -1) i += 1;
      continue;
    }
    // An UNKNOWN flag makes the prediction unreliable: its value used to be taken
    // for the config path, so `--stmap X` errored with 'missing config file X'
    // while parseReadArgs would have named the flag. No prediction → no mask.
    if (arg.startsWith('-')) return undefined;
    // A positional lands only in the one slot parseReadArgs accepts; a SECOND one
    // (or one after --config) is the pipeline's 'unexpected extra argument' —
    // predicting around it masked that error behind 'missing config file'.
    if (positional === undefined && config === undefined) positional = arg;
    else return undefined;
  }
  return config ?? positional ?? `./read.config.${name}.json`;
}

/**
 * Shared CLI tail for BOTH dispatchers (write.mjs imports it): usage errors to stderr,
 * an existence check of the predicted input file, then the pipeline spawned with
 * inherited stdio. The pipeline runs in the CALLER's working directory (in this repository:
 * the root, where `npm run alm:*` is invoked), so a relative config or input path means what
 * the caller meant — the tool itself lives in `tools/alm/`, and nothing there is yours. One copy on purpose — the two 16-line tails were identical twins
 * and a fix to one (like this exit-code handling) used to miss the other.
 * Sets `process.exitCode` instead of calling `process.exit()`, so piped stderr flushes.
 *
 * @param {{exit: number, message?: string, args?: string[]}} decision
 * @param {{path: string, missingMessage: string}} check
 */
export function runDispatcher(decision, check) {
  if (decision.exit !== 0) {
    process.stderr.write(`${decision.message}\n`);
    process.exitCode = decision.exit;
    return;
  }
  // `check.path === undefined` means the input could not be predicted (an unknown or
  // value-less flag) — skip the pre-flight and let the pipeline print the accurate
  // error, instead of masking it with a guessed 'missing file'.
  if (check.path !== undefined && !existsSync(path.resolve(process.cwd(), check.path))) {
    process.stderr.write(`${check.missingMessage}\n`);
    process.exitCode = 2;
    return;
  }
  const result = spawnSync(process.execPath, decision.args, { cwd: process.cwd(), stdio: 'inherit' });
  if (result.error) {
    // A spawn failure leaves status null and — with inherited stdio and no child —
    // NOTHING on stderr; without this line the run ended 1 in total silence.
    process.stderr.write(`could not start the pipeline: ${result.error.message}\n`);
    process.exitCode = 1;
    return;
  }
  process.exitCode = result.status ?? 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const decision = plan({ argv: process.argv.slice(2) });
  // '' can come from `--config=` OR from an empty positional — the message blames
  // neither specifically, because it used to name a flag the caller never typed.
  if (decision.exit === 0 && decision.config === '') {
    process.stderr.write(`${E_READ_USAGE}: the config path is empty — pass a real path.\n`);
    process.exitCode = 2;
  } else {
    runDispatcher(decision, {
      path: decision.config,
      missingMessage:
        `${E_READ_USAGE}: missing config file ${decision.config}. ` +
        'The pipeline does not guess the read scope — pass the config explicitly.',
    });
  }
}
