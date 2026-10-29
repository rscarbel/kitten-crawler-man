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
  FOUNTAIN,
  TORCH,
  WELL,
  TABLE,
  BOOKSHELF,
  BED,
  BARREL,
  CHAIR,
  BARREL_SIDE,
  CRATE,
  PRISON_COVER,
  BRAZIER,
  SPRITE_BUILDING,
  RUINED_WALL,
  TENT_POLE,
  TOWN_WALL,
  FENCE,
  MODERN_DECORATION,
  WALKABLE_MODERN_DECORATION_VARIANTS,
  SAFE_ROOM_MEDICINE_CABINET,
  SAFE_ROOM_MENU_BOARD,
  SAFE_ROOM_HERB_RACK,
  SAFE_ROOM_BANNER,
  SAFE_ROOM_LANTERN,
  SAFE_ROOM_STOVE,
  SAFE_ROOM_TABLE,
  SAFE_ROOM_STOOL,
  SAFE_ROOM_LARDER,
  LAB_STATION_PROP_TILE_TYPES,
  LAB_STATION_COT,
  LAB_STATION_BARRICADE,
  LAB_STATION_JERRY_CAN,
  LAB_STATION_LANTERN,
  TILE_TYPE_COUNT,
  INTERIOR_COUNTER,
  INTERIOR_WALL,
  TRAINING_DUMMY,
  WEAPON_RACK,
  MUSTER_BOARD,
  MAP_TABLE,
  FLASH_WALL,
  PIGMENT_SHELF,
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
  TRASH_PILE,
  TRASH_TOWER,
  TRASH_BAG,
  GYM_RACK,
  GYM_SQUAT_RACK,
  GYM_CABLE_STACK,
  GYM_KETTLEBELL_RACK,
  POWER_LAB_TANK,
  POWER_LAB_CONSOLE,
  LAB_BENCH,
  LAB_SHELF,
  HOLLOW_WALL,
  HOLLOW_PROP_LOW,
  HOLLOW_PROP_TALL,
  HOLLOW_PALISADE,
  HOLLOW_GATE,
  ROCK_DEPOSIT,
  CIRCUS_STRUCTURE_TALL,
  CIRCUS_STRUCTURE_LOW,
  BONE_PILE,
  SLUMPED_SKELETON,
} from './tileTypes';
import {
  SERVICE_SIGHT_TRANSPARENT_TILE_TYPES,
  SERVICE_SOLID_TILE_TYPES,
} from './serviceLevelProps';
import { CELLAR_SIGHT_TRANSPARENT_TILE_TYPES, CELLAR_SOLID_TILE_TYPES } from './cellarProps';

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
  ROOF_THATCH,
  ROOF_SLATE,
  ROOF_RED,
  ROOF_GREEN,
  FOUNTAIN,
  TORCH,
  // A stone well is as solid as the fountain beside it: nothing needs the
  // player to stand on one — the murder quest's clue and the drink heal both
  // measure distance to the tile instead.
  WELL,
  TABLE,
  BOOKSHELF,
  BED,
  BARREL,
  CHAIR,
  BARREL_SIDE,
  CRATE,
  BRAZIER,
  SPRITE_BUILDING,
  RUINED_WALL,
  TENT_POLE,
  TOWN_WALL,
  FENCE,
  // The doctor's medicine cabinet and the safe room's furnishings. `SAFE_ROOM_RUG` is
  // deliberately absent — a runner is walkable ground decoration, not furniture.
  SAFE_ROOM_MEDICINE_CABINET,
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
  GRINDING_SLAB,
  // The floor-3 wilderness. `HIGHLAND_GRASS`, `SCREE`, `BARE_EARTH`, `BRIDGE`,
  // `WILDFLOWER_TUFT`, `PEBBLE_SCATTER` and `DEN_HOLLOW` are deliberately
  // absent — the first four are ground the player is meant to cross and the
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
  // Boss-room props. The walkable boss-room decals (`TRASH_RUBBLE`,
  // `GYM_TREADMILL_BELT`, `LAB_WEB`) are
  // deliberately absent: each is ground a fight is meant to cross.
  TRASH_PILE,
  TRASH_TOWER,
  TRASH_BAG,
  GYM_RACK,
  GYM_SQUAT_RACK,
  GYM_CABLE_STACK,
  GYM_KETTLEBELL_RACK,
  POWER_LAB_TANK,
  POWER_LAB_CONSOLE,
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
  // The circus grounds' structures. `CIRCUS_LOT` is deliberately absent — it is
  // the ground every circus fight is fought on.
  CIRCUS_STRUCTURE_TALL,
  CIRCUS_STRUCTURE_LOW,
  // The service level's furniture, anchors and the parts their anchors draw.
  // Its cable, paper and towel decals are absent: they are floor clutter.
  ...SERVICE_SOLID_TILE_TYPES,
  // The cellars' furniture. Its straw, candles and fungus are absent: each is
  // floor dressing a crawler walks through.
  ...CELLAR_SOLID_TILE_TYPES,
  // The dead: a heap of bones and a skeleton sitting against a wall. The walkable
  // scatter, `BONES`, is absent — it is floor dressing.
  BONE_PILE,
  SLUMPED_SKELETON,
  PRISON_COVER,
  ...LAB_STATION_PROP_TILE_TYPES,
];

