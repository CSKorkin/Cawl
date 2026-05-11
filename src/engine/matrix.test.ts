import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  generateMatrix,
  generateMatrixFromViewA,
  MATRIX_SIZE,
  TABLE_COUNT,
} from './matrix.js';
import type { CellImpact } from './matrix.js';
import { ATLAS_TIERS, invertModifier } from './score.js';
import type { Score, TableModifier } from './score.js';
import { seed } from './rng.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function isValidStandard(s: Score): boolean {
  return s.mode === 'standard' && Number.isInteger(s.value) && s.value >= 0 && s.value <= 20;
}

function isValidAtlas(s: Score): boolean {
  return s.mode === 'atlas' && (ATLAS_TIERS as readonly number[]).includes(s.value);
}

describe('matrix.generateMatrix — shape', () => {
  it('produces 8×8 viewA and 8×8 viewB (standard)', () => {
    const { matrix } = generateMatrix(seed(42), 'standard');
    expect(matrix.viewA.length).toBe(MATRIX_SIZE);
    for (const row of matrix.viewA) expect(row.length).toBe(MATRIX_SIZE);
    expect(matrix.viewB.length).toBe(MATRIX_SIZE);
    for (const row of matrix.viewB) expect(row.length).toBe(MATRIX_SIZE);
  });

  it('produces 8×8 viewA and 8×8 viewB (atlas)', () => {
    const { matrix } = generateMatrix(seed(42), 'atlas');
    expect(matrix.viewA.length).toBe(MATRIX_SIZE);
    for (const row of matrix.viewA) expect(row.length).toBe(MATRIX_SIZE);
    expect(matrix.viewB.length).toBe(MATRIX_SIZE);
    for (const row of matrix.viewB) expect(row.length).toBe(MATRIX_SIZE);
  });

  it('stores the requested mode on the matrix', () => {
    expect(generateMatrix(seed(1), 'standard').matrix.mode).toBe('standard');
    expect(generateMatrix(seed(1), 'atlas').matrix.mode).toBe('atlas');
  });
});

describe('matrix.generateMatrix — cell validity', () => {
  it('all standard cells are integers in [0, 20]', () => {
    const { matrix } = generateMatrix(seed(42), 'standard');
    for (const row of matrix.viewA) {
      for (const s of row) expect(isValidStandard(s)).toBe(true);
    }
    for (const row of matrix.viewB) {
      for (const s of row) expect(isValidStandard(s)).toBe(true);
    }
  });

  it('all atlas cells are valid tiers', () => {
    const { matrix } = generateMatrix(seed(42), 'atlas');
    for (const row of matrix.viewA) {
      for (const s of row) expect(isValidAtlas(s)).toBe(true);
    }
    for (const row of matrix.viewB) {
      for (const s of row) expect(isValidAtlas(s)).toBe(true);
    }
  });

  it('cell validity holds across 20 seeds (standard)', () => {
    for (let i = 0; i < 20; i++) {
      const { matrix } = generateMatrix(seed(i * 7919), 'standard');
      for (const row of matrix.viewA) {
        for (const s of row) expect(isValidStandard(s)).toBe(true);
      }
      for (const row of matrix.viewB) {
        for (const s of row) expect(isValidStandard(s)).toBe(true);
      }
    }
  });
});

