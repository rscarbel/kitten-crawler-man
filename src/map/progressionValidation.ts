import type { TileContent } from './tileTypes';
import { isWalkableTileType } from './walkability';
import type { DungeonData } from './DungeonGenerator';
import { arenaReserveRect } from './arenaGeometry';

type Point = { x: number; y: number };
type Rect = { x: number; y: number; w: number; h: number };

export interface InvariantFailure {
  id: string;
  message: string;
}

export interface ProgressionExpectations {
  mapSize: number;
  gauntletCount: number;
  hasArena: boolean;
}

/** How far `startTile` may sit from the exact map centre (I1). */
const CENTER_SPAWN_TOLERANCE_TILES = 3;
/** Doorways the start room must have so the player can leave in several directions (I2). */
const MIN_START_ROOM_DOORWAYS = 2;
/** Pairwise stairwell distance in the free region (I4). */
export const STAIRWELL_MIN_SEPARATION = 45;
/** Stairwell distance from the last gateway boss room's bounds (I4). */
export const STAIRWELL_MIN_DIST_FROM_GAUNTLET_EXIT = 35;
/** Pairwise scatter-safe-room distance, and their distance from gateway safe rooms (I5). */
export const SCATTER_SAFE_ROOM_SEPARATION = 30;

// ── Geometry helpers ──────────────────────────────────────────────────────────

function pointDistance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Distance from a point to the nearest point of a rectangle (0 when inside). */
export function distanceToRect(point: Point, rect: Rect): number {
  const nearestX = Math.min(Math.max(point.x, rect.x), rect.x + rect.w - 1);
  const nearestY = Math.min(Math.max(point.y, rect.y), rect.y + rect.h - 1);
  return Math.hypot(point.x - nearestX, point.y - nearestY);
}

function rectContains(rect: Rect, point: Point): boolean {
  return (
    point.x >= rect.x && point.x < rect.x + rect.w && point.y >= rect.y && point.y < rect.y + rect.h
  );
}

// ── Flood fill ────────────────────────────────────────────────────────────────

const FLOOD_STEPS: ReadonlyArray<{ dx: number; dy: number }> = [
  { dx: 1, dy: 0 },
  { dx: -1, dy: 0 },
  { dx: 0, dy: 1 },
  { dx: 0, dy: -1 },
];

type FloodField = ReadonlyArray<ReadonlyArray<boolean>>;

/**
 * Reachability from `start` over walkable tiles, treating every tile inside a
 * `blockedRects` rectangle as solid.
 *
 * Every cut-vertex invariant is phrased as "block this room, then check what
 * became unreachable", so blocking is expressed as rectangles rather than by
 * mutating a copy of the grid.
 */
function floodFill(
  grid: TileContent[][],
  start: Point,
  blockedRects: ReadonlyArray<Rect>,
): FloodField {
  const height = grid.length;
  const width = grid[0]?.length ?? 0;
  const visited = Array.from({ length: height }, () => new Array<boolean>(width).fill(false));

  const isBlocked = (x: number, y: number): boolean =>
    blockedRects.some((rect) => rectContains(rect, { x, y }));

  const open = (x: number, y: number): boolean => {
    if (y < 0 || y >= height || x < 0 || x >= width) return false;
    if (visited[y][x]) return false;
    if (isBlocked(x, y)) return false;
    return isWalkableTileType(grid[y][x]);
  };

  if (!open(start.x, start.y)) return visited;

  const queue: Point[] = [{ x: start.x, y: start.y }];
  visited[start.y][start.x] = true;
  let head = 0;
  while (head < queue.length) {
    const { x, y } = queue[head];
    head++;
    for (const step of FLOOD_STEPS) {
      const nx = x + step.dx;
      const ny = y + step.dy;
      if (!open(nx, ny)) continue;
      visited[ny][nx] = true;
      queue.push({ x: nx, y: ny });
    }
  }
  return visited;
}

function isReachable(flood: FloodField, point: Point): boolean {
  if (point.y < 0 || point.y >= flood.length) return false;
  const row = flood[point.y];
  if (point.x < 0 || point.x >= row.length) return false;
  return row[point.x];
}

/**
 * Whether any tile of a rectangle was reached. Landmarks are tested by area
 * rather than by their centre tile, because a centre can be occupied by
 * furniture (a boss room's brazier, a stairwell's own footprint) while the room
 * is plainly reachable.
 */
