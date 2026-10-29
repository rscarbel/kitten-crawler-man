import {
  FloorTypeValue,
  type TileContent,
  VOID_TYPE,
  SAFE_ROOM_FLOOR,
  SAFE_ROOM_THRESHOLD,
  TRASH_GREMLIN_FLOOR,
  GYM_FLOOR,
  POWER_LAB_FLOOR,
  FLOODED_PUMP_ROOM_FLOOR,
  FLOOR_GRATE,
  SPIDER_LAB_FLOOR,
  LAB_STATION_FLOOR,
  LAB_STATION_THRESHOLD,
  LAB_BENCH,
  LAB_SHELF,
  LAB_WEB,
  placeProp,
  CRAWLER_SIGN,
  STEALTH_GATE_CLOSED,
} from './tileTypes';
import { randomFromArray, randomInt } from '../utils';
import { tileCoordKey } from './tileIndex';
import { planCrawlerSigns, crawlerSignFootprint, type PlannedCrawlerSign } from './crawlerSigns';
import { isWalkableTileType } from './walkability';
import { guideAndBedTiles, SAFE_ROOM_THRESHOLD_DEPTH_TILES } from './safeRoomFixtures';
import { planLabStation } from './labStationLayout';
import { labHallwayDecayAt, layOutLabApproach, type LabHallwayTile } from './labApproach';
import type { BranchesRoute, GauntletDef, ProgressionDef, SpineRoute } from '../levels/types';
import { BOSS_ROOM_SIZE, type GauntletBossType } from './bossRoomSizes';
import { floodedTileDepths, type FloodedApproachData } from './floodedApproach';
import { floodDungeonTile } from './dungeonWater';
import {
  SegmentMap,
  SEGMENT_FREE,
  SEGMENT_FREE_RESERVE,
  gauntletSegment,
  planGauntlet,
  planGauntletHead,
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
  type GauntletHead,
  type GauntletPlan,
  type GauntletRoomSizes,
  type PlannedBathroom,
  type PlannedCorridor,
} from './gauntletLayout';
import { bathroomBlockedTiles, layOutBathroom, type BathroomRoomData } from './bathroomLayout';
import {
  PRISON_DOOR_SIDE_FACE_TILES,
  layOutStealthGateRoom,
  prisonBuildingEntry,
  type StealthGateRoomData,
} from './stealthGateLayout';
import { doorwayKeepClearTiles } from '../systems/doorwayKeepClear';
import { tileKey } from '../systems/tileKey';
import {
  validateProgression,
  distanceToRect,
  SCATTER_SAFE_ROOM_SEPARATION,
  STAIRWELL_MIN_SEPARATION,
  STAIRWELL_MIN_DIST_FROM_GAUNTLET_EXIT,
  STAIRWELL_MAX_DIST_FROM_GAUNTLET_EXIT,
  buildRoomGraph,
  nearestHopDistance,
  OUTSKIRTS_SAFE_ROOM_MIN_HOPS,
  OUTSKIRTS_SAFE_ROOM_MAX_HOPS,
  type InvariantFailure,
  type ProgressionExpectations,
} from './progressionValidation';
import { planSpine, type SpinePlan, type SpinePocketRequest } from './spineLayout';
import { layOutSpiderLab } from './spiderLabLayout';
import { registerSpiderLabFloorPlan } from './tiles/bossRooms/labFloorPlan';
import {
  blockingWouldSplitRoom,
  roomDoorways,
  detectRoomEntrance,
  ROOM_WALL_OUTWARD,
  type RoomDoorway,
  type RoomWall,
} from './roomDoorways';
import { UINT32_SPAN, worldRandom } from '../core/world/WorldRandom';
import { BASE_NURSERY_GRATE_COUNT } from '../levels/defendQuestIntensity';
import {
  buildRegionMap,
  NO_REGION,
  RegionMap,
  type HallwayKind,
  type RoomRole,
  type Zone,
} from './regionMap';
import { mulberry32 } from '../sprites/person/rng';
import { DEFAULT_DUNGEON_FLOOR_THEME, type DungeonFloorThemeId } from './dungeon/floorTheme';
import {
  SPECIAL_REGION_LIGHTING,
  SPECIAL_REGION_PROPS,
  type SpecialRegionTag,
} from './dungeon/roomCharacters';
import {
  RegionCharacters,
  rollHallwayCharacter,
  rollRoomCharacter,
  type RegionAssignment,
} from './dungeon/regionCharacters';
import {
  BLOCKING_CLEARANCE_TILES,
  dressHallway,
  dressLabHallway,
  dressRoom,
  dressSpecialRoom,
  isBlockingDressingTile,
} from './dungeon/roomDressing';
import { dressBathroom } from './dungeon/bathroomDressing';
import { placeWallFixtures, type WallFixture } from './dungeon/wallFixtures';

type Room = {
  x: number;
  y: number;
  w: number;
  h: number;
  floor: number;
  role: RoomRole;
  /** Set on a gateway safe room: the boss its only onward exit leads to. */
  guardsBossType?: string;
  /** Set on an exit safe room: the gauntlet boss whose room's only onward exit leads here. */
  followsBossType?: string;
  /**
   * Set on a mandatory safe-access pocket seated off a gauntlet branch or the
   * spine chain. Distinguishes those from the free region's own scatter safe
   * rooms, which otherwise carry the same `guardsBossType`/`followsBossType`
   * of `undefined` and would be indistinguishable by any other field.
   */
  isSafeAccessPocket?: boolean;
  /** See {@link SafeRoomData.servesSpecialRoom}. */
  servesSpecialRoom?: SafeRoomService;
};

/** What a room may set on itself beyond its rectangle, floor and role. */
type RoomTags = Pick<
  Room,
  'guardsBossType' | 'followsBossType' | 'isSafeAccessPocket' | 'servesSpecialRoom'
>;
type Point = { x: number; y: number };
type Rect = { x: number; y: number; w: number; h: number };

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
  /** The terminal the hack is run from: the back-middle tile of its bench. */
  computerTile: Point;
  /** Tile where the spider egg starts (centre of room). */
  spiderEggTile: Point;
  /** Tile positions of the life machines scattered through the room. */
  lifeMachineTiles: Point[];
  /** Which wall the lab's doorway breaks through; the furniture is laid out against it. */
  entranceWall: RoomWall;
  /** The terminal's whole bench, three wide and two deep, stamped `LAB_BENCH`. */
  computerTableTiles: Point[];
  /** Dr. Moult's post in his lab once he has asked for help: beside the terminal bench, on the doorway side. */
  labPostTile: Point;
  /** The waist-high lab benches in the entrance half, stamped `LAB_BENCH`. */
  benchTiles: Point[];
  /** The specimen shelving against the side walls, stamped `LAB_SHELF`. */
  shelfTiles: Point[];
  /** Webbing spun over the far end of the lab, stamped `LAB_WEB`. */
  webTiles: Point[];
  /** Where the cocooned lab staff hang. Walkable: they hang over the floor, not on it. */
  cocoonTiles: Point[];
  /**
   * The hallway from the chain room the lab hangs off to its station: every
   * floor tile of that corridor. The lab's approach runs host room → this
   * hallway → the station (a safe room) → {@link innerHallwayTiles} → the lab.
   */
  outerHallwayTiles: LabHallwayTile[];
  /** The hallway from the station to the lab's doorway: every floor tile of that corridor. */
  innerHallwayTiles: LabHallwayTile[];
  /**
   * The outer hallway's middle tile where it leaves the host chain room — the
   * first corridor tile a crawler steps on when turning in.
   */
  hallwayMouthTile: Point;
  /**
   * Where Dr. Moult waits before he has asked for help: inside the host room
   * beside the mouth, never in a doorway.
   */
  hallwayPostTile: Point;
  /** The way into the host room from the mouth, one tile long: the way he faces at his post. */
  hallwayPostFacing: Point;
  /** The chain room the approach leaves from. */
  hostBounds: Rect;
  /**
   * The station's floor. Its entry in `safeRooms` is the one whose
   * `servesSpecialRoom` is `'spider_lab'`.
   */
  stationBounds: Rect;
  /**
   * Fewest steps from the mouth to the lab's doorway tile, along the same walk
   * as {@link LabHallwayTile.distanceFromMouth}: the far end of the approach.
   */
  labDoorwayDistance: number;
}

/** A special room a safe room exists to serve, rather than one of the floor's own stops. */
export type SafeRoomService = 'spider_lab';

export interface SafeRoomData {
  bounds: Rect;
  centre: Point;
  /**
   * Set when this safe room is the last stop before a specific boss, naming that
   * boss's snake_case mob type. Drives the boss-specific advice Dave gives
   * in that room while the boss is still alive.
   */
  guardsBossType?: string;
  /**
   * Set when this safe room is the one behind a gauntlet boss room, naming that
   * boss's snake_case mob type. Set by the generator on each gauntlet's exit
   * safe room; read by the validator and verify scripts to tell exit rooms
   * apart from gateway and scatter rooms without relying on placement order.
   */
  followsBossType?: string;
  /**
   * Set when this safe room is a mandatory safe-access pocket seated off a
   * gauntlet branch or the spine chain, rather than one of the free region's
   * own scatter safe rooms. Both carry `guardsBossType`/`followsBossType` of
   * `undefined`, so this is the only field that tells them apart — needed by
   * the outskirts hop-spacing invariant, which must not judge a pocket's
   * spacing along its own mandatory route by the free region's rule.
   */
  isSafeAccessPocket?: boolean;
  /**
   * Set on a safe room that belongs to a special room's approach rather than to
   * the floor's own run of stops — the spider lab's field station, on the
   * lab's dead-end branch. It is not a scatter room, not a gateway and not a
   * safe-access pocket, so the rules for those leave it out; it furnishes
   * itself as a field station rather than an ordinary safe room, and it is
   * always the last entry in `safeRooms`, so no earlier room's index (which
   * keys its doctor's name and face) depends on whether the floor has one.
   */
  servesSpecialRoom?: SafeRoomService;
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
  /** Which gauntlet's rooms bracket the choke. */
  gauntletIndex: number;
  /** The landmark that must become unreachable once the quest room is removed. */
  blocks: 'gatewaySafeRoom' | 'gatewayBossRoom';
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
  /**
   * Each branch's own room sequence in walking order, per gauntlet, excluding
   * the branch's fan point and gateway safe room — the same span
   * `safeAccessPocketIndices` seats mandatory safe-access pockets against.
   * Lets the validator walk a branch in the order the run-limit rule was
   * applied to, rather than reconstruct it from the flat `gauntletRoomBounds`.
   */
  gauntletBranchChains: Rect[][][];
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
   * Keyed by tile rather than by index into `stairwellTiles`, so a reader
   * matching one never depends on placement order.
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
  /** The gauntlet whose branches each seat a bathroom, or null on a floor with none. */
  bathroomGauntletIndex: number | null;
  /**
   * The stealth gate room the spine seated, by its position in `spine.chain`,
   * or null on a floor with none.
   */
  stealthGate: { chainIndex: number; bounds: Rect } | null;
  /**
   * The forced chain a spine route leads up to its gauntlet's gateway safe room,
   * or null on a floor with none.
   *
   * `chain` is in walking order and every one of its rooms is meant to be a cut
   * vertex; `lanes` are the alternate routes, each bridging `chain[forkIndex]`
   * and the room after it. `gauntletIndex` is the gauntlet whose gateway safe
   * room the chain arrives at.
   */
  spine: {
    chain: Rect[];
    lanes: Array<{ forkIndex: number; rooms: Rect[] }>;
    gauntletIndex: number;
  } | null;
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
  gauntlet: GauntletDef,
): ReadonlyArray<ChokeSlot | undefined> {
  if (gauntlet.questChoke !== true) return [undefined];
  // A flooded approach is the corridor the approach slot would interrupt.
  if (gauntlet.approach !== undefined) {
    if (gauntletIndex === 0) {
      throw new Error('a flooded approach takes its choke on the stem; gauntlet 0 has none');
    }
    return ['stem'];
  }
  // The stem is the corridor out of the *previous* gauntlet's boss room, which
  // gauntlet 0 leaves from the start room instead — a choke there would gate the
  // floor before the player has walked anywhere.
  if (gauntletIndex === 0) return ['approach'];
  return worldRandom() < EVEN_SLOT_CHANCE ? ['stem', 'approach'] : ['approach', 'stem'];
}

