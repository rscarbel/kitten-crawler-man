/**
 * Floor 2's stealth gate room, checked on whole generated floors.
 *
 * Two halves. The layout half runs `validateProgression`'s S7 on the
 * generator's own output: the gate room is the halfway chain room, every route
 * to the antechamber passes through it, and the nursery, the lanes, the spider
 * lab and the safe and treasure pockets all stay off it and away from it. The
 * live half builds a `GameMap` and walks it with the map's own walkability: shut
 * while the gate is locked without shutting the party out of the guard or the
 * prison door, open once unlocked, the open art written into the grid, a
 * checkpoint that keeps the state, the prison door on plain north wall face with
 * its building entry on the floor in front of it, the sign on the wall beside it
 * and off the approach, the waiting spots reachable, and nothing spawned on the
 * room's keep-clear tiles.
 *
 * Map generation takes no difficulty, so one floor stands for every difficulty.
 *
 *   npx tsx scripts/verify-stealth-gate.ts [--runs=40] [--fault=<name>]
 *
 * Every `--fault=` injects one regression the gate exists to catch and must
 * turn it red.
 */

import { TILE_SIZE } from '../src/core/constants.js';
import { GameMap } from '../src/map/GameMap.js';
import { generateDungeon, progressionExpectations } from '../src/map/DungeonGenerator.js';
import { validateProgression } from '../src/map/progressionValidation.js';
import { dungeonOptionsForLevel } from '../src/levels/dungeonOptions.js';
import { level2 } from '../src/levels/level2.js';
import type { LevelDef } from '../src/levels/types.js';
import { stealthGateChainIndex, type StealthGatePlanFault } from '../src/map/spineLayout.js';
import { pastSafeRoomTest } from '../src/map/pastSafeRoom.js';
import { ARENA_BOSS_TYPE } from '../src/map/progressionValidation.js';
import { roomDoorways } from '../src/map/roomDoorways.js';
import { tileIndex } from '../src/map/tileIndex.js';
import { STEALTH_GATE_CLOSED, STEALTH_GATE_OPEN } from '../src/map/tileTypes.js';
import {
  PRISON_DOOR_DOORWAY_CLEARANCE_TILES,
  PRISON_DOOR_SIDE_FACE_TILES,
  PRISON_DOOR_WIDTH_TILES,
  type StealthGateRoomData,
} from '../src/map/stealthGateLayout.js';

type Point = { x: number; y: number };
type Rect = { x: number; y: number; w: number; h: number };

/** Floors built per run: the planner faults only show on the layouts that tempt them. */
const DEFAULT_RUNS = 40;

/** Faults the planner itself is switched into, through `StealthGateRequest.faultForGate`. */
const PLAN_FAULTS = [
  'nursery-beside-gate',
  'lane-at-gate',
  'lab-on-gate',
  'pocket-on-gate',
  'gate-off-halfway',
] as const satisfies ReadonlyArray<StealthGatePlanFault>;

const LIVE_FAULTS = [
  /** The map starts with the gate already open, so nothing is ever shut. */
  'never-locked',
  /** Unlocking the gate does nothing. */
  'never-opens',
  /** Unlocking lifts the block but leaves the shut art in the grid. */
  'open-art-missing',
  /** A checkpoint restore forgets the gate and puts it back locked. */
  'checkpoint-drops-gate',
  /** The route-as-built question answers with the live gate, so rooms change sides when it opens. */
  'past-safe-room-sees-gate',
  /** The bypass check closes the wrong room. */
  'bypass-checks-wrong-room',
  /** The door is hung a column off the room's west wall, half over the corner. */
  'door-off-wall',
  /** The sign is set down on the door's approach. */
  'sign-on-approach',
  /** Deinonychus's waiting spot is inside a wall. */
  'waiting-in-wall',
  /** The prison door's building entry is never placed. */
  'entry-missing',
  /** A hallway spawn is set down on the gate. */
  'spawn-on-gate',
] as const;

const FAULTS = [...PLAN_FAULTS, ...LIVE_FAULTS] as const;
type Fault = (typeof FAULTS)[number];
type PlanFault = (typeof PLAN_FAULTS)[number];

