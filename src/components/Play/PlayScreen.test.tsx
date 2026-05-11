import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../../App.js';
import { useGameStore, nextRequiredMover } from '../../store/gameStore.js';
import { clearGame } from '../../store/persistence.js';
import { viewFor } from '../../engine/state.js';
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

describe('PlayScreen — renders viewer\'s view with engine state', () => {
  it('shows both rosters, the matrix, and the step prompt for the human', () => {
    useGameStore.getState().startGame(spEasyConfig());
    render(<App />);

    // Both team rosters are visible.
    expect(screen.getByTestId('roster-play-a')).toBeInTheDocument();
    expect(screen.getByTestId('roster-play-b')).toBeInTheDocument();

    // 8x8 matrix renders 64 cells.
    for (let i = 0; i < 8; i++) {
      for (let j = 0; j < 8; j++) {
        expect(screen.getByTestId(`cell-${i}-${j}`)).toBeInTheDocument();
      }
    }

    // Step prompt for the human at R1 defenders.
    const prompt = screen.getByTestId('step-prompt');
    expect(prompt).toHaveTextContent(/Pick your defender/i);
  });

  it('matrix cells reflect viewFor(state, viewerSeat).myView values', () => {
    useGameStore.getState().startGame(spEasyConfig(7));
    render(<App />);

    const state = useGameStore.getState().state!;
    const view = viewFor(state, 'A');
    // Spot-check a few cells against the viewer's matrix.
    expect(screen.getByTestId('cell-0-0-score').textContent).toBe(String(view.myView[0]![0]!.value));
    expect(screen.getByTestId('cell-3-5-score').textContent).toBe(String(view.myView[3]![5]!.value));
    expect(screen.getByTestId('cell-7-7-score').textContent).toBe(String(view.myView[7]![7]!.value));
  });
});

describe('PlayScreen — selection is scoped to the clicked roster', () => {
  it('clicking a faction in Team A does not light up the same faction in Team B', async () => {
    const user = userEvent.setup();
    // Both rosters share Space Marines at slot 0.
    const sharedRosterA = [
      'space-marines', 'orks', 'tyranids', 'necrons',
      'asuryani', 'drukhari', 'tau-empire', 'death-guard',
    ] as const;
    const sharedRosterB = [
      'space-marines', 'thousand-sons', 'world-eaters', 'imperial-guard',
      'imperial-knights', 'grey-knights', 'sisters-of-battle', 'adeptus-custodes',
    ] as const;
    useGameStore.getState().startGame({
      mode: { kind: 'sp', tier: 'easy' },
      scoring: 'standard',
      matrixSource: 'generated',
      seed: 0xc4f1,
      rosterA: sharedRosterA,
      rosterB: sharedRosterB,
    });
    render(<App />);

    await user.click(screen.getByTestId('card-A-space-marines'));

    // Team A's Space Marines card is highlighted; Team B's is not.
    expect(screen.getByTestId('card-A-space-marines'))
      .toHaveAttribute('data-highlighted', 'true');
    expect(screen.getByTestId('card-B-space-marines'))
      .toHaveAttribute('data-highlighted', 'false');
  });
});

describe('PlayScreen — U7 pairing surface (cards land in triangle / slate)', () => {
  it('clicking a defender-eligible card moves it from roster to the triangle defender slot', async () => {
    const user = userEvent.setup();
    useGameStore.getState().startGame(spEasyConfig());
    render(<App />);

    const target = ROSTER_A[0];
    const card = screen.getByTestId(`card-A-${target}`);
    // Initially in the roster column (parent is a roster container).
    expect(card.closest('[data-testid="roster-play-a"]')).not.toBeNull();
    expect(card.closest('[data-testid="triangle-a"]')).toBeNull();

    await user.click(card);

    // After click, the same card now lives inside the team A triangle's
    // defender slot.
    const cardAfter = screen.getByTestId(`card-A-${target}`);
    expect(cardAfter.closest('[data-testid="triangle-a"]')).not.toBeNull();
    expect(cardAfter.closest('[data-testid="triangle-slot-a-defender"]')).not.toBeNull();
  });

  it('after one full round step, the two paired cards land in the slate column for that table', async () => {
    const user = userEvent.setup();
    useGameStore.getState().startGame(spEasyConfig());
    render(<App />);

    // Drive forward until at least one pairing has a tableId set — the
    // signal that one R1 step has fully completed (table picked).
    let safety = 12;
    while (useGameStore.getState().state!.pairings.every((p) => p.tableId === undefined)) {
      if (safety-- <= 0) throw new Error('did not converge to a pairing with a tableId');
      const s = useGameStore.getState().state!;
      const view = viewFor(s, 'A');
      switch (s.phase) {
        case 'ROUND_1.AWAITING_DEFENDERS': {
          await user.click(screen.getByTestId(`card-A-${view.myPool[0]!}`));
          await user.click(screen.getByTestId('confirm-button'));
          break;
        }
        case 'ROUND_1.AWAITING_ATTACKERS': {
          const ownDef = view.step.defenders!.revealed!.a;
          const eligible = view.myPool.filter((a) => a !== ownDef);
          await user.click(screen.getByTestId(`card-A-${eligible[0]!}`));
          await user.click(screen.getByTestId(`card-A-${eligible[1]!}`));
          await user.click(screen.getByTestId('confirm-button'));
          break;
        }
        case 'ROUND_1.AWAITING_REFUSALS': {
          const sentAtMe = view.step.attackers!.revealed!.b;
          await user.click(screen.getByTestId(`card-B-${sentAtMe[0]!}`));
          await user.click(screen.getByTestId('confirm-button'));
          break;
        }
        case 'ROUND_1.AWAITING_TABLES': {
          const tablePicker = screen.getByTestId('table-picker');
          const buttons = within(tablePicker).getAllByRole('button');
          await user.click(buttons[0]!);
          await user.click(screen.getByTestId('confirm-button'));
          break;
        }
        default:
          throw new Error(`unexpected phase ${s.phase}`);
      }
    }

    // After one round step, two pairings exist. At least one should have
    // a tableId set, and its two armies should render inside a slate column.
    const finished = useGameStore.getState().state!;
    const withTable = finished.pairings.find((p) => p.tableId !== undefined);
    expect(withTable).toBeDefined();
    const aCard = screen.getByTestId(`card-A-${withTable!.aArmy}`);
    const bCard = screen.getByTestId(`card-B-${withTable!.bArmy}`);
    expect(aCard.closest('[data-testid="slate-grid"]')).not.toBeNull();
    expect(bCard.closest('[data-testid="slate-grid"]')).not.toBeNull();
  });
});

