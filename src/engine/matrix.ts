import { generate, applyVariance } from './score.js';
import type { Score, ScoreMode, GenerateParams } from './score.js';
import type { RngState } from './rng.js';

export interface Matrix {
  readonly mode: ScoreMode;
  // viewA[aArmy][bArmy] = team A's expected score for A's army i vs B's army j
  readonly viewA: readonly (readonly Score[])[];
  // viewB[bArmy][aArmy] = team B's expected score for B's army j vs A's army i
  // B reads its own armies down the rows, so axes are transposed relative to viewA.
  readonly viewB: readonly (readonly Score[])[];
}

export const MATRIX_SIZE = 8;

export function generateMatrix(
  rng: RngState,
  mode: ScoreMode,
  params?: GenerateParams,
): { rng: RngState; matrix: Matrix } {
  let state = rng;

  // Draw 64 ground-truth matchup scores.
  const truth: Score[][] = [];
  for (let i = 0; i < MATRIX_SIZE; i++) {
    const row: Score[] = [];
    for (let j = 0; j < MATRIX_SIZE; j++) {
      const draw = generate(state, mode, params);
      state = draw.state;
      row.push(draw.value);
    }
    truth.push(row);
  }

  // Apply independent variance for team A's view (row-major, same order as truth).
  const viewA: Score[][] = [];
  for (let i = 0; i < MATRIX_SIZE; i++) {
    const row: Score[] = [];
    for (let j = 0; j < MATRIX_SIZE; j++) {
      const draw = applyVariance(truth[i]![j]!, state);
      state = draw.state;
      row.push(draw.value);
    }
    viewA.push(row);
  }

  // Apply independent variance for team B's view (row-major over truth, then transpose).
  // Iterating (i, j) over truth[i][j] means we fill viewBRaw[i][j] in the same order,
  // then transpose so that viewB[j][i] = viewBRaw[i][j].
  const viewBRaw: Score[][] = [];
  for (let i = 0; i < MATRIX_SIZE; i++) {
    const row: Score[] = [];
    for (let j = 0; j < MATRIX_SIZE; j++) {
      const draw = applyVariance(truth[i]![j]!, state);
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