describe('matrix.generateMatrix — asymmetry property (inversion model)', () => {
  // WTC scoring is split out of a fixed total, so each team's view of a
  // matchup is the COMPLEMENT of the other's: viewB[j][i] is generated as
  // applyVariance(invert(viewA[i][j])). The bound is therefore on the
  // distance from the inverse, not from viewA itself:
  //   standard: |viewA[i][j] − (20 − viewB[j][i])| ≤ 3
  //   atlas:    |idx(viewA[i][j]) + idx(viewB[j][i]) − 6| ≤ 1
  //             (since invert maps idx k → 6 − k on the 7-tier set)

  it('|viewA[i][j] − (20 − viewB[j][i])| ≤ 3 in standard mode (200 seeds)', () => {
    let totalDiffsFromExactInverse = 0;
    for (let s = 0; s < 200; s++) {
      const { matrix } = generateMatrix(seed(s), 'standard');
      for (let i = 0; i < MATRIX_SIZE; i++) {
        for (let j = 0; j < MATRIX_SIZE; j++) {
          const a = matrix.viewA[i]![j]!;
          const b = matrix.viewB[j]![i]!;
          expect(a.mode).toBe('standard');
          expect(b.mode).toBe('standard');
          if (a.mode === 'standard' && b.mode === 'standard') {
            const inverseOfA = 20 - a.value;
            const delta = Math.abs(inverseOfA - b.value);
            expect(delta).toBeLessThanOrEqual(3);
            if (delta > 0) totalDiffsFromExactInverse++;
          }
        }
      }
    }
    // Variance should perturb most cells off the exact inverse — confirm
    // the asymmetry is real (otherwise we'd be applying invert with no noise).
    expect(totalDiffsFromExactInverse).toBeGreaterThan(0);
  });

  it('regression: seed 0x102 cell viewA[0][1] inverts to within ±3 of viewB[1][0]', () => {
    // History: under an earlier "two independent variance draws from a hidden
    // truth" model this seed produced |viewA[0][1] − viewB[1][0]| = 5, breaking
    // the ±3 bound. The fix anchored viewA, applied one variance step to derive
    // viewB. Then a second bug surfaced: WTC scoring is split, so viewB should
    // start from invert(viewA), not from viewA itself. This regression locks in
    // the inversion model — the bound is between viewB and INVERT(viewA).
    const { matrix } = generateMatrix(seed(0x102), 'standard');
    const a = matrix.viewA[0]![1]!;
    const b = matrix.viewB[1]![0]!;
    if (a.mode === 'standard' && b.mode === 'standard') {
      expect(Math.abs((20 - a.value) - b.value)).toBeLessThanOrEqual(3);
    }
  });

  it('high A-score implies low B-score (split-scoring sanity)', () => {
    // Pin a specific cell to the high end and confirm B sees the inverse.
    // Mean 20 stdev 0 → every viewA cell is 20 → invert is 0 → viewB is in [0, 3].
    const { matrix } = generateMatrix(seed(42), 'standard', { mean: 20, stdev: 0 });
    for (const row of matrix.viewA) {
      for (const s of row) {
        if (s.mode === 'standard') expect(s.value).toBe(20);
      }
    }
    for (const row of matrix.viewB) {
      for (const s of row) {
        if (s.mode === 'standard') expect(s.value).toBeLessThanOrEqual(3);
      }
    }
  });

  it('atlas idx(viewA) + idx(viewB) sums to 6 ± 1 across 100 seeds', () => {
    for (let s = 0; s < 100; s++) {
      const { matrix } = generateMatrix(seed(s), 'atlas');
      for (let i = 0; i < MATRIX_SIZE; i++) {
        for (let j = 0; j < MATRIX_SIZE; j++) {
          const a = matrix.viewA[i]![j]!;
          const b = matrix.viewB[j]![i]!;
          if (a.mode === 'atlas' && b.mode === 'atlas') {
            const idxA = ATLAS_TIERS.indexOf(a.value);
            const idxB = ATLAS_TIERS.indexOf(b.value);
            expect(Math.abs(idxA + idxB - 6)).toBeLessThanOrEqual(1);
          }
        }
      }
    }
  });
});

