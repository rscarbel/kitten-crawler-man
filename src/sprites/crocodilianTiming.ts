/**
 * Frame counts, impact frames and play durations for the crocodilian rows —
 * Bucket Boy's, Clarabelle's, and the Triage sparkle's.
 *
 * The choreography (`src/sprites/art/crocodilianFigure.ts`), the runtime sprite
 * (`src/sprites/crocodilianSprite.ts`) and whatever kit drives them all read
 * these. A slap whose damage lands a frame before the palm arrives, or a heal
 * that pops before the glow peaks, is two copies of a number drifting apart.
 *
 * This module imports nothing, so the offline gates can load it directly.
 */

export const BUCKET_BOY_WALK_FRAMES = 16;
export const BUCKET_BOY_FLEE_FRAMES = 12;
/**
 * Twelve, not eight: the idle carries a weight shift *and* a glance over the
 * shoulder, and a head turn sampled by fewer frames snaps between two poses.
 */
export const BUCKET_BOY_IDLE_FRAMES = 12;
export const BUCKET_BOY_SLAP_FRAMES = 8;
/** The frame the open palm is at the far end of its swing — where the 2 damage lands. */
export const BUCKET_BOY_SLAP_IMPACT_FRAME = 4;
export const BUCKET_BOY_TRIAGE_FRAMES = 14;
/**
 * The frame the glow peaks and the hands thrust out: the heal lands here. Late
 * enough that setting the bucket down and raising the hands has played — that
 * is the channel the player reads — and early enough that he picks the bucket
 * back up afterwards.
 */
export const BUCKET_BOY_TRIAGE_RELEASE_FRAME = 8;
/** One shiver cycle of the shriek pose. Six frames, one cycle: fewer aliases into a stutter. */
export const BUCKET_BOY_COWER_FRAMES = 6;
export const BUCKET_BOY_HURT_FRAMES = 4;
/** Ends on the corpse frame, which the runtime holds while the corpse fades. */
export const BUCKET_BOY_DEATH_FRAMES = 10;

export const CLARABELLE_WALK_FRAMES = 16;
export const CLARABELLE_IDLE_FRAMES = 8;
/** Arms crossed → palm out → arms crossed again, so the row can loop for as long as she talks. */
export const CLARABELLE_TALK_FRAMES = 12;
/** The frame her palm is fully out: "that'll be three hundred". */
export const CLARABELLE_TALK_PALM_FRAME = 5;

export const TRIAGE_SPARKLE_FRAMES = 10;

/** How long each one-shot row plays, in milliseconds. */
export const BUCKET_BOY_SLAP_DURATION_MS = 420;
/** The Triage channel: the row spans it, and the heal lands on the release frame. */
export const BUCKET_BOY_TRIAGE_DURATION_MS = 1000;
export const BUCKET_BOY_HURT_DURATION_MS = 260;
export const BUCKET_BOY_DEATH_DURATION_MS = 900;
export const TRIAGE_SPARKLE_DURATION_MS = 700;

/** Loop speeds for the rows driven by the clock rather than by a timer or a walk phase. */
export const BUCKET_BOY_IDLE_FPS = 7;
export const BUCKET_BOY_COWER_FPS = 14;
export const CLARABELLE_IDLE_FPS = 5;
export const CLARABELLE_TALK_FPS = 8;

/**
 * The progress, 0–1, at which a one-shot row first shows `frame`.
 *
 * The runtime picks a frame with `progressFrameIndex`, which floors
 * `progress × frames`, so frame `f` is on screen from `f / frames` until the
 * next. A kit that lands its effect when progress crosses this value lands it
 * on the first tick the impact pose is drawn.
 */
export function progressAtFrame(frame: number, frames: number): number {
  return frame / frames;
}

/** The slap's damage moment, as a share of the slap's duration. */
export function bucketBoySlapImpactProgress(): number {
  return progressAtFrame(BUCKET_BOY_SLAP_IMPACT_FRAME, BUCKET_BOY_SLAP_FRAMES);
}

/** Triage's heal moment, as a share of the channel's duration. */
export function bucketBoyTriageReleaseProgress(): number {
  return progressAtFrame(BUCKET_BOY_TRIAGE_RELEASE_FRAME, BUCKET_BOY_TRIAGE_FRAMES);
}