function isFault(value: string): value is Fault {
  return FAULTS.some((fault) => fault === value);
}

function isPlanFault(value: Fault | null): value is PlanFault {
  return PLAN_FAULTS.some((fault) => fault === value);
}

function parseArgs(): { runs: number; fault: Fault | null } {
  let runs = DEFAULT_RUNS;
  let fault: Fault | null = null;
  for (const arg of process.argv.slice(2)) {
    const separator = arg.indexOf('=');
    const name = separator < 0 ? arg : arg.slice(0, separator);
    const value = separator < 0 ? '' : arg.slice(separator + 1);
    if (name === '--runs') runs = Number(value);
    else if (name === '--fault') {
      if (!isFault(value)) {
        console.error(`unknown fault "${value}"; known: ${FAULTS.join(', ')}`);
        process.exit(2);
      }
      fault = value;
    } else {
      console.error(`unknown argument ${arg}`);
      process.exit(2);
    }
  }
  return { runs, fault };
}

const { runs, fault } = parseArgs();

const STEPS: ReadonlyArray<Point> = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
];

let failures = 0;
let checks = 0;

function check(condition: boolean, message: string): void {
  checks++;
  if (condition) return;
  failures++;
  console.log(`  FAIL: ${message}`);
}

function rectContains(rect: Rect, point: Point): boolean {
  return (
    point.x >= rect.x && point.x < rect.x + rect.w && point.y >= rect.y && point.y < rect.y + rect.h
  );
}

function sameRect(a: Rect, b: Rect): boolean {
  return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
}

function chebyshev(a: Point, b: Point): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

/** Level 2, or for a planner fault the same floor with that rule switched off. */
function floorUnderTest(): LevelDef {
  const spine = level2.progression?.spine;
  if (!isPlanFault(fault) || level2.progression === undefined || spine?.stealthGate === undefined) {
    return level2;
  }
  return {
    ...level2,
    progression: {
      ...level2.progression,
      spine: { ...spine, stealthGate: { ...spine.stealthGate, faultForGate: fault } },
    },
  };
}

const levelDef = floorUnderTest();

/** Everything walkable from `start` with the map's own walkability, never entering a `closed` rect. */
function reachableTiles(
  gameMap: GameMap,
  start: Point,
  closed: ReadonlyArray<Rect> = [],
  solid: ReadonlyArray<Point> = [],
): Set<number> {
  const size = gameMap.gridSize;
  const key = (point: Point): number => tileIndex(point.x, point.y, size);
  const solidKeys = new Set(solid.map(key));
  const isOpen = (point: Point): boolean =>
    gameMap.isWalkable(point.x, point.y) &&
    !solidKeys.has(key(point)) &&
    !closed.some((rect) => rectContains(rect, point));
  const seen = new Set<number>();
  if (!isOpen(start)) return seen;
  seen.add(key(start));
  const queue: Point[] = [start];
  for (const tile of queue) {
    for (const step of STEPS) {
      const next = { x: tile.x + step.x, y: tile.y + step.y };
      if (seen.has(key(next)) || !isOpen(next)) continue;
      seen.add(key(next));
      queue.push(next);
    }
  }
  return seen;
}

function anyTileReachable(reached: ReadonlySet<number>, size: number, rect: Rect): boolean {
  for (let y = rect.y; y < rect.y + rect.h; y++) {
    for (let x = rect.x; x < rect.x + rect.w; x++) {
      if (reached.has(tileIndex(x, y, size))) return true;
    }
  }
  return false;
}

function setGate(gameMap: GameMap, state: 'locked' | 'open'): void {
  if (fault === 'never-opens' && state === 'open') return;
  if (fault === 'never-locked' && state === 'locked') return;
  gameMap.setStealthGate(state);
  if (fault === 'open-art-missing' && state === 'open' && gameMap.stealthGateRoom !== null) {
    for (const tile of gameMap.stealthGateRoom.gateTiles) {
      gameMap.structure[tile.y][tile.x].type = STEALTH_GATE_CLOSED;
    }
  }
}

