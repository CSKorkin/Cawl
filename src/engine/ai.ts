// AI tier 1 — Actor interface, scripted test fixture, easy actor (depth-0
// greedy per spec §AI.Easy), and runGame driver.
//
// Actors are by signature unable to read opposing pendings: every method
// receives only a `TeamView`, which is what `viewFor(state, seat)` returns.
// This is the architectural enforcement of the information-hiding invariant —
// no AI can cheat by looking at the engine's privileged state.

import { applyAction, rollInitialToken, viewFor } from './state.js';
import type { PairingState, TeamView } from './state.js';
import type { ArmyId, LogEntry, Round, TableId, Team } from './log.js';

// ── Public types ──────────────────────────────────────────────────────────────

export interface Actor {
  pickDefender(view: TeamView): ArmyId;
  pickAttackers(view: TeamView, oppDefender: ArmyId): readonly [ArmyId, ArmyId];
  pickRefusal(view: TeamView, attackers: readonly [ArmyId, ArmyId]): ArmyId;
  pickTable(view: TeamView, available: readonly TableId[]): TableId;
}

export interface RunGameResult {
  readonly state: PairingState;
  readonly log: readonly LogEntry[];
}

// ── Scripted test-fixture actor ───────────────────────────────────────────────

export type ScriptedPick =
  | { readonly kind: 'defender'; readonly armyId: ArmyId }
  | { readonly kind: 'attackers'; readonly armyIds: readonly [ArmyId, ArmyId] }
  | { readonly kind: 'refusal'; readonly armyId: ArmyId }
  | { readonly kind: 'table'; readonly tableId: TableId };

export function scriptedActor(picks: readonly ScriptedPick[]): Actor {
  let cursor = 0;
  function next(expectedKind: ScriptedPick['kind']): ScriptedPick {
    if (cursor >= picks.length) {
      throw new Error(`scriptedActor: script exhausted (expected ${expectedKind})`);
    }
    const p = picks[cursor]!;
    if (p.kind !== expectedKind) {
      throw new Error(
        `scriptedActor: expected ${expectedKind} at index ${cursor}, got ${p.kind}`,
      );
    }
    cursor++;
    return p;
  }
  return {
    pickDefender(_view) {
      const p = next('defender');
      return (p as Extract<ScriptedPick, { kind: 'defender' }>).armyId;
    },
    pickAttackers(_view, _oppDefender) {
      const p = next('attackers');
      return (p as Extract<ScriptedPick, { kind: 'attackers' }>).armyIds;
    },
    pickRefusal(_view, _attackers) {
      const p = next('refusal');
      return (p as Extract<ScriptedPick, { kind: 'refusal' }>).armyId;
    },
    pickTable(_view, _available) {
      const p = next('table');
      return (p as Extract<ScriptedPick, { kind: 'table' }>).tableId;
    },
  };
}

// ── Easy actor (depth-0 greedy) ───────────────────────────────────────────────

// Index helper: cell in own matrix for "myArmy vs oppArmy". Both rosters use
// the actor's own seat — `myView[i][j]` is "my army myRoster[i]" vs "opp army
// oppRoster[j]" from MY perspective. The score type wraps the value in a
// discriminated union; we read `.value` (number) — comparisons across modes
// are mode-internal so a raw subtraction is safe.
function cell(view: TeamView, myArmy: ArmyId, oppArmy: ArmyId): number {
  const i = view.myRoster.indexOf(myArmy);
  const j = view.oppRoster.indexOf(oppArmy);
  return view.myView[i]![j]!.value as number;
}

function ownDefenderFromView(view: TeamView): ArmyId {
  const revealed = view.step.defenders!.revealed!;
  return view.seat === 'A' ? revealed.a : revealed.b;
}

