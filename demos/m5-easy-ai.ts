/**
 * M5 demo: easy AI plays itself.
 *
 * Run with:  npx tsx demos/m5-easy-ai.ts [seed]
 *   seed:    hex integer (default 0xEA51)
 *
 * Runs runGame(init, easyActor('A'), easyActor('B')) and narrates each
 * decision with the score behind it — the mean expected score for defenders,
 * the per-matchup score for attackers/refusals, the lowest available id for
 * tables. Ends with a final slate, the log, and a 100-seed timing batch
 * proving the M5 acceptance: easy-vs-easy completes in well under 50ms.
 */

import { performance } from 'node:perf_hooks';
import {
  createInitialState,
  applyAction,
  rollInitialToken,
  viewFor,
} from '../src/engine/state.js';
import type { PairingState, Pairing, TeamView } from '../src/engine/state.js';
import { easyActor, runGame } from '../src/engine/ai.js';
import type { Actor } from '../src/engine/ai.js';
import type { ArmyId, LogEntry, Round, Team } from '../src/engine/log.js';
import { MATRIX_SIZE } from '../src/engine/matrix.js';
import { colorBand, invert } from '../src/engine/score.js';
import type { Score, ScoreMode } from '../src/engine/score.js';

// ── ANSI helpers ─────────────────────────────────────────────────────────────

const RESET   = '\x1b[0m';
const BOLD    = '\x1b[1m';
const DIM     = '\x1b[2m';
const GREEN   = '\x1b[32m';
const YELLOW  = '\x1b[93m';
const CYAN    = '\x1b[36m';
const MAGENTA = '\x1b[95m';
const RED     = '\x1b[91m';

function header(label: string): void {
  const bar = '═'.repeat(Math.max(0, 70 - label.length - 8));
  console.log(`\n${BOLD}═══ ${label} ${bar}${RESET}`);
}

function sub(label: string): void {
  console.log(`  ${BOLD}${CYAN}${label}${RESET}`);
}

// ── Matrix rendering (ported from M1 to keep visual style consistent) ────────

const BAND_COLOR: Record<string, string> = {
  red:        '\x1b[91m',
  orange:     '\x1b[33m',
  yellow:     '\x1b[93m',
  lightGreen: '\x1b[92m',
  darkGreen:  '\x1b[32m',
};

const CELL_WIDTH = 3;
const COL_STRIDE = CELL_WIDTH + 2;
const ARMY_LABELS = ['α', 'β', 'γ', 'δ', 'ε', 'ζ', 'η', 'θ'];

function paint(score: Score): string {
  const color = BAND_COLOR[colorBand(score)] ?? '';
  return `${color}${score.value.toString().padStart(CELL_WIDTH, ' ')}${RESET}`;
}

function diffMarker(rowView: Score, colView: Score): string {
  // Asymmetry sign vs the exact inverse of the col team's view (split-scoring
  // is the structural identity; this marker shows the noise on top).
  const inv = invert(colView);
  const delta = (rowView.value as number) - (inv.value as number);
  if (delta === 0) return ' ';
  return delta > 0 ? `${BOLD}\x1b[36m+${RESET}` : `${BOLD}\x1b[35m-${RESET}`;
}

