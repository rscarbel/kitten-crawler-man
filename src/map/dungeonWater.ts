/**
 * Standing water on a dungeon floor.
 *
 * It is the river's model, reused: a `FloorTypeValue.water` tile with a
 * `waterDepth`, so wading, its slowdown, the waterline clip, the splashes and
 * the wading loop all follow from `GameMap.isWadeable` with nothing of their
 * own. What makes it dungeon water is `drainsTo`, the tile as it was before it
 * flooded: the floor drawn under the water, and what draining puts back.
 */

import { FloorTypeValue, isDungeonWater, MAX_WATER_DEPTH, type TileContent } from './tileTypes';
import { isWalkableTileType } from './walkability';

/** The shallowest depth a flooded tile may hold; anything less is dry floor. */
export const MIN_DUNGEON_WATER_DEPTH = 1;

function assertWaterDepth(depth: number): void {
  const isWholeDepthInRange =
    Number.isInteger(depth) && depth >= MIN_DUNGEON_WATER_DEPTH && depth <= MAX_WATER_DEPTH;
  if (!isWholeDepthInRange) {
    throw new Error(
      `dungeon water depth must be a whole number from ${MIN_DUNGEON_WATER_DEPTH} to ${MAX_WATER_DEPTH}, got ${depth}`,
    );
  }
}

/**
 * Floods a carved dungeon floor tile to `depth` (1..`MAX_WATER_DEPTH`).
 *
 * Already-flooded water just takes the new depth. The floor's own `groundType`
 * becomes the bed drawn under the water when it has one (a boss room's floor
 * names the material it is laid in that way); otherwise the floor type itself
 * does.
 *
 * Throws on a tile nobody could walk on: water poured over a wall or a prop
 * would replace it, and draining would then bring back something that had
 * already been lost.
 */
export function floodDungeonTile(cell: TileContent, depth: number): void {
  assertWaterDepth(depth);
  if (isDungeonWater(cell)) {
    cell.waterDepth = depth;
    return;
  }
  if (cell.type === FloorTypeValue.water || !isWalkableTileType(cell, 'walker')) {
    throw new Error(`cannot flood tile ${cell.tileId}: it is not dry walkable floor`);
  }
  cell.drainsTo = { type: cell.type, groundType: cell.groundType };
  cell.groundType = cell.groundType ?? cell.type;
  cell.type = FloorTypeValue.water;
  cell.waterDepth = depth;
}

/** Puts a flooded tile back exactly as it was before it flooded. A no-op on anything else. */
export function drainDungeonTile(cell: TileContent): void {
  const dry = cell.drainsTo;
  if (cell.type !== FloorTypeValue.water || dry === undefined) return;
  cell.type = dry.type;
  if (dry.groundType === undefined) delete cell.groundType;
  else cell.groundType = dry.groundType;
  delete cell.drainsTo;
  delete cell.waterDepth;
}

/** The depth of standing water on a dungeon tile, 0 when dry. */
export function dungeonWaterDepth(cell: TileContent): number {
  return isDungeonWater(cell) ? (cell.waterDepth ?? MIN_DUNGEON_WATER_DEPTH) : 0;
}
