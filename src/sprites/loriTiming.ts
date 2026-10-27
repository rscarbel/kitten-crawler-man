/**
 * Frame counts and playback rates for Old Lori.
 *
 * The choreography (`src/sprites/art/loriFigure.ts`) and the runtime sprite
 * (`src/sprites/loriSprite.ts`) both read these, so a row's length is written
 * down once.
 *
 * This module imports nothing, so the offline gates can load it directly.
 */

/** One slow hobble: weight onto the cane, off it again, and a cane re-plant. */
export const LORI_IDLE_FRAMES = 12;
/**
 * Six frames a second makes the hobble a two-second breath of a thing — about
 * the pace an old woman leaning on a stick shifts her weight. The row moves at
 * most a pixel or two per frame at the 32 px tile, well inside what six frames
 * a second carries without strobing.
 */
export const LORI_IDLE_FPS = 6;

/**
 * One full walk cycle: the bad leg and the cane forward together, then the
 * good leg. Played by the walk phase, never by the clock.
 */
export const LORI_WALK_FRAMES = 16;
