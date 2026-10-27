import type { BuildingEntry } from './buildingEntry';
import { ROOM_WALL_OUTWARD, type Point, type Rect, type RoomDoorway } from './roomDoorways';

/** Whether the stealth gate still shuts the gate room's onward doorway. One value per floor. */
export type StealthGateState = 'locked' | 'open';

/** The building the prison door opens into, as `BuildingSystem` names it. */
export const PRISON_BUILDING_NAME = 'Goblin High Security Prison';
/** The prison door is a double door: two tiles of north wall face. */
export const PRISON_DOOR_WIDTH_TILES = 2;
/**
 * Columns of plain wall face either side of the door, so its frame never meets
 * a jamb or a corner and the sign has a face of its own to hang on.
 */
export const PRISON_DOOR_SIDE_FACE_TILES = 1;
/**
 * Chebyshev distance every tile in front of the door keeps from every doorway
 * tile, so the door's approach is never also somebody's way through.
 */
export const PRISON_DOOR_DOORWAY_CLEARANCE_TILES = 3;

/**
 * The prison door's place on the gate room's north wall.
 *
 * The door is wall-face art over a solid wall, so the floor grid gains no
 * opening; it is entered by stepping onto {@link approachTiles}, which carry a
 * hand-made `BuildingEntry`. It hangs on the north face because that is the
 * only face the dungeon draws straight on, and because a building entry's
 * doorway is a run of tiles along one row.
 */
export interface PrisonDoorSpan {
  /** Westmost column of the door. */
  x0: number;
  /** The row of floor in front of the door: the room's top row. */
  approachRow: number;
  /** The lower face tiles the door is painted on, west to east (the row above the room). */
  faceTiles: Point[];
  /** The upper face tiles above them, which carry the door's head and lintel. */
  upperFaceTiles: Point[];
  /** The floor tiles directly in front of the door, west to east: the room's top row. */
  approachTiles: Point[];
}

/**
 * The stealth gate room seated halfway along the spine, and where everything in
 * it stands. Every tile is in map tile coordinates.
 */
export interface StealthGateRoomData {
  bounds: Rect;
  centre: Point;
  /** Position of the room in the spine's chain, walking order. */
  chainIndex: number;
  /** Middle perimeter tile of the doorway the party arrives through. */
  entranceTile: Point;
  entranceDoorway: RoomDoorway;
  /** The doorway the gate shuts, toward the arena antechamber. */
  onwardDoorway: RoomDoorway;
  /** Every tile the gate spans: the onward doorway's full width. */
  gateTiles: Point[];
  /** Where the gate guard stands: inside the room, beside the gate. */
  guardTile: Point;
  /** Open floor beside the guard that a crawler talks to him from. */
  guardTalkTiles: Point[];
  prisonDoor: PrisonDoorSpan;
  /** The lower face tile beside the door that the PRISON sign hangs on. */
  signTile: Point;
  /** Which way the sign's arrow points, toward the door. */
  signArrow: 'west' | 'east';
  /** Where Mongo and the hireling wait while the crawlers are inside the prison. */
  waitingTiles: { mongo: Point; hireling: Point };
  /**
   * Tiles nothing generated may stand on: the gate and the floor inside it, the
   * guard and his talk tiles, the door approach, the waiting spots and a ring
   * round each doorway. No hallway spawn, sign or dressing goes on any of them.
   */
  keepClearTiles: Point[];
}

export interface StealthGateLayoutInput {
  bounds: Rect;
  entrance: RoomDoorway;
  onward: RoomDoorway;
  /** Walkable floor anywhere on the map. */
  isOpen: (x: number, y: number) => boolean;
  /** A dungeon wall tile, drawn as wall. */
  isWall: (x: number, y: number) => boolean;
}

export type StealthGateLayout = Pick<
  StealthGateRoomData,
  | 'gateTiles'
  | 'guardTile'
  | 'guardTalkTiles'
  | 'prisonDoor'
  | 'signTile'
  | 'signArrow'
  | 'waitingTiles'
  | 'keepClearTiles'
>;

/** Farthest a guard may stand from the gate, Chebyshev, and still be beside it. */
const GUARD_REACH_TILES = 2;
/** Ranking weight of a step away from the gate, against standing off the wall line. */
const GUARD_DISTANCE_WEIGHT = 10;
const GUARD_OFF_WALL_PENALTY = 3;
/** Chebyshev distance waiting spots keep from every doorway tile. */
const WAITING_DOORWAY_CLEARANCE_TILES = 2;
/** Ranking weight of distance from the entrance, against standing off a wall. */
const WAITING_DISTANCE_WEIGHT = 2;
const WAITING_OFF_WALL_PENALTY = 6;
/** Rows of floor kept clear in front of the door, the approach row included. */
const DOOR_APPROACH_ROWS = 2;
/** Rows of floor inside the gate kept clear, so the way through is never furnished shut. */
const GATE_FRONT_ROWS = 2;

