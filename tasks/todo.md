# Table Impact System — Task List

> Tracks implementation against `tasks/plan.md`. Vertical slices: each phase
> is independently demoable. Mark `[x]` as completed.

## Phase 1 — Engine foundation
- [x] **T1**: `TableModifier` type + standard/atlas application + symbolic inverter (`score.ts`)
- [x] **T2**: `Matrix` carries `impactA`/`impactB` (placeholder all-null in `generateMatrix`)
- [x] **T3**: Generated impact distribution (~25% cells, hidden importance + preferred tables)
- [x] **T4**: `LOCK_IN_TABLE` consults impacts; `Pairing.tableScoreModifier` populated for real

**Checkpoint**: engine tests green; typecheck green; impacts visible on `state.matrix`.

## Phase 2 — AI awareness
- [x] **T5**: Medium AI picks best available table (Easy unchanged, documented)
- [x] **T6**: Medium incorporates expected best-table impact bonus into defender/attacker picks

**Checkpoint**: Medium-vs-Easy ≥70% on impact-heavy seed corpus.

## Phase 3 — Generated-mode play surface
- [x] **T7**: `Matrix.tsx` overlays per-cell impact glyphs + tooltip
- [x] **T8**: Table-pick UI (`StepPrompt.tsx`) shows live modifier per available table
- [x] **T9**: `FinalSlate.tsx` shows base + modifier breakdown in score column

**Checkpoint**: SP-vs-Medium on a generated impact-carrying matrix plays end-to-end with impacts visible at every surface.

## Phase 4 — Manual grid input
- [ ] **T10**: Per-cell "table impact" button + `TableImpactModal` (8-row toggle list)

**Checkpoint**: a user can configure a complete matrix + impacts via the grid and start a game.

## Phase 5 — Paste input
- [ ] **T11**: `parseSheetPaste` returns marker counts per cell (no longer silently ignored)
- [ ] **T12**: Paste preview + per-cell "assign tables to markers" modal
- [ ] **T13**: Setup wiring — `impactAOverride` plumbed through `GameConfig` → engine; persistence schema bumped

**Checkpoint**: all three input paths produce engine state with correct impact tensors.

## Phase 6 — Polish + verification
- [ ] **T14**: AI corpus retune; demo walkthrough; viewport spot-checks; build/typecheck green

**Final checkpoint**: ship-ready; `/review` before merge.

## Open questions to resolve in-flight

- Scrum auto-paired games: which team's view drives the modifier? (Task 4)
- Atlas chip display when `++` would clamp: show literal symbol or capped form? (Task 7)
- Paste validate gating: do we block "Validate" until markers assigned, or allow score-only validation first? (Task 12)
