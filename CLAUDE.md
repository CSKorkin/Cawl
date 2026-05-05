# Cawl — 40k WTC Pairings Simulator

## Project purpose

Cawl is a training tool for competitive Warhammer 40k team play. It simulates the WTC "King of the Hill" pairing sequence — defender/attacker selection, the refusal mechanic, the table choice token handoff — so players can practice pairing decisions against an algorithm or another human. Input is a per-team matchup matrix of predicted scores; output is a logged sequence of eight pairings across eight tables.

The core insight the tool exists to communicate: **pairing is a game of incomplete information played on top of a slightly asymmetric shared belief matrix.** Both sides are reasoning about the same 64 matchups, but with different expected values, no knowledge of the opponent's matrix, and a fixed protocol for how information gets revealed. Everything in the UI should serve that mental model.

## Domain glossary

Use these terms exactly. Don't paraphrase to "selected army" or "rejected pick" or anything else.

- **WTC** — World Team Championship; the format this simulates.
- **Army** — a player's list; eight per team.
- **Defender** — the army "defending" a pairing slot in a given step.
- **Attackers** — the two armies the opposing team proposes against a defender.
- **Refusal** — choosing one of the two proposed attackers to send back to the pool.
- **Table choice token** — alternates between teams between steps; grants right to pick table first that step.
- **Pairing matrix** — 8×8 grid. Each cell is an expected score for Team A's army vs Team B's army, from Team A's perspective. Team B sees the same matchups from their perspective with per-cell variance applied (i.e., the two views are asymmetric — that asymmetry is the whole game). Two scoring modes are supported; see _Matrix and visual specifics_ below.
- **Round 1 / Round 2 / Scrum** — the three pairing rounds. The Scrum auto-resolves the final two games (refused-vs-refused and last-man-vs-last-man). See `spec.md` for exact mechanics.
- **Atlas mode** — the alternate ordinal scoring scale {1, 2, 2.5, 3, 3.5, 4, 5}, opt-in. Default is the integer 0–20 scale.

## Tech stack (recommended starting point)

Change anything in this section that doesn't fit how you want to build. These are defaults, not requirements.

- **Frontend:** React + TypeScript via Vite. The matrix UI, hover states, and lock-in flows are React's sweet spot.
- **Styling:** Tailwind. Color bands map cleanly to utility classes.
- **State:** Zustand. The pairing flow is a state machine, not a tree of derived data — Redux is overkill.
- **Modes:** V1 ships hot-seat (two humans, one device, "pass the laptop" interstitials for info-hiding) and single-player vs. AI. Networked multiplayer is V2 — do not build the network layer now.
- **Algorithm opponent:** pure TS module exposing three difficulty levels. Top-end AI should be very strong; ship the medium tier first and build up to maximum strength once the engine and UI are stable. Don't gold-plate the strongest tier early.
- **Persistence:** sessions survive reload. Use `localStorage` for V1 — the state object is small and JSON-serializable. Serialize on every state transition; rehydrate on mount. This makes "engine state must be serializable" a hard constraint on the FSM design.
- **Tests:** Vitest + React Testing Library. The pairing state machine especially needs tests — the rules are subtle and the failure modes are quiet.

## Workflow

This project uses the `agent-skills` pack. Default to its lifecycle:

1. `/spec` — every feature starts with a markdown spec in `specs/`.
2. `/plan` — break specs into tasks before writing code.
3. `/build` — incremental, one task at a time, tests alongside.
4. `/test` — tests must run and pass before declaring done.
5. `/review` — audit non-trivial changes before merging.
6. `/ship` — only when genuinely done.

**Do not skip `/spec` for the pairing engine.** Spec ambiguities in the rules will turn into bugs that are very hard to find later because the rules are recursive and most paths are valid-looking.

## Code conventions