// Tiebreak by armyId lexicographically; documented behavior so easy-vs-easy
// games are deterministic across seeds (a property test relies on it).
function lex(a: ArmyId, b: ArmyId): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function easyActor(seat: Team): Actor {
  // Seat is mostly informational (the actor reads view.seat), but pinning it
  // at construction time documents intent and can catch wiring mistakes if a
  // caller passes the wrong actor for a seat.
  void seat;
  return {
    // pickDefender: argmax over our pool of mean expected score across the
    // opposing pool. Ties broken lex.
    pickDefender(view) {
      const oppPool = view.oppPool;
      let best: ArmyId | null = null;
      let bestScore = -Infinity;
      for (const candidate of view.myPool) {
        let sum = 0;
        for (const opp of oppPool) sum += cell(view, candidate, opp);
        const mean = sum / oppPool.length;
        if (
          mean > bestScore
          || (mean === bestScore && best !== null && lex(candidate, best) < 0)
        ) {
          best = candidate;
          bestScore = mean;
        }
      }
      // myPool is non-empty in any state where pickDefender is dispatched.
      return best!;
    },

    // pickAttackers: the two pool armies (excluding own defender) with the
    // lowest expected score against oppDefender. Sorted ascending then lex.
    pickAttackers(view, oppDefender) {
      const ownDef = ownDefenderFromView(view);
      const candidates = view.myPool.filter(a => a !== ownDef);
      const scored = candidates.map(a => ({ armyId: a, score: cell(view, a, oppDefender) }));
      scored.sort((x, y) => x.score - y.score || lex(x.armyId, y.armyId));
      return [scored[0]!.armyId, scored[1]!.armyId];
    },

    // pickRefusal: refuse the attacker associated with our LOWEST expected
    // score against our defender. The spec wording "refuse the attacker with
    // the higher expected score" reads as the OPPONENT's score — our matrix
    // is from our POV, so the opponent's higher score is our lower value.
    // The explanatory text "keep the easier matchup" is the source of truth:
    // we want to keep the matchup we're rated to score well in, so we refuse
    // the matchup we're rated to score poorly in.
    pickRefusal(view, attackers) {
      const ownDef = ownDefenderFromView(view);
      const scored = attackers.map(a => ({ armyId: a, score: cell(view, ownDef, a) }));
      scored.sort((x, y) => x.score - y.score || lex(x.armyId, y.armyId));
      return scored[0]!.armyId;
    },

    // pickTable: lowest available id. The "Tables and scoring" note in the
    // spec defines tables as scheduling slots only; without a score impact,
    // there's no preference signal beyond stable ordering.
    pickTable(_view, available) {
      let min = available[0]!;
      for (const t of available) if (t < min) min = t;
      return min;
    },
  };
}

// ── runGame driver ────────────────────────────────────────────────────────────

const TABLE_ID_MIN = 1;
const TABLE_ID_MAX = 8;

function availableTables(state: PairingState): TableId[] {
  const used = new Set(
    state.pairings.map(p => p.tableId).filter((x): x is number => x !== undefined),
  );
  const out: TableId[] = [];
  for (let i = TABLE_ID_MIN; i <= TABLE_ID_MAX; i++) if (!used.has(i)) out.push(i);
  return out;
}

// Token-holder-first ordering for table picks, derived from pairing state.
// Mirrors the engine's internal logic but lives here because the driver needs
// to know which actor to call before dispatching.
function nextTableTeam(state: PairingState): Team {
  const holder = state.tokenHolder!;
  const other: Team = holder === 'A' ? 'B' : 'A';
  if (state.phase === 'SCRUM.AWAITING_TABLES') {
    const phaseAUnassigned = state.pairings.filter(
      p => p.round === 'scrum' && p.defenderTeam !== null && p.tableId === undefined,
    );
    if (phaseAUnassigned.length > 0) {
      // Phase A: holder defender picks first; once their pairing has a table,
      // the opposing defender picks.
      const holderPairing = phaseAUnassigned.find(p => p.defenderTeam === holder);
      return holderPairing !== undefined ? holder : other;
    }
    // Phase B: holder picks both auto-paired games.
    return holder;
  }
  const round: Round = state.phase === 'ROUND_1.AWAITING_TABLES' ? 1 : 2;
  const holderPairing = state.pairings.find(
    p => p.round === round && p.defenderTeam === holder && p.tableId === undefined,
  );
  return holderPairing !== undefined ? holder : other;
}

function dispatchOrThrow(
  state: PairingState,
  action: Parameters<typeof applyAction>[1],
): PairingState {
  const r = applyAction(state, action);
  if (!r.ok) {
    throw new Error(
      `runGame: actor produced illegal action: ${JSON.stringify(action)} → ${JSON.stringify(r.error)}`,
    );
  }
  return r.state;
}

