/**
 * M2 demo: information hiding through viewFor.
 *
 * Run with:  npx tsx demos/m2-information-hiding.ts
 *
 * Shows a defender step: two LOCK_IN_DEFENDER dispatches, with the engine's
 * privileged state alongside each team's viewFor projection. The point: between
 * lock-ins, viewFor(B) literally cannot see A's pick — the field is structurally
 * absent, not just blanked. After the second lock-in, the collapse to
 * `revealed` is atomic and both views see the pair symmetrically.
 */

import { createInitialState, applyAction, viewFor } from '../src/engine/state.js';
import type { PairingState, SecretSlot } from '../src/engine/state.js';
import type { ArmyId, LogEntry } from '../src/engine/log.js';

// ── ANSI color helpers ────────────────────────────────────────────────────────

const RESET  = '\x1b[0m';
const BOLD   = '\x1b[1m';
const DIM    = '\x1b[2m';
const GREEN  = '\x1b[32m';
const YELLOW = '\x1b[93m';
const CYAN   = '\x1b[36m';
const MAGENTA = '\x1b[95m';

// ── Slot rendering ────────────────────────────────────────────────────────────

function renderSlot(slot: SecretSlot<ArmyId> | undefined): string {
  if (slot === undefined) return `${DIM}(slot not initialized)${RESET}`;
  const parts: string[] = [];
  if ('pendingA' in slot && slot.pendingA !== undefined) {
    parts.push(`${GREEN}pendingA: '${slot.pendingA}'${RESET}`);
  }
  if ('pendingB' in slot && slot.pendingB !== undefined) {
    parts.push(`${GREEN}pendingB: '${slot.pendingB}'${RESET}`);
  }
  if (slot.revealed !== undefined) {
    parts.push(`${YELLOW}revealed: { a: '${slot.revealed.a}', b: '${slot.revealed.b}' }${RESET}`);
  }
  if (parts.length === 0) return `${DIM}{} (empty — opposing pending stripped by viewFor)${RESET}`;
  return `{ ${parts.join(', ')} }`;
}

// ── Step printer ──────────────────────────────────────────────────────────────

function printStep(label: string, state: PairingState): void {
  console.log(`${BOLD}━━━ ${label} ━━━${RESET}`);
  console.log(`  Phase: ${CYAN}${state.phase}${RESET}`);
  console.log();

  console.log(`  ${BOLD}${MAGENTA}Engine state${RESET} ${DIM}(privileged "DM" view — never exposed to either team)${RESET}:`);
  console.log(`    step.defenders = ${renderSlot(state.step.defenders)}`);
  console.log();

  const va = viewFor(state, 'A');
  const vb = viewFor(state, 'B');
  console.log(`  ${BOLD}Team A's view${RESET}  ${DIM}via viewFor(state, 'A')${RESET}:`);
  console.log(`    step.defenders = ${renderSlot(va.step.defenders)}`);
  console.log(`  ${BOLD}Team B's view${RESET}  ${DIM}via viewFor(state, 'B')${RESET}:`);
  console.log(`    step.defenders = ${renderSlot(vb.step.defenders)}`);
  console.log();

  if (state.log.length > 0) {
    console.log(`  ${BOLD}Log:${RESET}`);
    for (const e of state.log) {
      console.log(`    ${YELLOW}${JSON.stringify(e)}${RESET}`);
    }
    console.log();
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

const ROSTER_A: ArmyId[] = Array.from({ length: 8 }, (_, i) => `a${i}`);
const ROSTER_B: ArmyId[] = Array.from({ length: 8 }, (_, i) => `b${i}`);

console.log(`\n${BOLD}Cawl M2 demo — information hiding through viewFor${RESET}`);
console.log(`${DIM}seed 0xCAFE  mode standard${RESET}\n`);
console.log(`Watch what each team can see across two LOCK_IN_DEFENDER dispatches.\n`);

const s0 = createInitialState({
  mode: 'standard',
  seed: 0xcafe,
  rosterA: ROSTER_A,
  rosterB: ROSTER_B,
});

printStep('Step 0 — Initial state', s0);

const r1 = applyAction(s0, { type: 'LOCK_IN_DEFENDER', team: 'A', armyId: 'a3' });
if (!r1.ok) { console.error('A lock-in failed:', r1.error); process.exit(1); }
printStep("Step 1 — Team A locks defender 'a3' (secret)", r1.state);

const events1: readonly LogEntry[] = r1.events;
console.log(`  ${GREEN}✓ A's pick visible to A; B's view shows {} (slot exists, value redacted)${RESET}`);
console.log(`  ${GREEN}✓ Phase unchanged — reveal collapse only fires on the second lock${RESET}`);
console.log(`  ${GREEN}✓ events delta from this dispatch: ${JSON.stringify(events1)}${RESET}\n`);

const r2 = applyAction(r1.state, { type: 'LOCK_IN_DEFENDER', team: 'B', armyId: 'b5' });
if (!r2.ok) { console.error('B lock-in failed:', r2.error); process.exit(1); }
printStep("Step 2 — Team B locks defender 'b5' → reveal collapse", r2.state);

console.log(`  ${GREEN}✓ Both views see the same revealed pair — symmetric reveal${RESET}`);
console.log(`  ${GREEN}✓ Phase advanced to ROUND_1.AWAITING_ATTACKERS in the same dispatch${RESET}`);
console.log(`  ${GREEN}✓ Pendings are structurally absent: 'pendingA' in slot === ${'pendingA' in (r2.state.step.defenders ?? {})}${RESET}`);
console.log(`  ${GREEN}✓ events delta from this dispatch: ${JSON.stringify(r2.events)}${RESET}\n`);
