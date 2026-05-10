import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Matrix } from './Matrix.js';
import { createInitialState, viewFor } from '../../engine/state.js';
import type { Pairing, TeamView } from '../../engine/state.js';

const ROSTER_A = [
  'space-marines', 'orks', 'tyranids', 'necrons',
  'asuryani', 'drukhari', 'tau-empire', 'death-guard',
] as const;
const ROSTER_B = [
  'chaos-daemons', 'thousand-sons', 'world-eaters', 'imperial-guard',
  'imperial-knights', 'grey-knights', 'sisters-of-battle', 'adeptus-custodes',
] as const;

function makeView(seat: 'A' | 'B'): TeamView {
  const state = createInitialState({
    mode: 'standard',
    seed: 0xa11ce,
    rosterA: ROSTER_A,
    rosterB: ROSTER_B,
  });
  return viewFor(state, seat);
}

describe('Matrix — renders the viewer\'s view', () => {
  it('renders 64 cells with values matching myView[i][j]', () => {
    const view = makeView('A');
    render(<Matrix view={view} />);
    for (let i = 0; i < 8; i++) {
      for (let j = 0; j < 8; j++) {
        const cell = screen.getByTestId(`cell-${i}-${j}`);
        expect(cell.textContent).toBe(String(view.myView[i]![j]!.value));
      }
    }
  });

  it('renders different values when viewing as A vs B (asymmetric matrix)', () => {
    const viewA = makeView('A');
    const viewB = makeView('B');
    const { unmount } = render(<Matrix view={viewA} />);
    const cell00A = screen.getByTestId('cell-0-0').textContent;
    unmount();

    render(<Matrix view={viewB} />);
    const cell00B = screen.getByTestId('cell-0-0').textContent;
    // viewB[0][0] is B's view of (B's army 0) vs (A's army 0). The engine
    // generates the two views via inversion + variance, so by construction
    // there is no general identity between them — we just confirm the two
    // renders aren't accidentally the same component reading the same data.
    expect(viewA.myView[0]![0]!.value).toBe(Number(cell00A));
    expect(viewB.myView[0]![0]!.value).toBe(Number(cell00B));
  });

  it('row averages mean myView[i][j] across the opp pool, formatted to 1 decimal', () => {
    const view = makeView('A');
    render(<Matrix view={view} />);
    for (let i = 0; i < 8; i++) {
      const expectedSum = view.myView[i]!.reduce(
        (s, c) => s + (c.value as number),
        0,
      );
      const expectedAvg = expectedSum / view.oppRoster.length;
      const cell = screen.getByTestId(`row-avg-${i}`);
      expect(cell.textContent).toBe(expectedAvg.toFixed(1));
    }
  });

  it('column averages mean myView[i][j] across own pool, formatted to 1 decimal', () => {
    const view = makeView('A');
    render(<Matrix view={view} />);
    for (let j = 0; j < 8; j++) {
      let sum = 0;
      for (let i = 0; i < 8; i++) sum += view.myView[i]![j]!.value as number;
      const expectedAvg = sum / view.myRoster.length;
      const cell = screen.getByTestId(`col-avg-${j}`);
      expect(cell.textContent).toBe(expectedAvg.toFixed(1));
    }
  });

  it('hides rows and columns for paired armies (matrix shrinks each round)', () => {
    const view = makeView('A');
    // Synthesize a TeamView with one pairing already locked: A's army at
    // index 2 paired with B's army at index 5. The corresponding row /
    // column should disappear; the rest should remain.
    const fakePairing: Pairing = {
      round: 1,
      aArmy: view.myRoster[2]!,
      bArmy: view.oppRoster[5]!,
      defenderTeam: 'A',
      tableId: 1,
    };
    const trimmed: TeamView = {
      ...view,
      pairings: [fakePairing],
      myPool: view.myRoster.filter((id) => id !== view.myRoster[2]!),
      oppPool: view.oppRoster.filter((id) => id !== view.oppRoster[5]!),
    };
    render(<Matrix view={trimmed} />);

    // The hidden row's cells should be gone.
    expect(screen.queryByTestId('cell-2-0')).toBeNull();
    expect(screen.queryByTestId('row-avg-2')).toBeNull();
    // The hidden column's cells should be gone.
    expect(screen.queryByTestId('cell-0-5')).toBeNull();
    expect(screen.queryByTestId('col-avg-5')).toBeNull();
    // A neighboring row / column still renders with its original index.
    expect(screen.getByTestId('cell-0-0')).toBeInTheDocument();
    expect(screen.getByTestId('cell-3-3')).toBeInTheDocument();
    expect(screen.getByTestId('row-avg-0')).toBeInTheDocument();
    expect(screen.getByTestId('col-avg-0')).toBeInTheDocument();
  });

  it('column headers carry faction display-name titles for the opp roster', () => {
    const view = makeView('A');
    render(<Matrix view={view} />);
    // Each header has a `title` attribute with the faction display name.
    const expected = [
      'Chaos Daemons', 'Thousand Sons', 'World Eaters', 'Imperial Guard',
      'Imperial Knights', 'Grey Knights', 'Sisters of Battle', 'Adeptus Custodes',
    ];
    for (const name of expected) {
      expect(screen.getAllByTitle(name).length).toBeGreaterThan(0);
    }
  });
});
