import type { MatrixSource } from './types.js';

interface MatrixSourcePickerProps {
  readonly value: MatrixSource;
  readonly seed: number;
  readonly onChange: (source: MatrixSource) => void;
  readonly onReroll: () => void;
}

// Format a 32-bit unsigned int as 0xHEX, padded to 8 digits.
function formatSeed(seed: number): string {
  const u = seed >>> 0;
  return `0x${u.toString(16).toUpperCase().padStart(8, '0')}`;
}

export function MatrixSourcePicker({ value, seed, onChange, onReroll }: MatrixSourcePickerProps) {
  const isGenerated = value === 'generated';
  return (
    <fieldset className="space-y-3">
      <legend className="text-sm font-semibold uppercase tracking-wide text-slate-400">Matrix source</legend>
      <div className="space-y-2">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="radio"
            name="matrixSource"
            value="generated"
            checked={isGenerated}
            onChange={() => onChange('generated')}
            className="accent-sky-500"
          />
          <span>Generated</span>
        </label>
        {isGenerated && (
          <div className="ml-6 flex items-center gap-3 text-sm">
            <span className="text-slate-400">Seed:</span>
            <code className="font-mono text-slate-200" data-testid="seed-display">{formatSeed(seed)}</code>
            <button
              type="button"
              onClick={onReroll}
              className="rounded border border-slate-700 bg-slate-800 px-3 py-1 text-xs hover:bg-slate-700"
            >
              Re-roll
            </button>
          </div>
        )}

        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="radio"
            name="matrixSource"
            value="entered"
            checked={value === 'entered'}
            onChange={() => onChange('entered')}
            className="accent-sky-500"
          />
          <span>Entered <span className="text-xs text-slate-500">(paste from sheet or enter cell-by-cell)</span></span>
        </label>
      </div>
    </fieldset>
  );
}