function isRectReachable(flood: FloodField, rect: Rect): boolean {
  for (let y = rect.y; y < rect.y + rect.h; y++) {
    for (let x = rect.x; x < rect.x + rect.w; x++) {
      if (isReachable(flood, { x, y })) return true;
    }
  }
  return false;
}

// ── Doorway detection ─────────────────────────────────────────────────────────

/**
 * The four sides of a room, as the direction *out of* the room from each one,
 * paired with how a walk along that side advances.
 */
const ROOM_SIDES: ReadonlyArray<{
  readonly outwardX: number;
  readonly outwardY: number;
  readonly alongX: number;
  readonly alongY: number;
}> = [
  { outwardX: 0, outwardY: -1, alongX: 1, alongY: 0 },
  { outwardX: 0, outwardY: 1, alongX: 1, alongY: 0 },
  { outwardX: -1, outwardY: 0, alongX: 0, alongY: 1 },
  { outwardX: 1, outwardY: 0, alongX: 0, alongY: 1 },
];

/**
 * Counts a room's distinct doorways.
 *
 * A doorway tile is a perimeter tile whose neighbour just outside the room is
 * walkable floor — a corridor only becomes a doorway once it has cut through the
 * surrounding wall, which is why this reads the finished grid. Runs of adjacent
 * doorway tiles along one side count once: a 3-tile-wide corridor is one way out,
 * not three, and counting tiles would let a single wide exit satisfy "the start
 * room can be left in more than one direction".
 */
function countDoorways(grid: TileContent[][], bounds: Rect): number {
  const height = grid.length;
  const width = grid[0]?.length ?? 0;
  const lastX = bounds.x + bounds.w - 1;
  const lastY = bounds.y + bounds.h - 1;
  let doorways = 0;

  for (const side of ROOM_SIDES) {
    const startX = side.outwardX > 0 ? lastX : bounds.x;
    const startY = side.outwardY > 0 ? lastY : bounds.y;
    const spanLength = side.alongX !== 0 ? bounds.w : bounds.h;

    let insideRun = false;
    for (let step = 0; step < spanLength; step++) {
      const x = startX + side.alongX * step;
      const y = startY + side.alongY * step;
      const ox = x + side.outwardX;
      const oy = y + side.outwardY;
      const isDoorway =
        isWalkableTileType(grid[y][x]) &&
        oy >= 0 &&
        oy < height &&
        ox >= 0 &&
        ox < width &&
        isWalkableTileType(grid[oy][ox]);
      if (isDoorway && !insideRun) doorways++;
      insideRun = isDoorway;
    }
  }
  return doorways;
}

// ── Invariants ────────────────────────────────────────────────────────────────

function stairwellFootprint(tile: Point): Rect {
  return { x: tile.x, y: tile.y, w: 1, h: 1 };
}

/**
 * Checks every topology invariant the forced-progression design depends on.
 * Pure: grid and layout data in, a list of failures out. Run both by the
 * generator's retry loop and by the offline verification harness.
 */