const CARDINAL: ReadonlyArray<Point> = ROOM_WALL_OUTWARD.map((side) => ({
  x: side.dx,
  y: side.dy,
}));

const EIGHT_NEIGHBOURS: ReadonlyArray<Point> = [
  { x: -1, y: -1 },
  { x: 0, y: -1 },
  { x: 1, y: -1 },
  { x: -1, y: 0 },
  { x: 1, y: 0 },
  { x: -1, y: 1 },
  { x: 0, y: 1 },
  { x: 1, y: 1 },
];

function keyOf(point: Point): string {
  return `${point.x},${point.y}`;
}

function chebyshev(a: Point, b: Point): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

function nearest(point: Point, others: ReadonlyArray<Point>): number {
  let best = Infinity;
  for (const other of others) best = Math.min(best, chebyshev(point, other));
  return best;
}

function rectContains(rect: Rect, point: Point): boolean {
  return (
    point.x >= rect.x && point.x < rect.x + rect.w && point.y >= rect.y && point.y < rect.y + rect.h
  );
}

function onPerimeter(rect: Rect, point: Point): boolean {
  return (
    point.x === rect.x ||
    point.y === rect.y ||
    point.x === rect.x + rect.w - 1 ||
    point.y === rect.y + rect.h - 1
  );
}

/** Every tile of the room reachable from `from` without stepping on `solid`. */
function reachableInRoom(
  bounds: Rect,
  from: ReadonlyArray<Point>,
  solid: ReadonlySet<string>,
  isOpen: (x: number, y: number) => boolean,
): Set<string> {
  const reached = new Set<string>();
  const queue = from.filter((tile) => !solid.has(keyOf(tile)) && isOpen(tile.x, tile.y));
  for (const tile of queue) reached.add(keyOf(tile));
  for (const tile of queue) {
    for (const step of CARDINAL) {
      const next = { x: tile.x + step.x, y: tile.y + step.y };
      const key = keyOf(next);
      if (reached.has(key) || solid.has(key) || !rectContains(bounds, next)) continue;
      if (!isOpen(next.x, next.y)) continue;
      reached.add(key);
      queue.push(next);
    }
  }
  return reached;
}

/**
 * Door spans along the north wall, best first: as far from every doorway as
 * the wall allows, then nearest the middle of the wall.
 */
function doorCandidates(
  input: StealthGateLayoutInput,
  doorwayTiles: ReadonlyArray<Point>,
): number[] {
  const { bounds, isOpen, isWall } = input;
  const top = bounds.y;
  const centreX = bounds.x + (bounds.w - PRISON_DOOR_WIDTH_TILES) / 2;
  const isDoorwayTile = (point: Point): boolean =>
    doorwayTiles.some((tile) => tile.x === point.x && tile.y === point.y);
  const candidates: Array<{ x0: number; clearance: number; offCentre: number }> = [];
  const firstColumn = bounds.x + PRISON_DOOR_SIDE_FACE_TILES;
  const lastColumn = bounds.x + bounds.w - PRISON_DOOR_WIDTH_TILES - PRISON_DOOR_SIDE_FACE_TILES;
  for (let x0 = firstColumn; x0 <= lastColumn; x0++) {
    let fits = true;
    const columnsFrom = x0 - PRISON_DOOR_SIDE_FACE_TILES;
    const columnsTo = x0 + PRISON_DOOR_WIDTH_TILES - 1 + PRISON_DOOR_SIDE_FACE_TILES;
    for (let x = columnsFrom; x <= columnsTo && fits; x++) {
      const floor = { x, y: top };
      fits = isWall(x, top - 1) && isWall(x, top - 2) && isOpen(x, top) && !isDoorwayTile(floor);
    }
    if (!fits) continue;
    const approach = [
      { x: x0, y: top },
      { x: x0 + 1, y: top },
    ];
    const clearance = Math.min(...approach.map((tile) => nearest(tile, doorwayTiles)));
    if (clearance < PRISON_DOOR_DOORWAY_CLEARANCE_TILES) continue;
    candidates.push({ x0, clearance, offCentre: Math.abs(x0 - centreX) });
  }
  candidates.sort((a, b) => b.clearance - a.clearance || a.offCentre - b.offCentre);
  return candidates.map((candidate) => candidate.x0);
}