function stepDefender(state: PairingState, team: Team, actor: Actor): PairingState {
  const view = viewFor(state, team);
  const armyId = actor.pickDefender(view);
  return dispatchOrThrow(state, { type: 'LOCK_IN_DEFENDER', team, armyId });
}

function stepAttackers(state: PairingState, team: Team, actor: Actor): PairingState {
  const view = viewFor(state, team);
  const revealed = state.step.defenders!.revealed!;
  const oppDefender = team === 'A' ? revealed.b : revealed.a;
  const armyIds = actor.pickAttackers(view, oppDefender);
  return dispatchOrThrow(state, { type: 'LOCK_IN_ATTACKERS', team, armyIds });
}

function stepRefusal(state: PairingState, team: Team, actor: Actor): PairingState {
  const view = viewFor(state, team);
  const revealed = state.step.attackers!.revealed!;
  const sentAtMe = team === 'A' ? revealed.b : revealed.a;
  const armyId = actor.pickRefusal(view, sentAtMe);
  return dispatchOrThrow(state, { type: 'LOCK_IN_REFUSAL', team, armyId });
}

function stepTable(
  state: PairingState,
  actorA: Actor,
  actorB: Actor,
): PairingState {
  const team = nextTableTeam(state);
  const actor = team === 'A' ? actorA : actorB;
  const view = viewFor(state, team);
  const tableId = actor.pickTable(view, availableTables(state));
  return dispatchOrThrow(state, { type: 'LOCK_IN_TABLE', team, tableId });
}

export function runGame(
  initialState: PairingState,
  actorA: Actor,
  actorB: Actor,
): RunGameResult {
  let state = initialState;
  // Bound the loop generously so a buggy actor or driver can't infinite-loop.
  // A correct full game touches each phase at most a small finite number of
  // times; 200 iterations is well above that ceiling.
  for (let i = 0; i < 200 && state.phase !== 'GAME_COMPLETE'; i++) {
    switch (state.phase) {
      case 'ROUND_1.AWAITING_DEFENDERS':
      case 'ROUND_2.AWAITING_DEFENDERS':
      case 'SCRUM.AWAITING_DEFENDERS':
        state = stepDefender(state, 'A', actorA);
        state = stepDefender(state, 'B', actorB);
        break;
      case 'ROUND_1.AWAITING_ATTACKERS':
      case 'ROUND_2.AWAITING_ATTACKERS':
      case 'SCRUM.AWAITING_ATTACKERS':
        state = stepAttackers(state, 'A', actorA);
        state = stepAttackers(state, 'B', actorB);
        break;
      case 'ROUND_1.AWAITING_REFUSALS':
      case 'ROUND_2.AWAITING_REFUSALS':
      case 'SCRUM.AWAITING_REFUSALS':
        state = stepRefusal(state, 'A', actorA);
        state = stepRefusal(state, 'B', actorB);
        break;
      case 'ROUND_1.AWAITING_TABLES':
        if (state.tokenHolder === null) {
          const { winner } = rollInitialToken(state);
          state = dispatchOrThrow(state, { type: 'RESOLVE_INITIAL_TOKEN', winner });
        }
        state = stepTable(state, actorA, actorB);
        break;
      case 'ROUND_2.AWAITING_TABLES':
      case 'SCRUM.AWAITING_TABLES':
        state = stepTable(state, actorA, actorB);
        break;
      case 'INIT':
      case 'ROUND_1_COMPLETE':
      case 'ROUND_2_COMPLETE':
      case 'SCRUM.AUTO_LAST_MAN':
      case 'SCRUM.AUTO_REFUSED_PAIR':
        // INIT is never the entry phase from createInitialState; the AUTO and
        // _COMPLETE phases are transient and resolved inside applyAction so
        // they never persist into a runGame iteration. Reaching one means
        // either a malformed initialState or an engine bug — surface loudly.
        throw new Error(`runGame: unexpected phase ${state.phase}`);
    }
  }
  if (state.phase !== 'GAME_COMPLETE') {
    throw new Error(`runGame: did not reach GAME_COMPLETE within iteration cap (phase=${state.phase})`);
  }
  return { state, log: state.log };
}
