import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../../App.js';
import { useGameStore } from '../../store/gameStore.js';
import { clearGame, loadGame } from '../../store/persistence.js';
import { viewFor } from '../../engine/state.js';
import { availableTables, easyActor } from '../../engine/ai.js';
import { buildTranscript, transcriptFilename } from './transcript.js';
import type { GameConfig } from '../Setup/types.js';
import type { Action, PairingState } from '../../engine/state.js';

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

// Drive an SP-vs-Easy game to GAME_COMPLETE through the store. The store's
// autoAdvance handles the AI's lock-ins and any system actions
// (RESOLVE_INITIAL_TOKEN), so the loop only has to dispatch the human
// (Team A)'s actions. Bypasses the React tree — these tests are about the
// GameOver screen, not the Play UI.
function completedGame(config: GameConfig): PairingState {
  useGameStore.getState().startGame(config);
  const human = easyActor('A');
  let safety = 200;
  while (
    useGameStore.getState().state!.phase !== 'GAME_COMPLETE'
    && safety-- > 0
  ) {
    const s = useGameStore.getState().state!;
    const view = viewFor(s, 'A');
    let action: Action;
    switch (s.phase) {
      case 'ROUND_1.AWAITING_DEFENDERS':
      case 'ROUND_2.AWAITING_DEFENDERS':
      case 'SCRUM.AWAITING_DEFENDERS':
        action = { type: 'LOCK_IN_DEFENDER', team: 'A', armyId: human.pickDefender(view) };
        break;
      case 'ROUND_1.AWAITING_ATTACKERS':
      case 'ROUND_2.AWAITING_ATTACKERS':
      case 'SCRUM.AWAITING_ATTACKERS': {
        const oppDef = s.step.defenders!.revealed!.b;
        action = { type: 'LOCK_IN_ATTACKERS', team: 'A', armyIds: human.pickAttackers(view, oppDef) };
        break;
      }
      case 'ROUND_1.AWAITING_REFUSALS':
      case 'ROUND_2.AWAITING_REFUSALS':
      case 'SCRUM.AWAITING_REFUSALS': {
        const sentAtMe = s.step.attackers!.revealed!.b;
        action = { type: 'LOCK_IN_REFUSAL', team: 'A', armyId: human.pickRefusal(view, sentAtMe) };
        break;
      }
      case 'ROUND_1.AWAITING_TABLES':
      case 'ROUND_2.AWAITING_TABLES':
      case 'SCRUM.AWAITING_TABLES':
        action = { type: 'LOCK_IN_TABLE', team: 'A', tableId: human.pickTable(view, availableTables(s)) };
        break;
      default:
        throw new Error(`unexpected phase for human dispatch: ${s.phase}`);
    }
    const r = useGameStore.getState().dispatch(action);
    if (!r.ok) throw new Error(`drive failed: ${JSON.stringify(r.error)}`);
  }
  const final = useGameStore.getState().state!;
  if (final.phase !== 'GAME_COMPLETE') throw new Error('did not converge');
  return final;
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

describe('GameOverScreen — final slate', () => {
  it('renders 8 table-ordered rows with each team\'s expected scores', () => {
    completedGame(spEasyConfig());
    render(<App />);

    const slate = screen.getByTestId('final-slate');
    // Eight rows, T1..T8, in table order.
    for (let t = 1; t <= 8; t++) {
      const row = within(slate).getByTestId(`slate-row-t${t}`);
      expect(row).toBeInTheDocument();
    }
    // Verdict text is one of: A wins / B wins / draw.
    expect(within(slate).getByTestId('slate-verdict').textContent).toMatch(
      /(Team A wins by \d+|Team B wins by \d+|Predicted draw)/,
    );
  });

  it('totals equal the column sums of A and B per-row scores', () => {
    completedGame(spEasyConfig(7));
    render(<App />);

    let sumA = 0;
    let sumB = 0;
    for (let t = 1; t <= 8; t++) {
      sumA += Number(screen.getByTestId(`slate-row-t${t}-a-score`).textContent);
      sumB += Number(screen.getByTestId(`slate-row-t${t}-b-score`).textContent);
    }
    expect(Number(screen.getByTestId('slate-total-a').textContent)).toBe(sumA);
    expect(Number(screen.getByTestId('slate-total-b').textContent)).toBe(sumB);
  });
});

describe('GameOverScreen — actions', () => {
  it('Play again returns to Setup with the previous config preserved', async () => {
    const user = userEvent.setup();
    const config = spEasyConfig(0xabcd);
    completedGame(config);
    render(<App />);

    await user.click(screen.getByTestId('play-again-button'));

    // Setup screen is now rendered, with the previous seed visible.
    const expectedSeedText = `0x${config.seed.toString(16).toUpperCase().padStart(8, '0')}`;
    expect(screen.getByTestId('seed-display').textContent).toBe(expectedSeedText);
    // Engine state cleared, but config preserved in the store so Setup
    // could seed itself.
    expect(useGameStore.getState().state).toBeNull();
    expect(useGameStore.getState().config?.seed).toBe(config.seed);
    // localStorage was cleared as part of play-again (a reload starts fresh).
    expect(loadGame()).toBeNull();
  });

  it('Export transcript triggers a download with the bundled state + config', async () => {
    const config = spEasyConfig(0xfeed);
    const finalState = completedGame(config);
    render(<App />);

    // Capture the JSON via the Blob constructor (jsdom's Blob doesn't
    // implement .text()). Stub URL.createObjectURL and intercept the
    // anchor click so we can read the download filename without writing
    // to disk.
    let capturedJson: string | null = null;
    let capturedFilename: string | null = null;
    const origBlob = globalThis.Blob;
    const origCreate = URL.createObjectURL;
    const origRevoke = URL.revokeObjectURL;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).Blob = function (parts: BlobPart[], opts?: BlobPropertyBag) {
      capturedJson = (parts as string[]).join('');
      return new origBlob(parts, opts);
    };
    URL.createObjectURL = vi.fn(() => 'blob:mock');
    URL.revokeObjectURL = vi.fn();

    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      capturedFilename = this.download;
    });

    try {
      const user = userEvent.setup();
      await user.click(screen.getByTestId('export-button'));
    } finally {
      clickSpy.mockRestore();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (globalThis as any).Blob = origBlob;
      URL.createObjectURL = origCreate;
      URL.revokeObjectURL = origRevoke;
    }

    expect(capturedFilename).toBe(transcriptFilename(buildTranscript(finalState, config)));
    expect(capturedJson).not.toBeNull();
    const parsed = JSON.parse(capturedJson!);
    expect(parsed.version).toBe(1);
    expect(parsed.config.seed).toBe(config.seed);
    expect(parsed.state.phase).toBe('GAME_COMPLETE');
    expect(parsed.state.pairings).toHaveLength(8);
  });
});

describe('buildTranscript — round-trips through JSON', () => {
  it('re-parsing the serialized transcript yields a structurally equal payload', () => {
    const config = spEasyConfig(0x1234);
    const finalState = completedGame(config);
    const transcript = buildTranscript(finalState, config);
    const json = JSON.stringify(transcript);
    const parsed = JSON.parse(json);
    expect(parsed).toEqual(transcript);
    // Spot-check: state survives untouched.
    expect(parsed.state.pairings).toHaveLength(finalState.pairings.length);
    expect(parsed.state.log.length).toBe(finalState.log.length);
  });
});