/**
 * Solid tile types low enough to see and shoot over. A crawler crouched behind
 * a waist-high bench would otherwise be invisible to a boss's aim, and every
 * such prop in a boss room would become cover that makes the fight easier.
 */
const SIGHT_TRANSPARENT_TILE_TYPES: readonly number[] = [
  TRASH_BAG,
  GYM_RACK,
  GYM_KETTLEBELL_RACK,
  POWER_LAB_CONSOLE,
  LAB_BENCH,
  // A palisade segment and the gate are shoulder height; a crawler behind one
  // is still exposed. `HOLLOW_PROP_LOW` is the same idea for the village's own
  // low blocking props.
  HOLLOW_PALISADE,
  HOLLOW_GATE,
  HOLLOW_PROP_LOW,
  // An arch post is a pole a crawler is seen past, and a wagon is waist high.
  CIRCUS_STRUCTURE_LOW,
  // The service level's low furniture: a mop bucket, a desk, a gas bottle.
  ...SERVICE_SIGHT_TRANSPARENT_TILE_TYPES,
  // The cellars' low furniture: a cask, a table, a heap of rubble.
  ...CELLAR_SIGHT_TRANSPARENT_TILE_TYPES,
  // A knee-high heap of bones and a skeleton sitting on the floor.
  BONE_PILE,
  SLUMPED_SKELETON,
  // The field station's cot, barricade, jerry can and lantern are knee to waist high.
  LAB_STATION_COT,
  LAB_STATION_BARRICADE,
  LAB_STATION_JERRY_CAN,
  LAB_STATION_LANTERN,
];

/**
 * Solid tile types a lobbed bomb cannot arc over: masonry, building fabric,
 * rock faces and the grid's own border. Everything else that blocks a step —
 * furniture, crates, barrels, trees, palisades, props — is low or narrow
 * enough for a lob to clear, so it is left out on purpose.
 */
const LOB_BLOCKING_TILE_TYPES: readonly number[] = [
  FloorTypeValue.wall,
  VOID_TYPE,
  BUILDING_WALL,
  METAL_WALL,
  ROOF_THATCH,
  ROOF_SLATE,
  ROOF_RED,
  ROOF_GREEN,
  SPRITE_BUILDING,
  RUINED_WALL,
  TOWN_WALL,
  INTERIOR_WALL,
  CLIFF,
  GOBLIN_TENT,
  HOLLOW_WALL,
  CIRCUS_STRUCTURE_TALL,
];

const LOB_BLOCKING_BY_TILE_TYPE = ((): Uint8Array => {
  const table = new Uint8Array(TILE_TYPE_COUNT);
  for (const type of LOB_BLOCKING_TILE_TYPES) table[type] = 1;
  return table;
})();

/** Whether a tile's type is a wall or building a lobbed bomb comes down against. */
export function isLobBlockingTileType(tile: TileContent): boolean {
  return LOB_BLOCKING_BY_TILE_TYPE[tile.type] === 1;
}

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
