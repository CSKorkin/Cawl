import type { Team } from '../../engine/log.js';

interface TokenChipProps {
  readonly tokenHolder: Team | null;
  // U6 polish: when true, the chip plays a one-shot scale pulse
  // animation. PlayScreen forces a remount via key= when the holder
  // changes, so the animation restarts on every flip.
  readonly pulse?: boolean;
}

export function TokenChip({ tokenHolder, pulse }: TokenChipProps) {
  const pulseClass = pulse === true ? 'animate-token-pulse inline-block origin-center' : '';
  if (tokenHolder === null) {
    return (
      <span
        className={`rounded border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-400 ${pulseClass}`}
        data-testid="token-chip"
        data-holder=""
      >
        ◯ Token: —
      </span>
    );
  }
  const color = tokenHolder === 'A' ? 'text-sky-400' : 'text-amber-400';
  return (
    <span
      className={`rounded border border-slate-700 bg-slate-800 px-2 py-1 text-xs ${color} ${pulseClass}`}
      data-testid="token-chip"
      data-holder={tokenHolder}
    >
      ● Token: {tokenHolder}
    </span>
  );
}
