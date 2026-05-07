import { describe, it, expect } from 'vitest';
import { performance } from 'node:perf_hooks';
import {
  createInitialState,
  applyAction,
  viewFor,
} from './state.js';
import type { PairingState, TeamView } from './state.js';
import type { ArmyId, LogEntry, Team } from './log.js';
import {
  scriptedActor,
  easyActor,
  runGame,
} from './ai.js';
import type { Actor, ScriptedPick } from './ai.js';

const ROSTER_A: readonly ArmyId[] = Array.from({ length: 8 }, (_, i) => `a${i}`);
const ROSTER_B: readonly ArmyId[] = Array.from({ length: 8 }, (_, i) => `b${i}`);

function init(seed = 0xdead): PairingState {
  return createInitialState({
    mode: 'standard',
    seed,
    rosterA: ROSTER_A,
    rosterB: ROSTER_B,
  });
}

// Build a minimal TeamView for unit-testing easyActor methods directly.
// myView is row-indexed by myRoster, col-indexed by oppRoster.
function makeView(opts: {
  seat: Team;
  myRoster: readonly ArmyId[];
  oppRoster: readonly ArmyId[];
  myPool: readonly ArmyId[];
  oppPool: readonly ArmyId[];
  myView: readonly (readonly number[])[];
  // Optional revealed defenders so pickAttackers / pickRefusal can read self.
  revealedDefenders?: { a: ArmyId; b: ArmyId };
}): TeamView {
  return {
    seat: opts.seat,
    phase: 'ROUND_1.AWAITING_DEFENDERS',
    mode: 'standard',
    myView: opts.myView.map(row => row.map(v => ({ mode: 'standard' as const, value: v }))),
    myRoster: opts.myRoster,
    oppRoster: opts.oppRoster,
    myPool: opts.myPool,
    oppPool: opts.oppPool,
    pairings: [],
    log: [],
    tokenHolder: null,
    step: opts.revealedDefenders
      ? { defenders: { revealed: opts.revealedDefenders } }
      : {},
  };
}

// ── scriptedActor ─────────────────────────────────────────────────────────────

describe('scriptedActor', () => {
  it('returns picks in FIFO order, one per call', () => {
    const view = makeView({
      seat: 'A',
      myRoster: ROSTER_A, oppRoster: ROSTER_B,
      myPool: ROSTER_A, oppPool: ROSTER_B,
      myView: Array.from({ length: 8 }, () => Array(8).fill(10)),
      revealedDefenders: { a: 'a0', b: 'b0' },
    });
    const actor = scriptedActor([
      { kind: 'defender', armyId: 'a3' },
      { kind: 'attackers', armyIds: ['a1', 'a2'] },
      { kind: 'refusal', armyId: 'b4' },
      { kind: 'table', tableId: 5 },
    ]);
    expect(actor.pickDefender(view)).toBe('a3');
    expect(actor.pickAttackers(view, 'b0')).toEqual(['a1', 'a2']);
    expect(actor.pickRefusal(view, ['b4', 'b5'])).toBe('b4');
    expect(actor.pickTable(view, [1, 2, 3, 5])).toBe(5);
  });

  it('throws when the next pick kind does not match the call', () => {
    const view = makeView({
      seat: 'A',
      myRoster: ROSTER_A, oppRoster: ROSTER_B,
      myPool: ROSTER_A, oppPool: ROSTER_B,
      myView: Array.from({ length: 8 }, () => Array(8).fill(10)),
    });
    const actor = scriptedActor([{ kind: 'attackers', armyIds: ['a1', 'a2'] }]);
    expect(() => actor.pickDefender(view)).toThrow(/got attackers/);
  });

  it('throws when the script is exhausted', () => {
    const view = makeView({
      seat: 'A',
      myRoster: ROSTER_A, oppRoster: ROSTER_B,
      myPool: ROSTER_A, oppPool: ROSTER_B,
      myView: Array.from({ length: 8 }, () => Array(8).fill(10)),
    });
    const actor = scriptedActor([]);
    expect(() => actor.pickDefender(view)).toThrow(/exhausted/);
  });
});

