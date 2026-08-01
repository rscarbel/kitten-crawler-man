import {
  FloorTypeValue,
  type TileContent,
  VOID_TYPE,
  TREE,
  BUILDING_WALL,
  METAL_WALL,
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
  SPRITE_BUILDING,
  RUINED_WALL,
  TENT_POLE,
  BLEACHER,
  TOWN_WALL,
  FENCE,
  MODERN_DECORATION,
  WALKABLE_MODERN_DECORATION_VARIANTS,
  SAFE_ROOM_COUNTER,
  SAFE_ROOM_COUNTER_BACK,
  SAFE_ROOM_MENU_BOARD,
  SAFE_ROOM_HERB_RACK,
  SAFE_ROOM_BANNER,
  SAFE_ROOM_LANTERN,
  SAFE_ROOM_STOVE,
  SAFE_ROOM_TABLE,
  SAFE_ROOM_STOOL,
  SAFE_ROOM_LARDER,
  TILE_TYPE_COUNT,
  INTERIOR_COUNTER,
  INTERIOR_WALL,
} from './tileTypes';

/** Tile types that cannot be walked on. Everything not listed here is walkable. */
const NON_WALKABLE_TILE_TYPES: readonly number[] = [
  FloorTypeValue.wall,
  FloorTypeValue.water,
  VOID_TYPE,
  TREE,
  BUILDING_WALL,
  METAL_WALL,
  ROOF_THATCH,
  ROOF_SLATE,
  ROOF_RED,
  ROOF_GREEN,
  ROOF_CIRCUS_RED,
  ROOF_CIRCUS_BLUE,
  ROOF_CIRCUS_PURPLE,
  FOUNTAIN,
  TORCH,
  // A stone well is as solid as the fountain beside it. Its absence here was
  // pre-existing: both town wells were walkable and the player could stand
  // inside one. Every consumer that cares about a well — the murder quest's
  // clue and the drink heal — measures distance to the tile rather than
  // standing on it.
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
  SPRITE_BUILDING,
  RUINED_WALL,
  TENT_POLE,
  BLEACHER,
  TOWN_WALL,
  FENCE,
  SAFE_ROOM_COUNTER,
  SAFE_ROOM_COUNTER_BACK,
  // The safe room's furnishings. `SAFE_ROOM_RUG` is deliberately absent — a
  // runner is walkable ground decoration, not furniture.
  SAFE_ROOM_MENU_BOARD,
  SAFE_ROOM_HERB_RACK,
  SAFE_ROOM_BANNER,
  SAFE_ROOM_LANTERN,
  SAFE_ROOM_STOVE,
  SAFE_ROOM_TABLE,
  SAFE_ROOM_STOOL,
  SAFE_ROOM_LARDER,
  // A town interior's plastered wall and its counter runs. The counters were
  // `FloorTypeValue.wall` until they got a type of their own, so they were
  // already solid; this is what keeps them that way.
  INTERIOR_WALL,
  INTERIOR_COUNTER,
];

/**
 * Walkability by tile type as a flat lookup, so the innermost walkability test
 * is one array read rather than a chain of inequality checks.
 * MODERN_DECORATION is excluded — its walkability depends on the tile's variant.
 */
const WALKABLE_BY_TILE_TYPE = ((): Uint8Array => {
  const table = new Uint8Array(TILE_TYPE_COUNT).fill(1);
  for (const type of NON_WALKABLE_TILE_TYPES) table[type] = 0;
  return table;
})();

/**
 * Whether a tile's *type* permits walking, ignoring every runtime block bit
 * (placed props, locked arena doors, stairwell footprints).
 *
 * The single source of truth for type-level walkability: `GameMap.isWalkable`
 * layers its block mask over this, and the map validators run it on a bare grid
 * with no `GameMap` instance in play.
 */
export function isWalkableTileType(tile: TileContent): boolean {
  if (tile.type === MODERN_DECORATION) {
    return WALKABLE_MODERN_DECORATION_VARIANTS.has(tile.decorationVariant ?? 0);
  }
  return WALKABLE_BY_TILE_TYPE[tile.type] === 1;
}
