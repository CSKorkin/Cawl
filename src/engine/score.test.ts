import { describe, it, expect } from 'vitest';
import {
  ATLAS_TIERS,
  applyTableModifier,
  applyVariance,
  colorBand,
  compare,
  generate,
  invert,
  invertModifier,
  tableModifierDelta,
} from './score.js';
import type { AtlasTier, Score, TableModifier } from './score.js';
import { seed } from './rng.js';

describe('score.compare', () => {
  it('returns -1 / 0 / 1 for standard scores', () => {
    const a: Score = { mode: 'standard', value: 5 };
    const b: Score = { mode: 'standard', value: 10 };
    expect(compare(a, b)).toBe(-1);
    expect(compare(b, a)).toBe(1);
    expect(compare(a, { mode: 'standard', value: 5 })).toBe(0);
  });

  it('returns -1 / 0 / 1 for atlas scores', () => {
    const a: Score = { mode: 'atlas', value: 2 };
    const b: Score = { mode: 'atlas', value: 4 };
    expect(compare(a, b)).toBe(-1);
    expect(compare(b, a)).toBe(1);
    expect(compare(a, { mode: 'atlas', value: 2 })).toBe(0);
  });

  it('throws TypeError on cross-mode comparison', () => {
    const std: Score = { mode: 'standard', value: 5 };
    const atlas: Score = { mode: 'atlas', value: 3 };
    expect(() => compare(std, atlas)).toThrow(TypeError);
    expect(() => compare(atlas, std)).toThrow(TypeError);
  });
});

// ── invert ───────────────────────────────────────────────────────────────────
//
// Inverts a score around the midpoint of its mode. Models WTC's split scoring:
// each cell is one team's expected share of a fixed 20-point total (or atlas
// 6-tier total), so the OTHER team's expected share is the complement.

describe('score.invert (standard)', () => {
  it.each([
    [0, 20],
    [4, 16],
    [10, 10],
    [12, 8],
    [18, 2],
    [20, 0],
  ] as const)('inverts %i → %i (sum to 20)', (input, expected) => {
    expect(invert({ mode: 'standard', value: input })).toEqual({ mode: 'standard', value: expected });
  });

  it('is an involution — invert(invert(s)) === s', () => {
    for (let v = 0; v <= 20; v++) {
      const s: Score = { mode: 'standard', value: v };
      expect(invert(invert(s))).toEqual(s);
    }
  });
});

describe('score.invert (atlas)', () => {
  it.each([
    [1,   5],
    [2,   4],
    [2.5, 3.5],
    [3,   3],
    [3.5, 2.5],
    [4,   2],
    [5,   1],
  ] as const)('tier %f → tier %f (each pair sums to 6)', (input, expected) => {
    expect(invert({ mode: 'atlas', value: input as AtlasTier }))
      .toEqual({ mode: 'atlas', value: expected as AtlasTier });
  });

  it('is an involution — invert(invert(t)) === t for every atlas tier', () => {
    for (const t of ATLAS_TIERS) {
      const s: Score = { mode: 'atlas', value: t };
      expect(invert(invert(s))).toEqual(s);
    }
  });
});

describe('score.colorBand (standard)', () => {
  it.each([
    [0, 'red'],
    [4, 'red'],
    [5, 'orange'],
    [8, 'orange'],
    [9, 'yellow'],
    [11, 'yellow'],
    [12, 'lightGreen'],
    [15, 'lightGreen'],
    [16, 'darkGreen'],
    [20, 'darkGreen'],
  ] as const)('value %i → %s', (value, band) => {
    expect(colorBand({ mode: 'standard', value })).toBe(band);
  });
});

describe('score.colorBand (atlas)', () => {
  it.each([
    [1, 'red'],
    [2, 'orange'],
    [2.5, 'yellow'],
    [3, 'yellow'],
    [3.5, 'yellow'],
    [4, 'lightGreen'],
    [5, 'darkGreen'],
  ] as const)('tier %f → %s', (tier, band) => {
    expect(colorBand({ mode: 'atlas', value: tier as AtlasTier })).toBe(band);
  });
});

