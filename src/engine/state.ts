// FSM core: types, initial state constructor, viewFor projection, and a
// default-illegal applyAction dispatcher. Real transitions land in T7+.
//
// All public state is JSON-serializable: no class instances, Maps, Sets,
// Dates, or methods. `viewFor` is the only sanctioned way to read state
// from outside the engine — it strips the opposing team's pending slots.

import { generateMatrix } from './matrix.js';
import type { Matrix } from './matrix.js';
import type { Score, ScoreMode } from './score.js';
import { pick, seed as mkSeed } from './rng.js';
import type { RngState } from './rng.js';
import type { ArmyId, LogEntry, Round, TableId, Team } from './log.js';

// ── Phase literal union (all 18 spec phases) ──────────────────────────────────

export type Phase =
  | 'INIT'
  | 'ROUND_1.AWAITING_DEFENDERS'
  | 'ROUND_1.AWAITING_ATTACKERS'
  | 'ROUND_1.AWAITING_REFUSALS'
  | 'ROUND_1.AWAITING_TABLES'
  | 'ROUND_1_COMPLETE'
  | 'ROUND_2.AWAITING_DEFENDERS'
  | 'ROUND_2.AWAITING_ATTACKERS'
  | 'ROUND_2.AWAITING_REFUSALS'
  | 'ROUND_2.AWAITING_TABLES'
  | 'ROUND_2_COMPLETE'
  | 'SCRUM.AWAITING_DEFENDERS'
  | 'SCRUM.AWAITING_ATTACKERS'
  | 'SCRUM.AUTO_LAST_MAN'
  | 'SCRUM.AWAITING_REFUSALS'
  | 'SCRUM.AUTO_REFUSED_PAIR'
  | 'SCRUM.AWAITING_TABLES'
  | 'GAME_COMPLETE';

// ── Information-hiding slot ───────────────────────────────────────────────────

// pendingA / pendingB co-exist only between an applyAction call's input and
// output — within the dispatcher, they collapse to `revealed` atomically.
export interface SecretSlot<T> {
  readonly pendingA?: T;
  readonly pendingB?: T;
  readonly revealed?: { readonly a: T; readonly b: T };
}

// ── Pairing ───────────────────────────────────────────────────────────────────

export interface Pairing {
  readonly round: Round;
  readonly aArmy: ArmyId;
  readonly bArmy: ArmyId;
  // Which team is defending in this pairing (drives table-pick ordering in T9).
  // null marks scrum auto-paired games (last-vs-last, refused-vs-refused) where
  // there is no defender.
  readonly defenderTeam: Team | null;
  readonly tableId?: TableId;
  // Score adjustment from the table-choice hook. Set together with `tableId`;
  // currently always 0 (the spec defines tables as scheduling slots only) but
  // wired through so future score-impacting table logic has an attachment
  // point without needing to thread a new field through later.
  readonly tableScoreModifier?: number;
}

// ── Step state ────────────────────────────────────────────────────────────────

// Cumulative scratch for the in-flight step. Each phase fills in only the
// slots it cares about; transitions write a fresh StepState to advance.
export interface StepState {
  readonly defenders?: SecretSlot<ArmyId>;
  readonly attackers?: SecretSlot<readonly [ArmyId, ArmyId]>;
  readonly refusals?: SecretSlot<ArmyId>;
  // For AWAITING_TABLES sub-phase: which team is up to pick next.
  readonly tableTurn?: Team;
}

// ── PairingState ──────────────────────────────────────────────────────────────

export interface PairingState {
  readonly phase: Phase;
  readonly mode: ScoreMode;
  readonly rng: RngState;
  readonly matrix: Matrix;
  readonly rosterA: readonly ArmyId[];
  readonly rosterB: readonly ArmyId[];
  readonly poolA: readonly ArmyId[];
  readonly poolB: readonly ArmyId[];
  readonly pairings: readonly Pairing[];
  readonly log: readonly LogEntry[];
  readonly tokenHolder: Team | null;
  readonly step: StepState;
}

// ── Actions ───────────────────────────────────────────────────────────────────

export type Action =
  | { readonly type: 'LOCK_IN_DEFENDER'; readonly team: Team; readonly armyId: ArmyId }
  | { readonly type: 'LOCK_IN_ATTACKERS'; readonly team: Team; readonly armyIds: readonly [ArmyId, ArmyId] }
  | { readonly type: 'LOCK_IN_REFUSAL'; readonly team: Team; readonly armyId: ArmyId }
  | { readonly type: 'LOCK_IN_TABLE'; readonly team: Team; readonly tableId: TableId }
  | { readonly type: 'RESOLVE_INITIAL_TOKEN'; readonly winner: Team };

