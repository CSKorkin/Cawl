import { generate, applyVariance, invert } from './score.js';
import type { Score, ScoreMode, GenerateParams } from './score.js';
import type { RngState } from './rng.js';

export interface Matrix {
  readonly mode: ScoreMode;
  // viewA[aArmy][bArmy] = team A's expected score for A's army i vs B's army j.
  // This is the anchor — drawn directly from the bell-curve generator.
  readonly viewA: readonly (readonly Score[])[];
  // viewB[bArmy][aArmy] = team B's expected score for the same matchup.
  // WTC scoring splits a fixed total per matchup, so B's expected share is
  // the inverse of A's around the mode's midpoint, plus per-cell variance:
  //   viewB[j][i] = applyVariance(invert(viewA[i][j]))
  // Hence |viewA[i][j] − (MAX − viewB[j][i])| ≤ the mode's variance bound
  // (±3 standard, ±1 ordinal step atlas). B reads its own armies down the
  // rows, hence the transposed indexing.
  readonly viewB: readonly (readonly Score[])[];
}

export const MATRIX_SIZE = 8;

export function generateMatrix(
  rng: RngState,
  mode: ScoreMode,
  params?: GenerateParams,
): { rng: RngState; matrix: Matrix } {
  let state = rng;

  // Draw 64 bell-curve values for team A's view (the anchor).
  const viewA: Score[][] = [];
  for (let i = 0; i < MATRIX_SIZE; i++) {
    const row: Score[] = [];
    for (let j = 0; j < MATRIX_SIZE; j++) {
      const draw = generate(state, mode, params);
      state = draw.state;
      row.push(draw.value);
    }
    viewA.push(row);
  }

  // For each matchup, B's expected score starts as the INVERSE of A's around
  // the mode's midpoint (split-scoring complement), then has per-cell variance
  // applied on top. Collected row-major in (i, j) order to match viewA's
  // iteration, then transposed so viewB[j][i] = same matchup as viewA[i][j].
  const viewBRaw: Score[][] = [];
  for (let i = 0; i < MATRIX_SIZE; i++) {
    const row: Score[] = [];
    for (let j = 0; j < MATRIX_SIZE; j++) {
      const draw = applyVariance(invert(viewA[i]![j]!), state);
      state = draw.state;
      row.push(draw.value);
    }
    viewBRaw.push(row);
  }

  const viewB: Score[][] = Array.from({ length: MATRIX_SIZE }, (_, j) =>
    Array.from({ length: MATRIX_SIZE }, (_, i) => viewBRaw[i]![j]!),
  );

  return { rng: state, matrix: { mode, viewA, viewB } };
}
