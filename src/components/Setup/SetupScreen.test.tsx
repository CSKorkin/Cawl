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

  it('Start button is disabled when Hot-seat is selected (Phase U4 hint)', async () => {
    const user = userEvent.setup();
    render(<SetupScreen onStart={() => {}} />);
    await user.click(screen.getByLabelText(/Hot-seat/i));
    expect(screen.getByRole('button', { name: /Start/i })).toBeDisabled();
    expect(screen.getByTestId('start-disabled-reason')).toHaveTextContent(/Phase U4/i);
  });
});

describe('SetupScreen — Entered mode', () => {
  it('clears the rosters and shows dropdowns when switching to Entered', async () => {
    const user = userEvent.setup();
    render(<SetupScreen onStart={() => {}} />);
    await user.click(screen.getByLabelText(/Entered/i));

    const rosterA = screen.getByTestId('roster-a');
    const slot0 = within(rosterA).getByTestId('team-a-slot-0');
    // Dropdown is now visible.
    expect(within(slot0).getByRole('combobox')).toBeInTheDocument();
    // Read-only name span is gone.
    expect(within(slot0).queryByTestId('team-a-slot-0-name')).not.toBeInTheDocument();
    // No factions populated yet.
    const select = within(slot0).getByRole('combobox') as HTMLSelectElement;
    expect(select.value).toBe('');
  });

  it('Entered mode disables Start with a Phase U5 hint', async () => {
    const user = userEvent.setup();
    render(<SetupScreen onStart={() => {}} />);
    await user.click(screen.getByLabelText(/Entered/i));
    expect(screen.getByRole('button', { name: /Start/i })).toBeDisabled();
    expect(screen.getByTestId('start-disabled-reason')).toHaveTextContent(/Phase U5/i);
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
