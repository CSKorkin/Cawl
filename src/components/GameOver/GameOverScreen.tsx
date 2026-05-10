import { useState } from 'react';
import { useGameStore } from '../../store/gameStore.js';
import { LogPanel } from '../Play/LogPanel.js';
import { FinalSlate } from './FinalSlate.js';
import { buildTranscript, downloadTranscript } from './transcript.js';

export function GameOverScreen() {
  const state = useGameStore((s) => s.state)!;
  const config = useGameStore((s) => s.config)!;
  const playAgain = useGameStore((s) => s.playAgain);

  // Log panel collapses by default — the slate is the headline; the log
  // is reference detail.
  const [logOpen, setLogOpen] = useState(false);

  function handleExport(): void {
    const transcript = buildTranscript(state, config);
    downloadTranscript(transcript);
  }

  return (
    <main className="mx-auto max-w-5xl space-y-6 p-6" data-testid="game-over">
      <header className="flex flex-wrap items-center gap-3 border-b border-slate-800 pb-4">
        <h1 className="text-2xl font-bold">Game complete</h1>
        <span className="text-xs text-slate-500">
          {state.pairings.length} pairings · {new Set(state.pairings.map((p) => p.tableId)).size} tables
        </span>
        <span className="ml-auto" />
        <button
          type="button"
          onClick={handleExport}
          className="rounded border border-slate-700 bg-slate-800 px-3 py-2 text-sm hover:bg-slate-700"
          data-testid="export-button"
        >
          Export transcript
        </button>
        <button
          type="button"
          onClick={playAgain}
          className="rounded bg-sky-600 px-4 py-2 text-sm font-semibold text-white shadow"
          data-testid="play-again-button"
        >
          Play again
        </button>
      </header>

      <FinalSlate state={state} />

      <section>
        <button
          type="button"
          onClick={() => setLogOpen((v) => !v)}
          className="text-xs uppercase tracking-wide text-slate-400 hover:text-slate-200"
          data-testid="toggle-log"
        >
          {logOpen ? '▾ Hide log' : '▸ Show log'}
        </button>
        {logOpen && (
          <div className="mt-2">
            <LogPanel entries={state.log} />
          </div>
        )}
      </section>
    </main>
  );
}
