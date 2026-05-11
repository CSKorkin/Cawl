import { useEffect, useState } from 'react';
import type { ScoreMode } from '../../engine/score.js';
import { ATLAS_TIERS } from '../../engine/score.js';
import type { FactionId } from '../../factions.js';
import { findFaction } from '../../factions.js';

interface MatrixGridEntryProps {
  readonly scoring: ScoreMode;
  // Emits a fully-filled, validated 8x8 of numbers, or null if any cell is
  // empty / invalid. Standard cells are integers in [0, 20]; atlas cells
  // are values from ATLAS_TIERS (1, 2, 2.5, 3, 3.5, 4, 5).
  readonly onMatrixChange: (matrix: readonly (readonly number[])[] | null) => void;
  // Optional roster context — when provided (and a slot is filled), the
  // grid swaps the abstract A1/B1 placeholders for that faction's logo +
  // name so the user knows which matchup they're scoring. Per-slot
  // fallback to placeholders when an entry is null.
  readonly rosterA?: ReadonlyArray<FactionId | null>;
  readonly rosterB?: ReadonlyArray<FactionId | null>;
}

const SIZE = 8;

function emptyGrid(): (string | null)[][] {
  return Array.from({ length: SIZE }, () =>
    Array.from({ length: SIZE }, () => null),
  );
}

function validateCell(scoring: ScoreMode, raw: string | null): { ok: true; value: number } | { ok: false } {
  if (raw === null || raw.trim().length === 0) return { ok: false };
  const n = Number(raw);
  if (!Number.isFinite(n)) return { ok: false };
  if (scoring === 'standard') {
    if (!Number.isInteger(n)) return { ok: false };
    if (n < 0 || n > 20) return { ok: false };
    return { ok: true, value: n };
  }
  // Atlas: must be one of the allowed tier values.
  if (!ATLAS_TIERS.includes(n as (typeof ATLAS_TIERS)[number])) return { ok: false };
  return { ok: true, value: n };
}

export function MatrixGridEntry({ scoring, onMatrixChange, rosterA, rosterB }: MatrixGridEntryProps) {
  const [cells, setCells] = useState<(string | null)[][]>(() => emptyGrid());

  // Reset whenever scoring mode changes — the value space is incompatible.
  useEffect(() => {
    setCells(emptyGrid());
  }, [scoring]);

  // Recompute "complete & valid" status and report up.
  useEffect(() => {
    const out: number[][] = [];
    for (let i = 0; i < SIZE; i++) {
      const row: number[] = [];
      for (let j = 0; j < SIZE; j++) {
        const r = validateCell(scoring, cells[i]![j] ?? null);
        if (!r.ok) {
          onMatrixChange(null);
          return;
        }
        row.push(r.value);
      }
      out.push(row);
    }
    onMatrixChange(out);
  }, [cells, scoring, onMatrixChange]);

  function setCell(i: number, j: number, value: string): void {
    setCells((prev) => {
      const next = prev.map((row) => row.slice());
      next[i]![j] = value;
      return next;
    });
  }

  return (
    <div className="overflow-x-auto" data-testid="matrix-grid-entry">
      <table className="border-separate border-spacing-1 text-center">
        <thead>
          <tr>
            <th />
            {Array.from({ length: SIZE }, (_, j) => (
              <th key={j} className="px-1 text-xs text-slate-400">
                <HeaderCell team="B" index={j} factionId={rosterB?.[j] ?? null} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {cells.map((row, i) => (
            <tr key={i}>
              <th className="px-1 text-xs text-slate-400">
                <HeaderCell team="A" index={i} factionId={rosterA?.[i] ?? null} />
              </th>
              {row.map((value, j) => {
                const valid = validateCell(scoring, value).ok;
                const empty = value === null || value.trim().length === 0;
                const cellState = empty
                  ? 'border-slate-700 bg-slate-900/40'
                  : valid
                    ? 'border-emerald-700 bg-slate-900/60'
                    : 'border-rose-700 bg-rose-950/40';
                return (
                  <td key={j}>
                    {scoring === 'standard' ? (
                      <input
                        type="number"
                        min={0}
                        max={20}
                        step={1}
                        value={value ?? ''}
                        onChange={(e) => setCell(i, j, e.target.value)}
                        className={`h-9 w-12 rounded border ${cellState} text-center font-mono text-sm text-slate-100`}
                        data-testid={`grid-cell-${i}-${j}`}
                      />
                    ) : (
                      <select
                        value={value ?? ''}
                        onChange={(e) => setCell(i, j, e.target.value)}
                        className={`h-9 w-14 rounded border ${cellState} text-center font-mono text-sm text-slate-100`}
                        data-testid={`grid-cell-${i}-${j}`}
                      >
                        <option value="" />
                        {ATLAS_TIERS.map((t) => (
                          <option key={t} value={t}>{t}</option>
                        ))}
                      </select>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Header cell for the grid's row/col labels. When a faction is supplied,
// renders its 28×28 logo + a short name. Otherwise falls back to the
// "A1"/"B3" placeholder so a partly-filled roster still has every label.
function HeaderCell({ team, index, factionId }: {
  readonly team: 'A' | 'B';
  readonly index: number;
  readonly factionId: FactionId | null;
}) {
  const faction = factionId !== null ? findFaction(factionId) : undefined;
  if (faction !== undefined) {
    return (
      <span className="flex flex-col items-center gap-1" title={faction.displayName}>
        <img src={faction.logoPath} alt="" className="h-7 w-7 object-contain" />
        <span className="line-clamp-1 max-w-[5rem] text-[10px] font-normal">
          {faction.displayName}
        </span>
      </span>
    );
  }
  return <span>{team}{index + 1}</span>;
}