/** Side length, in tiles, of the square a stairwell blocks. */
export const STAIRWELL_FOOTPRINT_SPAN = 2;

/**
 * Rooms a sign may stand in. Safe rooms are excluded because the scene stamps
 * their counters and decor after generation, where this planner cannot see them;
 * the start, boss, quest and lab rooms hold scripted encounters it cannot see either.
 */
const SIGN_ROOM_ROLES: ReadonlySet<RoomRole> = new Set<RoomRole>(['chain', 'regular']);

/**
 * Whether the bathroom plumber counts as standing in the way, which he always
 * does in the game; only a gate's self-test switches it off.
 */
function plumberBlocksOnFloor(progression: ProgressionDef | undefined): boolean {
  return !(
    progression?.gauntlets.some(
      (gauntlet) =>
        gauntlet.route.kind === 'branches' &&
        gauntlet.route.bathroomChoke?.plumberWalkableForGate === true,
    ) ?? false
  );
}

/**
 * Every tile a bathroom's fixtures, plumber and goblins stand on, which nothing
 * else may be placed over: no sign, no prop, no dressing.
 */
function bathroomStandingTiles(room: BathroomRoomData): Point[] {
  return [
    room.entranceTile,
    room.pipeWallStandTile,
    room.plumberTile,
    ...room.stallDoorTiles,
    ...room.sinkTiles,
    ...room.loiterTiles,
    ...bathroomBlockedTiles(room),
  ];
}

/** A gate room has exactly two ways through it: the way in, and the way the gate shuts. */
const STEALTH_GATE_DOORWAY_COUNT = 2;

/** Every tile of the stealth gate room nothing else may be placed on; empty without one. */
function stealthGateKeepClear(room: StealthGateRoomData | null): Point[] {
  return room === null ? [] : room.keepClearTiles;
}

/**
 * The wall tiles the prison door and its sign are painted on, with a column of
 * face either side, so no sign pocket is cut into them.
 */
function stealthGateWallArtTiles(room: StealthGateRoomData | null): Point[] {
  if (room === null) return [];
  const { prisonDoor } = room;
  const tiles: Point[] = [room.signTile];
  const lastColumn = prisonDoor.x0 + prisonDoor.faceTiles.length - 1 + PRISON_DOOR_SIDE_FACE_TILES;
  for (let x = prisonDoor.x0 - PRISON_DOOR_SIDE_FACE_TILES; x <= lastColumn; x++) {
    for (const row of [prisonDoor.approachRow - 1, prisonDoor.approachRow - 2])
      tiles.push({ x, y: row });
  }
  return tiles;
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
  /** Every copy of the clogged bathroom, one per branch of the gauntlet that seats them. */
  bathroomRooms: BathroomRoomData[];
  /** The spine's locked gate room, or null on a floor without one. */
  stealthGateRoom: StealthGateRoomData | null;
  treasureRooms: TreasureRoomData[];
  spiderLabRoom: SpiderLabRoomData | null;
  mobSpawnPoints: MobSpawnPoint[];
  hallwaySpawnPoints: Point[];
  stairwellTiles: Point[];
  /** Every gauntlet's flooded corridor into its boss room; empty on a floor with none. */
  floodedApproaches: FloodedApproachData[];
  /** Set only in forced-progression mode. */
  progressionLayout?: ProgressionLayoutData;
  /** Every wayfinding sign stamped into the grid; empty when the floor has no forced progression. */
  readonly crawlerSigns: ReadonlyArray<PlannedCrawlerSign>;
  /**
   * Which room or hallway segment each tile belongs to. Built only in
   * forced-progression mode, whose rooms are the ones `progressionLayout.roomBounds`
   * lists; empty on a free-roam floor, which records no room list.
   */
  readonly regionMap: RegionMap;
  /**
   * The character each room and hallway segment was dressed as, indexed like
   * {@link regionMap}. Empty wherever the region map is.
   */
  readonly regionCharacters: RegionCharacters;
  /** What hangs on the floor's wall faces; empty wherever the region map is. */
  readonly wallFixtures: ReadonlyArray<WallFixture>;
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
const QUEST_ROOM_W = 14;
const QUEST_ROOM_H = 12;
const SPIDER_LAB_W = 40;
const SPIDER_LAB_H = 32;
/**
 * The lab's field station: room for Dave to wander a little (his walk needs
 * a 3×3 interior) beside the team's kit, with the walk between its two
 * doorways left open.
 */
const LAB_STATION_W = 7;
const LAB_STATION_H = 6;

const BOSS_MIN_SEPARATION = 60;
const FALLBACK_START_POS = 15;

// Extra loop connections added on top of MST
const EXTRA_LOOP_RATIO = 0.22;
const LOOP_ATTEMPT_FACTOR = 10;
const EXTRA_LOOP_MIN_DIST = 14;
const EXTRA_LOOP_MAX_DIST = 40;

/** How far inside a quest-room wall its grates sit. */
const QUEST_GRATE_WALL_INSET = 2;
/** How far a wall's outermost grates sit from the room's midline, along the wall; the rest are spaced evenly between. */
const QUEST_GRATE_SPREAD = 3;
/** Walls the quest room's grates are split evenly between. */
const QUEST_GRATE_WALLS = 2;
/**
 * Grates kept at least this many tiles along the wall from any doorway in it,
 * so none sits in the mouth of a corridor where the arriving party would walk
 * straight onto a breach.
 */
const QUEST_GRATE_DOORWAY_CLEARANCE = 2;
/** Grates never sit closer than this (Chebyshev tiles) to one another. */
const QUEST_GRATE_MIN_SEPARATION = 2;

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
const LAB_EGG_NEAR_WALL = 4; // egg offset from the wall opposite the entrance
const LAB_EGG_FAR_WALL = 5; // egg offset from the far wall
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
 * Sitings of a spine-fed gauntlet tried before the map is thrown away.
 *
 * A spine that will not fit between the previous exit and this gateway is
 * usually a complaint about where the gateway landed, not about the whole
 * floor, so the gauntlet is re-sited first and only a run of failures costs a
 * map attempt.
 */
const MAX_SPINE_GATEWAY_SITINGS = 6;
/** Candidate positions sampled per siting before it gives up on finding one that fits. */
const SPINE_GATEWAY_PLACEMENT_SAMPLES = 400;
/**
 * Distance from the previous gauntlet's exit to a spine-fed gateway safe room.
 * Short on purpose: the spine's length comes from winding, not distance.
 */
const SPINE_GATEWAY_DIST_MIN = 30;
const SPINE_GATEWAY_DIST_MAX = 100;
/** How far from an already-seated free room a room sampled near the region is tried. */
const FREE_ROOM_NEAR_DIST_MIN = 18;
const FREE_ROOM_NEAR_DIST_MAX = 40;
/**
 * Side of the square of open ground held beyond a spine-fed last gauntlet's
 * exit safe room while its spine is planned, so the spine cannot wind through
 * the only ground the free region past it, where the stairwells are, could
 * grow in. Room for a few rooms each way at the free region's pitch.
 */
const FREE_REGION_RESERVE_SPAN_TILES = 64;
/** Rock left between the exit safe room and the near edge of that reserve. */
const FREE_REGION_RESERVE_GAP_TILES = 4;
/** Serpentines tried per gateway siting. Mirrors the per-branch attempt budget. */
const MAX_SPINE_ATTEMPTS = 10;
/**
 * Ordinary dead-end rooms hung off the spine, on top of the floor's safe rooms.
 * The treasure-room pass draws from these, so a floor with none would have its
 * chests only past its last boss.
 */
const SPINE_TREASURE_POCKETS = 5;
/** Chests a spine floor aims for, drawn from its pockets and its free region. */
const SPINE_TREASURE_ROOM_TARGET = 3;

/**
 * Mixed into the dressing seed to split off the placement and hallway streams,
 * so which character a room rolls draws nothing from the stream props are
 * placed from. A room dressed differently still places a different number of
 * props, so every room after it lands its props differently.
 */
const PLACEMENT_STREAM_SALT = 0x5bd1e995;
const HALLWAY_STREAM_SALT = 0x27d4eb2f;
const FIXTURE_STREAM_SALT = 0x165667b1;
const SPECIAL_ROOM_STREAM_SALT = 0x2f6b1c53;
const LAB_HALLWAY_STREAM_SALT = 0x4c8f2a91;

/**
 * The lighting tag each room role that takes no character is given; null for
 * the roles that are dressed from a character.
 */
const SPECIAL_ROLE_TAGS = {
  start: 'start',
  safe: 'safe',
  boss: 'boss',
  quest: 'quest',
  spider_lab: 'spider_lab',
  bathroom: 'clogged_bathroom',
  stealth_gate: 'stealth_gate',
  chain: null,
  regular: null,
} as const satisfies Record<RoomRole, SpecialRegionTag | null>;

const TREASURE_ROOM_RATIO = 0.05;

// Hallway spawn point density: count ≈ HALLWAY_SPAWNS_SCALE * (size / SIZE_SCALE_BASE)²
const HALLWAY_SPAWNS_SCALE = 10;
const HALLWAY_SPAWN_MIN_GAP = 3;
/**
 * Tiles of clearance kept around the start room's own bounds for hallway
 * spawns, on every floor. Exported so a headless check can assert the same
 * boundary the generator enforces rather than restating it.
 */
export const START_ROOM_HALLWAY_SPAWN_MARGIN_TILES = 4;

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

function corridorFloorForZone(zone: Zone): number {
  if (zone === 'entrance') return FloorTypeValue.concrete;
  if (zone === 'mid') {
    return worldRandom() < MID_ZONE_CONCRETE_PROB
      ? FloorTypeValue.concrete
      : FloorTypeValue.tile_floor;
  }
  // deep: darker, worn floors
  return worldRandom() < DEEP_ZONE_TILE_PROB ? FloorTypeValue.tile_floor : FloorTypeValue.wood;
}

/**
 * Seats up to `count` stairwells over a candidate pool by farthest-point
 * sampling: each addition goes to whichever candidate is currently most isolated
 * from the ones already seated, so the set spreads across the pool instead of
 * packing into whichever end the caller's sort happens to visit first. The first
 * is seeded at random: callers sort by distance from the boss exit, so seeding
 * from either end would bring back the perimeter bias the distance ceiling
 * exists to remove.
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
  alreadySeated: readonly Point[] = [],
): Point[] {
  if (candidates.length === 0) return [...alreadySeated];
  const seedIndex = Math.floor(worldRandom() * candidates.length);
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

// ── Boss floor selection ──────────────────────────────────────────────────────

const BOSS_ROOM_FLOOR = {
  trash_gremlin: TRASH_GREMLIN_FLOOR,
  kraken: FLOODED_PUMP_ROOM_FLOOR,
  electric_goblin: POWER_LAB_FLOOR,
  big_rooster: GYM_FLOOR,
} as const satisfies Record<GauntletBossType, number>;

/**
 * Boss room floors that name no ground material of their own, and the
 * material they are laid in. The flooded pump room is bare concrete under its
 * water; its dressing paints everything else.
 */
const BOSS_ROOM_FLOOR_GROUND: ReadonlyMap<number, number> = new Map([
  [FLOODED_PUMP_ROOM_FLOOR, FloorTypeValue.concrete],
]);

// ── Safe-room thresholds ──────────────────────────────────────────────────────

/** The band each safe-room floor is worn or painted into at its doorways. */
const THRESHOLD_FOR_FLOOR: ReadonlyMap<number, number> = new Map([
  [SAFE_ROOM_FLOOR, SAFE_ROOM_THRESHOLD],
  [LAB_STATION_FLOOR, LAB_STATION_THRESHOLD],
]);

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
 * Dave's tile and the bed's are skipped: they are the room's fixed furniture
 * and the band would otherwise be drawn under them in a narrow room. The
 * doctor's cabinet is *not* skipped, and does not need to be — it is stamped
 * later with `placeProp`, which records the floor it replaced, so the cabinet
 * stands on whatever the band left there.
 */
function stampSafeRoomThresholds(
  grid: TileContent[][],
  safeRoom: { bounds: Rect; centre: Point },
): void {
  const { bounds } = safeRoom;
  const fixtures = guideAndBedTiles(safeRoom);
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
        const threshold = THRESHOLD_FOR_FLOOR.get(grid[y][x].type);
        if (threshold === undefined) continue;
        grid[y][x].type = threshold;
      }
    }
  }
}

