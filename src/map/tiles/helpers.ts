import type { TileContent } from '../tileTypes';
import {
  FloorTypeValue,
  VOID_TYPE,
  BUILDING_WALL,
  METAL_WALL,
  TREE,
  ROOF_THATCH,
  ROOF_SLATE,
  ROOF_RED,
  ROOF_GREEN,
  ROOF_CIRCUS_RED,
  ROOF_CIRCUS_BLUE,
  ROOF_CIRCUS_PURPLE,
  FOUNTAIN,
  TORCH,
  WELL,
  DIRT_PATCH,
  GRASSY_WEED,
  TABLE,
  BOOKSHELF,
  BED,
  FIREPLACE,
  BARREL,
  CHAIR,
  BARREL_SIDE,
  CRATE,
  BRAZIER,
  BONES,
  SPRITE_BUILDING,
  MODERN_DECORATION,
  RUINED_WALL,
  RUBBLE,
  TOWN_WALL,
} from '../tileTypes';

const CARDINAL_DIRS: [number, number][] = [
  [0, 1],
  [0, -1],
  [-1, 0],
  [1, 0],
];

const DIAGONAL_DIRS: [number, number][] = [
  [1, 1],
  [-1, 1],
  [1, -1],
  [-1, -1],
];

/**
 * Widest ring searched by inferFloorType before it gives up. A 3×3 decoration
 * blob (the town fountain) encloses its own centre in all eight directions, so
 * the search has to reach past the diagonals to find real ground.
 */
const FLOOR_SEARCH_MAX_RADIUS = 3;

// Only architectural solids cast the wall-shadow strip on adjacent floor tiles.
// Furniture and decorations (TORCH, BARREL, TABLE …) are excluded intentionally
// to avoid ugly rectangular gray bands next to them. FOUNTAIN is excluded for
// the same reason — it is round, and carries its own soft elliptical contact
// shadow inside its sprite.
const SHADOW_TYPES = new Set([
  FloorTypeValue.wall,
  BUILDING_WALL,
  METAL_WALL,
  TREE,
  ROOF_THATCH,
  ROOF_SLATE,
  ROOF_RED,
  ROOF_GREEN,
  ROOF_CIRCUS_RED,
  ROOF_CIRCUS_BLUE,
  ROOF_CIRCUS_PURPLE,
  RUINED_WALL,
  TOWN_WALL,
]);

// Full set of non-floor tile types used when scanning neighbours for inferFloorType.
// Includes all opaque decorations even though they no longer cast wall shadows.
const NON_FLOOR_TYPES = new Set<number>([
  VOID_TYPE,
  FloorTypeValue.wall,
  BUILDING_WALL,
  METAL_WALL,
  TREE,
  ROOF_THATCH,
  ROOF_SLATE,
  ROOF_RED,
  ROOF_GREEN,
  ROOF_CIRCUS_RED,
  ROOF_CIRCUS_BLUE,
  ROOF_CIRCUS_PURPLE,
  FOUNTAIN,
  TORCH,
  WELL,
  TABLE,
  BOOKSHELF,
  BED,
  FIREPLACE,
  BARREL,
  CHAIR,
  BARREL_SIDE,
  CRATE,
  BRAZIER,
  BONES,
  SPRITE_BUILDING,
  MODERN_DECORATION,
  RUINED_WALL,
  TOWN_WALL,
]);

/**
 * Resolves the floor type at (tx, ty), or undefined when the tile is off-map or
 * is itself a wall/decoration rather than ground.
 */
function floorTypeAt(structure: TileContent[][], tx: number, ty: number): number | undefined {
  if (ty < 0 || ty >= structure.length) return undefined;
  const row = structure[ty];
  if (tx < 0 || tx >= row.length) return undefined;
  const t = row[tx].type;
  if (NON_FLOOR_TYPES.has(t)) return undefined;
  if (t === GRASSY_WEED || t === RUBBLE) return FloorTypeValue.grass;
  if (t === DIRT_PATCH) return FloorTypeValue.road;
  return t;
}

/**
 * Infers the tile type of the floor beneath a decoration (TORCH, WELL, BARREL, etc.)
 * by scanning outward for the first non-wall, non-decoration tile: cardinals
 * first, then diagonals, then whole rings out to FLOOR_SEARCH_MAX_RADIUS.
 * Maps walkable decorations (GRASSY_WEED, DIRT_PATCH) to their underlying floor type.
 * Falls back to FloorTypeValue.concrete (dungeon floor) when no floor tile is found.
 */
export function inferFloorType(structure: TileContent[][], tx: number, ty: number): number {
  for (const [dx, dy] of CARDINAL_DIRS) {
    const found = floorTypeAt(structure, tx + dx, ty + dy);
    if (found !== undefined) return found;
  }
  // Diagonal fallback: handles tiles surrounded by other decorations (e.g. dense forest center)
  for (const [dx, dy] of DIAGONAL_DIRS) {
    const found = floorTypeAt(structure, tx + dx, ty + dy);
    if (found !== undefined) return found;
  }
  // Ring fallback: a decoration blob wider than 3×3 hides its interior from both
  // passes above, which would otherwise paint dungeon concrete under a town prop.
  for (let radius = 2; radius <= FLOOR_SEARCH_MAX_RADIUS; radius++) {
    for (let offset = -radius; offset <= radius; offset++) {
      const atRingCorner = Math.abs(offset) === radius;
      const candidates: [number, number][] = atRingCorner
        ? [
            [offset, -radius],
            [offset, radius],
          ]
        : [
            [offset, -radius],
            [offset, radius],
            [-radius, offset],
            [radius, offset],
          ];
      for (const [dx, dy] of candidates) {
        const found = floorTypeAt(structure, tx + dx, ty + dy);
        if (found !== undefined) return found;
      }
    }
  }
  return FloorTypeValue.concrete;
}

const SHADOW_TOP_DEPTH = 8;
const SHADOW_SIDE_DEPTH = 6;

/** Draws a shadow strip on floor tiles directly below or right of a wall/building/tree. */
export function drawWallShadow(
  ctx: CanvasRenderingContext2D,
  structure: TileContent[][],
  sx: number,
  sy: number,
  ts: number,
  tx: number,
  ty: number,
) {
  if (ty > 0 && SHADOW_TYPES.has(structure[ty - 1][tx].type)) {
    ctx.fillStyle = 'rgba(0,0,0,0.40)';
    ctx.fillRect(sx, sy, ts, SHADOW_TOP_DEPTH);
  }
  if (tx > 0 && SHADOW_TYPES.has(structure[ty][tx - 1].type)) {
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.fillRect(sx, sy, SHADOW_SIDE_DEPTH, ts);
  }
}
