import type { TeamView } from '../../engine/state.js';
import type { Score } from '../../engine/score.js';
import { colorBand } from '../../engine/score.js';
import { findFaction } from '../../factions.js';

interface MatrixProps {
  // The viewer's view of the matrix. Always passed `viewFor(state, viewer)`
  // — the engine guarantees opp pendings are stripped.
  readonly view: TeamView;
}

const BAND_BG: Record<string, string> = {
  red:        'bg-red-900/60 text-red-200',
  orange:     'bg-orange-900/60 text-orange-200',
  yellow:     'bg-yellow-900/60 text-yellow-100',
  lightGreen: 'bg-emerald-900/60 text-emerald-200',
  darkGreen:  'bg-green-800/70 text-green-100',
};

function cellClass(score: Score): string {
  const band = colorBand(score);
  return BAND_BG[band] ?? 'bg-slate-800 text-slate-200';
}

function meanScore(values: readonly number[]): number {
  if (values.length === 0) return 0;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

// Color a derived (mean) value by rounding to nearest int and looking up the
// standard color band. For atlas mode the rounded value won't always land on
// a tier, but the band scheme is intentionally identical to standard.
function meanCellClass(value: number, mode: 'standard' | 'atlas'): string {
  const rounded = Math.round(value);
  // Synthesize a Score for the band lookup — colorBand only uses the value.
  if (mode === 'standard') {
    const v = Math.max(0, Math.min(20, rounded));
    return cellClass({ mode: 'standard', value: v });
  }
  // Atlas: nearest tier value (1..5 ints; rounded mean ∈ [1,5] OK).
  const v = Math.max(1, Math.min(5, rounded));
  return cellClass({ mode: 'atlas', value: v as 1 | 2 | 3 | 4 | 5 });
}

export function Matrix({ view }: MatrixProps) {
  const myView = view.myView;
  const myRoster = view.myRoster;
  const oppRoster = view.oppRoster;

  // Hide rows / columns whose army has been paired off. The matrix shrinks
  // each round so the user is only looking at the matchups still in play.
  // Mid-step pendings (def-locked / attackers-locked) stay visible — they
  // haven't been paired yet and are still part of the active decision.
  const myPaired = new Set<string>();
  const oppPaired = new Set<string>();
  for (const p of view.pairings) {
    if (view.seat === 'A') {
      myPaired.add(p.aArmy);
      oppPaired.add(p.bArmy);
    } else {
      myPaired.add(p.bArmy);
      oppPaired.add(p.aArmy);
    }
  }
  const visibleRows = myRoster
    .map((id, i) => ({ id, i }))
    .filter((r) => !myPaired.has(r.id));
  const visibleCols = oppRoster
    .map((id, j) => ({ id, j }))
    .filter((c) => !oppPaired.has(c.id));

  // Margin averages still use the pool (which excludes paired armies and so
  // is the same set as visibleRows/visibleCols by id).
  const myPoolSet = new Set(view.myPool);
  const oppPoolSet = new Set(view.oppPool);

  function rowAvg(i: number): number {
    const values: number[] = [];
    for (let j = 0; j < oppRoster.length; j++) {
      if (!oppPoolSet.has(oppRoster[j]!)) continue;
      values.push(myView[i]![j]!.value as number);
    }
    return meanScore(values);
  }

  function colAvg(j: number): number {
    const values: number[] = [];
    for (let i = 0; i < myRoster.length; i++) {
      if (!myPoolSet.has(myRoster[i]!)) continue;
      values.push(myView[i]![j]!.value as number);
    }
    return meanScore(values);
  }

  return (
    <div className="overflow-x-auto" data-testid="matrix">
      <table className="border-separate border-spacing-1 text-center text-sm">
        <thead>
          <tr>
            <th className="text-xs text-slate-500"></th>
            {visibleCols.map(({ id }) => (
              <th key={id} className="text-xs text-slate-400" title={findFaction(id)?.displayName}>
                {labelOf(id)}
              </th>
            ))}
            <th className="text-xs uppercase text-slate-500">avg</th>
          </tr>
        </thead>
        <tbody>
          {visibleRows.map(({ id: rowId, i }) => (
            <tr key={rowId}>
              <th
                className="text-xs text-slate-400"
                title={findFaction(rowId)?.displayName}
              >
                {labelOf(rowId)}
              </th>
              {visibleCols.map(({ id: colId, j }) => {
                const score = myView[i]![j]!;
                return (
                  <td
                    key={colId}
                    className={`h-9 w-10 rounded font-mono ${cellClass(score)}`}
                    data-testid={`cell-${i}-${j}`}
                  >
                    {score.value}
                  </td>
                );
              })}
              <td
                className={`h-9 w-12 rounded font-mono ${meanCellClass(rowAvg(i), view.mode)}`}
                data-testid={`row-avg-${i}`}
              >
                {rowAvg(i).toFixed(1)}
              </td>
            </tr>
          ))}
          <tr>
            <th className="text-xs uppercase text-slate-500">avg</th>
            {visibleCols.map(({ id: colId, j }) => (
              <td
                key={colId}
                className={`h-9 w-10 rounded font-mono ${meanCellClass(colAvg(j), view.mode)}`}
                data-testid={`col-avg-${j}`}
              >
                {colAvg(j).toFixed(1)}
              </td>
            ))}
            <td />
          </tr>
        </tbody>
      </table>
    </div>
  );
}

// Compact single-letter row/col label using the engine's army id. The slot
// detail (faction logo + name) lives in the Roster panels alongside.
function labelOf(id: string): string {
  // Engine ArmyIds in the UI are faction slugs ("space-marines", etc.).
  // Show first letter capitalized + numeric suffix if present.
  const m = id.match(/-(\d+)$/);
  if (m !== null) return id[0]!.toUpperCase() + m[1]!;
  return id[0]!.toUpperCase();
}

