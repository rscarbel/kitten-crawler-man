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
  BROKEN_TABLE,
  BROKEN_CHAIR,
  BROKEN_BOOKSHELF,
  CRAWLER_SIGN,
  HOARD_PILE,
  HOARD_TOWER,
  HOARD_BAG,
  GYM_RACK,
  GYM_SQUAT_RACK,
  GYM_CABLE_STACK,
  KRAKAREN_TANK,
  KRAKAREN_CONSOLE,
  LAB_BENCH,
  LAB_SHELF,
  HOLLOW_WALL,
  HOLLOW_PROP_LOW,
  HOLLOW_PROP_TALL,
  HOLLOW_PALISADE,
  HOLLOW_GATE,
  ROCK_DEPOSIT,
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
  // load-bearing: a rock replaces the water tile type outright, so without it
  // the rock would be the one *swimmable* tile in a river everything else can
  // already cross.
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
  // A stone well is as solid as the fountain beside it: nothing needs the
  // player to stand on one — the murder quest's clue and the drink heal both
  // measure distance to the tile instead.
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
  // A town interior's plastered wall and its counter runs — the counters are
  // solid the same way `FloorTypeValue.wall` is, the type they were split out
  // of.
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
  // Broken furniture blocks exactly what the intact piece blocked. A wreck the
  // player could walk onto would put them inside the repair the moment it lands.
  BROKEN_TABLE,
  BROKEN_CHAIR,
  BROKEN_BOOKSHELF,
  CRAWLER_SIGN,
  // Boss-room props. The walkable boss-room decals (`HOARD_RUBBLE`,
  // `GYM_TREADMILL_BELT`, `KRAKAREN_WADE`, `LAB_WEB`, `ARENA_MUD`) are
  // deliberately absent: each is ground a fight is meant to cross.
  HOARD_PILE,
  HOARD_TOWER,
  HOARD_BAG,
  GYM_RACK,
  GYM_SQUAT_RACK,
  GYM_CABLE_STACK,
  KRAKAREN_TANK,
  KRAKAREN_CONSOLE,
  LAB_BENCH,
  LAB_SHELF,
  // Briar Hollow. `HOLLOW_GATE` is deliberately absent — it is walkable by
  // tile type, and a hostile mob is turned away by a runtime block flag
  // instead. `HOLLOW_PLANK_FLOOR`, `HOLLOW_THRESHOLD`, `HOLLOW_DECAL`,
  // `HOLLOW_PALISADE_GAP`, `PASTURE_GRASS` and `CROP_FIELD` are also absent —
  // every one of them is ground the player is meant to cross.
  HOLLOW_WALL,
  HOLLOW_PROP_LOW,
  HOLLOW_PROP_TALL,
  HOLLOW_PALISADE,
  ROCK_DEPOSIT,
];

/**
 * Solid tile types low enough to see and shoot over. A crawler crouched behind
 * a waist-high bench would otherwise be invisible to a boss's aim, and every
 * such prop in a boss room would become cover that makes the fight easier.
 */
const SIGHT_TRANSPARENT_TILE_TYPES: readonly number[] = [
  HOARD_BAG,
  GYM_RACK,
  KRAKAREN_CONSOLE,
  LAB_BENCH,
  // A palisade segment and the gate are shoulder height; a crawler behind one
  // is still exposed. `HOLLOW_PROP_LOW` is the same idea for the village's own
  // low blocking props.
  HOLLOW_PALISADE,
  HOLLOW_GATE,
  HOLLOW_PROP_LOW,
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

const SIGHT_TRANSPARENT_BY_TILE_TYPE = ((): Uint8Array => {
  const table = new Uint8Array(TILE_TYPE_COUNT);
  for (const type of SIGHT_TRANSPARENT_TILE_TYPES) table[type] = 1;
  return table;
})();

/**
 * Whether a solid tile's *type* still lets sight through. Only meaningful for a
 * tile that blocks movement: `GameMap.hasLineOfSight` asks it after a tile has
 * failed the walkability test.
 */
export function isSightTransparentTileType(tile: TileContent): boolean {
  return SIGHT_TRANSPARENT_BY_TILE_TYPE[tile.type] === 1;
}

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