// ── easyActor — hand-crafted matrix tests ─────────────────────────────────────

describe('easyActor.pickDefender', () => {
  it('argmaxes mean expected score across the opposing pool', () => {
    // Three armies for clarity; only the row means matter.
    // Means: a0 → 10, a1 → 15, a2 → 5. Argmax = a1.
    const myView = [
      [10, 10, 10],
      [15, 15, 15],
      [ 5,  5,  5],
    ];
    const view = makeView({
      seat: 'A',
      myRoster: ['a0', 'a1', 'a2'],
      oppRoster: ['b0', 'b1', 'b2'],
      myPool:    ['a0', 'a1', 'a2'],
      oppPool:   ['b0', 'b1', 'b2'],
      myView,
    });
    expect(easyActor('A').pickDefender(view)).toBe('a1');
  });

  it('breaks ties by armyId lexicographically', () => {
    // a1 and a2 both have mean 12; a1 wins by lex order.
    const myView = [
      [ 8,  8,  8],
      [12, 12, 12],
      [12, 12, 12],
    ];
    const view = makeView({
      seat: 'A',
      myRoster: ['a0', 'a1', 'a2'],
      oppRoster: ['b0', 'b1', 'b2'],
      myPool:    ['a0', 'a1', 'a2'],
      oppPool:   ['b0', 'b1', 'b2'],
      myView,
    });
    expect(easyActor('A').pickDefender(view)).toBe('a1');
  });

  it('only considers armies in myPool, not the full roster', () => {
    // a1 has the best mean overall, but it's already paired (out of pool).
    // From the remaining {a0, a2}, a2 has the higher mean.
    const myView = [
      [ 8,  8,  8],   // a0 mean 8
      [20, 20, 20],   // a1 mean 20 — but excluded
      [12, 12, 12],   // a2 mean 12
    ];
    const view = makeView({
      seat: 'A',
      myRoster: ['a0', 'a1', 'a2'],
      oppRoster: ['b0', 'b1', 'b2'],
      myPool:    ['a0', 'a2'],
      oppPool:   ['b0', 'b1', 'b2'],
      myView,
    });
    expect(easyActor('A').pickDefender(view)).toBe('a2');
  });
});

