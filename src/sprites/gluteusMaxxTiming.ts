/**
 * Frame counts, impact frames and playback speeds for Gluteus Maxx's rows.
 *
 * The choreography (`src/sprites/art/gluteusMaxxFigure.ts`) and whatever drives
 * him at runtime both read these. A copy of any number on either side is how a
 * jab ends up landing its damage on a frame where the fist is still cocked: the
 * animation and the hit stop describing the same event and nothing in the type
 * system notices.
 *
 * This module imports nothing, so the offline gates can load it directly.
 */

export const MAXX_IDLE_FRAMES = 12;
/**
 * The idle is two bounces on his toes and two clanks of the gauntlets per
 * loop, so at this rate he bounces about two and a half times a second — a
 * boxer's bounce, not a jog on the spot.
 */
export const MAXX_IDLE_FPS = 15;

/**
 * The run cycle: two steps. Ten frames rather than Carl's sixteen because
 * Maxx is fast and short-legged — see `MAXX_MAX_WALK_FRAMES_PER_TICK`.
 */
export const MAXX_WALK_FRAMES = 10;

/**
 * The most walk frames one tick may advance. His stride is short and his speed
 * high, so the honest cadence is already close to one frame a tick; anything
 * that covers ground faster than he runs (a separation shove, a knockback)
 * would skip frames and strobe the legs. The runtime caps the gait here.
 */
export const MAXX_MAX_WALK_FRAMES_PER_TICK = 1;

export const MAXX_JAB_FRAMES = 8;
/** The frame each jab is drawn at full extension, which is when it lands. */
export const MAXX_JAB_IMPACT_FRAME = 3;
/** A jab is a snap: about a quarter of a second, cocked, out and back. */
export const MAXX_JAB_TICKS = 16;

export const MAXX_CRUSH_FRAMES = 16;
/** The frame his seat lands on the target. */
export const MAXX_CRUSH_IMPACT_FRAME = 6;
/**
 * The whole routine, turn to turn, a little over a second: slow enough to
 * read as a deliberate finisher, fast enough not to leave him a sitting duck.
 */
export const MAXX_CRUSH_TICKS = 68;
/**
 * How far from where he stands his seat lands, in tiles along his facing: the
 * target is expected about this far in front of him when the crush begins.
 */
export const MAXX_CRUSH_SEAT_REACH_TILES = 0.85;

export const MAXX_HURT_FRAMES = 6;
export const MAXX_HURT_TICKS = 18;

export const MAXX_DEATH_FRAMES = 12;
export const MAXX_DEATH_TICKS = 54;
/** The last frame of the death row: the corpse, held while it fades. */
export const MAXX_CORPSE_FRAME = MAXX_DEATH_FRAMES - 1;

/** Ticks a one-shot row is held on each frame, at its authored duration. */
export function maxxTicksPerFrame(rowTicks: number, frames: number): number {
  return rowTicks / frames;
}
