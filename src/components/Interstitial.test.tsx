import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../App.js';
import { useGameStore } from '../store/gameStore.js';
import { clearGame } from '../store/persistence.js';
import { viewFor } from '../engine/state.js';
import { availableTables, easyActor, nextTableTeam } from '../engine/ai.js';
import type { GameConfig } from './Setup/types.js';
import type { Action, PairingState } from '../engine/state.js';
import type { Team } from '../engine/log.js';

const ROSTER_A = [
  'space-marines', 'orks', 'tyranids', 'necrons',
  'asuryani', 'drukhari', 'tau-empire', 'death-guard',
] as const;
const ROSTER_B = [
  'chaos-daemons', 'thousand-sons', 'world-eaters', 'imperial-guard',
  'imperial-knights', 'grey-knights', 'sisters-of-battle', 'adeptus-custodes',
] as const;

function hotSeatConfig(seed = 0xc4f1): GameConfig {
  return {
    mode: { kind: 'hot-seat' },
    scoring: 'standard',
    matrixSource: 'generated',
    seed,
    rosterA: ROSTER_A,
    rosterB: ROSTER_B,
  };
}

function spConfig(): GameConfig {
  return {
    mode: { kind: 'sp', tier: 'easy' },
    scoring: 'standard',
    matrixSource: 'generated',
    seed: 0xc4f1,
    rosterA: ROSTER_A,
    rosterB: ROSTER_B,
  };
}

beforeEach(() => {
  clearGame();
  useGameStore.setState({
    state: null,
    config: null,
    humanSeat: null,
    pendingHandoff: null,
    _aiActorA: null,
    _aiActorB: null,
  });
});

describe('Interstitial — store wiring', () => {
  it('SP mode never sets pendingHandoff', () => {
    useGameStore.getState().startGame(spConfig());
    expect(useGameStore.getState().pendingHandoff).toBeNull();
    useGameStore.getState().dispatch({
      type: 'LOCK_IN_DEFENDER', team: 'A', armyId: 'space-marines',
    });
    // SP auto-advances the AI, returning to A's turn — still no handoff.
    expect(useGameStore.getState().pendingHandoff).toBeNull();
  });

  it('hot-seat sets pendingHandoff = B after A locks defender', () => {
    useGameStore.getState().startGame(hotSeatConfig());
    expect(useGameStore.getState().pendingHandoff).toBeNull();
    const r = useGameStore.getState().dispatch({
      type: 'LOCK_IN_DEFENDER', team: 'A', armyId: 'space-marines',
    });
    expect(r.ok).toBe(true);
    expect(useGameStore.getState().pendingHandoff).toBe('B');
  });

  it('hot-seat sets pendingHandoff = A after B completes defender reveal', () => {
    useGameStore.getState().startGame(hotSeatConfig());
    useGameStore.getState().dispatch({
      type: 'LOCK_IN_DEFENDER', team: 'A', armyId: 'space-marines',
    });
    useGameStore.getState().dismissHandoff();
    useGameStore.getState().dispatch({
      type: 'LOCK_IN_DEFENDER', team: 'B', armyId: 'chaos-daemons',
    });
    // Defender phase reveal collapsed → AWAITING_ATTACKERS, mover = A.
    expect(useGameStore.getState().state!.phase).toBe('ROUND_1.AWAITING_ATTACKERS');
    expect(useGameStore.getState().pendingHandoff).toBe('A');
  });

  it('dismissHandoff clears the flag', () => {
    useGameStore.getState().startGame(hotSeatConfig());
    useGameStore.getState().dispatch({
      type: 'LOCK_IN_DEFENDER', team: 'A', armyId: 'space-marines',
    });
    expect(useGameStore.getState().pendingHandoff).toBe('B');
    useGameStore.getState().dismissHandoff();
    expect(useGameStore.getState().pendingHandoff).toBeNull();
  });

  it('table phases do NOT trigger an interstitial (table picks are public)', () => {
    // Drive the game forward in hot-seat to ROUND_1.AWAITING_TABLES.
    useGameStore.getState().startGame(hotSeatConfig());
    driveHotSeatTo(s => s.phase === 'ROUND_1.AWAITING_TABLES');
    // We're in tables now — store should not gate this with a handoff.
    expect(useGameStore.getState().pendingHandoff).toBeNull();
    // Picking a table should not set one either.
    const s = useGameStore.getState().state!;
    const team = nextHotSeatTableTeam(s);
    const tables = availableTables(s);
    useGameStore.getState().dispatch({
      type: 'LOCK_IN_TABLE', team, tableId: tables[0]!,
    });
    expect(useGameStore.getState().pendingHandoff).toBeNull();
  });
});

