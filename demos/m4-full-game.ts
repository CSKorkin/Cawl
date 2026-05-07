/**
 * M4 demo: drive a full game from init to GAME_COMPLETE.
 *
 * Run with:  npx tsx demos/m4-full-game.ts [seed]
 *   seed:    hex integer (default 0xC4W1)
 *
 * Walks the engine through Round 1, Round 2, and the Scrum with deterministic
 * legal choices off a seeded PRNG, narrating each phase. The payoff is the
 * Scrum: two transitions through AUTO_LAST_MAN and AUTO_REFUSED_PAIR happen
 * inside single applyAction calls — externally invisible as a phase, but
 * structurally proven by the LastManAutoPaired and RefusedAutoPaired log
 * entries. The demo ends with the table-ordered 8-pairing slate, a log-entry
 * tally, and a JSON round-trip check, which together are the M4 acceptance.
 */

import {
  createInitialState,
  applyAction,
  rollInitialToken,
} from '../src/engine/state.js';
import type { PairingState, Pairing } from '../src/engine/state.js';
import { pick, nextInt, seed as mkSeed } from '../src/engine/rng.js';
import type { RngState } from '../src/engine/rng.js';
import type { ArmyId, LogEntry, Team } from '../src/engine/log.js';

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

// ── Seeded legal-action picker ───────────────────────────────────────────────
//
// Mirrors the strategy used by the 200-seed property test so this demo's
// "decisions" are guaranteed legal for any seed. The PRNG is separate from
// state.rng so the demo's RNG drift doesn't perturb engine-internal RNG.

function pickFromPool(rng: RngState, pool: readonly ArmyId[]): { rng: RngState; armyId: ArmyId } {
  const r = pick(rng, pool);
  return { rng: r.state, armyId: r.value };
}

function pickPair(
  rng: RngState,
  pool: readonly ArmyId[],
  excluding: ArmyId,
): { rng: RngState; pair: readonly [ArmyId, ArmyId] } {
  const eligible = pool.filter(a => a !== excluding);
  const r1 = nextInt(rng, 0, eligible.length - 1);
  const v1 = eligible[r1.value]!;
  const remaining = eligible.filter(a => a !== v1);
  const r2 = nextInt(r1.state, 0, remaining.length - 1);
  const v2 = remaining[r2.value]!;
  return { rng: r2.state, pair: [v1, v2] };
}

function pickFreeTable(rng: RngState, used: ReadonlySet<number>): { rng: RngState; tableId: number } {
  const r = nextInt(rng, 1, 8);
  let id = r.value;
  while (used.has(id)) id = (id % 8) + 1;
  return { rng: r.state, tableId: id };
}

// ── Dispatch wrapper that fails loudly ───────────────────────────────────────

function dispatch(state: PairingState, action: Parameters<typeof applyAction>[1]): {
  state: PairingState;
  events: readonly LogEntry[];
} {
  const r = applyAction(state, action);
  if (!r.ok) {
    console.error(`${RED}Engine rejected action:${RESET}`, action);
    console.error(`${RED}Error:${RESET}`, r.error);
    console.error(`${DIM}Phase: ${state.phase}${RESET}`);
    process.exit(1);
  }
  return { state: r.state, events: r.events };
}

function otherTeam(t: Team): Team {
  return t === 'A' ? 'B' : 'A';
}

