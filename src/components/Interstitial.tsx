import { useGameStore } from '../store/gameStore.js';
import type { Team } from '../engine/log.js';

interface InterstitialProps {
  readonly newMover: Team;
}

// Hot-seat hand-off gate. Replaces PlayScreen entirely while pending so the
// matrix can't leak across the device. Tap → store clears the flag → next
// render brings up PlayScreen with the new mover's view.
export function Interstitial({ newMover }: InterstitialProps) {
  const dismissHandoff = useGameStore((s) => s.dismissHandoff);
  const teamColor = newMover === 'A' ? 'text-sky-400' : 'text-amber-400';

  return (
    <main
      className="flex min-h-screen flex-col items-center justify-center gap-8 bg-slate-900 p-6 text-center"
      data-testid="interstitial"
    >
      <p className="text-sm uppercase tracking-widest text-slate-500">
        Pass the device
      </p>
      <h1 className={`text-4xl font-bold ${teamColor}`}>
        Team {newMover}, you're up
      </h1>
      <p className="max-w-md text-sm text-slate-400">
        Hand the device to Team {newMover} before tapping Continue. Your
        opponent's pick stays hidden until you both lock in.
      </p>
      <button
        type="button"
        onClick={dismissHandoff}
        className="rounded bg-sky-600 px-8 py-4 text-lg font-semibold text-white shadow hover:bg-sky-500"
        data-testid="interstitial-continue"
        autoFocus
      >
        Continue as Team {newMover}
      </button>
    </main>
  );
}