describe('PlayScreen — full single-player vs Easy game smoke test', () => {
  it('drives a full game to GAME_COMPLETE through repeated UI interactions', async () => {
    const user = userEvent.setup();
    useGameStore.getState().startGame(spEasyConfig());
    render(<App />);

    // Sanity: human is up first (Team A).
    expect(useGameStore.getState().state!.phase).toBe('ROUND_1.AWAITING_DEFENDERS');

    // Loop: pick legal selections from current state, click confirm. The
    // store auto-advances the AI so each iteration corresponds to one human
    // action.
    let safety = 50;
    while (
      useGameStore.getState().state!.phase !== 'GAME_COMPLETE'
      && safety-- > 0
    ) {
      const s = useGameStore.getState().state!;
      // The store should have auto-advanced past any AI moves; the next
      // required mover is always the human.
      expect(nextRequiredMover(s)).toBe('A');

      const view = viewFor(s, 'A');

      switch (s.phase) {
        case 'ROUND_1.AWAITING_DEFENDERS':
        case 'ROUND_2.AWAITING_DEFENDERS':
        case 'SCRUM.AWAITING_DEFENDERS': {
          const armyId = view.myPool[0]!;
          await user.click(screen.getByTestId(`card-A-${armyId}`));
          await user.click(screen.getByTestId('confirm-button'));
          break;
        }
        case 'ROUND_1.AWAITING_ATTACKERS':
        case 'ROUND_2.AWAITING_ATTACKERS':
        case 'SCRUM.AWAITING_ATTACKERS': {
          const ownDef = view.step.defenders!.revealed!.a;
          const eligible = view.myPool.filter(a => a !== ownDef);
          await user.click(screen.getByTestId(`card-A-${eligible[0]!}`));
          await user.click(screen.getByTestId(`card-A-${eligible[1]!}`));
          await user.click(screen.getByTestId('confirm-button'));
          break;
        }
        case 'ROUND_1.AWAITING_REFUSALS':
        case 'ROUND_2.AWAITING_REFUSALS':
        case 'SCRUM.AWAITING_REFUSALS': {
          const sentAtMe = view.step.attackers!.revealed!.b;
          // Refusal flow is "click the attacker you accept" — the *other*
          // one of opp's two attackers is the engine-level refusal.
          const accepted = sentAtMe[0]!;
          const expectedRefused = sentAtMe[1]!;
          await user.click(screen.getByTestId(`card-B-${accepted}`));
          await user.click(screen.getByTestId('confirm-button'));
          // Last log entry should be a RefusalsRevealed naming the *other*
          // attacker as A's refusal.
          const log = useGameStore.getState().state!.log;
          const last = log[log.length - 1];
          if (last?.type === 'RefusalsRevealed') {
            expect(last.aRefused).toBe(expectedRefused);
          }
          break;
        }
        case 'ROUND_1.AWAITING_TABLES':
        case 'ROUND_2.AWAITING_TABLES':
        case 'SCRUM.AWAITING_TABLES': {
          // Pick the first available table button.
          const tablePicker = screen.getByTestId('table-picker');
          const firstButton = within(tablePicker).getAllByRole('button')[0]!;
          await user.click(firstButton);
          await user.click(screen.getByTestId('confirm-button'));
          break;
        }
        default:
          throw new Error(`unexpected phase ${s.phase}`);
      }
    }

    const final = useGameStore.getState().state!;
    expect(final.phase).toBe('GAME_COMPLETE');
    // Eight pairings on eight distinct tables.
    expect(final.pairings).toHaveLength(8);
    expect(new Set(final.pairings.map(p => p.tableId)).size).toBe(8);

    // GameOverScreen is now rendered.
    expect(screen.getByTestId('game-over')).toBeInTheDocument();
  });
});
