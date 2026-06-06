/** Cat kiting speed reduction factor (lower than FOLLOWER_SPEED to make cat catchable). */
const CAT_KITE_FLEE_MULTIPLIER = 0.92;

/** Cat kiting orbit speed reduction factor. */
const CAT_KITE_ORBIT_MULTIPLIER = 0.76;

export const TILE_SIZE = 32;
export const PLAYER_SPEED = 2.5;
export const FOLLOWER_SPEED = 3.5;

/** Kiting speed multipliers — lower than FOLLOWER_SPEED to make the cat catchable. */
export const CAT_KITE_FLEE_SPEED = FOLLOWER_SPEED * CAT_KITE_FLEE_MULTIPLIER;
export const CAT_KITE_ORBIT_SPEED = FOLLOWER_SPEED * CAT_KITE_ORBIT_MULTIPLIER;

/** Probability a kiting auto-shot flies slightly off-target (visible near-miss). */
export const CAT_KITE_MISS_CHANCE = 0.3;

/** If the two companions drift further apart than this, the auto-fighting one breaks off. */
const COMPANION_LEASH_TILES = 10;
export const COMPANION_LEASH_PX = TILE_SIZE * COMPANION_LEASH_TILES;

/** How close an enemy must wander before the human auto-engages (cat-active mode). */
const HUMAN_ENGAGE_RANGE_TILES = 5;
export const HUMAN_ENGAGE_RANGE = TILE_SIZE * HUMAN_ENGAGE_RANGE_TILES;

/**
 * Cat's preferred kiting distance from an enemy that is targeting her.
 * She orbits at this radius and flees inward if the enemy gets too close.
 */
const CAT_KITE_DIST_TILES = 3.5;
export const CAT_KITE_DIST = TILE_SIZE * CAT_KITE_DIST_TILES;

/**
 * When helping the human, the cat stands this many pixels behind the human
 * (on the side away from the enemy) so the human acts as a shield.
 */
const CAT_BEHIND_HUMAN_OFFSET_TILES = 2.2;
export const CAT_BEHIND_HUMAN_OFFSET = TILE_SIZE * CAT_BEHIND_HUMAN_OFFSET_TILES;

/**
 * Once a mob has aggroed a target, it uses this multiplier on its normal aggro
 * range before giving up the chase. Keeps enemies on the player longer once
 * combat has started.
 */
export const AGGRO_PERSIST_MULTIPLIER = 2;
