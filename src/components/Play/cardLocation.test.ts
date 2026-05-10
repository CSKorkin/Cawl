import { describe, it, expect } from 'vitest';
import { cardLocation } from './cardLocation.js';
import { applyAction, createInitialState } from '../../engine/state.js';
import type { PairingState } from '../../engine/state.js';
import type { SelectionState } from './StepPrompt.js';

const ROSTER_A = [
  'space-marines', 'orks', 'tyranids', 'necrons',
  'asuryani', 'drukhari', 'tau-empire', 'death-guard',
] as const;
const ROSTER_B = [
  'chaos-daemons', 'thousand-sons', 'world-eaters', 'imperial-guard',
  'imperial-knights', 'grey-knights', 'sisters-of-battle', 'adeptus-custodes',
] as const;

function fresh(): PairingState {
  return createInitialState({
    mode: 'standard',
    seed: 0xc4f1,
    rosterA: ROSTER_A,
    rosterB: ROSTER_B,
  });
}

const EMPTY_SELECTION: SelectionState = { kind: 'army', team: null, ids: [] };

describe('cardLocation', () => {
  it('every army starts in the roster on a fresh state', () => {
    const s = fresh();
    for (const armyId of ROSTER_A) {
      const loc = cardLocation({ armyId, team: 'A', state: s, viewerSeat: 'A', selection: EMPTY_SELECTION });
      expect(loc).toEqual({ kind: 'roster' });
    }
    for (const armyId of ROSTER_B) {
      const loc = cardLocation({ armyId, team: 'B', state: s, viewerSeat: 'A', selection: EMPTY_SELECTION });
      expect(loc).toEqual({ kind: 'roster' });
    }
  });

  it('a tentative defender selection moves the card to A\'s defender slot in A\'s triangle', () => {
    const s = fresh();
    const selection: SelectionState = { kind: 'army', team: 'A', ids: ['orks'] };
    const loc = cardLocation({ armyId: 'orks', team: 'A', state: s, viewerSeat: 'A', selection });
    expect(loc).toEqual({ kind: 'triangle', defenderTeam: 'A', slot: 'defender', committed: false });
  });

  it('two-attacker selection lands attackers in the OPP triangle\'s atk slots (attackers attack opp\'s defender)', () => {
    // Drive past the defender phase so the engine is in AWAITING_ATTACKERS.
    let s = fresh();
    let r = applyAction(s, { type: 'LOCK_IN_DEFENDER', team: 'A', armyId: 'space-marines' });
    if (!r.ok) throw new Error('engine rejected A defender');
    s = r.state;
    r = applyAction(s, { type: 'LOCK_IN_DEFENDER', team: 'B', armyId: 'chaos-daemons' });
    if (!r.ok) throw new Error('engine rejected B defender');
    s = r.state;
    expect(s.phase).toBe('ROUND_1.AWAITING_ATTACKERS');

    const selection: SelectionState = { kind: 'army', team: 'A', ids: ['orks', 'tyranids'] };
    const orksLoc = cardLocation({ armyId: 'orks', team: 'A', state: s, viewerSeat: 'A', selection });
    const tyranidsLoc = cardLocation({ armyId: 'tyranids', team: 'A', state: s, viewerSeat: 'A', selection });
    // A's attackers are routed to B's triangle (above B's defender).
    expect(orksLoc).toEqual({ kind: 'triangle', defenderTeam: 'B', slot: 'atk1', committed: false });
    expect(tyranidsLoc).toEqual({ kind: 'triangle', defenderTeam: 'B', slot: 'atk2', committed: false });
  });

  it('a paired pairing routes both armies to their slate column', () => {
    // Drive a single full round step so two pairings get tableIds.
    let s = fresh();
    const acts = [
      { type: 'LOCK_IN_DEFENDER', team: 'A', armyId: 'space-marines' },
      { type: 'LOCK_IN_DEFENDER', team: 'B', armyId: 'chaos-daemons' },
      { type: 'LOCK_IN_ATTACKERS', team: 'A', armyIds: ['orks', 'tyranids'] },
      { type: 'LOCK_IN_ATTACKERS', team: 'B', armyIds: ['thousand-sons', 'world-eaters'] },
      { type: 'LOCK_IN_REFUSAL', team: 'A', armyId: 'thousand-sons' },
      { type: 'LOCK_IN_REFUSAL', team: 'B', armyId: 'orks' },
      { type: 'RESOLVE_INITIAL_TOKEN', winner: 'A' },
      { type: 'LOCK_IN_TABLE', team: 'A', tableId: 3 },
      { type: 'LOCK_IN_TABLE', team: 'B', tableId: 5 },
    ] as const;
    for (const a of acts) {
      const r = applyAction(s, a);
      if (!r.ok) throw new Error(`engine rejected ${a.type}: ${JSON.stringify(r.error)}`);
      s = r.state;
    }
    // Two pairings now have tableIds set: A defends with space-marines (vs
    // surviving B attacker world-eaters), and B defends with chaos-daemons
    // (vs surviving A attacker tyranids).
    const aDefLoc = cardLocation({ armyId: 'space-marines', team: 'A', state: s, viewerSeat: 'A', selection: EMPTY_SELECTION });
    const bSurvivorLoc = cardLocation({ armyId: 'world-eaters', team: 'B', state: s, viewerSeat: 'A', selection: EMPTY_SELECTION });
    expect(aDefLoc.kind).toBe('slate');
    expect(bSurvivorLoc.kind).toBe('slate');
  });

  it('refused attacker (returned to pool) goes back to the roster', () => {
    let s = fresh();
    const acts = [
      { type: 'LOCK_IN_DEFENDER', team: 'A', armyId: 'space-marines' },
      { type: 'LOCK_IN_DEFENDER', team: 'B', armyId: 'chaos-daemons' },
      { type: 'LOCK_IN_ATTACKERS', team: 'A', armyIds: ['orks', 'tyranids'] },
      { type: 'LOCK_IN_ATTACKERS', team: 'B', armyIds: ['thousand-sons', 'world-eaters'] },
      { type: 'LOCK_IN_REFUSAL', team: 'A', armyId: 'thousand-sons' },
      { type: 'LOCK_IN_REFUSAL', team: 'B', armyId: 'orks' },
    ] as const;
    for (const a of acts) {
      const r = applyAction(s, a);
      if (!r.ok) throw new Error(`engine rejected ${a.type}`);
      s = r.state;
    }
    // orks (A's attacker, refused by B) and thousand-sons (B's attacker,
    // refused by A) return to their pools.
    expect(s.poolA).toContain('orks');
    expect(s.poolB).toContain('thousand-sons');
    const orksLoc = cardLocation({ armyId: 'orks', team: 'A', state: s, viewerSeat: 'A', selection: EMPTY_SELECTION });
    const thousandSonsLoc = cardLocation({ armyId: 'thousand-sons', team: 'B', state: s, viewerSeat: 'A', selection: EMPTY_SELECTION });
    expect(orksLoc).toEqual({ kind: 'roster' });
    expect(thousandSonsLoc).toEqual({ kind: 'roster' });
  });
});
