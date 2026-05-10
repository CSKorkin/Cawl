// Pure helper: derive the 8 slate columns from engine state.
//
// Slot rules (from spec, U7):
//   - Slots 1–6 fill left-to-right in *chronological* order of table
//     choice. The "chronological" ordering comes from the log: walk
//     TableChosen events in order, take the ones whose pairing is
//     player-decided (defenderArmy present), assign each to the next
//     open regular slot.
//   - Slot 7 is reserved for `RefusedAutoPaired` (the second scrum
//     auto-pair).
//   - Slot 8 is reserved for `LastManAutoPaired` (the first scrum
//     auto-pair).
//
// Empty columns (pairings not yet decided) render as `null`.

import type { Pairing, PairingState } from '../../engine/state.js';

const COLUMN_COUNT = 8;
const REGULAR_SLOTS = 6; // columns 1-6 (zero-indexed: 0-5)
const REFUSED_AUTO_COLUMN = 6; // column 7 (zero-indexed: 6)
const LAST_MAN_COLUMN = 7;     // column 8 (zero-indexed: 7)

export function computeSlateColumns(state: PairingState): readonly (Pairing | null)[] {
  const cols: (Pairing | null)[] = Array.from({ length: COLUMN_COUNT }, () => null);

  // Map auto-pair pairings via their LastMan/RefusedPair log entries.
  // Identifying via log avoids guessing which `defenderTeam: null` pairing
  // is which (the engine produces them in known order, but reading the
  // log makes the dependency explicit).
  let lastManPairing: Pairing | null = null;
  let refusedPairPairing: Pairing | null = null;
  for (const e of state.log) {
    if (e.type === 'LastManAutoPaired') {
      lastManPairing = state.pairings.find(
        p => p.defenderTeam === null && p.aArmy === e.aArmy && p.bArmy === e.bArmy,
      ) ?? null;
    } else if (e.type === 'RefusedAutoPaired') {
      refusedPairPairing = state.pairings.find(
        p => p.defenderTeam === null && p.aArmy === e.aArmy && p.bArmy === e.bArmy,
      ) ?? null;
    }
  }
  if (lastManPairing !== null) cols[LAST_MAN_COLUMN] = lastManPairing;
  if (refusedPairPairing !== null) cols[REFUSED_AUTO_COLUMN] = refusedPairPairing;

  // Walk TableChosen events in log order; each "regular" pairing claims
  // the next open slot among 0..REGULAR_SLOTS-1. A regular TableChosen
  // entry has defenderArmy set; auto-pair table events (which assign a
  // tableId to a defenderTeam===null pairing) omit defenderArmy and are
  // skipped here — they're already pinned to slots 7 / 8.
  let nextRegularIdx = 0;
  const placed = new Set<Pairing>();
  for (const e of state.log) {
    if (e.type !== 'TableChosen') continue;
    if (e.defenderArmy === undefined) continue;
    const pairing = state.pairings.find(
      p => p.tableId === e.tableId && p.defenderTeam !== null,
    );
    if (pairing === undefined) continue;
    if (placed.has(pairing)) continue;
    if (nextRegularIdx >= REGULAR_SLOTS) break;
    cols[nextRegularIdx] = pairing;
    placed.add(pairing);
    nextRegularIdx++;
  }

  return cols;
}
