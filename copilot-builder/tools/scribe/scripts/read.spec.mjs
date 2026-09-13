// Tests for the read pipeline dispatcher.
//
// The heart of this script is not spawning a process, but the fact that the source list is
// **discovered** rather than written down. That is why the tests work on a synthetic `dist/`: they
// check that a new directory becomes visible without touching the code, and that a directory which
// does not look like a pipeline does not.
//
// The reason stated plainly: in this repository a list enumerating sources by name failed
// three times (vitest `include`, both `tsconfig` files, the previous version of the dispatcher) and
// every time silently.

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { DIST, E_READ_NOT_BUILT, E_READ_USAGE, discoverPipelines, plan } from './read.mjs';

let dist;

/** Builds a synthetic `dist/` with the given sources. */
function seed(names, { broken = [] } = {}) {
  dist = mkdtempSync(path.join(tmpdir(), 'read-'));
  for (const name of names) {
    const dir = path.join(dist, name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, `read-${name}.js`), '// pipeline\n');
  }
  for (const name of broken) {
    mkdirSync(path.join(dist, name), { recursive: true });
  }
  return dist;
}

afterEach(() => {
  if (dist) rmSync(dist, { recursive: true, force: true });
  dist = undefined;
});

describe('pipeline discovery', () => {
  it('sees every directory that holds a read-<name>.js file', () => {
    seed(['jira', 'figma', 'sonar']);
    expect(discoverPipelines(dist).map((p) => p.name)).toEqual(['figma', 'jira', 'sonar']);
  });

  it('a new source is visible without a code change — that was the point', () => {
    seed(['jira']);
    expect(discoverPipelines(dist).map((p) => p.name)).toEqual(['jira']);
    const dir = path.join(dist, 'bitbucket');
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'read-bitbucket.js'), '// pipeline\n');
    expect(discoverPipelines(dist).map((p) => p.name)).toEqual(['bitbucket', 'jira']);
  });

  it('skips `shared` — it is not a source, even though it has read-runtime.js', () => {
    seed(['jira']);
    const dir = path.join(dist, 'shared');
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'read-shared.js'), '// not a pipeline\n');
    expect(discoverPipelines(dist).map((p) => p.name)).toEqual(['jira']);
  });

  it('skips a directory without a pipeline file instead of promising a command that will fail', () => {
    seed(['jira'], { broken: ['halfbuilt'] });
    expect(discoverPipelines(dist).map((p) => p.name)).toEqual(['jira']);
  });

  it('sorts deterministically so the help message does not change between runs', () => {
    seed(['sonar', 'confluence', 'jira']);
    const names = discoverPipelines(dist).map((p) => p.name);
    expect(names).toEqual([...names].sort());
  });
});

describe('source selection', () => {
  it('with no argument it prints what is available and ends in STOP-AND-ASK', () => {
    seed(['jira', 'figma']);
    const out = plan({ argv: [], dist });
    expect(out.code).toBe(E_READ_USAGE);
    expect(out.exit).toBe(2);
    expect(out.message).toContain('figma, jira');
    // The README calls the argument a "source"; the tool used to answer "pick an
    // integration". Pinned here so the two cannot drift apart again.
    expect(out.message).toContain('pick a source');
    expect(out.message).not.toMatch(/integration/i);
  });

  it('the usage example is an npm command a reader can actually run', () => {
    seed(['jira']);
    const out = plan({ argv: [], dist });
    expect(out.message).toContain('npm run alm:read -- jira');
  });

  it('an unknown source also prints the list, instead of a bare "not found"', () => {
    seed(['jira']);
    const out = plan({ argv: ['bitbucket'], dist });
    expect(out.exit).toBe(2);
    expect(out.message).toContain('bitbucket');
    expect(out.message).toContain('jira');
  });

  it('the default config path follows the pipeline convention', () => {
    seed(['figma']);
    expect(plan({ argv: ['figma'], dist }).config).toBe('./read.config.figma.json');
  });

  it('an explicit config path takes precedence', () => {
    seed(['figma']);
    expect(plan({ argv: ['figma', './other.json'], dist }).config).toBe('./other.json');
  });

  it('an empty dist is "step not built", not "wrong name"', () => {
    dist = mkdtempSync(path.join(tmpdir(), 'read-'));
    const out = plan({ argv: ['figma'], dist });
    expect(out.code).toBe(E_READ_NOT_BUILT);
    expect(out.exit).toBe(3);
    expect(out.message).toContain('build');
  });
});

