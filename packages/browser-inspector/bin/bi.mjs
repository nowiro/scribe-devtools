#!/usr/bin/env node
// bi — the entry the agent runs (DESIGN.md §2.1 / §3.1). Budget: 72 ms to the first byte of
// output, so this file imports the parser and nothing else; the client module (net, config,
// paths, print) is loaded only when a command actually needs it, and playwright-core / engine.mjs /
// steps.run.mjs are never imported here or in the client — test/client-imports.test.mjs proves it.
//
// Dispatch:
//   bi help [cmd] | version           → here, from the STEPS table
//   bi <config.json> … | bi script f  → keeper, unless --no-daemon / BI_DAEMON=0 / CI → in-process;
//                                        no keeper within 3 s → in-process with `keeper: fallback`
//   bi <session command> | bi export  → keeper only; without one: exit 2 + `FAIL keeper unavailable…`
//   bi up | status | stop | doctor    → keeper control (`up` spawns, the others never do)
import { CliError, parseArgs, usage } from '../src/cli.mjs';

const argv = process.argv.slice(2);

/** @param {number} code */
function finish(code) {
  process.exitCode = code;
  // An unref'd timer costs nothing when the loop is empty (natural exit) and forces the exit
  // when a stray handle (a browser closed late in the fallback path) would keep the process alive.
  setTimeout(() => process.exit(code), 2000).unref();
}

const first = argv[0];
if (first === undefined || first === 'help' || first === '--help' || first === '-h') {
  try {
    const parsed = parseArgs(argv);
    process.stdout.write(`${usage(parsed.mode === 'help' ? parsed.command : undefined)}\n`);
    finish(0);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    finish(error instanceof CliError ? error.exit : 2);
  }
} else {
  import('../src/client.mjs')
    .then(({ main }) => main(argv))
    .then(finish)
    .catch((error) => {
      process.stderr.write(`bi: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
      finish(2);
    });
}
