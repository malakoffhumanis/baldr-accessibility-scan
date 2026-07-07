import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LRUCache } from './lru-cache.util.js';

describe('LRUCache', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should store and retrieve values', () => {
    const cache = new LRUCache<string>({ maxSize: 3, ttlMs: 60000 });
    cache.set('a', 'alpha');
    expect(cache.get('a')).toBe('alpha');
  });

  it('should return undefined for missing keys', () => {
    const cache = new LRUCache<string>({ maxSize: 3, ttlMs: 60000 });
    expect(cache.get('missing')).toBeUndefined();
  });

  it('should evict oldest entry when maxSize is reached', () => {
    const cache = new LRUCache<string>({ maxSize: 2, ttlMs: 60000 });
    cache.set('a', 'alpha');
    cache.set('b', 'beta');
    cache.set('c', 'gamma'); // evicts 'a'

    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBe('beta');
    expect(cache.get('c')).toBe('gamma');
  });

  it('should promote accessed entries (LRU behavior)', () => {
    const cache = new LRUCache<string>({ maxSize: 2, ttlMs: 60000 });
    cache.set('a', 'alpha');
    cache.set('b', 'beta');

    // Access 'a' to promote it
    cache.get('a');

    // Insert 'c' — should evict 'b' (oldest unused)
    cache.set('c', 'gamma');
    expect(cache.get('a')).toBe('alpha');
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('c')).toBe('gamma');
  });

  it('should expire entries after TTL', () => {
    const cache = new LRUCache<string>({ maxSize: 10, ttlMs: 5000 });
    cache.set('a', 'alpha');

    expect(cache.get('a')).toBe('alpha');

    vi.advanceTimersByTime(5001);
    expect(cache.get('a')).toBeUndefined();
  });

  it('should report correct size', () => {
    const cache = new LRUCache<number>({ maxSize: 5, ttlMs: 60000 });
    expect(cache.size).toBe(0);
    cache.set('x', 1);
    cache.set('y', 2);
    expect(cache.size).toBe(2);
  });

  it('should clear all entries', () => {
    const cache = new LRUCache<number>({ maxSize: 5, ttlMs: 60000 });
    cache.set('x', 1);
    cache.set('y', 2);
    cache.clear();
    expect(cache.size).toBe(0);
    expect(cache.get('x')).toBeUndefined();
  });

  it('has() should return true for existing and false for missing', () => {
    const cache = new LRUCache<string>({ maxSize: 5, ttlMs: 60000 });
    cache.set('a', 'val');
    expect(cache.has('a')).toBe(true);
    expect(cache.has('b')).toBe(false);
  });
});
