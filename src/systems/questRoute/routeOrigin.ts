/**
 * Where a quest route starts from a body: the point its feet stand on, not
 * the top-left corner of the tile box its sprite is drawn in.
 *
 * A sprite's box hangs about half a tile above the tile its wall tests keep
 * it on, so a crawler standing just below a building has the top of its box
 * over the building's bottom row. A route walked from that corner starts
 * inside the building and leads out of it.
 */

import { TILE_SIZE } from '../../core/constants';
import { CENTER_COLLISION_OFFSET, SOLE_COLLISION_OFFSET } from '../../map/collisionAnchors';
import type { TilePoint } from '../../map/town/townPlan';

/**
 * A world-pixel point a body stands on. Tagged, because a tile coordinate has
 * the same `x`/`y` shape and would otherwise be accepted in its place.
 */
export interface GroundPoint {
  readonly unit: 'px';
  readonly x: number;
  readonly y: number;
}

/** Anything placed by the top-left of a one-tile sprite box, in world pixels. */
interface BoxPlaced {
  readonly x: number;
  readonly y: number;
}

/**
 * The world-pixel point a body stands on: the middle of its soles, the same
 * point a southward wall test is taken at.
 */
export function crawlerGroundPoint(body: BoxPlaced): GroundPoint {
  return {
    unit: 'px',
    x: body.x + TILE_SIZE * CENTER_COLLISION_OFFSET,
    y: body.y + TILE_SIZE * SOLE_COLLISION_OFFSET,
  };
}

/** Where the feet of a body standing squarely on `tile` are. */
export function groundPointOnTile(tile: TilePoint): GroundPoint {
  return crawlerGroundPoint({ x: tile.x * TILE_SIZE, y: tile.y * TILE_SIZE });
}

/**
 * The tiles a body with its feet at `ground` could be said to stand on, best
 * first: the tile under its soles, then the tile its centre is in. The
 * centre's tile is the one every wall test keeps open, so it stands in when
 * the soles have rounded into a wall's edge.
 */
export function standingTileCandidates(ground: GroundPoint): readonly [TilePoint, TilePoint] {
  const soleToCentrePx = TILE_SIZE * (SOLE_COLLISION_OFFSET - CENTER_COLLISION_OFFSET);
  const column = Math.floor(ground.x / TILE_SIZE);
  return [
    { x: column, y: Math.floor(ground.y / TILE_SIZE) },
    { x: column, y: Math.floor((ground.y - soleToCentrePx) / TILE_SIZE) },
  ];
}

/**
 * How far a crawler's painted figure rises above the top of its tile box, in
 * tiles: the head and shoulders are drawn over the tile north of the one it
 * stands on.
 */
const CRAWLER_SPRITE_HEADROOM_TILES = 0.75;

/** The world-pixel rectangle a crawler's painted figure covers, head included. */
export function crawlerSpriteBox(body: BoxPlaced): {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
} {
  const headroomPx = TILE_SIZE * CRAWLER_SPRITE_HEADROOM_TILES;
  return { x: body.x, y: body.y - headroomPx, width: TILE_SIZE, height: TILE_SIZE + headroomPx };
}
