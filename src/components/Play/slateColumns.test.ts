import { describe, it, expect } from 'vitest';
import { computeSlateColumns } from './slateColumns.js';
import type { Pairing, PairingState } from '../../engine/state.js';
import type { LogEntry } from '../../engine/log.js';

function pairing(over: Partial<Pairing> & Pick<Pairing, 'aArmy' | 'bArmy' | 'defenderTeam'>): Pairing {
  return {
    round: 1,
    ...over,
  } as Pairing;
}

function fakeState(over: { pairings: readonly Pairing[]; log: readonly LogEntry[] }): PairingState {
  return {
    phase: 'GAME_COMPLETE',
    mode: 'standard',
    rng: { seed: 0, cursor: 0 },
    matrix: { mode: 'standard', viewA: [], viewB: [] },
    rosterA: [],
    rosterB: [],
    poolA: [],
    poolB: [],
    pairings: over.pairings,
    log: over.log,
    tokenHolder: null,
    step: {},
  } as unknown as PairingState;
}

describe('computeSlateColumns', () => {
  it('returns 8 null columns on a fresh state', () => {
    const cols = computeSlateColumns(fakeState({ pairings: [], log: [] }));
    expect(cols.length).toBe(8);
    expect(cols.every((c) => c === null)).toBe(true);
  });

  it('fills regular pairings into columns 0..5 in chronological table-pick order', () => {
    // Simulate three TableChosen events (regular pairings, defenderArmy
    // present) in order. Each pairing has a tableId matching the event.
    const p1 = pairing({ aArmy: 'a1', bArmy: 'b1', defenderTeam: 'A', tableId: 5 });
    const p2 = pairing({ aArmy: 'a2', bArmy: 'b2', defenderTeam: 'B', tableId: 1 });
    const p3 = pairing({ aArmy: 'a3', bArmy: 'b3', defenderTeam: 'A', tableId: 3 });

    const log: LogEntry[] = [
      { type: 'TableChosen', round: 1, tableId: 5, team: 'A', defenderArmy: 'a1' },
      { type: 'TableChosen', round: 1, tableId: 1, team: 'B', defenderArmy: 'b2' },
      { type: 'TableChosen', round: 1, tableId: 3, team: 'A', defenderArmy: 'a3' },
    ];
    const cols = computeSlateColumns(fakeState({ pairings: [p1, p2, p3], log }));
    expect(cols[0]).toBe(p1);  // first TableChosen
    expect(cols[1]).toBe(p2);
    expect(cols[2]).toBe(p3);
    expect(cols[3]).toBeNull();
    expect(cols[4]).toBeNull();
    expect(cols[5]).toBeNull();
  });

  it('pins RefusedAutoPaired to column 7 (index 6) and LastManAutoPaired to column 8 (index 7)', () => {
    const lastMan = pairing({ round: 'scrum', aArmy: 'a-last', bArmy: 'b-last', defenderTeam: null, tableId: 7 });
    const refused = pairing({ round: 'scrum', aArmy: 'a-ref', bArmy: 'b-ref', defenderTeam: null, tableId: 8 });
    const log: LogEntry[] = [
      { type: 'LastManAutoPaired', aArmy: 'a-last', bArmy: 'b-last' },
      { type: 'RefusedAutoPaired', aArmy: 'a-ref', bArmy: 'b-ref' },
      // The auto-pair table assignments emit TableChosen entries WITHOUT
      // defenderArmy. Including them here proves the chronological-fill
      // path skips them.
      { type: 'TableChosen', round: 'scrum', tableId: 7, team: 'A' },
      { type: 'TableChosen', round: 'scrum', tableId: 8, team: 'B' },
    ];
    const cols = computeSlateColumns(fakeState({ pairings: [lastMan, refused], log }));
    expect(cols[6]).toBe(refused);
    expect(cols[7]).toBe(lastMan);
    // Slots 0..5 stay null because no regular TableChosen entries appear.
    for (let i = 0; i < 6; i++) expect(cols[i]).toBeNull();
  });

  it('an auto-pair TableChosen entry never advances the regular-slot pointer', () => {
    // Mix: one regular pick, then both auto-pair table picks, then a
    // second regular pick. Slot 0 = first regular, slot 1 = second
    // regular, columns 6/7 = auto-pairs.
    const reg1 = pairing({ aArmy: 'a1', bArmy: 'b1', defenderTeam: 'A', tableId: 5 });
    const reg2 = pairing({ aArmy: 'a2', bArmy: 'b2', defenderTeam: 'B', tableId: 2 });
    const lastMan = pairing({ round: 'scrum', aArmy: 'al', bArmy: 'bl', defenderTeam: null, tableId: 1 });
    const refused = pairing({ round: 'scrum', aArmy: 'ar', bArmy: 'br', defenderTeam: null, tableId: 3 });
    const log: LogEntry[] = [
      { type: 'TableChosen', round: 1, tableId: 5, team: 'A', defenderArmy: 'a1' },
      { type: 'LastManAutoPaired', aArmy: 'al', bArmy: 'bl' },
      { type: 'RefusedAutoPaired', aArmy: 'ar', bArmy: 'br' },
      { type: 'TableChosen', round: 'scrum', tableId: 1, team: 'A' },
      { type: 'TableChosen', round: 'scrum', tableId: 3, team: 'B' },
      { type: 'TableChosen', round: 2, tableId: 2, team: 'B', defenderArmy: 'b2' },
    ];
    const cols = computeSlateColumns(fakeState({
      pairings: [reg1, reg2, lastMan, refused],
      log,
    }));
    expect(cols[0]).toBe(reg1);
    expect(cols[1]).toBe(reg2);
    expect(cols[6]).toBe(refused);
    expect(cols[7]).toBe(lastMan);
  });
});
