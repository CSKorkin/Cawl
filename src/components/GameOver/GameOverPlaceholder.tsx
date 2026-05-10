import { useGameStore } from '../../store/gameStore.js';

// U2 placeholder. Phase U3 replaces this with the full final-slate screen.
export function GameOverPlaceholder() {
  const state = useGameStore((s) => s.state)!;
  const resetGame = useGameStore((s) => s.resetGame);
  return (
    <main className="mx-auto max-w-3xl space-y-6 p-8 text-center" data-testid="game-over-placeholder">
      <h1 className="text-3xl font-bold">Game complete</h1>
      <p className="text-slate-300">
        {state.pairings.length} pairings locked across {new Set(state.pairings.map((p) => p.tableId)).size} tables.
      </p>
      <p className="text-xs text-slate-500">
        Final slate UI coming in Phase U3.
      </p>
      <button
        type="button"
        onClick={resetGame}
        className="rounded bg-sky-600 px-4 py-2 font-semibold text-white shadow"
        data-testid="play-again-button"
      >
        Play again
      </button>
    </main>
  );
}
