import { describe, it, expect } from 'vitest';
import { seed, next, nextFloat, nextInt, pick, shuffle } from './rng.js';
import type { RngState } from './rng.js';

describe('rng.seed', () => {
  it('puts the seed into both seed and cursor fields', () => {
    expect(seed(42)).toEqual({ seed: 42, cursor: 42 });
  });

  it('normalizes inputs to 32-bit signed integers', () => {
    // 2^32 wraps to 0
    expect(seed(0x1_0000_0000)).toEqual({ seed: 0, cursor: 0 });
    // 0xFFFFFFFF is -1 in signed 32-bit
    expect(seed(0xffff_ffff)).toEqual({ seed: -1, cursor: -1 });
  });
});

describe('rng.next', () => {
  it('does not mutate the input state', () => {
    const before = seed(42);
    const snapshot = { ...before };
    next(before);
    expect(before).toEqual(snapshot);
  });

  it('round-trips the new state through JSON', () => {
    const draw = next(seed(42));
    const reparsed = JSON.parse(JSON.stringify(draw.state)) as RngState;
    expect(reparsed).toEqual(draw.state);
    expect(next(reparsed)).toEqual(next(draw.state));
  });

  it('preserves the original seed across advances', () => {
    let s = seed(12345);
    for (let i = 0; i < 50; i++) {
      s = next(s).state;
      expect(s.seed).toBe(12345);
    }
  });

  it('produces a stable hash over 1024 draws (regression canary)', () => {
    let s = seed(0xc4c4_c4c4 | 0);
    let acc = 0;
    for (let i = 0; i < 1024; i++) {
      const r = next(s);
      acc = (acc + r.value) >>> 0;
      s = r.state;
    }
    expect(acc).toBe(3_067_597_626);
  });
});

describe('rng.nextFloat', () => {
  it('returns values in [0, 1) over 10000 draws', () => {
    let s = seed(42);
    for (let i = 0; i < 10000; i++) {
      const r = nextFloat(s);
      expect(r.value).toBeGreaterThanOrEqual(0);
      expect(r.value).toBeLessThan(1);
      s = r.state;
    }
  });
});

describe('rng.nextInt', () => {
  it('returns values in [lo, hi] inclusive over 10000 draws', () => {
    let s = seed(42);
    for (let i = 0; i < 10000; i++) {
      const r = nextInt(s, -7, 13);
      expect(r.value).toBeGreaterThanOrEqual(-7);
      expect(r.value).toBeLessThanOrEqual(13);
      s = r.state;
    }
  });

  it('handles a single-value range', () => {
    expect(nextInt(seed(42), 5, 5).value).toBe(5);
  });

  it('throws RangeError when hi < lo', () => {
    expect(() => nextInt(seed(42), 10, 5)).toThrow(RangeError);
  });

  it('produces all values in the range across enough samples', () => {
    let s = seed(42);
    const observed = new Set<number>();
    for (let i = 0; i < 1000; i++) {
      const r = nextInt(s, 0, 4);
      observed.add(r.value);
      s = r.state;
    }
    expect(observed).toEqual(new Set([0, 1, 2, 3, 4]));
  });
});

describe('rng.pick', () => {
  it('returns an element from the array', () => {
    const arr = ['a', 'b', 'c', 'd'] as const;
    let s = seed(42);
    for (let i = 0; i < 100; i++) {
      const r = pick(s, arr);
      expect(arr).toContain(r.value);
      s = r.state;
    }
  });

  it('throws RangeError on empty array', () => {
    expect(() => pick(seed(42), [])).toThrow(RangeError);
  });
});

describe('rng.shuffle', () => {
  it('returns a permutation of the input', () => {
    const arr = [1, 2, 3, 4, 5, 6, 7, 8];
    const r = shuffle(seed(42), arr);
    expect([...r.value].sort((a, b) => a - b)).toEqual(arr);
  });

  it('does not mutate the input array', () => {
    const arr = [1, 2, 3, 4];
    const snapshot = [...arr];
    shuffle(seed(42), arr);
    expect(arr).toEqual(snapshot);
  });

  it('is deterministic for a fixed seed', () => {
    const arr = [1, 2, 3, 4, 5];
    const a = shuffle(seed(42), arr);
    const b = shuffle(seed(42), arr);
    expect(a.value).toEqual(b.value);
    expect(a.state).toEqual(b.state);
  });

  it('handles single-element and empty arrays', () => {
    const empty = shuffle(seed(42), []);
    expect(empty.value).toEqual([]);
    expect(empty.state).toEqual(seed(42)); // no draws consumed

    const single = shuffle(seed(42), [99]);
    expect(single.value).toEqual([99]);
    expect(single.state).toEqual(seed(42));
  });
});