export function validateProgression(
  data: DungeonData,
  expectations: ProgressionExpectations,
): InvariantFailure[] {
  const failures: InvariantFailure[] = [];
  const fail = (id: string, message: string): void => {
    failures.push({ id, message });
  };

  const { grid, startTile, safeRooms, bossRooms, questRooms, stairwellTiles } = data;
  const { mapSize, gauntletCount, hasArena } = expectations;
  const layout = data.progressionLayout;

  const fullFlood = floodFill(grid, startTile, []);

  // I7 — everything the floor advertises is reachable with nothing removed.
  for (const [index, room] of bossRooms.entries()) {
    if (!isRectReachable(fullFlood, room.bounds)) {
      fail('I7', `boss room ${index} is unreachable from the start tile`);
    }
  }
  for (const [index, room] of safeRooms.entries()) {
    if (!isRectReachable(fullFlood, room.bounds)) {
      fail('I7', `safe room ${index} is unreachable from the start tile`);
    }
  }
  for (const [index, room] of questRooms.entries()) {
    if (!isRectReachable(fullFlood, room.bounds)) {
      fail('I7', `quest room ${index} is unreachable from the start tile`);
    }
  }
  if (data.spiderLabRoom !== null && !isRectReachable(fullFlood, data.spiderLabRoom.bounds)) {
    fail('I7', 'spider lab is unreachable from the start tile');
  }
  for (const [index, tile] of stairwellTiles.entries()) {
    if (!isReachable(fullFlood, tile)) {
      fail('I7', `stairwell ${index} at (${tile.x},${tile.y}) is unreachable from the start tile`);
    }
  }

  if (gauntletCount === 0) return failures;

  if (layout === undefined) {
    fail('I8', 'progression floor generated without gauntlet layout data');
    return failures;
  }

  // I1 — the player spawns at the middle of the map, inside the start room.
  const mapCentre: Point = { x: Math.floor(mapSize / 2), y: Math.floor(mapSize / 2) };
  const centreOffset = pointDistance(startTile, mapCentre);
  if (centreOffset > CENTER_SPAWN_TOLERANCE_TILES) {
    fail('I1', `start tile is ${centreOffset.toFixed(1)} tiles from the map centre`);
  }
  if (!rectContains(layout.startRoom, startTile)) {
    fail('I1', 'start tile lies outside the start room');
  }

  // I2 — the start room can be left in more than one direction.
  const startDoorways = countDoorways(grid, layout.startRoom);
  if (startDoorways < MIN_START_ROOM_DOORWAYS) {
    fail(
      'I2',
      `start room has ${startDoorways} distinct doorways, expected at least ${MIN_START_ROOM_DOORWAYS}`,
    );
  }

  // I8 — one boss room per gauntlet, index-aligned.
  if (bossRooms.length < gauntletCount) {
    fail('I8', `${bossRooms.length} boss rooms for ${gauntletCount} gauntlets`);
    return failures;
  }
  if (safeRooms.length < gauntletCount) {
    fail('I8', `${safeRooms.length} safe rooms for ${gauntletCount} gauntlets`);
    return failures;
  }

  const gatewaySafeRooms = safeRooms.slice(0, gauntletCount);
  const otherSafeRooms = safeRooms.slice(gauntletCount);
  const antechamber = otherSafeRooms.find((room) => room.guardsBossType !== undefined);
  const scatterSafeRooms = otherSafeRooms.filter((room) => room.guardsBossType === undefined);

  for (const [index, room] of gatewaySafeRooms.entries()) {
    if (room.guardsBossType === undefined) {
      fail('I8', `gateway safe room ${index} carries no guardsBossType`);
    }
  }

  const lastBossRoom = bossRooms[gauntletCount - 1];
  const arena = data.arenaExteriors.length > 0 ? data.arenaExteriors[0] : null;
  const arenaDoorTile = data.arenaDoorTile;

  // I3 — each gateway safe room and its boss room are cut vertices: nothing past
  // them survives their removal.
  for (let k = 0; k < gauntletCount; k++) {
    const gatewaySafe = gatewaySafeRooms[k];
    const gatewayBoss = bossRooms[k];

    const laterLandmarks: Array<{ label: string; rect: Rect }> = [];
    for (let later = k + 1; later < gauntletCount; later++) {
      laterLandmarks.push({
        label: `gateway safe room ${later}`,
        rect: gatewaySafeRooms[later].bounds,
      });
      laterLandmarks.push({ label: `gateway boss room ${later}`, rect: bossRooms[later].bounds });
    }
    for (const [index, tile] of stairwellTiles.entries()) {
      laterLandmarks.push({ label: `stairwell ${index}`, rect: stairwellFootprint(tile) });
    }
    for (const [index, room] of questRooms.entries()) {
      laterLandmarks.push({ label: `quest room ${index}`, rect: room.bounds });
    }
    if (hasArena && arenaDoorTile !== undefined) {
      laterLandmarks.push({ label: 'arena door', rect: stairwellFootprint(arenaDoorTile) });
    }

    // I3a — remove the gateway safe room.
    const withoutSafe = floodFill(grid, startTile, [gatewaySafe.bounds]);
    if (isRectReachable(withoutSafe, gatewayBoss.bounds)) {
      fail('I3a', `gauntlet ${k}: boss room is reachable without its gateway safe room`);
    }
    for (const landmark of laterLandmarks) {
      if (isRectReachable(withoutSafe, landmark.rect)) {
        fail('I3a', `gauntlet ${k}: ${landmark.label} is reachable without the gateway safe room`);
      }
    }

    // I3b — remove the gateway boss room.
    const withoutBoss = floodFill(grid, startTile, [gatewayBoss.bounds]);
    if (!isRectReachable(withoutBoss, gatewaySafe.bounds)) {
      fail('I3b', `gauntlet ${k}: gateway safe room became unreachable without the boss room`);
    }
    for (const landmark of laterLandmarks) {
      if (isRectReachable(withoutBoss, landmark.rect)) {
        fail('I3b', `gauntlet ${k}: ${landmark.label} is reachable without the gateway boss room`);
      }
    }
  }

  // I4 — stairwells are spread out, well past the last boss's exit, and never
  // sitting inside a gauntlet.
  if (stairwellTiles.length === 0) {
    fail('I4', 'the floor has no stairwell down');
  }
  for (let i = 0; i < stairwellTiles.length; i++) {
    const tile = stairwellTiles[i];
    const distFromExit = distanceToRect(tile, lastBossRoom.bounds);
    if (!layout.stairwellSpacingWaived && distFromExit < STAIRWELL_MIN_DIST_FROM_GAUNTLET_EXIT) {
      fail(
        'I4',
        `stairwell ${i} is ${distFromExit.toFixed(1)} tiles from the last boss room (min ${STAIRWELL_MIN_DIST_FROM_GAUNTLET_EXIT})`,
      );
    }
    for (let j = i + 1; j < stairwellTiles.length; j++) {
      const separation = pointDistance(tile, stairwellTiles[j]);
      if (separation < STAIRWELL_MIN_SEPARATION) {
        fail(
          'I4',
          `stairwells ${i} and ${j} are ${separation.toFixed(1)} tiles apart (min ${STAIRWELL_MIN_SEPARATION})`,
        );
      }
    }
    for (const gauntletRooms of layout.gauntletRoomBounds) {
      if (gauntletRooms.some((rect) => rectContains(rect, tile))) {
        fail('I4', `stairwell ${i} sits inside a gauntlet room`);
      }
    }
  }

  // I5 — scatter safe rooms never cluster, and never crowd a gateway.
  for (let i = 0; i < scatterSafeRooms.length; i++) {
    for (let j = i + 1; j < scatterSafeRooms.length; j++) {
      const separation = pointDistance(scatterSafeRooms[i].centre, scatterSafeRooms[j].centre);
      if (separation < SCATTER_SAFE_ROOM_SEPARATION) {
        fail(
          'I5',
          `scatter safe rooms ${i} and ${j} are ${separation.toFixed(1)} tiles apart (min ${SCATTER_SAFE_ROOM_SEPARATION})`,
        );
      }
    }
    for (const [gatewayIndex, gateway] of gatewaySafeRooms.entries()) {
      const separation = pointDistance(scatterSafeRooms[i].centre, gateway.centre);
      if (separation < SCATTER_SAFE_ROOM_SEPARATION) {
        fail(
          'I5',
          `scatter safe room ${i} is ${separation.toFixed(1)} tiles from gateway safe room ${gatewayIndex} (min ${SCATTER_SAFE_ROOM_SEPARATION})`,
        );
      }
    }
  }

  // I6 — the arena is only reachable through its antechamber, and skipping both
  // still leaves the rest of the floor open.
  if (hasArena) {
    if (antechamber === undefined) {
      fail('I6', 'arena floor generated without an antechamber safe room');
    } else if (arenaDoorTile === undefined || arena === null) {
      fail('I6', 'arena floor generated without an arena door tile');
    } else {
      const withoutAntechamber = floodFill(grid, startTile, [antechamber.bounds]);
      if (isReachable(withoutAntechamber, arenaDoorTile)) {
        fail('I6', 'the arena door is reachable without passing through the antechamber');
      }
      const withoutArena = floodFill(grid, startTile, [
        antechamber.bounds,
        arenaReserveRect(arena.centre),
      ]);
      for (const [index, tile] of stairwellTiles.entries()) {
        if (!isReachable(withoutArena, tile)) {
          fail('I6', `stairwell ${index} needs the arena or antechamber to be reachable`);
        }
      }
    }
  }

  return failures;
}
