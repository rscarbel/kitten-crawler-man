/**
 * Frame counts and impact timings for the rock golem's attack rows.
 *
 * The offline generator (`scripts/generate-rock-golem-sprites.ts`) and the
 * runtime creature (`src/creatures/RockGolem.ts`) both read these. Copying the
 * numbers into either side instead is how a slam ends up dealing its damage on a
 * frame where the fists are still overhead: the animation and the hit stop
 * describing the same event, and nothing in the type system notices.
 *
 * This module deliberately imports nothing — the node-canvas generator loads it
 * directly, so it must not pull in any browser-only code.
 */

export const GOLEM_SLAM_FRAMES = 10;
export const GOLEM_STOMP_FRAMES = 10;
export const GOLEM_THROW_FRAMES = 14;

/** Fraction of the slam row at which both fists reach the ground. */
export const GOLEM_SLAM_IMPACT_PROGRESS = 0.55;
/** Fraction of the stomp row at which the raised foot lands. */
export const GOLEM_STOMP_IMPACT_PROGRESS = 0.52;
/**
 * Fraction of the throw row at which the boulder leaves the hands. Late enough
 * that the pick-up off the ground has fully played — that haul is the readable
 * wind-up the attack is telegraphed by.
 */
export const GOLEM_THROW_RELEASE_PROGRESS = 0.72;

/**
 * The sheet frame a timing fraction lands on.
 *
 * The generator samples one-shot rows at frame *centres* — frame `f` is drawn
 * at `(f + 0.5) / frameCount` — so the frame that shows a fraction `p` is the
 * one nearest `p * frameCount - 0.5`, not `p * frameCount`. Rounding without
 * the half-frame shift lands every impact one frame after the pose that
 * actually shows it, which at four game frames per sheet frame is a visible
 * gap between the fists hitting the ground and the damage.
 */
function frameAt(frames: number, progress: number): number {
  return Math.max(0, Math.round(frames * progress - 0.5));
}

export function golemSlamImpactFrame(): number {
  return frameAt(GOLEM_SLAM_FRAMES, GOLEM_SLAM_IMPACT_PROGRESS);
}

export function golemStompImpactFrame(): number {
  return frameAt(GOLEM_STOMP_FRAMES, GOLEM_STOMP_IMPACT_PROGRESS);
}

export function golemThrowReleaseFrame(): number {
  return frameAt(GOLEM_THROW_FRAMES, GOLEM_THROW_RELEASE_PROGRESS);
}
