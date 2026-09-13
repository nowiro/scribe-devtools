import { describe, expect, it } from 'vitest';
import { STAMP_TIMEZONE, nowStamp, stampToEpoch } from './stamp.mjs';

describe('nowStamp', () => {
  it('renders the wall-clock time of the repository time zone, winter offset', () => {
    // 23:30 UTC on 15 January is 00:30 on 16 January in Europe/Warsaw (UTC+1)
    expect(nowStamp(new Date(Date.UTC(2026, 0, 15, 23, 30)), 'Europe/Warsaw')).toBe('2026-01-16_00-30');
  });

  it('renders the summer offset', () => {
    // 12:00 UTC on 1 July is 14:00 in Europe/Warsaw (UTC+2)
    expect(nowStamp(new Date(Date.UTC(2026, 6, 1, 12, 0)), 'Europe/Warsaw')).toBe('2026-07-01_14-00');
  });

  it('never prints hour 24 for midnight', () => {
    expect(nowStamp(new Date(Date.UTC(2026, 2, 1, 23, 5)), 'Europe/Warsaw')).toBe('2026-03-02_00-05');
  });

  it('defaults to the repository time zone', () => {
    const at = new Date(Date.UTC(2026, 6, 1, 12, 0));
    expect(nowStamp(at)).toBe(nowStamp(at, STAMP_TIMEZONE));
  });
});

describe('stampToEpoch', () => {
  it('is the inverse of nowStamp', () => {
    const epoch = Date.UTC(2026, 0, 15, 23, 30);
    expect(stampToEpoch(2026, 1, 16, 0, 30, 'Europe/Warsaw')).toBe(epoch);
    expect(stampToEpoch(2026, 7, 1, 14, 0, 'Europe/Warsaw')).toBe(Date.UTC(2026, 6, 1, 12, 0));
  });

  it('orders stamps chronologically across the DST switch', () => {
    const before = stampToEpoch(2026, 3, 29, 1, 30, 'Europe/Warsaw');
    const after = stampToEpoch(2026, 3, 29, 3, 30, 'Europe/Warsaw');
    expect(after).toBeGreaterThan(before);
  });
});