// ── Errors ────────────────────────────────────────────────────────────────────

export type EngineError =
  | { readonly kind: 'IllegalAction'; readonly phase: Phase; readonly action: Action }
  | { readonly kind: 'PoolViolation'; readonly team: Team; readonly armyId: ArmyId }
  | { readonly kind: 'DuplicatePending'; readonly team: Team }
  | { readonly kind: 'OutOfTurn'; readonly team: Team }
  | { readonly kind: 'InvalidPayload'; readonly reason: string };

export type ActionResult =
  | { readonly ok: true; readonly state: PairingState; readonly events: readonly LogEntry[] }
  | { readonly ok: false; readonly error: EngineError };

// ── createInitialState ────────────────────────────────────────────────────────

export interface InitialStateConfig {
  readonly mode: ScoreMode;
  readonly seed: number;
  readonly rosterA: readonly ArmyId[];
  readonly rosterB: readonly ArmyId[];
}

const ROSTER_SIZE = 8;

export function createInitialState(config: InitialStateConfig): PairingState {
  if (config.rosterA.length !== ROSTER_SIZE) {
    throw new RangeError(
      `rosterA must have ${ROSTER_SIZE} armies, got ${config.rosterA.length}`,
    );
  }
  if (config.rosterB.length !== ROSTER_SIZE) {
    throw new RangeError(
      `rosterB must have ${ROSTER_SIZE} armies, got ${config.rosterB.length}`,
    );
  }
  const initialRng = mkSeed(config.seed);
  const { rng, matrix } = generateMatrix(initialRng, config.mode);
  return {
    phase: 'ROUND_1.AWAITING_DEFENDERS',
    mode: config.mode,
    rng,
    matrix,
    rosterA: [...config.rosterA],
    rosterB: [...config.rosterB],
    poolA: [...config.rosterA],
    poolB: [...config.rosterB],
    pairings: [],
    log: [],
    tokenHolder: null,
    step: {},
  };
}

// ── TeamView and viewFor ──────────────────────────────────────────────────────

export interface TeamView {
  readonly seat: Team;
  readonly phase: Phase;
  readonly mode: ScoreMode;
  // Only this seat's view of the matrix; the opposing team's view is omitted.
  readonly myView: readonly (readonly Score[])[];
  readonly myRoster: readonly ArmyId[];
  readonly oppRoster: readonly ArmyId[];
  readonly myPool: readonly ArmyId[];
  readonly oppPool: readonly ArmyId[];
  readonly pairings: readonly Pairing[];
  readonly log: readonly LogEntry[];
  readonly tokenHolder: Team | null;
  readonly step: StepState;
}

function projectSlot<T>(slot: SecretSlot<T>, seat: Team): SecretSlot<T> {
  // Build a fresh slot containing only the values this seat is allowed to see.
  // The seat's own pending stays; the opposing pending is dropped entirely
  // (not set to undefined — the field is absent under exactOptionalPropertyTypes).
  const projected: { pendingA?: T; pendingB?: T; revealed?: { a: T; b: T } } = {};
  if (seat === 'A' && slot.pendingA !== undefined) projected.pendingA = slot.pendingA;
  if (seat === 'B' && slot.pendingB !== undefined) projected.pendingB = slot.pendingB;
  if (slot.revealed !== undefined) projected.revealed = slot.revealed;
  return projected;
}

function projectStep(step: StepState, seat: Team): StepState {
  const projected: {
    defenders?: SecretSlot<ArmyId>;
    attackers?: SecretSlot<readonly [ArmyId, ArmyId]>;
    refusals?: SecretSlot<ArmyId>;
    tableTurn?: Team;
  } = {};
  if (step.defenders !== undefined) projected.defenders = projectSlot(step.defenders, seat);
  if (step.attackers !== undefined) projected.attackers = projectSlot(step.attackers, seat);
  if (step.refusals !== undefined) projected.refusals = projectSlot(step.refusals, seat);
  if (step.tableTurn !== undefined) projected.tableTurn = step.tableTurn;
  return projected;
}

export function viewFor(state: PairingState, seat: Team): TeamView {
  const myView = seat === 'A' ? state.matrix.viewA : state.matrix.viewB;
  return {
    seat,
    phase: state.phase,
    mode: state.mode,
    myView,
    myRoster: seat === 'A' ? state.rosterA : state.rosterB,
    oppRoster: seat === 'A' ? state.rosterB : state.rosterA,
    myPool: seat === 'A' ? state.poolA : state.poolB,
    oppPool: seat === 'A' ? state.poolB : state.poolA,
    pairings: state.pairings,
    log: state.log,
    tokenHolder: state.tokenHolder,
    step: projectStep(state.step, seat),
  };
}