describe('the default dist path', () => {
  // This test exists because of a real regression: the scripts moved from `tools/scripts/` up to
  // `scripts/`, and the repo root was computed by counting `..` segments. The count stayed, so
  // ROOT pointed one level ABOVE the repository and `npm run alm:read` reported zero pipelines
  // right after a successful build. Every other test passes `dist` explicitly, so none of them
  // touched the default — the whole class of "the path constant is off" was untested.
  it('points inside the repository, at a directory that a build can produce', () => {
    const root = path.resolve(DIST, '..');
    // The tool lives in tools/scribe of a larger repository: its root is the directory that holds
    // the integrations sources, not a package manifest (the root package.json declares its dependencies).
    expect(existsSync(path.join(root, 'integrations', 'tsconfig.json'))).toBe(true);
    expect(DIST.split(/[/\\]/).slice(-1)).toEqual(['dist']);
  });
});

describe('argument forwarding', () => {
  it('forwards every flag after the source name, not just the config path', () => {
    // Only `rest[0]` used to reach the pipeline, so `--stamp` — the one knob that
    // makes a run reproducible — was unreachable through `npm run alm:read`.
    const dist = seed(['jira']);
    const decision = plan({ argv: ['jira', 'c.json', '--stamp', '2026-08-23_12-00'], dist });
    expect(decision.exit).toBe(0);
    expect(decision.args.slice(1)).toEqual(['c.json', '--stamp', '2026-08-23_12-00']);
  });

  it('predicts the default config path when only flags are given, and injects nothing', () => {
    const dist = seed(['jira']);
    const decision = plan({ argv: ['jira', '--stamp', '2026-08-23_12-00'], dist });
    expect(decision.config).toBe('./read.config.jira.json');
    // Verbatim: injecting the default would win the pipeline's "first positional" race.
    expect(decision.args.slice(1)).toEqual(['--stamp', '2026-08-23_12-00']);
  });

  it('finds a config path that comes AFTER a flag, instead of running the default', () => {
    const dist = seed(['jira']);
    const decision = plan({ argv: ['jira', '--stamp', '2026-08-23_12-00', 'mine.json'], dist });
    expect(decision.config).toBe('mine.json');
    expect(decision.args.slice(1)).toEqual(['--stamp', '2026-08-23_12-00', 'mine.json']);
  });

  it('does not mistake a flag value for the config path', () => {
    const dist = seed(['jira']);
    expect(plan({ argv: ['jira', '--stamp', '2026-08-23_12-00'], dist }).config).toBe('./read.config.jira.json');
    expect(plan({ argv: ['jira', '--stamp=2026-08-23_12-00'], dist }).config).toBe('./read.config.jira.json');
  });

  it('honours --config in both forms', () => {
    const dist = seed(['jira']);
    expect(plan({ argv: ['jira', '--config', 'a.json'], dist }).config).toBe('a.json');
    expect(plan({ argv: ['jira', '--config=b.json'], dist }).config).toBe('b.json');
  });

  it('--config wins over an EARLIER positional — the pipelines resolve it that way too', () => {
    const dist = seed(['jira']);
    // The dispatcher and parseReadArgs must agree, or the existence check
    // validates one file while the pipeline reads another.
    expect(plan({ argv: ['jira', 'b.json', '--config', 'a.json'], dist }).config).toBe('a.json');
  });

  it('a DUPLICATED --config resolves to the LAST one — the same way parseReadArgs does', () => {
    const dist = seed(['jira']);
    // Returning on the first occurrence made the dispatcher existence-check a.json
    // while the pipeline read b.json.
    expect(plan({ argv: ['jira', '--config', 'a.json', '--config', 'b.json'], dist }).config).toBe('b.json');
  });

  it('an explicit empty --config= stays empty for the caller to reject, never the repo root', () => {
    const dist = seed(['jira']);
    // '' used to resolve against ROOT — a directory that always exists — so the
    // missing-config guard passed vacuously and the pipeline died on a raw ENOENT.
    expect(plan({ argv: ['jira', '--config='], dist }).config).toBe('');
  });

  it('an unpredictable input — unknown flag or value-less flag — makes NO prediction', () => {
    const dist = seed(['jira']);
    // `--stmap X` used to promote X to the predicted config, so the dispatcher's
    // 'missing config file X' masked the pipeline's accurate 'unknown flag' error;
    // undefined skips the pre-flight and lets the pipeline answer by name.
    expect(plan({ argv: ['jira', '--stmap', 'X'], dist }).config).toBeUndefined();
    expect(plan({ argv: ['jira', '--config'], dist }).config).toBeUndefined();
    expect(plan({ argv: ['jira', '--stamp'], dist }).config).toBeUndefined();
  });
});
