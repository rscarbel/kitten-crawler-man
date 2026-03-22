export const TILE_SIZE = 32;
export const PLAYER_SPEED = 3.25;
export const FOLLOWER_SPEED = 4.55;

/** Kiting speed multipliers — lower than FOLLOWER_SPEED to make the cat catchable. */
export const CAT_KITE_FLEE_SPEED = FOLLOWER_SPEED * 0.92;
export const CAT_KITE_ORBIT_SPEED = FOLLOWER_SPEED * 0.76;

/** Probability a kiting auto-shot flies slightly off-target (visible near-miss). */
export const CAT_KITE_MISS_CHANCE = 0.3;

/** If the two companions drift further apart than this, the auto-fighting one breaks off. */
export const COMPANION_LEASH_PX = TILE_SIZE * 10;

/** How close an enemy must wander before the human auto-engages (cat-active mode). */
export const HUMAN_ENGAGE_RANGE = TILE_SIZE * 5;

/**
 * Cat's preferred kiting distance from an enemy that is targeting her.
 * She orbits at this radius and flees inward if the enemy gets too close.
 */
export const CAT_KITE_DIST = TILE_SIZE * 3.5;

/**
 * When helping the human, the cat stands this many pixels behind the human
 * (on the side away from the enemy) so the human acts as a shield.
 */
export const CAT_BEHIND_HUMAN_OFFSET = TILE_SIZE * 2.2;