// ── applyAction dispatcher and per-action helpers ─────────────────────────────

function illegal(state: PairingState, action: Action): ActionResult {
  return {
    ok: false,
    error: { kind: 'IllegalAction', phase: state.phase, action },
  };
}

type LockInDefenderAction = Extract<Action, { readonly type: 'LOCK_IN_DEFENDER' }>;

// Reusable across ROUND_1, ROUND_2, and SCRUM AWAITING_DEFENDERS phases.
// On the second lock-in, both pendings collapse atomically into `revealed`,
// the phase advances, and a single DefendersRevealed event is appended —
// all in one applyAction return so no intermediate state ever exposes both
// pendings to a viewFor consumer.
function applyLockInDefender(
  state: PairingState,
  action: LockInDefenderAction,
  nextPhase: Phase,
  round: Round,
): ActionResult {
  const pool = action.team === 'A' ? state.poolA : state.poolB;
  if (!pool.includes(action.armyId)) {
    return {
      ok: false,
      error: { kind: 'PoolViolation', team: action.team, armyId: action.armyId },
    };
  }

  const slot = state.step.defenders;
  const teamPending = action.team === 'A' ? slot?.pendingA : slot?.pendingB;
  if (teamPending !== undefined) {
    return { ok: false, error: { kind: 'DuplicatePending', team: action.team } };
  }

  const otherPending = action.team === 'A' ? slot?.pendingB : slot?.pendingA;

  if (otherPending === undefined) {
    // First team to lock in this step — phase unchanged, no log entry.
    const newSlot: SecretSlot<ArmyId> =
      action.team === 'A' ? { pendingA: action.armyId } : { pendingB: action.armyId };
    return {
      ok: true,
      state: { ...state, step: { ...state.step, defenders: newSlot } },
      events: [],
    };
  }

  // Both teams have committed — collapse to revealed, advance phase, log event.
  const aArmy = action.team === 'A' ? action.armyId : otherPending;
  const bArmy = action.team === 'B' ? action.armyId : otherPending;
  const event: LogEntry = { type: 'DefendersRevealed', round, aArmy, bArmy };
  return {
    ok: true,
    state: {
      ...state,
      phase: nextPhase,
      step: { ...state.step, defenders: { revealed: { a: aArmy, b: bArmy } } },
      log: [...state.log, event],
    },
    events: [event],
  };
}

type LockInAttackersAction = Extract<Action, { readonly type: 'LOCK_IN_ATTACKERS' }>;

// Reusable across ROUND_1, ROUND_2, and SCRUM AWAITING_ATTACKERS phases.
// Validates: distinct armyIds, both in own pool, neither equals own defender.
// On second lock-in, collapses into `revealed`, advances phase, emits one
// AttackersRevealed event.
function applyLockInAttackers(
  state: PairingState,
  action: LockInAttackersAction,
  nextPhase: Phase,
  round: Round,
): ActionResult {
  const [a1, a2] = action.armyIds;

  if (a1 === a2) {
    return {
      ok: false,
      error: { kind: 'InvalidPayload', reason: 'attackers must be two distinct armies' },
    };
  }

  const pool = action.team === 'A' ? state.poolA : state.poolB;
  for (const armyId of action.armyIds) {
    if (!pool.includes(armyId)) {
      return {
        ok: false,
        error: { kind: 'PoolViolation', team: action.team, armyId },
      };
    }
  }

  // The "neither equals opposing defender" check from the literal spec is
  // vacuous given disjoint rosters; the meaningful constraint is that an
  // attacker cannot equal *own* defender (which is committed for this round).
  const revealedDefenders = state.step.defenders?.revealed;
  if (revealedDefenders !== undefined) {
    const ownDefender = action.team === 'A' ? revealedDefenders.a : revealedDefenders.b;
    if (a1 === ownDefender || a2 === ownDefender) {
      return {
        ok: false,
        error: { kind: 'InvalidPayload', reason: 'attacker cannot equal own defender' },
      };
    }
  }

  const slot = state.step.attackers;
  const teamPending = action.team === 'A' ? slot?.pendingA : slot?.pendingB;
  if (teamPending !== undefined) {
    return { ok: false, error: { kind: 'DuplicatePending', team: action.team } };
  }

  const otherPending = action.team === 'A' ? slot?.pendingB : slot?.pendingA;

  if (otherPending === undefined) {
    const newSlot: SecretSlot<readonly [ArmyId, ArmyId]> =
      action.team === 'A'
        ? { pendingA: action.armyIds }
        : { pendingB: action.armyIds };
    return {
      ok: true,
      state: { ...state, step: { ...state.step, attackers: newSlot } },
      events: [],
    };
  }

  const aAttackers: readonly [ArmyId, ArmyId] =
    action.team === 'A' ? action.armyIds : otherPending;
  const bAttackers: readonly [ArmyId, ArmyId] =
    action.team === 'B' ? action.armyIds : otherPending;
  const event: LogEntry = {
    type: 'AttackersRevealed',
    round,
    aAttackers,
    bAttackers,
  };
  return {
    ok: true,
    state: {
      ...state,
      phase: nextPhase,
      step: {
        ...state.step,
        attackers: { revealed: { a: aAttackers, b: bAttackers } },
      },
      log: [...state.log, event],
    },
    events: [event],
  };
}