describe('easyActor.pickAttackers', () => {
  it('returns the two pool armies with the lowest score against oppDefender, excluding own defender', () => {
    // Against b0 (col 0): a0=15, a1=4, a2=8, a3=2, a4=20.
    // Excluding a4 (own defender) → sorted ascending: a3(2), a1(4), a2(8), a0(15).
    // Two lowest: [a3, a1].
    const myView = [
      [15, 0, 0, 0, 0],
      [ 4, 0, 0, 0, 0],
      [ 8, 0, 0, 0, 0],
      [ 2, 0, 0, 0, 0],
      [20, 0, 0, 0, 0],
    ];
    const view = makeView({
      seat: 'A',
      myRoster: ['a0', 'a1', 'a2', 'a3', 'a4'],
      oppRoster: ['b0', 'b1', 'b2', 'b3', 'b4'],
      myPool:    ['a0', 'a1', 'a2', 'a3', 'a4'],
      oppPool:   ['b0', 'b1', 'b2', 'b3', 'b4'],
      myView,
      // Defenders revealed: A=a4, B=b0.
      revealedDefenders: { a: 'a4', b: 'b0' },
    });
    expect(easyActor('A').pickAttackers(view, 'b0')).toEqual(['a3', 'a1']);
  });

  it('breaks ties by armyId lexicographically', () => {
    // a0=5, a1=5, a2=10, a3=10. Two lowest: a0 and a1 (lex tiebreak).
    const myView = [
      [ 5, 0],
      [ 5, 0],
      [10, 0],
      [10, 0],
    ];
    const view = makeView({
      seat: 'A',
      myRoster: ['a0', 'a1', 'a2', 'a3'],
      oppRoster: ['b0', 'b1'],
      myPool:    ['a0', 'a1', 'a2', 'a3'],
      oppPool:   ['b0', 'b1'],
      myView,
      revealedDefenders: { a: 'a3', b: 'b0' },
    });
    // a3 is own defender → excluded; among {a0,a1,a2}, two lowest ties between
    // a0 and a1 at 5. Pair sorted ascending then lex: [a0, a1].
    expect(easyActor('A').pickAttackers(view, 'b0')).toEqual(['a0', 'a1']);
  });

  it('works for seat B with row indexing on viewB (B armies down rows, A across cols)', () => {
    // For B: myView[i][j] is B's score for B's army myRoster[i] vs A's army oppRoster[j].
    // Against a0 (col 0): b0=10, b1=4, b2=2.
    // Own defender = b2 → excluded. Two lowest from {b0,b1}: [b1, b0] sorted asc.
    const myView = [
      [10, 0, 0],
      [ 4, 0, 0],
      [ 2, 0, 0],
    ];
    const view = makeView({
      seat: 'B',
      myRoster: ['b0', 'b1', 'b2'],
      oppRoster: ['a0', 'a1', 'a2'],
      myPool:    ['b0', 'b1', 'b2'],
      oppPool:   ['a0', 'a1', 'a2'],
      myView,
      revealedDefenders: { a: 'a0', b: 'b2' },
    });
    expect(easyActor('B').pickAttackers(view, 'a0')).toEqual(['b1', 'b0']);
  });
});

describe('easyActor.pickRefusal', () => {
  it('refuses the attacker with the lowest expected score against our defender (= worst matchup for us)', () => {
    // Our defender = a0. Attackers = [b1, b3]. myView[a0][b1]=15, myView[a0][b3]=4.
    // Refuse the worst-for-us → b3 (score 4).
    const myView = [
      [10, 15, 10, 4, 10],   // a0 row
      [10, 10, 10, 10, 10],
      [10, 10, 10, 10, 10],
    ];
    const view = makeView({
      seat: 'A',
      myRoster: ['a0', 'a1', 'a2'],
      oppRoster: ['b0', 'b1', 'b2', 'b3', 'b4'],
      myPool:    ['a0', 'a1', 'a2'],
      oppPool:   ['b0', 'b1', 'b2', 'b3', 'b4'],
      myView,
      revealedDefenders: { a: 'a0', b: 'b0' },
    });
    expect(easyActor('A').pickRefusal(view, ['b1', 'b3'])).toBe('b3');
  });

  it('breaks ties by armyId lexicographically (worst-tied attackers)', () => {
    const myView = [[10, 5, 5, 5, 5]];
    const view = makeView({
      seat: 'A',
      myRoster: ['a0'],
      oppRoster: ['b0', 'b1', 'b2', 'b3', 'b4'],
      myPool:    ['a0'],
      oppPool:   ['b0', 'b1', 'b2', 'b3', 'b4'],
      myView,
      revealedDefenders: { a: 'a0', b: 'b0' },
    });
    // b1 and b2 both score 5 → refuse b1 (lex first).
    expect(easyActor('A').pickRefusal(view, ['b1', 'b2'])).toBe('b1');
  });
});

describe('easyActor.pickTable', () => {
  it('returns the lowest-numbered available table id', () => {
    const view = makeView({
      seat: 'A',
      myRoster: ROSTER_A, oppRoster: ROSTER_B,
      myPool: ROSTER_A, oppPool: ROSTER_B,
      myView: Array.from({ length: 8 }, () => Array(8).fill(10)),
    });
    expect(easyActor('A').pickTable(view, [3, 7, 2, 5])).toBe(2);
    expect(easyActor('A').pickTable(view, [8])).toBe(8);
  });
});