describe('score.applyVariance (standard)', () => {
  it('keeps results in [0, 20] across 10000 starts × draws', () => {
    let s = seed(42);
    for (let i = 0; i < 10000; i++) {
      const startR = { state: s, value: i % 21 };
      s = startR.state;
      const r = applyVariance(
        { mode: 'standard', value: startR.value },
        s,
      );
      s = r.state;
      if (r.value.mode !== 'standard') throw new Error('mode mismatch');
      expect(r.value.value).toBeGreaterThanOrEqual(0);
      expect(r.value.value).toBeLessThanOrEqual(20);
    }
  });

  it('clamps at low end (0 stays in [0, 3])', () => {
    let s = seed(123);
    const observed = new Set<number>();
    for (let i = 0; i < 500; i++) {
      const r = applyVariance({ mode: 'standard', value: 0 }, s);
      s = r.state;
      if (r.value.mode === 'standard') observed.add(r.value.value);
    }
    for (const v of observed) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(3);
    }
    expect(observed.has(0)).toBe(true);
    expect(observed.has(3)).toBe(true);
  });

  it('clamps at high end (20 stays in [17, 20])', () => {
    let s = seed(123);
    const observed = new Set<number>();
    for (let i = 0; i < 500; i++) {
      const r = applyVariance({ mode: 'standard', value: 20 }, s);
      s = r.state;
      if (r.value.mode === 'standard') observed.add(r.value.value);
    }
    for (const v of observed) {
      expect(v).toBeGreaterThanOrEqual(17);
      expect(v).toBeLessThanOrEqual(20);
    }
    expect(observed.has(17)).toBe(true);
    expect(observed.has(20)).toBe(true);
  });

  it('interior values produce all 7 outcomes (-3..+3)', () => {
    let s = seed(123);
    const observed = new Set<number>();
    for (let i = 0; i < 1000; i++) {
      const r = applyVariance({ mode: 'standard', value: 10 }, s);
      s = r.state;
      if (r.value.mode === 'standard') observed.add(r.value.value);
    }
    expect(observed).toEqual(new Set([7, 8, 9, 10, 11, 12, 13]));
  });
});

describe('score.applyVariance (atlas) — exhaustive tier set tests', () => {
  function observeFor(tier: AtlasTier): Set<AtlasTier> {
    let s = seed(123);
    const seen = new Set<AtlasTier>();
    for (let i = 0; i < 500; i++) {
      const r = applyVariance({ mode: 'atlas', value: tier }, s);
      s = r.state;
      if (r.value.mode === 'atlas') seen.add(r.value.value);
    }
    return seen;
  }

  it('tier 1 varies to {1, 2} (clamped low)', () => {
    expect(observeFor(1)).toEqual(new Set([1, 2]));
  });

  it('tier 2 varies to {1, 2, 2.5}', () => {
    expect(observeFor(2)).toEqual(new Set([1, 2, 2.5]));
  });

  it('tier 2.5 varies to {2, 2.5, 3}', () => {
    expect(observeFor(2.5)).toEqual(new Set([2, 2.5, 3]));
  });

  it('tier 3 varies to {2.5, 3, 3.5}', () => {
    expect(observeFor(3)).toEqual(new Set([2.5, 3, 3.5]));
  });

  it('tier 3.5 varies to {3, 3.5, 4}', () => {
    expect(observeFor(3.5)).toEqual(new Set([3, 3.5, 4]));
  });

  it('tier 4 varies to {3.5, 4, 5}', () => {
    expect(observeFor(4)).toEqual(new Set([3.5, 4, 5]));
  });

  it('tier 5 varies to {4, 5} (clamped high)', () => {
    expect(observeFor(5)).toEqual(new Set([4, 5]));
  });

  it('never moves more than one ordinal step', () => {
    let s = seed(42);
    for (let i = 0; i < 1000; i++) {
      const startTier = ATLAS_TIERS[i % ATLAS_TIERS.length]!;
      const r = applyVariance({ mode: 'atlas', value: startTier }, s);
      s = r.state;
      if (r.value.mode !== 'atlas') throw new Error('mode mismatch');
      const startIdx = ATLAS_TIERS.indexOf(startTier);
      const endIdx = ATLAS_TIERS.indexOf(r.value.value);
      expect(Math.abs(endIdx - startIdx)).toBeLessThanOrEqual(1);
    }
  });
});