describe('matrix.generateMatrix — determinism and RNG', () => {
  it('is deterministic for a fixed seed (standard)', () => {
    const s = seed(0xcafe);
    const r1 = generateMatrix(s, 'standard');
    const r2 = generateMatrix(s, 'standard');
    expect(r1.matrix).toEqual(r2.matrix);
    expect(r1.rng).toEqual(r2.rng);
  });

  it('is deterministic for a fixed seed (atlas)', () => {
    const s = seed(0xcafe);
    const r1 = generateMatrix(s, 'atlas');
    const r2 = generateMatrix(s, 'atlas');
    expect(r1.matrix).toEqual(r2.matrix);
    expect(r1.rng).toEqual(r2.rng);
  });

  it('advances the RNG state', () => {
    const initial = seed(42);
    const { rng } = generateMatrix(initial, 'standard');
    expect(rng).not.toEqual(initial);
  });

  it('RNG state round-trips through JSON', () => {
    const { rng } = generateMatrix(seed(42), 'standard');
    const reparsed = JSON.parse(JSON.stringify(rng));
    expect(reparsed).toEqual(rng);
  });
});

describe('matrix.generateMatrix — params', () => {
  it('custom params (mean=20, stdev=0) produce all high-end scores in viewA', () => {
    // With mean=20, stdev=0, base values are all 20; variance can pull them down at most 3.
    const { matrix } = generateMatrix(seed(42), 'standard', { mean: 20, stdev: 0 });
    for (const row of matrix.viewA) {
      for (const s of row) {
        if (s.mode === 'standard') expect(s.value).toBeGreaterThanOrEqual(17);
      }
    }
  });

  it('custom params (mean=0, stdev=0) produce all low-end scores in viewA', () => {
    const { matrix } = generateMatrix(seed(42), 'standard', { mean: 0, stdev: 0 });
    for (const row of matrix.viewA) {
      for (const s of row) {
        if (s.mode === 'standard') expect(s.value).toBeLessThanOrEqual(3);
      }
    }
  });
});

describe('matrix.generateMatrixFromViewA — entered-matrix override path', () => {
  function constantViewA(value: number): Score[][] {
    return Array.from({ length: MATRIX_SIZE }, () =>
      Array.from({ length: MATRIX_SIZE }, () => ({ mode: 'standard', value } as Score)),
    );
  }

  it('uses the supplied viewA verbatim', () => {
    const viewA = constantViewA(12);
    const { matrix } = generateMatrixFromViewA(seed(123), 'standard', viewA);
    expect(matrix.viewA).toEqual(viewA);
  });

  it('still derives viewB via inversion + variance (asymmetry property holds)', () => {
    const viewA = constantViewA(15);
    const { matrix } = generateMatrixFromViewA(seed(123), 'standard', viewA);
    for (let i = 0; i < MATRIX_SIZE; i++) {
      for (let j = 0; j < MATRIX_SIZE; j++) {
        const a = matrix.viewA[i]![j]!.value as number;
        const b = matrix.viewB[j]![i]!.value as number;
        // |a - (20 - b)| ≤ 3 (the standard-mode variance bound)
        expect(Math.abs(a - (20 - b))).toBeLessThanOrEqual(3);
        expect(isValidStandard(matrix.viewB[j]![i]!)).toBe(true);
      }
    }
  });

  it('throws on wrong row count', () => {
    expect(() =>
      generateMatrixFromViewA(seed(0), 'standard', constantViewA(10).slice(0, 5)),
    ).toThrow(/8/);
  });

  it('throws on wrong column count', () => {
    const v = constantViewA(10).map((row, i) => (i === 0 ? row.slice(0, 6) : row));
    expect(() => generateMatrixFromViewA(seed(0), 'standard', v)).toThrow(/8/);
  });
});

