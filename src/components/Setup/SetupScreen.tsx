import { useCallback, useState } from 'react';
import { ModePicker } from './ModePicker.js';
import { ScoringPicker } from './ScoringPicker.js';
import { MatrixSourcePicker } from './MatrixSourcePicker.js';
import { RosterPicker } from './RosterPicker.js';
import { MatrixEntry } from './MatrixEntry.js';
import type { EntryMethod } from './MatrixEntry.js';
import type { GameConfig, GameMode, MatrixSource } from './types.js';
import type { Score, ScoreMode, AtlasTier } from '../../engine/score.js';
import type { FactionId } from '../../factions.js';
import { FACTIONS } from '../../factions.js';

interface SetupScreenProps {
  readonly onStart: (config: GameConfig) => void;
  // Optional: when "Play again" routes back to Setup, the previous game's
  // config seeds the form so the user can re-roll or re-Start without
  // re-picking everything. Same seed retained by default.
  readonly initialConfig?: GameConfig | null;
}

const ROSTER_SIZE = 8;

function randomSeed(): number {
  return Math.floor(Math.random() * 0x100000000) >>> 0;
}

// 8 distinct factions, randomly chosen. Per spec: rosters in Generated mode
// auto-populate with no within-team duplicates. Across-team duplicates are
// allowed (Team A and Team B can both have Space Marines).
function randomRoster(): readonly FactionId[] {
  const ids = FACTIONS.map((f) => f.id);
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = ids[i]!;
    ids[i] = ids[j]!;
    ids[j] = tmp;
  }
  return ids.slice(0, ROSTER_SIZE);
}

function emptyRoster(): ReadonlyArray<FactionId | null> {
  return Array.from({ length: ROSTER_SIZE }, () => null);
}

function rosterReady(roster: ReadonlyArray<FactionId | null>): boolean {
  return roster.length === ROSTER_SIZE && roster.every((v) => v !== null);
}

// Convert the typed/pasted 8x8 of plain numbers into the engine's tagged
// Score values. Standard mode wraps each number directly; atlas treats
// each value as a tier (the grid's <select> already constrains values to
// ATLAS_TIERS so the cast is safe).
function toScoreMatrix(
  scoring: ScoreMode,
  matrix: readonly (readonly number[])[],
): readonly (readonly Score[])[] {
  return matrix.map((row) => row.map((value) => {
    if (scoring === 'standard') return { mode: 'standard', value } as const;
    return { mode: 'atlas', value: value as AtlasTier } as const;
  }));
}

