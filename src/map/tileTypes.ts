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
/**
 * Tile type for a bookshelf against a wall — not walkable. Smashable on the
 * dungeon floors, which are the only scenes that build a `DestructiblePropSystem`;
 * the town-interior shelves are furniture, exactly as their barrels and crates are.
 */
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

// A safe room's service counter, in three tile types: the front bar the player
// orders across, the back bench the Bopca cooks at, and the walkable strip
// between them. The two counter types are solid, so the strip is a sealed galley
// the player, the companion and mobs can all see into and none can enter.

/** Tile type for the front bar of a safe-room counter — not walkable. */
export const SAFE_ROOM_COUNTER = 64;
/** Tile type for the back bench / stove line behind a safe-room counter — not walkable. */
export const SAFE_ROOM_COUNTER_BACK = 65;
/**
 * Tile type for the scrubbed flagstone strip the Bopca stands on, walkable.
 *
 * Walkable so the Bopca's idle shuffle stays on legal tiles, and so nothing in
 * the game has to special-case a creature standing on a solid tile. It is
 * unreachable by geometry rather than by walkability: `stampSafeRoomCounters`
 * always closes both ends of the strip with counter tiles.
 */
export const SAFE_ROOM_GALLEY_FLOOR = 66;

/**
 * Tile type for the scuffed traffic band inside a safe room's doorways, walkable.
 *
 * Its own type rather than a renderer-side guess at "near a door": the material a
 * tile stands on is a property of the map everywhere else in this codebase, and
 * the decor layout has to be able to keep props off the band without re-deriving
 * which tiles the generator considered a threshold.
 */
export const SAFE_ROOM_THRESHOLD = 67;

// A safe room is a waystation mess hall — the one warm, provisioned, lamp-lit
// room on a floor of concrete and blood — so its decorations read as *inhabited
// and provisioned* rather than as dungeon set dressing: food, light, storage,
// rest. `safeRoomDecorLayout` places them; `src/sprites/safeRoomDecor.ts` draws
// them.
//
// The three wall-hung types go on the room's north row and nowhere else. The
// game's oblique projection has a fixed viewpoint to the south, so a hanging on
// the south wall would be seen from behind — the same constraint that pins the
// Bopca's counter to the north wall.

/** Tile type for a chalk slate listing the day's stew — north wall, not walkable. */
export const SAFE_ROOM_MENU_BOARD = 68;
/** Tile type for a drying rack of herb bundles and cured strips — north wall, not walkable. */
export const SAFE_ROOM_HERB_RACK = 69;
/** Tile type for a long dyed pennant in Bopca green — north wall, not walkable. */
export const SAFE_ROOM_BANNER = 70;
/** Tile type for a standing brass lantern on a pole — the room's light source, not walkable. */
export const SAFE_ROOM_LANTERN = 71;
/** Tile type for a squat iron stove with a copper pot — not walkable. */
export const SAFE_ROOM_STOVE = 72;
/** Tile type for a refectory table — not walkable. */
export const SAFE_ROOM_TABLE = 73;
/** Tile type for a stool at the refectory table — not walkable. */
export const SAFE_ROOM_STOOL = 74;
/** Tile type for stacked crates, sacks and a barrel against a side wall — not walkable. */
export const SAFE_ROOM_LARDER = 75;
/**
 * Tile type for a woven runner across the floor — walkable.
 *
 * Like every other walkable ground decoration it reports the material it is
 * painted *over* rather than one of its own (see `DUNGEON_GROUND`), or the
 * surrounding floor wins all four of its corners and the transition masks erase
 * it. That exact bug already happened once, with `GRASSY_WEED` on the town verge.
 */
export const SAFE_ROOM_RUG = 76;

// ── Town building interiors ───────────────────────────────────────────────────
//
// A shop, a house and the tower used to be floored and walled in the *dungeon's*
// generic types — `FloorTypeValue.wood`, `carpet` and `wall` — so whatever art
// the dungeon's floors happened to be wearing is what a townhouse was built out
// of. That was invisible while both were hand-extracted frames of one tileset;
// once each dungeon floor got a palette of its own it meant a house was floored
// in whichever cellar the player had most recently walked through. These four
// types are the town's own, so an interior is a decision on the map rather than
// a side effect of somebody else's.
//
// The restaurant, the Desperado Club and the Big Top keep their own floor types
// (`SAFE_ROOM_FLOOR`, `CLUB_FLOOR`, `SAWDUST_FLOOR`) — but their *walls* change
// with everything else, because `generateInterior` rings every interior in one
// wall type. That is the right answer for all three: a town restaurant is a
// Bopca station built inside a building, so it should have the building's
// plaster, where a dungeon station is cut out of rock and keeps the floor's
// masonry. The station's own floor is identical in both, which is the part that
// has to match.

