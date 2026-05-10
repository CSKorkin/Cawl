import { useMemo, useState } from 'react';
import {
  nextRequiredMover,
  useGameStore,
} from '../../store/gameStore.js';
import { viewFor } from '../../engine/state.js';
import { availableTables } from '../../engine/ai.js';
import type { ArmyId, TableId, Team } from '../../engine/log.js';
import type { Action, PairingState } from '../../engine/state.js';
import { Matrix } from './Matrix.js';
import { Roster } from './Roster.js';
import { LogPanel } from './LogPanel.js';
import { PhaseChip } from './PhaseChip.js';
import { TokenChip } from './TokenChip.js';
import { StepPrompt } from './StepPrompt.js';
import type { SelectionState } from './StepPrompt.js';

// PlayScreen is the mid-game UI. It reads the engine state from the Zustand
// store and drives the human's pick → confirm → dispatch flow.
//
// Selection state lives locally (it's a per-step UI concern, not persisted).
// On dispatch the selection clears so the next phase starts fresh.
export function PlayScreen() {
  const state = useGameStore((s) => s.state)!;
  const config = useGameStore((s) => s.config)!;
  const humanSeat = useGameStore((s) => s.humanSeat);
  const dispatch = useGameStore((s) => s.dispatch);
  const resetGame = useGameStore((s) => s.resetGame);

  // Derive view + viewer + table list from stable store reads. Reading
  // these via selectors that returned freshly-allocated objects caused
  // Zustand to fire infinite re-renders (each call produced a new
  // reference, defeating the default Object.is equality check).
  const viewerSeat = useMemo<Team>(() => {
    if (humanSeat !== null) return humanSeat;
    const next = nextRequiredMover(state);
    if (next === 'A' || next === 'B') return next;
    // Game is between human turns / complete. Fall back to A; nothing
    // selectable is rendered in this branch anyway.
    return 'A';
  }, [state, humanSeat]);
  const view = useMemo(() => viewFor(state, viewerSeat), [state, viewerSeat]);
  const availableTablesList = useMemo(() => availableTables(state), [state]);

  const [selection, setSelection] = useState<SelectionState>({ kind: 'army', team: null, ids: [] });

  // Reset selection if the phase changes (e.g. after a dispatch advanced the
  // game). We key the selection on phase + log length to detect transitions.
  const phaseKey = `${state.phase}:${state.log.length}`;
  const [lastPhaseKey, setLastPhaseKey] = useState(phaseKey);
  if (lastPhaseKey !== phaseKey) {
    setLastPhaseKey(phaseKey);
    setSelection({ kind: 'army', team: null, ids: [] });
  }

  // `slotTeam` is the roster the click originated on — used to scope the
  // visual highlight when both teams happen to share a faction.
  function handleSlotClick(armyId: ArmyId, slotTeam: Team): void {
    if (selection.kind !== 'army' || selection.team !== slotTeam) {
      setSelection({ kind: 'army', team: slotTeam, ids: [armyId] });
      return;
    }
    if (selection.ids.includes(armyId)) {
      setSelection({ kind: 'army', team: slotTeam, ids: selection.ids.filter((x) => x !== armyId) });
      return;
    }
    // Add to selection, capped by expected count for the phase.
    const cap = expectedSelectionCount(state.phase);
    if (selection.ids.length >= cap) {
      // Replace oldest — convenient when user changes mind.
      setSelection({ kind: 'army', team: slotTeam, ids: [...selection.ids.slice(1), armyId] });
      return;
    }
    setSelection({ kind: 'army', team: slotTeam, ids: [...selection.ids, armyId] });
  }

  function handleSelectTable(tableId: TableId): void {
    setSelection({ kind: 'table', tableId });
  }

  function handleClear(): void {
    setSelection(
      isTablePhase(state.phase)
        ? { kind: 'table', tableId: null }
        : { kind: 'army', team: null, ids: [] },
    );
  }

  function handleConfirm(): void {
    const action = buildAction(state, viewerSeat, selection);
    if (action === null) return;
    const r = dispatch(action);
    if (!r.ok) {
      // eslint-disable-next-line no-console
      console.error('dispatch rejected:', r.error);
      return;
    }
    setSelection(
      isTablePhase(useGameStore.getState().state?.phase ?? 'GAME_COMPLETE')
        ? { kind: 'table', tableId: null }
        : { kind: 'army', team: null, ids: [] },
    );
  }

  // After human's pickRefusal-related dispatch transitions us into table
  // phase, switch the selection mode accordingly.
  if (isTablePhase(state.phase) && selection.kind === 'army') {
    setSelection({ kind: 'table', tableId: null });
  }
  if (!isTablePhase(state.phase) && selection.kind === 'table') {
    setSelection({ kind: 'army', team: null, ids: [] });
  }

  const tier = config.mode.kind === 'sp' ? config.mode.tier : null;

  return (
    <main className="mx-auto max-w-7xl space-y-4 p-4">
      <header className="flex flex-wrap items-center gap-3 border-b border-slate-800 pb-3">
        <h1 className="text-lg font-bold">Cawl</h1>
        <span className="text-xs text-slate-500">
          {config.mode.kind === 'sp' ? `SP vs ${tier}` : 'Hot-seat'} · {config.scoring}
        </span>
        <PhaseChip phase={state.phase} />
        <TokenChip tokenHolder={state.tokenHolder} />
        <span className="ml-auto" />
        <button
          type="button"
          onClick={resetGame}
          className="rounded border border-slate-700 bg-slate-800 px-2 py-1 text-xs hover:bg-slate-700"
          data-testid="quit-button"
        >
          Quit
        </button>
      </header>

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-[16rem_minmax(0,1fr)_16rem]">
        <Roster
          state={state}
          team="A"
          selectableArmyIds={selectableArmyIdsFor('A', state, viewerSeat)}
          selectedIds={selection.kind === 'army' && selection.team === 'A' ? selection.ids : []}
          onSlotClick={(id) => handleSlotClick(id, 'A')}
        />

        <div className="rounded border border-slate-800 bg-slate-900/40 p-3">
          <Matrix view={view} />
        </div>

        <Roster
          state={state}
          team="B"
          selectableArmyIds={selectableArmyIdsFor('B', state, viewerSeat)}
          selectedIds={selection.kind === 'army' && selection.team === 'B' ? selection.ids : []}
          onSlotClick={(id) => handleSlotClick(id, 'B')}
        />
      </section>

      <StepPrompt
        state={state}
        humanTeam={viewerSeat}
        selection={selection}
        availableTables={availableTablesList}
        onSelectTable={handleSelectTable}
        onClearSelection={handleClear}
        onConfirm={handleConfirm}
      />

      <LogPanel entries={state.log} />
    </main>
  );
}