type LockInRefusalAction = Extract<Action, { readonly type: 'LOCK_IN_REFUSAL' }>;

// Reusable across ROUND_1, ROUND_2, and SCRUM AWAITING_REFUSALS phases.
// On reveal collapse: locks two attacker-vs-defender pairings (A's defender vs
// B's surviving attacker, and vice versa), removes locked-in armies from each
// team's pool (refused armies stay), and advances to the next phase.
function applyLockInRefusal(
  state: PairingState,
  action: LockInRefusalAction,
  nextPhase: Phase,
  round: Round,
): ActionResult {
  // The dispatcher only routes here from AWAITING_REFUSALS, where the prior
  // collapses guarantee defenders + attackers are revealed. Trust that.
  const defenders = state.step.defenders!.revealed!;
  const attackers = state.step.attackers!.revealed!;

  // A refuses one of B's attackers (the pair sent at A); B refuses one of A's.
  const sentAtMe = action.team === 'A' ? attackers.b : attackers.a;
  if (!sentAtMe.includes(action.armyId)) {
    return {
      ok: false,
      error: {
        kind: 'InvalidPayload',
        reason: 'refusal must be one of the opposing team\'s attackers',
      },
    };
  }

  const slot = state.step.refusals;
  const teamPending = action.team === 'A' ? slot?.pendingA : slot?.pendingB;
  if (teamPending !== undefined) {
    return { ok: false, error: { kind: 'DuplicatePending', team: action.team } };
  }

  const otherPending = action.team === 'A' ? slot?.pendingB : slot?.pendingA;

  if (otherPending === undefined) {
    const newSlot: SecretSlot<ArmyId> =
      action.team === 'A' ? { pendingA: action.armyId } : { pendingB: action.armyId };
    return {
      ok: true,
      state: { ...state, step: { ...state.step, refusals: newSlot } },
      events: [],
    };
  }

  // Reveal collapse — lock pairings and update pools.
  const aRefused = action.team === 'A' ? action.armyId : otherPending;
  const bRefused = action.team === 'B' ? action.armyId : otherPending;

  const [aAtk1, aAtk2] = attackers.a;
  const [bAtk1, bAtk2] = attackers.b;
  // The surviving attacker is the one the opposing team did NOT refuse.
  const aSurviving = aAtk1 === bRefused ? aAtk2 : aAtk1;
  const bSurviving = bAtk1 === aRefused ? bAtk2 : bAtk1;

  const newPairings: readonly Pairing[] = [
    { round, aArmy: defenders.a, bArmy: bSurviving, defenderTeam: 'A' },
    { round, aArmy: aSurviving, bArmy: defenders.b, defenderTeam: 'B' },
  ];

  // Locked-in armies (defender + surviving attacker) leave each team's pool;
  // refused attackers stay (they were never removed).
  const newPoolA = state.poolA.filter(x => x !== defenders.a && x !== aSurviving);
  const newPoolB = state.poolB.filter(x => x !== defenders.b && x !== bSurviving);

  const event: LogEntry = {
    type: 'RefusalsRevealed',
    round,
    aRefused,
    bRefused,
  };

  return {
    ok: true,
    state: {
      ...state,
      phase: nextPhase,
      step: {
        ...state.step,
        refusals: { revealed: { a: aRefused, b: bRefused } },
      },
      pairings: [...state.pairings, ...newPairings],
      poolA: newPoolA,
      poolB: newPoolB,
      log: [...state.log, event],
    },
    events: [event],
  };
}

// ── Initial-token roll-off ────────────────────────────────────────────────────

