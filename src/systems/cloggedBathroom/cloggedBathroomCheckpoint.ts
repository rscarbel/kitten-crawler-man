/**
 * What a checkpoint and a save keep of the clogged bathroom, apart from the
 * system so the save format can parse it without loading the bathroom itself.
 */

import { isRecord } from '../../core/util/guards';

/**
 * Where the quest stands:
 * - `unmet`: nobody has talked to the plumber; he wears a '!'.
 * - `met`: he has explained; the quest is active and he wears nothing.
 * - `solved`: the plumbing is fixed; he wears a gold '?' until he says thanks.
 * - `thanked`: he has said it and the quest is complete.
 */
export type CloggedBathroomPhase = 'unmet' | 'met' | 'solved' | 'thanked';
const PHASES: readonly CloggedBathroomPhase[] = ['unmet', 'met', 'solved', 'thanked'];

/** What a checkpoint and a save keep of the bathroom. The board's turns are deliberately not among it. */
export interface CloggedBathroomCheckpoint {
  readonly phase: CloggedBathroomPhase;
  readonly explainerSeen: boolean;
}

/** Parses the saved bathroom from untrusted JSON; undefined for a save written before it existed. */
export function parseCloggedBathroomCheckpoint(
  value: unknown,
): CloggedBathroomCheckpoint | undefined {
  if (!isRecord(value)) return undefined;
  const phase = PHASES.find((candidate) => candidate === value.phase);
  const { explainerSeen } = value;
  if (phase === undefined || typeof explainerSeen !== 'boolean') return undefined;
  return { phase, explainerSeen };
}
