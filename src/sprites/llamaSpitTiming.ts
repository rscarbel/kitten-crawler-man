/**
 * The one place the Lava Llama's spit timing is written down.
 *
 * Four things have to agree about when the ball leaves the mouth: the pose
 * choreography in `scripts/generate-llama-sprite.ts`, the countdown in
 * `src/creatures/Llama.ts`, the frame the `?llama` harness marks as the
 * release, and the sprite state `src/sprites/llamaSprite.ts` picks. They used
 * to agree by three hand-copied copies of the same number, which is a contract
 * that holds until the first time someone retunes the animation — and then
 * fails silently, with the llama firing on a pose where its mouth is shut.
 *
 * This module deliberately imports nothing. It is pulled in by an offline
 * node-canvas generator as well as by the browser bundle, and anything it
 * touched would have to work in both.
 */

/** Game frames the spit animation runs for. */
export const LLAMA_SPIT_FRAMES = 26;

/**
 * Where in the spit the ball leaves the mouth, as a fraction of
 * `LLAMA_SPIT_FRAMES`.
 *
 * The art gathers, charges, whips the neck forward and recovers; the projectile
 * launches on the whip. Fired on the gather it reads as the llama spitting
 * before it opens its mouth, and fired on the recovery it reads as a reaction
 * to a shot that already happened.
 */
export const LLAMA_SPIT_RELEASE_PROGRESS = 0.52;

/**
 * How much of the animation the forward whip occupies, centred on the release.
 *
 * The generator derives its gather and thrust window from this rather than
 * declaring them, so the pose the ball launches on is the pose in the middle of
 * the thrust by construction.
 */
export const LLAMA_SPIT_THRUST_SHARE = 0.22;

/**
 * The elapsed frame of the animation the ball is launched on.
 *
 * Everything that needs a frame number rather than a progress fraction derives
 * it here, so the game and the review harness cannot round the same fraction to
 * two different frames — which is exactly what they were doing.
 */
export function llamaSpitReleaseFrame(): number {
  return Math.round(LLAMA_SPIT_FRAMES * LLAMA_SPIT_RELEASE_PROGRESS);
}
