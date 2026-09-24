import { TILE_SIZE } from './constants';

/**
 * The one set of numbers every revive in the game is judged by — a knocked-out
 * crawler and a downed hireling alike — so standing over a fallen friend means
 * the same distance, the same wait and the same sliver of health whoever it is.
 * A leaf module so a creature can read them without importing a system.
 */

/** How close a crawler must stand to someone down to revive them. */
const REVIVE_RANGE_TILE_FRACTION = 0.8;
export const REVIVE_RANGE_PX = TILE_SIZE * REVIVE_RANGE_TILE_FRACTION;
/** 5 seconds @ 60fps of standing close before whoever is down comes back up. */
export const REVIVE_FRAMES = 300;
/** HP a revived body comes back with, as a fraction of their max. */
export const REVIVE_HP_FRACTION = 0.01;
