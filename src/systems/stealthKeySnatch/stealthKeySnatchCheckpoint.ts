/**
 * What a checkpoint and a save keep of the stealth gate's key quest, apart
 * from the system so the save format can parse it without loading the quest.
 */

import { isRecord } from '../../core/util/guards';

/**
 * Where the quest stands:
 * - `unmet`: nobody has talked to the gate guard; he wears a '!' and the
 *   prison door refuses the party.
 * - `briefed`: he has explained; the quest is active and the tracker points
 *   at the prison door.
 * - `keyHeld`: a crawler carries the key; he wears a '?' until it is handed over.
 * - `opened`: the gate is open and the quest is complete.
 *
 * `briefed` and `keyHeld` follow the inventories, not the other way round: a
 * key evicted from the quest slot drops the phase back to `briefed`.
 */
export type StealthKeySnatchPhase = 'unmet' | 'briefed' | 'keyHeld' | 'opened';
const PHASES: readonly StealthKeySnatchPhase[] = ['unmet', 'briefed', 'keyHeld', 'opened'];

/** What a checkpoint and a save keep of the quest. The prison's guards and suspicion are never kept. */
export interface StealthKeySnatchCheckpoint {
  readonly phase: StealthKeySnatchPhase;
  /** Whether the prison's explainer has been read on this save, so later entries skip it. */
  readonly explainerSeen: boolean;
}

/** The quest as a floor generates it, and as a save written before the quest loads it. */
export const UNMET_STEALTH_KEY_SNATCH: StealthKeySnatchCheckpoint = {
  phase: 'unmet',
  explainerSeen: false,
};

/** Parses the saved quest from untrusted JSON; undefined for a save written before it existed. */
export function parseStealthKeySnatchCheckpoint(
  value: unknown,
): StealthKeySnatchCheckpoint | undefined {
  if (!isRecord(value)) return undefined;
  const phase = PHASES.find((candidate) => candidate === value.phase);
  const { explainerSeen } = value;
  if (phase === undefined || typeof explainerSeen !== 'boolean') return undefined;
  return { phase, explainerSeen };
}
