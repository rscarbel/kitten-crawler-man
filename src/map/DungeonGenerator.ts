import {
  FloorTypeValue,
  type TileContent,
  VOID_TYPE,
  SAFE_ROOM_FLOOR,
  SAFE_ROOM_THRESHOLD,
  HORDER_BOSS_ROOM_FLOOR,
  JUICER_BOSS_ROOM_FLOOR,
  KRAKAREN_BOSS_ROOM_FLOOR,
  METAL_WALL,
  ARENA_FLOOR,
  FLOOR_GRATE,
  TORCH,
  BARREL,
  BARREL_SIDE,
  CRATE,
  BRAZIER,
  BONES,
  BOOKSHELF,
  SPIDER_LAB_FLOOR,
  placeProp,
} from './tileTypes';
import { randomFromArray, randomInt, clamp } from '../utils';
import { mordecaiAndBedTiles } from './safeRoomFixtures';
import type { ProgressionDef } from '../levels/types';
import {
  ARENA_RADIUS,
  ARENA_REACH,
  ARENA_RING_WIDTH,
  ARENA_WALL_THICKNESS,
  arenaDoorTileAt,
  arenaReserveRect,
} from './arenaGeometry';
import {
  SegmentMap,
  SEGMENT_FREE,
  SEGMENT_ARENA,
  gauntletSegment,
  planGauntlet,
  planCorridorBetween,
  rectCentre,
  rectCentredOn,
  MAX_GAUNTLET_ATTEMPTS,
  MAX_MAP_ATTEMPTS,
  START_ROOM_W_MIN,
  START_ROOM_W_MAX,
  START_ROOM_H_MIN,
  START_ROOM_H_MAX,
  type GauntletPlan,
  type PlannedCorridor,
} from './gauntletLayout';
import {
  validateProgression,
  distanceToRect,
  SCATTER_SAFE_ROOM_SEPARATION,
  STAIRWELL_MIN_SEPARATION,
  STAIRWELL_MIN_DIST_FROM_GAUNTLET_EXIT,
  type InvariantFailure,
} from './progressionValidation';

/**
 * What a generated room is *for*. Carried on the room itself rather than
 * inferred from its index, so every downstream stage (corridor width, stairwell
 * eligibility, decoration, mob spawns) asks the room what it is.
 */
type RoomRole = 'start' | 'safe' | 'boss' | 'quest' | 'spider_lab' | 'chain' | 'regular';

type Room = {
  x: number;
  y: number;
  w: number;
  h: number;
  floor: number;
  role: RoomRole;
  /** Set on a gateway safe room: the boss its only onward exit leads to. */
  guardsBossType?: string;
};
type Point = { x: number; y: number };
type Rect = { x: number; y: number; w: number; h: number };
type Zone = 'entrance' | 'mid' | 'deep';
// narrow = 1-tile wide (default); standard = 3-tile wide (main arteries); nook = narrow + alcove junction
type HallwayKind = 'narrow' | 'standard' | 'nook';

export interface ArenaExterior {
  centre: Point;
  radius: number;
  doorTile: Point;
  /** Tile position for the stairwell placed at the arena centre (initially locked). */
  stairwellTile: Point;
}

export interface QuestRoomData {
  bounds: Rect;
  centre: Point;
  grateTiles: Point[];
  entranceTile: Point;
  npcTile: Point;
  woodPileTile: Point;
}

export interface TreasureRoomData {
  bounds: { x: number; y: number; w: number; h: number };
  centre: { x: number; y: number };
}

export interface SpiderLabRoomData {
  bounds: Rect;
  centre: Point;
  /** South-wall entrance tile (where hallways connect). */
  entranceTile: Point;
  /** Tile where the scientist NPC stands (near entrance). */
  scientistTile: Point;
  /** Tile where the lab computer table is placed. */
  computerTile: Point;
  /** Tile where the spider egg starts (centre of room). */
  spiderEggTile: Point;
  /** Tile positions of the life machines scattered through the room. */
  lifeMachineTiles: Point[];
}

export interface SafeRoomData {
  bounds: Rect;
  centre: Point;
  /**
   * Set when this safe room is the last stop before a specific boss, naming that
   * boss's snake_case mob type. Drives the boss-specific advice Mordecai gives
   * in that room while the boss is still alive.
   */
  guardsBossType?: string;
}

/**
 * What forced-progression mode built, for validators that have to reason about
 * gauntlet ownership after the fact — the grid alone cannot say which rooms
 * belonged to a gauntlet rather than to the free region.
 */
export interface ProgressionLayoutData {
  startRoom: Rect;
  /** Bounds of every room owned by each gauntlet, in gauntlet order. */
  gauntletRoomBounds: Rect[][];
  /** Rooms per branch, per gauntlet, excluding the entry and gateway rooms. */
  branchRoomCounts: number[][];
  /** Whole-map attempts the accepted layout took, including the accepted one. */
  attempts: number;
  /**
   * Set when no free room cleared the stairwell-distance rule and one had to be
   * placed anyway. A floor with no stairs down is worse than one whose stairs
   * are a little close to the last boss, so the rule yields — and says so, so the
   * validator does not reject the result.
   */
  stairwellSpacingWaived: boolean;
}

export interface DungeonData {
  grid: TileContent[][];
  startTile: Point;
  safeRooms: SafeRoomData[];
  bossRooms: Array<{ bounds: Rect; centre: Point }>;
  questRooms: QuestRoomData[];
  treasureRooms: TreasureRoomData[];
  spiderLabRoom: SpiderLabRoomData | null;
  mobSpawnPoints: Array<Point & { w: number; h: number }>;
  hallwaySpawnPoints: Point[];
  stairwellTiles: Point[];
  buildingEntries: Array<{ doorTile: Point; name: string; type: 'arena' }>;
  arenaExteriors: ArenaExterior[];
  /** South-door tile of the arena, when this floor has one. */
  arenaDoorTile?: Point;
  /** Set only in forced-progression mode. */
  progressionLayout?: ProgressionLayoutData;
}

// ── Zone helpers ──────────────────────────────────────────────────────────────

const ZONE_ENTRANCE_MAX = 30;
const ZONE_MID_MAX = 60;

// Corridor zone floor probabilities
const MID_ZONE_CONCRETE_PROB = 0.5;
const DEEP_ZONE_TILE_PROB = 0.55;

// Hallway kind probability thresholds by zone
const SPECIAL_CONN_STANDARD_PROB = 0.55;
const ENTRANCE_NARROW_THRESH = 0.48;
const ENTRANCE_STANDARD_THRESH = 0.88;
const MID_NARROW_THRESH = 0.62;
const MID_STANDARD_THRESH = 0.9;
const DEEP_NARROW_THRESH = 0.76;
const DEEP_STANDARD_THRESH = 0.93;

// Room generation scaling: maxRooms ≈ ROOMS_SCALE_FACTOR * (size / SIZE_SCALE_BASE)²
const ROOMS_SCALE_FACTOR = 15;
const SIZE_SCALE_BASE = 100;
const ATTEMPT_MULTIPLIER = 8;
const MIN_PLACEMENT_ATTEMPTS = 80;

// Special room fixed dimensions
const BOSS_ROOM_W = 22;
const BOSS_ROOM_H = 18;
const QUEST_ROOM_W = 14;
const QUEST_ROOM_H = 12;
const SPIDER_LAB_W = 40;
const SPIDER_LAB_H = 32;

const BOSS_MIN_SEPARATION = 60;
const FALLBACK_START_POS = 15;

// Extra loop connections added on top of MST
const EXTRA_LOOP_RATIO = 0.22;
const LOOP_ATTEMPT_FACTOR = 10;
const EXTRA_LOOP_MIN_DIST = 14;
const EXTRA_LOOP_MAX_DIST = 40;

const QUEST_GRATE_WALL_OFFSET = 3;

/** Quest room distance cap from the last gateway boss room, in progression mode. */
const QUEST_ROOM_MAX_DIST_FROM_EXIT = 90;
/**
 * Nearest already-connected rooms a new free-region room will try to reach
 * before giving up on its position. More candidates trade generation time for a
 * lower chance of rejecting a perfectly good spot.
 */
const FREE_CONNECT_CANDIDATES = 6;
/** Below this, a progression floor's free region is too thin to be worth playing. */
const MIN_FREE_REGULAR_ROOMS = 12;
/** Ordinary rooms seeded before the free region's landmarks are placed. */
const FREE_SEED_ROOMS = 8;

const DEADEND_MIN_DIST_FROM_START = 18;
const DEADEND_SHORTCUT_MIN = 10;
const DEADEND_SHORTCUT_MAX = 65;

// Spider lab furniture layout (room is SPIDER_LAB_W × SPIDER_LAB_H tiles)
const LAB_WALL_OFFSET = 3; // items placed 3 tiles inside walls
const LAB_EGG_NEAR_WALL = 4; // egg/computer offset near entrance
const LAB_EGG_FAR_WALL = 5; // egg/computer offset far from entrance
const LAB_MACHINE_SPREAD = 10; // life machine lateral spread from center
const LAB_MACHINE_NS_NEAR_ROW = 12; // near life machine row (N/S entrance)
const LAB_MACHINE_NS_NEAR_FROM_FAR = 13; // same, from far wall
const LAB_MACHINE_EW_NEAR_FROM_FAR = 14; // near life machine col from far wall (E/W)
const LAB_MACHINE_NS_FAR_ROW = 22; // far life machine row (N/S entrance)
const LAB_MACHINE_NS_FAR_FROM_FAR = 23; // same, from far wall
const LAB_MACHINE_EW_FAR_COL = 24; // far life machine column (E/W entrance)
const LAB_MACHINE_EW_FAR_FROM_FAR = 25; // same, from far wall

const ROOMS_PER_STAIRWELL = 50;

// Room decoration placement
const PILLAR_MIN_ROOM_W = 13;
const PILLAR_MIN_ROOM_H = 10;
const DECO_INNER_OFFSET = 3; // decor placed 3 tiles inside walls
const DECO_NEAR_FAR_OFFSET = 4; // far-side column (r.w - DECO_NEAR_FAR_OFFSET)

// Decoration cycle lengths by zone
const ENTRANCE_CYCLE_LEN = 6;
const STANDARD_CYCLE_LEN = 8;

// Per-cycle thresholds and offsets
const CYCLE0_MIN_W = 10;
const CYCLE0_EXTRA_BARREL_MIN_W = 12;
const CYCLE0_EXTRA_BARREL_DX = 5;
const CYCLE1_MIN_W = 8;
const CYCLE3_MIN_SIZE = 7;
const CYCLE4_MIN_W = 9;
const CYCLE5_BONE_COUNT = 3;
const CYCLE5_DEEP_BONE_COUNT = 4;
const CYCLE6_MIN_W = 10;
const CYCLE6_SHELF_DX_END = 4;
const DECO_CYCLE_BRAZIER = 3;
const DECO_CYCLE_CORNER_MIX = 4;
const DECO_CYCLE_BONES = 5;
const DECO_CYCLE_SHELVES = 6;
const DECO_CYCLE_CLUSTER = 7;

const TREASURE_ROOM_RATIO = 0.05;

// Hallway spawn point density: count ≈ HALLWAY_SPAWNS_SCALE * (size / SIZE_SCALE_BASE)²
const HALLWAY_SPAWNS_SCALE = 10;
const HALLWAY_SPAWN_MIN_GAP = 3;

// Arena placement
const ARENA_PLACEMENT_ATTEMPTS = 800;
const ARENA_ANGLE_JITTER = 0.3;
const ARENA_MIN_DIST = 20;
const ARENA_DIST_VARIANCE = 70;
const ARENA_CLEARANCE = 3;
/** Arena distance from the last gateway boss room, in progression mode. */
const ARENA_MIN_DIST_FROM_GAUNTLET_EXIT = 30;
/** Nearest free rooms the antechamber will try to reach before the map is rejected. */
const ANTECHAMBER_CONNECT_CANDIDATES = 12;
/** Boss the arena's antechamber warns the player about. */
const ARENA_BOSS_TYPE = 'ball_of_swine';
/** Antechamber size range — a safe room, so it reuses the safe-room dimensions. */
const ANTECHAMBER_W_MIN = 10;
const ANTECHAMBER_W_MAX = 16;
const ANTECHAMBER_H_MIN = 8;
const ANTECHAMBER_H_MAX = 12;