- **Strict TypeScript.** `strict: true`. No `any` without an inline comment explaining why.
- **Pure core, thin shell.** The engine (state machine, matrix logic, AI opponent) is pure TS with no React, no DOM, no I/O. UI components read from the engine and dispatch events into it. This keeps the rules testable in isolation and lets the AI opponent share the exact same code paths a human triggers.
- **State machine, named explicitly.** The pairing flow is an FSM with named states (`AWAITING_DEFENDERS`, `AWAITING_ATTACKERS`, `AWAITING_REFUSALS`, `AWAITING_TABLE_CHOICE`, `STEP_COMPLETE`, `ROUND_COMPLETE`, ...). Don't model it as nested booleans.
- **No god components.** Matrix, army roster, log panel, control bar — separate components that compose.
- **Naming reflects domain.** `defender`, `attackers`, `refused`, `tableChoiceToken`. Not `selectedA`, `picks`, `rejected`. Code should read like the WTC vocabulary, because anyone touching it will think in that vocabulary.

## Matrix and visual specifics

This section covers both engine concerns (score generation, variance) and rendering. They're tightly coupled — the engine produces the matrix, the UI displays it — so they live together.

**Default scoring mode (integer 0–20):**
- Scores are integers in [0, 20].
- Color bands: 0–4 red, 5–8 orange, 9–11 yellow, 12–15 light green, 16–20 dark green.
- Base matrix values are drawn from a bell curve centered around 10, integer-rounded, clamped to [0, 20]. The curve shape (mean, stdev) determines the difficulty distribution — make these tunable from the start.
- Variance between team views: per-cell noise of −3 to +3, clamped to [0, 20].

**Atlas mode (opt-in):**
- Scores from the ordinal set {1, 2, 2.5, 3, 3.5, 4, 5}.
- Color bands map proportionally to the same five tiers (1 = red ... 5 = dark green).
- Variance between team views: strictly ±1 step on the ordinal scale (e.g., a true 3 may show as 2.5, 3, or 3.5 to the opponent — never 2 or 3.5+).
- Atlas mode bell-curve generation should center near 3 with similar tunable shape.

**Engine implication:** abstract over both modes. The engine should treat "score" as a typed value with a mode-aware comparator, color-bander, and variance function — not hardcode 0–20 anywhere outside the default-mode module.

**Layout:**
- Matrix is 8×8. Team A armies down rows, Team B armies across columns. Each cell shows the score, color-coded.
- Logos: provided as 60×60 white-on-transparent PNGs in `public/logos/`. They render as-is on dark backgrounds; on light backgrounds wrap them in a dark container or apply a CSS filter. Don't try to recolor the source PNGs at build time.
- Army slots: 8 per team. Logo + name. Hover reveals faction + list summary. Click selects.
- Table choice token: visible on screen at all times, with an animated handoff between teams between rounds.
- Log panel: append-only record of each round's decisions (defender, attackers proposed, attacker refused, table chosen, which team had the token).

## Information hiding

The spec is built around **simultaneous reveal** of secret choices. The UI must enforce this — no peeking. In hot-seat mode, this means a "pass the device" interstitial when control switches teams. For each secret choice (defender pick, attacker pair, refusal):

1. Active player locks in (hidden) → "Pass to opponent" interstitial.
2. Opponent locks in (hidden) → both reveal simultaneously.

Don't shortcut this even in single-player. The AI also commits before reveal — the human must not be able to change their pick after seeing what the AI would do. Importantly, the AI logic must ALSO implement this. The AI cannot make its decision based on information about what the human has chosen.

## File structure

```
cawl/
├── CLAUDE.md
├── specs/                   # feature specs — start every feature here
│   └── 001-pairing-engine.md
├── src/
│   ├── engine/              # pure pairing logic, no React
│   │   ├── state.ts         # state machine
│   │   ├── matrix.ts        # generation + asymmetric variance
│   │   ├── ai.ts            # algorithmic opponent
│   │   ├── log.ts
│   │   └── *.test.ts        # colocated tests
│   ├── components/          # React UI
│   ├── pages/
│   └── main.tsx
├── public/
│   └── logos/
└── tests/                   # integration / e2e tests
```

## Things to avoid

- Building networked multiplayer before hot-seat works end-to-end.
- Embedding the AI opponent into UI components — it lives in the engine.
- Passing raw `number[][]` for the matrix into the UI layer. Pass a typed `Matrix` object that knows how to color-band itself.
- Animations and polish before the rules are correct.
- Trusting the spec verbatim where it contradicts itself — flag and ask.

## Build commands

To be filled in once the project is scaffolded:

```
# install
# dev server
# test
# build
# lint
```