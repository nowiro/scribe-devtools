#!/usr/bin/env node
// browser-inspector — the entry the agent runs (DESIGN.md §2.1 / §3.1). Budget: 72 ms to the first byte of
// output, so this file imports the parser and nothing else; the client module (net, config,
// paths, print) is loaded only when a command actually needs it, and playwright-core / engine.mjs /
// steps.run.mjs are never imported here or in the client — the `client-imports` test guards that
// graph where the test suite is checked out; without it, review the import lists by hand.
//
// Dispatch:
//   help [cmd] | version              → here, from the STEPS table
//   <config.json> … | script <file>   → keeper, unless --no-daemon / BROWSER_INSPECTOR_DAEMON=0 / CI → in-process;
//                                       no keeper within 3 s → in-process with `keeper: fallback`
//   <session command> | export        → keeper only; without one: exit 2 + `FAIL keeper unavailable…`
//   up | status | stop | doctor       → keeper control (`up` spawns, the others never do)
import { readFileSync } from 'node:fs';

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
if (first === 'version' || first === '--version' || first === '-v') {
  // Answered here for the same reason `help` is: the answer is one field of the manifest, and the
  // client graph it would otherwise load costs ~6 ms it has no use for.
  try {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    process.stdout.write(`${typeof pkg.version === 'string' ? pkg.version : '0.0.0'}\n`);
    finish(0);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    finish(2);
  }
} else if (first === undefined || first === 'help' || first === '--help' || first === '-h') {
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
      process.stderr.write(
        `browser-inspector: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
      );
      finish(2);
    });
}
