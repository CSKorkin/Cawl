// Transcript export: bundles the final state + originating config into a
// JSON payload the user can download. Pure builder + a thin DOM trigger so
// the builder can be unit-tested without the DOM.

import type { PairingState } from '../../engine/state.js';
import type { GameConfig } from '../Setup/types.js';

export interface Transcript {
  readonly version: 1;
  readonly exportedAt: string;
  readonly config: GameConfig;
  readonly state: PairingState;
}

export function buildTranscript(state: PairingState, config: GameConfig): Transcript {
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    config,
    state,
  };
}

export function transcriptFilename(transcript: Transcript): string {
  // Use the originating seed so filenames are stable for a given game.
  const seedHex = transcript.config.seed.toString(16).toUpperCase().padStart(8, '0');
  return `cawl-transcript-${seedHex}.json`;
}

// Triggers a browser download of the transcript. Only meaningful with a
// real DOM; the buildTranscript path is what tests exercise.
export function downloadTranscript(transcript: Transcript): void {
  const json = JSON.stringify(transcript, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = transcriptFilename(transcript);
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
