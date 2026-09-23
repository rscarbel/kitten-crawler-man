/**
 * `riposte` — a mob that turns a blow aside answers it sooner than its attack
 * clock would otherwise allow.
 *
 * Only the wait *between* attacks is cut. The swing itself — its windup, its
 * telegraph, the frame its blow lands on — plays exactly as it always does,
 * so the punishment for swinging into a guard stays readable and dodgeable.
 */

/**
 * The soonest, in frames after a guard, that a riposting mob's next attack may
 * begin.
 *
 * Not less than the 21-frame floor `docs/difficulty-fairness-rules.md` sets on a
 * locked telegraph, on its own: so however short a creature's own windup, the
 * answer to a guard can never land sooner after the "Blocked" cue than a locked
 * telegraph would.
 */
export const RIPOSTE_READY_FRAMES = 24;

/**
 * The attack cooldown a riposte leaves: cut to {@link RIPOSTE_READY_FRAMES}
 * when it was longer, never lengthened, and never shorter than the frames left
 * on a swing already playing — a riposte must not start a second swing over the
 * top of the first.
 */
export function riposteCooldown(remainingCooldown: number, swingFramesLeft: number): number {
  return Math.max(swingFramesLeft, Math.min(remainingCooldown, RIPOSTE_READY_FRAMES));
}
