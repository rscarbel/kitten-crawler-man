import { SERVICE_PROP_TILE_TYPES } from './serviceLevelProps';
import { CELLAR_OVERLAY_TILE_TYPES } from './cellarProps';
import {
  MAZE_CAT_SPAWN_CHAR,
  MAZE_EXIT_TILES,
  MAZE_FLOOR_CHAR,
  MAZE_HUMAN_SPAWN_CHAR,
  MAZE_HUMAN_SPAWN_TILE,
  MAZE_PILLAR_CHAR,
  MAZE_POLE_CHAR,
  MAZE_WALL_CHAR,
  type BigTopMazePlan,
} from './bigTopMazeLayout';
import {
  BONE_PILE,
  SLUMPED_SKELETON,
  type TileContent,
  FloorTypeValue,
  TREE,
  BUILDING_WALL,
  ROOF_THATCH,
  ROOF_SLATE,
  ROOF_RED,
  ROOF_GREEN,
  FOUNTAIN,
  TORCH,
  WELL,
  STAIRS_UP,
  STAIRS_DOWN,
  TOWER_STAIR_SPAN,
  TABLE,
  BOOKSHELF,
  CRAWLER_SIGN,
  BED,
  FIREPLACE,
  BARREL,
  RUG,
  CHAIR,
  BARREL_SIDE,
  CRATE,
  BRAZIER,
  MAIN_TOWER,
  SPRITE_BUILDING,
  MODERN_DECORATION,
  SAWDUST_FLOOR,
  CIRCUS_RING_EDGE,
  TENT_POLE,
  BLEACHER,
  CLUB_FLOOR,
  DANCE_FLOOR,
  placeProp,
  INTERIOR_BOARD_FLOOR,
  INTERIOR_RUSH_FLOOR,
  INTERIOR_EARTH_FLOOR,
  INTERIOR_FLAG_FLOOR,
  INTERIOR_STONE_FLOOR,
  INTERIOR_WALL,
  BOULDER_SMALL,
  BOULDER_LARGE,
  CAMPFIRE,
  GOBLIN_TENT,
  CLIFF,
  TRAINING_DUMMY,
  WEAPON_RACK,
  MUSTER_BOARD,
  FLASH_WALL,
  PIGMENT_SHELF,
  GRINDING_SLAB,
  QUEST_EXIT_DOOR_CLOSED,
  QUEST_EXIT_DOOR_OPEN,
  BOSS_ROOM_PROP_TILE_TYPES,
  HOLLOW_WALL,
  HOLLOW_PROP_LOW,
  HOLLOW_PROP_TALL,
  HOLLOW_PALISADE,
  HOLLOW_GATE,
  ROCK_DEPOSIT,
  CIRCUS_STRUCTURE_TALL,
  CIRCUS_STRUCTURE_LOW,
} from './tileTypes';
import { isSightTransparentTileType, isWalkableTileType } from './walkability';
import type { Rect } from './roomDoorways';
import { RegionMap, type RegionKind } from './regionMap';
import { RegionCharacters } from './dungeon/regionCharacters';
import { buildFloorSurface, FloorSurface, registerFloorSurface } from './dungeon/floorSurface';
import { registerWallCharacters, registerWallFixtureFeet } from './dungeon/wallDressing';
import { fixtureFoot, type WallFixture } from './dungeon/wallFixtures';
import type { RegionCharacter } from './dungeon/roomCharacters';
import type { Mob } from '../creatures/Mob';
import { countsTowardRoomClear } from '../creatures/roomClear';
import { tileIndex, tileCoordKey, tileKeyX, tileKeyY } from './tileIndex';
import { drawFloorArtSeed } from './ground/floorArtSeed';
import { MinHeap, HEAP_EMPTY } from '../core/MinHeap';
import { drawWorldSeed, withWorldSeed } from '../core/WorldRandom';
import { TILE_SIZE } from '../core/constants';
import {
  CLUB_INTERIOR_W,
  CLUB_INTERIOR_H,
  CLUB_DANCE_FLOOR,
  CLUB_DIVIDER_WALLS,
} from '../core/clubLayout';
import { CLUB_FURNITURE_TILES } from '../core/clubProps';
import { ARENA_RADIUS, ARENA_CONCOURSE_REACH } from './arenaGeometry';
import {
  COLOSSEUM_RIM_PAINT_REACH_TILES,
  colosseumRimCoversTile,
} from './tiles/bossRooms/colosseumGeometry';
import {
  generateDungeon,
  type DungeonLevelOptions,
  type GenerateDungeonOptions,
  type SafeRoomData,
  type ArenaExterior,
  type ProgressionLayoutData,
  type QuestRoomData,
  type TreasureRoomData,
  type SpiderLabRoomData,
  type MobSpawnPoint,
} from './DungeonGenerator';
import { generateOverworld, type BuildingEntry } from './OverworldGenerator';
import type { CampSite } from './overworld/camps';
import type { BriarHollowSite, VillageDistrictId } from './overworld/briarHollowSite';
import type { CircusGroundsSite } from './overworld/circusGroundsLayout';
import { registerBriarHollowSite } from './tiles/hollowSiteRegistry';
import { registerCircusGroundsSite } from './tiles/circusSiteRegistry';
import { hollowPropDrawsAt } from './tiles/hollowVillageTiles';
import { circusStructureDrawsAt } from './tiles/circusStructureTiles';
import { tentPoleDrawsAt } from './tiles/tentPoleTiles';
import type { BuildingKind, TownPlan } from './town/townPlan';
import {
  NAMED_INTERIOR_LAYOUTS,
  buildGeneralStoreLayout,
  INN_INTERIOR_W,
  INN_INTERIOR_H,
  INN_TAPROOM_FIRST_ROW,
  INN_TAPROOM_LAST_ROW,
  BARRACKS_INTERIOR_W,
  BARRACKS_INTERIOR_H,
} from './town/interiors/index';
import { stableInteriorPropId, type TownInteriorLayoutEntry } from './town/interiors/types';
import {
  buildTownCenterTowerLayout,
  type TowerStairOrigins,
} from './town/interiors/townCenterTower';
import { setTownInteriorWallMaterial } from './town/interiorWallMaterial';
import { setBigTopDecorLayout } from './bigTopMazeDecor';
import {
  TOWN_INTERIOR_PROPS,
  type TownInteriorPropId,
} from '../sprites/art/townInterior/townInteriorProps';
import {
  getBlockedTileOffsets,
  getBlockedTileOffsetsByKey,
  getSpriteDefByKey,
  getSortYAnchorPx,
  type MapSpriteExtentsPx,
} from '../core/SpriteLoader';
import {
  decorationTileExtentsPx,
  renderCanvas,
  renderDecorationsOverlay,
  drawDecorationTileFull,
  TileChunkCache,
  OverlayTileCache,
  bakeDecorationsForView,
} from './TileRenderer';

// ── Default map construction options ──────────────────────────────────────────
const DEFAULT_MAP_SIZE = 100;
const DEFAULT_TILE_HEIGHT = 10;
/** Boss rooms carved when a caller supplies no dungeon settings at all. */
const DEFAULT_BOSS_ROOM_COUNT = 1;
/** An entity's pixel position is its top-left corner; this offset reaches its centre. */
const ENTITY_TILE_CENTER_OFFSET = 0.5;
/** From a tile's top-left corner to its centre, in tiles. */
const TILE_CENTRE_OFFSET = 0.5;

// ── Interior building dimensions (width × height in tiles) ────────────────────
export const TOWER_INTERIOR_W = 20;
const TOWER_INTERIOR_H = 16;
/**
 * Wide enough for a real back storeroom bay behind the shop floor, and no
 * wider: the shop is furnished with a few big fittings, and a larger shell
 * only spreads them over bare boards. The store is the only `store`-kind
 * building, so this shell touches nothing else.
 */
const STORE_INTERIOR_W = 20;
const STORE_INTERIOR_H = 12;
const HOUSE_INTERIOR_W = 18;
const HOUSE_INTERIOR_H = 14;
/**
 * Which shape an interior is built in.
 *
 * Only the Big Top has more than one, and only for the length of the circus
 * questline's final act — every other room is `'default'` forever.
 */
export type InteriorVariant =
  | 'default'
  | {
      readonly kind: 'bigtop_maze';
      /** The tent as dealt to this world and difficulty: its board written into the floor plan. */
      readonly plan: BigTopMazePlan;
    };

/** The tile the maze layout's legend character stands for. */
function mazeTileTypeFor(legend: string): number {
  switch (legend) {
    case MAZE_WALL_CHAR:
      return INTERIOR_WALL;
    case MAZE_POLE_CHAR:
      return TENT_POLE;
    case MAZE_PILLAR_CHAR:
      return INTERIOR_WALL;
    case MAZE_FLOOR_CHAR:
    case MAZE_HUMAN_SPAWN_CHAR:
    case MAZE_CAT_SPAWN_CHAR:
      return SAWDUST_FLOOR;
    default:
      // Gates, barricades, curtains, exit doors, the grates the counterweights
      // hang behind, the hall's lights, its stars and the windows in its
      // dividing wall. All of them start as wall; only a gate, a curtain or a
      // door ever stops being one, and `BigTopMazeSystem` is what opens it.
      return INTERIOR_WALL;
  }
}

/** The big top interior is a boss arena — much larger than any other interior. */
const BIGTOP_INTERIOR_W = 34;
const BIGTOP_INTERIOR_H = 26;

// ── Big top interior layout ───────────────────────────────────────────────────
/** Radius of the painted performance ring, in tiles. */
const BIGTOP_RING_RADIUS = 8;
/** The ring centre sits this many rows above the map centre, leaving an entrance apron. */
const BIGTOP_RING_NORTH_SHIFT = 2;
/** Rows of bleacher benches hugging the north/west/east walls. */
const BIGTOP_BLEACHER_DEPTH = 2;

// ── Tile types used in interior generation ────────────────────────────────────
//
// These four interior types belong to the town, distinct from the dungeon's
// generic floor/wall types. Sharing a type with the dungeon — a shop floored in
// `FloorTypeValue.wood`, a wall drawn in `FloorTypeValue.wall` — would make a
// townhouse's floorboards resolve through whichever dungeon floor's material
// set happens to be active, rather than through the town's own palette.

// The four interior types are used under their own names below rather than
// through local aliases: a use site reading `WALL_TILE` would give no clue
// which kind of wall it is, which is exactly the ambiguity that would let a
// townhouse be built out of dungeon rock without anyone noticing. The exit
// door likewise names `FloorTypeValue.road` outright — it is genuinely the
// outdoor threshold type, and a bare `1` would say nothing.

interface InteriorShell {
  readonly w: number;
  readonly h: number;
  readonly floorType: number;
}

/** One instance of a town interior prop, placed by a layout file. */
export interface PlacedTownInteriorProp {
  readonly propId: TownInteriorPropId;
  readonly variant: number;
  readonly tile: { readonly x: number; readonly y: number };
  /** Cross-regeneration-stable id — see `stableInteriorPropId`. */
  readonly id: string;
  /** Resolved per-instance override of the prop def's own `destructible.dropsLootByDefault`. */
  readonly dropsLoot: boolean | undefined;
}

/** Interior shell per building kind. Exhaustive, so a new kind cannot ship unsized. */
const INTERIOR_BY_KIND: Record<BuildingKind, InteriorShell> = {
  tower: { w: TOWER_INTERIOR_W, h: TOWER_INTERIOR_H, floorType: INTERIOR_STONE_FLOOR },
  store: { w: STORE_INTERIOR_W, h: STORE_INTERIOR_H, floorType: INTERIOR_BOARD_FLOOR },
  club: { w: CLUB_INTERIOR_W, h: CLUB_INTERIOR_H, floorType: CLUB_FLOOR },
  house: { w: HOUSE_INTERIOR_W, h: HOUSE_INTERIOR_H, floorType: INTERIOR_BOARD_FLOOR },
};

/**
 * Shells stated per building rather than per kind. A kind is a category — a
 * shop, a house — and a category cannot say how big a mead hall is or what a
 * garrison's drill floor is made of. Every town building wearing the same 18x14
 * box in the same boards is the single largest reason they all felt alike.
 * Anything absent here falls back to its kind's shell.
 */
const INTERIOR_BY_NAME: ReadonlyMap<string, InteriorShell> = new Map([
  [
    'The Sleeping Cat Inn',
    { w: INN_INTERIOR_W, h: INN_INTERIOR_H, floorType: INTERIOR_RUSH_FLOOR },
  ],
  [
    'The Barracks',
    { w: BARRACKS_INTERIOR_W, h: BARRACKS_INTERIOR_H, floorType: INTERIOR_STONE_FLOOR },
  ],
  // A small parlour: the alcove, back room and waiting room each hold a few
  // big pieces with nothing spread thin between them. Clean boards are the
  // base; the two work rooms lay their own ink-stained floor in
  // `buildQuietNeedleLayout`.
  ['The Quiet Needle', { w: 14, h: 13, floorType: INTERIOR_BOARD_FLOOR }],
  // Flagstones under the respectable house: a mead hall built to look like it
  // has stood for generations, on a floor that shows no wear.
  ['The Horned Flagon', { w: 22, h: 16, floorType: INTERIOR_FLAG_FLOOR }],
  // Packed earth under the dive, and a room small enough that the drinkers
  // are always in each other's way: nobody has ever laid a floor here worth
  // keeping clean.
  ['The Sunken Stump Pub', { w: 15, h: 12, floorType: INTERIOR_EARTH_FLOOR }],
  ['Temple of the Sky', { w: 18, h: 18, floorType: INTERIOR_FLAG_FLOOR }],
  ['The Rusty Anvil', { w: 16, h: 12, floorType: INTERIOR_FLAG_FLOOR }],
  ['Herb & Remedy', { w: 16, h: 14, floorType: INTERIOR_BOARD_FLOOR }],
  // One small room: a ten-tile floor keeps her furniture crowded in clusters
  // against the walls instead of spread thin across a hall.
  ["Old Hilda's Cottage", { w: 12, h: 12, floorType: INTERIOR_BOARD_FLOOR }],
  // Board, not earth: a wheelwright's own floor is swept clean of shavings
  // by daylight, not left as bare dirt. Sized to the pieces the trade needs —
  // any wider and the wagon, the stand and the bench float in open floor.
  ["Cartwright's Workshop", { w: 16, h: 12, floorType: INTERIOR_BOARD_FLOOR }],
  // Boards under the kitchen half; the mill room overrides its own tiles to
  // flagstone in `buildMillersFarmLayout`.
  ["Miller's Farm", { w: 16, h: 14, floorType: INTERIOR_BOARD_FLOOR }],
  ['Plumbline Farm', { w: 14, h: 10, floorType: INTERIOR_BOARD_FLOOR }],
  // Sixteen wide: a bunk rank down each side wall and the hall between them
  // still wide enough for the cult-hideout fight around the room's centre.
  ['Blackwood Lodge', { w: 16, h: 14, floorType: INTERIOR_BOARD_FLOOR }],
  ['General Store', { w: STORE_INTERIOR_W, h: STORE_INTERIOR_H, floorType: INTERIOR_BOARD_FLOOR }],
  ['The Desperado Club', { w: CLUB_INTERIOR_W, h: CLUB_INTERIOR_H, floorType: CLUB_FLOOR }],
  ['Big Top', { w: BIGTOP_INTERIOR_W, h: BIGTOP_INTERIOR_H, floorType: SAWDUST_FLOOR }],
] satisfies ReadonlyArray<[string, InteriorShell]>);

