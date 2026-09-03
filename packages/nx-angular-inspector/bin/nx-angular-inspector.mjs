#!/usr/bin/env node
// nx-angular-inspector — the entry the agent runs. Replaces `ng mcp` (9 tools, 4 979 fixed o200k
// tokens) and `nx-mcp` (workspace tools broken on nx 23) with a binary that costs a ~150-token
// instruction block once and prints one line per call.
//
// The floor is 95 ms cold, of which 61 ms is Node starting — which is why this file imports only
// the parser path and why there is no keeper process in v1. In browser-inspector the arithmetic
// went the other way (935 ms cold against a 720 ms budget) and a keeper was the only way out; here
// a keeper could save at most 61 ms and would cost an identity hash, a lock, a named pipe, a dead-pid
// probe, a doctor and a shell-survival test.
//
//   env | projects [nazwa] | graph <projekt> | gen [wzorzec] | guide
//
// Supported: nx >= 23 and angular >= 22, checked once before anything runs.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { main } from '../src/main.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Our own version, for `nx-angular-inspector version`. Read lazily and never fatal. */
function ownVersion() {
  try {
    return String(JSON.parse(readFileSync(path.join(here, '..', 'package.json'), 'utf8')).version ?? '');
  } catch {
    return '';
  }
}

try {
  const { line, exit } = main(process.argv.slice(2), { version: ownVersion() });
  (exit === 0 ? process.stdout : process.stderr).write(`${line}\n`);
  process.exitCode = exit;
} catch (error) {
  process.stderr.write(
    `nx-angular-inspector: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exitCode = 2;
}