describe('matrix.generateMatrix — impact tensors', () => {
  it('exposes impactA and impactB of shape [8][8][8]', () => {
    const { matrix } = generateMatrix(seed(42), 'standard');
    expect(matrix.impactA.length).toBe(MATRIX_SIZE);
    expect(matrix.impactB.length).toBe(MATRIX_SIZE);
    for (let i = 0; i < MATRIX_SIZE; i++) {
      expect(matrix.impactA[i]!.length).toBe(MATRIX_SIZE);
      expect(matrix.impactB[i]!.length).toBe(MATRIX_SIZE);
      for (let j = 0; j < MATRIX_SIZE; j++) {
        expect(matrix.impactA[i]![j]!.length).toBe(TABLE_COUNT);
        expect(matrix.impactB[i]![j]!.length).toBe(TABLE_COUNT);
      }
    }
  });

  it('default generation produces some non-null impacts (T3 distribution on)', () => {
    // After T3, generateMatrix populates impacts via per-army hidden
    // importance + preferred tables. We want at least *some* non-null
    // entries on a typical seed; distribution band is asserted below.
    let nonNull = 0;
    const { matrix } = generateMatrix(seed(42), 'standard');
    for (let i = 0; i < MATRIX_SIZE; i++) {
      for (let j = 0; j < MATRIX_SIZE; j++) {
        for (let t = 0; t < TABLE_COUNT; t++) {
          if (matrix.impactA[i]![j]![t] !== null) nonNull++;
        }
      }
    }
    expect(nonNull).toBeGreaterThan(0);
  });

  it('fully-zeroed impact params (fireRate 0) produce all-null impacts', () => {
    // Regression dial: with zero fire-rate, generation should fall through
    // to the empty case — useful for tests that want a clean matrix.
    const { matrix } = generateMatrix(seed(42), 'standard', undefined, { fireRate: 0 });
    for (let i = 0; i < MATRIX_SIZE; i++) {
      for (let j = 0; j < MATRIX_SIZE; j++) {
        for (let t = 0; t < TABLE_COUNT; t++) {
          expect(matrix.impactA[i]![j]![t]).toBeNull();
        }
      }
    }
  });
});

