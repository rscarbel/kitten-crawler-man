import {
  FloorTypeValue,
  type TileContent,
  VOID_TYPE,
  TREE,
  BUILDING_WALL,
  METAL_WALL,
  ARENA_CAGE,
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
  TRAINING_DUMMY,
  WEAPON_RACK,
  MUSTER_BOARD,
  MAP_TABLE,
  FLASH_WALL,
  PIGMENT_SHELF,
  INK_BENCH,
  GRINDING_SLAB,
  RIVER_ROCK,
  BOULDER_SMALL,
  BOULDER_LARGE,
  CLIFF,
  CAMPFIRE,
  GOBLIN_TENT,
} from './tileTypes';

/** Tile types that cannot be walked on. Everything not listed here is walkable. */
const NON_WALKABLE_TILE_TYPES: readonly number[] = [
  FloorTypeValue.wall,
  // `FloorTypeValue.water` is deliberately absent: river water is **walkable**,
  // and everything that walks — the player, the companion and the mobs — wades
  // through it slowly and partly submerged. `moveWithCollision` and
  // `applyMovement` apply the speed penalty; `RenderPipeline` sinks the sprite.
  //
  // `RIVER_ROCK` below is what keeps a midstream stone solid, and that entry is
  // now load-bearing rather than belt-and-braces: a rock replaces the water tile
  // type outright, so without it the rock would be the one *swimmable* tile in a
  // river everything else can already cross.
  VOID_TYPE,
  TREE,
  BUILDING_WALL,
  METAL_WALL,
  ARENA_CAGE,
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
  // The garrison's and the inking shop's furniture. `DRILL_SAND_FLOOR` is
  // deliberately absent — a drill hall's raked sand is ground the player is
  // meant to cross, and it is the one member of that set that is a floor.
  TRAINING_DUMMY,
  WEAPON_RACK,
  MUSTER_BOARD,
  MAP_TABLE,
  FLASH_WALL,
  PIGMENT_SHELF,
  INK_BENCH,
  GRINDING_SLAB,
  // The floor-3 wilderness. `HIGHLAND_GRASS`, `SCREE`, `BRIDGE`,
  // `WILDFLOWER_TUFT`, `PEBBLE_SCATTER` and `DEN_HOLLOW` are deliberately
  // absent — the first three are ground the player is meant to cross and the
  // last three are flat cover drawn on top of it.
  //
  // `RIVER_ROCK` replaces the water tile it stands in rather than sitting on
  // one, so listing it is not redundant: walkability is decided by type, and
  // without this entry a mid-channel rock would be the one walkable pixel in a
  // river.
  RIVER_ROCK,
  BOULDER_SMALL,
  BOULDER_LARGE,
  CLIFF,
  CAMPFIRE,
  GOBLIN_TENT,
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
