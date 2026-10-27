/**
 * Frame counts, event frames and playback lengths for Steve Cartwright's rows
 * and his loosed bolt.
 *
 * The choreography (`src/sprites/art/steveFigure.ts`) paints the bolt leaving
 * the crossbow on the frame named here, and the target-practice routine spawns
 * the flying bolt at the progress that frame is first drawn. Copying any of
 * these numbers into either side instead is how a bolt ends up flying while the
 * crossbow in his paw is still loaded.
 *
 * This module deliberately imports nothing — the offline gates load it directly,
 * so it must not pull in any browser-only code.
 */

export const STEVE_IDLE_FRAMES = 12;
export const STEVE_WALK_FRAMES = 12;
export const STEVE_AIM_FRAMES = 12;
export const STEVE_SHOOT_FRAMES = 8;
export const STEVE_RELOAD_FRAMES = 16;

/**
 * The first shoot frame drawn with the crossbow empty and the bolt away. Early
 * in the row: the shot follows on from a held aim, so the squeeze is short and
 * the rest of the row is the kick and the settle back onto the line.
 */
export const STEVE_SHOOT_RELEASE_FRAME = 2;

/**
 * The progress at which the release frame is first drawn, when the row is
 * played through `progressFrameIndex` (frame `f` shows from `f / frames`).
 * The routine spawns the flying bolt here.
 */
export const STEVE_SHOOT_RELEASE_PROGRESS = STEVE_SHOOT_RELEASE_FRAME / STEVE_SHOOT_FRAMES;

/** How long each one-shot row plays. */
export const STEVE_SHOOT_DURATION_MS = 640;
export const STEVE_RELOAD_DURATION_MS = 2600;

/** Loop speeds of the idle bounce and the held aim's breathing, in frames per second. */
export const STEVE_IDLE_FPS = 8;
export const STEVE_AIM_FPS = 6;

export const STEVE_BOLT_FRAMES = 4;
/** Loop speed of the flying bolt's streak flicker. */
export const STEVE_BOLT_FPS = 16;
