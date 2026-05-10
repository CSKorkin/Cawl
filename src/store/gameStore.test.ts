import { describe, it, expect, beforeEach } from 'vitest';
import {
  useGameStore,
  selectViewKind,
  selectCurrentMover,
  selectViewerSeat,
  selectViewerView,
  nextRequiredMover,
} from './gameStore.js';
import { clearGame, loadGame } from './persistence.js';
import { applyAction, viewFor } from '../engine/state.js';
import type { GameConfig } from '../components/Setup/types.js';

function configSpEasy(seed = 0xc4f1): GameConfig {
  return {
    mode: { kind: 'sp', tier: 'easy' },
    scoring: 'standard',
    matrixSource: 'generated',
    seed,
    rosterA: ['a0', 'a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7'],
    rosterB: ['b0', 'b1', 'b2', 'b3', 'b4', 'b5', 'b6', 'b7'],
  };
}

function configHotSeat(): GameConfig {
  return {
    mode: { kind: 'hot-seat' },
    scoring: 'standard',
    matrixSource: 'generated',
    seed: 1,
    rosterA: ['a0', 'a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7'],
    rosterB: ['b0', 'b1', 'b2', 'b3', 'b4', 'b5', 'b6', 'b7'],
  };
}

beforeEach(() => {
  // Each test starts with a clean slate — no persisted game.
  clearGame();
  useGameStore.setState({
    state: null,
    config: null,
    humanSeat: null,
    _aiActorA: null,
    _aiActorB: null,
  });
});

describe('gameStore — view routing', () => {
  it('selectViewKind starts at "setup" before any game', () => {
    expect(selectViewKind(useGameStore.getState())).toBe('setup');
  });

  it('selectViewKind is "play" after startGame', () => {
    useGameStore.getState().startGame(configSpEasy());
    expect(selectViewKind(useGameStore.getState())).toBe('play');
  });

  it('resetGame returns the store to setup state', () => {
    useGameStore.getState().startGame(configSpEasy());
    expect(selectViewKind(useGameStore.getState())).toBe('play');
    useGameStore.getState().resetGame();
    expect(selectViewKind(useGameStore.getState())).toBe('setup');
    expect(useGameStore.getState().state).toBeNull();
  });
});

describe('gameStore — startGame in SP mode', () => {
  it('initializes engine state from the config (seed → matrix)', () => {
    useGameStore.getState().startGame(configSpEasy(42));
    const s = useGameStore.getState().state!;
    expect(s.mode).toBe('standard');
    expect(s.matrix.viewA).toHaveLength(8);
    expect(s.matrix.viewB).toHaveLength(8);
  });

  it('humanSeat is "A" in SP mode', () => {
    useGameStore.getState().startGame(configSpEasy());
    expect(useGameStore.getState().humanSeat).toBe('A');
  });

  it('phase opens at ROUND_1.AWAITING_DEFENDERS (no auto-advance needed)', () => {
    useGameStore.getState().startGame(configSpEasy());
    expect(useGameStore.getState().state!.phase).toBe('ROUND_1.AWAITING_DEFENDERS');
    expect(selectCurrentMover(useGameStore.getState())).toBe('A');
  });
});