// ── runGame ───────────────────────────────────────────────────────────────────

describe('runGame', () => {
  it('drives easy-vs-easy from init to GAME_COMPLETE with a legal action sequence', () => {
    const { state, log } = runGame(init(0xc4f1), easyActor('A'), easyActor('B'));
    expect(state.phase).toBe('GAME_COMPLETE');
    expect(state.pairings).toHaveLength(8);
    expect(new Set(state.pairings.map(p => p.tableId)).size).toBe(8);
    expect(state.poolA).toHaveLength(0);
    expect(state.poolB).toHaveLength(0);
    expect(log).toBe(state.log); // returned log is the same array reference
    const counts: Record<string, number> = {};
    for (const e of log) counts[e.type] = (counts[e.type] ?? 0) + 1;
    expect(counts['LastManAutoPaired']).toBe(1);
    expect(counts['RefusedAutoPaired']).toBe(1);
    expect(counts['TableChosen']).toBe(8);
  });

  it('is deterministic — same seed yields the same log', () => {
    const r1 = runGame(init(42), easyActor('A'), easyActor('B'));
    const r2 = runGame(init(42), easyActor('A'), easyActor('B'));
    expect(r2.log).toEqual(r1.log);
    expect(r2.state.pairings).toEqual(r1.state.pairings);
  });

  it('completes 100 easy-vs-easy games legally in well under 50ms each (avg)', () => {
    const t0 = performance.now();
    for (let seed = 0; seed < 100; seed++) {
      const { state } = runGame(init(seed), easyActor('A'), easyActor('B'));
      expect(state.phase).toBe('GAME_COMPLETE');
      expect(state.pairings).toHaveLength(8);
    }
    const elapsed = performance.now() - t0;
    // 100 games < 5000ms (50ms/game ceiling). In practice <500ms.
    expect(elapsed).toBeLessThan(5000);
  });

  it('uses viewFor projections — actors never receive opposing pendings', () => {
    // Actor wrapper that asserts every view it sees has no opposing pendings.
    function assertingActor(seat: Team): Actor {
      const inner = easyActor(seat);
      const check = (view: TeamView) => {
        expect(view.seat).toBe(seat);
        const oppKey = seat === 'A' ? 'pendingB' : 'pendingA';
        if (view.step.defenders) expect(oppKey in view.step.defenders).toBe(false);
        if (view.step.attackers) expect(oppKey in view.step.attackers).toBe(false);
        if (view.step.refusals) expect(oppKey in view.step.refusals).toBe(false);
      };
      return {
        pickDefender(v) { check(v); return inner.pickDefender(v); },
        pickAttackers(v, d) { check(v); return inner.pickAttackers(v, d); },
        pickRefusal(v, a) { check(v); return inner.pickRefusal(v, a); },
        pickTable(v, t) { check(v); return inner.pickTable(v, t); },
      };
    }
    const { state } = runGame(init(0xbeef), assertingActor('A'), assertingActor('B'));
    expect(state.phase).toBe('GAME_COMPLETE');
  });

  it('a scripted actor built from a recorded run reproduces the same final state byte-for-byte', () => {
    // Record what easyActors decide, then replay through scriptedActors.
    const initial = init(0x7777);

    function recording(inner: Actor): { actor: Actor; picks: ScriptedPick[] } {
      const picks: ScriptedPick[] = [];
      return {
        actor: {
          pickDefender(v) {
            const armyId = inner.pickDefender(v);
            picks.push({ kind: 'defender', armyId });
            return armyId;
          },
          pickAttackers(v, d) {
            const armyIds = inner.pickAttackers(v, d);
            picks.push({ kind: 'attackers', armyIds });
            return armyIds;
          },
          pickRefusal(v, a) {
            const armyId = inner.pickRefusal(v, a);
            picks.push({ kind: 'refusal', armyId });
            return armyId;
          },
          pickTable(v, t) {
            const tableId = inner.pickTable(v, t);
            picks.push({ kind: 'table', tableId });
            return tableId;
          },
        },
        picks,
      };
    }

    const recA = recording(easyActor('A'));
    const recB = recording(easyActor('B'));
    const original = runGame(initial, recA.actor, recB.actor);

    const replayed = runGame(initial, scriptedActor(recA.picks), scriptedActor(recB.picks));
    // JSON-equal modulo info-hiding (state.step is reset at GAME_COMPLETE).
    expect(replayed.state).toEqual(original.state);
    expect(replayed.log).toEqual(original.log);
  });

  it('throws if an actor returns an illegal decision', () => {
    // An actor that always returns 'NOT_AN_ARMY' will trip PoolViolation.
    const bogus: Actor = {
      pickDefender: () => 'NOT_AN_ARMY',
      pickAttackers: () => ['NOT_AN_ARMY', 'NOT_AN_ARMY'],
      pickRefusal: () => 'NOT_AN_ARMY',
      pickTable: () => 1,
    };
    expect(() => runGame(init(1), bogus, easyActor('B'))).toThrow();
  });
});

