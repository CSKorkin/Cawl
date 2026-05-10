// Zustand store wrapping the pure-TS engine. The store owns:
//   - the current engine PairingState (or null when no game in progress)
//   - the GameConfig that produced it
//   - which seat is the human (SP mode only; null in hot-seat)
//   - the chosen Actor instance (SP mode only)
//
// In SP mode, dispatch() applies the human's action and then auto-advances
// any subsequent AI moves until the state is back at "human's turn" or
// GAME_COMPLETE. The human never observes intermediate phase boundaries.
//
// Persistence: every state change is mirrored to localStorage. State is JSON
// round-trippable by engine invariant.

import { create } from 'zustand';
import {
  applyAction,
  createInitialState,
  rollInitialToken,
  viewFor,
} from '../engine/state.js';
import type {
  Action,
  EngineError,
  PairingState,
  TeamView,
} from '../engine/state.js';
import type { ArmyId, TableId, Team } from '../engine/log.js';
import {
  availableTables,
  easyActor,
  mediumActor,
  nextTableTeam,
} from '../engine/ai.js';
import type { Actor } from '../engine/ai.js';
import type { GameConfig } from '../components/Setup/types.js';
import { clearGame, loadGame, saveGame } from './persistence.js';

// ── helpers ──────────────────────────────────────────────────────────────────

function actorFor(config: GameConfig, seat: Team): Actor | null {
  if (config.mode.kind !== 'sp') return null;
  switch (config.mode.tier) {
    case 'easy': return easyActor(seat);
    case 'medium': return mediumActor(seat);
  }
}

function humanSeatFor(config: GameConfig): Team | null {
  // SP convention: human is always seat A. (Hot-seat returns null — both
  // seats are human, no AI auto-advance.)
  return config.mode.kind === 'sp' ? 'A' : null;
}

// What does the next move require? Used to decide whether the AI auto-driver
// should keep dispatching after a human action, or wait for human input.
export type RequiredMover = Team | 'system' | 'none';

export function nextRequiredMover(state: PairingState): RequiredMover {
  switch (state.phase) {
    case 'GAME_COMPLETE':
    case 'INIT':
    case 'ROUND_1_COMPLETE':
    case 'ROUND_2_COMPLETE':
    case 'SCRUM.AUTO_LAST_MAN':
    case 'SCRUM.AUTO_REFUSED_PAIR':
      return 'none';

    case 'ROUND_1.AWAITING_DEFENDERS':
    case 'ROUND_2.AWAITING_DEFENDERS':
    case 'SCRUM.AWAITING_DEFENDERS': {
      const slot = state.step.defenders;
      if (slot?.pendingA === undefined) return 'A';
      if (slot?.pendingB === undefined) return 'B';
      return 'none';
    }
    case 'ROUND_1.AWAITING_ATTACKERS':
    case 'ROUND_2.AWAITING_ATTACKERS':
    case 'SCRUM.AWAITING_ATTACKERS': {
      const slot = state.step.attackers;
      if (slot?.pendingA === undefined) return 'A';
      if (slot?.pendingB === undefined) return 'B';
      return 'none';
    }
    case 'ROUND_1.AWAITING_REFUSALS':
    case 'ROUND_2.AWAITING_REFUSALS':
    case 'SCRUM.AWAITING_REFUSALS': {
      const slot = state.step.refusals;
      if (slot?.pendingA === undefined) return 'A';
      if (slot?.pendingB === undefined) return 'B';
      return 'none';
    }

    case 'ROUND_1.AWAITING_TABLES':
      if (state.tokenHolder === null) return 'system';
      return nextTableTeam(state);
    case 'ROUND_2.AWAITING_TABLES':
    case 'SCRUM.AWAITING_TABLES':
      return nextTableTeam(state);
  }
}