describe('gameStore — dispatch in SP mode auto-advances AI', () => {
  it('after human locks defender, AI commits in same dispatch and phase advances', () => {
    useGameStore.getState().startGame(configSpEasy());
    const r = useGameStore.getState().dispatch({
      type: 'LOCK_IN_DEFENDER', team: 'A', armyId: 'a0',
    });
    expect(r.ok).toBe(true);
    const s = useGameStore.getState().state!;
    // AI committed too → reveal collapse → phase advanced.
    expect(s.phase).toBe('ROUND_1.AWAITING_ATTACKERS');
    // Both reveals visible in log.
    const lastLog = s.log[s.log.length - 1];
    expect(lastLog?.type).toBe('DefendersRevealed');
    // Now waiting on human (A) again for attackers.
    expect(selectCurrentMover(useGameStore.getState())).toBe('A');
  });

  it('drives a full game to GAME_COMPLETE through repeated human dispatches', () => {
    useGameStore.getState().startGame(configSpEasy());
    // Human plays as Easy too (just to drive); we use a deterministic strategy
    // that calls easyActor for the human's seat.
    let safety = 200;
    while (useGameStore.getState().state!.phase !== 'GAME_COMPLETE' && safety-- > 0) {
      const s = useGameStore.getState().state!;
      const next = nextRequiredMover(s);
      if (next !== 'A') throw new Error(`expected human (A) to be next, got ${next} at phase ${s.phase}`);
      // Pick an arbitrary legal action for the human via the engine view.
      // Reuse easyActor by importing inline to keep this test focused.
      const view = viewFor(s, 'A');
      let action: Parameters<typeof applyAction>[1];
      switch (s.phase) {
        case 'ROUND_1.AWAITING_DEFENDERS':
        case 'ROUND_2.AWAITING_DEFENDERS':
        case 'SCRUM.AWAITING_DEFENDERS':
          action = { type: 'LOCK_IN_DEFENDER', team: 'A', armyId: view.myPool[0]! };
          break;
        case 'ROUND_1.AWAITING_ATTACKERS':
        case 'ROUND_2.AWAITING_ATTACKERS':
        case 'SCRUM.AWAITING_ATTACKERS': {
          const ownDef = view.step.defenders!.revealed!.a;
          const eligible = view.myPool.filter(a => a !== ownDef);
          action = { type: 'LOCK_IN_ATTACKERS', team: 'A', armyIds: [eligible[0]!, eligible[1]!] };
          break;
        }
        case 'ROUND_1.AWAITING_REFUSALS':
        case 'ROUND_2.AWAITING_REFUSALS':
        case 'SCRUM.AWAITING_REFUSALS': {
          const sentAtMe = view.step.attackers!.revealed!.b;
          action = { type: 'LOCK_IN_REFUSAL', team: 'A', armyId: sentAtMe[0]! };
          break;
        }
        case 'ROUND_1.AWAITING_TABLES':
        case 'ROUND_2.AWAITING_TABLES':
        case 'SCRUM.AWAITING_TABLES': {
          // Pick the lowest unused table.
          const used = new Set(s.pairings.map(p => p.tableId).filter((x): x is number => x !== undefined));
          let id = 1;
          while (used.has(id)) id++;
          action = { type: 'LOCK_IN_TABLE', team: 'A', tableId: id };
          break;
        }
        default:
          throw new Error(`unexpected phase ${s.phase}`);
      }
      const r = useGameStore.getState().dispatch(action);
      expect(r.ok, `dispatch failed at phase ${s.phase}: ${JSON.stringify(r)}`).toBe(true);
    }
    const final = useGameStore.getState().state!;
    expect(final.phase).toBe('GAME_COMPLETE');
    expect(final.pairings).toHaveLength(8);
    expect(new Set(final.pairings.map(p => p.tableId)).size).toBe(8);
  });
});

describe('gameStore — hot-seat mode does NOT auto-advance AI', () => {
  it('humanSeat is null', () => {
    useGameStore.getState().startGame(configHotSeat());
    expect(useGameStore.getState().humanSeat).toBeNull();
  });

  it('after team A locks defender, store does NOT auto-commit team B', () => {
    useGameStore.getState().startGame(configHotSeat());
    const r = useGameStore.getState().dispatch({
      type: 'LOCK_IN_DEFENDER', team: 'A', armyId: 'a0',
    });
    expect(r.ok).toBe(true);
    const s = useGameStore.getState().state!;
    // Phase stays at AWAITING_DEFENDERS — team B hasn't committed yet.
    expect(s.phase).toBe('ROUND_1.AWAITING_DEFENDERS');
    expect(selectCurrentMover(useGameStore.getState())).toBe('B');
  });
});

describe('gameStore — selectors', () => {
  it('selectViewerSeat returns the human in SP mode', () => {
    useGameStore.getState().startGame(configSpEasy());
    expect(selectViewerSeat(useGameStore.getState())).toBe('A');
  });

  it('selectViewerSeat returns the current mover in hot-seat mode', () => {
    useGameStore.getState().startGame(configHotSeat());
    expect(selectViewerSeat(useGameStore.getState())).toBe('A');
    useGameStore.getState().dispatch({
      type: 'LOCK_IN_DEFENDER', team: 'A', armyId: 'a0',
    });
    expect(selectViewerSeat(useGameStore.getState())).toBe('B');
  });

  it('selectViewerView returns the viewer-projected TeamView', () => {
    useGameStore.getState().startGame(configSpEasy());
    const view = selectViewerView(useGameStore.getState())!;
    expect(view.seat).toBe('A');
    expect(view.myView).toHaveLength(8);
  });
});

describe('gameStore — persistence', () => {
  it('persists state to localStorage on startGame', () => {
    useGameStore.getState().startGame(configSpEasy());
    const persisted = loadGame();
    expect(persisted).not.toBeNull();
    expect(persisted!.state.phase).toBe('ROUND_1.AWAITING_DEFENDERS');
  });

  it('persists updated state on dispatch', () => {
    useGameStore.getState().startGame(configSpEasy());
    useGameStore.getState().dispatch({
      type: 'LOCK_IN_DEFENDER', team: 'A', armyId: 'a0',
    });
    const persisted = loadGame();
    expect(persisted!.state.phase).toBe('ROUND_1.AWAITING_ATTACKERS');
  });

  it('clearGame is called on resetGame', () => {
    useGameStore.getState().startGame(configSpEasy());
    expect(loadGame()).not.toBeNull();
    useGameStore.getState().resetGame();
    expect(loadGame()).toBeNull();
  });
});
