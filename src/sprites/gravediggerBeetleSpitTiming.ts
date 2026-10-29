/**
 * The one place the Gravedigger Beetle's spit timing is written down.
 *
 * The pose choreography in `src/sprites/art/gravediggerBeetleFigure.ts`, the
 * countdown in `src/creatures/GravediggerBeetle.ts` and the frame the review
 * harness marks as the release all have to agree on when the fireball leaves
 * the mouth, so they all derive it from here.
 *
 * This module deliberately imports nothing: the offline art gates read it as
 * well as the browser bundle.
 */

/** Game frames the spit animation runs for. */
export const GRAVEDIGGER_SPIT_FRAMES = 32;

/**
 * Where in the spit the fireball leaves the mouth, as a fraction of
 * `GRAVEDIGGER_SPIT_FRAMES`. The beetle rears with fire gathering in its jaws,
 * then whips forward; the ball launches on the whip.
 */
export const GRAVEDIGGER_SPIT_RELEASE_PROGRESS = 0.6;

/** How much of the animation the forward whip occupies, centred on the release. */
export const GRAVEDIGGER_SPIT_THRUST_SHARE = 0.2;

/** The elapsed game frame of the animation the fireball is launched on. */
export function gravediggerSpitReleaseFrame(): number {
  return Math.round(GRAVEDIGGER_SPIT_FRAMES * GRAVEDIGGER_SPIT_RELEASE_PROGRESS);
}
