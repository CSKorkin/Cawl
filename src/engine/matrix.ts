import { generate, applyVariance, invert, invertModifier } from './score.js';
import type { Score, ScoreMode, GenerateParams, TableModifier } from './score.js';
import { nextFloat, nextInt, shuffle } from './rng.js';
import type { RngDraw, RngState } from './rng.js';

// Per-cell modifier vector: one slot per table id, 0-indexed (slot t maps to
// table id t + 1). Empty slots are `null`. A cell may carry up to one
// modifier per table; multiple tables may carry the same or different
// modifiers within a cell (manual + paste paths permit this freely;
// generation does not mix '+' with '++' or '-' with '--' on the same cell).
export type CellImpact = readonly (TableModifier | null)[];

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
  // Per-cell per-table modifier tensors. impactA[i][j] is the 8-vector of
  // modifiers for the matchup A's army i vs B's army j from team A's
  // perspective. impactB[j][i] is the same matchup from team B's perspective
  // and is the symbolic inverse cell-by-cell — '+'↔'-' / '++'↔'--', null
  // preserved as null. Both views materialize at generation/entry time so
  // viewFor(state, seat) need only read the seat's own tensor; no run-time
  // inversion in the engine hot path.
  readonly impactA: readonly (readonly CellImpact[])[];
  readonly impactB: readonly (readonly CellImpact[])[];
}

export const MATRIX_SIZE = 8;
export const TABLE_COUNT = 8;

// Tunable parameters for impact-tensor generation. Defaults chosen so the
// "≥1-modifier cell rate" averages around 25% — high enough to make table
// strategy interesting, low enough that most cells stay table-agnostic.
// Empirically validated by the distribution test in matrix.test.ts.
export interface ImpactGenerationParams {
  // Bell-curve mean for per-army `tableImportance` (clamped to [0, 1]).
  // Default 0.4. Bumping this raises both fire rate and ++ / -- frequency.
  readonly importanceMean?: number;
  // Bell-curve stdev. Default 0.2.
  readonly importanceStdev?: number;
  // Per-cell, per-side multiplier on importance for "do we fire this cell".
  // Effective per-cell fire probability (one side) = importance × fireRate.
  // Default 0.33; with avg importance 0.4 this lands ≥1-mod rate near 25%.
  readonly fireRate?: number;
  // Threshold for upgrading a single modifier ('+' / '-') to a double
  // ('++' / '--'). Per-fire roll < importance × doubleThreshold → double.
  // Default 0.5; at importance 0.4, ~20% of fires are doubles.
  readonly doubleThreshold?: number;
}

// Per-army hidden profile used during impact generation. Not exposed on the
// Matrix — only the resulting per-cell modifiers are observable. "Hidden"
// per the user's product brief: armies have intrinsic table preferences
// that the matrix surface only hints at via the cells they affect.
interface ArmyImpactProfile {
  readonly importance: number;
  readonly preferredTables: readonly number[]; // table index, 0..TABLE_COUNT-1
}

export function generateMatrix(
  rng: RngState,
  mode: ScoreMode,
  params?: GenerateParams,
  impactParams?: ImpactGenerationParams,
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

  // Generate impacts on a forked RNG so the main RNG path (which downstream
  // engine state consumes for token roll-offs etc.) is unchanged. Forking
  // off the *input* seed (not `state`) means impact tuning never shifts
  // viewA/viewB pinned-seed tests. The cursor jump is the standard
  // golden-ratio-of-2^32 constant used for sub-stream decorrelation.
  const impactFork: RngState = {
    seed: rng.seed,
    cursor: (rng.cursor + 0x9e3779b1) | 0,
  };
  const { impactA } = generateImpacts(impactFork, impactParams);

  return deriveViewB(state, mode, viewA, impactA);
}

// Build a Matrix from a caller-supplied viewA (used by the Entered matrix
// flow). viewB is still derived through inversion + per-cell variance off
// the same RNG path so its statistical properties match the Generated
// flow — the user's typed matrix is purely the anchor.
//
// Optional `impactA` carries per-cell, per-table modifiers from the manual
// or paste flows. When omitted, defaults to all-null (no modifiers). When
// supplied, impactB is derived by symbolic inversion (no RNG draws).
export function generateMatrixFromViewA(
  rng: RngState,
  mode: ScoreMode,
  viewA: readonly (readonly Score[])[],
  impactA?: readonly (readonly CellImpact[])[],
): { rng: RngState; matrix: Matrix } {
  if (viewA.length !== MATRIX_SIZE) {
    throw new RangeError(
      `viewA must be ${MATRIX_SIZE}×${MATRIX_SIZE}, got ${viewA.length} rows`,
    );
  }
  for (let i = 0; i < MATRIX_SIZE; i++) {
    if (viewA[i]!.length !== MATRIX_SIZE) {
      throw new RangeError(
        `viewA row ${i} has ${viewA[i]!.length} cells, expected ${MATRIX_SIZE}`,
      );
    }
  }
  // Defensive copy so mutations on the input don't leak into the engine.
  const copied: Score[][] = viewA.map((row) => row.slice());
  const impacts = impactA !== undefined
    ? validateAndCopyImpacts(impactA)
    : nullImpacts();
  return deriveViewB(rng, mode, copied, impacts);
}

