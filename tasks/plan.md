# Implementation Plan: Table Impact System

> Adds intelligent table-choice modeling to Cawl. Each matchup may carry per-
> table modifiers (`+`, `++`, `-`, `--`) that shift its expected score, turning
> table selection into a real strategic decision rather than a scheduling
> formality. Cuts across the engine (types, matrix, state, AI), all three
> matrix-input flows (generated, manual grid, paste), and most of the play UI.

## Overview

Today `tableChoiceScoreModifier` on the engine returns a constant `0` and
`pickTable` for all AI tiers picks the lowest-numbered available table. Tables
are pure scheduling slots. This change makes them strategic:

- Each matrix cell carries an 8-element vector of optional modifiers, one per
  table id (`null | '+' | '++' | '-' | '--'`).
- Standard mode: `+`/`++` add 3/6 points; `-`/`--` subtract 3/6. Atlas mode:
  one/two ordinal steps in either direction.
- **Inversion is mirrored**: a `+` for Team A on a table is a `-` for Team B,
  `++` ↔ `--`. (The matchup score split is inverted; so is the modifier.)
- Three input flows produce these vectors:
  - **Generated**: armies have hidden `tableImportance` and `preferredTables`;
    high-importance friendly armies bias toward `+`/`++` on a few cells, high-
    importance enemy armies toward `-`/`--`. Target ~25% of cells with at
    least one modifier. Generation does **not** mix `+`/`++` or `-`/`--` in
    the same cell (one direction only).
  - **Manual grid**: each cell exposes a "table impact" button that opens a
    modal with 8 toggle-rows, one per table.
  - **Paste**: parser already extracts cell-level markers; user is shown a
    preview where cells with markers expose a popup ("`+` applies to
    tables: …", "`-` applies to tables: …", etc.). Pasted matrices may
    legally combine `+` and `++` (or `-` and `--`) on a single cell.
- AI: Easy ignores impacts (intentional — increases Medium/Hard's edge).
  Medium and Hard read impacts when picking attackers, defenders, and tables.
- Display: Matrix cells overlay impact indicators where present; the table-
  pick UI shows the live modifier per table for the active pairing; the final
  slate folds the chosen table's modifier into each pairing's score.

## Architecture decisions

1. **Impacts live on `Matrix`, not `Pairing`.** Pairings inherit the modifier
   the moment a table is chosen (already plumbed via `Pairing.tableScoreModifier`
   from the existing hook). Matrix is the "what could happen" layer; Pairing
   is the "what did happen." Same separation we already have for scores.
2. **One impact tensor per view, mirroring `viewA`/`viewB`.** A cell in
   `impactA[i][j]` is read identically to `viewA[i][j]` — same indexing, same
   info-hiding by `viewFor`. We do **not** try to derive `impactB` lazily from
   `impactA` at read-time; we materialize both at generation/paste/manual-
   entry time, exactly as we already do for scores. This keeps the engine
   pure and the UI selectors trivial.
3. **Inversion of modifiers is symbolic, not numerical.** `+` ↔ `-`, `++` ↔
   `--` on inversion. We do not compute "invert(score + 3)" — the score
   inversion already handles the matchup split; the *modifier* just flips
   sign because each team experiences the same table effect from opposite
   ends of the score scale.
4. **Atlas modifiers are ordinal-step deltas, not numeric.** `+1 step` on the
   tier set, clamped at the ends. Reuses the existing `applyVariance` clamp
   logic via a small helper.
5. **Modifier kept in `TableModifier` symbol form on the matrix; expanded to
   number/tier-step at *application* time.** Storing symbols (not numbers)
   keeps the matrix JSON-lean, makes UI rendering straightforward (display
   `+`, `--`, etc.), and means atlas/standard share the same matrix shape.
   The mode-aware "apply" function lives in `score.ts`.
6. **Generation parameters are tunable from outside, like score generation.**
   `tableImportance` distribution (mean, stdev), preferred-table count
   distribution, modifier-likelihood thresholds — all parameterized so we
   can dial the feel without code changes later.
7. **Persistence break is acceptable.** Loading a pre-impact saved game
   should reject cleanly (clear localStorage + restart) rather than silently
   "upgrade" to empty impacts. This is in-flight work; no users to migrate.
8. **Easy AI's table pick stays "lowest available."** Per the user's request:
   the deliberate handicap is the point. Document it in `ai.ts` so a future
   editor doesn't "fix" it.
9. **Medium/Hard table-aware decisions are scoped narrowly for v1.** The
   Medium AI's existing depth-2 closed form is already complex; layering
   table-impact awareness onto every decision in one go is a large refactor.
   v1 of this feature: Medium picks the best **table** (cheap, isolated win),
   and incorporates an "expected best-table impact" *additive bonus* into
   defender/attacker round-sum scoring. This captures most of the strategic
   value without re-deriving the closed-form math. Full minimax with table
   branches is a follow-up.
10. **No engine-internal feature flag.** This is a forward-compatible engine
    change (new optional fields, defaults preserve current behavior in
    tests). UI surfaces gate behind the matrix actually carrying impacts —
    if all impacts are absent, the UI degrades gracefully to today's layout.

## Files affected (rough map)

**Engine** (`src/engine/`)
- `score.ts`: add `TableModifier`, `applyTableModifier(score, mod)`,
  `invertModifier(mod)`. ~40 LOC.
- `matrix.ts`: extend `Matrix` with `impactA`/`impactB`, update
  `generateMatrix` to draw impacts, update `generateMatrixFromViewA` to
  accept an optional `impactA` override, derive `impactB` via the new
  `invertModifier` per-cell. ~80 LOC.
- `state.ts`: rewrite `tableChoiceScoreModifier` to look up the chosen
  table's modifier in the appropriate view; thread `viewer` (defender's
  team) so the modifier reflects *that team's* perspective on impact. The
  existing `Pairing.tableScoreModifier` field already exists. ~20 LOC.
- `ai.ts`: Medium/Hard `pickTable` becomes "argmax over available tables of
  defender's view modifier"; `pickDefender`/`pickAttackers` add an
  expected-impact bonus term. Easy unchanged (with a `// intentional` note).
  ~80 LOC.
- `index.ts`: re-export new public types/helpers.

**Setup / matrix input** (`src/components/Setup/`)
- `types.ts`: extend `GameConfig` with optional `impactAOverride`.
- `MatrixGridEntry.tsx`: add per-cell "table impact" button + modal.
- New `TableImpactModal.tsx`: 8-row toggle list shared by grid and paste.
- `sheetPaste.ts`: stop discarding markers; return a parallel
  `markersA[i][j]: { plus, plusPlus, minus, minusMinus }` (count of each).
- `MatrixPasteEntry.tsx`: if any cell has markers, render a preview with
  per-cell "assign tables" buttons that open a paste-flavored modal
  ("`+` applies to: …" etc.).
- `MatrixEntry.tsx`: thread the impact tensor through `onMatrixChange` (the
  callback shape grows from "matrix or null" to a small shape `{ matrix,
  impact } | null`).
- `SetupScreen.tsx`: store `enteredImpact` alongside `enteredMatrix`; pass
  through to engine in `handleStart`.

**Play UI** (`src/components/Play/`)
- `Matrix.tsx`: overlay tiny modifier glyphs on cells whose impact vector
  is non-empty; tooltip shows per-table breakdown.
- `StepPrompt.tsx`: in `AWAITING_TABLES`, render each available table with
  its live modifier for the active pairing (color-coded). The user already
  sees the table list — this just enriches each entry.
- `cardLocation.ts` / `slateColumns.ts`: no changes (impact is matrix data;
  cards/slate are about pairings).

**GameOver** (`src/components/GameOver/`)
- `FinalSlate.tsx`: add modifier indicator next to each pairing's score.
  `expectedScore` becomes `expectedScore + tableModifier(p)`.

**Store** (`src/store/`)
- `gameStore.ts`: pass the new `impactAOverride` through `startGame`.
- `persistence.ts`: bump persistence version key; on rehydrate, if version
  mismatches, clear silently.

**Tests**
- New: `score.test.ts` cases for `applyTableModifier` / `invertModifier`.
- New: `matrix.test.ts` cases for impact generation distribution, inversion
  symmetry, manual override path.
- New: `state.test.ts` cases for `LOCK_IN_TABLE` writing the correct
  modifier into the pairing.
- New: `ai.test.ts` cases for Medium picking the best table and Medium
  beating Easy >70% on a corpus that exercises high-impact matrices (the
  whole point of the feature).
- New: `sheetPaste.test.ts` cases for marker capture (currently asserts
  ignored).
- New: `MatrixGridEntry.test.tsx` for the modal flow.
- New: `MatrixPasteEntry.test.tsx` preview + modal.
- Updated: `Matrix.test.tsx` for impact overlay rendering.
- Updated: `FinalSlate` test for modifier in score column.

## Task list

Sized for one focused session each unless noted. Vertical slices: each
phase ships engine + UI + tests for one user-visible change so we can
demo it before moving on.

### Phase 1 — Engine foundation (no UI)

#### Task 1: `TableModifier` type + standard/atlas application

**Description**: Add the modifier symbol type, the standard/atlas value
deltas, the atlas-step helper, and the symbolic inverter. Pure additions
to `score.ts`. No callers yet.

**Acceptance criteria**:
- `TableModifier = '+' | '++' | '-' | '--'` exported from `score.ts`.
- `applyTableModifier(score, mod): Score` — standard adds ±3/±6 with
  `[0, 20]` clamp; atlas steps ±1/±2 on `ATLAS_TIERS` with end clamp.
- `invertModifier(mod): TableModifier` — `+`↔`-`, `++`↔`--`. Involution.
- All branches covered.

**Verification**:
- `npm test -- src/engine/score` passes.
- `npm run typecheck` clean.

**Dependencies**: None.

**Files touched**: `src/engine/score.ts`, `src/engine/score.test.ts`.

**Estimated scope**: XS (single file + tests).

---

#### Task 2: `Matrix` carries `impactA`/`impactB`

**Description**: Extend the `Matrix` interface with two parallel impact
tensors. Each `impactX[i][j]` is a `readonly (TableModifier | null)[]` of
length 8 (one slot per table id, **0-indexed**: slot 0 = table id 1). Empty
slots = `null`. Update `generateMatrix` to fill **all-null** vectors for
now (real generation in Task 3). Update `generateMatrixFromViewA` to take
an optional `impactA` override and *symbolically invert* it cell-by-cell
into `impactB`.

**Acceptance criteria**:
- `Matrix.impactA[i][j][t]` and `Matrix.impactB[j][i][t]` exist on every
  generated matrix.
- `impactB[j][i][t] = invertModifier(impactA[i][j][t])` when the latter is
  non-null; `null` otherwise. Property test.
- Default `generateMatrix` produces all-null impact tensors (preserves
  pre-feature semantics until Task 3 turns generation on).
- `generateMatrixFromViewA(rng, mode, viewA)` still works without the
  impact override (back-compat).
- JSON round-trip of a matrix with non-trivial impacts is identical.

**Verification**:
- `npm test -- src/engine/matrix` passes.
- New "impact inversion is symbolic and involutive" property test passes.

**Dependencies**: Task 1.

**Files touched**: `src/engine/matrix.ts`, `src/engine/matrix.test.ts`.

**Estimated scope**: S.

---

#### Task 3: Generated impact distribution

**Description**: Per-army hidden `tableImportance` (drawn from a
parameterized distribution, default mean 0.4, stdev 0.2, clamped [0, 1])
and `preferredTables` (1–3 of {1..8}, drawn at generation time). For each
cell `[i][j]`:
- With probability proportional to A's army `i`'s importance, pick a
  random subset of A[i]'s preferred tables and assign `+` or `++`
  (`++` rate proportional to importance × secondary roll).
- With probability proportional to B's army `j`'s importance, pick a
  random subset of B[j]'s preferred tables and assign `-` or `--`.
- Within a single cell, never combine `+` and `++` (or `-` and `--`) —
  if multiple draws collide on the same table, keep the stronger.
- After populating `impactA`, derive `impactB` via `invertModifier` per
  cell (Task 2 already covers this path).

Tune until ~25% of cells (`(i, j)` pairs) carry at least one modifier
across the 8 tables, validated with a property test over 50 seeds.

**Acceptance criteria**:
- New helper(s) live in `matrix.ts` (e.g. `generateImpacts`); pure, RNG-
  driven, no `Math.random`.
- "≥1 modifier" cell rate is in `[0.18, 0.32]` averaged over 50 seeds
  (loose-but-meaningful bound around the 25% target).
- No cell has both `+` and `++` on the same table; same for `-`/`--`.
- Generation parameters are exposed via an optional `params` extension
  (importance mean/stdev, ++/-- threshold).

**Verification**:
- `npm test -- src/engine/matrix` passes.
- A new "distribution stays in band" test runs across 50 seeds.
- `npm run typecheck` clean.

**Dependencies**: Task 2.

**Files touched**: `src/engine/matrix.ts`, `src/engine/matrix.test.ts`.

**Estimated scope**: M.

---

#### Task 4: `LOCK_IN_TABLE` consults impacts

**Description**: Replace the constant-`0` body of
`tableChoiceScoreModifier` with a real lookup against the matrix. The
modifier returned reflects the **defender team's perspective**:
`impact[def][opp][tableId-1]`. Standard mode → `±3`/`±6`; atlas mode →
encoded as the *step delta* (a small integer used to look up the new tier
from `ATLAS_TIERS`). Auto-paired scrum games (no defender) use Team A's
view by convention — flag this explicitly in the doc-comment so a reader
doesn't have to reverse-engineer the choice.

The modifier is recorded on the pairing as today
(`Pairing.tableScoreModifier`); no schema change.

**Acceptance criteria**:
- A unit test sets up a matrix with a known `+` impact on `[0][0][T3]` and
  asserts that `LOCK_IN_TABLE { tableId: 3 }` for the relevant pairing
  records `tableScoreModifier === 3` on the pairing.
- Atlas analog: a `++` impact records the step delta the score module
  defines.
- No matrix → no modifier change in any existing test (regression).

**Verification**:
- `npm test -- src/engine/state` passes.
- All pre-existing engine tests still pass (regression).

**Dependencies**: Task 2, Task 3.

**Files touched**: `src/engine/state.ts`, `src/engine/state.test.ts`.

**Estimated scope**: S.

---

### ✅ Checkpoint — Engine foundation
- [ ] `npm test` is green.
- [ ] `npm run typecheck` is green.
- [ ] A hand-rolled engine fixture demonstrates: matrix carries impacts,
      generated impacts hit the target distribution, `LOCK_IN_TABLE`
      records the impact-derived modifier on the pairing.
- [ ] No UI surface affected yet — Generated SP-vs-Easy game still plays
      to completion exactly as before (with all-null impacts in legacy
      tests where applicable, or with random impacts but Easy's table-
      pick policy unchanged).

### Phase 2 — AI awareness

#### Task 5: Medium AI picks best available table

**Description**: `mediumActor.pickTable` is changed from "lowest available
id" to "table that maximizes `applyTableModifier(matchup_score, mod)` for
the active pairing." Easy explicitly unchanged. Hard delegates to Medium
for now. (When the Hard-AI tier lands separately, it will revisit.)

**Acceptance criteria**:
- A new `ai.test.ts` case: build a state where the active pairing has a
  `++` on table 5, an `--` on table 2, nothing elsewhere; assert
  `mediumActor.pickTable` returns 5 and `easyActor.pickTable` still
  returns 1.
- Tie-break: among tables with equal modifier value, lowest id wins
  (deterministic for tests).

**Verification**:
- `npm test -- src/engine/ai` passes.

**Dependencies**: Task 4.

**Files touched**: `src/engine/ai.ts`, `src/engine/ai.test.ts`.

**Estimated scope**: S.

---

#### Task 6: Medium incorporates impact bonus into defender/attacker picks

**Description**: Augment `mediumActor.pickDefender` (and the inherited
`pickAttackers`) to include an "expected best-table impact" bonus per
candidate matchup. The bonus is the *maximum* table modifier value (in
score units) the defender's team can capture on that matchup, weighted by
the probability they'll actually get the table choice (≈ 0.5 absent
detailed token tracking — adequate for v1; documented).

