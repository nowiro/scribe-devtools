// withDeadline turns a hanging page call into a failed STEP; degradeTo turns it into an empty
// capture. Both must clear their timer — a live timer kept the client alive after the answer.
import { describe, expect, it } from 'vitest';

import { DeadlineError, degradeTo, isDeadline, withDeadline } from '../src/deadline.mjs';

const later = (/** @type {number} */ ms, /** @type {any} */ value) =>
  new Promise((resolve) => setTimeout(() => resolve(value), ms));

describe('withDeadline', () => {
  it('passes a value that arrives in time', async () => {
    await expect(withDeadline(later(5, 'ok'), 500, 'fast')).resolves.toBe('ok');
  });

  it('rejects with a DeadlineError naming the label and the budget', async () => {
    const pending = new Promise(() => {});
    const error = await withDeadline(pending, 20, 'evaluate "krok-po"').catch((e) => e);
    expect(error).toBeInstanceOf(DeadlineError);
    expect(error.message).toBe('evaluate "krok-po" timed out after 20ms');
    expect(error.code).toBe('E_DEADLINE');
    expect(isDeadline(error)).toBe(true);
    expect(isDeadline(new Error('x'))).toBe(false);
  });

  it('propagates the original rejection', async () => {
    await expect(withDeadline(Promise.reject(new Error('boom')), 500, 'x')).rejects.toThrow('boom');
  });
});

describe('degradeTo', () => {
  it('returns the fallback on timeout and on rejection, the value otherwise', async () => {
    await expect(degradeTo('fallback', new Promise(() => {}), 10, 'slow')).resolves.toBe('fallback');
    await expect(degradeTo('fallback', Promise.reject(new Error('x')), 10, 'bad')).resolves.toBe('fallback');
    await expect(degradeTo('fallback', later(1, 'value'), 100, 'fine')).resolves.toBe('value');
  });
});
