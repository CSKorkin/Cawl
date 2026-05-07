/**
 * M1 demo: generate an 8×8 pairing matrix and print both team views
 * side by side with ANSI color bands.
 *
 * Run with:  npx tsx demos/m1-matrix.ts [seed] [--atlas]
 *   seed:     hex integer (default 0x4040)
 *   --atlas:  use the ordinal {1, 2, 2.5, 3, 3.5, 4, 5} score mode
 *
 * Each cell is the row team's expected score for that matchup. WTC scoring
 * splits a fixed total per matchup, so viewA and viewB are STRUCTURAL
 * INVERSES of each other (high A-score implies low B-score), with per-cell
 * variance applied on top. The diff marker shows how much each cell
 * deviates from the exact inverse — that residual is the ±3 (standard) or
 * ±1 ordinal step (atlas) noise that makes pairing a game of incomplete
 * information over slightly different beliefs about a shared matchup.
 */

import { generateMatrix, MATRIX_SIZE } from '../src/engine/matrix.js';
import { colorBand, invert } from '../src/engine/score.js';
import { seed as mkSeed } from '../src/engine/rng.js';
import type { Score, ScoreMode } from '../src/engine/score.js';

// ── ANSI color helpers ────────────────────────────────────────────────────────

const RESET = '\x1b[0m';
const BOLD  = '\x1b[1m';
const DIM   = '\x1b[2m';

const BAND_COLOR: Record<string, string> = {
  red:        '\x1b[91m', // bright red
  orange:     '\x1b[33m', // yellow-orange
  yellow:     '\x1b[93m', // bright yellow
  lightGreen: '\x1b[92m', // bright green
  darkGreen:  '\x1b[32m', // green
};

// Atlas values include "2.5" / "3.5", so 3-char width handles both modes.
const CELL_WIDTH = 3;

function paint(score: Score): string {
  const band = colorBand(score);
  const color = BAND_COLOR[band] ?? '';
  const val = score.value.toString().padStart(CELL_WIDTH, ' ');
  return `${color}${val}${RESET}`;
}

// ── Diff marker ───────────────────────────────────────────────────────────────

// Compares the row-team's view to the EXACT INVERSE of the col-team's view.
// Under the split-scoring model, perfect agreement means b = invert(a). The
// residual `delta = (row - invert(col))` is the variance term, bounded by ±3
// (standard) or ±1 ordinal step (atlas).
function diffMarker(rowView: Score, colView: Score): string {
  const inv = invert(colView);
  const delta = (rowView.value as number) - (inv.value as number);
  if (delta === 0) return ' ';
  return delta > 0 ? `${BOLD}\x1b[36m+${RESET}` : `${BOLD}\x1b[35m-${RESET}`;
}

// ── Legend ────────────────────────────────────────────────────────────────────

function printLegend(mode: ScoreMode): void {
  if (mode === 'standard') {
    console.log(`  Legend: ${BAND_COLOR['red']}0–4${RESET} red  `
      + `${BAND_COLOR['orange']}5–8${RESET} orange  `
      + `${BAND_COLOR['yellow']}9–11${RESET} yellow  `
      + `${BAND_COLOR['lightGreen']}12–15${RESET} light green  `
      + `${BAND_COLOR['darkGreen']}16–20${RESET} dark green`);
  } else {
    console.log(`  Legend: ${BAND_COLOR['red']}1${RESET} red  `
      + `${BAND_COLOR['orange']}2${RESET} orange  `
      + `${BAND_COLOR['yellow']}2.5/3/3.5${RESET} yellow  `
      + `${BAND_COLOR['lightGreen']}4${RESET} light green  `
      + `${BAND_COLOR['darkGreen']}5${RESET} dark green`);
  }
  console.log(`  Diff markers (vs exact inverse of opponent's view): `
    + `${BOLD}\x1b[36m+${RESET} = row team more optimistic than split implies  `
    + `${BOLD}\x1b[35m-${RESET} = row team more pessimistic  `
    + `(space) = exact inverse`);
}

// ── Grid printer ──────────────────────────────────────────────────────────────

const ARMY_LABELS = ['α', 'β', 'γ', 'δ', 'ε', 'ζ', 'η', 'θ'];
const COL_STRIDE = CELL_WIDTH + 2; // value + diff marker + separator space

