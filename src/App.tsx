import { SetupScreen } from './components/Setup/SetupScreen.js';
import { PlayScreen } from './components/Play/PlayScreen.js';
import { GameOverPlaceholder } from './components/GameOver/GameOverPlaceholder.js';
import { selectViewKind, useGameStore } from './store/gameStore.js';
import type { GameConfig } from './components/Setup/types.js';

export function App() {
  const view = useGameStore(selectViewKind);
  const startGame = useGameStore((s) => s.startGame);

  function handleStart(config: GameConfig): void {
    startGame(config);
  }

  switch (view) {
    case 'setup':
      return <SetupScreen onStart={handleStart} />;
    case 'play':
      return <PlayScreen />;
    case 'gameOver':
      return <GameOverPlaceholder />;
  }
}
