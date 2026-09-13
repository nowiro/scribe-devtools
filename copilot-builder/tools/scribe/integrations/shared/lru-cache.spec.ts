/**
 * Unit tests — the ETag store's TTL + LRU cache.
 *
 * The overwrite-at-capacity case below is the one worth keeping honest: an
 * eviction on overwrite would silently drop a live entry, and the symptom
 * would be a cache that simply misses more often — never an error.
 */
import { describe, expect, it, vi } from 'vitest';

import { LruCache } from './lru-cache.js';

describe('LruCache', () => {
  it('throws on invalid capacity / TTL', () => {
    expect(() => new LruCache(0, 1000)).toThrow(RangeError);
    expect(() => new LruCache(10, 0)).toThrow(RangeError);
  });

  it('stores + retrieves values within TTL', () => {
    const c = new LruCache<number>(10, 60_000);
    c.set('a', 1);
    expect(c.get('a')).toBe(1);
  });

  it('expires entries after TTL', () => {
    vi.useFakeTimers();
    try {
      const c = new LruCache<number>(10, 1000);
      c.set('a', 1);
      vi.advanceTimersByTime(2000);
      expect(c.get('a')).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it('evicts least-recently-used when at capacity', () => {
    const c = new LruCache<number>(2, 60_000);
    c.set('a', 1);
    c.set('b', 2);
    c.get('a'); // mark 'a' as MRU
    c.set('c', 3); // should evict 'b' (LRU)
    expect(c.get('a')).toBe(1);
    expect(c.get('b')).toBeUndefined();
    expect(c.get('c')).toBe(3);
  });

  it('does not evict when overwriting an existing key at capacity', () => {
    const c = new LruCache<number>(2, 60_000);
    c.set('a', 1);
    c.set('b', 2);
    c.set('a', 99); // overwrite — the map does not grow, so nothing may be evicted
    expect(c.get('a')).toBe(99);
    expect(c.get('b')).toBe(2);
  });
});