/** Sawn boards: a shop's and a house's floor. */
export const INTERIOR_BOARD_FLOOR = 77;

/** Flagged stone: the tower's floor, which is masonry rather than carpentry. */
export const INTERIOR_STONE_FLOOR = 78;

/** Plastered interior wall — what a town building looks like from the inside. */
export const INTERIOR_WALL = 79;

/**
 * A shop counter or a tavern bar: solid, and made of wood rather than stone.
 *
 * The counter runs in `GameMap.generateInterior` — the general store's, Herb &
 * Remedy's, and the bars in The Sleeping Cat Inn, The Horned Flagon and The
 * Sunken Stump Pub, seven write statements across those five buildings — were
 * all written as `FloorTypeValue.wall`, so every one of them was drawn as a
 * course of dungeon masonry. They only ever needed to be *solid*; borrowing the
 * wall type to get that also borrowed its appearance.
 *
 * `InteriorOccupantSystem` anchors a barkeep to this type, so a building whose
 * counter is not written with it loses its occupant silently.
 */
export const INTERIOR_COUNTER = 80;

/**
 * One past the highest tile type value above — the length of any array indexed
 * by tile type. Bump this when a new tile type exceeds it.
 */
export const TILE_TYPE_COUNT = 81;

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
  /**
   * Wear on a destructible prop tile (BARREL, BARREL_SIDE, CRATE, TORCH,
   * BRAZIER, BOOKSHELF): see the `PROP_DAMAGE_STAGE_*` constants in
   * `DestructiblePropSystem`.
   *
   * Carried on the tile rather than held only in that system so the tile
   * renderer can pick its sprite state without a back-reference into gameplay
   * code — the same reason `spriteKey` and `groundType` live here.
   */
  damageStage?: number;
  /**
   * How far through its life a `TREE` tile is: one of the `TREE_STAGE_*`
   * constants. Absent means healthy.
   *
   * On the tile rather than only in `TreeSystem` for the same reason
   * `damageStage` is: `drawDecorationTile` is a pure tile renderer with no
   * handle on any gameplay system, so a burning tree could not otherwise pick
   * its sprite row.
   */
  treeStage?: number;
  /**
   * Animation cursor for whichever looping row a `TREE` tile is currently in —
   * the flame loop while it burns, the collapse while it falls. Advanced by
   * `TreeSystem.update()`. Absent means frame 0.
   */
  treeAnimFrame?: number;
};

/** A destructible prop tile that has taken no damage yet. */
export const PROP_DAMAGE_STAGE_INTACT = 0;
/** A destructible prop tile that is visibly hurt but still standing. */
export const PROP_DAMAGE_STAGE_CRACKED = 1;

/**
 * The sprite state a destructible prop tile should render in.
 *
 * Lives here rather than in `DestructiblePropSystem` so the tile renderers can
 * read a prop's wear without importing gameplay code — the map layer has no
 * other dependency on `src/systems`, and pulling one in for two constants would
 * drag the loot system and both player classes along with it.
 */
export function propSpriteState(damageStage: number | undefined): 'idle' | 'damaged' {
  return (damageStage ?? PROP_DAMAGE_STAGE_INTACT) === PROP_DAMAGE_STAGE_INTACT
    ? 'idle'
    : 'damaged';
}

/** An untouched tree. */
export const TREE_STAGE_HEALTHY = 0;
/** Below half health: bark gouged, boughs snapped, crown thinned. */
export const TREE_STAGE_DAMAGED = 1;
/** Alight, crown still green under the flames. */
export const TREE_STAGE_BURNING = 2;
/** Alight, crown mostly consumed, trunk burning. */
export const TREE_STAGE_BURNING_LATE = 3;
/** Burnt out: a black skeletal husk, and trivially easy to knock down. */
export const TREE_STAGE_CHARRED = 4;
/**
 * Coming down. Held on the tile rather than drawn as an overlay burst the way a
 * smashed crate is: a tree is four tiles tall, and an effects-pass overlay would
 * draw the collapse on top of a player standing south of it. Keeping it in the
 * Y-sorted tile pass also keeps the tile blocked until it has finished falling.
 */
export const TREE_STAGE_FELLING = 5;
/**
 * Coming down having already burnt out. A separate stage from `FELLING` purely
 * so the collapse can be drawn as the husk it is: the sheets carry one row per
 * dressing, and reusing the green `felling` row would grow a charred tree's
 * leaves back for the half second it takes to fall.
 */
export const TREE_STAGE_FELLING_CHARRED = 6;