describe('matrix.generateMatrix — impact distribution', () => {
  // Helper: how many of the 64 cells have at least one modifier across the
  // 8 table slots, summed across `seeds` matrices.
  function cellsWithImpactRate(seeds: number): number {
    let cellsWithImpact = 0;
    let totalCells = 0;
    for (let s = 0; s < seeds; s++) {
      const { matrix } = generateMatrix(seed(s * 7919 + 11), 'standard');
      for (let i = 0; i < MATRIX_SIZE; i++) {
        for (let j = 0; j < MATRIX_SIZE; j++) {
          totalCells++;
          const cell = matrix.impactA[i]![j]!;
          for (let t = 0; t < TABLE_COUNT; t++) {
            if (cell[t] !== null) {
              cellsWithImpact++;
              break;
            }
          }
        }
      }
    }
    return cellsWithImpact / totalCells;
  }

  it('≥1-modifier cell rate stays in [0.18, 0.32] over 50 seeds (~25% target)', () => {
    const rate = cellsWithImpactRate(50);
    expect(rate).toBeGreaterThanOrEqual(0.18);
    expect(rate).toBeLessThanOrEqual(0.32);
  });

  it('per-cell exclusion: no cell mixes "+" and "++" within its 8 tables', () => {
    // Generation rolls strength once per (cell, side), so a friendly-side
    // fire writes a single symbol across its chosen subset of tables. The
    // exclusion rule (plan T3) is satisfied by construction; the test is a
    // canary against a future refactor that re-rolls per-table.
    for (let s = 0; s < 50; s++) {
      const { matrix } = generateMatrix(seed(s * 17 + 3), 'standard');
      for (let i = 0; i < MATRIX_SIZE; i++) {
        for (let j = 0; j < MATRIX_SIZE; j++) {
          let hasPlus = false, hasPlusPlus = false;
          for (let t = 0; t < TABLE_COUNT; t++) {
            const m = matrix.impactA[i]![j]![t];
            if (m === '+') hasPlus = true;
            if (m === '++') hasPlusPlus = true;
          }
          expect(hasPlus && hasPlusPlus).toBe(false);
        }
      }
    }
  });

  it('per-cell exclusion: no cell mixes "-" and "--" within its 8 tables', () => {
    for (let s = 0; s < 50; s++) {
      const { matrix } = generateMatrix(seed(s * 17 + 5), 'standard');
      for (let i = 0; i < MATRIX_SIZE; i++) {
        for (let j = 0; j < MATRIX_SIZE; j++) {
          let hasMinus = false, hasMinusMinus = false;
          for (let t = 0; t < TABLE_COUNT; t++) {
            const m = matrix.impactA[i]![j]![t];
            if (m === '-') hasMinus = true;
            if (m === '--') hasMinusMinus = true;
          }
          expect(hasMinus && hasMinusMinus).toBe(false);
        }
      }
    }
  });

  it('mixed "+" and "-" across different tables of one cell is permitted', () => {
    // Sanity: friendly and enemy modifiers are independent — finding a cell
    // with both somewhere in the corpus confirms generation isn't forcing a
    // single direction per cell. (Statistical: with ~12% friendly fire and
    // ~12% enemy fire per cell, ~1.4% of cells expected — enough hits in
    // 200 seeds × 64 cells = 12800 cells.)
    let mixedFound = 0;
    for (let s = 0; s < 200; s++) {
      const { matrix } = generateMatrix(seed(s * 31 + 7), 'standard');
      for (let i = 0; i < MATRIX_SIZE; i++) {
        for (let j = 0; j < MATRIX_SIZE; j++) {
          let hasFriendly = false, hasEnemy = false;
          for (let t = 0; t < TABLE_COUNT; t++) {
            const m = matrix.impactA[i]![j]![t];
            if (m === '+' || m === '++') hasFriendly = true;
            if (m === '-' || m === '--') hasEnemy = true;
          }
          if (hasFriendly && hasEnemy) mixedFound++;
        }
      }
    }
    expect(mixedFound).toBeGreaterThan(0);
  });

  it('is deterministic — same seed produces same impacts', () => {
    const r1 = generateMatrix(seed(0xc0de), 'standard');
    const r2 = generateMatrix(seed(0xc0de), 'standard');
    expect(r1.matrix.impactA).toEqual(r2.matrix.impactA);
    expect(r1.matrix.impactB).toEqual(r2.matrix.impactB);
  });

  it('impactB is the symbolic inverse of impactA on a generated matrix', () => {
    // The viewB derivation already covers numeric inversion + variance.
    // Here we re-assert the modifier inversion specifically against a
    // freshly *generated* matrix (T2 covered the manual-override path).
    const { matrix } = generateMatrix(seed(0xbeef), 'standard');
    for (let i = 0; i < MATRIX_SIZE; i++) {
      for (let j = 0; j < MATRIX_SIZE; j++) {
        for (let t = 0; t < TABLE_COUNT; t++) {
          const a = matrix.impactA[i]![j]![t] ?? null;
          const b = matrix.impactB[j]![i]![t] ?? null;
          if (a === null) expect(b).toBeNull();
          else expect(b).toBe(invertModifier(a));
        }
      }
    }
  });

  it('viewA / viewB / state.rng path is unchanged by impact generation (RNG-fork invariant)', () => {
    // Engine-side tests pin specific seeds expecting specific viewA values
    // and downstream RNG behavior (token roll-off, etc.). Impact generation
    // forks off the input seed and must not perturb the main RNG path.
    // This test asserts that the matrix's score views match what the prior
    // implementation produced for a canary seed.
    const fixturePath = join(__dirname, '__fixtures__', 'matrix-golden.json');
    const fixture = JSON.parse(readFileSync(fixturePath, 'utf-8')) as {
      seed: number;
      matrix: { viewA: unknown; viewB: unknown };
    };
    const { matrix } = generateMatrix(seed(fixture.seed), 'standard');
    expect(matrix.viewA).toEqual(fixture.matrix.viewA);
    expect(matrix.viewB).toEqual(fixture.matrix.viewB);
  });

  it('high fireRate → most cells have at least one modifier', () => {
    // Dial test: pushing fireRate up should saturate the rate.
    const { matrix } = generateMatrix(seed(42), 'standard', undefined, {
      fireRate: 1.0,
      importanceMean: 1.0,
      importanceStdev: 0,
    });
    let cellsWithImpact = 0;
    for (let i = 0; i < MATRIX_SIZE; i++) {
      for (let j = 0; j < MATRIX_SIZE; j++) {
        for (let t = 0; t < TABLE_COUNT; t++) {
          if (matrix.impactA[i]![j]![t] !== null) {
            cellsWithImpact++;
            break;
          }
        }
      }
    }
    expect(cellsWithImpact).toBeGreaterThanOrEqual(60); // out of 64
  });
});