function deriveViewB(
  rng: RngState,
  mode: ScoreMode,
  viewA: readonly (readonly Score[])[],
  impactA: readonly (readonly CellImpact[])[],
): { rng: RngState; matrix: Matrix } {
  let state = rng;
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
  const impactB = symbolicInvertImpacts(impactA);
  return { rng: state, matrix: { mode, viewA, viewB, impactA, impactB } };
}

// Build an MATRIX_SIZE × MATRIX_SIZE × TABLE_COUNT tensor of nulls. Used as
// the default impact tensor when no per-cell modifiers are supplied.
function nullImpacts(): (readonly (TableModifier | null)[])[][] {
  return Array.from({ length: MATRIX_SIZE }, () =>
    Array.from({ length: MATRIX_SIZE }, () =>
      Array.from({ length: TABLE_COUNT }, () => null as TableModifier | null),
    ),
  );
}

// Validate shape and defensively copy a caller-supplied impactA so external
// mutations can't leak into the engine. Throws RangeError on shape mismatch.
function validateAndCopyImpacts(
  impactA: readonly (readonly CellImpact[])[],
): (readonly (TableModifier | null)[])[][] {
  if (impactA.length !== MATRIX_SIZE) {
    throw new RangeError(
      `impactA must be ${MATRIX_SIZE}×${MATRIX_SIZE}×${TABLE_COUNT}, got ${impactA.length} rows`,
    );
  }
  const out: (TableModifier | null)[][][] = [];
  for (let i = 0; i < MATRIX_SIZE; i++) {
    const row = impactA[i]!;
    if (row.length !== MATRIX_SIZE) {
      throw new RangeError(
        `impactA row ${i} has ${row.length} cells, expected ${MATRIX_SIZE}`,
      );
    }
    const outRow: (TableModifier | null)[][] = [];
    for (let j = 0; j < MATRIX_SIZE; j++) {
      const cell = row[j]!;
      if (cell.length !== TABLE_COUNT) {
        throw new RangeError(
          `impactA[${i}][${j}] has ${cell.length} slots, expected ${TABLE_COUNT}`,
        );
      }
      outRow.push(cell.slice());
    }
    out.push(outRow);
  }
  return out;
}

// ── Impact generation ─────────────────────────────────────────────────────────

// Box-Muller Gaussian draw clamped to [0, 1]. Inlined here (rather than
// re-exporting the equivalent helper from score.ts) to keep the impact-gen
// module self-contained — score.ts and matrix.ts otherwise have no shared
// internals beyond the public Score / TableModifier types.
function gaussianClamped01(
  rng: RngState,
  mean: number,
  stdev: number,
): RngDraw<number> {
  const r1 = nextFloat(rng);
  const u1 = r1.value === 0 ? Number.MIN_VALUE : r1.value;
  const r2 = nextFloat(r1.state);
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * r2.value);
  const raw = mean + z * stdev;
  const clamped = raw < 0 ? 0 : raw > 1 ? 1 : raw;
  return { state: r2.state, value: clamped };
}

// Draw one army's hidden impact profile: importance from the clamped
// Gaussian, plus 1–3 distinct preferred table indices via shuffle-and-take.
function drawArmyProfile(
  rng: RngState,
  mean: number,
  stdev: number,
): RngDraw<ArmyImpactProfile> {
  const imp = gaussianClamped01(rng, mean, stdev);
  const sizeR = nextInt(imp.state, 1, 3);
  const allTables = Array.from({ length: TABLE_COUNT }, (_, t) => t);
  const sh = shuffle(sizeR.state, allTables);
  return {
    state: sh.state,
    value: {
      importance: imp.value,
      preferredTables: sh.value.slice(0, sizeR.value),
    },
  };
}

