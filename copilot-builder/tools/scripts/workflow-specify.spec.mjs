import { describe, expect, it } from 'vitest';
import { VERBS, parseArgs } from './workflow-specify.mjs';

describe('parseArgs', () => {
  it('reads --key=value, --key value and bare flags', () => {
    expect(parseArgs(['--verb=feature', '--slug', 'my-slug', '--title="Human title"', '--draft'])).toEqual({
      verb: 'feature',
      slug: 'my-slug',
      title: '"Human title"',
      draft: true,
    });
  });

  it('does not swallow the next flag as a value', () => {
    expect(parseArgs(['--draft', '--slug=x'])).toEqual({ draft: true, slug: 'x' });
  });

  it('ignores positional arguments', () => {
    expect(parseArgs(['stray', '--verb=fix'])).toEqual({ verb: 'fix' });
  });
});

describe('VERBS', () => {
  it('matches the commit types the SDD ladder distinguishes', () => {
    expect([...VERBS]).toEqual(['feature', 'fix', 'refactor', 'deps', 'chore', 'security', 'docs']);
  });
});
