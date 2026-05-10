import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateMatrix, generateMatrixFromViewA, MATRIX_SIZE } from './matrix.js';
import { ATLAS_TIERS } from './score.js';
import type { Score } from './score.js';
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
