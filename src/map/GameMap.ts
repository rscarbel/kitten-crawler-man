import {
  BIG_TOP_MAZE_ROWS,
  MAZE_CAT_SPAWN_CHAR,
  MAZE_EXIT_TILES,
  MAZE_FLOOR_CHAR,
  MAZE_HUMAN_SPAWN_CHAR,
  MAZE_HUMAN_SPAWN_TILE,
  MAZE_POLE_CHAR,
  MAZE_WALL_CHAR,
} from './bigTopMazeLayout';
import {
  type TileContent,
  FloorTypeValue,
  TREE,
  BUILDING_WALL,
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
  STAIRS_UP,
  STAIRS_DOWN,
  TOWER_STAIR_SPAN,
  TABLE,
  BOOKSHELF,
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
  INTERIOR_INK_FLOOR,
  INTERIOR_COUNTER,
  INTERIOR_STONE_FLOOR,
  INTERIOR_WALL,
  BOULDER_SMALL,
  BOULDER_LARGE,
  CAMPFIRE,
  GOBLIN_TENT,
  CLIFF,
  DRILL_SAND_FLOOR,
  TRAINING_DUMMY,
  WEAPON_RACK,
  MUSTER_BOARD,
  MAP_TABLE,
  FLASH_WALL,
  PIGMENT_SHELF,
  INK_BENCH,
  GRINDING_SLAB,
} from './tileTypes';
import { isWalkableTileType } from './walkability';
import { tileIndex, tileCoordKey, tileKeyX, tileKeyY } from './tileIndex';
import { MinHeap, HEAP_EMPTY } from '../core/MinHeap';
import {
  CLUB_INTERIOR_W,
  CLUB_INTERIOR_H,
  CLUB_DANCE_FLOOR,
  CLUB_DIVIDER_WALLS,
} from '../core/clubLayout';
import { CLUB_FURNITURE_TILES } from '../core/clubProps';
import {
  generateDungeon,
  type DungeonLevelOptions,
  type GenerateDungeonOptions,
  type SafeRoomData,
  type ArenaExterior,
  type QuestRoomData,
  type TreasureRoomData,
  type SpiderLabRoomData,
  type MobSpawnPoint,
} from './DungeonGenerator';
import { generateOverworld, type BuildingEntry } from './OverworldGenerator';
import type { CampSite } from './overworld/camps';
import type { BuildingKind, TownPlan } from './town/townPlan';
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
} from './TileRenderer';

// ── Default map construction options ──────────────────────────────────────────
const DEFAULT_MAP_SIZE = 100;
const DEFAULT_TILE_HEIGHT = 10;
/** Boss rooms carved when a caller supplies no dungeon settings at all. */
const DEFAULT_BOSS_ROOM_COUNT = 1;

// ── Interior building dimensions (width × height in tiles) ────────────────────
export const TOWER_INTERIOR_W = 20;
const TOWER_INTERIOR_H = 16;
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
export type InteriorVariant = 'default' | 'bigtop_maze';

