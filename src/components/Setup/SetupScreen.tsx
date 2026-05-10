import { useState } from 'react';
import { ModePicker } from './ModePicker.js';
import { ScoringPicker } from './ScoringPicker.js';
import { MatrixSourcePicker } from './MatrixSourcePicker.js';
import { RosterPicker } from './RosterPicker.js';
import type { GameConfig, GameMode, MatrixSource } from './types.js';
import type { ScoreMode } from '../../engine/score.js';
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

  function handleSourceChange(next: MatrixSource): void {
    setMatrixSource(next);
    if (next === 'generated') {
      // Switching to Generated: re-randomize rosters AND seed so the user
      // sees a fresh draw.
      setRosterA(randomRoster());
      setRosterB(randomRoster());
      setSeed(randomSeed());
    } else {
      // Switching to Entered: clear rosters; user will pick alongside the
      // matrix in Phase U5.
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
  //   - Generated-only for now (entered matrix is Phase U5).
  //   - Both rosters fully picked.
  const isEntered = matrixSource === 'entered';
  const rostersReady = rosterReady(rosterA) && rosterReady(rosterB);
  const canStart = !isEntered && rostersReady;

  let disabledReason: string | null = null;
  if (isEntered) disabledReason = 'Matrix entry coming in Phase U5';
  else if (!rostersReady) disabledReason = 'Pick all 16 factions';

  function handleStart(): void {
    if (!canStart) return;
    const config: GameConfig = {
      mode,
      scoring,
      matrixSource,
      seed,
      rosterA: rosterA.filter((v): v is FactionId => v !== null),
      rosterB: rosterB.filter((v): v is FactionId => v !== null),
    };
    onStart(config);
  }

  return (
    <main className="mx-auto max-w-6xl space-y-8 p-6">
      <header>
        <h1 className="text-2xl font-bold">Cawl</h1>
        <p className="text-sm text-slate-400">
          A WTC pairings simulator. Configure the game, then start.
        </p>
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

      <section className="grid grid-cols-1 gap-8 md:grid-cols-2">
        <RosterPicker team="A" value={rosterA} onChange={setRosterA} editable={isEntered} />
        <RosterPicker team="B" value={rosterB} onChange={setRosterB} editable={isEntered} />
      </section>

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
