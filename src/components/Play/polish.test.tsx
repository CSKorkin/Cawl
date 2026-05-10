// U6 polish: tests for reveal flash, token pulse, log panel
// (collapsible / color-banded / hover detail), and atlas half-tier
// rendering. Lives alongside the play components since each test is a
// thin DOM probe of one polish behavior.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, act, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../../App.js';
import { useGameStore } from '../../store/gameStore.js';
import { clearGame } from '../../store/persistence.js';
import { Matrix } from './Matrix.js';
import { LogPanel } from './LogPanel.js';
import { createInitialState, viewFor } from '../../engine/state.js';
import type { LogEntry } from '../../engine/log.js';
import type { Action, TeamView } from '../../engine/state.js';
import type { GameConfig } from '../Setup/types.js';

const ROSTER_A = [
  'space-marines', 'orks', 'tyranids', 'necrons',
  'asuryani', 'drukhari', 'tau-empire', 'death-guard',
] as const;
const ROSTER_B = [
  'chaos-daemons', 'thousand-sons', 'world-eaters', 'imperial-guard',
  'imperial-knights', 'grey-knights', 'sisters-of-battle', 'adeptus-custodes',
] as const;

function spEasyConfig(seed = 0xc4f1): GameConfig {
  return {
    mode: { kind: 'sp', tier: 'easy' },
    scoring: 'standard',
    matrixSource: 'generated',
    seed,
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

describe('U6 — reveal flash on freshly-revealed slots', () => {
  it('flashes the two defender slots after a defender lock-in collapses the reveal', () => {
    vi.useFakeTimers();
    try {
      useGameStore.getState().startGame(spEasyConfig());
      render(<App />);

      // Dispatch the human's defender. SP mode auto-advances the AI →
      // both pendings collapse → DefendersRevealed log entry appears.
      act(() => {
        useGameStore.getState().dispatch({
          type: 'LOCK_IN_DEFENDER', team: 'A', armyId: 'space-marines',
        });
      });

      const last = useGameStore.getState().state!.log.at(-1)!;
      expect(last.type).toBe('DefendersRevealed');
      const aArmy = (last as { aArmy: string }).aArmy;
      const bArmy = (last as { bArmy: string }).bArmy;

      // U7: rosters now render PairingCard instead of ArmySlot. Cards
      // carry the same data-flashing attribute regardless of which
      // container they currently live in.
      const aCard = screen.getByTestId(`card-A-${aArmy}`);
      const bCard = screen.getByTestId(`card-B-${bArmy}`);
      expect(aCard.getAttribute('data-flashing')).toBe('true');
      expect(bCard.getAttribute('data-flashing')).toBe('true');

      // After 600ms the flash should clear.
      act(() => { vi.advanceTimersByTime(700); });
      expect(aCard.getAttribute('data-flashing')).toBe('false');
      expect(bCard.getAttribute('data-flashing')).toBe('false');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('U6 — token chip pulse on holder change', () => {
  it('the token chip remounts (key bump) when the holder changes', () => {
    useGameStore.getState().startGame(spEasyConfig());
    render(<App />);

    const before = screen.getByTestId('token-chip');
    expect(before.getAttribute('data-holder')).toBe('');

    // Drive the game until ROUND_1.AWAITING_TABLES is reached and the
    // RESOLVE_INITIAL_TOKEN system action sets the token holder.
    let safety = 50;
    while (
      useGameStore.getState().state!.tokenHolder === null
      && useGameStore.getState().state!.phase !== 'GAME_COMPLETE'
      && safety-- > 0
    ) {
      const s = useGameStore.getState().state!;
      const v = viewFor(s, 'A');
      // Pick the first legal action for whatever phase we're in. We don't
      // care about quality — just need to advance to the table phase.
      let action: Action;
      switch (s.phase) {
        case 'ROUND_1.AWAITING_DEFENDERS':
          action = { type: 'LOCK_IN_DEFENDER', team: 'A', armyId: v.myPool[0]! };
          break;
        case 'ROUND_1.AWAITING_ATTACKERS': {
          const ownDef = s.step.defenders!.revealed!.a;
          const eligible = v.myPool.filter((a) => a !== ownDef);
          action = { type: 'LOCK_IN_ATTACKERS', team: 'A', armyIds: [eligible[0]!, eligible[1]!] };
          break;
        }
        case 'ROUND_1.AWAITING_REFUSALS':
          action = { type: 'LOCK_IN_REFUSAL', team: 'A', armyId: s.step.attackers!.revealed!.b[0]! };
          break;
        default:
          throw new Error(`unexpected phase ${s.phase}`);
      }
      act(() => { useGameStore.getState().dispatch(action); });
    }

    const after = screen.getByTestId('token-chip');
    // Holder is now A or B (whoever won the roll-off).
    expect(['A', 'B']).toContain(after.getAttribute('data-holder'));
  });
});

describe('U6 — log panel polish', () => {
  it('starts expanded, toggle hides entries, and entries carry color + type metadata', () => {
    const entries: readonly LogEntry[] = [
      { type: 'DefendersRevealed', round: 1, aArmy: 'orks', bArmy: 'necrons' },
      { type: 'TableChosen', round: 1, tableId: 1, team: 'A', defenderArmy: 'orks' },
    ];
    render(<LogPanel entries={entries} />);

    const first = screen.getByTestId('log-entry-0');
    expect(first.getAttribute('data-entry-type')).toBe('DefendersRevealed');
    // Color band class is applied (sky for defenders).
    expect(first.className).toMatch(/text-sky-300/);

    const second = screen.getByTestId('log-entry-1');
    expect(second.getAttribute('data-entry-type')).toBe('TableChosen');
    expect(second.className).toMatch(/text-emerald-300/);

    // Hover detail surfaces as a title= attribute.
    expect(second.getAttribute('title')).toMatch(/Table 1/);
  });

  it('clicking the toggle hides and re-shows the entries', async () => {
    const user = userEvent.setup();
    const entries: readonly LogEntry[] = [
      { type: 'TokenRollOff', winner: 'A' },
    ];
    render(<LogPanel entries={entries} />);
    expect(screen.getByTestId('log-entry-0')).toBeInTheDocument();
    await user.click(screen.getByTestId('log-toggle'));
    expect(screen.queryByTestId('log-entry-0')).toBeNull();
    await user.click(screen.getByTestId('log-toggle'));
    expect(screen.getByTestId('log-entry-0')).toBeInTheDocument();
  });
});

describe('U6 — atlas half-tier visual differentiation', () => {
  it('atlas cells with value 2.5 / 3.5 render with italic styling', () => {
    // Build an atlas state and patch one cell to a half-tier so the test
    // doesn't depend on lucky RNG.
    const base = createInitialState({
      mode: 'atlas',
      seed: 0xa,
      rosterA: ROSTER_A,
      rosterB: ROSTER_B,
    });
    // Mutate viewA[0][0] to 2.5 for the assertion, leave the rest as is.
    const patchedViewA = base.matrix.viewA.map((row, i) =>
      row.map((cell, j) => (
        i === 0 && j === 0 ? { mode: 'atlas' as const, value: 2.5 as 2.5 } : cell
      )),
    );
    const view: TeamView = {
      ...viewFor(base, 'A'),
      myView: patchedViewA,
    };
    render(<Matrix view={view} />);
    const cell00 = screen.getByTestId('cell-0-0');
    expect(cell00.className).toMatch(/italic/);
    // A neighbouring whole-tier cell does NOT get italic.
    const otherCell = screen.getByTestId('cell-0-1');
    expect(otherCell.className).not.toMatch(/italic/);
  });
});
