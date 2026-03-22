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
};