// ── helpers ─────────────────────────────────────────────────────────────────

function expectedSelectionCount(phase: string): number {
  if (phase.endsWith('AWAITING_ATTACKERS')) return 2;
  return 1;
}

function isTablePhase(phase: string): boolean {
  return phase.endsWith('AWAITING_TABLES');
}

// Which army ids on `team` should be clickable for the current phase, given
// who's viewing? Defender / attackers come from the viewer's own pool;
// refusal targets the *opponent's* two pending attackers (the viewer is
// choosing which one to refuse). Other phases are non-interactive on the
// rosters.
function selectableArmyIdsFor(
  team: Team,
  state: PairingState,
  viewerSeat: Team,
): readonly ArmyId[] {
  const phase = state.phase;
  if (
    phase.endsWith('AWAITING_DEFENDERS')
    || phase.endsWith('AWAITING_ATTACKERS')
  ) {
    if (team !== viewerSeat) return [];
    const pool = team === 'A' ? state.poolA : state.poolB;
    return pool;
  }
  if (phase.endsWith('AWAITING_REFUSALS')) {
    if (team === viewerSeat) return [];
    const revealed = state.step.attackers?.revealed;
    if (revealed === undefined) return [];
    return team === 'A' ? [...revealed.a] : [...revealed.b];
  }
  return [];
}

function buildAction(
  state: PairingState,
  team: Team,
  selection: SelectionState,
): Action | null {
  const phase = state.phase;
  if (phase.endsWith('AWAITING_DEFENDERS')) {
    if (selection.kind !== 'army' || selection.ids.length !== 1) return null;
    return { type: 'LOCK_IN_DEFENDER', team, armyId: selection.ids[0]! };
  }
  if (phase.endsWith('AWAITING_ATTACKERS')) {
    if (selection.kind !== 'army' || selection.ids.length !== 2) return null;
    return { type: 'LOCK_IN_ATTACKERS', team, armyIds: [selection.ids[0]!, selection.ids[1]!] };
  }
  if (phase.endsWith('AWAITING_REFUSALS')) {
    // The user clicks the attacker they want to *accept* (the matchup they
    // want to play). The engine action carries the *refused* army — the
    // other one of the opponent's two pending attackers.
    if (selection.kind !== 'army' || selection.ids.length !== 1) return null;
    const accepted = selection.ids[0]!;
    const revealed = state.step.attackers?.revealed;
    if (revealed === undefined) return null;
    const sentAtMe = team === 'A' ? revealed.b : revealed.a;
    const refused = sentAtMe.find((a) => a !== accepted);
    if (refused === undefined) return null;
    return { type: 'LOCK_IN_REFUSAL', team, armyId: refused };
  }
  if (phase.endsWith('AWAITING_TABLES')) {
    if (selection.kind !== 'table' || selection.tableId === null) return null;
    return { type: 'LOCK_IN_TABLE', team, tableId: selection.tableId };
  }
  return null;
}