export function SetupScreen({ onStart, initialConfig }: SetupScreenProps) {
  const [mode, setMode] = useState<GameMode>(
    () => initialConfig?.mode ?? { kind: 'sp', tier: 'easy' },
  );
  const [scoring, setScoring] = useState<ScoreMode>(
    () => initialConfig?.scoring ?? 'standard',
  );
  const [matrixSource, setMatrixSource] = useState<MatrixSource>(
    () => initialConfig?.matrixSource ?? 'generated',
  );
  const [seed, setSeed] = useState<number>(
    () => initialConfig?.seed ?? randomSeed(),
  );
  // Default to Generated, so rosters auto-populate immediately.
  const [rosterA, setRosterA] = useState<ReadonlyArray<FactionId | null>>(
    () => initialConfig?.rosterA ?? randomRoster(),
  );
  const [rosterB, setRosterB] = useState<ReadonlyArray<FactionId | null>>(
    () => initialConfig?.rosterB ?? randomRoster(),
  );
  // Entered mode only: the validated 8x8 matrix typed/pasted by the user
  // (numbers in [0,20] for standard, atlas tier values for atlas). Null
  // until the user finishes entry. Memoize-style callback to satisfy the
  // grid's effect-dependency check.
  const [enteredMatrix, setEnteredMatrix] = useState<readonly (readonly number[])[] | null>(null);
  const handleMatrixChange = useCallback(
    (m: readonly (readonly number[])[] | null) => setEnteredMatrix(m),
    [],
  );
  // Entered mode only: how the user enters the matrix. Default is grid
  // (cell-by-cell) — paste is the secondary path. SetupScreen owns this
  // because it controls page ordering: grid mode shows rosters BEFORE
  // the grid (so we can label rows/cols with faction logos), paste mode
  // shows the textarea before rosters.
  const [entryMethod, setEntryMethod] = useState<EntryMethod>('grid');
  const handleEntryMethodChange = useCallback(
    (next: EntryMethod) => {
      setEntryMethod(next);
      // Switching method invalidates any partially-entered matrix.
      setEnteredMatrix(null);
    },
    [],
  );

  function handleSourceChange(next: MatrixSource): void {
    setMatrixSource(next);
    setEnteredMatrix(null);
    if (next === 'generated') {
      // Switching to Generated: re-randomize rosters AND seed so the user
      // sees a fresh draw.
      setRosterA(randomRoster());
      setRosterB(randomRoster());
      setSeed(randomSeed());
    } else {
      // Switching to Entered: clear rosters; the user will pick them after
      // the matrix has been validated.
      setRosterA(emptyRoster());
      setRosterB(emptyRoster());
    }
  }

  function handleReroll(): void {
    setSeed(randomSeed());
    setRosterA(randomRoster());
    setRosterB(randomRoster());
  }

  // Start enablement:
  //   - Both rosters fully picked.
  //   - For Entered mode: a validated matrix is loaded.
  const isEntered = matrixSource === 'entered';
  const rostersReady = rosterReady(rosterA) && rosterReady(rosterB);
  const matrixReady = !isEntered || enteredMatrix !== null;
  const canStart = rostersReady && matrixReady;

  let disabledReason: string | null = null;
  if (isEntered && entryMethod === 'grid' && !rostersReady) {
    disabledReason = 'Pick all 16 factions, then enter the matrix';
  } else if (isEntered && enteredMatrix === null) {
    disabledReason = 'Enter and validate the matrix first';
  } else if (!rostersReady) {
    disabledReason = 'Pick all 16 factions';
  }

  function handleStart(): void {
    if (!canStart) return;
    const config: GameConfig = {
      mode,
      scoring,
      matrixSource,
      seed,
      rosterA: rosterA.filter((v): v is FactionId => v !== null),
      rosterB: rosterB.filter((v): v is FactionId => v !== null),
      ...(isEntered && enteredMatrix !== null
        ? { viewAOverride: toScoreMatrix(scoring, enteredMatrix) }
        : {}),
    };
    onStart(config);
  }

  return (
    <main className="mx-auto max-w-6xl space-y-8 p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold">Cawl</h1>
        <p className="text-sm text-slate-400">
          A WTC pairings simulator. Configure the game, then start.
        </p>
        {initialConfig !== null && initialConfig !== undefined && (
          <p className="text-xs text-slate-500" data-testid="setup-resumed-hint">
            Previous game configuration restored — adjust below or hit Start to play again.
          </p>
        )}
      </header>

      <section className="grid grid-cols-1 gap-8 md:grid-cols-3">
        <ModePicker value={mode} onChange={setMode} />
        <ScoringPicker value={scoring} onChange={setScoring} />
        <MatrixSourcePicker
          value={matrixSource}
          seed={seed}
          onChange={handleSourceChange}
          onReroll={handleReroll}
        />
      </section>

      {(() => {
        // Generated: rosters are auto-populated and always visible.
        if (!isEntered) {
          return (
            <section className="grid grid-cols-1 gap-8 md:grid-cols-2">
              <RosterPicker team="A" value={rosterA} onChange={setRosterA} editable={false} />
              <RosterPicker team="B" value={rosterB} onChange={setRosterB} editable={false} />
            </section>
          );
        }
        // Entered + grid: pick rosters first, then the grid (which uses
        // those factions as row/col labels). Hide the grid until rosters
        // are fully picked so the user can't score abstract A1/B1 slots.
        if (entryMethod === 'grid') {
          return (
            <>
              <section className="grid grid-cols-1 gap-8 md:grid-cols-2">
                <RosterPicker team="A" value={rosterA} onChange={setRosterA} editable />
                <RosterPicker team="B" value={rosterB} onChange={setRosterB} editable />
              </section>
              <MatrixEntry
                scoring={scoring}
                method={entryMethod}
                onMethodChange={handleEntryMethodChange}
                rosterA={rosterA}
                rosterB={rosterB}
                onMatrixChange={handleMatrixChange}
              />
              {!rostersReady && (
                <p className="text-xs text-slate-500" data-testid="grid-blocked-hint">
                  Pick both rosters above before entering matrix scores.
                </p>
              )}
            </>
          );
        }
        // Entered + paste: paste matrix first, rosters appear after
        // validation (preserves the existing paste-flow ordering).
        return (
          <>
            <MatrixEntry
              scoring={scoring}
              method={entryMethod}
              onMethodChange={handleEntryMethodChange}
              rosterA={rosterA}
              rosterB={rosterB}
              onMatrixChange={handleMatrixChange}
            />
            {enteredMatrix !== null && (
              <section className="grid grid-cols-1 gap-8 md:grid-cols-2">
                <RosterPicker team="A" value={rosterA} onChange={setRosterA} editable />
                <RosterPicker team="B" value={rosterB} onChange={setRosterB} editable />
              </section>
            )}
          </>
        );
      })()}

      <footer className="flex items-center justify-end gap-4 border-t border-slate-800 pt-4">
        {disabledReason !== null && (
          <span className="text-xs text-slate-500" data-testid="start-disabled-reason">
            {disabledReason}
          </span>
        )}
        <button
          type="button"
          onClick={handleStart}
          disabled={!canStart}
          className="rounded bg-sky-600 px-4 py-2 font-semibold text-white shadow disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
        >
          Start
        </button>
      </footer>
    </main>
  );
}
