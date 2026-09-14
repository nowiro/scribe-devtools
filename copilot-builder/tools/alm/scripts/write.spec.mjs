// Tests for the write dispatcher. Same philosophy as read.spec.mjs: what matters is the
// discovery (write pipelines found, never enumerated) and the caller-error paths — the
// pipelines themselves own everything after the spawn.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { E_WRITE_NOT_BUILT, E_WRITE_USAGE, plan } from './write.mjs';

let dist;

/** Builds a synthetic `dist/` holding write (and optionally read-only) pipelines. */
function seed(names, { readOnly = [] } = {}) {
  dist = mkdtempSync(path.join(tmpdir(), 'write-'));
  for (const name of names) {
    const dir = path.join(dist, name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, `write-${name}.js`), '// pipeline\n');
  }
  for (const name of readOnly) {
    const dir = path.join(dist, name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, `read-${name}.js`), '// read-only pipeline\n');
  }
  return dist;
}

afterEach(() => {
  if (dist) rmSync(dist, { recursive: true, force: true });
  dist = undefined;
});

describe('the mode comes first', () => {
  it('no mode at all is a usage error naming both commands', () => {
    seed(['jira']);
    const out = plan({ argv: [], dist });
    expect(out.code).toBe(E_WRITE_USAGE);
    expect(out.exit).toBe(2);
    expect(out.message).toContain('create');
    expect(out.message).toContain('update');
  });

  it('a source where the mode should be is the same usage error — modes are not guessed', () => {
    seed(['jira']);
    const out = plan({ argv: ['jira', 'x.md'], dist });
    expect(out.code).toBe(E_WRITE_USAGE);
    expect(out.exit).toBe(2);
  });

  it('the accepted mode rides into the pipeline args as --mode', () => {
    seed(['jira']);
    const out = plan({ argv: ['update', 'jira', './zadanie.md'], dist });
    expect(out.exit).toBe(0);
    expect(out.mode).toBe('update');
    expect(out.args.slice(1)).toEqual(['--mode', 'update', './zadanie.md']);
  });
});

describe('discovery through the dispatcher', () => {
  it('sees write pipelines and does NOT offer read-only sources for writing', () => {
    seed(['jira', 'gitlab'], { readOnly: ['sonar', 'figma'] });
    const out = plan({ argv: ['create'], dist });
    expect(out.exit).toBe(2);
    expect(out.message).toContain('gitlab, jira');
    expect(out.message).not.toContain('sonar');
  });

  it('an empty dist is "not built", exit 3', () => {
    dist = mkdtempSync(path.join(tmpdir(), 'write-'));
    const out = plan({ argv: ['create', 'jira', 'x.md'], dist });
    expect(out.code).toBe(E_WRITE_NOT_BUILT);
    expect(out.exit).toBe(3);
  });
});

describe('caller errors', () => {
  it('a mode without a source → the list plus a dry-run explanation', () => {
    seed(['jira']);
    const out = plan({ argv: ['create'], dist });
    expect(out.code).toBe(E_WRITE_USAGE);
    expect(out.message).toContain('dry-run');
    expect(out.message).toContain('npm run alm:create -- jira');
  });

  it('unknown source → the list again', () => {
    seed(['jira']);
    const out = plan({ argv: ['update', 'bitbucket', 'x.md'], dist });
    expect(out.exit).toBe(2);
    expect(out.message).toContain('jira');
  });

  it('a source without a file is a usage error — nothing default gets published', () => {
    seed(['jira']);
    const out = plan({ argv: ['create', 'jira'], dist });
    expect(out.exit).toBe(2);
    expect(out.message).toContain('missing input file');
    const flagsOnly = plan({ argv: ['create', 'jira', '--yes'], dist });
    expect(flagsOnly.exit).toBe(2);
  });
});

describe('argument forwarding', () => {
  it('forwards everything after the source verbatim, --yes included, mode in front', () => {
    seed(['jira']);
    const out = plan({ argv: ['create', 'jira', './zadanie.md', '--yes'], dist });
    expect(out.exit).toBe(0);
    expect(out.file).toBe('./zadanie.md');
    expect(out.args.slice(1)).toEqual(['--mode', 'create', './zadanie.md', '--yes']);
  });

  it('a caller-supplied --mode is rejected — it would override the very assertion the command makes', () => {
    seed(['jira']);
    // The dispatcher injects its own `--mode <command>` FIRST and the pipeline lets
    // the last one win, so a `--mode` in the tail would silently defeat the check.
    // It also used to make the scan take the flag's VALUE as the input file.
    const out = plan({ argv: ['create', 'jira', '--mode', 'update', './x.md'], dist });
    expect(out.exit).toBe(2);
    expect(out.message).toContain('the mode IS the command');
    const inline = plan({ argv: ['create', 'jira', '--mode=update', './x.md'], dist });
    expect(inline.exit).toBe(2);
  });
});
