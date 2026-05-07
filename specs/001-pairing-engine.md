# Spec 001 — Pairing Engine

> Scope: the **engine layer** that drives the WTC King-of-the-Hill pairing
> sequence. Pure TypeScript, no React, no DOM, no I/O. The UI integration is
> a separate spec.
>
> Source-of-truth precedence: `CLAUDE.md` is canonical. The `spec.md`
> at the repo root is supplementary information regarding the details
> of the pairings process. All disagreements should be flagged, but 
> prioritize `CLAUDE.md`.

## Objective

Build a deterministic, JSON-serializable state machine that drives the
WTC pairing protocol from "two 8-army rosters and two pairing matrices" to
"eight logged pairings with table assignments." The engine is shared by
hot-seat humans and the AI opponent — both call into the same transitions.

The reason this is its own spec: the rules are recursive and most invalid
paths *look* valid, so we need to nail down the FSM before any UI exists.

### Why an engine-only spec

- The pairing flow is a state machine. Modeling it with pure data and pure
  transitions makes it testable in isolation, lets us swap any "actor"
  (human, easy AI, hard AI) into either seat without changing the engine,
  and keeps the information-hiding invariant enforceable from one place.
- Persistence (localStorage) requires the state object to round-trip
  through JSON. Designing the engine without React in the room makes that
  constraint visible and easy to keep.
- Information-hiding is a correctness property, not a UI concern. The
  engine must be the place where it lives — the UI cannot be trusted to
  not leak a locked-but-unrevealed pick into a render.

### Success criteria

The engine ships when all of the following hold:

1. A single `PairingState` value, when serialized to JSON and rehydrated,
   produces an identical machine — no methods, no class instances, no
   `Date`/`Map`/`Set` on the state.
2. Every transition is a pure function `(state, action) -> state` (or
   `Result<state, EngineError>`). No I/O, no `Math.random` outside the
   seeded RNG, no time-of-day dependence.
3. From any reachable state, only the legal next-actions are accepted.
   Illegal actions return a typed error and do not mutate state.
4. The information-hiding invariant holds:
   *No transition's output state ever exposes a locked-but-not-yet-revealed
   selection of one team in a field readable by the other team's actor.*
   This is enforced by the state shape (separate `pendingA`/`pendingB`
   slots that collapse into a single `revealed` slot only on the second
   `lockIn`), and verified by tests.
5. Both modes (default 0–20 integer, Atlas ordinal) work without
   mode-conditional branches outside the `Score` module — comparator,
   variance function, and color-bander are mode-aware behind one
   abstraction.
6. The medium-difficulty AI plays whole games to completion against the
   easy AI without crashing or stalling, and beats it >70% of seeded runs
   over a fixed corpus.