The defender round-sum heuristic becomes:

    score(X) = rowSecondMin + colSecondMax
             + 0.5 * bestImpact(X, oppPredicted)        // defender side
             + 0.5 * bestImpact(myAttacker, oppPredicted) // attacker side approx

Where `bestImpact(myArmy, oppArmy)` is `max(0, max over t of
applyTableModifier(viewA[myArmy][oppArmy], modA[t]).value -
viewA[myArmy][oppArmy].value)`. Negatives clamp to 0 (best-case
expectation: opp will *not* pick a `--` table for us).

**Acceptance criteria**:
- New unit test: with a deliberately constructed matrix where one
  defender candidate has high impact upside on the predicted opp
  defender's column, Medium picks it over a slightly higher row-sum
  candidate; Easy still picks by row mean.
- AI-vs-AI smoke: across the existing 50-seed corpus + a new "high-impact"
  corpus, Medium beats Easy ≥70% (engine spec success criterion 6 is
  preserved). Should improve, given Easy ignores impacts entirely.

**Verification**:
- `npm test -- src/engine/ai` passes.
- The AI-vs-AI win-rate test runs across the corpus and reports ≥70%.

**Dependencies**: Task 5.

**Files touched**: `src/engine/ai.ts`, `src/engine/ai.test.ts`.

