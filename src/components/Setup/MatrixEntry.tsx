import { useEffect, useState } from 'react';
import type { ScoreMode } from '../../engine/score.js';
import { MatrixPasteEntry } from './MatrixPasteEntry.js';
import { MatrixGridEntry } from './MatrixGridEntry.js';

type EntryMethod = 'paste' | 'grid';

interface MatrixEntryProps {
  readonly scoring: ScoreMode;
  readonly onMatrixChange: (matrix: readonly (readonly number[])[] | null) => void;
}

// Wrapper for the Entered matrix flow. Standard mode supports either paste
// (sheet format) or cell-by-cell grid; atlas mode only supports the grid
// since the paste vocabulary is built around 0–20 colors.
export function MatrixEntry({ scoring, onMatrixChange }: MatrixEntryProps) {
  const [method, setMethod] = useState<EntryMethod>('paste');

  // If the user switches to atlas, force the grid (paste isn't valid).
  useEffect(() => {
    if (scoring === 'atlas' && method === 'paste') {
      setMethod('grid');
    }
  }, [scoring, method]);

  return (
    <section className="space-y-3" data-testid="matrix-entry">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
        Matrix
      </h3>
      <fieldset className="flex items-center gap-4 text-sm" data-testid="matrix-entry-method">
        <legend className="sr-only">Entry method</legend>
        {scoring === 'standard' && (
          <label className="flex items-center gap-1">
            <input
              type="radio"
              name="entry-method"
              value="paste"
              checked={method === 'paste'}
              onChange={() => setMethod('paste')}
            />
            Paste from sheet
          </label>
        )}
        <label className="flex items-center gap-1">
          <input
            type="radio"
            name="entry-method"
            value="grid"
            checked={method === 'grid'}
            onChange={() => setMethod('grid')}
          />
          Cell-by-cell grid
        </label>
      </fieldset>

      {method === 'paste' && scoring === 'standard' ? (
        <MatrixPasteEntry onMatrixChange={onMatrixChange} />
      ) : (
        <MatrixGridEntry scoring={scoring} onMatrixChange={onMatrixChange} />
      )}
    </section>
  );
}