function getZone(point: Point, start: Point): Zone {
  const d = Math.hypot(point.x - start.x, point.y - start.y);
  if (d < ZONE_ENTRANCE_MAX) return 'entrance';
  if (d < ZONE_MID_MAX) return 'mid';
  return 'deep';
}

// Zone-weighted floor palettes for regular rooms.
const ZONE_FLOORS: Record<Zone, number[]> = {
  entrance: [FloorTypeValue.concrete, FloorTypeValue.concrete, FloorTypeValue.tile_floor],
  mid: [FloorTypeValue.carpet, FloorTypeValue.wood, FloorTypeValue.tile_floor],
  deep: [FloorTypeValue.wood, FloorTypeValue.concrete, FloorTypeValue.carpet],
};

// Zone-based corridor floor — corridors now visually match their zone theme.
function corridorFloorForZone(zone: Zone): number {
  if (zone === 'entrance') return FloorTypeValue.concrete;
  if (zone === 'mid') {
    return Math.random() < MID_ZONE_CONCRETE_PROB
      ? FloorTypeValue.concrete
      : FloorTypeValue.tile_floor;
  }
  // deep: darker, worn floors
  return Math.random() < DEEP_ZONE_TILE_PROB ? FloorTypeValue.tile_floor : FloorTypeValue.wood;
}

// ── Vignette system ───────────────────────────────────────────────────────────

type Vignette = {
  tiles: ReadonlyArray<ReadonlyArray<number>>;
  minZone?: Zone;
  minRoomW?: number;
  minRoomH?: number;
  weight: number;
};

const ZONE_ORDER: ReadonlyArray<Zone> = ['entrance', 'mid', 'deep'];

// prettier-ignore
const VIGNETTES: ReadonlyArray<Vignette> = [
  {
    weight: 10,
    tiles: [
      [TORCH, 0,     0,       0,     TORCH],
      [0,     CRATE, BRAZIER, CRATE, 0    ],
      [0,     0,     BONES,   0,     0    ],
    ],
    minRoomW: 9, minRoomH: 7,
  },
  {
    weight: 8,
    tiles: [
      [BARREL,      BARREL,      0, CRATE,       CRATE     ],
      [BARREL_SIDE, BARREL_SIDE, 0, BARREL_SIDE, BARREL_SIDE],
    ],
    minRoomW: 9,
  },
  {
    weight: 8,
    tiles: [
      [BARREL, CRATE, TORCH,  CRATE, BARREL],
      [0,      0,     0,      0,     0     ],
      [BONES,  0,     0,      0,     BONES ],
    ],
    minRoomW: 9, minRoomH: 7,
  },
  {
    weight: 9,
    tiles: [
      [BARREL, BARREL_SIDE, BARREL, BARREL_SIDE, BARREL],
    ],
    minRoomW: 9,
  },
  {
    weight: 10,
    tiles: [
      [BONES,       0,           BARREL_SIDE, 0    ],
      [0,           BARREL_SIDE, 0,           BONES],
      [BARREL_SIDE, 0,           BONES,       0    ],
    ],
    minRoomW: 8, minRoomH: 7,
  },
  {
    weight: 7,
    tiles: [
      [BARREL, 0, 0, 0, BARREL],
      [0,      0, 0, 0, 0     ],
      [0,      0, 0, 0, 0     ],
      [0,      0, 0, 0, 0     ],
      [BARREL, 0, 0, 0, BARREL],
    ],
    minRoomW: 9, minRoomH: 9,
  },
  {
    weight: 7,
    tiles: [
      [BARREL, BARREL, CRATE],
      [BARREL, 0,      0    ],
      [CRATE,  CRATE,  0    ],
    ],
    minRoomW: 7,
  },
  {
    weight: 9,
    minZone: 'mid',
    tiles: [
      [TORCH, 0,     0,       0,     TORCH],
      [0,     BONES, 0,       BONES, 0    ],
      [0,     0,     BRAZIER, 0,     0    ],
      [0,     BONES, 0,       BONES, 0    ],
      [TORCH, 0,     0,       0,     TORCH],
    ],
    minRoomW: 9, minRoomH: 9,
  },
  {
    weight: 9,
    minZone: 'mid',
    tiles: [
      [BONES,  BONES, CRATE, BONES, BONES],
      [BONES,  0,     0,     0,     CRATE],
      [CRATE,  0,     0,     0,     BONES],
    ],
    minRoomW: 9,
  },
  {
    weight: 8,
    minZone: 'mid',
    tiles: [
      [CRATE, CRATE, CRATE,  0    ],
      [CRATE, 0,     0,      CRATE],
      [BONES, BONES, 0,      0    ],
    ],
    minRoomW: 8, minRoomH: 7,
  },
  {
    weight: 8,
    minZone: 'deep',
    tiles: [
      [BOOKSHELF, 0,     TORCH,   0,     BOOKSHELF],
      [0,         CRATE, BRAZIER, CRATE, 0        ],
      [BONES,     BONES, 0,       BONES, BONES    ],
    ],
    minRoomW: 9, minRoomH: 7,
  },
  {
    weight: 9,
    minZone: 'deep',
    tiles: [
      [BONES,  BONES,  BRAZIER, BONES,  BONES ],
      [BONES,  0,      0,       0,      BONES ],
      [BARREL, BONES,  BONES,   BONES,  BARREL],
    ],
    minRoomW: 9, minRoomH: 7,
  },
];

function pickVignette(zone: Zone, room: Room): Vignette | null {
  const zi = ZONE_ORDER.indexOf(zone);
  const eligible = VIGNETTES.filter((v) => {
    const vH = v.tiles.length;
    const vW = v.tiles[0]?.length ?? 0;
    if (room.w - 2 < vW || room.h - 2 < vH) return false;
    if (v.minRoomW !== undefined && room.w < v.minRoomW) return false;
    if (v.minRoomH !== undefined && room.h < v.minRoomH) return false;
    if (v.minZone !== undefined && zi < ZONE_ORDER.indexOf(v.minZone)) return false;
    return true;
  });
  if (eligible.length === 0) return null;

  let totalWeight = 0;
  for (const v of eligible) totalWeight += v.weight;
  let pick = Math.random() * totalWeight;
  for (const v of eligible) {
    pick -= v.weight;
    if (pick <= 0) return v;
  }
  return eligible[eligible.length - 1] ?? null;
}

function stampVignette(
  grid: TileContent[][],
  room: Room,
  vignette: Vignette,
  gridSize: number,
  stairwellBlockedSet: Set<string>,
): void {
  const vH = vignette.tiles.length;
  const vW = vignette.tiles[0]?.length ?? 0;
  if (vH === 0 || vW === 0) return;

  const interiorW = room.w - 2;
  const interiorH = room.h - 2;
  const maxOffX = interiorW - vW;
  const maxOffY = interiorH - vH;
  const offX = maxOffX > 0 ? randomInt(0, maxOffX) : 0;
  const offY = maxOffY > 0 ? randomInt(0, maxOffY) : 0;

  const originX = room.x + 1 + offX;
  const originY = room.y + 1 + offY;

  for (let vy = 0; vy < vH; vy++) {
    const vigRow = vignette.tiles[vy];
    for (let vx = 0; vx < vW; vx++) {
      const tileType = vigRow[vx] ?? 0;
      if (tileType === 0) continue;
      const gx = originX + vx;
      const gy = originY + vy;
      if (gy < 0 || gy >= gridSize || gx < 0 || gx >= gridSize) continue;
      if (stairwellBlockedSet.has(`${gx},${gy}`)) continue;
      const existingType = grid[gy][gx].type;
      if (
        existingType === room.floor ||
        existingType === FloorTypeValue.concrete ||
        existingType === FloorTypeValue.tile_floor ||
        existingType === FloorTypeValue.carpet ||
        existingType === FloorTypeValue.wood
      ) {
        placeProp(grid[gy][gx], tileType);
      }
    }
  }
}

const VIGNETTE_CHANCE: Record<Zone, number> = {
  entrance: 0.22,
  mid: 0.38,
  deep: 0.55,
};

// ── Boss floor selection ──────────────────────────────────────────────────────

function bossFloorForType(type: string): number {
  switch (type) {
    case 'the_hoarder':
      return HORDER_BOSS_ROOM_FLOOR;
    case 'juicer':
      return JUICER_BOSS_ROOM_FLOOR;
    case 'krakaren_clone':
      return KRAKAREN_BOSS_ROOM_FLOOR;
    default:
      return HORDER_BOSS_ROOM_FLOOR;
  }
}

// ── Safe-room thresholds ──────────────────────────────────────────────────────

/** How far into the room the scuffed band reaches: the doorway tile, plus one. */
const SAFE_ROOM_THRESHOLD_DEPTH_TILES = 2;

/**
 * The four sides of a room, as the direction *into* the room from each one.
 * A perimeter tile is a doorway when the tile one step the other way — outside
 * the room — is carved floor rather than wall.
 */
const ROOM_SIDES: ReadonlyArray<{ readonly inwardX: number; readonly inwardY: number }> = [
  { inwardX: 0, inwardY: 1 },
  { inwardX: 0, inwardY: -1 },
  { inwardX: 1, inwardY: 0 },
  { inwardX: -1, inwardY: 0 },
];

function isCarvedFloor(grid: TileContent[][], x: number, y: number): boolean {
  if (y < 0 || y >= grid.length) return false;
  const row = grid[y];
  if (x < 0 || x >= row.length) return false;
  const { type } = row[x];
  return type !== FloorTypeValue.wall && type !== VOID_TYPE;
}

/**
 * Lays the worn traffic band inside every doorway of a safe room.
 *
 * Run after all hallway carving, because a doorway only exists once a corridor
 * has cut through the room's wall — before that every perimeter tile looks
 * identical.
 *
 * Mordecai's tile and the bed's are skipped: they are the room's fixed furniture
 * and the band would otherwise be drawn under them in a narrow room. The Bopca's
 * counter run is *not* skipped, and does not need to be — it is stamped later
 * with `placeProp`, which overwrites the type, and `DUNGEON_GROUND` maps all
 * three counter types straight to the hearth paving regardless of what they
 * replaced.
 */
function stampSafeRoomThresholds(
  grid: TileContent[][],
  safeRoom: { bounds: Rect; centre: Point },
): void {
  const { bounds } = safeRoom;
  const fixtures = mordecaiAndBedTiles(safeRoom);
  const isFixture = (x: number, y: number): boolean =>
    fixtures.some((tile) => tile.x === x && tile.y === y);

  const lastX = bounds.x + bounds.w - 1;
  const lastY = bounds.y + bounds.h - 1;

  for (const side of ROOM_SIDES) {
    const alongX = side.inwardX === 0;
    const fromX = side.inwardX > 0 ? bounds.x : side.inwardX < 0 ? lastX : bounds.x;
    const fromY = side.inwardY > 0 ? bounds.y : side.inwardY < 0 ? lastY : bounds.y;
    const spanLength = alongX ? bounds.w : bounds.h;

    for (let step = 0; step < spanLength; step++) {
      const edgeX = alongX ? bounds.x + step : fromX;
      const edgeY = alongX ? fromY : bounds.y + step;
      if (!isCarvedFloor(grid, edgeX - side.inwardX, edgeY - side.inwardY)) continue;

      for (let depth = 0; depth < SAFE_ROOM_THRESHOLD_DEPTH_TILES; depth++) {
        const x = edgeX + side.inwardX * depth;
        const y = edgeY + side.inwardY * depth;
        if (x < bounds.x || x > lastX || y < bounds.y || y > lastY) break;
        if (isFixture(x, y)) continue;
        if (grid[y][x].type !== SAFE_ROOM_FLOOR) continue;
        grid[y][x].type = SAFE_ROOM_THRESHOLD;
      }
    }
  }
}

