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

  it('scrum auto-paired armies route to the slate as soon as their pairing exists (BUG: bug_log.json)', () => {
    // Reproduces the three scrum-display bugs from reference/bug_log.json.
    // Root cause: cardLocation step 2 used to fall through into the
    // surviving-attacker branch for defenderTeam===null pairings, computing
    // `atks.indexOf(armyId) ?? 0`. Since the auto-paired armies aren't in
    // step.attackers.revealed, indexOf returned -1 and the cards got routed
    // to triangle atk2 — DISPLACING the real attacker / refusal-target cards
    // that should have lived there.
    //
    // Drive to SCRUM.AWAITING_REFUSALS via a scripted sequence that lands an
    // auto-last-man pair, then assert:
    //  (a) auto-last-man armies are in the slate, not a triangle slot;
    //  (b) both real scrum attackers (the refusal targets, including the
    //      "drukhari-equivalent" at idx 1 of the opp's attackers) are in
    //      their proper triangle slots — uncontested.
    let s = fresh();
    // ── R1 ─────────────────────────────────────────────────────────────────
    const r1 = [
      { type: 'LOCK_IN_DEFENDER', team: 'A', armyId: 'space-marines' },
      { type: 'LOCK_IN_DEFENDER', team: 'B', armyId: 'chaos-daemons' },
      { type: 'LOCK_IN_ATTACKERS', team: 'A', armyIds: ['orks', 'tyranids'] },
      { type: 'LOCK_IN_ATTACKERS', team: 'B', armyIds: ['thousand-sons', 'world-eaters'] },
      { type: 'LOCK_IN_REFUSAL', team: 'A', armyId: 'thousand-sons' },
      { type: 'LOCK_IN_REFUSAL', team: 'B', armyId: 'orks' },
      { type: 'RESOLVE_INITIAL_TOKEN', winner: 'A' },
      { type: 'LOCK_IN_TABLE', team: 'A', tableId: 1 },
      { type: 'LOCK_IN_TABLE', team: 'B', tableId: 2 },
    ] as const;
    for (const a of r1) {
      const r = applyAction(s, a);
      if (!r.ok) throw new Error(`R1 ${a.type}: ${JSON.stringify(r.error)}`);
      s = r.state;
    }
    // ── R2 ─────────────────────────────────────────────────────────────────
    const r2 = [
      { type: 'LOCK_IN_DEFENDER', team: 'A', armyId: 'necrons' },
      { type: 'LOCK_IN_DEFENDER', team: 'B', armyId: 'imperial-guard' },
      { type: 'LOCK_IN_ATTACKERS', team: 'A', armyIds: ['asuryani', 'drukhari'] },
      { type: 'LOCK_IN_ATTACKERS', team: 'B', armyIds: ['imperial-knights', 'grey-knights'] },
      { type: 'LOCK_IN_REFUSAL', team: 'A', armyId: 'imperial-knights' },
      { type: 'LOCK_IN_REFUSAL', team: 'B', armyId: 'asuryani' },
      { type: 'LOCK_IN_TABLE', team: 'B', tableId: 3 },
      { type: 'LOCK_IN_TABLE', team: 'A', tableId: 4 },
    ] as const;
    for (const a of r2) {
      const r = applyAction(s, a);
      if (!r.ok) throw new Error(`R2 ${a.type}: ${JSON.stringify(r.error)}`);
      s = r.state;
    }
    expect(s.phase).toBe('SCRUM.AWAITING_DEFENDERS');
    // ── Scrum: pools now have 4 armies each ────────────────────────────────
    // poolA: orks (refused R1), thousand-sons-NO wait thousand-sons is B's.
    // Let me reconstruct: A roster: SM (R1 def), orks (R1 atk-refused, back),
    // tyranids (R1 atk-survived, paired), necrons (R2 def), asuryani (R2 atk
    // refused, back), drukhari (R2 atk-survived, paired), tau-empire,
    // death-guard. So A pool at scrum start = [orks, asuryani, tau-empire,
    // death-guard]. B pool = [thousand-sons (R1 atk refused), world-eaters
    // (R1 atk paired)-NO that's paired. Let me redo.
    //
    // R1: A def SM. A atks [orks, tyranids]. B def CD. B atks [TS, WE].
    //   A refuses TS → B survivor = WE → A def SM ⊕ WE paired.
    //   B refuses orks → A survivor = tyranids → B def CD ⊕ tyranids paired.
    //   Pools after R1: A drops SM + tyranids; B drops CD + WE.
    //   orks (A) and TS (B) remain in pool.
    // R2: A def necrons. A atks [asuryani, drukhari]. B def IG. B atks [IK, GK].
    //   A refuses IK → B survivor = GK → A def necrons ⊕ GK paired.
    //   B refuses asuryani → A survivor = drukhari → B def IG ⊕ drukhari paired.
    //   Pools after R2: A drops necrons + drukhari; B drops IG + GK.
    //   asuryani (A) and IK (B) remain in pool.
    //
    // Scrum start pools:
    //   A: orks, asuryani, tau-empire, death-guard
    //   B: thousand-sons, imperial-knights, sisters-of-battle, adeptus-custodes
    expect([...s.poolA].sort()).toEqual(['asuryani', 'death-guard', 'orks', 'tau-empire']);
    expect([...s.poolB].sort()).toEqual(['adeptus-custodes', 'imperial-knights', 'sisters-of-battle', 'thousand-sons']);

    // ── Scrum defenders + attackers ────────────────────────────────────────
    const scrumPre = [
      { type: 'LOCK_IN_DEFENDER', team: 'A', armyId: 'orks' },
      { type: 'LOCK_IN_DEFENDER', team: 'B', armyId: 'thousand-sons' },
      // A's attackers: send two of [asuryani, tau-empire, death-guard].
      // Picking [asuryani, tau-empire] leaves death-guard as A's last-man.
      { type: 'LOCK_IN_ATTACKERS', team: 'A', armyIds: ['asuryani', 'tau-empire'] },
      // B's attackers: send two of [imperial-knights, sisters-of-battle,
      // adeptus-custodes]. Picking [imperial-knights, sisters-of-battle]
      // leaves adeptus-custodes as B's last-man — the "drukhari at idx 1"
      // analog from the bug report is `sisters-of-battle` (B's atk[1]).
      { type: 'LOCK_IN_ATTACKERS', team: 'B', armyIds: ['imperial-knights', 'sisters-of-battle'] },
    ] as const;
    for (const a of scrumPre) {
      const r = applyAction(s, a);
      if (!r.ok) throw new Error(`scrum ${a.type}: ${JSON.stringify(r.error)}`);
      s = r.state;
    }
    expect(s.phase).toBe('SCRUM.AWAITING_REFUSALS');
    // Auto-last-man pairing exists with defenderTeam=null:
    //   aArmy='death-guard', bArmy='adeptus-custodes'
    const lastMan = s.pairings.find(
      p => p.round === 'scrum' && p.defenderTeam === null,
    );
    expect(lastMan).toBeDefined();
    expect(lastMan!.aArmy).toBe('death-guard');
    expect(lastMan!.bArmy).toBe('adeptus-custodes');

    // (a) Auto-last-man armies route to the slate, NOT a triangle slot.
    //     Before the fix, the surviving-attacker fallback routed both to
    //     atk2 (because indexOf returned -1).
    const dgLoc = cardLocation({
      armyId: 'death-guard', team: 'A', state: s, viewerSeat: 'A', selection: EMPTY_SELECTION,
    });
    const acLoc = cardLocation({
      armyId: 'adeptus-custodes', team: 'B', state: s, viewerSeat: 'A', selection: EMPTY_SELECTION,
    });
    expect(dgLoc.kind).toBe('slate');
    expect(acLoc.kind).toBe('slate');
    // computeSlateColumns reserves col 7 for LastManAutoPaired.
    if (dgLoc.kind === 'slate') expect(dgLoc.column).toBe(7);
    if (acLoc.kind === 'slate') expect(acLoc.column).toBe(7);

    // (b) The "idx 1 of opp's attackers" army — analog of drukhari from the
    //     bug — must land in its proper refusal-target slot (A's triangle
    //     atk2, uncontested). Pre-fix this slot was claimed by
    //     adeptus-custodes, leaving the real card unselectable.
    const sobLoc = cardLocation({
      armyId: 'sisters-of-battle', team: 'B', state: s, viewerSeat: 'A', selection: EMPTY_SELECTION,
    });
    expect(sobLoc).toEqual({ kind: 'triangle', defenderTeam: 'A', slot: 'atk2', committed: true });

    // ── Drive past refusal so the AUTO_REFUSED_PAIR pairing also exists ──
    // A refuses sisters-of-battle (B's atk[1]); B refuses asuryani (A's atk[0]).
    // After refusal collapse: poolA empties, poolB empties → auto-refused
    // pair = [asuryani, sisters-of-battle] with defenderTeam=null.
    const refuses = [
      { type: 'LOCK_IN_REFUSAL', team: 'A', armyId: 'sisters-of-battle' },
      { type: 'LOCK_IN_REFUSAL', team: 'B', armyId: 'asuryani' },
    ] as const;
    for (const a of refuses) {
      const r = applyAction(s, a);
      if (!r.ok) throw new Error(`refusal ${a.type}: ${JSON.stringify(r.error)}`);
      s = r.state;
    }
    expect(s.phase).toBe('SCRUM.AWAITING_TABLES');

    // Both auto-paired pairings now exist; cardLocation must route them to
    // the slate (cols 6 and 7), not into the triangles. The two
    // defender-led scrum pairings (orks/tau-empire and thousand-sons/IK)
    // route to their triangles as expected.
    const dgLoc2 = cardLocation({
      armyId: 'death-guard', team: 'A', state: s, viewerSeat: 'A', selection: EMPTY_SELECTION,
    });
    const acLoc2 = cardLocation({
      armyId: 'adeptus-custodes', team: 'B', state: s, viewerSeat: 'A', selection: EMPTY_SELECTION,
    });
    const asuLoc = cardLocation({
      armyId: 'asuryani', team: 'A', state: s, viewerSeat: 'A', selection: EMPTY_SELECTION,
    });
    const sobLoc2 = cardLocation({
      armyId: 'sisters-of-battle', team: 'B', state: s, viewerSeat: 'A', selection: EMPTY_SELECTION,
    });
    expect(dgLoc2.kind).toBe('slate');
    expect(acLoc2.kind).toBe('slate');
    if (dgLoc2.kind === 'slate') expect(dgLoc2.column).toBe(7);
    if (acLoc2.kind === 'slate') expect(acLoc2.column).toBe(7);
    expect(asuLoc.kind).toBe('slate');
    expect(sobLoc2.kind).toBe('slate');
    if (asuLoc.kind === 'slate') expect(asuLoc.column).toBe(6);
    if (sobLoc2.kind === 'slate') expect(sobLoc2.column).toBe(6);

    // The defender-led scrum pairings stay in the triangles (their proper
    // home until tables are assigned).
    const orksLoc = cardLocation({
      armyId: 'orks', team: 'A', state: s, viewerSeat: 'A', selection: EMPTY_SELECTION,
    });
    const tsLoc = cardLocation({
      armyId: 'thousand-sons', team: 'B', state: s, viewerSeat: 'A', selection: EMPTY_SELECTION,
    });
    expect(orksLoc).toEqual({ kind: 'triangle', defenderTeam: 'A', slot: 'defender', committed: true });
    expect(tsLoc).toEqual({ kind: 'triangle', defenderTeam: 'B', slot: 'defender', committed: true });
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