**Estimated scope**: M.

---

### ✅ Checkpoint — AI awareness
- [ ] `npm test` is green.
- [ ] Medium-vs-Easy win rate ≥70% on a fresh seed corpus that exercises
      generated impacts (per engine spec success criterion 6).
- [ ] Easy's behavior is byte-identical to pre-feature (no leakage).

### Phase 3 — Generated-mode play surface

#### Task 7: Matrix UI overlays impact glyphs

**Description**: `Matrix.tsx` cells gain a tiny corner glyph row when the
cell's impact vector has any non-null entries: e.g. "T2:+, T5:++, T7:-"
abbreviated to colored micro-chips. Tooltip on hover shows the per-table
breakdown. Empty vectors render today's layout unchanged.

**Acceptance criteria**:
- A snapshot-style RTL test asserts: cell with `++` on T3 renders a
  green-tinted "T3++" chip; empty-impact cells render no chip wrapper.
- Visual regression: in a generated game, ~25% of visible cells show at
  least one chip (loose, but caught by a spot check).

**Verification**:
- `npm test -- src/components/Play/Matrix` passes.
- Manual: `npm run dev`; matrix cells show readable impact chips that
  don't crowd the score.

**Dependencies**: Task 4.

**Files touched**: `src/components/Play/Matrix.tsx`,
`src/components/Play/Matrix.test.tsx`.

