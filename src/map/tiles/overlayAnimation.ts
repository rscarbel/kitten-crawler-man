/**
 * The clock every sprite-building overlay plays on, and the longest loop one
 * may have.
 *
 * These live in a leaf module of their own because the building painters
 * (`src/sprites/buildinggen`) have to honour both of them and cannot import
 * `decorationTiles`, which pulls in the whole tile-rendering graph. A gate that
 * asserted against its own private copy of the cap would keep passing after
 * the runtime's copy changed, which is the failure the split exists to prevent.
 */

/** Playback rate of animated overlay states composited onto sprite buildings. */
export const SPRITE_BUILDING_OVERLAY_FPS = 8;

/**
 * The most frames a building's life loop may have.
 *
 * A building's animation can only be as *sparse* as its loop is long — the
 * overlay repeats exactly, so a pause between two events cannot outlast the
 * loop containing it. At 16 the longest available loop was 1.9 s, which is not
 * enough to hold both a slow walk across a window and a visible gap before the
 * next one. Every frame is a whole frame of decoded sheet, though, so the cap
 * is what bounds the memory one building's life may cost.
 */
export const MAX_LIFE_FRAMES = 31;
