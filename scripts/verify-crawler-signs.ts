/**
 * Wayfinding signs, checked against the live `GameMap` rather than against the
 * planner that placed them.
 *
 * An arrow pointing the wrong way is worse than no sign, and no other gate can
 * see it: the layout invariants are all indifferent to where a sign stands. So
 * the headline check walks the built map with its own room and corridor
 * bookkeeping — deliberately not `buildRoomGraph`, `corridorTilesBetween` or
 * `planCrawlerSigns` — and asks the only question a crawler asks at the
 * junction: does the doorway the arrow points at reach the stairs in fewer
 * room-steps than every doorway that does not lead onward?
 *
 * "The stairs" is one stairwell per map, the one nearest the start in room-steps.
 * Every stairwell descends, so a per-room nearest stairwell would send signs a
 * few rooms apart toward different ones; against one exit, following signs can
 * only ever approach it, and a second check walks that chain to prove it.
 *
 * Which junctions get a sign at all is checked the same way: a second model
 * floods the level with each junction taken out and calls a junction a trap when
 * some branch leads round a loop or into a dead end of several rooms. Every such
 * junction must be signed, and no other may be. Real dungeons only ever produce
 * loops (their dead ends are one room deep), so hand-built levels run through the
 * planner cover the dead-end rule and the stair-search exemption.
 *
 * Two corridors can join the same pair of rooms, so two doorways may tie for
 * closest to the onward room. Both are right, so a doorway that reaches the
 * onward room is never measured against the arrow.
 *
 *   npx tsx scripts/verify-crawler-signs.ts
 */

import { readFileSync } from 'node:fs';
import { TILE_SIZE } from '../src/core/constants.js';
import { DIFFICULTY_PROFILES } from '../src/core/difficultyProfiles.js';
import { dungeonOptionsForLevel } from '../src/levels/dungeonOptions.js';
import { level1 } from '../src/levels/level1.js';
import { level2 } from '../src/levels/level2.js';
import { spawnForLevel } from '../src/levels/spawner.js';
import type { LevelDef } from '../src/levels/types.js';
import {
  crawlerSignFootprint,
  planCrawlerSigns,
  type CrawlerSignDirection,
  type CrawlerSignInput,
  type PlannedCrawlerSign,
} from '../src/map/crawlerSigns.js';
import { GameMap } from '../src/map/GameMap.js';
import { hasOpenRegion } from '../src/map/findWalkableTile.js';
import { applyMovement } from '../src/systems/PlayerMovementSystem.js';
import { TILE_KEY_STRIDE, tileCoordKey } from '../src/map/tileIndex.js';
import { CRAWLER_SIGN, FloorTypeValue, type TileContent } from '../src/map/tileTypes.js';

/**
 * Maps generated per floor.
 *
 * Signs are seated on a few junctions per map and the shapes that break them —
 * a corridor that leaves through one wall and arrives at another, two corridors
 * joining the same onward room — turn up on a few percent of signs, so a couple
 * of dozen maps would sit green through a regression. Every map builds a whole
 * `GameMap`, which is what keeps this from being several hundred.
 */
const RUNS_PER_FLOOR = 40;

/** Below this many signs across a floor's runs the gate is checking too little to mean anything. */
const MIN_SIGNS_PER_FLOOR = 1;

/**
 * Room signs the two floors must seat between them. Floor 1's junction rooms are all
 * safe-room hubs, which never carry a sign, so it legitimately seats none and the
 * bar is set over both floors; floor 1 cannot pass vacuously because its trap-room
 * count, its hallway signs and its safe-room controls are each guarded above zero.
 */
const MIN_ROOM_SIGNS_ACROSS_FLOORS = 20;

/**
 * Share of a floor's signable trap junction rooms (safe rooms excluded) that must hold a
 * sign. What is left over is
 * rooms with no legal seat or a hard exclusion, both proven independently per room,
 * so this only guards against the exemption list itself growing.
 */
const MIN_ROOM_SIGNED_SHARE = 0.9;

/** How far, in tiles, a sign's base keeps from every doorway of its room; restated so the gate does not import the planner's constant. */
const MIN_DOORWAY_CLEARANCE_TILES = 3;

/** Party level is irrelevant to where the spawner seats a mob, so one level serves. */
const SPAWN_PARTY_LEVEL = 1;

/** Tiles a mob's own position rounds to, centred the way `Mob` reads its tile. */
const TILE_CENTRE_FRACTION = 0.5;

/** Radians an angle may differ from the measured bearing; the two are computed from the same integers. */
const ARROW_ANGLE_TOLERANCE_RADIANS = 1e-9;

/** Radians a deliberately wrong angle is turned by; a quarter turn is far outside any tolerance. */
const WRONG_ANGLE_OFFSET_RADIANS = Math.PI / 2;

/** Side length, in tiles, of the square a stairwell blocks. */
const STAIRWELL_SPAN = 2;

/** Corridors, and the distinct rooms they reach, a room needs for its exits to be a real choice. */
const MIN_JUNCTION_OPENINGS = 3;

/** Rooms a plain hallway joins; a corridor touching more blurs which doorway leads where. */
const ROOMS_PER_PLAIN_HALLWAY = 2;

/** Branches a hallway junction needs before the way onward is a real choice. */
const MIN_HALLWAY_BRANCHES = 3;

/** Chebyshev radius around a junction inside which its branches must stay connected. */
const JUNCTION_WINDOW_TILES = 3;

/** Pixels the simulated player advances per step; one keeps every tile-aligned waypoint exact. */
const WALK_SPEED_PIXELS = 1;

/** Steps a simulated walk between two lane tiles may take, a generous multiple of the tiles in a junction window. */
const WALK_STEP_BUDGET = TILE_SIZE * JUNCTION_WINDOW_TILES * JUNCTION_WINDOW_TILES * 8;

/**
 * Rooms a dead-end region must touch before a wrong turn into it is worth a sign.
 * Restated here so the gate does not import the planner's constant.
 */
const MIN_DEAD_END_ROOMS = 3;

/** Old board geometry: three tiles wide, one to each side of the tile it blocked. */
const OVERHANGING_BOARD = { frameWidth: 192, tileX: 64, tileScale: 64 } as const;

/** Slack, in tiles, before a board's edge counts as reaching into the next tile. */
const SPAN_EDGE_EPSILON_TILES = 1e-6;

/** Path to the manifest the game loads the board's frame geometry from. */
const PROPS_MANIFEST_PATH = '../src/images/environment/props/manifest.json';

/** Marks a tile that belongs to no room, or a tile with no corridor component. */
const NO_ROOM = -1;

/** Marks a room on no leg of the forced path. */
const NO_STAGE = -1;

const MULBERRY_INCREMENT = 0x6d2b79f5;
const MIX_SHIFT_A = 15;
const MIX_SHIFT_B = 7;
const MIX_SHIFT_C = 14;
const MIX_OR = 61;
const UINT32_RANGE = 4294967296;

/** Seeds are spaced by floor so no two floors replay the same random stream. */
const SEED_STRIDE_PER_FLOOR = 100000;

/** Integer from an environment variable, or the fallback when unset; exits on anything else. */
function integerFromEnvironment(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (raw.trim() === '' || !Number.isInteger(value)) {
    console.error(`${name} must be an integer, got "${raw}"`);
    process.exit(1);
  }
  return value;
}

/** Shifts every seed so repeated invocations cover fresh maps. */
const seedOffset = integerFromEnvironment('CRAWLER_SIGN_SEED_OFFSET', 0);

/** Set to replay one map: `CRAWLER_SIGN_SEED=<n> npm run verify:crawler-signs`. */
const REPLAY_SEED = integerFromEnvironment('CRAWLER_SIGN_SEED', Number.NaN);

type Point = { x: number; y: number };
type Rect = { x: number; y: number; w: number; h: number };

const AXIS_STEP: Readonly<Record<CrawlerSignDirection, Point>> = {
  North: { x: 0, y: -1 },
  South: { x: 0, y: 1 },
  West: { x: -1, y: 0 },
  East: { x: 1, y: 0 },
};

const AXIS_DIRECTIONS: ReadonlyArray<CrawlerSignDirection> = ['North', 'South', 'West', 'East'];

let currentSeed = 0;

/** Deterministic stand-in for `Math.random`, so a failing map can be regenerated from its printed seed. */
function seedRandom(seed: number): void {
  let state = seed;
  Math.random = () => {
    state = (state + MULBERRY_INCREMENT) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> MIX_SHIFT_A), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> MIX_SHIFT_B), mixed | MIX_OR);
    return ((mixed ^ (mixed >>> MIX_SHIFT_C)) >>> 0) / UINT32_RANGE;
  };
}

/**
 * Signs met while following another sign's chain, over every floor. Floor 1's few signs
 * are spread over hundreds of rooms and rarely meet, so the guard is on the total.
 */
let chainedAcrossFloors = 0;

/** Room-sign gates, summed over both floors. */
const roomGateTotals = {
  signs: 0,
  farEnd: 0,
  flipped: 0,
  junctionRule: 0,
  chain: 0,
  roomCoverage: 0,
  hallwayCoverage: 0,
};

let failures = 0;
let checks = 0;

function check(condition: boolean, message: string): void {
  checks++;
  if (condition) return;
  failures++;
  console.log(`  FAIL [seed ${currentSeed}]: ${message}`);
}

function rectContains(rect: Rect, x: number, y: number): boolean {
  return x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h;
}

/** Chebyshev gap, in tiles, between a point and the nearest tile of `rect`; zero inside it. */
function distanceToRectTiles(point: Point, rect: Rect): number {
  const gapX = Math.max(rect.x - point.x, 0, point.x - (rect.x + rect.w - 1));
  const gapY = Math.max(rect.y - point.y, 0, point.y - (rect.y + rect.h - 1));
  return Math.max(gapX, gapY);
}

/** Room-steps to the goal of the leg `room` lies on, everywhere; all infinite for a room off the forced path. */
function fieldOf(model: FloorModel, room: number): ReadonlyArray<number> {
  const stage = model.stageOfRoom[room] ?? NO_STAGE;
  return model.stageDistance[stage] ?? model.rooms.map(() => Number.POSITIVE_INFINITY);
}

function onRectEdge(rect: Rect, x: number, y: number): boolean {
  return x === rect.x || x === rect.x + rect.w - 1 || y === rect.y || y === rect.y + rect.h - 1;
}

interface SignTile {
  readonly tile: Point;
  readonly direction: CrawlerSignDirection | undefined;
  readonly arrowAngle: number | undefined;
}

/**
 * The map's own account of its rooms and corridors, built from `isWalkable`.
 *
 * A corridor component is one connected stretch of walkable floor outside every
 * room; the rooms it touches are the rooms it joins.
 */
interface FloorModel {
  readonly map: GameMap;
  readonly rooms: ReadonlyArray<Rect>;
  readonly roomAt: ReadonlyArray<number>;
  readonly componentAt: ReadonlyArray<number>;
  readonly componentRooms: ReadonlyArray<ReadonlySet<number>>;
  readonly componentTiles: ReadonlyArray<ReadonlyArray<Point>>;
  /**
   * The leg of the forced path each room lies on (an index into `stageGoals`), or
   * `NO_STAGE` for a room past the last goal, where the player searches for the stairs.
   */
  readonly stageOfRoom: ReadonlyArray<number>;
  /** The room each leg leads to, in the order the player must reach them. */
  readonly stageGoals: ReadonlyArray<number>;
  /** Room-steps to each leg's goal, per leg; infinite for a room that cannot reach it. */
  readonly stageDistance: ReadonlyArray<ReadonlyArray<number>>;
  readonly neighbours: ReadonlyArray<ReadonlySet<number>>;
}

const FLOOD_STEPS: ReadonlyArray<Point> = Object.values(AXIS_STEP);

