/**
 * Being drunk. A tavern round applies the `drunk` status (see `makeDrunk`), and
 * everything the player feels from it lives here so the camera, the movement step
 * and combat all read the same tuning.
 *
 * It is deliberately a mixed bag rather than a pure debuff: the world tilts and
 * your feet wander, but liquid courage puts a little extra behind every swing.
 */

/** Peak camera drift, in screen pixels. Small enough to read as a sway, not a shove. */
const SWAY_AMPLITUDE_PX = 6;
/**
 * Horizontal and vertical sway run at different, non-harmonic rates so the camera
 * traces a slow wandering loop instead of a rigid diagonal.
 */
const SWAY_X_HZ = 0.31;
const SWAY_Y_HZ = 0.19;
/** Vertical sway is shallower — a horizontal list reads as tipsy, a vertical one as seasick. */
const SWAY_Y_SCALE = 0.55;

/** Widest angle (radians) the walk veers off the direction actually pressed. */
const WALK_WOBBLE_MAX_RADIANS = 0.28;
/** How fast the veer swings side to side. */
const WALK_WOBBLE_HZ = 0.44;

/** Extra melee damage while drunk — the liquid-courage upside. */
export const DRUNK_MELEE_DAMAGE_BONUS = 2;

const TAU = Math.PI * 2;

/** Camera offset (screen pixels) for a drunk player at `elapsedSeconds`. */
export function drunkCameraOffset(elapsedSeconds: number): { x: number; y: number } {
  return {
    x: Math.sin(TAU * SWAY_X_HZ * elapsedSeconds) * SWAY_AMPLITUDE_PX,
    y: Math.sin(TAU * SWAY_Y_HZ * elapsedSeconds) * SWAY_AMPLITUDE_PX * SWAY_Y_SCALE,
  };
}

/**
 * Veer a movement vector off course by a slowly oscillating angle. Rotating the
 * whole vector (rather than adding a sideways nudge) keeps the walk speed intact
 * and makes the facing direction wander with it.
 */
export function applyDrunkWalkWobble(
  dx: number,
  dy: number,
  elapsedSeconds: number,
): { dx: number; dy: number } {
  if (dx === 0 && dy === 0) return { dx, dy };
  const angle = Math.sin(TAU * WALK_WOBBLE_HZ * elapsedSeconds) * WALK_WOBBLE_MAX_RADIANS;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return { dx: dx * cos - dy * sin, dy: dx * sin + dy * cos };
}
