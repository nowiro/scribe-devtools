#!/usr/bin/env node
// write.mjs — one entry point for BOTH write commands, `create` and `update`, over the
// `write-<source>` pipelines. The twin of `read.mjs`: the same discovery rule (pipelines
// found in `dist/`, never enumerated), the same exit codes, the same launcher awareness.
//
// WHY the mode is a command and not only front matter: the file stays the single source
// of detail (`key:` present = an update file), and the command is an ASSERTION over it.
// `create zadanie.md` against a file that carries `key: PROJ-123` fails loudly naming the
// right command — the two can never silently disagree, because a mismatch never runs.
//
// The write contract, stated once and enforced by the pipelines themselves:
//   - DRY-RUN IS THE DEFAULT. `create jira zadanie.md` prints what would happen — for an
//     update, a diff against the live item — and exits 0 without writing anything.
//   - `--yes` is the only way anything is written.
//   - There is no delete. Create, update, comment — nothing else exists to dispatch.
//
// Exit codes: 0 pass (a completed dry-run IS a pass) · 1 pipeline failure · 2 caller error ·
// 3 not built (`npm run alm:create`/`update` build first by themselves, so 3 is reachable only
// via `node`).

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { DIST, discoverPipelines, runDispatcher, selectSource } from './read.mjs';

export const E_WRITE_USAGE = 'E_WRITE_USAGE';
export const E_WRITE_NOT_BUILT = 'E_WRITE_NOT_BUILT';

const MODES = new Set(['create', 'update']);

export function plan({ argv, dist = DIST }) {
  const [mode, name, ...rest] = argv;

  if (mode === undefined || !MODES.has(mode)) {
    return {
      code: E_WRITE_USAGE,
      exit: 2,
      message:
        `${E_WRITE_USAGE}: pick a mode — create (a new item) or update (an existing one).\n` +
        'The npm scripts pass it for you: `npm run alm:create -- jira ./zadanie.md`.',
    };
  }

  const example = `npm run alm:${mode} -- jira ./zadanie.md`;
  const picked = selectSource(discoverPipelines(dist, 'write'), name, {
    kind: 'write pipeline',
    dist,
    usageCode: E_WRITE_USAGE,
    notBuiltCode: E_WRITE_NOT_BUILT,
    example,
    hint:
      '  (the file is Markdown with YAML front matter — templates/ shows the shape.\n' +
      '   Without --yes this is a dry-run: it prints what would happen and writes nothing.)',
  });
  if ('error' in picked) return picked.error;
  const chosen = picked.chosen;

  // The input file is the first non-flag argument that is not the VALUE of a flag.
  // A bare `.find(not-a-dash)` used to take the value of a caller's `--mode` as the
  // file. And a caller-supplied `--mode` is rejected outright: the dispatcher injects
  // its own `--mode <command>` FIRST, the pipeline lets the last one win, so a `--mode`
  // in `rest` would silently override the very assertion this command exists to make.
  let file;
  let predictable = true;
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    const eq = arg.indexOf('=');
    const flag = eq === -1 ? arg : arg.slice(0, eq);
    if (flag === '--mode') {
      return {
        code: E_WRITE_USAGE,
        exit: 2,
        message: `${E_WRITE_USAGE}: the mode IS the command — drop --mode and use \`npm run alm:create\` or \`npm run alm:update\`.`,
      };
    }
    if (arg.startsWith('-')) {
      // Any flag other than --yes is unknown to the write pipelines; predicting a
      // file around it risks mistaking its value for the path (the mask the read
      // side kills too), so the pre-flight check is skipped and the pipeline's
      // own unknown-flag error surfaces by name.
      if (arg !== '--yes') predictable = false;
      continue;
    }
    if (file === undefined) {
      file = arg;
    } else {
      // A SECOND positional is parseWriteArgs's 'unexpected extra argument' —
      // predicting around it masked that error behind 'missing input file'.
      predictable = false;
    }
  }
  // '' passes a `startsWith('-')` test and resolves against ROOT to a directory that
  // exists — treat it as missing, same as no file at all.
  if (predictable && (file === undefined || file === '')) {
    return {
      code: E_WRITE_USAGE,
      exit: 2,
      message: `${E_WRITE_USAGE}: missing input file.\nExample: ${example}`,
    };
  }
  if (!predictable) file = undefined;

  // `--mode` rides along so the pipeline can assert the file's shape matches the
  // caller's intent — the whole point of splitting create from update.
  return { code: 'OK', exit: 0, mode, pipeline: chosen, file, args: [chosen.entry, '--mode', mode, ...rest] };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const decision = plan({ argv: process.argv.slice(2) });
  runDispatcher(decision, {
    path: decision.file,
    missingMessage:
      `${E_WRITE_USAGE}: missing input file ${decision.file}. ` +
      'Relative paths resolve against the current working directory — run the command from the repository root.',
  });
}