/** The layout half: S7 and its exclusions, as `validateProgression` reports them. */
function verifyLayout(label: string): void {
  const options = { ...dungeonOptionsForLevel(levelDef), size: levelDef.mapSize };
  const data = generateDungeon(options);
  const expectations = { ...progressionExpectations(options), hasStealthGate: true };
  const s7 = validateProgression(data, expectations).filter((failure) => failure.id === 'S7');
  for (const failure of s7) check(false, `${label}: S7 ${failure.message}`);
}

/** The room itself: its doorways, its gate, its door, its sign, its waiting spots. */
function verifyRoomShape(gameMap: GameMap, room: StealthGateRoomData, label: string): void {
  const { bounds } = room;
  const spine = gameMap.progressionLayout?.spine ?? null;
  check(spine !== null, `${label}: the floor recorded no spine`);
  if (spine === null) return;
  const halfway = stealthGateChainIndex(spine.chain.length);
  const atHalfway = spine.chain[halfway];
  check(
    room.chainIndex === halfway && atHalfway !== undefined && sameRect(atHalfway, bounds),
    `${label}: the gate room is chain room ${room.chainIndex}, not the halfway room ${halfway}`,
  );

  const doorways = roomDoorways(gameMap.structure, bounds);
  check(doorways.length === 2, `${label}: the gate room has ${doorways.length} doorways, not 2`);
  check(
    room.gateTiles.length === room.onwardDoorway.tiles.length &&
      room.onwardDoorway.tiles.every((tile) =>
        room.gateTiles.some((gate) => gate.x === tile.x && gate.y === tile.y),
      ),
    `${label}: the gate does not span the onward doorway's full width`,
  );

  // The nursery: never on or beside the gate room.
  const nursery = gameMap.questRooms[0];
  if (nursery !== undefined) {
    const nurseryIndex = spine.chain.findIndex((rect) => sameRect(rect, nursery.bounds));
    check(
      nurseryIndex < 0 || Math.abs(nurseryIndex - room.chainIndex) > 1,
      `${label}: the nursery is chain room ${nurseryIndex}, on or beside the gate room`,
    );
  }
  // Lanes: none forks on a link touching the gate room.
  for (const lane of spine.lanes) {
    check(
      lane.forkIndex !== room.chainIndex && lane.forkIndex + 1 !== room.chainIndex,
      `${label}: a lane forks at chain room ${lane.forkIndex}, on a link touching the gate room`,
    );
  }
  // The lab, the lanes and the pockets: nothing opens off the gate room but its
  // two chain neighbours, read off the corridors as carved.
  const chainNeighbours = [spine.chain[room.chainIndex - 1], spine.chain[room.chainIndex + 1]];
  const lab = gameMap.spiderLabRoom;
  const laneRooms = spine.lanes.flatMap((lane) => lane.rooms);
  for (const neighbour of roomsJoinedTo(gameMap, bounds)) {
    if (chainNeighbours.some((rect) => rect !== undefined && sameRect(rect, neighbour))) continue;
    if (
      lab !== null &&
      (sameRect(lab.bounds, neighbour) || sameRect(lab.stationBounds, neighbour))
    ) {
      check(false, `${label}: the spider lab hangs off the gate room`);
    } else if (laneRooms.some((rect) => sameRect(rect, neighbour))) {
      check(false, `${label}: a lane room opens off the gate room`);
    } else {
      check(false, `${label}: the room at (${neighbour.x},${neighbour.y}) hangs off the gate room`);
    }
  }

  verifyDoorAndSign(gameMap, room, doorways, label);

  for (const [name, spot] of Object.entries(room.waitingTiles)) {
    const tile =
      fault === 'waiting-in-wall' && name === 'deinonychus'
        ? { x: bounds.x - 1, y: bounds.y }
        : spot;
    check(
      rectContains(bounds, tile) && gameMap.isWalkable(tile.x, tile.y),
      `${label}: ${name}'s waiting spot (${tile.x},${tile.y}) is not open floor in the room`,
    );
  }
}

/**
 * Every room the corridors leaving `bounds` lead to: a flood out of each of its
 * doorways through open floor that lies in no room, stopping at the first room
 * it meets.
 */