// Pure function: caller invokes this to get the RNG-determined winner, then
// dispatches RESOLVE_INITIAL_TOKEN { winner } so the action acts as an audit
// record. The dispatcher consumes the same RNG draw to keep state.rng in sync.
export function rollInitialToken(state: PairingState): { winner: Team; rng: RngState } {
  const r = pick(state.rng, ['A', 'B'] as const);
  return { winner: r.value, rng: r.state };
}

type ResolveInitialTokenAction = Extract<Action, { readonly type: 'RESOLVE_INITIAL_TOKEN' }>;

function applyResolveInitialToken(
  state: PairingState,
  action: ResolveInitialTokenAction,
): ActionResult {
  // The roll-off is a one-time event at the start of ROUND_1.AWAITING_TABLES.
  if (state.tokenHolder !== null) {
    return { ok: false, error: { kind: 'IllegalAction', phase: state.phase, action } };
  }

  // Consume the same RNG draw rollInitialToken used so state.rng stays in sync.
  const { rng: nextRng } = rollInitialToken(state);
  const event: LogEntry = { type: 'TokenRollOff', winner: action.winner };

  return {
    ok: true,
    state: {
      ...state,
      rng: nextRng,
      tokenHolder: action.winner,
      log: [...state.log, event],
    },
    events: [event],
  };
}

// ── Table-choice score hook ───────────────────────────────────────────────────

// Future hook: tables may shift the expected score for a matchup based on
// layout, faction, mission, etc. The current spec defines tables as
// scheduling slots only — no score effect — so this returns 0. Wired into
// LOCK_IN_TABLE so the data path is in place for future spec versions.
function tableChoiceScoreModifier(
  pairing: Pairing,
  tableId: TableId,
  matrix: Matrix,
): number {
  void pairing;
  void tableId;
  void matrix;
  return 0;
}

// ── LOCK_IN_TABLE ─────────────────────────────────────────────────────────────

type LockInTableAction = Extract<Action, { readonly type: 'LOCK_IN_TABLE' }>;

const TABLE_ID_MIN = 1;
const TABLE_ID_MAX = 8;

// Reusable across ROUND_1.AWAITING_TABLES and ROUND_2.AWAITING_TABLES.
// Token-holder picks first, then the opposing team. When all tables in the
// current round are assigned, transitions through ROUND_n_COMPLETE — flipping
// the token and emitting TokenFlipped — and lands in the next round's
// AWAITING_DEFENDERS within the same applyAction call. SCRUM phase B (T11)
// has different ordering rules and will need its own handler.
function applyLockInTable(
  state: PairingState,
  action: LockInTableAction,
  currentRound: Round,
  nextPhase: Phase,
): ActionResult {
  // Token must already be resolved for this round.
  if (state.tokenHolder === null) {
    return { ok: false, error: { kind: 'OutOfTurn', team: action.team } };
  }

  // Token-holder-first ordering — derived from pairing state rather than a
  // separate tableTurn field, since each round has exactly one pairing per
  // team for which this team defends.
  const tokenHolderPairing = state.pairings.find(
    p => p.round === currentRound && p.defenderTeam === state.tokenHolder,
  );
  const tokenHolderPicked = tokenHolderPairing?.tableId !== undefined;
  const expectedTeam: Team = tokenHolderPicked
    ? (state.tokenHolder === 'A' ? 'B' : 'A')
    : state.tokenHolder;
  if (action.team !== expectedTeam) {
    return { ok: false, error: { kind: 'OutOfTurn', team: action.team } };
  }

  // Validate tableId range.
  if (action.tableId < TABLE_ID_MIN || action.tableId > TABLE_ID_MAX) {
    return {
      ok: false,
      error: { kind: 'InvalidPayload', reason: `tableId must be in [${TABLE_ID_MIN}, ${TABLE_ID_MAX}]` },
    };
  }

  // Validate tableId not already assigned anywhere in the game.
  if (state.pairings.some(p => p.tableId === action.tableId)) {
    return {
      ok: false,
      error: { kind: 'InvalidPayload', reason: 'tableId already assigned' },
    };
  }

  // Find the pairing this team defends in the current round.
  const targetIdx = state.pairings.findIndex(
    p => p.round === currentRound
      && p.defenderTeam === action.team
      && p.tableId === undefined,
  );
  // Guaranteed to exist: every team has exactly one defending pairing per
  // round, and the OutOfTurn check above ensures we're picking it now.
  const target = state.pairings[targetIdx]!;

  const tableScoreModifier = tableChoiceScoreModifier(target, action.tableId, state.matrix);
  const updatedTarget: Pairing = {
    ...target,
    tableId: action.tableId,
    tableScoreModifier,
  };
  const updatedPairings = state.pairings.map((p, i) => (i === targetIdx ? updatedTarget : p));
  const defenderArmy = action.team === 'A' ? target.aArmy : target.bArmy;

  const tableEvent: LogEntry = {
    type: 'TableChosen',
    round: currentRound,
    team: action.team,
    tableId: action.tableId,
    defenderArmy,
  };

  // Are all tables in this round assigned now?
  const roundUnassigned = updatedPairings.some(
    p => p.round === currentRound && p.tableId === undefined,
  );

  if (roundUnassigned) {
    return {
      ok: true,
      state: {
        ...state,
        pairings: updatedPairings,
        log: [...state.log, tableEvent],
      },
      events: [tableEvent],
    };
  }

  // All tables assigned → traverse ROUND_n_COMPLETE, flip the token, and
  // land in the next round's AWAITING_DEFENDERS (per spec; reason 'round-end').
  const newTokenHolder: Team = state.tokenHolder === 'A' ? 'B' : 'A';
  const flipEvent: LogEntry = {
    type: 'TokenFlipped',
    newHolder: newTokenHolder,
    reason: 'round-end',
  };
  return {
    ok: true,
    state: {
      ...state,
      phase: nextPhase,
      pairings: updatedPairings,
      tokenHolder: newTokenHolder,
      step: {},
      log: [...state.log, tableEvent, flipEvent],
    },
    events: [tableEvent, flipEvent],
  };
}

