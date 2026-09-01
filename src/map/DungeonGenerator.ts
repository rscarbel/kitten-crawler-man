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
  ARENA_CAGE,
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
import { tileCoordKey } from './tileIndex';
import { isWalkableTileType } from './walkability';
import { mordecaiAndBedTiles } from './safeRoomFixtures';
import type { ProgressionDef } from '../levels/types';
import {
  ARENA_ANTECHAMBER_MIN_WIDTH,
  ARENA_CONCOURSE_REACH,
  ARENA_DOOR_COLUMN_OFFSETS,
  ARENA_GATE_COLUMN_OFFSETS,
  ARENA_CONCOURSE_LINK_INNER_DX,
  ARENA_CONCOURSE_LINK_OUTER_DX,
  ARENA_RADIUS,
  ARENA_REACH,
  ARENA_WALL_THICKNESS,
  arenaDoorTileAt,
  arenaGateBreachTiles,
  arenaGateTileAt,
  arenaReserveRect,
} from './arenaGeometry';
import {
  SegmentMap,
  SEGMENT_FREE,
  SEGMENT_ARENA,
  SEGMENT_BEYOND,
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
  gauntletSegmentCeiling,
  type ChokeSlot,
  type GauntletPlan,
  type PlannedCorridor,
} from './gauntletLayout';
import { planSpine, type SpinePlan, type SpinePocketRequest } from './spineLayout';
import {
  roomDoorways,
  detectRoomEntrance,
  ROOM_WALL_OUTWARD,
  type RoomDoorway,
  type RoomWall,
} from './roomDoorways';
import {
  validateProgression,
  distanceToRect,
  SCATTER_SAFE_ROOM_SEPARATION,
  STAIRWELL_MIN_SEPARATION,
  STAIRWELL_MIN_DIST_FROM_GAUNTLET_EXIT,
  STAIRWELL_MAX_DIST_FROM_GAUNTLET_EXIT,
  BEYOND_STAIRWELL_MIN_SEPARATION,
  type InvariantFailure,
  type ProgressionExpectations,
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
  /** Perimeter tile of the doorway the player arrives through. */
  entranceTile: Point;
  /**
   * Every perimeter tile of the room's onward doorways — every doorway but the
   * entrance.
   *
   * Open ground: the player walks through this room, and the wave is something
   * they can accept on the way past or ignore. The goblin mother bars these for
   * the length of an encounter the player chose to start, and nothing else ever
   * closes them.
   *
   * A list rather than one tile: a doorway can be three tiles wide, and a choke
   * seated as a branch fan's hub has one onward doorway per branch. Empty on a
   * floor where the quest room is an optional side room with nothing beyond it.
   */
  exitDoorTiles: Point[];
  npcTile: Point;
  woodPileTile: Point;
}

