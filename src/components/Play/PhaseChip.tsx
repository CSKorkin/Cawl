import type { Phase } from '../../engine/state.js';

interface PhaseChipProps {
  readonly phase: Phase;
}

// Render the engine phase as a short, human-readable label.
function labelFor(phase: Phase): string {
  switch (phase) {
    case 'ROUND_1.AWAITING_DEFENDERS': return 'R1 — Defenders';
    case 'ROUND_1.AWAITING_ATTACKERS': return 'R1 — Attackers';
    case 'ROUND_1.AWAITING_REFUSALS': return 'R1 — Refusals';
    case 'ROUND_1.AWAITING_TABLES': return 'R1 — Tables';
    case 'ROUND_2.AWAITING_DEFENDERS': return 'R2 — Defenders';
    case 'ROUND_2.AWAITING_ATTACKERS': return 'R2 — Attackers';
    case 'ROUND_2.AWAITING_REFUSALS': return 'R2 — Refusals';
    case 'ROUND_2.AWAITING_TABLES': return 'R2 — Tables';
    case 'SCRUM.AWAITING_DEFENDERS': return 'Scrum — Defenders';
    case 'SCRUM.AWAITING_ATTACKERS': return 'Scrum — Attackers';
    case 'SCRUM.AWAITING_REFUSALS': return 'Scrum — Refusals';
    case 'SCRUM.AWAITING_TABLES': return 'Scrum — Tables';
    case 'GAME_COMPLETE': return 'Game complete';
    case 'INIT':
    case 'ROUND_1_COMPLETE':
    case 'ROUND_2_COMPLETE':
    case 'SCRUM.AUTO_LAST_MAN':
    case 'SCRUM.AUTO_REFUSED_PAIR':
      return phase;
  }
}

export function PhaseChip({ phase }: PhaseChipProps) {
  return (
    <span
      className="rounded border border-slate-700 bg-slate-800 px-2 py-1 font-mono text-xs text-slate-200"
      data-testid="phase-chip"
    >
      {labelFor(phase)}
    </span>
  );
}
