import { findFaction } from '../../factions.js';
import type { Pairing } from '../../engine/state.js';
import type { ArmyId, Team } from '../../engine/log.js';

export type SlotStatus =
  | { readonly kind: 'pool' }
  | { readonly kind: 'def-locked' }
  | { readonly kind: 'attackers-locked' }
  | { readonly kind: 'paired'; readonly tableId?: number }
  | { readonly kind: 'refused' };

interface ArmySlotProps {
  readonly team: Team;
  readonly armyId: ArmyId;
  readonly status: SlotStatus;
  readonly selected: boolean;
  readonly selectable: boolean;
  readonly onClick?: () => void;
  readonly testId?: string;
}

const STATUS_CHIP: Record<SlotStatus['kind'], string> = {
  'pool':             'bg-slate-800 text-slate-300',
  'def-locked':       'bg-sky-700 text-sky-100',
  'attackers-locked': 'bg-amber-700 text-amber-100',
  'paired':           'bg-emerald-800 text-emerald-100',
  'refused':          'bg-rose-800 text-rose-100',
};

const STATUS_LABEL: Record<SlotStatus['kind'], string> = {
  'pool':             'pool',
  'def-locked':       'def',
  'attackers-locked': 'atk',
  'paired':           'paired',
  'refused':          'refused',
};

export function ArmySlot({
  team,
  armyId,
  status,
  selected,
  selectable,
  onClick,
  testId,
}: ArmySlotProps) {
  const faction = findFaction(armyId);
  const teamColor = team === 'A' ? 'border-sky-500' : 'border-amber-500';
  const baseClasses = 'flex items-center gap-3 rounded border px-2 py-2 transition';
  const selectedClasses = selected
    ? `${teamColor} bg-slate-800 ring-2 ring-sky-500`
    : 'border-slate-700 bg-slate-900/40 hover:bg-slate-800/60';
  const cursorClass = selectable ? 'cursor-pointer' : 'cursor-default opacity-80';

  const showStatusLabel =
    status.kind === 'paired' && status.tableId !== undefined
      ? `paired · T${status.tableId}`
      : STATUS_LABEL[status.kind];

  return (
    <button
      type="button"
      onClick={selectable ? onClick : undefined}
      disabled={!selectable}
      className={`${baseClasses} ${selectedClasses} ${cursorClass} text-left w-full`}
      data-testid={testId ?? `slot-${team}-${armyId}`}
      data-status={status.kind}
      data-selected={selected ? 'true' : 'false'}
    >
      {faction !== undefined ? (
        <img src={faction.logoPath} alt="" className="h-8 w-8 shrink-0 object-contain" />
      ) : (
        <div className="h-8 w-8 shrink-0 rounded bg-slate-800" />
      )}
      <span className="flex-1 truncate text-sm">{faction?.displayName ?? armyId}</span>
      <span className={`shrink-0 rounded px-2 py-0.5 text-[10px] uppercase ${STATUS_CHIP[status.kind]}`}>
        {showStatusLabel}
      </span>
    </button>
  );
}

// Derive the slot status for a given armyId from the engine state pieces.
// This lives next to ArmySlot since it directly informs the rendering choice.
export function deriveStatus(
  armyId: ArmyId,
  team: Team,
  pool: readonly ArmyId[],
  pairings: readonly Pairing[],
  defenderRevealed: { a: ArmyId; b: ArmyId } | undefined,
  attackersRevealed: { a: readonly [ArmyId, ArmyId]; b: readonly [ArmyId, ArmyId] } | undefined,
): SlotStatus {
  // Locked into a pairing → paired (or "refused" if back in pool with a refusal mark).
  for (const p of pairings) {
    const target = team === 'A' ? p.aArmy : p.bArmy;
    if (target === armyId) {
      return p.tableId !== undefined ? { kind: 'paired', tableId: p.tableId } : { kind: 'paired' };
    }
  }
  // Currently defending in this step.
  if (defenderRevealed !== undefined) {
    const myDef = team === 'A' ? defenderRevealed.a : defenderRevealed.b;
    if (myDef === armyId) return { kind: 'def-locked' };
  }
  // Currently among committed attackers.
  if (attackersRevealed !== undefined) {
    const myAtk = team === 'A' ? attackersRevealed.a : attackersRevealed.b;
    if (myAtk.includes(armyId)) return { kind: 'attackers-locked' };
  }
  // Otherwise: in pool (refused armies are returned to pool too — "refused"
  // status is a transient annotation we'd add via log inspection; default to
  // pool here for simplicity in U2).
  if (pool.includes(armyId)) return { kind: 'pool' };
  return { kind: 'pool' };
}
