import type { GameMode } from './types.js';

interface ModePickerProps {
  readonly value: GameMode;
  readonly onChange: (mode: GameMode) => void;
}

export function ModePicker({ value, onChange }: ModePickerProps) {
  const isHotSeat = value.kind === 'hot-seat';
  const isSp = value.kind === 'sp';
  const tier = isSp ? value.tier : null;

  return (
    <fieldset className="space-y-3">
      <legend className="text-sm font-semibold uppercase tracking-wide text-slate-400">Mode</legend>
      <div className="space-y-2">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="radio"
            name="mode"
            value="hot-seat"
            checked={isHotSeat}
            onChange={() => onChange({ kind: 'hot-seat' })}
            className="accent-sky-500"
          />
          <span>Hot-seat (2 humans, one device)</span>
        </label>

        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="radio"
            name="mode"
            value="sp"
            checked={isSp}
            onChange={() => onChange({ kind: 'sp', tier: 'easy' })}
            className="accent-sky-500"
          />
          <span>Single-player vs AI</span>
        </label>
      </div>

      {isSp && (
        <fieldset className="ml-6 space-y-2 border-l border-slate-700 pl-4">
          <legend className="text-xs font-semibold uppercase tracking-wide text-slate-500">AI tier</legend>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              name="tier"
              value="easy"
              checked={tier === 'easy'}
              onChange={() => onChange({ kind: 'sp', tier: 'easy' })}
              className="accent-sky-500"
            />
            <span>Easy</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              name="tier"
              value="medium"
              checked={tier === 'medium'}
              onChange={() => onChange({ kind: 'sp', tier: 'medium' })}
              className="accent-sky-500"
            />
            <span>Medium</span>
          </label>
          <label className="flex items-center gap-2 opacity-50 cursor-not-allowed">
            <input type="radio" name="tier" value="hard" disabled className="accent-sky-500" />
            <span>Hard <span className="text-xs text-slate-500">(coming soon)</span></span>
          </label>
        </fieldset>
      )}
    </fieldset>
  );
}
