import { generate, applyVariance } from './score.js';
import type { Score, ScoreMode, GenerateParams } from './score.js';
import type { RngState } from './rng.js';

export interface Matrix {
  readonly mode: ScoreMode;
  // viewA[aArmy][bArmy] = team A's expected score for A's army i vs B's army j.
  // This is the anchor — drawn directly from the bell-curve generator.
  readonly viewA: readonly (readonly Score[])[];
  // viewB[bArmy][aArmy] = team B's expected score for the same matchup.
  // Each cell is a single application of the score-mode's variance to the
  // corresponding viewA cell, so |viewA[i][j] - viewB[j][i]| ≤ the mode's
  // variance bound (±3 standard, ±1 ordinal step atlas). B reads its own
  // armies down the rows, hence the transposed indexing.
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

  // Apply per-cell variance to viewA to produce team B's view of each matchup,
  // collected row-major in (i, j) order to match viewA's iteration. Then
  // transpose so viewB[j][i] = same matchup as viewA[i][j].
  const viewBRaw: Score[][] = [];
  for (let i = 0; i < MATRIX_SIZE; i++) {
    const row: Score[] = [];
    for (let j = 0; j < MATRIX_SIZE; j++) {
      const draw = applyVariance(viewA[i]![j]!, state);
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