describe('Interstitial — UI behavior', () => {
  it('App renders Interstitial in place of PlayScreen while pendingHandoff is set', () => {
    useGameStore.getState().startGame(hotSeatConfig());
    useGameStore.getState().dispatch({
      type: 'LOCK_IN_DEFENDER', team: 'A', armyId: 'space-marines',
    });
    render(<App />);
    expect(screen.getByTestId('interstitial')).toBeInTheDocument();
    // Crucially: PlayScreen pieces (matrix, rosters, step-prompt) are NOT in
    // the DOM. This is the whole point of the gate.
    expect(screen.queryByTestId('matrix')).toBeNull();
    expect(screen.queryByTestId('roster-play-a')).toBeNull();
    expect(screen.queryByTestId('roster-play-b')).toBeNull();
    expect(screen.queryByTestId('step-prompt')).toBeNull();
  });

  it('clicking Continue dismisses the interstitial and reveals PlayScreen', async () => {
    const user = userEvent.setup();
    useGameStore.getState().startGame(hotSeatConfig());
    useGameStore.getState().dispatch({
      type: 'LOCK_IN_DEFENDER', team: 'A', armyId: 'space-marines',
    });
    render(<App />);
    await user.click(screen.getByTestId('interstitial-continue'));
    expect(screen.queryByTestId('interstitial')).toBeNull();
    expect(screen.getByTestId('matrix')).toBeInTheDocument();
    expect(screen.getByTestId('step-prompt')).toBeInTheDocument();
  });

  it('information-hiding invariant: every dispatch that hands control to the other team gates the next render', () => {
    // The spec invariant ("viewFor(B) is never rendered while pendingA is
    // set") is enforced at the App-routing layer: while pendingHandoff is
    // set, App swaps PlayScreen for the Interstitial. So the moment of
    // truth is *immediately after* a dispatch — if the next required mover
    // is the opposite team, pendingHandoff must be set BEFORE the next
    // render. Once the user dismisses (i.e. has physically passed the
    // device), it's correct for pendingHandoff to be null even if engine
    // pendings remain set, because viewFor(opp) strips them.
    useGameStore.getState().startGame(hotSeatConfig());

    let safety = 200;
    while (
      useGameStore.getState().state!.phase !== 'GAME_COMPLETE'
      && safety-- > 0
    ) {
      if (useGameStore.getState().pendingHandoff !== null) {
        useGameStore.getState().dismissHandoff();
        continue;
      }
      const s = useGameStore.getState().state!;
      const team = nextHotSeatTeam(s);
      const action = legalActionFor(s, team);
      const r = useGameStore.getState().dispatch(action);
      expect(r.ok).toBe(true);

      // Post-dispatch invariant: if the engine is now in a secret-choice
      // phase and the next mover is the opposite team, the handoff must
      // be in place.
      const newState = useGameStore.getState().state!;
      const newPhase = newState.phase;
      const inSecretPhase =
        newPhase.endsWith('AWAITING_DEFENDERS')
        || newPhase.endsWith('AWAITING_ATTACKERS')
        || newPhase.endsWith('AWAITING_REFUSALS');
      if (inSecretPhase) {
        const nextTeam = nextHotSeatTeam(newState);
        if (nextTeam !== team) {
          expect(useGameStore.getState().pendingHandoff).toBe(nextTeam);
        }
      }
    }
    expect(useGameStore.getState().state!.phase).toBe('GAME_COMPLETE');
  });

  it('App swap rule: while pendingHandoff is set, no PlayScreen DOM is reachable (renders Interstitial)', () => {
    useGameStore.getState().startGame(hotSeatConfig());
    useGameStore.getState().dispatch({
      type: 'LOCK_IN_DEFENDER', team: 'A', armyId: 'space-marines',
    });
    // pendingHandoff = 'B' now. App must render Interstitial; matrix DOM
    // should be entirely absent (no risk of B glimpsing it).
    render(<App />);
    expect(screen.getByTestId('interstitial')).toBeInTheDocument();
    expect(screen.queryByTestId('matrix')).toBeNull();
    expect(screen.queryByTestId('roster-play-a')).toBeNull();
    expect(screen.queryByTestId('roster-play-b')).toBeNull();
  });

  it('full hot-seat game: interstitial appears between every secret-choice handoff', () => {
    useGameStore.getState().startGame(hotSeatConfig(0x77));
    let interstitialCount = 0;
    let safety = 200;
    while (
      useGameStore.getState().state!.phase !== 'GAME_COMPLETE'
      && safety-- > 0
    ) {
      if (useGameStore.getState().pendingHandoff !== null) {
        interstitialCount++;
        useGameStore.getState().dismissHandoff();
        continue;
      }
      const s = useGameStore.getState().state!;
      const team = nextHotSeatTeam(s);
      const action = legalActionFor(s, team);
      const r = useGameStore.getState().dispatch(action);
      expect(r.ok).toBe(true);
    }
    // Each secret-choice phase contributes 2 handoffs (A→B for B's pick,
    // B→A for the next phase). 8 pairings × ~3 secret phases per pairing,
    // minus the scrum's auto-paired bits — call it "comfortably more than
    // 10". A precise count would be brittle; the lower bound + the
    // invariant test above pin down the behavior.
    expect(interstitialCount).toBeGreaterThanOrEqual(10);
  });
});

