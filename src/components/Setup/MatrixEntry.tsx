import { useEffect } from 'react';
import type { ScoreMode } from '../../engine/score.js';
import type { FactionId } from '../../factions.js';
import { MatrixPasteEntry } from './MatrixPasteEntry.js';
import { MatrixGridEntry } from './MatrixGridEntry.js';

export type EntryMethod = 'paste' | 'grid';

interface MatrixEntryProps {
  readonly scoring: ScoreMode;
  // Controlled by SetupScreen so it can re-order the page (grid → rosters
  // first; paste → matrix first).
  readonly method: EntryMethod;
  readonly onMethodChange: (next: EntryMethod) => void;
  // Roster context for the grid header row/column labels. When both
  // rosters are filled, the grid swaps the abstract A1/B1 placeholders
  // for faction names + logos so the user sees which matchup they're
  // scoring. Either roster being null/incomplete is fine — the grid
  // falls back to placeholders for those slots.
  readonly rosterA?: ReadonlyArray<FactionId | null>;
  readonly rosterB?: ReadonlyArray<FactionId | null>;
  readonly onMatrixChange: (matrix: readonly (readonly number[])[] | null) => void;
}

// Wrapper for the Entered matrix flow. Standard mode supports either
// paste (sheet format) or cell-by-cell grid; atlas mode only supports
// the grid since the paste vocabulary is built around 0–20 colors.
export function MatrixEntry({
  scoring, method, onMethodChange, rosterA, rosterB, onMatrixChange,
}: MatrixEntryProps) {
  // Atlas + paste isn't a valid combo; force grid if the user picks atlas.
  useEffect(() => {
    if (scoring === 'atlas' && method === 'paste') {
      onMethodChange('grid');
    }
  }, [scoring, method, onMethodChange]);

  return (
    <section className="space-y-3" data-testid="matrix-entry">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
        Matrix
      </h3>
      <fieldset className="flex items-center gap-4 text-sm" data-testid="matrix-entry-method">
        <legend className="sr-only">Entry method</legend>
        <label className="flex items-center gap-1">
          <input
            type="radio"
            name="entry-method"
            value="grid"
            checked={method === 'grid'}
            onChange={() => onMethodChange('grid')}
          />
          Cell-by-cell grid
        </label>
        {scoring === 'standard' && (
          <label className="flex items-center gap-1">
            <input
              type="radio"
              name="entry-method"
              value="paste"
              checked={method === 'paste'}
              onChange={() => onMethodChange('paste')}
            />
            Paste from sheet
          </label>
        )}
      </fieldset>

      {method === 'paste' && scoring === 'standard' ? (
        <MatrixPasteEntry onMatrixChange={onMatrixChange} />
      ) : (
        <MatrixGridEntry
          scoring={scoring}
          onMatrixChange={onMatrixChange}
          {...(rosterA !== undefined ? { rosterA } : {})}
          {...(rosterB !== undefined ? { rosterB } : {})}
        />
      )}
    </section>
  );
}
