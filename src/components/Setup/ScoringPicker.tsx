import type { ScoreMode } from '../../engine/score.js';

interface ScoringPickerProps {
  readonly value: ScoreMode;
  readonly onChange: (scoring: ScoreMode) => void;
}

export function ScoringPicker({ value, onChange }: ScoringPickerProps) {
  return (
    <fieldset className="space-y-3">
      <legend className="text-sm font-semibold uppercase tracking-wide text-slate-400">Scoring</legend>
      <div className="space-y-2">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="radio"
            name="scoring"
            value="standard"
            checked={value === 'standard'}
            onChange={() => onChange('standard')}
            className="accent-sky-500"
          />
          <span>Standard <span className="text-xs text-slate-500">(0–20 integer)</span></span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="radio"
            name="scoring"
            value="atlas"
            checked={value === 'atlas'}
            onChange={() => onChange('atlas')}
            className="accent-sky-500"
          />
          <span>Atlas <span className="text-xs text-slate-500">(1–5 ordinal: 1, 2, 2.5, 3, 3.5, 4, 5)</span></span>
        </label>
      </div>
    </fieldset>
  );
}
