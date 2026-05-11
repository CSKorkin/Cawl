import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SetupScreen } from './SetupScreen.js';
import { FACTIONS } from '../../factions.js';

describe('SetupScreen — common layout', () => {
  it('renders mode, scoring, matrix-source pickers and both rosters', () => {
    render(<SetupScreen onStart={() => {}} />);
    expect(screen.getByText(/Mode/i)).toBeInTheDocument();
    expect(screen.getByText(/Scoring/i)).toBeInTheDocument();
    expect(screen.getByText(/Matrix source/i)).toBeInTheDocument();
    expect(screen.getByTestId('roster-a')).toBeInTheDocument();
    expect(screen.getByTestId('roster-b')).toBeInTheDocument();
  });

  it('Hard tier radio is disabled in single-player mode', () => {
    render(<SetupScreen onStart={() => {}} />);
    const hardRadio = screen.getByLabelText(/Hard/i) as HTMLInputElement;
    expect(hardRadio).toBeDisabled();
  });

  it('switching to hot-seat hides the AI tier sub-radio', async () => {
    const user = userEvent.setup();
    render(<SetupScreen onStart={() => {}} />);
    expect(screen.queryByText(/AI tier/i)).toBeInTheDocument();
    await user.click(screen.getByLabelText(/Hot-seat/i));
    expect(screen.queryByText(/AI tier/i)).not.toBeInTheDocument();
  });
});

