// Final slate: 8 pairings ordered by table number, with each team's own
// predicted score for that matchup and a totals row + verdict at the
// bottom. Mirrors the m5 demo's text-mode output (see demos/m5-easy-ai.ts).

import { findFaction } from '../../factions.js';
import { viewFor } from '../../engine/state.js';
import type { Pairing, PairingState, TeamView } from '../../engine/state.js';
import type { ArmyId } from '../../engine/log.js';

interface FinalSlateProps {
  readonly state: PairingState;
}

function nameOf(armyId: ArmyId): string {
  return findFaction(armyId)?.displayName ?? armyId;
}

function logoOf(armyId: ArmyId): string | null {
  return findFaction(armyId)?.logoPath ?? null;
}

function roundLabel(p: Pairing): string {
  if (p.round === 1) return 'R1';
  if (p.round === 2) return 'R2';
  return p.defenderTeam === null ? 'Sc*' : 'Sc';
}

function defenderLabel(p: Pairing): string {
  if (p.defenderTeam === null) return 'auto-paired';
  return `${p.defenderTeam} defends`;
}

// Each team's own predicted score for a matchup, looked up against that
// team's view of the matrix. By construction these don't sum to the WTC
// per-matchup total — the per-cell variance gives each side an independent
// prediction.
function expectedScore(view: TeamView, myArmy: ArmyId, oppArmy: ArmyId): number {
  const i = view.myRoster.indexOf(myArmy);
  const j = view.oppRoster.indexOf(oppArmy);
  return view.myView[i]![j]!.value as number;
}

interface RowSummary {
  readonly pairing: Pairing;
  readonly aScore: number;
  readonly bScore: number;
}

function summarize(state: PairingState): {
  readonly rows: readonly RowSummary[];
  readonly aTotal: number;
  readonly bTotal: number;
} {
  const va = viewFor(state, 'A');
  const vb = viewFor(state, 'B');
  const sorted = [...state.pairings].sort(
    (a, b) => (a.tableId ?? 0) - (b.tableId ?? 0),
  );
  let aTotal = 0;
  let bTotal = 0;
  const rows = sorted.map((p) => {
    const aScore = expectedScore(va, p.aArmy, p.bArmy);
    const bScore = expectedScore(vb, p.bArmy, p.aArmy);
    aTotal += aScore;
    bTotal += bScore;
    return { pairing: p, aScore, bScore };
  });
  return { rows, aTotal, bTotal };
}

function verdict(aTotal: number, bTotal: number): string {
  if (aTotal > bTotal) return `Team A wins by ${aTotal - bTotal}`;
  if (bTotal > aTotal) return `Team B wins by ${bTotal - aTotal}`;
  return 'Predicted draw';
}

function ArmyCell({ armyId }: { readonly armyId: ArmyId }) {
  const logo = logoOf(armyId);
  return (
    <span className="inline-flex items-center gap-2">
      {logo !== null ? (
        <img src={logo} alt="" className="h-5 w-5 shrink-0 object-contain" />
      ) : (
        <span className="h-5 w-5 shrink-0 rounded bg-slate-800" />
      )}
      <span className="truncate">{nameOf(armyId)}</span>
    </span>
  );
}

export function FinalSlate({ state }: FinalSlateProps) {
  const { rows, aTotal, bTotal } = summarize(state);
  return (
    <section className="rounded border border-slate-800 bg-slate-900/40 p-4" data-testid="final-slate">
      <table className="w-full text-sm">
        <thead className="text-xs uppercase text-slate-400">
          <tr>
            <th className="px-2 py-1 text-left">T#</th>
            <th className="px-2 py-1 text-left">Round</th>
            <th className="px-2 py-1 text-left">Team A</th>
            <th className="px-2 py-1 text-center">vs</th>
            <th className="px-2 py-1 text-left">Team B</th>
            <th className="px-2 py-1 text-left">Defender</th>
            <th className="px-2 py-1 text-right font-mono">A</th>
            <th className="px-2 py-1 text-right font-mono">B</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ pairing: p, aScore, bScore }) => (
            <tr key={p.tableId} data-testid={`slate-row-t${p.tableId}`} className="border-t border-slate-800">
              <td className="px-2 py-1 font-mono">T{p.tableId}</td>
              <td className="px-2 py-1 text-slate-400">{roundLabel(p)}</td>
              <td className="px-2 py-1"><ArmyCell armyId={p.aArmy} /></td>
              <td className="px-2 py-1 text-center text-slate-500">vs</td>
              <td className="px-2 py-1"><ArmyCell armyId={p.bArmy} /></td>
              <td className="px-2 py-1 text-xs text-slate-400">{defenderLabel(p)}</td>
              <td className="px-2 py-1 text-right font-mono" data-testid={`slate-row-t${p.tableId}-a-score`}>{aScore}</td>
              <td className="px-2 py-1 text-right font-mono" data-testid={`slate-row-t${p.tableId}-b-score`}>{bScore}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-slate-700 text-sm font-semibold">
            <td className="px-2 py-2" colSpan={6}>
              <span className="text-xs uppercase tracking-wide text-slate-400">Totals</span>
            </td>
            <td className="px-2 py-2 text-right font-mono" data-testid="slate-total-a">{aTotal}</td>
            <td className="px-2 py-2 text-right font-mono" data-testid="slate-total-b">{bTotal}</td>
          </tr>
        </tfoot>
      </table>
      <p className="mt-3 text-sm text-slate-300" data-testid="slate-verdict">
        Predicted result (under each team's own beliefs):{' '}
        <span className="font-semibold text-sky-300">{verdict(aTotal, bTotal)}</span>
      </p>
    </section>
  );
}
