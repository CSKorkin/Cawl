// Seedable mulberry32 PRNG. Pure functions over a serializable RngState —
// no closures, no class instances. The state round-trips through JSON.

export interface RngState {
  readonly seed: number;
  readonly cursor: number;
}

export interface RngDraw<T> {
  readonly state: RngState;
  readonly value: T;
}

export function seed(n: number): RngState {
  const normalized = n | 0;
  return { seed: normalized, cursor: normalized };
}

export function next(state: RngState): RngDraw<number> {
  const a = (state.cursor + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  const value = (t ^ (t >>> 14)) >>> 0;
  return { state: { seed: state.seed, cursor: a }, value };
}

export function nextFloat(state: RngState): RngDraw<number> {
  const draw = next(state);
  return { state: draw.state, value: draw.value / 0x1_0000_0000 };
}

export function nextInt(
  state: RngState,
  lo: number,
  hi: number,
): RngDraw<number> {
  if (hi < lo) {
    throw new RangeError(`nextInt: hi (${hi}) < lo (${lo})`);
  }
  const range = hi - lo + 1;
  const draw = nextFloat(state);
  const value = lo + Math.floor(draw.value * range);
  return { state: draw.state, value };
}

export function pick<T>(state: RngState, arr: readonly T[]): RngDraw<T> {
  if (arr.length === 0) {
    throw new RangeError('pick: empty array');
  }
  const idx = nextInt(state, 0, arr.length - 1);
  // Safe: idx is bounded to a valid index by nextInt above.
  return { state: idx.state, value: arr[idx.value]! };
}

export function shuffle<T>(state: RngState, arr: readonly T[]): RngDraw<T[]> {
  const result = [...arr];
  let cursor = state;
  for (let i = result.length - 1; i > 0; i--) {
    const r = nextInt(cursor, 0, i);
    cursor = r.state;
    const j = r.value;
    // Safe: i and j are both valid indices into result.
    const tmp = result[i]!;
    result[i] = result[j]!;
    result[j] = tmp;
  }
  return { state: cursor, value: result };
}
