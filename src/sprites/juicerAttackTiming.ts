/**
 * The one place the Juicer's animation timing is written down.
 *
 * Four things have to agree about when his attacks connect: the pose
 * choreography in `scripts/generate-juicer-sprite.ts`, the release/impact
 * countdowns in `src/creatures/Juicer.ts`, the frame the bake gates assert is
 * the peak of each one-shot, and the row lengths `src/sprites/juicerSprite.ts`
 * plays. Separate hand-copied constants are a contract that holds until the
 * first retune and then fails silently, with the damage landing on a frame
 * where the body has not moved.
 *
 * This module deliberately imports nothing: it is pulled in by an offline
 * node-canvas generator as well as by the browser bundle, and anything it
 * touched would have to work in both.
 */

/** Sprite frames in the idle rows. */
export const JUICER_IDLE_FRAMES = 8;

/**
 * Sprite frames in the walk rows. Twice the other loop cycles: the walk plays
 * most and travels furthest, so it is the one where too few frames read as a
 * stutter.
 */
export const JUICER_WALK_FRAMES = 16;

/**
 * Sprite frames in the sprint rows, run on their own frame counter rather
 * than the walk's distance-driven one — a fast gait sampled off travel
 * distance undersamples and the legs jump between non-adjacent poses.
 */
export const JUICER_SPRINT_FRAMES = 12;

/** Sprite frames in the dumbbell throw rows (windup through release). */
export const JUICER_THROW_FRAMES = 10;

/**
 * Where in the throw the dumbbell leaves his hands, as a fraction of the row.
 *
 * The crouch-and-coil builds through the first half, the release is the peak
 * frame, and the remainder is follow-through. Landed later than this the
 * held-dumbbell overlay and the airborne projectile would both be on screen
 * at once; landed earlier the throw reads as releasing before the arms
 * finish driving forward.
 */
export const JUICER_THROW_RELEASE_PROGRESS = 0.55;

/** Sprite frames in the ground-punch rows. */
export const JUICER_PUNCH_FRAMES = 12;

/**
 * Where in the punch the fists connect with the floor, as a fraction of the
 * row. The rear-up builds through the first half, impact is the peak frame,
 * and the recovery crouch plays out after it.
 */
export const JUICER_PUNCH_IMPACT_PROGRESS = 0.5;

/** Game frames each sprite frame of a one-shot row is held for. */
export const JUICER_FRAME_HOLD = 3;

/**
 * Game frames each sprite frame of the sprint is held for.
 *
 * Shorter than a one-shot's hold because the sprint covers ground several
 * times faster than the walk does — driving it off the shared walk phase
 * instead would undersample it into a vibrating blur rather than a charge.
 */
export const JUICER_SPRINT_FRAME_HOLD = 2;

/** How many game frames a one-shot row of `spriteFrames` frames occupies. */
export function juicerActionFrames(spriteFrames: number): number {
  return spriteFrames * JUICER_FRAME_HOLD;
}

/** The game frame within a one-shot on which its impact/release lands. */
export function juicerImpactFrame(spriteFrames: number, impactProgress: number): number {
  return Math.max(1, Math.round(juicerActionFrames(spriteFrames) * impactProgress));
}

/**
 * The *sprite* frame showing at the moment of impact/release.
 *
 * Exported rather than re-derived, because there is more than one plausible
 * formula for it — `floor(p·F)` and `round(p·(F−1))` agree at `p = 0.5` and
 * part company everywhere else. The bake gates assert the pose peaks on this
 * frame and the runtime draws this frame; if they each did their own
 * arithmetic the two would silently describe different moments the first
 * time an impact was retuned, which is the failure this module exists to
 * prevent.
 */
export function juicerImpactSpriteFrame(spriteFrames: number, impactProgress: number): number {
  return Math.max(0, Math.min(spriteFrames - 1, Math.floor(impactProgress * spriteFrames)));
}
