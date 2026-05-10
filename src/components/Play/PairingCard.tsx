import { motion } from 'framer-motion';
import type { ArmyId, Team } from '../../engine/log.js';
import { findFaction } from '../../factions.js';

interface PairingCardProps {
  readonly armyId: ArmyId;
  readonly team: Team;
  // U7 polish: when true, the card has a brighter ring (e.g., currently
  // selected in a triangle slot, or the human's tentative pick).
  readonly highlighted?: boolean;
  // When true, clicking the card fires onClick. Otherwise pointer-events
  // remain disabled (cards in the slate / opp roster are non-interactive).
  readonly clickable?: boolean;
  // U7 polish: pulse on collapse-reveal. PlayScreen passes it down via the
  // existing flashingIds set.
  readonly flashing?: boolean;
  readonly onClick?: () => void;
  readonly testId?: string;
}

// One army → one card. Cards animate between the roster, the active
// triangle pick zone, and the slate via framer-motion's `layoutId`. The
// id is namespaced by team so cross-team duplicate factions (e.g. both
// teams pick Space Marines) get independent layout groups.
export function PairingCard({
  armyId, team, highlighted, clickable, flashing, onClick, testId,
}: PairingCardProps) {
  const faction = findFaction(armyId);
  const teamRing = team === 'A' ? 'ring-sky-500/70' : 'ring-amber-500/70';
  const ringClass = highlighted === true
    ? `ring-2 ${teamRing}`
    : 'ring-1 ring-slate-700';
  const flashClass = flashing === true ? 'animate-reveal-flash' : '';
  const cursorClass = clickable === true ? 'cursor-pointer hover:ring-2' : 'cursor-default';

  return (
    <motion.button
      type="button"
      // layoutId drives the shared-element transition: when the same
      // armyId/team renders in a new DOM position, framer interpolates
      // between the two. Bare `layout` would only animate within the
      // current parent.
      layoutId={`card-${team}-${armyId}`}
      // Opt out of layout animation for non-position changes (size etc.) to
      // avoid the rosters jitter-shifting when the slate fills.
      layout="position"
      transition={{ type: 'spring', stiffness: 320, damping: 32 }}
      onClick={clickable === true ? onClick : undefined}
      disabled={clickable !== true}
      data-testid={testId ?? `card-${team}-${armyId}`}
      data-team={team}
      data-army-id={armyId}
      data-highlighted={highlighted === true ? 'true' : 'false'}
      data-flashing={flashing === true ? 'true' : 'false'}
      className={[
        'flex flex-col items-center justify-start gap-1 rounded-xl border border-slate-700 bg-slate-900/80 p-2 text-center text-[11px] leading-tight text-slate-100',
        'h-24 w-24 shrink-0 select-none',
        ringClass,
        flashClass,
        cursorClass,
      ].join(' ')}
    >
      {faction !== undefined ? (
        <img
          src={faction.logoPath}
          alt=""
          className="h-9 w-9 shrink-0 object-contain"
        />
      ) : (
        <div className="h-9 w-9 shrink-0 rounded bg-slate-800" />
      )}
      <span className="line-clamp-2 leading-tight">
        {faction?.displayName ?? armyId}
      </span>
    </motion.button>
  );
}
