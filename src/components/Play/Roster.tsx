import type { PairingState } from '../../engine/state.js';
import type { ArmyId, Team } from '../../engine/log.js';
import { ArmySlot, deriveStatus } from './ArmySlot.js';

interface RosterProps {
  readonly state: PairingState;
  readonly team: Team;
  // Army ids on this team that are clickable for the current decision.
  // Caller decides per phase: e.g. own pool for defender/attackers, opp's
  // two pending attackers for refusal, empty otherwise.
  readonly selectableArmyIds: readonly ArmyId[];
  // Current selection in the human's UI flow (defender = 1, attackers = 2).
  readonly selectedIds: readonly ArmyId[];
  readonly onSlotClick?: (armyId: ArmyId) => void;
}

export function Roster({ state, team, selectableArmyIds, selectedIds, onSlotClick }: RosterProps) {
  const roster = team === 'A' ? state.rosterA : state.rosterB;
  const pool = team === 'A' ? state.poolA : state.poolB;
  const teamColor = team === 'A' ? 'text-sky-400' : 'text-amber-400';
  const selectedSet = new Set(selectedIds);
  const selectableSet = new Set(selectableArmyIds);

  return (
    <div className="space-y-3" data-testid={`roster-play-${team.toLowerCase()}`}>
      <h3 className={`text-sm font-semibold uppercase tracking-wide ${teamColor}`}>
        Team {team}
      </h3>
      <div className="space-y-1">
        {roster.map((armyId) => {
          const status = deriveStatus(
            armyId,
            team,
            pool,
            state.pairings,
            state.step.defenders?.revealed,
            state.step.attackers?.revealed,
          );
          const slotSelectable = selectableSet.has(armyId);
          return (
            <ArmySlot
              key={armyId}
              team={team}
              armyId={armyId}
              status={status}
              selected={selectedSet.has(armyId)}
              selectable={slotSelectable}
              onClick={() => onSlotClick?.(armyId)}
              testId={`slot-${team.toLowerCase()}-${armyId}`}
            />
          );
        })}
      </div>
    </div>
  );
}
