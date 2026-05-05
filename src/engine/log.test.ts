import { describe, it, expect } from 'vitest';
import { appendLog } from './log.js';
import type { LogEntry } from './log.js';

describe('log.appendLog', () => {
  it('appends an entry to an empty log', () => {
    const entry: LogEntry = { type: 'TokenRollOff', winner: 'A' };
    expect(appendLog([], entry)).toEqual([entry]);
  });

  it('appends an entry to a non-empty log', () => {
    const e1: LogEntry = { type: 'TokenRollOff', winner: 'A' };
    const e2: LogEntry = { type: 'TokenFlipped', newHolder: 'B', reason: 'round-end' };
    expect(appendLog([e1], e2)).toEqual([e1, e2]);
  });

  it('does not mutate the input log', () => {
    const log: LogEntry[] = [{ type: 'TokenRollOff', winner: 'A' }];
    const snapshot = [...log];
    appendLog(log, { type: 'TokenFlipped', newHolder: 'B', reason: 'round-end' });
    expect(log).toEqual(snapshot);
  });

  it('round-trips all entry types through JSON', () => {
    const entries: LogEntry[] = [
      { type: 'DefendersRevealed', round: 1, aArmy: 'marines', bArmy: 'orks' },
      { type: 'AttackersRevealed', round: 2, aAttackers: ['marines', 'guard'], bAttackers: ['orks', 'nids'] },
      { type: 'RefusalsRevealed', round: 'scrum', aRefused: 'marines', bRefused: 'orks' },
      { type: 'TokenRollOff', winner: 'B' },
      { type: 'TokenFlipped', newHolder: 'A', reason: 'round-end' },
      { type: 'TableChosen', round: 1, team: 'A', tableId: 3, defenderArmy: 'marines' },
      { type: 'LastManAutoPaired', aArmy: 'custodes', bArmy: 'nids' },
      { type: 'RefusedAutoPaired', aArmy: 'guard', bArmy: 'daemons' },
    ];
    for (const entry of entries) {
      const reparsed = JSON.parse(JSON.stringify(entry)) as LogEntry;
      expect(reparsed).toEqual(entry);
    }
  });
});

// Compile-time exhaustiveness assertion: if a new LogEntry variant is added
// without updating this switch, TypeScript will flag a type error here.
function _assertExhaustive(x: never): never {
  throw new Error(`Unhandled log entry type: ${JSON.stringify(x)}`);
}

function _exhaustivenessSwitch(entry: LogEntry): string {
  switch (entry.type) {
    case 'DefendersRevealed': return 'ok';
    case 'AttackersRevealed': return 'ok';
    case 'RefusalsRevealed': return 'ok';
    case 'TokenRollOff': return 'ok';
    case 'TokenFlipped': return 'ok';
    case 'TableChosen': return 'ok';
    case 'LastManAutoPaired': return 'ok';
    case 'RefusedAutoPaired': return 'ok';
    default: return _assertExhaustive(entry);
  }
}

describe('log.LogEntry exhaustiveness (compile-time)', () => {
  it('switch covers all variants — file compiles iff this passes', () => {
    expect(_exhaustivenessSwitch({ type: 'TokenRollOff', winner: 'A' })).toBe('ok');
  });
});
