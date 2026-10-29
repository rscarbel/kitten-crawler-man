/**
 * How a lit stick of dynamite slides across the floor once it is down: the
 * friction `DynamiteSystem` slows every stick by, and the two answers built on
 * it. A leaf, so a mob that kicks a stick can aim it without loading the
 * system that draws it.
 */

/** Share of its speed a sliding stick keeps each frame. */
export const DYN_FRICTION = 0.88;

/**
 * How far a stick launched at `speed` px/frame slides before it stops, on open
 * floor. Friction takes the same share of its speed every frame, so the
 * distance is a geometric series; the last sliver below the stop speed is
 * under a pixel and ignored.
 */
export function slideDistance(speed: number): number {
  return speed / (1 - DYN_FRICTION);
}

/** The launch speed that slides a stick `distance` px on open floor; the inverse of {@link slideDistance}. */
export function launchSpeedFor(distance: number): number {
  return distance * (1 - DYN_FRICTION);
}
