import type { BuildingEntry } from '../BuildingSystem';

/** What the prison door says to a party that has not heard the gate guard out. */
export const PRISON_DOOR_UNBRIEFED_REFUSAL = 'Talk to the guard first.';

/**
 * The prison door's refusal for `BuildingEntryGate.blockedMessage`, or null
 * when it opens. The guard is the one who explains the gate, the key and the
 * prison, so the door stays shut until he has. Once briefed the door always
 * opens, the gate unlocked or not: the prison stays enterable.
 */
export function prisonDoorRefusal(entry: BuildingEntry, guardBriefed: boolean): string | null {
  if (entry.type !== 'prison') return null;
  return guardBriefed ? null : PRISON_DOOR_UNBRIEFED_REFUSAL;
}
