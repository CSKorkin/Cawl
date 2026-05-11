// AI tier 1 — Actor interface, scripted test fixture, easy actor (depth-0
// greedy per spec §AI.Easy), and runGame driver.
//
// Actors are by signature unable to read opposing pendings: every method
// receives only a `TeamView`, which is what `viewFor(state, seat)` returns.
// This is the architectural enforcement of the information-hiding invariant —
// no AI can cheat by looking at the engine's privileged state.

import { applyAction, rollInitialToken, viewFor } from './state.js';
import type { Pairing, PairingState, TeamView } from './state.js';
import { applyTableModifier, tableModifierDelta } from './score.js';
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

    // pickAttackers: send the two pool armies (excluding own defender) with
    // the HIGHEST expected score against oppDefender. The naive intuition —
    // "send my best to attack their defender" — sounds right to a human and
    // is what an unsophisticated player would do, even though more careful
    // analysis (see mediumActor below) shows it's still a depth-2 closed
    // form. Sorted descending by score, lex tiebreak.
    pickAttackers(view, oppDefender) {
      const ownDef = ownDefenderFromView(view);
      const candidates = view.myPool.filter(a => a !== ownDef);
      const scored = candidates.map(a => ({ armyId: a, score: cell(view, a, oppDefender) }));
      scored.sort((x, y) => y.score - x.score || lex(x.armyId, y.armyId));
      return [scored[0]!.armyId, scored[1]!.armyId];
    },

    // pickRefusal: refuse the attacker associated with our LOWEST expected
    // score against our defender. WTC matchups split a fixed total, so the
    // opponent's expected score for the same matchup is roughly invert(ours).
    // "The attacker with the higher expected score against our defender" thus
    // means the OPPONENT's higher score = our lower value, which is the
    // matchup we don't want — refuse it, keep the easier one.
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

// ── Medium actor (depth-2 minimax against Easy under inversion) ──────────────
//
// Spec: "depth-2 minimax with K=4 pruning, opponent matrix approximated as
// own." Under the inversion model (each cell of viewB ≈ invert(viewA[i][j])),
// the approximation tightens to "opponent matrix = invert(my matrix)" since
// each team's view of a matchup is the structural complement of the other's.
//
// Both Easy and Medium send top-2 attackers (Easy from naive "send my best"
// intuition; Medium because depth-2 minimax against Easy yields the same
// closed form). So the symmetric model is "both teams send top-2 attackers."
// Under that model, the per-round outcome decomposes:
//
//   defender pairing for my X = ROW SECOND-MIN of myView[X][.] over oppPool
//     Reason: opp's Easy sends top-2 by oppView[.][X] = my bottom-2 in row X
//     under inversion. I refuse my row-min; surviving = my row second-min.
//
//   attacker pairing vs opp's D = COL SECOND-MAX of myView[.][D] over (myPool
//     \ {X}). Reason: I send top-2 by col D from eligible attackers. Opp's
//     Easy refuses my col-max (their lowest oppView). Surviving = col
//     second-max. Crucially, this depends on X via eligibility — if X is in
//     the top-2 of col D, removing it as defender drops col-second-max by
//     ~5+ points. Easy doesn't account for this.
//
// Medium picks X to maximize the SUM (defender pairing + attacker pairing)
// given the predicted opp defender D. Easy picks X by row mean — a noisy
// proxy that's correlated but not aligned with the depth-2 round score.
//
// Refusal and table picks are depth-2 optimal under Easy already; Medium
// delegates rather than duplicating logic. If Easy's behavior changes, the
// derivation needs revisiting (we noted this exact situation when the user
// updated Easy's pickAttackers from bottom-2 to top-2 — old Medium's row-max
// defender heuristic became miscalibrated overnight).
//
// We approximate the predicted opp defender as the static "argmin col-mean
// over my full pool" (the same calculation opp performs at this phase since
// opp can't see X yet). True depth-2 would re-predict for each X candidate
// based on a counterfactual "what if I had locked X" — but at AWAITING_
// DEFENDERS the locks are simultaneous, so opp uses the same full-pool view
// and the static prediction is exact.

// Row second-min of myView[X][.] over a given opp pool, returned alongside
// the surviving opposing army id (the second-lowest myView[X][·] over the
// pool). Under the symmetric top-2 attacker model, opp sends my bottom-2 of
// myView[X][·]; I refuse my row-min → row-second-min is the surviving opp
// attacker's score, and `armyId` is who they sent. The position is needed
// by the impact-bonus term in pickDefender (Task 6).
interface SecondExtremum {
  readonly value: number;
  readonly armyId: ArmyId | null;
}

