// Final slate: 8 pairings ordered by table number, with each team's own
// predicted score for that matchup and a totals row + verdict at the
// bottom. Mirrors the m5 demo's text-mode output (see demos/m5-easy-ai.ts).

import { findFaction } from '../../factions.js';
import { viewFor } from '../../engine/state.js';
import type { Pairing, PairingState, TeamView } from '../../engine/state.js';
import { applyTableModifier } from '../../engine/score.js';
import type { TableModifier } from '../../engine/score.js';
import type { ArmyId, Team } from '../../engine/log.js';

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

// Each team's own predicted base score for a matchup, looked up against
// that team's view of the matrix. By construction these don't sum to the
// WTC per-matchup total — the per-cell variance gives each side an
// independent prediction.
function baseScore(view: TeamView, myArmy: ArmyId, oppArmy: ArmyId): number {
  const i = view.myRoster.indexOf(myArmy);
  const j = view.oppRoster.indexOf(oppArmy);
  return view.myView[i]![j]!.value as number;
}

// Team's view of the table modifier on a pairing's cell. Reads impactA
// when team===A, impactB when team===B (each team's view of the same
// matchup is the symbolic inverse — '+' for one is '-' for the other),
// then applies the modifier to the base via the *clamped* score path so
// the rendered delta matches the actual change to that team's score.
//
// Returns delta = 0 when no modifier applies (null symbol or no tableId).
// Pairings without tableId can't have an applied modifier yet — the
// FinalSlate is rendered at GAME_COMPLETE, so all pairings carry one.
function impactDelta(
  state: PairingState,
  pairing: Pairing,
  team: Team,
): { readonly delta: number; readonly symbol: TableModifier | null } {
  if (pairing.tableId === undefined) return { delta: 0, symbol: null };
  const aIdx = state.rosterA.indexOf(pairing.aArmy);
  const bIdx = state.rosterB.indexOf(pairing.bArmy);
  if (aIdx < 0 || bIdx < 0) return { delta: 0, symbol: null };
  const slot = pairing.tableId - 1;
  const sym: TableModifier | null = team === 'A'
    ? (state.matrix.impactA[aIdx]?.[bIdx]?.[slot] ?? null)
    : (state.matrix.impactB[bIdx]?.[aIdx]?.[slot] ?? null);
  if (sym === null) return { delta: 0, symbol: null };
  const base = team === 'A'
    ? state.matrix.viewA[aIdx]![bIdx]!
    : state.matrix.viewB[bIdx]![aIdx]!;
  const shifted = applyTableModifier(base, sym);
  return { delta: (shifted.value as number) - (base.value as number), symbol: sym };
}

interface RowSummary {
  readonly pairing: Pairing;
  // Base = each team's view of the cell; final = base + clamped delta
  // (the modifier may saturate near the score edges — e.g. base 18 with
  // `++` only contributes +2, not the nominal +6 — so the displayed
  // delta is the real change, not the symbolic value).
  readonly aBase: number;
  readonly bBase: number;
  readonly aDelta: number;
  readonly bDelta: number;
  readonly aSym: TableModifier | null;
  readonly bSym: TableModifier | null;
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
    const aBase = baseScore(va, p.aArmy, p.bArmy);
    const bBase = baseScore(vb, p.bArmy, p.aArmy);
    const aImpact = impactDelta(state, p, 'A');
    const bImpact = impactDelta(state, p, 'B');
    aTotal += aBase + aImpact.delta;
    bTotal += bBase + bImpact.delta;
    return {
      pairing: p,
      aBase, bBase,
      aDelta: aImpact.delta, bDelta: bImpact.delta,
      aSym: aImpact.symbol, bSym: bImpact.symbol,
    };
  });
  return { rows, aTotal, bTotal };
}

// Tint the modifier annotation by symbol — same hierarchy as the matrix
// chip overlay and the table-pick UI (Matrix CHIP_BG / StepPrompt
// MODIFIER_BG): '+'/'++' increasingly green, '-'/'--' increasingly red.
const MOD_TEXT_COLOR: Record<TableModifier, string> = {
  '+':  'text-emerald-300',
  '++': 'text-green-200',
  '-':  'text-orange-300',
  '--': 'text-red-300',
};

function formatDelta(delta: number, tableId: number | undefined): string {
  const sign = delta > 0 ? '+' : '';
  const t = tableId === undefined ? '' : ` T${tableId}`;
  return `${sign}${delta}${t}`;
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
          {rows.map(({ pairing: p, aBase, bBase, aDelta, bDelta, aSym, bSym }) => {
            const aFinal = aBase + aDelta;
            const bFinal = bBase + bDelta;
            return (
              <tr key={p.tableId} data-testid={`slate-row-t${p.tableId}`} className="border-t border-slate-800">
                <td className="px-2 py-1 font-mono">T{p.tableId}</td>
                <td className="px-2 py-1 text-slate-400">{roundLabel(p)}</td>
                <td className="px-2 py-1"><ArmyCell armyId={p.aArmy} /></td>
                <td className="px-2 py-1 text-center text-slate-500">vs</td>
                <td className="px-2 py-1"><ArmyCell armyId={p.bArmy} /></td>
                <td className="px-2 py-1 text-xs text-slate-400">{defenderLabel(p)}</td>
                <td className="px-2 py-1 text-right font-mono">
                  <span data-testid={`slate-row-t${p.tableId}-a-score`}>{aFinal}</span>
                  {aSym !== null && (
                    <span
                      data-testid={`slate-row-t${p.tableId}-a-mod`}
                      data-modifier={aSym}
                      className={`ml-1 text-[10px] ${MOD_TEXT_COLOR[aSym]}`}
                    >
                      {`(${formatDelta(aDelta, p.tableId)})`}
                    </span>
                  )}
                </td>
                <td className="px-2 py-1 text-right font-mono">
                  <span data-testid={`slate-row-t${p.tableId}-b-score`}>{bFinal}</span>
                  {bSym !== null && (
                    <span
                      data-testid={`slate-row-t${p.tableId}-b-mod`}
                      data-modifier={bSym}
                      className={`ml-1 text-[10px] ${MOD_TEXT_COLOR[bSym]}`}
                    >
                      {`(${formatDelta(bDelta, p.tableId)})`}
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
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
