import type { Team } from '../../engine/log.js';

interface TokenChipProps {
  readonly tokenHolder: Team | null;
}

export function TokenChip({ tokenHolder }: TokenChipProps) {
  if (tokenHolder === null) {
    return (
      <span
        className="rounded border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-400"
        data-testid="token-chip"
      >
        ◯ Token: —
      </span>
    );
  }
  const color = tokenHolder === 'A' ? 'text-sky-400' : 'text-amber-400';
  return (
    <span
      className={`rounded border border-slate-700 bg-slate-800 px-2 py-1 text-xs ${color}`}
      data-testid="token-chip"
    >
      ● Token: {tokenHolder}
    </span>
  );
}