function roomsJoinedTo(gameMap: GameMap, bounds: Rect): Rect[] {
  const rooms = gameMap.progressionLayout?.roomBounds ?? [];
  const roomAt = (point: Point): Rect | undefined =>
    rooms.find((rect) => rectContains(rect, point));
  const size = gameMap.gridSize;
  const seen = new Set<number>();
  const joined: Rect[] = [];
  const queue: Point[] = [];
  for (const doorway of roomDoorways(gameMap.structure, bounds)) {
    for (const tile of doorway.tiles) {
      for (const step of STEPS) {
        const next = { x: tile.x + step.x, y: tile.y + step.y };
        if (rectContains(bounds, next) || !gameMap.isWalkableIgnoringPuzzleChokes(next.x, next.y))
          continue;
        queue.push(next);
      }
    }
  }
  for (const tile of queue) {
    const key = tileIndex(tile.x, tile.y, size);
    if (seen.has(key)) continue;
    seen.add(key);
    const owner = roomAt(tile);
    if (owner !== undefined) {
      if (!sameRect(owner, bounds) && !joined.some((rect) => sameRect(rect, owner))) {
        joined.push(owner);
      }
      continue;
    }
    for (const step of STEPS) {
      const next = { x: tile.x + step.x, y: tile.y + step.y };
      if (rectContains(bounds, next) || !gameMap.isWalkableIgnoringPuzzleChokes(next.x, next.y))
        continue;
      queue.push(next);
    }
  }
  return joined;
}

function verifyDoorAndSign(
  gameMap: GameMap,
  room: StealthGateRoomData,
  doorways: ReturnType<typeof roomDoorways>,
  label: string,
): void {
  const { bounds } = room;
  const door =
    fault === 'door-off-wall'
      ? {
          ...room.prisonDoor,
          x0: bounds.x - 1,
          faceTiles: room.prisonDoor.faceTiles.map((_, i) => ({
            x: bounds.x - 1 + i,
            y: bounds.y - 1,
          })),
          approachTiles: room.prisonDoor.approachTiles.map((_, i) => ({
            x: bounds.x - 1 + i,
            y: bounds.y,
          })),
        }
      : room.prisonDoor;
  check(
    door.faceTiles.length === PRISON_DOOR_WIDTH_TILES,
    `${label}: the door is not a double door`,
  );
  const doorwayTiles = doorways.flatMap((doorway) => doorway.tiles);
  const columnsFrom = door.x0 - PRISON_DOOR_SIDE_FACE_TILES;
  const columnsTo = door.x0 + PRISON_DOOR_WIDTH_TILES - 1 + PRISON_DOOR_SIDE_FACE_TILES;
  for (let x = columnsFrom; x <= columnsTo; x++) {
    check(
      !gameMap.isWalkable(x, bounds.y - 1) &&
        !gameMap.isWalkable(x, bounds.y - 2) &&
        x >= bounds.x &&
        x < bounds.x + bounds.w,
      `${label}: column ${x} of the door's wall is not plain north wall face`,
    );
  }
  for (const tile of door.approachTiles) {
    check(
      tile.y === bounds.y && rectContains(bounds, tile) && gameMap.isWalkable(tile.x, tile.y),
      `${label}: the door approach (${tile.x},${tile.y}) is not open floor on the room's top row`,
    );
    const clearance = Math.min(...doorwayTiles.map((other) => chebyshev(tile, other)));
    check(
      clearance >= PRISON_DOOR_DOORWAY_CLEARANCE_TILES,
      `${label}: the door approach (${tile.x},${tile.y}) is ${clearance} tiles from a doorway`,
    );
  }

  const entries = fault === 'entry-missing' ? [] : gameMap.buildingEntries;
  const entry = entries.find((candidate) => candidate.type === 'prison');
  check(
    entry !== undefined &&
      entry.id === 'level2_goblin_prison' &&
      entry.doorway.width === PRISON_DOOR_WIDTH_TILES &&
      entry.doorway.x0 === room.prisonDoor.x0 &&
      entry.doorTile.y === room.prisonDoor.approachRow,
    `${label}: the prison door has no building entry on the floor in front of it`,
  );

  const sign = fault === 'sign-on-approach' ? door.approachTiles[0] : room.signTile;
  const besideDoor =
    sign !== undefined &&
    sign.y === bounds.y - 1 &&
    (sign.x === door.x0 - 1 || sign.x === door.x0 + PRISON_DOOR_WIDTH_TILES);
  check(
    sign !== undefined && besideDoor && !gameMap.isWalkable(sign.x, sign.y),
    `${label}: the sign is not on the wall face beside the door`,
  );
  check(
    sign !== undefined &&
      !door.approachTiles.some((tile) => tile.x === sign.x && tile.y === sign.y),
    `${label}: the sign stands on the door's approach`,
  );
  const pointsAtDoor =
    (room.signArrow === 'east' && room.signTile.x < door.x0) ||
    (room.signArrow === 'west' && room.signTile.x >= door.x0 + PRISON_DOOR_WIDTH_TILES);
  check(pointsAtDoor, `${label}: the sign's arrow points away from the door`);
}

