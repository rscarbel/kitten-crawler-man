export const FLOOR_TYPES = [
  'grass',
  'road',
  'wall',
  'water',
  'concrete',
  'tile_floor',
  'carpet',
  'wood',
] as const;

/** Tile type for the outer border — renders as pure black and is not walkable. */
export const VOID_TYPE = 9;
/** Tile type for the Safe Room floor — warm sanctuary look. */
export const SAFE_ROOM_FLOOR = 10;
/** Tile type for the Boss Room floor — grimy, trash-covered look (TheHoarder). */
export const HORDER_BOSS_ROOM_FLOOR = 11;
/** Tile type for the Gym Boss Room floor — dark rubber mat look (Juicer). */
export const JUICER_BOSS_ROOM_FLOOR = 12;
/** Tile type for outdoor trees — renders as trunk + canopy, not walkable. */
export const TREE = 13;
/** Tile type for overworld building exteriors — lighter stone facade look. */
export const BUILDING_WALL = 14;
/** Tile type for thatched roofs — warm straw/golden cottage roofs. */
export const ROOF_THATCH = 15;
/** Tile type for slate roofs — blue-gray inn/tower roofs. */
export const ROOF_SLATE = 16;
/** Tile type for terracotta tile roofs — warm red shop roofs. */
export const ROOF_RED = 17;
/** Tile type for mossy green roofs — overgrown hut roofs. */
export const ROOF_GREEN = 18;
/** Tile type for a multi-tile fountain — animated water basin, not walkable. */
export const FOUNTAIN = 19;
/** Tile type for a torch — animated flame and smoke, not walkable (pole blocks movement). */
export const TORCH = 20;
/** Tile type for a stone well — classic town well with wooden crossbeam, not walkable. */
export const WELL = 21;
/** Tile type for a grassy weed decoration — walkable ground tile with grass tufts and flowers. */
export const GRASSY_WEED = 22;
/** Tile type for a dirt patch decoration — walkable road tile with pebbles and soil texture. */
export const DIRT_PATCH = 23;
/** Tile type for the metal arena exterior walls — dark riveted steel panels, not walkable. */
export const METAL_WALL = 24;
/** Tile type for the arena interior floor — dark steel grating, walkable combat surface. */
export const ARENA_FLOOR = 25;
/** Tile type for the Krakaren Clone boss room — dark wet cavern floor. */
export const KRAKAREN_BOSS_ROOM_FLOOR = 26;
/** Tile type for red & white striped circus tent roof — big top style, not walkable. */
export const ROOF_CIRCUS_RED = 27;
/** Tile type for blue & gold circus tent roof — smaller accent tents, not walkable. */
export const ROOF_CIRCUS_BLUE = 28;
/** Tile type for purple & yellow circus tent roof — smaller accent tents, not walkable. */
export const ROOF_CIRCUS_PURPLE = 29;
/** Tile type for interior stairs going up — walkable trigger tile. */
export const STAIRS_UP = 30;
/** Tile type for interior stairs going down — walkable trigger tile. */
export const STAIRS_DOWN = 31;
/** Tile type for a wooden table — not walkable. */
export const TABLE = 32;
/** Tile type for a bookshelf against a wall — not walkable. */
export const BOOKSHELF = 33;
/** Tile type for a bed — not walkable. */
export const BED = 34;
/** Tile type for a stone fireplace/hearth — not walkable. */
export const FIREPLACE = 35;
/** Tile type for a storage barrel — not walkable. */
export const BARREL = 36;
/** Tile type for a decorative rug — walkable. */
export const RUG = 37;
/** Tile type for a chair — not walkable. */
export const CHAIR = 38;
/** Tile type for a floor grate — walkable, metal grate enemies can spawn from. */
export const FLOOR_GRATE = 39;
/** Tile type for a barrel lying on its side — not walkable. */
export const BARREL_SIDE = 40;
/** Tile type for a wooden storage crate — not walkable. */
export const CRATE = 41;
/** Tile type for an iron floor brazier — animated flames, not walkable. */
export const BRAZIER = 42;
/** Tile type for a pile of bones — walkable, dungeon floor decoration. */
export const BONES = 43;
/** Tile type for the overworld main tower — single anchor tile that triggers the full sprite render, walkable. */
export const MAIN_TOWER = 44;
/**
 * Anchor tile for a sprite-based building (e.g. a village house PNG).
 * The tile carries a `spriteKey` that selects which image to render.
 */