**Estimated scope**: M (tight on layout fidelity).

---

#### Task 8: Table-pick UI shows live modifier per table

**Description**: When `state.phase` ends in `AWAITING_TABLES`,
`StepPrompt.tsx` renders the available-tables list with each entry
annotated by the modifier the *active pairing* carries on that table for
the *picking team's* viewpoint. Color-coded the same way as matrix
overlays (`+`/`++` green tints, `-`/`--` red tints, neutral grey).

**Acceptance criteria**:
- A test seeds a state at `ROUND_1.AWAITING_TABLES` with known impacts
  and asserts that the rendered table buttons show the expected
  annotations.
- Atlas mode shows step-deltas (e.g. "+1 step") in lieu of "+3".

**Verification**:
- `npm test -- src/components/Play/StepPrompt` (new file) passes.
- Manual: a generated game's table pick shows clear "T5: +6" /
  "T2: −3" annotations.

**Dependencies**: Task 4, Task 7.

**Files touched**: `src/components/Play/StepPrompt.tsx`,
`src/components/Play/StepPrompt.test.tsx`.

**Estimated scope**: S.

---

#### Task 9: FinalSlate shows table modifier in score column

**Description**: `FinalSlate.tsx`'s `expectedScore` reads from each
team's view *plus the chosen table's modifier* (already on the pairing).
Rendering shows the base+mod breakdown for transparency: e.g.
`16 (+3 T5)` rather than just `19`. Totals reflect the modified scores.