/** The tile the maze layout's legend character stands for. */
function mazeTileTypeFor(legend: string): number {
  switch (legend) {
    case MAZE_WALL_CHAR:
      return INTERIOR_WALL;
    case MAZE_POLE_CHAR:
      return TENT_POLE;
    case MAZE_FLOOR_CHAR:
    case MAZE_HUMAN_SPAWN_CHAR:
    case MAZE_CAT_SPAWN_CHAR:
      return SAWDUST_FLOOR;
    default:
      // Gates, barricades and the grates the counterweights hang behind. All of
      // them start as wall; only a gate or barricade ever stops being one, and
      // `BigTopMazeSystem` is what opens it.
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
// These three used to be the *dungeon's* generic types under local aliases: the
// tower's floor was `FloorTypeValue.carpet`, a shop's and a house's was
// `FloorTypeValue.wood`, and every interior wall was `FloorTypeValue.wall`.
// That read as harmless while all of them were rows of one shared tileset, but
// it meant a townhouse was floored in whatever the dungeon's fourth surface
// happened to be — and once each dungeon floor was given a material set of its
// own it meant a shop's floorboards changed depending on which cellar the player
// had most recently walked through. The town owns them now.

// The four interior types are used under their own names below rather than
// through local aliases. Aliasing is what hid the borrowing in the first place:
// a use site reading `WALL_TILE` gives no clue which kind of wall it is, which
// is how a townhouse came to be built out of dungeon rock without anyone
// noticing. The exit door likewise names `FloorTypeValue.road` outright — it is
// genuinely the outdoor threshold type, and a bare `1` said nothing.

interface InteriorShell {
  readonly w: number;
  readonly h: number;
  readonly floorType: number;
}

/** Interior shell per building kind. Exhaustive, so a new kind cannot ship unsized. */
const INTERIOR_BY_KIND: Record<BuildingKind, InteriorShell> = {
  tower: { w: TOWER_INTERIOR_W, h: TOWER_INTERIOR_H, floorType: INTERIOR_STONE_FLOOR },
  store: { w: STORE_INTERIOR_W, h: STORE_INTERIOR_H, floorType: INTERIOR_BOARD_FLOOR },
  club: { w: CLUB_INTERIOR_W, h: CLUB_INTERIOR_H, floorType: CLUB_FLOOR },
  house: { w: HOUSE_INTERIOR_W, h: HOUSE_INTERIOR_H, floorType: INTERIOR_BOARD_FLOOR },
};

// ── The Sleeping Cat Inn's three zones ────────────────────────────────────────
//
// Stated here rather than inside the interior case because the safe-room bounds
// below name the taproom band and the interior case builds it. Writing the row
// twice is exactly how the two come apart.
const INN_INTERIOR_W = 24;
const INN_INTERIOR_H = 22;
/** The guest wing: three private rooms, split by dividing walls. */
const INN_GUEST_WING_FIRST_ROW = 1;
const INN_GUEST_WING_LAST_ROW = 7;
/** The wall the three guest rooms open through, one doorway each. */
const INN_GUEST_WALL_ROW = 8;
/** The landing corridor, running the width of the building. */
const INN_LANDING_RUG_ROW = 9;
const INN_LANDING_ROW = 10;
/** The partition between the landing and the taproom, pierced by one archway. */
const INN_PARTITION_ROW = 11;
const INN_TAPROOM_FIRST_ROW = 12;
const INN_TAPROOM_LAST_ROW = 20;

// ── The Barracks' three zones ─────────────────────────────────────────────────
//
// Stated beside the shell for the same reason the inn's are: the drill hall's
// sand is laid by the shell-independent loop below and the zones' walls are cut
// by the interior case, and a row written twice is a row that comes apart.
const BARRACKS_INTERIOR_W = 22;
const BARRACKS_INTERIOR_H = 18;
/** The wall between the quartermaster's armoury and the drill hall. */
const BARRACKS_ZONE_DIVIDER_COL = 7;
/** Both upper zones run from the north wall down to the partition. */
const BARRACKS_UPPER_FIRST_ROW = 1;
const BARRACKS_UPPER_LAST_ROW = 11;
/** The wall between the two upper zones and the muster hall, pierced twice. */
const BARRACKS_PARTITION_ROW = 12;
const BARRACKS_MUSTER_FIRST_ROW = 13;

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
  ['The Quiet Needle', { w: 18, h: 16, floorType: INTERIOR_INK_FLOOR }],
  ['The Horned Flagon', { w: 22, h: 16, floorType: INTERIOR_RUSH_FLOOR }],
  ['The Sunken Stump Pub', { w: 16, h: 14, floorType: INTERIOR_RUSH_FLOOR }],
  ['Temple of the Sky', { w: 18, h: 18, floorType: INTERIOR_FLAG_FLOOR }],
  ['The Rusty Anvil', { w: 18, h: 14, floorType: INTERIOR_FLAG_FLOOR }],
  ['Herb & Remedy', { w: 16, h: 14, floorType: INTERIOR_BOARD_FLOOR }],
  ["Old Hilda's Cottage", { w: 14, h: 14, floorType: INTERIOR_EARTH_FLOOR }],
  ["Cartwright's Workshop", { w: 20, h: 14, floorType: INTERIOR_EARTH_FLOOR }],
  ["Miller's Farm", { w: 18, h: 14, floorType: INTERIOR_EARTH_FLOOR }],
  ["Shepherd's Cabin", { w: 14, h: 12, floorType: INTERIOR_EARTH_FLOOR }],
  ['Blackwood Lodge', { w: 18, h: 14, floorType: INTERIOR_BOARD_FLOOR }],
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
  ROOF_CIRCUS_RED,
  ROOF_CIRCUS_BLUE,
  ROOF_CIRCUS_PURPLE,
  MAIN_TOWER,
  BARREL,
  BARREL_SIDE,
  CRATE,
  BOOKSHELF,
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
/** Bits that block movement regardless of game state. */
const BLOCK_UNCONDITIONAL = BLOCK_EXTRA | BLOCK_PERMANENT;

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
}

export type { SpiderLabRoomData };

export class GameMap {
  structure: TileContent[][];
  tileHeight: number;
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
  /** Door positions for enterable buildings (overworld only). */
  buildingEntries: BuildingEntry[] = [];
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
   * Radius (in tiles, from map centre) inside which the overworld town is
   * considered safe — no hostile ambient spawns, and hostile mobs won't
   * target players standing inside it. Null on non-overworld maps.
   */
  private townSafeRadiusTiles: number | null = null;
  /** Quest rooms generated in the dungeon (defend-NPC encounters). */
  questRooms: QuestRoomData[] = [];
  /** Spider lab room, if generated (spider quest boss encounter). */
  spiderLabRoom: SpiderLabRoomData | null = null;
  /** Treasure rooms generated in the dungeon (chest encounters). */
  treasureRooms: TreasureRoomData[] = [];
  /** Arena circles generated in the dungeon (one per dungeon map). */
  arenaExteriors: ArenaExterior[] = [];
  /** When true, the arena door gap tiles are treated as unwalkable. */
  arenaDoorLocked = false;
  /**
   * Write-side record of every runtime block, keyed with `tileCoordKey` so the
   * entries survive a structure replacement (building interiors regenerate the
   * grid). `blockedMask` is rebuilt from these whenever the grid changes.
   */
  private readonly arenaDoorTileSet = new Set<number>();
  private readonly permanentBlockedTiles = new Set<number>();
  private readonly stairwellBlockedSet = new Set<number>();

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
   * Memoized results of `tilesOfType`. Exiting a building rebuilds the town's
   * systems against this same map instance, and each of them used to re-sweep
   * all 78,400 tiles looking for wells and fountains — a visible hitch at every
   * shop door, for a list that cannot have changed.
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
    } = opts;
    this.tileHeight = tileHeight;
    if (prebuiltStructure) {
      this.structure = prebuiltStructure;
    } else if (mapType === 'overworld') {
      this.structure = this.generateOverworldMap(mapSize);
    } else {
      this.structure = this.generateDungeonMap({ ...dungeon, size: mapSize });
    }
    this.rebuildBlockedMasks();
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
    this.bountySites = data.bountySites;
    this.camps = data.camps;
    this.doomsdayEscapeTile = data.doomsdayEscapeTile;
    return data.grid;
  }

  private generateDungeonMap(options: GenerateDungeonOptions): TileContent[][] {
    const data = generateDungeon(options);
    this.startTile = data.startTile;
    this.safeRooms = data.safeRooms;
    this.bossRooms = data.bossRooms;
    this.questRooms = data.questRooms;
    this.treasureRooms = data.treasureRooms;
    this.spiderLabRoom = data.spiderLabRoom;
    this.mobSpawnPoints = data.mobSpawnPoints;
    this.hallwaySpawnPoints = data.hallwaySpawnPoints;
    this.setStairwellTiles(data.stairwellTiles);
    this.arenaExteriors = data.arenaExteriors;
    for (const arena of data.arenaExteriors) {
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

  private addArenaDoorTile(tileX: number, tileY: number): void {
    this.arenaDoorTileSet.add(tileCoordKey(tileX, tileY));
    this.addBlockFlag(tileX, tileY, BLOCK_ARENA_DOOR);
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

  /** Generates a small interior room for a building (called externally after construction).
   *  For towers, pass towerFloor (0-3) to generate per-floor stair layout. */
  generateInterior(
    buildingType: BuildingKind,
    towerFloor = 0,
    buildingName = '',
    hasSafeRoom = false,
    variant: InteriorVariant = 'default',
  ): void {
    if (variant === 'bigtop_maze') {
      this.generateBigTopMaze();
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
      // Stock stands in two free-standing runs down the middle of the floor with
      // a walking aisle either side of each, rather than being pushed flat against
      // the walls. A perimeter run leaves a shop that is one empty room with
      // things around the edge; aisles make the player walk the stock to cross it.
      const storeEastWallCol = w - 2;
      const storeSouthRow = h - 2;
      const storeCounterRow = 2;
      const storeCounterStartCol = 2;
      const storeCounterEndCol = storeEastWallCol - 1;
      const storeRugRow = storeCounterRow + 1;
      const storeRugStartCol = 8;
      const storeRugEndCol = 11;
      /** Floor left at each end of an aisle run, so neither run seals its lane. */
      const storeAisleEndGap = 2;
      const storeAisleStartCol = 1 + storeAisleEndGap;
      const storeAisleEndCol = storeEastWallCol - storeAisleEndGap;
      const storeFirstAisleRow = 5;
      const storeAislePitch = 2;
      const storeAisleRuns = 2;
      /*
       * Behind the counter, which is the north strip. The counter stops short of
       * both side walls and nothing is stacked in those two columns, because the
       * lanes past its ends are the only way into the strip at all.
       */
      const storeStockRow = 1;
      const storeStockRunTiles = 3;
      const storeStockStartCol = storeEastWallCol - storeStockRunTiles;
      const storeEntranceRow = storeSouthRow - 1;
      for (let rx = storeCounterStartCol; rx <= storeCounterEndCol; rx++)
        grid[storeCounterRow][rx].type = INTERIOR_COUNTER;
      for (let n = 0; n < storeStockRunTiles; n++)
        placeProp(grid[storeStockRow][storeStockStartCol + n], BARREL);
      for (let rx = storeRugStartCol; rx <= storeRugEndCol; rx++) grid[storeRugRow][rx].type = RUG;
      for (let run = 0; run < storeAisleRuns; run++) {
        const runRow = storeFirstAisleRow + run * storeAislePitch;
        for (let rx = storeAisleStartCol; rx <= storeAisleEndCol; rx++)
          placeProp(grid[runRow][rx], BOOKSHELF);
      }
      placeProp(grid[storeEntranceRow][1], CRATE);
      placeProp(grid[storeEntranceRow][2], CRATE);
      placeProp(grid[storeEntranceRow][storeEastWallCol - 1], BARREL);
      placeProp(grid[storeEntranceRow][storeEastWallCol], BARREL);
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

    // ── Named building interiors — each has a unique hand-crafted layout ──
    const NAMED_BUILDINGS = [
      "Shepherd's Cabin",
      'Blackwood Lodge',
      "Old Hilda's Cottage",
      "Cartwright's Workshop",
      'Herb & Remedy',
      'The Sleeping Cat Inn',
      'The Rusty Anvil',
      "Miller's Farm",
      'The Horned Flagon',
      'The Sunken Stump Pub',
      'Temple of the Sky',
      'The Quiet Needle',
      'The Barracks',
    ] as const;
    const isNamedBuilding = NAMED_BUILDINGS.some((n) => n === buildingName);

    if (isHouse && isNamedBuilding) {
      switch (buildingName) {
        case "Shepherd's Cabin": {
          // One room, and the smallest interior in town — hearth, a cot, the
          // barrels a season's wool goes into. Every column is derived from `w`
          // and every row from `h`: this room is four tiles narrower and two
          // shorter than a townhouse, and an absolute column here writes into
          // the wall.
          const cabinHearthCol1 = 4;
          const cabinHearthCol2 = 5;
          const cabinBedNorthRow = 2;
          const cabinBedSouthRow = 3;
          const cabinBedEastCol = w - 2;
          const cabinBedWestCol = cabinBedEastCol - 1;
          const cabinBarrelStartRow = 3;
          const cabinBarrelEndRow = 5;
          const cabinTableRow = 6;
          const cabinTableCol1 = 6;
          const cabinTableCol2 = 7;
          const cabinChairRow = 7;
          const cabinSouthRow = h - 2;
          const cabinBarrelSideRow = cabinSouthRow - 2;
          grid[1][cabinHearthCol1].type = FIREPLACE;
          grid[1][cabinHearthCol2].type = FIREPLACE;
          grid[cabinBedNorthRow][cabinBedWestCol].type = BED;
          grid[cabinBedNorthRow][cabinBedEastCol].type = BED;
          grid[cabinBedSouthRow][cabinBedWestCol].type = BED;
          grid[cabinBedSouthRow][cabinBedEastCol].type = BED;
          for (let ry = cabinBarrelStartRow; ry <= cabinBarrelEndRow; ry++)
            placeProp(grid[ry][1], BARREL);
          grid[cabinTableRow][cabinTableCol1].type = TABLE;
          grid[cabinTableRow][cabinTableCol2].type = TABLE;
          grid[cabinChairRow][cabinTableCol1].type = CHAIR;
          placeProp(grid[cabinSouthRow][1], CRATE);
          placeProp(grid[cabinSouthRow][2], CRATE);
          placeProp(grid[cabinBarrelSideRow][cabinBedEastCol], BARREL_SIDE);
          break;
        }

        case 'Blackwood Lodge': {
          // The town's other garrison ground, and the one that still looks like a
          // garrison: racked steel along the north wall, bunks stacked down both
          // sides in ranks with a lane between them, and a map table in the middle
          // of the floor. Kessler holds this post with two men and a watch
          // rotation nobody relieves, so the room is furnished for a section and
          // occupied by a section's worth of empty bunks — which is the point.
          //
          // The briefing table is a `MAP_TABLE` rather than a plain one because
          // what the Lodge is actually watching is the drainage under the alley,
          // and a pinned map is the only thing in the room that says so.
          const lodgeEastWallCol = w - 2;
          const lodgeSouthRow = h - 2;
          const lodgeRackRow = 1;
          const lodgeWestRackStartCol = 2;
          const lodgeRackRunTiles = 2;
          const lodgeEastRackStartCol = lodgeEastWallCol - lodgeRackRunTiles;
          /** Each bunk is two tiles square; the ranks are pitched to leave a lane between. */
          const lodgeBunkDepth = 2;
          const lodgeBunkPitch = 3;
          const lodgeFirstBunkRow = 3;
          const lodgeWestBunkRanks = 3;
          const lodgeEastBunkRanks = 2;
          const lodgeWestBunkCol = 1;
          const lodgeEastBunkCol = lodgeEastWallCol - 1;
          const lodgeMapTableRow = 6;
          const lodgeMapTableStartCol = 7;
          const lodgeMapTableEndCol = 10;
          const lodgeChairRow = lodgeMapTableRow + 1;
          const lodgeKitRow = lodgeSouthRow - 1;
          for (let n = 0; n < lodgeRackRunTiles; n++) {
            placeProp(grid[lodgeRackRow][lodgeWestRackStartCol + n], WEAPON_RACK);
            placeProp(grid[lodgeRackRow][lodgeEastRackStartCol + n], WEAPON_RACK);
          }
          for (let rank = 0; rank < lodgeWestBunkRanks; rank++)
            for (let d = 0; d < lodgeBunkDepth; d++)
              for (let c = 0; c < lodgeBunkDepth; c++)
                grid[lodgeFirstBunkRow + rank * lodgeBunkPitch + d][lodgeWestBunkCol + c].type =
                  BED;
          for (let rank = 0; rank < lodgeEastBunkRanks; rank++)
            for (let d = 0; d < lodgeBunkDepth; d++)
              for (let c = 0; c < lodgeBunkDepth; c++)
                grid[lodgeFirstBunkRow + rank * lodgeBunkPitch + d][lodgeEastBunkCol + c].type =
                  BED;
          for (let rx = lodgeMapTableStartCol; rx <= lodgeMapTableEndCol; rx++)
            grid[lodgeMapTableRow][rx].type = MAP_TABLE;
          grid[lodgeChairRow][lodgeMapTableStartCol].type = CHAIR;
          grid[lodgeChairRow][lodgeMapTableEndCol].type = CHAIR;
          placeProp(grid[lodgeKitRow][1], CRATE);
          placeProp(grid[lodgeKitRow][2], CRATE);
          placeProp(grid[lodgeKitRow][lodgeEastWallCol - 1], BARREL);
          placeProp(grid[lodgeKitRow][lodgeEastWallCol], BARREL);
          break;
        }

        case "Old Hilda's Cottage": {
          // A hedge-witch's one room, and it is meant to feel crowded rather than
          // small: shelves run both side walls end to end and turn the corners
          // along the north wall, so the walls are lined with work everywhere the
          // hearth and the cauldron are not.
          //
          // The hearth is a real `FIREPLACE` and not another brazier because the
          // cottage's second occupant — the customer waiting on a charm — is
          // anchored to a hearth, and an anchor group that matches nothing drops
          // its occupant with no error at all. A cottage with a cauldron and no
          // fire to hang it over would not have read as one either.
          const hildaEastShelfCol = w - 2;
          const hildaSouthRow = h - 2;
          const hildaHearthCol1 = 5;
          const hildaHearthCol2 = 6;
          const hildaCauldronCol = 8;
          const hildaSideShelfStartRow = 2;
          const hildaWestShelfEndRow = hildaSouthRow - 2;
          const hildaEastShelfEndRow = hildaWestShelfEndRow - 1;
          const hildaNorthWestShelfEndCol = 2;
          const hildaNorthEastShelfStartCol = hildaEastShelfCol - 2;
          const hildaTableRow = 6;
          const hildaTableCol1 = hildaHearthCol1;
          const hildaTableCol2 = hildaHearthCol2;
          const hildaChairRow = hildaTableRow + 1;
          const hildaClutterRow1 = 8;
          const hildaClutterCol1 = hildaCauldronCol;
          const hildaClutterRow2 = 9;
          const hildaClutterCol2 = 3;
          const hildaStoreRow = hildaSouthRow - 1;
          grid[1][hildaHearthCol1].type = FIREPLACE;
          grid[1][hildaHearthCol2].type = FIREPLACE;
          grid[1][hildaCauldronCol].type = BRAZIER;
          for (let rx = 1; rx <= hildaNorthWestShelfEndCol; rx++) placeProp(grid[1][rx], BOOKSHELF);
          for (let rx = hildaNorthEastShelfStartCol; rx <= hildaEastShelfCol; rx++)
            placeProp(grid[1][rx], BOOKSHELF);
          for (let ry = hildaSideShelfStartRow; ry <= hildaWestShelfEndRow; ry++)
            placeProp(grid[ry][1], BOOKSHELF);
          for (let ry = hildaSideShelfStartRow; ry <= hildaEastShelfEndRow; ry++)
            placeProp(grid[ry][hildaEastShelfCol], BOOKSHELF);
          grid[hildaTableRow][hildaTableCol1].type = TABLE;
          grid[hildaTableRow][hildaTableCol2].type = TABLE;
          grid[hildaChairRow][hildaTableCol1].type = CHAIR;
          placeProp(grid[hildaClutterRow1][hildaClutterCol1], BARREL_SIDE);
          placeProp(grid[hildaClutterRow2][hildaClutterCol2], BARREL_SIDE);
          placeProp(grid[hildaStoreRow][1], BARREL);
          placeProp(grid[hildaStoreRow][2], BARREL);
          placeProp(grid[hildaStoreRow][hildaEastShelfCol - 1], CRATE);
          placeProp(grid[hildaStoreRow][hildaEastShelfCol], CRATE);
          break;
        }

        case "Cartwright's Workshop": {
          // A builder's shop, and a builder's shop is mostly timber. The east end
          // is walled off into a stock bay stacked to the ceiling, and the
          // workbench run stops dead against that wall rather than continuing —
          // the break is what makes the bench read as a bench and not as a
          // counter running the width of the room.
          //
          // The bay is closed on its west side and open along its south, so the
          // stock is behind a wall without being behind a door.
          const cartwrightEastWallCol = w - 2;
          const cartwrightSouthRow = h - 2;
          const cartwrightBayWidth = 4;
          const cartwrightBayWallCol = cartwrightEastWallCol - cartwrightBayWidth;
          const cartwrightBayFirstCol = cartwrightBayWallCol + 1;
          const cartwrightBayWallLastRow = 7;
          const cartwrightBayStackEndRow = 6;
          const cartwrightBayInnerStackEndRow = 3;
          const cartwrightBenchRow = 2;
          const cartwrightBench1StartCol = 3;
          const cartwrightBench1EndCol = 7;
          const cartwrightBench2StartCol = 10;
          const cartwrightBench2EndCol = cartwrightBayWallCol - 1;
          const cartwrightCrateStartRow = 4;
          const cartwrightCrateEndRow = 7;
          const cartwrightBarrelRow = 8;
          const cartwrightBarrelCol1 = 4;
          const cartwrightBarrelCol2 = 5;
          const cartwrightBarrelCol3 = 11;
          const cartwrightBarrelCol4 = 12;
          const cartwrightTableRow = 5;
          const cartwrightTableCol1 = 8;
          const cartwrightTableCol2 = 9;
          const cartwrightStoreRow = cartwrightSouthRow - 1;
          for (let rx = cartwrightBench1StartCol; rx <= cartwrightBench1EndCol; rx++)
            grid[cartwrightBenchRow][rx].type = TABLE;
          for (let rx = cartwrightBench2StartCol; rx <= cartwrightBench2EndCol; rx++)
            grid[cartwrightBenchRow][rx].type = TABLE;
          for (let ry = 1; ry <= cartwrightBayWallLastRow; ry++)
            grid[ry][cartwrightBayWallCol].type = INTERIOR_WALL;
          for (let ry = 1; ry <= cartwrightBayStackEndRow; ry++)
            placeProp(grid[ry][cartwrightEastWallCol], CRATE);
          for (let ry = 1; ry <= cartwrightBayInnerStackEndRow; ry++)
            placeProp(grid[ry][cartwrightBayFirstCol], CRATE);
          placeProp(grid[1][cartwrightBayFirstCol + 1], BARREL);
          placeProp(grid[1][cartwrightBayFirstCol + 2], BARREL);
          for (let ry = cartwrightCrateStartRow; ry <= cartwrightCrateEndRow; ry++)
            placeProp(grid[ry][1], CRATE);
          placeProp(grid[cartwrightBarrelRow][cartwrightBarrelCol1], BARREL_SIDE);
          placeProp(grid[cartwrightBarrelRow][cartwrightBarrelCol2], BARREL_SIDE);
          placeProp(grid[cartwrightBarrelRow][cartwrightBarrelCol3], BARREL_SIDE);
          placeProp(grid[cartwrightBarrelRow][cartwrightBarrelCol4], BARREL_SIDE);
          grid[cartwrightTableRow][cartwrightTableCol1].type = TABLE;
          grid[cartwrightTableRow][cartwrightTableCol2].type = TABLE;
          grid[cartwrightTableRow + 1][cartwrightTableCol1].type = CHAIR;
          placeProp(grid[cartwrightStoreRow][1], BARREL);
          placeProp(grid[cartwrightStoreRow][2], BARREL);
          placeProp(grid[cartwrightStoreRow][cartwrightEastWallCol - 1], CRATE);
          placeProp(grid[cartwrightStoreRow][cartwrightEastWallCol], CRATE);
          break;
        }

        case 'Herb & Remedy': {
          // An apothecary is a shop in front of a drying room, and the drying
          // room is the half a customer does not walk into: bunched herbs on
          // racks, out of the light and out of the traffic, behind a stub wall
          // with one doorway at its east end.
          //
          // The counter hangs off the front of that wall with open floor at both
          // ends of the run. The gaps are not decorative — the strip between the
          // wall and the counter is where the herbalist's own anchor lands, and a
          // run carried wall to wall would seal her into it.
          const herbEastShelfCol = w - 2;
          const herbSouthRow = h - 2;
          const herbDryingLastRow = 4;
          const herbPartitionRow = herbDryingLastRow + 1;
          const herbDoorwayEastCol = herbEastShelfCol - 1;
          const herbDoorwayWestCol = herbDoorwayEastCol - 1;
          const herbRackEndRow = herbDryingLastRow;
          const herbHangingBarrelCol1 = 5;
          const herbHangingBarrelCol2 = 6;
          /** Tiles of open floor at each end of the counter — the only way behind it. */
          const herbCounterEndGap = 2;
          const herbCounterRow = herbPartitionRow + 2;
          const herbCounterStartCol = 1 + herbCounterEndGap;
          const herbCounterEndCol = herbEastShelfCol - herbCounterEndGap - 1;
          const herbShopShelfStartRow = herbCounterRow + 1;
          const herbShopShelfEndRow = herbSouthRow - 2;
          const herbRugStartRow = herbCounterRow + 1;
          /** Floor left bare between the rug's edges and the side walls. */
          const herbRugSideMargin = 3;
          const herbRugStartCol = 1 + herbRugSideMargin;
          const herbRugEndCol = herbEastShelfCol - herbRugSideMargin;
          const herbTableRow = herbSouthRow - 2;
          const herbTableCol1 = 6;
          const herbTableCol2 = 7;
          for (let ry = 1; ry <= herbRackEndRow; ry++) {
            placeProp(grid[ry][1], BOOKSHELF);
            placeProp(grid[ry][herbEastShelfCol], BOOKSHELF);
          }
          placeProp(grid[1][herbHangingBarrelCol1], BARREL);
          placeProp(grid[1][herbHangingBarrelCol2], BARREL);
          for (let rx = 1; rx <= herbEastShelfCol; rx++)
            grid[herbPartitionRow][rx].type = INTERIOR_WALL;
          grid[herbPartitionRow][herbDoorwayWestCol].type = floorType;
          grid[herbPartitionRow][herbDoorwayEastCol].type = floorType;
          for (let rx = herbCounterStartCol; rx <= herbCounterEndCol; rx++)
            grid[herbCounterRow][rx].type = INTERIOR_COUNTER;
          for (let ry = herbShopShelfStartRow; ry <= herbShopShelfEndRow; ry++)
            placeProp(grid[ry][1], BOOKSHELF);
          for (let rx = herbRugStartCol; rx <= herbRugEndCol; rx++) {
            grid[herbRugStartRow][rx].type = RUG;
            grid[herbRugStartRow + 1][rx].type = RUG;
          }
          grid[herbTableRow][herbTableCol1].type = TABLE;
          grid[herbTableRow][herbTableCol2].type = TABLE;
          placeProp(grid[herbSouthRow][1], BARREL_SIDE);
          placeProp(grid[herbSouthRow][herbEastShelfCol], BARREL_SIDE);
          break;
        }

        case 'The Sleeping Cat Inn': {
          // An inn rather than a dormitory: three private guest rooms off a
          // landing upstairs, and a taproom below the partition which is also
          // the town's safe room. The three rooms are furnished alike and then
          // given one thing each — a second bunk, a hearth, a shelf and a
          // brazier — because that difference is the whole of what a crawler is
          // choosing between when they pay for one.
          const innEastWallCol = w - 2;
          const innSouthRow = h - 2;

          /** Walls between the three guest rooms, running the wing's full depth. */
          const innAtticRoomEastWallCol = 8;
          const innHearthsideRoomEastWallCol = 16;
          const innGuestDividerCols = [innAtticRoomEastWallCol, innHearthsideRoomEastWallCol];
          /** One doorway per guest room, cut in the wall the landing runs along. */
          const innAtticDoorwayCol = 4;
          const innHearthsideDoorwayCol = 12;
          const innCatsOwnDoorwayCol = 19;
          const innGuestDoorwayCols = [
            innAtticDoorwayCol,
            innHearthsideDoorwayCol,
            innCatsOwnDoorwayCol,
          ];
          const innGuestBedFirstRow = 2;
          const innGuestBedLastRow = 3;
          const innGuestTableRow = 2;
          const innGuestChairRow = 3;
          const innGuestRugRow = 5;
          /** Each guest room's shared fittings: a bed pair, a table and chair, a rug. */
          const innGuestRooms = [
            { bedWestCol: 2, tableCol: 5, rugStartCol: 2, rugEndCol: 5 },
            { bedWestCol: 10, tableCol: 14, rugStartCol: 10, rugEndCol: 14 },
            { bedWestCol: 18, tableCol: 21, rugStartCol: 18, rugEndCol: 21 },
          ] as const;

          // The Attic Cot: the cheap room, and the only one sleeping four.
          const innAtticExtraBunkRow = 1;
          const innAtticCrateCol = 7;
          const innAtticCrateRow = 6;
          // The Hearthside Room: a fire of its own, which is what it is sold on.
          const innHearthsideCol1 = 11;
          const innHearthsideCol2 = 12;
          // The Cat's Own Room: reading shelf, a brazier, and a cask by the bed.
          const innCatsOwnShelfCol = 17;
          const innCatsOwnShelfFirstRow = 4;
          const innCatsOwnShelfLastRow = 5;
          const innCatsOwnBarrelCol = 21;
          const innCatsOwnBarrelRow = 6;

          /*
           * The archway down to the taproom is deliberately off-centre.
           *
           * The Bopca's counter run is laid against the north wall of the safe
           * room's bounds — this partition row — and centred on it, three rows
           * deep including the galley behind. An archway in the middle would sit
           * directly under that run, whose back bench is solid: the guest wing
           * would be sealed off with no error and no log anywhere, and a crawler
           * would walk into an inn whose entire upstairs could be seen and never
           * entered. Kept hard against the taproom's west end instead, and the
           * taproom's northern rows kept free of authored furniture across the
           * middle so the run has somewhere to land.
           */
          const innArchwayWestCol = 3;
          const innArchwayEastCol = 4;
          const innArchwayCols = [innArchwayWestCol, innArchwayEastCol];

          const innTaproomHearthCol1 = 1;
          const innTaproomHearthCol2 = 2;
          const innTaproomTableRow = 17;
          const innTaproomChairRow = 18;
          /** Two two-tile side tables along the west of the taproom. */
          const innWestSideTableCol1 = 2;
          const innWestSideTableCol2 = 3;
          const innInnerSideTableCol1 = 6;
          const innInnerSideTableCol2 = 7;
          const innSideTableCols = [
            innWestSideTableCol1,
            innWestSideTableCol2,
            innInnerSideTableCol1,
            innInnerSideTableCol2,
          ];
          const innFeastTableRow = 19;
          const innFeastTableStartCol = innInnerSideTableCol1;
          const innFeastTableEndCol = 11;
          /** Feast seats north of the long table that no side table already seats. */
          const innFeastSeatWestCol = 9;
          const innFeastSeatEastCol = innFeastTableEndCol;
          const innFeastSeatCols = [innFeastSeatWestCol, innFeastSeatEastCol];
          const innBarRunTiles = 7;
          const innBarEndCol = innEastWallCol;
          const innBarStartCol = innBarEndCol - (innBarRunTiles - 1);
          const innBarStoolPitch = 2;

          for (const col of innGuestDividerCols) {
            for (let ry = INN_GUEST_WING_FIRST_ROW; ry <= INN_GUEST_WING_LAST_ROW; ry++)
              grid[ry][col].type = INTERIOR_WALL;
          }
          for (let rx = 1; rx <= innEastWallCol; rx++) {
            grid[INN_GUEST_WALL_ROW][rx].type = INTERIOR_WALL;
            grid[INN_PARTITION_ROW][rx].type = INTERIOR_WALL;
          }
          for (const col of innGuestDoorwayCols) grid[INN_GUEST_WALL_ROW][col].type = floorType;
          for (const col of innArchwayCols) grid[INN_PARTITION_ROW][col].type = floorType;

          for (const room of innGuestRooms) {
            for (let ry = innGuestBedFirstRow; ry <= innGuestBedLastRow; ry++) {
              grid[ry][room.bedWestCol].type = BED;
              grid[ry][room.bedWestCol + 1].type = BED;
            }
            grid[innGuestTableRow][room.tableCol].type = TABLE;
            grid[innGuestChairRow][room.tableCol].type = CHAIR;
            for (let rx = room.rugStartCol; rx <= room.rugEndCol; rx++)
              grid[innGuestRugRow][rx].type = RUG;
          }

          const [innAtticRoom] = innGuestRooms;
          grid[innAtticExtraBunkRow][innAtticRoom.bedWestCol].type = BED;
          grid[innAtticExtraBunkRow][innAtticRoom.bedWestCol + 1].type = BED;
          placeProp(grid[innAtticCrateRow][innAtticCrateCol], CRATE);
          grid[INN_GUEST_WING_FIRST_ROW][innHearthsideCol1].type = FIREPLACE;
          grid[INN_GUEST_WING_FIRST_ROW][innHearthsideCol2].type = FIREPLACE;
          for (let ry = innCatsOwnShelfFirstRow; ry <= innCatsOwnShelfLastRow; ry++)
            placeProp(grid[ry][innCatsOwnShelfCol], BOOKSHELF);
          grid[INN_GUEST_WING_FIRST_ROW][innEastWallCol].type = BRAZIER;
          placeProp(grid[innCatsOwnBarrelRow][innCatsOwnBarrelCol], BARREL);

          // The landing runner stops a column short of each side wall, where the
          // corridor's own barrels stand.
          const innLandingRugStartCol = 2;
          const innLandingRugEndCol = innEastWallCol - 1;
          for (let rx = innLandingRugStartCol; rx <= innLandingRugEndCol; rx++)
            grid[INN_LANDING_RUG_ROW][rx].type = RUG;
          placeProp(grid[INN_LANDING_ROW][1], BARREL);
          placeProp(grid[INN_LANDING_ROW][innEastWallCol], BARREL);

          grid[INN_TAPROOM_FIRST_ROW][innTaproomHearthCol1].type = FIREPLACE;
          grid[INN_TAPROOM_FIRST_ROW][innTaproomHearthCol2].type = FIREPLACE;
          placeProp(grid[INN_TAPROOM_FIRST_ROW][innEastWallCol], BARREL);
          for (const col of innSideTableCols) {
            grid[innTaproomTableRow][col].type = TABLE;
            grid[innTaproomChairRow][col].type = CHAIR;
          }
          for (let rx = innFeastTableStartCol; rx <= innFeastTableEndCol; rx++)
            grid[innFeastTableRow][rx].type = TABLE;
          for (const col of innFeastSeatCols) grid[innTaproomChairRow][col].type = CHAIR;
          for (let rx = innBarStartCol; rx <= innBarEndCol; rx++)
            grid[innTaproomTableRow][rx].type = INTERIOR_COUNTER;
          for (let rx = innBarStartCol; rx <= innBarEndCol; rx += innBarStoolPitch)
            grid[innTaproomChairRow][rx].type = CHAIR;
          placeProp(grid[innSouthRow][1], CRATE);
          placeProp(grid[innSouthRow][2], CRATE);
          placeProp(grid[innSouthRow][innEastWallCol - 1], BARREL);
          placeProp(grid[innSouthRow][innEastWallCol], BARREL);
          break;
        }

        case 'The Rusty Anvil': {
          // A smithy is two rooms, not one: a walled forge hall where the heat
          // and the sparks are, and a small shop across the south end where a
          // customer stands at a counter without walking into the quench. The
          // partition's one doorway lines up with the street door, so the forge
          // hall is still open to anyone who wants to look at it.
          //
          // The shop counter is what stations the smith: `InteriorOccupantSystem`
          // anchors her on the room's `INTERIOR_COUNTER` run, and every brazier
          // is north of the partition, so deleting this run would put her back
          // in the forge hall and leave the room the player spawns into empty.
          const anvilEastWallCol = w - 2;
          const anvilWestForgeCol1 = 3;
          const anvilWestForgeCol2 = 4;
          const anvilEastForgeCol2 = anvilEastWallCol - 2;
          const anvilEastForgeCol1 = anvilEastForgeCol2 - 1;
          const anvilTableRow = 3;
          const anvilCrateStartRow = 5;
          const anvilCrateEndRow = 8;
          const anvilBarrelSideRow = 6;
          const anvilQuenchStartCol = 7;
          const anvilQuenchEndCol = 10;
          const anvilChairRow = 4;
          const anvilSouthRow = h - 2;
          /** The shop is three rows deep — enough for a counter and a lane, no more. */
          const anvilShopDepth = 3;
          const anvilPartitionRow = anvilSouthRow - anvilShopDepth;
          const anvilDoorwayWestCol = Math.floor(w / 2) - 1;
          const anvilDoorwayEastCol = anvilDoorwayWestCol + 1;
          const anvilCounterRow = anvilSouthRow - 1;
          const anvilCounterStartCol = 2;
          const anvilCounterEndCol = anvilDoorwayWestCol - 2;
          grid[1][anvilWestForgeCol1].type = BRAZIER;
          grid[1][anvilWestForgeCol2].type = BRAZIER;
          grid[1][anvilEastForgeCol1].type = BRAZIER;
          grid[1][anvilEastForgeCol2].type = BRAZIER;
          grid[anvilTableRow][anvilWestForgeCol1].type = TABLE;
          grid[anvilTableRow][anvilWestForgeCol2].type = TABLE;
          grid[anvilTableRow][anvilEastForgeCol1].type = TABLE;
          grid[anvilTableRow][anvilEastForgeCol2].type = TABLE;
          for (let ry = anvilCrateStartRow; ry <= anvilCrateEndRow; ry++)
            placeProp(grid[ry][1], CRATE);
          for (let ry = anvilCrateStartRow; ry <= anvilCrateEndRow - 1; ry++)
            placeProp(grid[ry][anvilEastWallCol], BARREL);
          for (let rx = anvilQuenchStartCol; rx <= anvilQuenchEndCol; rx++)
            placeProp(grid[anvilBarrelSideRow][rx], BARREL_SIDE);
          grid[anvilChairRow][anvilQuenchStartCol].type = CHAIR;
          for (let rx = 1; rx <= anvilEastWallCol; rx++)
            grid[anvilPartitionRow][rx].type = INTERIOR_WALL;
          grid[anvilPartitionRow][anvilDoorwayWestCol].type = floorType;
          grid[anvilPartitionRow][anvilDoorwayEastCol].type = floorType;
          for (let rx = anvilCounterStartCol; rx <= anvilCounterEndCol; rx++)
            grid[anvilCounterRow][rx].type = INTERIOR_COUNTER;
          placeProp(grid[anvilCounterRow][anvilEastWallCol], BARREL);
          placeProp(grid[anvilCounterRow][anvilEastWallCol - 1], BARREL);
          placeProp(grid[anvilSouthRow][1], CRATE);
          placeProp(grid[anvilSouthRow][anvilEastWallCol], CRATE);
          break;
        }

        case "Miller's Farm": {
          // A farmhouse whose harvest no longer sits in the room the family eats
          // in: the crates have moved into a lean-to walled off the south-east
          // corner, open along its north side the way a lean-to is open to the
          // yard it was nailed onto. The bed moves west to make room for it.
          const farmEastWallCol = w - 2;
          const farmSouthRow = h - 2;
          const farmHearth1 = 2;
          const farmHearth2 = 3;
          const farmBedNorthRow = 2;
          const farmBedSouthRow = 3;
          const farmBedWestCol = 5;
          const farmBedEastCol = 6;
          const farmBarrelStartRow = 4;
          const farmBarrelEndRow = 6;
          const farmTableRow = 8;
          const farmTableCol1 = 7;
          const farmTableCol2 = 8;
          const farmBarrelSideRow1 = 10;
          const farmBarrelSideRow2 = 11;
          const farmLeanToWidth = 4;
          const farmLeanToWallCol = farmEastWallCol - farmLeanToWidth;
          const farmLeanToFirstCol = farmLeanToWallCol + 1;
          const farmLeanToFirstRow = 7;
          const farmLeanToStackStartRow = farmLeanToFirstRow + 1;
          const farmLeanToStackEndRow = farmSouthRow - 1;
          grid[1][farmHearth1].type = FIREPLACE;
          grid[1][farmHearth2].type = FIREPLACE;
          grid[farmBedNorthRow][farmBedWestCol].type = BED;
          grid[farmBedNorthRow][farmBedEastCol].type = BED;
          grid[farmBedSouthRow][farmBedWestCol].type = BED;
          grid[farmBedSouthRow][farmBedEastCol].type = BED;
          for (let ry = farmBarrelStartRow; ry <= farmBarrelEndRow; ry++)
            placeProp(grid[ry][1], BARREL);
          for (let ry = farmLeanToFirstRow; ry <= farmSouthRow; ry++)
            grid[ry][farmLeanToWallCol].type = INTERIOR_WALL;
          for (let ry = farmLeanToStackStartRow; ry <= farmLeanToStackEndRow; ry++)
            placeProp(grid[ry][farmEastWallCol], CRATE);
          for (let ry = farmLeanToStackStartRow + 1; ry <= farmLeanToStackEndRow; ry++)
            placeProp(grid[ry][farmLeanToFirstCol], CRATE);
          grid[farmTableRow][farmTableCol1].type = TABLE;
          grid[farmTableRow][farmTableCol2].type = TABLE;
          grid[farmTableRow + 1][farmTableCol1].type = CHAIR;
          grid[farmTableRow + 1][farmTableCol2].type = CHAIR;
          placeProp(grid[farmBarrelSideRow1][1], BARREL_SIDE);
          placeProp(grid[farmBarrelSideRow2][1], BARREL_SIDE);
          break;
        }

        case 'The Horned Flagon': {
          // A mead hall: one long central feast table with benches down both
          // sides, a serving bar in the north-east corner, and a snug side bay
          // at each end of the hall walled off the main floor by stub walls. The
          // bays are what stop the mead hall from being one loud box — a party
          // that wants a corner has one, and the hall reads as bigger than the
          // dive down the road because part of it is out of sight.
          const FLAGON_EAST_WALL_COL = w - 2;
          /** A bar this long seats four stools and still leaves the alley a mouth. */
          const FLAGON_BAR_RUN_TILES = 8;
          const FLAGON_BAR_ROW = 2;
          const FLAGON_BAR_START_COL = FLAGON_EAST_WALL_COL - FLAGON_BAR_RUN_TILES + 1;
          const FLAGON_BAR_RETURN_ROW = 3;
          const FLAGON_STOOL_ROW = 3;
          const FLAGON_STOOL_PITCH = 2;
          const FLAGON_HEARTH_COL_1 = 3;
          const FLAGON_HEARTH_COL_2 = 4;
          const FLAGON_FEAST_ROW = 8;
          const FLAGON_FEAST_START_COL = 6;
          /** Floor left between the feast table's east end and the side bay. */
          const FLAGON_FEAST_EAST_GAP = 5;
          const FLAGON_FEAST_END_COL = FLAGON_EAST_WALL_COL - FLAGON_FEAST_EAST_GAP;
          const FLAGON_BENCH_PITCH = 2;
          /** Floor left south and east of a side bay, so its chairs have a lane. */
          const FLAGON_SIDE_TABLE_MARGIN = 3;
          const FLAGON_SIDE_TABLE_ROW = h - 2 - FLAGON_SIDE_TABLE_MARGIN;
          /*
           * One tile off the bay's own outer wall, mirrored east to west. The
           * mirroring is load-bearing rather than tidy: the tile the bay is
           * entered through is the one beside its stub wall, and a table pushed
           * up against that side walls its own snug off.
           */
          const FLAGON_SIDE_TABLE_INSET = 1;
          const FLAGON_SIDE_TABLE_WIDTH = 2;
          const FLAGON_SIDE_TABLES = [
            { col: 1 + FLAGON_SIDE_TABLE_INSET, row: FLAGON_SIDE_TABLE_ROW },
            {
              col: FLAGON_EAST_WALL_COL - FLAGON_SIDE_TABLE_INSET - FLAGON_SIDE_TABLE_WIDTH + 1,
              row: FLAGON_SIDE_TABLE_ROW,
            },
          ];
          /*
           * Each bay is closed on its north side and part of its inner side, and
           * open for the two rows between. The mouth is deliberately two tiles
           * rather than one: a snug entered through a single tile is a trap for
           * anything that wanders into it, and every occupant in this room wanders.
           */
          const FLAGON_BAY_WIDTH = 4;
          const FLAGON_BAY_WALL_ROW = FLAGON_SIDE_TABLE_ROW - 1;
          const FLAGON_BAY_MOUTH_ROWS = 2;
          const FLAGON_BAY_INNER_WALL_FIRST_ROW = FLAGON_BAY_WALL_ROW + 1 + FLAGON_BAY_MOUTH_ROWS;
          const FLAGON_BAY_INNER_WALL_LAST_ROW = h - 2;
          const FLAGON_BAYS = [
            { firstCol: 1, lastCol: FLAGON_BAY_WIDTH, innerWallCol: FLAGON_BAY_WIDTH + 1 },
            {
              firstCol: FLAGON_EAST_WALL_COL - FLAGON_BAY_WIDTH + 1,
              lastCol: FLAGON_EAST_WALL_COL,
              innerWallCol: FLAGON_EAST_WALL_COL - FLAGON_BAY_WIDTH,
            },
          ];
          const FLAGON_RUG_ROW = 5;
          const FLAGON_RUG_START_COL = 3;
          const FLAGON_RUG_END_COL = FLAGON_EAST_WALL_COL - 2;
          const FLAGON_BARREL_TILES = [
            { x: 1, y: 4 },
            { x: 1, y: 5 },
            { x: FLAGON_EAST_WALL_COL, y: 6 },
          ];
          for (let rx = FLAGON_BAR_START_COL; rx <= FLAGON_EAST_WALL_COL; rx++)
            grid[FLAGON_BAR_ROW][rx].type = INTERIOR_COUNTER;
          grid[FLAGON_BAR_RETURN_ROW][FLAGON_BAR_START_COL].type = INTERIOR_COUNTER;
          for (
            let rx = FLAGON_BAR_START_COL + 1;
            rx <= FLAGON_EAST_WALL_COL;
            rx += FLAGON_STOOL_PITCH
          )
            grid[FLAGON_STOOL_ROW][rx].type = CHAIR;
          grid[1][FLAGON_HEARTH_COL_1].type = FIREPLACE;
          grid[1][FLAGON_HEARTH_COL_2].type = FIREPLACE;
          for (let rx = FLAGON_FEAST_START_COL; rx <= FLAGON_FEAST_END_COL; rx++)
            grid[FLAGON_FEAST_ROW][rx].type = TABLE;
          for (let rx = FLAGON_FEAST_START_COL; rx < FLAGON_FEAST_END_COL; rx += FLAGON_BENCH_PITCH)
            grid[FLAGON_FEAST_ROW - 1][rx].type = CHAIR;
          for (
            let rx = FLAGON_FEAST_START_COL + 1;
            rx <= FLAGON_FEAST_END_COL;
            rx += FLAGON_BENCH_PITCH
          )
            grid[FLAGON_FEAST_ROW + 1][rx].type = CHAIR;
          for (const bay of FLAGON_BAYS) {
            for (let rx = bay.firstCol; rx <= bay.lastCol; rx++)
              grid[FLAGON_BAY_WALL_ROW][rx].type = INTERIOR_WALL;
            for (
              let ry = FLAGON_BAY_INNER_WALL_FIRST_ROW;
              ry <= FLAGON_BAY_INNER_WALL_LAST_ROW;
              ry++
            )
              grid[ry][bay.innerWallCol].type = INTERIOR_WALL;
          }
          for (const side of FLAGON_SIDE_TABLES) {
            grid[side.row][side.col].type = TABLE;
            grid[side.row][side.col + 1].type = TABLE;
            grid[side.row + 1][side.col].type = CHAIR;
            grid[side.row + 1][side.col + 1].type = CHAIR;
          }
          for (let rx = FLAGON_RUG_START_COL; rx <= FLAGON_RUG_END_COL; rx++)
            grid[FLAGON_RUG_ROW][rx].type = RUG;
          for (const t of FLAGON_BARREL_TILES) placeProp(grid[t.y][t.x], BARREL);
          break;
        }

        case 'Temple of the Sky': {
          // A hushed hall: the altar stands on a dressed-stone dais under the
          // north wall flanked by braziers, four pew ranks face it, a rug aisle
          // runs the length of the nave, scripture lines both walls.
          const TEMPLE_ALTAR_ROW = 1;
          const TEMPLE_ALTAR_START_COL = 7;
          const TEMPLE_ALTAR_END_COL = 10;
          const TEMPLE_BRAZIER_WEST_COL = 5;
          const TEMPLE_BRAZIER_EAST_COL = 12;
          /*
           * The dais is a band of dressed stone laid over the nave's flagstones,
           * the same trick the garrison's drill sand plays against its stone: two
           * ground materials meeting produce the palette's own corner-mask fringe,
           * so the step reads as a rim rather than as a flat change of colour.
           */
          const TEMPLE_DAIS_FIRST_ROW = 1;
          const TEMPLE_DAIS_LAST_ROW = 2;
          const TEMPLE_DAIS_START_COL = TEMPLE_BRAZIER_WEST_COL - 1;
          const TEMPLE_DAIS_END_COL = TEMPLE_BRAZIER_EAST_COL + 1;
          const TEMPLE_FIRST_PEW_ROW = 4;
          const TEMPLE_PEW_ROW_PITCH = 2;
          /** The taller hall bought one more rank; the rest is nave and narthex. */
          const TEMPLE_PEW_ROWS = 4;
          const TEMPLE_WEST_PEW_START_COL = 3;
          const TEMPLE_WEST_PEW_END_COL = 7;
          const TEMPLE_EAST_PEW_START_COL = 10;
          const TEMPLE_EAST_PEW_END_COL = 14;
          const TEMPLE_AISLE_START_COL = 8;
          const TEMPLE_AISLE_END_COL = 9;
          const TEMPLE_AISLE_START_ROW = TEMPLE_DAIS_LAST_ROW + 1;
          const TEMPLE_AISLE_END_ROW = h - 2 - 2;
          const TEMPLE_SCRIPTURE_START_ROW = 2;
          const TEMPLE_SCRIPTURE_END_ROW = 4;
          const TEMPLE_EAST_WALL_COL = w - 2;
          for (let ry = TEMPLE_DAIS_FIRST_ROW; ry <= TEMPLE_DAIS_LAST_ROW; ry++)
            for (let rx = TEMPLE_DAIS_START_COL; rx <= TEMPLE_DAIS_END_COL; rx++)
              grid[ry][rx].type = INTERIOR_STONE_FLOOR;
          for (let rx = TEMPLE_ALTAR_START_COL; rx <= TEMPLE_ALTAR_END_COL; rx++)
            grid[TEMPLE_ALTAR_ROW][rx].type = TABLE;
          grid[TEMPLE_ALTAR_ROW][TEMPLE_BRAZIER_WEST_COL].type = BRAZIER;
          grid[TEMPLE_ALTAR_ROW][TEMPLE_BRAZIER_EAST_COL].type = BRAZIER;
          for (let pew = 0; pew < TEMPLE_PEW_ROWS; pew++) {
            const pewRow = TEMPLE_FIRST_PEW_ROW + pew * TEMPLE_PEW_ROW_PITCH;
            for (let rx = TEMPLE_WEST_PEW_START_COL; rx <= TEMPLE_WEST_PEW_END_COL; rx++)
              grid[pewRow][rx].type = CHAIR;
            for (let rx = TEMPLE_EAST_PEW_START_COL; rx <= TEMPLE_EAST_PEW_END_COL; rx++)
              grid[pewRow][rx].type = CHAIR;
          }
          for (let ry = TEMPLE_AISLE_START_ROW; ry <= TEMPLE_AISLE_END_ROW; ry++)
            for (let rx = TEMPLE_AISLE_START_COL; rx <= TEMPLE_AISLE_END_COL; rx++)
              grid[ry][rx].type = RUG;
          for (let ry = TEMPLE_SCRIPTURE_START_ROW; ry <= TEMPLE_SCRIPTURE_END_ROW; ry++) {
            placeProp(grid[ry][1], BOOKSHELF);
            placeProp(grid[ry][TEMPLE_EAST_WALL_COL], BOOKSHELF);
          }
          break;
        }

        case 'The Quiet Needle': {
          // A parlour rather than a shop floor, and three rooms rather than one
          // box: a walled inking alcove to the north-west where the work is done
          // out of sight, a pigment room to the north-east where it is ground,
          // and a waiting room across the south end under a wall of flash art.
          // The privacy is the whole reason the room reads as a parlour — a
          // customer on a bench in the middle of a shop is a shop.
          const NEEDLE_EAST_WALL_COL = w - 2;
          const NEEDLE_SOUTH_WALL_ROW = h - 2;
          const NEEDLE_WEST_WALL_COL = 1;
          /** Both north rooms run from the north wall down to the partition. */
          const NEEDLE_WORKROOM_FIRST_ROW = 1;
          const NEEDLE_WORKROOM_LAST_ROW = 6;
          /** The wall between the alcove and the pigment room. */
          const NEEDLE_ZONE_DIVIDER_COL = 8;
          /** The wall between the two north rooms and the waiting room. */
          const NEEDLE_PARTITION_ROW = 7;
          const NEEDLE_WAITING_FIRST_ROW = 8;

          /*
           * One doorway per north room, and neither of them on the divider.
           * Each room is otherwise walled on all four sides, so a room that
           * loses its doorway is a room the player can see and never enter —
           * which throws nothing, logs nothing and looks like art.
           */
          const NEEDLE_ALCOVE_DOORWAY_COL = 5;
          const NEEDLE_PIGMENT_DOORWAY_COL = 12;

          const NEEDLE_ALCOVE_SHELF_ROW = 1;
          const NEEDLE_ALCOVE_SHELF_LAST_COL = 3;
          const NEEDLE_BENCH_ROW = 2;
          const NEEDLE_BENCH_FIRST_COL = 3;
          const NEEDLE_BENCH_LAST_COL = 5;
          const NEEDLE_STOOL_ROW = 3;
          const NEEDLE_STOOL_COL = 4;
          const NEEDLE_ALCOVE_BRAZIER_COL = 6;
          const NEEDLE_ALCOVE_RUG_ROW = 4;
          const NEEDLE_ALCOVE_BARREL_ROW = 5;
          const NEEDLE_ALCOVE_EAST_COL = NEEDLE_ZONE_DIVIDER_COL - 1;

          const NEEDLE_PIGMENT_WEST_COL = NEEDLE_ZONE_DIVIDER_COL + 1;
          const NEEDLE_SLAB_ROW = 1;
          const NEEDLE_WORK_TABLE_ROW = 2;
          const NEEDLE_WORK_STOOL_ROW = 3;
          const NEEDLE_WORK_FIRST_COL = 13;
          const NEEDLE_WORK_LAST_COL = 14;
          const NEEDLE_PIGMENT_SHELF_FIRST_ROW = 5;
          const NEEDLE_PIGMENT_SHELF_LAST_ROW = 6;

          /*
           * The flash art hangs in runs with gaps between them, and the two gaps
           * that matter are the ones directly under the doorways: a sheet hung
           * there would block the only way into its room.
           */
          const NEEDLE_FLASH_ROW = NEEDLE_WAITING_FIRST_ROW;
          const NEEDLE_FLASH_SPANS: ReadonlyArray<{ first: number; last: number }> = [
            { first: 2, last: 4 },
            { first: 6, last: 6 },
            { first: 10, last: 11 },
            { first: 13, last: 15 },
          ];
          const NEEDLE_WAITING_BENCH_ROW = 10;
          const NEEDLE_WEST_BENCH_FIRST_COL = 3;
          const NEEDLE_WEST_BENCH_LAST_COL = 6;
          const NEEDLE_EAST_BENCH_FIRST_COL = 11;
          const NEEDLE_EAST_BENCH_LAST_COL = 14;
          const NEEDLE_LOW_TABLE_FIRST_COL = 8;
          const NEEDLE_LOW_TABLE_LAST_COL = 9;
          const NEEDLE_WAITING_BARREL_ROW = 11;
          const NEEDLE_WAITING_BARREL_WEST_COL = 2;
          const NEEDLE_WAITING_BARREL_EAST_COL = NEEDLE_EAST_WALL_COL - 1;
          const NEEDLE_WAITING_RUG_FIRST_ROW = 12;
          const NEEDLE_WAITING_RUG_LAST_ROW = 13;
          const NEEDLE_WAITING_RUG_FIRST_COL = 5;
          const NEEDLE_WAITING_RUG_LAST_COL = 12;
          const NEEDLE_DOOR_ROW = NEEDLE_SOUTH_WALL_ROW;
          const NEEDLE_DOOR_BRAZIER_WEST_COL = 6;
          const NEEDLE_DOOR_BRAZIER_EAST_COL = 11;

          for (let ry = NEEDLE_WORKROOM_FIRST_ROW; ry <= NEEDLE_WORKROOM_LAST_ROW; ry++)
            grid[ry][NEEDLE_ZONE_DIVIDER_COL].type = INTERIOR_WALL;
          for (let rx = NEEDLE_WEST_WALL_COL; rx <= NEEDLE_EAST_WALL_COL; rx++)
            grid[NEEDLE_PARTITION_ROW][rx].type = INTERIOR_WALL;
          grid[NEEDLE_PARTITION_ROW][NEEDLE_ALCOVE_DOORWAY_COL].type = floorType;
          grid[NEEDLE_PARTITION_ROW][NEEDLE_PIGMENT_DOORWAY_COL].type = floorType;

          for (let rx = NEEDLE_WEST_WALL_COL; rx <= NEEDLE_ALCOVE_SHELF_LAST_COL; rx++)
            placeProp(grid[NEEDLE_ALCOVE_SHELF_ROW][rx], PIGMENT_SHELF);
          for (let rx = NEEDLE_BENCH_FIRST_COL; rx <= NEEDLE_BENCH_LAST_COL; rx++)
            grid[NEEDLE_BENCH_ROW][rx].type = INK_BENCH;
          grid[NEEDLE_STOOL_ROW][NEEDLE_STOOL_COL].type = CHAIR;
          grid[NEEDLE_STOOL_ROW][NEEDLE_ALCOVE_BRAZIER_COL].type = BRAZIER;
          for (let rx = NEEDLE_BENCH_FIRST_COL; rx <= NEEDLE_BENCH_LAST_COL; rx++)
            grid[NEEDLE_ALCOVE_RUG_ROW][rx].type = RUG;
          placeProp(grid[NEEDLE_ALCOVE_BARREL_ROW][NEEDLE_WEST_WALL_COL], BARREL);
          placeProp(grid[NEEDLE_ALCOVE_BARREL_ROW][NEEDLE_ALCOVE_EAST_COL], BARREL);

          for (let rx = NEEDLE_WORK_FIRST_COL; rx <= NEEDLE_WORK_LAST_COL; rx++) {
            placeProp(grid[NEEDLE_SLAB_ROW][rx], GRINDING_SLAB);
            grid[NEEDLE_WORK_TABLE_ROW][rx].type = TABLE;
            grid[NEEDLE_WORK_STOOL_ROW][rx].type = CHAIR;
          }
          for (let ry = NEEDLE_PIGMENT_SHELF_FIRST_ROW; ry <= NEEDLE_PIGMENT_SHELF_LAST_ROW; ry++) {
            placeProp(grid[ry][NEEDLE_PIGMENT_WEST_COL], PIGMENT_SHELF);
            placeProp(grid[ry][NEEDLE_EAST_WALL_COL], PIGMENT_SHELF);
          }

          for (const span of NEEDLE_FLASH_SPANS)
            for (let rx = span.first; rx <= span.last; rx++)
              placeProp(grid[NEEDLE_FLASH_ROW][rx], FLASH_WALL);
          for (let rx = NEEDLE_WEST_BENCH_FIRST_COL; rx <= NEEDLE_WEST_BENCH_LAST_COL; rx++)
            grid[NEEDLE_WAITING_BENCH_ROW][rx].type = CHAIR;
          for (let rx = NEEDLE_EAST_BENCH_FIRST_COL; rx <= NEEDLE_EAST_BENCH_LAST_COL; rx++)
            grid[NEEDLE_WAITING_BENCH_ROW][rx].type = CHAIR;
          for (let rx = NEEDLE_LOW_TABLE_FIRST_COL; rx <= NEEDLE_LOW_TABLE_LAST_COL; rx++)
            grid[NEEDLE_WAITING_BENCH_ROW][rx].type = TABLE;
          placeProp(grid[NEEDLE_WAITING_BARREL_ROW][NEEDLE_WAITING_BARREL_WEST_COL], BARREL);
          placeProp(grid[NEEDLE_WAITING_BARREL_ROW][NEEDLE_WAITING_BARREL_EAST_COL], BARREL);
          for (let ry = NEEDLE_WAITING_RUG_FIRST_ROW; ry <= NEEDLE_WAITING_RUG_LAST_ROW; ry++)
            for (let rx = NEEDLE_WAITING_RUG_FIRST_COL; rx <= NEEDLE_WAITING_RUG_LAST_COL; rx++)
              grid[ry][rx].type = RUG;
          grid[NEEDLE_DOOR_ROW][NEEDLE_DOOR_BRAZIER_WEST_COL].type = BRAZIER;
          grid[NEEDLE_DOOR_ROW][NEEDLE_DOOR_BRAZIER_EAST_COL].type = BRAZIER;
          placeProp(grid[NEEDLE_DOOR_ROW][NEEDLE_WEST_WALL_COL], CRATE);
          placeProp(grid[NEEDLE_DOOR_ROW][NEEDLE_EAST_WALL_COL], CRATE);
          break;
        }

        case 'The Barracks': {
          // The garrison, and three rooms rather than one box: the
          // quartermaster's armoury penned behind its counter run to the west, a
          // sanded drill hall with its dummies and its sparring ring to the
          // east, and a muster hall across the south end that both of them open
          // onto.
          const BARRACKS_EAST_WALL_COL = w - 2;
          const BARRACKS_SOUTH_WALL_ROW = h - 2;
          const BARRACKS_ARMOURY_FIRST_COL = 1;
          const BARRACKS_ARMOURY_LAST_COL = BARRACKS_ZONE_DIVIDER_COL - 1;
          const BARRACKS_DRILL_FIRST_COL = BARRACKS_ZONE_DIVIDER_COL + 1;

          /*
           * Two archways rather than one, and neither of them centred.
           *
           * The armoury and the drill hall share no wall of their own, so each
           * needs its own way down into the muster hall or one of the two is a
           * room the player can see and never enter — a sealed wing throws
           * nothing and logs nothing. The eastern archway is kept one column
           * west of the lane the muster hall keeps clear, so the walk from the
           * door to the drill hall never crosses the map table.
           */
          const BARRACKS_ARMOURY_ARCHWAY_COL = 3;
          const BARRACKS_DRILL_ARCHWAY_COL = 14;
          /**
           * The north-south lane the muster hall keeps free of furniture, joining
           * the entrance to both archways along row {@link BARRACKS_MUSTER_FIRST_ROW}.
           */
          const BARRACKS_MUSTER_LANE_COL = 13;

          const BARRACKS_RACK_ROW = 1;
          const BARRACKS_RACK_LAST_COL = 4;
          const BARRACKS_STOCK_ROW = 2;
          const BARRACKS_STOCK_BARREL_LAST_COL = 2;
          /*
           * The counter run stops one column short of the divider wall, and the
           * gap it leaves is a flap rather than a decoration: it is the only way
           * into the stock alley the run pens off along the north wall. A run
           * spanning all six columns would seal that alley outright.
           */
          const BARRACKS_COUNTER_ROW = 3;
          const BARRACKS_COUNTER_LAST_COL = BARRACKS_ARMOURY_LAST_COL - 1;
          const BARRACKS_ISSUE_CRATE_FIRST_ROW = 5;
          const BARRACKS_ISSUE_CRATE_LAST_ROW = 6;
          const BARRACKS_ISSUE_SHELF_ROW = 8;
          const BARRACKS_ISSUE_BARREL_ROW = 9;
          const BARRACKS_ISSUE_STACK_ROW = BARRACKS_UPPER_LAST_ROW;

          const BARRACKS_DUMMY_NORTH_ROW = 2;
          const BARRACKS_DUMMY_SOUTH_ROW = 10;
          const BARRACKS_DUMMY_WEST_COL = 11;
          const BARRACKS_DUMMY_EAST_COL = 17;
          const BARRACKS_RING_FIRST_ROW = 5;
          const BARRACKS_RING_LAST_ROW = 8;
          const BARRACKS_RING_FIRST_COL = 10;
          const BARRACKS_RING_LAST_COL = 18;

          const BARRACKS_BOARD_ROW = BARRACKS_MUSTER_FIRST_ROW;
          const BARRACKS_BOARD_LAST_COL = 2;
          const BARRACKS_MAP_TABLE_ROW = 14;
          const BARRACKS_MAP_TABLE_FIRST_COL = 9;
          const BARRACKS_MAP_TABLE_LAST_COL = 12;
          const BARRACKS_MAP_STOOL_ROW = 15;
          const BARRACKS_MUSTER_BARREL_ROW = 15;
          const BARRACKS_MUSTER_BARREL_WEST_COL = 2;
          const BARRACKS_MUSTER_BARREL_EAST_COL = BARRACKS_EAST_WALL_COL - 1;
          const BARRACKS_BENCH_ROW = BARRACKS_SOUTH_WALL_ROW;
          const BARRACKS_WEST_BENCH_FIRST_COL = 2;
          const BARRACKS_EAST_BENCH_LAST_COL = BARRACKS_EAST_WALL_COL - 1;
          const BARRACKS_BENCH_TILES = 2;
          const BARRACKS_BRAZIER_WEST_COL = 6;
          const BARRACKS_BRAZIER_EAST_COL = 15;
          const BARRACKS_DOOR_RUG_FIRST_COL = BARRACKS_MAP_TABLE_FIRST_COL;
          const BARRACKS_DOOR_RUG_LAST_COL = BARRACKS_MAP_TABLE_LAST_COL;

          for (let ry = BARRACKS_UPPER_FIRST_ROW; ry <= BARRACKS_UPPER_LAST_ROW; ry++)
            grid[ry][BARRACKS_ZONE_DIVIDER_COL].type = INTERIOR_WALL;
          for (let rx = 1; rx <= BARRACKS_EAST_WALL_COL; rx++)
            grid[BARRACKS_PARTITION_ROW][rx].type = INTERIOR_WALL;
          grid[BARRACKS_PARTITION_ROW][BARRACKS_ARMOURY_ARCHWAY_COL].type = floorType;
          grid[BARRACKS_PARTITION_ROW][BARRACKS_DRILL_ARCHWAY_COL].type = DRILL_SAND_FLOOR;

          // Raked sand over the whole drill hall, laid before its furniture so
          // the dummies and the ring stamp over it rather than under it.
          for (let ry = BARRACKS_UPPER_FIRST_ROW; ry <= BARRACKS_UPPER_LAST_ROW; ry++)
            for (let rx = BARRACKS_DRILL_FIRST_COL; rx <= BARRACKS_EAST_WALL_COL; rx++)
              grid[ry][rx].type = DRILL_SAND_FLOOR;

          for (let rx = BARRACKS_ARMOURY_FIRST_COL; rx <= BARRACKS_RACK_LAST_COL; rx++)
            placeProp(grid[BARRACKS_RACK_ROW][rx], WEAPON_RACK);
          for (let rx = BARRACKS_ARMOURY_FIRST_COL; rx <= BARRACKS_STOCK_BARREL_LAST_COL; rx++)
            placeProp(grid[BARRACKS_STOCK_ROW][rx], BARREL);
          for (let rx = BARRACKS_ARMOURY_FIRST_COL; rx <= BARRACKS_COUNTER_LAST_COL; rx++)
            grid[BARRACKS_COUNTER_ROW][rx].type = INTERIOR_COUNTER;
          for (let ry = BARRACKS_ISSUE_CRATE_FIRST_ROW; ry <= BARRACKS_ISSUE_CRATE_LAST_ROW; ry++) {
            placeProp(grid[ry][BARRACKS_ARMOURY_FIRST_COL], CRATE);
            placeProp(grid[ry][BARRACKS_ARMOURY_LAST_COL], CRATE);
          }
          placeProp(grid[BARRACKS_ISSUE_SHELF_ROW][BARRACKS_ARMOURY_FIRST_COL], BOOKSHELF);
          placeProp(grid[BARRACKS_ISSUE_SHELF_ROW][BARRACKS_ARMOURY_LAST_COL], BOOKSHELF);
          placeProp(grid[BARRACKS_ISSUE_BARREL_ROW][BARRACKS_ARMOURY_FIRST_COL], BARREL);
          placeProp(grid[BARRACKS_ISSUE_BARREL_ROW][BARRACKS_ARMOURY_LAST_COL], BARREL);
          for (let rx = BARRACKS_ARMOURY_FIRST_COL; rx <= BARRACKS_ARMOURY_LAST_COL; rx++) {
            const insideTheArchway =
              rx === BARRACKS_ARMOURY_ARCHWAY_COL || rx === BARRACKS_ARMOURY_ARCHWAY_COL + 1;
            if (insideTheArchway) continue;
            placeProp(grid[BARRACKS_ISSUE_STACK_ROW][rx], CRATE);
          }

          for (const dummyRow of [BARRACKS_DUMMY_NORTH_ROW, BARRACKS_DUMMY_SOUTH_ROW]) {
            grid[dummyRow][BARRACKS_DUMMY_WEST_COL].type = TRAINING_DUMMY;
            grid[dummyRow][BARRACKS_DUMMY_EAST_COL].type = TRAINING_DUMMY;
          }
          for (let ry = BARRACKS_RING_FIRST_ROW; ry <= BARRACKS_RING_LAST_ROW; ry++)
            for (let rx = BARRACKS_RING_FIRST_COL; rx <= BARRACKS_RING_LAST_COL; rx++)
              grid[ry][rx].type = RUG;

          for (let rx = BARRACKS_ARMOURY_FIRST_COL; rx <= BARRACKS_BOARD_LAST_COL; rx++)
            placeProp(grid[BARRACKS_BOARD_ROW][rx], MUSTER_BOARD);
          for (let rx = BARRACKS_MAP_TABLE_FIRST_COL; rx <= BARRACKS_MAP_TABLE_LAST_COL; rx++)
            grid[BARRACKS_MAP_TABLE_ROW][rx].type = MAP_TABLE;
          grid[BARRACKS_MAP_STOOL_ROW][BARRACKS_MAP_TABLE_FIRST_COL].type = CHAIR;
          grid[BARRACKS_MAP_STOOL_ROW][BARRACKS_MAP_TABLE_LAST_COL].type = CHAIR;
          placeProp(grid[BARRACKS_MUSTER_BARREL_ROW][BARRACKS_MUSTER_BARREL_WEST_COL], BARREL);
          placeProp(grid[BARRACKS_MUSTER_BARREL_ROW][BARRACKS_MUSTER_BARREL_EAST_COL], BARREL);
          for (let seat = 0; seat < BARRACKS_BENCH_TILES; seat++) {
            grid[BARRACKS_BENCH_ROW][BARRACKS_WEST_BENCH_FIRST_COL + seat].type = CHAIR;
            grid[BARRACKS_BENCH_ROW][BARRACKS_EAST_BENCH_LAST_COL - seat].type = CHAIR;
          }
          grid[BARRACKS_BENCH_ROW][BARRACKS_BRAZIER_WEST_COL].type = BRAZIER;
          grid[BARRACKS_BENCH_ROW][BARRACKS_BRAZIER_EAST_COL].type = BRAZIER;
          for (let rx = BARRACKS_DOOR_RUG_FIRST_COL; rx <= BARRACKS_DOOR_RUG_LAST_COL; rx++)
            grid[BARRACKS_BENCH_ROW][rx].type = RUG;

          // Cleared last, after every fitting above it. The lane is what joins
          // the entrance to both archways, so a prop that grew into it would cut
          // the drill hall or the armoury off with no symptom anyone could
          // report — only a room the player can see and never enter.
          for (let ry = BARRACKS_MUSTER_FIRST_ROW; ry <= BARRACKS_SOUTH_WALL_ROW; ry++)
            grid[ry][BARRACKS_MUSTER_LANE_COL].type = floorType;
          break;
        }

        case 'The Sunken Stump Pub': {
          // A cramped, dark dive: L-shaped bar penning in a barkeep alley,
          // stools along its front, tight table clusters and barrels everywhere.
          const STUMP_BAR_ROW = 3;
          const STUMP_BAR_END_COL = 7;
          const STUMP_BAR_RETURN_ROW = 2;
          const STUMP_STOOL_ROW = 4;
          const STUMP_FIRST_STOOL_COL = 2;
          const STUMP_STOOL_PITCH = 2;
          const STUMP_EAST_WALL_COL = w - 2;
          const STUMP_SOUTH_WALL_ROW = h - 2;
          const STUMP_HEARTH_COL_2 = STUMP_EAST_WALL_COL - 1;
          const STUMP_HEARTH_COL_1 = STUMP_EAST_WALL_COL - 2;
          /** The column the player walks in on, kept clear of furniture. */
          const STUMP_DOOR_LANE_COL = Math.floor(w / 2);
          /*
           * Seven clusters jammed into a room the mead hall would fit twice over.
           * The dive's whole character is that it is the cramped one, and a table
           * count alone does not say that — what says it is the pitch: three
           * columns per cluster leaves a one-tile lane between them, so a crawler
           * crossing this floor squeezes past drinkers the entire way. The south
           * rank leaves the door's own column open so the room is enterable.
           */
          const STUMP_CLUSTER_PITCH = 3;
          const STUMP_FIRST_CLUSTER_COL = 2;
          const STUMP_NORTH_CLUSTER_ROW = 6;
          const STUMP_SOUTH_CLUSTER_ROW = 9;
          const STUMP_NORTH_CLUSTER_COUNT = 4;
          const STUMP_TABLE_CLUSTERS: Array<{ col: number; row: number }> = [];
          for (let n = 0; n < STUMP_NORTH_CLUSTER_COUNT; n++)
            STUMP_TABLE_CLUSTERS.push({
              col: STUMP_FIRST_CLUSTER_COL + n * STUMP_CLUSTER_PITCH,
              row: STUMP_NORTH_CLUSTER_ROW,
            });
          for (let n = 0; n < STUMP_NORTH_CLUSTER_COUNT; n++) {
            const col = STUMP_FIRST_CLUSTER_COL + n * STUMP_CLUSTER_PITCH;
            if (col <= STUMP_DOOR_LANE_COL && col + 1 >= STUMP_DOOR_LANE_COL) continue;
            STUMP_TABLE_CLUSTERS.push({ col, row: STUMP_SOUTH_CLUSTER_ROW });
          }
          const STUMP_RUG_ROW = 8;
          const STUMP_RUG_START_COL = 5;
          const STUMP_RUG_END_COL = 9;
          const STUMP_BARREL_TILES = [
            { x: STUMP_EAST_WALL_COL, y: 4 },
            { x: STUMP_EAST_WALL_COL, y: 5 },
            { x: STUMP_EAST_WALL_COL - 1, y: 4 },
          ];
          const STUMP_BARREL_SIDE_ROW = STUMP_SOUTH_WALL_ROW - 1;
          const STUMP_BARREL_SIDE_TILES = [
            { x: 1, y: STUMP_BARREL_SIDE_ROW },
            { x: STUMP_EAST_WALL_COL, y: STUMP_BARREL_SIDE_ROW },
          ];
          // The bar's long run plus its return arm; the gap east of the return is
          // the only way in or out of the alley, so the barkeep stays put.
          for (let rx = 1; rx <= STUMP_BAR_END_COL; rx++)
            grid[STUMP_BAR_ROW][rx].type = INTERIOR_COUNTER;
          grid[STUMP_BAR_RETURN_ROW][STUMP_BAR_END_COL].type = INTERIOR_COUNTER;
          for (let rx = STUMP_FIRST_STOOL_COL; rx < STUMP_BAR_END_COL; rx += STUMP_STOOL_PITCH)
            grid[STUMP_STOOL_ROW][rx].type = CHAIR;
          grid[1][STUMP_HEARTH_COL_1].type = FIREPLACE;
          grid[1][STUMP_HEARTH_COL_2].type = FIREPLACE;
          for (const cluster of STUMP_TABLE_CLUSTERS) {
            grid[cluster.row][cluster.col].type = TABLE;
            grid[cluster.row][cluster.col + 1].type = TABLE;
            grid[cluster.row + 1][cluster.col].type = CHAIR;
            grid[cluster.row + 1][cluster.col + 1].type = CHAIR;
          }
          for (let rx = STUMP_RUG_START_COL; rx <= STUMP_RUG_END_COL; rx++)
            grid[STUMP_RUG_ROW][rx].type = RUG;
          for (const t of STUMP_BARREL_TILES) placeProp(grid[t.y][t.x], BARREL);
          for (const t of STUMP_BARREL_SIDE_TILES) placeProp(grid[t.y][t.x], BARREL_SIDE);
          break;
        }
      }
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

      if (hasUp) this._interiorStairUpTiles = fillStairBlock(upX, stairRow, STAIRS_UP);
      if (hasDown) this._interiorStairDownTiles = fillStairBlock(dnX, stairRow, STAIRS_DOWN);

      // ── Tower floor furniture (20×16, carpet) ──
      // Both stair blocks occupy rows TOWER_STAIR_ROW and the one below it; the
      // furniture on every floor is placed clear of those two rows at the stair
      // columns, so nothing here overwrites a staircase.
      // TOWER_ENTRANCE_ROW_INSET: h - this value = second-to-last interior row (barrel/entrance row)
      const TOWER_ENTRANCE_ROW_INSET = 3;
      const towerFireplaceCol1 = 9;
      const towerFireplaceCol2 = 10;
      const towerShelfStartRow = 3;
      if (towerFloor === 0) {
        // Ground floor: reception hall — large rug, tables, bookshelves, fireplace
        const groundFloorRugStartRow = 6;
        const groundFloorRugEndRow = 9;
        const groundFloorRugStartCol = 7;
        const groundFloorRugEndCol = 13;
        const groundFloorShelfEndRow = 7;
        const groundFloorReceptionRow = 7;
        const groundFloorChairRow = 8;
        const groundFloorReceptionTableCol1 = 4;
        const groundFloorReceptionTableCol2 = 5;
        const groundFloorReceptionTableCol3 = 6;
        const groundFloorEastBarrelRow = 4;
        // Fireplace centered on north wall
        grid[1][towerFireplaceCol1].type = FIREPLACE;
        grid[1][towerFireplaceCol2].type = FIREPLACE;
        // Large rug in center
        for (let ry = groundFloorRugStartRow; ry <= groundFloorRugEndRow; ry++) {
          for (let rx = groundFloorRugStartCol; rx <= groundFloorRugEndCol; rx++)
            grid[ry][rx].type = RUG;
        }
        for (let ry = towerShelfStartRow; ry <= groundFloorShelfEndRow; ry++)
          placeProp(grid[ry][1], BOOKSHELF);
        // Reception table with chairs
        grid[groundFloorReceptionRow][groundFloorReceptionTableCol1].type = TABLE;
        grid[groundFloorReceptionRow][groundFloorReceptionTableCol2].type = TABLE;
        grid[groundFloorReceptionRow][groundFloorReceptionTableCol3].type = TABLE;
        grid[groundFloorChairRow][groundFloorReceptionTableCol1].type = CHAIR;
        grid[groundFloorChairRow][groundFloorReceptionTableCol3].type = CHAIR;
        grid[groundFloorReceptionRow - 1][groundFloorReceptionTableCol2].type = CHAIR;
        // Barrels near entrance
        placeProp(grid[h - TOWER_ENTRANCE_ROW_INSET][1], BARREL);
        placeProp(grid[h - TOWER_ENTRANCE_ROW_INSET][2], BARREL);
        placeProp(grid[h - TOWER_ENTRANCE_ROW_INSET][w - 2], BARREL);
        // Torch-style decoration on east wall (use barrel as substitute)
        placeProp(grid[groundFloorEastBarrelRow][w - 2], BARREL);
      } else if (towerFloor === 1) {
        // 2nd floor: library — lots of bookshelves + reading tables
        const libraryShelfEndRow = 9;
        const libraryIslandRow = 4;
        const libraryIsland1StartCol = 7;
        const libraryIsland1EndCol = 9;
        const libraryIsland2StartCol = 11;
        const libraryIsland2EndCol = 13;
        const libraryReadingRow = 7;
        const libraryChairRow = 8;
        const libraryWestTableCol1 = 5;
        const libraryWestTableCol2 = 6;
        const libraryEastTableCol1 = 11;
        const libraryEastTableCol2 = 12;
        const libraryRugStartCol = 7;
        const libraryRugEndCol = 10;
        for (let ry = towerShelfStartRow; ry <= libraryShelfEndRow; ry++)
          placeProp(grid[ry][1], BOOKSHELF);
        for (let ry = towerShelfStartRow; ry <= libraryShelfEndRow; ry++)
          placeProp(grid[ry][w - 2], BOOKSHELF);
        for (let rx = libraryIsland1StartCol; rx <= libraryIsland1EndCol; rx++)
          placeProp(grid[libraryIslandRow][rx], BOOKSHELF);
        for (let rx = libraryIsland2StartCol; rx <= libraryIsland2EndCol; rx++)
          placeProp(grid[libraryIslandRow][rx], BOOKSHELF);
        // Reading tables
        grid[libraryReadingRow][libraryWestTableCol1].type = TABLE;
        grid[libraryReadingRow][libraryWestTableCol2].type = TABLE;
        grid[libraryChairRow][libraryWestTableCol1].type = CHAIR;
        grid[libraryChairRow][libraryWestTableCol2].type = CHAIR;
        grid[libraryReadingRow][libraryEastTableCol1].type = TABLE;
        grid[libraryReadingRow][libraryEastTableCol2].type = TABLE;
        grid[libraryChairRow][libraryEastTableCol1].type = CHAIR;
        grid[libraryChairRow][libraryEastTableCol2].type = CHAIR;
        // Rug between tables
        for (let rx = libraryRugStartCol; rx <= libraryRugEndCol; rx++) {
          grid[libraryReadingRow][rx].type = RUG;
          grid[libraryChairRow][rx].type = RUG;
        }
      } else if (towerFloor === 2) {
        // 3rd floor: living quarters — beds, tables, personal items
        const quartersNorthBedRow1 = 3;
        const quartersNorthBedRow2 = 4;
        const quartersSouthBedRow1 = 7;
        const quartersSouthBedRow2 = 8;
        const quartersShelfRow1 = 5;
        const quartersShelfRow2 = 6;
        const quartersEastTableRow = 6;
        const quartersEastTableCol1 = w - TOWER_STAIR_UP_X_OFFSET;
        const quartersEastTableCol2 = w - TOWER_STAIR_UP_X_OFFSET + 1;
        const quartersEastTableCol3 = w - TOWER_STAIR_UP_X_OFFSET + 2;
        const quartersBarrelRow1 = 10;
        const quartersBarrelRow2 = 11;
        const quartersRugStartCol = 3;
        const quartersRugEndCol = 4;
        // Two beds along west wall
        grid[quartersNorthBedRow1][1].type = BED;
        grid[quartersNorthBedRow1][2].type = BED;
        grid[quartersNorthBedRow2][1].type = BED;
        grid[quartersNorthBedRow2][2].type = BED;
        grid[quartersSouthBedRow1][1].type = BED;
        grid[quartersSouthBedRow1][2].type = BED;
        grid[quartersSouthBedRow2][1].type = BED;
        grid[quartersSouthBedRow2][2].type = BED;
        placeProp(grid[quartersShelfRow1][1], BOOKSHELF);
        placeProp(grid[quartersShelfRow2][1], BOOKSHELF);
        // Table and chairs on east side
        grid[quartersEastTableRow][quartersEastTableCol1].type = TABLE;
        grid[quartersEastTableRow][quartersEastTableCol2].type = TABLE;
        grid[quartersEastTableRow][quartersEastTableCol3].type = TABLE;
        grid[quartersEastTableRow + 1][quartersEastTableCol1].type = CHAIR;
        grid[quartersEastTableRow + 1][quartersEastTableCol3].type = CHAIR;
        // Barrel storage
        placeProp(grid[quartersBarrelRow1][w - 2], BARREL);
        placeProp(grid[quartersBarrelRow2][w - 2], BARREL);
        // Rug by beds
        for (let rx = quartersRugStartCol; rx <= quartersRugEndCol; rx++) {
          grid[quartersNorthBedRow2][rx].type = RUG;
          grid[quartersShelfRow1][rx].type = RUG;
          grid[quartersShelfRow2][rx].type = RUG;
          grid[quartersSouthBedRow1][rx].type = RUG;
        }
        // Fireplace on north wall
        grid[1][towerFireplaceCol1].type = FIREPLACE;
        grid[1][towerFireplaceCol2].type = FIREPLACE;
      } else {
        // Top floor: study/throne room — desk, bookshelves, large rug
        const studyShelfEndRow = 8;
        const studyDeskRow = towerShelfStartRow;
        const studyDeskStartCol = 8;
        const studyDeskEndCol = 11;
        const studyDeskCentreCol = Math.floor((studyDeskStartCol + studyDeskEndCol) / 2);
        const studyChairRow = towerShelfStartRow + 1;
        const studyRugStartRow = 5;
        const studyRugEndRow = 10;
        const studyRugStartCol = 5;
        const studyRugEndCol = 14;
        const studyFireplaceCol1 = 6;
        const studyFireplaceCol2 = 7;
        for (let ry = towerShelfStartRow; ry <= studyShelfEndRow; ry++)
          placeProp(grid[ry][1], BOOKSHELF);
        for (let ry = towerShelfStartRow; ry <= studyShelfEndRow; ry++)
          placeProp(grid[ry][w - 2], BOOKSHELF);
        // Grand desk at north end
        for (let dx = studyDeskStartCol; dx <= studyDeskEndCol; dx++)
          grid[studyDeskRow][dx].type = TABLE;
        grid[studyChairRow][studyDeskCentreCol].type = CHAIR;
        // Large rug in center
        for (let ry = studyRugStartRow; ry <= studyRugEndRow; ry++) {
          for (let rx = studyRugStartCol; rx <= studyRugEndCol; rx++) grid[ry][rx].type = RUG;
        }
        // Fireplace on north wall
        grid[1][studyFireplaceCol1].type = FIREPLACE;
        grid[1][studyFireplaceCol2].type = FIREPLACE;
        // Barrel in corners
        placeProp(grid[h - TOWER_ENTRANCE_ROW_INSET][1], BARREL);
        placeProp(grid[h - TOWER_ENTRANCE_ROW_INSET][w - 2], BARREL);
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
   */
  private generateBigTopMaze(): void {
    const grid: TileContent[][] = BIG_TOP_MAZE_ROWS.map((row, y) =>
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
  ): Array<{ x: number; y: number }> {
    if (!this.isWalkable(goalX, goalY)) return [];
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
        this.cardinalWalkable[i] = this.isWalkable(cx + step.dx, cy + step.dy);
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
        if (!this.isWalkable(nx, ny)) continue;
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
    this.applyBlockKeySet(this.stairwellBlockedSet, BLOCK_STAIRWELL);
  }

  private applyBlockKeySet(keys: ReadonlySet<number>, flag: number): void {
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

  blockTilePermanently(tileX: number, tileY: number): void {
    this.permanentBlockedTiles.add(tileCoordKey(tileX, tileY));
    this.addBlockFlag(tileX, tileY, BLOCK_PERMANENT);
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
      permanentBlockedTiles: [...this.permanentBlockedTiles],
      stairwellTiles: this._stairwellTiles.map((tile) => ({ x: tile.x, y: tile.y })),
    };
  }

  restoreCheckpoint(snapshot: GameMapCheckpoint): void {
    this.arenaDoorLocked = snapshot.arenaDoorLocked;

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
    return isWalkableTileType(this.structure[tileY][tileX]);
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
    return isWalkableTileType(this.structure[tileY][tileX]);
  }

  isStairwellTile(tileX: number, tileY: number): boolean {
    if (!this.isInsideGrid(tileX, tileY)) return false;
    return (this.blockedMask[tileIndex(tileX, tileY, this.maskWidth)] & BLOCK_STAIRWELL) !== 0;
  }

  /**
   * Returns true if there is a clear line of sight between two pixel-space
   * points — i.e. no non-walkable tiles cross the line segment.
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
      if (!this.isWalkable(tileX, tileY)) return false;
    }
    return true;
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

  renderCanvas(
    ctx: CanvasRenderingContext2D,
    cameraX: number,
    cameraY: number,
    viewW: number,
    viewH: number,
  ): void {
    this._chunkCache ??= new TileChunkCache(this.structure, this.tileHeight);
    for (const t of this._dirtyTiles) {
      this._chunkCache.invalidateTile(t.x, t.y);
      this._overlayCache?.invalidateTile(t.x, t.y);
      this.refreshDecorationTile(t.x, t.y);
    }
    this._dirtyTiles.length = 0;
    renderCanvas(
      ctx,
      this.structure,
      this.tileHeight,
      cameraX,
      cameraY,
      viewW,
      viewH,
      this._chunkCache,
    );
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
    for (let y = startY; y <= endY; y++) {
      for (const entry of this._decorationRows[y]) {
        if (entry.tx < startX || entry.tx > endX) continue;
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
      visible.push(entry);
    }

    return visible;
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
  /** `tileCoordKey` values, so the entries survive a structure replacement. */
  permanentBlockedTiles: number[];
  stairwellTiles: ReadonlyArray<{ x: number; y: number }>;
}