/**
 * The band of a safe-room building's interior the safe room actually covers.
 *
 * Name-addressable rather than "the whole floor", because an inn's safe room is
 * its taproom and not its guest wing. The whole interior is the fallback, so a
 * future safe-room building works without an entry here.
 */
const SAFE_ROOM_BOUNDS_BY_NAME: ReadonlyMap<
  string,
  { readonly x: number; readonly y: number; readonly w: number; readonly h: number }
> = new Map([
  /*
   * The inn's taproom, and none of its guest wing. A rented room is somewhere a
   * crawler pays to be alone; the System's protection belongs to the public room
   * downstairs, where the Bopca cooks and Mordecai sits.
   */
  [
    'The Sleeping Cat Inn',
    {
      x: 1,
      y: INN_TAPROOM_FIRST_ROW,
      w: INN_INTERIOR_W - 2,
      h: INN_TAPROOM_LAST_ROW - INN_TAPROOM_FIRST_ROW + 1,
    },
  ],
]);

// ── Tower stair placement ─────────────────────────────────────────────────────
/** X offset from the east wall for the "stairs up" tile in tower floors. */
const TOWER_STAIR_UP_X_OFFSET = 5;
/** Y row for both stair tiles (near the north wall). */
const TOWER_STAIR_ROW = 2;
/** X column for the "stairs down" tile (near the west wall). */
const TOWER_STAIR_DOWN_COL = 3;
/** Maximum tower floor index — floors 0..3, so the cap is 3. */
const TOWER_TOP_FLOOR = 3;
/**
 * How many storeys a tower generates. Stated here beside the top-floor index it
 * is derived from, so a scene building the floors and a gate walking them cannot
 * disagree about how many there are.
 */
export const TOWER_FLOOR_COUNT = TOWER_TOP_FLOOR + 1;

// ── Decoration overlay index ──────────────────────────────────────────────────
/** A decoration tile drawn in the Y-sorted overlay pass. */
export interface DecorationTile {
  readonly tx: number;
  readonly ty: number;
  /** Pixels below the tile's top edge where the sprite's visual foot sits. */
  readonly sortYAnchorPx: number;
  /** How far the art reaches past the tile's own square, per direction. */
  readonly extents: Readonly<MapSpriteExtentsPx>;
}

/** Tile types drawn in the Y-sorted decoration overlay pass. */
const DECORATION_OVERLAY_TYPES: ReadonlySet<number> = new Set([
  // The dead. Y-sorted so a crawler north of a skeleton is drawn behind it.
  BONE_PILE,
  SLUMPED_SKELETON,
  TREE,
  TORCH,
  WELL,
  BRAZIER,
  FOUNTAIN,
  BUILDING_WALL,
  ROOF_THATCH,
  ROOF_SLATE,
  ROOF_RED,
  ROOF_GREEN,
  MAIN_TOWER,
  BARREL,
  BARREL_SIDE,
  CRATE,
  BOOKSHELF,
  CRAWLER_SIGN,
  SPRITE_BUILDING,
  MODERN_DECORATION,
  // Both registries, or the tile renders as bare floor: `DECORATION_TYPES` in
  // `TileRenderer` decides what the chunk bake skips, and this one decides what
  // the Y-sorted overlay draws.
  BOULDER_SMALL,
  BOULDER_LARGE,
  CAMPFIRE,
  GOBLIN_TENT,
  CLIFF,
  // The garrison's and the inking shop's tall props. Y-sorted so a player
  // standing north of a training dummy is drawn behind it. `MAP_TABLE` and
  // `INK_BENCH` are absent for the same reason `TABLE` and `BED` are: both are
  // waist height, drawn flat in the base pass, and nothing walks behind them.
  TRAINING_DUMMY,
  WEAPON_RACK,
  MUSTER_BOARD,
  FLASH_WALL,
  PIGMENT_SHELF,
  GRINDING_SLAB,
  ...BOSS_ROOM_PROP_TILE_TYPES,
  // Briar Hollow's walls, palisade, gate and blocking props.
  HOLLOW_WALL,
  HOLLOW_PROP_LOW,
  HOLLOW_PROP_TALL,
  HOLLOW_PALISADE,
  HOLLOW_GATE,
  ROCK_DEPOSIT,
  // The circus grounds' tents, pavilions and arch posts.
  CIRCUS_STRUCTURE_TALL,
  CIRCUS_STRUCTURE_LOW,
  // The Big Top's tent poles: the mast rises out of view in the Y-sorted pass.
  TENT_POLE,
  // The service level's furniture; its part tiles are drawn by their anchor.
  ...SERVICE_PROP_TILE_TYPES,
  // The cellars' furniture, candles and fungus.
  ...CELLAR_OVERLAY_TILE_TYPES,
]);

/**
 * A decoration reaching further than this past its anchor is checked
 * individually every frame rather than widening the row scan for everything
 * else. The main tower and every sprite building qualify — a few dozen tiles
 * on the town map, against tens of thousands of ordinary decorations.
 */
const OVERSIZED_DECORATION_EXTENT_TILES = 3;

function isOversizedDecoration(extents: Readonly<MapSpriteExtentsPx>, tileSize: number): boolean {
  const limit = OVERSIZED_DECORATION_EXTENT_TILES * tileSize;
  return (
    extents.left > limit || extents.up > limit || extents.right > limit || extents.down > limit
  );
}

// ── Walkability masks ─────────────────────────────────────────────────────────
/** Tile is inside a multi-tile sprite/prop footprint. */
const BLOCK_EXTRA = 1;
/** Tile was blocked permanently at runtime (placed prop, quest scenery). */
const BLOCK_PERMANENT = 2;
/** Tile is part of an arena door gap — blocking only while `arenaDoorLocked`. */
const BLOCK_ARENA_DOOR = 4;
/** Tile is part of a stairwell's 2×2 footprint. */
const BLOCK_STAIRWELL = 8;
/**
 * Tile is part of the defense quest's onward doorway — blocking only while the
 * goblin mother has it barred, which is only ever during an encounter the
 * player accepted.
 *
 * A flag rather than an unwalkable tile type because the offline progression
 * validator flood-fills the raw grid, and a wall here would make every landmark
 * past the quest room read as unreachable on the floors where the room is a
 * mandatory pass-through.
 */
const BLOCK_QUEST_EXIT = 16;
/**
 * Tile is under a player-built structure's footprint (a trebuchet). Blocking
 * unconditionally, but kept apart from `BLOCK_PERMANENT` because the structure
 * can be dismantled, and its owner re-derives the whole set from saved village
 * state rather than accumulating it.
 */
const BLOCK_STRUCTURE = 32;
/**
 * Tile turns away hostile mobs only — the village gate. `isWalkable` ignores it
 * so crawlers, companions, allies and livestock walk straight through, and only
 * `isWalkableForHostile` (the test every hostile's step and A* use) honours it.
 * A flag rather than a tile type for the same reason as `BLOCK_QUEST_EXIT`: the
 * offline reachability validators flood the raw grid.
 */
const BLOCK_HOSTILE_ONLY = 64;

/**
 * What the defense quest's onward doorway is doing.
 *
 * `clear` is what every floor generates in, and what the doorway stays as for a
 * player who never takes the wave: the nursery is a room on the route, and
 * walking through it is all it ever demands. `barred` is the goblin mother's
 * own doing, for the length of an encounter the player accepted — she boards
 * the far side so nothing gets out of the room past her brood. `smashed` is the
 * scar the segment leaves once it ends, win or lose: her boards gone but for
 * the splintered ends still nailed to the jambs.
 */
export type QuestExitDoorState = 'clear' | 'barred' | 'smashed';

/** The art a doorway tile wears in a given state, over the floor it generated as. */
function questExitDoorTileType(state: QuestExitDoorState, generatedType: number): number {
  if (state === 'barred') return QUEST_EXIT_DOOR_CLOSED;
  if (state === 'smashed') return QUEST_EXIT_DOOR_OPEN;
  return generatedType;
}
/** Bits that block movement regardless of game state. */
const BLOCK_UNCONDITIONAL = BLOCK_EXTRA | BLOCK_PERMANENT | BLOCK_STRUCTURE;

// ── A* pathfinding constants ──────────────────────────────────────────────────
/** Movement cost for a diagonal step (√2 approximated to 3 decimal places). */
const DIAGONAL_MOVE_COST = 1.414;
/** Movement cost for a cardinal step. */
const CARDINAL_MOVE_COST = 1;
/** Maximum A* node expansions per call — keeps per-frame cost bounded. */
const ASTAR_MAX_NODE_EXPANSIONS = 2000;
/**
 * Default longest path A* will attempt, in tiles. Just beyond the AI activation
 * radius, so a mob's walkable-but-unreachable faraway goal fails instantly
 * instead of burning the full expansion budget on every repath. Callers that
 * navigate outside the AI leash — a companion catching up across town — pass
 * their own, larger limit.
 */
export const MOB_MAX_PATH_DISTANCE_TILES = 24;
/**
 * Expansions allowed regardless of how short the requested path is. Generous,
 * because "short as the crow flies" and "short to walk" diverge sharply in
 * town: a goal two tiles away on the far side of a building costs a few hundred
 * expansions to route around, and failing that leaves a mob pinned to the wall.
 */
const ASTAR_BASE_EXPANSIONS = 400;
/**
 * Search radius allowance per tile of goal distance. The expansion cap is the
 * square of `goalDistance * this`, so a 4-tile hop may explore a small
 * neighbourhood while a cross-screen chase gets the full budget.
 */
const ASTAR_EXPANSIONS_PER_TILE = 4;

/** Sentinel in `pathCameFrom` marking the start node, which has no parent. */
const PATH_NO_PARENT = -1;
/** Initial open-set capacity — grown automatically if a search needs more. */
const ASTAR_OPEN_HEAP_CAPACITY = 256;

/**
 * The four cardinal steps A* expands. Their walkability is computed once per
 * expansion and reused by the diagonal corner-cutting rule.
 */
const CARDINAL_STEPS = [
  { dx: 1, dy: 0 },
  { dx: -1, dy: 0 },
  { dx: 0, dy: 1 },
  { dx: 0, dy: -1 },
] as const;

const CARDINAL_EAST = 0;
const CARDINAL_WEST = 1;
const CARDINAL_SOUTH = 2;
const CARDINAL_NORTH = 3;

/**
 * The four diagonal steps, each naming the two `CARDINAL_STEPS` it squeezes
 * between — both must be walkable or the move would cut a wall corner.
 */
const DIAGONAL_STEPS = [
  { dx: 1, dy: 1, horizontal: CARDINAL_EAST, vertical: CARDINAL_SOUTH },
  { dx: 1, dy: -1, horizontal: CARDINAL_EAST, vertical: CARDINAL_NORTH },
  { dx: -1, dy: 1, horizontal: CARDINAL_WEST, vertical: CARDINAL_SOUTH },
  { dx: -1, dy: -1, horizontal: CARDINAL_WEST, vertical: CARDINAL_NORTH },
] as const;

/** A* heuristic: the same Manhattan estimate the original search used. */
function manhattanDistance(x1: number, y1: number, x2: number, y2: number): number {
  return Math.abs(x1 - x2) + Math.abs(y1 - y2);
}

// ── Line-of-sight traversal ───────────────────────────────────────────────────
/**
 * Extra boundary crossings allowed beyond the Manhattan tile distance, so a ray
 * that clips a corner (crossing both axes at the same point) still terminates on
 * its target tile rather than on the iteration guard.
 */
const LOS_CROSSING_SLACK = 2;

/** Options for GameMap construction. */
export interface GameMapOptions {
  mapSize?: number;
  tileHeight?: number;
  mapType?: 'dungeon' | 'overworld';
  /** Dungeon generator settings. Ignored for overworld maps. */
  dungeon?: DungeonLevelOptions;
  /**
   * Supply a fully-built tile grid to skip procedural generation entirely.
   * When provided, the caller is responsible for manually setting startTile,
   * safeRooms, stairwellTiles, etc. after construction.
   */
  prebuiltStructure?: TileContent[][];
  /**
   * The seed every runtime-painted piece of this map's environment art derives
   * from. Omitted for a map generating its own layout, which draws its own; a
   * building interior passes the town's so that stepping through a door does not
   * reroll the world it is a door in.
   */
  artSeed?: number;
  /**
   * Replays the layout a save was written on: the same seed with the same level
   * options generates the same floor. Omitted for a new floor, which draws its
   * own. Ignored when `prebuiltStructure` is supplied, since nothing is generated.
   */
  worldSeed?: number;
}

export type { SpiderLabRoomData };

