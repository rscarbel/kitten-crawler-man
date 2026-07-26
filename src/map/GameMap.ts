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
  ROOF_CIRCUS_RED,
  ROOF_CIRCUS_BLUE,
  ROOF_CIRCUS_PURPLE,
  FOUNTAIN,
  TORCH,
  WELL,
  SAFE_ROOM_FLOOR,
  STAIRS_UP,
  STAIRS_DOWN,
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
  FENCE,
  MODERN_DECORATION,
  WALKABLE_MODERN_DECORATION_VARIANTS,
  RUINED_WALL,
  SAWDUST_FLOOR,
  CIRCUS_RING_EDGE,
  TENT_POLE,
  BLEACHER,
  CLUB_FLOOR,
  DANCE_FLOOR,
  TOWN_WALL,
  SAFE_ROOM_COUNTER,
  SAFE_ROOM_COUNTER_BACK,
  TILE_TYPE_COUNT,
  placeProp,
} from './tileTypes';
import { tileIndex, tileCoordKey, tileKeyX, tileKeyY } from './tileIndex';
import { MinHeap, HEAP_EMPTY } from '../core/MinHeap';
import {
  CLUB_INTERIOR_W,
  CLUB_INTERIOR_H,
  CLUB_DANCE_FLOOR,
  CLUB_DIVIDER_WALLS,
  CLUB_FURNITURE_TILES,
} from '../core/clubLayout';
import {
  generateDungeon,
  type ArenaExterior,
  type QuestRoomData,
  type TreasureRoomData,
  type SpiderLabRoomData,
} from './DungeonGenerator';
import { generateOverworld, type BuildingEntry } from './OverworldGenerator';
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

// ── Interior building dimensions (width × height in tiles) ────────────────────
export const TOWER_INTERIOR_W = 20;
const TOWER_INTERIOR_H = 16;
const RESTAURANT_INTERIOR_W = 22;
const RESTAURANT_INTERIOR_H = 16;
const STORE_INTERIOR_W = 20;
const STORE_INTERIOR_H = 12;
const HOUSE_INTERIOR_W = 18;
const HOUSE_INTERIOR_H = 14;
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

// ── Floor tile type values used in interior generation ────────────────────────
/** Carpet floor tile (used in tower interiors). */
const CARPET_FLOOR = 7;
/** Wood floor tile (used in house / store interiors). */
const WOOD_FLOOR = 8;
/** Wall tile value, used when filling the outer ring or sealing doors. */
const WALL_TILE = 2;
/** Road tile value (walkable threshold), used for interior exit doors. */
const ROAD_TILE = 1;

/** Interior shell per building kind. Exhaustive, so a new kind cannot ship unsized. */
const INTERIOR_BY_KIND: Record<BuildingKind, { w: number; h: number; floorType: number }> = {
  tower: { w: TOWER_INTERIOR_W, h: TOWER_INTERIOR_H, floorType: CARPET_FLOOR },
  restaurant: { w: RESTAURANT_INTERIOR_W, h: RESTAURANT_INTERIOR_H, floorType: SAFE_ROOM_FLOOR },
  store: { w: STORE_INTERIOR_W, h: STORE_INTERIOR_H, floorType: WOOD_FLOOR },
  club: { w: CLUB_INTERIOR_W, h: CLUB_INTERIOR_H, floorType: CLUB_FLOOR },
  house: { w: HOUSE_INTERIOR_W, h: HOUSE_INTERIOR_H, floorType: WOOD_FLOOR },
};

/** The Big Top is registered as a `house`, so its interior is keyed by name instead. */
const BIGTOP_INTERIOR = {
  w: BIGTOP_INTERIOR_W,
  h: BIGTOP_INTERIOR_H,
  floorType: SAWDUST_FLOOR,
};

// ── Tower stair placement ─────────────────────────────────────────────────────
/** X offset from the east wall for the "stairs up" tile in tower floors. */
const TOWER_STAIR_UP_X_OFFSET = 5;
/** Y row for both stair tiles (near the north wall). */
const TOWER_STAIR_ROW = 2;
/** X column for the "stairs down" tile (near the west wall). */
const TOWER_STAIR_DOWN_COL = 3;
/** Maximum tower floor index — floors 0..3, so the cap is 3. */
const TOWER_TOP_FLOOR = 3;

