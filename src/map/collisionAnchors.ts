/**
 * Where on a sprite a wall test is taken.
 *
 * A sprite occupies a whole tile box but only its *feet* are on the ground, so
 * which part of it a wall test uses depends on which way it is walking. Walking
 * **south**, the feet lead into the wall: testing the sprite's centre lets it
 * advance until its waist reaches the wall, which plants its entire lower half
 * on top of the masonry — the "standing on the south wall of a building" bug.
 * Walking **north**, the head leads instead, and testing the soles there would
 * let the sprite reverse into tiles it cannot stand on.
 *
 * So: south tests the sole, everything else tests the centre. This module is the
 * single definition of that rule, because it has to hold for the player, the
 * companion, every mob and every wandering townsperson alike — a sprite that
 * disagreed with the others about where a wall begins would be visibly wrong
 * next to them.
 */

export const CENTER_COLLISION_OFFSET = 0.5;

/**
 * Not a flat 1.0: a sprite standing on the last floor row already has its soles
 * on that row's bottom edge, and testing there would refuse the row outright.
 */
export const SOLE_COLLISION_OFFSET = 0.95;

/**
 * The fraction down a sprite's tile box at which a vertical step is tested.
 *
 * @param dy - the step being attempted; positive is southward (down-screen).
 */
export function verticalCollisionOffset(dy: number): number {
  return dy > 0 ? SOLE_COLLISION_OFFSET : CENTER_COLLISION_OFFSET;
}

/**
 * How far *below* a centre probe a southward probe sits, in tile fractions.
 *
 * For callers that hand a world point to a walkability callback which applies
 * the centre offset itself: shifting the point down by this much before the call
 * makes that callback test the sole instead, without every callback having to
 * learn about the rule.
 */
export const SOUTHWARD_PROBE_DROP = SOLE_COLLISION_OFFSET - CENTER_COLLISION_OFFSET;