/** A corridor's tiles as a lookup, keyed the way every other tile set in the game is. */
function corridorTileKeys(tiles: ReadonlyArray<Point>): Set<number> {
  return new Set(tiles.map((tile) => tileCoordKey(tile.x, tile.y)));
}

/**
 * Where the quest room's Fuzzy Nightmare grates go.
 *
 * The room is a pass-through with a doorway on two or more walls, so fixed
 * columns could put a grate in the mouth of one. Walls with no doorway are
 * preferred, each takes an even share of the grates spread along it a fixed
 * inset inside the wall, and a spot too close to a doorway in that same wall,
 * or touching a grate already placed, is passed over for the next wall — so nothing lands where a corridor arrives
 * and the goblin mother at the centre always has a clear approach.
 *
 * When the planned spots run out, every tile along each wall's inset line is
 * swept, first those clear of doorways and then any. Grates never touch, even
 * in that sweep: two touching grates' barriers would overlap and one
 * Fuzzy Nightmare breach would open both.
 */
function questGrateTiles(
  bounds: Rect,
  doorways: ReadonlyArray<RoomDoorway>,
  grateCount: number,
): Point[] {
  const doorwayWalls = new Set(doorways.map((doorway) => doorway.wall));
  const walls = ROOM_WALL_OUTWARD.map((side) => side.wall);
  const ranked = [
    ...walls.filter((wall) => !doorwayWalls.has(wall)),
    ...walls.filter((wall) => doorwayWalls.has(wall)),
  ];
  const perWall = Math.ceil(grateCount / QUEST_GRATE_WALLS);
  const offsets = evenlySpacedOffsets(perWall, QUEST_GRATE_SPREAD);

  const centreX = Math.floor(bounds.x + bounds.w / 2);
  const centreY = Math.floor(bounds.y + bounds.h / 2);
  const lastX = bounds.x + bounds.w - 1;
  const lastY = bounds.y + bounds.h - 1;
  const alongWall = (wall: RoomWall, tile: Point): number =>
    wall === 'north' || wall === 'south' ? tile.x : tile.y;
  const tooCloseToDoorway = (wall: RoomWall, tile: Point): boolean =>
    doorways.some(
      (doorway) =>
        doorway.wall === wall &&
        doorway.tiles.some(
          (doorTile) =>
            Math.abs(alongWall(wall, doorTile) - alongWall(wall, tile)) <
            QUEST_GRATE_DOORWAY_CLEARANCE,
        ),
    );

  const tiles: Point[] = [];
  // Two walls that meet at a corner would otherwise put their end grates
  // diagonally touching, and one barrier's boards would overhang the other.
  const touchesChosenGrate = (tile: Point): boolean =>
    tiles.some(
      (chosen) =>
        Math.max(Math.abs(chosen.x - tile.x), Math.abs(chosen.y - tile.y)) <
        QUEST_GRATE_MIN_SEPARATION,
    );
  const insetTile = (wall: RoomWall, along: number): Point =>
    wall === 'north'
      ? { x: along, y: bounds.y + QUEST_GRATE_WALL_INSET }
      : wall === 'south'
        ? { x: along, y: lastY - QUEST_GRATE_WALL_INSET }
        : wall === 'west'
          ? { x: bounds.x + QUEST_GRATE_WALL_INSET, y: along }
          : { x: lastX - QUEST_GRATE_WALL_INSET, y: along };

  for (const wall of ranked) {
    const wallCentre = wall === 'north' || wall === 'south' ? centreX : centreY;
    let takenOnWall = 0;
    for (const offset of offsets) {
      if (tiles.length >= grateCount || takenOnWall >= perWall) break;
      const tile = insetTile(wall, wallCentre + offset);
      if (tooCloseToDoorway(wall, tile) || touchesChosenGrate(tile)) continue;
      tiles.push(tile);
      takenOnWall++;
    }
  }

  for (const keepClearOfDoorways of [true, false]) {
    for (const wall of ranked) {
      const runsAlongX = wall === 'north' || wall === 'south';
      const firstAlong = (runsAlongX ? bounds.x : bounds.y) + QUEST_GRATE_WALL_INSET;
      const lastAlong = (runsAlongX ? lastX : lastY) - QUEST_GRATE_WALL_INSET;
      for (let along = firstAlong; along <= lastAlong; along++) {
        if (tiles.length >= grateCount) return tiles;
        const tile = insetTile(wall, along);
        if (keepClearOfDoorways && tooCloseToDoorway(wall, tile)) continue;
        if (touchesChosenGrate(tile)) continue;
        tiles.push(tile);
      }
    }
  }
  return tiles;
}

/** `count` whole offsets spread evenly from `-spread` to `spread`; a lone one sits on the midline. */
function evenlySpacedOffsets(count: number, spread: number): number[] {
  if (count <= 1) return [0];
  const step = (spread * 2) / (count - 1);
  return Array.from({ length: count }, (_, index) => Math.round(-spread + step * index));
}

// ── Main generator ────────────────────────────────────────────────────────────

/** Everything the generator needs except the map's side length. */
export interface DungeonLevelOptions {
  /** One boss room per entry, in order; a boss room is always sized for its boss. */
  bossTypes: readonly GauntletBossType[];
  numStairwellsOverride?: number;
  stairwellCountMultiplier?: number;
  hasSpiderLab?: boolean;
  /** When present, forced-progression mode replaces free room placement. */
  progression?: ProgressionDef;
  /** Grates cut into the defense quest's room. Defaults to the base nursery's four. */
  questGrateCount?: number;
  /** Which floor's room characters the rooms are dressed from. Defaults to the cellars'. */
  floorTheme?: DungeonFloorThemeId;
  /**
   * False builds the floor with characters assigned but no props placed. Every
   * other draw is unchanged, so a harness can generate a seed both ways and
   * prove the props never cost a layout its acceptance.
   */
  placeProps?: boolean;
}

export interface GenerateDungeonOptions extends DungeonLevelOptions {
  size: number;
}

/**
 * Safe rooms carved on a free-roam floor. Progression floors ignore it and
 * derive their own count from the gauntlets plus `scatterSafeRooms`.
 */
const FREE_ROAM_SAFE_ROOM_COUNT = 2;

function rectOfRoom(room: { x: number; y: number; w: number; h: number }): Rect {
  return { x: room.x, y: room.y, w: room.w, h: room.h };
}

/** The room sizes drawn for one gauntlet's head, its boss room from the size table. */
function gauntletRoomSizes(
  bossType: GauntletBossType,
  drawSize: () => { w: number; h: number },
): GauntletRoomSizes {
  const safe = drawSize();
  const exit = drawSize();
  const boss = BOSS_ROOM_SIZE[bossType];
  return {
    safeRoomW: safe.w,
    safeRoomH: safe.h,
    bossRoomW: boss.w,
    bossRoomH: boss.h,
    exitSafeRoomW: exit.w,
    exitSafeRoomH: exit.h,
  };
}

/** The stealth gate room a spine seated, with the corridors it is entered and left by. */
interface PlannedStealthGate {
  rect: Rect;
  chainIndex: number;
  entryTiles: Set<number>;
  exitTiles: Set<number>;
}