function printHeader(label: string): void {
  console.log(`\n  ${BOLD}${label}${RESET}`);
  const cols = ARMY_LABELS.slice(0, MATRIX_SIZE)
    .map(l => `${DIM}${l.padStart(CELL_WIDTH)}${RESET} `)
    .join(' ');
  console.log(`        ${cols}`);
  console.log(`       ${'─'.repeat(MATRIX_SIZE * COL_STRIDE)}`);
}

function printViewA(
  viewA: readonly (readonly Score[])[],
  viewBTransposed: readonly (readonly Score[])[],
): void {
  printHeader("Team A's view  (row = A army, col = B army)");
  for (let i = 0; i < MATRIX_SIZE; i++) {
    const cells = viewA[i]!.map((score, j) => {
      const bScore = viewBTransposed[i]![j]!;
      return `${paint(score)}${diffMarker(score, bScore)}`;
    }).join(' ');
    console.log(`  ${DIM}${ARMY_LABELS[i]}${RESET} ${i} │ ${cells}`);
  }
}

function printViewB(
  viewB: readonly (readonly Score[])[],
  viewATransposed: readonly (readonly Score[])[],
): void {
  printHeader("Team B's view  (row = B army, col = A army)");
  for (let j = 0; j < MATRIX_SIZE; j++) {
    const cells = viewB[j]!.map((score, i) => {
      const aScore = viewATransposed[j]![i]!;
      return `${paint(score)}${diffMarker(score, aScore)}`;
    }).join(' ');
    console.log(`  ${DIM}${ARMY_LABELS[j]}${RESET} ${j} │ ${cells}`);
  }
}

// ── Delta summary ─────────────────────────────────────────────────────────────

function printSummary(
  viewA: readonly (readonly Score[])[],
  viewB: readonly (readonly Score[])[],
  mode: ScoreMode,
): void {
  // Variance term per cell: how much B's view deviates from the exact inverse
  // of A's. Zero means perfect agreement on the split; up to the mode's bound
  // means each team's belief independently drifts from the structural midpoint.
  let nonZero = 0;
  let totalAbsDelta = 0;
  let maxAbsDelta = 0;
  for (let i = 0; i < MATRIX_SIZE; i++) {
    for (let j = 0; j < MATRIX_SIZE; j++) {
      const a = viewA[i]![j]!;
      const b = viewB[j]![i]!;
      const inv = invert(a);
      const delta = Math.abs((b.value as number) - (inv.value as number));
      if (delta > 0) nonZero++;
      totalAbsDelta += delta;
      if (delta > maxAbsDelta) maxAbsDelta = delta;
    }
  }
  const pct = ((nonZero / (MATRIX_SIZE * MATRIX_SIZE)) * 100).toFixed(0);
  const avg = (totalAbsDelta / (MATRIX_SIZE * MATRIX_SIZE)).toFixed(2);
  const unit = mode === 'standard' ? 'points' : 'tier-numeric';
  console.log(`\n  ${BOLD}Variance from split:${RESET} ${nonZero}/64 cells off the exact inverse (${pct}%), `
    + `mean |Δ| ${avg} ${unit}, max |Δ| ${maxAbsDelta}`);
  console.log(`  ${DIM}Each team's view ≈ inverse of the other's, plus per-cell noise. The noise is the asymmetry.${RESET}`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const useAtlas = args.includes('--atlas');
const seedArg = args.find(a => !a.startsWith('--'));
const rawSeed = parseInt(seedArg ?? '0x4040', 16);
const mode: ScoreMode = useAtlas ? 'atlas' : 'standard';

const s = mkSeed(rawSeed);
const { matrix } = generateMatrix(s, mode);

console.log(`\n${BOLD}Cawl M1 demo — pairing matrix${RESET}  seed 0x${rawSeed.toString(16).toUpperCase()}  mode ${mode}`);
printLegend(mode);

const viewBTransposed: Score[][] = Array.from({ length: MATRIX_SIZE }, (_, i) =>
  Array.from({ length: MATRIX_SIZE }, (_, j) => matrix.viewB[j]![i]!),
);
const viewATransposed: Score[][] = Array.from({ length: MATRIX_SIZE }, (_, j) =>
  Array.from({ length: MATRIX_SIZE }, (_, i) => matrix.viewA[i]![j]!),
);

printViewA(matrix.viewA, viewBTransposed);
printViewB(matrix.viewB, viewATransposed);
printSummary(matrix.viewA, matrix.viewB, mode);
console.log();