// ── Per-event renderer ──────────────────────────────────────────────────────

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
        // aRefused / bRefused name the *refusing* team — i.e., aRefused is the
        // army A chose to refuse (which is one of B's attackers), and vice versa.
        console.log(`    ${YELLOW}reveal${RESET} refusals:  A refuses ${BOLD}${e.aRefused}${RESET} (one of B's attackers)  B refuses ${BOLD}${e.bRefused}${RESET} (one of A's attackers)`);
        break;
      case 'TokenRollOff':
        console.log(`    ${MAGENTA}● token roll-off${RESET}: ${BOLD}${e.winner}${RESET} wins`);
        break;
      case 'TokenFlipped':
        console.log(`    ${MAGENTA}↔ token flips${RESET} → ${BOLD}${e.newHolder}${RESET} ${DIM}(${e.reason})${RESET}`);
        break;
      case 'TableChosen': {
        const who = e.defenderArmy ? `defends ${e.defenderArmy}` : `${DIM}(auto-paired game, no defender)${RESET}`;
        console.log(`    ${GREEN}table${RESET} T${e.tableId} ← ${BOLD}${e.team}${RESET} ${who}`);
        break;
      }
      case 'LastManAutoPaired':
        console.log(`    ${BOLD}${MAGENTA}★ AUTO_LAST_MAN${RESET}  →  ${BOLD}${e.aArmy}${RESET} vs ${BOLD}${e.bArmy}${RESET} ${DIM}(committed in same applyAction call)${RESET}`);
        break;
      case 'RefusedAutoPaired':
        console.log(`    ${BOLD}${MAGENTA}★ AUTO_REFUSED_PAIR${RESET} →  ${BOLD}${e.aArmy}${RESET} vs ${BOLD}${e.bArmy}${RESET} ${DIM}(committed in same applyAction call)${RESET}`);
        break;
    }
  }
}

// ── Phase drivers ───────────────────────────────────────────────────────────

interface DriverState {
  s: PairingState;
  rng: RngState;
}

function playDefendersAttackersRefusals(d: DriverState): DriverState {
  // Both teams lock defenders; second lock collapses + advances phase.
  const aDef = pickFromPool(d.rng, d.s.poolA); d.rng = aDef.rng;
  let r = dispatch(d.s, { type: 'LOCK_IN_DEFENDER', team: 'A', armyId: aDef.armyId });
  d.s = r.state; renderEvents(r.events);
  const bDef = pickFromPool(d.rng, d.s.poolB); d.rng = bDef.rng;
  r = dispatch(d.s, { type: 'LOCK_IN_DEFENDER', team: 'B', armyId: bDef.armyId });
  d.s = r.state; renderEvents(r.events);

  // Both teams lock attackers (excluding own defender).
  const aAtk = pickPair(d.rng, d.s.poolA, aDef.armyId); d.rng = aAtk.rng;
  r = dispatch(d.s, { type: 'LOCK_IN_ATTACKERS', team: 'A', armyIds: aAtk.pair });
  d.s = r.state; renderEvents(r.events);
  const bAtk = pickPair(d.rng, d.s.poolB, bDef.armyId); d.rng = bAtk.rng;
  r = dispatch(d.s, { type: 'LOCK_IN_ATTACKERS', team: 'B', armyIds: bAtk.pair });
  d.s = r.state; renderEvents(r.events);

  // Each team refuses one of the OTHER team's attackers.
  const aRef = pick(d.rng, bAtk.pair); d.rng = aRef.state;
  r = dispatch(d.s, { type: 'LOCK_IN_REFUSAL', team: 'A', armyId: aRef.value });
  d.s = r.state; renderEvents(r.events);
  const bRef = pick(d.rng, aAtk.pair); d.rng = bRef.state;
  r = dispatch(d.s, { type: 'LOCK_IN_REFUSAL', team: 'B', armyId: bRef.value });
  d.s = r.state; renderEvents(r.events);
  return d;
}

function pickTwoTablesTokenFirst(d: DriverState, used: Set<number>): DriverState {
  const h = d.s.tokenHolder!;
  const t1 = pickFreeTable(d.rng, used); d.rng = t1.rng; used.add(t1.tableId);
  let r = dispatch(d.s, { type: 'LOCK_IN_TABLE', team: h, tableId: t1.tableId });
  d.s = r.state; renderEvents(r.events);
  const t2 = pickFreeTable(d.rng, used); d.rng = t2.rng; used.add(t2.tableId);
  r = dispatch(d.s, { type: 'LOCK_IN_TABLE', team: otherTeam(h), tableId: t2.tableId });
  d.s = r.state; renderEvents(r.events);
  return d;
}

function pickTwoTablesHolderOnly(d: DriverState, used: Set<number>): DriverState {
  const h = d.s.tokenHolder!;
  const t1 = pickFreeTable(d.rng, used); d.rng = t1.rng; used.add(t1.tableId);
  let r = dispatch(d.s, { type: 'LOCK_IN_TABLE', team: h, tableId: t1.tableId });
  d.s = r.state; renderEvents(r.events);
  const t2 = pickFreeTable(d.rng, used); d.rng = t2.rng; used.add(t2.tableId);
  r = dispatch(d.s, { type: 'LOCK_IN_TABLE', team: h, tableId: t2.tableId });
  d.s = r.state; renderEvents(r.events);
  return d;
}