// Translate the abstract Actor pick into a concrete engine action for the
// current phase. Mirrors the pattern in engine/ai.ts:runGame.
function aiActionFor(state: PairingState, seat: Team, actor: Actor): Action {
  const view: TeamView = viewFor(state, seat);
  switch (state.phase) {
    case 'ROUND_1.AWAITING_DEFENDERS':
    case 'ROUND_2.AWAITING_DEFENDERS':
    case 'SCRUM.AWAITING_DEFENDERS': {
      const armyId = actor.pickDefender(view);
      return { type: 'LOCK_IN_DEFENDER', team: seat, armyId };
    }
    case 'ROUND_1.AWAITING_ATTACKERS':
    case 'ROUND_2.AWAITING_ATTACKERS':
    case 'SCRUM.AWAITING_ATTACKERS': {
      const revealed = state.step.defenders!.revealed!;
      const oppDef = seat === 'A' ? revealed.b : revealed.a;
      const armyIds = actor.pickAttackers(view, oppDef);
      return { type: 'LOCK_IN_ATTACKERS', team: seat, armyIds };
    }
    case 'ROUND_1.AWAITING_REFUSALS':
    case 'ROUND_2.AWAITING_REFUSALS':
    case 'SCRUM.AWAITING_REFUSALS': {
      const revealed = state.step.attackers!.revealed!;
      const sentAtMe = seat === 'A' ? revealed.b : revealed.a;
      const armyId = actor.pickRefusal(view, sentAtMe);
      return { type: 'LOCK_IN_REFUSAL', team: seat, armyId };
    }
    case 'ROUND_1.AWAITING_TABLES':
    case 'ROUND_2.AWAITING_TABLES':
    case 'SCRUM.AWAITING_TABLES': {
      const tableId = actor.pickTable(view, availableTables(state));
      return { type: 'LOCK_IN_TABLE', team: seat, tableId };
    }
    default:
      throw new Error(`aiActionFor: unsupported phase ${state.phase}`);
  }
}

// Drives `state` forward through any AI moves and system actions
// (RESOLVE_INITIAL_TOKEN) until the next required mover is the human or the
// game is complete. Pure function — no store side effects.
function autoAdvance(
  state: PairingState,
  humanSeat: Team | null,
  aiActorA: Actor | null,
  aiActorB: Actor | null,
): PairingState {
  let s = state;
  // Bound the loop generously; a correct full game performs O(40) actions
  // total, so 200 iterations is comfortably above the ceiling.
  for (let i = 0; i < 200; i++) {
    const next = nextRequiredMover(s);
    if (next === 'none') return s;
    if (next === 'system') {
      // RESOLVE_INITIAL_TOKEN: only happens at ROUND_1.AWAITING_TABLES with
      // unresolved tokenHolder. Drive the engine through it.
      const { winner } = rollInitialToken(s);
      const r = applyAction(s, { type: 'RESOLVE_INITIAL_TOKEN', winner });
      if (!r.ok) throw new Error(`autoAdvance system action failed: ${JSON.stringify(r.error)}`);
      s = r.state;
      continue;
    }
    if (next === humanSeat) return s;
    const actor = next === 'A' ? aiActorA : aiActorB;
    if (actor === null) {
      // Hot-seat: both seats are human, so we shouldn't be auto-advancing
      // anything beyond system actions. Return without advancing.
      return s;
    }
    const action = aiActionFor(s, next, actor);
    const r = applyAction(s, action);
    if (!r.ok) throw new Error(`autoAdvance AI action failed: ${JSON.stringify(r.error)}`);
    s = r.state;
  }
  throw new Error('autoAdvance: did not converge within iteration cap');
}

// ── store types ──────────────────────────────────────────────────────────────

export type DispatchResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: EngineError };

export interface GameStore {
  readonly state: PairingState | null;
  readonly config: GameConfig | null;
  readonly humanSeat: Team | null;
  // AI actor instances are not serialized; recreated whenever the store is
  // initialized from a config.
  readonly _aiActorA: Actor | null;
  readonly _aiActorB: Actor | null;

  startGame(config: GameConfig): void;
  resetGame(): void;
  dispatch(action: Action): DispatchResult;
}

// ── store implementation ─────────────────────────────────────────────────────

