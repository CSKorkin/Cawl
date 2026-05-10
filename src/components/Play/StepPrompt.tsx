import type { PairingState } from '../../engine/state.js';
import type { ArmyId, TableId, Team } from '../../engine/log.js';
import { findFaction } from '../../factions.js';

export type SelectionState =
  // `team` is the roster the click originated on. It scopes the visual
  // "selected" highlight so a faction shared by both teams doesn't light up
  // in both rosters. `null` means no slot has been clicked yet.
  | { readonly kind: 'army'; readonly team: Team | null; readonly ids: readonly ArmyId[] }
  | { readonly kind: 'table'; readonly tableId: TableId | null };

interface StepPromptProps {
  readonly state: PairingState;
  readonly humanTeam: Team;
  readonly selection: SelectionState;
  readonly availableTables: readonly TableId[];
  readonly onSelectTable: (tableId: TableId) => void;
  readonly onClearSelection: () => void;
  readonly onConfirm: () => void;
}

function name(id: ArmyId): string {
  return findFaction(id)?.displayName ?? id;
}

// Per-phase prompt + confirm rules. The roster click handler is wired up in
// PlayScreen; this component handles the table-pick UI and the confirm
// button enablement.
export function StepPrompt({
  state,
  humanTeam,
  selection,
  availableTables,
  onSelectTable,
  onClearSelection,
  onConfirm,
}: StepPromptProps) {
  const phase = state.phase;

  let promptText = '';
  let confirmEnabled = false;
  let pickerKind: 'army' | 'table' = 'army';
  let expectedSelectionCount = 1;

  switch (phase) {
    case 'ROUND_1.AWAITING_DEFENDERS':
    case 'ROUND_2.AWAITING_DEFENDERS':
    case 'SCRUM.AWAITING_DEFENDERS':
      promptText = `Pick your defender (${roundOf(phase)}).`;
      expectedSelectionCount = 1;
      confirmEnabled = selection.kind === 'army' && selection.ids.length === 1;
      break;

    case 'ROUND_1.AWAITING_ATTACKERS':
    case 'ROUND_2.AWAITING_ATTACKERS':
    case 'SCRUM.AWAITING_ATTACKERS':
      promptText = 'Pick two attackers.';
      expectedSelectionCount = 2;
      confirmEnabled = selection.kind === 'army' && selection.ids.length === 2;
      break;

    case 'ROUND_1.AWAITING_REFUSALS':
    case 'ROUND_2.AWAITING_REFUSALS':
    case 'SCRUM.AWAITING_REFUSALS': {
      const sentAtMe =
        humanTeam === 'A'
          ? state.step.attackers!.revealed!.b
          : state.step.attackers!.revealed!.a;
      promptText = `Choose which attacker to accept: ${sentAtMe.map(name).join(' or ')}.`;
      expectedSelectionCount = 1;
      confirmEnabled = selection.kind === 'army' && selection.ids.length === 1;
      break;
    }

    case 'ROUND_1.AWAITING_TABLES':
    case 'ROUND_2.AWAITING_TABLES':
    case 'SCRUM.AWAITING_TABLES':
      promptText = 'Pick a table for this pairing.';
      pickerKind = 'table';
      confirmEnabled = selection.kind === 'table' && selection.tableId !== null;
      break;

    case 'GAME_COMPLETE':
      promptText = 'Game complete.';
      break;

    case 'INIT':
    case 'ROUND_1_COMPLETE':
    case 'ROUND_2_COMPLETE':
    case 'SCRUM.AUTO_LAST_MAN':
    case 'SCRUM.AUTO_REFUSED_PAIR':
      // Transient states — never visible to the human in practice.
      promptText = `(${phase})`;
      break;
  }

  return (
    <div
      className="flex flex-wrap items-center gap-3 rounded border border-slate-800 bg-slate-900/60 p-3"
      data-testid="step-prompt"
    >
      <div className="flex-1 text-sm text-slate-200">
        <span className="text-xs text-slate-400">Team {humanTeam}: </span>
        {promptText}
        {pickerKind === 'army' && (
          <span className="ml-2 text-xs text-slate-500">
            ({selection.kind === 'army' ? selection.ids.length : 0} / {expectedSelectionCount} selected)
          </span>
        )}
      </div>

      {pickerKind === 'table' && (
        <div className="flex flex-wrap gap-1" data-testid="table-picker">
          {availableTables.map((id) => {
            const isSelected = selection.kind === 'table' && selection.tableId === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => onSelectTable(id)}
                className={`min-w-[2.5rem] rounded border px-2 py-1 text-sm font-mono ${
                  isSelected
                    ? 'border-sky-500 bg-sky-700 text-white'
                    : 'border-slate-700 bg-slate-800 hover:bg-slate-700'
                }`}
                data-testid={`table-option-${id}`}
              >
                T{id}
              </button>
            );
          })}
        </div>
      )}

      <button
        type="button"
        onClick={onClearSelection}
        className="rounded border border-slate-700 bg-slate-800 px-3 py-1 text-xs hover:bg-slate-700"
        data-testid="clear-selection"
      >
        Clear
      </button>
      <button
        type="button"
        onClick={onConfirm}
        disabled={!confirmEnabled}
        className="rounded bg-sky-600 px-4 py-2 text-sm font-semibold text-white shadow disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
        data-testid="confirm-button"
      >
        Confirm
      </button>
    </div>
  );
}

function roundOf(phase: string): string {
  if (phase.startsWith('ROUND_1')) return 'Round 1';
  if (phase.startsWith('ROUND_2')) return 'Round 2';
  return 'Scrum';
}
