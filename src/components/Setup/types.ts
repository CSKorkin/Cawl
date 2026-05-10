import type { Score, ScoreMode } from '../../engine/score.js';
import type { FactionId } from '../../factions.js';

// Hot-seat: two humans share the device. SP: human plays one seat, AI the
// other. Tier is only meaningful in SP mode. Hard tier is reserved for T14
// and disabled in the UI until then.
export type GameMode =
  | { readonly kind: 'hot-seat' }
  | { readonly kind: 'sp'; readonly tier: 'easy' | 'medium' };

// Whether the engine generates the matrix from a seed (the default training
// scenario) or the user enters their own (closer to real WTC prep). The
// "entered" path is built in Phase U5; for U1 it's UI-only and the picker
// renders it as disabled.
export type MatrixSource = 'generated' | 'entered';

// What Setup's "Start" callback receives. Phase U2 turns this into an
// engine PairingState; U1 logs it.
export interface GameConfig {
  readonly mode: GameMode;
  readonly scoring: ScoreMode;
  readonly matrixSource: MatrixSource;
  readonly seed: number;
  readonly rosterA: readonly FactionId[];
  readonly rosterB: readonly FactionId[];
  // Set when matrixSource === 'entered'. Pre-built viewA from the user's
  // typed/pasted matrix; the engine derives viewB via inversion + variance
  // off `seed`. Absent for Generated mode (engine draws viewA from RNG).
  readonly viewAOverride?: readonly (readonly Score[])[];
}
