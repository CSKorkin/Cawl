import { useEffect, useMemo, useRef, useState } from 'react';
import {
  nextRequiredMover,
  useGameStore,
} from '../../store/gameStore.js';
import { viewFor } from '../../engine/state.js';
import { availableTables } from '../../engine/ai.js';
import type { ArmyId, TableId, Team } from '../../engine/log.js';
import type { Action, PairingState } from '../../engine/state.js';
import { Matrix } from './Matrix.js';
import { LogPanel } from './LogPanel.js';
import { PhaseChip } from './PhaseChip.js';
import { TokenChip } from './TokenChip.js';
import { StepPrompt } from './StepPrompt.js';
import type { SelectionState } from './StepPrompt.js';
import { PairingCard } from './PairingCard.js';
import { TrianglePickZone } from './TrianglePickZone.js';
import { SlateGrid } from './SlateGrid.js';
import { computeSlateColumns } from './slateColumns.js';
import { cardLocation } from './cardLocation.js';

// PlayScreen is the mid-game UI. It reads engine state from the Zustand
// store and drives the human's pick → confirm → dispatch flow.
//
// Each army across both teams renders exactly one PairingCard per render
// (in the slot derived by `cardLocation`). The same `layoutId` on every
// card across renders lets framer-motion handle the slide-between-slots
// animation as a shared-element transition.
export function PlayScreen() {
  const state = useGameStore((s) => s.state)!;
  const config = useGameStore((s) => s.config)!;
  const humanSeat = useGameStore((s) => s.humanSeat);
  const dispatch = useGameStore((s) => s.dispatch);
  const resetGame = useGameStore((s) => s.resetGame);

  // Derive view + viewer + table list from stable store reads. Selectors
  // that returned freshly-allocated objects defeated Zustand's Object.is
  // and caused infinite re-renders here.
  const viewerSeat = useMemo<Team>(() => {
    if (humanSeat !== null) return humanSeat;
    const next = nextRequiredMover(state);
    if (next === 'A' || next === 'B') return next;
    return 'A';
  }, [state, humanSeat]);
  const view = useMemo(() => viewFor(state, viewerSeat), [state, viewerSeat]);
  const availableTablesList = useMemo(() => availableTables(state), [state]);
  const slateCols = useMemo(() => computeSlateColumns(state), [state]);

  const [selection, setSelection] = useState<SelectionState>({ kind: 'army', team: null, ids: [] });

  // U6 polish: one-shot flash on slots whose secret was just revealed (or
  // who were just auto-paired in the scrum). Watched off log growth so
  // every chained reveal in a single dispatch is included in the flash set.
  const [flashingIds, setFlashingIds] = useState<readonly ArmyId[]>([]);
  const lastLogLenRef = useRef(state.log.length);
  useEffect(() => {
    if (state.log.length === lastLogLenRef.current) return;
    const ids: ArmyId[] = [];
    for (let i = lastLogLenRef.current; i < state.log.length; i++) {
      const entry = state.log[i];
      if (entry === undefined) continue;
      switch (entry.type) {
        case 'DefendersRevealed':
          ids.push(entry.aArmy, entry.bArmy);
          break;
        case 'AttackersRevealed':
          ids.push(...entry.aAttackers, ...entry.bAttackers);
          break;
        case 'RefusalsRevealed':
          ids.push(entry.aRefused, entry.bRefused);
          break;
        case 'LastManAutoPaired':
        case 'RefusedAutoPaired':
          ids.push(entry.aArmy, entry.bArmy);
          break;
        default:
          break;
      }
    }
    lastLogLenRef.current = state.log.length;
    if (ids.length === 0) return;
    setFlashingIds(ids);
    const tid = setTimeout(() => setFlashingIds([]), 600);
    return () => clearTimeout(tid);
  }, [state.log.length, state.log]);

  // U6 polish: token chip pulses when the holder changes.
  const [tokenPulseKey, setTokenPulseKey] = useState(0);
  const lastTokenRef = useRef(state.tokenHolder);
  useEffect(() => {
    if (state.tokenHolder !== lastTokenRef.current) {
      lastTokenRef.current = state.tokenHolder;
      setTokenPulseKey((k) => k + 1);
    }
  }, [state.tokenHolder]);

  // Reset selection if the phase changes (e.g. after dispatch advanced
  // the game). We key the selection on phase + log length to detect
  // transitions.
  const phaseKey = `${state.phase}:${state.log.length}`;
  const [lastPhaseKey, setLastPhaseKey] = useState(phaseKey);
  if (lastPhaseKey !== phaseKey) {
    setLastPhaseKey(phaseKey);
    setSelection({ kind: 'army', team: null, ids: [] });
  }

  function handleSlotClick(armyId: ArmyId, slotTeam: Team): void {
    if (selection.kind !== 'army' || selection.team !== slotTeam) {
      setSelection({ kind: 'army', team: slotTeam, ids: [armyId] });
      return;
    }
    if (selection.ids.includes(armyId)) {
      setSelection({ kind: 'army', team: slotTeam, ids: selection.ids.filter((x) => x !== armyId) });
      return;
    }
    const cap = expectedSelectionCount(state.phase);
    if (selection.ids.length >= cap) {
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

  if (isTablePhase(state.phase) && selection.kind === 'army') {
    setSelection({ kind: 'table', tableId: null });
  }
  if (!isTablePhase(state.phase) && selection.kind === 'table') {
    setSelection({ kind: 'army', team: null, ids: [] });
  }

  const tier = config.mode.kind === 'sp' ? config.mode.tier : null;

  // ── card click eligibility ─────────────────────────────────────────────
  // A card is clickable when (a) the current phase invites a click on
  // that team's card AND (b) the viewer is the current mover. Refusal
  // routes clicks to the opp triangle's attacker slots.
  const phase = state.phase;
  const ownPickPhase = phase.endsWith('AWAITING_DEFENDERS') || phase.endsWith('AWAITING_ATTACKERS');
  const refusalPhase = phase.endsWith('AWAITING_REFUSALS');

  function isClickable(armyId: ArmyId, team: Team): boolean {
    if (ownPickPhase) {
      if (team !== viewerSeat) return false;
      const pool = team === 'A' ? state.poolA : state.poolB;
      // Allow click on own pool members AND on cards already in the
      // tentative triangle slot (so the user can click to remove).
      if (pool.includes(armyId)) return true;
      return selection.kind === 'army'
        && selection.team === team
        && selection.ids.includes(armyId);
    }
    if (refusalPhase) {
      if (team === viewerSeat) return false;
      const revealed = state.step.attackers?.revealed;
      if (revealed === undefined) return false;
      const oppAtks = team === 'A' ? revealed.a : revealed.b;
      return oppAtks.includes(armyId);
    }
    return false;
  }

  function isHighlighted(armyId: ArmyId, team: Team): boolean {
    if (selection.kind !== 'army' || selection.team !== team) return false;
    return selection.ids.includes(armyId);
  }

  function renderCard(armyId: ArmyId, team: Team): JSX.Element {
    return (
      <PairingCard
        armyId={armyId}
        team={team}
        clickable={isClickable(armyId, team)}
        highlighted={isHighlighted(armyId, team)}
        flashing={flashingIds.includes(armyId)}
        onClick={() => handleSlotClick(armyId, team)}
      />
    );
  }

  // Build per-team containers: roster column gets cards whose location is
  // 'roster'; triangle slots get the card whose location matches.
  function rosterCards(team: Team): JSX.Element[] {
    const roster = team === 'A' ? state.rosterA : state.rosterB;
    return roster
      .filter((id) => cardLocation({ armyId: id, team, state, viewerSeat, selection }).kind === 'roster')
      .map((id) => <div key={id}>{renderCard(id, team)}</div>);
  }

  function findCardForTriangleSlot(defenderTeam: Team, slot: 'defender' | 'atk1' | 'atk2'): JSX.Element | null {
    // Each triangle is keyed by *whose defender* sits at the bottom.
    // Defender slots hold that team's card; attacker slots hold the OPP
    // team's cards. So we scan both rosters and match by defenderTeam.
    for (const team of ['A', 'B'] as const) {
      const roster = team === 'A' ? state.rosterA : state.rosterB;
      for (const id of roster) {
        const loc = cardLocation({ armyId: id, team, state, viewerSeat, selection });
        if (loc.kind === 'triangle' && loc.defenderTeam === defenderTeam && loc.slot === slot) {
          return renderCard(id, team);
        }
      }
    }
    return null;
  }

  function findCardForSlateColumn(col: number, row: 'top' | 'bottom'): JSX.Element | null {
    const pairing = slateCols[col];
    if (pairing === null || pairing === undefined) return null;
    const team: Team = row === 'top' ? 'B' : 'A';
    const armyId = team === 'A' ? pairing.aArmy : pairing.bArmy;
    return renderCard(armyId, team);
  }

  // Triangle is "active" when the viewer's current pick lands in it.
  // Defender phase fills the viewer's own triangle (their defender at
  // the bottom). Attacker phase fills the OPP triangle (the viewer's
  // attackers stack above the opp's defender). Refusal phase activates
  // the viewer's own triangle (the user clicks one of opp's attackers
  // — which now sit above the viewer's defender — to accept).
  function triangleActive(defenderTeam: Team): boolean {
    if (phase.endsWith('AWAITING_DEFENDERS')) return defenderTeam === viewerSeat;
    if (phase.endsWith('AWAITING_ATTACKERS')) return defenderTeam !== viewerSeat;
    if (phase.endsWith('AWAITING_REFUSALS')) return defenderTeam === viewerSeat;
    return false;
  }

  return (
    <main className="mx-auto max-w-7xl space-y-4 p-4">
      <header className="flex flex-wrap items-center gap-3 border-b border-slate-800 pb-3">
        <h1 className="text-lg font-bold">Cawl</h1>
        <span className="text-xs text-slate-500">
          {config.mode.kind === 'sp' ? `SP vs ${tier}` : 'Hot-seat'} · {config.scoring}
        </span>
        <PhaseChip phase={state.phase} />
        <TokenChip key={tokenPulseKey} tokenHolder={state.tokenHolder} pulse={tokenPulseKey > 0} />
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

      <SlateGrid columns={slateCols} cardForColumn={findCardForSlateColumn} />

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-[10rem_minmax(0,1fr)_10rem]">
        <div className="space-y-2" data-testid="roster-play-a">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-sky-400">Team A</h3>
          <div className="flex flex-col items-center gap-2">
            {rosterCards('A')}
          </div>
        </div>

        <div className="flex justify-center rounded border border-slate-800 bg-slate-900/40 p-3">
          <Matrix view={view} />
        </div>

        <div className="space-y-2" data-testid="roster-play-b">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-amber-400">Team B</h3>
          <div className="flex flex-col items-center gap-2">
            {rosterCards('B')}
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <TrianglePickZone
          defenderTeam="A"
          active={triangleActive('A')}
          attackerSlot1={findCardForTriangleSlot('A', 'atk1')}
          attackerSlot2={findCardForTriangleSlot('A', 'atk2')}
          defenderSlot={findCardForTriangleSlot('A', 'defender')}
        />
        <TrianglePickZone
          defenderTeam="B"
          active={triangleActive('B')}
          attackerSlot1={findCardForTriangleSlot('B', 'atk1')}
          attackerSlot2={findCardForTriangleSlot('B', 'atk2')}
          defenderSlot={findCardForTriangleSlot('B', 'defender')}
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
    // The user clicks the attacker they want to accept. The engine
    // action carries the *refused* (other) attacker.
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