export const SPRITE_BUILDING = 45;

/**
 * A modern-era prop from the shared sprite sheet (modern_decorations.png).
 * The tile carries a `decorationVariant` (row * 10 + col) that selects which
 * item to render. Some variants are walkable (floor clutter), others are not.
 */
export const MODERN_DECORATION = 46;

/** Tile type for the spider lab room floor — dark, web-covered laboratory tiles. */
export const SPIDER_LAB_FLOOR = 47;

/**
 * Variant indices (row * 10 + col) from the modern_decorations sprite sheet
 * that are walkable floor clutter — cables, rubble, flat debris, etc.
 * All other variants are non-walkable furniture/equipment.
 */
const WALKABLE_VARIANT_CABLE_PILE = 3;
const WALKABLE_VARIANT_CABLE_COIL = 4;
const WALKABLE_VARIANT_CABLE_BUNDLE = 5;
const WALKABLE_VARIANT_CHAIR_BASE = 13;
const WALKABLE_VARIANT_CABLE_PILE_2 = 18;
const WALKABLE_VARIANT_POWER_STRIP = 19;
const WALKABLE_VARIANT_CONCRETE_RUBBLE = 29;
const WALKABLE_VARIANT_OPEN_BOX = 36;
const WALKABLE_VARIANT_BROKEN_CONCRETE = 39;
const WALKABLE_VARIANT_PAPER_TRAY = 43;
const WALKABLE_VARIANT_NEWSPAPER_STACK = 44;
const WALKABLE_VARIANT_BOOK_STACK = 47;
const WALKABLE_VARIANT_CABLE_COIL_2 = 48;
const WALKABLE_VARIANT_WHITE_RUBBLE = 49;
const WALKABLE_VARIANT_BROKEN_TILE_PILE = 56;
const WALKABLE_VARIANT_ROCK_DEBRIS = 57;

export const WALKABLE_MODERN_DECORATION_VARIANTS = new Set([
  1,
  2,
  WALKABLE_VARIANT_CABLE_PILE,
  WALKABLE_VARIANT_CABLE_COIL,
  WALKABLE_VARIANT_CABLE_BUNDLE, // magazine stack, air vent, broken tiles, cable coil, cable bundle
  WALKABLE_VARIANT_CHAIR_BASE,
  WALKABLE_VARIANT_CABLE_PILE_2,
  WALKABLE_VARIANT_POWER_STRIP, // chair base, cable pile, power strip
  WALKABLE_VARIANT_CONCRETE_RUBBLE, // concrete rubble pile
  WALKABLE_VARIANT_OPEN_BOX,
  WALKABLE_VARIANT_BROKEN_CONCRETE, // open empty box, broken concrete chunks
  WALKABLE_VARIANT_PAPER_TRAY,
  WALKABLE_VARIANT_NEWSPAPER_STACK,
  WALKABLE_VARIANT_BOOK_STACK,
  WALKABLE_VARIANT_CABLE_COIL_2,
  WALKABLE_VARIANT_WHITE_RUBBLE, // paper tray, newspaper stack, book stack, cable coil, white rubble
  WALKABLE_VARIANT_BROKEN_TILE_PILE,
  WALKABLE_VARIANT_ROCK_DEBRIS, // broken tile pile, rock debris pile
]);

export type FloorTile = (typeof FLOOR_TYPES)[number];

export const FloorTypeValue = {
  grass: 0,
  road: 1,
  wall: 2,
  water: 4,
  concrete: 5,
  tile_floor: 6,
  carpet: 7,
  wood: 8,
} as const satisfies Record<FloorTile, number>;

export type TileContent = {
  tileId: string;
  type: number;
  /** Set on SPRITE_BUILDING tiles to select which PNG sprite to render. */
  spriteKey?: string;
  /** Set on MODERN_DECORATION tiles: row * 10 + col within modern_decorations.png. */
  decorationVariant?: number;
};
