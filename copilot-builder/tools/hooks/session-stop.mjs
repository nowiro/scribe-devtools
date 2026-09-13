#!/usr/bin/env node
/**
 * session-stop.mjs — Stop hook: after an agent session ends, run the cheap gates and report.
 *
 * "Cheap" means: no compilation, no tests, no network — the Copilot configuration, the SDD
 * artefacts, the forbidden-files guard and the instruction-block sync, a couple of seconds together.
 * `npm run verify` stays the definition of done; this is an early warning that costs zero tokens.
 *
 * The hook NEVER blocks — a red gate here is information, not a refusal. A blocking hook at the end
 * of a session takes away the chance to save work in progress and teaches people to work around it.
 */
import { execFileSync } from 'node:child_process';
import process from 'node:process';
import { ROOT, isMain, readStdin } from './lib/payload.mjs';
/** @type {readonly [string, string[]][]} */
const GATES = [
  ['ai:validate', ['tools/scripts/validate-ai-config.mjs']],
  ['sdd:check', ['tools/scripts/validate-sdd.mjs']],
  ['guard:forbidden', ['tools/scripts/guard-forbidden.mjs']],
  ['check:instructions', ['tools/scripts/check-instruction-sync.mjs', '--require-all']],
];

/**
 * @param {string} name
 * @param {string[]} args
 * @returns {string | null} the first lines of the failure, or null when the gate passed
 */
function runGate(name, args) {
  try {
    execFileSync(process.execPath, args, {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
      timeout: 25_000,
    });
    return null;
  } catch (error) {
    const failure = /** @type {{ stdout?: string, stderr?: string }} */ (error);
    const output = `${failure.stdout ?? ''}${failure.stderr ?? ''}`.trim();
    return `${name}: ${output.split('\n').slice(0, 3).join(' · ') || 'no output'}`;
  }
}

if (isMain(import.meta.url)) {
  // The payload is irrelevant here; stdin is drained so the client does not wait on a full pipe.
  await readStdin();
  const failures = GATES.map(([name, args]) => runGate(name, args)).filter((line) => line !== null);
  if (failures.length > 0) {
    process.stdout.write(
      JSON.stringify({
        systemMessage: `session-stop — cheap gates are red:\n${failures.map((line) => `  · ${line}`).join('\n')}\nFull gate: npm run verify`,
      }),
    );
  }
}
