import { describe, it, expect } from 'vitest';
import {
  createInitialState,
  applyAction,
  viewFor,
  rollInitialToken,
} from './state.js';
import type {
  Action,
  PairingState,
  Phase,
  SecretSlot,
  StepState,
} from './state.js';
import type { ArmyId, LogEntry, Team } from './log.js';
import { seed as mkSeed, nextInt, pick } from './rng.js';
import type { RngState } from './rng.js';

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

// ── createInitialState ────────────────────────────────────────────────────────

describe('state.createInitialState', () => {
  it('starts in ROUND_1.AWAITING_DEFENDERS', () => {
    expect(init().phase).toBe('ROUND_1.AWAITING_DEFENDERS');
  });

  it('records the requested mode', () => {
    expect(init().mode).toBe('standard');
    const atlas = createInitialState({
      mode: 'atlas', seed: 1, rosterA: ROSTER_A, rosterB: ROSTER_B,
    });
    expect(atlas.mode).toBe('atlas');
  });

  it('generates a matrix matching the requested mode', () => {
    const s = init();
    expect(s.matrix.mode).toBe('standard');
    expect(s.matrix.viewA.length).toBe(8);
    expect(s.matrix.viewB.length).toBe(8);
  });

  it('initializes pools to full rosters', () => {
    const s = init();
    expect(s.poolA).toEqual(ROSTER_A);
    expect(s.poolB).toEqual(ROSTER_B);
  });

  it('starts with empty pairings, empty log, no token holder, empty step', () => {
    const s = init();
    expect(s.pairings).toEqual([]);
    expect(s.log).toEqual([]);
    expect(s.tokenHolder).toBe(null);
    expect(s.step).toEqual({});
  });

  it('is deterministic for a fixed seed', () => {
    expect(init(42)).toEqual(init(42));
  });

  it('round-trips through JSON', () => {
    const s = init();
    const reparsed = JSON.parse(JSON.stringify(s)) as PairingState;
    expect(reparsed).toEqual(s);
  });

  it('does not mutate the input rosters (frozen input)', () => {
    const frozenA = Object.freeze([...ROSTER_A]);
    const frozenB = Object.freeze([...ROSTER_B]);
    expect(() =>
      createInitialState({
        mode: 'standard',
        seed: 1,
        rosterA: frozenA,
        rosterB: frozenB,
      }),
    ).not.toThrow();
    expect([...frozenA]).toEqual(ROSTER_A);
    expect([...frozenB]).toEqual(ROSTER_B);
  });

  it('rejects rosters that are not 8 armies', () => {
    expect(() =>
      createInitialState({
        mode: 'standard',
        seed: 1,
        rosterA: ['only-one'],
        rosterB: ROSTER_B,
      }),
    ).toThrow(RangeError);
    expect(() =>
      createInitialState({
        mode: 'standard',
        seed: 1,
        rosterA: ROSTER_A,
        rosterB: [...ROSTER_B, 'extra'],
      }),
    ).toThrow(RangeError);
  });
});

// ── viewFor ───────────────────────────────────────────────────────────────────

describe('state.viewFor', () => {
  it('exposes A\'s own matrix view to seat A and B\'s view to seat B', () => {
    const s = init();
    expect(viewFor(s, 'A').myView).toEqual(s.matrix.viewA);
    expect(viewFor(s, 'B').myView).toEqual(s.matrix.viewB);
  });

  it('exposes own roster and pool, plus opposing roster and pool', () => {
    const s = init();
    const va = viewFor(s, 'A');
    expect(va.myRoster).toEqual(ROSTER_A);
    expect(va.oppRoster).toEqual(ROSTER_B);
    expect(va.myPool).toEqual(ROSTER_A);
    expect(va.oppPool).toEqual(ROSTER_B);
    const vb = viewFor(s, 'B');
    expect(vb.myRoster).toEqual(ROSTER_B);
    expect(vb.oppRoster).toEqual(ROSTER_A);
  });

  it('exposes phase, mode, log, pairings, tokenHolder', () => {
    const s = init();
    const v = viewFor(s, 'A');
    expect(v.phase).toBe(s.phase);
    expect(v.mode).toBe(s.mode);
    expect(v.log).toEqual(s.log);
    expect(v.pairings).toEqual(s.pairings);
    expect(v.tokenHolder).toBe(s.tokenHolder);
    expect(v.seat).toBe('A');
  });

  it('strips opposing team\'s pendingB when seat is A', () => {
    const s = init();
    const slot: SecretSlot<ArmyId> = { pendingA: 'a3', pendingB: 'b5' };
    const withPending: PairingState = { ...s, step: { defenders: slot } };

    const va = viewFor(withPending, 'A');
    expect(va.step.defenders?.pendingA).toBe('a3');
    expect(va.step.defenders?.pendingB).toBeUndefined();
    expect('pendingB' in (va.step.defenders ?? {})).toBe(false);
  });

  it('strips opposing team\'s pendingA when seat is B', () => {
    const s = init();
    const slot: SecretSlot<ArmyId> = { pendingA: 'a3', pendingB: 'b5' };
    const withPending: PairingState = { ...s, step: { defenders: slot } };

    const vb = viewFor(withPending, 'B');
    expect(vb.step.defenders?.pendingB).toBe('b5');
    expect(vb.step.defenders?.pendingA).toBeUndefined();
    expect('pendingA' in (vb.step.defenders ?? {})).toBe(false);
  });

  it('preserves revealed values for both seats', () => {
    const s = init();
    const slot: SecretSlot<ArmyId> = { revealed: { a: 'a1', b: 'b2' } };
    const withRevealed: PairingState = { ...s, step: { defenders: slot } };

    expect(viewFor(withRevealed, 'A').step.defenders?.revealed).toEqual({ a: 'a1', b: 'b2' });
    expect(viewFor(withRevealed, 'B').step.defenders?.revealed).toEqual({ a: 'a1', b: 'b2' });
  });

  it('strips pendings across all slot kinds (defenders, attackers, refusals)', () => {
    const s = init();
    const step: StepState = {
      defenders: { pendingA: 'a1', pendingB: 'b1' },
      attackers: { pendingA: ['a2', 'a3'], pendingB: ['b2', 'b3'] },
      refusals: { pendingA: 'a4', pendingB: 'b4' },
    };
    const populated: PairingState = { ...s, step };

    const va = viewFor(populated, 'A');
    expect(va.step.defenders?.pendingB).toBeUndefined();
    expect(va.step.attackers?.pendingB).toBeUndefined();
    expect(va.step.refusals?.pendingB).toBeUndefined();
    expect(va.step.defenders?.pendingA).toBe('a1');
    expect(va.step.attackers?.pendingA).toEqual(['a2', 'a3']);
    expect(va.step.refusals?.pendingA).toBe('a4');

    const vb = viewFor(populated, 'B');
    expect(vb.step.defenders?.pendingA).toBeUndefined();
    expect(vb.step.attackers?.pendingA).toBeUndefined();
    expect(vb.step.refusals?.pendingA).toBeUndefined();
    expect(vb.step.defenders?.pendingB).toBe('b1');
    expect(vb.step.attackers?.pendingB).toEqual(['b2', 'b3']);
    expect(vb.step.refusals?.pendingB).toBe('b4');
  });

  it('round-trips a TeamView through JSON', () => {
    const s = init();
    const slot: SecretSlot<ArmyId> = { pendingA: 'a3', pendingB: 'b5' };
    const v = viewFor({ ...s, step: { defenders: slot } }, 'A');
    expect(JSON.parse(JSON.stringify(v))).toEqual(v);
  });

  it('does not mutate the source state', () => {
    const s = init();
    const slot: SecretSlot<ArmyId> = { pendingA: 'a3', pendingB: 'b5' };
    const withPending: PairingState = { ...s, step: { defenders: slot } };
    const snapshot = JSON.parse(JSON.stringify(withPending));
    viewFor(withPending, 'A');
    expect(JSON.parse(JSON.stringify(withPending))).toEqual(snapshot);
  });
});

// ── applyAction default dispatcher ────────────────────────────────────────────

describe('state.applyAction (default dispatcher)', () => {
  it('rejects non-LOCK_IN_DEFENDER actions in ROUND_1.AWAITING_DEFENDERS', () => {
    const s = init();
    const actions: Action[] = [
      { type: 'LOCK_IN_ATTACKERS', team: 'A', armyIds: ['a0', 'a1'] },
      { type: 'LOCK_IN_REFUSAL', team: 'A', armyId: 'a0' },
      { type: 'LOCK_IN_TABLE', team: 'A', tableId: 1 },
      { type: 'RESOLVE_INITIAL_TOKEN', winner: 'A' },
    ];
    for (const a of actions) {
      const r = applyAction(s, a);
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.error.kind).toBe('IllegalAction');
        if (r.error.kind === 'IllegalAction') {
          expect(r.error.phase).toBe('ROUND_1.AWAITING_DEFENDERS');
          expect(r.error.action).toEqual(a);
        }
      }
    }
  });

  it('does not mutate input state on a rejected action', () => {
    const s = init();
    const snapshot = JSON.parse(JSON.stringify(s));
    applyAction(s, { type: 'LOCK_IN_TABLE', team: 'A', tableId: 1 });
    expect(JSON.parse(JSON.stringify(s))).toEqual(snapshot);
  });
});

// ── LOCK_IN_DEFENDER (ROUND_1.AWAITING_DEFENDERS) ─────────────────────────────