export class GameMap {
  structure: TileContent[][];
  tileHeight: number;
  /**
   * Seed for this map's environment art, fixed for the life of the map object.
   *
   * A checkpoint restore rewinds this same object rather than building a new one,
   * so the floor keeps the art it had when the player died — while a genuine
   * descent or restart constructs a new map and so earns a new look. See
   * `src/map/ground/floorArtSeed.ts`.
   */
  readonly artSeed: number;
  /**
   * The seed this map's layout was generated from, so a save can rebuild the
   * same floor. Hand-built maps (tutorial, interiors) generate nothing and
   * carry a seed that reproduces nothing.
   */
  readonly worldSeed: number;
  /** Tile coordinates where the player should spawn (centre of the first room). */
  startTile: { x: number; y: number } = { x: 15, y: 15 };
  /** Tile centres of all rooms except the start and safe rooms — used for mob placement. */
  mobSpawnPoints: MobSpawnPoint[] = [];
  /** Tile coordinates inside hallways (away from rooms) — used for rat spawning. */
  hallwaySpawnPoints: Array<{ x: number; y: number }> = [];
  /** All safe rooms on this map (bounds + centre in tile coords). */
  safeRooms: Array<SafeRoomData & { showBed?: boolean }> = [];
  /** All boss rooms generated on this map (bounds + centre in tile coords). */
  bossRooms: Array<{
    bounds: { x: number; y: number; w: number; h: number };
    centre: { x: number; y: number };
  }> = [];
  /** Tile-space centres of rooms that contain a stairwell (descent point). */
  private _stairwellTiles: ReadonlyArray<{ x: number; y: number }> = [];

  /**
   * The map's stairwells. Assignable only through `setStairwellTiles`, because
   * the list and the `BLOCK_STAIRWELL` bits `isStairwellTile` reads are two
   * views of one fact — setting the list alone silently disables stairwell
   * detection while the stairs still render.
   */
  get stairwellTiles(): ReadonlyArray<{ x: number; y: number }> {
    return this._stairwellTiles;
  }

  /** The safe room that is the last stop before `bossType`, or undefined when this map has none. */
  safeRoomGuarding(bossType: string): (SafeRoomData & { showBed?: boolean }) | undefined {
    return this.safeRooms.find((room) => room.guardsBossType === bossType);
  }
  /** Door positions for enterable buildings (overworld only). */
  buildingEntries: BuildingEntry[] = [];
  /**
   * Furniture placed by a town interior's layout file — counters, tables,
   * shelving, barrels, a hearth — Y-sorted and rendered the way the
   * Desperado Club's furniture already is. Reset every `generateInterior`
   * call; empty on every map that is not a town building interior.
   */
  private _placedInteriorProps: PlacedTownInteriorProp[] = [];
  get placedInteriorProps(): ReadonlyArray<PlacedTownInteriorProp> {
    return this._placedInteriorProps;
  }
  /**
   * Repaints one placed prop as another of its variants, for a room whose
   * furniture follows a story while the room is open — a drawer that empties
   * when something is handed over. The prop keeps its tile, footprint and id.
   * The list is replaced rather than edited in place, so a cache keyed on it
   * sees the change. Returns whether anything changed.
   */
  setPlacedInteriorPropVariant(id: string, variant: number): boolean {
    const index = this._placedInteriorProps.findIndex((placed) => placed.id === id);
    if (index < 0) return false;
    const current = this._placedInteriorProps[index];
    if (current.variant === variant) return false;
    const next = [...this._placedInteriorProps];
    next[index] = { ...current, variant };
    this._placedInteriorProps = next;
    return true;
  }
  /**
   * Every tile an authored interior prop's footprint covers, with whether the
   * prop stops movement there. A prop leaves the tile's type as floor and
   * blocks it with a permanent flag instead, so a planner that reads tile
   * types alone sees open floor under every shelf and counter. Derived from
   * the authored list rather than the flag, so a broken prop still counts and
   * a re-plan on the same map lands where the first one did.
   */
  placedInteriorPropFootprintTiles(): Array<{ x: number; y: number; blocksMovement: boolean }> {
    const tiles: Array<{ x: number; y: number; blocksMovement: boolean }> = [];
    for (const placed of this._placedInteriorProps) {
      const propDef = TOWN_INTERIOR_PROPS[placed.propId];
      for (let dy = 0; dy < propDef.footprint.h; dy++)
        for (let dx = 0; dx < propDef.footprint.w; dx++)
          tiles.push({
            x: placed.tile.x + dx,
            y: placed.tile.y + dy,
            blocksMovement: !propDef.walkable,
          });
    }
    return tiles;
  }
  /** The `TownPlan` the overworld town was generated from. Undefined on other maps. */
  townPlan: TownPlan | undefined = undefined;
  /** Tile coords of the MAIN_TOWER sprite anchor (overworld only). */
  mainTowerAnchor: { x: number; y: number } | undefined = undefined;
  /** Centre of the town square, in tile coords. Undefined on non-overworld maps. */
  townSquareCentre: { x: number; y: number } | undefined = undefined;
  /** Centre tile of the town fountain. Undefined on non-overworld maps. */
  fountainCentre: { x: number; y: number } | undefined = undefined;
  /** Centre of the circus, in tile coords. Undefined on non-overworld maps. */
  circusCentre: { x: number; y: number } | undefined = undefined;
  /** Where the town's escape route out appears once the Doomsday finale's escape phase begins. Undefined on non-overworld maps. */
  doomsdayEscapeTile: { x: number; y: number } | undefined = undefined;
  /** Radius (tiles) of the circus grounds around `circusCentre`. Undefined on non-overworld maps. */
  circusRadiusTiles: number | undefined = undefined;
  /** What the circus grounds' layout stamped on this map, and where. Null off the overworld. */
  circusGrounds: CircusGroundsSite | null = null;

  /**
   * Wilderness clearings (tile coords) where bounty encounters are staged.
   * Empty on every map but the overworld.
   */
  bountySites: ReadonlyArray<{ x: number; y: number }> = [];

  /**
   * The wilderness's enemy camps. Empty on every map but the overworld.
   *
   * Carried here the way `circusCentre` is, and consumed the same way: a system
   * that needs to know where a landmark is reads it off the map rather than
   * re-deriving it. `spawnForLevel` populates each camp from this.
   */
  camps: ReadonlyArray<CampSite> = [];
  /**
   * Briar Hollow's site on the overworld: the ratkin village's geometry,
   * districts and anchors. Null on every other map. `BriarHollowKit` is built
   * only when this is non-null.
   */
  briarHollow: BriarHollowSite | null = null;
  /** Palisade tiles by `tileCoordKey`, for `isNearPalisade`. Empty off the overworld. */
  private briarHollowPalisadeKeys: ReadonlySet<number> = new Set();
  /**
   * Radius (in tiles, from map centre) inside which the overworld town is
   * considered safe — no hostile ambient spawns, and hostile mobs won't
   * target players standing inside it. Null on non-overworld maps.
   */
  private townSafeRadiusTiles: number | null = null;
  /** Quest rooms generated in the dungeon (defend-NPC encounters). */
  questRooms: QuestRoomData[] = [];
  /**
   * What forced-progression mode built, when this map is a progression floor.
   *
   * Carried through so a harness can ask the finished map where its choke and
   * its spine ended up. Nothing in the game reads it — the generator's own
   * validator has it directly — but a check that had to guess at the choke's
   * position would prove nothing on the floors where it guessed wrong.
   */
  progressionLayout: ProgressionLayoutData | undefined;
  /**
   * Which room or hallway segment each tile was generated as, with each room's
   * role, zone, treasure flag and doorways. Generation data: it rebuilds with
   * the map and is never checkpointed. Empty (every tile `NO_REGION`) on any map
   * that isn't a forced-progression dungeon floor. See {@link RegionMap}.
   */
  regionMap: RegionMap = RegionMap.empty();
  /**
   * The character each room and hallway segment of this floor was dressed as,
   * and the lighting profile of each special room. Generation data, rebuilt
   * with the map. See {@link RegionCharacters}.
   */
  regionCharacters: RegionCharacters = RegionCharacters.empty();

  /**
   * What hangs on this floor's wall faces — sconces, tubes, fuse boxes, chains.
   * Each fixture's tile stays a wall; the list is drawn live over the wall art.
   * Placement is generation data rebuilt with the map; each fixture's `state`
   * is live and checkpointed by `DestructiblePropSystem`. Empty on any map
   * without room characters.
   */
  wallFixtures: ReadonlyArray<WallFixture> = [];

  /**
   * What each dressed room and hallway is floored in and how worn it is, read by
   * the tile painters. Derived from the region map once the map is built, so it
   * is never checkpointed. See {@link FloorSurface}.
   */
  floorSurface: FloorSurface = FloorSurface.empty();

  /**
   * Every room this map's dungeon generator placed, in placement order — the
   * same list the generator used to seat encounters. Empty on any map that
   * isn't a forced-progression dungeon floor (overworld, tutorial, building
   * interiors, and a free-roam dungeon floor, which doesn't record one).
   * Room membership checks (`roomIndexAt`, `roomBoundsContaining`,
   * `hostilesInRoom`) all read the region map these bounds come from, so they
   * degrade to "no room found" wherever it is empty.
   */
  get roomBounds(): ReadonlyArray<Rect> {
    return this.regionMap.roomBounds;
  }

  /**
   * Index into {@link roomBounds} of the room containing this tile, or `-1` when none does.
   * Where two rooms' rectangles overlap, the earlier room is the answer.
   */
  roomIndexAt(tileX: number, tileY: number): number {
    return this.regionMap.roomIndexAt(tileX, tileY);
  }

  /** The region id at a tile; see {@link RegionMap.regionAt}. */
  regionAt(tileX: number, tileY: number): number {
    return this.regionMap.regionAt(tileX, tileY);
  }

  /** Whether a region id is a room or a hallway segment; see {@link RegionMap.regionKind}. */
  regionKind(id: number): RegionKind | null {
    return this.regionMap.regionKind(id);
  }

  /** The character of the room or hallway at a tile; see {@link RegionCharacters.characterAt}. */
  characterAt(tileX: number, tileY: number): RegionCharacter | null {
    return this.regionCharacters.characterAt(tileX, tileY);
  }

  /** Whether standing water covers a tile; see {@link FloorSurface.isPuddleAt}. */
  isPuddleAt(tileX: number, tileY: number): boolean {
    return this.floorSurface.isPuddleAt(tileX, tileY);
  }

  /** An entity's pixel position is its top-left corner; this converts to the tile under its centre. */
  private entityCentreTile(entity: { x: number; y: number }): { x: number; y: number } {
    return {
      x: Math.floor((entity.x + TILE_SIZE * ENTITY_TILE_CENTER_OFFSET) / TILE_SIZE),
      y: Math.floor((entity.y + TILE_SIZE * ENTITY_TILE_CENTER_OFFSET) / TILE_SIZE),
    };
  }

  /**
   * The room containing an entity's centre, or `null` when it isn't inside any
   * room this map recorded (a hallway, or a map with no {@link roomBounds} at
   * all). `entity` is a pixel-space top-left position, matching `Player`/`Mob`.
   */
  roomBoundsContaining(entity: { x: number; y: number }): Rect | null {
    const tile = this.entityCentreTile(entity);
    const roomIndex = this.roomIndexAt(tile.x, tile.y);
    return roomIndex === -1 ? null : this.roomBounds[roomIndex];
  }

  /**
   * Every mob in `mobs` whose centre falls in room `roomIndex` and that
   * {@link countsTowardRoomClear}. Empty when `roomIndex` is out of range,
   * which includes every map with no {@link roomBounds} at all.
   */
  hostilesInRoom(roomIndex: number, mobs: readonly Mob[]): Mob[] {
    if (roomIndex < 0 || roomIndex >= this.roomBounds.length) return [];
    return mobs.filter((mob) => {
      if (!countsTowardRoomClear(mob)) return false;
      const tile = this.entityCentreTile(mob);
      return this.roomIndexAt(tile.x, tile.y) === roomIndex;
    });
  }

  /** Spider lab room, if generated (spider quest boss encounter). */
  spiderLabRoom: SpiderLabRoomData | null = null;
  /** Treasure rooms generated in the dungeon (chest encounters). */
  treasureRooms: TreasureRoomData[] = [];
  /** Arena circles generated in the dungeon (one per dungeon map). */
  arenaExteriors: ArenaExterior[] = [];
  /** When true, the arena door gap tiles are treated as unwalkable. */
  arenaDoorLocked = false;
  /**
   * What the defense quest's onward doorway is doing. See `QuestExitDoorState`.
   */
  private questExitDoorState: QuestExitDoorState = 'clear';
  /**
   * Each onward doorway tile, against the floor it generated as — which is what
   * `clear` puts back when an accepted encounter is abandoned and the doorway
   * goes back to being a doorway.
   */
  private readonly questExitDoorTiles = new Map<number, number>();
  /**
   * Write-side record of every runtime block, keyed with `tileCoordKey` so the
   * entries survive a structure replacement (building interiors regenerate the
   * grid). `blockedMask` is rebuilt from these whenever the grid changes.
   */
  private readonly arenaDoorTileSet = new Set<number>();
  private readonly permanentBlockedTiles = new Set<number>();
  private readonly stairwellBlockedSet = new Set<number>();
  private readonly structureBlockedSet = new Set<number>();
  private readonly hostileOnlyBlockedSet = new Set<number>();

  /**
   * Per-tile block flags (`BLOCK_*`) for the current structure, indexed
   * `tileIndex(tx, ty, maskWidth)`. This is the read model for every
   * walkability test — the hottest call in the game.
   */
  private blockedMask = new Uint8Array(0);
  /**
   * Tiles covered by a SPRITE_BUILDING's art. Only the anchor tile carries the
   * SPRITE_BUILDING type, so anything that reads the map by tile type — the
   * minimap most visibly — needs this to see a building rather than one pixel.
   */
  private spriteBuildingMask = new Uint8Array(0);
  private maskWidth = 0;
  private maskHeight = 0;

  /**
   * Decoration tiles bucketed by row, plus the few whose art reaches so far
   * past its anchor that row-bucket culling cannot bound it. Built once per
   * structure; see `ensureDecorationIndex`.
   */
  private _decorationRows: DecorationTile[][] = [];
  private _oversizedDecorations: DecorationTile[] = [];
  private _modestDecorationExtents: MapSpriteExtentsPx = { left: 0, up: 0, right: 0, down: 0 };
  /** Reused result of `getVisibleDecorationTiles` — holds references, never copies. */
  private readonly _visibleDecorations: DecorationTile[] = [];
  /**
   * Decoration tiles held out of the Y-sorted pass, by `tileCoordKey`: a
   * construction contract's rebuild spot stands stripped while the tile under
   * it keeps its prop, so the prop comes back the moment the key is removed.
   * Owned by whoever adds a key; nothing here ever clears it.
   */
  readonly hiddenDecorationTiles = new Set<number>();