function verifySpawnsClear(gameMap: GameMap, room: StealthGateRoomData, label: string): void {
  const keep = new Set(
    room.keepClearTiles.map((tile) => tileIndex(tile.x, tile.y, gameMap.gridSize)),
  );
  const spawns: Point[] = [...gameMap.hallwaySpawnPoints];
  if (fault === 'spawn-on-gate' && room.gateTiles[0] !== undefined) spawns.push(room.gateTiles[0]);
  for (const spawn of spawns) {
    check(
      !keep.has(tileIndex(spawn.x, spawn.y, gameMap.gridSize)),
      `${label}: a hallway spawn at (${spawn.x},${spawn.y}) stands on the gate room's keep-clear tiles`,
    );
  }
  for (const spawn of gameMap.mobSpawnPoints) {
    check(
      !rectContains(room.bounds, spawn),
      `${label}: a room spawn at (${spawn.x},${spawn.y}) is inside the gate room`,
    );
  }
}

/**
 * Which rooms lie past the arena's safe room is a question about the route as
 * built, asked at floor load while the gate is shut. Unlocking it must not move
 * any room to the other side.
 */
function verifyPastSafeRoomIgnoresGate(gameMap: GameMap, label: string): void {
  const roomBounds = gameMap.progressionLayout?.roomBounds ?? [];
  // The fault hands the test a map whose route-as-built walkability is the live
  // one, gate and all.
  const asked =
    fault === 'past-safe-room-sees-gate'
      ? new Proxy(gameMap, {
          get(target, property) {
            if (property === 'isWalkableIgnoringPuzzleChokes') {
              return (x: number, y: number): boolean => target.isWalkable(x, y);
            }
            return Reflect.get(target, property, target);
          },
        })
      : gameMap;
  gameMap.setStealthGate('locked');
  const whileLocked = pastSafeRoomTest(asked, ARENA_BOSS_TYPE);
  const lockedAnswers = roomBounds.map((room) => whileLocked?.(room) ?? null);
  gameMap.setStealthGate('open');
  const whileOpen = pastSafeRoomTest(asked, ARENA_BOSS_TYPE);
  const changed = roomBounds.filter(
    (room, index) => (whileOpen?.(room) ?? null) !== lockedAnswers[index],
  ).length;
  check(
    changed === 0,
    `${label}: ${changed} rooms change sides of the arena's safe room when the gate opens`,
  );
  gameMap.setStealthGate('locked');
}

