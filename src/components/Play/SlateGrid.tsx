import type { ReactNode } from 'react';
import type { Pairing } from '../../engine/state.js';

interface SlateGridProps {
  // 8 entries; null = empty placeholder column. Indexes match the rules
  // in slateColumns.ts: 0..5 fill chronologically with player-decided
  // pairings, 6 = RefusedAutoPaired, 7 = LastManAutoPaired.
  readonly columns: readonly (Pairing | null)[];
  // PlayScreen renders the actual cards (so they share layoutIds with
  // their roster/triangle counterparts). We just receive them already
  // resolved per (column, row).
  readonly cardForColumn: (col: number, row: 'top' | 'bottom') => ReactNode;
}

const COL_LABELS = ['T?', 'T?', 'T?', 'T?', 'T?', 'T?', 'T?', 'T?'];
// Visual marker for the two reserved auto-pair columns at the right edge.
const RESERVED_LABELS: Record<number, string> = {
  6: 'auto · refused',
  7: 'auto · last man',
};

// 8 columns × 3 rows. Top: Team B card. Middle: table chip + "T#"
// indicator. Bottom: Team A card. Empty columns render as visible
// placeholder slots so the player sees how much of the slate remains.
export function SlateGrid({ columns, cardForColumn }: SlateGridProps) {
  return (
    <section
      className="rounded-lg border border-slate-800 bg-slate-900/40 p-3"
      data-testid="slate-grid"
    >
      <header className="mb-2 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
          Slate
        </h3>
        <span className="text-[10px] text-slate-500">B · table · A · (cols 7–8 reserved for scrum auto-pairs)</span>
      </header>
      <div className="grid grid-cols-8 gap-2">
        {columns.map((p, i) => (
          <div key={i} className="flex flex-col items-center gap-1" data-testid={`slate-col-${i}`}>
            <span className="text-[10px] uppercase text-amber-400/80">B</span>
            <SlotShell isReserved={i >= 6} hasContent={p !== null}>
              {cardForColumn(i, 'top')}
            </SlotShell>
            <TableIndicator
              pairing={p}
              fallback={COL_LABELS[i] ?? 'T?'}
              {...(RESERVED_LABELS[i] !== undefined ? { reservedLabel: RESERVED_LABELS[i]! } : {})}
            />
            <SlotShell isReserved={i >= 6} hasContent={p !== null}>
              {cardForColumn(i, 'bottom')}
            </SlotShell>
            <span className="text-[10px] uppercase text-sky-400/80">A</span>
          </div>
        ))}
      </div>
    </section>
  );
}

interface SlotShellProps {
  readonly isReserved: boolean;
  readonly hasContent: boolean;
  readonly children: ReactNode;
}

function SlotShell({ isReserved, hasContent, children }: SlotShellProps) {
  const baseBorder = isReserved ? 'border-fuchsia-800/50' : 'border-slate-700/60';
  const empty = children === null || children === undefined || children === false || !hasContent;
  return (
    <div
      className={`flex h-24 w-24 items-center justify-center rounded-xl border border-dashed ${baseBorder} ${empty ? 'bg-slate-900/20' : 'border-transparent'}`}
    >
      {hasContent ? children : null}
    </div>
  );
}

interface TableIndicatorProps {
  readonly pairing: Pairing | null;
  readonly reservedLabel?: string;
  readonly fallback: string;
}

function TableIndicator({ pairing, reservedLabel, fallback }: TableIndicatorProps) {
  if (pairing !== null && pairing.tableId !== undefined) {
    const teamColor = pairing.defenderTeam === 'A'
      ? 'text-sky-300'
      : pairing.defenderTeam === 'B'
        ? 'text-amber-300'
        : 'text-fuchsia-300';
    return (
      <span className={`rounded bg-slate-800 px-2 py-0.5 font-mono text-xs ${teamColor}`}>
        T{pairing.tableId}
      </span>
    );
  }
  if (reservedLabel !== undefined) {
    return (
      <span className="rounded border border-fuchsia-800/50 bg-slate-900/40 px-2 py-0.5 text-[9px] uppercase text-fuchsia-300/80">
        {reservedLabel}
      </span>
    );
  }
  return (
    <span className="rounded border border-slate-700/40 bg-slate-900/40 px-2 py-0.5 font-mono text-[10px] text-slate-600">
      {fallback}
    </span>
  );
}