  /**
   * Memoized results of `tilesOfType`. Exiting a building rebuilds the town's
   * systems against this same map instance, and without this cache each of them
   * would re-sweep all 78,400 tiles looking for wells and fountains — a visible
   * hitch at every shop door, for a list that cannot have changed.
   */
  private _tilesOfTypeCache = new Map<number, ReadonlyArray<{ x: number; y: number }>>();

  /**
   * A* scratch, sized to the grid and reused across searches. `pathGScore` and
   * `pathCameFrom` are only meaningful for tiles stamped with the current
   * `pathSearchGeneration`, which is what lets them go uncleared between calls.
   */
  private pathGScore = new Float64Array(0);
  private pathCameFrom = new Int32Array(0);
  private pathDiscoveredStamp = new Int32Array(0);
  private pathExpandedStamp = new Int32Array(0);
  private pathSearchGeneration = 0;
  private readonly pathOpenHeap = new MinHeap(ASTAR_OPEN_HEAP_CAPACITY);
  /** Walkability of the four cardinal neighbours of the node being expanded. */
  private readonly cardinalWalkable = [false, false, false, false];

  /** True when (tileX, tileY) is covered by a sprite building's artwork. */
  isSpriteBuildingTile(tileX: number, tileY: number): boolean {
    if (!this.isInsideGrid(tileX, tileY)) return false;
    return this.spriteBuildingMask[tileIndex(tileX, tileY, this.maskWidth)] === 1;
  }
  private _chunkCache: TileChunkCache | null = null;
  /**
   * Tiles whose base art changed since the last frame. Queued rather than
   * invalidated on the spot because the chunk cache is created lazily on the
   * first render, so a tile can change before there is a cache to tell.
   */
  private readonly _dirtyTiles: Array<{ x: number; y: number }> = [];
  private _overlayCache: OverlayTileCache | null = null;

  constructor(opts: GameMapOptions = {}) {
    const {
      mapSize = DEFAULT_MAP_SIZE,
      tileHeight = DEFAULT_TILE_HEIGHT,
      mapType,
      dungeon = { numBossRooms: DEFAULT_BOSS_ROOM_COUNT },
      prebuiltStructure,
      artSeed = drawFloorArtSeed(),
      worldSeed = drawWorldSeed(),
    } = opts;
    this.tileHeight = tileHeight;
    this.artSeed = artSeed;
    this.worldSeed = worldSeed;
    if (prebuiltStructure) {
      this.structure = prebuiltStructure;
    } else if (mapType === 'overworld') {
      this.structure = withWorldSeed(worldSeed, () => this.generateOverworldMap(mapSize));
    } else {
      this.structure = withWorldSeed(worldSeed, () =>
        this.generateDungeonMap({ ...dungeon, size: mapSize }),
      );
    }
    this.rebuildBlockedMasks();
    this.floorSurface = buildFloorSurface({
      grid: this.structure,
      regionMap: this.regionMap,
      characters: this.regionCharacters,
    });
    registerFloorSurface(this.structure, this.floorSurface);
  }

  private generateOverworldMap(size: number): TileContent[][] {
    const data = generateOverworld(size);
    this.startTile = data.startTile;
    this.safeRooms = data.safeRooms;
    this.buildingEntries = data.buildingEntries;
    this.townPlan = data.townPlan;
    this.bossRooms = data.bossRooms;
    this.mobSpawnPoints = [];
    this.hallwaySpawnPoints = data.hallwaySpawnPoints;
    this.setStairwellTiles(data.stairwellTiles);
    this.mainTowerAnchor = data.mainTowerAnchor;
    this.townSafeRadiusTiles = data.townSafeRadiusTiles;
    this.townSquareCentre = data.townSquareCentre;
    this.fountainCentre = data.fountainCentre;
    this.circusCentre = data.circusCentre;
    this.circusRadiusTiles = data.circusRadiusTiles;
    this.circusGrounds = data.circusGrounds;
    this.bountySites = data.bountySites;
    this.camps = data.camps;
    this.briarHollow = data.briarHollow;
    this.briarHollowPalisadeKeys = new Set(
      data.briarHollow.palisadePath.map((tile) => tileCoordKey(tile.x, tile.y)),
    );
    this.doomsdayEscapeTile = data.doomsdayEscapeTile;
    // Recorded now and applied by `rebuildBlockedMasks` once the grid is
    // installed: the gate never changes, so it belongs to the map itself and
    // holds even where no village system is running.
    for (const gate of data.briarHollow.gates) {
      for (const tile of gate.tiles) {
        this.hostileOnlyBlockedSet.add(tileCoordKey(tile.x, tile.y));
      }
    }
    registerBriarHollowSite(data.grid, data.briarHollow);
    registerCircusGroundsSite(data.grid, data.circusGrounds);
    return data.grid;
  }

  private generateDungeonMap(options: GenerateDungeonOptions): TileContent[][] {
    const data = generateDungeon(options);
    this.startTile = data.startTile;
    this.safeRooms = data.safeRooms;
    this.bossRooms = data.bossRooms;
    this.questRooms = data.questRooms;
    this.progressionLayout = data.progressionLayout;
    this.regionMap = data.regionMap;
    this.regionCharacters = data.regionCharacters;
    registerWallCharacters(data.grid, data.regionCharacters);
    this.wallFixtures = data.wallFixtures;
    registerWallFixtureFeet(data.grid, data.wallFixtures.map(fixtureFoot));
    // The flag goes on now and stays on; what changes is whether it is being
    // honoured. Every floor starts `clear`: the nursery is a room on the way,
    // not a toll gate, and nothing is shut until the player takes the wave.
    for (const room of data.questRooms) {
      for (const tile of room.exitDoorTiles) {
        this.questExitDoorTiles.set(tileCoordKey(tile.x, tile.y), data.grid[tile.y][tile.x].type);
        this.addBlockFlag(tile.x, tile.y, BLOCK_QUEST_EXIT);
      }
    }
    this.treasureRooms = data.treasureRooms;
    this.spiderLabRoom = data.spiderLabRoom;
    this.mobSpawnPoints = data.mobSpawnPoints;
    this.hallwaySpawnPoints = data.hallwaySpawnPoints;
    this.setStairwellTiles(data.stairwellTiles);
    this.arenaExteriors = data.arenaExteriors;
    for (const arena of data.arenaExteriors) {
      this.blockColosseumRimOverhang(data.grid, arena);
      const { x: doorX, y: doorY } = arena.doorTile;
      for (const dy of [0, -1]) {
        for (const dx of [-1, 0]) {
          this.addArenaDoorTile(doorX + dx, doorY + dy);
        }
      }
      // Also cover the south exit tiles carved in front of the door — unless the
      // door opens straight into a safe room, as it does on a progression floor,
      // where those tiles are the antechamber's own floor and sealing them would
      // block movement inside a safe room for the length of the fight.
      const insideSafeRoom = (x: number, y: number): boolean =>
        this.safeRooms.some(
          ({ bounds }) =>
            x >= bounds.x && x < bounds.x + bounds.w && y >= bounds.y && y < bounds.y + bounds.h,
        );
      for (const dx of [-1, 0]) {
        if (!insideSafeRoom(doorX + dx, doorY + 1)) this.addArenaDoorTile(doorX + dx, doorY + 1);
      }
    }
    return data.grid;
  }

  /** Locks the arena door so players cannot exit while the fight is active. */
  lockArenaDoor(): void {
    this.arenaDoorLocked = true;
  }

  /** Unlocks the arena door after the fight ends. */
  unlockArenaDoor(): void {
    this.arenaDoorLocked = false;
  }

  /** Adds the arena stairwell to the active stairwell list (call when Ball of Swine is defeated). */
  unlockArenaStairwell(): void {
    for (const arena of this.arenaExteriors) {
      const already = this.stairwellTiles.some(
        (s) => s.x === arena.stairwellTile.x && s.y === arena.stairwellTile.y,
      );
      if (!already) {
        this.setStairwellTiles([...this.stairwellTiles, arena.stairwellTile]);
      }
    }
  }

  /**
   * Sets the defense quest's onward doorway, swapping its art with it.
   *
   * Each state is its own tile type because base tiles are baked into reusable
   * chunk canvases, so the swap has to announce itself as a dirty tile or the
   * old art keeps being blitted over the new state.
   */
  setQuestExitDoorState(state: QuestExitDoorState): void {
    this.questExitDoorState = state;
    for (const [key, generatedType] of this.questExitDoorTiles) {
      const tileX = tileKeyX(key);
      const tileY = tileKeyY(key);
      if (!this.isInsideGrid(tileX, tileY)) continue;
      const doorType = questExitDoorTileType(state, generatedType);
      const tile = this.structure[tileY][tileX];
      if (tile.type === doorType) continue;
      // The smashed state paints the floor it opens back onto, and a doorway
      // inferring that floor from its neighbours would take the next room's.
      tile.groundType = generatedType;
      tile.type = doorType;
      this.markTileDirty(tileX, tileY);
    }
  }

  private addArenaDoorTile(tileX: number, tileY: number): void {
    this.arenaDoorTileSet.add(tileCoordKey(tileX, tileY));
    this.addBlockFlag(tileX, tileY, BLOCK_ARENA_DOOR);
  }

  /**
   * How far past the rim's own paint reach the connectivity check's local graph
   * extends — far enough to cover the whole concourse ring and a slice of the
   * antechamber, so a route around a blocked tile via the ring's other lane, or
   * down into the antechamber and back out its other link, is always visible to
   * the flood fill below.
   */
  private static readonly RIM_GRAPH_MARGIN_TILES = 4;

  /**
   * Blocks every concourse tile the colosseum's painted rim reaches into,
   * without ever cutting the concourse ring off from its own door.
   *
   * The rim is drawn against a true circle, so its iron and shadow land partway
   * across the first ring of concourse tiles outside the carved wall — the
   * generator only walls tiles up to `ARENA_RADIUS`, by tile centre, which is
   * short of where the continuous circle's paint actually stops. Left alone, a
   * crawler standing on the concourse can reach in and stand with their feet on
   * painted iron.
   *
   * A tile the paint reaches is not always safe to block, though: on a
   * progression floor the door row is sealed but for two single-tile flank
   * links down into the antechamber (`linkConcourseToAntechamber` in
   * `DungeonGenerator.ts`), and the tiles the ring needs to get from a link back
   * out into its own two-tile-wide band sit well within the rim's reach too.
   * Rather than hand-deriving every such pinch point from the carve constants,
   * this floods the local graph once before touching anything, floods it again
   * with every rim-covered tile provisionally blocked, and for any tile that
   * lost its way to the door as a result, walks the (guaranteed-connected)
   * baseline path back and reinstates whichever blocked tiles sit on it. What
   * is left blocked afterward can never disconnect anything the door could
   * already reach. Permanent because the geometry never changes once an arena
   * is placed.
   */
  private blockColosseumRimOverhang(grid: TileContent[][], arena: ArenaExterior): void {
    const centre = arena.centre;
    const reachRadius = Math.ceil(COLOSSEUM_RIM_PAINT_REACH_TILES);
    const graphRadius = ARENA_CONCOURSE_REACH + GameMap.RIM_GRAPH_MARGIN_TILES;
    const gridHeight = grid.length;
    const gridWidth = grid[0]?.length ?? 0;

    const isOpenGraphTile = (x: number, y: number): boolean =>
      x >= 0 &&
      x < gridWidth &&
      y >= 0 &&
      y < gridHeight &&
      Math.hypot(x - centre.x, y - centre.y) <= graphRadius &&
      isWalkableTileType(grid[y][x]);

    const candidates = new Set<number>();
    for (let dy = -reachRadius; dy <= reachRadius; dy++) {
      for (let dx = -reachRadius; dx <= reachRadius; dx++) {
        if (Math.hypot(dx, dy) <= ARENA_RADIUS) continue;
        if (!colosseumRimCoversTile(dx, dy)) continue;
        const x = centre.x + dx;
        const y = centre.y + dy;
        if (isOpenGraphTile(x, y)) candidates.add(tileCoordKey(x, y));
      }
    }
    if (candidates.size === 0) return;

    const neighborsOf = (x: number, y: number): Array<[number, number]> => [
      [x + 1, y],
      [x - 1, y],
      [x, y + 1],
      [x, y - 1],
    ];

    const floodFill = (
      root: { x: number; y: number },
      blocked: ReadonlySet<number>,
      parents?: Map<number, number>,
    ): Set<number> => {
      const rootKey = tileCoordKey(root.x, root.y);
      const seen = new Set<number>([rootKey]);
      const stack: Array<{ x: number; y: number }> = [root];
      while (stack.length > 0) {
        const cur = stack.pop();
        if (cur === undefined) break;
        const curKey = tileCoordKey(cur.x, cur.y);
        for (const [nx, ny] of neighborsOf(cur.x, cur.y)) {
          const key = tileCoordKey(nx, ny);
          if (seen.has(key) || blocked.has(key)) continue;
          if (!isOpenGraphTile(nx, ny)) continue;
          seen.add(key);
          parents?.set(key, curKey);
          stack.push({ x: nx, y: ny });
        }
      }
      return seen;
    };

    const parents = new Map<number, number>();
    const baseline = floodFill(arena.doorTile, new Set(), parents);

    const blocked = new Set(candidates);
    const reachableAfter = floodFill(arena.doorTile, blocked);

    for (const key of baseline) {
      if (candidates.has(key) || reachableAfter.has(key)) continue;
      // This tile is required (not itself up for blocking) and the provisional
      // block cut it off. Walk its baseline path back to the door — a path that
      // only ever crosses tiles the flood above already proved open — freeing
      // every candidate on it.
      let walk: number | undefined = key;
      while (walk !== undefined) {
        blocked.delete(walk);
        walk = parents.get(walk);
      }
    }

    for (const key of blocked) this.permanentBlockedTiles.add(key);
  }

  /**
   * Replaces the stairwell tile list and the block bits derived from it. The
   * two are set together because `isStairwellTile` reads the bits while
   * everything that renders or places stairs reads the list — assigning one
   * without the other silently disables stairwell detection.
   */
  setStairwellTiles(tiles: ReadonlyArray<{ x: number; y: number }>): void {
    this._stairwellTiles = tiles;
    this.buildStairwellBlockedSet(tiles);
  }