function rowSecondMinPosOver(
  view: TeamView,
  X: ArmyId,
  oppPool: readonly ArmyId[],
): SecondExtremum {
  const i = view.myRoster.indexOf(X);
  let min1 = Infinity, min2 = Infinity;
  let arg1: ArmyId | null = null, arg2: ArmyId | null = null;
  for (const o of oppPool) {
    const j = view.oppRoster.indexOf(o);
    const v = view.myView[i]![j]!.value as number;
    if (v < min1) {
      min2 = min1; arg2 = arg1;
      min1 = v; arg1 = o;
    } else if (v < min2) {
      min2 = v; arg2 = o;
    }
  }
  return { value: min2, armyId: arg2 };
}

// Col second-max of myView[.][D] over a given my-pool, returned alongside
// the surviving MY attacker's army id. Opp's Easy refuses my col-max →
// col-second-max is my surviving attacker's score; `armyId` is who survived.
function colSecondMaxPosOver(
  view: TeamView,
  D: ArmyId,
  myPool: readonly ArmyId[],
): SecondExtremum {
  const j = view.oppRoster.indexOf(D);
  let max1 = -Infinity, max2 = -Infinity;
  let arg1: ArmyId | null = null, arg2: ArmyId | null = null;
  for (const a of myPool) {
    const i = view.myRoster.indexOf(a);
    const v = view.myView[i]![j]!.value as number;
    if (v > max1) {
      max2 = max1; arg2 = arg1;
      max1 = v; arg1 = a;
    } else if (v > max2) {
      max2 = v; arg2 = a;
    }
  }
  return { value: max2, armyId: arg2 };
}

// Best positive table-modifier delta achievable on this cell from the
// picker's view. Reads myImpact, applies each non-null modifier to the cell's
// score via the *clamped* form (near-edge cells can't realize the full
// nominal delta — e.g. an 18 with `++` only yields +2, not +6), and returns
// the max positive shift. 0 when no impact improves the cell.
//
// Used by Task 6's defender heuristic: each candidate matchup picks up a
// fractional bonus for the best table its team could be assigned, capturing
// upside that Easy's row-mean / row-second-min terms completely ignore.
function bestImpactDelta(
  view: TeamView,
  myArmy: ArmyId,
  oppArmy: ArmyId,
): number {
  const i = view.myRoster.indexOf(myArmy);
  const j = view.oppRoster.indexOf(oppArmy);
  if (i < 0 || j < 0) return 0;
  const cell = view.myImpact[i]?.[j];
  if (cell === undefined) return 0;
  const score = view.myView[i]![j]!;
  const base = score.value as number;
  let best = 0;
  for (const mod of cell) {
    if (mod === null) continue;
    const shifted = applyTableModifier(score, mod);
    const delta = (shifted.value as number) - base;
    if (delta > best) best = delta;
  }
  return best;
}

// Predict opp's defender pick. Opp's Easy = argmax row mean of oppView. Under
// inversion, opp's row mean(D) = 20 − col-mean(D) from my POV, so opp picks D
// to MINIMIZE my column mean. Note: at AWAITING_DEFENDERS, both teams pick
// simultaneously and opp doesn't know my X, so this calculation uses my full
// remaining pool — the same view opp has when they decide.
function predictOppDefender(view: TeamView): ArmyId {
  let best: ArmyId | null = null;
  let bestMean = Infinity;
  for (const o of view.oppPool) {
    const j = view.oppRoster.indexOf(o);
    let sum = 0;
    for (const a of view.myPool) {
      const i = view.myRoster.indexOf(a);
      sum += view.myView[i]![j]!.value as number;
    }
    const mean = sum / view.myPool.length;
    if (
      mean < bestMean
      || (mean === bestMean && best !== null && lex(o, best) < 0)
    ) {
      best = o;
      bestMean = mean;
    }
  }
  return best!;
}

// Weight on each impact-bonus term in the Medium defender heuristic (Task 6).
// 0.5 reflects the v1 simplification that for each pairing the table modifier
// is realized with some uncertainty about which team picks; see the inline
// derivation in mediumActor.pickDefender for the full reasoning.
const IMPACT_BONUS_WEIGHT = 0.5;

// Find the pairing the seat is about to assign a table to. Mirrors the
// engine's targetIdx selection in applyLockInTable / phaseATableScrum /
// phaseBTableScrum: own-defender unassigned pairing first, then any
// null-defender (scrum Phase B). Returns null if no candidate — defensive;
// the engine never invokes pickTable outside an AWAITING_TABLES phase.
function findTablePickTarget(view: TeamView): Pairing | null {
  for (const p of view.pairings) {
    if (p.tableId === undefined && p.defenderTeam === view.seat) return p;
  }
  for (const p of view.pairings) {
    if (p.tableId === undefined && p.defenderTeam === null) return p;
  }
  return null;
}