**Acceptance criteria**:
- An integration test from Phase U3 era passes with the new score
  display: a fixture pairing with `+3` on its chosen table renders
  `16 (+3 T5)` and contributes 19 to the team total.

**Verification**:
- `npm test -- src/components/GameOver` passes.
- Manual: a finished game's final slate sums match the modifier-
  inclusive total.

**Dependencies**: Task 4.

**Files touched**: `src/components/GameOver/FinalSlate.tsx`,
`src/components/GameOver/GameOverScreen.test.tsx`.

**Estimated scope**: S.

---

### ✅ Checkpoint — Generated-mode play surface
- [ ] An SP-vs-Medium game on a generated impact-carrying matrix plays
      end-to-end, with impacts visible on the matrix, on table picks, and
      on the final slate.
- [ ] An SP-vs-Easy game on the same seed shows identical UX *except*
      the AI's table picks (Easy keeps grabbing T1).
- [ ] Engine + AI tests still ≥95% coverage thresholds the spec sets.

### Phase 4 — Manual grid input

#### Task 10: Per-cell "table impact" button + modal in MatrixGridEntry

**Description**: Each cell in the grid input gains a tiny "T" button
beneath the score input. Clicking opens a modal that lists 8 rows (one per
table id), each with a 5-way toggle: `none | + | ++ | - | --`. Submit
writes the cell's 8-vector. Cells with at least one non-null modifier
render a small dot indicator on the button so the user can see which
cells they've already configured.