/** The sprite row a tree tile should render from, given its stage. */
export function treeSpriteState(
  treeStage: number | undefined,
): 'idle' | 'damaged' | 'burning' | 'burning_late' | 'charred' | 'felling' | 'felling_charred' {
  switch (treeStage ?? TREE_STAGE_HEALTHY) {
    case TREE_STAGE_DAMAGED:
      return 'damaged';
    case TREE_STAGE_BURNING:
      return 'burning';
    case TREE_STAGE_BURNING_LATE:
      return 'burning_late';
    case TREE_STAGE_CHARRED:
      return 'charred';
    case TREE_STAGE_FELLING:
      return 'felling';
    case TREE_STAGE_FELLING_CHARRED:
      return 'felling_charred';
    default:
      return 'idle';
  }
}

/**
 * Every baked tree sheet, grouped by species. Order is load-bearing: the grove
 * hash indexes the species and the per-tile hash indexes the variant, so
 * reordering either level repaints every forest on the map.
 */
const TREE_SPRITE_KEYS = [
  ['tree_oak_a', 'tree_oak_b', 'tree_oak_c', 'tree_oak_d'],
  ['tree_birch_a', 'tree_birch_b', 'tree_birch_c', 'tree_birch_d'],
  ['tree_pine_a', 'tree_pine_b', 'tree_pine_c', 'tree_pine_d'],
] as const;

/** A single tree sheet's manifest key. */
type TreeSpriteKey = (typeof TREE_SPRITE_KEYS)[number][number];

/**
 * How many tiles across one single-species grove is. Large enough that a stand
 * of one species fills the screen and the wood reads as having regions, small
 * enough that walking a forest blob crosses two or three of them.
 */
const GROVE_SIZE_TILES = 24;

/**
 * How far a grove's edge wanders, in tiles.
 *
 * Without it the species boundaries are the grove grid's own straight lines,
 * and a forest laid over them reads as three rectangular plantations meeting at
 * right angles. Offsetting each tile's grove lookup by a hash of the *other*
 * axis breaks those lines into a ragged front while keeping the lookup a pure
 * function of position.
 */
const GROVE_EDGE_WOBBLE_TILES = 5;

function groveWobble(alongAxis: number, salt: number): number {
  const span = GROVE_EDGE_WOBBLE_TILES * 2 + 1;
  return (positionHash(alongAxis, salt) % span) - GROVE_EDGE_WOBBLE_TILES;
}

/** Salts keeping the two axes' wobble streams independent. */
const GROVE_WOBBLE_SALT_X = 0x5bd1;
const GROVE_WOBBLE_SALT_Y = 0xa3e7;

// Knuth's multiplicative hash constants — two large odd 32-bit primes, one per
// axis, so `tx` and `ty` scramble independently before they are combined.
const HASH_MULTIPLIER_X = 2654435761;
const HASH_MULTIPLIER_Y = 2246822519;

function positionHash(x: number, y: number): number {
  return (Math.imul(x, HASH_MULTIPLIER_X) ^ Math.imul(y, HASH_MULTIPLIER_Y)) >>> 0;
}

/**
 * The sheet a tree at (tx, ty) is drawn from.
 *
 * Species comes from a low-frequency hash of the tile's grove, so neighbouring
 * trees are usually the same species and a forest reads as one wood rather than
 * as a nursery display. The variant within that species comes from the tile's
 * own hash, so no two adjacent trees are identical. Both are pure functions of
 * position: nothing is stored per tile, and the choice survives a re-bake.
 */
export function treeSpriteKey(tx: number, ty: number): TreeSpriteKey {
  const wobbledX = tx + groveWobble(ty, GROVE_WOBBLE_SALT_X);
  const wobbledY = ty + groveWobble(tx, GROVE_WOBBLE_SALT_Y);
  const groveHash = positionHash(
    Math.floor(wobbledX / GROVE_SIZE_TILES),
    Math.floor(wobbledY / GROVE_SIZE_TILES),
  );
  const species = TREE_SPRITE_KEYS[groveHash % TREE_SPRITE_KEYS.length];
  return species[positionHash(tx, ty) % species.length];
}

/**
 * Stamps a decoration over a floor tile, recording the surface it replaced.
 *
 * Every prop write goes through this rather than assigning `type` directly: the
 * floor is what a smashed prop is smashed back down to, and inferring it later
 * from the neighbours gets the wrong answer for any prop sitting on a boundary
 * (see `groundType` above).
 */
export function placeProp(tile: TileContent, propType: number): void {
  // `??=`, not `=`: if a second stamp ever lands on the same tile, recording the
  // first prop as the "ground" would leave the floor beneath it unpaintable and
  // make smashing the prop restore a prop.
  tile.groundType ??= tile.type;
  tile.type = propType;
}
