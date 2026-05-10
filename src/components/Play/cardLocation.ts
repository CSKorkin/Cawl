// Pure derivation of "where on screen does the card for army X live right
// now?", given the engine state, the human's UI selection, and the
// viewing seat. The answer is one of: in the team's roster, in a slot of
// a triangle pick zone, or in a slate column. PlayScreen uses this to
// decide which container should host each card on every render — the
// shared-element animation handles the rest.

import type { PairingState } from '../../engine/state.js';
import type { ArmyId, Team } from '../../engine/log.js';
import type { SelectionState } from './StepPrompt.js';
import { computeSlateColumns } from './slateColumns.js';

export type CardLocation =
  | { readonly kind: 'roster' }
  | {
      readonly kind: 'triangle';
      // The defender's team — i.e., which triangle this card lives in.
      // For a defender card, this is the card's own team. For an attacker
      // card it's the OPP team (attackers attack opp's defender, so they
      // visually stack above the opp's defender slot).
      readonly defenderTeam: Team;
      readonly slot: 'defender' | 'atk1' | 'atk2';
      // True when the card has been committed (revealed) — vs tentatively
      // placed (the human's pre-confirm UI selection or own-team pending
      // before the opponent has locked in).
      readonly committed: boolean;
    }
  | { readonly kind: 'slate'; readonly column: number };

interface Args {
  readonly armyId: ArmyId;
  readonly team: Team;
  readonly state: PairingState;
  readonly viewerSeat: Team;
  readonly selection: SelectionState;
}

export function cardLocation({ armyId, team, state, viewerSeat, selection }: Args): CardLocation {
  // 1. Slate (paired with tableId set). Highest priority — once a
  //    pairing's table is locked, the cards live in the slate column.
  const cols = computeSlateColumns(state);
  for (let i = 0; i < cols.length; i++) {
    const slot = cols[i];
    if (slot === null || slot === undefined) continue;
    const own = team === 'A' ? slot.aArmy : slot.bArmy;
    if (own === armyId && slot.tableId !== undefined) {
      return { kind: 'slate', column: i };
    }
  }

  const oppTeam: Team = team === 'A' ? 'B' : 'A';

  // 2. Pairing without tableId yet → triangle slot derived from role.
  //    This is the post-refusal-collapse pre-table-pick window. Reading
  //    from `pairings` (instead of `step.attackers.revealed`) is what
  //    keeps refused attackers OUT of the triangle: they were never
  //    written into a pairing, so they fall through to the roster.
  for (const pairing of state.pairings) {
    if (pairing.tableId !== undefined) continue;
    const own = team === 'A' ? pairing.aArmy : pairing.bArmy;
    if (own !== armyId) continue;
    if (pairing.defenderTeam === team) {
      // This army is the defender → bottom slot of *its own* team's triangle.
      return { kind: 'triangle', defenderTeam: team, slot: 'defender', committed: true };
    }
    // This army is the SURVIVING attacker → top of the OPP defender's
    // triangle (attackers visually overlay the army they're attacking).
    const atks = team === 'A' ? state.step.attackers?.revealed?.a : state.step.attackers?.revealed?.b;
    const idx = atks?.indexOf(armyId) ?? 0;
    return {
      kind: 'triangle',
      defenderTeam: oppTeam,
      slot: idx === 0 ? 'atk1' : 'atk2',
      committed: true,
    };
  }

  // 3. Active step revealed slots — pre-refusal-collapse views. Once
  //    refusal is revealed, surviving attackers are in pairings (handled
  //    above) and refused attackers are back in the pool, so we gate the
  //    attackers branch on "refusal hasn't happened yet."
  const refusalCollapsed = state.step.refusals?.revealed !== undefined;
  if (state.step.defenders?.revealed !== undefined) {
    const def = team === 'A' ? state.step.defenders.revealed.a : state.step.defenders.revealed.b;
    if (def === armyId) {
      return { kind: 'triangle', defenderTeam: team, slot: 'defender', committed: true };
    }
  }
  if (!refusalCollapsed && state.step.attackers?.revealed !== undefined) {
    const atks = team === 'A' ? state.step.attackers.revealed.a : state.step.attackers.revealed.b;
    if (atks[0] === armyId) {
      return { kind: 'triangle', defenderTeam: oppTeam, slot: 'atk1', committed: true };
    }
    if (atks[1] === armyId) {
      return { kind: 'triangle', defenderTeam: oppTeam, slot: 'atk2', committed: true };
    }
  }

  // 4. Own-team pending (only the viewer can see their own pendings; the
  //    engine's viewFor strips opp pendings but we read raw state and
  //    gate by viewer to keep the same guarantee).
  if (team === viewerSeat) {
    const defSlot = state.step.defenders;
    if (defSlot !== undefined) {
      const ownPending = team === 'A' ? defSlot.pendingA : defSlot.pendingB;
      if (ownPending === armyId) {
        return { kind: 'triangle', defenderTeam: team, slot: 'defender', committed: false };
      }
    }
    const atkSlot = state.step.attackers;
    if (atkSlot !== undefined) {
      const ownPending = team === 'A' ? atkSlot.pendingA : atkSlot.pendingB;
      if (ownPending !== undefined) {
        if (ownPending[0] === armyId) {
          return { kind: 'triangle', defenderTeam: oppTeam, slot: 'atk1', committed: false };
        }
        if (ownPending[1] === armyId) {
          return { kind: 'triangle', defenderTeam: oppTeam, slot: 'atk2', committed: false };
        }
      }
    }
  }

  // 5. UI selection (pre-confirm tentative slot fill).
  if (selection.kind === 'army' && selection.team === team) {
    const idx = selection.ids.indexOf(armyId);
    if (idx >= 0) {
      if (state.phase.endsWith('AWAITING_DEFENDERS')) {
        return { kind: 'triangle', defenderTeam: team, slot: 'defender', committed: false };
      }
      if (state.phase.endsWith('AWAITING_ATTACKERS')) {
        return {
          kind: 'triangle',
          defenderTeam: oppTeam,
          slot: idx === 0 ? 'atk1' : 'atk2',
          committed: false,
        };
      }
    }
  }

  return { kind: 'roster' };
}
