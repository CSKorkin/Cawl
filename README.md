# Cawl

A practice tool for **WTC-Style 40k pairings**, the process by which two
teams of 8 players determine who plays who. 

Cawl simulates that protocol against an AI opponent or a second human on
the same laptop, on top of a per-team predicted-score matrix. Unlike many
similar apps, Cawl incorporates the real variance that you would expect in
teams. Each matrix contains the same 64 matchups but with **different beliefs**.
The backend engine handles information hiding, guides the player through
the entire pairings flow, and incorporates a fixed protocol for how information 
gets revealed.

*Who is this for?*
The primary use for this tool is captains trying to optimize their planning for
live pairings or improve their own abilities at pairings. By incorporating different
levels of sophistication in the AI, players can learn and refine their own strategies.
Instead of having to coordinate with other team members, captains can test varying
pairing strategies rapidly and see how each would play out against a variety of
strategies.

## Quick start

```bash
npm install              # install deps (React, Vite, Tailwind, Zustand)
npm run dev              # Vite dev server — opens at http://localhost:5173
npm run typecheck        # tsc --noEmit
npm test                 # vitest run (engine + UI)
npm run build            # production build into dist/
```

Requires Node 18+ (Vite 6).

## What you get

- **Generated matrix mode** — one click, random predicted-score matrix.
  Re-roll for a fresh draw; play user-vs-Easy or user-vs-Medium AI. Because
  this uses the same seed, users can replay against the same matrix
  against the same or different AI difficulties.
- **Entered matrix mode** — paste a matrix from your team sheet or fill an 
  8×8 grid cell-by-cell. The engine then derives the opposing team's matrix 
  via inversion + per-cell variance based on a seed.
- **Hot-seat** — two humans share the device. Information-hiding
  interstitials gate every secret-choice handoff so the next mover's
  view is never on screen while the prior mover is still looking at it.
- **Final slate + transcript export** — the GameOver screen shows the
  table-ordered 8-game slate with each team's predicted score and a
  verdict. Export the full state + log as JSON for later analysis.
