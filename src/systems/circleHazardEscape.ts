/**
 * The way out of a set of overlapping round hazard zones — lob landings,
 * charges on a fuse, burning sticks — for a `GroundHazardSource` whose ground
 * is circles.
 */

import { TILE_SIZE } from '../core/constants';
import type { GameMap } from '../map/GameMap';
import type { HazardEscape } from './GroundHazardSource';

/**
 * One circle of ground about to hurt. `radiusPx` is the hurt radius plus any
 * clearance a steering body should keep from it.
 */
export interface CircleHazardZone {
  readonly x: number;
  readonly y: number;
  readonly radiusPx: number;
}

/** Offset from a tile's origin to its centre, as a share of a tile. */
const TILE_CENTRE = 0.5;

/** Compass directions tried when the summed push out of overlapping zones leads nowhere. */
const ESCAPE_SEARCH_DIRECTIONS = 16;
const FULL_TURN_RADIANS = Math.PI * 2;

/**
 * Push, in pixels of depth, across the line through two zone centres below
 * which a body counts as standing on that line.
 */
const ON_CENTRE_LINE_PUSH_PX = 0.5;

/** Share of the deepest zone's depth below which the summed push counts as cancelled out. */
const CANCELLED_PUSH_FRACTION = 0.05;

/** Spacing, as a share of a tile, of the wall checks along a searched way out. */
const ESCAPE_WALL_CHECK_STEP_TILES = 0.25;

/**
 * How much shorter a searched way out must be to beat an earlier direction;
 * mirror-image directions differ only by rounding, and the earlier one wins.
 */
const EXIT_TIE_TOLERANCE_PX = 1e-6;

/**
 * Out of every zone containing the body whose top-left is (x, y), at once.
 * Each zone pushes outward from its own centre, harder the deeper the point
 * sits in it, so a body standing where two zones overlap is sent out of both,
 * never out of one and into the other. On the line through two zones' centres
 * that sum has no way out in it, so there the shortest walkable way out of
 * every zone is searched for instead — which also covers a corridor whose
 * walls rule out stepping sideways off that line.
 */
export function escapeFromCircleZones(
  gameMap: Pick<GameMap, 'isWalkable'>,
  zones: readonly CircleHazardZone[],
  x: number,
  y: number,
): HazardEscape | null {
  if (zones.length === 0) return null;
  const cx = x + TILE_SIZE * TILE_CENTRE;
  const cy = y + TILE_SIZE * TILE_CENTRE;
  let containing = 0;
  let deepest: CircleHazardZone | null = null;
  let deepestDepth = 0;
  let secondDeepest: CircleHazardZone | null = null;
  let secondDeepestDepth = 0;
  let pushX = 0;
  let pushY = 0;
  for (const zone of zones) {
    const offsetX = cx - zone.x;
    const offsetY = cy - zone.y;
    const distance = Math.hypot(offsetX, offsetY);
    const depth = zone.radiusPx - distance;
    if (depth <= 0) continue;
    containing++;
    if (depth > deepestDepth) {
      secondDeepest = deepest;
      secondDeepestDepth = deepestDepth;
      deepest = zone;
      deepestDepth = depth;
    } else if (depth > secondDeepestDepth) {
      secondDeepest = zone;
      secondDeepestDepth = depth;
    }
    // Dead centre has no outward direction of its own; the other zones, or
    // the fallback below, choose one.
    if (distance === 0) continue;
    pushX += (offsetX / distance) * depth;
    pushY += (offsetY / distance) * depth;
  }
  if (containing === 0) return null;
  const length = Math.hypot(pushX, pushY);
  const overlapPushIsNoWayOut =
    deepest !== null &&
    secondDeepest !== null &&
    (length < deepestDepth * CANCELLED_PUSH_FRACTION ||
      pushAcrossCentreLine(pushX, pushY, deepest, secondDeepest) < ON_CENTRE_LINE_PUSH_PX);
  if (overlapPushIsNoWayOut) {
    const searched = shortestWalkableExit(gameMap, cx, cy, zones);
    if (searched !== null) return searched;
  }
  if (length === 0) return { dx: 1, dy: 0 };
  return { dx: pushX / length, dy: pushY / length };
}