/** What building one gauntlet seated beyond its rooms, for the floor-wide records. */
interface GauntletBuild {
  /** The quest room's choke record and the corridor it is entered by, when this gauntlet seated it. */
  questChoke: { entryTiles: Set<number>; data: QuestChokeData } | null;
  stealthGate: PlannedStealthGate | null;
  seatedBathrooms: boolean;
  seatedSpine: boolean;
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
    numStairwellsOverride,
    stairwellCountMultiplier = 1,
    bossTypes,
    hasSpiderLab = false,
    progression,
    questGrateCount = BASE_NURSERY_GRATE_COUNT,
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
  /** The corridor kind that first carved each tile, for the region map. */
  const corridorKindByTile = new Map<number, HallwayKind>();
  const recordCorridorTile = (x: number, y: number, kind: HallwayKind): void => {
    hallwayTiles.push({ x, y });
    corridorKindByTile.set(tileCoordKey(x, y), kind);
  };

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
    kind: HallwayKind,
  ) => {
    const minX = Math.min(x1, x2);
    const maxX = Math.max(x1, x2);
    for (let hx = minX; hx <= maxX; hx++) {
      for (let off = -halfWidth; off <= halfWidth; off++) {
        const hy = y1 + off;
        if (hy >= BORDER && hy < size - BORDER && grid[hy][hx].type === FloorTypeValue.wall) {
          grid[hy][hx].type = floorType;
          recordCorridorTile(hx, hy, kind);
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
          recordCorridorTile(hx, hy, kind);
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
            recordCorridorTile(nx, ny, 'nook');
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
    carveHallwayCore(x1, y1, x2, y2, halfWidth, floorType, kind);
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
      return worldRandom() < SPECIAL_CONN_STANDARD_PROB ? 'standard' : 'narrow';
    }
    const r = worldRandom();
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

  type Edge = { from: number; to: number };
  const mstEdges: Edge[] = [];

  let startCenter: Point | null = null;
  let progressionLayout: ProgressionLayoutData | undefined;
  let lastGauntletExitBounds: Rect | null = null;
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
  /**
   * Every bathroom the gauntlets seated, with the tiles of the corridor each is
   * entered by, for the reason `questChokeEntryTiles` is kept.
   */
  const plannedBathrooms: Array<PlannedBathroom & { entryTiles: Set<number> }> = [];
  let bathroomGauntletIndex: number | null = null;
  /**
   * The stealth gate room the spine seated, with the tiles of the corridors it
   * is entered and left by, for the reason `questChokeEntryTiles` is kept.
   */
  let plannedStealthGate: PlannedStealthGate | null = null;
  /** Every gauntlet's flooded corridor, laid out and waiting to be flooded once the floor is built. */
  const plannedFloodedApproaches: FloodedApproachData[] = [];
  /** Indices into `rooms` of the free region past the last gauntlet: the only rooms a stairwell may stand in. */
  const freeRegionRoomIndices: number[] = [];

  const carveRoomFloor = (rect: Rect, floor: number): void => {
    const ground = BOSS_ROOM_FLOOR_GROUND.get(floor);
    for (let ry = rect.y; ry < rect.y + rect.h; ry++) {
      for (let rx = rect.x; rx < rect.x + rect.w; rx++) {
        grid[ry][rx].type = floor;
        if (ground !== undefined) grid[ry][rx].groundType = ground;
      }
    }
  };

  /** Carves planned corridor tiles, leaving any already-carved tile alone. */
  const carveCorridorTiles = (
    tiles: ReadonlyArray<Point>,
    floorType: number,
    kind: HallwayKind,
  ): void => {
    for (const tile of tiles) {
      if (grid[tile.y]?.[tile.x]?.type !== FloorTypeValue.wall) continue;
      grid[tile.y][tile.x].type = floorType;
      recordCorridorTile(tile.x, tile.y, kind);
    }
  };

  const addRoom = (rect: Rect, floor: number, role: RoomRole, tags: RoomTags = {}): number => {
    rooms.push({ x: rect.x, y: rect.y, w: rect.w, h: rect.h, floor, role, ...tags });
    carveRoomFloor(rect, floor);
    return rooms.length - 1;
  };

  /** Spine bookkeeping the layout data and the validators read; filled by a spine route. */
  const spineChainBounds: Rect[] = [];
  const spineLanes: Array<{ forkIndex: number; rooms: Rect[] }> = [];
  let spineGauntletIndex: number | null = null;

  if (progression !== undefined) {
    const segments = new SegmentMap(size, BORDER);

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
      carveCorridorTiles(
        corridor.tiles,
        corridorFloorForZone(zoneOf(corridor.target)),
        corridor.kind,
      );
    };
    const drawRoomSize = (): { w: number; h: number } => ({
      w: randomInt(MIN_W, MAX_W),
      h: randomInt(MIN_H, MAX_H),
    });

    // ── Gauntlets ───────────────────────────────────────────────────────────

    // One nursery per floor. A gauntlet's flag and a spine route both seat a
    // quest room, but the generator carries a single `questChoke` and finds the
    // room with a single `role === 'quest'` lookup — so a second request would
    // pair the first room with the second choke's entry corridor, leave it with
    // no identifiable way in, and fail every map until the attempt budget threw.
    // Better to say so at the source than to fail forty layouts describing it.
    const chokeRequests = progression.gauntlets.filter(
      (gauntlet) => gauntlet.questChoke === true || gauntlet.route.kind === 'spine',
    ).length;
    if (chokeRequests > 1) {
      throw new Error(
        `a floor may seat one defense-quest choke; this one asks for ${chokeRequests}`,
      );
    }
    // The lab's approach — the station and both hallways — is seated by a
    // spine, so a floor asking for a lab without one is a level-definition bug.
    const spineRoutes = progression.gauntlets.filter((gauntlet) => gauntlet.route.kind === 'spine');
    if (hasSpiderLab && spineRoutes.length !== 1) {
      throw new Error('a spider lab is seated off a spine; this floor needs exactly one');
    }
    if (spineRoutes.length > 1) {
      throw new Error('a floor may route one gauntlet through a spine');
    }

    const gauntletRoomBounds: Rect[][] = [];
    const branchRoomCounts: number[][] = [];
    const gauntletBranchChains: Rect[][][] = [];
    let entryRoom = startRoom;
    let previousHeading: number | null = null;

    /** The rooms every gauntlet seats whatever its route: its head. */
    const addGauntletHead = (gauntlet: GauntletDef, head: GauntletHead): void => {
      addRoom(head.safeRoom, SAFE_ROOM_FLOOR, 'safe', { guardsBossType: gauntlet.bossType });
      addRoom(head.bossRoom, BOSS_ROOM_FLOOR[gauntlet.bossType], 'boss');
      addRoom(head.exitSafeRoom, SAFE_ROOM_FLOOR, 'safe', { followsBossType: gauntlet.bossType });
      if (head.floodedApproach !== null) {
        plannedFloodedApproaches.push({ ...head.floodedApproach, bossType: gauntlet.bossType });
      }
    };

    /**
     * Plans a gauntlet reached by branches, seats its rooms and carves its
     * corridors. Returns false when no layout fit.
     */
    const buildBranchesGauntlet = (
      index: number,
      gauntlet: GauntletDef,
      route: BranchesRoute,
    ): GauntletBuild | null => {
      let plan: GauntletPlan | null = null;
      // The choke slot is drawn once and only yields to the other after the first
      // has genuinely proved unplaceable, for the same reason the branch count
      // is: the approach slot seats less often per attempt than the stem, so
      // redrawing per attempt would put the nursery on the stem nearly always.
      // The stem needs a boss room to hang off, which gauntlet 0 does not have.
      const chokeSlotOrder = chokeSlotsFor(index, gauntlet);
      for (const chokeSlot of chokeSlotOrder) {
        if (plan !== null) break;
        // The drawn branch count survives every geometry retry, and only steps down
        // once this many branches have proved genuinely unplaceable. Redrawing it
        // per attempt would collapse the distribution onto the minimum, because
        // fewer branches are always likelier to fit.
        let branchCount = randomInt(route.branchCount.min, route.branchCount.max);
        while (plan === null && branchCount >= route.branchCount.min) {
          for (let attempt = 0; attempt < MAX_GAUNTLET_ATTEMPTS && plan === null; attempt++) {
            const snapshot = segments.snapshot();
            plan = planGauntlet(segments, {
              index,
              mapSize: size,
              entryRoom,
              previousHeading,
              branchCount,
              branchRooms: route.branchRooms,
              sizes: gauntletRoomSizes(gauntlet.bossType, drawRoomSize),
              choke:
                chokeSlot === undefined
                  ? undefined
                  : { w: QUEST_ROOM_W, h: QUEST_ROOM_H, slot: chokeSlot },
              bathroom: route.bathroomChoke,
              approach: gauntlet.approach,
              pocketSize: drawRoomSize,
              pickCorridorKind,
            });
            if (plan === null) segments.rollback(snapshot);
          }
          if (plan === null) branchCount--;
        }
      }
      if (plan === null) return null;

      for (const count of plan.branchRoomCounts) {
        if (count < route.branchRooms.min || count > route.branchRooms.max) {
          throw new Error(
            `gauntlet ${index} produced a branch of ${count} rooms, outside the configured ` +
              `range ${route.branchRooms.min}–${route.branchRooms.max}`,
          );
        }
      }
      if (
        route.bathroomChoke !== undefined &&
        plan.bathroomRooms.length !== plan.branchChains.length
      ) {
        return null;
      }

      addGauntletHead(gauntlet, {
        safeRoom: plan.safeRoom,
        bossRoom: plan.bossRoom,
        exitSafeRoom: plan.exitSafeRoom,
        corridors: [],
        approachChokeRoom: null,
        approachChokeEntryCorridor: null,
        floodedApproach: plan.floodedApproach,
      });
      for (const rect of plan.chainRooms) {
        addRoom(rect, randomFromArray(ZONE_FLOORS[zoneOf(rectCentre(rect))]), 'chain');
      }
      for (const rect of plan.pockets) {
        addRoom(rect, SAFE_ROOM_FLOOR, 'safe', { isSafeAccessPocket: true });
      }
      for (const bathroom of plan.bathroomRooms) {
        addRoom(bathroom.rect, FloorTypeValue.tile_floor, 'bathroom');
        plannedBathrooms.push({
          ...bathroom,
          entryTiles: corridorTileKeys(bathroom.entryCorridor.tiles),
        });
      }
      const chokeRooms: Rect[] = [];
      let questChoke: GauntletBuild['questChoke'] = null;
      if (plan.chokeRoom !== null && plan.chokeSlot !== null) {
        addRoom(plan.chokeRoom, FloorTypeValue.tile_floor, 'quest');
        chokeRooms.push(plan.chokeRoom);
        // The stem choke sits on the corridor out of the previous gauntlet's
        // boss room; the approach choke sits past this gauntlet's gateway safe
        // room. Both are crossed after every earlier gauntlet's boss.
        questChoke = {
          entryTiles: corridorTileKeys(plan.chokeEntryCorridor?.tiles ?? []),
          data: {
            rank: index,
            gauntletIndex: index,
            blocks: plan.chokeSlot === 'stem' ? 'gatewaySafeRoom' : 'gatewayBossRoom',
          },
        };
      }
      for (const corridor of plan.corridors) carvePlannedCorridor(corridor);

      gauntletRoomBounds.push([
        plan.safeRoom,
        plan.bossRoom,
        plan.exitSafeRoom,
        ...chokeRooms,
        ...plan.chainRooms,
        ...plan.bathroomRooms.map((bathroom) => bathroom.rect),
        ...plan.pockets,
      ]);
      branchRoomCounts.push(plan.branchRoomCounts);
      gauntletBranchChains.push(plan.branchChains);
      entryRoom = plan.exitSafeRoom;
      previousHeading = plan.heading;
      return {
        questChoke,
        stealthGate: null,
        seatedBathrooms: route.bathroomChoke !== undefined,
        seatedSpine: false,
      };
    };

    // A few ordinary dead ends hanging off the chain for the treasure-room pass
    // to draw from. The chain's mandatory safe-access pockets are seated by
    // `planSpine` itself, sized through `safeRoomSize` below.
    const spinePockets: SpinePocketRequest[] = [];

    /**
     * Sites a spine-fed gauntlet's head near the previous exit and threads a
     * spine to its gateway safe room, then seats and carves both. The two are
     * planned together because the spine's far endpoint *is* that safe room: a
     * spine that cannot be seated between this exit and this gateway is
     * answered by moving the gateway rather than by throwing the whole map
     * away. Both live purely in the `SegmentMap` until one pairing works, so a
     * failure rolls back cleanly. Returns the stage that failed when it fails.
     */
    const buildSpineGauntlet = (
      index: number,
      gauntlet: GauntletDef,
      route: SpineRoute,
    ): GauntletBuild | 'spine gateway' | 'spine' => {
      if (index === 0) {
        throw new Error('a spine route leaves the previous gauntlet’s exit; the first has none');
      }
      for (let pocket = 0; pocket < SPINE_TREASURE_POCKETS; pocket++) {
        spinePockets.push(drawRoomSize());
      }
      const spineEntry = entryRoom;
      const entryCentre = rectCentre(spineEntry);
      const isLastGauntlet = index === progression.gauntlets.length - 1;
      const reserveFreeRegion = (exitRoom: Rect, heading: number): boolean => {
        const exitCentre = rectCentre(exitRoom);
        const exitReach = Math.hypot(exitRoom.w / 2, exitRoom.h / 2);
        const reserveReach = FREE_REGION_RESERVE_SPAN_TILES / 2;
        const offset = exitReach + FREE_REGION_RESERVE_GAP_TILES + reserveReach;
        const reserve = rectCentredOn(
          {
            x: Math.round(exitCentre.x + Math.cos(heading) * offset),
            y: Math.round(exitCentre.y + Math.sin(heading) * offset),
          },
          FREE_REGION_RESERVE_SPAN_TILES,
          FREE_REGION_RESERVE_SPAN_TILES,
        );
        return segments.reserveArea(reserve, SEGMENT_FREE_RESERVE);
      };
      let head: GauntletHead | null = null;
      let spinePlan: SpinePlan | null = null;
      let headEverSeated = false;

      for (let siting = 0; siting < MAX_SPINE_GATEWAY_SITINGS && spinePlan === null; siting++) {
        const sitingSnapshot = segments.snapshot();
        head = null;
        for (let sample = 0; sample < SPINE_GATEWAY_PLACEMENT_SAMPLES && head === null; sample++) {
          const sampleSnapshot = segments.snapshot();
          const bearing = worldRandom() * Math.PI * 2;
          const distance = randomInt(SPINE_GATEWAY_DIST_MIN, SPINE_GATEWAY_DIST_MAX);
          head = planGauntletHead(segments, {
            index,
            heading: bearing,
            safeRoomCentre: {
              x: Math.round(entryCentre.x + Math.cos(bearing) * distance),
              y: Math.round(entryCentre.y + Math.sin(bearing) * distance),
            },
            sizes: gauntletRoomSizes(gauntlet.bossType, drawRoomSize),
            approach: gauntlet.approach,
            pickCorridorKind,
          });
          if (head !== null && isLastGauntlet && !reserveFreeRegion(head.exitSafeRoom, bearing)) {
            head = null;
          }
          if (head === null) segments.rollback(sampleSnapshot);
        }
        if (head === null) {
          segments.rollback(sitingSnapshot);
          continue;
        }
        headEverSeated = true;
        const gatewayRoom = head.safeRoom;
        const keepAway = [
          ...rooms
            .filter((room) => room.role === 'safe')
            .map((room) => rectCentre(rectOfRoom(room))),
          rectCentre(gatewayRoom),
          rectCentre(head.exitSafeRoom),
        ];
        for (let spineAttempt = 0; spineAttempt < MAX_SPINE_ATTEMPTS; spineAttempt++) {
          const spineSnapshot = segments.snapshot();
          spinePlan = planSpine(segments, {
            entryRoom: spineEntry,
            exitRoom: gatewayRoom,
            rooms: route.rooms,
            splits: route.splits,
            questRoom: { w: QUEST_ROOM_W, h: QUEST_ROOM_H },
            stealthGate: route.stealthGate ?? null,
            labRoom: hasSpiderLab
              ? {
                  w: SPIDER_LAB_W,
                  h: SPIDER_LAB_H,
                  station: { w: LAB_STATION_W, h: LAB_STATION_H },
                }
              : null,
            pockets: spinePockets,
            safeRoomSize: drawRoomSize,
            safeRoomKeepAway: keepAway,
            safeRoomSeparation: SCATTER_SAFE_ROOM_SEPARATION,
            segmentBase: gauntletSegmentCeiling(progression.gauntlets.length) + 1,
            pickCorridorKind,
          });
          if (spinePlan !== null) break;
          segments.rollback(spineSnapshot);
        }
        if (spinePlan === null) segments.rollback(sitingSnapshot);
      }
      // Named by the stage that failed last: a histogram of rejections that
      // blamed the gateway for a chain that would not thread would send its
      // reader to the wrong planner.
      if (head === null || spinePlan === null) return headEverSeated ? 'spine' : 'spine gateway';

      addGauntletHead(gauntlet, head);
      for (const corridor of head.corridors) carvePlannedCorridor(corridor);

      // Everything the spine seats is carved here in one pass, because the plan
      // claimed its tiles before any of it was drawn: rooms first, so the
      // corridors could be threaded between them, then the corridors, in
      // walking order.
      const spineRooms: Rect[] = [];
      let stealthGate: PlannedStealthGate | null = null;
      let questChoke: GauntletBuild['questChoke'] = null;
      for (const [chainIndex, room] of spinePlan.chain.entries()) {
        spineChainBounds.push(room.rect);
        spineRooms.push(room.rect);
        if (room.kind === 'stealth_gate') {
          addRoom(room.rect, FloorTypeValue.concrete, 'stealth_gate');
          stealthGate = {
            rect: room.rect,
            chainIndex,
            entryTiles: corridorTileKeys(spinePlan.stealthGateEntryCorridor?.tiles ?? []),
            exitTiles: corridorTileKeys(spinePlan.stealthGateExitCorridor?.tiles ?? []),
          };
          continue;
        }
        if (room.kind === 'quest') {
          addRoom(room.rect, FloorTypeValue.tile_floor, 'quest');
          // The spine arrives at this gauntlet's gateway safe room, so the
          // nursery stands where a stem choke would: in front of the gateway.
          questChoke = {
            entryTiles: corridorTileKeys(spinePlan.questEntryCorridor?.tiles ?? []),
            data: { rank: index, gauntletIndex: index, blocks: 'gatewaySafeRoom' },
          };
          continue;
        }
        addRoom(room.rect, randomFromArray(ZONE_FLOORS[zoneOf(rectCentre(room.rect))]), 'chain');
      }
      for (const lane of spinePlan.lanes) {
        spineLanes.push({ forkIndex: lane.forkIndex, rooms: lane.rooms });
        spineRooms.push(...lane.rooms);
        for (const rect of lane.rooms) {
          addRoom(rect, randomFromArray(ZONE_FLOORS[zoneOf(rectCentre(rect))]), 'chain');
        }
      }
      if (spinePlan.lab !== null) {
        addRoom(spinePlan.lab.room, SPIDER_LAB_FLOOR, 'spider_lab');
        addRoom(spinePlan.lab.station, LAB_STATION_FLOOR, 'safe', {
          servesSpecialRoom: 'spider_lab',
        });
        spineRooms.push(spinePlan.lab.room, spinePlan.lab.station);
      }
      for (const pocket of spinePlan.pockets) {
        const centre = rectCentre(pocket.rect);
        if (pocket.role === 'safe') {
          addRoom(pocket.rect, SAFE_ROOM_FLOOR, 'safe', { isSafeAccessPocket: true });
        } else {
          addRoom(pocket.rect, randomFromArray(ZONE_FLOORS[zoneOf(centre)]), 'regular');
        }
        spineRooms.push(pocket.rect);
      }
      for (const corridor of spinePlan.corridors) carvePlannedCorridor(corridor);

      gauntletRoomBounds.push([head.safeRoom, head.bossRoom, head.exitSafeRoom, ...spineRooms]);
      branchRoomCounts.push([]);
      gauntletBranchChains.push([]);
      previousHeading = Math.atan2(
        rectCentre(head.safeRoom).y - entryCentre.y,
        rectCentre(head.safeRoom).x - entryCentre.x,
      );
      entryRoom = head.exitSafeRoom;
      return { questChoke, stealthGate, seatedBathrooms: false, seatedSpine: true };
    };

    for (const [index, gauntlet] of progression.gauntlets.entries()) {
      const route = gauntlet.route;
      let build: GauntletBuild;
      switch (route.kind) {
        case 'branches': {
          const built = buildBranchesGauntlet(index, gauntlet, route);
          if (built === null) return reject(`gauntlet ${index}`);
          build = built;
          break;
        }
        case 'spine': {
          const built = buildSpineGauntlet(index, gauntlet, route);
          if (typeof built === 'string') return reject(built);
          build = built;
          break;
        }
        default: {
          const unhandled: never = route;
          throw new Error(`unknown gauntlet route ${JSON.stringify(unhandled)}`);
        }
      }
      if (build.questChoke !== null) {
        questChokeEntryTiles = build.questChoke.entryTiles;
        questChokeData = build.questChoke.data;
      }
      if (build.stealthGate !== null) plannedStealthGate = build.stealthGate;
      if (build.seatedBathrooms) bathroomGauntletIndex = index;
      if (build.seatedSpine) spineGauntletIndex = index;
    }

    segments.releaseSegment(SEGMENT_FREE_RESERVE);
    const lastGauntletExitRoom = entryRoom;
    lastGauntletExitBounds = lastGauntletExitRoom;
    const lastGauntletExitIndex = rooms.findIndex(
      (r) =>
        r.role === 'safe' &&
        r.followsBossType !== undefined &&
        r.x === lastGauntletExitRoom.x &&
        r.y === lastGauntletExitRoom.y,
    );
    const lastGauntletExitCentre = rectCentre(lastGauntletExitRoom);

    // ── Free region ─────────────────────────────────────────────────────────
    //
    // Every free room is connected the moment it is seated, to the nearest
    // already-connected room that yields a legal corridor. That makes the region
    // a tree rooted at the last gauntlet's exit safe room by construction: nothing
    // here can be reached without clearing that gauntlet's boss.

    const connectableIndices: number[] = [];
    let seedUsed = false;

    const connectFreeRoom = (rect: Rect, isSpecial: boolean): PlannedCorridor | null => {
      const centre = rectCentre(rect);
      const candidates = seedUsed
        ? [...connectableIndices]
        : [lastGauntletExitIndex, ...connectableIndices];
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
          pickCorridorKind(isSpecial || candidateIndex === lastGauntletExitIndex, centre),
        );
        if (corridor === null) continue;
        segments.claimCorridor(corridor.tiles, SEGMENT_FREE);
        mstEdges.push({ from: candidateIndex, to: rooms.length });
        if (candidateIndex === lastGauntletExitIndex) seedUsed = true;
        return corridor;
      }
      return null;
    };

    /**
     * Where a free room is tried. `anywhere` samples the whole map, which on a
     * large open floor spreads the region evenly. `nearRegion` samples around
     * the rooms already seated (the last exit first), for a floor whose free
     * ground is a pocket behind its last boss that uniform samples rarely land
     * in with a corridor that can reach it.
     */
    type FreeRoomSampling = 'anywhere' | 'nearRegion';
    const sampleFreeRoom = (w: number, h: number, sampling: FreeRoomSampling): Rect => {
      if (sampling === 'anywhere') {
        return {
          x: randomInt(BORDER + 1, size - BORDER - w - 2),
          y: randomInt(BORDER + 1, size - BORDER - h - 2),
          w,
          h,
        };
      }
      const anchors = seedUsed
        ? connectableIndices
        : [lastGauntletExitIndex, ...connectableIndices];
      const anchor = rectCentre(rectOfRoom(rooms[randomFromArray(anchors)]));
      const angle = worldRandom() * Math.PI * 2;
      const distance = randomInt(FREE_ROOM_NEAR_DIST_MIN, FREE_ROOM_NEAR_DIST_MAX);
      return rectCentredOn(
        {
          x: Math.round(anchor.x + Math.cos(angle) * distance),
          y: Math.round(anchor.y + Math.sin(angle) * distance),
        },
        w,
        h,
      );
    };

    const placeFreeRoom = (
      w: number,
      h: number,
      role: RoomRole,
      floorFor: (centre: Point) => number,
      accept: (centre: Point) => boolean,
      sampling: FreeRoomSampling = 'anywhere',
    ): number | null => {
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const rect = sampleFreeRoom(w, h, sampling);
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
        const index = addRoom(rect, floorFor(centre), role);
        carvePlannedCorridor(corridor);
        connectableIndices.push(index);
        freeRegionRoomIndices.push(index);
        return index;
      }
      return null;
    };

    const regularFloorFor = (centre: Point): number => randomFromArray(ZONE_FLOORS[zoneOf(centre)]);
    const anyPosition = (): boolean => true;

    // A capped free region is a short stretch past the last boss, so it grows
    // out from the exit as one pocket; an uncapped one spreads over the map.
    const preferredSampling: FreeRoomSampling =
      progression.freeRegionRooms === undefined ? 'anywhere' : 'nearRegion';
    const fallbackSampling: FreeRoomSampling =
      preferredSampling === 'anywhere' ? 'nearRegion' : 'anywhere';
    let freeRegularRooms = 0;
    const fillWithRegularRooms = (limit: number): void => {
      while (rooms.length < limit) {
        const w = randomInt(MIN_W, MAX_W);
        const h = randomInt(MIN_H, MAX_H);
        const placed =
          placeFreeRoom(w, h, 'regular', regularFloorFor, anyPosition, preferredSampling) ??
          placeFreeRoom(w, h, 'regular', regularFloorFor, anyPosition, fallbackSampling);
        if (placed === null) break;
        freeRegularRooms++;
      }
    };

    // A handful of ordinary rooms first, so the big landmarks have somewhere to
    // attach; then the quest room, while there is still open ground for it;
    // then everything else fills the gaps.
    //
    // Every free room, loop edge and dead-end shortcut is past the last
    // gauntlet's exit and joins only other free rooms, so none of them can open
    // a way around a boss or along a spine.
    const freeRegionRoomLimit =
      progression.freeRegionRooms === undefined
        ? maxRooms
        : Math.min(maxRooms, rooms.length + progression.freeRegionRooms);
    fillWithRegularRooms(Math.min(freeRegionRoomLimit, rooms.length + FREE_SEED_ROOMS));
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
          Math.hypot(centre.x - lastGauntletExitCentre.x, centre.y - lastGauntletExitCentre.y) <=
          QUEST_ROOM_MAX_DIST_FROM_EXIT,
      ) === null
    ) {
      return reject('quest room');
    }

    // The outskirts' own safe rooms (floor 1 only) are promoted out of this
    // fill once the free region — loop shortcuts included — is finished, so
    // they can be chosen against the hop distances the player actually walks
    // rather than against a guess made before the last shortcut was cut.
    fillWithRegularRooms(freeRegionRoomLimit);
    if (freeRegularRooms < MIN_FREE_REGULAR_ROOMS) return reject('free region too thin');

    // ── Free-region loops and dead-end rescue ───────────────────────────────
    //
    // Filtered from `connectableIndices` — the rooms `placeFreeRoom` actually
    // seated — rather than scanned by role. A spine's treasure pockets keep the
    // 'regular' role too, so a role scan over every room would hand these passes
    // a room before the last boss and let them carve a `SEGMENT_FREE` shortcut
    // from it straight into the free region, around every boss in between.
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

    // ── Outskirts safe rooms (floor 1 only) ────────────────────────────────
    //
    // Rather than seating dedicated safe-shaped rooms up front — before the
    // loop shortcuts above could shorten a hop count they'd have to guess at
    // — ordinary free rooms already carved are promoted to safe once the
    // region's graph is final, chosen so every outskirts safe room's nearest
    // other one sits within the required hop band, spreading outward from
    // the last gateway's own exit safe room rather than clustering near it.
    if (progression.outskirtsSafeRoomHops === true) {
      const outskirtsGraph = buildRoomGraph(grid, rooms.map(rectOfRoom));
      const outskirtsSafeIndices = new Set<number>([lastGauntletExitIndex]);
      const candidates = new Set<number>(freeRegularIndices);
      for (;;) {
        let best: { index: number; hops: number } | null = null;
        for (const candidateIndex of candidates) {
          const hops = nearestHopDistance(outskirtsGraph, candidateIndex, outskirtsSafeIndices);
          if (hops < OUTSKIRTS_SAFE_ROOM_MIN_HOPS || hops > OUTSKIRTS_SAFE_ROOM_MAX_HOPS) continue;
          if (best === null || hops > best.hops) best = { index: candidateIndex, hops };
        }
        if (best === null) break;
        outskirtsSafeIndices.add(best.index);
        candidates.delete(best.index);
      }
      outskirtsSafeIndices.delete(lastGauntletExitIndex);
      if (outskirtsSafeIndices.size < (progression.scatterSafeRooms ?? 0)) {
        return reject('outskirts safe room hops');
      }
      for (const index of outskirtsSafeIndices) {
        rooms[index].role = 'safe';
        rooms[index].floor = SAFE_ROOM_FLOOR;
        carveRoomFloor(rectOfRoom(rooms[index]), SAFE_ROOM_FLOOR);
      }
    }

    progressionLayout = {
      startRoom,
      gauntletRoomBounds,
      branchRoomCounts,
      gauntletBranchChains,
      roomBounds: rooms.map(rectOfRoom),
      attempts: mapAttempt,
      // Filled in once stairwells have been sited, further down the pipeline.
      stairwellSpacingWaived: false,
      bandedStairwellTiles: [],
      questChoke: questChokeData,
      bathroomGauntletIndex,
      stealthGate:
        plannedStealthGate === null
          ? null
          : { chainIndex: plannedStealthGate.chainIndex, bounds: plannedStealthGate.rect },
      spine:
        spineGauntletIndex === null
          ? null
          : { chain: spineChainBounds, lanes: spineLanes, gauntletIndex: spineGauntletIndex },
    };
  } else {
    const safeRoomStart = 1;
    const safeRoomEnd = 1 + FREE_ROAM_SAFE_ROOM_COUNT;
    const bossRoomStart = safeRoomEnd;
    const bossRoomEnd = safeRoomEnd + bossTypes.length;
    const questRoomIdx = bossRoomEnd;

    const SAFE_MAX_DIST = 50;
    const BOSS_MAX_DIST = 80;
    const SAFE_MIN_SEPARATION = 18;

    for (let attempt = 0; attempt < maxAttempts && rooms.length < maxRooms; attempt++) {
      const isSafeRoom = rooms.length >= safeRoomStart && rooms.length < safeRoomEnd;
      const bossIndex = rooms.length - bossRoomStart;
      const bossType = bossIndex >= 0 ? bossTypes[bossIndex] : undefined;
      const isBossRoom = bossType !== undefined;
      const isQuestRoom = rooms.length === questRoomIdx;
      const { w, h } = isBossRoom
        ? BOSS_ROOM_SIZE[bossType]
        : isQuestRoom
          ? { w: QUEST_ROOM_W, h: QUEST_ROOM_H }
          : { w: randomInt(MIN_W, MAX_W), h: randomInt(MIN_H, MAX_H) };
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
        const maxDist = isSafeRoom
          ? SAFE_MAX_DIST
          : isBossRoom
            ? BOSS_MAX_DIST
            : isQuestRoom
              ? QUEST_MAX_DIST
              : Infinity;
        if (Math.hypot(cx - sc0.x, cy - sc0.y) > maxDist) tooFarFromStart = true;
      }

      if (!overlaps && !tooCloseToBoss && !tooCloseToSafeRoom && !tooFarFromStart) {
        const roomCentre: Point = { x: cx, y: cy };
        const zone: Zone = startCenter !== null ? getZone(roomCentre, startCenter) : 'entrance';

        const floor = isSafeRoom
          ? SAFE_ROOM_FLOOR
          : bossType !== undefined
            ? BOSS_ROOM_FLOOR[bossType]
            : isQuestRoom
              ? FloorTypeValue.tile_floor
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

  // A safe room serving a special room goes last; see `SafeRoomData.servesSpecialRoom`.
  const floorSafeRooms = rooms.filter(
    (r) => r.role === 'safe' && r.servesSpecialRoom === undefined,
  );
  const servingSafeRooms = rooms.filter(
    (r) => r.role === 'safe' && r.servesSpecialRoom !== undefined,
  );
  const safeRooms: SafeRoomData[] = [...floorSafeRooms, ...servingSafeRooms].map((sr) => ({
    bounds: { x: sr.x, y: sr.y, w: sr.w, h: sr.h },
    centre: { x: Math.floor(sr.x + sr.w / 2), y: Math.floor(sr.y + sr.h / 2) },
    guardsBossType: sr.guardsBossType,
    followsBossType: sr.followsBossType,
    isSafeAccessPocket: sr.isSafeAccessPocket,
    servesSpecialRoom: sr.servesSpecialRoom,
  }));

  for (const safeRoom of safeRooms) stampSafeRoomThresholds(grid, safeRoom);
  for (const safeRoom of safeRooms) {
    if (safeRoom.servesSpecialRoom === undefined) continue;
    const kit = planLabStation({
      bounds: safeRoom.bounds,
      centre: safeRoom.centre,
      isOpenOutside: (x, y) => isCarvedFloor(grid, x, y),
    });
    for (const prop of kit) placeProp(grid[prop.y][prop.x], prop.type);
  }

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
    alsoAvoiding: ReadonlyArray<Rect> = [],
  ): Set<RoomDoorway> {
    const size = grid.length;
    const insideRoom = (x: number, y: number): boolean =>
      [bounds, ...alsoAvoiding].some(
        (rect) => x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h,
      );
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

    const grateTiles = questGrateTiles(bounds, doorways, questGrateCount);
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

  const bathroomRooms: BathroomRoomData[] = [];
  const bathroomPlumberBlocks = plumberBlocksOnFloor(progression);
  const insideAnyRoom = (x: number, y: number): boolean =>
    rooms.some((room) => x >= room.x && x < room.x + room.w && y >= room.y && y < room.y + room.h);
  const isOpenFloor = (x: number, y: number): boolean =>
    y >= 0 && y < size && x >= 0 && x < grid[y].length && isWalkableTileType(grid[y][x]);
  for (const planned of plannedBathrooms) {
    const bounds = planned.rect;
    const doorways = roomDoorways(grid, bounds);
    // The way in is the doorway the planned arrival corridor cuts, unless the
    // corridors as built only reach it through a bathroom; see
    // `doorwaysReachableAroundRoom`. Every copy is avoided, not just this one:
    // a doorway reached only by walking through another copy is one the queue
    // there keeps the player from.
    const plannedEntrance =
      doorways.find((doorway) =>
        doorway.tiles.some((tile) => planned.entryTiles.has(tileCoordKey(tile.x, tile.y))),
      ) ?? null;
    const approachable = doorwaysReachableAroundRoom(
      grid,
      startTile,
      bounds,
      doorways,
      plannedBathrooms.map((other) => other.rect),
    );
    const entranceDoorway =
      plannedEntrance !== null && approachable.has(plannedEntrance)
        ? plannedEntrance
        : (doorways.find((doorway) => approachable.has(doorway)) ?? null);
    if (entranceDoorway === null) return reject('bathroom entrance');
    const blockedDoorways = doorways.filter((doorway) => doorway !== entranceDoorway);
    const layout = layOutBathroom({
      bounds,
      entrance: entranceDoorway,
      blocked: blockedDoorways,
      isOpen: isOpenFloor,
      isCorridor: (x, y) => isOpenFloor(x, y) && !insideAnyRoom(x, y),
      plumberBlocks: bathroomPlumberBlocks,
    });
    if (layout === null) return reject('bathroom layout');
    bathroomRooms.push({
      bounds,
      centre: rectCentre(bounds),
      branchIndex: planned.branchIndex,
      entranceTile: entranceDoorway.tile,
      entranceDoorway,
      blockedDoorways,
      ...layout,
    });
  }

  let stealthGateRoom: StealthGateRoomData | null = null;
  if (plannedStealthGate !== null) {
    const planned = plannedStealthGate;
    const bounds = planned.rect;
    const doorways = roomDoorways(grid, bounds);
    // A self-test fault ships the extra doorway its broken rule makes, so the
    // gate's own checks are what catch it.
    const underSelfTest =
      progression?.gauntlets.some(
        (gauntlet) =>
          gauntlet.route.kind === 'spine' && gauntlet.route.stealthGate?.faultForGate !== undefined,
      ) ?? false;
    if (doorways.length !== STEALTH_GATE_DOORWAY_COUNT && !underSelfTest) {
      return reject('stealth gate doorways');
    }
    const touches = (doorway: RoomDoorway, corridorTiles: Set<number>): boolean =>
      doorway.tiles.some((tile) => corridorTiles.has(tileCoordKey(tile.x, tile.y)));
    // The way in is the doorway the arrival corridor cuts, unless the corridors
    // as built only reach it through the room itself; see
    // `doorwaysReachableAroundRoom`. The way on is the one the onward corridor
    // cuts, and with only two doorways it must be the other one.
    const plannedEntrance = doorways.find((doorway) => touches(doorway, planned.entryTiles));
    const approachable = doorwaysReachableAroundRoom(grid, startTile, bounds, doorways);
    const entranceDoorway =
      plannedEntrance !== undefined && approachable.has(plannedEntrance)
        ? plannedEntrance
        : doorways.find((doorway) => approachable.has(doorway));
    const onwardDoorway = doorways.find(
      (doorway) => doorway !== entranceDoorway && touches(doorway, planned.exitTiles),
    );
    if (entranceDoorway === undefined || onwardDoorway === undefined) {
      return reject('stealth gate doorways');
    }
    const layout = layOutStealthGateRoom({
      bounds,
      entrance: entranceDoorway,
      onward: onwardDoorway,
      isOpen: isOpenFloor,
      isWall: (x, y) => grid[y]?.[x]?.type === FloorTypeValue.wall,
    });
    if (layout === null) return reject('stealth gate layout');
    for (const tile of layout.gateTiles) {
      placeProp(grid[tile.y][tile.x], STEALTH_GATE_CLOSED);
    }
    stealthGateRoom = {
      bounds,
      centre: rectCentre(bounds),
      chainIndex: planned.chainIndex,
      entranceTile: entranceDoorway.tile,
      entranceDoorway,
      onwardDoorway,
      ...layout,
    };
  }

  // Spider lab room data
  let spiderLabRoom: SpiderLabRoomData | null = null;
  const spiderLabIdx = rooms.findIndex((r) => r.role === 'spider_lab');
  if (spiderLabIdx >= 0) {
    const slr = rooms[spiderLabIdx];
    const slcx = Math.floor(slr.x + slr.w / 2);
    const slcy = Math.floor(slr.y + slr.h / 2);

    // The computer and Dr. Moult's post go near the way in, and the egg and life
    // machines as far from it as the room allows, so the layout has to know
    // which wall the corridor actually broke through.
    const entrance = detectRoomEntrance(grid, { x: slr.x, y: slr.y, w: slr.w, h: slr.h });
    const entranceWall = entrance.wall;

    const entranceTile = entrance.tile;
    let spiderEggTile: Point;
    let lifeMachineTiles: Point[];

    if (entranceWall === 'south') {
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

    const labBounds = { x: slr.x, y: slr.y, w: slr.w, h: slr.h };
    const entranceDoorway = roomDoorways(grid, labBounds).find((doorway) =>
      doorway.tiles.some((tile) => tile.x === entranceTile.x && tile.y === entranceTile.y),
    );
    // Only the spine seats a lab, and it always seats the lab's station with it.
    const station = safeRooms.find((room) => room.servesSpecialRoom === 'spider_lab');
    if (station === undefined) return reject('spider lab station');
    const approach = layOutLabApproach(
      grid,
      { tiles: entranceDoorway?.tiles ?? [entranceTile] },
      labBounds,
      station.bounds,
      rooms.map(rectOfRoom),
    );
    if (approach === null) return reject('spider lab approach');
    const furniture = layOutSpiderLab({
      bounds: labBounds,
      entranceWall,
      doorwayTiles: entranceDoorway?.tiles ?? [entranceTile],
      spiderEggTile,
      lifeMachineTiles,
    });
    for (const tile of [...furniture.computerTableTiles, ...furniture.benchTiles]) {
      placeProp(grid[tile.y][tile.x], LAB_BENCH);
    }
    for (const tile of furniture.shelfTiles) placeProp(grid[tile.y][tile.x], LAB_SHELF);
    for (const tile of furniture.webTiles) placeProp(grid[tile.y][tile.x], LAB_WEB);

    spiderLabRoom = {
      bounds: labBounds,
      centre: { x: slcx, y: slcy },
      entranceTile,
      spiderEggTile,
      lifeMachineTiles,
      entranceWall,
      ...furniture,
      ...approach,
      stationBounds: station.bounds,
    };
    registerSpiderLabFloorPlan(grid, spiderLabRoom);
  }

  // 7. Stairwells
  const regularRooms = regularRoomIndices.map((i) => rooms[i]);
  const stairwellTiles: Point[] = [];
  const baseStairwellCount =
    numStairwellsOverride ?? Math.max(1, Math.floor(regularRooms.length / ROOMS_PER_STAIRWELL));
  const stairwellCount = Math.max(1, Math.round(baseStairwellCount * stairwellCountMultiplier));

  if (progression !== undefined && lastGauntletExitBounds !== null) {
    // A stairwell must never be in sight of the last gauntlet's exit safe room, and two
    // stairwells must never be found in the same sweep of the free region — the
    // hunt for the stairs is the point of the post-gauntlet stretch.
    //
    // Drawn from the free region's own rooms rather than from every ordinary
    // room: a spine's treasure pockets are ordinary rooms too, and a stairwell
    // in one would sit in front of the last boss.
    const stairwellRoomPool = freeRegionRoomIndices
      .map((index) => rooms[index])
      .filter((room) => room.role === 'regular');
    const stairwellSeparation = STAIRWELL_MIN_SEPARATION;
    const exitBounds = lastGauntletExitBounds;
    const byDistanceFromExit = stairwellRoomPool
      .map((r) => ({ x: Math.floor(r.x + r.w / 2), y: Math.floor(r.y + r.h / 2) }))
      .sort((a, b) => distanceToRect(b, exitBounds) - distanceToRect(a, exitBounds));
    const beyondMinDistance = byDistanceFromExit.filter(
      (centre) => distanceToRect(centre, exitBounds) >= STAIRWELL_MIN_DIST_FROM_GAUNTLET_EXIT,
    );
    // The ceiling is what keeps the stairs off the perimeter: "as far from the
    // exit as possible" is maximised at the map's corners, which is precisely the
    // sweep a player never makes.
    const insideBand = beyondMinDistance.filter(
      (centre) => distanceToRect(centre, exitBounds) <= STAIRWELL_MAX_DIST_FROM_GAUNTLET_EXIT,
    );
    const bandHoldsEnoughRooms = insideBand.length >= stairwellCount;
    const seatedInsideBand = bandHoldsEnoughRooms
      ? seatStairwellsByIsolation(insideBand, stairwellCount, stairwellSeparation)
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
          seatedInsideBand,
        );
    // Keeping the banded picks can itself box out the wider pool: a set clustered
    // near the exit leaves the rest of the floor less room to spread into. So a
    // set still short of the count is raced against one seeded from the wide pool
    // alone, and the fuller of the two takes the floor.
    const widenedAlone =
      widenedFromBand.length < stairwellCount
        ? seatStairwellsByIsolation(beyondMinDistance, stairwellCount, stairwellSeparation)
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
    for (let dy = 0; dy < STAIRWELL_FOOTPRINT_SPAN; dy++) {
      for (let dx = 0; dx < STAIRWELL_FOOTPRINT_SPAN; dx++) {
        stairwellBlockedSet.add(`${s.x + dx},${s.y + dy}`);
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
  // A spine floor has far fewer ordinary rooms than a large free region does —
  // its dead-end pockets and a small free region are the whole supply — so a
  // share of that count would leave the floor with a single chest.
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
    const j = Math.floor(worldRandom() * (i + 1));
    [shuffledEligible[i], shuffledEligible[j]] = [shuffledEligible[j], shuffledEligible[i]];
  }
  const selectedTreasureRooms = shuffledEligible.slice(0, treasureRoomTarget);

  const treasureRooms: TreasureRoomData[] = selectedTreasureRooms.map((r) => {
    const cx = Math.floor(r.x + r.w / 2);
    const cy = Math.floor(r.y + r.h / 2);
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
  // The radius above is measured from every room's centre, which clears a
  // square start room but not a rectangular one: a corner doorway can sit
  // outside a 5-tile circle from centre while still being a step off the
  // room's own wall, close enough that a hallway rat spawned there wanders in
  // before the floor's arrival beat has finished playing. `rooms[0]` is always
  // the start room in both the forced-progression and the free-roam builder.
  const startRoom = rooms[0];
  const inStartRoomMargin = (x: number, y: number): boolean =>
    x >= startRoom.x - START_ROOM_HALLWAY_SPAWN_MARGIN_TILES &&
    x < startRoom.x + startRoom.w + START_ROOM_HALLWAY_SPAWN_MARGIN_TILES &&
    y >= startRoom.y - START_ROOM_HALLWAY_SPAWN_MARGIN_TILES &&
    y < startRoom.y + startRoom.h + START_ROOM_HALLWAY_SPAWN_MARGIN_TILES;
  // A bathroom's queue spills into its corridors, and a rat set down on a tile
  // the queue blocks would start inside ground it cannot walk.
  // Every tile of a flooded corridor and its barrel seat: kept at full width
  // and clear of props, signs and hallway spawns, so the approach's staging
  // always has the whole corridor to work with.
  const floodedApproachKeepClear = plannedFloodedApproaches.flatMap((approach) =>
    [...floodedTileDepths(approach).values()].map(({ tile }) => tile),
  );
  const bathroomTileKeys = new Set(
    [
      ...bathroomRooms.flatMap(bathroomStandingTiles),
      ...stealthGateKeepClear(stealthGateRoom),
      ...floodedApproachKeepClear,
    ].map((tile) => tileCoordKey(tile.x, tile.y)),
  );
  const validHallway = hallwayTiles.filter(
    (t) =>
      !nearRoomSet.has(t.y * size + t.x) &&
      !inStartRoomMargin(t.x, t.y) &&
      !bathroomTileKeys.has(tileCoordKey(t.x, t.y)),
  );
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

  const claimedTiles = new Set<number>();
  const claim = (tile: Point): void => {
    claimedTiles.add(tileCoordKey(tile.x, tile.y));
  };
  const crawlerSigns: PlannedCrawlerSign[] = [];
  if (progression !== undefined && progressionLayout !== undefined) {
    for (const stairwell of stairwellTiles) {
      for (let dy = 0; dy < STAIRWELL_FOOTPRINT_SPAN; dy++) {
        for (let dx = 0; dx < STAIRWELL_FOOTPRINT_SPAN; dx++) {
          claim({ x: stairwell.x + dx, y: stairwell.y + dy });
        }
      }
    }
    for (const list of [
      mobSpawnPoints,
      hallwaySpawnPoints,
      stairwellTiles,
      [startTile],
      treasureRooms.map((room) => room.centre),
      safeRooms.map((room) => room.centre),
      bossRooms.map((room) => room.centre),
      floodedApproachKeepClear,
      questRooms.flatMap((quest) => [
        quest.entranceTile,
        quest.npcTile,
        quest.woodPileTile,
        ...quest.grateTiles,
        ...quest.exitDoorTiles,
      ]),
      bathroomRooms.flatMap(bathroomStandingTiles),
      stealthGateKeepClear(stealthGateRoom),
      stealthGateWallArtTiles(stealthGateRoom),
      spiderLabRoom === null
        ? []
        : [
            spiderLabRoom.entranceTile,
            spiderLabRoom.labPostTile,
            spiderLabRoom.hallwayPostTile,
            spiderLabRoom.computerTile,
            spiderLabRoom.spiderEggTile,
            ...spiderLabRoom.lifeMachineTiles,
            ...spiderLabRoom.computerTableTiles,
            ...spiderLabRoom.benchTiles,
            ...spiderLabRoom.shelfTiles,
            ...spiderLabRoom.webTiles,
            ...spiderLabRoom.cocoonTiles,
          ],
    ]) {
      for (const tile of list) claim(tile);
    }
  }

  // ── Room dressing ─────────────────────────────────────────────────────────

  // Dressing comes after every placement the floor is built from, so none of
  // them ever reads where a prop stands; only the crawler signs, which choose
  // no geometry and draw no randomness, are planned after it. It draws exactly
  // one number from the world stream and runs on streams of its own from
  // there, so a change to a character table leaves this attempt's layout and
  // spawns as they were. It can still change the floor if it ever makes an
  // attempt fail validation, because the retry then draws a different layout;
  // `verify:dungeon-placement` checks that dressing never does.
  const dressingSeed = Math.floor(worldRandom() * UINT32_SPAN);
  const characterRng = mulberry32(dressingSeed);
  const placementRng = mulberry32(dressingSeed ^ PLACEMENT_STREAM_SALT);
  const hallwayRng = mulberry32(dressingSeed ^ HALLWAY_STREAM_SALT);
  const floorTheme = options.floorTheme ?? DEFAULT_DUNGEON_FLOOR_THEME;
  const placeProps = options.placeProps ?? true;

  const dressingReserved = new Set<number>();
  for (const list of [
    [startTile],
    mobSpawnPoints,
    hallwaySpawnPoints,
    treasureRooms.map((room) => room.centre),
    floodedApproachKeepClear,
    bathroomRooms.flatMap(bathroomStandingTiles),
    stealthGateKeepClear(stealthGateRoom),
  ]) {
    for (const tile of list) dressingReserved.add(tileCoordKey(tile.x, tile.y));
  }
  // A door tile is a dead end, so a prop on its approach strands nothing else
  // and would pass every connectivity check while sealing the door.
  const prisonDoorKeepClear = doorwayKeepClearTiles(
    stealthGateRoom === null ? [] : [prisonBuildingEntry(stealthGateRoom)],
  );
  const isDressingReserved = (x: number, y: number): boolean =>
    dressingReserved.has(tileCoordKey(x, y)) ||
    prisonDoorKeepClear.has(tileKey(x, y)) ||
    stairwellBlockedSet.has(`${x},${y}`);

  const roomAssignments: Array<RegionAssignment | null> = rooms.map((room) => {
    const tag = SPECIAL_ROLE_TAGS[room.role];
    return tag === null ? null : { type: 'special', tag };
  });
  for (const index of populatedRoomIndices) {
    const room = rooms[index];
    const bounds = rectOfRoom(room);
    const zone = getZone(rectCentre(bounds), sc);
    const assignment = rollRoomCharacter(floorTheme, zone, characterRng);
    roomAssignments[index] = assignment;
    if (assignment === null || !placeProps) continue;
    dressRoom(
      grid,
      {
        bounds,
        floor: room.floor,
        zone,
        doorways: roomDoorways(grid, bounds),
        isReserved: isDressingReserved,
        wouldSplitRoom: (x, y) => blockingWouldSplitRoom(grid, rectOfRoom(room), [{ x, y }]),
      },
      assignment,
      placementRng,
    );
  }
  // On a stream of its own, so furnishing a special room never moves a prop
  // in a populated room.
  const specialRoomRng = mulberry32(dressingSeed ^ SPECIAL_ROOM_STREAM_SALT);
  for (const room of rooms) {
    const tag = SPECIAL_ROLE_TAGS[room.role];
    if (tag === null || !placeProps) continue;
    const bounds = rectOfRoom(room);
    dressSpecialRoom(
      grid,
      {
        bounds,
        floor: room.floor,
        zone: getZone(rectCentre(bounds), sc),
        doorways: roomDoorways(grid, bounds),
        isReserved: isDressingReserved,
        wouldSplitRoom: (x, y) => blockingWouldSplitRoom(grid, rectOfRoom(room), [{ x, y }]),
      },
      SPECIAL_REGION_LIGHTING[tag],
      SPECIAL_REGION_PROPS[floorTheme][tag] ?? [],
      specialRoomRng,
    );
  }
  // Fitted from the room's own layout rather than rolled, so it draws nothing
  // from any stream.
  for (const bathroom of placeProps ? bathroomRooms : []) {
    const room = rooms.find(
      (candidate) =>
        candidate.role === 'bathroom' &&
        candidate.x === bathroom.bounds.x &&
        candidate.y === bathroom.bounds.y,
    );
    if (room !== undefined) dressBathroom(grid, bathroom, room.floor, bathroomPlumberBlocks);
  }

  // Built from the finished grid so every carve, pocket and door above is in
  // it. Free-roam floors skip it: they publish no room list for its ids to
  // index into.
  const treasureRoomSet = new Set<Room>(selectedTreasureRooms);
  const regionMap =
    progressionLayout === undefined
      ? RegionMap.empty()
      : buildRegionMap({
          grid,
          rooms: rooms.map((room) => ({
            bounds: rectOfRoom(room),
            role: room.role,
            treasure: treasureRoomSet.has(room),
            floor: room.floor,
          })),
          corridorKindAt: (x, y) => corridorKindByTile.get(tileCoordKey(x, y)),
          zoneOf: (point) => getZone(point, sc),
          labApproachTiles:
            spiderLabRoom === null
              ? undefined
              : new Set(
                  [...spiderLabRoom.outerHallwayTiles, ...spiderLabRoom.innerHallwayTiles].map(
                    (tile) => tileCoordKey(tile.x, tile.y),
                  ),
                ),
        });

  // Dressed after the region map is built, because a hallway segment only
  // exists as one once corridors are split into segments. A prop placed here
  // keeps its segment's id, as a prop in a room keeps the room's.
  // A stream of its own, so the approach's scatter never moves a prop in any
  // other hallway.
  const labHallwayRng = mulberry32(dressingSeed ^ LAB_HALLWAY_STREAM_SALT);
  const hallwayAssignments = regionMap.hallways.map((hallway) => {
    const assignment = rollHallwayCharacter(floorTheme, hallway, characterRng);
    if (assignment?.type === 'special' && assignment.tag === 'lab_hallway' && placeProps) {
      const lab = spiderLabRoom;
      if (lab !== null) {
        dressLabHallway(
          grid,
          {
            hallway,
            isReserved: (x, y) => isDressingReserved(x, y) || claimedTiles.has(tileCoordKey(x, y)),
            decayAt: (x, y) => labHallwayDecayAt(lab, x, y),
          },
          labHallwayRng,
        );
      }
    }
    if (assignment?.type === 'hallway' && placeProps) {
      dressHallway(
        grid,
        {
          hallway,
          corridorKindAt: (x, y) => corridorKindByTile.get(tileCoordKey(x, y)),
          isReserved: (x, y) => isDressingReserved(x, y) || claimedTiles.has(tileCoordKey(x, y)),
          isRoomTile: (x, y) => regionMap.roomIndexAt(x, y) !== NO_REGION,
        },
        assignment.character,
        hallwayRng,
      );
    }
    return assignment;
  });
  // Planned on the dressed floor, props and all, so every route length a
  // sign's trap rule measures is the one a crawler walks.
  if (progression !== undefined && progressionLayout !== undefined) {
    // A tile whose type is no longer its room's floor was stamped by a fixture,
    // a prop or a vignette; none of those record themselves anywhere else.
    for (const room of rooms) {
      for (let y = room.y; y < room.y + room.h; y++) {
        for (let x = room.x; x < room.x + room.w; x++) {
          if (grid[y]?.[x]?.type !== room.floor) claimedTiles.add(tileCoordKey(x, y));
        }
      }
    }
    for (const [y, row] of grid.entries()) {
      for (const [x, tile] of row.entries()) {
        if (!isBlockingDressingTile(tile)) continue;
        for (let dy = -BLOCKING_CLEARANCE_TILES; dy <= BLOCKING_CLEARANCE_TILES; dy++) {
          for (let dx = -BLOCKING_CLEARANCE_TILES; dx <= BLOCKING_CLEARANCE_TILES; dx++) {
            claimedTiles.add(tileCoordKey(x + dx, y + dy));
          }
        }
      }
    }

    const signPlacements = planCrawlerSigns({
      grid,
      rooms: rooms.map((room) => ({
        ...rectOfRoom(room),
        eligible: SIGN_ROOM_ROLES.has(room.role),
      })),
      startRoom: progressionLayout.startRoom,
      goalRooms: bossRooms.map((boss) => boss.bounds),
      claimedTiles,
    });
    if (signPlacements === null) return reject('crawler signs never settled');

    const spawnLists: ReadonlyArray<ReadonlyArray<Point>> = [
      mobSpawnPoints,
      hallwaySpawnPoints,
      treasureRooms.map((room) => room.centre),
    ];
    for (const placement of signPlacements) {
      for (const tile of crawlerSignFootprint(placement.tile)) {
        const target = grid[tile.y][tile.x];
        const pocketFloor = placement.pocketFloor;
        const owner = rooms.find(
          (room) =>
            tile.x >= room.x &&
            tile.x < room.x + room.w &&
            tile.y >= room.y &&
            tile.y < room.y + room.h,
        );
        const heldDecoration =
          pocketFloor === null
            ? owner?.floor !== target.type
            : owner !== undefined || target.type !== FloorTypeValue.wall;
        const onSpawn = spawnLists.some((list) =>
          list.some((point) => point.x === tile.x && point.y === tile.y),
        );
        if (heldDecoration || onSpawn) {
          throw new Error(
            `crawler sign seated on a claimed tile (${tile.x}, ${tile.y}); a claim source is missing from the planner's input`,
          );
        }
        if (pocketFloor !== null) target.groundType = pocketFloor;
        target.type = CRAWLER_SIGN;
        target.crawlerSignDirection = placement.direction;
        target.crawlerSignArrowAngle = placement.arrowAngleRadians;
      }
    }
    crawlerSigns.push(...signPlacements);
  }
  const regionCharacters =
    progressionLayout === undefined
      ? RegionCharacters.empty()
      : new RegionCharacters(regionMap, roomAssignments, hallwayAssignments);
  const wallFixtures =
    progressionLayout === undefined || !placeProps
      ? []
      : placeWallFixtures({
          grid,
          regionMap,
          characters: regionCharacters,
          rng: mulberry32(dressingSeed ^ FIXTURE_STREAM_SALT),
          labApproach: spiderLabRoom ?? undefined,
        });

  // Flooded last, so every pass above saw a carved dry corridor and none of them
  // has to know what water is.
  for (const approach of plannedFloodedApproaches) {
    for (const { tile, depth } of floodedTileDepths(approach).values()) {
      if (depth > 0) floodDungeonTile(grid[tile.y][tile.x], depth);
    }
  }

  return {
    grid,
    startTile,
    safeRooms,
    bossRooms,
    questRooms,
    bathroomRooms,
    stealthGateRoom,
    treasureRooms,
    spiderLabRoom,
    mobSpawnPoints,
    hallwaySpawnPoints,
    stairwellTiles,
    floodedApproaches: plannedFloodedApproaches,
    progressionLayout,
    crawlerSigns,
    regionMap,
    regionCharacters,
    wallFixtures,
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
  const gauntlets = progression?.gauntlets ?? [];
  const spineRoute = gauntlets
    .map((gauntlet) => gauntlet.route)
    .find((route): route is SpineRoute => route.kind === 'spine');
  const branchRoutes = gauntlets
    .map((gauntlet) => gauntlet.route)
    .filter((route): route is BranchesRoute => route.kind === 'branches');
  return {
    mapSize: options.size,
    gauntletCount: gauntlets.length,
    hasQuestChoke:
      spineRoute !== undefined || gauntlets.some((gauntlet) => gauntlet.questChoke === true),
    hasBathroomChoke: branchRoutes.some((route) => route.bathroomChoke !== undefined),
    bathroomPlumberBlocks: plumberBlocksOnFloor(progression),
    // Disarmed only under a `verify:stealth-gate` self-test fault, so the faulty
    // layout ships and that gate's own checks have to be the ones to catch it.
    hasStealthGate:
      spineRoute?.stealthGate !== undefined && spineRoute.stealthGate.faultForGate === undefined,
    hasSpine: spineRoute !== undefined,
    spiderLabIsDeadEnd: (options.hasSpiderLab ?? false) && spineRoute !== undefined,
    spineMinRooms: spineRoute?.rooms.min ?? 0,
    scatterSafeRooms: progression?.scatterSafeRooms ?? 0,
    outskirtsSafeRoomHops: progression?.outskirtsSafeRoomHops === true,
    floodedApproaches: gauntlets.flatMap((gauntlet, gauntletIndex) =>
      gauntlet.approach === undefined
        ? []
        : [{ gauntletIndex, bossType: gauntlet.bossType, spec: gauntlet.approach }],
    ),
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
