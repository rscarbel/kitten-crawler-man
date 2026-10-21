/**
 * Bodies so large they fill the air above their footprint as well as the
 * ground, so a flying mob cannot pass over them.
 *
 * A flyer is left out of ground separation on purpose — it crosses over an
 * ordinary mob's head — and separation is a soft push capped below a mob's own
 * walk step anyway, so a flyer heading straight at a body would out-fly it.
 * These bodies are therefore hard obstacles in the flyer's own step instead.
 *
 * The roster is published per frame by `MobUpdateLoop`, for the same reason as
 * {@link module:creatures/packAlert}: a mob has no reference to the world it
 * lives in.
 */

/** A body that blocks flight: a position and the radius it keeps clear. */
export interface AirspaceBody {
  readonly x: number;
  readonly y: number;
  readonly isAlive: boolean;
  readonly collisionRadiusPx: number;
}

/** A step, as the change it makes to a position. */
export interface Step {
  readonly dx: number;
  readonly dy: number;
}

/**
 * Sideways part of a step, as a share of its length, below which the step
 * counts as aimed dead at a body's centre and goes round the fixed way.
 */
const DEAD_CENTRE_SIDEWAYS_SHARE = 1e-6;

let bodies: readonly AirspaceBody[] = [];

/**
 * Publish this frame's airspace-filling bodies. Pass an empty list when tearing
 * a scene down so a stale roster can never block anything.
 */
export function setAirspaceBodies(published: readonly AirspaceBody[]): void {
  bodies = published;
}

/** Whether the point (top-left convention, like a mob's position) lies inside a living body. */
export function isInsideAirspaceBody(x: number, y: number): boolean {
  for (const body of bodies) {
    if (!body.isAlive) continue;
    const radius = body.collisionRadiusPx;
    const dx = x - body.x;
    const dy = y - body.y;
    if (dx * dx + dy * dy < radius * radius) return true;
  }
  return false;
}

/**
 * `step` for a flyer at (`x`, `y`), turned so it never carries the flyer into a
 * body: a step that would end inside one keeps its length but loses the part
 * aimed at the body's centre, so the flyer slides around the rim rather than
 * stopping against it. A step aimed dead at a centre has no sideways part left
 * and goes round one fixed way, so a flyer can never stall on the near side of
 * a body it is trying to get past. A step out of a body is never refused.
 */
export function deflectAroundAirspaceBodies(mover: object, x: number, y: number, step: Step): Step {
  let { dx, dy } = step;
  const length = Math.hypot(dx, dy);
  if (length === 0) return step;
  for (const body of bodies) {
    if (body === mover || !body.isAlive) continue;
    const radius = body.collisionRadiusPx;
    const awayX = x - body.x;
    const awayY = y - body.y;
    const nextAwayX = awayX + dx;
    const nextAwayY = awayY + dy;
    if (nextAwayX * nextAwayX + nextAwayY * nextAwayY >= radius * radius) continue;

    const awayLength = Math.hypot(awayX, awayY);
    const outwardX = awayLength === 0 ? 1 : awayX / awayLength;
    const outwardY = awayLength === 0 ? 0 : awayY / awayLength;
    const outwardShare = dx * outwardX + dy * outwardY;
    if (outwardShare >= 0) continue;

    // The side is read from the cross product and the step rebuilt exactly
    // along the rim: normalising a sideways remainder that is only rounding
    // noise would point it anywhere, including back into the body.
    const sidewaysShare = outwardX * dy - outwardY * dx;
    const aimedAtCentre = Math.abs(sidewaysShare) < length * DEAD_CENTRE_SIDEWAYS_SHARE;
    const side = aimedAtCentre || sidewaysShare > 0 ? 1 : -1;
    dx = -outwardY * length * side;
    dy = outwardX * length * side;
  }
  const unchanged = dx === step.dx && dy === step.dy;
  return unchanged ? step : { dx, dy };
}