// ── Scrum AUTO-state resolvers ────────────────────────────────────────────────

// AUTO_LAST_MAN: each team's "last man" is the unique pool member that is
// neither the committed defender nor in the committed attackers. Lock as a
// scrum pairing with defenderTeam=null, drop from pools, advance phase.
function autoLastMan(state: PairingState): { state: PairingState; events: readonly LogEntry[] } {
  const defenders = state.step.defenders!.revealed!;
  const attackers = state.step.attackers!.revealed!;
  const aLastMan = state.poolA.find(
    a => a !== defenders.a && !attackers.a.includes(a),
  )!;
  const bLastMan = state.poolB.find(
    b => b !== defenders.b && !attackers.b.includes(b),
  )!;

  const newPairing: Pairing = {
    round: 'scrum',
    aArmy: aLastMan,
    bArmy: bLastMan,
    defenderTeam: null,
  };
  const event: LogEntry = { type: 'LastManAutoPaired', aArmy: aLastMan, bArmy: bLastMan };
  return {
    state: {
      ...state,
      phase: 'SCRUM.AWAITING_REFUSALS',
      pairings: [...state.pairings, newPairing],
      poolA: state.poolA.filter(a => a !== aLastMan),
      poolB: state.poolB.filter(b => b !== bLastMan),
      log: [...state.log, event],
    },
    events: [event],
  };
}

// AUTO_REFUSED_PAIR: by the time we enter, the scrum refusal collapse has
// removed defender + surviving attacker from each pool, leaving exactly one
// army per side — the refused attacker. Pair them, drain the pools.
function autoRefusedPair(state: PairingState): { state: PairingState; events: readonly LogEntry[] } {
  const aRefused = state.poolA[0]!;
  const bRefused = state.poolB[0]!;
  const newPairing: Pairing = {
    round: 'scrum',
    aArmy: aRefused,
    bArmy: bRefused,
    defenderTeam: null,
  };
  const event: LogEntry = { type: 'RefusedAutoPaired', aArmy: aRefused, bArmy: bRefused };
  return {
    state: {
      ...state,
      phase: 'SCRUM.AWAITING_TABLES',
      pairings: [...state.pairings, newPairing],
      poolA: [],
      poolB: [],
      log: [...state.log, event],
    },
    events: [event],
  };
}

// Auto-states are real FSM states the engine passes through, but they never
// persist between applyAction calls — when a transition lands in one, this
// helper chains forward to a non-AUTO state in the same call. Structural
// proof of passage lives in the emitted LastManAutoPaired / RefusedAutoPaired
// events, which only this code path produces.
function chainAutoStates(
  state: PairingState,
  events: readonly LogEntry[],
): ActionResult {
  let s = state;
  let evs: readonly LogEntry[] = events;
  if (s.phase === 'SCRUM.AUTO_LAST_MAN') {
    const r = autoLastMan(s);
    s = r.state;
    evs = [...evs, ...r.events];
  }
  if (s.phase === 'SCRUM.AUTO_REFUSED_PAIR') {
    const r = autoRefusedPair(s);
    s = r.state;
    evs = [...evs, ...r.events];
  }
  return { ok: true, state: s, events: evs };
}

