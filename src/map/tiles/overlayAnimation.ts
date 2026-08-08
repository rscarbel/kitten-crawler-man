/**
 * The clock every sprite-building overlay plays on, and the radix its frame
 * indices are folded with.
 *
 * These live in a leaf module of their own because the offline building bake
 * (`scripts/buildinggen`) has to honour both of them and cannot import
 * `decorationTiles`, which pulls in the whole tile-rendering graph. A gate that
 * asserted against its own private copy of the radix would keep passing after
 * the runtime's copy changed, which is the failure the split exists to prevent.
 */

/** Playback rate of animated overlay states composited onto sprite buildings. */
export const SPRITE_BUILDING_OVERLAY_FPS = 8;

/**
 * Radix for folding several overlay frame indices into one number. Must stay
 * larger than any overlay's frame count: at or above it, two distinct
 * combinations of frame indices collide on one cache key and a tile is served
 * a composite built for a different frame.
 *
 * 32 rather than 16 because a building's animation can only be as *sparse* as
 * its loop is long — the overlay repeats exactly, so a pause between two events
 * cannot outlast the loop containing it. At 16 the longest available loop was
 * 1.9 s, which is not enough to hold both a slow walk across a window and a
 * visible gap before the next one. Raising the radix costs nothing at runtime;
 * the frames it permits are what cost memory, so they are still spent one
 * building at a time.
 */
export const OVERLAY_FRAME_KEY_STRIDE = 32;
