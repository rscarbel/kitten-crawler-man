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
