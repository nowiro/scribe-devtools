import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { EDIT_TOOLS, formatTarget } from './format-on-edit.mjs';

const ROOT = path.resolve('/repo');

describe('formatTarget', () => {
  it('formats a source file written by an edit tool, as an absolute path', () => {
    expect(formatTarget('create_file', 'apps/demo/src/main.ts', ROOT)).toBe(path.join(ROOT, 'apps/demo/src/main.ts'));
    expect(formatTarget('copilot_replaceStringInFile', 'tools/x.mjs', ROOT)).toBe(path.join(ROOT, 'tools/x.mjs'));
    expect(formatTarget('apply_patch', '--check.js', ROOT)).toBe(path.join(ROOT, '--check.js'));
    expect(formatTarget('create_file', 'apps/demo/src/app/app.html', ROOT)).toBe(
      path.join(ROOT, 'apps/demo/src/app/app.html'),
    );
  });

  it('does nothing for tools that only read', () => {
    expect(formatTarget('read_file', 'apps/demo/src/main.ts', ROOT)).toBeNull();
    expect(formatTarget('grep_search', 'apps/demo/src/main.ts', ROOT)).toBeNull();
    expect(formatTarget('', 'apps/demo/src/main.ts', ROOT)).toBeNull();
  });

  it('skips files oxfmt does not own and paths outside the repository', () => {
    expect(formatTarget('create_file', 'README.md', ROOT)).toBeNull();
    expect(formatTarget('create_file', 'dist/main.js', ROOT)).toBeNull();
    expect(formatTarget('create_file', '../outside.ts', ROOT)).toBeNull();
    expect(formatTarget('create_file', path.resolve('/elsewhere/x.ts'), ROOT)).toBeNull();
    expect(formatTarget('create_file', '', ROOT)).toBeNull();
    expect(formatTarget('create_file', 42, ROOT)).toBeNull();
  });

  it('keeps the edit-tool list normalised', () => {
    for (const entry of EDIT_TOOLS) expect(entry).toMatch(/^[a-z0-9]+$/u);
  });
});
