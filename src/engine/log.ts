// Append-only typed log of revealed pairing events. Entries are added only at
// reveal-time or auto-resolution time, never on lock-in.

export type ArmyId = string;
export type TableId = number;
export type Round = 1 | 2 | 'scrum';
export type Team = 'A' | 'B';

export type LogEntry =
  | { readonly type: 'DefendersRevealed'; readonly round: Round; readonly aArmy: ArmyId; readonly bArmy: ArmyId }
  | { readonly type: 'AttackersRevealed'; readonly round: Round; readonly aAttackers: readonly [ArmyId, ArmyId]; readonly bAttackers: readonly [ArmyId, ArmyId] }
  | { readonly type: 'RefusalsRevealed'; readonly round: Round; readonly aRefused: ArmyId; readonly bRefused: ArmyId }
  | { readonly type: 'TokenRollOff'; readonly winner: Team }
  | { readonly type: 'TokenFlipped'; readonly newHolder: Team; readonly reason: string }
  | { readonly type: 'TableChosen'; readonly round: Round; readonly team: Team; readonly tableId: TableId; readonly defenderArmy?: ArmyId }
  | { readonly type: 'LastManAutoPaired'; readonly aArmy: ArmyId; readonly bArmy: ArmyId }
  | { readonly type: 'RefusedAutoPaired'; readonly aArmy: ArmyId; readonly bArmy: ArmyId };

export function appendLog(log: readonly LogEntry[], entry: LogEntry): LogEntry[] {
  return [...log, entry];
}
