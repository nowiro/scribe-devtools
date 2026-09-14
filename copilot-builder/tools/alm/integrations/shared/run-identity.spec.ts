// Tests for the run identity: the property that makes correlation WORK is sameness — one
// process, one id, in every header and in the manifest. The property that makes it SAFE is
// sanitization — even our own environment is not trusted to be header-clean.

import { afterEach, describe, expect, it } from 'vitest';

import { getCorrelationId, getRunUser, resetCorrelationIdForTests, sanitizeHeaderValue } from './run-identity.js';

afterEach(() => {
  resetCorrelationIdForTests();
});

describe('sanitizeHeaderValue()', () => {
  it('passes printable ASCII through untouched', () => {
    expect(sanitizeHeaderValue('build-4711/agent_1')).toBe('build-4711/agent_1');
  });

  it('neutralizes CR/LF — the header-injection characters — and control bytes', () => {
    expect(sanitizeHeaderValue('evil\r\nx-injected: 1')).toBe('evil__x-injected: 1');
    // Written with explicit escapes — an invisible literal control byte in the source
    // made this test's subject unreadable.
    expect(sanitizeHeaderValue('a\tb\0c')).toBe('a_b_c');
  });

  it('non-ASCII becomes underscore instead of a rejected request', () => {
    expect(sanitizeHeaderValue('paweł')).toBe('pawe_');
  });

  it('bounds the length', () => {
    expect(sanitizeHeaderValue('x'.repeat(500))).toHaveLength(128);
  });
});

describe('getCorrelationId()', () => {
  it('is memoized — every caller in one process sees the SAME id', () => {
    const first = getCorrelationId({});
    expect(getCorrelationId({})).toBe(first);
  });

  it('defaults to a UUID', () => {
    expect(getCorrelationId({})).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('EXTRACT_CORRELATION_ID injects a caller-supplied id — sanitized, not trusted', () => {
    expect(getCorrelationId({ EXTRACT_CORRELATION_ID: 'ci-4711\r\nx: y' })).toBe('ci-4711__x: y');
  });
});

describe('getRunUser()', () => {
  it('returns a non-empty, header-safe value on this machine', () => {
    const user = getRunUser();
    expect(user.length).toBeGreaterThan(0);
    expect(user).toBe(sanitizeHeaderValue(user));
  });
});