type RoomWall = 'north' | 'south' | 'east' | 'west';

/** The four walls of a room, as the direction *out of* the room through each. */
const ROOM_WALL_OUTWARD: ReadonlyArray<{ wall: RoomWall; dx: number; dy: number }> = [
  { wall: 'north', dx: 0, dy: -1 },
  { wall: 'south', dx: 0, dy: 1 },
  { wall: 'west', dx: -1, dy: 0 },
  { wall: 'east', dx: 1, dy: 0 },
];

/**
 * Which wall a room's corridor comes in through, read off the finished grid.
 *
 * Derived from the tiles rather than from the corridor's endpoints, because a
 * corridor's L can bend either way: guessing the wall from the two room centres
 * is right only for one of the two orientations, and picks the wrong wall
 * outright for the other.
 *
 * Returns the wall carrying the most doorway tiles, and the middle tile of its
 * widest doorway run. Falls back to the south wall's midpoint for a room nothing
 * has connected to yet.
 */
function detectRoomEntrance(grid: TileContent[][], bounds: Rect): { wall: RoomWall; tile: Point } {
  const lastX = bounds.x + bounds.w - 1;
  const lastY = bounds.y + bounds.h - 1;
  let best: { wall: RoomWall; tile: Point; width: number } | null = null;

  for (const side of ROOM_WALL_OUTWARD) {
    const alongX = side.dx === 0;
    const spanLength = alongX ? bounds.w : bounds.h;
    const fixedX = side.dx > 0 ? lastX : bounds.x;
    const fixedY = side.dy > 0 ? lastY : bounds.y;

    let runStart = -1;
    for (let step = 0; step <= spanLength; step++) {
      const x = alongX ? bounds.x + step : fixedX;
      const y = alongX ? fixedY : bounds.y + step;
      const isDoorway =
        step < spanLength &&
        isCarvedFloor(grid, x, y) &&
        isCarvedFloor(grid, x + side.dx, y + side.dy);
      if (isDoorway) {
        if (runStart === -1) runStart = step;
        continue;
      }
      if (runStart === -1) continue;
      const width = step - runStart;
      if (best === null || width > best.width) {
        const middle = runStart + Math.floor(width / 2);
        best = {
          wall: side.wall,
          tile: alongX ? { x: bounds.x + middle, y: fixedY } : { x: fixedX, y: bounds.y + middle },
          width,
        };
      }
      runStart = -1;
    }
  }

  if (best !== null) return { wall: best.wall, tile: best.tile };
  return { wall: 'south', tile: { x: Math.floor(bounds.x + bounds.w / 2), y: lastY } };
}

// ── Main generator ────────────────────────────────────────────────────────────

/** Everything the generator needs except the map's side length. */
export interface DungeonLevelOptions {
  numBossRooms: number;
  numStairwellsOverride?: number;
  hasArena?: boolean;
  bossTypes?: string[];
  hasSpiderLab?: boolean;
  /** When present, forced-progression mode replaces free room placement. */
  progression?: ProgressionDef;
}

export interface GenerateDungeonOptions extends DungeonLevelOptions {
  size: number;
}

/**
 * Safe rooms carved on a free-roam floor. Progression floors ignore it and
 * derive their own count from the gauntlets plus `scatterSafeRooms`.
 */
const FREE_ROAM_SAFE_ROOM_COUNT = 2;

/** Where the arena will be carved, and the safe room that will guard its door. */
interface ArenaReservation {
  centre: Point;
  doorTile: Point;
  /** Rock claimed for the arena wall, its outer ring, and a margin of its own. */
  reserve: Rect;
  antechamber: Rect;
}

/**
 * Finds a home for the arena in progression mode and claims the tiles for it.
 *
 * Spirals outward from the last gateway boss room, so the arena sits somewhere in
 * the free region rather than back inside a gauntlet, and takes the first
 * position where both the arena's own footprint and the antechamber below its
 * door land on untouched rock.
 */
function rectOfRoom(room: { x: number; y: number; w: number; h: number }): Rect {
  return { x: room.x, y: room.y, w: room.w, h: room.h };
}

function reserveArena(
  segments: SegmentMap,
  origin: Point,
  size: number,
  border: number,
): ArenaReservation | null {
  for (let attempt = 0; attempt < ARENA_PLACEMENT_ATTEMPTS; attempt++) {
    const angle =
      (attempt / ARENA_PLACEMENT_ATTEMPTS) * Math.PI * 2 + Math.random() * ARENA_ANGLE_JITTER;
    const distance = ARENA_MIN_DIST_FROM_GAUNTLET_EXIT + Math.random() * ARENA_DIST_VARIANCE;
    const centre: Point = {
      x: Math.round(origin.x + Math.cos(angle) * distance),
      y: Math.round(origin.y + Math.sin(angle) * distance),
    };

    if (
      centre.x - ARENA_REACH < border ||
      centre.x + ARENA_REACH >= size - border ||
      centre.y - ARENA_REACH < border ||
      centre.y + ARENA_REACH >= size - border
    ) {
      continue;
    }

    const doorTile = arenaDoorTileAt(centre);
    const reserve = arenaReserveRect(centre);
    const antechamberW = randomInt(ANTECHAMBER_W_MIN, ANTECHAMBER_W_MAX);
    const antechamberH = randomInt(ANTECHAMBER_H_MIN, ANTECHAMBER_H_MAX);
    const antechamber: Rect = {
      x: doorTile.x - Math.floor(antechamberW / 2),
      y: doorTile.y + 1,
      w: antechamberW,
      h: antechamberH,
    };

    if (!segments.canPlaceRoom(reserve, SEGMENT_ARENA)) continue;
    if (!segments.canPlaceRoom(antechamber, SEGMENT_ARENA)) continue;

    segments.addRoom(reserve, SEGMENT_ARENA);
    segments.addRoom(antechamber, SEGMENT_ARENA);
    return { centre, doorTile, reserve, antechamber };
  }
  return null;
}

/**
 * Generates one dungeon floor.
 *
 * In forced-progression mode the layout can simply fail to fit — a gauntlet may
 * run out of room, or the free region may end up too thin — so this returns null
 * and `generateDungeon` retries with fresh randomness.
 */