describe('state.applyAction LOCK_IN_DEFENDER (ROUND_1.AWAITING_DEFENDERS)', () => {
  it('first lock-in by A: pendingA set, phase unchanged, no log entry, empty events', () => {
    const s0 = init();
    const r = applyAction(s0, { type: 'LOCK_IN_DEFENDER', team: 'A', armyId: 'a3' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.phase).toBe('ROUND_1.AWAITING_DEFENDERS');
    expect(r.state.step.defenders?.pendingA).toBe('a3');
    expect(r.state.step.defenders?.pendingB).toBeUndefined();
    expect(r.state.step.defenders?.revealed).toBeUndefined();
    expect(r.state.log).toEqual([]);
    expect(r.events).toEqual([]);
  });

  it('first lock-in by B: pendingB set, phase unchanged', () => {
    const s0 = init();
    const r = applyAction(s0, { type: 'LOCK_IN_DEFENDER', team: 'B', armyId: 'b5' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.phase).toBe('ROUND_1.AWAITING_DEFENDERS');
    expect(r.state.step.defenders?.pendingB).toBe('b5');
    expect(r.state.step.defenders?.pendingA).toBeUndefined();
  });

  it('second lock-in (B after A) collapses to revealed, advances phase, emits exactly one DefendersRevealed', () => {
    const s0 = init();
    const r1 = applyAction(s0, { type: 'LOCK_IN_DEFENDER', team: 'A', armyId: 'a0' });
    if (!r1.ok) throw new Error('first should succeed');
    const r2 = applyAction(r1.state, { type: 'LOCK_IN_DEFENDER', team: 'B', armyId: 'b0' });
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect(r2.state.phase).toBe('ROUND_1.AWAITING_ATTACKERS');
    expect(r2.state.step.defenders?.revealed).toEqual({ a: 'a0', b: 'b0' });
    expect(r2.state.log).toEqual([
      { type: 'DefendersRevealed', round: 1, aArmy: 'a0', bArmy: 'b0' },
    ]);
    expect(r2.events).toEqual([
      { type: 'DefendersRevealed', round: 1, aArmy: 'a0', bArmy: 'b0' },
    ]);
  });

  it('lock-in order is symmetric (B first, then A produces the same revealed slot)', () => {
    const s0 = init();
    const r1 = applyAction(s0, { type: 'LOCK_IN_DEFENDER', team: 'B', armyId: 'b2' });
    if (!r1.ok) throw new Error('first should succeed');
    const r2 = applyAction(r1.state, { type: 'LOCK_IN_DEFENDER', team: 'A', armyId: 'a4' });
    if (!r2.ok) throw new Error('second should succeed');
    expect(r2.state.step.defenders?.revealed).toEqual({ a: 'a4', b: 'b2' });
    expect(r2.state.phase).toBe('ROUND_1.AWAITING_ATTACKERS');
  });

  it('after reveal: pendingA / pendingB are structurally absent (not just undefined)', () => {
    const s0 = init();
    const r1 = applyAction(s0, { type: 'LOCK_IN_DEFENDER', team: 'A', armyId: 'a0' });
    if (!r1.ok) throw new Error('first should succeed');
    const r2 = applyAction(r1.state, { type: 'LOCK_IN_DEFENDER', team: 'B', armyId: 'b0' });
    if (!r2.ok) throw new Error('second should succeed');
    const slot = r2.state.step.defenders!;
    expect('pendingA' in slot).toBe(false);
    expect('pendingB' in slot).toBe(false);
    expect('revealed' in slot).toBe(true);
  });

  it('PoolViolation when A tries to lock an army not in poolA', () => {
    const s0 = init();
    const r = applyAction(s0, { type: 'LOCK_IN_DEFENDER', team: 'A', armyId: 'b0' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe('PoolViolation');
      if (r.error.kind === 'PoolViolation') {
        expect(r.error.team).toBe('A');
        expect(r.error.armyId).toBe('b0');
      }
    }
  });

  it('PoolViolation when B tries to lock an army not in poolB', () => {
    const s0 = init();
    const r = applyAction(s0, { type: 'LOCK_IN_DEFENDER', team: 'B', armyId: 'a0' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('PoolViolation');
  });

  it('state unchanged on PoolViolation', () => {
    const s0 = init();
    const snap = JSON.parse(JSON.stringify(s0));
    applyAction(s0, { type: 'LOCK_IN_DEFENDER', team: 'A', armyId: 'b0' });
    expect(JSON.parse(JSON.stringify(s0))).toEqual(snap);
  });

  it('DuplicatePending when same team locks twice', () => {
    const s0 = init();
    const r1 = applyAction(s0, { type: 'LOCK_IN_DEFENDER', team: 'A', armyId: 'a0' });
    if (!r1.ok) throw new Error('first should succeed');
    const r2 = applyAction(r1.state, { type: 'LOCK_IN_DEFENDER', team: 'A', armyId: 'a1' });
    expect(r2.ok).toBe(false);
    if (!r2.ok) {
      expect(r2.error.kind).toBe('DuplicatePending');
      if (r2.error.kind === 'DuplicatePending') expect(r2.error.team).toBe('A');
    }
  });

  it('state unchanged on DuplicatePending', () => {
    const s0 = init();
    const r1 = applyAction(s0, { type: 'LOCK_IN_DEFENDER', team: 'A', armyId: 'a0' });
    if (!r1.ok) throw new Error('first should succeed');
    const snap = JSON.parse(JSON.stringify(r1.state));
    applyAction(r1.state, { type: 'LOCK_IN_DEFENDER', team: 'A', armyId: 'a1' });
    expect(JSON.parse(JSON.stringify(r1.state))).toEqual(snap);
  });

  it('information hiding: viewFor(B) does NOT see A\'s pending after A locks first', () => {
    const s0 = init();
    const r = applyAction(s0, { type: 'LOCK_IN_DEFENDER', team: 'A', armyId: 'a3' });
    if (!r.ok) throw new Error('lock should succeed');
    const view = viewFor(r.state, 'B');
    expect(view.step.defenders).toBeDefined();
    expect('pendingA' in (view.step.defenders ?? {})).toBe(false);
    expect(view.step.defenders?.pendingB).toBeUndefined();
  });

  it('information hiding: viewFor(A) does NOT see B\'s pending after B locks first', () => {
    const s0 = init();
    const r = applyAction(s0, { type: 'LOCK_IN_DEFENDER', team: 'B', armyId: 'b3' });
    if (!r.ok) throw new Error('lock should succeed');
    const view = viewFor(r.state, 'A');
    expect('pendingB' in (view.step.defenders ?? {})).toBe(false);
  });

  it('JSON round-trip preserved at every step (single lock and reveal)', () => {
    const s0 = init();
    const r1 = applyAction(s0, { type: 'LOCK_IN_DEFENDER', team: 'A', armyId: 'a3' });
    if (!r1.ok) throw new Error('first should succeed');
    expect(JSON.parse(JSON.stringify(r1.state))).toEqual(r1.state);
    const r2 = applyAction(r1.state, { type: 'LOCK_IN_DEFENDER', team: 'B', armyId: 'b5' });
    if (!r2.ok) throw new Error('second should succeed');
    expect(JSON.parse(JSON.stringify(r2.state))).toEqual(r2.state);
  });

  it('does not mutate input state on success', () => {
    const s0 = init();
    const snap = JSON.parse(JSON.stringify(s0));
    applyAction(s0, { type: 'LOCK_IN_DEFENDER', team: 'A', armyId: 'a0' });
    expect(JSON.parse(JSON.stringify(s0))).toEqual(snap);
  });

  it('pools are unchanged through both lock-ins (defenders only leave pool at refusal collapse)', () => {
    const s0 = init();
    const r1 = applyAction(s0, { type: 'LOCK_IN_DEFENDER', team: 'A', armyId: 'a0' });
    if (!r1.ok) throw new Error('first should succeed');
    const r2 = applyAction(r1.state, { type: 'LOCK_IN_DEFENDER', team: 'B', armyId: 'b0' });
    if (!r2.ok) throw new Error('second should succeed');
    expect(r2.state.poolA).toEqual(s0.poolA);
    expect(r2.state.poolB).toEqual(s0.poolB);
  });
});

// ── Test helpers for sequencing past T7's defender step ───────────────────────

function advanceToAttackers(seed = 0xdead, aDef: ArmyId = 'a3', bDef: ArmyId = 'b5'): PairingState {
  const s0 = init(seed);
  const r1 = applyAction(s0, { type: 'LOCK_IN_DEFENDER', team: 'A', armyId: aDef });
  if (!r1.ok) throw new Error(`A defender lock failed: ${JSON.stringify(r1.error)}`);
  const r2 = applyAction(r1.state, { type: 'LOCK_IN_DEFENDER', team: 'B', armyId: bDef });
  if (!r2.ok) throw new Error(`B defender lock failed: ${JSON.stringify(r2.error)}`);
  return r2.state;
}

function advanceToRefusals(
  seed = 0xdead,
  aDef: ArmyId = 'a0',
  bDef: ArmyId = 'b0',
  aAtk: readonly [ArmyId, ArmyId] = ['a1', 'a2'],
  bAtk: readonly [ArmyId, ArmyId] = ['b1', 'b2'],
): PairingState {
  const s = advanceToAttackers(seed, aDef, bDef);
  const r1 = applyAction(s, { type: 'LOCK_IN_ATTACKERS', team: 'A', armyIds: aAtk });
  if (!r1.ok) throw new Error(`A attackers lock failed: ${JSON.stringify(r1.error)}`);
  const r2 = applyAction(r1.state, { type: 'LOCK_IN_ATTACKERS', team: 'B', armyIds: bAtk });
  if (!r2.ok) throw new Error(`B attackers lock failed: ${JSON.stringify(r2.error)}`);
  return r2.state;
}

// ── LOCK_IN_ATTACKERS (ROUND_1.AWAITING_ATTACKERS) ────────────────────────────

describe('state.applyAction LOCK_IN_ATTACKERS (ROUND_1.AWAITING_ATTACKERS)', () => {
  it('first lock-in by A: pendingA set, phase unchanged, no event', () => {
    const s = advanceToAttackers();
    const r = applyAction(s, { type: 'LOCK_IN_ATTACKERS', team: 'A', armyIds: ['a1', 'a2'] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.phase).toBe('ROUND_1.AWAITING_ATTACKERS');
    expect(r.state.step.attackers?.pendingA).toEqual(['a1', 'a2']);
    expect(r.state.step.attackers?.pendingB).toBeUndefined();
    expect(r.events).toEqual([]);
  });

  it('second lock-in collapses to revealed, advances to AWAITING_REFUSALS, emits AttackersRevealed', () => {
    const s = advanceToAttackers(0xdead, 'a3', 'b5');
    const r1 = applyAction(s, { type: 'LOCK_IN_ATTACKERS', team: 'A', armyIds: ['a0', 'a1'] });
    if (!r1.ok) throw new Error('first should succeed');
    const r2 = applyAction(r1.state, { type: 'LOCK_IN_ATTACKERS', team: 'B', armyIds: ['b0', 'b1'] });
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect(r2.state.phase).toBe('ROUND_1.AWAITING_REFUSALS');
    expect(r2.state.step.attackers?.revealed).toEqual({
      a: ['a0', 'a1'],
      b: ['b0', 'b1'],
    });
    expect(r2.events).toEqual([
      {
        type: 'AttackersRevealed',
        round: 1,
        aAttackers: ['a0', 'a1'],
        bAttackers: ['b0', 'b1'],
      },
    ]);
    expect(r2.state.log).toContainEqual({
      type: 'AttackersRevealed',
      round: 1,
      aAttackers: ['a0', 'a1'],
      bAttackers: ['b0', 'b1'],
    });
  });

  it('order symmetry: B locks first, then A produces the same revealed slot', () => {
    const s = advanceToAttackers(0xdead, 'a0', 'b0');
    const r1 = applyAction(s, { type: 'LOCK_IN_ATTACKERS', team: 'B', armyIds: ['b1', 'b2'] });
    if (!r1.ok) throw new Error('first should succeed');
    const r2 = applyAction(r1.state, { type: 'LOCK_IN_ATTACKERS', team: 'A', armyIds: ['a1', 'a2'] });
    if (!r2.ok) throw new Error('second should succeed');
    expect(r2.state.step.attackers?.revealed).toEqual({ a: ['a1', 'a2'], b: ['b1', 'b2'] });
  });

  it('after reveal: pendingA / pendingB are structurally absent', () => {
    const s = advanceToAttackers();
    const r1 = applyAction(s, { type: 'LOCK_IN_ATTACKERS', team: 'A', armyIds: ['a0', 'a1'] });
    if (!r1.ok) throw new Error('first should succeed');
    const r2 = applyAction(r1.state, { type: 'LOCK_IN_ATTACKERS', team: 'B', armyIds: ['b0', 'b1'] });
    if (!r2.ok) throw new Error('second should succeed');
    const slot = r2.state.step.attackers!;
    expect('pendingA' in slot).toBe(false);
    expect('pendingB' in slot).toBe(false);
    expect('revealed' in slot).toBe(true);
  });

  it('InvalidPayload when armyIds[0] === armyIds[1]', () => {
    const s = advanceToAttackers();
    const r = applyAction(s, { type: 'LOCK_IN_ATTACKERS', team: 'A', armyIds: ['a1', 'a1'] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('InvalidPayload');
  });

  it('PoolViolation when an armyId is not in own pool', () => {
    const s = advanceToAttackers();
    const r = applyAction(s, { type: 'LOCK_IN_ATTACKERS', team: 'A', armyIds: ['a1', 'b0'] });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe('PoolViolation');
      if (r.error.kind === 'PoolViolation') expect(r.error.armyId).toBe('b0');
    }
  });

  it('InvalidPayload when an attacker equals own defender', () => {
    const s = advanceToAttackers(0xdead, 'a3', 'b5');
    // A's defender is a3; A picking a3 as attacker is illegal.
    const r = applyAction(s, { type: 'LOCK_IN_ATTACKERS', team: 'A', armyIds: ['a3', 'a4'] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('InvalidPayload');
  });

  it('B picking own defender as attacker is also rejected', () => {
    const s = advanceToAttackers(0xdead, 'a3', 'b5');
    const r = applyAction(s, { type: 'LOCK_IN_ATTACKERS', team: 'B', armyIds: ['b1', 'b5'] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('InvalidPayload');
  });

  it('DuplicatePending when same team locks attackers twice', () => {
    const s = advanceToAttackers();
    const r1 = applyAction(s, { type: 'LOCK_IN_ATTACKERS', team: 'A', armyIds: ['a0', 'a1'] });
    if (!r1.ok) throw new Error('first should succeed');
    const r2 = applyAction(r1.state, { type: 'LOCK_IN_ATTACKERS', team: 'A', armyIds: ['a4', 'a5'] });
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.error.kind).toBe('DuplicatePending');
  });

  it('state unchanged on any error path', () => {
    const s = advanceToAttackers();
    const snap = JSON.parse(JSON.stringify(s));
    applyAction(s, { type: 'LOCK_IN_ATTACKERS', team: 'A', armyIds: ['a3', 'a3'] });
    applyAction(s, { type: 'LOCK_IN_ATTACKERS', team: 'A', armyIds: ['a1', 'b0'] });
    applyAction(s, { type: 'LOCK_IN_ATTACKERS', team: 'A', armyIds: ['a3', 'a4'] }); // a3 is own defender
    expect(JSON.parse(JSON.stringify(s))).toEqual(snap);
  });

  it('information hiding: viewFor(B) does not see A\'s pending attackers', () => {
    const s = advanceToAttackers();
    const r = applyAction(s, { type: 'LOCK_IN_ATTACKERS', team: 'A', armyIds: ['a1', 'a2'] });
    if (!r.ok) throw new Error('lock should succeed');
    const view = viewFor(r.state, 'B');
    expect('pendingA' in (view.step.attackers ?? {})).toBe(false);
  });

  it('JSON round-trip preserved at every step', () => {
    const s = advanceToAttackers();
    const r1 = applyAction(s, { type: 'LOCK_IN_ATTACKERS', team: 'A', armyIds: ['a0', 'a1'] });
    if (!r1.ok) throw new Error('first should succeed');
    expect(JSON.parse(JSON.stringify(r1.state))).toEqual(r1.state);
    const r2 = applyAction(r1.state, { type: 'LOCK_IN_ATTACKERS', team: 'B', armyIds: ['b0', 'b1'] });
    if (!r2.ok) throw new Error('second should succeed');
    expect(JSON.parse(JSON.stringify(r2.state))).toEqual(r2.state);
  });

  it('non-LOCK_IN_ATTACKERS actions are still IllegalAction in this phase', () => {
    const s = advanceToAttackers();
    const r = applyAction(s, { type: 'LOCK_IN_DEFENDER', team: 'A', armyId: 'a4' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('IllegalAction');
  });

  it('pools unchanged through both attacker lock-ins', () => {
    const s0 = advanceToAttackers();
    const r1 = applyAction(s0, { type: 'LOCK_IN_ATTACKERS', team: 'A', armyIds: ['a1', 'a2'] });
    if (!r1.ok) throw new Error('first should succeed');
    const r2 = applyAction(r1.state, { type: 'LOCK_IN_ATTACKERS', team: 'B', armyIds: ['b1', 'b2'] });
    if (!r2.ok) throw new Error('second should succeed');
    expect(r2.state.poolA).toEqual(s0.poolA);
    expect(r2.state.poolB).toEqual(s0.poolB);
  });
});

// ── LOCK_IN_REFUSAL (ROUND_1.AWAITING_REFUSALS) ───────────────────────────────

describe('state.applyAction LOCK_IN_REFUSAL (ROUND_1.AWAITING_REFUSALS)', () => {
  it('first lock-in by A (refusing one of B\'s attackers): pendingA set, phase unchanged', () => {
    const s = advanceToRefusals();
    // B's attackers are b1, b2 → A refuses one of them.
    const r = applyAction(s, { type: 'LOCK_IN_REFUSAL', team: 'A', armyId: 'b1' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.phase).toBe('ROUND_1.AWAITING_REFUSALS');
    expect(r.state.step.refusals?.pendingA).toBe('b1');
    expect(r.events).toEqual([]);
  });

  it('second lock-in collapses: phase advances to AWAITING_TABLES, emits RefusalsRevealed', () => {
    const s = advanceToRefusals(0xdead, 'a3', 'b5', ['a1', 'a2'], ['b1', 'b2']);
    const r1 = applyAction(s, { type: 'LOCK_IN_REFUSAL', team: 'A', armyId: 'b1' });
    if (!r1.ok) throw new Error('A refusal failed');
    const r2 = applyAction(r1.state, { type: 'LOCK_IN_REFUSAL', team: 'B', armyId: 'a2' });
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect(r2.state.phase).toBe('ROUND_1.AWAITING_TABLES');
    expect(r2.events).toEqual([
      { type: 'RefusalsRevealed', round: 1, aRefused: 'b1', bRefused: 'a2' },
    ]);
    expect(r2.state.step.refusals?.revealed).toEqual({ a: 'b1', b: 'a2' });
  });

  it('on collapse: 2 pairings added with correct defenderTeam', () => {
    // aDef='a3', bDef='b5', aAtk=[a1,a2], bAtk=[b1,b2]; A refuses b1, B refuses a2.
    // Surviving A attacker = a1 (a2 refused). Surviving B attacker = b2 (b1 refused).
    // Pairings: A def vs B surv → a3 vs b2 (defenderTeam A); B def vs A surv → a1 vs b5 (defenderTeam B).
    const s = advanceToRefusals(0xdead, 'a3', 'b5', ['a1', 'a2'], ['b1', 'b2']);
    const r1 = applyAction(s, { type: 'LOCK_IN_REFUSAL', team: 'A', armyId: 'b1' });
    if (!r1.ok) throw new Error('A refusal failed');
    const r2 = applyAction(r1.state, { type: 'LOCK_IN_REFUSAL', team: 'B', armyId: 'a2' });
    if (!r2.ok) throw new Error('B refusal failed');
    expect(r2.state.pairings).toHaveLength(2);
    expect(r2.state.pairings[0]).toEqual({
      round: 1, aArmy: 'a3', bArmy: 'b2', defenderTeam: 'A',
    });
    expect(r2.state.pairings[1]).toEqual({
      round: 1, aArmy: 'a1', bArmy: 'b5', defenderTeam: 'B',
    });
  });

  it('on collapse: pools shrink by 2 each (defender + surviving attacker removed; refused stay)', () => {
    const s = advanceToRefusals(0xdead, 'a3', 'b5', ['a1', 'a2'], ['b1', 'b2']);
    const r1 = applyAction(s, { type: 'LOCK_IN_REFUSAL', team: 'A', armyId: 'b1' });
    if (!r1.ok) throw new Error('A refusal failed');
    const r2 = applyAction(r1.state, { type: 'LOCK_IN_REFUSAL', team: 'B', armyId: 'a2' });
    if (!r2.ok) throw new Error('B refusal failed');
    // poolA loses a3 (def) and a1 (surviving att); a2 (refused) stays.
    expect(r2.state.poolA).toEqual(['a0', 'a2', 'a4', 'a5', 'a6', 'a7']);
    // poolB loses b5 (def) and b2 (surviving att); b1 (refused) stays.
    expect(r2.state.poolB).toEqual(['b0', 'b1', 'b3', 'b4', 'b6', 'b7']);
  });

  it('InvalidPayload when refusal not in opposing team\'s attackers', () => {
    const s = advanceToRefusals(0xdead, 'a0', 'b0', ['a1', 'a2'], ['b1', 'b2']);
    // A must refuse one of B's attackers (b1 or b2). 'a1' is not.
    const r = applyAction(s, { type: 'LOCK_IN_REFUSAL', team: 'A', armyId: 'a1' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('InvalidPayload');
  });

  it('B refusing one of B\'s own attackers (not A\'s) is also rejected', () => {
    const s = advanceToRefusals(0xdead, 'a0', 'b0', ['a1', 'a2'], ['b1', 'b2']);
    const r = applyAction(s, { type: 'LOCK_IN_REFUSAL', team: 'B', armyId: 'b1' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('InvalidPayload');
  });

  it('DuplicatePending when same team refuses twice', () => {
    const s = advanceToRefusals();
    const r1 = applyAction(s, { type: 'LOCK_IN_REFUSAL', team: 'A', armyId: 'b1' });
    if (!r1.ok) throw new Error('first should succeed');
    const r2 = applyAction(r1.state, { type: 'LOCK_IN_REFUSAL', team: 'A', armyId: 'b2' });
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.error.kind).toBe('DuplicatePending');
  });

  it('state unchanged on any error path', () => {
    const s = advanceToRefusals();
    const snap = JSON.parse(JSON.stringify(s));
    applyAction(s, { type: 'LOCK_IN_REFUSAL', team: 'A', armyId: 'a1' }); // not in B's atks
    applyAction(s, { type: 'LOCK_IN_REFUSAL', team: 'B', armyId: 'b1' }); // not in A's atks
    expect(JSON.parse(JSON.stringify(s))).toEqual(snap);
  });

  it('information hiding: viewFor(B) does not see A\'s pending refusal', () => {
    const s = advanceToRefusals();
    const r = applyAction(s, { type: 'LOCK_IN_REFUSAL', team: 'A', armyId: 'b1' });
    if (!r.ok) throw new Error('lock should succeed');
    const view = viewFor(r.state, 'B');
    expect('pendingA' in (view.step.refusals ?? {})).toBe(false);
  });

  it('JSON round-trip preserved at every step', () => {
    const s = advanceToRefusals();
    const r1 = applyAction(s, { type: 'LOCK_IN_REFUSAL', team: 'A', armyId: 'b1' });
    if (!r1.ok) throw new Error('first should succeed');
    expect(JSON.parse(JSON.stringify(r1.state))).toEqual(r1.state);
    const r2 = applyAction(r1.state, { type: 'LOCK_IN_REFUSAL', team: 'B', armyId: 'a1' });
    if (!r2.ok) throw new Error('second should succeed');
    expect(JSON.parse(JSON.stringify(r2.state))).toEqual(r2.state);
  });

  it('non-LOCK_IN_REFUSAL actions in AWAITING_REFUSALS are IllegalAction', () => {
    const s = advanceToRefusals();
    const r = applyAction(s, { type: 'LOCK_IN_DEFENDER', team: 'A', armyId: 'a4' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('IllegalAction');
  });
});

// ── Dispatcher default-illegal coverage for not-yet-implemented phases ────────

describe('state.applyAction default-illegal for unhandled phases', () => {
  const unhandledPhases: readonly Phase[] = [
    'INIT',
    'ROUND_1_COMPLETE',
    'ROUND_2_COMPLETE',
    'SCRUM.AUTO_LAST_MAN',
    'SCRUM.AUTO_REFUSED_PAIR',
  ];

  it.each(unhandledPhases)('rejects any action in %s', (phase) => {
    const s: PairingState = { ...init(), phase };
    const r = applyAction(s, { type: 'LOCK_IN_TABLE', team: 'A', tableId: 1 });
    expect(r.ok).toBe(false);
    if (!r.ok && r.error.kind === 'IllegalAction') {
      expect(r.error.phase).toBe(phase);
    }
  });
});

// ── Test helpers for sequencing past T8's refusal collapse ────────────────────

function advanceToTables(seed = 0xdead): PairingState {
  // After this: phase = ROUND_1.AWAITING_TABLES, tokenHolder = null,
  // 2 pairings (defenderTeam='A' and 'B'), tableIds undefined, pools at 6.
  const s = advanceToRefusals(seed, 'a3', 'b5', ['a1', 'a2'], ['b1', 'b2']);
  const r1 = applyAction(s, { type: 'LOCK_IN_REFUSAL', team: 'A', armyId: 'b1' });
  if (!r1.ok) throw new Error(`A refusal failed: ${JSON.stringify(r1.error)}`);
  const r2 = applyAction(r1.state, { type: 'LOCK_IN_REFUSAL', team: 'B', armyId: 'a2' });
  if (!r2.ok) throw new Error(`B refusal failed: ${JSON.stringify(r2.error)}`);
  return r2.state;
}

function advanceToTokenResolved(seed = 0xdead): PairingState {
  const s = advanceToTables(seed);
  const { winner } = rollInitialToken(s);
  const r = applyAction(s, { type: 'RESOLVE_INITIAL_TOKEN', winner });
  if (!r.ok) throw new Error(`token resolve failed: ${JSON.stringify(r.error)}`);
  return r.state;
}

const otherTeam = (t: Team): Team => (t === 'A' ? 'B' : 'A');

// ── rollInitialToken ──────────────────────────────────────────────────────────

describe('state.rollInitialToken', () => {
  it('returns a Team and an advanced RngState', () => {
    const s = advanceToTables(42);
    const r = rollInitialToken(s);
    expect(r.winner === 'A' || r.winner === 'B').toBe(true);
    expect(r.rng).not.toEqual(s.rng);
  });

  it('is deterministic for a fixed seed', () => {
    const s = advanceToTables(0xcafe);
    expect(rollInitialToken(s)).toEqual(rollInitialToken(s));
  });

  it('does not mutate the input state', () => {
    const s = advanceToTables(0xcafe);
    const snap = JSON.parse(JSON.stringify(s));
    rollInitialToken(s);
    expect(JSON.parse(JSON.stringify(s))).toEqual(snap);
  });
});

// ── RESOLVE_INITIAL_TOKEN ─────────────────────────────────────────────────────

describe('state.applyAction RESOLVE_INITIAL_TOKEN', () => {
  it('sets tokenHolder, advances RNG, emits TokenRollOff', () => {
    const s = advanceToTables(42);
    const { winner, rng: expectedRng } = rollInitialToken(s);
    const r = applyAction(s, { type: 'RESOLVE_INITIAL_TOKEN', winner });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.tokenHolder).toBe(winner);
    expect(r.state.rng).toEqual(expectedRng);
    expect(r.state.log).toContainEqual({ type: 'TokenRollOff', winner });
    expect(r.events).toEqual([{ type: 'TokenRollOff', winner }]);
    expect(r.state.phase).toBe('ROUND_1.AWAITING_TABLES');
  });

  it('IllegalAction when tokenHolder already resolved', () => {
    const s = advanceToTokenResolved();
    const r = applyAction(s, { type: 'RESOLVE_INITIAL_TOKEN', winner: 'A' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('IllegalAction');
  });

  it('IllegalAction when dispatched in a non-AWAITING_TABLES phase', () => {
    const s = init();
    const r = applyAction(s, { type: 'RESOLVE_INITIAL_TOKEN', winner: 'A' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('IllegalAction');
  });

  it('state unchanged on IllegalAction (already-resolved)', () => {
    const s = advanceToTokenResolved();
    const snap = JSON.parse(JSON.stringify(s));
    applyAction(s, { type: 'RESOLVE_INITIAL_TOKEN', winner: 'A' });
    expect(JSON.parse(JSON.stringify(s))).toEqual(snap);
  });

  it('JSON round-trip preserved', () => {
    const s = advanceToTokenResolved(42);
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  });
});

// ── LOCK_IN_TABLE ─────────────────────────────────────────────────────────────

describe('state.applyAction LOCK_IN_TABLE (ROUND_1.AWAITING_TABLES)', () => {
  it('OutOfTurn when tokenHolder has not been resolved yet', () => {
    const s = advanceToTables();
    const r = applyAction(s, { type: 'LOCK_IN_TABLE', team: 'A', tableId: 1 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('OutOfTurn');
  });

  it('OutOfTurn when the non-token-holder picks first', () => {
    const s = advanceToTokenResolved();
    const wrong = otherTeam(s.tokenHolder!);
    const r = applyAction(s, { type: 'LOCK_IN_TABLE', team: wrong, tableId: 1 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('OutOfTurn');
  });

  it('happy path: token holder picks first → assigns tableId, emits TableChosen with defenderArmy', () => {
    const s = advanceToTokenResolved();
    const holder = s.tokenHolder!;
    const r = applyAction(s, { type: 'LOCK_IN_TABLE', team: holder, tableId: 3 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const updated = r.state.pairings.find(p => p.defenderTeam === holder)!;
    expect(updated.tableId).toBe(3);
    expect(updated.tableScoreModifier).toBe(0);
    const expectedDefender = holder === 'A' ? updated.aArmy : updated.bArmy;
    expect(r.events).toEqual([
      { type: 'TableChosen', round: 1, team: holder, tableId: 3, defenderArmy: expectedDefender },
    ]);
    expect(r.state.phase).toBe('ROUND_1.AWAITING_TABLES');
  });

  it('after token holder picks: other team can pick next', () => {
    const s = advanceToTokenResolved();
    const holder = s.tokenHolder!;
    const r1 = applyAction(s, { type: 'LOCK_IN_TABLE', team: holder, tableId: 3 });
    if (!r1.ok) throw new Error('first pick failed');
    const r2 = applyAction(r1.state, { type: 'LOCK_IN_TABLE', team: otherTeam(holder), tableId: 5 });
    expect(r2.ok).toBe(true);
  });

  it('InvalidPayload when tableId is out of range (< 1 or > 8)', () => {
    const s = advanceToTokenResolved();
    const holder = s.tokenHolder!;
    for (const bad of [0, -1, 9, 99]) {
      const r = applyAction(s, { type: 'LOCK_IN_TABLE', team: holder, tableId: bad });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.kind).toBe('InvalidPayload');
    }
  });

  it('InvalidPayload when tableId is already assigned in this game', () => {
    const s = advanceToTokenResolved();
    const holder = s.tokenHolder!;
    const r1 = applyAction(s, { type: 'LOCK_IN_TABLE', team: holder, tableId: 4 });
    if (!r1.ok) throw new Error('first pick failed');
    const r2 = applyAction(r1.state, { type: 'LOCK_IN_TABLE', team: otherTeam(holder), tableId: 4 });
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.error.kind).toBe('InvalidPayload');
  });

  it('state unchanged on any error path', () => {
    const s = advanceToTokenResolved();
    const wrong = otherTeam(s.tokenHolder!);
    const snap = JSON.parse(JSON.stringify(s));
    applyAction(s, { type: 'LOCK_IN_TABLE', team: wrong, tableId: 1 });
    applyAction(s, { type: 'LOCK_IN_TABLE', team: s.tokenHolder!, tableId: 0 });
    applyAction(s, { type: 'LOCK_IN_TABLE', team: s.tokenHolder!, tableId: 9 });
    expect(JSON.parse(JSON.stringify(s))).toEqual(snap);
  });

  it('non-table actions in this phase are IllegalAction', () => {
    const s = advanceToTokenResolved();
    const r = applyAction(s, { type: 'LOCK_IN_DEFENDER', team: 'A', armyId: 'a4' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('IllegalAction');
  });

  it('JSON round-trip preserved at every step', () => {
    const s = advanceToTokenResolved();
    const holder = s.tokenHolder!;
    const r1 = applyAction(s, { type: 'LOCK_IN_TABLE', team: holder, tableId: 2 });
    if (!r1.ok) throw new Error('first pick failed');
    expect(JSON.parse(JSON.stringify(r1.state))).toEqual(r1.state);
  });
});

// ── End-of-round auto-advance ─────────────────────────────────────────────────

describe('state.applyAction LOCK_IN_TABLE (R1 → R2 auto-advance)', () => {
  it('on second LOCK_IN_TABLE: phase advances to ROUND_2.AWAITING_DEFENDERS', () => {
    const s = advanceToTokenResolved();
    const holder = s.tokenHolder!;
    const r1 = applyAction(s, { type: 'LOCK_IN_TABLE', team: holder, tableId: 1 });
    if (!r1.ok) throw new Error('first pick failed');
    const r2 = applyAction(r1.state, { type: 'LOCK_IN_TABLE', team: otherTeam(holder), tableId: 2 });
    if (!r2.ok) throw new Error('second pick failed');
    expect(r2.state.phase).toBe('ROUND_2.AWAITING_DEFENDERS');
  });

  it('flips tokenHolder and emits TokenFlipped exactly once', () => {
    const s = advanceToTokenResolved();
    const holder = s.tokenHolder!;
    const r1 = applyAction(s, { type: 'LOCK_IN_TABLE', team: holder, tableId: 1 });
    if (!r1.ok) throw new Error('first pick failed');
    const r2 = applyAction(r1.state, { type: 'LOCK_IN_TABLE', team: otherTeam(holder), tableId: 2 });
    if (!r2.ok) throw new Error('second pick failed');
    expect(r2.state.tokenHolder).toBe(otherTeam(holder));
    const flips = r2.state.log.filter(e => e.type === 'TokenFlipped');
    expect(flips).toHaveLength(1);
    expect(flips[0]).toEqual({
      type: 'TokenFlipped',
      newHolder: otherTeam(holder),
      reason: 'round-end',
    });
  });

  it('events delta from the auto-advance dispatch contains TableChosen + TokenFlipped', () => {
    const s = advanceToTokenResolved();
    const holder = s.tokenHolder!;
    const r1 = applyAction(s, { type: 'LOCK_IN_TABLE', team: holder, tableId: 1 });
    if (!r1.ok) throw new Error('first pick failed');
    const r2 = applyAction(r1.state, { type: 'LOCK_IN_TABLE', team: otherTeam(holder), tableId: 2 });
    if (!r2.ok) throw new Error('second pick failed');
    const types = r2.events.map((e: LogEntry) => e.type);
    expect(types).toEqual(['TableChosen', 'TokenFlipped']);
  });

  it('resets step on auto-advance and preserves pairings + pools', () => {
    const s = advanceToTokenResolved();
    const holder = s.tokenHolder!;
    const r1 = applyAction(s, { type: 'LOCK_IN_TABLE', team: holder, tableId: 1 });
    if (!r1.ok) throw new Error('first pick failed');
    const r2 = applyAction(r1.state, { type: 'LOCK_IN_TABLE', team: otherTeam(holder), tableId: 2 });
    if (!r2.ok) throw new Error('second pick failed');
    expect(r2.state.step).toEqual({});
    expect(r2.state.pairings).toHaveLength(2);
    expect(r2.state.pairings.every(p => p.tableId !== undefined)).toBe(true);
    expect(r2.state.poolA).toHaveLength(6);
    expect(r2.state.poolB).toHaveLength(6);
  });

  it('JSON round-trip preserved through auto-advance', () => {
    const s = advanceToTokenResolved(0xfeed);
    const holder = s.tokenHolder!;
    const r1 = applyAction(s, { type: 'LOCK_IN_TABLE', team: holder, tableId: 7 });
    if (!r1.ok) throw new Error('first pick failed');
    const r2 = applyAction(r1.state, { type: 'LOCK_IN_TABLE', team: otherTeam(holder), tableId: 8 });
    if (!r2.ok) throw new Error('second pick failed');
    expect(JSON.parse(JSON.stringify(r2.state))).toEqual(r2.state);
  });
});

// ── Round 2 sequencing helpers ────────────────────────────────────────────────

function dispatch(state: PairingState, action: Action): PairingState {
  const r = applyAction(state, action);
  if (!r.ok) {
    throw new Error(`unexpected error: ${JSON.stringify(r.error)} for ${JSON.stringify(action)}`);
  }
  return r.state;
}

// Drives R1 through to ROUND_2.AWAITING_DEFENDERS using fixed picks.
// Returns the post-R1 state and the R1 token holder (depends on seed).
function advanceToRound2Defenders(seed = 0xdead): {
  state: PairingState;
  r1Holder: Team;
} {
  let s = init(seed);
  s = dispatch(s, { type: 'LOCK_IN_DEFENDER', team: 'A', armyId: 'a3' });
  s = dispatch(s, { type: 'LOCK_IN_DEFENDER', team: 'B', armyId: 'b5' });
  s = dispatch(s, { type: 'LOCK_IN_ATTACKERS', team: 'A', armyIds: ['a1', 'a2'] });
  s = dispatch(s, { type: 'LOCK_IN_ATTACKERS', team: 'B', armyIds: ['b1', 'b2'] });
  s = dispatch(s, { type: 'LOCK_IN_REFUSAL', team: 'A', armyId: 'b1' });
  s = dispatch(s, { type: 'LOCK_IN_REFUSAL', team: 'B', armyId: 'a2' });
  const { winner } = rollInitialToken(s);
  s = dispatch(s, { type: 'RESOLVE_INITIAL_TOKEN', winner });
  s = dispatch(s, { type: 'LOCK_IN_TABLE', team: winner, tableId: 1 });
  s = dispatch(s, { type: 'LOCK_IN_TABLE', team: otherTeam(winner), tableId: 2 });
  return { state: s, r1Holder: winner };
}

// ── ROUND_2.* per-phase sanity ────────────────────────────────────────────────

describe('state.applyAction Round 2 — per-phase happy paths', () => {
  it('starts R2 with phase=ROUND_2.AWAITING_DEFENDERS, empty step, pools at 6', () => {
    const { state } = advanceToRound2Defenders();
    expect(state.phase).toBe('ROUND_2.AWAITING_DEFENDERS');
    expect(state.step).toEqual({});
    expect(state.poolA).toHaveLength(6);
    expect(state.poolB).toHaveLength(6);
    expect(state.pairings).toHaveLength(2);
    expect(state.pairings.every(p => p.tableId !== undefined)).toBe(true);
  });

  it('R2 LOCK_IN_DEFENDER: collapse advances to ROUND_2.AWAITING_ATTACKERS, log adds DefendersRevealed (round 2)', () => {
    const { state } = advanceToRound2Defenders();
    let s = dispatch(state, { type: 'LOCK_IN_DEFENDER', team: 'A', armyId: 'a4' });
    s = dispatch(s, { type: 'LOCK_IN_DEFENDER', team: 'B', armyId: 'b6' });
    expect(s.phase).toBe('ROUND_2.AWAITING_ATTACKERS');
    expect(s.step.defenders?.revealed).toEqual({ a: 'a4', b: 'b6' });
    expect(s.log[s.log.length - 1]).toEqual({
      type: 'DefendersRevealed', round: 2, aArmy: 'a4', bArmy: 'b6',
    });
  });

  it('R2 LOCK_IN_DEFENDER PoolViolation when picking an army removed in R1', () => {
    const { state } = advanceToRound2Defenders();
    // a3 was R1's defender → out of pool. a1 was R1's surviving attacker → out.
    // a2 was R1's refused attacker → still in pool (eligible).
    expect(state.poolA).not.toContain('a3');
    expect(state.poolA).not.toContain('a1');
    expect(state.poolA).toContain('a2');
    const r = applyAction(state, { type: 'LOCK_IN_DEFENDER', team: 'A', armyId: 'a3' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('PoolViolation');
  });

  it('R2 LOCK_IN_ATTACKERS: helpers accept R2 pool & defender; collapse advances phase', () => {
    const { state } = advanceToRound2Defenders();
    let s = dispatch(state, { type: 'LOCK_IN_DEFENDER', team: 'A', armyId: 'a4' });
    s = dispatch(s, { type: 'LOCK_IN_DEFENDER', team: 'B', armyId: 'b6' });
    s = dispatch(s, { type: 'LOCK_IN_ATTACKERS', team: 'A', armyIds: ['a0', 'a5'] });
    s = dispatch(s, { type: 'LOCK_IN_ATTACKERS', team: 'B', armyIds: ['b0', 'b3'] });
    expect(s.phase).toBe('ROUND_2.AWAITING_REFUSALS');
    expect(s.step.attackers?.revealed).toEqual({
      a: ['a0', 'a5'],
      b: ['b0', 'b3'],
    });
  });

  it('R2 LOCK_IN_REFUSAL: collapse adds R2 pairings (defenderTeam set), shrinks pools to 4', () => {
    const { state } = advanceToRound2Defenders();
    let s = dispatch(state, { type: 'LOCK_IN_DEFENDER', team: 'A', armyId: 'a4' });
    s = dispatch(s, { type: 'LOCK_IN_DEFENDER', team: 'B', armyId: 'b6' });
    s = dispatch(s, { type: 'LOCK_IN_ATTACKERS', team: 'A', armyIds: ['a0', 'a5'] });
    s = dispatch(s, { type: 'LOCK_IN_ATTACKERS', team: 'B', armyIds: ['b0', 'b3'] });
    s = dispatch(s, { type: 'LOCK_IN_REFUSAL', team: 'A', armyId: 'b0' });
    s = dispatch(s, { type: 'LOCK_IN_REFUSAL', team: 'B', armyId: 'a5' });
    expect(s.phase).toBe('ROUND_2.AWAITING_TABLES');
    expect(s.pairings).toHaveLength(4);
    // R2 pairings: A def vs B surv = a4 vs b3; B def vs A surv = a0 vs b6.
    expect(s.pairings[2]).toEqual({ round: 2, aArmy: 'a4', bArmy: 'b3', defenderTeam: 'A' });
    expect(s.pairings[3]).toEqual({ round: 2, aArmy: 'a0', bArmy: 'b6', defenderTeam: 'B' });
    expect(s.poolA).toHaveLength(4);
    expect(s.poolB).toHaveLength(4);
    // R1 refused (a2, b1) and R2 refused (a5, b0) all stay in pool.
    expect(s.poolA).toContain('a2');
    expect(s.poolA).toContain('a5');
    expect(s.poolB).toContain('b1');
    expect(s.poolB).toContain('b0');
  });

  it('R2 LOCK_IN_TABLE: token-holder-first uses CURRENT (post-R1-flip) tokenHolder; no RESOLVE_INITIAL_TOKEN needed', () => {
    const { state, r1Holder } = advanceToRound2Defenders();
    let s = state;
    expect(s.tokenHolder).toBe(otherTeam(r1Holder)); // flipped

    s = dispatch(s, { type: 'LOCK_IN_DEFENDER', team: 'A', armyId: 'a4' });
    s = dispatch(s, { type: 'LOCK_IN_DEFENDER', team: 'B', armyId: 'b6' });
    s = dispatch(s, { type: 'LOCK_IN_ATTACKERS', team: 'A', armyIds: ['a0', 'a5'] });
    s = dispatch(s, { type: 'LOCK_IN_ATTACKERS', team: 'B', armyIds: ['b0', 'b3'] });
    s = dispatch(s, { type: 'LOCK_IN_REFUSAL', team: 'A', armyId: 'b0' });
    s = dispatch(s, { type: 'LOCK_IN_REFUSAL', team: 'B', armyId: 'a5' });

    // Out-of-turn: the non-holder tries to pick first.
    const r2Holder = s.tokenHolder!;
    const wrong = applyAction(s, { type: 'LOCK_IN_TABLE', team: otherTeam(r2Holder), tableId: 3 });
    expect(wrong.ok).toBe(false);
    if (!wrong.ok) expect(wrong.error.kind).toBe('OutOfTurn');

    // Holder picks first.
    s = dispatch(s, { type: 'LOCK_IN_TABLE', team: r2Holder, tableId: 3 });
    expect(s.phase).toBe('ROUND_2.AWAITING_TABLES');
  });

  it('RESOLVE_INITIAL_TOKEN is IllegalAction throughout R2 (already resolved in R1)', () => {
    const { state } = advanceToRound2Defenders();
    const r = applyAction(state, { type: 'RESOLVE_INITIAL_TOKEN', winner: 'A' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('IllegalAction');
  });

  it('non-matching actions at each R2 phase return IllegalAction', () => {
    const { state: s0 } = advanceToRound2Defenders();
    // R2.AWAITING_ATTACKERS: LOCK_IN_DEFENDER is illegal here
    let s = dispatch(s0, { type: 'LOCK_IN_DEFENDER', team: 'A', armyId: 'a4' });
    s = dispatch(s, { type: 'LOCK_IN_DEFENDER', team: 'B', armyId: 'b6' });
    let r = applyAction(s, { type: 'LOCK_IN_DEFENDER', team: 'A', armyId: 'a5' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('IllegalAction');

    // R2.AWAITING_REFUSALS: LOCK_IN_ATTACKERS is illegal here
    s = dispatch(s, { type: 'LOCK_IN_ATTACKERS', team: 'A', armyIds: ['a0', 'a5'] });
    s = dispatch(s, { type: 'LOCK_IN_ATTACKERS', team: 'B', armyIds: ['b0', 'b3'] });
    r = applyAction(s, { type: 'LOCK_IN_ATTACKERS', team: 'A', armyIds: ['a0', 'a2'] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('IllegalAction');

    // R2.AWAITING_TABLES: LOCK_IN_REFUSAL is illegal here
    s = dispatch(s, { type: 'LOCK_IN_REFUSAL', team: 'A', armyId: 'b0' });
    s = dispatch(s, { type: 'LOCK_IN_REFUSAL', team: 'B', armyId: 'a5' });
    r = applyAction(s, { type: 'LOCK_IN_REFUSAL', team: 'A', armyId: 'b3' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('IllegalAction');
  });
});

// ── End-of-R2 auto-advance ─────────────────────────────────────────────────────

describe('state.applyAction Round 2 — auto-advance to SCRUM.AWAITING_DEFENDERS', () => {
  function playR2ToTablesEnd(seed = 0xdead): { state: PairingState; r1Holder: Team } {
    const { state, r1Holder } = advanceToRound2Defenders(seed);
    let s = state;
    s = dispatch(s, { type: 'LOCK_IN_DEFENDER', team: 'A', armyId: 'a4' });
    s = dispatch(s, { type: 'LOCK_IN_DEFENDER', team: 'B', armyId: 'b6' });
    s = dispatch(s, { type: 'LOCK_IN_ATTACKERS', team: 'A', armyIds: ['a0', 'a5'] });
    s = dispatch(s, { type: 'LOCK_IN_ATTACKERS', team: 'B', armyIds: ['b0', 'b3'] });
    s = dispatch(s, { type: 'LOCK_IN_REFUSAL', team: 'A', armyId: 'b0' });
    s = dispatch(s, { type: 'LOCK_IN_REFUSAL', team: 'B', armyId: 'a5' });
    const r2Holder = s.tokenHolder!;
    s = dispatch(s, { type: 'LOCK_IN_TABLE', team: r2Holder, tableId: 3 });
    s = dispatch(s, { type: 'LOCK_IN_TABLE', team: otherTeam(r2Holder), tableId: 4 });
    return { state: s, r1Holder };
  }

  it('phase advances to SCRUM.AWAITING_DEFENDERS on second R2 LOCK_IN_TABLE', () => {
    const { state } = playR2ToTablesEnd();
    expect(state.phase).toBe('SCRUM.AWAITING_DEFENDERS');
  });

  it('token flips back to original holder (two flips total: R1→R2 and R2→Scrum)', () => {
    const { state, r1Holder } = playR2ToTablesEnd();
    expect(state.tokenHolder).toBe(r1Holder);
    const flips = state.log.filter(e => e.type === 'TokenFlipped');
    expect(flips).toHaveLength(2);
    expect(flips.every(e => e.type === 'TokenFlipped' && e.reason === 'round-end')).toBe(true);
  });

  it('step is reset; pairings count = 4 (all with tableId); pools at 4 each', () => {
    const { state } = playR2ToTablesEnd();
    expect(state.step).toEqual({});
    expect(state.pairings).toHaveLength(4);
    expect(state.pairings.every(p => p.tableId !== undefined)).toBe(true);
    expect(state.poolA).toHaveLength(4);
    expect(state.poolB).toHaveLength(4);
  });

  it('all 4 tableIds are distinct', () => {
    const { state } = playR2ToTablesEnd();
    const ids = state.pairings.map(p => p.tableId);
    expect(new Set(ids).size).toBe(4);
  });

  it('JSON round-trip preserved at game-end-of-R2', () => {
    const { state } = playR2ToTablesEnd();
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
  });
});

// ── Scripted end-to-end log trace ─────────────────────────────────────────────

describe('state.applyAction Round 1 + Round 2 — scripted end-to-end', () => {
  it('produces the full expected log entry counts', () => {
    let s = init(0xdead);

    // R1
    s = dispatch(s, { type: 'LOCK_IN_DEFENDER', team: 'A', armyId: 'a3' });
    s = dispatch(s, { type: 'LOCK_IN_DEFENDER', team: 'B', armyId: 'b5' });
    s = dispatch(s, { type: 'LOCK_IN_ATTACKERS', team: 'A', armyIds: ['a1', 'a2'] });
    s = dispatch(s, { type: 'LOCK_IN_ATTACKERS', team: 'B', armyIds: ['b1', 'b2'] });
    s = dispatch(s, { type: 'LOCK_IN_REFUSAL', team: 'A', armyId: 'b1' });
    s = dispatch(s, { type: 'LOCK_IN_REFUSAL', team: 'B', armyId: 'a2' });
    const { winner } = rollInitialToken(s);
    s = dispatch(s, { type: 'RESOLVE_INITIAL_TOKEN', winner });
    s = dispatch(s, { type: 'LOCK_IN_TABLE', team: winner, tableId: 1 });
    s = dispatch(s, { type: 'LOCK_IN_TABLE', team: otherTeam(winner), tableId: 2 });
    // R2
    s = dispatch(s, { type: 'LOCK_IN_DEFENDER', team: 'A', armyId: 'a4' });
    s = dispatch(s, { type: 'LOCK_IN_DEFENDER', team: 'B', armyId: 'b6' });
    s = dispatch(s, { type: 'LOCK_IN_ATTACKERS', team: 'A', armyIds: ['a0', 'a5'] });
    s = dispatch(s, { type: 'LOCK_IN_ATTACKERS', team: 'B', armyIds: ['b0', 'b3'] });
    s = dispatch(s, { type: 'LOCK_IN_REFUSAL', team: 'A', armyId: 'b0' });
    s = dispatch(s, { type: 'LOCK_IN_REFUSAL', team: 'B', armyId: 'a5' });
    const r2Holder = s.tokenHolder!;
    s = dispatch(s, { type: 'LOCK_IN_TABLE', team: r2Holder, tableId: 3 });
    s = dispatch(s, { type: 'LOCK_IN_TABLE', team: otherTeam(r2Holder), tableId: 4 });

    const counts: Record<string, number> = {};
    for (const e of s.log) counts[e.type] = (counts[e.type] ?? 0) + 1;
    expect(counts).toEqual({
      DefendersRevealed: 2,
      AttackersRevealed: 2,
      RefusalsRevealed: 2,
      TokenRollOff: 1,
      TokenFlipped: 2,
      TableChosen: 4,
    });

    // Per-round pairing breakdown.
    expect(s.pairings.filter(p => p.round === 1)).toHaveLength(2);
    expect(s.pairings.filter(p => p.round === 2)).toHaveLength(2);
    expect(s.phase).toBe('SCRUM.AWAITING_DEFENDERS');
  });
});

// ── Property test extending T8's to R1 + R2 ───────────────────────────────────

describe('state property: information hiding holds through R1 + R2 to SCRUM.AWAITING_DEFENDERS', () => {
  function assertInfoHiding(state: PairingState): void {
    const va = viewFor(state, 'A');
    const vb = viewFor(state, 'B');
    if (va.step.defenders) expect('pendingB' in va.step.defenders).toBe(false);
    if (va.step.attackers) expect('pendingB' in va.step.attackers).toBe(false);
    if (va.step.refusals)  expect('pendingB' in va.step.refusals).toBe(false);
    if (vb.step.defenders) expect('pendingA' in vb.step.defenders).toBe(false);
    if (vb.step.attackers) expect('pendingA' in vb.step.attackers).toBe(false);
    if (vb.step.refusals)  expect('pendingA' in vb.step.refusals).toBe(false);
  }

  function pickFromPool(rng: RngState, pool: readonly ArmyId[]): { state: RngState; value: ArmyId } {
    const r = pick(rng, pool);
    return { state: r.state, value: r.value };
  }

  function pickPair(
    rng: RngState,
    pool: readonly ArmyId[],
    excluding: ArmyId,
  ): { state: RngState; value: readonly [ArmyId, ArmyId] } {
    const eligible = pool.filter(a => a !== excluding);
    const r1 = nextInt(rng, 0, eligible.length - 1);
    const v1 = eligible[r1.value]!;
    const remaining = eligible.filter(a => a !== v1);
    const r2 = nextInt(r1.state, 0, remaining.length - 1);
    const v2 = remaining[r2.value]!;
    return { state: r2.state, value: [v1, v2] };
  }

  function playRound(
    state: PairingState,
    rng: RngState,
    round: 1 | 2,
  ): { state: PairingState; rng: RngState; tableSeed: number } {
    // Defenders
    const aDef = pickFromPool(rng, state.poolA); rng = aDef.state;
    state = dispatch(state, { type: 'LOCK_IN_DEFENDER', team: 'A', armyId: aDef.value });
    assertInfoHiding(state);
    const bDef = pickFromPool(rng, state.poolB); rng = bDef.state;
    state = dispatch(state, { type: 'LOCK_IN_DEFENDER', team: 'B', armyId: bDef.value });
    assertInfoHiding(state);

    // Attackers
    const aAtk = pickPair(rng, state.poolA, aDef.value); rng = aAtk.state;
    state = dispatch(state, { type: 'LOCK_IN_ATTACKERS', team: 'A', armyIds: aAtk.value });
    assertInfoHiding(state);
    const bAtk = pickPair(rng, state.poolB, bDef.value); rng = bAtk.state;
    state = dispatch(state, { type: 'LOCK_IN_ATTACKERS', team: 'B', armyIds: bAtk.value });
    assertInfoHiding(state);

    // Refusals
    const aRef = pick(rng, bAtk.value); rng = aRef.state;
    state = dispatch(state, { type: 'LOCK_IN_REFUSAL', team: 'A', armyId: aRef.value });
    assertInfoHiding(state);
    const bRef = pick(rng, aAtk.value); rng = bRef.state;
    state = dispatch(state, { type: 'LOCK_IN_REFUSAL', team: 'B', armyId: bRef.value });
    assertInfoHiding(state);

    // Tables — R1 needs RESOLVE_INITIAL_TOKEN first; R2 already has a token.
    if (round === 1) {
      const { winner } = rollInitialToken(state);
      state = dispatch(state, { type: 'RESOLVE_INITIAL_TOKEN', winner });
    }
    const holder = state.tokenHolder!;

    // Pick two tableIds that aren't already assigned (avoids R1's tables in R2).
    const usedBefore = new Set(state.pairings.map(p => p.tableId).filter((x): x is number => x !== undefined));
    const start = nextInt(rng, 1, 8); rng = start.state;
    let tA = start.value;
    while (usedBefore.has(tA)) tA = (tA % 8) + 1;
    state = dispatch(state, { type: 'LOCK_IN_TABLE', team: holder, tableId: tA });
    assertInfoHiding(state);

    const usedAfterA = new Set([...usedBefore, tA]);
    let tB = (tA % 8) + 1;
    while (usedAfterA.has(tB)) tB = (tB % 8) + 1;
    state = dispatch(state, { type: 'LOCK_IN_TABLE', team: otherTeam(holder), tableId: tB });
    assertInfoHiding(state);

    return { state, rng, tableSeed: tA };
  }

  it('preserves information hiding across 50 random R1+R2 sequences', () => {
    for (let seed = 0; seed < 50; seed++) {
      let state = init(seed);
      let rng = mkSeed(seed ^ 0x12345);
      assertInfoHiding(state);

      const r1 = playRound(state, rng, 1);
      state = r1.state; rng = r1.rng;
      expect(state.phase).toBe('ROUND_2.AWAITING_DEFENDERS');
      expect(state.poolA).toHaveLength(6);
      expect(state.poolB).toHaveLength(6);
      expect(state.pairings).toHaveLength(2);

      const r2 = playRound(state, rng, 2);
      state = r2.state;
      expect(state.phase).toBe('SCRUM.AWAITING_DEFENDERS');
      expect(state.poolA).toHaveLength(4);
      expect(state.poolB).toHaveLength(4);
      expect(state.pairings).toHaveLength(4);
      expect(new Set(state.pairings.map(p => p.tableId)).size).toBe(4);
      expect(JSON.parse(JSON.stringify(state))).toEqual(state);
    }
  });
});

// ── Scrum sequencing helpers ──────────────────────────────────────────────────

function advanceToScrumDefenders(seed = 0xdead): { state: PairingState; r1Holder: Team } {
  const { state, r1Holder } = advanceToRound2Defenders(seed);
  let s = state;
  s = dispatch(s, { type: 'LOCK_IN_DEFENDER', team: 'A', armyId: 'a4' });
  s = dispatch(s, { type: 'LOCK_IN_DEFENDER', team: 'B', armyId: 'b6' });
  s = dispatch(s, { type: 'LOCK_IN_ATTACKERS', team: 'A', armyIds: ['a0', 'a5'] });
  s = dispatch(s, { type: 'LOCK_IN_ATTACKERS', team: 'B', armyIds: ['b0', 'b3'] });
  s = dispatch(s, { type: 'LOCK_IN_REFUSAL', team: 'A', armyId: 'b0' });
  s = dispatch(s, { type: 'LOCK_IN_REFUSAL', team: 'B', armyId: 'a5' });
  const r2Holder = s.tokenHolder!;
  s = dispatch(s, { type: 'LOCK_IN_TABLE', team: r2Holder, tableId: 3 });
  s = dispatch(s, { type: 'LOCK_IN_TABLE', team: otherTeam(r2Holder), tableId: 4 });
  return { state: s, r1Holder };
}

// Pre-canned scrum pool contents for the standard sequence helpers below.
// After R1+R2 with the standard picks: poolA = [a2, a5, a6, a7], poolB = [b1, b3, b4, b7].
// (R1 refused: a2, b1 stay. R2 refused: a5, b0 stay.) Wait — b0 is in poolB but
// got removed as R2 attacker; recompute below in tests by inspection.

// ── SCRUM.AWAITING_DEFENDERS ──────────────────────────────────────────────────

describe('state.applyAction SCRUM.AWAITING_DEFENDERS', () => {
  it('lands in SCRUM.AWAITING_DEFENDERS with empty step, pools at 4', () => {
    const { state } = advanceToScrumDefenders();
    expect(state.phase).toBe('SCRUM.AWAITING_DEFENDERS');
    expect(state.step).toEqual({});
    expect(state.poolA).toHaveLength(4);
    expect(state.poolB).toHaveLength(4);
  });

  it('reveal collapse advances to AWAITING_ATTACKERS, log appends DefendersRevealed { round: "scrum" }', () => {
    const { state } = advanceToScrumDefenders();
    const aDef = state.poolA[0]!;
    const bDef = state.poolB[0]!;
    let s = dispatch(state, { type: 'LOCK_IN_DEFENDER', team: 'A', armyId: aDef });
    s = dispatch(s, { type: 'LOCK_IN_DEFENDER', team: 'B', armyId: bDef });
    expect(s.phase).toBe('SCRUM.AWAITING_ATTACKERS');
    expect(s.step.defenders?.revealed).toEqual({ a: aDef, b: bDef });
    expect(s.log[s.log.length - 1]).toEqual({
      type: 'DefendersRevealed', round: 'scrum', aArmy: aDef, bArmy: bDef,
    });
  });

  it('PoolViolation when picking an army from R1/R2 pool removals', () => {
    const { state } = advanceToScrumDefenders();
    // a3 (R1 def), a1 (R1 surviving atk), a4 (R2 def), a0 (R2 surviving atk) are gone.
    const r = applyAction(state, { type: 'LOCK_IN_DEFENDER', team: 'A', armyId: 'a3' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('PoolViolation');
  });
});

// ── SCRUM.AWAITING_ATTACKERS + AUTO_LAST_MAN chain ────────────────────────────

describe('state.applyAction SCRUM.AWAITING_ATTACKERS → AUTO_LAST_MAN auto-advance', () => {
  function setup(): { state: PairingState; aDef: ArmyId; bDef: ArmyId } {
    const { state } = advanceToScrumDefenders();
    const aDef = state.poolA[0]!;
    const bDef = state.poolB[0]!;
    let s = dispatch(state, { type: 'LOCK_IN_DEFENDER', team: 'A', armyId: aDef });
    s = dispatch(s, { type: 'LOCK_IN_DEFENDER', team: 'B', armyId: bDef });
    return { state: s, aDef, bDef };
  }

  it('reveal collapse advances ALL THE WAY to SCRUM.AWAITING_REFUSALS in one applyAction', () => {
    const { state, aDef, bDef } = setup();
    const aAtk: [ArmyId, ArmyId] = [state.poolA[1]!, state.poolA[2]!];
    const bAtk: [ArmyId, ArmyId] = [state.poolB[1]!, state.poolB[2]!];
    let s = dispatch(state, { type: 'LOCK_IN_ATTACKERS', team: 'A', armyIds: aAtk });
    const r = applyAction(s, { type: 'LOCK_IN_ATTACKERS', team: 'B', armyIds: bAtk });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Phase should land on AWAITING_REFUSALS, not AUTO_LAST_MAN — the AUTO state
    // is real but transient and never persists between applyAction calls.
    expect(r.state.phase).toBe('SCRUM.AWAITING_REFUSALS');

    // Events from this single dispatch contain BOTH AttackersRevealed and
    // LastManAutoPaired in order. The presence of LastManAutoPaired is the
    // structural proof the engine passed through SCRUM.AUTO_LAST_MAN.
    const types = r.events.map((e: LogEntry) => e.type);
    expect(types).toEqual(['AttackersRevealed', 'LastManAutoPaired']);

    // Last-man pairing committed as scrum game with defenderTeam=null.
    const lastManPairing = r.state.pairings.find(p => p.round === 'scrum' && p.defenderTeam === null);
    expect(lastManPairing).toBeDefined();
    const aLastMan = state.poolA[3]!; // not defender, not in attackers
    const bLastMan = state.poolB[3]!;
    expect(lastManPairing!.aArmy).toBe(aLastMan);
    expect(lastManPairing!.bArmy).toBe(bLastMan);
    void aDef; void bDef;
  });

  it('LastManAutoPaired log entry appears exactly once in the log', () => {
    const { state } = setup();
    const aAtk: [ArmyId, ArmyId] = [state.poolA[1]!, state.poolA[2]!];
    const bAtk: [ArmyId, ArmyId] = [state.poolB[1]!, state.poolB[2]!];
    let s = dispatch(state, { type: 'LOCK_IN_ATTACKERS', team: 'A', armyIds: aAtk });
    s = dispatch(s, { type: 'LOCK_IN_ATTACKERS', team: 'B', armyIds: bAtk });
    const lastManEvents = s.log.filter(e => e.type === 'LastManAutoPaired');
    expect(lastManEvents).toHaveLength(1);
  });

  it('after AUTO_LAST_MAN: pools at 3 each (last man removed)', () => {
    const { state } = setup();
    const aAtk: [ArmyId, ArmyId] = [state.poolA[1]!, state.poolA[2]!];
    const bAtk: [ArmyId, ArmyId] = [state.poolB[1]!, state.poolB[2]!];
    let s = dispatch(state, { type: 'LOCK_IN_ATTACKERS', team: 'A', armyIds: aAtk });
    s = dispatch(s, { type: 'LOCK_IN_ATTACKERS', team: 'B', armyIds: bAtk });
    expect(s.poolA).toHaveLength(3);
    expect(s.poolB).toHaveLength(3);
  });

  it('JSON round-trip preserved across the AUTO advance', () => {
    const { state } = setup();
    const aAtk: [ArmyId, ArmyId] = [state.poolA[1]!, state.poolA[2]!];
    const bAtk: [ArmyId, ArmyId] = [state.poolB[1]!, state.poolB[2]!];
    let s = dispatch(state, { type: 'LOCK_IN_ATTACKERS', team: 'A', armyIds: aAtk });
    s = dispatch(s, { type: 'LOCK_IN_ATTACKERS', team: 'B', armyIds: bAtk });
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  });
});

// ── SCRUM.AWAITING_REFUSALS + AUTO_REFUSED_PAIR chain ─────────────────────────

describe('state.applyAction SCRUM.AWAITING_REFUSALS → AUTO_REFUSED_PAIR auto-advance', () => {
  function setup(): { state: PairingState; aAtk: readonly [ArmyId, ArmyId]; bAtk: readonly [ArmyId, ArmyId] } {
    const { state: s0 } = advanceToScrumDefenders();
    const aDef = s0.poolA[0]!;
    const bDef = s0.poolB[0]!;
    let s = dispatch(s0, { type: 'LOCK_IN_DEFENDER', team: 'A', armyId: aDef });
    s = dispatch(s, { type: 'LOCK_IN_DEFENDER', team: 'B', armyId: bDef });
    const aAtk: readonly [ArmyId, ArmyId] = [s.poolA[1]!, s.poolA[2]!];
    const bAtk: readonly [ArmyId, ArmyId] = [s.poolB[1]!, s.poolB[2]!];
    s = dispatch(s, { type: 'LOCK_IN_ATTACKERS', team: 'A', armyIds: aAtk });
    s = dispatch(s, { type: 'LOCK_IN_ATTACKERS', team: 'B', armyIds: bAtk });
    return { state: s, aAtk, bAtk };
  }

  it('reveal collapse advances to SCRUM.AWAITING_TABLES in one applyAction', () => {
    const { state, aAtk, bAtk } = setup();
    let s = dispatch(state, { type: 'LOCK_IN_REFUSAL', team: 'A', armyId: bAtk[0] });
    const r = applyAction(s, { type: 'LOCK_IN_REFUSAL', team: 'B', armyId: aAtk[0] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.phase).toBe('SCRUM.AWAITING_TABLES');

    const types = r.events.map((e: LogEntry) => e.type);
    expect(types).toEqual(['RefusalsRevealed', 'RefusedAutoPaired']);
  });

  it('RefusedAutoPaired logged exactly once with defenderTeam=null pairing', () => {
    const { state, aAtk, bAtk } = setup();
    let s = dispatch(state, { type: 'LOCK_IN_REFUSAL', team: 'A', armyId: bAtk[0] });
    s = dispatch(s, { type: 'LOCK_IN_REFUSAL', team: 'B', armyId: aAtk[0] });
    const refusedEvents = s.log.filter(e => e.type === 'RefusedAutoPaired');
    expect(refusedEvents).toHaveLength(1);
    const refusedPairing = s.pairings[s.pairings.length - 1]!;
    expect(refusedPairing.defenderTeam).toBeNull();
    expect(refusedPairing.aArmy).toBe(aAtk[0]); // A's refused attacker
    expect(refusedPairing.bArmy).toBe(bAtk[0]); // B's refused attacker
  });

  it('after AUTO_REFUSED_PAIR: pools EMPTY, 8 pairings total (4 prior + last-man + 2 refusal + refused-pair)', () => {
    const { state, aAtk, bAtk } = setup();
    let s = dispatch(state, { type: 'LOCK_IN_REFUSAL', team: 'A', armyId: bAtk[0] });
    s = dispatch(s, { type: 'LOCK_IN_REFUSAL', team: 'B', armyId: aAtk[0] });
    expect(s.poolA).toHaveLength(0);
    expect(s.poolB).toHaveLength(0);
    expect(s.pairings).toHaveLength(8);
  });
});

// ── SCRUM.AWAITING_TABLES (Phase A + Phase B) ─────────────────────────────────

describe('state.applyAction SCRUM.AWAITING_TABLES — Phase A and Phase B', () => {
  function setupAtTables(seed = 0xdead): { state: PairingState; r1Holder: Team } {
    const { state: s0, r1Holder } = advanceToScrumDefenders(seed);
    const aDef = s0.poolA[0]!;
    const bDef = s0.poolB[0]!;
    let s = dispatch(s0, { type: 'LOCK_IN_DEFENDER', team: 'A', armyId: aDef });
    s = dispatch(s, { type: 'LOCK_IN_DEFENDER', team: 'B', armyId: bDef });
    const aAtk: readonly [ArmyId, ArmyId] = [s.poolA[1]!, s.poolA[2]!];
    const bAtk: readonly [ArmyId, ArmyId] = [s.poolB[1]!, s.poolB[2]!];
    s = dispatch(s, { type: 'LOCK_IN_ATTACKERS', team: 'A', armyIds: aAtk });
    s = dispatch(s, { type: 'LOCK_IN_ATTACKERS', team: 'B', armyIds: bAtk });
    s = dispatch(s, { type: 'LOCK_IN_REFUSAL', team: 'A', armyId: bAtk[0] });
    s = dispatch(s, { type: 'LOCK_IN_REFUSAL', team: 'B', armyId: aAtk[0] });
    return { state: s, r1Holder };
  }

  it('lands in SCRUM.AWAITING_TABLES with token preserved across R1→R2→Scrum (matches r1Holder)', () => {
    const { state, r1Holder } = setupAtTables();
    expect(state.phase).toBe('SCRUM.AWAITING_TABLES');
    expect(state.tokenHolder).toBe(r1Holder);
  });

  it('Phase A out-of-turn: non-token-holder picks first → OutOfTurn', () => {
    const { state } = setupAtTables();
    const wrong = otherTeam(state.tokenHolder!);
    const r = applyAction(state, { type: 'LOCK_IN_TABLE', team: wrong, tableId: 5 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('OutOfTurn');
  });

  it('Phase A: token-holder picks first, then opposing — both events have defenderArmy', () => {
    const { state } = setupAtTables();
    const holder = state.tokenHolder!;
    const r1 = applyAction(state, { type: 'LOCK_IN_TABLE', team: holder, tableId: 5 });
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    expect(r1.events).toHaveLength(1);
    if (r1.events[0]?.type === 'TableChosen') {
      expect(r1.events[0].defenderArmy).toBeDefined();
    }

    const r2 = applyAction(r1.state, { type: 'LOCK_IN_TABLE', team: otherTeam(holder), tableId: 6 });
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect(r2.state.phase).toBe('SCRUM.AWAITING_TABLES'); // still in tables; Phase B starts
    if (r2.events[0]?.type === 'TableChosen') {
      expect(r2.events[0].defenderArmy).toBeDefined();
    }
  });

  it('Phase B begins after both Phase A picks: token holder picks both, opposing OutOfTurn', () => {
    const { state } = setupAtTables();
    const holder = state.tokenHolder!;
    let s = dispatch(state, { type: 'LOCK_IN_TABLE', team: holder, tableId: 5 });
    s = dispatch(s, { type: 'LOCK_IN_TABLE', team: otherTeam(holder), tableId: 6 });

    // Phase B started — opposing team is OutOfTurn for the next pick.
    const wrong = applyAction(s, { type: 'LOCK_IN_TABLE', team: otherTeam(holder), tableId: 7 });
    expect(wrong.ok).toBe(false);
    if (!wrong.ok) expect(wrong.error.kind).toBe('OutOfTurn');

    // Token holder may pick the first Phase B table.
    const r1 = applyAction(s, { type: 'LOCK_IN_TABLE', team: holder, tableId: 7 });
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    // TableChosen for Phase B has NO defenderArmy.
    if (r1.events[0]?.type === 'TableChosen') {
      expect(r1.events[0].defenderArmy).toBeUndefined();
    }
    expect(r1.state.phase).toBe('SCRUM.AWAITING_TABLES');

    // Opposing still OutOfTurn for the second Phase B pick.
    const wrong2 = applyAction(r1.state, { type: 'LOCK_IN_TABLE', team: otherTeam(holder), tableId: 8 });
    expect(wrong2.ok).toBe(false);
    if (!wrong2.ok) expect(wrong2.error.kind).toBe('OutOfTurn');

    // Final Phase B pick → GAME_COMPLETE.
    const r2 = applyAction(r1.state, { type: 'LOCK_IN_TABLE', team: holder, tableId: 8 });
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect(r2.state.phase).toBe('GAME_COMPLETE');
  });

  it('GAME_COMPLETE state: 8 pairings, 8 distinct tableIds, no further token flip', () => {
    const { state, r1Holder } = setupAtTables();
    const holder = state.tokenHolder!;
    let s = dispatch(state, { type: 'LOCK_IN_TABLE', team: holder, tableId: 5 });
    s = dispatch(s, { type: 'LOCK_IN_TABLE', team: otherTeam(holder), tableId: 6 });
    s = dispatch(s, { type: 'LOCK_IN_TABLE', team: holder, tableId: 7 });
    s = dispatch(s, { type: 'LOCK_IN_TABLE', team: holder, tableId: 8 });
    expect(s.phase).toBe('GAME_COMPLETE');
    expect(s.pairings).toHaveLength(8);
    const ids = s.pairings.map(p => p.tableId);
    expect(new Set(ids).size).toBe(8);
    // Token holder unchanged (no flip on game end).
    expect(s.tokenHolder).toBe(r1Holder);
    // Exactly 2 TokenFlipped events (R1→R2, R2→Scrum) — no flip from Scrum.
    const flips = s.log.filter(e => e.type === 'TokenFlipped');
    expect(flips).toHaveLength(2);
    expect(s.step).toEqual({});
  });

  it('Phase A InvalidPayload on out-of-range or duplicate tableId', () => {
    const { state } = setupAtTables();
    const holder = state.tokenHolder!;
    for (const bad of [0, 9]) {
      const r = applyAction(state, { type: 'LOCK_IN_TABLE', team: holder, tableId: bad });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.kind).toBe('InvalidPayload');
    }
    // R1 used tables 1, 2 and R2 used 3, 4 — try to reuse one.
    const r = applyAction(state, { type: 'LOCK_IN_TABLE', team: holder, tableId: 1 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('InvalidPayload');
  });

  it('non-LOCK_IN_TABLE actions in SCRUM.AWAITING_TABLES are IllegalAction', () => {
    const { state } = setupAtTables();
    const r = applyAction(state, { type: 'LOCK_IN_DEFENDER', team: 'A', armyId: 'a2' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('IllegalAction');
  });
});

// ── Wrong-action IllegalAction in each scrum DAR phase ────────────────────────

describe('state.applyAction wrong-action in SCRUM DAR phases', () => {
  it('SCRUM.AWAITING_DEFENDERS rejects non-LOCK_IN_DEFENDER', () => {
    const { state } = advanceToScrumDefenders();
    const r = applyAction(state, { type: 'LOCK_IN_TABLE', team: 'A', tableId: 5 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('IllegalAction');
  });

  it('SCRUM.AWAITING_ATTACKERS rejects non-LOCK_IN_ATTACKERS', () => {
    const { state: s0 } = advanceToScrumDefenders();
    const aDef = s0.poolA[0]!;
    const bDef = s0.poolB[0]!;
    let s = dispatch(s0, { type: 'LOCK_IN_DEFENDER', team: 'A', armyId: aDef });
    s = dispatch(s, { type: 'LOCK_IN_DEFENDER', team: 'B', armyId: bDef });
    const r = applyAction(s, { type: 'LOCK_IN_REFUSAL', team: 'A', armyId: 'doesnt-matter' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('IllegalAction');
  });

  it('SCRUM.AWAITING_REFUSALS rejects non-LOCK_IN_REFUSAL', () => {
    const { state: s0 } = advanceToScrumDefenders();
    const aDef = s0.poolA[0]!;
    const bDef = s0.poolB[0]!;
    let s = dispatch(s0, { type: 'LOCK_IN_DEFENDER', team: 'A', armyId: aDef });
    s = dispatch(s, { type: 'LOCK_IN_DEFENDER', team: 'B', armyId: bDef });
    const aAtk: readonly [ArmyId, ArmyId] = [s.poolA[1]!, s.poolA[2]!];
    const bAtk: readonly [ArmyId, ArmyId] = [s.poolB[1]!, s.poolB[2]!];
    s = dispatch(s, { type: 'LOCK_IN_ATTACKERS', team: 'A', armyIds: aAtk });
    s = dispatch(s, { type: 'LOCK_IN_ATTACKERS', team: 'B', armyIds: bAtk });
    const r = applyAction(s, { type: 'LOCK_IN_TABLE', team: 'A', tableId: 5 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('IllegalAction');
  });
});

// ── GAME_COMPLETE terminality ─────────────────────────────────────────────────

describe('state.applyAction GAME_COMPLETE — terminal', () => {
  it('rejects every action with IllegalAction', () => {
    const s: PairingState = { ...init(), phase: 'GAME_COMPLETE' };
    const actions: Action[] = [
      { type: 'LOCK_IN_DEFENDER', team: 'A', armyId: 'a0' },
      { type: 'LOCK_IN_ATTACKERS', team: 'A', armyIds: ['a0', 'a1'] },
      { type: 'LOCK_IN_REFUSAL', team: 'A', armyId: 'a0' },
      { type: 'LOCK_IN_TABLE', team: 'A', tableId: 1 },
      { type: 'RESOLVE_INITIAL_TOKEN', winner: 'A' },
    ];
    for (const a of actions) {
      const r = applyAction(s, a);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.kind).toBe('IllegalAction');
    }
  });
});

// ── Full-game property test ───────────────────────────────────────────────────

describe('state property: full-game runs to GAME_COMPLETE preserve invariants', () => {
  function assertInfoHiding(state: PairingState): void {
    const va = viewFor(state, 'A');
    const vb = viewFor(state, 'B');
    if (va.step.defenders) expect('pendingB' in va.step.defenders).toBe(false);
    if (va.step.attackers) expect('pendingB' in va.step.attackers).toBe(false);
    if (va.step.refusals)  expect('pendingB' in va.step.refusals).toBe(false);
    if (vb.step.defenders) expect('pendingA' in vb.step.defenders).toBe(false);
    if (vb.step.attackers) expect('pendingA' in vb.step.attackers).toBe(false);
    if (vb.step.refusals)  expect('pendingA' in vb.step.refusals).toBe(false);
  }

  function pickFromPool(rng: RngState, pool: readonly ArmyId[]): { state: RngState; value: ArmyId } {
    const r = pick(rng, pool);
    return { state: r.state, value: r.value };
  }

  function pickPair(
    rng: RngState,
    pool: readonly ArmyId[],
    excluding: ArmyId,
  ): { state: RngState; value: readonly [ArmyId, ArmyId] } {
    const eligible = pool.filter(a => a !== excluding);
    const r1 = nextInt(rng, 0, eligible.length - 1);
    const v1 = eligible[r1.value]!;
    const remaining = eligible.filter(a => a !== v1);
    const r2 = nextInt(r1.state, 0, remaining.length - 1);
    const v2 = remaining[r2.value]!;
    return { state: r2.state, value: [v1, v2] };
  }

  function pickFreeTable(used: ReadonlySet<number>, rng: RngState): { rng: RngState; tableId: number } {
    const r = nextInt(rng, 1, 8);
    let id = r.value;
    while (used.has(id)) id = (id % 8) + 1;
    return { rng: r.state, tableId: id };
  }

  function playFullGame(state: PairingState, rng: RngState): { state: PairingState; rng: RngState } {
    let s = state;
    assertInfoHiding(s);

    // Helper: play one defender/attackers/refusals trio for the current phase chain
    const playDARForRound = (round: 1 | 2 | 'scrum') => {
      // Defenders
      const aDef = pickFromPool(rng, s.poolA); rng = aDef.state;
      s = dispatch(s, { type: 'LOCK_IN_DEFENDER', team: 'A', armyId: aDef.value }); assertInfoHiding(s);
      const bDef = pickFromPool(rng, s.poolB); rng = bDef.state;
      s = dispatch(s, { type: 'LOCK_IN_DEFENDER', team: 'B', armyId: bDef.value }); assertInfoHiding(s);

      // Attackers (excluding own defender)
      const aAtk = pickPair(rng, s.poolA, aDef.value); rng = aAtk.state;
      s = dispatch(s, { type: 'LOCK_IN_ATTACKERS', team: 'A', armyIds: aAtk.value }); assertInfoHiding(s);
      const bAtk = pickPair(rng, s.poolB, bDef.value); rng = bAtk.state;
      s = dispatch(s, { type: 'LOCK_IN_ATTACKERS', team: 'B', armyIds: bAtk.value }); assertInfoHiding(s);

      // Refusals (each refuses one of the OTHER team's attackers)
      const aRef = pick(rng, bAtk.value); rng = aRef.state;
      s = dispatch(s, { type: 'LOCK_IN_REFUSAL', team: 'A', armyId: aRef.value }); assertInfoHiding(s);
      const bRef = pick(rng, aAtk.value); rng = bRef.state;
      s = dispatch(s, { type: 'LOCK_IN_REFUSAL', team: 'B', armyId: bRef.value }); assertInfoHiding(s);
      void round;
    };

    // R1
    playDARForRound(1);
    const { winner } = rollInitialToken(s);
    s = dispatch(s, { type: 'RESOLVE_INITIAL_TOKEN', winner });
    let used = new Set<number>();
    let h = s.tokenHolder!;
    let tA = pickFreeTable(used, rng); rng = tA.rng; used.add(tA.tableId);
    s = dispatch(s, { type: 'LOCK_IN_TABLE', team: h, tableId: tA.tableId }); assertInfoHiding(s);
    let tB = pickFreeTable(used, rng); rng = tB.rng; used.add(tB.tableId);
    s = dispatch(s, { type: 'LOCK_IN_TABLE', team: otherTeam(h), tableId: tB.tableId }); assertInfoHiding(s);

    // R2
    playDARForRound(2);
    used = new Set<number>(s.pairings.map(p => p.tableId).filter((x): x is number => x !== undefined));
    h = s.tokenHolder!;
    tA = pickFreeTable(used, rng); rng = tA.rng; used.add(tA.tableId);
    s = dispatch(s, { type: 'LOCK_IN_TABLE', team: h, tableId: tA.tableId }); assertInfoHiding(s);
    tB = pickFreeTable(used, rng); rng = tB.rng; used.add(tB.tableId);
    s = dispatch(s, { type: 'LOCK_IN_TABLE', team: otherTeam(h), tableId: tB.tableId }); assertInfoHiding(s);

    // Scrum (DAR + Phase A + Phase B)
    playDARForRound('scrum');
    used = new Set<number>(s.pairings.map(p => p.tableId).filter((x): x is number => x !== undefined));
    h = s.tokenHolder!;
    // Phase A: holder, then opposing
    tA = pickFreeTable(used, rng); rng = tA.rng; used.add(tA.tableId);
    s = dispatch(s, { type: 'LOCK_IN_TABLE', team: h, tableId: tA.tableId }); assertInfoHiding(s);
    tB = pickFreeTable(used, rng); rng = tB.rng; used.add(tB.tableId);
    s = dispatch(s, { type: 'LOCK_IN_TABLE', team: otherTeam(h), tableId: tB.tableId }); assertInfoHiding(s);
    // Phase B: holder picks both
    let tC = pickFreeTable(used, rng); rng = tC.rng; used.add(tC.tableId);
    s = dispatch(s, { type: 'LOCK_IN_TABLE', team: h, tableId: tC.tableId }); assertInfoHiding(s);
    let tD = pickFreeTable(used, rng); rng = tD.rng; used.add(tD.tableId);
    s = dispatch(s, { type: 'LOCK_IN_TABLE', team: h, tableId: tD.tableId }); assertInfoHiding(s);

    return { state: s, rng };
  }

  it('200 random full games reach GAME_COMPLETE with all required invariants', () => {
    for (let seed = 0; seed < 200; seed++) {
      const initial = init(seed);
      const rng = mkSeed(seed ^ 0x12345);
      const { state } = playFullGame(initial, rng);

      expect(state.phase).toBe('GAME_COMPLETE');
      expect(state.pairings).toHaveLength(8);
      const ids = state.pairings.map(p => p.tableId);
      expect(ids.every(id => id !== undefined)).toBe(true);
      expect(new Set(ids).size).toBe(8);

      const counts: Record<string, number> = {};
      for (const e of state.log) counts[e.type] = (counts[e.type] ?? 0) + 1;
      expect(counts['TokenRollOff']).toBe(1);
      expect(counts['TokenFlipped']).toBeGreaterThanOrEqual(2);
      expect(counts['LastManAutoPaired']).toBe(1);
      expect(counts['RefusedAutoPaired']).toBe(1);
      expect(counts['TableChosen']).toBe(8);

      // Pools fully consumed.
      expect(state.poolA).toHaveLength(0);
      expect(state.poolB).toHaveLength(0);

      // JSON round-trip at game end.
      expect(JSON.parse(JSON.stringify(state))).toEqual(state);

      // Pairing breakdown by round.
      expect(state.pairings.filter(p => p.round === 1)).toHaveLength(2);
      expect(state.pairings.filter(p => p.round === 2)).toHaveLength(2);
      expect(state.pairings.filter(p => p.round === 'scrum')).toHaveLength(4);
      expect(state.pairings.filter(p => p.defenderTeam === null)).toHaveLength(2); // last-man + refused
    }
  });
});

// ── Property test: information hiding through R1 to AWAITING_TABLES ────────────

describe('state property: information hiding holds through R1 to AWAITING_TABLES', () => {
  function assertInfoHiding(state: PairingState): void {
    const va = viewFor(state, 'A');
    const vb = viewFor(state, 'B');
    if (va.step.defenders) expect('pendingB' in va.step.defenders).toBe(false);
    if (va.step.attackers) expect('pendingB' in va.step.attackers).toBe(false);
    if (va.step.refusals)  expect('pendingB' in va.step.refusals).toBe(false);
    if (vb.step.defenders) expect('pendingA' in vb.step.defenders).toBe(false);
    if (vb.step.attackers) expect('pendingA' in vb.step.attackers).toBe(false);
    if (vb.step.refusals)  expect('pendingA' in vb.step.refusals).toBe(false);
  }

  function pickFromPool(rng: RngState, pool: readonly ArmyId[]): { state: RngState; value: ArmyId } {
    const r = pick(rng, pool);
    return { state: r.state, value: r.value };
  }

  function pickPair(
    rng: RngState,
    pool: readonly ArmyId[],
    excluding: ArmyId,
  ): { state: RngState; value: readonly [ArmyId, ArmyId] } {
    const eligible = pool.filter(a => a !== excluding);
    const r1 = nextInt(rng, 0, eligible.length - 1);
    const v1 = eligible[r1.value]!;
    const remaining = eligible.filter(a => a !== v1);
    const r2 = nextInt(r1.state, 0, remaining.length - 1);
    const v2 = remaining[r2.value]!;
    return { state: r2.state, value: [v1, v2] };
  }

  it('preserves information hiding across 50 random legal R1 sequences', () => {
    for (let s = 0; s < 50; s++) {
      let state = init(s);
      let rng = mkSeed(s ^ 0x12345);
      assertInfoHiding(state);

      // R1.AWAITING_DEFENDERS: A locks, then B locks
      const aDefDraw = pickFromPool(rng, state.poolA);
      rng = aDefDraw.state;
      let result = applyAction(state, { type: 'LOCK_IN_DEFENDER', team: 'A', armyId: aDefDraw.value });
      if (!result.ok) throw new Error(`A defender failed (seed ${s}): ${JSON.stringify(result.error)}`);
      state = result.state;
      assertInfoHiding(state);

      const bDefDraw = pickFromPool(rng, state.poolB);
      rng = bDefDraw.state;
      result = applyAction(state, { type: 'LOCK_IN_DEFENDER', team: 'B', armyId: bDefDraw.value });
      if (!result.ok) throw new Error(`B defender failed (seed ${s}): ${JSON.stringify(result.error)}`);
      state = result.state;
      assertInfoHiding(state);
      expect(state.phase).toBe('ROUND_1.AWAITING_ATTACKERS');

      // R1.AWAITING_ATTACKERS: A locks pair, then B locks pair (excluding own defender)
      const aDef = aDefDraw.value;
      const bDef = bDefDraw.value;
      const aAtkDraw = pickPair(rng, state.poolA, aDef);
      rng = aAtkDraw.state;
      result = applyAction(state, { type: 'LOCK_IN_ATTACKERS', team: 'A', armyIds: aAtkDraw.value });
      if (!result.ok) throw new Error(`A attackers failed (seed ${s}): ${JSON.stringify(result.error)}`);
      state = result.state;
      assertInfoHiding(state);

      const bAtkDraw = pickPair(rng, state.poolB, bDef);
      rng = bAtkDraw.state;
      result = applyAction(state, { type: 'LOCK_IN_ATTACKERS', team: 'B', armyIds: bAtkDraw.value });
      if (!result.ok) throw new Error(`B attackers failed (seed ${s}): ${JSON.stringify(result.error)}`);
      state = result.state;
      assertInfoHiding(state);
      expect(state.phase).toBe('ROUND_1.AWAITING_REFUSALS');

      // R1.AWAITING_REFUSALS: A refuses one of B's attackers, B refuses one of A's
      const bAtkPair = bAtkDraw.value;
      const aRefDraw = pick(rng, bAtkPair);
      rng = aRefDraw.state;
      result = applyAction(state, { type: 'LOCK_IN_REFUSAL', team: 'A', armyId: aRefDraw.value });
      if (!result.ok) throw new Error(`A refusal failed (seed ${s}): ${JSON.stringify(result.error)}`);
      state = result.state;
      assertInfoHiding(state);

      const aAtkPair = aAtkDraw.value;
      const bRefDraw = pick(rng, aAtkPair);
      rng = bRefDraw.state;
      result = applyAction(state, { type: 'LOCK_IN_REFUSAL', team: 'B', armyId: bRefDraw.value });
      if (!result.ok) throw new Error(`B refusal failed (seed ${s}): ${JSON.stringify(result.error)}`);
      state = result.state;
      assertInfoHiding(state);
      expect(state.phase).toBe('ROUND_1.AWAITING_TABLES');

      // Sanity invariants at AWAITING_TABLES.
      expect(state.pairings).toHaveLength(2);
      expect(state.poolA).toHaveLength(6);
      expect(state.poolB).toHaveLength(6);
      // JSON round-trip at the end.
      expect(JSON.parse(JSON.stringify(state))).toEqual(state);
    }
  });
});