  private buildStairwellBlockedSet(tiles: ReadonlyArray<{ x: number; y: number }>): void {
    for (const key of this.stairwellBlockedSet) {
      this.removeBlockFlag(tileKeyX(key), tileKeyY(key), BLOCK_STAIRWELL);
    }
    this.stairwellBlockedSet.clear();
    for (const s of tiles) {
      this.addToStairwellBlockedSet(s);
    }
  }

  private addToStairwellBlockedSet(s: { x: number; y: number }): void {
    for (let dy = 0; dy <= 1; dy++) {
      for (let dx = 0; dx <= 1; dx++) {
        this.stairwellBlockedSet.add(tileCoordKey(s.x + dx, s.y + dy));
        this.addBlockFlag(s.x + dx, s.y + dy, BLOCK_STAIRWELL);
      }
    }
  }

  /**
   * Applies one town interior layout file's entries to a freshly carved
   * grid: a 'tile' entry writes a tile type directly (via `placeProp` when
   * `smashable`, matching what the old switch case did for a breakable
   * legacy fixture); a 'prop' entry registers a placed prop instance and
   * blocks its footprint, mirroring how the Desperado Club's furniture
   * blocks the tiles `CLUB_FURNITURE_TILES` names.
   */
  private applyTownInteriorLayout(
    grid: TileContent[][],
    entries: ReadonlyArray<TownInteriorLayoutEntry>,
  ): void {
    for (const entry of entries) {
      if (entry.kind === 'tile') {
        if (entry.smashable === true) placeProp(grid[entry.y][entry.x], entry.tileType);
        else grid[entry.y][entry.x].type = entry.tileType;
        continue;
      }
      const propDef = TOWN_INTERIOR_PROPS[entry.propId];
      this._placedInteriorProps.push({
        propId: entry.propId,
        variant: entry.variant ?? 0,
        tile: { x: entry.x, y: entry.y },
        id: stableInteriorPropId(entry),
        dropsLoot: entry.dropsLoot,
      });
      if (!propDef.walkable) {
        for (let dy = 0; dy < propDef.footprint.h; dy++)
          for (let dx = 0; dx < propDef.footprint.w; dx++)
            this.blockTilePermanently(entry.x + dx, entry.y + dy);
      }
    }
  }

  /** Generates a small interior room for a building (called externally after construction).
   *  For towers, pass towerFloor (0-3) to generate per-floor stair layout. */
  generateInterior(
    buildingType: BuildingKind,
    towerFloor = 0,
    buildingName = '',
    hasSafeRoom = false,
    variant: InteriorVariant = 'default',
  ): void {
    this._placedInteriorProps = [];
    setTownInteriorWallMaterial(buildingName);
    setBigTopDecorLayout(null);
    if (variant !== 'default') {
      this.generateBigTopMaze(variant.plan);
      return;
    }
    const isTower = buildingType === 'tower';
    const isStore = buildingType === 'store';
    const isClub = buildingType === 'club';
    const isHouse = buildingType === 'house';
    const isCarnival = buildingName === 'Big Top';
    const { w, h, floorType } =
      INTERIOR_BY_NAME.get(buildingName) ?? INTERIOR_BY_KIND[buildingType];

    const grid: TileContent[][] = Array.from({ length: h }, (_, y) =>
      Array.from({ length: w }, (_, x) => ({
        tileId: `${x}#${y}`,
        type: INTERIOR_WALL,
      })),
    );

    // Carve interior floor
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) grid[y][x].type = floorType;

    if (isStore && !isCarnival) {
      this.applyTownInteriorLayout(grid, buildGeneralStoreLayout(w, h, floorType));
    }

    if (isClub) {
      // Central dance floor
      for (let y = CLUB_DANCE_FLOOR.y0; y <= CLUB_DANCE_FLOOR.y1; y++)
        for (let x = CLUB_DANCE_FLOOR.x0; x <= CLUB_DANCE_FLOOR.x1; x++)
          grid[y][x].type = DANCE_FLOOR;
      // Alcove divider walls (never seal a region — the dance-floor rows stay open)
      for (const wall of CLUB_DIVIDER_WALLS)
        for (let y = wall.y0; y <= wall.y1; y++) grid[y][wall.x].type = INTERIOR_WALL;
      // Furniture collision — the club's props are sprites in the interior's
      // Y-sorted pass rather than tile types, so their tiles still render as
      // floor and have to be blocked here.
      for (const t of CLUB_FURNITURE_TILES) this.blockTilePermanently(t.x, t.y);
    }

    // ── Named building interiors — each reads its layout from a per-building file ──
    const isNamedBuilding = NAMED_INTERIOR_LAYOUTS.has(buildingName);

    if (isHouse && isNamedBuilding) {
      const layout = NAMED_INTERIOR_LAYOUTS.get(buildingName);
      if (layout !== undefined) this.applyTownInteriorLayout(grid, layout(w, h, floorType));
    }

    // ── Generic house furniture (unnamed / unnamed overworld houses) ──
    if (isHouse && !isCarnival && !isNamedBuilding) {
      const genericFireplaceCol1 = 8;
      const genericFireplaceCol2 = 9;
      const genericRugStartCol = 7;
      const genericRugEndCol = 10;
      const genericBedNorthRow = 2;
      const genericBedSouthRow = 3;
      // HOUSE_INTERIOR_W=18: east col=16, second-from-east=15
      const HOUSE_EAST_WALL_COL = HOUSE_INTERIOR_W - 2;
      const HOUSE_SECOND_EAST_COL = HOUSE_INTERIOR_W - 2 - 1;
      // HOUSE_INTERIOR_H=14: south row index=13, pre-south=11, two-before-south=10
      const HOUSE_PRE_SOUTH_ROW = HOUSE_INTERIOR_H - 2 - 1;
      const HOUSE_BARREL_ROW = HOUSE_INTERIOR_H - 2 - 2;
      const genericBedWestCol = HOUSE_SECOND_EAST_COL;
      const genericBedEastCol = HOUSE_EAST_WALL_COL;
      const genericShelfStartRow = 3;
      const genericShelfEndRow = 5;
      const genericTableRow = 7;
      const genericTableCol1 = 7;
      const genericTableCol2 = 8;
      const genericTableCol3 = 9;
      const genericChairRow = 8;
      const genericSouthRow = HOUSE_PRE_SOUTH_ROW;
      const genericEastWallCol = HOUSE_EAST_WALL_COL;
      const genericEastBarrelRow = HOUSE_BARREL_ROW;
      const genericEastChairRow = 6;
      // Fireplace centered on north wall
      grid[1][genericFireplaceCol1].type = FIREPLACE;
      grid[1][genericFireplaceCol2].type = FIREPLACE;
      // Rug in front of fireplace
      for (let x = genericRugStartCol; x <= genericRugEndCol; x++) {
        grid[2][x].type = RUG;
        grid[genericBedSouthRow][x].type = RUG;
      }
      // Bed in NE corner
      grid[genericBedNorthRow][genericBedWestCol].type = BED;
      grid[genericBedNorthRow][genericBedEastCol].type = BED;
      grid[genericBedSouthRow][genericBedWestCol].type = BED;
      grid[genericBedSouthRow][genericBedEastCol].type = BED;
      placeProp(grid[genericShelfStartRow][1], BOOKSHELF);
      placeProp(grid[genericShelfStartRow + 1][1], BOOKSHELF);
      placeProp(grid[genericShelfEndRow][1], BOOKSHELF);
      // Dining table with chairs in center-south area
      grid[genericTableRow][genericTableCol1].type = TABLE;
      grid[genericTableRow][genericTableCol2].type = TABLE;
      grid[genericTableRow][genericTableCol3].type = TABLE;
      grid[genericChairRow][genericTableCol1].type = CHAIR;
      grid[genericChairRow][genericTableCol3].type = CHAIR;
      // Barrel in SW corner
      placeProp(grid[genericSouthRow][1], BARREL);
      placeProp(grid[genericSouthRow][2], BARREL);
      // Barrel in SE area
      placeProp(grid[genericEastBarrelRow][genericEastWallCol], BARREL);
      // Chair by east wall
      grid[genericEastChairRow][genericEastWallCol].type = CHAIR;
    }