/**
 * The compass direction from (cx, cy) that leaves every zone soonest without
 * crossing a wall, or null when every one of them is walled. Lowest index
 * wins a tie, so a body standing exactly between two equal zones is sent the
 * same way every frame rather than whichever way rounding favours.
 */
function shortestWalkableExit(
  gameMap: Pick<GameMap, 'isWalkable'>,
  cx: number,
  cy: number,
  zones: readonly CircleHazardZone[],
): HazardEscape | null {
  let best: HazardEscape | null = null;
  let bestDistance = Infinity;
  for (let index = 0; index < ESCAPE_SEARCH_DIRECTIONS; index++) {
    const angle = (index / ESCAPE_SEARCH_DIRECTIONS) * FULL_TURN_RADIANS;
    const direction = { dx: Math.cos(angle), dy: Math.sin(angle) };
    const exitDistance = distanceOutOfZones(cx, cy, direction, zones);
    const isShorter = exitDistance < bestDistance - EXIT_TIE_TOLERANCE_PX;
    if (!isShorter || !rayIsWalkable(gameMap, cx, cy, direction, exitDistance)) continue;
    best = direction;
    bestDistance = exitDistance;
  }
  return best;
}

/** Whether every tile under the ray from (cx, cy) out to `distance` can be walked. */
function rayIsWalkable(
  gameMap: Pick<GameMap, 'isWalkable'>,
  cx: number,
  cy: number,
  direction: HazardEscape,
  distance: number,
): boolean {
  const stepPx = TILE_SIZE * ESCAPE_WALL_CHECK_STEP_TILES;
  for (
    let travelled = Math.min(stepPx, distance);
    ;
    travelled = Math.min(distance, travelled + stepPx)
  ) {
    const tileX = Math.floor((cx + direction.dx * travelled) / TILE_SIZE);
    const tileY = Math.floor((cy + direction.dy * travelled) / TILE_SIZE);
    if (!gameMap.isWalkable(tileX, tileY, 'walker')) return false;
    if (travelled >= distance) return true;
  }
}

/**
 * How hard the summed push out of two zones points across the line through
 * their centres. On that line both zones push along it, so their sum points
 * at the balance point between them rather than out: a body following it
 * slides there and shakes in place until both have gone off. Two zones on the
 * same spot have no line, and their shared outward push is a real way out.
 */
function pushAcrossCentreLine(
  pushX: number,
  pushY: number,
  first: CircleHazardZone,
  second: CircleHazardZone,
): number {
  const lineX = second.x - first.x;
  const lineY = second.y - first.y;
  const lineLength = Math.hypot(lineX, lineY);
  if (lineLength === 0) return Infinity;
  return Math.abs(pushX * lineY - pushY * lineX) / lineLength;
}

/**
 * How far from (cx, cy) along `direction` the ray leaves every zone. A ray
 * that has left a circle never re-enters it, so each zone can move the exit at
 * most once and the walk ends within one pass per zone.
 */
function distanceOutOfZones(
  cx: number,
  cy: number,
  direction: HazardEscape,
  zones: readonly CircleHazardZone[],
): number {
  let travelled = 0;
  for (let passesLeft = zones.length; passesLeft > 0; passesLeft--) {
    const x = cx + direction.dx * travelled;
    const y = cy + direction.dy * travelled;
    let furthest = travelled;
    for (const zone of zones) {
      const offsetX = x - zone.x;
      const offsetY = y - zone.y;
      if (Math.hypot(offsetX, offsetY) >= zone.radiusPx) continue;
      const along = offsetX * direction.dx + offsetY * direction.dy;
      const squaredMiss = offsetX * offsetX + offsetY * offsetY - along * along;
      const halfChord = Math.sqrt(Math.max(0, zone.radiusPx * zone.radiusPx - squaredMiss));
      furthest = Math.max(furthest, travelled - along + halfChord);
    }
    if (furthest === travelled) return travelled;
    travelled = furthest;
  }
  return travelled;
}