function buildFloorModel(map: GameMap, rooms: ReadonlyArray<Rect>): FloorModel {
  const size = map.gridSize;
  const at = (x: number, y: number): number => y * size + x;
  const inside = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < size && y < size;

  const roomAt = new Array<number>(size * size).fill(NO_ROOM);
  for (const [index, room] of rooms.entries()) {
    for (let y = room.y; y < room.y + room.h; y++) {
      for (let x = room.x; x < room.x + room.w; x++) {
        if (inside(x, y)) roomAt[at(x, y)] = index;
      }
    }
  }

  const componentAt = new Array<number>(size * size).fill(NO_ROOM);
  const componentRooms: Array<Set<number>> = [];
  const componentTiles: Point[][] = [];
  for (let startY = 0; startY < size; startY++) {
    for (let startX = 0; startX < size; startX++) {
      const startKey = at(startX, startY);
      if (componentAt[startKey] !== NO_ROOM || roomAt[startKey] !== NO_ROOM) continue;
      if (!map.isWalkable(startX, startY)) continue;
      const component = componentRooms.length;
      const touched = new Set<number>();
      componentRooms.push(touched);
      componentAt[startKey] = component;
      const queue: Point[] = [{ x: startX, y: startY }];
      componentTiles.push(queue);
      for (const tile of queue) {
        for (const step of FLOOD_STEPS) {
          const nx = tile.x + step.x;
          const ny = tile.y + step.y;
          if (!inside(nx, ny) || !map.isWalkable(nx, ny)) continue;
          const room = roomAt[at(nx, ny)];
          if (room !== NO_ROOM) {
            touched.add(room);
            continue;
          }
          if (componentAt[at(nx, ny)] !== NO_ROOM) continue;
          componentAt[at(nx, ny)] = component;
          queue.push({ x: nx, y: ny });
        }
      }
    }
  }

  const neighbours = rooms.map(() => new Set<number>());
  for (const touched of componentRooms) {
    for (const a of touched) {
      for (const b of touched) {
        if (a !== b) neighbours[a].add(b);
      }
    }
  }

  const distancesFrom = (source: number): number[] => {
    const distance = rooms.map(() => Number.POSITIVE_INFINITY);
    distance[source] = 0;
    const queue = [source];
    for (const room of queue) {
      for (const next of neighbours[room]) {
        if (distance[next] !== Number.POSITIVE_INFINITY) continue;
        distance[next] = distance[room] + 1;
        queue.push(next);
      }
    }
    return distance;
  };

  const startRoom = roomAt[at(map.startTile.x, map.startTile.y)];
  const fromStart = startRoom === NO_ROOM ? [] : distancesFrom(startRoom);
  const reachableFromStart = (room: number): number => fromStart[room] ?? Number.POSITIVE_INFINITY;

  // The rooms the player is required to reach: every gateway boss, then the room
  // that guards the arena's door. Derived from the live map's own boss and arena
  // records, and ordered by how far each is from the start rather than trusting
  // the generator's list order.
  const requiredGoals = new Set<number>();
  for (const boss of map.bossRooms) {
    const room = roomAt[at(boss.centre.x, boss.centre.y)];
    if (room !== undefined && room !== NO_ROOM) requiredGoals.add(room);
  }
  const arena = map.arenaExteriors[0];
  if (arena !== undefined) {
    const nearestToDoor = rooms
      .map((bounds, index) => ({ index, gap: distanceToRectTiles(arena.doorTile, bounds) }))
      .sort((a, b) => a.gap - b.gap || a.index - b.index)[0];
    if (nearestToDoor !== undefined) requiredGoals.add(nearestToDoor.index);
  }
  const stageGoals = [...requiredGoals]
    .filter((room) => reachableFromStart(room) !== Number.POSITIVE_INFINITY)
    .sort((a, b) => reachableFromStart(a) - reachableFromStart(b) || a - b);

  const stageOfRoom = rooms.map(() => NO_STAGE);
  for (const [stage, goal] of stageGoals.entries()) {
    const nearSide = new Set<number>([startRoom, goal]);
    const queue = [startRoom];
    for (const room of queue) {
      for (const next of neighbours[room] ?? []) {
        if (nearSide.has(next)) continue;
        nearSide.add(next);
        queue.push(next);
      }
    }
    for (const room of nearSide) {
      if (stageOfRoom[room] === NO_STAGE) stageOfRoom[room] = stage;
    }
  }
  const stageDistance = stageGoals.map((goal) => distancesFrom(goal));

  return {
    map,
    rooms,
    roomAt,
    componentAt,
    componentRooms,
    componentTiles,
    stageOfRoom,
    stageGoals,
    stageDistance,
    neighbours,
  };
}

function roomIndexAt(model: FloorModel, x: number, y: number): number {
  return model.roomAt[y * model.map.gridSize + x] ?? NO_ROOM;
}

/** The corridor component a room's perimeter tile opens onto in `step`'s direction, if any. */
function exitComponent(model: FloorModel, perimeter: Point, step: Point): number | null {
  const size = model.map.gridSize;
  const x = perimeter.x + step.x;
  const y = perimeter.y + step.y;
  if (x < 0 || y < 0 || x >= size || y >= size) return null;
  if (!model.map.isWalkable(perimeter.x, perimeter.y)) return null;
  const component = model.componentAt[y * size + x];
  return component === undefined || component === NO_ROOM ? null : component;
}

/** Every corridor component that touches `room` through some walkable perimeter tile. */
function doorwayComponents(model: FloorModel, room: number): Set<number> {
  const bounds = model.rooms[room];
  const components = new Set<number>();
  for (let y = bounds.y; y < bounds.y + bounds.h; y++) {
    for (let x = bounds.x; x < bounds.x + bounds.w; x++) {
      if (!onRectEdge(bounds, x, y)) continue;
      for (const step of FLOOD_STEPS) {
        if (rectContains(bounds, x + step.x, y + step.y)) continue;
        const component = exitComponent(model, { x, y }, step);
        if (component !== null) components.add(component);
      }
    }
  }
  return components;
}

/**
 * Why `arrowComponent` is not the right way onward from `room`, or an empty
 * list when it is.
 *
 * The arrow must reach the stairs in strictly fewer room-steps than the room it
 * stands in and than every doorway that does not lead to the same onward room.
 */
function headlineFailures(model: FloorModel, room: number, arrowComponent: number): string[] {
  const reasons: string[] = [];
  const field = fieldOf(model, room);
  const roomDistance = field[room] ?? Number.POSITIVE_INFINITY;
  const reachable = (component: number): number[] =>
    [...(model.componentRooms[component] ?? [])].filter((other) => other !== room);
  const distanceOf = (rooms: ReadonlyArray<number>): number =>
    Math.min(
      Number.POSITIVE_INFINITY,
      ...rooms.map((other) => field[other] ?? Number.POSITIVE_INFINITY),
    );

  const arrowRooms = reachable(arrowComponent);
  const arrowDistance = distanceOf(arrowRooms);
  if (arrowRooms.length === 0) return ['the arrow’s doorway leads to no other room'];
  if (arrowDistance === Number.POSITIVE_INFINITY) {
    return ['the arrow’s doorway reaches no goal on the forced path'];
  }
  if (!(arrowDistance < roomDistance)) {
    reasons.push(
      `the arrow leads ${arrowDistance} steps from the goal, no nearer than the sign's own room (${roomDistance})`,
    );
  }
  const onwardRooms = arrowRooms.filter((other) => field[other] === arrowDistance);

  for (const other of doorwayComponents(model, room)) {
    if (other === arrowComponent) continue;
    const otherRooms = reachable(other);
    if (otherRooms.some((candidate) => onwardRooms.includes(candidate))) continue;
    const otherDistance = distanceOf(otherRooms);
    if (!(arrowDistance < otherDistance)) {
      reasons.push(
        `a doorway that does not lead onward is ${otherDistance} steps from the goal, arrow's is ${arrowDistance}`,
      );
    }
  }
  return reasons;
}

/** A doorway of `room` that shares no room with the arrow's, standing in for a flipped arrow. */
function wrongDoorway(model: FloorModel, room: number, arrowComponent: number): number | null {
  const arrowRooms = model.componentRooms[arrowComponent] ?? new Set<number>();
  const onward = [...arrowRooms].filter((other) => other !== room);
  for (const candidate of doorwayComponents(model, room)) {
    if (candidate === arrowComponent) continue;
    const reaches = model.componentRooms[candidate] ?? new Set<number>();
    if (onward.some((other) => reaches.has(other))) continue;
    return candidate;
  }
  return null;
}

/** Whether an arrow bearing stays strictly within a quarter turn of the cardinal `direction`. */
function agreesWithDirection(angle: number, direction: CrawlerSignDirection): boolean {
  const step = AXIS_STEP[direction];
  const alongDirection = Math.cos(angle) * step.x + Math.sin(angle) * step.y;
  return alongDirection > ARROW_ANGLE_TOLERANCE_RADIANS;
}

/**
 * The bearing a sign at `from` must paint for the hallway whose first tile is
 * `entrance`: straight at that tile, or the printed `direction` itself when the
 * tile lies a quarter turn or more away from it.
 */
function expectedArrowAngle(from: Point, entrance: Point, direction: CrawlerSignDirection): number {
  const step = AXIS_STEP[direction];
  const alongDirection = (entrance.x - from.x) * step.x + (entrance.y - from.y) * step.y;
  const aim = alongDirection > 0 ? entrance : { x: from.x + step.x, y: from.y + step.y };
  return Math.atan2(aim.y - from.y, aim.x - from.x);
}

/** Whether two bearings are the same direction, modulo a full turn. */
function sameBearing(a: number, b: number): boolean {
  return Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b))) <= ARROW_ANGLE_TOLERANCE_RADIANS;
}

function findSigns(map: GameMap): SignTile[] {
  const signs: SignTile[] = [];
  for (let y = 0; y < map.gridSize; y++) {
    for (let x = 0; x < map.gridSize; x++) {
      const tile = map.structure[y][x];
      if (tile.type !== CRAWLER_SIGN) continue;
      signs.push({
        tile: { x, y },
        direction: tile.crawlerSignDirection,
        arrowAngle: tile.crawlerSignArrowAngle,
      });
    }
  }
  return signs;
}

/** Every list of placed things on the map, named so a list nobody crossed is visible as an omission. */
function claimLists(map: GameMap): Array<{ name: string; points: Point[] }> {
  const treasureCentres = map.treasureRooms.map((room) => room.centre);
  const questTiles = map.questRooms.flatMap((quest) => [
    quest.entranceTile,
    quest.npcTile,
    quest.woodPileTile,
  ]);
  const spiderLab = map.spiderLabRoom;
  return [
    { name: 'mobSpawnPoints', points: map.mobSpawnPoints },
    { name: 'hallwaySpawnPoints', points: map.hallwaySpawnPoints },
    { name: 'stairwellTiles', points: [...map.stairwellTiles] },
    { name: 'startTile', points: [map.startTile] },
    { name: 'treasureRoom centres', points: treasureCentres },
    { name: 'safeRoom centres', points: map.safeRooms.map((room) => room.centre) },
    { name: 'bossRoom centres', points: map.bossRooms.map((room) => room.centre) },
    { name: 'building entries', points: map.buildingEntries.map((entry) => entry.doorTile) },
    { name: 'arena doors', points: map.arenaExteriors.map((arena) => arena.doorTile) },
    { name: 'arena stairwells', points: map.arenaExteriors.map((arena) => arena.stairwellTile) },
    { name: 'quest room tiles', points: questTiles },
    { name: 'quest grates', points: map.questRooms.flatMap((quest) => quest.grateTiles) },
    { name: 'quest exit doors', points: map.questRooms.flatMap((quest) => quest.exitDoorTiles) },
    {
      name: 'spider lab tiles',
      points:
        spiderLab === null
          ? []
          : [
              spiderLab.entranceTile,
              spiderLab.scientistTile,
              spiderLab.computerTile,
              spiderLab.spiderEggTile,
              ...spiderLab.lifeMachineTiles,
            ],
    },
  ];
}

function stairwellFootprint(stairwell: Point): Point[] {
  const tiles: Point[] = [];
  for (let dy = 0; dy < STAIRWELL_SPAN; dy++) {
    for (let dx = 0; dx < STAIRWELL_SPAN; dx++) {
      tiles.push({ x: stairwell.x + dx, y: stairwell.y + dy });
    }
  }
  return tiles;
}

function reachableFromStart(map: GameMap): Set<number> {
  const size = map.gridSize;
  const seen = new Set<number>();
  const start = map.startTile;
  if (!map.isWalkable(start.x, start.y)) return seen;
  seen.add(tileCoordKey(start.x, start.y));
  const queue: Point[] = [start];
  for (const tile of queue) {
    for (const step of FLOOD_STEPS) {
      const nx = tile.x + step.x;
      const ny = tile.y + step.y;
      if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
      if (seen.has(tileCoordKey(nx, ny)) || !map.isWalkable(nx, ny)) continue;
      seen.add(tileCoordKey(nx, ny));
      queue.push({ x: nx, y: ny });
    }
  }
  return seen;
}

/** Counters one floor's runs accumulate, so a guard can tell a gate that ran from one that never did. */
interface FloorStats {
  roomSigns: number;
  hallwaySigns: number;
  negativeControls: number;
  tiedDoorways: number;
  diagonalArrows: number;
  farEndControls: number;
  chainedSigns: number;
  hallwayNegativeControls: number;
  overhangControls: number;
  junctionControls: number;
  boardsChecked: number;
  chainControls: number;
  tiedBranches: number;
  junctionsRequired: number;
  junctionsSigned: number;
  junctionsOffPath: number;
  roomsRequired: number;
  roomsSigned: number;
  roomControls: number;
  exemptions: string[];
  searchTilesChecked: number;
  searchControls: number;
  coverageControls: number;
  trapJunctions: number;
  leafJunctions: number;
  loopJunctions: number;
  deadEndJunctions: number;
  safeRoomControls: number;
  safeExcludedRooms: number;
}

/** What leaving a junction down one branch amounts to, judged by the gate's own flood. */
interface BranchOutcome {
  readonly reachesGoal: boolean;
  readonly trap: boolean;
  readonly kind: 'goal' | 'arrival' | 'loop' | 'dead end' | 'stub';
}

/**
 * The gate's own account of what each exit of a junction leads to.
 *
 * Built by a different method from the planner's: instead of labelling whole
 * regions and counting how many seeds fell in each, every branch walks the live map
 * on its own and reports what it met. A branch is a loop when its walk arrives at
 * another branch's first tile without crossing the junction; it reaches the goal
 * when its walk touches the goal room, which is a wall to the walk; and it spans
 * the rooms its own tiles fall in against the model's room map.
 */
