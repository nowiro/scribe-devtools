import path from 'node:path';
import process from 'node:process';
import { describe, expect, it } from 'vitest';
import { displayCommand, displayPart } from './display-command.mjs';

const REPO = path.resolve('/repo');

describe('displayPart', () => {
  it('shows the running Node binary as `node`', () => {
    expect(displayPart(process.execPath, REPO)).toBe('node');
  });

  it('makes a path under the repository relative, with forward slashes', () => {
    expect(displayPart(path.join(REPO, 'tools', 'scripts', 'x.mjs'), REPO)).toBe('tools/scripts/x.mjs');
  });

  it('leaves a path outside the repository and a relative argument alone', () => {
    const outside = path.resolve('/elsewhere/bin/tool');
    expect(displayPart(outside, REPO)).toBe(outside);
    expect(displayPart('--max-warnings=0', REPO)).toBe('--max-warnings=0');
    expect(displayPart('apps/demo', REPO)).toBe('apps/demo');
  });
});

describe('displayCommand', () => {
  it('joins the displayed parts into one pasteable line', () => {
    const command = [process.execPath, path.join(REPO, 'node_modules', 'eslint', 'bin', 'eslint.js'), 'apps/demo'];
    expect(displayCommand(command, REPO)).toBe('node node_modules/eslint/bin/eslint.js apps/demo');
  });
});
