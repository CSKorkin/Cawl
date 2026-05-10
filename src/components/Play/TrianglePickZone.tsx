import type { ReactNode } from 'react';
import type { Team } from '../../engine/log.js';

interface TrianglePickZoneProps {
  // Whose defender sits at the bottom of this triangle. Top slots host
  // the OPP's two attackers (the matchup forming AROUND this defender).
  readonly defenderTeam: Team;
  // True when the viewer's current pick lands in this triangle. Drives
  // the highlight ring; selection logic still lives in PlayScreen.
  readonly active: boolean;
  readonly attackerSlot1: ReactNode;
  readonly attackerSlot2: ReactNode;
  readonly defenderSlot: ReactNode;
}

// Triangle layout: two attacker slots on top, defender slot centered
// below them. Slot containers are fixed-size so the cards'
// shared-element transitions land in a stable position.
export function TrianglePickZone({
  defenderTeam, active, attackerSlot1, attackerSlot2, defenderSlot,
}: TrianglePickZoneProps) {
  const teamColor = defenderTeam === 'A' ? 'text-sky-400' : 'text-amber-400';
  return (
    <section
      className={`flex flex-col items-center gap-2 rounded-lg border ${active ? 'border-slate-600 bg-slate-900/60' : 'border-slate-800 bg-slate-900/30'} p-3`}
      data-testid={`triangle-${defenderTeam.toLowerCase()}`}
      data-defender-team={defenderTeam}
      data-active={active ? 'true' : 'false'}
    >
      <h4 className={`text-xs font-semibold uppercase tracking-wider ${teamColor}`}>
        Team {defenderTeam} defends
      </h4>
      <div className="flex items-end gap-2">
        <Slot kind="attacker" defenderTeam={defenderTeam} index={1}>{attackerSlot1}</Slot>
        <Slot kind="attacker" defenderTeam={defenderTeam} index={2}>{attackerSlot2}</Slot>
      </div>
      <div className="flex justify-center">
        <Slot kind="defender" defenderTeam={defenderTeam}>{defenderSlot}</Slot>
      </div>
    </section>
  );
}

interface SlotProps {
  readonly kind: 'defender' | 'attacker';
  readonly defenderTeam: Team;
  readonly index?: 1 | 2;
  readonly children: ReactNode;
}

function Slot({ kind, defenderTeam, index, children }: SlotProps) {
  const empty = children === null || children === undefined || children === false;
  const labelMap: Record<'defender' | 'attacker', string> = {
    defender: 'DEF',
    attacker: 'ATK',
  };
  const slotKey = kind === 'defender' ? 'defender' : `atk${index}`;
  return (
    <div
      className={`flex h-24 w-24 items-center justify-center rounded-xl border border-dashed ${
        empty ? 'border-slate-700/60 bg-slate-900/20' : 'border-transparent'
      }`}
      data-testid={`triangle-slot-${defenderTeam.toLowerCase()}-${slotKey}`}
    >
      {empty ? (
        <span className="text-[10px] uppercase tracking-widest text-slate-600">
          {labelMap[kind]}
        </span>
      ) : (
        children
      )}
    </div>
  );
}
