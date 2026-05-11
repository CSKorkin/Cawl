// Score abstraction: mode-aware comparator, color bands, variance, generation.
// The two modes (default 0–20 integer "standard" and ordinal "atlas") share
// one API behind this discriminated union, so callers never branch on mode
// outside this module.

import { nextFloat, nextInt } from './rng.js';
import type { RngDraw, RngState } from './rng.js';

export const ATLAS_TIERS = [1, 2, 2.5, 3, 3.5, 4, 5] as const;
export type AtlasTier = (typeof ATLAS_TIERS)[number];

export type ScoreMode = 'standard' | 'atlas';

export type Score =
  | { readonly mode: 'standard'; readonly value: number }
  | { readonly mode: 'atlas'; readonly value: AtlasTier };

export type ColorBand =
  | 'red'
  | 'orange'
  | 'yellow'
  | 'lightGreen'
  | 'darkGreen';

// Per-table impact symbol. A matchup may carry one of these for any subset
// of the 8 tables, shifting the matchup's expected score on that table:
//   '+'  =  +3 in standard / +1 ordinal step in atlas
//   '++' =  +6 in standard / +2 ordinal steps in atlas
//   '-'  =  -3 in standard / -1 ordinal step in atlas
//   '--' =  -6 in standard / -2 ordinal steps in atlas
// All transforms clamp at the mode's bounds.
export type TableModifier = '+' | '++' | '-' | '--';

export interface GenerateParams {
  readonly mean?: number;
  readonly stdev?: number;
}

export const STANDARD_MIN = 0;
export const STANDARD_MAX = 20;
const STANDARD_VARIANCE = 3;

export function compare(a: Score, b: Score): -1 | 0 | 1 {
  if (a.mode !== b.mode) {
    throw new TypeError(
      `score.compare: mode mismatch (${a.mode} vs ${b.mode})`,
    );
  }
  if (a.value < b.value) return -1;
  if (a.value > b.value) return 1;
  return 0;
}

export function colorBand(s: Score): ColorBand {
  if (s.mode === 'standard') {
    const v = s.value;
    if (v <= 4) return 'red';
    if (v <= 8) return 'orange';
    if (v <= 11) return 'yellow';
    if (v <= 15) return 'lightGreen';
    return 'darkGreen';
  }
  // Atlas: 7 tiers map to 5 bands as 1 / 2 / {2.5,3,3.5} / 4 / 5,
  // mirroring the bell-curve symmetry of the standard mode.
  switch (s.value) {
    case 1:
      return 'red';
    case 2:
      return 'orange';
    case 4:
      return 'lightGreen';
    case 5:
      return 'darkGreen';
    default:
      return 'yellow';
  }
}

// Inverts a score around its mode's midpoint. WTC scoring splits a fixed
// total (20 in standard, 6 in atlas — the latter being the symmetry point of
// the tier set, not a literal point cap), so each team's expected share of a
// matchup is the complement of the other team's. Used by matrix generation
// to derive viewB from viewA: each opposing-team view starts as the inverse
// of the same matchup, then has per-cell variance applied on top.
export function invert(s: Score): Score {
  if (s.mode === 'standard') {
    return { mode: 'standard', value: STANDARD_MAX - s.value };
  }
  // For atlas, 6 - t maps {1,2,2.5,3,3.5,4,5} onto itself: 1↔5, 2↔4,
  // 2.5↔3.5, 3↔3. The cast is safe by enumeration.
  return { mode: 'atlas', value: (6 - s.value) as AtlasTier };
}

// Symbolic inverse of a table modifier. Mirrors `invert` for scores: the
// matchup's impact is experienced from opposite sides by the two teams, so
// '+' for one team is '-' for the other and '++' is '--'. We never compute
// this numerically — `invert` already handles the score-share split, so the
// modifier just flips sign at the symbol level. Involution: invertModifier
// composed with itself is the identity.
export function invertModifier(mod: TableModifier): TableModifier {
  switch (mod) {
    case '+': return '-';
    case '-': return '+';
    case '++': return '--';
    case '--': return '++';
  }
}

const STANDARD_MODIFIER_DELTA: Record<TableModifier, number> = {
  '+': 3,
  '++': 6,
  '-': -3,
  '--': -6,
};

const ATLAS_MODIFIER_STEPS: Record<TableModifier, number> = {
  '+': 1,
  '++': 2,
  '-': -1,
  '--': -2,
};

