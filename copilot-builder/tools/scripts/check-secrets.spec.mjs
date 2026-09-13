import { describe, expect, it } from 'vitest';
import { PATTERNS, findSecrets } from './check-secrets.mjs';

describe('findSecrets', () => {
  it('flags the token shapes this repository could leak', () => {
    const text = [
      'JIRA_TOKEN=ATATT3xFfGF0abcdefghijklmnopqrstuvwxyz0123456789', // secrets:ignore
      'glpat-abcdefghijklmnopqrstuvwx', // secrets:ignore
      'ghp_abcdefghijklmnopqrstuvwxyzABCDEFGHIJ0123', // secrets:ignore
      'xoxb-123456789012-abcdefghijkl', // secrets:ignore
      'AKIAABCDEFGHIJKLMNOP', // secrets:ignore
      '-----BEGIN RSA PRIVATE KEY-----', // secrets:ignore
      'const password = "correct-horse-battery-staple-2024";', // secrets:ignore
    ].join('\n');
    const findings = findSecrets(text.replaceAll(' // secrets:ignore', ''), 'x');
    expect(findings).toHaveLength(7);
    expect(findings[0]).toBe('x:1 · Atlassian API token');
    expect(findings[6]).toBe('x:7 · credential assignment');
  });

  it('ignores placeholders, short values and lines marked secrets:ignore', () => {
    const text = [
      'password: "<your-password>"',
      'api_key = "xxxxxxxxxxxxxxxxxxxxxxxx"',
      'token: "example-token-value-here-1234"',
      'secret = "short"',
      'glpat-abcdefghijklmnopqrstuvwx is the shape of a GitLab token — secrets:ignore',
      'JIRA_TOKEN=${JIRA_TOKEN}',
    ].join('\n');
    expect(findSecrets(text)).toEqual([]);
  });

  it('reports one finding per line at most', () => {
    expect(findSecrets('ghp_abcdefghijklmnopqrstuvwxyzABCDEFGHIJ0123 glpat-abcdefghijklmnopqrstuvwx')).toHaveLength(1); // secrets:ignore
    expect(PATTERNS.length).toBeGreaterThanOrEqual(7);
  });
});
