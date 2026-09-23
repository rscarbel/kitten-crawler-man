/**
 * Frame counts, impact frames and play lengths for Dong Quixote's rows.
 *
 * The choreography (`src/sprites/art/dongQuixoteFigure.ts`), the runtime
 * sprite (`src/sprites/dongQuixoteSprite.ts`) and his combat kit all read
 * these. A kit that copied the numbers instead would land a thrust's damage on
 * a frame where the lance is still being lowered, and nothing in the type
 * system would notice.
 *
 * This module imports nothing, so the offline gates can load it directly.
 */

/**
 * The breathing idle. Its frames are held for different lengths: he holds the
 * pumped chest proudly, lets it all go in a rush, sags for a beat, and hauls
 * it back up. Those holds are what make the deflation read as a gag rather
 * than as a pulse, so the row is paced frame by frame, not at a flat rate.
 */
export const DONG_IDLE_FRAMES = 10;
export const DONG_IDLE_FRAME_MS: readonly number[] = [
  900, 110, 90, 110, 650, 450, 150, 150, 160, 220,
];

/** The walk: one full stride (two steps) per loop, paced by ground covered. */
export const DONG_WALK_FRAMES = 16;

/** The lance jab. */
export const DONG_THRUST_FRAMES = 8;
/** The frame the point is at its furthest: the thrust's damage lands on this frame. */
export const DONG_THRUST_IMPACT_FRAME = 4;
/** How long the jab plays, wind-up to recovery. */
export const DONG_THRUST_MS = 520;

/** Lance lowered to the couch and heels dug in, before the charge. */
export const DONG_CHARGE_WINDUP_FRAMES = 6;
export const DONG_CHARGE_WINDUP_MS = 500;

/** The running couch-lance: a loop, played for as long as the charge lasts. */
export const DONG_CHARGE_FRAMES = 8;

/** Winded after a charge, hands on knees. */
export const DONG_CHARGE_RECOVER_FRAMES = 12;
export const DONG_CHARGE_RECOVER_MS = 1500;

/** The lance raised to the sky, for a kill or a hire. */
export const DONG_SALUTE_FRAMES = 10;
export const DONG_SALUTE_MS = 1300;
/** The frame the lance first reaches its full height: a bark lands well here. */
export const DONG_SALUTE_RAISED_FRAME = 3;

/** A short flinch. */
export const DONG_HURT_FRAMES = 5;
export const DONG_HURT_MS = 320;

/** Stagger, kneel, a farewell, and the fall. */
export const DONG_DEATH_FRAMES = 12;
export const DONG_DEATH_MS = 1800;
/** The frame he raises his hand in farewell: "Vale to you all. Vale." */
export const DONG_DEATH_FAREWELL_FRAME = 5;
/** The last frame is the corpse, held while it fades. */
export const DONG_DEATH_CORPSE_FRAME = DONG_DEATH_FRAMES - 1;

/**
 * The frame a one-shot row shows at `progress` (0 at its start, 1 at its end).
 *
 * The rows are sampled at frame centres — frame `f` is posed at
 * `(f + 0.5) / frames` — so the frame showing a fraction `p` is the one
 * nearest `p * frames - 0.5`.
 */
export function dongFrameAtProgress(frames: number, progress: number): number {
  return Math.max(0, Math.min(frames - 1, Math.round(frames * progress - 0.5)));
}

/** The progress at which a one-shot row shows frame `frame`: its centre. */
export function dongProgressOfFrame(frames: number, frame: number): number {
  return (frame + 0.5) / frames;
}