// ── helpers ──────────────────────────────────────────────────────────────

function nextHotSeatTeam(s: PairingState): Team {
  // Pick the slot keyed to the current phase — the previous phase's slot
  // can linger with `revealed` set after the phase advances and would
  // wrongly read as "A is next."
  const phase = s.phase;
  let slot: { readonly pendingA?: unknown; readonly pendingB?: unknown } | undefined;
  if (phase.endsWith('AWAITING_DEFENDERS')) slot = s.step.defenders;
  else if (phase.endsWith('AWAITING_ATTACKERS')) slot = s.step.attackers;
  else if (phase.endsWith('AWAITING_REFUSALS')) slot = s.step.refusals;
  else return nextTableTeam(s);
  if (slot === undefined || slot.pendingA === undefined) return 'A';
  return 'B';
}

function nextHotSeatTableTeam(s: PairingState): Team {
  return nextTableTeam(s);
}

function legalActionFor(s: PairingState, team: Team): Action {
  const view = viewFor(s, team);
  const actor = easyActor(team);
  switch (s.phase) {
    case 'ROUND_1.AWAITING_DEFENDERS':
    case 'ROUND_2.AWAITING_DEFENDERS':
    case 'SCRUM.AWAITING_DEFENDERS':
      return { type: 'LOCK_IN_DEFENDER', team, armyId: actor.pickDefender(view) };
    case 'ROUND_1.AWAITING_ATTACKERS':
    case 'ROUND_2.AWAITING_ATTACKERS':
    case 'SCRUM.AWAITING_ATTACKERS': {
      const oppDef = team === 'A'
        ? s.step.defenders!.revealed!.b
        : s.step.defenders!.revealed!.a;
      return { type: 'LOCK_IN_ATTACKERS', team, armyIds: actor.pickAttackers(view, oppDef) };
    }
    case 'ROUND_1.AWAITING_REFUSALS':
    case 'ROUND_2.AWAITING_REFUSALS':
    case 'SCRUM.AWAITING_REFUSALS': {
      const sentAtMe = team === 'A'
        ? s.step.attackers!.revealed!.b
        : s.step.attackers!.revealed!.a;
      return { type: 'LOCK_IN_REFUSAL', team, armyId: actor.pickRefusal(view, sentAtMe) };
    }
    case 'ROUND_1.AWAITING_TABLES':
    case 'ROUND_2.AWAITING_TABLES':
    case 'SCRUM.AWAITING_TABLES':
      return {
        type: 'LOCK_IN_TABLE',
        team,
        tableId: actor.pickTable(view, availableTables(s)),
      };
    default:
      throw new Error(`legalActionFor: unsupported phase ${s.phase}`);
  }
}

function driveHotSeatTo(stop: (s: PairingState) => boolean): void {
  let safety = 200;
  while (!stop(useGameStore.getState().state!) && safety-- > 0) {
    if (useGameStore.getState().pendingHandoff !== null) {
      useGameStore.getState().dismissHandoff();
      continue;
    }
    const s = useGameStore.getState().state!;
    const team = nextHotSeatTeam(s);
    const action = legalActionFor(s, team);
    const r = useGameStore.getState().dispatch(action);
    if (!r.ok) throw new Error(`drive failed: ${JSON.stringify(r.error)}`);
  }
}
