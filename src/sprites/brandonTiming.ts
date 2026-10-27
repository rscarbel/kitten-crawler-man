/**
 * Frame counts and play lengths for Brandon's rows.
 *
 * The choreography (`src/sprites/art/brandonFigure.ts`), the runtime sprite
 * (`src/sprites/brandonSprite.ts`) and the resident adapter that plays his
 * greeting all read these, so none of them can drift from the painted rows.
 *
 * This module imports nothing, so the offline gates can load it directly.
 */

/**
 * The breathing idle. Its frames are held for different lengths: he holds the
 * pumped chest proudly, lets it all go in a rush, sags for a beat, and hauls
 * it back up. Those holds are what make the deflation read as a gag rather
 * than as a pulse, so the row is paced frame by frame, not at a flat rate.
 */
export const BRANDON_IDLE_FRAMES = 10;
export const BRANDON_IDLE_FRAME_MS: readonly number[] = [
  900, 110, 90, 110, 650, 450, 150, 150, 160, 220,
];

/** The walk: one full stride (two steps) per loop, paced by ground covered. */
export const BRANDON_WALK_FRAMES = 16;

/**
 * The host's greeting: the hand comes up to the brow, holds there while he
 * nods, and drops back to his side as he bows.
 */
export const BRANDON_SALUTE_FRAMES = 13;
export const BRANDON_SALUTE_MS = 1750;
/** The frame the fingers first touch the brow: a greeting line lands well here. */
export const BRANDON_SALUTE_RAISED_FRAME = 4;

/**
 * The frame a one-shot row shows at `progress` (0 at its start, 1 at its end).
 *
 * The rows are sampled at frame centres — frame `f` is posed at
 * `(f + 0.5) / frames` — so the frame showing a fraction `p` is the one
 * nearest `p * frames - 0.5`.
 */
export function brandonFrameAtProgress(frames: number, progress: number): number {
  return Math.max(0, Math.min(frames - 1, Math.round(frames * progress - 0.5)));
}