export const useGameStore = create<GameStore>((set, get) => {
  // On first store creation, attempt to rehydrate from localStorage. AI actor
  // instances aren't serialized — recreate them from config.
  const persisted = loadGame();
  let initialState: PairingState | null = null;
  let initialConfig: GameConfig | null = null;
  let initialHumanSeat: Team | null = null;
  let initialActorA: Actor | null = null;
  let initialActorB: Actor | null = null;
  if (persisted !== null) {
    initialState = persisted.state;
    initialConfig = persisted.config;
    initialHumanSeat = persisted.humanSeat;
    initialActorA = humanSeatFor(persisted.config) === 'A' ? null : actorFor(persisted.config, 'A');
    initialActorB = humanSeatFor(persisted.config) === 'B' ? null : actorFor(persisted.config, 'B');
  }

  return {
    state: initialState,
    config: initialConfig,
    humanSeat: initialHumanSeat,
    _aiActorA: initialActorA,
    _aiActorB: initialActorB,

    startGame(config) {
      // Build fresh engine state from the config, then auto-advance any
      // immediate AI/system moves (e.g. AI-vs-human in R1.AWAITING_TABLES
      // would still need RESOLVE_INITIAL_TOKEN before the first table pick;
      // that's handled here).
      const baseState = createInitialState({
        mode: config.scoring,
        seed: config.seed,
        rosterA: config.rosterA,
        rosterB: config.rosterB,
      });
      const humanSeat = humanSeatFor(config);
      const actorA = humanSeat === 'A' ? null : actorFor(config, 'A');
      const actorB = humanSeat === 'B' ? null : actorFor(config, 'B');
      const advanced = autoAdvance(baseState, humanSeat, actorA, actorB);
      set({
        state: advanced,
        config,
        humanSeat,
        _aiActorA: actorA,
        _aiActorB: actorB,
      });
      saveGame({ state: advanced, config, humanSeat });
    },

    resetGame() {
      clearGame();
      set({ state: null, config: null, humanSeat: null, _aiActorA: null, _aiActorB: null });
    },

    dispatch(action) {
      const { state, config, humanSeat, _aiActorA, _aiActorB } = get();
      if (state === null || config === null) {
        return { ok: false, error: { kind: 'IllegalAction', phase: 'INIT', action } };
      }
      const r = applyAction(state, action);
      if (!r.ok) return { ok: false, error: r.error };
      // After applying the human's action, drive AI/system actions until we
      // reach the next human-input boundary. In hot-seat mode (humanSeat ===
      // null), autoAdvance only handles system actions and returns the rest
      // for the other human to dispatch.
      const advanced = autoAdvance(r.state, humanSeat, _aiActorA, _aiActorB);
      set({ state: advanced });
      saveGame({ state: advanced, config, humanSeat });
      return { ok: true };
    },
  };
});

// ── selectors ────────────────────────────────────────────────────────────────

export type ViewKind = 'setup' | 'play' | 'gameOver';

export function selectViewKind(s: GameStore): ViewKind {
  if (s.state === null) return 'setup';
  if (s.state.phase === 'GAME_COMPLETE') return 'gameOver';
  return 'play';
}

// Whose action is next? In SP mode this is always the human (the store
// auto-advances past AI moves). In hot-seat both teams are human.
export function selectCurrentMover(s: GameStore): Team | null {
  if (s.state === null) return null;
  const next = nextRequiredMover(s.state);
  if (next === 'A' || next === 'B') return next;
  return null;
}

// Convenience: get the "viewing seat" for the matrix render. In SP mode this
// is always the human; in hot-seat it's the current mover.
export function selectViewerSeat(s: GameStore): Team | null {
  if (s.humanSeat !== null) return s.humanSeat;
  return selectCurrentMover(s);
}

// Available tables for the current state (used by the table-pick UI).
export function selectAvailableTables(s: GameStore): readonly TableId[] {
  if (s.state === null) return [];
  return availableTables(s.state);
}

// Convenience for tests + components: grab the matrix view from the viewing
// seat's perspective.
export function selectViewerView(s: GameStore): TeamView | null {
  const seat = selectViewerSeat(s);
  if (seat === null || s.state === null) return null;
  return viewFor(s.state, seat);
}

// Re-export ArmyId for convenience to component consumers.
export type { ArmyId };