describe('SetupScreen — Generated mode (default)', () => {
  it('auto-populates 8 distinct factions per team on initial render', () => {
    render(<SetupScreen onStart={() => {}} />);
    const validIds = new Set(FACTIONS.map((f) => f.id));
    for (const team of ['a', 'b'] as const) {
      const rosterEl = screen.getByTestId(`roster-${team}`);
      const slotNames: string[] = [];
      for (let i = 0; i < 8; i++) {
        const nameEl = within(rosterEl).getByTestId(`team-${team}-slot-${i}-name`);
        slotNames.push(nameEl.textContent ?? '');
      }
      // 8 slots filled, all valid faction display names, no within-team duplicates.
      expect(new Set(slotNames).size).toBe(8);
      for (const name of slotNames) {
        const matchesValidFaction = FACTIONS.some((f) => f.displayName === name);
        expect(matchesValidFaction, `slot name "${name}" not a valid faction`).toBe(true);
      }
      void validIds; // silence noUnusedLocals if any future cleanup
    }
  });

  it('hides the dropdown <select> in Generated mode (read-only display)', () => {
    render(<SetupScreen onStart={() => {}} />);
    const rosterA = screen.getByTestId('roster-a');
    const slot0 = within(rosterA).getByTestId('team-a-slot-0');
    expect(within(slot0).queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('Re-roll changes the displayed seed AND the rosters', async () => {
    const user = userEvent.setup();
    render(<SetupScreen onStart={() => {}} />);
    const seedDisplay = screen.getByTestId('seed-display');
    const initialSeed = seedDisplay.textContent;
    const initialName0 = screen.getByTestId('team-a-slot-0-name').textContent;

    let changed = false;
    for (let attempt = 0; attempt < 8 && !changed; attempt++) {
      await user.click(screen.getByRole('button', { name: /Re-roll/i }));
      const newSeed = seedDisplay.textContent;
      const newName0 = screen.getByTestId('team-a-slot-0-name').textContent;
      if (newSeed !== initialSeed || newName0 !== initialName0) changed = true;
    }
    expect(changed).toBe(true);
    expect(seedDisplay.textContent).toMatch(/^0x[0-9A-F]{8}$/);
  });

  it('Start button is enabled in Generated SP mode (default)', () => {
    render(<SetupScreen onStart={() => {}} />);
    expect(screen.getByRole('button', { name: /Start/i })).not.toBeDisabled();
  });

  it('Start button is enabled when Hot-seat is selected (U4 onwards)', async () => {
    const user = userEvent.setup();
    render(<SetupScreen onStart={() => {}} />);
    await user.click(screen.getByLabelText(/Hot-seat/i));
    expect(screen.getByRole('button', { name: /Start/i })).not.toBeDisabled();
  });
});

describe('SetupScreen — Entered mode (default: cell-by-cell grid)', () => {
  it('switching to Entered defaults to grid mode and shows the rosters first', async () => {
    const user = userEvent.setup();
    render(<SetupScreen onStart={() => {}} />);
    await user.click(screen.getByLabelText(/Entered/i));
    // Rosters appear immediately so the user can pick factions BEFORE
    // entering scores.
    expect(screen.getByTestId('roster-a')).toBeInTheDocument();
    expect(screen.getByTestId('roster-b')).toBeInTheDocument();
    // Grid mode is the default selection in MatrixEntry's method radio.
    expect((screen.getByRole('radio', { name: /Cell-by-cell grid/i }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole('radio', { name: /Paste from sheet/i }) as HTMLInputElement).checked).toBe(false);
  });

  it('Start is disabled until both rosters AND the matrix are filled', async () => {
    const user = userEvent.setup();
    render(<SetupScreen onStart={() => {}} />);
    await user.click(screen.getByLabelText(/Entered/i));
    // Initial Entered + empty rosters: hint nudges roster pick first.
    expect(screen.getByRole('button', { name: /Start/i })).toBeDisabled();
    expect(screen.getByTestId('start-disabled-reason')).toHaveTextContent(/Pick all 16 factions/i);
    expect(screen.getByTestId('grid-blocked-hint')).toHaveTextContent(/before entering matrix scores/i);
  });

  it('grid header cells render the chosen faction logo + name once a roster slot is filled', async () => {
    const user = userEvent.setup();
    render(<SetupScreen onStart={() => {}} />);
    await user.click(screen.getByLabelText(/Entered/i));
    // Pick Team A slot 0 = Space Marines.
    const rosterA = screen.getByTestId('roster-a');
    const slot0 = within(within(rosterA).getByTestId('team-a-slot-0')).getByRole('combobox') as HTMLSelectElement;
    await user.selectOptions(slot0, 'Space Marines');
    // The grid is visible (rendered above/below the rosters depending on
    // method). Find the matrix-grid-entry container and look for the
    // faction name label inside its first row header.
    const grid = screen.getByTestId('matrix-grid-entry');
    expect(within(grid).getAllByText('Space Marines').length).toBeGreaterThan(0);
  });

  it('disables already-chosen factions in OTHER slots within the same team', async () => {
    const user = userEvent.setup();
    render(<SetupScreen onStart={() => {}} />);
    await user.click(screen.getByLabelText(/Entered/i));
    const rosterA = screen.getByTestId('roster-a');
    const slot0Select = within(within(rosterA).getByTestId('team-a-slot-0')).getByRole('combobox') as HTMLSelectElement;
    await user.selectOptions(slot0Select, 'Space Marines');

    for (let i = 1; i < 8; i++) {
      const slotI = within(rosterA).getByTestId(`team-a-slot-${i}`);
      const selectI = within(slotI).getByRole('combobox') as HTMLSelectElement;
      const option = Array.from(selectI.options).find((o) => o.text === 'Space Marines');
      expect(option?.disabled, `slot ${i} should disable Space Marines`).toBe(true);
    }

    // Cross-team duplicates remain allowed.
    const rosterB = screen.getByTestId('roster-b');
    const teamBSlot0 = within(within(rosterB).getByTestId('team-b-slot-0')).getByRole('combobox') as HTMLSelectElement;
    const optionB = Array.from(teamBSlot0.options).find((o) => o.text === 'Space Marines');
    expect(optionB?.disabled).toBe(false);
  });

  it('clicking Re-roll while in Entered mode is impossible (the button is hidden)', async () => {
    const user = userEvent.setup();
    render(<SetupScreen onStart={() => {}} />);
    await user.click(screen.getByLabelText(/Entered/i));
    expect(screen.queryByRole('button', { name: /Re-roll/i })).not.toBeInTheDocument();
  });
});

describe('SetupScreen — Entered mode (paste-from-sheet path)', () => {
  const VALID_PASTE = Array(8)
    .fill(Array(8).fill('Y').join('\t'))
    .join('\n');

  async function selectPasteMode(user: ReturnType<typeof userEvent.setup>): Promise<void> {
    await user.click(screen.getByLabelText(/Entered/i));
    await user.click(screen.getByRole('radio', { name: /Paste from sheet/i }));
  }

  async function pasteValidMatrix(user: ReturnType<typeof userEvent.setup>): Promise<void> {
    await selectPasteMode(user);
    const textarea = screen.getByTestId('matrix-paste-textarea');
    await user.click(textarea);
    await user.paste(VALID_PASTE);
    await user.click(screen.getByTestId('matrix-paste-validate'));
  }

  it('switching to paste mode hides the rosters until the matrix is validated', async () => {
    const user = userEvent.setup();
    render(<SetupScreen onStart={() => {}} />);
    await selectPasteMode(user);
    expect(screen.queryByTestId('roster-a')).not.toBeInTheDocument();
    expect(screen.queryByTestId('roster-b')).not.toBeInTheDocument();
    expect(screen.getByTestId('matrix-entry')).toBeInTheDocument();
  });

  it('paste mode shows a "validate the matrix first" hint on Start', async () => {
    const user = userEvent.setup();
    render(<SetupScreen onStart={() => {}} />);
    await selectPasteMode(user);
    expect(screen.getByRole('button', { name: /Start/i })).toBeDisabled();
    expect(screen.getByTestId('start-disabled-reason')).toHaveTextContent(/validate the matrix/i);
  });

  it('after a valid paste, rosters appear with empty dropdowns', async () => {
    const user = userEvent.setup();
    render(<SetupScreen onStart={() => {}} />);
    await pasteValidMatrix(user);

    const rosterA = screen.getByTestId('roster-a');
    const slot0 = within(rosterA).getByTestId('team-a-slot-0');
    expect(within(slot0).getByRole('combobox')).toBeInTheDocument();
    const select = within(slot0).getByRole('combobox') as HTMLSelectElement;
    expect(select.value).toBe('');
  });

  it('paste error is surfaced and rosters stay hidden', async () => {
    const user = userEvent.setup();
    render(<SetupScreen onStart={() => {}} />);
    await selectPasteMode(user);
    const textarea = screen.getByTestId('matrix-paste-textarea');
    await user.click(textarea);
    // 7 rows instead of 8 → row-count error.
    await user.paste(Array(7).fill(Array(8).fill('Y').join('\t')).join('\n'));
    await user.click(screen.getByTestId('matrix-paste-validate'));
    expect(screen.getByTestId('matrix-paste-error').textContent).toMatch(/8 rows/);
    expect(screen.queryByTestId('roster-a')).not.toBeInTheDocument();
  });
});

describe('SetupScreen — Entered mode end-to-end', () => {
  const VALID_PASTE = Array(8)
    .fill(Array(8).fill('Y').join('\t'))
    .join('\n');

  it('clicking Start in Entered mode passes a viewAOverride matching the typed matrix', async () => {
    const user = userEvent.setup();
    const onStart = vi.fn();
    render(<SetupScreen onStart={onStart} />);
    await user.click(screen.getByLabelText(/Entered/i));
    // Switch to paste mode (default is grid). Paste then validate.
    await user.click(screen.getByRole('radio', { name: /Paste from sheet/i }));

    const textarea = screen.getByTestId('matrix-paste-textarea');
    await user.click(textarea);
    await user.paste(VALID_PASTE);
    await user.click(screen.getByTestId('matrix-paste-validate'));

    // Pick all 16 factions across both teams.
    for (const team of ['a', 'b'] as const) {
      const rosterEl = screen.getByTestId(`roster-${team}`);
      for (let i = 0; i < 8; i++) {
        const slot = within(rosterEl).getByTestId(`team-${team}-slot-${i}`);
        const select = within(slot).getByRole('combobox') as HTMLSelectElement;
        // Pick i-th faction from the dropdown options (skip the empty
        // option at index 0).
        const opts = Array.from(select.options).filter((o) => o.value !== '');
        await user.selectOptions(select, opts[i]!.value);
      }
    }

    await user.click(screen.getByRole('button', { name: /Start/i }));
    expect(onStart).toHaveBeenCalledTimes(1);
    const config = onStart.mock.calls[0]![0] as {
      matrixSource: string;
      viewAOverride?: readonly (readonly { value: number }[])[];
    };
    expect(config.matrixSource).toBe('entered');
    expect(config.viewAOverride).toBeDefined();
    expect(config.viewAOverride!.length).toBe(8);
    // Every cell of "Y" parses to 10.
    for (const row of config.viewAOverride!) {
      expect(row.length).toBe(8);
      for (const cell of row) expect(cell.value).toBe(10);
    }
  });
});

describe('SetupScreen — onStart callback', () => {
  it('clicking Start in Generated SP mode invokes onStart with a complete GameConfig', async () => {
    const user = userEvent.setup();
    const onStart = vi.fn();
    render(<SetupScreen onStart={onStart} />);

    await user.click(screen.getByRole('button', { name: /Start/i }));

    expect(onStart).toHaveBeenCalledTimes(1);
    const config = onStart.mock.calls[0]![0] as {
      mode: { kind: string; tier?: string };
      scoring: string;
      matrixSource: string;
      seed: number;
      rosterA: readonly string[];
      rosterB: readonly string[];
    };
    expect(config.mode).toEqual({ kind: 'sp', tier: 'easy' });
    expect(config.scoring).toBe('standard');
    expect(config.matrixSource).toBe('generated');
    expect(typeof config.seed).toBe('number');
    expect(config.rosterA).toHaveLength(8);
    expect(config.rosterB).toHaveLength(8);
    expect(new Set(config.rosterA).size).toBe(8);
    expect(new Set(config.rosterB).size).toBe(8);
  });
});