function usedTables(s: PairingState): Set<number> {
  return new Set(s.pairings.map(p => p.tableId).filter((x): x is number => x !== undefined));
}

// ── Final slate renderer ────────────────────────────────────────────────────

function roundLabel(p: Pairing): string {
  if (p.round === 1) return 'R1';
  if (p.round === 2) return 'R2';
  return p.defenderTeam === null ? 'Sc*' : 'Sc';
}

function defenderLabel(p: Pairing): string {
  if (p.defenderTeam === null) return `${DIM}auto-paired${RESET}`;
  return `${p.defenderTeam} defends`;
}

function renderSlate(state: PairingState): void {
  const sorted = [...state.pairings].sort((a, b) => (a.tableId ?? 0) - (b.tableId ?? 0));
  console.log(`  ${DIM}T#  Round  Pairing            Defender${RESET}`);
  console.log(`  ${DIM}──  ─────  ─────────────────  ──────────────${RESET}`);
  for (const p of sorted) {
    const t = `T${p.tableId}`.padEnd(3);
    const round = roundLabel(p).padEnd(5);
    const matchup = `${BOLD}${p.aArmy}${RESET} vs ${BOLD}${p.bArmy}${RESET}`.padEnd(28);
    console.log(`  ${t} ${round}  ${matchup}  ${defenderLabel(p)}`);
  }
}

function renderLogTally(log: readonly LogEntry[]): void {
  const counts: Record<string, number> = {};
  for (const e of log) counts[e.type] = (counts[e.type] ?? 0) + 1;
  const order: LogEntry['type'][] = [
    'DefendersRevealed',
    'AttackersRevealed',
    'RefusalsRevealed',
    'TokenRollOff',
    'TokenFlipped',
    'TableChosen',
    'LastManAutoPaired',
    'RefusedAutoPaired',
  ];
  for (const t of order) {
    const n = counts[t] ?? 0;
    console.log(`    ${t.padEnd(20)} ${BOLD}${n}${RESET}`);
  }
}

// ── Main ────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const seedArg = args.find(a => !a.startsWith('--'));
const rawSeed = parseInt(seedArg ?? '0xC4441', 16);

const ROSTER_A: ArmyId[] = Array.from({ length: 8 }, (_, i) => `a${i}`);
const ROSTER_B: ArmyId[] = Array.from({ length: 8 }, (_, i) => `b${i}`);

console.log(`\n${BOLD}Cawl M4 demo — full game with Scrum auto-resolution${RESET}`);
console.log(`${DIM}seed 0x${rawSeed.toString(16).toUpperCase()}  mode standard${RESET}`);

let d: DriverState = {
  s: createInitialState({ mode: 'standard', seed: rawSeed, rosterA: ROSTER_A, rosterB: ROSTER_B }),
  // Independent PRNG for the demo's "what to lock in" choices, so engine RNG
  // drift (e.g., from rollInitialToken) doesn't change which armies get picked.
  rng: mkSeed(rawSeed ^ 0xDEC0DE),
};

// ── Round 1 ───────────────────────────────────────────────────────────────────
header('ROUND 1');
sub('Defenders → Attackers → Refusals');
d = playDefendersAttackersRefusals(d);
sub('Token roll-off');
const r1Roll = rollInitialToken(d.s);
const rollRes = dispatch(d.s, { type: 'RESOLVE_INITIAL_TOKEN', winner: r1Roll.winner });
d.s = rollRes.state; renderEvents(rollRes.events);
sub('Tables (token-holder picks first)');
d = pickTwoTablesTokenFirst(d, usedTables(d.s));

// ── Round 2 ───────────────────────────────────────────────────────────────────
header('ROUND 2');
sub('Defenders → Attackers → Refusals');
d = playDefendersAttackersRefusals(d);
sub('Tables (current token-holder picks first)');
d = pickTwoTablesTokenFirst(d, usedTables(d.s));