function independentBranchOutcomes(
  model: FloorModel,
  removed: ReadonlyArray<Point>,
  seeds: ReadonlyArray<Point>,
  goalRoom: number,
): BranchOutcome[] {
  const { map } = model;
  const startRoom = roomIndexAt(model, map.startTile.x, map.startTile.y);
  const removedKeys = new Set(removed.map(tileKeyOf));
  const isWall = (tile: Point): boolean =>
    !map.isWalkable(tile.x, tile.y) ||
    removedKeys.has(tileKeyOf(tile)) ||
    roomIndexAt(model, tile.x, tile.y) === goalRoom;
  const seedKeys = seeds.map(tileKeyOf);

  interface Walk {
    touchesGoal: boolean;
    holdsStart: boolean;
    metOtherBranch: boolean;
    rooms: Set<number>;
  }
  const walkFrom = (seedIndex: number): Walk => {
    const seed = seeds[seedIndex];
    const walk: Walk = {
      touchesGoal: false,
      holdsStart: false,
      metOtherBranch: false,
      rooms: new Set<number>(),
    };
    const seen = new Set<number>([tileKeyOf(seed)]);
    const queue: Point[] = [seed];
    for (const tile of queue) {
      const room = roomIndexAt(model, tile.x, tile.y);
      if (room !== NO_ROOM) walk.rooms.add(room);
      if (room !== NO_ROOM && room === startRoom) walk.holdsStart = true;
      const key = tileKeyOf(tile);
      if (seedKeys.some((other, index) => index !== seedIndex && other === key)) {
        walk.metOtherBranch = true;
      }
      for (const step of ORTHOGONAL_STEPS) {
        const next = { x: tile.x + step.x, y: tile.y + step.y };
        if (!map.isWalkable(next.x, next.y)) continue;
        if (roomIndexAt(model, next.x, next.y) === goalRoom) walk.touchesGoal = true;
        if (isWall(next) || seen.has(tileKeyOf(next))) continue;
        seen.add(tileKeyOf(next));
        queue.push(next);
      }
    }
    return walk;
  };

  return seeds.map((seed, seedIndex): BranchOutcome => {
    if (roomIndexAt(model, seed.x, seed.y) === goalRoom) {
      return { reachesGoal: true, trap: false, kind: 'goal' };
    }
    if (isWall(seed)) return { reachesGoal: false, trap: false, kind: 'stub' };
    const walk = walkFrom(seedIndex);
    if (walk.touchesGoal) return { reachesGoal: true, trap: false, kind: 'goal' };
    if (walk.metOtherBranch) return { reachesGoal: false, trap: true, kind: 'loop' };
    if (walk.holdsStart) return { reachesGoal: false, trap: false, kind: 'arrival' };
    const isBigDeadEnd = walk.rooms.size >= MIN_DEAD_END_ROOMS;
    return { reachesGoal: false, trap: isBigDeadEnd, kind: isBigDeadEnd ? 'dead end' : 'stub' };
  });
}

/** Outcomes at a hallway junction tile: the tile is removed, one branch per open side. */
function hallwayJunctionOutcomes(model: FloorModel, centre: Point, stage: number): BranchOutcome[] {
  const seeds = openSidesOf(model.map, centre).map((step) => ({
    x: centre.x + step.x,
    y: centre.y + step.y,
  }));
  return independentBranchOutcomes(model, [centre], seeds, model.stageGoals[stage] ?? NO_ROOM);
}

/** Outcomes at a junction room: every tile of the room is removed, one branch per corridor leaving it. */
function roomJunctionOutcomes(model: FloorModel, room: number): BranchOutcome[] {
  const bounds = model.rooms[room];
  const stage = model.stageOfRoom[room] ?? NO_STAGE;
  const goalRoom = model.stageGoals[stage];
  if (bounds === undefined || goalRoom === undefined) return [];
  const removed: Point[] = [];
  for (let y = bounds.y; y < bounds.y + bounds.h; y++) {
    for (let x = bounds.x; x < bounds.x + bounds.w; x++) {
      if (model.map.isWalkable(x, y)) removed.push({ x, y });
    }
  }
  const touchesRoom = (tile: Point): boolean =>
    ORTHOGONAL_STEPS.some((step) => roomIndexAt(model, tile.x + step.x, tile.y + step.y) === room);
  const seeds = [...doorwayComponents(model, room)].flatMap((component) => {
    const seed = (model.componentTiles[component] ?? []).find(touchesRoom);
    return seed === undefined ? [] : [seed];
  });
  return independentBranchOutcomes(model, removed, seeds, goalRoom);
}

/** A junction is signable when some way onward reaches the goal and some other way is a trap. */
function isTrapJunction(outcomes: ReadonlyArray<BranchOutcome>): boolean {
  return outcomes.some((outcome) => outcome.reachesGoal) && outcomes.some((o) => o.trap);
}

/** Tallies which kind of trap made a junction signable, so a floor showing only one kind is visible. */
function tallyTrapKinds(outcomes: ReadonlyArray<BranchOutcome>, stats: FloorStats): void {
  if (outcomes.some((outcome) => outcome.kind === 'loop')) stats.loopJunctions++;
  if (outcomes.some((outcome) => outcome.kind === 'dead end')) stats.deadEndJunctions++;
}

interface WallOpening {
  readonly perimeter: Point;
  /** The first tile outside the room, in the corridor. */
  readonly entrance: Point;
  readonly component: number;
}

/** Every doorway tile on the wall of `room` that faces `direction`, with the corridor it opens onto. */
function openingsOnWall(
  model: FloorModel,
  room: number,
  direction: CrawlerSignDirection,
): WallOpening[] {
  const bounds = model.rooms[room];
  const step = AXIS_STEP[direction];
  const found: WallOpening[] = [];
  for (let y = bounds.y; y < bounds.y + bounds.h; y++) {
    for (let x = bounds.x; x < bounds.x + bounds.w; x++) {
      if (!onRectEdge(bounds, x, y) || rectContains(bounds, x + step.x, y + step.y)) continue;
      const component = exitComponent(model, { x, y }, step);
      if (component === null) continue;
      found.push({
        perimeter: { x, y },
        entrance: { x: x + step.x, y: y + step.y },
        component,
      });
    }
  }
  return found;
}

/** Every perimeter tile of `room` through which corridor `component` is entered. */
function doorwayPerimeters(model: FloorModel, room: number, component: number): Point[] {
  const bounds = model.rooms[room];
  const found: Point[] = [];
  for (let y = bounds.y; y < bounds.y + bounds.h; y++) {
    for (let x = bounds.x; x < bounds.x + bounds.w; x++) {
      if (!onRectEdge(bounds, x, y)) continue;
      const opensOnto = FLOOD_STEPS.some(
        (step) =>
          !rectContains(bounds, x + step.x, y + step.y) &&
          exitComponent(model, { x, y }, step) === component,
      );
      if (opensOnto) found.push({ x, y });
    }
  }
  return found;
}

/** Whether every doorway tile can reach every other by walking inside `room`, treating `blocked` as solid. */
function doorwaysConnected(
  model: FloorModel,
  room: number,
  doorwayTiles: ReadonlyArray<Point>,
  blocked: ReadonlySet<number>,
): boolean {
  const bounds = model.rooms[room];
  const open = (tile: Point): boolean =>
    rectContains(bounds, tile.x, tile.y) &&
    model.map.isWalkable(tile.x, tile.y) &&
    !blocked.has(tileKeyOf(tile));
  const [origin, ...rest] = doorwayTiles;
  if (origin === undefined || !open(origin)) return false;
  const seen = new Set<number>([tileKeyOf(origin)]);
  const queue: Point[] = [origin];
  for (const tile of queue) {
    for (const step of ORTHOGONAL_STEPS) {
      const next = { x: tile.x + step.x, y: tile.y + step.y };
      if (!open(next) || seen.has(tileKeyOf(next))) continue;
      seen.add(tileKeyOf(next));
      queue.push(next);
    }
  }
  return rest.every((tile) => seen.has(tileKeyOf(tile)));
}

function verifyRoomSign(
  model: FloorModel,
  sign: SignTile,
  direction: CrawlerSignDirection,
  room: number,
  where: string,
  stats: FloorStats,
): void {
  const { x, y } = sign.tile;
  const bounds = model.rooms[room];
  check(
    x > bounds.x && x < bounds.x + bounds.w - 1 && y > bounds.y && y < bounds.y + bounds.h - 1,
    `${where} is not in its room's interior`,
  );

  const openings = doorwayComponents(model, room);
  const neighbourRooms = roomsJoinedBy(model, openings, room);
  check(
    isRealJunction(model, openings),
    `${where} stands in a room with ${openings.size} openings to ${neighbourRooms.size} rooms, not a real three-way choice`,
  );
  check(
    isTrapJunction(roomJunctionOutcomes(model, room)),
    `${where} stands in a room where no wrong turn is a loop or a dead end of ${MIN_DEAD_END_ROOMS}+ rooms`,
  );
  const reduced = new Set([...openings].slice(0, MIN_JUNCTION_OPENINGS - 1));
  check(
    !isRealJunction(model, reduced),
    `negative control: a room with one opening fewer than ${where}'s was accepted as a junction`,
  );
  stats.junctionControls++;

  const wallOpenings = openingsOnWall(model, room, direction);
  check(wallOpenings.length > 0, `${where} says ${direction}, but that wall has no doorway`);

  check(sign.arrowAngle !== undefined, `${where} carries no arrow angle`);
  const arrowAngle = sign.arrowAngle;
  const aimed =
    arrowAngle === undefined
      ? []
      : wallOpenings.filter((opening) =>
          sameBearing(arrowAngle, expectedArrowAngle(sign.tile, opening.entrance, direction)),
        );
  check(
    arrowAngle === undefined || aimed.length === 1,
    `${where} arrow angle ${arrowAngle} aims at ${aimed.length} of the ${direction} wall's ${wallOpenings.length} doorways, not exactly one`,
  );
  const [target] = aimed;
  const arrowComponent = target?.component ?? null;
  if (arrowAngle !== undefined && target !== undefined) {
    const { entrance } = target;
    const expected = expectedArrowAngle(sign.tile, entrance, direction);
    check(
      !sameBearing(arrowAngle + WRONG_ANGLE_OFFSET_RADIANS, expected),
      `negative control: a wrong arrow angle at ${where} was accepted`,
    );
    const farEnd = (model.componentTiles[target.component] ?? []).reduce<Point>(
      (far, tile) =>
        Math.hypot(tile.x - sign.tile.x, tile.y - sign.tile.y) >
        Math.hypot(far.x - sign.tile.x, far.y - sign.tile.y)
          ? tile
          : far,
      entrance,
    );
    const towardFarEnd = expectedArrowAngle(sign.tile, farEnd, direction);
    if (!sameBearing(towardFarEnd, expected)) {
      check(
        !sameBearing(towardFarEnd, arrowAngle),
        `negative control: an arrow aimed at the hallway's far end at ${where} was accepted`,
      );
      stats.farEndControls++;
    }
    check(
      agreesWithDirection(arrowAngle, direction),
      `${where} arrow angle ${arrowAngle} contradicts its ${direction} wording`,
    );
    check(
      !agreesWithDirection(arrowAngle + Math.PI, direction),
      `negative control: a reversed arrow at ${where} was accepted as agreeing with ${direction}`,
    );
  }

  const doorwayEntrances = [...openings].flatMap((component) =>
    doorwayPerimeters(model, room, component),
  );
  check(
    doorwaysConnected(model, room, doorwayEntrances, new Set()),
    `${where} leaves the room's doorways disconnected with the sign stamped`,
  );
  // Rooms here are floor to their very edge, so the perimeter ring joins every
  // doorway on its own. The control solidifies everything but the doorway tiles.
  const doorwayKeys = new Set(doorwayEntrances.map(tileKeyOf));
  const solidExceptDoorways = new Set<number>();
  for (let roomY = bounds.y; roomY < bounds.y + bounds.h; roomY++) {
    for (let roomX = bounds.x; roomX < bounds.x + bounds.w; roomX++) {
      const key = tileKeyOf({ x: roomX, y: roomY });
      if (!doorwayKeys.has(key)) solidExceptDoorways.add(key);
    }
  }
  const doorwaysTouch = doorwayEntrances.some((tile) =>
    ORTHOGONAL_STEPS.some((step) =>
      doorwayKeys.has(tileKeyOf({ x: tile.x + step.x, y: tile.y + step.y })),
    ),
  );
  if (doorwayEntrances.length >= MIN_JUNCTION_OPENINGS && !doorwaysTouch) {
    check(
      !doorwaysConnected(model, room, doorwayEntrances, solidExceptDoorways),
      `negative control: a room solid but for its doorways was reported connected at ${where}`,
    );
  }

  if (arrowComponent !== null) {
    const reasons = headlineFailures(model, room, arrowComponent);
    for (const reason of reasons) check(false, `${where} points ${direction}: ${reason}`);
    if (reasons.length === 0) check(true, `${where} arrow verified`);

    const arrowRooms = [...(model.componentRooms[arrowComponent] ?? [])].filter(
      (other) => other !== room,
    );
    const sameOnward = [...doorwayComponents(model, room)].filter(
      (other) =>
        other !== arrowComponent &&
        arrowRooms.some((candidate) => model.componentRooms[other]?.has(candidate) === true),
    );
    if (sameOnward.length > 0) stats.tiedDoorways++;

    // A gate whose red path has never run is not known to be a gate: point
    // the same sign at a doorway that is not onward and it must fail.
    const flipped = wrongDoorway(model, room, arrowComponent);
    if (flipped !== null) {
      stats.negativeControls++;
      check(
        headlineFailures(model, room, flipped).length > 0,
        `negative control: a flipped arrow at ${where} was reported green`,
      );
    }
  }
}

/** Distinct rooms, other than `except`, that the given corridor components join. */
function roomsJoinedBy(
  model: FloorModel,
  components: ReadonlySet<number>,
  except: number,
): Set<number> {
  const joined = new Set<number>();
  for (const component of components) {
    for (const other of model.componentRooms[component] ?? []) {
      if (other !== except) joined.add(other);
    }
  }
  return joined;
}

/**
 * Whether a room with these openings offers a real choice: enough corridors, each a
 * plain hallway that joins only two rooms, reaching enough distinct neighbours. Two
 * corridors to one neighbour do not disqualify a room, they just count once.
 */