**Acceptance criteria**:
- New `TableImpactModal.tsx` component with 8 toggle rows; controlled
  (open/close + value/onChange).
- `MatrixGridEntry` keeps an `impact[i][j]` parallel state, surfaces it
  via `onImpactChange` (or a unified `onMatrixChange` shape — see Task
  12).
- RTL test: opening the modal on cell `[2][3]`, toggling table 5 to
  `++`, and submitting writes `++` to `impact[2][3][4]`.
- Atlas mode + manual grid: same modal, same shape (atlas just changes
  what `applyTableModifier` does at consume time, not the input UX).

**Verification**:
- `npm test -- src/components/Setup/MatrixGridEntry` passes.

**Dependencies**: Task 1.

**Files touched**: `src/components/Setup/MatrixGridEntry.tsx`,
new `src/components/Setup/TableImpactModal.tsx`,
`src/components/Setup/MatrixGridEntry.test.tsx` (new).

**Estimated scope**: M.

---

### ✅ Checkpoint — Manual grid
- [ ] A user can configure a complete 8x8 + impacts via the grid UI and
      start a game; impacts thread through to engine state.
- [ ] An empty-impacts grid still works (matches today's flow exactly).

### Phase 5 — Paste input

#### Task 11: `parseSheetPaste` captures markers per cell

**Description**: Today the parser silently ignores `+`, `-`, `++`, `--`,
`?`, `+/-` markers. Change the return shape to also surface a parallel
`markersA[i][j] = { plus: number, plusPlus: number, minus: number,
minusMinus: number }` (count of each marker token in that cell). `?` and
`+/-` remain ignored. Tests for cells like `"R, Y, +, +, ++"` should yield
counts `{ plus: 2, plusPlus: 1 }`.

The score derivation rule is unchanged.

**Acceptance criteria**:
- New `markersA` field on `SheetParseSuccess`. Existing test for "table
  markers ignored" updates from "no effect" to "ignored at score
  computation, surfaced as counts."
- All existing reference-paste tests still pass for the score values.
- New tests: explicit count cases for each marker.

**Verification**:
- `npm test -- src/components/Setup/sheetPaste` passes.

**Dependencies**: None (pure parser change).

**Files touched**: `src/components/Setup/sheetPaste.ts`,
`src/components/Setup/sheetPaste.test.ts`.

**Estimated scope**: S.

---

#### Task 12: Paste preview + per-cell "assign tables" modal

**Description**: After a successful paste, if any cell carries markers,
`MatrixPasteEntry.tsx` renders a preview matrix where each marker-bearing
cell shows a button summarizing its unassigned markers (e.g. "+×2, ++×1").
Clicking opens a modal: for each marker symbol present, "+ applies to
tables: [☐1 ☐2 …☐8]" with checkbox columns. The user must assign exactly
*N* tables for an "×N" marker (counts must be exhausted; Submit is
disabled otherwise). On submit the cell's `impact[t]` for each chosen
table gets the marker.

Differences from grid:
- Grid lets the user freely assign any modifier to any table.
- Paste constrains the user to *distribute the markers they pasted*
  across the 8 tables — this preserves the "the paste says how many
  modifiers but not which tables" model.
- A pasted cell may legally end with both `+` and `++` on different
  tables (or `-` and `--`); generation does not produce this, but paste
  permits it.

**Acceptance criteria**:
- `MatrixPasteEntry` exposes `onMatrixChange(matrix, impact)` that emits
  null until *all* marker-bearing cells have their tables assigned.
- An RTL flow test: paste a fixture with `R, Y, +, ++` on cell `[0][0]`,
  open the modal, assign `+` to T3 and `++` to T7, submit; the emitted
  impact has those exact slots populated.
- Submit on the modal disabled until counts match exactly. Underflow
  (assigning 0 tables for a non-zero count) keeps Submit disabled.

**Verification**:
- `npm test -- src/components/Setup/MatrixPasteEntry` (new) passes.

**Dependencies**: Task 10 (modal component reuse), Task 11.

**Files touched**: `src/components/Setup/MatrixPasteEntry.tsx`,
`src/components/Setup/TableImpactModal.tsx` (paste-flavored variant or
shared), `src/components/Setup/MatrixPasteEntry.test.tsx` (new).

**Estimated scope**: L (split if it sprawls).

---

#### Task 13: Setup wiring — pass impacts through to engine

**Description**: Plumb the impact tensor from `SetupScreen` →
`GameConfig.impactAOverride` → `gameStore.startGame` →
`createInitialState` → `generateMatrixFromViewA` (extended in Task 2).
Update `types.ts`, `gameStore.ts`, the test fixtures, and the persistence
schema version.

**Acceptance criteria**:
- An end-to-end RTL test: configure manual-grid mode, fill matrix +
  impacts, click Start; the resulting engine state carries the user's
  impacts on `state.matrix.impactA`/`impactB`.
- Same for paste mode.
- Generated-mode flow unchanged (impactAOverride absent → generator runs
  Task 3's path).
- Persistence: bumping the schema version invalidates pre-feature saved
  games (test for clean clear).

**Verification**:
- `npm test` passes (all suites).
- `npm run dev`: a manual full game with non-trivial impacts plays
  through and final-slate scores include modifiers.

**Dependencies**: Tasks 4, 10, 12.

**Files touched**: `src/components/Setup/SetupScreen.tsx`,
`src/components/Setup/MatrixEntry.tsx`,
`src/components/Setup/types.ts`, `src/store/gameStore.ts`,
`src/store/persistence.ts`, `src/store/gameStore.test.ts`.

**Estimated scope**: M.

---

### ✅ Checkpoint — All input flows complete
- [ ] All three paths (Generated, Manual Grid, Paste) produce a matrix
      with impacts that the engine correctly applies.
- [ ] An SP-vs-Medium game from each path completes successfully end-to-
      end.
- [ ] Manual page-reload mid-game preserves impacts (persistence round-
      trip works at the new schema version).

### Phase 6 — Polish + verification

#### Task 14: Snapshot the full demo flow + tune AI corpus

**Description**: Final polish + the QA pass before declaring done.
- Add a short README walkthrough of the feature (a paragraph in the
  existing user-facing copy, no new doc files).
- Run the full Medium-vs-Easy AI corpus across 100 seeded games on
  impact-carrying matrices; tune the impact-bonus coefficient (the `0.5`
  weight in Task 6) if the win rate dips below 70%.
- Verify success criterion 8 (full game in <50ms) still holds.
- Walk a human through the Generated → Play → GameOver flow once and
  capture any rough edges (e.g. cell overlap with chips, color clash).

**Acceptance criteria**:
- AI corpus reports stable ≥70% Medium-over-Easy on impact-heavy
  matrices.
- `<50ms` budget holds (no regression).
- No layout overlaps in the matrix at viewport widths {1024, 1440, 1920}.

**Verification**:
- `npm test` green.
- `npm run build` succeeds.
- `npm run typecheck` clean.

**Dependencies**: All of Phase 1–5.

**Files touched**: tunings in `src/engine/ai.ts`, possibly chip CSS in
`src/components/Play/Matrix.tsx`.

**Estimated scope**: S.

---

### ✅ Final checkpoint — Ship-ready
- [ ] All acceptance criteria for Tasks 1–14 met.
- [ ] Engine ≥95% coverage on score/matrix/state preserved.
- [ ] AI win-rate criterion holds.
- [ ] Manual smoke test on each input path (Generated, Manual Grid,
      Paste) passes.
- [ ] Code review (`/review`) before merge.

## Risks and mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Generation distribution drifts from 25% target with tuning changes | Med | Property test with loose `[0.18, 0.32]` bounds across 50 seeds; fails loud, easy to recenter. |
| Impact UI crowds matrix cells at smaller viewports | Med | Use micro-chips (~6px tall) + tooltip-on-hover for detail; Task 14 explicitly verifies at three viewport widths. |
| Medium AI's win-rate drops below 70% after impact-aware bonus | High (breaks engine spec criterion 6) | Task 6 includes the corpus run; Task 14 retunes the bonus weight if needed; we have a documented dial. |
| Paste-flow modal becomes confusing (counts vs tables) | Med | Submit-disabled-until-counts-match makes the rule visible; a single RTL test covers the flow end-to-end. |
| Persistence break orphans in-flight saves | Low | Single-user dev project; documented + clean clear on version mismatch. |
| Atlas-mode step deltas interact weirdly at the ends of the tier scale | Med | `applyTableModifier` reuses the existing `applyVariance` clamp pattern; tested explicitly with end-of-scale fixtures (`5 + ++` should saturate at `5`). |
| AI table-aware decisions become too slow under deeper search later | Low | v1 keeps the bonus additive (no extra branching); Hard AI's deeper search is its own future spec. |

## Open questions

- **AI table-pick when defender is null (scrum auto-paired games):** the
  spec says the token-holder picks both. Should impact-aware selection
  use the token-holder's view (their preferred outcome on these games)?
  Default proposal: yes, token-holder's view. Confirm in Task 4.
- **Display of impact in Matrix cell when atlas mode crosses tier
  boundaries**: e.g. cell shows `4`, `+` modifier on T2 → effective `5`
  but on T7 modifier is `++` → effective `5` (clamped). Should the chip
  show "T7:+" or "T7:++ (capped)"? Default proposal: show the literal
  symbol the user/generator put there (`T7:++`); the cap is implicit at
  apply time. Confirm in Task 7.
- **Paste flow: should we accept a paste with markers but auto-prompt
  for assignment, or require it before "Validate" succeeds?** Default
  proposal: validate the *score* part on click, surface marker-assignment
  separately afterward; `onMatrixChange` only emits non-null after both
  are complete. Locked-in if Task 12 is approved as written.
- **Easy AI's documented handicap**: should we expose a "table-aware
  Easy" toggle for users who want a *truly* easy opponent in late-game
  practice? Default proposal: no; out of scope for v1. Revisit if user
  asks.
