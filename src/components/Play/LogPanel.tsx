import type { LogEntry } from '../../engine/log.js';
import { findFaction } from '../../factions.js';

interface LogPanelProps {
  readonly entries: readonly LogEntry[];
}

function name(armyId: string): string {
  return findFaction(armyId)?.displayName ?? armyId;
}

function describe(entry: LogEntry): string {
  switch (entry.type) {
    case 'DefendersRevealed':
      return `R${roundLabel(entry.round)} reveal: A=${name(entry.aArmy)}  B=${name(entry.bArmy)} (defenders)`;
    case 'AttackersRevealed':
      return `R${roundLabel(entry.round)} reveal: A attackers {${entry.aAttackers.map(name).join(', ')}}  B attackers {${entry.bAttackers.map(name).join(', ')}}`;
    case 'RefusalsRevealed':
      return `R${roundLabel(entry.round)} reveal: A refuses ${name(entry.aRefused)}  B refuses ${name(entry.bRefused)}`;
    case 'TokenRollOff':
      return `Token roll-off: ${entry.winner} wins`;
    case 'TokenFlipped':
      return `Token → ${entry.newHolder} (${entry.reason})`;
    case 'TableChosen': {
      const who = entry.defenderArmy !== undefined ? `defends ${name(entry.defenderArmy)}` : '(auto-paired)';
      return `T${entry.tableId} ← ${entry.team} ${who}`;
    }
    case 'LastManAutoPaired':
      return `★ AUTO_LAST_MAN: ${name(entry.aArmy)} vs ${name(entry.bArmy)}`;
    case 'RefusedAutoPaired':
      return `★ AUTO_REFUSED_PAIR: ${name(entry.aArmy)} vs ${name(entry.bArmy)}`;
  }
}

function roundLabel(round: number | 'scrum'): string {
  return round === 'scrum' ? 'S' : String(round);
}

export function LogPanel({ entries }: LogPanelProps) {
  if (entries.length === 0) {
    return (
      <section className="rounded border border-slate-800 bg-slate-900/40 p-3 text-xs text-slate-500" data-testid="log-panel">
        Log will populate as the game progresses.
      </section>
    );
  }
  return (
    <section className="rounded border border-slate-800 bg-slate-900/40 p-3" data-testid="log-panel">
      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Log</h4>
      <ul className="space-y-1 font-mono text-xs text-slate-300">
        {entries.map((e, i) => (
          <li key={i}>{describe(e)}</li>
        ))}
      </ul>
    </section>
  );
}