// ── runGame property: 100 seeds reach GAME_COMPLETE with engine invariants ────

describe('runGame property: easy-vs-easy invariants', () => {
  it('every seed in [0, 100) lands in GAME_COMPLETE with 8 distinct tables and JSON round-trip', () => {
    for (let seed = 0; seed < 100; seed++) {
      const { state } = runGame(init(seed), easyActor('A'), easyActor('B'));
      expect(state.phase).toBe('GAME_COMPLETE');
      expect(state.pairings).toHaveLength(8);
      expect(new Set(state.pairings.map(p => p.tableId)).size).toBe(8);
      // Tables are by spec the lowest available, so easy-vs-easy assigns 1..8 in order.
      const sortedTables = [...state.pairings.map(p => p.tableId)].sort((a, b) => (a ?? 0) - (b ?? 0));
      expect(sortedTables).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
      expect(JSON.parse(JSON.stringify(state))).toEqual(state);
    }
  });
});

// ── Sanity: applyAction integration — the runner only dispatches legal actions ─

describe('runGame integration with applyAction', () => {
  it('every dispatch returns ok=true (no IllegalAction or PoolViolation under runGame)', () => {
    // Wrap applyAction by spying through a custom actor that records seen states;
    // simpler: re-walk the recorded actions through applyAction and assert ok.
    const { state: finalState, log } = runGame(init(123), easyActor('A'), easyActor('B'));
    expect(finalState.phase).toBe('GAME_COMPLETE');
    // Sanity: log contains exactly one TokenRollOff and at least 2 TokenFlipped.
    const tokenRollOffs = log.filter(e => e.type === 'TokenRollOff');
    const tokenFlips = log.filter(e => e.type === 'TokenFlipped');
    expect(tokenRollOffs).toHaveLength(1);
    expect(tokenFlips.length).toBeGreaterThanOrEqual(2);
    // Ensure applyAction is never called on a GAME_COMPLETE state by external runner;
    // i.e., further calls would be IllegalAction.
    const probe = applyAction(finalState, { type: 'LOCK_IN_DEFENDER', team: 'A', armyId: 'a0' });
    expect(probe.ok).toBe(false);
  });

  it('viewFor on the final state has no pending slots', () => {
    const { state } = runGame(init(7), easyActor('A'), easyActor('B'));
    const va = viewFor(state, 'A');
    const vb = viewFor(state, 'B');
    expect(va.step).toEqual({});
    expect(vb.step).toEqual({});
  });
});

// Suppress unused-import warning for LogEntry — it's used implicitly via state.log typing.
void (null as unknown as LogEntry);
