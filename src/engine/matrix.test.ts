import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateMatrix, MATRIX_SIZE } from './matrix.js';
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

describe('matrix.generateMatrix — asymmetry property', () => {
  // Per CLAUDE.md: "Team B sees the same matchups from their perspective with
  // per-cell variance applied" — viewA is the anchor; viewB[j][i] is viewA[i][j]
  // with one application of variance. So |viewA[i][j] - viewB[j][i]| ≤ 3 for
  // standard mode and ≤ 1 ordinal step for atlas mode.

  it('viewA[i][j] and viewB[j][i] differ by ≤3 in standard mode (200 seeds)', () => {
    let totalDiffs = 0;
    for (let s = 0; s < 200; s++) {
      const { matrix } = generateMatrix(seed(s), 'standard');
      for (let i = 0; i < MATRIX_SIZE; i++) {
        for (let j = 0; j < MATRIX_SIZE; j++) {
          const a = matrix.viewA[i]![j]!;
          const b = matrix.viewB[j]![i]!;
          expect(a.mode).toBe('standard');
          expect(b.mode).toBe('standard');
          if (a.mode === 'standard' && b.mode === 'standard') {
            expect(Math.abs(a.value - b.value)).toBeLessThanOrEqual(3);
            if (a.value !== b.value) totalDiffs++;
          }
        }
      }
    }
    // Overwhelming probability that at least one cell differs across 200 seeds.
    expect(totalDiffs).toBeGreaterThan(0);
  });

  it('regression: seed 0x102 cell viewA[0][1] vs viewB[1][0] differ by ≤3', () => {
    // User-reported bug: with the original "independent variance from a hidden
    // truth" model, this seed produced viewA[0][1] = 13, viewB[1][0] = 8 (Δ=5),
    // violating the ±3 bound that CLAUDE.md prescribes.
    const { matrix } = generateMatrix(seed(0x102), 'standard');
    const a = matrix.viewA[0]![1]!;
    const b = matrix.viewB[1]![0]!;
    if (a.mode === 'standard' && b.mode === 'standard') {
      expect(Math.abs(a.value - b.value)).toBeLessThanOrEqual(3);
    }
  });

  it('atlas views are within ±1 ordinal step of each other (100 seeds)', () => {
    for (let s = 0; s < 100; s++) {
      const { matrix } = generateMatrix(seed(s), 'atlas');
      for (let i = 0; i < MATRIX_SIZE; i++) {
        for (let j = 0; j < MATRIX_SIZE; j++) {
          const a = matrix.viewA[i]![j]!;
          const b = matrix.viewB[j]![i]!;
          if (a.mode === 'atlas' && b.mode === 'atlas') {
            const idxA = ATLAS_TIERS.indexOf(a.value);
            const idxB = ATLAS_TIERS.indexOf(b.value);
            expect(Math.abs(idxA - idxB)).toBeLessThanOrEqual(1);
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
