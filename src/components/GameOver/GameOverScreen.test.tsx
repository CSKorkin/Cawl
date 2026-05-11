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

  // ── T9: per-row scores include the table modifier; totals reflect that. ──

  it('renders the modifier annotation when the chosen table carries a non-null symbol (plan example: "19 (+3 T5)")', () => {
    // Use the synthetic-injection path: complete a normal game, then
    // overwrite impactA so a known pairing's chosen table has a `+` (=
    // +3 in standard mode). Re-render FinalSlate directly against the
    // mutated state. This avoids depending on which seeded impacts land
    // on the AI's lowest-id table picks.
    const finalState = completedGame(spEasyConfig(0xc4f1));
    // Pick a pairing with a known A-base in a range where `+3` doesn't
    // clamp (any base ≤ 17 works). Find the first such pairing in table
    // order, force `+` on impactA at its chosen table, and `-` on impactB
    // at the same slot (symbolic inverse).
    const targetIdx = finalState.pairings.findIndex(p => {
      const aIdx = finalState.rosterA.indexOf(p.aArmy);
      const bIdx = finalState.rosterB.indexOf(p.bArmy);
      const base = finalState.matrix.viewA[aIdx]![bIdx]!.value as number;
      return p.tableId !== undefined && base <= 17;
    });
    expect(targetIdx).toBeGreaterThanOrEqual(0);
    const target = finalState.pairings[targetIdx]!;
    const aIdx = finalState.rosterA.indexOf(target.aArmy);
    const bIdx = finalState.rosterB.indexOf(target.bArmy);
    const slot = target.tableId! - 1;
    const baseA = finalState.matrix.viewA[aIdx]![bIdx]!.value as number;

    // Clone the matrix tensors with the override on the target cell.
    const newImpactA = finalState.matrix.impactA.map((row, i) =>
      row.map((cell, j) =>
        cell.map((sym, t) => (i === aIdx && j === bIdx && t === slot ? '+' : sym)),
      ),
    );
    const newImpactB = finalState.matrix.impactB.map((row, j) =>
      row.map((cell, i) =>
        cell.map((sym, t) => (j === bIdx && i === aIdx && t === slot ? '-' : sym)),
      ),
    );
    const patched: typeof finalState = {
      ...finalState,
      matrix: { ...finalState.matrix, impactA: newImpactA, impactB: newImpactB },
    };
    useGameStore.setState({ state: patched });

    render(<App />);

    // The target row shows the modified score (base + 3) prominently and a
    // small annotation chip "(+3 T#)" with data-modifier="+".
    const scoreSpan = screen.getByTestId(`slate-row-t${target.tableId}-a-score`);
    expect(Number(scoreSpan.textContent)).toBe(baseA + 3);
    const aMod = screen.getByTestId(`slate-row-t${target.tableId}-a-mod`);
    expect(aMod.getAttribute('data-modifier')).toBe('+');
    expect(aMod.textContent).toBe(`(+3 T${target.tableId})`);
    expect(aMod.className).toMatch(/emerald-300/);

    // B's view on the same matchup is the symbolic-inverse `-` → −3.
    const bMod = screen.getByTestId(`slate-row-t${target.tableId}-b-mod`);
    expect(bMod.getAttribute('data-modifier')).toBe('-');
    expect(bMod.textContent).toBe(`(-3 T${target.tableId})`);
  });

  it('totals include the clamped table-modifier delta from each team\'s own view (T6 corpus bug fixed)', () => {
    // The per-row score testids now show the MODIFIED contribution (base +
    // clamped delta), so summing them must equal the totals row. This
    // closes the gap that existed before T9, where the totals were
    // base-only and the AI win-rate corpus had to compute modified totals
    // separately. Exercises both teams' columns.
    const finalState = completedGame(spEasyConfig(0xc4f1));
    render(<App />);

    // Compute the expected modified totals directly from the engine state
    // (each team reads its own impactA / impactB; symbolic-inverse means
    // A's and B's deltas usually differ for the same matchup).
    function expectedTotal(team: 'A' | 'B'): number {
      let total = 0;
      for (const p of finalState.pairings) {
        if (p.tableId === undefined) continue;
        const aIdx = finalState.rosterA.indexOf(p.aArmy);
        const bIdx = finalState.rosterB.indexOf(p.bArmy);
        const baseCell = team === 'A'
          ? finalState.matrix.viewA[aIdx]![bIdx]!
          : finalState.matrix.viewB[bIdx]![aIdx]!;
        const baseVal = baseCell.value as number;
        const slot = p.tableId - 1;
        const sym = team === 'A'
          ? finalState.matrix.impactA[aIdx]?.[bIdx]?.[slot] ?? null
          : finalState.matrix.impactB[bIdx]?.[aIdx]?.[slot] ?? null;
        if (sym === null) {
          total += baseVal;
          continue;
        }
        // Clamped path matches FinalSlate's applyTableModifier usage.
        const delta = team === 'A'
          ? (sym === '+' ? Math.min(20 - baseVal, 3)
            : sym === '++' ? Math.min(20 - baseVal, 6)
            : sym === '-' ? Math.max(-baseVal, -3)
            : Math.max(-baseVal, -6))
          : (sym === '+' ? Math.min(20 - baseVal, 3)
            : sym === '++' ? Math.min(20 - baseVal, 6)
            : sym === '-' ? Math.max(-baseVal, -3)
            : Math.max(-baseVal, -6));
        total += baseVal + delta;
      }
      return total;
    }

    const renderedTotalA = Number(screen.getByTestId('slate-total-a').textContent);
    const renderedTotalB = Number(screen.getByTestId('slate-total-b').textContent);
    expect(renderedTotalA).toBe(expectedTotal('A'));
    expect(renderedTotalB).toBe(expectedTotal('B'));

    // And the per-row sums still equal the totals (this was the existing
    // invariant; it must continue to hold after the testid moved to the
    // inner `<span>{aFinal}</span>` element).
    let sumA = 0, sumB = 0;
    for (let t = 1; t <= 8; t++) {
      sumA += Number(screen.getByTestId(`slate-row-t${t}-a-score`).textContent);
      sumB += Number(screen.getByTestId(`slate-row-t${t}-b-score`).textContent);
    }
    expect(renderedTotalA).toBe(sumA);
    expect(renderedTotalB).toBe(sumB);
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
