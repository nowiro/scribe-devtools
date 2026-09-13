import { describe, expect, it } from 'vitest';
import { CODE, STATIC, parseArgs, projectSteps } from './verify.mjs';

describe('parseArgs', () => {
  it('reads the three modes and the base', () => {
    expect(parseArgs([])).toEqual({ static: false, affected: false, full: false });
    expect(parseArgs(['--affected', '--base=origin/dev'])).toEqual({
      static: false,
      affected: true,
      full: false,
      base: 'origin/dev',
    });
    expect(parseArgs(['--full'])).toEqual({ static: false, affected: false, full: true });
    expect(parseArgs(['--static'])).toEqual({ static: true, affected: false, full: false });
  });
});

describe('projectSteps', () => {
  /** @param {ReturnType<typeof projectSteps>} steps */
  const targets = (steps) => steps.map((step) => step.command[2]);

  it('runs typecheck, test and build over every project by default', () => {
    const steps = projectSteps({ affected: false, full: false });
    expect(targets(steps)).toEqual(['typecheck', 'test', 'build']);
    expect(steps[0].command.slice(3)).toEqual(['--all']);
  });

  it('narrows to the affected projects and passes the base through', () => {
    const steps = projectSteps({ affected: true, full: false, base: 'origin/main' });
    expect(targets(steps)).toEqual(['typecheck', 'test']);
    expect(steps[0].command.slice(3)).toEqual(['--base=origin/main']);
    expect(projectSteps({ affected: true, full: false })[0].command.slice(3)).toEqual([]);
  });

  it('builds before e2e in every full run, affected or not', () => {
    expect(targets(projectSteps({ affected: false, full: true }))).toEqual(['typecheck', 'test', 'build', 'e2e']);
    expect(targets(projectSteps({ affected: true, full: true }))).toEqual(['typecheck', 'test', 'build', 'e2e']);
  });

  it('keeps the static gates first and the code gates after them', () => {
    expect(STATIC.length).toBeGreaterThan(5);
    expect(CODE.map((step) => step.label)).toEqual(expect.arrayContaining(['lint']));
    expect(STATIC[0].label).toBe('format:check');
  });
});
