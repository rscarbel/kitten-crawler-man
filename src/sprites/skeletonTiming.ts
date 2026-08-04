/**
 * The frame timings the skeleton art and the skeleton creatures have to agree
 * on, in one place so they cannot drift apart.
 *
 * Each of these numbers is a *contract* between an animation row and the code
 * that fires something on one of its frames. Declared twice — once in
 * `scripts/generate-skeleton-sprites.ts` as the frame the pose peaks on, once in
 * `src/creatures/*.ts` as the frame the projectile is queued on — they would
 * agree only until the next time either was tuned, and the failure is silent:
 * the bolt simply leaves before the hand thrusts, or after it has already
 * dropped, and nothing throws.
 */

/** Frames the lord's soul-bolt cast animation runs for. */
export const SOUL_BOLT_CAST_FRAMES = 40;

/**
 * How far through the cast the bolt leaves the palm, 0 at the first frame and 1
 * at the last. Placed at the peak of the arm thrust: the orb has finished
 * condensing and the hand has not started to drop.
 */
export const SOUL_BOLT_RELEASE_PROGRESS = 0.62;

/** Share of the cast the arm thrust itself occupies, centred on the release. */
export const SOUL_BOLT_THRUST_SHARE = 0.3;

/** Frames the archer's draw-and-loose animation runs for. */
export const BONE_ARROW_DRAW_FRAMES = 44;

/** How far through the draw the arrow is loosed. Late — the draw is the warning. */
export const BONE_ARROW_RELEASE_PROGRESS = 0.72;

/** Frames the sword warrior's slash runs for. */
export const SWORD_SLASH_FRAMES = 28;

/** How far through the slash the edge connects. */
export const SWORD_SLASH_IMPACT_PROGRESS = 0.55;

/** Frames a summoned warrior spends climbing out of the ground, harmless. */
export const SKELETON_RISE_FRAMES = 40;

/**
 * The frame of a countdown-driven animation on which the payload fires.
 *
 * The creatures count their animation timers *down*, so a progress fraction has
 * to be turned into an elapsed frame first and then subtracted from the length.
 * Doing that arithmetic at each call site is how one of them ends up a frame out.
 */
function releaseFrame(totalFrames: number, releaseProgress: number): number {
  return Math.round(totalFrames * releaseProgress);
}

/** Elapsed frame of the cast on which the lord queues its soul bolts. */
export function soulBoltReleaseFrame(): number {
  return releaseFrame(SOUL_BOLT_CAST_FRAMES, SOUL_BOLT_RELEASE_PROGRESS);
}

/** Elapsed frame of the draw on which the archer queues its arrow. */
export function boneArrowReleaseFrame(): number {
  return releaseFrame(BONE_ARROW_DRAW_FRAMES, BONE_ARROW_RELEASE_PROGRESS);
}

/** Elapsed frame of the slash on which the sword warrior's edge lands. */
export function swordSlashImpactFrame(): number {
  return releaseFrame(SWORD_SLASH_FRAMES, SWORD_SLASH_IMPACT_PROGRESS);
}
