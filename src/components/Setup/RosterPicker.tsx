import { FactionPicker } from './FactionPicker.js';
import type { FactionId } from '../../factions.js';

interface RosterPickerProps {
  readonly team: 'A' | 'B';
  readonly value: ReadonlyArray<FactionId | null>; // length 8
  readonly onChange: (slots: ReadonlyArray<FactionId | null>) => void;
  // false in Generated mode: rosters are randomized, slots show readonly
  // logo+name. true in Entered mode: dropdowns appear for manual selection.
  readonly editable: boolean;
}

const ROSTER_SIZE = 8;

export function RosterPicker({ team, value, onChange, editable }: RosterPickerProps) {
  // disabledIds = the set of factions already chosen elsewhere in THIS team
  // (so the user can't pick the same faction twice on one side).
  const disabledIds: ReadonlySet<FactionId> = new Set(
    value.filter((v): v is FactionId => v !== null),
  );

  function setSlot(idx: number, id: FactionId | null): void {
    const next = value.slice();
    next[idx] = id;
    onChange(next);
  }

  const teamColor = team === 'A' ? 'text-sky-400' : 'text-amber-400';

  return (
    <div className="space-y-3" data-testid={`roster-${team.toLowerCase()}`}>
      <h3 className={`text-sm font-semibold uppercase tracking-wide ${teamColor}`}>
        Team {team}
      </h3>
      <div className="space-y-2">
        {Array.from({ length: ROSTER_SIZE }, (_, i) => (
          <FactionPicker
            key={i}
            slotIndex={i}
            value={value[i] ?? null}
            disabledIds={disabledIds}
            onChange={(id) => setSlot(i, id)}
            testIdPrefix={`team-${team.toLowerCase()}`}
            editable={editable}
          />
        ))}
      </div>
    </div>
  );
}