function doorSpanAt(x0: number, top: number): PrisonDoorSpan {
  const columns = Array.from({ length: PRISON_DOOR_WIDTH_TILES }, (_, index) => x0 + index);
  return {
    x0,
    approachRow: top,
    faceTiles: columns.map((x) => ({ x, y: top - 1 })),
    upperFaceTiles: columns.map((x) => ({ x, y: top - 2 })),
    approachTiles: columns.map((x) => ({ x, y: top })),
  };
}

/** The floor rows just inside the gate, which the way through crosses. */
function gateFrontTiles(bounds: Rect, onward: RoomDoorway): Point[] {
  const outward = ROOM_WALL_OUTWARD.find((side) => side.wall === onward.wall);
  if (outward === undefined) return [];
  const tiles: Point[] = [];
  for (const gate of onward.tiles) {
    for (let row = 1; row <= GATE_FRONT_ROWS; row++) {
      const tile = { x: gate.x - outward.dx * row, y: gate.y - outward.dy * row };
      if (rectContains(bounds, tile)) tiles.push(tile);
    }
  }
  return tiles;
}

/** Floor tiles beside the gate a guard may stand on, best first. */
function guardCandidates(input: StealthGateLayoutInput, forbidden: ReadonlySet<string>): Point[] {
  const { bounds, onward, isOpen } = input;
  const scored: Array<{ tile: Point; score: number }> = [];
  for (let y = bounds.y; y < bounds.y + bounds.h; y++) {
    for (let x = bounds.x; x < bounds.x + bounds.w; x++) {
      const tile = { x, y };
      if (!isOpen(x, y) || forbidden.has(keyOf(tile))) continue;
      const distance = nearest(tile, onward.tiles);
      if (distance < 1 || distance > GUARD_REACH_TILES) continue;
      const alongWall = onPerimeter(bounds, tile);
      scored.push({
        tile,
        score: distance * GUARD_DISTANCE_WEIGHT + (alongWall ? 0 : GUARD_OFF_WALL_PENALTY),
      });
    }
  }
  scored.sort((a, b) => a.score - b.score);
  return scored.map((entry) => entry.tile);
}

function talkTilesFor(
  guard: Point,
  bounds: Rect,
  gateKeys: ReadonlySet<string>,
  isOpen: (x: number, y: number) => boolean,
): Point[] {
  return EIGHT_NEIGHBOURS.map((step) => ({ x: guard.x + step.x, y: guard.y + step.y })).filter(
    (tile) => rectContains(bounds, tile) && isOpen(tile.x, tile.y) && !gateKeys.has(keyOf(tile)),
  );
}

/** Two neighbouring floor tiles near the entrance, against a wall, off every path. */
function waitingSpots(
  input: StealthGateLayoutInput,
  doorwayTiles: ReadonlyArray<Point>,
  forbidden: ReadonlySet<string>,
): { mongo: Point; hireling: Point } | null {
  const { bounds, entrance, isOpen } = input;
  const scored: Array<{ tile: Point; score: number }> = [];
  for (let y = bounds.y; y < bounds.y + bounds.h; y++) {
    for (let x = bounds.x; x < bounds.x + bounds.w; x++) {
      const tile = { x, y };
      if (!isOpen(x, y) || forbidden.has(keyOf(tile))) continue;
      if (nearest(tile, doorwayTiles) < WAITING_DOORWAY_CLEARANCE_TILES) continue;
      scored.push({
        tile,
        score:
          nearest(tile, entrance.tiles) * WAITING_DISTANCE_WEIGHT +
          (onPerimeter(bounds, tile) ? 0 : WAITING_OFF_WALL_PENALTY),
      });
    }
  }
  scored.sort((a, b) => a.score - b.score);
  for (const first of scored) {
    const partner = scored.find(
      (other) => other !== first && chebyshev(other.tile, first.tile) === 1,
    );
    if (partner !== undefined) return { mongo: first.tile, hireling: partner.tile };
  }
  return null;
}

function ringAround(tiles: ReadonlyArray<Point>): Point[] {
  const ring: Point[] = [];
  for (const tile of tiles) {
    ring.push(tile);
    for (const step of EIGHT_NEIGHBOURS) ring.push({ x: tile.x + step.x, y: tile.y + step.y });
  }
  return ring;
}

