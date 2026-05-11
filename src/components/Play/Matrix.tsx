import type { TeamView } from '../../engine/state.js';
import type { CellImpact } from '../../engine/matrix.js';
import type { Score, TableModifier } from '../../engine/score.js';
import { colorBand, tableModifierDelta } from '../../engine/score.js';
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

// Per-modifier chip styling. `+`/`++` lift the matchup → green tints; `-`/`--`
// drop it → red tints. The `++`/`--` chips use a slightly bolder background
// so the second tier of intensity reads at a glance, mirroring the colorBand
// scheme on the main score cells. Mid-grey is reserved for null (no chip).
const CHIP_BG: Record<TableModifier, string> = {
  '+':  'bg-emerald-700/80 text-emerald-50',
  '++': 'bg-green-600/90 text-green-50',
  '-':  'bg-orange-700/80 text-orange-50',
  '--': 'bg-red-700/90 text-red-50',
};

function cellClass(score: Score): string {
  const band = colorBand(score);
  return BAND_BG[band] ?? 'bg-slate-800 text-slate-200';
}

// Build a "T2: + (+3) | T5: ++ (+6)" string for the cell's hover tooltip.
// Step-delta wording (atlas) vs raw-point delta (standard) flows through
// tableModifierDelta. Returns '' when the cell has no non-null modifiers,
// so callers can skip the `title` attribute entirely.
function impactTooltip(impact: CellImpact, mode: 'standard' | 'atlas'): string {
  const parts: string[] = [];
  for (let t = 0; t < impact.length; t++) {
    const sym = impact[t];
    if (sym === undefined || sym === null) continue;
    const delta = tableModifierDelta(sym, mode);
    const sign = delta > 0 ? '+' : '';
    const unit = mode === 'atlas'
      ? (Math.abs(delta) === 1 ? ' step' : ' steps')
      : '';
    parts.push(`T${t + 1}: ${sym} (${sign}${delta}${unit})`);
  }
  return parts.join(' | ');
}

function hasAnyImpact(impact: CellImpact | undefined): boolean {
  if (impact === undefined) return false;
  for (const sym of impact) if (sym !== null) return true;
  return false;
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
    <div className="mx-auto inline-block overflow-x-auto" data-testid="matrix">
      <table className="border-separate border-spacing-1.5 text-center text-base">
        <thead>
          <tr>
            <th className="text-xs text-slate-500"></th>
            {visibleCols.map(({ id }) => (
              <th key={id} className="text-xs text-slate-400" title={findFaction(id)?.displayName}>
                <FactionLogo armyId={id} />
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
                <FactionLogo armyId={rowId} />
              </th>
              {visibleCols.map(({ id: colId, j }) => {
                const score = myView[i]![j]!;
                // U6 polish: in atlas mode, half-tier values (2.5 / 3.5)
                // render in italic so they stand out from the integer
                // tiers at a glance.
                const isHalfTier = score.mode === 'atlas' && !Number.isInteger(score.value);
                const halfClass = isHalfTier ? 'italic text-base' : '';
                const impact = view.myImpact[i]?.[j];
                const showImpacts = hasAnyImpact(impact);
                const tooltip = showImpacts && impact !== undefined
                  ? impactTooltip(impact, view.mode)
                  : undefined;
                return (
                  <td
                    key={colId}
                    className={`relative h-16 w-[4.5rem] rounded font-mono ${cellClass(score)} ${halfClass}`}
                    data-testid={`cell-${i}-${j}`}
                    {...(tooltip !== undefined ? { title: tooltip } : {})}
                  >
                    <span data-testid={`cell-${i}-${j}-score`}>{score.value}</span>
                    {showImpacts && impact !== undefined && (
                      <ImpactChipRow
                        rowIdx={i}
                        colIdx={j}
                        impact={impact}
                      />
                    )}
                  </td>
                );
              })}
              <td
                className={`h-16 w-20 rounded font-mono ${meanCellClass(rowAvg(i), view.mode)}`}
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
                className={`h-16 w-[4.5rem] rounded font-mono ${meanCellClass(colAvg(j), view.mode)}`}
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

// Per-cell strip of table-modifier chips, absolutely positioned along the
// bottom edge so the score remains centered. Renders at most one chip per
// non-null table slot, in table order (T1..T8). Chips are intentionally
// tiny — they're an at-a-glance "this cell cares which table" cue; the
// per-table breakdown comes from the cell's `title` tooltip.
function ImpactChipRow({
  rowIdx,
  colIdx,
  impact,
}: {
  readonly rowIdx: number;
  readonly colIdx: number;
  readonly impact: CellImpact;
}) {
  return (
    <div
      className="pointer-events-none absolute inset-x-0.5 bottom-0.5 flex flex-wrap justify-center gap-px text-[8px] font-bold leading-none"
      data-testid={`cell-${rowIdx}-${colIdx}-impacts`}
    >
      {impact.map((sym, t) => {
        if (sym === null) return null;
        return (
          <span
            key={t}
            data-testid={`cell-${rowIdx}-${colIdx}-impact-${t}`}
            data-table={t + 1}
            data-modifier={sym}
            className={`rounded px-[2px] py-[1px] ${CHIP_BG[sym]}`}
          >
            {`T${t + 1}${sym}`}
          </span>
        );
      })}
    </div>
  );
}

// Faction logo used as the row/col header. Falls back to the armyId
// initials if the catalog has no entry (lets engine fixture ids like
// "a0"/"b3" still render in tests).
function FactionLogo({ armyId }: { readonly armyId: string }) {
  const faction = findFaction(armyId);
  if (faction === undefined) {
    return <span className="block text-xs">{labelOf(armyId)}</span>;
  }
  return (
    <img
      src={faction.logoPath}
      alt={faction.displayName}
      className="mx-auto h-12 w-12 object-contain"
    />
  );
}

function labelOf(id: string): string {
  const m = id.match(/-(\d+)$/);
  if (m !== null) return id[0]!.toUpperCase() + m[1]!;
  return id[0]!.toUpperCase();
}

