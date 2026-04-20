import {
  FloorTypeValue,
  TileContent,
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
  TABLE,
  BOOKSHELF,
  BED,
  FIREPLACE,
  BARREL,
  CHAIR,
} from '../tileTypes';

const CARDINAL_DIRS: [number, number][] = [
  [0, 1],
  [0, -1],
  [-1, 0],
  [1, 0],
];

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
  TORCH,
  WELL,
  TABLE,
  BOOKSHELF,
  BED,
  FIREPLACE,
  BARREL,
  CHAIR,
]);

/**
 * Infers the ground base colour for a decoration tile (TORCH, WELL, etc.) by
 * examining cardinal neighbours. Priority: road > safe-room cobblestone > grass.
 */
export function inferGroundColor(structure: TileContent[][], tx: number, ty: number): string {
  const dirs = CARDINAL_DIRS;
  let hasRoad = false;
  let hasSafe = false;
  let hasWood = false;
  let hasCarpet = false;
  let hasTileFloor = false;
  let hasConcrete = false;
  for (const [dx, dy] of dirs) {
    const n = structure[ty + dy]?.[tx + dx];
    if (!n) continue;
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
  const above = structure[ty - 1]?.[tx];
  if (above && SHADOW_TYPES.has(above.type)) {
    ctx.fillStyle = 'rgba(0,0,0,0.40)';
    ctx.fillRect(sx, sy, ts, 8);
  }
  const left = structure[ty]?.[tx - 1];
  if (left && SHADOW_TYPES.has(left.type)) {
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.fillRect(sx, sy, 6, ts);
  }
}