    if (isCarnival) {
      // Big top boss arena: painted performance ring, central tent pole
      // cluster, and bleachers hugging the north/west/east walls.
      const ringCx = Math.floor(w / 2);
      const ringCy = Math.floor(h / 2) - BIGTOP_RING_NORTH_SHIFT;
      // The curb tiles below are the tiles whose centres sit on the ring, so
      // the painted curb is centred on the middle of the centre tile; the pole
      // is the 2×2 whose shared corner is that tile's top-left.
      setBigTopDecorLayout({
        kind: 'arena',
        ringCentre: { x: ringCx + TILE_CENTRE_OFFSET, y: ringCy + TILE_CENTRE_OFFSET },
        ringRadius: BIGTOP_RING_RADIUS,
        poleCentre: { x: ringCx, y: ringCy },
      });

      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          const dist = Math.hypot(x - ringCx, y - ringCy);
          if (Math.round(dist) === BIGTOP_RING_RADIUS) grid[y][x].type = CIRCUS_RING_EDGE;
        }
      }

      for (let dy = 0; dy <= 1; dy++) {
        for (let dx = 0; dx <= 1; dx++) {
          grid[ringCy - dy][ringCx - dx].type = TENT_POLE;
        }
      }

      const bleacherSouthLimit = h - BIGTOP_RING_RADIUS + 1;
      for (let depth = 1; depth <= BIGTOP_BLEACHER_DEPTH; depth++) {
        // Wall to wall, so the north stand meets the two side stands rather than
        // stopping short of them. Insetting it left a pocket of bare floor in
        // each north corner, walled in by bleachers on both sides — floor the
        // player could see across the ring and never reach.
        for (let x = 1; x < w - 1; x++) {
          grid[depth][x].type = BLEACHER;
        }
        for (let y = 1 + BIGTOP_BLEACHER_DEPTH; y < bleacherSouthLimit; y++) {
          grid[y][depth].type = BLEACHER;
          grid[y][w - 1 - depth].type = BLEACHER;
        }
      }

      this._bigtopRingCentre = { x: ringCx, y: ringCy };
    } else {
      this._bigtopRingCentre = null;
    }

    // Exit door: 2-tile gap at bottom wall center (leave as road = walkable)
    const doorX = Math.floor(w / 2) - 1;
    grid[h - 1][doorX].type = FloorTypeValue.road;
    grid[h - 1][doorX + 1].type = FloorTypeValue.road;

    this.structure = grid;
    this.rebuildBlockedMasks();
    this.startTile = { x: Math.floor(w / 2), y: h - 2 };
    this.setStairwellTiles([]);
    this.buildingEntries = [];
    this.bossRooms = [];
    this.mobSpawnPoints = [];
    this.hallwaySpawnPoints = [];
    // Only ground floor (towerFloor 0) or non-tower buildings have exit doors
    if (isTower && towerFloor > 0) {
      // Upper floors: wall off the door gap (no exit)
      grid[h - 1][doorX].type = INTERIOR_WALL;
      grid[h - 1][doorX + 1].type = INTERIOR_WALL;
      this._interiorExitTiles = [];
    } else {
      this._interiorExitTiles = [
        { x: doorX, y: h - 1 },
        { x: doorX + 1, y: h - 1 },
      ];
    }

    // Tower stair placement per floor
    this._interiorStairUpTiles = [];
    this._interiorStairDownTiles = [];
    if (isTower) {
      // Stairs up: upper-right area; stairs down: upper-left. Each is a square
      // block of TOWER_STAIR_SPAN tiles a side, which is what the spiral art needs
      // to read as a staircase rather than a step pattern on a floor tile.
      const upX = w - TOWER_STAIR_UP_X_OFFSET;
      const dnX = TOWER_STAIR_DOWN_COL;
      const stairRow = TOWER_STAIR_ROW;

      const fillStairBlock = (
        originX: number,
        originY: number,
        type: number,
      ): Array<{ x: number; y: number }> => {
        const tiles: Array<{ x: number; y: number }> = [];
        for (let dy = 0; dy < TOWER_STAIR_SPAN; dy++) {
          for (let dx = 0; dx < TOWER_STAIR_SPAN; dx++) {
            // `placeProp`, not a bare type write: it records the floor the stair
            // replaced, and the stair is drawn as an overlay over that floor.
            placeProp(grid[originY + dy][originX + dx], type);
            tiles.push({ x: originX + dx, y: originY + dy });
          }
        }
        return tiles;
      };

      const hasUp = towerFloor < TOWER_TOP_FLOOR;
      const hasDown = towerFloor > 0;
      const stairs: TowerStairOrigins = {
        up: hasUp ? { x: upX, y: stairRow } : null,
        down: hasDown ? { x: dnX, y: stairRow } : null,
        span: TOWER_STAIR_SPAN,
      };

      // Before the stairs, so each stair block records the storey's own floor
      // material as the floor it stands on.
      this.applyTownInteriorLayout(grid, buildTownCenterTowerLayout(towerFloor, w, h, stairs));

      if (stairs.up !== null) {
        this._interiorStairUpTiles = fillStairBlock(stairs.up.x, stairs.up.y, STAIRS_UP);
      }
      if (stairs.down !== null) {
        this._interiorStairDownTiles = fillStairBlock(stairs.down.x, stairs.down.y, STAIRS_DOWN);
      }
    }

    if (hasSafeRoom) {
      const wholeInterior = { x: 1, y: 1, w: w - 2, h: h - 2 };
      const bounds = SAFE_ROOM_BOUNDS_BY_NAME.get(buildingName) ?? wholeInterior;
      this.safeRooms = [
        {
          bounds,
          centre: {
            x: bounds.x + Math.floor(bounds.w / 2),
            y: bounds.y + Math.floor(bounds.h / 2),
          },
        },
      ];
    } else {
      this.safeRooms = [];
    }
  }

  /**
   * The Big Top as it stands during the final act: an authored trap maze with
   * two flaps, two sealed halves, and one chamber at the tent pole.
   *
   * Built from the layout table rather than by the ring-arena branch above
   * because the vent choreography is timed against exact corridor lengths — a
   * layout that drifted by a tile would quietly make one of them unsurvivable.
   *
   * Public so a tent restarted on another difficulty can be rebuilt on the same
   * map, which every system in the room already holds.
   */
  generateBigTopMaze(plan: BigTopMazePlan): void {
    setBigTopDecorLayout({ kind: 'maze', plan });
    const grid: TileContent[][] = plan.rows.map((row, y) =>
      Array.from({ length: row.length }, (_unused, x) => ({
        tileId: `${x}#${y}`,
        type: mazeTileTypeFor(row[x]),
      })),
    );

    for (const exit of MAZE_EXIT_TILES) grid[exit.y][exit.x].type = FloorTypeValue.road;

    this.structure = grid;
    this.rebuildBlockedMasks();
    this.startTile = { x: MAZE_HUMAN_SPAWN_TILE.x, y: MAZE_HUMAN_SPAWN_TILE.y };
    this.setStairwellTiles([]);
    this.buildingEntries = [];
    this.bossRooms = [];
    this.mobSpawnPoints = [];
    this.hallwaySpawnPoints = [];
    this.safeRooms = [];
    this._interiorExitTiles = MAZE_EXIT_TILES.map((tile) => ({ x: tile.x, y: tile.y }));
    this._interiorStairUpTiles = [];
    this._interiorStairDownTiles = [];
    // No performance ring in the maze; the pole is furniture the layout owns.
    this._bigtopRingCentre = null;
  }

  /** Exit tile positions populated by generateInterior — used by BuildingInteriorScene. */
  _interiorExitTiles: Array<{ x: number; y: number }> = [];
  /** Centre of the big top's performance ring — set only for the Big Top interior. */
  private _bigtopRingCentre: { x: number; y: number } | null = null;

  get bigtopRingCentre(): { x: number; y: number } | null {
    return this._bigtopRingCentre;
  }
  /** Interior stair-up tile positions (tower floors). */
  _interiorStairUpTiles: Array<{ x: number; y: number }> = [];
  /** Interior stair-down tile positions (tower floors). */
  _interiorStairDownTiles: Array<{ x: number; y: number }> = [];

  /**
   * A* pathfinding on the tile grid. Returns an ordered array of tile
   * coordinates from start to goal (inclusive), or an empty array if no path
   * exists. Diagonals are allowed but blocked when they cut through a wall
   * corner. Capped at MAX_NODES expansions for predictable per-frame cost.
   */
  findPath(
    startX: number,
    startY: number,
    goalX: number,
    goalY: number,
    maxDistanceTiles = MOB_MAX_PATH_DISTANCE_TILES,
    forHostile = false,
  ): Array<{ x: number; y: number }> {
    if (!this.isWalkableFor(goalX, goalY, forHostile)) return [];
    if (startX === goalX && startY === goalY) return [{ x: goalX, y: goalY }];

    const goalDistanceTiles = Math.max(Math.abs(goalX - startX), Math.abs(goalY - startY));
    if (goalDistanceTiles > maxDistanceTiles) return [];

    const width = this.maskWidth;
    if (!this.isInsideGrid(startX, startY)) return [];
    this.ensurePathScratch();

    // A short hop must not be allowed to flood a wide radius of open ground.
    const reach = goalDistanceTiles * ASTAR_EXPANSIONS_PER_TILE;
    const maxExpansions = Math.min(
      ASTAR_MAX_NODE_EXPANSIONS,
      ASTAR_BASE_EXPANSIONS + reach * reach,
    );

    const goalIndex = tileIndex(goalX, goalY, width);
    const startIndex = tileIndex(startX, startY, width);
    const generation = ++this.pathSearchGeneration;

    this.pathOpenHeap.clear();
    this.pathGScore[startIndex] = 0;
    this.pathCameFrom[startIndex] = PATH_NO_PARENT;
    this.pathDiscoveredStamp[startIndex] = generation;
    this.pathOpenHeap.push(startIndex, manhattanDistance(startX, startY, goalX, goalY));

    let expanded = 0;
    while (expanded < maxExpansions) {
      const current = this.pathOpenHeap.pop();
      if (current === HEAP_EMPTY) break;
      // The heap holds stale duplicates of improved nodes; skip already-expanded ones.
      if (this.pathExpandedStamp[current] === generation) continue;
      this.pathExpandedStamp[current] = generation;

      if (current === goalIndex) return this.rebuildPath(current, width);
      expanded++;

      const cx = current % width;
      const cy = (current - cx) / width;
      const currentG = this.pathGScore[current];

      for (let i = 0; i < CARDINAL_STEPS.length; i++) {
        const step = CARDINAL_STEPS[i];
        this.cardinalWalkable[i] = this.isWalkableFor(cx + step.dx, cy + step.dy, forHostile);
        if (!this.cardinalWalkable[i]) continue;
        this.relaxNeighbor(
          cx + step.dx,
          cy + step.dy,
          currentG + CARDINAL_MOVE_COST,
          current,
          generation,
          width,
          goalX,
          goalY,
        );
      }

      for (const diagonal of DIAGONAL_STEPS) {
        // Diagonal moves may not cut through a wall corner.
        if (!this.cardinalWalkable[diagonal.horizontal]) continue;
        if (!this.cardinalWalkable[diagonal.vertical]) continue;
        const nx = cx + diagonal.dx;
        const ny = cy + diagonal.dy;
        if (!this.isWalkableFor(nx, ny, forHostile)) continue;
        this.relaxNeighbor(
          nx,
          ny,
          currentG + DIAGONAL_MOVE_COST,
          current,
          generation,
          width,
          goalX,
          goalY,
        );
      }
    }

    return [];
  }

  /**
   * Records a cheaper route to a neighbour and queues it. Node identity is the
   * packed tile index, so nothing is allocated per expansion.
   */
  private relaxNeighbor(
    tileX: number,
    tileY: number,
    tentativeG: number,
    parentIndex: number,
    generation: number,
    width: number,
    goalX: number,
    goalY: number,
  ): void {
    const index = tileIndex(tileX, tileY, width);
    if (this.pathExpandedStamp[index] === generation) return;
    const alreadyDiscovered = this.pathDiscoveredStamp[index] === generation;
    if (alreadyDiscovered && this.pathGScore[index] <= tentativeG) return;

    this.pathDiscoveredStamp[index] = generation;
    this.pathGScore[index] = tentativeG;
    this.pathCameFrom[index] = parentIndex;
    this.pathOpenHeap.push(index, tentativeG + manhattanDistance(tileX, tileY, goalX, goalY));
  }

  private rebuildPath(goalIndex: number, width: number): Array<{ x: number; y: number }> {
    const reversed: Array<{ x: number; y: number }> = [];
    let index = goalIndex;
    while (index !== PATH_NO_PARENT) {
      const x = index % width;
      reversed.push({ x, y: (index - x) / width });
      index = this.pathCameFrom[index];
    }
    reversed.reverse();
    return reversed;
  }

  /**
   * Allocates the A* scratch buffers to match the current grid. They are reused
   * across calls and never cleared — `pathSearchGeneration` stamping tells a
   * live entry from a leftover one.
   */
  private ensurePathScratch(): void {
    const cellCount = this.maskWidth * this.maskHeight;
    if (this.pathGScore.length === cellCount) return;
    this.pathGScore = new Float64Array(cellCount);
    this.pathCameFrom = new Int32Array(cellCount);
    this.pathDiscoveredStamp = new Int32Array(cellCount);
    this.pathExpandedStamp = new Int32Array(cellCount);
  }

  /**
   * Rebuilds `blockedMask` and `spriteBuildingMask` for the current structure:
   * multi-tile footprints are re-derived from the grid, and the runtime block
   * sets are re-applied on top. Call after any replacement of `structure`.
   */
  private rebuildBlockedMasks(): void {
    this._decorationRows = [];
    this._tilesOfTypeCache = new Map();
    // Both caches capture the grid's width when they are built, so a replaced
    // structure must not keep them.
    this._chunkCache = null;
    this._overlayCache = null;
    this.maskHeight = this.structure.length;
    this.maskWidth = this.structure[0]?.length ?? 0;
    const cellCount = this.maskWidth * this.maskHeight;
    this.blockedMask = new Uint8Array(cellCount);
    this.spriteBuildingMask = new Uint8Array(cellCount);

    for (let ty = 0; ty < this.maskHeight; ty++) {
      const row = this.structure[ty];
      for (let tx = 0; tx < row.length; tx++) {
        const tile = row[tx];
        const isSpriteBuilding = tile.type === SPRITE_BUILDING && tile.spriteKey !== undefined;
        const offsets =
          isSpriteBuilding && tile.spriteKey !== undefined
            ? getBlockedTileOffsetsByKey(tile.spriteKey)
            : getBlockedTileOffsets(tile.type);
        for (const { dx, dy } of offsets) {
          this.addBlockFlag(tx + dx, ty + dy, BLOCK_EXTRA);
          if (isSpriteBuilding) this.markSpriteBuildingTile(tx + dx, ty + dy);
        }
        if (isSpriteBuilding) this.markSpriteBuildingTile(tx, ty);
      }
    }

    this.applyBlockKeySet(this.permanentBlockedTiles, BLOCK_PERMANENT);
    this.applyBlockKeySet(this.arenaDoorTileSet, BLOCK_ARENA_DOOR);
    this.applyBlockKeySet(this.questExitDoorTiles.keys(), BLOCK_QUEST_EXIT);
    this.applyBlockKeySet(this.stairwellBlockedSet, BLOCK_STAIRWELL);
    this.applyBlockKeySet(this.structureBlockedSet, BLOCK_STRUCTURE);
    this.applyBlockKeySet(this.hostileOnlyBlockedSet, BLOCK_HOSTILE_ONLY);
  }

  private applyBlockKeySet(keys: Iterable<number>, flag: number): void {
    for (const key of keys) {
      this.addBlockFlag(tileKeyX(key), tileKeyY(key), flag);
    }
  }

  /** Tiles outside the grid are silently ignored — footprints may overhang the edge. */
  private addBlockFlag(tileX: number, tileY: number, flag: number): void {
    if (!this.isInsideGrid(tileX, tileY)) return;
    this.blockedMask[tileIndex(tileX, tileY, this.maskWidth)] |= flag;
  }

  private removeBlockFlag(tileX: number, tileY: number, flag: number): void {
    if (!this.isInsideGrid(tileX, tileY)) return;
    this.blockedMask[tileIndex(tileX, tileY, this.maskWidth)] &= ~flag;
  }

  private markSpriteBuildingTile(tileX: number, tileY: number): void {
    if (!this.isInsideGrid(tileX, tileY)) return;
    this.spriteBuildingMask[tileIndex(tileX, tileY, this.maskWidth)] = 1;
  }

  private isInsideGrid(tileX: number, tileY: number): boolean {
    return tileX >= 0 && tileY >= 0 && tileX < this.maskWidth && tileY < this.maskHeight;
  }

  /** Reserves a tile under a player-built structure. Undone by {@link unblockStructureTile}. */
  blockStructureTile(tileX: number, tileY: number): void {
    this.structureBlockedSet.add(tileCoordKey(tileX, tileY));
    this.addBlockFlag(tileX, tileY, BLOCK_STRUCTURE);
  }

  unblockStructureTile(tileX: number, tileY: number): void {
    this.structureBlockedSet.delete(tileCoordKey(tileX, tileY));
    this.removeBlockFlag(tileX, tileY, BLOCK_STRUCTURE);
  }

  /** Whether a structure's footprint reserves this tile. */
  isStructureTile(tileX: number, tileY: number): boolean {
    if (!this.isInsideGrid(tileX, tileY)) return false;
    return (this.blockedMask[tileIndex(tileX, tileY, this.maskWidth)] & BLOCK_STRUCTURE) !== 0;
  }

  /** Every structure-reserved tile, as `tileCoordKey` values. */
  structureTileKeys(): ReadonlySet<number> {
    return this.structureBlockedSet;
  }

  /** Turns a tile into (or back out of) one only hostile mobs cannot enter. */
  setHostileOnlyBlock(tileX: number, tileY: number, on: boolean): void {
    const key = tileCoordKey(tileX, tileY);
    if (on) {
      this.hostileOnlyBlockedSet.add(key);
      this.addBlockFlag(tileX, tileY, BLOCK_HOSTILE_ONLY);
      return;
    }
    this.hostileOnlyBlockedSet.delete(key);
    this.removeBlockFlag(tileX, tileY, BLOCK_HOSTILE_ONLY);
  }

  blockTilePermanently(tileX: number, tileY: number): void {
    this.permanentBlockedTiles.add(tileCoordKey(tileX, tileY));
    this.addBlockFlag(tileX, tileY, BLOCK_PERMANENT);
  }

  /**
   * Inverse of {@link blockTilePermanently}, for a placed town interior prop
   * a swing has just broken: the tile has no tile-type identity to reset (it
   * was floor the whole time), so walkability comes back the moment this
   * flag lifts rather than through `breakProp`'s tile-type rewrite.
   */
  unblockTilePermanently(tileX: number, tileY: number): void {
    this.permanentBlockedTiles.delete(tileCoordKey(tileX, tileY));
    this.removeBlockFlag(tileX, tileY, BLOCK_PERMANENT);
  }

  /**
   * The runtime mutations a safe-room checkpoint has to be able to put back.
   *
   * "Permanent" in `blockTilePermanently` means "for the map's lifetime", which
   * is not the same as "for the run's": a wall a quest raised after the
   * checkpoint has to come down again when that quest is rewound, or the player
   * respawns into a floor sealed by an event that no longer happened.
   */
  captureCheckpoint(): GameMapCheckpoint {
    return {
      arenaDoorLocked: this.arenaDoorLocked,
      questExitDoorState: this.questExitDoorState,
      permanentBlockedTiles: [...this.permanentBlockedTiles],
      stairwellTiles: this._stairwellTiles.map((tile) => ({ x: tile.x, y: tile.y })),
      structureBlockedTiles: [...this.structureBlockedSet],
    };
  }

  restoreCheckpoint(snapshot: GameMapCheckpoint): void {
    this.arenaDoorLocked = snapshot.arenaDoorLocked;
    // A resolved encounter is banked: the doorway her wave smashed open must
    // not come back boarded behind a player who respawns at a checkpoint taken
    // before it.
    this.setQuestExitDoorState(snapshot.questExitDoorState);

    // The mask is only rebuilt wholesale when the structure changes, so a key
    // dropped from the set without its bit being cleared leaves the tile
    // blocked until the next regeneration — which for a dungeon floor is never.
    const restoredKeys = new Set(snapshot.permanentBlockedTiles);
    for (const key of this.permanentBlockedTiles) {
      if (restoredKeys.has(key)) continue;
      this.removeBlockFlag(tileKeyX(key), tileKeyY(key), BLOCK_PERMANENT);
    }
    this.permanentBlockedTiles.clear();
    for (const key of restoredKeys) {
      this.permanentBlockedTiles.add(key);
      this.addBlockFlag(tileKeyX(key), tileKeyY(key), BLOCK_PERMANENT);
    }

    // Through the setter, which owns the BLOCK_STAIRWELL bits as well as the
    // list. This is what re-hides the arena stairwell that `unlockArenaStairwell`
    // revealed — that method appends and has no inverse of its own.
    this.setStairwellTiles(snapshot.stairwellTiles.map((tile) => ({ x: tile.x, y: tile.y })));

    for (const key of [...this.structureBlockedSet]) {
      this.unblockStructureTile(tileKeyX(key), tileKeyY(key));
    }
    for (const key of snapshot.structureBlockedTiles ?? []) {
      this.blockStructureTile(tileKeyX(key), tileKeyY(key));
    }
  }

  /**
   * Every tile of `type`, in row-major order. The result is cached per map and
   * must be treated as read-only. Only for tile types that are fixed for a map's
   * lifetime — a type a runtime event can create or destroy would go stale.
   */
  tilesOfType(type: number): ReadonlyArray<{ x: number; y: number }> {
    const cached = this._tilesOfTypeCache.get(type);
    if (cached !== undefined) return cached;

    const found: Array<{ x: number; y: number }> = [];
    for (let ty = 0; ty < this.structure.length; ty++) {
      const row = this.structure[ty];
      for (let tx = 0; tx < row.length; tx++) {
        if (row[tx].type === type) found.push({ x: tx, y: ty });
      }
    }
    this._tilesOfTypeCache.set(type, found);
    return found;
  }

  /** Number of tiles along one edge of the (square) map grid. */
  get gridSize(): number {
    return this.structure.length;
  }

  /** Town safe-zone radius in tiles, or null off the overworld. */
  get townSafeRadius(): number | null {
    return this.townSafeRadiusTiles;
  }

  /**
   * True when the given world-pixel position falls inside the overworld town's
   * safe radius. Always false on non-overworld maps (townSafeRadiusTiles is null).
   */
  isInTownSafeZone(worldX: number, worldY: number): boolean {
    if (this.townSafeRadiusTiles === null) return false;
    // Measured from the plaza, not from `gridSize / 2`. The two coincide today only
    // because the plaza happens to be centred on the map. This is what tells the
    // ruins ghouls and the krasue to break off a chase, and what switches the
    // overworld music between town and wilderness, so it should follow the town.
    // (Spawn *placement* is a separate thing: `scatterRuinsSpawnPoints` filters
    // against `plan.centre` at generation time and never calls this.)
    const mapCentre = Math.floor(this.structure.length / 2);
    const centre = this.townSquareCentre ?? { x: mapCentre, y: mapCentre };
    const dxTiles = worldX / this.tileHeight - centre.x;
    const dyTiles = worldY / this.tileHeight - centre.y;
    return (
      dxTiles * dxTiles + dyTiles * dyTiles <= this.townSafeRadiusTiles * this.townSafeRadiusTiles
    );
  }

  /**
   * True when the given world-pixel position lies strictly inside the town wall
   * ring. Always false on maps with no town plan.
   *
   * Not {@link isInTownSafeZone}: that circle reaches past the wall and takes in
   * the gate aprons and open fields beyond them, so it cannot answer "is the party
   * in town" for anything the wall is meant to bound.
   */
  isInsideTownWall(worldX: number, worldY: number): boolean {
    return this.isTileInsideTownWall(
      Math.floor(worldX / this.tileHeight),
      Math.floor(worldY / this.tileHeight),
    );
  }

  /**
   * True when the given world-pixel position is inside Briar Hollow's palisade
   * (its interior rectangle). Always false off the overworld.
   *
   * The village is deliberately **not** a safe zone: this never feeds
   * `isInTownSafeZone`, and hostiles may follow the party in.
   */
  isInBriarHollow(worldX: number, worldY: number): boolean {
    const interior = this.briarHollow?.interior;
    if (interior === undefined) return false;
    const tileX = Math.floor(worldX / this.tileHeight);
    const tileY = Math.floor(worldY / this.tileHeight);
    return (
      tileX >= interior.x &&
      tileY >= interior.y &&
      tileX < interior.x + interior.w &&
      tileY < interior.y + interior.h
    );
  }

  /**
   * True when the given world-pixel position lies within the circus grounds'
   * radius of `circusCentre`, widened by `marginTiles`. Always false off the
   * overworld.
   */
  isInCircusGrounds(worldX: number, worldY: number, marginTiles = 0): boolean {
    const centre = this.circusCentre;
    const radiusTiles = this.circusRadiusTiles;
    if (centre === undefined || radiusTiles === undefined) return false;
    const reachTiles = radiusTiles + marginTiles;
    const dxTiles = worldX / this.tileHeight - centre.x;
    const dyTiles = worldY / this.tileHeight - centre.y;
    return dxTiles * dxTiles + dyTiles * dyTiles <= reachTiles * reachTiles;
  }

  /**
   * Which Briar Hollow district the given world-pixel position is in — the
   * first listed district whose rectangle contains it — or null outside them
   * all, and always off the overworld.
   */
  briarHollowDistrictAt(worldX: number, worldY: number): VillageDistrictId | null {
    const districts = this.briarHollow?.districts;
    if (districts === undefined) return null;
    const tileX = Math.floor(worldX / this.tileHeight);
    const tileY = Math.floor(worldY / this.tileHeight);
    for (const district of districts) {
      const { rect } = district;
      const inside =
        tileX >= rect.x && tileY >= rect.y && tileX < rect.x + rect.w && tileY < rect.y + rect.h;
      if (inside) return district.id;
    }
    return null;
  }

  /**
   * True when a Briar Hollow palisade tile (not the gate) lies within `tiles`
   * tiles of the given world-pixel position, measured centre to centre.
   * Always false off the overworld.
   */
  isNearPalisade(worldX: number, worldY: number, tiles: number): boolean {
    if (this.briarHollowPalisadeKeys.size === 0) return false;
    const tileX = worldX / this.tileHeight;
    const tileY = worldY / this.tileHeight;
    const reach = Math.ceil(tiles);
    const centreX = Math.floor(tileX);
    const centreY = Math.floor(tileY);
    const halfTile = 0.5;
    for (let dy = -reach; dy <= reach; dy++) {
      for (let dx = -reach; dx <= reach; dx++) {
        const x = centreX + dx;
        const y = centreY + dy;
        if (!this.briarHollowPalisadeKeys.has(tileCoordKey(x, y))) continue;
        if (Math.hypot(x + halfTile - tileX, y + halfTile - tileY) <= tiles) return true;
      }
    }
    return false;
  }

  /**
   * True when no hostile may be spawned on this tile for Briar Hollow's sake:
   * inside its spawn exclusion (the palisade plus a margin) or its keep-out
   * (roads, quarry, ruins). Always false off the overworld.
   */
  isTileInBriarHollowSpawnExclusion(tileX: number, tileY: number): boolean {
    const site = this.briarHollow;
    if (site === null) return false;
    const rect = site.spawnExclusion;
    const inRect =
      tileX >= rect.x && tileY >= rect.y && tileX < rect.x + rect.w && tileY < rect.y + rect.h;
    return inRect || site.keepOut.contains(tileX, tileY);
  }

  /** Tile-coordinate form of {@link isInsideTownWall}. */
  isTileInsideTownWall(tileX: number, tileY: number): boolean {
    const interior = this.townPlan?.interior;
    if (interior === undefined) return false;
    return (
      tileX >= interior.x &&
      tileY >= interior.y &&
      tileX < interior.x + interior.w &&
      tileY < interior.y + interior.h
    );
  }

  /**
   * Tell the renderer a tile's base art changed. Base tiles are baked into
   * reusable chunk canvases, so anything that rewrites `structure[y][x].type`
   * (or a field the tile's renderer reads, such as `damageStage`) at runtime
   * must announce it here or the stale art keeps being blitted.
   */
  markTileDirty(tileX: number, tileY: number): void {
    this._dirtyTiles.push({ x: tileX, y: tileY });
  }

  isWalkable(tileX: number, tileY: number): boolean {
    if (!this.isInsideGrid(tileX, tileY)) return false;
    const flags = this.blockedMask[tileIndex(tileX, tileY, this.maskWidth)];
    if ((flags & BLOCK_UNCONDITIONAL) !== 0) return false;
    if (this.arenaDoorLocked && (flags & BLOCK_ARENA_DOOR) !== 0) return false;
    if (this.questExitDoorState === 'barred' && (flags & BLOCK_QUEST_EXIT) !== 0) return false;
    return isWalkableTileType(this.structure[tileY][tileX]);
  }

  /**
   * {@link isWalkable} for a hostile mob: the same test, plus the tiles only
   * hostiles are turned away from (the village gate). Every hostile step and
   * hostile A* search goes through this; line of sight and spawn checks do not.
   */
  isWalkableForHostile(tileX: number, tileY: number): boolean {
    if (!this.isWalkable(tileX, tileY)) return false;
    return (this.blockedMask[tileIndex(tileX, tileY, this.maskWidth)] & BLOCK_HOSTILE_ONLY) === 0;
  }

  /** {@link isWalkableForHostile} or {@link isWalkable}, whichever the mover's side calls for. */
  isWalkableFor(tileX: number, tileY: number, forHostile: boolean): boolean {
    return forHostile ? this.isWalkableForHostile(tileX, tileY) : this.isWalkable(tileX, tileY);
  }

  /**
   * Whether (tileX, tileY) is river water — walkable, but waded rather than
   * walked. The one definition of "this is the river", shared by the movement
   * penalty, the submerged rendering and the splash effects.
   */
  isWadeable(tileX: number, tileY: number): boolean {
    if (!this.isInsideGrid(tileX, tileY)) return false;
    const flags = this.blockedMask[tileIndex(tileX, tileY, this.maskWidth)];
    if ((flags & BLOCK_UNCONDITIONAL) !== 0) return false;
    return this.structure[tileY][tileX].type === FloorTypeValue.water;
  }

  /**
   * Walkability ignoring only the *permanent* block flag. Locked arena doors,
   * building/sprite footprints (`BLOCK_EXTRA`), and tile type are all still
   * honored — this differs from `isWalkable` only in that a tile the game blocked
   * permanently still reads as walkable.
   *
   * Use for deterministic prop placement on a map instance that is reused across
   * scene reconstructions: `BLOCK_EXTRA` is rebuilt from the (stable) structure
   * each time, but permanent blocks only ever accumulate, so a prop's own
   * permanent block would otherwise make placement drift to — and leak — a
   * fresh blocked tile on every pass. Ignoring it keeps re-placement idempotent.
   */
  isWalkableIgnoringPermanent(tileX: number, tileY: number): boolean {
    if (!this.isInsideGrid(tileX, tileY)) return false;
    const flags = this.blockedMask[tileIndex(tileX, tileY, this.maskWidth)];
    if ((flags & BLOCK_EXTRA) !== 0) return false;
    if (this.arenaDoorLocked && (flags & BLOCK_ARENA_DOOR) !== 0) return false;
    if (this.questExitDoorState === 'barred' && (flags & BLOCK_QUEST_EXIT) !== 0) return false;
    return isWalkableTileType(this.structure[tileY][tileX]);
  }

  isStairwellTile(tileX: number, tileY: number): boolean {
    if (!this.isInsideGrid(tileX, tileY)) return false;
    return (this.blockedMask[tileIndex(tileX, tileY, this.maskWidth)] & BLOCK_STAIRWELL) !== 0;
  }

  /**
   * Returns true if there is a clear line of sight between two pixel-space
   * points — i.e. no sight-blocking tile (`blocksSight`) crosses the segment.
   *
   * Walks the grid with an Amanatides–Woo traversal: at each step it crosses
   * whichever tile boundary the ray reaches first, so every tile the segment
   * passes through is tested exactly once. The endpoints' own tiles are never
   * tested — a creature standing on a solid tile can still see out, and a solid
   * tile can be targeted.
   *
   * `ignore` exempts one further tile from the walkability test. Needed when a
   * swing is aimed *past* a solid tile that would otherwise obstruct it.
   */
  hasLineOfSight(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    ignore?: { tileX: number; tileY: number },
  ): boolean {
    return this.lineClearOf(x1, y1, x2, y2, this.sightBlocker, ignore);
  }

  /**
   * {@link hasLineOfSight}, but a tile whose type is in `transparentTypes` never
   * blocks, whatever `blocksSight` would say about it. Lets a smash-everything
   * blast see past a crate standing between it and the crate behind it, while a
   * real wall still shadows both.
   */
  hasLineOfSightIgnoringTypes(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    transparentTypes: ReadonlySet<number>,
    ignore?: { tileX: number; tileY: number },
  ): boolean {
    return this.lineClearOf(
      x1,
      y1,
      x2,
      y2,
      (tileX, tileY) => {
        if (!this.blocksSight(tileX, tileY)) return false;
        // Off the grid blocks sight too, and has no tile to read a type from.
        if (!this.isInsideGrid(tileX, tileY)) return true;
        return !transparentTypes.has(this.structure[tileY][tileX].type);
      },
      ignore,
    );
  }

  /**
   * Whether a straight walk between two pixel-space points crosses only
   * walkable tiles — the movement counterpart of `hasLineOfSight`, which sees
   * over low props a body cannot pass through. Ask this, not sight, before
   * steering straight at a point instead of pathfinding to it.
   *
   * Same traversal and endpoint rule as `hasLineOfSight`.
   */
  hasWalkableLine(x1: number, y1: number, x2: number, y2: number): boolean {
    return this.lineClearOf(x1, y1, x2, y2, this.walkBlocker);
  }

  /** {@link hasWalkableLine} for a hostile mob, which the village gate also stops. */
  hasHostileWalkableLine(x1: number, y1: number, x2: number, y2: number): boolean {
    return this.lineClearOf(x1, y1, x2, y2, this.hostileWalkBlocker);
  }

  // Held as fields so the hot sight query allocates no closure per call.
  private readonly sightBlocker = (tileX: number, tileY: number): boolean =>
    this.blocksSight(tileX, tileY);
  private readonly walkBlocker = (tileX: number, tileY: number): boolean =>
    !this.isWalkable(tileX, tileY);
  private readonly hostileWalkBlocker = (tileX: number, tileY: number): boolean =>
    !this.isWalkableForHostile(tileX, tileY);

  /**
   * Amanatides–Woo walk from one point to another, false as soon as a crossed
   * tile (endpoints' own tiles and `ignore` excepted) satisfies `blocks`.
   */
  private lineClearOf(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    blocks: (tileX: number, tileY: number) => boolean,
    ignore?: { tileX: number; tileY: number },
  ): boolean {
    const ts = this.tileHeight;
    const startTileX = Math.floor(x1 / ts);
    const startTileY = Math.floor(y1 / ts);
    const endTileX = Math.floor(x2 / ts);
    const endTileY = Math.floor(y2 / ts);
    if (startTileX === endTileX && startTileY === endTileY) return true;

    const dx = x2 - x1;
    const dy = y2 - y1;
    const stepX = Math.sign(dx);
    const stepY = Math.sign(dy);

    // Distance along the ray, as a fraction of its length, between successive
    // boundary crossings on each axis.
    const tPerTileX = stepX === 0 ? Infinity : ts / Math.abs(dx);
    const tPerTileY = stepY === 0 ? Infinity : ts / Math.abs(dy);
    // Distance to the first crossing on each axis.
    let tNextX =
      stepX === 0 ? Infinity : ((stepX > 0 ? startTileX + 1 : startTileX) * ts - x1) / dx;
    let tNextY =
      stepY === 0 ? Infinity : ((stepY > 0 ? startTileY + 1 : startTileY) * ts - y1) / dy;

    let tileX = startTileX;
    let tileY = startTileY;
    const maxCrossings =
      Math.abs(endTileX - startTileX) + Math.abs(endTileY - startTileY) + LOS_CROSSING_SLACK;

    for (let crossing = 0; crossing < maxCrossings; crossing++) {
      if (tNextX < tNextY) {
        tileX += stepX;
        tNextX += tPerTileX;
      } else {
        tileY += stepY;
        tNextY += tPerTileY;
      }
      if (tileX === endTileX && tileY === endTileY) return true;
      if (tileX === ignore?.tileX && tileY === ignore.tileY) continue;
      if (blocks(tileX, tileY)) return false;
    }
    return true;
  }

  /**
   * Whether a tile stops a line of sight: anything solid, except a prop low
   * enough to see over (`isSightTransparentTileType`).
   */
  blocksSight(tileX: number, tileY: number): boolean {
    if (this.isWalkable(tileX, tileY)) return false;
    if (!this.isInsideGrid(tileX, tileY)) return true;
    return !isSightTransparentTileType(this.structure[tileY][tileX]);
  }

  /**
   * Drops every pre-rendered chunk/overlay block so the next `renderCanvas`
   * re-bakes everything from scratch.
   *
   * A chunk is baked once and reused forever (see `invalidateTile`'s own
   * comment), which is fine for a runtime tile change but breaks against
   * lazy sprite-group loading: a ground-tileset or decoration sheet that is
   * still loading when a chunk near the player first bakes gets that chunk
   * permanently stuck on its fallback color/art, even after the sheet
   * finishes loading a moment later — nothing else ever tells the chunk
   * cache to look again. Call this once a floor's declared sprite groups
   * finish loading (see `DungeonScene`'s
   * `prewarmGroups(levelDef.spriteGroups).then(...)`) so that one-time race
   * turns back into the "wrong for a frame or two" lazy loading intends, not
   * "wrong forever".
   */
  invalidateAllTileArt(): void {
    this._chunkCache = null;
    this._overlayCache = null;
  }

  /**
   * Bakes the ground chunks a view at this camera would show, for up to
   * `budgetMs`, and returns the fraction now warm — so a loading screen can pay
   * for the first frame of play before that frame. See `TileChunkCache.bakeView`.
   */
  bakeTileArtForView(
    cameraX: number,
    cameraY: number,
    viewW: number,
    viewH: number,
    budgetMs: number,
    mustProgress: boolean,
  ): number {
    // A tile changed since the last frame (a chest blocked, a door stamped as
    // the floor was built) would otherwise be baked stale here and rebaked by
    // the first frame of play.
    const chunkCache = this.applyDirtyTiles();
    return chunkCache.bakeView(cameraX, cameraY, viewW, viewH, budgetMs, mustProgress);
  }

  /**
   * Renders the decoration overlay entries a view at this camera would draw,
   * for up to `budgetMs`, and returns the fraction now warm. See
   * `bakeDecorationsForView`.
   */
  bakeDecorationArtForView(
    cameraX: number,
    cameraY: number,
    viewW: number,
    viewH: number,
    budgetMs: number,
    mustProgress: boolean,
  ): number {
    this.applyDirtyTiles();
    this._overlayCache ??= new OverlayTileCache(this.structure, this.tileHeight);
    return bakeDecorationsForView(
      this.structure,
      this.tileHeight,
      cameraX,
      cameraY,
      viewW,
      viewH,
      this._overlayCache,
      budgetMs,
      mustProgress,
    );
  }

  renderCanvas(
    ctx: CanvasRenderingContext2D,
    cameraX: number,
    cameraY: number,
    viewW: number,
    viewH: number,
  ): void {
    const chunkCache = this.applyDirtyTiles();
    renderCanvas(ctx, this.structure, this.tileHeight, cameraX, cameraY, viewW, viewH, chunkCache);
  }

  /** Invalidates the cached art of every tile announced by {@link markTileDirty} since the last call. */
  private applyDirtyTiles(): TileChunkCache {
    const chunkCache = (this._chunkCache ??= new TileChunkCache(this.structure, this.tileHeight));
    for (const t of this._dirtyTiles) {
      chunkCache.invalidateTile(t.x, t.y);
      this._overlayCache?.invalidateTile(t.x, t.y);
      this.refreshDecorationTile(t.x, t.y);
    }
    this._dirtyTiles.length = 0;
    return chunkCache;
  }

  renderDecorationsOverlay(
    ctx: CanvasRenderingContext2D,
    cameraX: number,
    cameraY: number,
    viewW: number,
    viewH: number,
  ): void {
    this._overlayCache ??= new OverlayTileCache(this.structure, this.tileHeight);
    renderDecorationsOverlay(
      ctx,
      this.structure,
      this.tileHeight,
      cameraX,
      cameraY,
      viewW,
      viewH,
      this._overlayCache,
    );
  }

  /** Returns tile coords of all visible decoration tiles (TORCH, WELL, TREE, FOUNTAIN). */
  getVisibleDecorationTiles(
    camX: number,
    camY: number,
    viewW: number,
    viewH: number,
  ): ReadonlyArray<DecorationTile> {
    this.ensureDecorationIndex();
    const ts = this.tileHeight;
    const rows = this.structure.length;
    const cols = this.structure[0]?.length ?? rows;

    // Widen the scan by how far a decoration's art can reach past its anchor
    // tile: an off-screen anchor can still own on-screen pixels. The margin is
    // the worst case among *ordinary* decorations only — the far-reaching ones
    // (the tower, every sprite building) are held in `_oversizedDecorations`
    // and tested against their own reach, so a tree's row scan isn't widened
    // by the tower's twenty-one tiles.
    const margin = this._modestDecorationExtents;
    const startX = Math.max(0, Math.floor(camX / ts) - Math.ceil(margin.right / ts));
    const startY = Math.max(0, Math.floor(camY / ts) - Math.ceil(margin.down / ts));
    const endX = Math.min(cols - 1, Math.ceil((camX + viewW) / ts) + Math.ceil(margin.left / ts));
    const endY = Math.min(rows - 1, Math.ceil((camY + viewH) / ts) + Math.ceil(margin.up / ts));

    const visible = this._visibleDecorations;
    visible.length = 0;
    const hidden = this.hiddenDecorationTiles;
    for (let y = startY; y <= endY; y++) {
      for (const entry of this._decorationRows[y]) {
        if (entry.tx < startX || entry.tx > endX) continue;
        if (hidden.size > 0 && hidden.has(tileCoordKey(entry.tx, entry.ty))) continue;
        visible.push(entry);
      }
    }

    // Oversized decorations are held out of the row buckets entirely, so this
    // is their only chance to be drawn — each is tested against its own reach.
    for (const entry of this._oversizedDecorations) {
      const extents = entry.extents;
      const left = entry.tx * ts - extents.left;
      const top = entry.ty * ts - extents.up;
      const right = (entry.tx + 1) * ts + extents.right;
      const bottom = (entry.ty + 1) * ts + extents.down;
      if (right < camX || left > camX + viewW || bottom < camY || top > camY + viewH) continue;
      if (hidden.size > 0 && hidden.has(tileCoordKey(entry.tx, entry.ty))) continue;
      visible.push(entry);
    }

    return visible;
  }

  /**
   * The world-pixel line the decoration drawn from tile (`tx`, `ty`) sorts on
   * in the Y-sorted pass, or null when that tile draws no decoration.
   */
  decorationSortYAt(tx: number, ty: number): number | null {
    this.ensureDecorationIndex();
    const entry =
      this._decorationRows[ty]?.find((candidate) => candidate.tx === tx) ??
      this._oversizedDecorations.find((candidate) => candidate.tx === tx && candidate.ty === ty);
    return entry === undefined ? null : entry.ty * this.tileHeight + entry.sortYAnchorPx;
  }

  /**
   * Builds the per-row decoration index. The set of decoration tiles is fixed
   * for a map apart from props destroyed at runtime, which come back through
   * `markTileDirty`, so this runs once instead of rescanning ~78k tiles a frame.
   */
  private ensureDecorationIndex(): void {
    if (this._decorationRows.length === this.structure.length) return;

    const rows = this.structure.length;
    this._decorationRows = Array.from({ length: rows }, () => []);
    this._oversizedDecorations = [];
    this._modestDecorationExtents = { left: 0, up: 0, right: 0, down: 0 };

    for (let ty = 0; ty < rows; ty++) {
      const row = this.structure[ty];
      for (let tx = 0; tx < row.length; tx++) {
        this.indexDecorationTile(tx, ty);
      }
    }
  }

  /** Classifies one tile into the row buckets or the oversized list. */
  private indexDecorationTile(tx: number, ty: number): void {
    const entry = this.buildDecorationTile(tx, ty);
    if (entry === null) return;
    if (isOversizedDecoration(entry.extents, this.tileHeight)) {
      this._oversizedDecorations.push(entry);
      return;
    }
    this._decorationRows[ty].push(entry);
    const margin = this._modestDecorationExtents;
    margin.left = Math.max(margin.left, entry.extents.left);
    margin.up = Math.max(margin.up, entry.extents.up);
    margin.right = Math.max(margin.right, entry.extents.right);
    margin.down = Math.max(margin.down, entry.extents.down);
  }

  /** The decoration entry for a tile, or null when the tile draws no decoration. */
  private buildDecorationTile(tx: number, ty: number): DecorationTile | null {
    const ts = this.tileHeight;
    const tile = this.structure[ty][tx];
    const type = tile.type;
    if (!DECORATION_OVERLAY_TYPES.has(type)) return null;
    // A village prop is drawn whole from one tile of its footprint; the rest
    // of the footprint blocks and draws nothing, so it is not sorted either.
    if (
      (type === HOLLOW_PROP_LOW || type === HOLLOW_PROP_TALL) &&
      !hollowPropDrawsAt(this.structure, tx, ty)
    ) {
      return null;
    }
    // A circus structure likewise: one tile draws the whole tent.
    if (
      (type === CIRCUS_STRUCTURE_TALL || type === CIRCUS_STRUCTURE_LOW) &&
      !circusStructureDrawsAt(this.structure, tx, ty)
    ) {
      return null;
    }
    // And a tent pole: its bottom-left tile draws the whole mast.
    if (type === TENT_POLE && !tentPoleDrawsAt(this.structure, tx, ty)) return null;

    // The same reach the overlay cache sizes its canvases to, so a tile can
    // never be culled while part of its art is still on screen.
    const extents = decorationTileExtentsPx(this.structure, type, tx, ty, ts);

    if (type === SPRITE_BUILDING) {
      const def = tile.spriteKey !== undefined ? getSpriteDefByKey(tile.spriteKey) : undefined;
      const sortYAnchorPx =
        def !== undefined ? (def.frameHeight - def.tileY) * (ts / def.tileScale) : ts;
      return { tx, ty, sortYAnchorPx, extents };
    }

    return {
      tx,
      ty,
      sortYAnchorPx: getSortYAnchorPx(type) ?? ts,
      extents,
    };
  }

  /** Re-classifies a tile whose art changed (a smashed prop reverts to floor). */
  private refreshDecorationTile(tx: number, ty: number): void {
    if (this._decorationRows.length !== this.structure.length) return;
    const row = this._decorationRows[ty];
    const rowIndex = row.findIndex((entry) => entry.tx === tx);
    if (rowIndex !== -1) row.splice(rowIndex, 1);
    const oversizedIndex = this._oversizedDecorations.findIndex(
      (entry) => entry.tx === tx && entry.ty === ty,
    );
    if (oversizedIndex !== -1) this._oversizedDecorations.splice(oversizedIndex, 1);
    this.indexDecorationTile(tx, ty);
  }

  /** Draws a single decoration tile at full fidelity (for z-sorted rendering). */
  drawDecorationAt(
    ctx: CanvasRenderingContext2D,
    tx: number,
    ty: number,
    camX: number,
    camY: number,
  ): void {
    const ts = this.tileHeight;
    this._overlayCache ??= new OverlayTileCache(this.structure, ts);
    drawDecorationTileFull(
      ctx,
      this.structure,
      tx,
      ty,
      tx * ts - camX,
      ty * ts - camY,
      ts,
      this._overlayCache,
    );
  }
}

/**
 * The map mutations a checkpoint restore undoes. Everything else about a map is
 * either fixed at generation or derived, so it needs no snapshot.
 */
export interface GameMapCheckpoint {
  arenaDoorLocked: boolean;
  questExitDoorState: QuestExitDoorState;
  /** `tileCoordKey` values, so the entries survive a structure replacement. */
  permanentBlockedTiles: number[];
  stairwellTiles: ReadonlyArray<{ x: number; y: number }>;
  /** `tileCoordKey` values of structure footprints; absent in checkpoints taken before structures existed. */
  structureBlockedTiles?: number[];
}
