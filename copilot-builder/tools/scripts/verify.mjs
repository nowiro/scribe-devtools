#!/usr/bin/env node
// verify.mjs — THE Definition of Done: every gate of the repository, in one order, first red stops.
//
//   npm run verify                 static gates → typecheck → lint → tests → every project: typecheck, test, build
//   npm run verify:affected        the same, but project targets only for the projects a change touches
//                                  (pre-push hook), and no build — a fast, honest answer before the push
//   npm run verify -- --static     only the static gates (GitLab job `static`)
//   npm run verify:full            everything above plus end-to-end tests of every application
//
// Cheap before expensive: a formatting drift or a stale index is reported in seconds, not after a
// three-minute build. Every step is the same command a human types (or `npm run <script>` shows), so
// a red line here reproduces on the console verbatim.
//
// Exit codes: 0 all green · 1 the first red gate (its command is printed) · 2 usage error.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { displayCommand } from './display-command.mjs';
import { REPO, isMain } from './lib/repo.mjs';

const node = process.execPath;
const bin = (/** @type {string} */ rel) => path.join(REPO, 'node_modules', rel);

/** @typedef {{ label: string, command: string[] }} Step */

/** @type {Step[]} */
export const STATIC = [
  { label: 'format:check', command: [node, bin('oxfmt/bin/oxfmt'), '--check'] },
  { label: 'check:pins', command: [node, 'tools/scripts/check-pins.mjs'] },
  { label: 'guard:forbidden', command: [node, 'tools/scripts/guard-forbidden.mjs'] },
  { label: 'ai:validate', command: [node, 'tools/scripts/validate-ai-config.mjs'] },
  { label: 'sdd:check', command: [node, 'tools/scripts/validate-sdd.mjs'] },
  { label: 'stack:check', command: [node, 'tools/scripts/stack.mjs', 'check'] },
  { label: 'code-index --check', command: [node, 'tools/scripts/index-code.mjs', '--check'] },
  { label: 'check:instructions', command: [node, 'tools/scripts/check-instruction-sync.mjs', '--require-all'] },
  { label: 'check:prefix', command: [node, 'tools/scripts/check-prefix.mjs'] },
  { label: 'check:glossary', command: [node, 'tools/scripts/check-glossary.mjs'] },
];

/** @type {Step[]} */
export const CODE = [
  { label: 'typecheck (tools)', command: [node, bin('typescript/bin/tsc'), '-p', 'tsconfig.tools.json'] },
  {
    label: 'typecheck (alm)',
    command: [node, bin('typescript/bin/tsc'), '-p', 'tools/alm/integrations/tsconfig.test.json'],
  },
  // oxlint for every code file, then angular-eslint for what oxlint cannot parse (templates).
  { label: 'lint', command: [node, bin('oxlint/bin/oxlint')] },
  {
    label: 'lint (angular)',
    command: [
      node,
      bin('eslint/bin/eslint.js'),
      '.',
      '--max-warnings=0',
      '--cache',
      '--cache-location',
      '.cache/eslint/',
    ],
  },
  {
    label: 'test (tools + alm)',
    command: [node, bin('vitest/vitest.mjs'), 'run', '--config', 'vitest.tools.config.mts'],
  },
];

/**
 * @param {{ affected: boolean, full: boolean, base?: string }} options
 * @returns {Step[]}
 */
export function projectSteps({ affected, full, base }) {
  let scope = ['--all'];
  if (affected) scope = base ? [`--base=${base}`] : [];
  const run = (/** @type {string} */ target) => ({
    label: `projects: ${target}`,
    command: [node, 'tools/scripts/affected.mjs', target, ...scope],
  });
  const steps = [run('typecheck'), run('test')];
  // e2e runs over dist/, so --full builds even in affected mode; the default branch builds anyway.
  if (!affected || full) steps.push(run('build'));
  if (full) steps.push(run('e2e'));
  return steps;
}

/**
 * @param {string[]} argv
 * @returns {{ static: boolean, affected: boolean, full: boolean, base?: string }}
 */
export function parseArgs(argv) {
  const out = { static: false, affected: false, full: false };
  for (const arg of argv) {
    if (arg === '--static') out.static = true;
    else if (arg === '--affected') out.affected = true;
    else if (arg === '--full') out.full = true;
    else if (arg.startsWith('--base=')) out.base = arg.slice('--base='.length);
  }
  return out;
}

/**
 * @param {Step[]} steps
 * @returns {number}
 */
export function runSteps(steps) {
  const startedAll = Date.now();
  for (const step of steps) {
    const started = Date.now();
    process.stdout.write(`\n▶ ${step.label}\n`);
    const result = spawnSync(step.command[0], step.command.slice(1), {
      cwd: REPO,
      stdio: 'inherit',
      env: { ...process.env, NG_CLI_ANALYTICS: 'false', FORCE_COLOR: process.env.FORCE_COLOR ?? '0' },
    });
    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    if (result.status !== 0) {
      const shown = displayCommand(step.command, REPO);
      process.stderr.write(`\nFAIL verify · ${step.label} after ${seconds} s\n  reproduce: ${shown}\n`);
      return 1;
    }
    process.stdout.write(`ok ${step.label} · ${seconds} s\n`);
  }
  process.stdout.write(
    `\nok verify · ${steps.length} gates green in ${((Date.now() - startedAll) / 1000).toFixed(1)} s\n`,
  );
  return 0;
}

if (isMain(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  const steps = args.static ? STATIC : [...STATIC, ...CODE, ...projectSteps(args)];
  process.exitCode = runSteps(steps);
}