function buildDungeon(
  options: GenerateDungeonOptions,
  mapAttempt: number,
  rejections: string[],
): DungeonData | null {
  const reject = (reason: string): null => {
    rejections.push(reason);
    return null;
  };
  const {
    size,
    numBossRooms,
    numStairwellsOverride,
    hasArena = false,
    bossTypes = [],
    hasSpiderLab = false,
    progression,
  } = options;
  const BORDER = 5;

  // 1. Fill everything with wall tiles
  const grid: TileContent[][] = Array.from({ length: size }, (_, y) =>
    Array.from({ length: size }, (_, x) => ({
      tileId: `${x}#${y}`,
      type: FloorTypeValue.wall,
    })),
  );

  // 2. Void border
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (y < BORDER || y >= size - BORDER || x < BORDER || x >= size - BORDER) {
        grid[y][x].type = VOID_TYPE;
      }
    }
  }

  // Tiles carved as hallway — tracked for rat spawn placement
  const hallwayTiles: Array<{ x: number; y: number }> = [];

  // ── Hallway carvers ───────────────────────────────────────────────────────
  //
  // L-shaped path: horizontal leg at y=y1, then vertical leg at x=x2.
  // halfWidth=0 → 1-tile wide (default); halfWidth=1 → 3-tile wide (main arteries).
  // Corridors only carve through existing wall tiles, so they don't overwrite rooms.

  const carveHallwayCore = (
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    halfWidth: number,
    floorType: number,
  ) => {
    const minX = Math.min(x1, x2);
    const maxX = Math.max(x1, x2);
    for (let hx = minX; hx <= maxX; hx++) {
      for (let off = -halfWidth; off <= halfWidth; off++) {
        const hy = y1 + off;
        if (hy >= BORDER && hy < size - BORDER && grid[hy][hx].type === FloorTypeValue.wall) {
          grid[hy][hx].type = floorType;
          hallwayTiles.push({ x: hx, y: hy });
        }
      }
    }
    const minY = Math.min(y1, y2);
    const maxY = Math.max(y1, y2);
    for (let hy = minY; hy <= maxY; hy++) {
      for (let off = -halfWidth; off <= halfWidth; off++) {
        const hx = x2 + off;
        if (hx >= BORDER && hx < size - BORDER && grid[hy][hx].type === FloorTypeValue.wall) {
          grid[hy][hx].type = floorType;
          hallwayTiles.push({ x: hx, y: hy });
        }
      }
    }
  };

  // Small 5×5 alcove at the L-bend, creating an interesting junction pocket.
  const carveNookAt = (cx: number, cy: number, floorType: number) => {
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx >= BORDER && nx < size - BORDER && ny >= BORDER && ny < size - BORDER) {
          if (grid[ny][nx].type === FloorTypeValue.wall) {
            grid[ny][nx].type = floorType;
            hallwayTiles.push({ x: nx, y: ny });
          }
        }
      }
    }
  };

  const carveHallway = (
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    kind: HallwayKind,
    floorType: number,
  ) => {
    const halfWidth = kind === 'standard' ? 1 : 0;
    carveHallwayCore(x1, y1, x2, y2, halfWidth, floorType);
    if (kind === 'nook') {
      carveNookAt(x2, y1, floorType);
    }
  };

  // Picks corridor kind based on zone. Most corridors are 1-tile narrow — rooms
  // become clearly distinct from the passages connecting them.
  const selectHallwayKind = (zone: Zone, isSpecial: boolean): HallwayKind => {
    if (isSpecial) {
      // Connections to/from safe rooms, boss rooms, and the first hub connections
      // get a wider passage so key areas feel accessible.
      return Math.random() < SPECIAL_CONN_STANDARD_PROB ? 'standard' : 'narrow';
    }
    const r = Math.random();
    if (zone === 'entrance') {
      if (r < ENTRANCE_NARROW_THRESH) return 'narrow';
      if (r < ENTRANCE_STANDARD_THRESH) return 'standard';
      return 'nook';
    } else if (zone === 'mid') {
      if (r < MID_NARROW_THRESH) return 'narrow';
      if (r < MID_STANDARD_THRESH) return 'standard';
      return 'nook';
    } else {
      if (r < DEEP_NARROW_THRESH) return 'narrow';
      if (r < DEEP_STANDARD_THRESH) return 'standard';
      return 'nook';
    }
  };

  // 3. Place rooms
  const rooms: Room[] = [];
  const MIN_W = 8,
    MAX_W = 16;
  const MIN_H = 7,
    MAX_H = 14;
  const GAP = 3;

  const maxRooms = Math.round(ROOMS_SCALE_FACTOR * (size / SIZE_SCALE_BASE) ** 2);
  const maxAttempts = Math.max(maxRooms * ATTEMPT_MULTIPLIER, MIN_PLACEMENT_ATTEMPTS);

  const QUEST_MAX_DIST = 60;
  const SPIDER_LAB_MIN_DIST = 30;
  const SPIDER_LAB_MAX_DIST = 90;

  type Edge = { from: number; to: number };
  const mstEdges: Edge[] = [];

  let startCenter: Point | null = null;
  let progressionLayout: ProgressionLayoutData | undefined;
  let lastGatewayBossRoom: Rect | null = null;
  let arenaReservation: ArenaReservation | null = null;
  let antechamberSafeRoom: SafeRoomData | null = null;

  const carveRoomFloor = (rect: Rect, floor: number): void => {
    for (let ry = rect.y; ry < rect.y + rect.h; ry++) {
      for (let rx = rect.x; rx < rect.x + rect.w; rx++) {
        grid[ry][rx].type = floor;
      }
    }
  };

  /** Carves planned corridor tiles, leaving any already-carved tile alone. */
  const carveCorridorTiles = (tiles: ReadonlyArray<Point>, floorType: number): void => {
    for (const tile of tiles) {
      if (grid[tile.y]?.[tile.x]?.type !== FloorTypeValue.wall) continue;
      grid[tile.y][tile.x].type = floorType;
      hallwayTiles.push({ x: tile.x, y: tile.y });
    }
  };

  const addRoom = (rect: Rect, floor: number, role: RoomRole, guardsBossType?: string): number => {
    rooms.push({ x: rect.x, y: rect.y, w: rect.w, h: rect.h, floor, role, guardsBossType });
    carveRoomFloor(rect, floor);
    return rooms.length - 1;
  };

  if (progression !== undefined) {
    const segments = new SegmentMap(size, BORDER);
    let antechamberRoomIndex: number | null = null;

    const mapCentre: Point = { x: Math.floor(size / 2), y: Math.floor(size / 2) };
    const startRoom = rectCentredOn(
      mapCentre,
      randomInt(START_ROOM_W_MIN, START_ROOM_W_MAX),
      randomInt(START_ROOM_H_MIN, START_ROOM_H_MAX),
    );
    if (!segments.canPlaceRoom(startRoom, gauntletSegment(0))) return reject('start room');
    segments.addRoom(startRoom, gauntletSegment(0));
    const startCentre = rectCentre(startRoom);
    startCenter = startCentre;
    addRoom(startRoom, randomFromArray(ZONE_FLOORS.entrance), 'start');

    const zoneOf = (point: Point): Zone => getZone(point, startCentre);
    const pickCorridorKind = (isSpecial: boolean, target: Point): HallwayKind =>
      selectHallwayKind(zoneOf(target), isSpecial);
    const carvePlannedCorridor = (corridor: PlannedCorridor): void => {
      carveCorridorTiles(corridor.tiles, corridorFloorForZone(zoneOf(corridor.target)));
    };

    // ── Gauntlets ───────────────────────────────────────────────────────────

    const gauntletRoomBounds: Rect[][] = [];
    const branchRoomCounts: number[][] = [];
    let entryRoom = startRoom;
    let previousHeading: number | null = null;

    for (const [index, gauntlet] of progression.gauntlets.entries()) {
      let plan: GauntletPlan | null = null;
      // The drawn branch count survives every geometry retry, and only steps down
      // once this many branches have proved genuinely unplaceable. Redrawing it
      // per attempt would collapse the distribution onto the minimum, because
      // fewer branches are always likelier to fit.
      let branchCount = randomInt(gauntlet.branchCount.min, gauntlet.branchCount.max);
      while (plan === null && branchCount >= gauntlet.branchCount.min) {
        for (let attempt = 0; attempt < MAX_GAUNTLET_ATTEMPTS && plan === null; attempt++) {
          const snapshot = segments.snapshot();
          plan = planGauntlet(segments, {
            index,
            mapSize: size,
            entryRoom,
            previousHeading,
            branchCount,
            branchRooms: gauntlet.branchRooms,
            sizes: {
              safeRoomW: randomInt(MIN_W, MAX_W),
              safeRoomH: randomInt(MIN_H, MAX_H),
              bossRoomW: BOSS_ROOM_W,
              bossRoomH: BOSS_ROOM_H,
            },
            pickCorridorKind,
          });
          if (plan === null) segments.rollback(snapshot);
        }
        if (plan === null) branchCount--;
      }
      if (plan === null) return reject(`gauntlet ${index}`);

      for (const count of plan.branchRoomCounts) {
        if (count < gauntlet.branchRooms.min || count > gauntlet.branchRooms.max) {
          throw new Error(
            `gauntlet ${index} produced a branch of ${count} rooms, outside the configured ` +
              `range ${gauntlet.branchRooms.min}–${gauntlet.branchRooms.max}`,
          );
        }
      }

      addRoom(plan.safeRoom, SAFE_ROOM_FLOOR, 'safe', gauntlet.bossType);
      addRoom(plan.bossRoom, bossFloorForType(gauntlet.bossType), 'boss');
      for (const rect of plan.chainRooms) {
        addRoom(rect, randomFromArray(ZONE_FLOORS[zoneOf(rectCentre(rect))]), 'chain');
      }
      for (const corridor of plan.corridors) carvePlannedCorridor(corridor);

      gauntletRoomBounds.push([plan.safeRoom, plan.bossRoom, ...plan.chainRooms]);
      branchRoomCounts.push(plan.branchRoomCounts);
      entryRoom = plan.bossRoom;
      previousHeading = plan.heading;
    }

    const lastBossRoom = entryRoom;
    lastGatewayBossRoom = lastBossRoom;
    const lastBossIndex = rooms.findIndex(
      (r) => r.role === 'boss' && r.x === lastBossRoom.x && r.y === lastBossRoom.y,
    );
    const lastBossCentre = rectCentre(lastBossRoom);

    // ── Arena reservation ───────────────────────────────────────────────────
    //
    // The arena is sited before the free region rather than after it, because it
    // needs a wide patch of untouched rock for its wall, its ring, and the
    // antechamber that guards its only door. Once reserved, free rooms simply
    // route around it.

    if (hasArena) {
      arenaReservation = reserveArena(segments, lastBossCentre, size, BORDER);
      if (arenaReservation === null) return reject('arena reservation');
      const antechamberIndex = addRoom(
        arenaReservation.antechamber,
        SAFE_ROOM_FLOOR,
        'safe',
        ARENA_BOSS_TYPE,
      );
      antechamberRoomIndex = antechamberIndex;
    }

    // ── Free region ─────────────────────────────────────────────────────────
    //
    // Every free room is connected the moment it is seated, to the nearest
    // already-connected room that yields a legal corridor. That makes the region
    // a tree rooted at the last gateway boss room by construction: nothing here
    // can be reached without clearing that boss.

    const connectableIndices: number[] = [];
    let seedUsed = false;

    const connectFreeRoom = (rect: Rect, isSpecial: boolean): PlannedCorridor | null => {
      const centre = rectCentre(rect);
      const candidates = seedUsed
        ? [...connectableIndices]
        : [lastBossIndex, ...connectableIndices];
      candidates.sort((a, b) => {
        const ra = rooms[a];
        const rb = rooms[b];
        return (
          Math.hypot(
            centre.x - Math.floor(ra.x + ra.w / 2),
            centre.y - Math.floor(ra.y + ra.h / 2),
          ) -
          Math.hypot(centre.x - Math.floor(rb.x + rb.w / 2), centre.y - Math.floor(rb.y + rb.h / 2))
        );
      });
      for (const candidateIndex of candidates.slice(0, FREE_CONNECT_CANDIDATES)) {
        const candidate = rooms[candidateIndex];
        const candidateRect: Rect = {
          x: candidate.x,
          y: candidate.y,
          w: candidate.w,
          h: candidate.h,
        };
        const corridor = planCorridorBetween(
          segments,
          SEGMENT_FREE,
          candidateRect,
          rect,
          pickCorridorKind(isSpecial || candidateIndex === lastBossIndex, centre),
        );
        if (corridor === null) continue;
        segments.claimCorridor(corridor.tiles, SEGMENT_FREE);
        mstEdges.push({ from: candidateIndex, to: rooms.length });
        if (candidateIndex === lastBossIndex) seedUsed = true;
        return corridor;
      }
      return null;
    };

    const placeFreeRoom = (
      w: number,
      h: number,
      role: RoomRole,
      floorFor: (centre: Point) => number,
      accept: (centre: Point) => boolean,
      guardsBossType?: string,
    ): number | null => {
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const rect: Rect = {
          x: randomInt(BORDER + 1, size - BORDER - w - 2),
          y: randomInt(BORDER + 1, size - BORDER - h - 2),
          w,
          h,
        };
        const centre = rectCentre(rect);
        if (!accept(centre)) continue;
        if (!segments.canPlaceRoom(rect, SEGMENT_FREE)) continue;

        const snapshot = segments.snapshot();
        segments.addRoom(rect, SEGMENT_FREE);
        const corridor = connectFreeRoom(rect, role !== 'regular');
        if (corridor === null) {
          segments.rollback(snapshot);
          continue;
        }
        const index = addRoom(rect, floorFor(centre), role, guardsBossType);
        carvePlannedCorridor(corridor);
        connectableIndices.push(index);
        return index;
      }
      return null;
    };

    const regularFloorFor = (centre: Point): number => randomFromArray(ZONE_FLOORS[zoneOf(centre)]);
    const anyPosition = (): boolean => true;

    let freeRegularRooms = 0;
    const fillWithRegularRooms = (limit: number): void => {
      while (rooms.length < limit) {
        const placed = placeFreeRoom(
          randomInt(MIN_W, MAX_W),
          randomInt(MIN_H, MAX_H),
          'regular',
          regularFloorFor,
          anyPosition,
        );
        if (placed === null) break;
        freeRegularRooms++;
      }
    };

    // A handful of ordinary rooms first, so the big landmarks have somewhere to
    // attach; then the landmarks, while there is still open ground for a
    // 40×32 spider lab; then everything else fills the gaps.
    fillWithRegularRooms(rooms.length + FREE_SEED_ROOMS);
    if (freeRegularRooms === 0) return reject('free region seed');

    if (
      placeFreeRoom(
        QUEST_ROOM_W,
        QUEST_ROOM_H,
        'quest',
        () => FloorTypeValue.tile_floor,
        (centre) =>
          Math.hypot(centre.x - lastBossCentre.x, centre.y - lastBossCentre.y) <=
          QUEST_ROOM_MAX_DIST_FROM_EXIT,
      ) === null
    ) {
      return reject('quest room');
    }

    if (hasSpiderLab) {
      const placedLab = placeFreeRoom(
        SPIDER_LAB_W,
        SPIDER_LAB_H,
        'spider_lab',
        () => SPIDER_LAB_FLOOR,
        (centre) => {
          const d = Math.hypot(centre.x - lastBossCentre.x, centre.y - lastBossCentre.y);
          return d >= SPIDER_LAB_MIN_DIST && d <= SPIDER_LAB_MAX_DIST;
        },
      );
      if (placedLab === null) return reject('spider lab');
    }

    const gatewaySafeCentres = rooms
      .filter((r) => r.role === 'safe')
      .map((r) => ({ x: Math.floor(r.x + r.w / 2), y: Math.floor(r.y + r.h / 2) }));
    const scatterSafeCentres: Point[] = [];
    for (let i = 0; i < progression.scatterSafeRooms; i++) {
      const placedSafe = placeFreeRoom(
        randomInt(MIN_W, MAX_W),
        randomInt(MIN_H, MAX_H),
        'safe',
        () => SAFE_ROOM_FLOOR,
        (centre) =>
          [...gatewaySafeCentres, ...scatterSafeCentres].every(
            (other) =>
              Math.hypot(centre.x - other.x, centre.y - other.y) >= SCATTER_SAFE_ROOM_SEPARATION,
          ),
      );
      if (placedSafe === null) return reject('scatter safe room');
      const placedRoom = rooms[placedSafe];
      scatterSafeCentres.push({
        x: Math.floor(placedRoom.x + placedRoom.w / 2),
        y: Math.floor(placedRoom.y + placedRoom.h / 2),
      });
    }

    fillWithRegularRooms(maxRooms);
    if (freeRegularRooms < MIN_FREE_REGULAR_ROOMS) return reject('free region too thin');

    // The antechamber gets exactly one way out into the free region. Any second
    // route would let a player reach the arena door without walking through it.
    if (antechamberRoomIndex !== null) {
      const antechamber = rectOfRoom(rooms[antechamberRoomIndex]);
      const antechamberCentre = rectCentre(antechamber);
      const candidates = [...connectableIndices].sort((a, b) => {
        const ra = rectCentre(rectOfRoom(rooms[a]));
        const rb = rectCentre(rectOfRoom(rooms[b]));
        return (
          Math.hypot(antechamberCentre.x - ra.x, antechamberCentre.y - ra.y) -
          Math.hypot(antechamberCentre.x - rb.x, antechamberCentre.y - rb.y)
        );
      });
      let connected = false;
      for (const candidateIndex of candidates.slice(0, ANTECHAMBER_CONNECT_CANDIDATES)) {
        const corridor = planCorridorBetween(
          segments,
          SEGMENT_FREE,
          antechamber,
          rectOfRoom(rooms[candidateIndex]),
          pickCorridorKind(true, antechamberCentre),
        );
        if (corridor === null) continue;
        segments.claimCorridor(corridor.tiles, SEGMENT_FREE);
        carvePlannedCorridor(corridor);
        connected = true;
        break;
      }
      if (!connected) return reject('antechamber connection');
    }

    // ── Free-region loops and dead-end rescue ───────────────────────────────

    const freeRegularIndices = rooms.reduce<number[]>((acc, room, idx) => {
      if (room.role === 'regular') acc.push(idx);
      return acc;
    }, []);

    const tryFreeShortcut = (fromIndex: number, toIndex: number): boolean => {
      const corridor = planCorridorBetween(
        segments,
        SEGMENT_FREE,
        rectOfRoom(rooms[fromIndex]),
        rectOfRoom(rooms[toIndex]),
        'narrow',
      );
      if (corridor === null) return false;
      segments.claimCorridor(corridor.tiles, SEGMENT_FREE);
      carvePlannedCorridor(corridor);
      return true;
    };

    const freeDegree = new Map<number, number>();
    for (const edge of mstEdges) {
      freeDegree.set(edge.from, (freeDegree.get(edge.from) ?? 0) + 1);
      freeDegree.set(edge.to, (freeDegree.get(edge.to) ?? 0) + 1);
    }
    const parentOf = new Map<number, number>();
    for (const edge of mstEdges) parentOf.set(edge.to, edge.from);

    for (const i of freeRegularIndices) {
      if ((freeDegree.get(i) ?? 0) !== 1) continue;
      const centre = rectCentre(rectOfRoom(rooms[i]));
      if (
        Math.hypot(centre.x - startCentre.x, centre.y - startCentre.y) < DEADEND_MIN_DIST_FROM_START
      ) {
        continue;
      }
      const parent = parentOf.get(i);
      let bestDist = Infinity;
      let bestTargetIdx = -1;
      for (const j of freeRegularIndices) {
        if (j === i || j === parent) continue;
        const other = rectCentre(rectOfRoom(rooms[j]));
        const dist = Math.hypot(centre.x - other.x, centre.y - other.y);
        if (dist >= DEADEND_SHORTCUT_MIN && dist <= DEADEND_SHORTCUT_MAX && dist < bestDist) {
          bestDist = dist;
          bestTargetIdx = j;
        }
      }
      if (bestTargetIdx !== -1) tryFreeShortcut(i, bestTargetIdx);
    }

    const extraTarget = Math.max(1, Math.floor(freeRegularIndices.length * EXTRA_LOOP_RATIO));
    let extraAdded = 0;
    const maxLoopAttempts = extraTarget * LOOP_ATTEMPT_FACTOR;
    for (let attempt = 0; attempt < maxLoopAttempts && extraAdded < extraTarget; attempt++) {
      if (freeRegularIndices.length < 2) break;
      const firstIdx = randomFromArray(freeRegularIndices);
      const secondIdx = randomFromArray(freeRegularIndices);
      if (firstIdx === secondIdx) continue;
      const c1 = rectCentre(rectOfRoom(rooms[firstIdx]));
      const c2 = rectCentre(rectOfRoom(rooms[secondIdx]));
      const dist = Math.hypot(c1.x - c2.x, c1.y - c2.y);
      if (dist < EXTRA_LOOP_MIN_DIST || dist > EXTRA_LOOP_MAX_DIST) continue;
      if (tryFreeShortcut(firstIdx, secondIdx)) extraAdded++;
    }

    progressionLayout = {
      startRoom,
      gauntletRoomBounds,
      branchRoomCounts,
      attempts: mapAttempt,
      // Filled in once stairwells have been sited, further down the pipeline.
      stairwellSpacingWaived: false,
    };
  } else {
    const safeRoomStart = 1;
    const safeRoomEnd = 1 + FREE_ROAM_SAFE_ROOM_COUNT;
    const bossRoomStart = safeRoomEnd;
    const bossRoomEnd = safeRoomEnd + numBossRooms;
    const questRoomIdx = bossRoomEnd;
    const spiderLabRoomIdx = hasSpiderLab ? questRoomIdx + 1 : -1;

    const SAFE_MAX_DIST = 50;
    const BOSS_MAX_DIST = 80;
    const SAFE_MIN_SEPARATION = 18;

    for (let attempt = 0; attempt < maxAttempts && rooms.length < maxRooms; attempt++) {
      const isSafeRoom = rooms.length >= safeRoomStart && rooms.length < safeRoomEnd;
      const isBossRoom = rooms.length >= bossRoomStart && rooms.length < bossRoomEnd;
      const isQuestRoom = rooms.length === questRoomIdx;
      const isSpiderLabRoom = spiderLabRoomIdx >= 0 && rooms.length === spiderLabRoomIdx;
      const w = isBossRoom
        ? BOSS_ROOM_W
        : isQuestRoom
          ? QUEST_ROOM_W
          : isSpiderLabRoom
            ? SPIDER_LAB_W
            : randomInt(MIN_W, MAX_W);
      const h = isBossRoom
        ? BOSS_ROOM_H
        : isQuestRoom
          ? QUEST_ROOM_H
          : isSpiderLabRoom
            ? SPIDER_LAB_H
            : randomInt(MIN_H, MAX_H);
      const x = randomInt(BORDER + 1, size - BORDER - w - 2);
      const y = randomInt(BORDER + 1, size - BORDER - h - 2);

      const cx = Math.floor(x + w / 2);
      const cy = Math.floor(y + h / 2);

      const overlaps = rooms.some(
        (r) => x < r.x + r.w + GAP && x + w + GAP > r.x && y < r.y + r.h + GAP && y + h + GAP > r.y,
      );

      const tooCloseToBoss =
        isBossRoom &&
        rooms.slice(bossRoomStart, bossRoomEnd).some((r) => {
          const rc = { x: Math.floor(r.x + r.w / 2), y: Math.floor(r.y + r.h / 2) };
          return Math.hypot(cx - rc.x, cy - rc.y) < BOSS_MIN_SEPARATION;
        });

      const tooCloseToSafeRoom =
        isSafeRoom &&
        rooms.slice(safeRoomStart, safeRoomEnd).some((r) => {
          const rc = { x: Math.floor(r.x + r.w / 2), y: Math.floor(r.y + r.h / 2) };
          return Math.hypot(cx - rc.x, cy - rc.y) < SAFE_MIN_SEPARATION;
        });

      let tooFarFromStart = false;
      if (rooms.length > 0) {
        const sc0 = startCenter ?? {
          x: Math.floor(rooms[0].x + rooms[0].w / 2),
          y: Math.floor(rooms[0].y + rooms[0].h / 2),
        };
        if (isSpiderLabRoom) {
          const d = Math.hypot(cx - sc0.x, cy - sc0.y);
          if (d < SPIDER_LAB_MIN_DIST || d > SPIDER_LAB_MAX_DIST) tooFarFromStart = true;
        } else {
          const maxDist = isSafeRoom
            ? SAFE_MAX_DIST
            : isBossRoom
              ? BOSS_MAX_DIST
              : isQuestRoom
                ? QUEST_MAX_DIST
                : Infinity;
          if (Math.hypot(cx - sc0.x, cy - sc0.y) > maxDist) tooFarFromStart = true;
        }
      }

      if (!overlaps && !tooCloseToBoss && !tooCloseToSafeRoom && !tooFarFromStart) {
        const roomCentre: Point = { x: cx, y: cy };
        const zone: Zone = startCenter !== null ? getZone(roomCentre, startCenter) : 'entrance';

        const bossIdx = rooms.length - bossRoomStart;
        const floor = isSafeRoom
          ? SAFE_ROOM_FLOOR
          : isBossRoom
            ? bossFloorForType(bossTypes[bossIdx] ?? '')
            : isQuestRoom
              ? FloorTypeValue.tile_floor
              : isSpiderLabRoom
                ? SPIDER_LAB_FLOOR
                : randomFromArray(ZONE_FLOORS[zone]);

        const role: RoomRole =
          rooms.length === 0
            ? 'start'
            : isSafeRoom
              ? 'safe'
              : isBossRoom
                ? 'boss'
                : isQuestRoom
                  ? 'quest'
                  : isSpiderLabRoom
                    ? 'spider_lab'
                    : 'regular';

        addRoom({ x, y, w, h }, floor, role);
        if (rooms.length === 1) startCenter = { x: cx, y: cy };
      }
    }
  }

  // ── Hallway connectivity via MST (Prim's algorithm) ───────────────────────
  //
  // Rather than connecting rooms in placement order (a single spaghetti chain),
  // Prim's builds a spanning tree by always attaching the nearest unconnected
  // room to the already-connected set. This naturally creates hub rooms (rooms
  // with several connections) and dead-end rooms (one connection), giving the
  // dungeon a real branching structure to explore.

  const sc = startCenter ?? {
    x: rooms[0]?.x ?? FALLBACK_START_POS,
    y: rooms[0]?.y ?? FALLBACK_START_POS,
  };

  // Special rooms (start, safe, boss, quest, spider lab) get wider corridors so
  // the map's landmarks feel accessible.
  const isSpecialRoom = (room: Room): boolean => room.role !== 'regular' && room.role !== 'chain';
  const regularRoomIndices = rooms.reduce<number[]>((acc, room, idx) => {
    if (room.role === 'regular') acc.push(idx);
    return acc;
  }, []);
  /** Rooms that host ordinary encounters and get ordinary decoration. */
  const populatedRoomIndices = rooms.reduce<number[]>((acc, room, idx) => {
    if (room.role === 'regular' || room.role === 'chain') acc.push(idx);
    return acc;
  }, []);

  if (progression === undefined) {
    if (rooms.length > 1) {
      const connected = new Set<number>([0]);
      // minDist[i] = distance from room i to its current closest connected room
      const minDist = rooms.map((r, i) => {
        if (i === 0) return 0;
        const r0 = rooms[0];
        return Math.hypot(
          Math.floor(r.x + r.w / 2) - Math.floor(r0.x + r0.w / 2),
          Math.floor(r.y + r.h / 2) - Math.floor(r0.y + r0.h / 2),
        );
      });
      const closestTo = new Array<number>(rooms.length).fill(0);

      while (connected.size < rooms.length) {
        let bestIdx = -1;
        let bestDist = Infinity;
        for (let i = 0; i < rooms.length; i++) {
          if (connected.has(i)) continue;
          if (minDist[i] < bestDist) {
            bestDist = minDist[i];
            bestIdx = i;
          }
        }
        if (bestIdx === -1) break;

        mstEdges.push({ from: closestTo[bestIdx], to: bestIdx });
        connected.add(bestIdx);

        // Update distances for remaining unconnected rooms
        const newR = rooms[bestIdx];
        const newCx = Math.floor(newR.x + newR.w / 2);
        const newCy = Math.floor(newR.y + newR.h / 2);
        for (let i = 0; i < rooms.length; i++) {
          if (connected.has(i)) continue;
          const r = rooms[i];
          const d = Math.hypot(
            Math.floor(r.x + r.w / 2) - newCx,
            Math.floor(r.y + r.h / 2) - newCy,
          );
          if (d < minDist[i]) {
            minDist[i] = d;
            closestTo[i] = bestIdx;
          }
        }
      }
    }

    // Carve all MST hallways
    for (const edge of mstEdges) {
      const from = rooms[edge.from];
      const to = rooms[edge.to];
      const fc = { x: Math.floor(from.x + from.w / 2), y: Math.floor(from.y + from.h / 2) };
      const tc = { x: Math.floor(to.x + to.w / 2), y: Math.floor(to.y + to.h / 2) };
      const isSpecial = isSpecialRoom(from) || isSpecialRoom(to);
      const zone = getZone(tc, sc);
      const kind = selectHallwayKind(zone, isSpecial);
      const floorType = corridorFloorForZone(zone);
      carveHallway(fc.x, fc.y, tc.x, tc.y, kind, floorType);
    }

    // ── Dead-end rescue connections ─────────────────────────────────────────
    //
    // Leaf rooms (MST degree 1) that are far from the start have only one exit.
    // Walking in and hitting a dead end forces long backtracking through already-
    // cleared areas. For each distant leaf we carve a narrow shortcut to the
    // nearest other regular room, converting the dead end into a loop.

    const mstDegree = new Array<number>(rooms.length).fill(0);
    for (const edge of mstEdges) {
      mstDegree[edge.from]++;
      mstDegree[edge.to]++;
    }
    const mstParentOf = new Map<number, number>();
    for (const edge of mstEdges) {
      mstParentOf.set(edge.to, edge.from);
    }

    for (const i of regularRoomIndices) {
      if (mstDegree[i] !== 1) continue;
      const r = rooms[i];
      const rc = { x: Math.floor(r.x + r.w / 2), y: Math.floor(r.y + r.h / 2) };
      if (Math.hypot(rc.x - sc.x, rc.y - sc.y) < DEADEND_MIN_DIST_FROM_START) continue;

      const parent = mstParentOf.get(i);
      let bestDist = Infinity;
      let bestTargetIdx = -1;

      for (const j of regularRoomIndices) {
        if (j === i || j === parent) continue;
        const tr = rooms[j];
        const tc = { x: Math.floor(tr.x + tr.w / 2), y: Math.floor(tr.y + tr.h / 2) };
        const dist = Math.hypot(rc.x - tc.x, rc.y - tc.y);
        if (dist >= DEADEND_SHORTCUT_MIN && dist <= DEADEND_SHORTCUT_MAX && dist < bestDist) {
          bestDist = dist;
          bestTargetIdx = j;
        }
      }

      if (bestTargetIdx !== -1) {
        const tr = rooms[bestTargetIdx];
        const tc = { x: Math.floor(tr.x + tr.w / 2), y: Math.floor(tr.y + tr.h / 2) };
        const zone = getZone(tc, sc);
        const floorType = corridorFloorForZone(zone);
        carveHallway(rc.x, rc.y, tc.x, tc.y, 'narrow', floorType);
      }
    }

    // ── Extra loop connections ──────────────────────────────────────────────
    //
    // Adding ~20% more edges on top of the MST creates loops, giving the player
    // shortcuts and alternative routes — making exploration rewarding rather than
    // mandatory backtracking through dead ends.

    const extraTarget = Math.max(1, Math.floor(regularRoomIndices.length * EXTRA_LOOP_RATIO));
    let extraAdded = 0;
    const maxLoopAttempts = extraTarget * LOOP_ATTEMPT_FACTOR;

    for (let attempt = 0; attempt < maxLoopAttempts && extraAdded < extraTarget; attempt++) {
      if (regularRoomIndices.length < 2) break;
      const r1Idx = randomFromArray(regularRoomIndices);
      const r2Idx = randomFromArray(regularRoomIndices);
      if (r1Idx === r2Idx) continue;

      const r1 = rooms[r1Idx];
      const r2 = rooms[r2Idx];
      const c1 = { x: Math.floor(r1.x + r1.w / 2), y: Math.floor(r1.y + r1.h / 2) };
      const c2 = { x: Math.floor(r2.x + r2.w / 2), y: Math.floor(r2.y + r2.h / 2) };
      const dist = Math.hypot(c1.x - c2.x, c1.y - c2.y);

      // Target spatially nearby but not immediately adjacent rooms.
      // Corridors that are too short just look like alcoves; too long = big gray passages.
      if (dist >= EXTRA_LOOP_MIN_DIST && dist <= EXTRA_LOOP_MAX_DIST) {
        const zone = getZone(c2, sc);
        const floorType = corridorFloorForZone(zone);
        // Loop connections are always narrow — they're secondary routes, not main arteries.
        carveHallway(c1.x, c1.y, c2.x, c2.y, 'narrow', floorType);
        extraAdded++;
      }
    }
  }

  // 6. Record spawn locations
  let startTile: Point = { x: 15, y: 15 };
  if (rooms.length > 0) {
    const r = rooms[0];
    startTile = { x: Math.floor(r.x + r.w / 2), y: Math.floor(r.y + r.h / 2) };
  }

  const safeRooms: SafeRoomData[] = rooms
    .filter((r) => r.role === 'safe')
    .map((sr) => ({
      bounds: { x: sr.x, y: sr.y, w: sr.w, h: sr.h },
      centre: { x: Math.floor(sr.x + sr.w / 2), y: Math.floor(sr.y + sr.h / 2) },
      guardsBossType: sr.guardsBossType,
    }));
  antechamberSafeRoom = safeRooms.find((r) => r.guardsBossType === ARENA_BOSS_TYPE) ?? null;

  for (const safeRoom of safeRooms) stampSafeRoomThresholds(grid, safeRoom);

  const bossRooms: Array<{ bounds: Rect; centre: Point }> = rooms
    .filter((r) => r.role === 'boss')
    .map((br) => ({
      bounds: { x: br.x, y: br.y, w: br.w, h: br.h },
      centre: { x: Math.floor(br.x + br.w / 2), y: Math.floor(br.y + br.h / 2) },
    }));

  const questRooms: QuestRoomData[] = [];
  const questRoom = rooms.find((r) => r.role === 'quest');
  if (questRoom !== undefined) {
    const qr = questRoom;
    const qcx = Math.floor(qr.x + qr.w / 2);
    const qcy = Math.floor(qr.y + qr.h / 2);
    const grateTiles: Point[] = [
      { x: qr.x + 2, y: qcy - 2 },
      { x: qr.x + 2, y: qcy + 2 },
      { x: qr.x + qr.w - QUEST_GRATE_WALL_OFFSET, y: qcy - 2 },
      { x: qr.x + qr.w - QUEST_GRATE_WALL_OFFSET, y: qcy + 2 },
    ];
    for (const g of grateTiles) {
      if (g.y >= 0 && g.y < size && g.x >= 0 && g.x < size) {
        grid[g.y][g.x].type = FLOOR_GRATE;
      }
    }
    questRooms.push({
      bounds: { x: qr.x, y: qr.y, w: qr.w, h: qr.h },
      centre: { x: qcx, y: qcy },
      grateTiles,
      entranceTile: { x: qcx, y: qr.y + qr.h - 1 },
      npcTile: { x: qcx, y: qcy },
      woodPileTile: { x: qr.x + 1, y: qr.y + 1 },
    });
  }

  // Spider lab room data
  let spiderLabRoom: SpiderLabRoomData | null = null;
  const spiderLabIdx = rooms.findIndex((r) => r.role === 'spider_lab');
  if (spiderLabIdx >= 0) {
    const slr = rooms[spiderLabIdx];
    const slcx = Math.floor(slr.x + slr.w / 2);
    const slcy = Math.floor(slr.y + slr.h / 2);

    // The scientist and computer go near the way in, and the egg and life
    // machines as far from it as the room allows, so the layout has to know
    // which wall the corridor actually broke through.
    const entrance = detectRoomEntrance(grid, { x: slr.x, y: slr.y, w: slr.w, h: slr.h });
    const entranceWall = entrance.wall;

    const entranceTile = entrance.tile;
    let scientistTile: Point;
    let computerTile: Point;
    let spiderEggTile: Point;
    let lifeMachineTiles: Point[];

    if (entranceWall === 'south') {
      scientistTile = { x: slcx - 1, y: slr.y + slr.h - LAB_WALL_OFFSET };
      computerTile = { x: slcx + 2, y: slr.y + slr.h - LAB_EGG_NEAR_WALL };
      spiderEggTile = { x: slcx, y: slr.y + LAB_EGG_NEAR_WALL };
      lifeMachineTiles = [
        { x: slr.x + 2, y: slr.y + 2 },
        { x: slr.x + slr.w - LAB_WALL_OFFSET, y: slr.y + 2 },
        { x: slcx - LAB_MACHINE_SPREAD, y: slr.y + LAB_MACHINE_NS_NEAR_ROW },
        { x: slcx + LAB_MACHINE_SPREAD, y: slr.y + LAB_MACHINE_NS_NEAR_ROW },
        { x: slr.x + 2, y: slr.y + LAB_MACHINE_NS_FAR_ROW },
        { x: slr.x + slr.w - LAB_WALL_OFFSET, y: slr.y + LAB_MACHINE_NS_FAR_ROW },
      ];
    } else if (entranceWall === 'north') {
      scientistTile = { x: slcx - 1, y: slr.y + 2 };
      computerTile = { x: slcx + 2, y: slr.y + LAB_WALL_OFFSET };
      spiderEggTile = { x: slcx, y: slr.y + slr.h - LAB_EGG_FAR_WALL };
      lifeMachineTiles = [
        { x: slr.x + 2, y: slr.y + slr.h - LAB_WALL_OFFSET },
        { x: slr.x + slr.w - LAB_WALL_OFFSET, y: slr.y + slr.h - LAB_WALL_OFFSET },
        { x: slcx - LAB_MACHINE_SPREAD, y: slr.y + slr.h - LAB_MACHINE_NS_NEAR_FROM_FAR },
        { x: slcx + LAB_MACHINE_SPREAD, y: slr.y + slr.h - LAB_MACHINE_NS_NEAR_FROM_FAR },
        { x: slr.x + 2, y: slr.y + slr.h - LAB_MACHINE_NS_FAR_FROM_FAR },
        { x: slr.x + slr.w - LAB_WALL_OFFSET, y: slr.y + slr.h - LAB_MACHINE_NS_FAR_FROM_FAR },
      ];
    } else if (entranceWall === 'east') {
      scientistTile = { x: slr.x + slr.w - LAB_WALL_OFFSET, y: slcy - 1 };
      computerTile = { x: slr.x + slr.w - LAB_EGG_FAR_WALL, y: slcy + 2 };
      spiderEggTile = { x: slr.x + LAB_EGG_NEAR_WALL, y: slcy };
      lifeMachineTiles = [
        { x: slr.x + 2, y: slr.y + 2 },
        { x: slr.x + 2, y: slr.y + slr.h - LAB_WALL_OFFSET },
        { x: slr.x + LAB_MACHINE_NS_NEAR_FROM_FAR, y: slcy - LAB_MACHINE_SPREAD },
        { x: slr.x + LAB_MACHINE_NS_NEAR_FROM_FAR, y: slcy + LAB_MACHINE_SPREAD },
        { x: slr.x + LAB_MACHINE_EW_FAR_COL, y: slr.y + 2 },
        { x: slr.x + LAB_MACHINE_EW_FAR_COL, y: slr.y + slr.h - LAB_WALL_OFFSET },
      ];
    } else {
      // west
      scientistTile = { x: slr.x + 2, y: slcy - 1 };
      computerTile = { x: slr.x + LAB_EGG_NEAR_WALL, y: slcy + 2 };
      spiderEggTile = { x: slr.x + slr.w - LAB_EGG_FAR_WALL, y: slcy };
      lifeMachineTiles = [
        { x: slr.x + slr.w - LAB_WALL_OFFSET, y: slr.y + 2 },
        { x: slr.x + slr.w - LAB_WALL_OFFSET, y: slr.y + slr.h - LAB_WALL_OFFSET },
        { x: slr.x + slr.w - LAB_MACHINE_EW_NEAR_FROM_FAR, y: slcy - LAB_MACHINE_SPREAD },
        { x: slr.x + slr.w - LAB_MACHINE_EW_NEAR_FROM_FAR, y: slcy + LAB_MACHINE_SPREAD },
        { x: slr.x + slr.w - LAB_MACHINE_EW_FAR_FROM_FAR, y: slr.y + 2 },
        { x: slr.x + slr.w - LAB_MACHINE_EW_FAR_FROM_FAR, y: slr.y + slr.h - LAB_WALL_OFFSET },
      ];
    }

    spiderLabRoom = {
      bounds: { x: slr.x, y: slr.y, w: slr.w, h: slr.h },
      centre: { x: slcx, y: slcy },
      entranceTile,
      scientistTile,
      computerTile,
      spiderEggTile,
      lifeMachineTiles,
    };
  }

  // 7. Stairwells
  const regularRooms = regularRoomIndices.map((i) => rooms[i]);
  const stairwellTiles: Point[] = [];
  const stairwellCount =
    numStairwellsOverride ?? Math.max(1, Math.floor(regularRooms.length / ROOMS_PER_STAIRWELL));

  if (progression !== undefined && lastGatewayBossRoom !== null) {
    // A stairwell must never be in sight of the last boss room's exit, and two
    // stairwells must never be found in the same sweep of the free region — the
    // hunt for the stairs is the point of the post-gauntlet stretch.
    const exitBounds = lastGatewayBossRoom;
    const byDistanceFromExit = regularRooms
      .map((r) => ({ x: Math.floor(r.x + r.w / 2), y: Math.floor(r.y + r.h / 2) }))
      .sort((a, b) => distanceToRect(b, exitBounds) - distanceToRect(a, exitBounds));
    const candidates = byDistanceFromExit.filter(
      (centre) => distanceToRect(centre, exitBounds) >= STAIRWELL_MIN_DIST_FROM_GAUNTLET_EXIT,
    );
    for (const candidate of candidates) {
      if (stairwellTiles.length >= stairwellCount) break;
      const clearOfOthers = stairwellTiles.every(
        (other) =>
          Math.hypot(candidate.x - other.x, candidate.y - other.y) >= STAIRWELL_MIN_SEPARATION,
      );
      if (clearOfOthers) stairwellTiles.push(candidate);
    }
    // A floor with no way down is unplayable, so the spacing rules yield rather
    // than the stairs: the farthest free room takes one even when it sits closer
    // to the boss's exit than the rule would like. The validator is told, so it
    // waives the distance rule instead of rejecting a floor that is merely
    // unlucky.
    if (stairwellTiles.length === 0 && byDistanceFromExit.length > 0) {
      stairwellTiles.push(byDistanceFromExit[0]);
      if (progressionLayout !== undefined) progressionLayout.stairwellSpacingWaived = true;
    }
  } else if (rooms.length > 0) {
    const MIN_STAIRWELL_DIST = 20;
    const farRooms = regularRooms.filter((r) => {
      const rc = { x: Math.floor(r.x + r.w / 2), y: Math.floor(r.y + r.h / 2) };
      return Math.hypot(rc.x - sc.x, rc.y - sc.y) >= MIN_STAIRWELL_DIST;
    });
    farRooms.sort((a, b) => {
      const da = Math.hypot(Math.floor(a.x + a.w / 2) - sc.x, Math.floor(a.y + a.h / 2) - sc.y);
      const db = Math.hypot(Math.floor(b.x + b.w / 2) - sc.x, Math.floor(b.y + b.h / 2) - sc.y);
      return db - da;
    });
    const step = Math.max(1, Math.floor(farRooms.length / stairwellCount));
    for (let i = 0; i < stairwellCount; i++) {
      const r = farRooms[i * step];
      stairwellTiles.push({
        x: Math.floor(r.x + r.w / 2),
        y: Math.floor(r.y + r.h / 2),
      });
    }
  }

  const stairwellBlockedSet = new Set<string>();
  for (const s of stairwellTiles) {
    for (let dy = 0; dy <= 1; dy++) {
      for (let dx = 0; dx <= 1; dx++) {
        stairwellBlockedSet.add(`${s.x + dx},${s.y + dy}`);
      }
    }
  }

  // ── Room decorations ──────────────────────────────────────────────────────

  for (let ordinal = 0; ordinal < populatedRoomIndices.length; ordinal++) {
    const i = populatedRoomIndices[ordinal];
    const r = rooms[i];
    const roomCentre: Point = {
      x: Math.floor(r.x + r.w / 2),
      y: Math.floor(r.y + r.h / 2),
    };
    const zone = getZone(roomCentre, sc);

    // Torches always in 2 diagonally-opposite corners
    const corners =
      i % 2 === 0
        ? [
            { x: r.x + 1, y: r.y + 1 },
            { x: r.x + r.w - 2, y: r.y + r.h - 2 },
          ]
        : [
            { x: r.x + r.w - 2, y: r.y + 1 },
            { x: r.x + 1, y: r.y + r.h - 2 },
          ];
    for (const c of corners) {
      if (grid[c.y]?.[c.x]?.type === r.floor && !stairwellBlockedSet.has(`${c.x},${c.y}`)) {
        placeProp(grid[c.y][c.x], TORCH);
      }
    }

    // Large rooms get barrel pillars that create lanes and break up open space.
    // Placed near inner corners, 3 tiles from each wall.
    if (r.w >= PILLAR_MIN_ROOM_W && r.h >= PILLAR_MIN_ROOM_H) {
      const pillarPositions = [
        { x: r.x + DECO_INNER_OFFSET, y: r.y + DECO_INNER_OFFSET },
        { x: r.x + r.w - DECO_NEAR_FAR_OFFSET, y: r.y + DECO_INNER_OFFSET },
      ];
      for (const p of pillarPositions) {
        if (grid[p.y]?.[p.x]?.type === r.floor && !stairwellBlockedSet.has(`${p.x},${p.y}`)) {
          placeProp(grid[p.y][p.x], BARREL);
        }
      }
    }

    // Vignette chance scales with zone depth
    const useVignette = Math.random() < VIGNETTE_CHANCE[zone];
    if (useVignette) {
      const vignette = pickVignette(zone, r);
      if (vignette !== null) {
        stampVignette(grid, r, vignette, size, stairwellBlockedSet);
        continue;
      }
    }

    // ── Cycle-based decoration (zone-aware) ──────────────────────────────
    const cycleLen = zone === 'entrance' ? ENTRANCE_CYCLE_LEN : STANDARD_CYCLE_LEN;
    const cycle = ordinal % cycleLen;

    if (cycle === 0 && r.w >= CYCLE0_MIN_W) {
      const positions = [
        { x: r.x + 2, y: r.y + 1 },
        { x: r.x + r.w - DECO_INNER_OFFSET, y: r.y + 1 },
      ];
      if (zone !== 'entrance' && r.w >= CYCLE0_EXTRA_BARREL_MIN_W)
        positions.push({ x: r.x + CYCLE0_EXTRA_BARREL_DX, y: r.y + 1 });
      for (const p of positions) {
        if (grid[p.y]?.[p.x]?.type === r.floor && !stairwellBlockedSet.has(`${p.x},${p.y}`))
          placeProp(grid[p.y][p.x], BARREL);
      }
    }

    if (cycle === 1 && r.w >= CYCLE1_MIN_W) {
      const positions = [
        { x: r.x + 2, y: r.y + r.h - 2 },
        { x: r.x + r.w - DECO_INNER_OFFSET, y: r.y + r.h - 2 },
      ];
      for (const p of positions) {
        if (grid[p.y]?.[p.x]?.type === r.floor && !stairwellBlockedSet.has(`${p.x},${p.y}`))
          placeProp(grid[p.y][p.x], BARREL_SIDE);
      }
      if (zone !== 'entrance') {
        const bp = { x: r.x + 2, y: r.y + r.h - DECO_INNER_OFFSET };
        if (grid[bp.y]?.[bp.x]?.type === r.floor && !stairwellBlockedSet.has(`${bp.x},${bp.y}`))
          placeProp(grid[bp.y][bp.x], BONES);
      }
    }

    if (cycle === 2) {
      const cx2 = i % 2 === 0 ? r.x + r.w - 2 : r.x + 1;
      const cy2 = r.y + 1;
      if (grid[cy2]?.[cx2]?.type === r.floor && !stairwellBlockedSet.has(`${cx2},${cy2}`))
        placeProp(grid[cy2][cx2], CRATE);
      const cx3 = cx2 + (i % 2 === 0 ? -1 : 1);
      if (grid[cy2]?.[cx3]?.type === r.floor && !stairwellBlockedSet.has(`${cx3},${cy2}`))
        placeProp(grid[cy2][cx3], CRATE);
    }

    if (cycle === DECO_CYCLE_BRAZIER && r.w >= CYCLE3_MIN_SIZE && r.h >= CYCLE3_MIN_SIZE) {
      const bx = Math.floor(r.x + r.w / 2);
      const by = Math.floor(r.y + r.h / 2);
      if (grid[by]?.[bx]?.type === r.floor && !stairwellBlockedSet.has(`${bx},${by}`))
        placeProp(grid[by][bx], BRAZIER);
      if (zone === 'deep') {
        const ring = [
          { x: bx - 1, y: by },
          { x: bx + 1, y: by },
          { x: bx, y: by - 1 },
          { x: bx, y: by + 1 },
        ];
        for (const p of ring) {
          if (grid[p.y]?.[p.x]?.type === r.floor && !stairwellBlockedSet.has(`${p.x},${p.y}`))
            placeProp(grid[p.y][p.x], BONES);
        }
      }
    }

    if (cycle === DECO_CYCLE_CORNER_MIX && r.w >= CYCLE4_MIN_W) {
      const positions: Array<{ x: number; y: number; type: number }> = [
        { x: r.x + 1, y: r.y + 1, type: BARREL },
        { x: r.x + 2, y: r.y + 1, type: CRATE },
        { x: r.x + r.w - 2, y: r.y + 1, type: CRATE },
      ];
      for (const p of positions) {
        if (grid[p.y]?.[p.x]?.type === r.floor && !stairwellBlockedSet.has(`${p.x},${p.y}`))
          placeProp(grid[p.y][p.x], p.type);
      }
    }

    if (cycle === DECO_CYCLE_BONES) {
      const boneCount = zone === 'deep' ? CYCLE5_DEEP_BONE_COUNT : CYCLE5_BONE_COUNT;
      const spots = [
        { x: r.x + 2, y: r.y + 2 },
        { x: r.x + r.w - DECO_INNER_OFFSET, y: r.y + 2 },
        { x: r.x + 2, y: r.y + r.h - DECO_INNER_OFFSET },
        { x: r.x + r.w - DECO_INNER_OFFSET, y: r.y + r.h - DECO_INNER_OFFSET },
      ].slice(0, boneCount);
      for (const p of spots) {
        if (grid[p.y]?.[p.x]?.type === r.floor && !stairwellBlockedSet.has(`${p.x},${p.y}`))
          placeProp(grid[p.y][p.x], BONES);
      }
    }

    if (cycle === DECO_CYCLE_SHELVES && r.w >= CYCLE6_MIN_W) {
      const shelfY = r.y + 1;
      for (let sx = r.x + 2; sx <= r.x + CYCLE6_SHELF_DX_END && sx < r.x + r.w - 2; sx++) {
        if (grid[shelfY]?.[sx]?.type === r.floor && !stairwellBlockedSet.has(`${sx},${shelfY}`))
          placeProp(grid[shelfY][sx], BOOKSHELF);
      }
    }

    if (cycle === DECO_CYCLE_CLUSTER) {
      const clusters: Array<Array<{ x: number; y: number; type: number }>> = [
        [
          { x: r.x + 1, y: r.y + r.h - 2, type: BARREL_SIDE },
          { x: r.x + 2, y: r.y + r.h - 2, type: CRATE },
        ],
        [
          { x: r.x + r.w - 2, y: r.y + 1, type: BARREL },
          { x: r.x + r.w - DECO_INNER_OFFSET, y: r.y + 1, type: BARREL_SIDE },
        ],
      ];
      for (const cluster of clusters) {
        for (const p of cluster) {
          if (grid[p.y]?.[p.x]?.type === r.floor && !stairwellBlockedSet.has(`${p.x},${p.y}`))
            placeProp(grid[p.y][p.x], p.type);
        }
      }
    }
  }

  // 9. Mob spawn points
  const mobSpawnPoints = populatedRoomIndices
    .map((i) => rooms[i])
    .map((r) => ({
      x: Math.floor(r.x + r.w / 2),
      y: Math.floor(r.y + r.h / 2),
      w: r.w,
      h: r.h,
    }));

  // Select treasure rooms from eligible regular rooms — 5% of total rooms, at least 1
  const MIN_ROOM_SIZE = 7;
  const treasureRoomTarget = Math.max(1, Math.round(regularRooms.length * TREASURE_ROOM_RATIO));

  const eligibleRegularRooms = regularRooms.filter(
    (r) => r.w >= MIN_ROOM_SIZE && r.h >= MIN_ROOM_SIZE,
  );
  // Fisher-Yates shuffle for a uniform distribution
  const shuffledEligible = [...eligibleRegularRooms];
  for (let i = shuffledEligible.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffledEligible[i], shuffledEligible[j]] = [shuffledEligible[j], shuffledEligible[i]];
  }
  const selectedTreasureRooms = shuffledEligible.slice(0, treasureRoomTarget);

  const treasureRooms: TreasureRoomData[] = selectedTreasureRooms.map((r) => {
    const cx = Math.floor(r.x + r.w / 2);
    const cy = Math.floor(r.y + r.h / 2);
    // Clear the chest tile so decorations stamped earlier don't overlap the chest.
    grid[cy][cx].type = r.floor;
    return {
      bounds: { x: r.x, y: r.y, w: r.w, h: r.h },
      centre: { x: cx, y: cy },
    };
  });

  // 10. Rat spawn points in hallway tiles
  const maxHallwaySpawns = Math.round(HALLWAY_SPAWNS_SCALE * (size / SIZE_SCALE_BASE) ** 2);
  const roomCenters = rooms.map((r) => ({
    x: Math.floor(r.x + r.w / 2),
    y: Math.floor(r.y + r.h / 2),
  }));
  const MIN_FROM_ROOM = 5;
  const nearRoomSet = new Set<number>();
  for (const centre of roomCenters) {
    for (let dy = -MIN_FROM_ROOM; dy <= MIN_FROM_ROOM; dy++) {
      for (let dx = -MIN_FROM_ROOM; dx <= MIN_FROM_ROOM; dx++) {
        if (Math.hypot(dx, dy) <= MIN_FROM_ROOM) {
          nearRoomSet.add((centre.y + dy) * size + (centre.x + dx));
        }
      }
    }
  }
  const validHallway = hallwayTiles.filter((t) => !nearRoomSet.has(t.y * size + t.x));
  for (let i = validHallway.length - 1; i > 0; i--) {
    const j = randomInt(0, i);
    [validHallway[i], validHallway[j]] = [validHallway[j], validHallway[i]];
  }
  const chosen: Array<{ x: number; y: number }> = [];
  for (const t of validHallway) {
    if (chosen.length >= maxHallwaySpawns) break;
    if (chosen.every((c) => Math.hypot(t.x - c.x, t.y - c.y) >= HALLWAY_SPAWN_MIN_GAP))
      chosen.push(t);
  }
  const hallwaySpawnPoints = chosen;

  // 11. Arena
  const buildingEntries: Array<{ doorTile: Point; name: string; type: 'arena' }> = [];
  const arenaExteriors: ArenaExterior[] = [];

  /** Carves the arena structure at a chosen centre and records its exterior. */
  const carveArena = (acx: number, acy: number, carveOuterRing: boolean): void => {
    for (let dy = -ARENA_RADIUS; dy <= ARENA_RADIUS; dy++) {
      for (let dx = -ARENA_RADIUS; dx <= ARENA_RADIUS; dx++) {
        const rad = Math.hypot(dx, dy);
        if (rad <= ARENA_RADIUS) {
          const gx = acx + dx;
          const gy = acy + dy;
          if (gy >= 0 && gy < size && gx >= 0 && gx < size) {
            grid[gy][gx].type =
              rad > ARENA_RADIUS - ARENA_WALL_THICKNESS ? METAL_WALL : ARENA_FLOOR;
          }
        }
      }
    }

    const doorY = acy + ARENA_RADIUS;
    const doorX = acx;
    for (let wy = 0; wy < ARENA_WALL_THICKNESS; wy++) {
      const ty = doorY - wy;
      if (ty >= 0 && ty < size) {
        grid[ty][doorX - 1].type = FloorTypeValue.concrete;
        grid[ty][doorX].type = FloorTypeValue.concrete;
      }
    }

    // A 2-tile walkable ring just outside the wall stops the arena from severing
    // corridors it was dropped on top of. A progression floor has no such
    // corridors to save — the arena is sited on reserved rock — and carving the
    // ring there would either hand the player a walk straight to the door,
    // bypassing the antechamber, or leave a band of floor nothing can reach.
    if (carveOuterRing) {
      for (
        let ry = -(ARENA_RADIUS + ARENA_RING_WIDTH);
        ry <= ARENA_RADIUS + ARENA_RING_WIDTH;
        ry++
      ) {
        for (
          let rx = -(ARENA_RADIUS + ARENA_RING_WIDTH);
          rx <= ARENA_RADIUS + ARENA_RING_WIDTH;
          rx++
        ) {
          const rad = Math.hypot(rx, ry);
          if (rad <= ARENA_RADIUS || rad > ARENA_RADIUS + ARENA_RING_WIDTH) continue;
          const gx = acx + rx;
          const gy = acy + ry;
          if (gy < 0 || gy >= size || gx < 0 || gx >= size) continue;
          grid[gy][gx].type = FloorTypeValue.concrete;
        }
      }
    }

    buildingEntries.push({
      doorTile: { x: doorX, y: doorY },
      name: 'The Iron Colosseum',
      type: 'arena',
    });
    arenaExteriors.push({
      centre: { x: acx, y: acy },
      radius: ARENA_RADIUS,
      doorTile: { x: doorX, y: doorY },
      stairwellTile: { x: acx - 1, y: acy - 1 },
    });
  };

  if (arenaReservation !== null) {
    carveArena(arenaReservation.centre.x, arenaReservation.centre.y, false);
    // The antechamber's arena-side doorway only exists now that the door is cut,
    // so its traffic band has to be laid after the arena rather than with the
    // other safe rooms.
    if (antechamberSafeRoom !== null) stampSafeRoomThresholds(grid, antechamberSafeRoom);
  } else if (hasArena && rooms.length > 0) {
    const startCentre = sc;
    let arenaPlaced = false;

    for (let attempt = 0; attempt < ARENA_PLACEMENT_ATTEMPTS && !arenaPlaced; attempt++) {
      const angle =
        (attempt / ARENA_PLACEMENT_ATTEMPTS) * Math.PI * 2 + Math.random() * ARENA_ANGLE_JITTER;
      const dist = ARENA_MIN_DIST + Math.random() * ARENA_DIST_VARIANCE;
      const acx = Math.round(startCentre.x + Math.cos(angle) * dist);
      const acy = Math.round(startCentre.y + Math.sin(angle) * dist);

      if (
        acx - ARENA_RADIUS - ARENA_CLEARANCE < BORDER ||
        acx + ARENA_RADIUS + ARENA_CLEARANCE >= size - BORDER ||
        acy - ARENA_RADIUS - ARENA_CLEARANCE < BORDER ||
        acy + ARENA_RADIUS + ARENA_CLEARANCE >= size - BORDER
      )
        continue;

      const overlapsSpecial = rooms.some((r) => {
        if (!isSpecialRoom(r)) return false;
        const closestX = clamp(acx, r.x, r.x + r.w - 1);
        const closestY = clamp(acy, r.y, r.y + r.h - 1);
        return Math.hypot(acx - closestX, acy - closestY) < ARENA_RADIUS + ARENA_CLEARANCE;
      });
      if (overlapsSpecial) continue;

      carveArena(acx, acy, true);

      const doorY = acy + ARENA_RADIUS;
      const doorX = acx;
      const nearestRoom = rooms.reduce((best, r) => {
        const rcx = Math.floor(r.x + r.w / 2);
        const rcy = Math.floor(r.y + r.h / 2);
        const d = Math.hypot(acx - rcx, acy - rcy);
        const bd = Math.hypot(
          acx - Math.floor(best.x + best.w / 2),
          acy - Math.floor(best.y + best.h / 2),
        );
        return d < bd ? r : best;
      }, rooms[0]);

      if (doorY + 1 < size) {
        grid[doorY + 1][doorX - 1].type = FloorTypeValue.concrete;
        grid[doorY + 1][doorX].type = FloorTypeValue.concrete;
      }

      const pivotX = Math.min(acx + ARENA_RADIUS + ARENA_RING_WIDTH, size - BORDER - 1);
      const pivotY = doorY + 1;
      carveHallway(doorX, pivotY, pivotX, pivotY, 'standard', FloorTypeValue.concrete);
      carveHallway(
        pivotX,
        pivotY,
        Math.floor(nearestRoom.x + nearestRoom.w / 2),
        Math.floor(nearestRoom.y + nearestRoom.h / 2),
        'standard',
        FloorTypeValue.concrete,
      );

      arenaPlaced = true;
    }
  }

  const filteredMobSpawns =
    arenaExteriors.length > 0
      ? mobSpawnPoints.filter((p) => {
          const a = arenaExteriors[0];
          return Math.hypot(p.x - a.centre.x, p.y - a.centre.y) > ARENA_RADIUS + 2;
        })
      : mobSpawnPoints;

  const filteredStairwells =
    arenaExteriors.length > 0
      ? stairwellTiles.filter((p) => {
          const a = arenaExteriors[0];
          return Math.hypot(p.x - a.centre.x, p.y - a.centre.y) > ARENA_RADIUS + 2;
        })
      : stairwellTiles;

  return {
    grid,
    startTile,
    safeRooms,
    bossRooms,
    questRooms,
    treasureRooms,
    spiderLabRoom,
    mobSpawnPoints: filteredMobSpawns,
    hallwaySpawnPoints,
    stairwellTiles: filteredStairwells,
    buildingEntries,
    arenaExteriors,
    arenaDoorTile: arenaExteriors[0]?.doorTile,
    progressionLayout,
  };
}