7. `state.ts` and `matrix.ts` have ≥95% line and branch coverage in
   Vitest. (We aim for 100% but accept the occasional defensive-default
   branch we can't reach.) `ai.ts` is "interesting cases covered" rather
   than coverage-percentage gated.
8. A full game (24 user-visible decisions per side + automated Scrum
   resolution) executes from initial state to `GAME_COMPLETE` in <50ms on
   a developer laptop.

## Tech stack

- TypeScript, strict mode (`strict: true`, `noUncheckedIndexedAccess: true`).
- No engine-layer dependencies beyond a tiny seedable PRNG (e.g.
  `seedrandom` or hand-rolled mulberry32 — prefer the latter, ~10 lines,
  no dep). Rationale: the engine is supposed to stay pure and tiny, and
  pulling a dep for 10 lines of arithmetic is the wrong trade.
- Vitest for tests (the surrounding project will use Vite, so Vitest is the
  free pick).

The engine is consumed by the Vite + React shell defined in `CLAUDE.md`.
Nothing in this spec depends on that.

## Commands

The project isn't scaffolded yet. Once it is, these are the engine-relevant
commands:

```
npm install                       # install deps
npm test                          # run all tests (engine + UI)
npm test -- src/engine            # engine tests only
npm test -- --coverage            # with coverage report
npm test -- --watch               # watch mode while iterating on FSM
npm run typecheck                 # tsc --noEmit
npm run lint                      # eslint src/
```

There is no engine-only build artifact. The engine compiles as part of the
app bundle.

## Project structure

```
src/engine/
├── state.ts          # FSM: types, initial state, transitions, errors
├── state.test.ts
├── matrix.ts         # Matrix generation, asymmetric variance, color bands
├── matrix.test.ts
├── score.ts          # Score abstraction (default 0–20 vs. Atlas ordinal)
├── score.test.ts
├── ai.ts             # Algorithmic opponent — easy / medium / hard tiers
├── ai.test.ts
├── log.ts            # Append-only log of revealed events
├── log.test.ts
├── rng.ts            # Seeded PRNG, used everywhere randomness is needed
└── index.ts          # Public surface — only what the UI may import
```

`src/engine/index.ts` is the only file the UI may import from. Anything
not re-exported there is engine-internal.

## State machine

### States

```
INIT                       → matrices generated, rosters set, RNG seeded
ROUND_1.AWAITING_DEFENDERS → both teams secretly pick a defender
ROUND_1.AWAITING_ATTACKERS → defenders revealed; both teams secretly pick 2 attackers
ROUND_1.AWAITING_REFUSALS  → attackers revealed; each team secretly refuses 1 of the 2 sent to them
ROUND_1.AWAITING_TABLES    → refusals revealed; token-holder's defender picks table, then the other
ROUND_1_COMPLETE           → 2 pairings + 2 tables logged; token flips
ROUND_2.AWAITING_DEFENDERS
ROUND_2.AWAITING_ATTACKERS
ROUND_2.AWAITING_REFUSALS
ROUND_2.AWAITING_TABLES
ROUND_2_COMPLETE
SCRUM.AWAITING_DEFENDERS
SCRUM.AWAITING_ATTACKERS
SCRUM.AUTO_LAST_MAN        → transient; engine auto-locks last-vs-last as game 8 immediately on entry
SCRUM.AWAITING_REFUSALS
SCRUM.AUTO_REFUSED_PAIR    → transient; engine auto-pairs refused-vs-refused as game 7 on entry
SCRUM.AWAITING_TABLES      → 4 remaining tables assigned, defender-first alternating from token-holder
GAME_COMPLETE              → 8 pairings + 8 tables logged; terminal
```

The two `AUTO_*` states are real states the FSM passes through (rather
than collapsing into the prior transition) so the log can record those
events in order and the UI can animate them. They auto-advance on entry —
no external action drives them.

### Actions

Each action is `{ type, team, payload }` where applicable.

- `LOCK_IN_DEFENDER { team, armyId }` — valid in `*.AWAITING_DEFENDERS`.
- `LOCK_IN_ATTACKERS { team, armyIds: [a, b] }` — valid in `*.AWAITING_ATTACKERS`.
- `LOCK_IN_REFUSAL { team, armyId }` — valid in `*.AWAITING_REFUSALS`.
- `LOCK_IN_TABLE { team, tableId }` — valid in `*.AWAITING_TABLES`, only
  when it's that team's turn to pick (token rules).
- `RESOLVE_INITIAL_TOKEN { winner: 'A' | 'B' }` — valid only at the start
  of `ROUND_1.AWAITING_TABLES`, generated by the engine via the seeded
  RNG and recorded in the log so the UI can display the roll-off result.
  Subsequent token transitions are deterministic (flip per round /
  Scrum).

### Information-hiding invariant

The state shape encodes hiding directly:

```ts
type SecretSlot<T> = { pendingA?: T; pendingB?: T; revealed?: { a: T; b: T } };
```

A `LOCK_IN_*` action sets only the corresponding `pending*` field. When
both pending fields are set, the *next* call to the transition function
collapses them atomically into `revealed` and clears the pendings. The
action handler never returns a state where one team's pending is visible
while the other's is also pending — the collapse is part of the same
transition.

A serialized state may contain `pendingA` and `pendingB` simultaneously
between calls (e.g., persisted to localStorage mid-step), which is fine
*as long as the UI does not render the opposing team's `pending*` for the
current actor*. The engine exposes a `viewFor(team)` projection that
strips the other team's pendings — UI must read through that projection,
never the raw state. The projection is part of the engine's public API
precisely so the hiding invariant cannot be accidentally bypassed.

### Scrum sequencing (confirmed)

1. `SCRUM.AWAITING_DEFENDERS` — both secret pick → reveal.
2. `SCRUM.AWAITING_ATTACKERS` — both secret pick → reveal.
3. `SCRUM.AUTO_LAST_MAN` — engine immediately locks the last-remaining
   army on each side as game 8.
4. `SCRUM.AWAITING_REFUSALS` — both secret refuse → reveal.
5. `SCRUM.AUTO_REFUSED_PAIR` — engine immediately pairs the two refused
   attackers as game 7.
6. `SCRUM.AWAITING_TABLES` — 4 tables assigned in two phases:
   - **Phase A (attacker-vs-defender games, 2 tables):** the
     token-holder's defender picks first, then the opposing defender
     picks. Two `LOCK_IN_TABLE` actions, one per team.
   - **Phase B (auto-paired games, 2 tables):** the auto-paired games
     (last-vs-last and refused-vs-refused) have no explicit defender, so
     the **token-holder assigns both remaining tables** unilaterally.
     Two `LOCK_IN_TABLE` actions, both from the token-holder team.

   The engine tracks within-phase progress on the state so it knows
   whose turn it is and rejects out-of-turn `LOCK_IN_TABLE` actions.

### Tables and scoring

Tables in this engine are scheduling slots only — they do not affect
match scores. The pairing matrix is a function of army pairs, not table
identity. The engine therefore exposes table choice as a decision the
human can make for fidelity to the WTC protocol, but the AI tiers all
treat table selection as arbitrary (lowest-numbered available table).
If table-dependent scoring is added later, the AI tiers will need a
separate `pickTable` strategy per tier.

## Matrix and scoring

### Score abstraction

```ts
type Score =
  | { mode: 'standard'; value: number }   // integer in [0, 20]
  | { mode: 'atlas'; value: AtlasTier };  // 1 | 2 | 2.5 | 3 | 3.5 | 4 | 5
```

The `score` module exposes:

- `compare(a, b): -1 | 0 | 1`
- `colorBand(s): 'red' | 'orange' | 'yellow' | 'lightGreen' | 'darkGreen'`
- `applyVariance(s, rng): Score` — mode-aware.
  - **Standard:** uniform integer in `[-3, +3]`, added and clamped to
    `[0, 20]`.
  - **Atlas:** uniform draw from `{prev_tier, current_tier, next_tier}`
    on the ordinal set `{1, 2, 2.5, 3, 3.5, 4, 5}`, clamped at the ends.
    "One ordinal step" means the adjacent tier in this sequence
    regardless of numeric distance — so `2 → {1, 2, 2.5}`,
    `2.5 → {2, 2.5, 3}`, `4 → {3.5, 4, 5}`, `5 → {4, 5}` (clamped),
    `1 → {1, 2}` (clamped).
- `generate(rng, mode, params): Score` — bell-curve draw. Standard:
  default `mean=10`, `stdev=3.5`, integer-rounded, clamped. Atlas:
  default `mean=3`, `stdev=0.8`, snapped to nearest tier. `params` is
  exposed so we can tune the difficulty distribution from outside.

### Matrix generation

```ts
type Matrix = {
  mode: ScoreMode;
  // viewA[i][j] = team A's expected score for A's army i vs. B's army j
  viewA: Score[][];
  // viewB[i][j] = team B's expected score for B's army j vs. A's army i,
  //              i.e. the same matchup with B's variance applied.
  // Indexed [bArmy][aArmy], not [aArmy][bArmy] — B reads its own armies
  // down the rows.
  viewB: Score[][];
};
```

`generateMatrix(rng, mode, params)` produces both views: it draws
`viewA` directly from the bell curve (the anchor — `CLAUDE.md` defines
each cell as "an expected score for Team A's army vs Team B's army,
from Team A's perspective"), then applies one application of the
score-mode's variance function to each cell to produce `viewB`. As a
result, `|viewA[i][j] - viewB[j][i]|` is bounded by the mode's variance
distance (±3 in standard mode, ±1 ordinal step in atlas mode) — the
spec disagreement noted in `CLAUDE.md` is resolved in `CLAUDE.md`'s
favor. Both views are persisted in state; each team's UI only ever
reads its own.

## AI opponent

Three difficulty tiers. All three live in `ai.ts` behind one factory
that returns an actor implementing the `Actor` interface — the same
interface a human controller satisfies via dispatched actions.

```ts
interface Actor {
  pickDefender(view: TeamView): ArmyId;
  pickAttackers(view: TeamView, oppDefender: ArmyId): [ArmyId, ArmyId];
  pickRefusal(view: TeamView, attackers: [ArmyId, ArmyId]): ArmyId;
  pickTable(view: TeamView, ...): TableId;
}
```

`TeamView` is exactly what `viewFor(team)` returns — the AI sees the same
information a human in that seat would see, no more.

### Tiers

Algorithms are documented explicitly here so reviewers can audit AI
behavior against the spec without reading the implementation.

#### Easy — greedy, depth 0

No lookahead. Decisions use only the AI's own matrix and the current
revealed state.

- **`pickDefender`**: choose the army `d` from our remaining pool that
  maximizes the **mean** of our expected scores against the opponent's
  remaining pool. Ties broken by army id for determinism.
- **`pickAttackers(oppDefender D)`**: choose the two armies in our pool
  with the **lowest** expected scores against `D`. Rationale: send the
  worst matchups as bait; preserve our strong armies for when their
  matchups still exist.
- **`pickRefusal(attackers [a, b])`**: refuse the attacker with the
  **higher** expected score against our defender — keep the easier
  matchup.
- **`pickTable`**: lowest-numbered available table id (per the
  "Tables and scoring" note).

#### Medium — shallow minimax with heuristic evaluation

Depth 2 minimax over the public game tree, with a heuristic that
estimates total expected team score from the current state to game end.
Moderately strong but not exhaustive — explicitly de-scoped from
optimality.

- **State representation**: the projected post-decision state
  (remaining pools, locked pairings, who holds the token).
- **Branching**: at each level, enumerate the candidate decisions for
  the moving team (typically 8 → smaller pools later); prune to the
  top-K by heuristic to keep the branch factor tractable (default
  `K = 4`).
- **Opponent model in the tree**: the AI assumes the opponent uses the
  *same matrix* as it does (a deliberate simplification — we don't have
  access to the opponent's matrix, so we approximate). Their move at
  each ply is the one that minimizes our heuristic.
- **Heuristic evaluator**: sum of expected scores for each completed
  pairing in the projected state, plus, for unfilled slots, a
  pessimistic estimate equal to the mean of "us as defender" rows minus
  a small penalty for being forced into the Scrum's unfavorable slots.
- **Refusal and table picks** use the same minimax framework with
  reduced branching.

#### Hard — Monte-Carlo simulation with parameterized opponent policy

Roll-forward simulation. Implemented in v1; explicitly committed.
Simulates plausible opponent decisions to estimate expected value;
**does not** read the opponent's actual locked-but-unrevealed pick.

- **Opponent policy**: softmax (Boltzmann) over the opponent's candidate
  moves, scored by the AI's *belief* of the opponent's heuristic
  evaluation. Temperature `τ` controls rationality:
  - low `τ` ≈ near-best-response (a "rational" opponent),
  - high `τ` ≈ near-uniform (a "noisy" opponent).
  Default `τ = 0.7`. Tunable per construction.
- **Opponent matrix belief**: starts as the AI's own matrix (same
  approximation as Medium). Each revealed opponent decision is used to
  update the belief lightly — specifically, we increase the implied
  likelihood weight on opponent matrices consistent with the observed
  decision (a coarse Bayesian-like update, not full posterior
  inference). This is the "behavioral inference" channel the spec
  permits.
- **Per-decision algorithm**: for each candidate decision `c`:
  1. Roll out `N` simulations to game end (default `N = 64`), sampling
     opponent moves from the softmax policy and our own moves from a
     greedy approximation of our future selves.
  2. Score each rollout by total expected team score.
  3. Pick `argmax_c` of the mean rollout score.
- **Determinism**: simulations use the engine's seeded RNG so test
  runs are reproducible.
- **Performance budget**: per-decision compute capped at ~10ms with
  `N = 64`; if exceeded, lower `N` rather than blocking the turn. The
  full game's `<50ms` end-to-end budget is for AI-vs-AI; in practice
  Hard will be slower than Medium and that's OK as long as a single
  decision feels responsive.
- **Out of scope for v1**: ML-based opponent models, learned
  evaluators, full Bayesian posterior over opponent matrices. Those
  belong to a future "Advanced+" tier and will be a separate spec.

### What the AI may and may not see

- May see: its own matrix (`viewA` or `viewB` depending on seat), all
  publicly revealed history (every defender, attacker pair, refusal,
  table choice, and the initial token roll-off), the seat it occupies,
  and the current state's projection.
- May *also* simulate hypothetical opponent decisions to inform its own
  pick. This is fine because simulations are about uncertainty over the
  opponent's matrix and tendencies, not about reading the opponent's
  actual locked pick.
- May **not** see: the opponent's matrix, the opponent's `pending*`
  selections in the same step, or any field stripped by `viewFor`.

The engine enforces this not by trust but by construction: the AI is
called with `viewFor(seat)` and has no other access to state.

## Logging

`log.ts` exposes an append-only `LogEntry[]` that lives on the state.
Entries are added only at reveal-time or auto-resolution time, never on
lock-in. Entries are typed:

```
DefendersRevealed   { round, aArmy, bArmy }
AttackersRevealed   { round, aAttackers, bAttackers }
RefusalsRevealed    { round, aRefused, bRefused }
TokenRollOff        { winner }                       // round 1 only
TokenFlipped        { newHolder, reason }
TableChosen         { round, team, tableId, defenderArmy }
LastManAutoPaired   { aArmy, bArmy }
RefusedAutoPaired   { aArmy, bArmy }
```

The log is what the UI's log panel renders. Its other purpose is
spectator-mode replay: feeding the log into a fresh engine state and
replaying transitions should reach the same terminal state, modulo the
secret pendings (which the log doesn't see — only reveals).

## Testing strategy

- **Vitest, colocated `*.test.ts`** alongside each module.
- **Coverage targets**: ≥95% line + branch on `state.ts`, `matrix.ts`,
  `score.ts`. `ai.ts` and `log.ts` are "interesting cases covered" — we
  don't gate on coverage percentage there because the AI's branch space
  isn't a useful coverage signal.
- **Property tests for the FSM**: with a seeded RNG, generate random
  legal action sequences and assert that (a) every reachable state
  passes the information-hiding invariant, (b) the engine reaches
  `GAME_COMPLETE` in exactly 8 logged pairings, (c) JSON
  round-trip produces an identical state at every step.
- **Golden tests for matrix generation**: with a fixed seed, the matrix
  generator produces the same matrix on every run on every machine
  (this is what catches accidental `Math.random` leaks).
- **AI vs. AI smoke tests**: easy-vs-easy, medium-vs-easy, medium-vs-medium
  for a fixed seed corpus. Assertions: completes in `<50ms`, no errors,
  legal actions only, log shape matches expected event sequence. Medium
  beats easy >70% over the corpus.
- **No mocks of the engine in engine tests.** We test the real state
  transitions; the AI tests use the real engine and just inject the AI
  Actor.

## Code style

Strict TS. Discriminated unions for state and actions. Pure functions.
Naming reflects the domain glossary in `CLAUDE.md` — `defender`,
`attackers`, `refused`, `tableChoiceToken`. Not `selectedA`, `picks`,
`rejected`.

Example transition (illustrative — not a binding signature):

```ts
type ActionResult =
  | { ok: true; state: PairingState; events: LogEntry[] }
  | { ok: false; error: EngineError };

export function applyAction(
  state: PairingState,
  action: Action,
): ActionResult {
  switch (state.phase) {
    case 'ROUND_1.AWAITING_DEFENDERS':
      if (action.type !== 'LOCK_IN_DEFENDER') {
        return { ok: false, error: { kind: 'IllegalAction', phase: state.phase, action } };
      }
      return lockInDefender(state, action);
    // ...
  }
}
```

No `any` without an inline `// any: <reason>` comment. No mutation of
`state` — return a new value. No `Date.now()` or `Math.random()` in the
engine; both go through `state.rng` which is a seedable, serializable
PRNG.

## Boundaries

**Always do**

- Write the test before the transition.
- Run `npm test -- src/engine` and `npm run typecheck` before declaring
  any engine task done.
- Keep all engine code free of React, DOM, and I/O imports.
- Route all randomness through the seeded RNG on `state`.

**Ask first**

- Adding any runtime dependency to the engine (the bar is "do we really
  need it" — current count is zero, target is zero or one).
- Changing the `Action` or `EngineError` shapes after the UI has started
  consuming them.
- Changing the bell-curve defaults for matrix generation (these affect
  game feel and should be a deliberate decision, not drift).

**Never do**

- Embed AI logic in UI components.
- Pass raw `number[][]` matrices into the UI — always pass typed
  `Matrix` / `Score` values.
- Read the opponent's `pending*` slot from any code path the AI uses.
- Skip the `AUTO_LAST_MAN` / `AUTO_REFUSED_PAIR` states by collapsing
  them into the prior reveal (the explicit transition is what gives the
  log and UI a hook to render those events).

## Resolved decisions

These were open questions during specification; recording the resolution
here so we don't relitigate them mid-implementation.

1. **Scrum table-choice for auto-paired games.** The token-holder
   assigns both remaining tables for the two auto-paired games. The two
   `attacker-vs-defender` games still go via defender-first (token-holder
   first, then opponent). See "Scrum sequencing" step 6.
2. **Atlas variance.** Strictly ±1 ordinal step on the tier set
   `{1, 2, 2.5, 3, 3.5, 4, 5}`, regardless of the numeric gap between
   adjacent tiers. The 4↔5 step counts as one step.
3. **Hard AI v1 behavior.** Monte-Carlo simulation with parameterized
   softmax opponent policy is in scope for v1. ML-based behavioral
   modeling is explicitly out of scope and will be a future
   "Advanced+" tier.

## Open questions

None remaining at spec time. Any new ambiguity discovered during `/plan`
or `/build` should be added here as a new entry rather than silently
resolved in code.

