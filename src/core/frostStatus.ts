/**
 * The rules for what ice does to whoever it hits. One place, so every source of
 * ice — a beam, a burst, anything added later — chills and freezes the same way
 * and honours the same grace window.
 */

import type { Player } from '../Player';
import { CHILLED_STATUS, FROZEN_STATUS, makeChilled, makeFrozen } from './StatusEffect';
import { CHILLED_FRAMES, FROZEN_FRAMES } from './statusTuning';

/** Ice-resistant gear halves the time spent encased, rounded up. */
const RESISTED_FREEZE_DIVISOR = 2;

/** What an ice hit ended up doing. */
export type IceHitOutcome = 'chilled' | 'frozen' | 'refused';

export interface IceHitOptions {
  /**
   * Whether this hit may freeze at all. False for anything that only ever
   * chills, such as a burst of cold air, which must never lock a crawler down.
   */
  readonly freezeAllowed?: boolean;
  /** Overrides {@link CHILLED_FRAMES}. */
  readonly chillFrames?: number;
  /** Overrides {@link FROZEN_FRAMES}, before any resistance halves it. */
  readonly frozenFrames?: number;
}

/** How long `target` stays encased by a freeze of `frames`, after its gear. */
export function frozenFramesFor(target: Player, frames: number = FROZEN_FRAMES): number {
  return target.resists('ice') ? Math.ceil(frames / RESISTED_FREEZE_DIVISOR) : frames;
}

/**
 * Whether an ice hit that may freeze would harden `target`'s chill into a
 * freeze right now: chilled, not already frozen, and outside the grace window
 * a thaw leaves.
 */
export function wouldIceHitFreeze(target: Player): boolean {
  return (
    target.hasStatus(CHILLED_STATUS) &&
    !target.hasStatus(FROZEN_STATUS) &&
    target.freezeGraceFrames <= 0
  );
}

/**
 * Lands one ice hit on `target`.
 *
 * - Not chilled: it chills.
 * - Chilled, and outside the grace window a thaw leaves: the chill hardens into
 *   a freeze, and the chill is removed so the thaw does not leave the crawler
 *   slowed on top of it.
 * - Already frozen, or inside the grace window: it only re-chills.
 *
 * Returns `'refused'` when the target would not take the status at all — a mob
 * that is currently immune to everything, or a body already dead. A corpse is
 * refused because a freeze landing on it after the killing blow would make the
 * death read as `frozenSolid` instead of as the blow that caused it.
 */
export function applyIceHit(target: Player, options: IceHitOptions = {}): IceHitOutcome {
  if (!target.isAlive) return 'refused';
  const freezeAllowed = options.freezeAllowed ?? true;
  const chillFrames = options.chillFrames ?? CHILLED_FRAMES;
  const hardensToFreeze = freezeAllowed && wouldIceHitFreeze(target);

  if (hardensToFreeze) {
    target.applyStatus(makeFrozen(frozenFramesFor(target, options.frozenFrames)));
    if (!target.hasStatus(FROZEN_STATUS)) return 'refused';
    target.cureStatuses([CHILLED_STATUS]);
    return 'frozen';
  }

  target.applyStatus(makeChilled(chillFrames));
  return target.hasStatus(CHILLED_STATUS) ? 'chilled' : 'refused';
}

/** Chills or re-chills `target` and never freezes it, whatever state it is in. */
export function applyChillOnly(
  target: Player,
  chillFrames: number = CHILLED_FRAMES,
): IceHitOutcome {
  return applyIceHit(target, { freezeAllowed: false, chillFrames });
}