/**
 * Lays out the stealth gate room: the gate across the onward doorway, the guard
 * beside it, the prison door and its sign on the north wall, and the spots
 * Mongo and the hireling wait on. Null when the room's walls leave no place for
 * the door or the guard would close something off; the generator then rejects
 * the map.
 *
 * Pure: everything about the grid comes in through `isOpen` and `isWall`.
 */
export function layOutStealthGateRoom(input: StealthGateLayoutInput): StealthGateLayout | null {
  const { bounds, entrance, onward, isOpen } = input;
  const top = bounds.y;
  const doorwayTiles = [...entrance.tiles, ...onward.tiles];
  const gateTiles = onward.tiles.map((tile) => ({ x: tile.x, y: tile.y }));
  const gateKeys = new Set(gateTiles.map(keyOf));
  const frontTiles = gateFrontTiles(bounds, onward);

  for (const x0 of doorCandidates(input, doorwayTiles)) {
    const prisonDoor = doorSpanAt(x0, top);
    const approachArea: Point[] = [];
    for (let row = 0; row < DOOR_APPROACH_ROWS; row++) {
      for (const tile of prisonDoor.approachTiles)
        approachArea.push({ x: tile.x, y: tile.y + row });
    }
    const signWest = { x: x0 - PRISON_DOOR_SIDE_FACE_TILES, y: top - 1 };
    const signEast = { x: x0 + PRISON_DOOR_WIDTH_TILES, y: top - 1 };
    const entranceIsWest = entrance.tile.x < x0;
    const signTile = entranceIsWest ? signWest : signEast;
    const signArrow = entranceIsWest ? 'east' : 'west';

    const guardForbiddenTiles = [
      ...gateTiles,
      ...frontTiles,
      ...approachArea,
      ...ringAround(entrance.tiles),
    ];
    const guardForbidden = new Set(guardForbiddenTiles.map(keyOf));
    for (const guardTile of guardCandidates(input, guardForbidden)) {
      const guardTalkTiles = talkTilesFor(guardTile, bounds, gateKeys, isOpen);
      if (guardTalkTiles.length === 0) continue;
      const waitingForbidden = new Set(
        [
          ...guardForbiddenTiles,
          guardTile,
          ...guardTalkTiles,
          ...ringAround(prisonDoor.approachTiles),
        ].map(keyOf),
      );
      const waitingTiles = waitingSpots(input, doorwayTiles, waitingForbidden);
      if (waitingTiles === null) continue;

      const solid = new Set([guardTile, waitingTiles.mongo, waitingTiles.hireling].map(keyOf));
      const reached = reachableInRoom(bounds, entrance.tiles, solid, isOpen);
      const reaches = (tile: Point): boolean => reached.has(keyOf(tile));
      const reachesEverything =
        prisonDoor.approachTiles.every(reaches) &&
        guardTalkTiles.some(reaches) &&
        gateTiles.every(reaches) &&
        frontTiles.every(reaches);
      if (!reachesEverything) continue;

      const keepClearTiles = [
        ...gateTiles,
        ...frontTiles,
        guardTile,
        ...guardTalkTiles,
        ...ringAround(prisonDoor.approachTiles),
        ...approachArea,
        waitingTiles.mongo,
        waitingTiles.hireling,
        ...ringAround(entrance.tiles),
        ...ringAround(onward.tiles),
      ];
      return {
        gateTiles,
        guardTile,
        guardTalkTiles,
        prisonDoor,
        signTile,
        signArrow,
        waitingTiles,
        keepClearTiles: dedupe(keepClearTiles),
      };
    }
  }
  return null;
}

function dedupe(tiles: ReadonlyArray<Point>): Point[] {
  const seen = new Set<string>();
  const unique: Point[] = [];
  for (const tile of tiles) {
    const key = keyOf(tile);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(tile);
  }
  return unique;
}

/** Every tile the stealth gate block flag covers while the gate is locked. */
export function stealthGateBlockedTiles(room: Pick<StealthGateRoomData, 'gateTiles'>): Point[] {
  return room.gateTiles;
}

/**
 * The hand-made building entry on the floor in front of the prison door, so
 * `BuildingSystem`'s prompt and door hints treat it like any other doorway.
 */
export function prisonBuildingEntry(room: Pick<StealthGateRoomData, 'prisonDoor'>): BuildingEntry {
  const { prisonDoor } = room;
  return {
    doorTile: { x: prisonDoor.x0, y: prisonDoor.approachRow },
    name: PRISON_BUILDING_NAME,
    type: 'prison',
    doorway: { x0: prisonDoor.x0, width: PRISON_DOOR_WIDTH_TILES },
  };
}