// ── Scrum table-pick handlers ─────────────────────────────────────────────────

function validateTableId(state: PairingState, tableId: TableId): EngineError | null {
  if (tableId < TABLE_ID_MIN || tableId > TABLE_ID_MAX) {
    return { kind: 'InvalidPayload', reason: `tableId must be in [${TABLE_ID_MIN}, ${TABLE_ID_MAX}]` };
  }
  if (state.pairings.some(p => p.tableId === tableId)) {
    return { kind: 'InvalidPayload', reason: 'tableId already assigned' };
  }
  return null;
}

// Scrum table picks split into two sub-phases derived from pairing state:
//   Phase A: 2 attacker-vs-defender games (defenderTeam = 'A' | 'B').
//            Token-holder defender first, then opposing — same as R1/R2.
//   Phase B: 2 auto-paired games (defenderTeam = null, no defender).
//            Token-holder picks BOTH; opposing team is OutOfTurn for both.
// On the 4th scrum LOCK_IN_TABLE, all 8 tables are assigned → GAME_COMPLETE
// (no token flip — the game is over).
function applyLockInTableScrum(
  state: PairingState,
  action: LockInTableAction,
): ActionResult {
  const phaseAUnassigned = state.pairings.filter(
    p => p.round === 'scrum' && p.defenderTeam !== null && p.tableId === undefined,
  );
  if (phaseAUnassigned.length > 0) {
    return phaseATableScrum(state, action);
  }
  return phaseBTableScrum(state, action);
}

function phaseATableScrum(state: PairingState, action: LockInTableAction): ActionResult {
  // Token-holder-first ordering across the 2 defender-led scrum pairings.
  const tokenHolderPairing = state.pairings.find(
    p => p.round === 'scrum' && p.defenderTeam === state.tokenHolder,
  );
  const tokenHolderPicked = tokenHolderPairing?.tableId !== undefined;
  const expectedTeam: Team = tokenHolderPicked
    ? (state.tokenHolder === 'A' ? 'B' : 'A')
    : state.tokenHolder!;
  if (action.team !== expectedTeam) {
    return { ok: false, error: { kind: 'OutOfTurn', team: action.team } };
  }

  const tableErr = validateTableId(state, action.tableId);
  if (tableErr) return { ok: false, error: tableErr };

  const targetIdx = state.pairings.findIndex(
    p => p.round === 'scrum'
      && p.defenderTeam === action.team
      && p.tableId === undefined,
  );
  const target = state.pairings[targetIdx]!;
  const tableScoreModifier = tableChoiceScoreModifier(target, action.tableId, state.matrix);
  const updated: Pairing = { ...target, tableId: action.tableId, tableScoreModifier };
  const updatedPairings = state.pairings.map((p, i) => (i === targetIdx ? updated : p));
  const defenderArmy = action.team === 'A' ? target.aArmy : target.bArmy;
  const event: LogEntry = {
    type: 'TableChosen',
    round: 'scrum',
    team: action.team,
    tableId: action.tableId,
    defenderArmy,
  };
  return {
    ok: true,
    state: { ...state, pairings: updatedPairings, log: [...state.log, event] },
    events: [event],
  };
}

function phaseBTableScrum(state: PairingState, action: LockInTableAction): ActionResult {
  // Phase B: only the token holder may pick — for both auto-paired games.
  if (action.team !== state.tokenHolder) {
    return { ok: false, error: { kind: 'OutOfTurn', team: action.team } };
  }

  const tableErr = validateTableId(state, action.tableId);
  if (tableErr) return { ok: false, error: tableErr };

  const targetIdx = state.pairings.findIndex(
    p => p.round === 'scrum'
      && p.defenderTeam === null
      && p.tableId === undefined,
  );
  const target = state.pairings[targetIdx]!;
  const tableScoreModifier = tableChoiceScoreModifier(target, action.tableId, state.matrix);
  const updated: Pairing = { ...target, tableId: action.tableId, tableScoreModifier };
  const updatedPairings = state.pairings.map((p, i) => (i === targetIdx ? updated : p));
  // Phase B has no defender to record; defenderArmy omitted.
  const event: LogEntry = {
    type: 'TableChosen',
    round: 'scrum',
    team: action.team,
    tableId: action.tableId,
  };

  const stillUnassigned = updatedPairings.some(
    p => p.round === 'scrum' && p.tableId === undefined,
  );
  if (stillUnassigned) {
    return {
      ok: true,
      state: { ...state, pairings: updatedPairings, log: [...state.log, event] },
      events: [event],
    };
  }
  // Last scrum table → game complete. No token flip.
  return {
    ok: true,
    state: {
      ...state,
      phase: 'GAME_COMPLETE',
      pairings: updatedPairings,
      step: {},
      log: [...state.log, event],
    },
    events: [event],
  };
}

