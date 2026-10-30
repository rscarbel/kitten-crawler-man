/**
 * Cutting a tile-by-tile walk into a few straight runs, each one walkable end
 * to end and never far off the walk it stands for: the way a guide hands out
 * waypoints a party can walk straight at.
 */

import type { MobilityClass } from '../../map/mobility';
import { TILE_SIZE } from '../../core/constants';
import type { GameMap } from '../../map/GameMap';
import type { TilePoint } from '../../map/town/townPlan';

const TILE_CENTRE = 0.5;

function tileCentrePx(tile: TilePoint): { readonly x: number; readonly y: number } {
  return { x: (tile.x + TILE_CENTRE) * TILE_SIZE, y: (tile.y + TILE_CENTRE) * TILE_SIZE };
}

/** Whether a body could walk straight from `from` to `to`: `hasWalkableLine`, centre to centre. */
export function isStraightWalk(
  gameMap: GameMap,
  from: TilePoint,
  to: TilePoint,
  mobility: MobilityClass,
): boolean {
  const a = tileCentrePx(from);
  const b = tileCentrePx(to);
  return gameMap.hasWalkableLine(a.x, a.y, b.x, b.y, mobility);
}

/** Distance in tiles from `point` to the segment `a`–`b`. */
function distanceToSegment(point: TilePoint, a: TilePoint, b: TilePoint): number {
  const abX = b.x - a.x;
  const abY = b.y - a.y;
  const lengthSq = abX * abX + abY * abY;
  const along =
    lengthSq === 0
      ? 0
      : Math.max(0, Math.min(1, ((point.x - a.x) * abX + (point.y - a.y) * abY) / lengthSq));
  return Math.hypot(point.x - (a.x + abX * along), point.y - (a.y + abY * along));
}

/** How far apart the ends of one straight run may stand, and how far the walk may bend away from it. */
export interface StraightSegmentLimits {
  readonly maxSpacingTiles: number;
  readonly maxDeviationTiles: number;
}

/**
 * Whether the straight line from `walk[from]` to `walk[to]` stands for the
 * walk between them: short enough, walkable end to end, and never more than
 * the deviation limit off the walk it replaces.
 */
function lineFollowsWalk(
  gameMap: GameMap,
  walk: readonly TilePoint[],
  from: number,
  to: number,
  limits: StraightSegmentLimits,
  mobility: MobilityClass,
): boolean {
  const a = walk[from];
  const b = walk[to];
  if (Math.hypot(b.x - a.x, b.y - a.y) > limits.maxSpacingTiles) return false;
  for (let index = from + 1; index < to; index++) {
    if (distanceToSegment(walk[index], a, b) > limits.maxDeviationTiles) return false;
  }
  return isStraightWalk(gameMap, a, b, mobility);
}

/**
 * The indices into `walk` where each straight run ends: from each end, the
 * furthest tile further along that the straight line still stands for the
 * walk. The walk's last index is always the last end; the first index is
 * never listed, since every run starts where the one before it ended.
 */
export function straightSegments(
  gameMap: GameMap,
  walk: readonly TilePoint[],
  limits: StraightSegmentLimits,
  mobility: MobilityClass,
): readonly number[] {
  const ends: number[] = [];
  const last = walk.length - 1;
  let anchor = 0;
  while (anchor < last) {
    let reach = anchor + 1;
    while (reach < last && lineFollowsWalk(gameMap, walk, anchor, reach + 1, limits, mobility))
      reach++;
    ends.push(reach);
    anchor = reach;
  }
  return ends;
}