export interface TreasureRoomData {
  bounds: { x: number; y: number; w: number; h: number };
  centre: { x: number; y: number };
  /** Which progression region this room sits in. See {@link MobSpawnPoint.region}. */
  region: number;
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
 * What the defense quest's room gates, for the validator.
 *
 * Recorded rather than inferred because the grid alone cannot say whether a
 * quest room is a mandatory choke or an optional side room, and a gate that
 * cannot tell the two apart passes vacuously on a floor whose choke failed to
 * seat.
 */
export interface QuestChokeData {
  /**
   * How many gateway *boss rooms* the quest room sits after.
   *
   * Boss rooms rather than gateways as a whole, because the two halves of a
   * gateway hide different things: an approach choke sits behind its own
   * gateway's safe room and in front of that gateway's boss room. The invariant
   * that a gateway strands everything past it reads this together with
   * {@link blocks} to know which of its two flood fills the quest room belongs
   * to.
   */
  rank: number;
  /** Which gauntlet's rooms bracket the choke. Unused for a spine choke. */
  gauntletIndex: number;
  /** The landmark that must become unreachable once the quest room is removed. */
  blocks: 'gatewaySafeRoom' | 'gatewayBossRoom' | 'antechamber';
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
  /**
   * The stairwell tiles that were seated from the banded candidate pool, so the
   * validator knows which individual stairwells the distance ceiling governs.
   *
   * The ceiling exists to pull stairs off the perimeter of the free region, but
   * the band cannot always sustain a floor's whole requested set: floor 1 asks
   * for more stairwells than the ring can hold `STAIRWELL_MIN_SEPARATION` apart,
   * so the rest come from the widened pool, which guarantees only the minimum
   * distance. Recorded per tile rather than as one floor-wide flag because a
   * flag meaning "every stair came from the band" is false on exactly the floor
   * the band was built for, which leaves the ceiling enforcing nothing there.
   *
   * Keyed by tile rather than by index into `stairwellTiles`, which is filtered
   * after placement on an arena floor.
   */
  bandedStairwellTiles: Point[];
  /**
   * Every room the generator seated, in placement order.
   *
   * The validator needs it to build the carved map's room-adjacency graph, and
   * the graph is the only honest way to ask how many routes run between two
   * points: the grid on its own cannot say which stretch of floor is a room and
   * which is the corridor between two of them.
   */
  roomBounds: Rect[];
  /** Set when the floor seats the defense quest as a mandatory choke. */
  questChoke: QuestChokeData | null;
  /**
   * The forced chain past the last gateway boss, or null on a free-region floor.
   *
   * `chain` is in walking order and every one of its rooms is meant to be a cut
   * vertex; `lanes` are the alternate routes, each bridging `chain[forkIndex]`
   * and the room after it.
   */
  spine: { chain: Rect[]; lanes: Array<{ forkIndex: number; rooms: Rect[] }> } | null;
}

/**
 * Where one room's encounter is placed, and which stretch of the floor's forced
 * progression it belongs to.
 *
 * The region is what lets spawn counts climb through a run: the generator is the
 * only thing that knows a room was part of gauntlet 0 rather than of the
 * free-roam region past the last gateway boss, and by the time the spawner sees
 * a point that ownership is otherwise unrecoverable from the grid.
 */
export interface MobSpawnPoint extends Point {
  w: number;
  h: number;
  /**
   * Index of the gauntlet whose rooms this one is among, or
   * `gauntlets.length` for the free-roam region beyond the last of them. Always
   * 0 on a floor with no forced progression, which has a single region.
   */
  region: number;
}

/**
 * The choke slots to try for one gauntlet, most-preferred first.
 *
 * A gauntlet with no choke yields a single `undefined`, so the caller's retry
 * loop has exactly one pass either way.
 */
function chokeSlotsFor(
  gauntletIndex: number,
  carriesChoke: boolean,
): ReadonlyArray<ChokeSlot | undefined> {
  if (!carriesChoke) return [undefined];
  // The stem is the corridor out of the *previous* gauntlet's boss room, which
  // gauntlet 0 leaves from the start room instead — a choke there would gate the
  // floor before the player has walked anywhere.
  if (gauntletIndex === 0) return ['approach'];
  return Math.random() < EVEN_SLOT_CHANCE ? ['stem', 'approach'] : ['approach', 'stem'];
}

/** See {@link MobSpawnPoint.region}. */
function progressionRegionOf(room: Rect, layout: ProgressionLayoutData | undefined): number {
  if (layout === undefined) return 0;
  const { gauntletRoomBounds } = layout;
  for (let index = 0; index < gauntletRoomBounds.length; index++) {
    for (const bounds of gauntletRoomBounds[index]) {
      if (bounds.x === room.x && bounds.y === room.y) return index;
    }
  }
  return gauntletRoomBounds.length;
}

export interface DungeonData {
  grid: TileContent[][];
  startTile: Point;
  safeRooms: SafeRoomData[];
  bossRooms: Array<{ bounds: Rect; centre: Point }>;
  questRooms: QuestRoomData[];
  treasureRooms: TreasureRoomData[];
  spiderLabRoom: SpiderLabRoomData | null;
  mobSpawnPoints: MobSpawnPoint[];
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

/** How far inside a quest-room wall its two grates sit. */
const QUEST_GRATE_WALL_INSET = 2;
/** How far each of a wall's two grates sits from the room's midline, along the wall. */
const QUEST_GRATE_SPREAD = 3;
/** Grates the quest room carries, split evenly between two of its walls. */
const QUEST_GRATE_WALLS = 2;

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
/** How far inside his own doorway the scientist waits. */
const LAB_SCIENTIST_DOORWAY_DEPTH = 2;
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

/** Probability either choke slot is tried first, when both are available. */
const EVEN_SLOT_CHANCE = 0.5;

/**
 * Arena sitings tried on a spine floor before the map is thrown away.
 *
 * A spine that will not fit between this boss room and this arena is usually a
 * complaint about where the arena landed, not about the whole floor, so the
 * arena is re-sited first and only a run of failures costs a map attempt.
 */
const MAX_ARENA_ATTEMPTS = 6;
/** Serpentines tried per arena siting. Mirrors the per-branch attempt budget. */
const MAX_SPINE_ATTEMPTS = 10;
/**
 * Ordinary dead-end rooms hung off the spine, on top of the floor's safe rooms.
 * The treasure-room pass draws from these, so a floor with none would have its
 * chests only behind the arena.
 */
const SPINE_TREASURE_POCKETS = 5;
/** Chests a spine floor aims for, drawn from its pockets and its beyond rooms. */
const SPINE_TREASURE_ROOM_TARGET = 3;

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
/**
 * Ways out of the antechamber the generator aims for.
 *
 * A target rather than a requirement: the layout may only offer one, and a floor
 * rejected for not fitting three corridors around a reserved disc would be rejected
 * often. Only the first is mandatory.
 */
const ANTECHAMBER_EXIT_TARGET = 3;
/** Boss the arena's antechamber warns the player about. */
const ARENA_BOSS_TYPE = 'ball_of_swine';
/** Antechamber size range — a safe room, so it reuses the safe-room dimensions. */
/**
 * The antechamber has to reach out under both concourse links, so its width has a
 * hard floor rather than a taste-based one — see `ARENA_ANTECHAMBER_MIN_WIDTH`.
 */
const ANTECHAMBER_W_MIN = ARENA_ANTECHAMBER_MIN_WIDTH;
/** Slack above the floor, so every antechamber is not the same shape. */
const ANTECHAMBER_WIDTH_SLACK = 3;
const ANTECHAMBER_W_MAX = ARENA_ANTECHAMBER_MIN_WIDTH + ANTECHAMBER_WIDTH_SLACK;
const ANTECHAMBER_H_MIN = 8;
const ANTECHAMBER_H_MAX = 12;

/**
 * Rock the arena's reserve must keep clear to its north, beyond its own reserved
 * rect, so the beyond pocket always has somewhere to live. An arena sited too
 * close to the map's border scores zero instead of stranding the pocket.
 */
const BEYOND_HEADROOM_TILES = 22;
/** Rooms the beyond pocket aims to seat before it stops trying for more. */
const BEYOND_ROOM_TARGET = 6;
/** Below this many seated rooms, the pocket is rejected rather than shipped thin. */
const BEYOND_MIN_ROOMS = 3;
/** How far a beyond-pocket room may sit from the gate tile, keeping the pocket clustered behind the drum. */
const BEYOND_MAX_DIST_FROM_GATE = 60;
/**
 * Distance outside the arena a mob or stairwell must keep, so neither sits on the
 * concourse ring. One tile inside `ARENA_REACH`, so beyond-region stairwells —
 * which sit past the reserve edge — still clear it, if only by that one tile.
 */
const ARENA_STAIRWELL_EXCLUSION_TILES = ARENA_RADIUS + 2;

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

/**
 * How the first stairwell is chosen when nothing is seated yet.
 *
 * `random` suits a pool the distance ceiling governs: callers sort by distance
 * from the boss exit, so seeding from that end and then maximising isolation
 * reproduces the perimeter bias the ceiling exists to remove.
 *
 * `farthest` takes the head of that same sort — the candidate farthest from the
 * exit — for a pool no ceiling governs, where distance from the exit is the
 * geometry the floor was built around rather than a bias to be corrected.
 */
type StairwellSeedStrategy = 'random' | 'farthest';

/**
 * Seats up to `count` stairwells over a candidate pool by farthest-point
 * sampling: each addition goes to whichever candidate is currently most isolated
 * from the ones already seated, so the set spreads across the pool instead of
 * packing into whichever end the caller's sort happens to visit first.
 *
 * `alreadySeated` lets a caller widen the pool and carry on from a partial set
 * rather than start over, so a narrower first pool keeps the placements it won.
 *
 * @returns every seated tile, `alreadySeated` included. Fewer than `count` when
 * no remaining candidate sits at least `minSeparation` from everything seated.
 */
function seatStairwellsByIsolation(
  candidates: readonly Point[],
  count: number,
  minSeparation: number,
  seedStrategy: StairwellSeedStrategy,
  alreadySeated: readonly Point[] = [],
): Point[] {
  if (candidates.length === 0) return [...alreadySeated];
  const FARTHEST_CANDIDATE_INDEX = 0;
  const seedIndex =
    seedStrategy === 'random'
      ? Math.floor(Math.random() * candidates.length)
      : FARTHEST_CANDIDATE_INDEX;
  const seated: Point[] = alreadySeated.length > 0 ? [...alreadySeated] : [candidates[seedIndex]];
  while (seated.length < count) {
    let bestCandidate: Point | null = null;
    let bestIsolation = 0;
    for (const candidate of candidates) {
      let isolation = Infinity;
      for (const chosen of seated) {
        isolation = Math.min(isolation, Math.hypot(candidate.x - chosen.x, candidate.y - chosen.y));
      }
      if (isolation > bestIsolation) {
        bestIsolation = isolation;
        bestCandidate = candidate;
      }
    }
    if (bestCandidate === null || bestIsolation < minSeparation) break;
    seated.push(bestCandidate);
  }
  return seated;
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

/** A corridor's tiles as a lookup, keyed the way every other tile set in the game is. */
function corridorTileKeys(tiles: ReadonlyArray<Point>): Set<number> {
  return new Set(tiles.map((tile) => tileCoordKey(tile.x, tile.y)));
}

/**
 * Where the spider lab's scientist stands: a couple of tiles inside his own
 * doorway, clamped to the room's interior.
 *
 * Derived from the doorway rather than from the entrance wall's midpoint,
 * because a 40-tile-wide wall can have its corridor break through anywhere
 * along it — and a scientist standing at the far end of the same wall is not
 * visible from the corridor at all.
 */
function labScientistTile(entrance: { wall: RoomWall; tile: Point }, bounds: Rect): Point {
  const side = ROOM_WALL_OUTWARD.find((candidate) => candidate.wall === entrance.wall);
  const inwardX = side === undefined ? 0 : -side.dx;
  const inwardY = side === undefined ? 0 : -side.dy;
  return {
    x: clamp(
      entrance.tile.x + inwardX * LAB_SCIENTIST_DOORWAY_DEPTH,
      bounds.x + 1,
      bounds.x + bounds.w - 2,
    ),
    y: clamp(
      entrance.tile.y + inwardY * LAB_SCIENTIST_DOORWAY_DEPTH,
      bounds.y + 1,
      bounds.y + bounds.h - 2,
    ),
  };
}

/**
 * Where the quest room's four bugaboo grates go.
 *
 * The room is a pass-through with a doorway on two or more walls, so the old
 * fixed east/west columns could put a grate in the mouth of one. Walls with no
 * doorway are preferred, and the grates sit a fixed inset inside the wall and
 * spread either side of the room's midline, so nothing lands where a corridor
 * arrives and the goblin mother at the centre always has a clear approach.
 */
function questGrateTiles(bounds: Rect, doorways: ReadonlyArray<RoomDoorway>): Point[] {
  const doorwayWalls = new Set(doorways.map((doorway) => doorway.wall));
  const walls = ROOM_WALL_OUTWARD.map((side) => side.wall);
  const ranked = [
    ...walls.filter((wall) => !doorwayWalls.has(wall)),
    ...walls.filter((wall) => doorwayWalls.has(wall)),
  ].slice(0, QUEST_GRATE_WALLS);

  const centreX = Math.floor(bounds.x + bounds.w / 2);
  const centreY = Math.floor(bounds.y + bounds.h / 2);
  const lastX = bounds.x + bounds.w - 1;
  const lastY = bounds.y + bounds.h - 1;

  const tiles: Point[] = [];
  for (const wall of ranked) {
    for (const offset of [-QUEST_GRATE_SPREAD, QUEST_GRATE_SPREAD]) {
      if (wall === 'north')
        tiles.push({ x: centreX + offset, y: bounds.y + QUEST_GRATE_WALL_INSET });
      else if (wall === 'south')
        tiles.push({ x: centreX + offset, y: lastY - QUEST_GRATE_WALL_INSET });
      else if (wall === 'west')
        tiles.push({ x: bounds.x + QUEST_GRATE_WALL_INSET, y: centreY + offset });
      else tiles.push({ x: lastX - QUEST_GRATE_WALL_INSET, y: centreY + offset });
    }
  }
  return tiles;
}

// ── Main generator ────────────────────────────────────────────────────────────

/** Everything the generator needs except the map's side length. */
export interface DungeonLevelOptions {
  numBossRooms: number;
  numStairwellsOverride?: number;
  stairwellCountMultiplier?: number;
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

/** Spectator cages set into the arena's inner wall, evenly spaced around it. */
const ARENA_CAGE_COUNT = 14;
/** Radians of clearance kept between a cage and the door, so none blocks the way in. */
const ARENA_CAGE_DOOR_CLEARANCE = 0.35;
/** Half-turns added before a modulo, so a signed angle difference wraps positive. */
const ANGLE_WRAP_TURNS = 3;
/** Half of a band's thickness, for finding its middle row. */
const WALL_BAND_HALF = 0.5;

/**
 * Sets cages into the inner face of the arena wall.
 *
 * Placed by angle rather than by walking the wall tiles, so they stay evenly spread
 * however the rasterised circle happens to fall, and only ever written onto a tile
 * that is already `METAL_WALL` — the door and the concourse's own seal are both
 * live structure, and a cage dropped on either would either wall the fight in or
 * open a second way to it.
 */
function setArenaCages(
  grid: TileContent[][],
  size: number,
  centreX: number,
  centreY: number,
): void {
  // Mid-wall, so a cage reads as an alcove with wall on both sides of it rather than
  // as a hole in the inner or outer face.
  const wallBandMidpoint = (ARENA_WALL_THICKNESS - 1) * WALL_BAND_HALF;
  const wallRadius = ARENA_RADIUS - wallBandMidpoint;
  const doorAngle = Math.PI / 2;

  for (let i = 0; i < ARENA_CAGE_COUNT; i++) {
    const angle = (i / ARENA_CAGE_COUNT) * Math.PI * 2;
    // Angular distance to the door, wrapped, so the two cages nearest it are dropped.
    const toDoor = Math.abs(
      ((angle - doorAngle + Math.PI * ANGLE_WRAP_TURNS) % (Math.PI * 2)) - Math.PI,
    );
    if (toDoor < ARENA_CAGE_DOOR_CLEARANCE) continue;
    const gx = centreX + Math.round(Math.cos(angle) * wallRadius);
    const gy = centreY + Math.round(Math.sin(angle) * wallRadius);
    if (gy < 0 || gy >= size || gx < 0 || gx >= size) continue;
    if (grid[gy][gx].type !== METAL_WALL) continue;
    grid[gy][gx].type = ARENA_CAGE;
  }
}

/**
 * Walls off the concourse along the arena's door row, on both sides of the door.
 *
 * The door sits at the outer edge of the wall, so the concourse's own tiles run
 * along beside it — and a crawler standing on one could step sideways into the
 * arena without ever entering the antechamber, which is precisely the bypass the
 * outer ring used to be suppressed to avoid. Walling the row instead keeps the
 * ring and closes the bypass: the only tiles left touching the door from outside
 * belong to the safe room.
 *
 * The links carved next deliberately cut back through this seal further out; what
 * has to be sealed is the stretch *between* the door and those links.
 */
function sealConcourseAcrossDoorRow(
  grid: TileContent[][],
  size: number,
  centreX: number,
  doorY: number,
): void {
  if (doorY < 0 || doorY >= size) return;
  for (let dx = -ARENA_CONCOURSE_REACH; dx <= ARENA_CONCOURSE_REACH; dx++) {
    // The door's own columns are the way in and stay carved.
    if (ARENA_DOOR_COLUMN_OFFSETS.includes(dx)) continue;
    const radius = Math.hypot(dx, ARENA_RADIUS);
    if (radius <= ARENA_RADIUS || radius > ARENA_CONCOURSE_REACH) continue;
    const gx = centreX + dx;
    if (gx < 0 || gx >= size) continue;
    grid[doorY][gx].type = METAL_WALL;
  }
}

/**
 * Drops the concourse into the antechamber on both flanks.
 *
 * Two two-tile passages through the door row, far enough out that the seal above
 * still separates them from the door. They are what make the circuit a circuit: the
 * ring's western end comes down into the safe room, and its eastern end leaves
 * again on the other side.
 */
function linkConcourseToAntechamber(
  grid: TileContent[][],
  size: number,
  centreX: number,
  doorY: number,
  antechamber: Rect,
): void {
  for (const side of [-1, 1] as const) {
    for (const offset of [ARENA_CONCOURSE_LINK_INNER_DX, ARENA_CONCOURSE_LINK_OUTER_DX]) {
      const gx = centreX + side * offset;
      if (gx < antechamber.x || gx >= antechamber.x + antechamber.w) continue;
      if (gx < 0 || gx >= size || doorY < 0 || doorY >= size) continue;
      // Exactly the door row, which the seal has just walled: the concourse's last
      // row sits immediately above it and the antechamber's first immediately below,
      // so opening this one tile joins two stretches of floor that already exist.
      // Only ever a wall the seal put there — anywhere else and this would be
      // punching a hole in the arena.
      if (grid[doorY][gx].type !== METAL_WALL) continue;
      grid[doorY][gx].type = FloorTypeValue.concrete;
    }
  }
}

/**
 * Breaches the reserve margin at the arena's north point, joining the concourse
 * ring straight to the beyond pocket's landing room.
 *
 * Unlike the door, this never touches the metal wall band around the disc — the
 * gate only opens the rock reserved outside the ring, never the ring's own inner
 * boundary — so the drum stays enterable only through the south door.
 */
function carveArenaGate(
  grid: TileContent[][],
  size: number,
  centreX: number,
  centreY: number,
  landingRoom: Rect,
): void {
  for (const tile of arenaGateBreachTiles({ x: centreX, y: centreY }, landingRoom)) {
    if (tile.x < 0 || tile.x >= size || tile.y < 0 || tile.y >= size) continue;
    grid[tile.y][tile.x].type = FloorTypeValue.concrete;
  }
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

/**
 * The arena's footprint at a candidate centre, or null if it will not fit there.
 *
 * Split out from the search so the search can score candidates instead of taking
 * the first that fits.
 */
function planArenaAt(
  segments: SegmentMap,
  centre: Point,
  size: number,
  border: number,
): ArenaReservation | null {
  if (
    centre.x - ARENA_REACH < border ||
    centre.x + ARENA_REACH >= size - border ||
    centre.y - ARENA_REACH < border ||
    centre.y + ARENA_REACH >= size - border
  ) {
    return null;
  }

  const doorTile = arenaDoorTileAt(centre);
  const reserve = arenaReserveRect(centre);

  // The beyond pocket lives north of the reserve, so a candidate that would back
  // onto the map's border there is unusable even though the reserve itself fits —
  // scoring it zero here is what keeps `reserveArena` from ever picking it.
  if (reserve.y - BEYOND_HEADROOM_TILES < border) return null;

  const antechamberW = randomInt(ANTECHAMBER_W_MIN, ANTECHAMBER_W_MAX);
  const antechamberH = randomInt(ANTECHAMBER_H_MIN, ANTECHAMBER_H_MAX);
  const antechamber: Rect = {
    x: doorTile.x - Math.floor(antechamberW / 2),
    y: doorTile.y + 1,
    w: antechamberW,
    h: antechamberH,
  };

  if (!segments.canPlaceRoom(reserve, SEGMENT_ARENA)) return null;
  if (!segments.canPlaceRoom(antechamber, SEGMENT_ARENA)) return null;
  return { centre, doorTile, reserve, antechamber };
}

/**
 * How the arena's home is chosen among the legal candidates.
 *
 * `farthest` is the free-region floor's rule: the arena is meant to sit at the
 * far end of the floor's paths, and on a loopy region distance from the last
 * boss's exit is the only thing that puts it there.
 *
 * `varied` is the spine floor's. There the walk is what makes the arena distant
 * — a dozen forced rooms of winding — so distance buys nothing, and taking the
 * farthest fit every time makes the siting effectively deterministic: a spine
 * that will not thread between this boss room and that arena would be retried
 * against the same arena until the map is thrown away.
 */
type ArenaSiting = 'farthest' | 'varied';

function reserveArena(
  segments: SegmentMap,
  origin: Point,
  size: number,
  border: number,
  siting: ArenaSiting,
): ArenaReservation | null {
  // Scored rather than first-fit: the arena is meant to sit at the far end of the
  // floor's paths, the way the Juicer does on floor 1, and taking the first legal
  // spiral step put it wherever the search happened to look first — sometimes a
  // couple of rooms past the gauntlet exit, where a crawler trips over it on the way
  // out. Distance from that exit is the score, and the whole attempt budget is spent
  // looking for the furthest one that fits.
  let best: ArenaReservation | null = null;
  let bestDistance = -1;
  const legal: ArenaReservation[] = [];

  for (let attempt = 0; attempt < ARENA_PLACEMENT_ATTEMPTS; attempt++) {
    const angle =
      (attempt / ARENA_PLACEMENT_ATTEMPTS) * Math.PI * 2 + Math.random() * ARENA_ANGLE_JITTER;
    const distance = ARENA_MIN_DIST_FROM_GAUNTLET_EXIT + Math.random() * ARENA_DIST_VARIANCE;
    if (siting === 'farthest' && distance <= bestDistance) continue;
    const centre: Point = {
      x: Math.round(origin.x + Math.cos(angle) * distance),
      y: Math.round(origin.y + Math.sin(angle) * distance),
    };

    const plan = planArenaAt(segments, centre, size, border);
    if (plan === null) continue;
    if (siting === 'varied') {
      legal.push(plan);
      continue;
    }
    best = plan;
    bestDistance = distance;
  }

  if (siting === 'varied' && legal.length > 0) best = randomFromArray(legal);
  if (best === null) return null;
  segments.addRoom(best.reserve, SEGMENT_ARENA);
  segments.addRoom(best.antechamber, SEGMENT_ARENA);
  return best;
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
    stairwellCountMultiplier = 1,
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
  /**
   * Tiles of the corridor the player arrives at the quest room through, which is
   * what tells the doorway scan which of the room's doorways is the way in and
   * which are the ways onward. Null on a floor where the quest room is an
   * optional side room rather than a choke.
   *
   * The corridor rather than the previous room's position: a corridor's L can
   * bend either way, so the doorway nearest the room the player came from is
   * routinely not the doorway they come through — and treating that one as a
   * way onward hands the goblin mother the way in to bar.
   */
  let questChokeEntryTiles: Set<number> | null = null;
  let questChokeData: QuestChokeData | null = null;
  let arenaReservation: ArenaReservation | null = null;
  let antechamberSafeRoom: SafeRoomData | null = null;
  /** Indices into `rooms` of the beyond pocket, index 0 always the landing room. */
  const beyondRoomIndices: number[] = [];

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

    // One nursery per floor. Both the gauntlet flag and a spine seat a quest
    // room, but the generator carries a single `questChoke` and finds the room
    // with a single `role === 'quest'` lookup — so a second request would pair
    // the first room with the second choke's entry corridor, leave it with no
    // identifiable way in, and fail every map until the attempt budget threw.
    // Better to say so at the source than to fail forty layouts describing it.
    const chokeRequests =
      progression.gauntlets.filter((gauntlet) => gauntlet.questChoke === true).length +
      (progression.spine === undefined ? 0 : 1);
    if (chokeRequests > 1) {
      throw new Error(
        `a floor may seat one defense-quest choke; this one asks for ${chokeRequests}`,
      );
    }

    const gauntletRoomBounds: Rect[][] = [];
    const branchRoomCounts: number[][] = [];
    let entryRoom = startRoom;
    let previousHeading: number | null = null;

    for (const [index, gauntlet] of progression.gauntlets.entries()) {
      let plan: GauntletPlan | null = null;
      // The choke slot is drawn once and only yields to the other after the first
      // has genuinely proved unplaceable, for the same reason the branch count
      // is: the approach slot seats less often per attempt than the stem, so
      // redrawing per attempt would put the nursery on the stem nearly always.
      // The stem needs a boss room to hang off, which gauntlet 0 does not have.
      const chokeSlotOrder = chokeSlotsFor(index, gauntlet.questChoke === true);
      for (const chokeSlot of chokeSlotOrder) {
        if (plan !== null) break;
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
              choke:
                chokeSlot === undefined
                  ? undefined
                  : { w: QUEST_ROOM_W, h: QUEST_ROOM_H, slot: chokeSlot },
              pickCorridorKind,
            });
            if (plan === null) segments.rollback(snapshot);
          }
          if (plan === null) branchCount--;
        }
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
      const chokeRooms: Rect[] = [];
      if (plan.chokeRoom !== null && plan.chokeSlot !== null) {
        addRoom(plan.chokeRoom, FloorTypeValue.tile_floor, 'quest');
        chokeRooms.push(plan.chokeRoom);
        // The stem choke sits on the corridor out of the previous gauntlet's
        // boss room; the approach choke sits past this gauntlet's gateway safe
        // room. Both are crossed after every earlier gauntlet's boss.
        questChokeEntryTiles = corridorTileKeys(plan.chokeEntryCorridor?.tiles ?? []);
        questChokeData = {
          rank: index,
          gauntletIndex: index,
          blocks: plan.chokeSlot === 'stem' ? 'gatewaySafeRoom' : 'gatewayBossRoom',
        };
      }
      for (const corridor of plan.corridors) carvePlannedCorridor(corridor);

      gauntletRoomBounds.push([plan.safeRoom, plan.bossRoom, ...chokeRooms, ...plan.chainRooms]);
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

    // ── Beyond pocket ─────────────────────────────────────────────────────
    //
    // Every floor-2 stairwell lives back here. Seeded from the arena's north gate
    // rather than the antechamber, so the walk to any of them crosses the ring the
    // boss rages along, not merely the door that leads to it.
    //
    // Planned rather than carved, and planned *before* the spine, for two reasons
    // that are really one: the pocket is the tightest thing on the floor — six
    // rooms inside a 60-tile radius of a single gate tile — so it must claim its
    // ground while the rock behind the drum is still untouched; and the gate's
    // breach line is claimed by `claimCorridor`, which overwrites ownership
    // rather than refusing it, so anything already sitting on that line would be
    // silently joined to the pocket and hand the stairs a second way in.
    const planBeyondPocket = (
      reservation: ArenaReservation,
    ): { rects: Rect[]; corridors: PlannedCorridor[] } | null => {
      const arenaCentre = reservation.centre;
      const reserveRect = reservation.reserve;
      const gateTile = arenaGateTileAt(arenaCentre);
      const rects: Rect[] = [];
      const corridors: PlannedCorridor[] = [];

      const connectBeyondRoom = (rect: Rect): PlannedCorridor | null => {
        const centre = rectCentre(rect);
        const sorted = [...rects].sort((a, b) => {
          const ca = rectCentre(a);
          const cb = rectCentre(b);
          return (
            Math.hypot(centre.x - ca.x, centre.y - ca.y) -
            Math.hypot(centre.x - cb.x, centre.y - cb.y)
          );
        });
        for (const candidate of sorted.slice(0, FREE_CONNECT_CANDIDATES)) {
          const corridor = planCorridorBetween(
            segments,
            SEGMENT_BEYOND,
            candidate,
            rect,
            pickCorridorKind(false, centre),
          );
          if (corridor === null) continue;
          segments.claimCorridor(corridor.tiles, SEGMENT_BEYOND);
          return corridor;
        }
        return null;
      };

      const placeBeyondRoom = (w: number, h: number): boolean => {
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
          const rect: Rect = {
            x: randomInt(BORDER + 1, size - BORDER - w - 2),
            y: randomInt(BORDER + 1, size - BORDER - h - 2),
            w,
            h,
          };
          const centre = rectCentre(rect);
          if (
            Math.hypot(centre.x - gateTile.x, centre.y - gateTile.y) > BEYOND_MAX_DIST_FROM_GATE
          ) {
            continue;
          }
          // Stays north of the reserve — the pocket's whole reason to exist is
          // ground the arena never claimed.
          if (rect.y + rect.h > reserveRect.y) continue;
          if (!segments.canPlaceRoom(rect, SEGMENT_BEYOND)) continue;

          if (rects.length === 0) {
            // The landing room is what the gate's straight breach reaches, so it
            // has to span both gate columns — otherwise the breach carved through
            // the reserve margin misses it entirely.
            const spansGateColumns = ARENA_GATE_COLUMN_OFFSETS.every(
              (offset) => gateTile.x + offset >= rect.x && gateTile.x + offset < rect.x + rect.w,
            );
            if (!spansGateColumns) continue;
            segments.addRoom(rect, SEGMENT_BEYOND);
            segments.claimCorridor(arenaGateBreachTiles(arenaCentre, rect), SEGMENT_BEYOND);
            rects.push(rect);
            return true;
          }

          const snapshot = segments.snapshot();
          segments.addRoom(rect, SEGMENT_BEYOND);
          const corridor = connectBeyondRoom(rect);
          if (corridor === null) {
            segments.rollback(snapshot);
            continue;
          }
          rects.push(rect);
          corridors.push(corridor);
          return true;
        }
        return false;
      };

      while (rects.length < BEYOND_ROOM_TARGET) {
        if (!placeBeyondRoom(randomInt(MIN_W, MAX_W), randomInt(MIN_H, MAX_H))) break;
      }
      if (rects.length < BEYOND_MIN_ROOMS) return null;
      return { rects, corridors };
    };

    // Dead ends hanging off the chain: the floor's scatter safe rooms, and a few
    // ordinary rooms for the treasure-room pass to draw from.
    const spinePockets: SpinePocketRequest[] = [];
    for (let index = 0; index < progression.scatterSafeRooms; index++) {
      spinePockets.push({ w: randomInt(MIN_W, MAX_W), h: randomInt(MIN_H, MAX_H), role: 'safe' });
    }
    for (let index = 0; index < SPINE_TREASURE_POCKETS; index++) {
      spinePockets.push({
        w: randomInt(MIN_W, MAX_W),
        h: randomInt(MIN_H, MAX_H),
        role: 'regular',
      });
    }

    // On a spine floor the arena and the spine are planned together, because the
    // spine's far endpoint *is* the antechamber: a spine that cannot be seated
    // between this boss room and this arena is answered by moving the arena
    // rather than by throwing the whole map away. Both live purely in the
    // `SegmentMap` until one pairing works, so a failure rolls back cleanly.
    const spineDef = progression.spine;
    let spinePlan: SpinePlan | null = null;
    let beyondPlan: { rects: Rect[]; corridors: PlannedCorridor[] } | null = null;
    let beyondPocketFailed = false;
    if (hasArena) {
      for (let arenaAttempt = 0; arenaAttempt < MAX_ARENA_ATTEMPTS; arenaAttempt++) {
        const arenaSnapshot = segments.snapshot();
        beyondPocketFailed = false;
        const reservation = reserveArena(
          segments,
          lastBossCentre,
          size,
          BORDER,
          spineDef === undefined ? 'farthest' : 'varied',
        );
        if (reservation === null) {
          segments.rollback(arenaSnapshot);
          continue;
        }
        const beyond = planBeyondPocket(reservation);
        if (beyond === null) {
          // Reported per attempt rather than latched, so a histogram of
          // rejections names the stage that actually failed last.
          beyondPocketFailed = true;
          segments.rollback(arenaSnapshot);
          continue;
        }
        if (spineDef === undefined) {
          arenaReservation = reservation;
          beyondPlan = beyond;
          break;
        }
        for (let spineAttempt = 0; spineAttempt < MAX_SPINE_ATTEMPTS; spineAttempt++) {
          const spineSnapshot = segments.snapshot();
          const planned = planSpine(segments, {
            entryRoom: lastBossRoom,
            exitRoom: reservation.antechamber,
            rooms: spineDef.rooms,
            splits: spineDef.splits,
            questRoom: { w: QUEST_ROOM_W, h: QUEST_ROOM_H },
            labRoom: hasSpiderLab ? { w: SPIDER_LAB_W, h: SPIDER_LAB_H } : null,
            pockets: spinePockets,
            safeRoomKeepAway: [
              ...rooms
                .filter((room) => room.role === 'safe')
                .map((room) => rectCentre(rectOfRoom(room))),
              rectCentre(reservation.antechamber),
            ],
            safeRoomSeparation: SCATTER_SAFE_ROOM_SEPARATION,
            segmentBase: gauntletSegmentCeiling(progression.gauntlets.length) + 1,
            pickCorridorKind,
          });
          if (planned !== null) {
            spinePlan = planned;
            break;
          }
          segments.rollback(spineSnapshot);
        }
        if (spinePlan !== null) {
          arenaReservation = reservation;
          beyondPlan = beyond;
          break;
        }
        segments.rollback(arenaSnapshot);
      }
      // The spine is named first. On a spine floor the arena is only accepted
      // once a spine threads to it, so an unseatable spine leaves *both* null —
      // and reporting that as an arena failure sends whoever reads the rejection
      // histogram to `reserveArena` when the geometry that would not fit is the
      // chain.
      if (spineDef !== undefined && spinePlan === null) return reject('spine');
      if (arenaReservation === null) {
        return reject(beyondPocketFailed ? 'beyond region' : 'arena reservation');
      }
      const antechamberIndex = addRoom(
        arenaReservation.antechamber,
        SAFE_ROOM_FLOOR,
        'safe',
        ARENA_BOSS_TYPE,
      );
      antechamberRoomIndex = antechamberIndex;
      if (beyondPlan !== null) {
        for (const rect of beyondPlan.rects) {
          const floor = randomFromArray(ZONE_FLOORS[zoneOf(rectCentre(rect))]);
          beyondRoomIndices.push(addRoom(rect, floor, 'regular'));
        }
        for (const corridor of beyondPlan.corridors) carvePlannedCorridor(corridor);
      }
    } else if (spineDef !== undefined) {
      // The spine's far endpoint is the antechamber, which only an arena floor
      // has. A floor that asked for one without an arena is a level-definition
      // bug, and shipping the free region instead would hide it.
      throw new Error('a spine floor must have an arena to anchor the far end of its chain');
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

    // ── Spine ───────────────────────────────────────────────────────────────
    //
    // Everything the spine seats is carved here in one pass, because the plan
    // claimed its tiles before any of it was drawn: rooms first, so the corridors
    // could be threaded between them, then the corridors, in walking order.
    const spineChainBounds: Rect[] = [];
    const spineLanes: Array<{ forkIndex: number; rooms: Rect[] }> = [];
    if (spinePlan !== null) {
      for (const room of spinePlan.chain) {
        spineChainBounds.push(room.rect);
        if (room.kind === 'quest') {
          addRoom(room.rect, FloorTypeValue.tile_floor, 'quest');
          questChokeEntryTiles = corridorTileKeys(spinePlan.questEntryCorridor?.tiles ?? []);
          questChokeData = {
            rank: progression.gauntlets.length,
            gauntletIndex: progression.gauntlets.length - 1,
            blocks: 'antechamber',
          };
          continue;
        }
        addRoom(room.rect, randomFromArray(ZONE_FLOORS[zoneOf(rectCentre(room.rect))]), 'chain');
      }
      for (const lane of spinePlan.lanes) {
        spineLanes.push({ forkIndex: lane.forkIndex, rooms: lane.rooms });
        for (const rect of lane.rooms) {
          addRoom(rect, randomFromArray(ZONE_FLOORS[zoneOf(rectCentre(rect))]), 'chain');
        }
      }
      if (spinePlan.labRoom !== null) {
        addRoom(spinePlan.labRoom, SPIDER_LAB_FLOOR, 'spider_lab');
      }
      for (const pocket of spinePlan.pockets) {
        const centre = rectCentre(pocket.rect);
        if (pocket.role === 'safe') addRoom(pocket.rect, SAFE_ROOM_FLOOR, 'safe');
        else addRoom(pocket.rect, randomFromArray(ZONE_FLOORS[zoneOf(centre)]), 'regular');
      }
      for (const corridor of spinePlan.corridors) carvePlannedCorridor(corridor);
    }

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
    //
    // None of it happens on a spine floor. Free seed rooms, the minimum fill, the
    // loop edges, the dead-end rescue shortcuts and the antechamber's extra exits
    // are every one of them a bypass generator, and the spine's whole point is
    // that there is one way through.
    if (spinePlan === null) {
      fillWithRegularRooms(rooms.length + FREE_SEED_ROOMS);
      if (freeRegularRooms === 0) return reject('free region seed');

      // Only on a floor whose gauntlets seated no choke: where they did, the quest
      // room is already on the forced path and a second one would put a goblin
      // mother in a side room too.
      if (
        questChokeData === null &&
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

      // The antechamber is a junction, not a dead end.
      //
      // Every route to the arena door still runs through it — the door's only
      // neighbours outside the wall are its own tiles, and the concourse is sealed
      // across the door row — so extra ways *out* cost nothing and buy the thing the
      // structure has to say: this fight is optional. A crawler who walks in, sees a
      // sealed iron drum with one door in it and three ways onward does not need to be
      // told they can leave. One is required; the rest are taken if the layout offers
      // them.
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
        let connected = 0;
        for (const candidateIndex of candidates.slice(0, ANTECHAMBER_CONNECT_CANDIDATES)) {
          if (connected >= ANTECHAMBER_EXIT_TARGET) break;
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
          connected++;
        }
        if (connected === 0) return reject('antechamber connection');
      }

      // ── Free-region loops and dead-end rescue ───────────────────────────────
      //
      // Filtered from `connectableIndices` — the rooms `placeFreeRoom` actually
      // seated — rather than scanned by role. Beyond-pocket rooms keep the
      // 'regular' role too (decorations and mob spawns work unchanged on them), so
      // a role scan over every room would hand these passes a beyond room and let
      // them carve a `SEGMENT_FREE` shortcut straight back into the free region —
      // reopening the very bypass the beyond pocket exists to close.
      const freeRegularIndices = connectableIndices.filter((i) => rooms[i].role === 'regular');

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
          Math.hypot(centre.x - startCentre.x, centre.y - startCentre.y) <
          DEADEND_MIN_DIST_FROM_START
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
    }

    progressionLayout = {
      startRoom,
      gauntletRoomBounds,
      branchRoomCounts,
      roomBounds: rooms.map(rectOfRoom),
      attempts: mapAttempt,
      // Filled in once stairwells have been sited, further down the pipeline.
      stairwellSpacingWaived: false,
      bandedStairwellTiles: [],
      questChoke: questChokeData,
      spine: spinePlan === null ? null : { chain: spineChainBounds, lanes: spineLanes },
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

  /**
   * Which of a room's doorways a crawler can stand outside of without first
   * walking through the room itself.
   *
   * The planned arrival corridor names the doorway the *route* comes in by, and
   * on nearly every map that is also the doorway a crawler walks in through. On a
   * map whose corridors loop it is not: the way to that corridor can itself run
   * back through the room, so the doorway the plan calls the entrance is one the
   * player only ever reaches from inside. Left uncorrected that hands the goblin
   * mother every doorway the party can actually walk in by, and the boards she
   * puts up for her wave go up across the way they came.
   *
   * Answered from the finished grid rather than from the plan, because it is a
   * question about the corridor network as built.
   */
  function doorwaysReachableAroundRoom(
    grid: TileContent[][],
    startTile: Point,
    bounds: Rect,
    doorways: ReadonlyArray<RoomDoorway>,
  ): Set<RoomDoorway> {
    const size = grid.length;
    const insideRoom = (x: number, y: number): boolean =>
      x >= bounds.x && x < bounds.x + bounds.w && y >= bounds.y && y < bounds.y + bounds.h;
    const open = (x: number, y: number): boolean =>
      x >= 0 &&
      y >= 0 &&
      y < size &&
      x < grid[y].length &&
      !insideRoom(x, y) &&
      isWalkableTileType(grid[y][x]);

    const seen = new Set<number>();
    if (open(startTile.x, startTile.y)) {
      seen.add(tileCoordKey(startTile.x, startTile.y));
      const queue: Point[] = [startTile];
      let head = 0;
      while (head < queue.length) {
        const tile = queue[head];
        head++;
        for (const step of ROOM_WALL_OUTWARD) {
          const next = { x: tile.x + step.dx, y: tile.y + step.dy };
          const key = tileCoordKey(next.x, next.y);
          if (seen.has(key) || !open(next.x, next.y)) continue;
          seen.add(key);
          queue.push(next);
        }
      }
    }

    const reachable = new Set<RoomDoorway>();
    for (const doorway of doorways) {
      for (const tile of doorway.tiles) {
        for (const step of ROOM_WALL_OUTWARD) {
          if (!seen.has(tileCoordKey(tile.x + step.dx, tile.y + step.dy))) continue;
          reachable.add(doorway);
        }
      }
    }
    return reachable;
  }

  const questRooms: QuestRoomData[] = [];
  const questRoom = rooms.find((r) => r.role === 'quest');
  if (questRoom !== undefined) {
    const qr = questRoom;
    const bounds: Rect = { x: qr.x, y: qr.y, w: qr.w, h: qr.h };
    const qcx = Math.floor(qr.x + qr.w / 2);
    const qcy = Math.floor(qr.y + qr.h / 2);
    const doorways = roomDoorways(grid, bounds);

    // The way in is the doorway the arrival corridor actually cuts through.
    // Everything else is a way onward: a choke seated as a branch fan's hub has
    // one onward doorway per branch.
    const entryTiles = questChokeEntryTiles;
    const plannedEntrance =
      entryTiles === null
        ? null
        : (doorways.find((doorway) =>
            doorway.tiles.some((tile) => entryTiles.has(tileCoordKey(tile.x, tile.y))),
          ) ?? null);
    // The planned arrival doorway, unless the built corridors say a crawler
    // cannot get to it without crossing the room — see
    // `doorwaysReachableAroundRoom`. A fan hub has several doorways that pass
    // that test, which is why the plan's answer is preferred over any of them.
    const approachable =
      plannedEntrance === null
        ? new Set<RoomDoorway>()
        : doorwaysReachableAroundRoom(grid, startTile, bounds, doorways);
    const entranceDoorway =
      plannedEntrance === null || approachable.has(plannedEntrance)
        ? plannedEntrance
        : ([...approachable][0] ?? plannedEntrance);
    const exitDoorTiles =
      entranceDoorway === null
        ? []
        : doorways
            .filter((doorway) => doorway !== entranceDoorway)
            .flatMap((doorway) => doorway.tiles);

    const grateTiles = questGrateTiles(bounds, doorways);
    for (const g of grateTiles) {
      if (g.y >= 0 && g.y < size && g.x >= 0 && g.x < size) {
        grid[g.y][g.x].type = FLOOR_GRATE;
      }
    }
    questRooms.push({
      bounds,
      centre: { x: qcx, y: qcy },
      grateTiles,
      entranceTile: entranceDoorway?.tile ?? { x: qcx, y: qr.y + qr.h - 1 },
      exitDoorTiles,
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
    // The scientist stands just inside his own doorway rather than somewhere
    // along the entrance wall, so a crawler walking the corridor past the lab
    // sees him waiting in the gap and knows the room is a choice on offer. The
    // lab hangs off the route as a dead end; nothing else advertises it.
    const scientistTile = labScientistTile(entrance, {
      x: slr.x,
      y: slr.y,
      w: slr.w,
      h: slr.h,
    });
    let computerTile: Point;
    let spiderEggTile: Point;
    let lifeMachineTiles: Point[];

    if (entranceWall === 'south') {
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
  const baseStairwellCount =
    numStairwellsOverride ?? Math.max(1, Math.floor(regularRooms.length / ROOMS_PER_STAIRWELL));
  const stairwellCount = Math.max(1, Math.round(baseStairwellCount * stairwellCountMultiplier));

  if (progression !== undefined && lastGatewayBossRoom !== null) {
    // A stairwell must never be in sight of the last boss room's exit, and two
    // stairwells must never be found in the same sweep of the free region — the
    // hunt for the stairs is the point of the post-gauntlet stretch.
    //
    // On an arena floor every candidate comes from the beyond pocket instead of
    // the whole free region: the pocket is far from the exit by construction, so
    // the distance filter below stays true, but restricting the pool is what
    // makes "every stairwell sits behind the drum" a guarantee rather than a
    // likelihood.
    const stairwellRoomPool = hasArena ? beyondRoomIndices.map((i) => rooms[i]) : regularRooms;
    // The pocket is only ~`BEYOND_MAX_DIST_FROM_GATE` tiles across, far tighter
    // than the free region `STAIRWELL_MIN_SEPARATION` was tuned for.
    const stairwellSeparation = hasArena
      ? BEYOND_STAIRWELL_MIN_SEPARATION
      : STAIRWELL_MIN_SEPARATION;
    const exitBounds = lastGatewayBossRoom;
    const byDistanceFromExit = stairwellRoomPool
      .map((r) => ({ x: Math.floor(r.x + r.w / 2), y: Math.floor(r.y + r.h / 2) }))
      .sort((a, b) => distanceToRect(b, exitBounds) - distanceToRect(a, exitBounds));
    const beyondMinDistance = byDistanceFromExit.filter(
      (centre) => distanceToRect(centre, exitBounds) >= STAIRWELL_MIN_DIST_FROM_GAUNTLET_EXIT,
    );
    // The ceiling is what keeps the stairs off the perimeter: "as far from the
    // exit as possible" is maximised at the map's corners, which is precisely the
    // sweep a player never makes. The pocket behind an arena is not perimeter to
    // begin with — its distance from the exit is the arena's geometry, not a
    // choice — so the ceiling only governs a free-region pool.
    const bandGovernsPool = !hasArena;
    // With no ceiling to counteract, the farthest room from the exit is the
    // placement the floor was tuned around, so an arena floor seeds from it
    // rather than from anywhere in the pool.
    const seedStrategy: StairwellSeedStrategy = bandGovernsPool ? 'random' : 'farthest';
    const insideBand = beyondMinDistance.filter(
      (centre) => distanceToRect(centre, exitBounds) <= STAIRWELL_MAX_DIST_FROM_GAUNTLET_EXIT,
    );
    const bandHoldsEnoughRooms = bandGovernsPool && insideBand.length >= stairwellCount;
    const seatedInsideBand = bandHoldsEnoughRooms
      ? seatStairwellsByIsolation(insideBand, stairwellCount, stairwellSeparation, seedStrategy)
      : [];
    // A band holding enough rooms by count can still be too cramped to hold them
    // `stairwellSeparation` apart, and a shortfall there is invisible to the
    // validator, which only rejects a floor with no stairs at all. Widening to
    // every room past the minimum distance is the same yielding a band too thin
    // to begin with already does — the stairs are worth more than the ceiling.
    const bandSustainsFullSet = seatedInsideBand.length >= stairwellCount;
    const widenedFromBand = bandSustainsFullSet
      ? seatedInsideBand
      : seatStairwellsByIsolation(
          beyondMinDistance,
          stairwellCount,
          stairwellSeparation,
          seedStrategy,
          seatedInsideBand,
        );
    // Keeping the banded picks can itself box out the wider pool: a set clustered
    // near the exit leaves the rest of the floor less room to spread into. So a
    // set still short of the count is raced against one seeded from the wide pool
    // alone, and the fuller of the two takes the floor.
    const widenedAlone =
      widenedFromBand.length < stairwellCount
        ? seatStairwellsByIsolation(
            beyondMinDistance,
            stairwellCount,
            stairwellSeparation,
            seedStrategy,
          )
        : [];
    const wideSetWins = widenedAlone.length > widenedFromBand.length;
    const seatedStairwells = wideSetWins ? widenedAlone : widenedFromBand;
    // The wide-pool set is seeded from scratch, so none of its picks owe their
    // position to the band even where one happens to land inside it.
    const seatedFromBandedPool = wideSetWins ? [] : seatedInsideBand;
    stairwellTiles.push(...seatedStairwells);
    if (progressionLayout !== undefined) {
      progressionLayout.bandedStairwellTiles = [...seatedFromBandedPool];
    }
    // A floor with no way down is unplayable, so the spacing rules yield rather
    // than the stairs: the farthest room in the pool takes one even when it sits
    // closer to the boss's exit than the rule would like. The validator is told,
    // so it waives the distance rule instead of rejecting a floor that is merely
    // unlucky. On an arena floor the pool is already beyond-only, so the waiver
    // can never reach into the free region.
    if (stairwellTiles.length === 0 && byDistanceFromExit.length > 0) {
      stairwellTiles.push(byDistanceFromExit[0]);
      if (progressionLayout !== undefined) progressionLayout.stairwellSpacingWaived = true;
    }
    // Under this plan the stairwell count is part of the guarantee on an arena
    // floor: every stairwell has to seat behind the drum, or the map is unplayable
    // as designed and must retry rather than ship a shortfall.
    if (hasArena && stairwellTiles.length < stairwellCount) {
      return reject('beyond stairwells');
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
      // Asking for more stairwells than there are distant rooms walks the stride
      // off the end of the list — place what fits rather than reading past it.
      const roomIndex = i * step;
      if (roomIndex >= farRooms.length) break;
      const r = farRooms[roomIndex];
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
      region: progressionRegionOf(r, progressionLayout),
    }));

  // Select treasure rooms from eligible regular rooms — 5% of total rooms, at least 1
  const MIN_ROOM_SIZE = 7;
  // A spine floor has an order of magnitude fewer ordinary rooms than a free
  // region does — its dead-end pockets and its beyond pocket are the whole
  // supply — so a share of that count would leave the floor with a single chest.
  // The pockets exist to be worth walking into; a floor-wide minimum is what
  // makes them so.
  const treasureRoomTarget = Math.max(
    progressionLayout?.spine === null || progressionLayout?.spine === undefined
      ? 1
      : SPINE_TREASURE_ROOM_TARGET,
    Math.round(regularRooms.length * TREASURE_ROOM_RATIO),
  );

  // A treasure chest and a stairwell in the same room let a player grab both
  // without exploring — exclude any room a stairwell already occupies.
  const eligibleRegularRooms = regularRooms.filter(
    (r) =>
      r.w >= MIN_ROOM_SIZE &&
      r.h >= MIN_ROOM_SIZE &&
      !stairwellTiles.some((s) => s.x >= r.x && s.x < r.x + r.w && s.y >= r.y && s.y < r.y + r.h),
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
      region: progressionRegionOf(r, progressionLayout),
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

  /**
   * Carves the arena structure at a chosen centre and records its exterior.
   *
   * `antechamber` is the safe room south of the door on a progression floor, and
   * null on a free-roam one. When it is present the concourse is routed *through*
   * it: the ring's two ends drop into the safe room and the door row between them
   * is walled, so the crawler can walk the whole way around the drum but can only
   * reach its door from inside the antechamber.
   */
  const carveArena = (acx: number, acy: number, antechamber: Rect | null): void => {
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
      if (ty < 0 || ty >= size) continue;
      for (const offset of ARENA_DOOR_COLUMN_OFFSETS) {
        grid[ty][doorX + offset].type = FloorTypeValue.concrete;
      }
    }

    // The concourse: a walkable ring right around the outside of the wall. It is
    // what makes the arena read as a building the crawler is walking *past* rather
    // than a dead end they have arrived at, and it is carved on every floor that
    // has an arena.
    //
    // Tiles already claimed by the antechamber are left alone. The safe room's own
    // floor material is part of how a crawler knows they are safe, and paving over
    // its northern strip with concourse would take that away exactly where they
    // stop to decide whether to fight.
    const insideAntechamber = (gx: number, gy: number): boolean =>
      antechamber !== null &&
      gx >= antechamber.x &&
      gx < antechamber.x + antechamber.w &&
      gy >= antechamber.y &&
      gy < antechamber.y + antechamber.h;

    for (let ry = -ARENA_CONCOURSE_REACH; ry <= ARENA_CONCOURSE_REACH; ry++) {
      for (let rx = -ARENA_CONCOURSE_REACH; rx <= ARENA_CONCOURSE_REACH; rx++) {
        const rad = Math.hypot(rx, ry);
        if (rad <= ARENA_RADIUS || rad > ARENA_CONCOURSE_REACH) continue;
        const gx = acx + rx;
        const gy = acy + ry;
        if (gy < 0 || gy >= size || gx < 0 || gx >= size) continue;
        if (insideAntechamber(gx, gy)) continue;
        grid[gy][gx].type = FloorTypeValue.concrete;
      }
    }

    if (antechamber !== null) {
      sealConcourseAcrossDoorRow(grid, size, acx, doorY);
      linkConcourseToAntechamber(grid, size, acx, doorY, antechamber);
    }

    setArenaCages(grid, size, acx, acy);

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
    carveArena(arenaReservation.centre.x, arenaReservation.centre.y, arenaReservation.antechamber);
    if (beyondRoomIndices.length > 0) {
      const landingRoom = rectOfRoom(rooms[beyondRoomIndices[0]]);
      carveArenaGate(grid, size, arenaReservation.centre.x, arenaReservation.centre.y, landingRoom);
    }
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

      // No antechamber on a free-roam floor, so the concourse is a plain ring and
      // the door opens onto it directly.
      carveArena(acx, acy, null);

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

      const pivotX = Math.min(acx + ARENA_CONCOURSE_REACH, size - BORDER - 1);
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
          return Math.hypot(p.x - a.centre.x, p.y - a.centre.y) > ARENA_STAIRWELL_EXCLUSION_TILES;
        })
      : mobSpawnPoints;

  const filteredStairwells =
    arenaExteriors.length > 0
      ? stairwellTiles.filter((p) => {
          const a = arenaExteriors[0];
          return Math.hypot(p.x - a.centre.x, p.y - a.centre.y) > ARENA_STAIRWELL_EXCLUSION_TILES;
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
/**
 * What the validator should demand of a floor built from these options.
 *
 * Derived here rather than at each call site so the offline harness and the
 * game's own retry loop can never disagree about which invariants a floor is
 * held to — a gate armed in one and not the other is a gate that reports green
 * having checked nothing.
 */
export function progressionExpectations(options: GenerateDungeonOptions): ProgressionExpectations {
  const progression = options.progression;
  return {
    mapSize: options.size,
    gauntletCount: progression?.gauntlets.length ?? 0,
    hasArena: options.hasArena ?? false,
    hasQuestChoke:
      progression !== undefined &&
      (progression.spine !== undefined ||
        progression.gauntlets.some((gauntlet) => gauntlet.questChoke === true)),
    hasSpine: progression?.spine !== undefined,
    spiderLabIsDeadEnd: (options.hasSpiderLab ?? false) && progression?.spine !== undefined,
    spineMinRooms: progression?.spine?.rooms.min ?? 0,
    scatterSafeRooms: progression?.scatterSafeRooms ?? 0,
  };
}

export function generateDungeon(options: GenerateDungeonOptions): DungeonData {
  const rejections: string[] = [];
  if (options.progression === undefined) {
    const data = buildDungeon(options, 1, rejections);
    if (data === null) throw new Error('free-roam dungeon generation returned no map');
    return data;
  }

  const expectations = progressionExpectations(options);
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
