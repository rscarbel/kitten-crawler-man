/**
 * The terrain an ambient spawn point stands in, so a spawn rule can ask for a
 * creature's natural ground: a bear at the edge of a wood, a lion out in the
 * open.
 *
 * Classified from tile counts rather than from `paintForests`' blob centres. A
 * blob is a disc on paper only: roads, solid tiles, the landmarks' keep-out and
 * ridge rock all bite into it, and its rim drops tiles at random, so a recorded
 * centre and radius would call a point a forest edge with no tree near it.
 * Counting the finished grid's `TREE` tiles also sees every tree no blob
 * planted.
 */

import { FloorTypeValue, HIGHLAND_GRASS, RUBBLE, SCREE, TREE } from '../tileTypes';
import type { TileGrid } from '../town/tileGrid';
import type { TilePoint } from '../town/townPlan';

/** Every terrain a spawn point can be classified as. A point may satisfy several, or none. */
export const SPAWN_TERRAINS = ['forest_edge', 'open_field'] as const;

export type SpawnTerrain = (typeof SPAWN_TERRAINS)[number];

/** A hallway spawn point together with the terrains it was classified as. */
export interface HallwaySpawnPoint extends TilePoint {
  readonly terrain: ReadonlySet<SpawnTerrain>;
}

/** The classification of a point that has none: every dungeon point, which no terrain rule may take. */
export const NO_SPAWN_TERRAIN: ReadonlySet<SpawnTerrain> = new Set();

/** How far from a point its trees are counted for {@link FOREST_EDGE_MIN_TREES}, in tiles. */
const FOREST_EDGE_RADIUS_TILES = 4;
/**
 * Trees within {@link FOREST_EDGE_RADIUS_TILES} that make a point a forest edge.
 * Enough that one riverbank tree or a felled wood's last stump does not count.
 */
const FOREST_EDGE_MIN_TREES = 6;
/**
 * The tree-free radius an open field needs, in tiles. Wider than
 * {@link FOREST_EDGE_RADIUS_TILES}, so no point is both a forest edge and an open
 * field.
 */
const OPEN_FIELD_TREE_CLEARANCE_TILES = 8;

/**
 * The three open, walkable surfaces the wilderness is made of.
 *
 * The elevation bands repaint a third of the map to `HIGHLAND_GRASS` or
 * `SCREE`, so the ruins and the ambient spawn scatter have to test for open
 * ground across all three surfaces rather than `=== grass` alone — a narrower
 * test would silently confine every ruin and every ghoul to the lowlands, and
 * the scatter's ~220 points would collapse with it, since a rejected attempt is
 * not retried.
 */
export function isOpenWildernessGround(type: number | undefined): boolean {
  return type === FloorTypeValue.grass || type === HIGHLAND_GRASS || type === SCREE;
}

function isGrass(type: number | undefined): boolean {
  return type === FloorTypeValue.grass || type === HIGHLAND_GRASS;
}

/** Whether (x, y) is a road or rubble tile, which no open field has underfoot. */
function isBrokenOrPavedGround(grid: TileGrid, x: number, y: number): boolean {
  const type = grid.typeAt(x, y);
  return type === FloorTypeValue.road || type === RUBBLE;
}

/**
 * The surface beneath whatever stands on (x, y): a wildflower clump or a
 * boulder stands on grass, and a field is still a field under them.
 */
function groundAt(grid: TileGrid, x: number, y: number): number | undefined {
  if (!grid.inBounds(x, y)) return undefined;
  const cell = grid.cells[y][x];
  return cell.groundType ?? cell.type;
}

function treesWithin(grid: TileGrid, x: number, y: number, radius: number): number {
  const radiusSq = radius * radius;
  let trees = 0;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy > radiusSq) continue;
      if (grid.typeAt(x + dx, y + dy) === TREE) trees++;
    }
  }
  return trees;
}

function satisfiesTerrain(grid: TileGrid, x: number, y: number, terrain: SpawnTerrain): boolean {
  switch (terrain) {
    case 'forest_edge':
      return (
        isOpenWildernessGround(groundAt(grid, x, y)) &&
        !isBrokenOrPavedGround(grid, x, y) &&
        treesWithin(grid, x, y, FOREST_EDGE_RADIUS_TILES) >= FOREST_EDGE_MIN_TREES
      );
    case 'open_field':
      return (
        isGrass(groundAt(grid, x, y)) &&
        !isBrokenOrPavedGround(grid, x, y) &&
        treesWithin(grid, x, y, OPEN_FIELD_TREE_CLEARANCE_TILES) === 0
      );
    default: {
      const unhandled: never = terrain;
      return unhandled;
    }
  }
}

/** Every terrain (x, y) satisfies on `grid`. A pure function of the grid. */
export function classifySpawnTerrain(
  grid: TileGrid,
  x: number,
  y: number,
): ReadonlySet<SpawnTerrain> {
  return new Set(SPAWN_TERRAINS.filter((terrain) => satisfiesTerrain(grid, x, y, terrain)));
}
