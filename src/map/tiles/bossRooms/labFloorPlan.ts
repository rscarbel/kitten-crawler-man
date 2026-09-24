import type { SpiderLabRoomData } from '../../DungeonGenerator';
import { doorFrame, type DoorFrame } from '../../spiderLabLayout';
import { tileCoordKey } from '../../tileIndex';
import type { TileContent } from '../../tileTypes';

/**
 * What the spider lab's floor painters need to know about the room they are
 * painting: where the egg sat, where the machines stand, which way is in, and
 * which of its webs have been torn down.
 *
 * Kept beside the grid rather than read from the quest, because the tile
 * painters are handed a grid and a position and nothing else — the same reason
 * `groundType` and `damageStage` ride on the tiles. A painter meeting a lab
 * floor on a grid with no plan paints plain vinyl, which is what a harness's
 * hand-built lab is.
 */
export interface SpiderLabFloorPlan {
  readonly room: SpiderLabRoomData;
  readonly frame: DoorFrame;
  /** Tile keys of the terminal's bench, with each tile's column and row in it. */
  readonly terminalSlices: ReadonlyMap<number, { col: number; row: number }>;
  /** Tile keys of every floor drain. */
  readonly drains: ReadonlySet<number>;
  /** Centre of the biohazard roundel, in tiles (a tile's centre is at +0.5). */
  readonly roundelCentre: { x: number; y: number };
  /**
   * Tiles whose web was cleared, and which paint the torn remains of it.
   * Mutable: the lab's dressing writes it as webs are cut and regrow, and marks
   * the tile dirty so the chunk bake repaints it.
   */
  readonly tornWebTiles: Set<number>;
}

const plans = new WeakMap<TileContent[][], SpiderLabFloorPlan>();

/** Drains in the doorway frame: two flanking the entrance aisle, two out in the fight. */
const DRAIN_SPOTS: ReadonlyArray<{ along: number; depth: number }> = [
  { along: -8, depth: 4 },
  { along: 8, depth: 4 },
  { along: -5, depth: 20 },
  { along: 6, depth: 23 },
];

/** Tiles from the egg toward the room's middle that the biohazard roundel is centred at. */
const ROUNDEL_OFFSET_FROM_EGG_TILES = 4;

/**
 * Records the lab's plan against its grid, once. Safe to call again for the
 * same grid: the first plan, and its torn webs, are kept.
 */
export function registerSpiderLabFloorPlan(
  grid: TileContent[][],
  room: SpiderLabRoomData,
): SpiderLabFloorPlan {
  const existing = plans.get(grid);
  if (existing !== undefined) return existing;
  const frame = doorFrame(room.bounds, room.entranceWall);

  const terminalSlices = new Map<number, { col: number; row: number }>();
  const minX = Math.min(...room.computerTableTiles.map((t) => t.x));
  const minY = Math.min(...room.computerTableTiles.map((t) => t.y));
  for (const tile of room.computerTableTiles) {
    terminalSlices.set(tileCoordKey(tile.x, tile.y), { col: tile.x - minX, row: tile.y - minY });
  }

  const drains = new Set<number>();
  for (const spot of DRAIN_SPOTS) {
    const tile = frame.toWorld(spot);
    drains.add(tileCoordKey(tile.x, tile.y));
  }

  const egg = frame.toFrame(room.spiderEggTile);
  const roundel = frame.toWorld({
    along: egg.along,
    depth: egg.depth - ROUNDEL_OFFSET_FROM_EGG_TILES,
  });
  const HALF = 0.5;
  const plan: SpiderLabFloorPlan = {
    room,
    frame,
    terminalSlices,
    drains,
    roundelCentre: { x: roundel.x + HALF, y: roundel.y + HALF },
    tornWebTiles: new Set(),
  };
  plans.set(grid, plan);
  return plan;
}

/** The lab plan recorded for a grid, or undefined for a grid with no generated lab. */
export function spiderLabFloorPlanFor(grid: TileContent[][]): SpiderLabFloorPlan | undefined {
  return plans.get(grid);
}
