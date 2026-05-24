import type { TileContent } from '../tileTypes';
import {
  FloorTypeValue,
  VOID_TYPE,
  SAFE_ROOM_FLOOR,
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

// Only architectural solids cast the wall-shadow strip on adjacent floor tiles.
// Furniture and decorations (TORCH, BARREL, TABLE …) are excluded intentionally
// to avoid ugly rectangular gray bands next to them.
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
  FOUNTAIN,
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
]);

/**
 * Infers the tile type of the floor beneath a decoration (TORCH, WELL, BARREL, etc.)
 * by scanning cardinal neighbours for the first non-wall, non-decoration tile.
 * Maps walkable decorations (GRASSY_WEED, DIRT_PATCH) to their underlying floor type.
 * Falls back to FloorTypeValue.concrete (dungeon floor) when no floor neighbour is found.
 */
export function inferFloorType(structure: TileContent[][], tx: number, ty: number): number {
  for (const [dx, dy] of CARDINAL_DIRS) {
    const ny = ty + dy;
    const nx = tx + dx;
    if (ny < 0 || ny >= structure.length) continue;
    const row = structure[ny];
    if (nx < 0 || nx >= row.length) continue;
    const t = row[nx].type;
    if (NON_FLOOR_TYPES.has(t)) continue;
    if (t === GRASSY_WEED) return FloorTypeValue.grass;
    if (t === DIRT_PATCH) return FloorTypeValue.road;
    return t;
  }
  // Diagonal fallback: handles tiles surrounded by other decorations (e.g. dense forest center)
  for (const [dx, dy] of DIAGONAL_DIRS) {
    const ny = ty + dy;
    const nx = tx + dx;
    if (ny < 0 || ny >= structure.length) continue;
    const row = structure[ny];
    if (nx < 0 || nx >= row.length) continue;
    const t = row[nx].type;
    if (NON_FLOOR_TYPES.has(t)) continue;
    if (t === GRASSY_WEED) return FloorTypeValue.grass;
    if (t === DIRT_PATCH) return FloorTypeValue.road;
    return t;
  }
  return FloorTypeValue.concrete;
}

// Keep for any callers that haven't been migrated yet.
export function inferGroundColor(structure: TileContent[][], tx: number, ty: number): string {
  const dirs = CARDINAL_DIRS;
  let hasRoad = false;
  let hasSafe = false;
  let hasWood = false;
  let hasCarpet = false;
  let hasTileFloor = false;
  let hasConcrete = false;
  for (const [dx, dy] of dirs) {
    const ny = ty + dy;
    const nx = tx + dx;
    if (ny < 0 || ny >= structure.length || nx < 0 || nx >= structure[ny].length) continue;
    const n = structure[ny][nx];
    if (n.type === FloorTypeValue.road || n.type === DIRT_PATCH) hasRoad = true;
    else if (n.type === SAFE_ROOM_FLOOR) hasSafe = true;
    else if (n.type === FloorTypeValue.wood) hasWood = true;
    else if (n.type === FloorTypeValue.carpet) hasCarpet = true;
    else if (n.type === FloorTypeValue.tile_floor) hasTileFloor = true;
    else if (n.type === FloorTypeValue.concrete) hasConcrete = true;
  }
  if (hasWood) return (tx + ty) % 2 === 0 ? '#b08050' : '#a07040';
  if (hasCarpet) return (tx + ty) % 2 === 0 ? '#8b3a3a' : '#7a3232';
  if (hasTileFloor) return '#c8bca0';
  if (hasConcrete) return (tx + ty) % 2 === 0 ? '#b4b0ab' : '#aaa7a2';
  if (hasRoad) return '#bc926b';
  if (hasSafe) return (tx + ty) % 2 === 0 ? '#f0e4c8' : '#e8d8b8';
  return '#6de89d';
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