// ── Scrum ─────────────────────────────────────────────────────────────────────
header('SCRUM');
console.log(`  ${DIM}Pools entering scrum: A=[${d.s.poolA.join(',')}]  B=[${d.s.poolB.join(',')}]${RESET}`);
sub('Defenders → Attackers');
// Defenders lock-in and attackers lock-in. The second attacker lock-in will
// trip AUTO_LAST_MAN inside the same applyAction — watch for the ★ marker.
const aDef = pickFromPool(d.rng, d.s.poolA); d.rng = aDef.rng;
let r = dispatch(d.s, { type: 'LOCK_IN_DEFENDER', team: 'A', armyId: aDef.armyId });
d.s = r.state; renderEvents(r.events);
const bDef = pickFromPool(d.rng, d.s.poolB); d.rng = bDef.rng;
r = dispatch(d.s, { type: 'LOCK_IN_DEFENDER', team: 'B', armyId: bDef.armyId });
d.s = r.state; renderEvents(r.events);
const aAtk = pickPair(d.rng, d.s.poolA, aDef.armyId); d.rng = aAtk.rng;
r = dispatch(d.s, { type: 'LOCK_IN_ATTACKERS', team: 'A', armyIds: aAtk.pair });
d.s = r.state; renderEvents(r.events);
const bAtk = pickPair(d.rng, d.s.poolB, bDef.armyId); d.rng = bAtk.rng;
r = dispatch(d.s, { type: 'LOCK_IN_ATTACKERS', team: 'B', armyIds: bAtk.pair });
d.s = r.state; renderEvents(r.events);
console.log(`    ${DIM}phase after attackers reveal: ${d.s.phase}${RESET}`);

sub('Refusals (second refusal will trip AUTO_REFUSED_PAIR)');
const aRef = pick(d.rng, bAtk.pair); d.rng = aRef.state;
r = dispatch(d.s, { type: 'LOCK_IN_REFUSAL', team: 'A', armyId: aRef.value });
d.s = r.state; renderEvents(r.events);
const bRef = pick(d.rng, aAtk.pair); d.rng = bRef.state;
r = dispatch(d.s, { type: 'LOCK_IN_REFUSAL', team: 'B', armyId: bRef.value });
d.s = r.state; renderEvents(r.events);
console.log(`    ${DIM}phase after refusal reveal: ${d.s.phase}${RESET}`);

sub('Phase A tables  (defender-led games — token-holder picks first)');
const used = usedTables(d.s);
d = pickTwoTablesTokenFirst(d, used);
sub('Phase B tables  (auto-paired games — token-holder picks both)');
d = pickTwoTablesHolderOnly(d, used);

// ── Done ──────────────────────────────────────────────────────────────────────
header('GAME_COMPLETE');
console.log(`  Final phase: ${BOLD}${CYAN}${d.s.phase}${RESET}`);
console.log(`  Pools: A=[${d.s.poolA.join(',') || DIM + 'empty' + RESET}]  B=[${d.s.poolB.join(',') || DIM + 'empty' + RESET}]`);
console.log();
sub('Pairing slate (table-ordered)');
renderSlate(d.s);
console.log();
sub('Log tally');
renderLogTally(d.s.log);

// Sanity invariants — the M4 acceptance criteria, asserted live.
const tableIds = d.s.pairings.map(p => p.tableId);
const ok =
  d.s.phase === 'GAME_COMPLETE'
  && d.s.pairings.length === 8
  && new Set(tableIds).size === 8
  && d.s.poolA.length === 0
  && d.s.poolB.length === 0
  && d.s.log.filter(e => e.type === 'LastManAutoPaired').length === 1
  && d.s.log.filter(e => e.type === 'RefusedAutoPaired').length === 1
  && JSON.stringify(JSON.parse(JSON.stringify(d.s))) === JSON.stringify(d.s);

console.log();
if (ok) {
  console.log(`  ${GREEN}✓ M4 invariants hold: GAME_COMPLETE, 8 pairings, 8 distinct tables,${RESET}`);
  console.log(`  ${GREEN}  pools drained, exactly 1 LastManAutoPaired + 1 RefusedAutoPaired,${RESET}`);
  console.log(`  ${GREEN}  state JSON round-trips losslessly.${RESET}`);
} else {
  console.log(`  ${RED}✗ M4 invariants FAILED${RESET}`);
  process.exit(1);
}
console.log();
