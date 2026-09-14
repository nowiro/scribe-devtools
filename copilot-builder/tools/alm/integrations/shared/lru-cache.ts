/**
 * Tiny TTL + LRU cache, dependency-free. One consumer: the ETag/304 store
 * inside `http-client.ts`, which keeps a bounded number of response bodies so a
 * repeated GET can be answered from a `304 Not Modified` without re-parsing.
 *
 * Scope is a single process and a single {@link HttpClient}. Nothing here is
 * shared between clients and nothing is persisted — a cache that outlives the
 * run would hand a later extract a body that upstream has since changed.
 *
 * This used to live in a `llm-optimize.ts` module alongside four response-
 * shaping helpers written for a tool-call protocol that no longer exists here.
 * Those four had no caller; this one does, so it moved out on its own.
 */

interface LruEntry<V> {
  readonly value: V;
  readonly expiresAt: number;
}

export class LruCache<V> {
  private readonly map = new Map<string, LruEntry<V>>();

  constructor(
    private readonly capacity: number,
    // Plain `ttlMs` — the 'default' in the old name promised a per-set override
    // that the trimmed surface deliberately no longer has.
    private readonly ttlMs: number,
  ) {
    if (!Number.isFinite(capacity) || capacity <= 0) {
      throw new RangeError('LruCache: capacity must be a positive integer');
    }
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
      throw new RangeError('LruCache: ttlMs must be positive');
    }
  }

  get(key: string): V | undefined {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt < Date.now()) {
      this.map.delete(key);
      return undefined;
    }
    // Mark as most-recently-used.
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.value;
  }

  set(key: string, value: V): void {
    // A re-set key is deleted first so the insert moves it to the BACK of the
    // Map's order — overwriting in place kept its old position, and the next
    // eviction could throw out the just-refreshed entry as the 'oldest'.
    if (this.map.has(key)) {
      this.map.delete(key);
    } else if (this.map.size >= this.capacity) {
      // Evict the oldest (Map preserves insertion order).
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
    this.map.set(key, {
      value,
      expiresAt: Date.now() + this.ttlMs,
    });
  }

  // No has()/size()/clear() and no per-set TTL: the single consumer uses get and
  // 2-arg set, and the wider general-cache surface had to stay correct for nobody
  // — has() even bumped recency as a hidden side effect, a trap for any caller
  // probing before insert.
}