// Return the signed delta value for a TableModifier in the given mode.
// Standard: +3 / +6 / -3 / -6 (raw point delta). Atlas: +1 / +2 / -1 / -2
// (ordinal step count — applied via the ATLAS_TIERS index walk). The
// value is *unclamped*; near-edge scores will see truncated actual
// effects when run through applyTableModifier. Useful for caching the
// "nominal" modifier on a Pairing without committing to a specific score
// at lookup time.
export function tableModifierDelta(mod: TableModifier, mode: ScoreMode): number {
  if (mode === 'standard') {
    switch (mod) {
      case '+': return 3;
      case '++': return 6;
      case '-': return -3;
      case '--': return -6;
    }
  }
  switch (mod) {
    case '+': return 1;
    case '++': return 2;
    case '-': return -1;
    case '--': return -2;
  }
}

// Apply a table modifier to a score, returning the shifted score. Standard
// mode adds the integer delta (clamped to [0, 20]); atlas mode walks the
// ordinal tier set by N steps (clamped at the ends, same convention as
// applyVariance).
export function applyTableModifier(s: Score, mod: TableModifier): Score {
  if (s.mode === 'standard') {
    const raw = s.value + STANDARD_MODIFIER_DELTA[mod];
    const clamped = raw < STANDARD_MIN
      ? STANDARD_MIN
      : raw > STANDARD_MAX
        ? STANDARD_MAX
        : raw;
    return { mode: 'standard', value: clamped };
  }
  const idx = ATLAS_TIERS.indexOf(s.value);
  const newIdx = clampIndex(idx + ATLAS_MODIFIER_STEPS[mod], ATLAS_TIERS.length);
  // Safe: clampIndex bounds newIdx to [0, ATLAS_TIERS.length - 1].
  return { mode: 'atlas', value: ATLAS_TIERS[newIdx]! };
}

export function applyVariance(s: Score, rng: RngState): RngDraw<Score> {
  if (s.mode === 'standard') {
    const r = nextInt(rng, -STANDARD_VARIANCE, STANDARD_VARIANCE);
    const raw = s.value + r.value;
    const clamped = raw < STANDARD_MIN
      ? STANDARD_MIN
      : raw > STANDARD_MAX
        ? STANDARD_MAX
        : raw;
    return { state: r.state, value: { mode: 'standard', value: clamped } };
  }
  // Atlas: ±1 ordinal step on ATLAS_TIERS, clamped at the ends.
  const idx = ATLAS_TIERS.indexOf(s.value);
  const r = nextInt(rng, -1, 1);
  const newIdx = clampIndex(idx + r.value, ATLAS_TIERS.length);
  return {
    state: r.state,
    // Safe: clampIndex bounds newIdx to [0, ATLAS_TIERS.length - 1].
    value: { mode: 'atlas', value: ATLAS_TIERS[newIdx]! },
  };
}

export function generate(
  rng: RngState,
  mode: ScoreMode,
  params?: GenerateParams,
): RngDraw<Score> {
  if (mode === 'standard') {
    const mean = params?.mean ?? 10;
    const stdev = params?.stdev ?? 3.5;
    const z = boxMuller(rng);
    const raw = mean + z.value * stdev;
    const rounded = Math.round(raw);
    const clamped = rounded < STANDARD_MIN
      ? STANDARD_MIN
      : rounded > STANDARD_MAX
        ? STANDARD_MAX
        : rounded;
    // Math.round can produce -0 for raw in (-0.5, 0]; normalize so JSON
    // round-trip stays stable (JSON.stringify(-0) === "0").
    const value = clamped === 0 ? 0 : clamped;
    return { state: z.state, value: { mode: 'standard', value } };
  }
  const mean = params?.mean ?? 3;
  const stdev = params?.stdev ?? 0.8;
  const z = boxMuller(rng);
  const raw = mean + z.value * stdev;
  return { state: z.state, value: { mode: 'atlas', value: snapToTier(raw) } };
}

function boxMuller(rng: RngState): RngDraw<number> {
  const r1 = nextFloat(rng);
  // Guard log(0): nextFloat is in [0, 1); 0 is vanishingly rare but possible.
  const u1 = r1.value === 0 ? Number.MIN_VALUE : r1.value;
  const r2 = nextFloat(r1.state);
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * r2.value);
  return { state: r2.state, value: z };
}

function clampIndex(i: number, length: number): number {
  if (i < 0) return 0;
  if (i >= length) return length - 1;
  return i;
}

function snapToTier(raw: number): AtlasTier {
  let best: AtlasTier = ATLAS_TIERS[0];
  let bestDist = Math.abs(raw - best);
  for (let i = 1; i < ATLAS_TIERS.length; i++) {
    const tier = ATLAS_TIERS[i]!;
    const d = Math.abs(raw - tier);
    if (d < bestDist) {
      bestDist = d;
      best = tier;
    }
  }
  return best;
}
