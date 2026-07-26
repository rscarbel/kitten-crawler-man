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

/** Tile type for a ruined city wall fragment — jagged broken stone, not walkable. */
export const RUINED_WALL = 48;
/** Tile type for scattered rubble — walkable ground decoration in the ruined-city zone. */
export const RUBBLE = 49;
/** Tile type for the big top interior floor — packed sawdust, walkable. */
export const SAWDUST_FLOOR = 50;
/** Tile type for the painted circus ring border — walkable sawdust with a red ring stripe. */
export const CIRCUS_RING_EDGE = 51;
/** Tile type for the big top's central tent pole — not walkable. */
export const TENT_POLE = 52;
/** Tile type for wooden bleacher benches along the big top walls — not walkable. */
export const BLEACHER = 53;
/** Tile type for the Desperado Club interior floor — dark, polished art-deco stone, walkable. */
export const CLUB_FLOOR = 54;
/** Tile type for the club's central dance floor — dark reflective panels lit by pulsing overlay lights, walkable. */
export const DANCE_FLOOR = 55;

// The town's outdoor surfaces, one tile type per ground material.
//
// `groundMaterialForTileType` maps each of these to a row of the generated
// `ground_overworld` sheet, so the material a street is paved in is a property of
// the map rather than of the renderer. `FloorTypeValue.road` stays the generic
// packed-earth surface — alleys inside the walls, and every track outside them —
// so there is no separate alley type.

/** Tile type for the town's wall ring — coursed stone rampart, not walkable. */
export const TOWN_WALL = 56;
/** Tile type for a street verge — grass invaded by stone and weeds, walkable. */
export const VERGE_GRASS = 57;
/** Tile type for a workyard or gate apron — loose gravel chip, walkable. */
export const YARD_GRAVEL = 58;
/** Tile type for a side lane or building frontage — small mixed setts, walkable. */
export const LANE_STREET = 59;
/** Tile type for a main street — rounded cobble setts with cart ruts, walkable. */
export const COBBLE_STREET = 60;
/** Tile type for the market plaza and civic terrace — large cut flagstones, walkable. */
export const PLAZA_STONE = 61;

/**
 * Tile type for a post-and-rail fence enclosing a yard or garden — not walkable.
 *
 * A fence stands *on* ground rather than being ground, so it has no material of
 * its own: `groundMaterialUnder` infers whatever surface it was driven into.
 */
export const FENCE = 62;
/**
 * Tile type for planting inside the walls — herb beds and vegetable rows, walkable.
 *
 * Its own type rather than a reuse of `GRASSY_WEED` because a decoration reports
 * the material it is painted *over*, and the town's soft ground is the verge while
 * `GRASSY_WEED`'s is field grass. Planted on a verge, `GRASSY_WEED` drew the wrong
 * sheet row and the surrounding verge then eroded it through the corner masks.
 */
export const GARDEN_PLANTING = 63;

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

/**
 * The town's three fencing types, distinguished by the only difference that
 * survives at 32 px: how the infill between the posts is made.
 *
 * `post_and_rail` is two long rails and nothing between them — a working yard's
 * fence, which only has to stop a cart. `picket` fills the span with sawn pales,
 * which is what a garden by the plaza would be enclosed in. `wattle` is woven
 * hazel on driven stakes: no posts to speak of, and the cheapest thing a kitchen
 * garden out by the wall would have.
 *
 * Declared beside the tile it decorates rather than in the renderer that draws
 * it, so the dependency runs from the renderer to the data and not back.
 */
export type FenceStyle = 'post_and_rail' | 'picket' | 'wattle';

export type TileContent = {
  tileId: string;
  type: number;
  /**
   * Set on `FENCE` tiles: which of the three fencing types to draw.
   *
   * Carried on the tile rather than looked up from the yard at draw time because
   * the renderer is handed a grid and a position, not a plan — the same reason
   * `spriteKey` and `groundType` live here.
   */
  fenceStyle?: FenceStyle;
  /** Set on SPRITE_BUILDING tiles to select which PNG sprite to render. */
  spriteKey?: string;
  /** Set on MODERN_DECORATION tiles: row * 10 + col within modern_decorations.png. */
  decorationVariant?: number;
  /**
   * The floor a prop was driven into, for props whose own type replaces it.
   *
   * A tile carries one type, so writing a `FENCE` over a verge loses the fact
   * that it was a verge — and the renderers then fall back to inferring the floor
   * from the neighbours, which takes the **first cardinal**, and that probe starts
   * with the tile to the south. Every fence on a yard's southern perimeter
   * therefore rendered as the street outside the yard: 17 of 75 fence tiles, with
   * a whole cobbled row drawn inside the Market Row workyard. Recording the
   * surface at paint time is the only answer that does not depend on which
   * neighbour a probe happens to reach first.
   */
  groundType?: number;
};