describe('score.generate', () => {
  it('is deterministic for a fixed seed (standard)', () => {
    const s = seed(0xcafe);
    expect(generate(s, 'standard')).toEqual(generate(s, 'standard'));
  });

  it('is deterministic for a fixed seed (atlas)', () => {
    const s = seed(0xcafe);
    expect(generate(s, 'atlas')).toEqual(generate(s, 'atlas'));
  });

  it('produces only standard values in [0, 20]', () => {
    let s = seed(42);
    for (let i = 0; i < 1000; i++) {
      const r = generate(s, 'standard');
      s = r.state;
      if (r.value.mode !== 'standard') throw new Error('mode mismatch');
      expect(r.value.value).toBeGreaterThanOrEqual(0);
      expect(r.value.value).toBeLessThanOrEqual(20);
      expect(Number.isInteger(r.value.value)).toBe(true);
    }
  });

  it('produces only valid atlas tiers', () => {
    let s = seed(42);
    const tierSet = new Set<number>(ATLAS_TIERS);
    for (let i = 0; i < 1000; i++) {
      const r = generate(s, 'atlas');
      s = r.state;
      if (r.value.mode !== 'atlas') throw new Error('mode mismatch');
      expect(tierSet.has(r.value.value)).toBe(true);
    }
  });

  it('honors custom mean/stdev params (standard)', () => {
    // mean=20, stdev=0 → Box-Muller still draws but result clamps to 20.
    const r = generate(seed(42), 'standard', { mean: 20, stdev: 0 });
    if (r.value.mode === 'standard') expect(r.value.value).toBe(20);
  });

  it('honors custom mean/stdev params (atlas)', () => {
    // mean=5, stdev=0 → snap to nearest tier of 5.
    const r = generate(seed(42), 'atlas', { mean: 5, stdev: 0 });
    if (r.value.mode === 'atlas') expect(r.value.value).toBe(5);
  });

  it('produces pinned values for seed 0xCAFE — standard (regression canary)', () => {
    let s = seed(0xcafe);
    const draws: number[] = [];
    for (let i = 0; i < 5; i++) {
      const r = generate(s, 'standard');
      s = r.state;
      if (r.value.mode === 'standard') draws.push(r.value.value);
    }
    expect(draws).toEqual([6, 3, 6, 9, 11]);
  });

  it('produces pinned values for seed 0xCAFE — atlas (regression canary)', () => {
    let s = seed(0xcafe);
    const draws: number[] = [];
    for (let i = 0; i < 5; i++) {
      const r = generate(s, 'atlas');
      s = r.state;
      if (r.value.mode === 'atlas') draws.push(r.value.value);
    }
    expect(draws).toEqual([2, 1, 2, 3, 3]);
  });
});

// ── invertModifier ───────────────────────────────────────────────────────────
//
// Symbolic inversion of a per-table modifier. WTC matchups split a fixed
// total, so a friendly-favoring impact ('+', '++') for one team is a hostile
// impact ('-', '--') from the other team's perspective. The mapping is
// pairwise: '+' ↔ '-' and '++' ↔ '--'. Numeric values never come into it —
// the score-side inversion already handles the matchup share split.

describe('score.invertModifier', () => {
  it.each([
    ['+',  '-'],
    ['-',  '+'],
    ['++', '--'],
    ['--', '++'],
  ] as const)('inverts %s → %s', (input, expected) => {
    expect(invertModifier(input)).toBe(expected);
  });

  it('is an involution — invertModifier(invertModifier(m)) === m', () => {
    const all: readonly TableModifier[] = ['+', '++', '-', '--'];
    for (const m of all) {
      expect(invertModifier(invertModifier(m))).toBe(m);
    }
  });
});

// ── tableModifierDelta ───────────────────────────────────────────────────────
//
// Returns the unclamped signed delta for a modifier symbol in the given
// scoring mode. Used by `tableChoiceScoreModifier` (in state.ts) to record a
// numeric form of the modifier on each Pairing when LOCK_IN_TABLE fires.

describe('score.tableModifierDelta (standard)', () => {
  it.each([
    ['+',   3],
    ['++',  6],
    ['-',  -3],
    ['--', -6],
  ] as const)('symbol %s → %i', (mod, expected) => {
    expect(tableModifierDelta(mod, 'standard')).toBe(expected);
  });
});

describe('score.tableModifierDelta (atlas)', () => {
  it.each([
    ['+',   1],
    ['++',  2],
    ['-',  -1],
    ['--', -2],
  ] as const)('symbol %s → %i', (mod, expected) => {
    expect(tableModifierDelta(mod, 'atlas')).toBe(expected);
  });
});

// ── applyTableModifier (standard) ────────────────────────────────────────────
//
// Standard: '+' = +3, '++' = +6, '-' = -3, '--' = -6, clamped to [0, 20].

