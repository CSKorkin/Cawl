import { SetupScreen } from './components/Setup/SetupScreen.js';
import { PlayScreen } from './components/Play/PlayScreen.js';
import { GameOverScreen } from './components/GameOver/GameOverScreen.js';
import { Interstitial } from './components/Interstitial.js';
import { selectViewKind, useGameStore } from './store/gameStore.js';
import type { GameConfig } from './components/Setup/types.js';

export function App() {
  const view = useGameStore(selectViewKind);
  // After "Play again" the engine state is null but config persists, so
  // Setup re-opens with the previous selections in place.
  const previousConfig = useGameStore((s) => s.config);
  const pendingHandoff = useGameStore((s) => s.pendingHandoff);
  const startGame = useGameStore((s) => s.startGame);

  function handleStart(config: GameConfig): void {
    startGame(config);
  }

  switch (view) {
    case 'setup':
      return <SetupScreen onStart={handleStart} initialConfig={previousConfig} />;
    case 'play':
      // Hot-seat: gate PlayScreen behind the Interstitial so the next
      // mover's view doesn't render until the device is handed over.
      if (pendingHandoff !== null) return <Interstitial newMover={pendingHandoff} />;
      return <PlayScreen />;
    case 'gameOver':
      return <GameOverScreen />;
  }
}
