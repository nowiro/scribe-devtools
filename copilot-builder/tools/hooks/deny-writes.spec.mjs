import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { READ_TOOLS, decide } from './deny-writes.mjs';

const HOOK = path.join(path.dirname(fileURLToPath(import.meta.url)), 'deny-writes.mjs');

describe('decide', () => {
  it.each([
    'read_file',
    'copilot_readFile',
    'list_dir',
    'grep_search',
    'semantic_search',
    'get_errors',
    'usages',
    'get_changed_files',
    'manage_todo_list',
  ])('allows the read tool %s', (tool) => {
    expect(decide(tool)).toBeNull();
  });

  it.each([
    'run_in_terminal',
    'editFiles',
    'create_file',
    'replace_string_in_file',
    'apply_patch',
    'runSubagent',
    'run_vscode_command',
    'install_extension',
    'install_python_packages',
    'configure_python_environment',
    'memory',
    'mkdir',
    'rename_file',
    'copy_file',
    'fetch_webpage',
    'github_repo_search',
  ])('denies %s', (tool) => {
    expect(decide(tool)).not.toBeNull();
  });

  it('fails closed on an unknown tool and on a missing name', () => {
    expect(decide('brand_new_tool')).toContain('not on the read-only allowlist');
    expect(decide('')).toContain('names no tool');
  });

  it('keeps the allowlist normalised (lower case, no separators)', () => {
    for (const entry of READ_TOOLS) expect(entry).toMatch(/^[a-z0-9]+$/u);
  });
});

describe('the hook process', () => {
  /** @param {string} input */
  const run = (input) => {
    const result = spawnSync(process.execPath, [HOOK], { input, encoding: 'utf8' });
    expect(result.status).toBe(0);
    return JSON.parse(result.stdout);
  };

  it('denies a write tool with the read-only reason and allows a read tool', () => {
    const denied = run(JSON.stringify({ tool_name: 'create_file', tool_input: { filePath: 'x.ts' } }));
    expect(denied.hookSpecificOutput.permissionDecision).toBe('deny');
    expect(denied.hookSpecificOutput.permissionDecisionReason).toContain('read-only');
    expect(run(JSON.stringify({ toolName: 'read_file', toolInput: { filePath: 'x.ts' } }))).toEqual({});
  });

  it('denies blank input rather than guessing', () => {
    expect(run('').hookSpecificOutput.permissionDecision).toBe('deny');
  });
});