describe('score.applyTableModifier (standard)', () => {
  it.each([
    [10, '+',  13],
    [10, '++', 16],
    [10, '-',   7],
    [10, '--',  4],
    [ 0, '+',   3],
    [20, '-',  17],
  ] as const)('value %i with %s → %i', (input, mod, expected) => {
    expect(applyTableModifier({ mode: 'standard', value: input }, mod))
      .toEqual({ mode: 'standard', value: expected });
  });

  it('clamps at the low end on negative modifiers', () => {
    expect(applyTableModifier({ mode: 'standard', value: 2 }, '-'))
      .toEqual({ mode: 'standard', value: 0 });
    expect(applyTableModifier({ mode: 'standard', value: 5 }, '--'))
      .toEqual({ mode: 'standard', value: 0 });
    expect(applyTableModifier({ mode: 'standard', value: 0 }, '--'))
      .toEqual({ mode: 'standard', value: 0 });
  });

  it('clamps at the high end on positive modifiers', () => {
    expect(applyTableModifier({ mode: 'standard', value: 18 }, '+'))
      .toEqual({ mode: 'standard', value: 20 });
    expect(applyTableModifier({ mode: 'standard', value: 15 }, '++'))
      .toEqual({ mode: 'standard', value: 20 });
    expect(applyTableModifier({ mode: 'standard', value: 20 }, '++'))
      .toEqual({ mode: 'standard', value: 20 });
  });
});

// ── applyTableModifier (atlas) ───────────────────────────────────────────────
//
// Atlas: '+' / '++' / '-' / '--' = +1 / +2 / -1 / -2 ordinal steps on
// ATLAS_TIERS, clamped at the ends. "One step" means the adjacent tier
// regardless of numeric distance — same convention as applyVariance.

describe('score.applyTableModifier (atlas)', () => {
  it.each([
    [3,   '+',  3.5],
    [3,   '++', 4],
    [3,   '-',  2.5],
    [3,   '--', 2],
    [2.5, '+',  3],
    [2.5, '-',  2],
    [3.5, '+',  4],
    [3.5, '-',  3],
  ] as const)('tier %f with %s → tier %f', (input, mod, expected) => {
    expect(applyTableModifier(
      { mode: 'atlas', value: input as AtlasTier },
      mod,
    )).toEqual({ mode: 'atlas', value: expected as AtlasTier });
  });

  it('clamps at the low end of the tier set', () => {
    expect(applyTableModifier({ mode: 'atlas', value: 1 }, '-'))
      .toEqual({ mode: 'atlas', value: 1 });
    expect(applyTableModifier({ mode: 'atlas', value: 1 }, '--'))
      .toEqual({ mode: 'atlas', value: 1 });
    expect(applyTableModifier({ mode: 'atlas', value: 2 }, '--'))
      .toEqual({ mode: 'atlas', value: 1 });
  });

  it('clamps at the high end of the tier set', () => {
    expect(applyTableModifier({ mode: 'atlas', value: 5 }, '+'))
      .toEqual({ mode: 'atlas', value: 5 });
    expect(applyTableModifier({ mode: 'atlas', value: 5 }, '++'))
      .toEqual({ mode: 'atlas', value: 5 });
    expect(applyTableModifier({ mode: 'atlas', value: 4 }, '++'))
      .toEqual({ mode: 'atlas', value: 5 });
  });

  it('moves exactly one ordinal step for + / -', () => {
    for (let i = 0; i < ATLAS_TIERS.length; i++) {
      const tier = ATLAS_TIERS[i]!;
      const plus = applyTableModifier({ mode: 'atlas', value: tier }, '+');
      const minus = applyTableModifier({ mode: 'atlas', value: tier }, '-');
      if (plus.mode !== 'atlas' || minus.mode !== 'atlas') {
        throw new Error('mode mismatch');
      }
      const expectedPlusIdx = Math.min(i + 1, ATLAS_TIERS.length - 1);
      const expectedMinusIdx = Math.max(i - 1, 0);
      expect(plus.value).toBe(ATLAS_TIERS[expectedPlusIdx]);
      expect(minus.value).toBe(ATLAS_TIERS[expectedMinusIdx]);
    }
  });

  it('moves exactly two ordinal steps for ++ / --', () => {
    for (let i = 0; i < ATLAS_TIERS.length; i++) {
      const tier = ATLAS_TIERS[i]!;
      const plusplus = applyTableModifier({ mode: 'atlas', value: tier }, '++');
      const minusminus = applyTableModifier({ mode: 'atlas', value: tier }, '--');
      if (plusplus.mode !== 'atlas' || minusminus.mode !== 'atlas') {
        throw new Error('mode mismatch');
      }
      const expectedPlusIdx = Math.min(i + 2, ATLAS_TIERS.length - 1);
      const expectedMinusIdx = Math.max(i - 2, 0);
      expect(plusplus.value).toBe(ATLAS_TIERS[expectedPlusIdx]);
      expect(minusminus.value).toBe(ATLAS_TIERS[expectedMinusIdx]);
    }
  });
});