function isRealJunction(model: FloorModel, openings: ReadonlySet<number>): boolean {
  if (openings.size < MIN_JUNCTION_OPENINGS) return false;
  const plain = [...openings].every(
    (component) => model.componentRooms[component]?.size === ROOMS_PER_PLAIN_HALLWAY,
  );
  if (!plain) return false;
  const neighbours = new Set<number>();
  for (const component of openings) {
    for (const room of model.componentRooms[component] ?? []) neighbours.add(room);
  }
  // Each plain hallway contributes the sign's own room plus one neighbour.
  return neighbours.size - 1 >= MIN_JUNCTION_OPENINGS;
}

/**
 * Why following signs from `start` fails to approach the exit, or null when it
 * arrives: every step must land strictly nearer the exit and never on a room
 * already passed, and a room with a sign follows the sign rather than the map.
 */
function chainFailure(
  distance: ReadonlyArray<number>,
  neighbours: ReadonlyArray<ReadonlySet<number>>,
  signOnward: ReadonlyMap<number, number>,
  exitRoom: number,
  start: number,
  passedRoom: number,
): { failure: string | null; signsMet: number } {
  const visited = new Set<number>([passedRoom]);
  let current = start;
  let signsMet = 0;
  const fail = (failure: string): { failure: string; signsMet: number } => ({ failure, signsMet });
  for (let step = 0; step <= distance.length; step++) {
    if (current === exitRoom) return { failure: null, signsMet };
    visited.add(current);
    if (signOnward.has(current)) signsMet++;
    let next = signOnward.get(current);
    if (next === undefined) {
      const closer = [...(neighbours[current] ?? [])]
        .filter((room) => (distance[room] ?? Number.POSITIVE_INFINITY) < (distance[current] ?? 0))
        .sort((a, b) => (distance[a] ?? 0) - (distance[b] ?? 0) || a - b);
      next = closer[0];
    }
    if (next === undefined) return fail(`room ${current} has no way nearer the exit`);
    if (visited.has(next)) return fail(`room ${current}'s sign points back at room ${next}`);
    const here = distance[current] ?? Number.POSITIVE_INFINITY;
    const there = distance[next] ?? Number.POSITIVE_INFINITY;
    if (!(there < here)) return fail(`room ${current} leads to room ${next}, no nearer the exit`);
    current = next;
  }
  return fail('the chain never reached the exit');
}

