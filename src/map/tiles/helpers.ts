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
  FENCE,
  GARDEN_PLANTING,
  GRASSY_WEED,
  VERGE_GRASS,
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
  SAFE_ROOM_COUNTER,
  SAFE_ROOM_COUNTER_BACK,
  SAFE_ROOM_GALLEY_FLOOR,
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
  // Defence in depth rather than a live branch: every fence is written with
  // `setStanding`, so `floorTypeAt` answers from its recorded ground and returns
  // before this set is consulted. A fence written with a plain `set` would also
  // have had its record cleared, so this only catches a fence that arrived by
  // some third route — at which point "not floor" is the right answer.
  FENCE,
  // The galley strip is the Bopca's own hearth paving, one tile wide and sealed
  // behind the counter. Nothing outside it should ever inherit that material, so
  // it reads as "not floor" to a neighbour's probe.
  SAFE_ROOM_COUNTER,
  SAFE_ROOM_COUNTER_BACK,
  SAFE_ROOM_GALLEY_FLOOR,
]);

/**
 * Resolves the floor type at (tx, ty), or undefined when the tile is off-map or
 * is itself a wall/decoration rather than ground.
 */
function floorTypeAt(structure: TileContent[][], tx: number, ty: number): number | undefined {
  if (ty < 0 || ty >= structure.length) return undefined;
  const row = structure[ty];
  if (tx < 0 || tx >= row.length) return undefined;
  // A prop that recorded the surface it replaced *is* a floor answer, and a good
  // one: a probe reaching a fence and skipping past it throws away the only tile
  // nearby that knows what the ground is.
  const recorded = row[tx].groundType;
  if (recorded !== undefined) return recorded;
  const t = row[tx].type;
  if (NON_FLOOR_TYPES.has(t)) return undefined;
  if (t === GRASSY_WEED || t === RUBBLE) return FloorTypeValue.grass;
  if (t === DIRT_PATCH) return FloorTypeValue.road;
  // Planting is a decoration drawn over the town's soft ground, exactly as the
  // two above are over field grass and packed earth.
  if (t === GARDEN_PLANTING) return VERGE_GRASS;
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
  // A prop that recorded the surface it replaced does not need inferring, and
  // must not be: the probe below takes the first cardinal it finds, starting
  // south, so a prop on a region's south edge would take the floor outside it.
  const recorded = structure[ty]?.[tx]?.groundType;
  if (recorded !== undefined) return recorded;
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