// Look up the modifier the picker sees for `pairing` on `tableId`, returning
// the signed numeric delta in the picker's mode. Reads from `myImpact`, so
// each seat's view of the same matchup is independent (symbolic inverse).
function pickerModifierDelta(
  view: TeamView,
  pairing: Pairing,
  tableId: TableId,
): number {
  const myArmy = view.seat === 'A' ? pairing.aArmy : pairing.bArmy;
  const oppArmy = view.seat === 'A' ? pairing.bArmy : pairing.aArmy;
  const i = view.myRoster.indexOf(myArmy);
  const j = view.oppRoster.indexOf(oppArmy);
  if (i < 0 || j < 0) return 0;
  const symbol = view.myImpact[i]?.[j]?.[tableId - 1] ?? null;
  if (symbol === null) return 0;
  return tableModifierDelta(symbol, view.mode);
}

export function mediumActor(seat: Team): Actor {
  void seat;
  const easy = easyActor(seat);
  return {
    // Round-sum depth-2 minimax with impact bonus (Task 6). Pick X to maximize
    //
    //   score(X) = defPairing                                  (base, my-defender)
    //            + atkPairing                                  (base, my-attacker)
    //            + IMPACT_BONUS_WEIGHT * bestImpactDelta(X, survB)
    //            + IMPACT_BONUS_WEIGHT * bestImpactDelta(survA, D)
    //
    // where
    //   defPairing / survB = row-second-min of myView[X][·] over oppPool\{D}
    //   atkPairing / survA = col-second-max of myView[·][D] over myPool\{X}
    //   D                  = predicted opp defender (argmin col-mean from my view)
    //
    // Base terms are the same depth-2 closed form as before — the defender
    // term excludes D, and the attacker term excludes X. The two bonus terms
    // approximate "expected best-table modifier my team will capture on each
    // pairing this round." Weighted at 0.5 because in practice each pairing's
    // table is picked by exactly one team — but the picker's view and the
    // non-picker's view of the same modifier are symbolic-inverse, so the
    // expected-from-my-view contribution lands between (no impact, full
    // upside) on average. v1 uses a flat 0.5 weight (no token tracking);
    // tunable in T14 once the AI corpus is benchmarked. Easy ignores both
    // bonus terms entirely — that's the intentional handicap.
    pickDefender(view) {
      const D = predictOppDefender(view);
      const oppEligible = view.oppPool.filter(o => o !== D);
      let best: ArmyId | null = null;
      let bestScore = -Infinity;
      for (const X of view.myPool) {
        const defSurv = rowSecondMinPosOver(view, X, oppEligible);
        const myRemaining = view.myPool.filter(a => a !== X);
        const atkSurv = colSecondMaxPosOver(view, D, myRemaining);
        const defBonus = defSurv.armyId !== null
          ? bestImpactDelta(view, X, defSurv.armyId)
          : 0;
        const atkBonus = atkSurv.armyId !== null
          ? bestImpactDelta(view, atkSurv.armyId, D)
          : 0;
        const total = defSurv.value
          + atkSurv.value
          + IMPACT_BONUS_WEIGHT * defBonus
          + IMPACT_BONUS_WEIGHT * atkBonus;
        if (
          total > bestScore
          || (total === bestScore && best !== null && lex(X, best) < 0)
        ) {
          best = X;
          bestScore = total;
        }
      }
      return best!;
    },

    // Under the symmetric top-2 attacker model, depth-2 minimax for these
    // two phases yields the same closed form Easy uses. Delegate to keep
    // the implementations in sync — if Easy's heuristic ever changes, Medium
    // tracks automatically (and we'll need to re-derive whether that's still
    // depth-2 optimal under the new model).
    pickAttackers(view, oppDefender) { return easy.pickAttackers(view, oppDefender); },
    pickRefusal(view, attackers) { return easy.pickRefusal(view, attackers); },

    // pickTable: argmax of the modifier delta from the picker's view of the
    // pairing they're picking for. Easy ignores impacts entirely (by design —
    // it's the handicap that widens the Easy/Medium gap once impacts exist);
    // Medium scans every available table and chooses the highest-delta one.
    // Tie-break: lowest tableId, matching Easy's pick when all deltas are 0.
    // When the impact tensor is empty (all-null), every delta is 0 and Medium
    // collapses to Easy's lowest-id pick — same observable behavior on legacy
    // games without impacts.
    pickTable(view, available) {
      const target = findTablePickTarget(view);
      if (target === null) return easy.pickTable(view, available);
      let bestTable = available[0]!;
      let bestDelta = pickerModifierDelta(view, target, bestTable);
      for (let k = 1; k < available.length; k++) {
        const t = available[k]!;
        const delta = pickerModifierDelta(view, target, t);
        if (delta > bestDelta || (delta === bestDelta && t < bestTable)) {
          bestTable = t;
          bestDelta = delta;
        }
      }
      return bestTable;
    },
  };
}

// ── runGame driver ────────────────────────────────────────────────────────────

const TABLE_ID_MIN = 1;
const TABLE_ID_MAX = 8;

export function availableTables(state: PairingState): TableId[] {
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
export function nextTableTeam(state: PairingState): Team {
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