describe('matrix.generateMatrixFromViewA — impact override path', () => {
  function constantViewA(value: number): Score[][] {
    return Array.from({ length: MATRIX_SIZE }, () =>
      Array.from({ length: MATRIX_SIZE }, () => ({ mode: 'standard', value } as Score)),
    );
  }

  // Mutable triple-array for tests so we can populate cells by index before
  // passing to generateMatrixFromViewA (whose param is `readonly … readonly
  // CellImpact[]`, accepting our mutable shape via covariance).
  function emptyImpactA(): (TableModifier | null)[][][] {
    return Array.from({ length: MATRIX_SIZE }, () =>
      Array.from({ length: MATRIX_SIZE }, () =>
        Array.from({ length: TABLE_COUNT }, () => null as TableModifier | null),
      ),
    );
  }

  it('defaults to all-null impacts when no override is passed', () => {
    const { matrix } = generateMatrixFromViewA(seed(0), 'standard', constantViewA(10));
    for (let i = 0; i < MATRIX_SIZE; i++) {
      for (let j = 0; j < MATRIX_SIZE; j++) {
        for (let t = 0; t < TABLE_COUNT; t++) {
          expect(matrix.impactA[i]![j]![t]).toBeNull();
          expect(matrix.impactB[i]![j]![t]).toBeNull();
        }
      }
    }
  });

  it('uses the supplied impactA verbatim', () => {
    const impactA = emptyImpactA();
    impactA[0]![1]![2] = '+';
    impactA[3]![4]![7] = '--';
    const { matrix } = generateMatrixFromViewA(
      seed(0),
      'standard',
      constantViewA(10),
      impactA,
    );
    expect(matrix.impactA[0]![1]![2]).toBe('+');
    expect(matrix.impactA[3]![4]![7]).toBe('--');
  });

  it('derives impactB by symbolic inversion + transposition', () => {
    // Place one of each modifier at distinct (i, j, t) coords.
    const impactA = emptyImpactA();
    impactA[0]![1]![2] = '+';
    impactA[1]![0]![3] = '++';
    impactA[2]![5]![0] = '-';
    impactA[5]![2]![6] = '--';
    const { matrix } = generateMatrixFromViewA(
      seed(0),
      'standard',
      constantViewA(10),
      impactA,
    );
    // impactB[j][i][t] = invertModifier(impactA[i][j][t])
    expect(matrix.impactB[1]![0]![2]).toBe('-');
    expect(matrix.impactB[0]![1]![3]).toBe('--');
    expect(matrix.impactB[5]![2]![0]).toBe('+');
    expect(matrix.impactB[2]![5]![6]).toBe('++');
  });

  it('preserves null slots in inversion', () => {
    const impactA = emptyImpactA();
    impactA[4]![4]![4] = '+';
    const { matrix } = generateMatrixFromViewA(
      seed(0),
      'standard',
      constantViewA(10),
      impactA,
    );
    // The one populated cell inverts; everything else stays null.
    expect(matrix.impactB[4]![4]![4]).toBe('-');
    let nonNullCount = 0;
    for (let i = 0; i < MATRIX_SIZE; i++) {
      for (let j = 0; j < MATRIX_SIZE; j++) {
        for (let t = 0; t < TABLE_COUNT; t++) {
          if (matrix.impactB[i]![j]![t] !== null) nonNullCount++;
        }
      }
    }
    expect(nonNullCount).toBe(1);
  });

  it('property: impactB[j][i][t] === invertModifier(impactA[i][j][t]) cell-by-cell', () => {
    // Pseudo-random fill driven by a deterministic walk so the test is
    // reproducible without pulling in the RNG module here.
    const symbols: readonly (TableModifier | null)[] = ['+', '++', '-', '--', null, null, null];
    const impactA = emptyImpactA();
    for (let i = 0; i < MATRIX_SIZE; i++) {
      for (let j = 0; j < MATRIX_SIZE; j++) {
        for (let t = 0; t < TABLE_COUNT; t++) {
          impactA[i]![j]![t] = symbols[(i * 13 + j * 7 + t) % symbols.length] ?? null;
        }
      }
    }
    const { matrix } = generateMatrixFromViewA(
      seed(0),
      'standard',
      constantViewA(10),
      impactA,
    );
    for (let i = 0; i < MATRIX_SIZE; i++) {
      for (let j = 0; j < MATRIX_SIZE; j++) {
        for (let t = 0; t < TABLE_COUNT; t++) {
          // `?? null` collapses the noUncheckedIndexedAccess `undefined`
          // case (slot is always allocated, but the type system can't see
          // that across nested indexing). Real null/non-null distinction
          // is what we're actually testing.
          const a = matrix.impactA[i]![j]![t] ?? null;
          const b = matrix.impactB[j]![i]![t] ?? null;
          if (a === null) expect(b).toBeNull();
          else expect(b).toBe(invertModifier(a));
        }
      }
    }
  });

  it('JSON-round-trips a matrix with non-trivial impacts', () => {
    const impactA = emptyImpactA();
    impactA[0]![0]![0] = '+';
    impactA[0]![0]![3] = '++';
    impactA[7]![7]![7] = '--';
    impactA[3]![5]![1] = '-';
    const { matrix } = generateMatrixFromViewA(
      seed(0xfeed),
      'standard',
      constantViewA(8),
      impactA,
    );
    const reparsed = JSON.parse(JSON.stringify(matrix)) as unknown;
    expect(reparsed).toEqual(matrix);
  });

  it('throws on impactA shape mismatch', () => {
    const bad = emptyImpactA().slice(0, 5);
    expect(() =>
      generateMatrixFromViewA(seed(0), 'standard', constantViewA(10), bad),
    ).toThrow(/8/);
    const badRow = emptyImpactA().map((row, i) => (i === 0 ? row.slice(0, 4) : row));
    expect(() =>
      generateMatrixFromViewA(seed(0), 'standard', constantViewA(10), badRow),
    ).toThrow(/8/);
    const badTable = emptyImpactA();
    badTable[0]![0] = badTable[0]![0]!.slice(0, 4);
    expect(() =>
      generateMatrixFromViewA(seed(0), 'standard', constantViewA(10), badTable),
    ).toThrow(/8/);
  });

  it('does not mutate the caller-supplied impactA', () => {
    const impactA = emptyImpactA();
    impactA[2]![2]![2] = '+';
    const before = JSON.stringify(impactA);
    generateMatrixFromViewA(seed(0), 'standard', constantViewA(10), impactA);
    expect(JSON.stringify(impactA)).toBe(before);
  });
});

describe('matrix.generateMatrix — golden regression', () => {
  it('produces pinned output for seed 0x4040 (catches Math.random leaks)', () => {
    const fixturePath = join(__dirname, '__fixtures__', 'matrix-golden.json');
    const fixture = JSON.parse(readFileSync(fixturePath, 'utf-8')) as {
      seed: number;
      matrix: unknown;
    };
    const { matrix } = generateMatrix(seed(fixture.seed), 'standard');
    expect(matrix).toEqual(fixture.matrix);
  });
});
