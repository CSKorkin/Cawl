import { FACTIONS, findFaction } from '../../factions.js';
import type { FactionId } from '../../factions.js';

interface FactionPickerProps {
  readonly slotIndex: number;
  readonly value: FactionId | null;
  readonly disabledIds: ReadonlySet<FactionId>;
  readonly onChange: (id: FactionId | null) => void;
  readonly testIdPrefix: string;
  // In Generated matrix mode, factions are auto-populated and the dropdown
  // is hidden (the slot just displays the random pick). In Entered mode,
  // the dropdown is shown for manual selection alongside matrix entry.
  readonly editable: boolean;
}

export function FactionPicker({
  slotIndex,
  value,
  disabledIds,
  onChange,
  testIdPrefix,
  editable,
}: FactionPickerProps) {
  const faction = value !== null ? findFaction(value) : undefined;
  return (
    <div
      className="flex items-center gap-3"
      data-testid={`${testIdPrefix}-slot-${slotIndex}`}
    >
      {faction !== undefined ? (
        <img
          src={faction.logoPath}
          alt=""
          className="h-12 w-12 shrink-0 object-contain"
        />
      ) : (
        <div className="h-12 w-12 shrink-0 rounded border border-dashed border-slate-700 bg-slate-800/50" />
      )}
      {editable ? (
        <select
          aria-label={`Slot ${slotIndex + 1}`}
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
          className="flex-1 rounded border border-slate-700 bg-slate-800 px-2 py-1 text-sm focus:border-sky-500 focus:outline-none"
        >
          <option value="">— pick a faction —</option>
          {FACTIONS.map((f) => (
            <option
              key={f.id}
              value={f.id}
              disabled={disabledIds.has(f.id) && f.id !== value}
            >
              {f.displayName}
            </option>
          ))}
        </select>
      ) : (
        <span className="flex-1 text-sm text-slate-200" data-testid={`${testIdPrefix}-slot-${slotIndex}-name`}>
          {faction?.displayName ?? '—'}
        </span>
      )}
    </div>
  );
}
