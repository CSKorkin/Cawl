import { useState } from 'react';
import type { LogEntry } from '../../engine/log.js';
import { findFaction } from '../../factions.js';

interface LogPanelProps {
  readonly entries: readonly LogEntry[];
}

function name(armyId: string): string {
  return findFaction(armyId)?.displayName ?? armyId;
}

// One-line summary used in the collapsed log row. Keep this terse — the
// hover/expanded view carries the verbose detail.
function summarize(entry: LogEntry): string {
  switch (entry.type) {
    case 'DefendersRevealed':
      return `R${roundLabel(entry.round)} defenders: ${name(entry.aArmy)} vs ${name(entry.bArmy)}`;
    case 'AttackersRevealed':
      return `R${roundLabel(entry.round)} attackers proposed`;
    case 'RefusalsRevealed':
      return `R${roundLabel(entry.round)} refusals: A↶${name(entry.aRefused)} · B↶${name(entry.bRefused)}`;
    case 'TokenRollOff':
      return `Token roll-off → ${entry.winner}`;
    case 'TokenFlipped':
      return `Token → ${entry.newHolder} (${entry.reason})`;
    case 'TableChosen': {
      const who = entry.defenderArmy !== undefined ? `${entry.team} defends ${name(entry.defenderArmy)}` : `(auto-paired)`;
      return `T${entry.tableId} ← ${who}`;
    }
    case 'LastManAutoPaired':
      return `★ Last-man auto: ${name(entry.aArmy)} vs ${name(entry.bArmy)}`;
    case 'RefusedAutoPaired':
      return `★ Refused auto: ${name(entry.aArmy)} vs ${name(entry.bArmy)}`;
  }
}

// Hover-revealed detail. Pulls in any per-type extras (full attacker
// lists, scoring perspective). We render this as the title= attribute on
// the row so it surfaces as a native tooltip without extra DOM.
function detail(entry: LogEntry): string {
  switch (entry.type) {
    case 'AttackersRevealed':
      return `A attackers: ${entry.aAttackers.map(name).join(', ')}\nB attackers: ${entry.bAttackers.map(name).join(', ')}`;
    case 'TableChosen':
      return entry.defenderArmy !== undefined
        ? `Table ${entry.tableId} chosen by ${entry.team}; ${entry.team} defends ${name(entry.defenderArmy)}.`
        : `Table ${entry.tableId} auto-assigned to the scrum auto-pair.`;
    case 'TokenFlipped':
      return `Token flipped to ${entry.newHolder} — reason: ${entry.reason}.`;
    case 'TokenRollOff':
      return `Coin flip at the start of R1 table picks: ${entry.winner} wins the token.`;
    default:
      // Fall back to the summary itself.
      return summarize(entry);
  }
}

const TYPE_COLOR: Record<LogEntry['type'], string> = {
  DefendersRevealed:   'text-sky-300',
  AttackersRevealed:   'text-amber-300',
  RefusalsRevealed:    'text-rose-300',
  TokenRollOff:        'text-violet-300',
  TokenFlipped:        'text-violet-300',
  TableChosen:         'text-emerald-300',
  LastManAutoPaired:   'text-fuchsia-300',
  RefusedAutoPaired:   'text-fuchsia-300',
};

const TYPE_GLYPH: Record<LogEntry['type'], string> = {
  DefendersRevealed:   '⛨',
  AttackersRevealed:   '⚔',
  RefusalsRevealed:    '✘',
  TokenRollOff:        '◉',
  TokenFlipped:        '↔',
  TableChosen:         '▤',
  LastManAutoPaired:   '★',
  RefusedAutoPaired:   '★',
};

function roundLabel(round: number | 'scrum'): string {
  return round === 'scrum' ? 'S' : String(round);
}

export function LogPanel({ entries }: LogPanelProps) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <section className="rounded border border-slate-800 bg-slate-900/40" data-testid="log-panel">
      <header className="flex items-center justify-between gap-2 border-b border-slate-800 px-3 py-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
          Log <span className="ml-1 text-slate-500">({entries.length})</span>
        </h4>
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          className="rounded border border-slate-700 bg-slate-800 px-2 py-0.5 text-[11px] uppercase tracking-wide text-slate-300 hover:bg-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-400"
          data-testid="log-toggle"
        >
          {collapsed ? 'Show' : 'Hide'}
        </button>
      </header>
      {!collapsed && (
        entries.length === 0 ? (
          <p className="px-3 py-2 text-xs text-slate-500">
            Log will populate as the game progresses.
          </p>
        ) : (
          <ul className="divide-y divide-slate-800/60 font-mono text-xs">
            {entries.map((e, i) => (
              <li
                key={i}
                title={detail(e)}
                className={`flex items-baseline gap-2 px-3 py-1 hover:bg-slate-800/50 ${TYPE_COLOR[e.type]}`}
                data-testid={`log-entry-${i}`}
                data-entry-type={e.type}
              >
                <span aria-hidden="true" className="w-4 text-center opacity-80">{TYPE_GLYPH[e.type]}</span>
                <span className="flex-1">{summarize(e)}</span>
              </li>
            ))}
          </ul>
        )
      )}
    </section>
  );
}