/**
 * Generates a dungeon floor, retrying forced-progression layouts until one
 * satisfies every topology invariant.
 *
 * A progression floor is built from randomised geometry that can genuinely fail
 * to fit, so a rejected layout is normal; a floor that never fits is a bug in the
 * tuning constants and throws rather than shipping a map the player can walk
 * around the bosses in.
 */
export function generateDungeon(options: GenerateDungeonOptions): DungeonData {
  const rejections: string[] = [];
  if (options.progression === undefined) {
    const data = buildDungeon(options, 1, rejections);
    if (data === null) throw new Error('free-roam dungeon generation returned no map');
    return data;
  }

  const expectations = {
    mapSize: options.size,
    gauntletCount: options.progression.gauntlets.length,
    hasArena: options.hasArena ?? false,
  };
  let lastFailures: InvariantFailure[] = [];

  for (let attempt = 1; attempt <= MAX_MAP_ATTEMPTS; attempt++) {
    const data = buildDungeon(options, attempt, rejections);
    if (data === null) continue;
    const failures = validateProgression(data, expectations);
    if (failures.length === 0) return data;
    lastFailures = failures;
  }

  const detail =
    lastFailures.length > 0
      ? lastFailures.map((f) => `${f.id}: ${f.message}`).join('; ')
      : `no layout could be seated (rejected at: ${[...new Set(rejections)].join(', ')})`;
  throw new Error(
    `progression dungeon generation failed after ${MAX_MAP_ATTEMPTS} attempts — ${detail}`,
  );
}