function verifyFloor(run: number): void {
  const label = `run ${run}`;
  verifyLayout(label);

  const gameMap = new GameMap({
    mapSize: levelDef.mapSize,
    tileHeight: TILE_SIZE,
    mapType: 'dungeon',
    dungeon: dungeonOptionsForLevel(levelDef),
  });
  if (fault === 'never-locked') gameMap.setStealthGate('open');
  // The bathrooms stand on an earlier stretch of the route; that gate is
  // `verify:clogged-bathroom`'s, and this one asks about the stealth gate alone.
  gameMap.setBathroomPlumbing('fixed');
  const size = gameMap.gridSize;
  const room = gameMap.stealthGateRoom;
  const antechamber = gameMap.safeRooms.find((safe) => safe.guardsBossType === ARENA_BOSS_TYPE);
  if (room === null || antechamber === undefined) {
    check(false, `${label}: the floor has no stealth gate room or no antechamber`);
    return;
  }
  check(
    gameMap.stealthGateState() === 'locked' || fault === 'never-locked',
    `${label}: the gate does not start locked`,
  );

  verifyRoomShape(gameMap, room, label);
  verifySpawnsClear(gameMap, room, label);
  verifyPastSafeRoomIgnoresGate(gameMap, label);

  // Every route passes through the gate room.
  setGate(gameMap, 'open');
  const closedRoom =
    fault === 'bypass-checks-wrong-room'
      ? (gameMap.safeRooms.find((safe) => safe.isSafeAccessPocket === true)?.bounds ?? room.bounds)
      : room.bounds;
  check(
    !anyTileReachable(
      reachableTiles(gameMap, gameMap.startTile, [closedRoom]),
      size,
      antechamber.bounds,
    ),
    `${label}: the antechamber is reachable without walking through the gate room`,
  );

  // Locked: shut, without shutting the party out of the guard or the door.
  setGate(gameMap, 'locked');
  const lockedReach = reachableTiles(gameMap, gameMap.startTile, [], [room.guardTile]);
  const reaches = (tile: Point): boolean => lockedReach.has(tileIndex(tile.x, tile.y, size));
  check(
    !anyTileReachable(lockedReach, size, antechamber.bounds),
    `${label}: the antechamber is reachable while the gate is locked`,
  );
  for (const tile of room.gateTiles) {
    check(
      !gameMap.isWalkable(tile.x, tile.y),
      `${label}: gate tile (${tile.x},${tile.y}) is walkable while locked`,
    );
    check(
      gameMap.structure[tile.y][tile.x].type === STEALTH_GATE_CLOSED,
      `${label}: gate tile (${tile.x},${tile.y}) does not wear the shut art while locked`,
    );
  }
  check(room.guardTalkTiles.some(reaches), `${label}: the guard cannot be talked to while locked`);
  check(
    room.prisonDoor.approachTiles.every(reaches),
    `${label}: the prison door cannot be reached`,
  );
  check(
    reaches(room.waitingTiles.deinonychus) && reaches(room.waitingTiles.hireling),
    `${label}: a waiting spot cannot be reached while locked`,
  );
  const lockedSnapshot = gameMap.captureCheckpoint();

  // Open: the way on is clear and the grid wears the open art.
  setGate(gameMap, 'open');
  for (const tile of room.gateTiles) {
    check(
      gameMap.isWalkable(tile.x, tile.y),
      `${label}: gate tile (${tile.x},${tile.y}) stayed shut once open`,
    );
    check(
      gameMap.structure[tile.y][tile.x].type === STEALTH_GATE_OPEN,
      `${label}: gate tile (${tile.x},${tile.y}) does not wear the open art once open`,
    );
  }
  check(
    anyTileReachable(reachableTiles(gameMap, gameMap.startTile), size, antechamber.bounds),
    `${label}: the antechamber is still unreachable once the gate is open`,
  );

  // An opening is banked by a checkpoint taken after it, and undone by one taken before.
  const openSnapshot =
    fault === 'checkpoint-drops-gate'
      ? { ...gameMap.captureCheckpoint(), stealthGate: 'locked' as const }
      : gameMap.captureCheckpoint();
  gameMap.setStealthGate('locked');
  gameMap.restoreCheckpoint(openSnapshot);
  check(
    gameMap.stealthGateState() === 'open' &&
      room.gateTiles.every((tile) => gameMap.isWalkable(tile.x, tile.y)),
    `${label}: restoring a checkpoint taken after the gate opened shut it again`,
  );
  gameMap.restoreCheckpoint(lockedSnapshot);
  check(
    gameMap.stealthGateState() === 'locked',
    `${label}: restoring a checkpoint taken before the gate opened left it open`,
  );
}

console.log(`── ${level2.id}: ${runs} floors${fault === null ? '' : `, fault ${fault}`} ──`);
for (let run = 0; run < runs; run++) verifyFloor(run);

console.log(
  `\n${failures === 0 ? 'PASS' : 'FAIL'} — ${checks - failures}/${checks} checks passed\n`,
);
process.exit(failures === 0 ? 0 : 1);