interface BoardGeometry {
  readonly frameWidth: number;
  readonly tileX: number;
  readonly tileScale: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** The board's frame geometry exactly as the game's loader reads it from the props manifest. */
function loadBoardGeometry(): BoardGeometry {
  const manifest: unknown = JSON.parse(
    readFileSync(new URL(PROPS_MANIFEST_PATH, import.meta.url), 'utf8'),
  );
  const entry = isRecord(manifest) ? manifest['crawler_sign'] : undefined;
  if (!isRecord(entry)) throw new Error('the props manifest has no crawler_sign entry');
  const { frameWidth, tileX, tileScale } = entry;
  if (
    typeof frameWidth !== 'number' ||
    typeof tileX !== 'number' ||
    typeof tileScale !== 'number'
  ) {
    throw new Error('the crawler_sign manifest entry lacks numeric frame geometry');
  }
  return { frameWidth, tileX, tileScale };
}

const BOARD = loadBoardGeometry();

/** Tile columns on the sign's own row that a board of `geometry` visibly covers. */
function columnsUnderBoard(geometry: BoardGeometry, signX: number): number[] {
  const left = signX - geometry.tileX / geometry.tileScale;
  const right = signX + (geometry.frameWidth - geometry.tileX) / geometry.tileScale;
  const first = Math.floor(left + SPAN_EDGE_EPSILON_TILES);
  const last = Math.ceil(right - SPAN_EDGE_EPSILON_TILES) - 1;
  return Array.from({ length: last - first + 1 }, (_, index) => first + index);
}

/** Walkable tiles beneath the board on the sign's row, by the player's predicate. */
function standableUnderBoard(map: GameMap, geometry: BoardGeometry, sign: Point): Point[] {
  return columnsUnderBoard(geometry, sign.x)
    .filter((x) => map.isWalkable(x, sign.y) || map.isWalkableIgnoringPermanent(x, sign.y))
    .map((x) => ({ x, y: sign.y }));
}

function checkBoardFootprint(map: GameMap, sign: Point, where: string, stats: FloorStats): void {
  stats.boardsChecked++;
  const uncovered = standableUnderBoard(map, BOARD, sign);
  check(
    uncovered.length === 0,
    `${where} has a board that visibly covers standable tiles: ${uncovered.map((t) => `(${t.x},${t.y})`).join(' ')}`,
  );
  const covered = columnsUnderBoard(BOARD, sign.x);
  for (const x of covered) {
    check(!map.isWalkable(x, sign.y), `${where} board column ${x} is walkable for the player`);
    check(
      map.findPath(map.startTile.x, map.startTile.y, x, sign.y).length === 0,
      `${where} board column ${x} is a legal goal for mob pathfinding`,
    );
  }
  const control = standableUnderBoard(map, OVERHANGING_BOARD, sign);
  if (control.length > 0) stats.overhangControls++;
}

const ORTHOGONAL_STEPS: ReadonlyArray<Point> = Object.values(AXIS_STEP);
const DIAGONAL_STEPS: ReadonlyArray<Point> = [
  { x: 1, y: 1 },
  { x: 1, y: -1 },
  { x: -1, y: 1 },
  { x: -1, y: -1 },
];

function tileKeyOf(tile: Point): number {
  return tileCoordKey(tile.x, tile.y);
}

/**
 * Whether every lane tile in `targets` can reach every other without leaving the
 * junction's window, treating `blocked` as solid.
 */
function lanesConnected(
  map: GameMap,
  centre: Point,
  targets: ReadonlyArray<Point>,
  blocked: ReadonlySet<number>,
): boolean {
  const inWindow = (tile: Point): boolean =>
    Math.max(Math.abs(tile.x - centre.x), Math.abs(tile.y - centre.y)) <= JUNCTION_WINDOW_TILES;
  const open = (tile: Point): boolean =>
    inWindow(tile) && map.isWalkable(tile.x, tile.y) && !blocked.has(tileKeyOf(tile));
  const [origin, ...rest] = targets;
  if (origin === undefined || !open(origin)) return false;
  const seen = new Set<number>([tileKeyOf(origin)]);
  const queue: Point[] = [origin];
  for (const tile of queue) {
    for (const step of ORTHOGONAL_STEPS) {
      const next = { x: tile.x + step.x, y: tile.y + step.y };
      if (!open(next) || seen.has(tileKeyOf(next))) continue;
      seen.add(tileKeyOf(next));
      queue.push(next);
    }
  }
  return rest.every((target) => seen.has(tileKeyOf(target)));
}

/** Walks a real player entity, under the game's own collision, along the map's own path between two tiles. */
function playerCanWalk(map: GameMap, from: Point, to: Point): boolean {
  const route = map.findPath(from.x, from.y, to.x, to.y);
  if (route.length === 0) return false;
  const entity = {
    x: from.x * TILE_SIZE,
    y: from.y * TILE_SIZE,
    isMoving: false,
    facingX: 0,
    facingY: 1,
  };
  const mapPixels = map.gridSize * TILE_SIZE;
  const waypoints: Point[] = [...route, to];
  for (const waypoint of waypoints) {
    const goalX = waypoint.x * TILE_SIZE;
    const goalY = waypoint.y * TILE_SIZE;
    for (let step = 0; step < WALK_STEP_BUDGET; step++) {
      if (entity.x === goalX && entity.y === goalY) break;
      const alongX = entity.x !== goalX;
      const dx = alongX ? Math.sign(goalX - entity.x) : 0;
      const dy = alongX ? 0 : Math.sign(goalY - entity.y);
      applyMovement(
        entity,
        { dx, dy, isMobileVector: false },
        WALK_SPEED_PIXELS,
        map,
        mapPixels,
        mapPixels,
      );
    }
    if (entity.x !== goalX || entity.y !== goalY) return false;
  }
  return true;
}

/** One way out of a hallway junction, as a flood from the tile beside it. */
interface JunctionBranch {
  readonly step: Point;
  readonly rooms: Set<number>;
  /** Fewest room-steps to the leg's goal from any room this branch reaches. */
  hops: number;
  /** Tiles from the branch's first tile to the goal room, walking. */
  walk: number;
}

const openSidesOf = (map: GameMap, tile: Point): Point[] =>
  ORTHOGONAL_STEPS.filter((step) => map.isWalkable(tile.x + step.x, tile.y + step.y));

function junctionBranches(model: FloorModel, centre: Point): JunctionBranch[] {
  const { map } = model;
  return openSidesOf(map, centre).map((step) => {
    const first = { x: centre.x + step.x, y: centre.y + step.y };
    const seen = new Set<number>([tileKeyOf(first), tileKeyOf(centre)]);
    const rooms = new Set<number>();
    const queue: Point[] = [first];
    for (const tile of queue) {
      for (const next of ORTHOGONAL_STEPS) {
        const neighbour = { x: tile.x + next.x, y: tile.y + next.y };
        if (!map.isWalkable(neighbour.x, neighbour.y)) continue;
        const room = roomIndexAt(model, neighbour.x, neighbour.y);
        if (room !== NO_ROOM) {
          rooms.add(room);
          continue;
        }
        if (seen.has(tileKeyOf(neighbour))) continue;
        seen.add(tileKeyOf(neighbour));
        queue.push(neighbour);
      }
    }
    return { step, rooms, hops: Number.POSITIVE_INFINITY, walk: Number.POSITIVE_INFINITY };
  });
}

/**
 * The one leg of the forced path a junction's branches all belong to, or `NO_STAGE`
 * when any branch reaches the stair search or the branches straddle two legs — a
 * junction no single goal names.
 */
function junctionStage(model: FloorModel, branches: ReadonlyArray<JunctionBranch>): number {
  const stages = new Set<number>();
  for (const branch of branches) {
    for (const room of branch.rooms) stages.add(model.stageOfRoom[room] ?? NO_STAGE);
  }
  const [only] = stages;
  return stages.size === 1 && only !== undefined ? only : NO_STAGE;
}

const walkFieldCache = new WeakMap<FloorModel, Map<number, Map<number, number>>>();

/** Tiles a walker takes from every walkable tile to the goal room of `stage`. */
function walkDistanceToGoal(model: FloorModel, stage: number): Map<number, number> {
  const perModel = walkFieldCache.get(model) ?? new Map<number, Map<number, number>>();
  walkFieldCache.set(model, perModel);
  const cached = perModel.get(stage);
  if (cached !== undefined) return cached;
  const goal = model.stageGoals[stage];
  const bounds = goal === undefined ? undefined : model.rooms[goal];
  const distance = new Map<number, number>();
  const queue: Point[] = [];
  if (bounds !== undefined) {
    for (let y = bounds.y; y < bounds.y + bounds.h; y++) {
      for (let x = bounds.x; x < bounds.x + bounds.w; x++) {
        if (!model.map.isWalkable(x, y)) continue;
        distance.set(tileKeyOf({ x, y }), 0);
        queue.push({ x, y });
      }
    }
  }
  for (const tile of queue) {
    const here = distance.get(tileKeyOf(tile)) ?? 0;
    for (const step of ORTHOGONAL_STEPS) {
      const next = { x: tile.x + step.x, y: tile.y + step.y };
      if (!model.map.isWalkable(next.x, next.y) || distance.has(tileKeyOf(next))) continue;
      distance.set(tileKeyOf(next), here + 1);
      queue.push(next);
    }
  }
  perModel.set(stage, distance);
  return distance;
}

/**
 * Fills each branch's rank against the leg's goal and returns the branches tied for
 * the best rank: fewest room-steps, then the shortest walk.
 */
function bestBranches(
  model: FloorModel,
  centre: Point,
  branches: ReadonlyArray<JunctionBranch>,
  stage: number,
): JunctionBranch[] {
  const field = model.stageDistance[stage] ?? [];
  const walked = walkDistanceToGoal(model, stage);
  for (const branch of branches) {
    branch.hops = Math.min(
      Number.POSITIVE_INFINITY,
      ...[...branch.rooms].map((room) => field[room] ?? Number.POSITIVE_INFINITY),
    );
    branch.walk =
      walked.get(tileKeyOf({ x: centre.x + branch.step.x, y: centre.y + branch.step.y })) ??
      Number.POSITIVE_INFINITY;
  }
  const rankOf = (branch: JunctionBranch): readonly [number, number] => [branch.hops, branch.walk];
  const worse = (a: JunctionBranch, b: JunctionBranch): boolean => {
    const [hopsA, walkA] = rankOf(a);
    const [hopsB, walkB] = rankOf(b);
    return hopsA > hopsB || (hopsA === hopsB && walkA > walkB);
  };
  return branches.filter((candidate) => !branches.some((other) => worse(candidate, other)));
}

/**
 * One hallway junction sign, judged from the live map alone: the junction is
 * whichever walkable tile beside the sign has three or more walkable sides, the
 * branches are floods from each of them, and the arrow must point down the one
 * that reaches the leg's goal in the fewest room-steps, the shorter walk breaking
 * a tie between branches that meet again.
 */
function verifyHallwaySign(
  model: FloorModel,
  sign: SignTile,
  direction: CrawlerSignDirection,
  where: string,
  stats: FloorStats,
): void {
  const { map } = model;
  const around = [...ORTHOGONAL_STEPS, ...DIAGONAL_STEPS].map((step) => ({
    x: sign.tile.x + step.x,
    y: sign.tile.y + step.y,
  }));
  const junctions = around.filter(
    (tile) =>
      map.isWalkable(tile.x, tile.y) && openSidesOf(map, tile).length >= MIN_HALLWAY_BRANCHES,
  );
  check(
    junctions.length === 1,
    `${where} has ${junctions.length} junction tiles beside it, not one`,
  );
  const [centre] = junctions;
  if (centre === undefined) return;

  check(
    !around.some((tile) => roomIndexAt(model, tile.x, tile.y) !== NO_ROOM),
    `${where} is cut into a wall beside a room`,
  );
  check(
    map.structure[sign.tile.y][sign.tile.x].groundType !== undefined,
    `${where} carries no floor under its pocket`,
  );
  check(
    !DIAGONAL_STEPS.some((step) => map.isWalkable(centre.x + step.x, centre.y + step.y)),
    `${where} stands at a junction wider than one tile`,
  );

  const branches = junctionBranches(model, centre);
  const stage = junctionStage(model, branches);
  check(
    stage !== NO_STAGE,
    `${where} stands at a junction off the forced path: a branch reaches the stair search or two legs`,
  );
  if (stage === NO_STAGE) return;
  check(
    isTrapJunction(hallwayJunctionOutcomes(model, centre, stage)),
    `${where} stands at a fork where no wrong turn is a loop or a dead end of ${MIN_DEAD_END_ROOMS}+ rooms`,
  );

  const best = bestBranches(model, centre, branches, stage);
  check(
    best.some(
      (branch) =>
        AXIS_STEP[direction].x === branch.step.x && AXIS_STEP[direction].y === branch.step.y,
    ),
    `${where} says ${direction} but the branches best placed for the goal leave ${best.map((branch) => `${branch.step.x},${branch.step.y}`).join(' | ')}`,
  );
  if (best.length > 1) stats.tiedBranches++;
  const onward = best.find(
    (branch) =>
      AXIS_STEP[direction].x === branch.step.x && AXIS_STEP[direction].y === branch.step.y,
  );
  if (onward === undefined) return;
  check(
    Number.isFinite(onward.hops),
    `${where} points down a branch that reaches no room of the forced path`,
  );
  const wrong = branches.find((branch) => !best.includes(branch));
  if (wrong !== undefined) {
    const wrongDirection = AXIS_DIRECTIONS.find(
      (name) => AXIS_STEP[name].x === wrong.step.x && AXIS_STEP[name].y === wrong.step.y,
    );
    check(
      wrongDirection !== direction && !best.includes(wrong),
      `negative control: a sign pointing down branch ${wrongDirection} was not worse than the onward one`,
    );
  }

  if (sign.arrowAngle !== undefined) {
    const entrance = { x: centre.x + onward.step.x, y: centre.y + onward.step.y };
    const expected = expectedArrowAngle(sign.tile, entrance, direction);
    check(
      sameBearing(sign.arrowAngle, expected),
      `${where} arrow angle ${sign.arrowAngle} is not the bearing ${expected} to the first tile of the onward branch (${entrance.x},${entrance.y})`,
    );
    check(
      !sameBearing(sign.arrowAngle + WRONG_ANGLE_OFFSET_RADIANS, expected),
      `negative control: a wrong arrow angle at ${where} was accepted`,
    );
    const quarterTurns = sign.arrowAngle / WRONG_ANGLE_OFFSET_RADIANS;
    if (Math.abs(quarterTurns - Math.round(quarterTurns)) > ARROW_ANGLE_TOLERANCE_RADIANS) {
      stats.diagonalArrows++;
    }
    const wrongBranch = branches.find((branch) => !best.includes(branch));
    if (wrongBranch !== undefined) {
      const wrongEntrance = {
        x: centre.x + wrongBranch.step.x,
        y: centre.y + wrongBranch.step.y,
      };
      const towardWrong = expectedArrowAngle(sign.tile, wrongEntrance, direction);
      if (!sameBearing(towardWrong, expected)) {
        check(
          !sameBearing(towardWrong, sign.arrowAngle),
          `negative control: an arrow aimed down the wrong branch at ${where} was accepted`,
        );
      }
    }
    check(
      agreesWithDirection(sign.arrowAngle, direction),
      `${where} arrow angle contradicts its ${direction} wording`,
    );
  }

  const laneTiles = branches.map((branch) => ({
    x: centre.x + branch.step.x,
    y: centre.y + branch.step.y,
  }));
  check(
    lanesConnected(map, centre, laneTiles, new Set()),
    `${where} leaves the junction's branches disconnected with the sign stamped`,
  );
  for (const end of laneTiles) {
    const first = laneTiles[0];
    if (first === undefined || end === first) continue;
    check(
      playerCanWalk(map, first, end) && playerCanWalk(map, end, first),
      `${where} blocks a player-sized walk between two branches`,
    );
  }

  // A sign stamped into the lane of a one-tile hallway is the failure this
  // design exists to avoid; the same predicate must call it out.
  const blockedAcrossJunction = lanesConnected(
    map,
    centre,
    laneTiles,
    new Set(laneTiles.map(tileKeyOf)),
  );
  check(
    !blockedAcrossJunction,
    `negative control: solid tiles stamped into every one-tile lane at ${where} were reported connected`,
  );
  stats.hallwayNegativeControls++;
}

/** The room a sign's arrow leads to: the nearest-to-exit room its doorway reaches, ties to the lowest index. */
function onwardRoomOfRoomSign(model: FloorModel, sign: SignTile, room: number): number | null {
  const { direction, arrowAngle } = sign;
  if (direction === undefined || arrowAngle === undefined) return null;
  const aimed = openingsOnWall(model, room, direction).find((opening) =>
    sameBearing(arrowAngle, expectedArrowAngle(sign.tile, opening.entrance, direction)),
  );
  if (aimed === undefined) return null;
  const reached = [...(model.componentRooms[aimed.component] ?? [])].filter(
    (other) => other !== room,
  );
  const field = fieldOf(model, room);
  reached.sort(
    (a, b) =>
      (field[a] ?? Number.POSITIVE_INFINITY) - (field[b] ?? Number.POSITIVE_INFINITY) || a - b,
  );
  return reached[0] ?? null;
}

function verifySignByKind(
  model: FloorModel,
  sign: SignTile,
  direction: CrawlerSignDirection,
  where: string,
  stats: FloorStats,
): void {
  const room = roomIndexAt(model, sign.tile.x, sign.tile.y);
  if (room === NO_ROOM) {
    stats.hallwaySigns++;
    verifyHallwaySign(model, sign, direction, where, stats);
    return;
  }
  stats.roomSigns++;
  verifyRoomSign(model, sign, direction, room, where, stats);
}

/**
 * Follows every sign's arrow onward, sign to sign, to the exit. With one shared
 * exit this can only pass while each step lands strictly nearer it, so any pair of
 * signs that contradict each other, or a sign pointing back at where the chain
 * came from, fails here whatever each sign's local check said.
 */
function verifyChains(model: FloorModel, signs: ReadonlyArray<SignTile>, stats: FloorStats): void {
  const signOnward = new Map<number, number>();
  const starts: Array<{ from: number; onward: number; where: string }> = [];
  for (const sign of signs) {
    const room = roomIndexAt(model, sign.tile.x, sign.tile.y);
    const where = `sign at (${sign.tile.x},${sign.tile.y})`;
    if (room === NO_ROOM) {
      const onward = hallwayOnwardRoom(model, sign);
      if (onward !== null) starts.push({ from: NO_ROOM, onward, where });
      continue;
    }
    const onward = onwardRoomOfRoomSign(model, sign, room);
    check(onward !== null, `${where} leads to no onward room`);
    if (onward === null) continue;
    signOnward.set(room, onward);
    starts.push({ from: room, onward, where });
  }
  for (const { from, onward, where } of starts) {
    const stage = model.stageOfRoom[onward] ?? NO_STAGE;
    const exitRoom = model.stageGoals[stage];
    check(exitRoom !== undefined, `${where} leads to room ${onward}, which is off the forced path`);
    if (exitRoom === undefined) continue;
    const field = fieldOf(model, onward);
    const { failure, signsMet } = chainFailure(
      field,
      model.neighbours,
      signOnward,
      exitRoom,
      onward,
      from,
    );
    check(failure === null, `${where}: following the signs onward fails: ${failure}`);
    stats.chainedSigns += signsMet;

    // The red path: point the next room's sign back where this one came from and
    // the very same walk must call it out.
    if (from === NO_ROOM) continue;
    const reversed = new Map(signOnward);
    reversed.set(onward, from);
    const { failure: controlFailure } = chainFailure(
      field,
      model.neighbours,
      reversed,
      exitRoom,
      onward,
      from,
    );
    if (onward !== exitRoom) {
      stats.chainControls++;
      check(
        controlFailure !== null,
        `negative control: a sign pointing back from room ${onward} to room ${from} was followed without complaint`,
      );
    }
  }
}

/** The room at the far end of the onward branch of a hallway sign, read from the live map. */
function hallwayOnwardRoom(model: FloorModel, sign: SignTile): number | null {
  const direction = sign.direction;
  if (direction === undefined) return null;
  const { map } = model;
  const junction = [...ORTHOGONAL_STEPS, ...DIAGONAL_STEPS]
    .map((step) => ({ x: sign.tile.x + step.x, y: sign.tile.y + step.y }))
    .find(
      (tile) =>
        map.isWalkable(tile.x, tile.y) &&
        ORTHOGONAL_STEPS.filter((step) => map.isWalkable(tile.x + step.x, tile.y + step.y))
          .length >= MIN_HALLWAY_BRANCHES,
    );
  if (junction === undefined) return null;
  const step = AXIS_STEP[direction];
  const first = { x: junction.x + step.x, y: junction.y + step.y };
  const seen = new Set<number>([tileKeyOf(junction), tileKeyOf(first)]);
  const queue: Point[] = [first];
  const reached: number[] = [];
  for (const tile of queue) {
    for (const next of ORTHOGONAL_STEPS) {
      const neighbour = { x: tile.x + next.x, y: tile.y + next.y };
      if (!map.isWalkable(neighbour.x, neighbour.y)) continue;
      const room = roomIndexAt(model, neighbour.x, neighbour.y);
      if (room !== NO_ROOM) {
        reached.push(room);
        continue;
      }
      if (seen.has(tileKeyOf(neighbour))) continue;
      seen.add(tileKeyOf(neighbour));
      queue.push(neighbour);
    }
  }
  const field = fieldOf(model, reached[0] ?? NO_ROOM);
  reached.sort(
    (a, b) =>
      (field[a] ?? Number.POSITIVE_INFINITY) - (field[b] ?? Number.POSITIVE_INFINITY) || a - b,
  );
  return reached[0] ?? null;
}

/** Tiles beyond an arena's radius the generator keeps sign pockets out of; restated here so the gate does not import the generator's constant. */
const ARENA_POCKET_MARGIN_TILES = 6;

/** Walkable tiles reachable from the start, split by whether the last required goal room lies in the way. */
function searchTerritory(model: FloorModel): { near: Set<number>; far: Set<number> } {
  const { map } = model;
  const finalGoal = model.stageGoals[model.stageGoals.length - 1];
  const flood = (blocked: boolean): Set<number> => {
    const seen = new Set<number>();
    const start = map.startTile;
    seen.add(tileKeyOf(start));
    const queue: Point[] = [start];
    for (const tile of queue) {
      for (const step of ORTHOGONAL_STEPS) {
        const next = { x: tile.x + step.x, y: tile.y + step.y };
        if (!map.isWalkable(next.x, next.y) || seen.has(tileKeyOf(next))) continue;
        if (blocked && roomIndexAt(model, next.x, next.y) === finalGoal) continue;
        seen.add(tileKeyOf(next));
        queue.push(next);
      }
    }
    return seen;
  };
  const near = flood(true);
  const far = new Set<number>();
  for (const key of flood(false)) {
    const tile = { x: key % TILE_KEY_STRIDE, y: Math.floor(key / TILE_KEY_STRIDE) };
    if (!near.has(key) && roomIndexAt(model, tile.x, tile.y) !== finalGoal) far.add(key);
  }
  return { near, far };
}

/** Whether a sign standing at `tile` would speak to walkers in the stair-search territory. */
function touchesSearch(far: ReadonlySet<number>, tile: Point): boolean {
  return [...ORTHOGONAL_STEPS, ...DIAGONAL_STEPS].some((step) =>
    far.has(tileKeyOf({ x: tile.x + step.x, y: tile.y + step.y })),
  );
}

/** Whether a sign's board touches any safe room's rectangle. */
function signTouchesSafeRoom(map: GameMap, sign: SignTile): boolean {
  return crawlerSignFootprint(sign.tile).some((tile) =>
    map.safeRooms.some((room) => rectContains(room.bounds, tile.x, tile.y)),
  );
}

/**
 * No sign of either kind may stand in a safe room: the scene stamps their counters
 * and decor after generation, and safe rooms are never signed. The control plants a
 * sign at a safe room's centre and requires the same predicate to flag it, so a
 * predicate that quietly matched nothing cannot leave this gate green.
 */
function verifyNoSafeRoomSigns(
  map: GameMap,
  signs: ReadonlyArray<SignTile>,
  stats: FloorStats,
): void {
  for (const sign of signs) {
    check(
      !signTouchesSafeRoom(map, sign),
      `sign at (${sign.tile.x},${sign.tile.y}) stands in a safe room`,
    );
  }
  for (const room of map.safeRooms) {
    stats.safeRoomControls++;
    const planted: SignTile = {
      tile: room.centre,
      direction: 'North',
      arrowAngle: 0,
    };
    check(
      signTouchesSafeRoom(map, planted),
      'negative control: a sign planted in a safe room was not flagged',
    );
  }
}

/** Every one-tile-wide fork in a hallway: no room, no wide floor beside it. */
function genuineJunctions(model: FloorModel): Point[] {
  const { map } = model;
  const found: Point[] = [];
  for (let y = 1; y < map.gridSize - 1; y++) {
    for (let x = 1; x < map.gridSize - 1; x++) {
      const tile = { x, y };
      if (!map.isWalkable(x, y) || roomIndexAt(model, x, y) !== NO_ROOM) continue;
      const open = openSidesOf(map, tile);
      if (open.length < MIN_HALLWAY_BRANCHES) continue;
      if (open.some((step) => roomIndexAt(model, x + step.x, y + step.y) !== NO_ROOM)) continue;
      if (DIAGONAL_STEPS.some((step) => map.isWalkable(x + step.x, y + step.y))) continue;
      found.push(tile);
    }
  }
  return found;
}

/** Why no wall tile beside `junction` could legally hold a sign, or null when one could. */
function noPocketReason(
  model: FloorModel,
  junction: Point,
  claimed: ReadonlySet<number>,
): string | null {
  const { map } = model;
  const isJunction = (t: Point): boolean =>
    map.isWalkable(t.x, t.y) && openSidesOf(map, t).length >= MIN_HALLWAY_BRANCHES;
  const legal = [...ORTHOGONAL_STEPS, ...DIAGONAL_STEPS].some((step) => {
    const pocket = { x: junction.x + step.x, y: junction.y + step.y };
    if (map.structure[pocket.y][pocket.x].type !== FloorTypeValue.wall) return false;
    if (claimed.has(tileKeyOf(pocket))) return false;
    for (const around of [...ORTHOGONAL_STEPS, ...DIAGONAL_STEPS, { x: 0, y: 0 }]) {
      if (roomIndexAt(model, pocket.x + around.x, pocket.y + around.y) !== NO_ROOM) return false;
    }
    const nearArena = map.arenaExteriors.some(
      (arena) =>
        Math.hypot(pocket.x - arena.centre.x, pocket.y - arena.centre.y) <=
        arena.radius + ARENA_POCKET_MARGIN_TILES,
    );
    if (nearArena) return false;
    const beside = [...ORTHOGONAL_STEPS, ...DIAGONAL_STEPS].filter((a) =>
      isJunction({ x: pocket.x + a.x, y: pocket.y + a.y }),
    );
    return beside.length === 1;
  });
  return legal
    ? null
    : 'no legal pocket: every wall tile beside it is claimed, beside a room, in the arena margin or touches a second junction';
}

/** Tiles of `room` the planner's own claim rules would treat as taken, judged from the live map. */
function claimedTilesOf(model: FloorModel): Set<number> {
  const claimed = new Set(claimLists(model.map).flatMap((list) => list.points.map(tileKeyOf)));
  for (const stairwell of model.map.stairwellTiles) {
    for (const tile of stairwellFootprint(stairwell)) claimed.add(tileKeyOf(tile));
  }
  return claimed;
}

/** The floor type most of a room's walkable tiles carry; a tile of any other type was stamped by a fixture or a prop. */
function dominantFloorType(model: FloorModel, room: number, ignored: Point | null): number | null {
  const bounds = model.rooms[room];
  const counts = new Map<number, number>();
  for (let y = bounds.y; y < bounds.y + bounds.h; y++) {
    for (let x = bounds.x; x < bounds.x + bounds.w; x++) {
      if (ignored !== null && ignored.x === x && ignored.y === y) continue;
      if (!model.map.isWalkable(x, y)) continue;
      const type = model.map.structure[y][x].type;
      counts.set(type, (counts.get(type) ?? 0) + 1);
    }
  }
  let best: number | null = null;
  let bestCount = 0;
  for (const [type, count] of counts) {
    if (count <= bestCount) continue;
    best = type;
    bestCount = count;
  }
  return best;
}

/**
 * Every interior tile of `room` where a sign could legally stand: unclaimed floor of
 * the room's own type, at least {@link MIN_DOORWAY_CLEARANCE_TILES} from every
 * doorway, that leaves each walkable neighbour somewhere to move once it is solid.
 *
 * `ignoredSign` is a sign the caller is pretending is absent: its tile counts as
 * open floor, which is how a control removes a real sign and asks the same question.
 */
function legalSignSeats(
  model: FloorModel,
  room: number,
  claimed: ReadonlySet<number>,
  ignoredSign: Point | null,
): Point[] {
  const { map } = model;
  const bounds = model.rooms[room];
  const size = map.gridSize;
  const floorType = dominantFloorType(model, room, ignoredSign);
  const isIgnored = (tile: Point): boolean =>
    ignoredSign !== null && ignoredSign.x === tile.x && ignoredSign.y === tile.y;
  const walkable = (tile: Point): boolean => isIgnored(tile) || map.isWalkable(tile.x, tile.y);

  const doorwayTiles = [...doorwayComponents(model, room)].flatMap((component) =>
    doorwayPerimeters(model, room, component),
  );
  const seats: Point[] = [];
  for (let y = bounds.y + 1; y < bounds.y + bounds.h - 1; y++) {
    for (let x = bounds.x + 1; x < bounds.x + bounds.w - 1; x++) {
      const tile = { x, y };
      if (!walkable(tile) || claimed.has(tileKeyOf(tile))) continue;
      if (!isIgnored(tile) && map.structure[y][x].type !== floorType) continue;
      const clearOfDoorways = doorwayTiles.every(
        (edge) =>
          Math.max(Math.abs(edge.x - x), Math.abs(edge.y - y)) >= MIN_DOORWAY_CLEARANCE_TILES,
      );
      if (!clearOfDoorways) continue;
      const walkableWithSeat = (nx: number, ny: number): boolean =>
        !(nx === x && ny === y) && walkable({ x: nx, y: ny });
      const leavesNeighboursRoom = ORTHOGONAL_STEPS.every((step) => {
        const nx = x + step.x;
        const ny = y + step.y;
        if (!walkableWithSeat(nx, ny)) return true;
        return hasOpenRegion(walkableWithSeat, size, size, nx, ny);
      });
      if (leavesNeighboursRoom) seats.push(tile);
    }
  }
  return seats;
}

/** Signs a scripted encounter's room may never hold, and the reason each kind is excluded. */
function excludedRoleOf(model: FloorModel, room: number): string | null {
  const bounds = model.rooms[room];
  const sameRoom = (other: Rect): boolean =>
    other.x === bounds.x && other.y === bounds.y && other.w === bounds.w && other.h === bounds.h;
  const { map } = model;
  if (map.progressionLayout !== undefined && sameRoom(map.progressionLayout.startRoom)) {
    return 'excluded role: the start room, where the player has not yet chosen anything';
  }
  if (map.safeRooms.some((safe) => sameRoom(safe.bounds))) {
    return 'excluded role: a safe room, a hub whose counters and decor are stamped after generation, and the user asked for no signs there';
  }
  if (map.bossRooms.some((boss) => sameRoom(boss.bounds))) {
    return 'excluded role: a boss room, the goal of its own leg';
  }
  if (map.questRooms.some((quest) => sameRoom(quest.bounds))) {
    return 'excluded role: a quest room, staged as a scripted encounter';
  }
  if (map.spiderLabRoom !== null && sameRoom(map.spiderLabRoom.bounds)) {
    return 'excluded role: the spider lab, staged as a scripted encounter';
  }
  return null;
}

/**
 * Whether two equally short corridors to the onward room leave through different
 * walls, which leaves an arrow with no single doorway to name.
 */
function hasTwinCorridorsOnDifferentWalls(
  model: FloorModel,
  room: number,
  onward: number,
): boolean {
  const corridors = [...doorwayComponents(model, room)]
    .filter((component) => model.componentRooms[component]?.has(onward) === true)
    .map((component) => ({
      length: model.componentTiles[component]?.length ?? 0,
      walls: new Set(
        AXIS_DIRECTIONS.filter((direction) =>
          openingsOnWall(model, room, direction).some((opening) => opening.component === component),
        ),
      ),
    }))
    .sort((a, b) => a.length - b.length);
  const [shortest, runnerUp] = corridors;
  if (shortest === undefined || runnerUp === undefined || shortest.length !== runnerUp.length) {
    return false;
  }
  return ![...shortest.walls].some((wall) => runnerUp.walls.has(wall));
}

/**
 * Why a forced-path trap junction room may go unsigned, or null when nothing excuses
 * it. An exemption is a claim that the planner could not have done otherwise, so each
 * is proved here rather than assumed from the room's role: a room that could seat a
 * sign and has none is a failure.
 */
function roomWithoutSignReason(
  model: FloorModel,
  room: number,
  onward: number,
  claimed: ReadonlySet<number>,
  ignoredSign: Point | null,
): string | null {
  const excluded = excludedRoleOf(model, room);
  if (excluded !== null) return excluded;
  if (hasTwinCorridorsOnDifferentWalls(model, room, onward)) {
    return 'two equally short corridors to the onward room leave through different walls';
  }
  const seats = legalSignSeats(model, room, claimed, ignoredSign);
  if (seats.length === 0)
    return 'no legal seat: every interior tile is claimed, near a doorway or would crowd a neighbour';
  return null;
}

/**
 * Every room on the forced path that is a real three-way choice with a trap in it
 * must hold a sign; the unsigned ones are counted with the reason that excuses them.
 */
function verifyRoomCoverage(
  model: FloorModel,
  signs: ReadonlyArray<SignTile>,
  stats: FloorStats,
): void {
  const claimed = claimedTilesOf(model);
  for (const room of model.rooms.keys()) {
    const stage = model.stageOfRoom[room] ?? NO_STAGE;
    if (stage === NO_STAGE) continue;
    const openings = doorwayComponents(model, room);
    if (!isRealJunction(model, openings)) continue;
    const toGoal = model.stageDistance[stage] ?? [];
    const here = toGoal[room] ?? Number.POSITIVE_INFINITY;
    const neighbours = [...(model.neighbours[room] ?? [])];
    const closer = neighbours.filter((n) => (toGoal[n] ?? Number.POSITIVE_INFINITY) < here);
    const [onward] = closer;
    if (closer.length !== 1 || onward === undefined || closer.length === neighbours.length) {
      continue;
    }
    const label = `room ${room} (${model.rooms[room].x},${model.rooms[room].y})`;
    const present = signs.find((sign) => rectContains(model.rooms[room], sign.tile.x, sign.tile.y));
    const outcomes = roomJunctionOutcomes(model, room);
    if (!isTrapJunction(outcomes)) {
      stats.leafJunctions++;
      check(present === undefined, `${label} has a sign but no wrong turn there is a trap`);
      continue;
    }
    stats.roomsRequired++;
    stats.trapJunctions++;
    tallyTrapKinds(outcomes, stats);
    if (present !== undefined) {
      stats.roomsSigned++;
      // The red path: delete this planner sign and ask the same question. The
      // room must then stand unexplained, or the exemption logic excuses anything.
      const withoutIt = roomWithoutSignReason(model, room, onward, claimed, present.tile);
      stats.roomControls++;
      check(
        withoutIt === null,
        `negative control: with the sign at (${present.tile.x},${present.tile.y}) deleted, ${label} was still excused: ${withoutIt}`,
      );
      continue;
    }
    const reason = roomWithoutSignReason(model, room, onward, claimed, null);
    stats.exemptions.push(`${label}: ${reason ?? 'UNEXPLAINED'}`);
    if (reason?.includes('a safe room') === true) stats.safeExcludedRooms++;
    check(reason !== null, `${label} on the forced path has no sign and nothing explains it`);
  }
}

/**
 * Every hallway junction on the forced path must have a sign beside it; the ones
 * that cannot are counted, each with the hard constraint that stops it. Also proves
 * no sign speaks to the stair-search territory.
 */
function verifyCoverage(
  model: FloorModel,
  signs: ReadonlyArray<SignTile>,
  stats: FloorStats,
): void {
  const claimed = new Set(claimLists(model.map).flatMap((l) => l.points.map(tileKeyOf)));
  const signKeys = new Set(signs.map((sign) => tileKeyOf(sign.tile)));
  const beside = (junction: Point, ignored: number | null): boolean =>
    [...ORTHOGONAL_STEPS, ...DIAGONAL_STEPS].some((step) => {
      const key = tileKeyOf({ x: junction.x + step.x, y: junction.y + step.y });
      return key !== ignored && signKeys.has(key);
    });

  const { far } = searchTerritory(model);
  check(
    far.size > 0,
    'the floor has no stair-search territory; the forced-path derivation found nothing to exclude',
  );
  check(
    model.stageGoals.length >= 2,
    `only ${model.stageGoals.length} required goals were derived`,
  );
  for (const sign of signs) {
    stats.searchTilesChecked++;
    check(
      !touchesSearch(far, sign.tile),
      `sign at (${sign.tile.x},${sign.tile.y}) speaks to the stair-search territory`,
    );
  }
  const probe = [...far].map((key) => ({
    x: key % TILE_KEY_STRIDE,
    y: Math.floor(key / TILE_KEY_STRIDE),
  }))[0];
  if (probe !== undefined) {
    stats.searchControls++;
    check(
      touchesSearch(far, probe),
      'negative control: a sign in the search territory was not flagged',
    );
  }

  let controlled = false;
  for (const junction of genuineJunctions(model)) {
    const branches = junctionBranches(model, junction);
    if (junctionStage(model, branches) === NO_STAGE) {
      stats.junctionsOffPath++;
      continue;
    }
    const label = `junction (${junction.x},${junction.y})`;
    const stage = junctionStage(model, branches);
    const outcomes = hallwayJunctionOutcomes(model, junction, stage);
    if (!isTrapJunction(outcomes)) {
      stats.leafJunctions++;
      check(!beside(junction, null), `${label} has a sign but no wrong turn there is a trap`);
      continue;
    }
    stats.junctionsRequired++;
    stats.trapJunctions++;
    tallyTrapKinds(outcomes, stats);
    if (beside(junction, null)) {
      stats.junctionsSigned++;
      const servingKey = [...ORTHOGONAL_STEPS, ...DIAGONAL_STEPS]
        .map((step) => tileKeyOf({ x: junction.x + step.x, y: junction.y + step.y }))
        .find((key) => signKeys.has(key));
      if (!controlled && servingKey !== undefined) {
        controlled = true;
        stats.coverageControls++;
        check(
          !beside(junction, servingKey) || noPocketReason(model, junction, claimed) === null,
          'negative control: removing a sign left its junction covered',
        );
      }
      continue;
    }
    const reason = noPocketReason(model, junction, claimed);
    stats.exemptions.push(`${label}: ${reason ?? 'UNEXPLAINED'}`);
    check(
      reason !== null,
      `${label} on the forced path has no sign and no hard constraint explains it`,
    );
  }
}

/** Side of the hand-built grids, in tiles; large enough for every scene below with walls to spare. */
const SCENE_SIZE = 60;

interface Scene {
  readonly name: string;
  readonly plan: CrawlerSignInput;
}

const floorTile = (): TileContent => ({ tileId: 'gate-floor', type: FloorTypeValue.concrete });
const wallTile = (): TileContent => ({ tileId: 'gate-wall', type: FloorTypeValue.wall });

/** Every tile on the axis-aligned segments joining `corners` in order. */
function polyline(...corners: Point[]): Point[] {
  const tiles: Point[] = [];
  for (const [index, from] of corners.entries()) {
    const to = corners[index + 1];
    if (to === undefined) break;
    const stepX = Math.sign(to.x - from.x);
    const stepY = Math.sign(to.y - from.y);
    for (let tile = { ...from }; ; tile = { x: tile.x + stepX, y: tile.y + stepY }) {
      tiles.push(tile);
      if (tile.x === to.x && tile.y === to.y) break;
    }
  }
  return tiles;
}

/**
 * A grid of solid wall with `rooms` hollowed out (their outer ring stays wall) and
 * each corridor cut through, the ends of a corridor breaking through room walls.
 */
function buildScene(
  name: string,
  rooms: ReadonlyArray<Rect>,
  corridors: ReadonlyArray<ReadonlyArray<Point>>,
  startRoom: Rect,
  goalRooms: ReadonlyArray<Rect>,
): Scene {
  const grid = Array.from({ length: SCENE_SIZE }, () =>
    Array.from({ length: SCENE_SIZE }, wallTile),
  );
  for (const room of rooms) {
    for (let y = room.y + 1; y < room.y + room.h - 1; y++) {
      for (let x = room.x + 1; x < room.x + room.w - 1; x++) grid[y][x] = floorTile();
    }
  }
  for (const corridor of corridors) {
    for (const tile of corridor) grid[tile.y][tile.x] = floorTile();
  }
  return {
    name,
    plan: {
      grid,
      rooms: rooms.map((room) => ({ ...room, eligible: true })),
      startRoom,
      goalRooms,
      claimedTiles: new Set<number>(),
      keepClear: [],
    },
  };
}

const at = (x: number, y: number): Point => ({ x, y });
const roomAtSpot = (x: number, y: number, w: number, h: number): Rect => ({ x, y, w, h });

/** Signs a scene's plan seats, split by kind. */
function plannedSigns(scene: Scene): {
  rooms: PlannedCrawlerSign[];
  hallways: PlannedCrawlerSign[];
} {
  const signs = planCrawlerSigns(scene.plan);
  return {
    rooms: signs.filter((sign) => sign.kind === 'room'),
    hallways: signs.filter((sign) => sign.kind === 'hallway'),
  };
}

/** How far, in tiles, a hallway sign's pocket may sit from the junction it serves. */
const POCKET_REACH_TILES = 1;

/** Row the northern twin corridor turns at, three tiles above the room it leaves. */
const NORTHERN_TWIN_ROW = 2;

/** Row the southern twin corridor turns at to mirror the northern one exactly. */
const MIRRORED_TWIN_ROW = 20;

/** Row the southern twin corridor turns at to be the longer of the two. */
const LONGER_TWIN_ROW = 22;

/**
 * A junction room with two corridors to the goal room, one out of its north wall
 * and one out of its south, plus a three-room dead-end tree as the wrong turn. The
 * southern corridor turns at `southernTurnRow`: the mirrored row makes the two
 * exactly as long, a deeper one makes the southern the longer.
 */
function twinCorridorScene(name: string, southernTurnRow: number): Scene {
  const start = roomAtSpot(1, 5, 9, 13);
  const hub = roomAtSpot(22, 5, 13, 13);
  const goal = roomAtSpot(45, 5, 13, 13);
  const firstStub = roomAtSpot(22, 24, 13, 9);
  const secondStub = roomAtSpot(22, 38, 13, 9);
  const thirdStub = roomAtSpot(45, 24, 13, 9);
  return buildScene(
    name,
    [hub, start, goal, firstStub, secondStub, thirdStub],
    [
      polyline(at(9, 11), at(22, 11)),
      polyline(at(28, 5), at(28, NORTHERN_TWIN_ROW), at(51, NORTHERN_TWIN_ROW), at(51, 5)),
      polyline(at(28, 17), at(28, southernTurnRow), at(51, southernTurnRow), at(51, 17)),
      polyline(at(25, 17), at(25, 24)),
      polyline(at(28, 32), at(28, 38)),
      polyline(at(34, 28), at(45, 28)),
    ],
    start,
    [goal],
  );
}

/**
 * The trap rule on hand-built levels, run through the planner itself. Each scene is
 * a start room, a goal room, and one junction with a single wrong turn of a known
 * shape; the only thing that differs between scenes is what that wrong turn is.
 */
function verifyTrapScenes(): number {
  currentSeed = 0;
  const hallwayStart = roomAtSpot(1, 5, 11, 11);
  const hallwayGoal = roomAtSpot(40, 5, 11, 11);
  const mainRow = polyline(at(11, 10), at(40, 10));
  const hallwayJunction = at(25, 10);
  const stemDown = polyline(at(25, 11), at(25, 22));
  const firstStub = roomAtSpot(20, 22, 11, 9);
  const secondStub = roomAtSpot(20, 36, 11, 9);
  const thirdStub = roomAtSpot(38, 22, 11, 9);
  const stubLink = polyline(at(25, 30), at(25, 36));
  const sideLink = polyline(at(30, 26), at(38, 26));

  const hallwayScene = (
    name: string,
    rooms: ReadonlyArray<Rect>,
    corridors: ReadonlyArray<ReadonlyArray<Point>>,
  ): Scene =>
    buildScene(name, [hallwayStart, hallwayGoal, ...rooms], [mainRow, ...corridors], hallwayStart, [
      hallwayGoal,
    ]);

  const pastGoalStart = roomAtSpot(1, 5, 11, 11);
  const pastGoalRoom = roomAtSpot(20, 5, 11, 11);
  const beyondRoom = roomAtSpot(50, 5, 11, 11);
  const pastGoal = buildScene(
    'a circle in the stair-search territory past the last goal',
    [pastGoalStart, pastGoalRoom, beyondRoom],
    [
      polyline(at(11, 10), at(20, 10)),
      polyline(at(30, 10), at(50, 10)),
      polyline(at(40, 10), at(40, 18), at(46, 18), at(46, 10)),
    ],
    pastGoalStart,
    [pastGoalRoom],
  );

  const hallwayCases: ReadonlyArray<{ scene: Scene; signed: boolean }> = [
    {
      scene: hallwayScene(
        'a fork whose wrong branch is one dead-end room',
        [firstStub],
        [stemDown],
      ),
      signed: false,
    },
    {
      scene: hallwayScene(
        'a fork whose wrong branch is a two-room dead end',
        [firstStub, secondStub],
        [stemDown, stubLink],
      ),
      signed: false,
    },
    {
      scene: hallwayScene(
        'a fork whose wrong branch is a three-room dead-end tree',
        [firstStub, secondStub, thirdStub],
        [stemDown, stubLink, sideLink],
      ),
      signed: true,
    },
    {
      scene: hallwayScene(
        'a fork whose wrong branch circles back to the hallway behind it',
        [],
        [polyline(at(25, 10), at(25, 18), at(15, 18), at(15, 10))],
      ),
      signed: true,
    },
    { scene: pastGoal, signed: false },
  ];

  const junctionRoom = roomAtSpot(22, 5, 13, 13);
  const roomStart = roomAtSpot(1, 5, 9, 13);
  const roomGoal = roomAtSpot(45, 5, 13, 13);
  const roomFirstStub = roomAtSpot(22, 24, 13, 9);
  const roomSecondStub = roomAtSpot(22, 38, 13, 9);
  const roomThirdStub = roomAtSpot(45, 24, 13, 9);
  const roomRing = roomAtSpot(4, 24, 13, 9);
  const roomSpine = [polyline(at(9, 11), at(22, 11)), polyline(at(34, 11), at(45, 11))];
  const roomStem = polyline(at(28, 17), at(28, 24));

  const roomScene = (
    name: string,
    rooms: ReadonlyArray<Rect>,
    corridors: ReadonlyArray<ReadonlyArray<Point>>,
  ): Scene =>
    buildScene(
      name,
      [junctionRoom, roomStart, roomGoal, ...rooms],
      [...roomSpine, ...corridors],
      roomStart,
      [roomGoal],
    );
  const roomCases: ReadonlyArray<{ scene: Scene; signed: boolean }> = [
    {
      scene: roomScene(
        'a junction room whose wrong door is one dead-end room',
        [roomFirstStub],
        [roomStem],
      ),
      signed: false,
    },
    {
      scene: roomScene(
        'a junction room whose wrong door is a two-room dead end',
        [roomFirstStub, roomSecondStub],
        [roomStem, polyline(at(28, 32), at(28, 38))],
      ),
      signed: false,
    },
    {
      scene: roomScene(
        'a junction room whose wrong door is a three-room dead-end tree',
        [roomFirstStub, roomSecondStub, roomThirdStub],
        [roomStem, polyline(at(28, 32), at(28, 38)), polyline(at(34, 28), at(45, 28))],
      ),
      signed: true,
    },
    {
      scene: roomScene(
        'a junction room with two doors that lead round to each other',
        [roomFirstStub, roomRing],
        [roomStem, polyline(at(22, 28), at(16, 28)), polyline(at(22, 15), at(12, 15), at(12, 24))],
      ),
      signed: true,
    },
  ];

  // Junctions past the first goal: the way in is a previous leg's goal room, not the start.
  const laterStart = roomAtSpot(1, 5, 9, 11);
  const laterFirstGoal = roomAtSpot(12, 5, 9, 11);
  const laterMiddle = roomAtSpot(23, 5, 9, 11);
  const laterFinalGoal = roomAtSpot(48, 5, 9, 11);
  const laterFork = at(39, 10);
  const laterHallwayScene = buildScene(
    'a fork on the second leg whose wrong branch circles back',
    [laterStart, laterFirstGoal, laterMiddle, laterFinalGoal],
    [
      polyline(at(9, 10), at(12, 10)),
      polyline(at(20, 10), at(23, 10)),
      polyline(at(31, 10), at(48, 10)),
      polyline(at(39, 10), at(39, 18), at(35, 18), at(35, 10)),
    ],
    laterStart,
    [laterFirstGoal, laterFinalGoal],
  );

  // A room whose wrong door leads round to the previous leg's goal room, which the
  // walk has to pass through rather than stop at.
  const loopStart = roomAtSpot(1, 5, 9, 13);
  const loopFirstGoal = roomAtSpot(14, 5, 9, 13);
  const loopHub = roomAtSpot(28, 5, 13, 13);
  const loopFinalGoal = roomAtSpot(46, 5, 11, 13);
  const loopDetour = roomAtSpot(28, 24, 13, 9);
  const throughGoalScene = buildScene(
    'a second-leg junction room whose wrong door circles through the first goal',
    [loopStart, loopFirstGoal, loopHub, loopFinalGoal, loopDetour],
    [
      polyline(at(9, 11), at(14, 11)),
      polyline(at(22, 11), at(28, 11)),
      polyline(at(40, 11), at(46, 11)),
      polyline(at(34, 17), at(34, 24)),
      polyline(at(28, 28), at(18, 28), at(18, 17)),
    ],
    loopStart,
    [loopFirstGoal, loopFinalGoal],
  );

  const twinCases: ReadonlyArray<{
    scene: Scene;
    roomDirection: CrawlerSignDirection | null;
  }> = [
    {
      scene: roomScene(
        'a junction room with a second, longer corridor to the onward room',
        [roomFirstStub, roomSecondStub, roomThirdStub],
        [
          roomStem,
          polyline(at(28, 32), at(28, 38)),
          polyline(at(34, 28), at(45, 28)),
          polyline(at(28, 5), at(28, 2), at(51, 2), at(51, 5)),
        ],
      ),
      roomDirection: 'East',
    },
    {
      scene: twinCorridorScene(
        'a junction room with two equally short corridors to the onward room on different walls',
        MIRRORED_TWIN_ROW,
      ),
      roomDirection: null,
    },
    {
      scene: twinCorridorScene(
        'a junction room whose two corridors to the onward room differ in length',
        LONGER_TWIN_ROW,
      ),
      roomDirection: 'North',
    },
  ];

  let controls = 0;
  for (const { scene, signed } of hallwayCases) {
    controls++;
    const { rooms, hallways } = plannedSigns(scene);
    check(rooms.length === 0, `scene "${scene.name}": a room sign was seated where none belongs`);
    const near = hallways.filter(
      (sign) =>
        Math.max(
          Math.abs(sign.tile.x - hallwayJunction.x),
          Math.abs(sign.tile.y - hallwayJunction.y),
        ) <= POCKET_REACH_TILES,
    );
    check(
      signed ? near.length === 1 && hallways.length === 1 : hallways.length === 0,
      `scene "${scene.name}": expected ${signed ? 'exactly one sign, at the fork' : 'no sign'}, got ${hallways.length} (${near.length} at the fork)`,
    );
    if (signed) {
      check(
        near[0]?.direction === 'East',
        `scene "${scene.name}": the sign points ${near[0]?.direction}, not toward the goal`,
      );
    }
  }
  for (const { scene, signed } of roomCases) {
    controls++;
    const { rooms, hallways } = plannedSigns(scene);
    check(
      hallways.length === 0,
      `scene "${scene.name}": a hallway sign was seated where none belongs`,
    );
    check(
      signed ? rooms.length === 1 : rooms.length === 0,
      `scene "${scene.name}": expected ${signed ? 'one room sign' : 'no sign'}, got ${rooms.length}`,
    );
    if (signed) {
      check(
        rooms[0]?.direction === 'East',
        `scene "${scene.name}": the sign points ${rooms[0]?.direction}, not toward the goal`,
      );
    }
  }
  const laterSigns = plannedSigns(laterHallwayScene);
  controls++;
  const laterNear = laterSigns.hallways.filter(
    (sign) =>
      Math.max(Math.abs(sign.tile.x - laterFork.x), Math.abs(sign.tile.y - laterFork.y)) <=
      POCKET_REACH_TILES,
  );
  check(
    laterSigns.rooms.length === 0 &&
      laterSigns.hallways.length === 1 &&
      laterNear.length === 1 &&
      laterNear[0]?.direction === 'East',
    `scene "${laterHallwayScene.name}": expected one East sign at the fork, got ${laterSigns.hallways.length} hallway and ${laterSigns.rooms.length} room signs`,
  );

  const throughGoalSigns = plannedSigns(throughGoalScene);
  controls++;
  check(
    throughGoalSigns.hallways.length === 0 &&
      throughGoalSigns.rooms.length === 1 &&
      throughGoalSigns.rooms[0]?.direction === 'East',
    `scene "${throughGoalScene.name}": expected one East room sign, got ${throughGoalSigns.rooms.length} room signs`,
  );

  for (const { scene, roomDirection } of twinCases) {
    controls++;
    const { rooms, hallways } = plannedSigns(scene);
    check(hallways.length === 0, `scene "${scene.name}": a hallway sign was seated`);
    check(
      roomDirection === null
        ? rooms.length === 0
        : rooms.length === 1 && rooms[0]?.direction === roomDirection,
      `scene "${scene.name}": expected ${roomDirection === null ? 'no sign' : `one ${roomDirection} sign`}, got ${rooms.map((sign) => sign.direction).join(',') || 'none'}`,
    );
  }
  return controls;
}

function verifyFloor(levelDef: LevelDef, floorIndex: number): void {
  console.log(`\n── ${levelDef.id} (${levelDef.name}) ──`);
  const stats: FloorStats = {
    roomSigns: 0,
    hallwaySigns: 0,
    negativeControls: 0,
    tiedDoorways: 0,
    diagonalArrows: 0,
    farEndControls: 0,
    chainedSigns: 0,
    hallwayNegativeControls: 0,
    overhangControls: 0,
    junctionControls: 0,
    boardsChecked: 0,
    chainControls: 0,
    tiedBranches: 0,
    junctionsRequired: 0,
    junctionsSigned: 0,
    junctionsOffPath: 0,
    roomsRequired: 0,
    roomsSigned: 0,
    roomControls: 0,
    exemptions: [],
    searchTilesChecked: 0,
    searchControls: 0,
    coverageControls: 0,
    trapJunctions: 0,
    leafJunctions: 0,
    loopJunctions: 0,
    deadEndJunctions: 0,
    safeRoomControls: 0,
    safeExcludedRooms: 0,
  };

  for (let run = 0; run < RUNS_PER_FLOOR; run++) {
    currentSeed = floorIndex * SEED_STRIDE_PER_FLOOR + run + seedOffset;
    if (!Number.isNaN(REPLAY_SEED) && currentSeed !== REPLAY_SEED) continue;
    seedRandom(currentSeed);
    const map = new GameMap({
      mapSize: levelDef.mapSize,
      tileHeight: TILE_SIZE,
      mapType: 'dungeon',
      dungeon: dungeonOptionsForLevel(levelDef),
    });
    const layout = map.progressionLayout;
    if (layout === undefined) {
      check(false, 'the floor generated no progression layout to read rooms from');
      continue;
    }
    const model = buildFloorModel(map, layout.roomBounds);
    const signs = findSigns(map);

    const lists = claimLists(map);
    const stairwellTiles = new Set(
      map.stairwellTiles.flatMap(stairwellFootprint).map((tile) => tileCoordKey(tile.x, tile.y)),
    );
    const encounterRooms: ReadonlyArray<Rect> = [
      layout.startRoom,
      ...map.bossRooms.map((room) => room.bounds),
      ...map.questRooms.map((room) => room.bounds),
      ...(map.spiderLabRoom === null ? [] : [map.spiderLabRoom.bounds]),
    ];
    const reach = reachableFromStart(map);

    for (const sign of signs) {
      const { x, y } = sign.tile;
      const where = `sign at (${x},${y})`;

      check(sign.direction !== undefined, `${where} carries no direction`);
      const direction = sign.direction;
      if (direction === undefined) continue;
      check(AXIS_DIRECTIONS.includes(direction), `${where} points "${direction}", not an axis`);

      verifySignByKind(model, sign, direction, where, stats);
      checkBoardFootprint(map, sign.tile, where, stats);

      check(!stairwellTiles.has(tileCoordKey(x, y)), `${where} stands on a stairwell`);
      check(!map.isStairwellTile(x, y), `${where} stands on a stairwell block`);
      check(
        !encounterRooms.some((encounter) => rectContains(encounter, x, y)),
        `${where} stands in a start, boss, quest or lab room`,
      );
      check(
        !map.arenaExteriors.some(
          (arena) => Math.hypot(x - arena.centre.x, y - arena.centre.y) <= arena.radius,
        ),
        `${where} stands inside the arena`,
      );

      for (const list of lists) {
        const clash = list.points.find((point) => point.x === x && point.y === y);
        check(clash === undefined, `${where} sits on an entry of ${list.name}`);
      }

      const mobStanding =
        map.isWalkable(x, y) &&
        !map.isStairwellTile(x, y) &&
        map.structure[y][x].type !== CRAWLER_SIGN;
      check(!map.isWalkable(x, y), `${where} is walkable on the live map`);
      check(
        !map.isWalkableIgnoringPermanent(x, y),
        `${where} is walkable ignoring permanent blocks`,
      );
      check(!mobStanding, `${where} is standable by the mob movement predicate`);
      const pathOntoSign = map.findPath(map.startTile.x, map.startTile.y, x, y);
      check(pathOntoSign.length === 0, `${where} is a legal goal for mob pathfinding`);
    }

    verifyChains(model, signs, stats);
    verifyCoverage(model, signs, stats);
    verifyRoomCoverage(model, signs, stats);

    for (const stairwell of map.stairwellTiles) {
      const footprint = stairwellFootprint(stairwell);
      const touching = footprint.flatMap((tile) => [
        tile,
        ...FLOOD_STEPS.map((step) => ({ x: tile.x + step.x, y: tile.y + step.y })),
      ]);
      check(
        touching.some((tile) => reach.has(tileCoordKey(tile.x, tile.y))),
        `stairwell (${stairwell.x},${stairwell.y}) is unreachable from the start with the signs stamped`,
      );
    }

    const signKeys = new Set(signs.map((sign) => tileCoordKey(sign.tile.x, sign.tile.y)));
    const mobs = spawnForLevel(levelDef, map, SPAWN_PARTY_LEVEL, DIFFICULTY_PROFILES.normal);
    check(mobs.length > 0 || signs.length === 0, 'the spawner seated no mobs, proving nothing');
    for (const mob of mobs) {
      const tileX = Math.floor((mob.x + TILE_SIZE * TILE_CENTRE_FRACTION) / TILE_SIZE);
      const tileY = Math.floor((mob.y + TILE_SIZE * TILE_CENTRE_FRACTION) / TILE_SIZE);
      check(
        !signKeys.has(tileCoordKey(tileX, tileY)),
        `a ${mob.displayName} was seated on the sign at (${tileX},${tileY})`,
      );
    }

    verifyNoSafeRoomSigns(map, signs, stats);
  }

  const guards: ReadonlyArray<readonly [string, number]> = [
    ['hallway-junction signs', stats.hallwaySigns],
    ['non-cardinal arrow angles', stats.diagonalArrows],
    ['blocked-lane negative controls', stats.hallwayNegativeControls],
    ['overhanging-board negative controls', stats.overhangControls],
    ['trap junctions', stats.trapJunctions],
    ['leaf-only junctions', stats.leafJunctions],
    ['loop trap junctions', stats.loopJunctions],
    ['search-territory negative controls', stats.searchControls],
  ];
  chainedAcrossFloors += stats.chainedSigns;
  roomGateTotals.signs += stats.roomSigns;
  roomGateTotals.farEnd += stats.farEndControls;
  roomGateTotals.flipped += stats.negativeControls;
  roomGateTotals.junctionRule += stats.junctionControls;
  roomGateTotals.chain += stats.chainControls;
  roomGateTotals.roomCoverage += stats.roomControls;
  roomGateTotals.hallwayCoverage += stats.coverageControls;
  for (const [name, count] of guards) {
    check(
      count >= MIN_SIGNS_PER_FLOOR,
      `${levelDef.id} exercised ${count} ${name} over ${RUNS_PER_FLOOR} maps; that gate had nothing to check`,
    );
  }
  const signableRooms = stats.roomsRequired - stats.safeExcludedRooms;
  check(
    stats.roomsSigned >= signableRooms * MIN_ROOM_SIGNED_SHARE,
    `${levelDef.id} signed only ${stats.roomsSigned} of ${signableRooms} signable trap junction rooms`,
  );
  check(
    stats.roomsSigned === 0 || stats.roomSigns >= stats.roomsSigned,
    `${levelDef.id} reports ${stats.roomsSigned} signed rooms but only ${stats.roomSigns} room signs`,
  );
  check(
    stats.safeRoomControls > 0,
    `${levelDef.id} had no safe room to plant a control sign in; the safe-room gate had nothing to check`,
  );
  check(
    stats.roomsSigned === stats.roomControls,
    `${levelDef.id} ran ${stats.roomControls} sign-deletion controls for ${stats.roomsSigned} signed rooms`,
  );
  console.log(
    `  room coverage: ${stats.roomsSigned}/${stats.roomsRequired} trap junction rooms signed (${stats.roomsRequired - stats.safeExcludedRooms} signable), ${stats.roomControls} negative controls`,
  );
  console.log(
    `  trap junctions (rooms + hallways): ${stats.trapJunctions} (${stats.loopJunctions} with a loop, ${stats.deadEndJunctions} with a big dead end), ${stats.leafJunctions} leaf-only junctions left bare\n` +
      `  coverage: ${stats.junctionsSigned}/${stats.junctionsRequired} trap hallway junctions signed, ` +
      `${stats.junctionsOffPath} off-path junctions skipped by definition, ${stats.exemptions.length} exempt, ` +
      `${stats.tiedBranches} tied branches, ${stats.searchTilesChecked} signs checked against search territory`,
  );
  const exemptionsByReason = new Map<string, number>();
  for (const line of stats.exemptions) {
    const reason = line.slice(line.indexOf(': ') + ': '.length);
    exemptionsByReason.set(reason, (exemptionsByReason.get(reason) ?? 0) + 1);
  }
  for (const [reason, count] of exemptionsByReason) console.log(`    exempt x${count}: ${reason}`);
  console.log(
    `  ${stats.safeRoomControls} safe-room negative controls; ${stats.safeExcludedRooms} safe-room trap junctions left bare by rule`,
  );
  console.log(
    `  ${stats.roomSigns} room signs + ${stats.hallwaySigns} hallway-junction signs over ${RUNS_PER_FLOOR} maps; ` +
      `${stats.negativeControls} flipped-arrow, ${stats.hallwayNegativeControls} blocked-lane, ${stats.junctionControls} junction-rule, ` +
      `${stats.overhangControls} overhang and ${stats.chainControls} chain negative controls; ` +
      `${stats.chainedSigns} signs chained onward; ${stats.tiedDoorways} with tied doorways, ${stats.diagonalArrows} non-cardinal arrows`,
  );
}

console.log('\n── trap rule on hand-built levels ──');
const sceneControls = verifyTrapScenes();
console.log(`  ${sceneControls} scenes planned`);

for (const [index, floor] of [level1, level2].entries()) verifyFloor(floor, index + 1);

check(
  roomGateTotals.signs >= MIN_ROOM_SIGNS_ACROSS_FLOORS,
  `only ${roomGateTotals.signs} room signs over both floors; at least ${MIN_ROOM_SIGNS_ACROSS_FLOORS} are expected`,
);
for (const [name, count] of Object.entries(roomGateTotals)) {
  check(
    count >= MIN_SIGNS_PER_FLOOR,
    `room-sign gate "${name}" exercised ${count} times over both floors; it had nothing to check`,
  );
}
check(
  chainedAcrossFloors >= MIN_SIGNS_PER_FLOOR,
  `only ${chainedAcrossFloors} signs were met while following another sign's chain; the chain check had nothing to check`,
);
console.log(
  `\n  ${chainedAcrossFloors} signs met while following other signs onward, over both floors`,
);

console.log(
  `\n${failures === 0 ? 'PASS' : 'FAIL'} — ${checks - failures}/${checks} checks passed\n`,
);
process.exit(failures === 0 ? 0 : 1);
