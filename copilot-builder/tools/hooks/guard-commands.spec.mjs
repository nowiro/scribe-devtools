import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HOOK = path.join(path.dirname(fileURLToPath(import.meta.url)), 'guard-commands.mjs');

/**
 * @param {string} input raw stdin for the hook
 * @returns {Record<string, any>} the parsed decision
 */
function run(input) {
  const result = spawnSync(process.execPath, [HOOK], { input, encoding: 'utf8' });
  expect(result.status).toBe(0);
  return JSON.parse(result.stdout);
}

/** @param {string} command */
const decision = (command) => run(JSON.stringify({ tool_input: { command } }));

describe('guard-commands hook', () => {
  it('denies destructive commands with a reason', () => {
    for (const [command, reason] of [
      ['git push --force origin main', 'force push'],
      ['git push origin +main', 'force push by refspec'],
      ['rm -rf dist', 'recursive or force delete'],
      ['git reset --hard HEAD~1', 'hard reset'],
      ['Remove-Item -Recurse -Force .cache', 'Remove-Item -Recurse'],
      ['DROP TABLE users;', 'destructive SQL'],
    ]) {
      const out = decision(command);
      expect(out.hookSpecificOutput?.permissionDecision, command).toBe('deny');
      expect(out.hookSpecificOutput?.permissionDecisionReason, command).toContain(reason);
    }
  });

  it('lets safe commands and the lease-protected push through', () => {
    expect(decision('git push --force-with-lease origin feature')).toEqual({});
    expect(decision('npm run verify')).toEqual({});
    expect(decision('git status --short')).toEqual({});
  });

  it('allows anything that is not a shell command, including blank or malformed input', () => {
    expect(run('')).toEqual({});
    expect(run('not json')).toEqual({});
    expect(run(JSON.stringify({ tool_input: { path: 'README.md' } }))).toEqual({});
  });
});