// Apply one side's modifier to a cell. Strength ('+' vs '++', or '-' vs
// '--') is rolled ONCE per (cell, side) — guaranteeing the plan's "no '+'
// alongside '++' on the same cell" invariant by construction. Then we pick
// a uniform-random non-empty subset of the army's preferred tables and
// stamp the chosen symbol onto each.
function applySideModifier(
  rng: RngState,
  profile: ArmyImpactProfile,
  doubleThreshold: number,
  side: 'friendly' | 'enemy',
  cellSlot: (TableModifier | null)[],
): RngState {
  const strengthRoll = nextFloat(rng);
  const isDouble = strengthRoll.value < profile.importance * doubleThreshold;
  const symbol: TableModifier = side === 'friendly'
    ? (isDouble ? '++' : '+')
    : (isDouble ? '--' : '-');

  const sizeR = nextInt(strengthRoll.state, 1, profile.preferredTables.length);
  const sh = shuffle(sizeR.state, profile.preferredTables);
  for (let k = 0; k < sizeR.value; k++) {
    const t = sh.value[k]!;
    // Across-side collision (friendly + enemy on same table) resolves
    // last-write-wins. Order is friendly-first, enemy-second per
    // generateImpacts, so enemy wins ties — arbitrary but documented.
    cellSlot[t] = symbol;
  }
  return sh.state;
}

// Build the impact tensor by walking 16 army profiles and 64 cells. RNG-
// driven, deterministic per input seed. Pure — all randomness routes
// through the seeded PRNG (the engine-invariants test enforces this).
function generateImpacts(
  rng: RngState,
  params?: ImpactGenerationParams,
): { rng: RngState; impactA: (TableModifier | null)[][][] } {
  const importanceMean = params?.importanceMean ?? 0.4;
  const importanceStdev = params?.importanceStdev ?? 0.2;
  const fireRate = params?.fireRate ?? 0.33;
  const doubleThreshold = params?.doubleThreshold ?? 0.5;

  let state = rng;
  const profilesA: ArmyImpactProfile[] = [];
  for (let i = 0; i < MATRIX_SIZE; i++) {
    const r = drawArmyProfile(state, importanceMean, importanceStdev);
    state = r.state;
    profilesA.push(r.value);
  }
  const profilesB: ArmyImpactProfile[] = [];
  for (let j = 0; j < MATRIX_SIZE; j++) {
    const r = drawArmyProfile(state, importanceMean, importanceStdev);
    state = r.state;
    profilesB.push(r.value);
  }

  const impactA: (TableModifier | null)[][][] = Array.from(
    { length: MATRIX_SIZE },
    () =>
      Array.from({ length: MATRIX_SIZE }, () =>
        Array.from({ length: TABLE_COUNT }, () => null as TableModifier | null),
      ),
  );

  for (let i = 0; i < MATRIX_SIZE; i++) {
    const profA = profilesA[i]!;
    for (let j = 0; j < MATRIX_SIZE; j++) {
      const profB = profilesB[j]!;
      const cell = impactA[i]![j]!;

      // Friendly side (A): may stamp '+' / '++'.
      const fireA = nextFloat(state);
      state = fireA.state;
      if (fireA.value < profA.importance * fireRate) {
        state = applySideModifier(state, profA, doubleThreshold, 'friendly', cell);
      }

      // Enemy side (B): may stamp '-' / '--' (overwriting friendly on
      // collisions — see applySideModifier).
      const fireB = nextFloat(state);
      state = fireB.state;
      if (fireB.value < profB.importance * fireRate) {
        state = applySideModifier(state, profB, doubleThreshold, 'enemy', cell);
      }
    }
  }

  return { rng: state, impactA };
}

// Derive impactB from impactA by symbolic inversion + transposition. Mirrors
// the [aArmy][bArmy] → [bArmy][aArmy] reshape we already do for viewB; each
// cell is `invertModifier(m)` (null preserved). No RNG involvement — the
// score-side variance is the only source of A↔B asymmetry; modifiers flip
// sign deterministically.
function symbolicInvertImpacts(
  impactA: readonly (readonly CellImpact[])[],
): (TableModifier | null)[][][] {
  const impactB: (TableModifier | null)[][][] = Array.from(
    { length: MATRIX_SIZE },
    () =>
      Array.from({ length: MATRIX_SIZE }, () =>
        Array.from({ length: TABLE_COUNT }, () => null as TableModifier | null),
      ),
  );
  for (let i = 0; i < MATRIX_SIZE; i++) {
    for (let j = 0; j < MATRIX_SIZE; j++) {
      const cell = impactA[i]![j]!;
      for (let t = 0; t < TABLE_COUNT; t++) {
        const m = cell[t] ?? null;
        impactB[j]![i]![t] = m === null ? null : invertModifier(m);
      }
    }
  }
  return impactB;
}
