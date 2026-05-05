/**
 * M1 demo: generate an 8×8 pairing matrix and print both team views
 * side by side with ANSI color bands.
 *
 * Run with:  npx tsx demos/m1-matrix.ts [seed] [--atlas]
 *   seed:     hex integer (default 0x4040)
 *   --atlas:  use the ordinal {1, 2, 2.5, 3, 3.5, 4, 5} score mode
 *
 * Each cell is Team A's expected score for that matchup. viewA is the
 * anchor; viewB is one application of variance per cell, so viewA[i][j]
 * and viewB[j][i] differ by at most ±3 (standard) or ±1 ordinal step
 * (atlas) — that bounded asymmetry is the whole game.
 */

import { generateMatrix, MATRIX_SIZE } from '../src/engine/matrix.js';
import { colorBand } from '../src/engine/score.js';
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

function diffMarker(a: Score, b: Score): string {
  if (a.value === b.value) return ' ';
  const delta = (a.value as number) - (b.value as number);
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
  console.log(`  Diff markers: ${BOLD}\x1b[36m+${RESET} = A sees higher  `
    + `${BOLD}\x1b[35m-${RESET} = A sees lower  (space) = identical`);
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
  let diffs = 0;
  let totalDelta = 0;
  for (let i = 0; i < MATRIX_SIZE; i++) {
    for (let j = 0; j < MATRIX_SIZE; j++) {
      const a = viewA[i]![j]!;
      const b = viewB[j]![i]!;
      if (a.value !== b.value) {
        diffs++;
        totalDelta += Math.abs((a.value as number) - (b.value as number));
      }
    }
  }
  const pct = ((diffs / (MATRIX_SIZE * MATRIX_SIZE)) * 100).toFixed(0);
  const avg = diffs > 0 ? (totalDelta / diffs).toFixed(2) : '0.00';
  const unit = mode === 'standard' ? 'points' : 'tier-numeric';
  console.log(`\n  ${BOLD}Asymmetry:${RESET} ${diffs}/64 cells differ (${pct}%), average delta ${avg} ${unit}`);
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