function printMatrixLegend(mode: ScoreMode): void {
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

function printGridHeader(label: string): void {
  console.log(`\n  ${BOLD}${label}${RESET}`);
  const cols = ARMY_LABELS.slice(0, MATRIX_SIZE)
    .map(l => `${DIM}${l.padStart(CELL_WIDTH)}${RESET} `)
    .join(' ');
  console.log(`        ${cols}`);
  console.log(`       ${'─'.repeat(MATRIX_SIZE * COL_STRIDE)}`);
}

function printMatrices(state: PairingState): void {
  const { viewA, viewB } = state.matrix;
  printMatrixLegend(state.mode);

  // Team A view: row=A army, col=B army; diff vs viewB[col][row].
  printGridHeader("Team A's view  (row = A army, col = B army)");
  for (let i = 0; i < MATRIX_SIZE; i++) {
    const cells = viewA[i]!.map((score, j) => {
      const bScore = viewB[j]![i]!;
      return `${paint(score)}${diffMarker(score, bScore)}`;
    }).join(' ');
    console.log(`  ${DIM}${ARMY_LABELS[i]}${RESET} ${i} │ ${cells}`);
  }

  // Team B view: row=B army, col=A army; diff vs viewA[col][row].
  printGridHeader("Team B's view  (row = B army, col = A army)");
  for (let j = 0; j < MATRIX_SIZE; j++) {
    const cells = viewB[j]!.map((score, i) => {
      const aScore = viewA[i]![j]!;
      return `${paint(score)}${diffMarker(score, aScore)}`;
    }).join(' ');
    console.log(`  ${DIM}${ARMY_LABELS[j]}${RESET} ${j} │ ${cells}`);
  }

  // Variance from the structural inverse: how much B's belief about each
  // matchup deviates from invert(A's belief). Each team plays its OWN view,
  // and that residual noise is what makes the same matchup look different
  // to each side.
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
  const unit = state.mode === 'standard' ? 'points' : 'tier-numeric';
  console.log(`\n  ${BOLD}Variance from split:${RESET} ${nonZero}/64 cells off the exact inverse (${pct}%), `
    + `mean |Δ| ${avg} ${unit}, max |Δ| ${maxAbsDelta}`);
  console.log(`  ${DIM}Each AI plays its own view; the residual noise drives divergent decisions.${RESET}`);
}

// ── Score-aware narration ───────────────────────────────────────────────────
//
// We recompute the same scores easyActor uses, so the narration shows WHY the
// AI picks what it does. Duplicating logic is fine here — this is a demo, and
// drift between narration and behavior would surface immediately as a wrong
// pick being reported.

function cell(view: TeamView, myArmy: ArmyId, oppArmy: ArmyId): number {
  const i = view.myRoster.indexOf(myArmy);
  const j = view.oppRoster.indexOf(oppArmy);
  return view.myView[i]![j]!.value as number;
}

function defenderRationale(view: TeamView): { armyId: ArmyId; mean: number; ranked: { armyId: ArmyId; mean: number }[] } {
  const ranked = view.myPool.map(a => {
    let sum = 0;
    for (const o of view.oppPool) sum += cell(view, a, o);
    return { armyId: a, mean: sum / view.oppPool.length };
  });
  const sorted = [...ranked].sort((x, y) => y.mean - x.mean || x.armyId.localeCompare(y.armyId));
  return { armyId: sorted[0]!.armyId, mean: sorted[0]!.mean, ranked: sorted };
}

function attackersRationale(view: TeamView, oppDefender: ArmyId): {
  pair: readonly [ArmyId, ArmyId];
  scores: { armyId: ArmyId; score: number }[];
  ownDef: ArmyId;
} {
  const ownDef = view.seat === 'A' ? view.step.defenders!.revealed!.a : view.step.defenders!.revealed!.b;
  const ranked = view.myPool
    .filter(a => a !== ownDef)
    .map(a => ({ armyId: a, score: cell(view, a, oppDefender) }))
    .sort((x, y) => x.score - y.score || x.armyId.localeCompare(y.armyId));
  return { pair: [ranked[0]!.armyId, ranked[1]!.armyId], scores: ranked, ownDef };
}

function refusalRationale(view: TeamView, attackers: readonly [ArmyId, ArmyId]): {
  refused: ArmyId;
  scores: { armyId: ArmyId; score: number }[];
  ownDef: ArmyId;
} {
  const ownDef = view.seat === 'A' ? view.step.defenders!.revealed!.a : view.step.defenders!.revealed!.b;
  const ranked = attackers.map(a => ({ armyId: a, score: cell(view, ownDef, a) }))
    .sort((x, y) => x.score - y.score || x.armyId.localeCompare(y.armyId));
  return { refused: ranked[0]!.armyId, scores: ranked, ownDef };
}

// ── Verbose actor wrapper ────────────────────────────────────────────────────

function narratingActor(seat: Team): Actor {
  const inner = easyActor(seat);
  return {
    pickDefender(view) {
      const r = defenderRationale(view);
      const top3 = r.ranked.slice(0, 3).map(x => `${x.armyId}=${x.mean.toFixed(1)}`).join('  ');
      console.log(`    ${DIM}[${seat}]${RESET} defender argmax(mean): ${top3}${r.ranked.length > 3 ? '  …' : ''}`);
      console.log(`    ${DIM}[${seat}]${RESET} ${BOLD}→ ${r.armyId}${RESET} ${DIM}(mean ${r.mean.toFixed(2)} across ${view.oppPool.length}-army opp pool)${RESET}`);
      const picked = inner.pickDefender(view);
      if (picked !== r.armyId) console.error(`${RED}narration drift: actor returned ${picked}, narration said ${r.armyId}${RESET}`);
      return picked;
    },
    pickAttackers(view, oppDef) {
      const r = attackersRationale(view, oppDef);
      const list = r.scores.map(x => `${x.armyId}=${x.score}`).join('  ');
      console.log(`    ${DIM}[${seat}]${RESET} attackers: scores vs opp def ${BOLD}${oppDef}${RESET}  →  ${list}`);
      console.log(`    ${DIM}[${seat}]${RESET} ${BOLD}→ [${r.pair[0]}, ${r.pair[1]}]${RESET} ${DIM}(two lowest; own def ${r.ownDef} excluded)${RESET}`);
      return inner.pickAttackers(view, oppDef);
    },
    pickRefusal(view, attackers) {
      const r = refusalRationale(view, attackers);
      const list = r.scores.map(x => `${x.armyId}=${x.score}`).join('  ');
      console.log(`    ${DIM}[${seat}]${RESET} refusal: matchups against own def ${BOLD}${r.ownDef}${RESET}  →  ${list}`);
      console.log(`    ${DIM}[${seat}]${RESET} ${BOLD}→ refuse ${r.refused}${RESET} ${DIM}(lowest = worst for us, hardest matchup; spec "keep the easier matchup")${RESET}`);
      return inner.pickRefusal(view, attackers);
    },
    pickTable(view, available) {
      const t = inner.pickTable(view, available);
      console.log(`    ${DIM}[${seat}]${RESET} table: available [${available.join(',')}]  →  ${BOLD}T${t}${RESET} ${DIM}(lowest)${RESET}`);
      return t;
    },
  };
}

// ── Driver mirror (same flow as runGame, but emits per-phase headers) ────────
//
// We can't use runGame directly because the demo wants per-phase headers
// printed BETWEEN actor calls. The flow below is a 1:1 mirror of runGame's
// dispatcher; if runGame ever changes, this drifts. Acceptance test below
// double-checks final state matches runGame's.

function dispatchOrThrow(state: PairingState, action: Parameters<typeof applyAction>[1]): { state: PairingState; events: readonly LogEntry[] } {
  const r = applyAction(state, action);
  if (!r.ok) {
    console.error(`${RED}dispatch failed:${RESET}`, action, r.error);
    process.exit(1);
  }
  return { state: r.state, events: r.events };
}

function renderEvents(events: readonly LogEntry[]): void {
  for (const e of events) {
    switch (e.type) {
      case 'DefendersRevealed':
        console.log(`    ${YELLOW}reveal${RESET} defenders: A=${BOLD}${e.aArmy}${RESET}  B=${BOLD}${e.bArmy}${RESET}`);
        break;
      case 'AttackersRevealed':
        console.log(`    ${YELLOW}reveal${RESET} attackers: A=${BOLD}{${e.aAttackers.join(',')}}${RESET}  B=${BOLD}{${e.bAttackers.join(',')}}${RESET}`);
        break;
      case 'RefusalsRevealed':
        console.log(`    ${YELLOW}reveal${RESET} refusals:  A refuses ${BOLD}${e.aRefused}${RESET}  B refuses ${BOLD}${e.bRefused}${RESET}`);
        break;
      case 'TokenRollOff':
        console.log(`    ${MAGENTA}● token roll-off${RESET}: ${BOLD}${e.winner}${RESET} wins`);
        break;
      case 'TokenFlipped':
        console.log(`    ${MAGENTA}↔ token flips${RESET} → ${BOLD}${e.newHolder}${RESET} ${DIM}(${e.reason})${RESET}`);
        break;
      case 'TableChosen': {
        const who = e.defenderArmy ? `defends ${e.defenderArmy}` : `${DIM}(auto-paired)${RESET}`;
        console.log(`    ${GREEN}table${RESET} T${e.tableId} ← ${BOLD}${e.team}${RESET} ${who}`);
        break;
      }
      case 'LastManAutoPaired':
        console.log(`    ${BOLD}${MAGENTA}★ AUTO_LAST_MAN${RESET}  →  ${BOLD}${e.aArmy}${RESET} vs ${BOLD}${e.bArmy}${RESET}`);
        break;
      case 'RefusedAutoPaired':
        console.log(`    ${BOLD}${MAGENTA}★ AUTO_REFUSED_PAIR${RESET} →  ${BOLD}${e.aArmy}${RESET} vs ${BOLD}${e.bArmy}${RESET}`);
        break;
    }
  }
}

function nextTableTeam(state: PairingState): Team {
  const holder = state.tokenHolder!;
  const other: Team = holder === 'A' ? 'B' : 'A';
  if (state.phase === 'SCRUM.AWAITING_TABLES') {
    const phaseAUnassigned = state.pairings.filter(
      p => p.round === 'scrum' && p.defenderTeam !== null && p.tableId === undefined,
    );
    if (phaseAUnassigned.length > 0) {
      const holderPairing = phaseAUnassigned.find(p => p.defenderTeam === holder);
      return holderPairing !== undefined ? holder : other;
    }
    return holder;
  }
  const round: Round = state.phase === 'ROUND_1.AWAITING_TABLES' ? 1 : 2;
  const holderPairing = state.pairings.find(
    p => p.round === round && p.defenderTeam === holder && p.tableId === undefined,
  );
  return holderPairing !== undefined ? holder : other;
}

function availableTables(state: PairingState): number[] {
  const used = new Set(state.pairings.map(p => p.tableId).filter((x): x is number => x !== undefined));
  const out: number[] = [];
  for (let i = 1; i <= 8; i++) if (!used.has(i)) out.push(i);
  return out;
}

function playWithNarration(initial: PairingState, actorA: Actor, actorB: Actor): PairingState {
  let state = initial;
  let lastPhase: string | null = null;
  for (let i = 0; i < 200 && state.phase !== 'GAME_COMPLETE'; i++) {
    if (state.phase !== lastPhase) {
      const phaseHeader = state.phase
        .replace('ROUND_1', 'ROUND 1')
        .replace('ROUND_2', 'ROUND 2')
        .replace('SCRUM.', 'SCRUM ');
      sub(`Phase: ${phaseHeader}`);
      lastPhase = state.phase;
    }
    switch (state.phase) {
      case 'ROUND_1.AWAITING_DEFENDERS':
      case 'ROUND_2.AWAITING_DEFENDERS':
      case 'SCRUM.AWAITING_DEFENDERS': {
        const aId = actorA.pickDefender(viewFor(state, 'A'));
        let r = dispatchOrThrow(state, { type: 'LOCK_IN_DEFENDER', team: 'A', armyId: aId });
        state = r.state; renderEvents(r.events);
        const bId = actorB.pickDefender(viewFor(state, 'B'));
        r = dispatchOrThrow(state, { type: 'LOCK_IN_DEFENDER', team: 'B', armyId: bId });
        state = r.state; renderEvents(r.events);
        break;
      }
      case 'ROUND_1.AWAITING_ATTACKERS':
      case 'ROUND_2.AWAITING_ATTACKERS':
      case 'SCRUM.AWAITING_ATTACKERS': {
        const revealed = state.step.defenders!.revealed!;
        const aIds = actorA.pickAttackers(viewFor(state, 'A'), revealed.b);
        let r = dispatchOrThrow(state, { type: 'LOCK_IN_ATTACKERS', team: 'A', armyIds: aIds });
        state = r.state; renderEvents(r.events);
        const bIds = actorB.pickAttackers(viewFor(state, 'B'), revealed.a);
        r = dispatchOrThrow(state, { type: 'LOCK_IN_ATTACKERS', team: 'B', armyIds: bIds });
        state = r.state; renderEvents(r.events);
        break;
      }
      case 'ROUND_1.AWAITING_REFUSALS':
      case 'ROUND_2.AWAITING_REFUSALS':
      case 'SCRUM.AWAITING_REFUSALS': {
        const revealed = state.step.attackers!.revealed!;
        const aRef = actorA.pickRefusal(viewFor(state, 'A'), revealed.b);
        let r = dispatchOrThrow(state, { type: 'LOCK_IN_REFUSAL', team: 'A', armyId: aRef });
        state = r.state; renderEvents(r.events);
        const bRef = actorB.pickRefusal(viewFor(state, 'B'), revealed.a);
        r = dispatchOrThrow(state, { type: 'LOCK_IN_REFUSAL', team: 'B', armyId: bRef });
        state = r.state; renderEvents(r.events);
        break;
      }
      case 'ROUND_1.AWAITING_TABLES': {
        if (state.tokenHolder === null) {
          const { winner } = rollInitialToken(state);
          const r = dispatchOrThrow(state, { type: 'RESOLVE_INITIAL_TOKEN', winner });
          state = r.state; renderEvents(r.events);
        }
        const team = nextTableTeam(state);
        const actor = team === 'A' ? actorA : actorB;
        const tableId = actor.pickTable(viewFor(state, team), availableTables(state));
        const r = dispatchOrThrow(state, { type: 'LOCK_IN_TABLE', team, tableId });
        state = r.state; renderEvents(r.events);
        break;
      }
      case 'ROUND_2.AWAITING_TABLES':
      case 'SCRUM.AWAITING_TABLES': {
        const team = nextTableTeam(state);
        const actor = team === 'A' ? actorA : actorB;
        const tableId = actor.pickTable(viewFor(state, team), availableTables(state));
        const r = dispatchOrThrow(state, { type: 'LOCK_IN_TABLE', team, tableId });
        state = r.state; renderEvents(r.events);
        break;
      }
      default:
        console.error(`${RED}unexpected phase ${state.phase}${RESET}`); process.exit(1);
    }
  }
  return state;
}

// ── Final slate + tally ─────────────────────────────────────────────────────

function roundLabel(p: Pairing): string {
  if (p.round === 1) return 'R1';
  if (p.round === 2) return 'R2';
  return p.defenderTeam === null ? 'Sc*' : 'Sc';
}

function defenderLabel(p: Pairing): string {
  if (p.defenderTeam === null) return `${DIM}auto-paired${RESET}`;
  return `${p.defenderTeam} defends`;
}

function expectedScoreA(view: TeamView, p: Pairing): number {
  return cell(view, p.aArmy, p.bArmy);
}

function renderSlate(state: PairingState): void {
  const va = viewFor(state, 'A');
  const vb = viewFor(state, 'B');
  const sorted = [...state.pairings].sort((a, b) => (a.tableId ?? 0) - (b.tableId ?? 0));
  console.log(`  ${DIM}T#  Round  Pairing            Defender         A-score (B-score)${RESET}`);
  console.log(`  ${DIM}──  ─────  ─────────────────  ──────────────  ─────────────────${RESET}`);
  let aTotal = 0;
  let bTotal = 0;
  for (const p of sorted) {
    const t = `T${p.tableId}`.padEnd(3);
    const round = roundLabel(p).padEnd(5);
    const matchup = `${BOLD}${p.aArmy}${RESET} vs ${BOLD}${p.bArmy}${RESET}`.padEnd(28);
    const aScore = expectedScoreA(va, p);
    // For B: row=B's army (p.bArmy in B's roster), col=A's army (p.aArmy in B's view's oppRoster).
    const bScore = cell(vb, p.bArmy, p.aArmy);
    aTotal += aScore;
    bTotal += bScore;
    console.log(`  ${t} ${round}  ${matchup}  ${defenderLabel(p).padEnd(14)}  ${aScore} (${bScore})`);
  }
  console.log(`  ${DIM}──  ─────  ─────────────────  ──────────────  ─────────────────${RESET}`);
  console.log(`  ${DIM}                                            Totals: ${RESET}${BOLD}${aTotal}${RESET} (${BOLD}${bTotal}${RESET})`);
  console.log(`  ${DIM}Each game splits 20 points between teams. Totals are each team's predicted aggregate score over all 8 games; the difference is the expected scoreline.${RESET}`);
  const verdict = aTotal > bTotal ? `${BOLD}A wins${RESET} by ${aTotal - bTotal}`
    : aTotal < bTotal ? `${BOLD}B wins${RESET} by ${bTotal - aTotal}`
    : `${BOLD}draw${RESET}`;
  console.log(`  ${DIM}Predicted result (under each team's own beliefs): ${RESET}${verdict}`);
}

function renderLogTally(log: readonly LogEntry[]): void {
  const counts: Record<string, number> = {};
  for (const e of log) counts[e.type] = (counts[e.type] ?? 0) + 1;
  const order: LogEntry['type'][] = [
    'DefendersRevealed', 'AttackersRevealed', 'RefusalsRevealed',
    'TokenRollOff', 'TokenFlipped', 'TableChosen',
    'LastManAutoPaired', 'RefusedAutoPaired',
  ];
  for (const t of order) {
    const n = counts[t] ?? 0;
    console.log(`    ${t.padEnd(20)} ${BOLD}${n}${RESET}`);
  }
}

// ── Main: walkthrough ────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const seedArg = args.find(a => !a.startsWith('--'));
const rawSeed = parseInt(seedArg ?? '0xEA51', 16);

const ROSTER_A: ArmyId[] = Array.from({ length: 8 }, (_, i) => `a${i}`);
const ROSTER_B: ArmyId[] = Array.from({ length: 8 }, (_, i) => `b${i}`);

console.log(`\n${BOLD}Cawl M5 demo — easy AI plays itself${RESET}`);
console.log(`${DIM}seed 0x${rawSeed.toString(16).toUpperCase()}  mode standard${RESET}`);
console.log(`${DIM}Each AI decision shows the score it optimized over.${RESET}`);

const initial = createInitialState({
  mode: 'standard', seed: rawSeed, rosterA: ROSTER_A, rosterB: ROSTER_B,
});

header('PAIRING MATRICES');
printMatrices(initial);

header('GAME WALKTHROUGH');
const tWalk0 = performance.now();
const finalState = playWithNarration(initial, narratingActor('A'), narratingActor('B'));
const tWalk = performance.now() - tWalk0;

header('GAME_COMPLETE');
console.log(`  Final phase: ${BOLD}${CYAN}${finalState.phase}${RESET}  in ${BOLD}${tWalk.toFixed(2)}ms${RESET} ${DIM}(narration overhead included)${RESET}`);
console.log();
sub('Pairing slate');
renderSlate(finalState);
console.log();
sub('Log tally');
renderLogTally(finalState.log);

// Sanity: same seed via runGame must reach byte-equal final state.
const ref = runGame(initial, easyActor('A'), easyActor('B'));
const drift = JSON.stringify(ref.state) !== JSON.stringify(finalState);
if (drift) {
  console.log(`\n  ${RED}✗ narration driver drifted from runGame!${RESET}`);
  process.exit(1);
}

// ── Batch timing — the M5 acceptance criterion ──────────────────────────────

header('BATCH (100 seeds, no narration)');
const N = 100;
const times: number[] = [];
let pairingsTotal = 0;
const tStart = performance.now();
for (let seed = 0; seed < N; seed++) {
  const s0 = createInitialState({ mode: 'standard', seed, rosterA: ROSTER_A, rosterB: ROSTER_B });
  const t0 = performance.now();
  const { state } = runGame(s0, easyActor('A'), easyActor('B'));
  times.push(performance.now() - t0);
  if (state.phase !== 'GAME_COMPLETE') {
    console.error(`${RED}seed ${seed} did not reach GAME_COMPLETE${RESET}`);
    process.exit(1);
  }
  pairingsTotal += state.pairings.length;
}
const tTotal = performance.now() - tStart;

const sorted = [...times].sort((a, b) => a - b);
const mean = times.reduce((a, b) => a + b, 0) / times.length;
const p50 = sorted[Math.floor(sorted.length * 0.5)]!;
const p95 = sorted[Math.floor(sorted.length * 0.95)]!;
const max = sorted[sorted.length - 1]!;

console.log(`  ${BOLD}${N}${RESET} games, ${BOLD}${pairingsTotal}${RESET} pairings total (${pairingsTotal / N} per game)`);
console.log(`  Wall:    ${BOLD}${tTotal.toFixed(1)}ms${RESET} total`);
console.log(`  Per-game timing  mean ${BOLD}${mean.toFixed(3)}ms${RESET}  p50 ${p50.toFixed(3)}ms  p95 ${p95.toFixed(3)}ms  max ${BOLD}${max.toFixed(3)}ms${RESET}`);

const M5_BUDGET_MS = 50;
if (max < M5_BUDGET_MS) {
  console.log(`\n  ${GREEN}✓ M5 acceptance: every game under ${M5_BUDGET_MS}ms (max ${max.toFixed(3)}ms).${RESET}`);
  console.log(`  ${GREEN}  The engine is now a REPL toy: easyActor('A') vs easyActor('B') runs in microseconds.${RESET}`);
} else {
  console.log(`\n  ${RED}✗ M5 budget exceeded: ${max.toFixed(3)}ms > ${M5_BUDGET_MS}ms${RESET}`);
  process.exit(1);
}
console.log();
