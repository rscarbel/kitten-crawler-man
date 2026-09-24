/**
 * Anything that puts damaging ground under the party's feet — the Hoarder's acid
 * puddles, the Evil Clown's gas clouds — and can therefore tell whatever steers
 * a body on the party's side (the AI companion, Mongo, the hirelings) which way
 * to run.
 *
 * A one-method interface rather than a base class because the implementers are
 * whole systems with nothing else in common, and because it is what lets
 * `CompanionSystem` stop naming `BossRoomSystem` specifically.
 */
export interface GroundHazardSource {
  /**
   * Unit vector pointing out of the nearest hazard containing (x, y), or null
   * when that point is safe. Coordinates are the entity's top-left world
   * position, matching `Player.x` / `Player.y`.
   */
  getHazardEscapeVector(x: number, y: number): { dx: number; dy: number } | null;
}

/** A unit direction out of marked ground, as a hazard source answers it. */
export type HazardEscape = NonNullable<ReturnType<GroundHazardSource['getHazardEscapeVector']>>;

/**
 * The way out that the first of `sources` to claim (x, y) gives, or null when
 * every one of them calls that point safe.
 */
export function hazardEscapeAmong(
  sources: readonly GroundHazardSource[],
  x: number,
  y: number,
): HazardEscape | null {
  for (const source of sources) {
    const escape = source.getHazardEscapeVector(x, y);
    if (escape !== null) return escape;
  }
  return null;
}

/** The four ways out of a wedge, for {@link stepAlongEscape}. */
const CARDINAL_DIRECTIONS = [
  { dx: 1, dy: 0 },
  { dx: -1, dy: 0 },
  { dx: 0, dy: 1 },
  { dx: 0, dy: -1 },
] as const;

/**
 * Steps a body `speed` pixels along `escape` through `move`, its own wall
 * collision, and returns whether it covered any ground.
 *
 * Being told to run and not moving is not a stalemate the next frame resolves;
 * it is permanent. A hazard source answers on tiles, while movement is a
 * collision box that can straddle two of them — and a shove out of a mob
 * ignores collision entirely, so a body can end up with part of its box inside
 * a wall. From there every move whose leading edge stays in the wall's column
 * is refused, including the one it is being told to make, and it stands in the
 * fire until something kills it. So when the step goes nowhere the four
 * cardinals are tried, in order of how well they match the order it was given,
 * so it leaves as near as the walls allow to the way it was sent. Only the
 * cardinals: a diagonal is what it already failed at, and both of its
 * components are among them.
 *
 * `awayOnly` is for running from a mob rather than from ground: any step with
 * no component away from it is a step towards it, and alternating one of those
 * with a step away is a body shaking on the spot in a corner.
 */
export function stepAlongEscape(
  body: { readonly x: number; readonly y: number },
  escape: HazardEscape,
  speed: number,
  move: (dx: number, dy: number) => void,
  awayOnly = false,
): boolean {
  const startX = body.x;
  const startY = body.y;
  move(escape.dx * speed, escape.dy * speed);
  if (body.x !== startX || body.y !== startY) return true;
  const alignment = (direction: HazardEscape): number =>
    direction.dx * escape.dx + direction.dy * escape.dy;
  const preferred = [...CARDINAL_DIRECTIONS].sort((a, b) => alignment(b) - alignment(a));
  for (const direction of preferred) {
    if (awayOnly && alignment(direction) <= 0) return false;
    move(direction.dx * speed, direction.dy * speed);
    if (body.x !== startX || body.y !== startY) return true;
  }
  return false;
}