// ── Decoration overlay index ──────────────────────────────────────────────────
/** A decoration tile drawn in the Y-sorted overlay pass. */
export interface DecorationTile {
  readonly tx: number;
  readonly ty: number;
  readonly isTree: boolean;
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
  SPRITE_BUILDING,
  MODERN_DECORATION,
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

/** Tile types that cannot be walked on. Everything not listed here is walkable. */
const NON_WALKABLE_TILE_TYPES: readonly number[] = [
  FloorTypeValue.wall,
  FloorTypeValue.water,
  VOID_TYPE,
  TREE,
  BUILDING_WALL,
  METAL_WALL,
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
  numBossRooms?: number;
  numSafeRooms?: number;
  numStairwellsOverride?: number;
  mapType?: 'dungeon' | 'overworld';
  hasArena?: boolean;
  bossTypes?: string[];
  hasSpiderLab?: boolean;
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
  mobSpawnPoints: Array<{ x: number; y: number; w: number; h: number }> = [];
  /** Tile coordinates inside hallways (away from rooms) — used for rat spawning. */
  hallwaySpawnPoints: Array<{ x: number; y: number }> = [];
  /** All safe rooms on this map (bounds + centre in tile coords). */
  safeRooms: Array<{
    bounds: { x: number; y: number; w: number; h: number };
    centre: { x: number; y: number };
    showBed?: boolean;
  }> = [];
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
  /** The plan the overworld town was generated from. Undefined on other maps. */
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
      numBossRooms = 1,
      numSafeRooms = 2,
      numStairwellsOverride,
      mapType,
      hasArena = false,
      bossTypes = [],
      hasSpiderLab = false,
      prebuiltStructure,
    } = opts;
    this.tileHeight = tileHeight;
    if (prebuiltStructure) {
      this.structure = prebuiltStructure;
    } else {
      this.structure = this.generate(
        mapSize,
        numBossRooms,
        numSafeRooms,
        numStairwellsOverride,
        mapType,
        hasArena,
        bossTypes,
        hasSpiderLab,
      );
    }
    this.rebuildBlockedMasks();
  }

  private generate(
    size: number,
    numBossRooms: number,
    numSafeRooms: number,
    numStairwellsOverride?: number,
    mapType?: 'dungeon' | 'overworld',
    hasArena = false,
    bossTypes: string[] = [],
    hasSpiderLab = false,
  ): TileContent[][] {
    if (mapType === 'overworld') {
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
      this.doomsdayEscapeTile = data.doomsdayEscapeTile;
      return data.grid;
    }

    const data = generateDungeon(
      size,
      numBossRooms,
      numSafeRooms,
      numStairwellsOverride,
      hasArena,
      bossTypes,
      hasSpiderLab,
    );
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
      // Also cover the south exit tile carved in the generator
      this.addArenaDoorTile(doorX - 1, doorY + 1);
      this.addArenaDoorTile(doorX, doorY + 1);
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
  generateInterior(buildingType: BuildingKind, towerFloor = 0, buildingName = ''): void {
    const isTower = buildingType === 'tower';
    const isRestaurant = buildingType === 'restaurant';
    const isStore = buildingType === 'store';
    const isClub = buildingType === 'club';
    const isHouse = buildingType === 'house';
    const isCarnival = buildingName === 'Big Top';
    const { w, h, floorType } = isCarnival ? BIGTOP_INTERIOR : INTERIOR_BY_KIND[buildingType];

    const grid: TileContent[][] = Array.from({ length: h }, (_, y) =>
      Array.from({ length: w }, (_, x) => ({
        tileId: `${x}#${y}`,
        type: WALL_TILE,
      })),
    );

    // Carve interior floor
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) grid[y][x].type = floorType;

    if (isStore && !isCarnival) {
      const storeCounterRow = 2;
      const storeBehindCounterRow = 3;
      const storeShelfStartRow = 4;
      const storeShelfEndRow = 6;
      const storeRugStartCol = 5;
      const storeRugEndCol = 8;
      // w - STORE_EAST_WALL_INSET = second column from east inner wall
      const STORE_EAST_WALL_INSET = 3;
      // h - STORE_ENTRANCE_ROW_INSET = rows before the south wall
      const STORE_ENTRANCE_ROW_INSET = 3;
      // Counter along the north interior (row 2, cols 2–17) — keeps shopkeeper separate
      for (let x = 2; x <= w - STORE_EAST_WALL_INSET; x++)
        grid[storeCounterRow][x].type = FloorTypeValue.wall;
      // Barrels behind counter on east side
      placeProp(grid[storeBehindCounterRow][w - STORE_EAST_WALL_INSET], BARREL);
      placeProp(grid[storeBehindCounterRow][w - STORE_EAST_WALL_INSET - 1], BARREL);
      placeProp(grid[storeShelfStartRow][w - STORE_EAST_WALL_INSET], BARREL);
      // Bookshelf (display shelf) on west wall
      grid[storeShelfStartRow][1].type = BOOKSHELF;
      grid[storeShelfStartRow + 1][1].type = BOOKSHELF;
      grid[storeShelfEndRow][1].type = BOOKSHELF;
      // Barrel cluster near entrance
      placeProp(grid[h - STORE_ENTRANCE_ROW_INSET][1], BARREL);
      placeProp(grid[h - STORE_ENTRANCE_ROW_INSET][w - 2], BARREL);
      // Small rug in front of counter
      for (let x = storeRugStartCol; x <= storeRugEndCol; x++)
        grid[storeShelfStartRow][x].type = RUG;
      for (let x = storeRugStartCol; x <= storeRugEndCol; x++)
        grid[storeShelfStartRow + 1][x].type = RUG;
    }

    if (isRestaurant) {
      // The Barracks — the overworld safe room, laid out as a crawler guild
      // bunkhouse. SafeRoomSystem derives Mordecai's spot and the sleeping bed
      // from the room's centre, so the room's centre row is deliberately left
      // clear of furniture — the bunk rows below skip it.
      const BARRACKS_HEARTH_COL_1 = 10;
      const BARRACKS_HEARTH_COL_2 = 11;
      const BARRACKS_FIRST_BUNK_ROW = 3;
      const BARRACKS_BUNK_ROW_PITCH = 3;
      const BARRACKS_BUNK_STACKS_PER_WALL = 3;
      const BARRACKS_BUNK_DEPTH = 2;
      const BARRACKS_MESS_ROW = 6;
      const BARRACKS_MESS_START_COL = 7;
      const BARRACKS_MESS_END_COL = 11;
      // Benches sit every other column, offset by one between the two sides so
      // diners face the gaps opposite them rather than each other's shoulders.
      const BARRACKS_BENCH_PITCH = 2;
      const BARRACKS_SUPPLY_TOP_ROW = 12;
      const BARRACKS_SUPPLY_BOTTOM_ROW = 13;
      const BARRACKS_BRAZIER_WEST_COL = 8;
      const BARRACKS_BRAZIER_EAST_COL = 13;
      const BARRACKS_BRAZIER_ROW = 13;
      const BARRACKS_RUG_START_COL = 9;
      const BARRACKS_RUG_END_COL = 12;
      const BARRACKS_EAST_WALL_COL = w - 2;
      const BARRACKS_SECOND_EAST_COL = w - 2 - 1;

      grid[1][BARRACKS_HEARTH_COL_1].type = FIREPLACE;
      grid[1][BARRACKS_HEARTH_COL_2].type = FIREPLACE;

      // Bunk pairs stacked along both side walls, two tiles deep each.
      for (let stack = 0; stack < BARRACKS_BUNK_STACKS_PER_WALL; stack++) {
        const bunkTopRow = BARRACKS_FIRST_BUNK_ROW + stack * BARRACKS_BUNK_ROW_PITCH;
        for (let d = 0; d < BARRACKS_BUNK_DEPTH; d++) {
          grid[bunkTopRow + d][1].type = BED;
          grid[bunkTopRow + d][2].type = BED;
          grid[bunkTopRow + d][BARRACKS_SECOND_EAST_COL].type = BED;
          grid[bunkTopRow + d][BARRACKS_EAST_WALL_COL].type = BED;
        }
      }

      // Long mess table with benches on both sides, kept west of centre so the
      // corridor to the hearth stays walkable.
      for (let x = BARRACKS_MESS_START_COL; x <= BARRACKS_MESS_END_COL; x++)
        grid[BARRACKS_MESS_ROW][x].type = TABLE;
      for (
        let x = BARRACKS_MESS_START_COL + 1;
        x <= BARRACKS_MESS_END_COL;
        x += BARRACKS_BENCH_PITCH
      )
        grid[BARRACKS_MESS_ROW - 1][x].type = CHAIR;
      for (let x = BARRACKS_MESS_START_COL; x <= BARRACKS_MESS_END_COL; x += BARRACKS_BENCH_PITCH)
        grid[BARRACKS_MESS_ROW + 1][x].type = CHAIR;

      // Supply stacks in the two southern corners.
      for (let ry = BARRACKS_SUPPLY_TOP_ROW; ry <= BARRACKS_SUPPLY_BOTTOM_ROW; ry++) {
        placeProp(grid[ry][1], CRATE);
        placeProp(grid[ry][BARRACKS_EAST_WALL_COL], BARREL);
      }
      placeProp(grid[BARRACKS_SUPPLY_TOP_ROW][2], CRATE);
      placeProp(grid[BARRACKS_SUPPLY_TOP_ROW][BARRACKS_SECOND_EAST_COL], BARREL);

      // Braziers flanking the entry rug.
      grid[BARRACKS_BRAZIER_ROW][BARRACKS_BRAZIER_WEST_COL].type = BRAZIER;
      grid[BARRACKS_BRAZIER_ROW][BARRACKS_BRAZIER_EAST_COL].type = BRAZIER;
      for (let ry = BARRACKS_SUPPLY_TOP_ROW; ry <= BARRACKS_SUPPLY_BOTTOM_ROW; ry++)
        for (let rx = BARRACKS_RUG_START_COL; rx <= BARRACKS_RUG_END_COL; rx++)
          grid[ry][rx].type = RUG;
    }

    if (isClub) {
      // Central dance floor
      for (let y = CLUB_DANCE_FLOOR.y0; y <= CLUB_DANCE_FLOOR.y1; y++)
        for (let x = CLUB_DANCE_FLOOR.x0; x <= CLUB_DANCE_FLOOR.x1; x++)
          grid[y][x].type = DANCE_FLOOR;
      // Alcove divider walls (never seal a region — the dance-floor rows stay open)
      for (const wall of CLUB_DIVIDER_WALLS)
        for (let y = wall.y0; y <= wall.y1; y++) grid[y][wall.x].type = WALL_TILE;
      // Furniture collision — solid props that still render as floor (the club's
      // visuals are drawn by drawClubDecor, not tile sprites), so block them here.
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
      "Signet's Ink",
    ] as const;
    const isNamedBuilding = NAMED_BUILDINGS.some((n) => n === buildingName);

    if (isHouse && isNamedBuilding) {
      switch (buildingName) {
        case "Shepherd's Cabin": {
          // Rustic shepherd's dwelling — hearth, simple cot, supply barrels
          const cabinHearth1 = 4;
          const cabinHearth2 = 5;
          const cabinBedNorthRow = 2;
          const cabinBedSouthRow = 3;
          const cabinBedWestCol = 14;
          const cabinBedEastCol = 15;
          const cabinBarrelEndRow = 6;
          const cabinTableRow = 7;
          const cabinTableCol1 = 8;
          const cabinTableCol2 = 9;
          const cabinChairRow = 8;
          const cabinSouthRow = 11;
          const cabinBarrelSideRow = 10;
          grid[1][cabinHearth1].type = FIREPLACE;
          grid[1][cabinHearth2].type = FIREPLACE;
          grid[cabinBedNorthRow][cabinBedWestCol].type = BED;
          grid[cabinBedNorthRow][cabinBedEastCol].type = BED;
          grid[cabinBedSouthRow][cabinBedWestCol].type = BED;
          grid[cabinBedSouthRow][cabinBedEastCol].type = BED;
          placeProp(grid[cabinHearth1][1], BARREL);
          placeProp(grid[cabinHearth2][1], BARREL);
          placeProp(grid[cabinBarrelEndRow][1], BARREL);
          grid[cabinTableRow][cabinTableCol1].type = TABLE;
          grid[cabinTableRow][cabinTableCol2].type = TABLE;
          grid[cabinChairRow][cabinTableCol1].type = CHAIR;
          placeProp(grid[cabinSouthRow][1], CRATE);
          placeProp(grid[cabinSouthRow][2], CRATE);
          placeProp(grid[cabinBarrelSideRow][cabinBedEastCol], BARREL_SIDE);
          break;
        }

        case 'Blackwood Lodge': {
          // Military barracks — rows of bunks, briefing table, crate storage
          const barracksBunkRow1 = 2;
          const barracksBunkRow2 = 3;
          const barracksBunkRow3 = 5;
          const barracksBunkRow4 = 6;
          const barracksEastBedCol1 = 14;
          const barracksEastBedCol2 = 15;
          const barracksBriefingRow = 7;
          const barracksBriefingTableCol1 = 7;
          const barracksBriefingTableCol2 = 8;
          const barracksBriefingTableCol3 = 9;
          const barracksChairRow = 8;
          const barracksCrateRow1 = 10;
          const barracksCrateRow2 = 11;
          grid[barracksBunkRow1][1].type = BED;
          grid[barracksBunkRow1][2].type = BED;
          grid[barracksBunkRow2][1].type = BED;
          grid[barracksBunkRow2][2].type = BED;
          grid[barracksBunkRow3][1].type = BED;
          grid[barracksBunkRow3][2].type = BED;
          grid[barracksBunkRow4][1].type = BED;
          grid[barracksBunkRow4][2].type = BED;
          grid[barracksBunkRow1][barracksEastBedCol1].type = BED;
          grid[barracksBunkRow1][barracksEastBedCol2].type = BED;
          grid[barracksBunkRow2][barracksEastBedCol1].type = BED;
          grid[barracksBunkRow2][barracksEastBedCol2].type = BED;
          grid[barracksBunkRow3][barracksEastBedCol1].type = BED;
          grid[barracksBunkRow3][barracksEastBedCol2].type = BED;
          grid[barracksBunkRow4][barracksEastBedCol1].type = BED;
          grid[barracksBunkRow4][barracksEastBedCol2].type = BED;
          grid[barracksBriefingRow][barracksBriefingTableCol1].type = TABLE;
          grid[barracksBriefingRow][barracksBriefingTableCol2].type = TABLE;
          grid[barracksBriefingRow][barracksBriefingTableCol3].type = TABLE;
          grid[barracksChairRow][barracksBriefingTableCol1].type = CHAIR;
          grid[barracksChairRow][barracksBriefingTableCol3].type = CHAIR;
          placeProp(grid[barracksCrateRow1][1], CRATE);
          placeProp(grid[barracksCrateRow2][1], CRATE);
          placeProp(grid[barracksCrateRow1][barracksEastBedCol2], CRATE);
          placeProp(grid[barracksCrateRow2][barracksEastBedCol2], CRATE);
          placeProp(grid[barracksCrateRow2][barracksBriefingTableCol2], BARREL);
          break;
        }

        case "Old Hilda's Cottage": {
          // Witch's lair — cauldron braziers, dense spell-book shelves, work table
          const hildaBrazierCol1 = 8;
          const hildaBrazierCol2 = 9;
          const hildaWestShelfStartRow = 2;
          const hildaWestShelfEndRow = 7;
          const hildaEastShelfEndRow = 5;
          const hildaEastShelfCol = HOUSE_INTERIOR_W - 2;
          const hildaTableRow = 5;
          const hildaTableCol1 = 7;
          const hildaTableCol2 = 8;
          const hildaChairRow = 6;
          const hildaBarrelRow1 = 8;
          const hildaBarrelRow2 = 9;
          const hildaCrateRow = 11;
          const hildaCrateCol1 = 13;
          const hildaCrateCol2 = 14;
          grid[1][hildaBrazierCol1].type = BRAZIER;
          grid[1][hildaBrazierCol2].type = BRAZIER;
          for (let ry = hildaWestShelfStartRow; ry <= hildaWestShelfEndRow; ry++)
            grid[ry][1].type = BOOKSHELF;
          for (let ry = hildaWestShelfStartRow; ry <= hildaEastShelfEndRow; ry++)
            grid[ry][hildaEastShelfCol].type = BOOKSHELF;
          grid[hildaTableRow][hildaTableCol1].type = TABLE;
          grid[hildaTableRow][hildaTableCol2].type = TABLE;
          grid[hildaChairRow][hildaTableCol1].type = CHAIR;
          placeProp(grid[hildaBarrelRow1][1], BARREL);
          placeProp(grid[hildaBarrelRow2][1], BARREL);
          placeProp(grid[hildaBarrelRow2][hildaTableCol2], BARREL_SIDE);
          placeProp(grid[hildaBarrelRow2][hildaBrazierCol2], BARREL_SIDE);
          placeProp(grid[hildaCrateRow][hildaCrateCol1], CRATE);
          placeProp(grid[hildaCrateRow][hildaCrateCol2], CRATE);
          break;
        }

        case "Cartwright's Workshop": {
          // Builder's shop — dual north workbenches, raw material crates, scattered supplies
          const cartwrightBenchRow = 2;
          const cartwrightBench1StartCol = 3;
          const cartwrightBench1EndCol = 7;
          const cartwrightBench2StartCol = 10;
          const cartwrightBench2EndCol = 14;
          const cartwrightCrateStartRow = 4;
          const cartwrightCrateEndRow = 7;
          const cartwrightEastWallCol = HOUSE_INTERIOR_W - 2;
          const cartwrightBarrelRow = 8;
          const cartwrightBarrelCol1 = 4;
          const cartwrightBarrelCol2 = 5;
          const cartwrightBarrelCol3 = 11;
          const cartwrightBarrelCol4 = 12;
          const cartwrightTableRow = 5;
          const cartwrightTableCol1 = 8;
          const cartwrightTableCol2 = 9;
          const cartwrightSouthRow = 11;
          const cartwrightSouthCrateCol1 = 14;
          const cartwrightSouthCrateCol2 = 15;
          for (let rx = cartwrightBench1StartCol; rx <= cartwrightBench1EndCol; rx++)
            grid[cartwrightBenchRow][rx].type = TABLE;
          for (let rx = cartwrightBench2StartCol; rx <= cartwrightBench2EndCol; rx++)
            grid[cartwrightBenchRow][rx].type = TABLE;
          for (let ry = cartwrightCrateStartRow; ry <= cartwrightCrateEndRow; ry++)
            placeProp(grid[ry][1], CRATE);
          for (let ry = cartwrightCrateStartRow; ry <= cartwrightCrateEndRow - 1; ry++)
            placeProp(grid[ry][cartwrightEastWallCol], BARREL);
          placeProp(grid[cartwrightBarrelRow][cartwrightBarrelCol1], BARREL_SIDE);
          placeProp(grid[cartwrightBarrelRow][cartwrightBarrelCol2], BARREL_SIDE);
          placeProp(grid[cartwrightBarrelRow][cartwrightBarrelCol3], BARREL_SIDE);
          placeProp(grid[cartwrightBarrelRow][cartwrightBarrelCol4], BARREL_SIDE);
          grid[cartwrightTableRow][cartwrightTableCol1].type = TABLE;
          grid[cartwrightTableRow][cartwrightTableCol2].type = TABLE;
          grid[cartwrightTableRow + 1][cartwrightTableCol1].type = CHAIR;
          placeProp(grid[cartwrightSouthRow][1], BARREL);
          placeProp(grid[cartwrightSouthRow][2], BARREL);
          placeProp(grid[cartwrightSouthRow][cartwrightSouthCrateCol1], CRATE);
          placeProp(grid[cartwrightSouthRow][cartwrightSouthCrateCol2], CRATE);
          break;
        }

        case 'Herb & Remedy': {
          // Apothecary — counter, dense ingredient shelves, display table
          const herbCounterRow = 2;
          const herbCounterStartCol = 5;
          const herbCounterEndCol = 13;
          const herbShelfStartRow = 3;
          const herbWestShelfEndRow = 7;
          const herbEastShelfEndRow = 6;
          const herbEastShelfCol = HOUSE_INTERIOR_W - 2;
          const herbBarrelRow1 = 3;
          const herbBarrelRow2 = 4;
          const herbBarrelCol1 = 14;
          const herbBarrelCol2 = 15;
          const herbRugStartCol = 4;
          const herbRugEndCol = 12;
          const herbTableRow = 8;
          const herbTableCol1 = 7;
          const herbTableCol2 = 8;
          const herbBarrelSideCol = 3;
          for (let rx = herbCounterStartCol; rx <= herbCounterEndCol; rx++)
            grid[herbCounterRow][rx].type = FloorTypeValue.wall;
          for (let ry = herbShelfStartRow; ry <= herbWestShelfEndRow; ry++)
            grid[ry][1].type = BOOKSHELF;
          for (let ry = herbShelfStartRow; ry <= herbEastShelfEndRow; ry++)
            grid[ry][herbEastShelfCol].type = BOOKSHELF;
          placeProp(grid[herbBarrelRow1][herbBarrelCol1], BARREL);
          placeProp(grid[herbBarrelRow1][herbBarrelCol2], BARREL);
          placeProp(grid[herbBarrelRow2][herbBarrelCol1], BARREL);
          for (let rx = herbRugStartCol; rx <= herbRugEndCol; rx++) {
            grid[herbBarrelRow2][rx].type = RUG;
            grid[herbBarrelRow2 + 1][rx].type = RUG;
          }
          grid[herbTableRow][herbTableCol1].type = TABLE;
          grid[herbTableRow][herbTableCol2].type = TABLE;
          placeProp(grid[herbTableRow][herbBarrelSideCol], BARREL_SIDE);
          break;
        }

        case 'The Sleeping Cat Inn': {
          // Cozy inn — west & east guest rooms, common dining area, innkeeper desk
          const innFireplaceCol1 = 8;
          const innFireplaceCol2 = 9;
          const innBunkRow1 = 2;
          const innBunkRow2 = 3;
          const innBunkRow3 = 5;
          const innBunkRow4 = 6;
          const innEastBedCol1 = 14;
          const innEastBedCol2 = 15;
          const innRugRow = 4;
          const innRugStartCol = 4;
          const innRugEndCol = 13;
          const innDiningRow = 7;
          const innDiningChairRow = 8;
          const innWestTableCol1 = 4;
          const innWestTableCol2 = 5;
          const innEastTableCol1 = 11;
          const innEastTableCol2 = 12;
          const innCenterTableRow = 6;
          const innCenterTableCol1 = 7;
          const innCenterTableCol2 = 8;
          const innCenterTableCol3 = 9;
          const innSouthRow = 11;
          // Reception bar in the south-east: gives the innkeeper a post to work
          // (the occupant system stations `tend_counter` roles at interior walls)
          // and gives the common room somewhere to be served a drink.
          const innBarRow = 10;
          const innBarStartCol = 10;
          const innBarEndCol = HOUSE_INTERIOR_W - 2;
          const innBarStoolRow = 11;
          const innBarStoolPitch = 2;
          grid[1][innFireplaceCol1].type = FIREPLACE;
          grid[1][innFireplaceCol2].type = FIREPLACE;
          grid[innBunkRow1][1].type = BED;
          grid[innBunkRow1][2].type = BED;
          grid[innBunkRow2][1].type = BED;
          grid[innBunkRow2][2].type = BED;
          grid[innBunkRow3][1].type = BED;
          grid[innBunkRow3][2].type = BED;
          grid[innBunkRow4][1].type = BED;
          grid[innBunkRow4][2].type = BED;
          grid[innBunkRow1][innEastBedCol1].type = BED;
          grid[innBunkRow1][innEastBedCol2].type = BED;
          grid[innBunkRow2][innEastBedCol1].type = BED;
          grid[innBunkRow2][innEastBedCol2].type = BED;
          grid[innBunkRow3][innEastBedCol1].type = BED;
          grid[innBunkRow3][innEastBedCol2].type = BED;
          grid[innBunkRow4][innEastBedCol1].type = BED;
          grid[innBunkRow4][innEastBedCol2].type = BED;
          for (let rx = innRugStartCol; rx <= innRugEndCol; rx++) grid[innRugRow][rx].type = RUG;
          grid[innDiningRow][innWestTableCol1].type = TABLE;
          grid[innDiningRow][innWestTableCol2].type = TABLE;
          grid[innDiningChairRow][innWestTableCol1].type = CHAIR;
          grid[innDiningChairRow][innWestTableCol2].type = CHAIR;
          grid[innDiningRow][innEastTableCol1].type = TABLE;
          grid[innDiningRow][innEastTableCol2].type = TABLE;
          grid[innDiningChairRow][innEastTableCol1].type = CHAIR;
          grid[innDiningChairRow][innEastTableCol2].type = CHAIR;
          grid[innCenterTableRow][innCenterTableCol1].type = TABLE;
          grid[innCenterTableRow][innCenterTableCol2].type = TABLE;
          grid[innCenterTableRow][innCenterTableCol3].type = TABLE;
          grid[innDiningRow][innCenterTableCol1].type = CHAIR;
          placeProp(grid[innSouthRow][1], BARREL);
          placeProp(grid[innSouthRow][2], BARREL);
          for (let rx = innBarStartCol; rx <= innBarEndCol; rx++)
            grid[innBarRow][rx].type = FloorTypeValue.wall;
          for (let rx = innBarStartCol + 1; rx <= innBarEndCol; rx += innBarStoolPitch)
            grid[innBarStoolRow][rx].type = CHAIR;
          break;
        }

        case 'The Rusty Anvil': {
          // Blacksmith — twin forge braziers, anvil tables, raw material crates
          const anvilWestForgeCol1 = 3;
          const anvilWestForgeCol2 = 4;
          const anvilEastForgeCol1 = 13;
          const anvilEastForgeCol2 = 14;
          const anvilTableRow = 3;
          const anvilCrateStartRow = 5;
          const anvilCrateEndRow = 9;
          const anvilEastWallCol = HOUSE_INTERIOR_W - 2;
          const anvilBarrelSideRow = 5;
          const anvilBarrelSideCol1 = 7;
          const anvilBarrelSideCol2 = 8;
          const anvilBarrelSideCol3 = 9;
          const anvilBarrelSideCol4 = 10;
          const anvilChairRow = 4;
          const anvilSouthRow = 11;
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
          placeProp(grid[anvilCrateStartRow][anvilEastWallCol], BARREL);
          placeProp(grid[anvilCrateStartRow + 1][anvilEastWallCol], BARREL);
          placeProp(grid[anvilCrateStartRow + 2][anvilEastWallCol], BARREL);
          placeProp(grid[anvilBarrelSideRow][anvilBarrelSideCol1], BARREL_SIDE);
          placeProp(grid[anvilBarrelSideRow][anvilBarrelSideCol2], BARREL_SIDE);
          placeProp(grid[anvilBarrelSideRow][anvilBarrelSideCol3], BARREL_SIDE);
          placeProp(grid[anvilBarrelSideRow][anvilBarrelSideCol4], BARREL_SIDE);
          grid[anvilChairRow][anvilBarrelSideCol1].type = CHAIR;
          placeProp(grid[anvilSouthRow][1], CRATE);
          placeProp(grid[anvilSouthRow][2], CRATE);
          placeProp(grid[anvilSouthRow][anvilEastForgeCol2], BARREL);
          placeProp(grid[anvilSouthRow][anvilEastWallCol - 1], BARREL);
          break;
        }

        case "Miller's Farm": {
          // Farmhouse — hearth, single bed, harvest crates along east wall
          const farmHearth1 = 2;
          const farmHearth2 = 3;
          const farmBedNorthRow = 2;
          const farmBedSouthRow = 3;
          const farmBedWestCol = 14;
          const farmBedEastCol = 15;
          const farmEastWallCol = HOUSE_INTERIOR_W - 2;
          const farmCrateStartRow = 4;
          const farmCrateEndRow = 7;
          const farmTableRow = 8;
          const farmTableCol1 = 7;
          const farmTableCol2 = 8;
          const farmBarrelSideRow1 = 10;
          const farmBarrelSideRow2 = 11;
          grid[1][farmHearth1].type = FIREPLACE;
          grid[1][farmHearth2].type = FIREPLACE;
          grid[farmBedNorthRow][farmBedWestCol].type = BED;
          grid[farmBedNorthRow][farmBedEastCol].type = BED;
          grid[farmBedSouthRow][farmBedWestCol].type = BED;
          grid[farmBedSouthRow][farmBedEastCol].type = BED;
          placeProp(grid[farmCrateStartRow][1], BARREL);
          placeProp(grid[farmCrateStartRow + 1][1], BARREL);
          placeProp(grid[farmCrateStartRow + 2][1], BARREL);
          placeProp(grid[farmCrateStartRow][farmEastWallCol], CRATE);
          placeProp(grid[farmCrateStartRow + 1][farmEastWallCol], CRATE);
          placeProp(grid[farmCrateStartRow + 2][farmEastWallCol], CRATE);
          placeProp(grid[farmCrateEndRow][farmEastWallCol], CRATE);
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
          // sides, a serving bar in the north-east corner, symmetric side tables.
          const FLAGON_BAR_ROW = 2;
          const FLAGON_BAR_START_COL = 11;
          const FLAGON_BAR_RETURN_ROW = 3;
          const FLAGON_STOOL_ROW = 3;
          const FLAGON_STOOL_PITCH = 2;
          const FLAGON_HEARTH_COL_1 = 3;
          const FLAGON_HEARTH_COL_2 = 4;
          const FLAGON_FEAST_ROW = 7;
          const FLAGON_FEAST_START_COL = 5;
          const FLAGON_FEAST_END_COL = 12;
          const FLAGON_BENCH_PITCH = 2;
          const FLAGON_SIDE_TABLES = [
            { col: 2, row: 10 },
            { col: 14, row: 10 },
          ];
          const FLAGON_RUG_ROW = 5;
          const FLAGON_RUG_START_COL = 3;
          const FLAGON_RUG_END_COL = 14;
          const FLAGON_BARREL_TILES = [
            { x: 1, y: 4 },
            { x: 1, y: 5 },
            { x: 16, y: 6 },
          ];
          const FLAGON_EAST_WALL_COL = HOUSE_INTERIOR_W - 2;
          for (let rx = FLAGON_BAR_START_COL; rx <= FLAGON_EAST_WALL_COL; rx++)
            grid[FLAGON_BAR_ROW][rx].type = FloorTypeValue.wall;
          grid[FLAGON_BAR_RETURN_ROW][FLAGON_BAR_START_COL].type = FloorTypeValue.wall;
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
          // A hushed hall: altar under the north wall flanked by braziers, pew
          // rows facing it, a rug aisle down the middle, scripture on both walls.
          const TEMPLE_ALTAR_ROW = 1;
          const TEMPLE_ALTAR_START_COL = 7;
          const TEMPLE_ALTAR_END_COL = 10;
          const TEMPLE_BRAZIER_WEST_COL = 5;
          const TEMPLE_BRAZIER_EAST_COL = 12;
          const TEMPLE_FIRST_PEW_ROW = 4;
          const TEMPLE_PEW_ROW_PITCH = 2;
          const TEMPLE_PEW_ROWS = 3;
          const TEMPLE_WEST_PEW_START_COL = 3;
          const TEMPLE_WEST_PEW_END_COL = 7;
          const TEMPLE_EAST_PEW_START_COL = 10;
          const TEMPLE_EAST_PEW_END_COL = 14;
          const TEMPLE_AISLE_START_COL = 8;
          const TEMPLE_AISLE_END_COL = 9;
          const TEMPLE_AISLE_START_ROW = 3;
          const TEMPLE_AISLE_END_ROW = 10;
          const TEMPLE_SCRIPTURE_START_ROW = 2;
          const TEMPLE_SCRIPTURE_END_ROW = 4;
          const TEMPLE_EAST_WALL_COL = HOUSE_INTERIOR_W - 2;
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
            grid[ry][1].type = BOOKSHELF;
            grid[ry][TEMPLE_EAST_WALL_COL].type = BOOKSHELF;
          }
          break;
        }

        case "Signet's Ink": {
          // One work station under a wall of flash art, needle fire beside it,
          // supplies stacked in the back and a rug where the customer waits.
          const INK_STATION_ROW = 4;
          const INK_STATION_COL_1 = 7;
          const INK_STATION_COL_2 = 8;
          const INK_CUSTOMER_CHAIR_ROW = 5;
          const INK_NEEDLE_FIRE_COL = 11;
          const INK_FLASH_ART_START_ROW = 2;
          const INK_FLASH_ART_END_ROW = 6;
          const INK_RUG_START_ROW = 7;
          const INK_RUG_END_ROW = 8;
          const INK_RUG_START_COL = 6;
          const INK_RUG_END_COL = 11;
          const INK_SUPPLY_ROW = 10;
          const INK_BARREL_ROW_1 = 2;
          const INK_BARREL_ROW_2 = 3;
          const INK_EAST_WALL_COL = HOUSE_INTERIOR_W - 2;
          grid[INK_STATION_ROW][INK_STATION_COL_1].type = TABLE;
          grid[INK_STATION_ROW][INK_STATION_COL_2].type = TABLE;
          grid[INK_CUSTOMER_CHAIR_ROW][INK_STATION_COL_1].type = CHAIR;
          grid[INK_CUSTOMER_CHAIR_ROW][INK_STATION_COL_2].type = CHAIR;
          grid[INK_STATION_ROW][INK_NEEDLE_FIRE_COL].type = BRAZIER;
          for (let ry = INK_FLASH_ART_START_ROW; ry <= INK_FLASH_ART_END_ROW; ry++)
            grid[ry][1].type = BOOKSHELF;
          for (let ry = INK_RUG_START_ROW; ry <= INK_RUG_END_ROW; ry++)
            for (let rx = INK_RUG_START_COL; rx <= INK_RUG_END_COL; rx++) grid[ry][rx].type = RUG;
          placeProp(grid[INK_SUPPLY_ROW][INK_EAST_WALL_COL], CRATE);
          placeProp(grid[INK_SUPPLY_ROW][INK_EAST_WALL_COL - 1], CRATE);
          placeProp(grid[INK_BARREL_ROW_1][INK_EAST_WALL_COL], BARREL);
          placeProp(grid[INK_BARREL_ROW_2][INK_EAST_WALL_COL], BARREL);
          break;
        }

        case 'The Sunken Stump Pub': {
          // A cramped, dark dive: L-shaped bar penning in a barkeep alley,
          // stools along its front, tight table clusters and barrels everywhere.
          const STUMP_BAR_ROW = 3;
          const STUMP_BAR_END_COL = 9;
          const STUMP_BAR_RETURN_ROW = 2;
          const STUMP_STOOL_ROW = 4;
          const STUMP_FIRST_STOOL_COL = 2;
          const STUMP_STOOL_PITCH = 2;
          const STUMP_HEARTH_COL_1 = 14;
          const STUMP_HEARTH_COL_2 = 15;
          const STUMP_TABLE_CLUSTERS = [
            { col: 2, row: 7 },
            { col: 6, row: 7 },
            { col: 11, row: 6 },
            { col: 2, row: 10 },
            { col: 12, row: 10 },
          ];
          const STUMP_RUG_ROW = 9;
          const STUMP_RUG_START_COL = 5;
          const STUMP_RUG_END_COL = 10;
          const STUMP_BARREL_TILES = [
            { x: 16, y: 4 },
            { x: 16, y: 5 },
            { x: 15, y: 4 },
          ];
          const STUMP_BARREL_SIDE_TILES = [
            { x: 1, y: 11 },
            { x: 16, y: 11 },
          ];
          // The bar's long run plus its return arm; the gap east of the return is
          // the only way in or out of the alley, so the barkeep stays put.
          for (let rx = 1; rx <= STUMP_BAR_END_COL; rx++)
            grid[STUMP_BAR_ROW][rx].type = FloorTypeValue.wall;
          grid[STUMP_BAR_RETURN_ROW][STUMP_BAR_END_COL].type = FloorTypeValue.wall;
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
      // Bookshelf on west wall
      grid[genericShelfStartRow][1].type = BOOKSHELF;
      grid[genericShelfStartRow + 1][1].type = BOOKSHELF;
      grid[genericShelfEndRow][1].type = BOOKSHELF;
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
        for (let x = 1 + BIGTOP_BLEACHER_DEPTH; x < w - 1 - BIGTOP_BLEACHER_DEPTH; x++) {
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
    grid[h - 1][doorX].type = ROAD_TILE;
    grid[h - 1][doorX + 1].type = ROAD_TILE;

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
      grid[h - 1][doorX].type = WALL_TILE;
      grid[h - 1][doorX + 1].type = WALL_TILE;
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
      // Stairs up: upper-right area (2 tiles wide)
      const upX = w - TOWER_STAIR_UP_X_OFFSET;
      const upY = TOWER_STAIR_ROW;
      // Stairs down: upper-left area (2 tiles wide)
      const dnX = TOWER_STAIR_DOWN_COL;
      const dnY = TOWER_STAIR_ROW;

      const hasUp = towerFloor < TOWER_TOP_FLOOR;
      const hasDown = towerFloor > 0;

      if (hasUp) {
        grid[upY][upX].type = STAIRS_UP;
        this._interiorStairUpTiles = [{ x: upX, y: upY }];
      }
      if (hasDown) {
        grid[dnY][dnX].type = STAIRS_DOWN;
        this._interiorStairDownTiles = [{ x: dnX, y: dnY }];
      }

      // ── Tower floor furniture (20×16, carpet) ──
      // Avoid stair tiles at (upX=15,upY=2) and (dnX=3,dnY=2)
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
        // Bookshelves along west wall
        for (let ry = towerShelfStartRow; ry <= groundFloorShelfEndRow; ry++)
          grid[ry][1].type = BOOKSHELF;
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
        // Bookshelves along west wall
        for (let ry = towerShelfStartRow; ry <= libraryShelfEndRow; ry++)
          grid[ry][1].type = BOOKSHELF;
        // Bookshelves along east wall
        for (let ry = towerShelfStartRow; ry <= libraryShelfEndRow; ry++)
          grid[ry][w - 2].type = BOOKSHELF;
        // Center bookshelf island
        for (let rx = libraryIsland1StartCol; rx <= libraryIsland1EndCol; rx++)
          grid[libraryIslandRow][rx].type = BOOKSHELF;
        for (let rx = libraryIsland2StartCol; rx <= libraryIsland2EndCol; rx++)
          grid[libraryIslandRow][rx].type = BOOKSHELF;
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
        // Bookshelf between beds
        grid[quartersShelfRow1][1].type = BOOKSHELF;
        grid[quartersShelfRow2][1].type = BOOKSHELF;
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
        // Bookshelves along both walls
        for (let ry = towerShelfStartRow; ry <= studyShelfEndRow; ry++)
          grid[ry][1].type = BOOKSHELF;
        for (let ry = towerShelfStartRow; ry <= studyShelfEndRow; ry++)
          grid[ry][w - 2].type = BOOKSHELF;
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

    if (isRestaurant) {
      const interior = { x: 1, y: 1, w: w - 2, h: h - 2 };
      this.safeRooms = [
        {
          bounds: interior,
          centre: { x: Math.floor(w / 2), y: Math.floor(h / 2) },
        },
      ];
    } else {
      this.safeRooms = [];
    }
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
    return this.isWalkableTileType(this.structure[tileY][tileX]);
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
    return this.isWalkableTileType(this.structure[tileY][tileX]);
  }

  private isWalkableTileType(tile: TileContent): boolean {
    if (tile.type === MODERN_DECORATION) {
      return WALKABLE_MODERN_DECORATION_VARIANTS.has(tile.decorationVariant ?? 0);
    }
    return WALKABLE_BY_TILE_TYPE[tile.type] === 1;
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
      return { tx, ty, isTree: false, sortYAnchorPx, extents };
    }

    return {
      tx,
      ty,
      isTree: type === TREE,
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