export function applyAction(state: PairingState, action: Action): ActionResult {
  switch (state.phase) {
    case 'ROUND_1.AWAITING_DEFENDERS':
      if (action.type === 'LOCK_IN_DEFENDER') {
        return applyLockInDefender(state, action, 'ROUND_1.AWAITING_ATTACKERS', 1);
      }
      return illegal(state, action);
    case 'ROUND_1.AWAITING_ATTACKERS':
      if (action.type === 'LOCK_IN_ATTACKERS') {
        return applyLockInAttackers(state, action, 'ROUND_1.AWAITING_REFUSALS', 1);
      }
      return illegal(state, action);
    case 'ROUND_1.AWAITING_REFUSALS':
      if (action.type === 'LOCK_IN_REFUSAL') {
        return applyLockInRefusal(state, action, 'ROUND_1.AWAITING_TABLES', 1);
      }
      return illegal(state, action);
    case 'ROUND_1.AWAITING_TABLES':
      if (action.type === 'RESOLVE_INITIAL_TOKEN') {
        return applyResolveInitialToken(state, action);
      }
      if (action.type === 'LOCK_IN_TABLE') {
        return applyLockInTable(state, action, 1, 'ROUND_2.AWAITING_DEFENDERS');
      }
      return illegal(state, action);
    case 'ROUND_2.AWAITING_DEFENDERS':
      if (action.type === 'LOCK_IN_DEFENDER') {
        return applyLockInDefender(state, action, 'ROUND_2.AWAITING_ATTACKERS', 2);
      }
      return illegal(state, action);
    case 'ROUND_2.AWAITING_ATTACKERS':
      if (action.type === 'LOCK_IN_ATTACKERS') {
        return applyLockInAttackers(state, action, 'ROUND_2.AWAITING_REFUSALS', 2);
      }
      return illegal(state, action);
    case 'ROUND_2.AWAITING_REFUSALS':
      if (action.type === 'LOCK_IN_REFUSAL') {
        return applyLockInRefusal(state, action, 'ROUND_2.AWAITING_TABLES', 2);
      }
      return illegal(state, action);
    case 'ROUND_2.AWAITING_TABLES':
      if (action.type === 'LOCK_IN_TABLE') {
        return applyLockInTable(state, action, 2, 'SCRUM.AWAITING_DEFENDERS');
      }
      return illegal(state, action);
    case 'SCRUM.AWAITING_DEFENDERS':
      if (action.type === 'LOCK_IN_DEFENDER') {
        return applyLockInDefender(state, action, 'SCRUM.AWAITING_ATTACKERS', 'scrum');
      }
      return illegal(state, action);
    case 'SCRUM.AWAITING_ATTACKERS':
      if (action.type === 'LOCK_IN_ATTACKERS') {
        const r = applyLockInAttackers(state, action, 'SCRUM.AUTO_LAST_MAN', 'scrum');
        if (!r.ok) return r;
        // On the second lock-in, chain through AUTO_LAST_MAN → AWAITING_REFUSALS.
        return chainAutoStates(r.state, r.events);
      }
      return illegal(state, action);
    case 'SCRUM.AWAITING_REFUSALS':
      if (action.type === 'LOCK_IN_REFUSAL') {
        const r = applyLockInRefusal(state, action, 'SCRUM.AUTO_REFUSED_PAIR', 'scrum');
        if (!r.ok) return r;
        // On the second lock-in, chain through AUTO_REFUSED_PAIR → AWAITING_TABLES.
        return chainAutoStates(r.state, r.events);
      }
      return illegal(state, action);
    case 'SCRUM.AWAITING_TABLES':
      if (action.type === 'LOCK_IN_TABLE') {
        return applyLockInTableScrum(state, action);
      }
      return illegal(state, action);
    case 'INIT':
    case 'ROUND_1_COMPLETE':
    case 'ROUND_2_COMPLETE':
    case 'SCRUM.AUTO_LAST_MAN':
    case 'SCRUM.AUTO_REFUSED_PAIR':
    case 'GAME_COMPLETE':
      return illegal(state, action);
  }
}
