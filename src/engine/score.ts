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
