// localStorage adapter for game state. Engine state is JSON-round-trippable
// by invariant, so persistence is a thin wrapper around stringify/parse.

import type { PairingState } from '../engine/state.js';
import type { GameConfig } from '../components/Setup/types.js';
import type { Team } from '../engine/log.js';

const STORAGE_KEY = 'cawl.game.v1';

export interface PersistedGame {
  readonly state: PairingState;
  readonly config: GameConfig;
  readonly humanSeat: Team | null;
  // Hot-seat: when set, the UI must show the Interstitial before rendering
  // any matrix view. Persisted so a mid-handoff reload doesn't leak the
  // next mover's view.
  readonly pendingHandoff: Team | null;
}

// Returns null when nothing is stored, or when the stored payload is
// malformed (we treat malformed data as "no game" rather than throwing —
// the user can always start a new game from Setup).
export function loadGame(): PersistedGame | null {
  if (typeof localStorage === 'undefined') return null;
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<PersistedGame>;
    // Light sanity check; deeper validation isn't worth the maintenance cost
    // since the only writer is this module.
    if (parsed?.state?.phase === undefined) return null;
    if (parsed.config === undefined) return null;
    return {
      state: parsed.state,
      config: parsed.config,
      humanSeat: parsed.humanSeat ?? null,
      pendingHandoff: parsed.pendingHandoff ?? null,
    };
  } catch {
    return null;
  }
}

export function saveGame(payload: PersistedGame): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

export function clearGame(): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem(STORAGE_KEY);
}
