import type { TileContent } from './tileTypes';
import { isWalkableTileType } from './walkability';

/**
 * A room's ways in, read off a finished grid.
 *
 * One module rather than a copy in the generator and another in the validator,
 * because the two definitions have already drifted once and the drift was
 * invisible: the generator grouped a corner arrival as one opening while the
 * validator counted it as two, so a structurally correct spider lab failed the
 * "exactly one doorway" gate and a perfectly good map was thrown away.
 */

export type RoomWall = 'north' | 'south' | 'east' | 'west';

export type Point = { x: number; y: number };
export type Rect = { x: number; y: number; w: number; h: number };

/** The four walls of a room, as the direction *out of* the room through each. */
export const ROOM_WALL_OUTWARD: ReadonlyArray<{ wall: RoomWall; dx: number; dy: number }> = [
  { wall: 'north', dx: 0, dy: -1 },
  { wall: 'south', dx: 0, dy: 1 },
  { wall: 'west', dx: -1, dy: 0 },
  { wall: 'east', dx: 1, dy: 0 },
];

/**
 * One way into a room: every perimeter tile a single corridor broke through,
 * however many walls the opening happens to touch.
 */
export interface RoomDoorway {
  /** The wall carrying most of the opening — what a fixture placed at it faces. */
  wall: RoomWall;
  /** Middle tile of the opening — the one thing a single-tile consumer wants. */
  tile: Point;
  /** Every perimeter tile of the opening, so a wide corridor can be sealed whole. */
  tiles: Point[];
}

function isOpenFloor(grid: TileContent[][], x: number, y: number): boolean {
  if (y < 0 || y >= grid.length) return false;
  const row = grid[y];
  if (x < 0 || x >= row.length) return false;
  return isWalkableTileType(row[x], 'walker');
}

/** Assembles one doorway from the run of perimeter tiles that make it up. */
function buildDoorway(
  tiles: ReadonlyArray<Point>,
  wallsAt: ReadonlyArray<RoomWall[]>,
): RoomDoorway {
  const counts = new Map<RoomWall, number>();
  for (const walls of wallsAt) {
    for (const wall of walls) counts.set(wall, (counts.get(wall) ?? 0) + 1);
  }
  let wall: RoomWall = 'south';
  let best = -1;
  for (const [candidate, count] of counts) {
    if (count <= best) continue;
    best = count;
    wall = candidate;
  }
  return { wall, tile: tiles[Math.floor(tiles.length / 2)], tiles: [...tiles] };
}

/**
 * Every doorway a room has.
 *
 * Derived from the tiles rather than from the corridors' endpoints, because a
 * corridor's L can bend either way: guessing the wall from the two room centres
 * is right only for one of the two orientations, and picks the wrong wall
 * outright for the other.
 *
 * Grouped by connected runs of perimeter tiles rather than per wall, and that is
 * load-bearing rather than tidy: a corridor arriving at a corner breaks through
 * on *both* of the walls meeting there, and a per-wall scan reports that single
 * opening as two doorways sharing a corner tile. Anything that then keeps one
 * doorway and treats the others as onward routes claims part of the one it kept
 * — which for the defense quest means the goblin mother boarding the way in.
 */
export function roomDoorways(grid: TileContent[][], bounds: Rect): RoomDoorway[] {
  const lastX = bounds.x + bounds.w - 1;
  const lastY = bounds.y + bounds.h - 1;

  /** Which walls a perimeter tile is open through, or none if it is not a doorway. */
  const openWallsAt = (x: number, y: number): RoomWall[] => {
    const walls: RoomWall[] = [];
    if (!isOpenFloor(grid, x, y)) return walls;
    for (const side of ROOM_WALL_OUTWARD) {
      const onThisWall =
        (side.wall === 'north' && y === bounds.y) ||
        (side.wall === 'south' && y === lastY) ||
        (side.wall === 'west' && x === bounds.x) ||
        (side.wall === 'east' && x === lastX);
      if (!onThisWall) continue;
      if (isOpenFloor(grid, x + side.dx, y + side.dy)) walls.push(side.wall);
    }
    return walls;
  };

  // The perimeter, walked as a closed ring so the run that wraps a corner is one
  // run rather than two touching the same tile.
  const ring: Point[] = [];
  for (let x = bounds.x; x <= lastX; x++) ring.push({ x, y: bounds.y });
  for (let y = bounds.y + 1; y <= lastY; y++) ring.push({ x: lastX, y });
  for (let x = lastX - 1; x >= bounds.x; x--) ring.push({ x, y: lastY });
  for (let y = lastY - 1; y > bounds.y; y--) ring.push({ x: bounds.x, y });

  const wallsAt = ring.map((tile) => openWallsAt(tile.x, tile.y));
  const isDoorway = wallsAt.map((walls) => walls.length > 0);
  if (isDoorway.every((open) => open)) {
    // A room open the whole way round has one doorway, not one per step.
    return [buildDoorway(ring, wallsAt)];
  }

  const doorways: RoomDoorway[] = [];
  let run: number[] = [];
  // Started at a closed tile so a run spanning the ring's seam is not split.
  const firstClosed = isDoorway.indexOf(false);
  for (let step = 0; step <= ring.length; step++) {
    const index = (firstClosed + step) % ring.length;
    if (step < ring.length && isDoorway[index]) {
      run.push(index);
      continue;
    }
    if (run.length === 0) continue;
    doorways.push(
      buildDoorway(
        run.map((position) => ring[position]),
        run.map((position) => wallsAt[position]),
      ),
    );
    run = [];
  }
  return doorways;
}

/**
 * Which wall a room's *main* corridor comes in through: the widest doorway it
 * has, or the south wall's midpoint for a room nothing has connected to yet.
 */
export function detectRoomEntrance(
  grid: TileContent[][],
  bounds: Rect,
): { wall: RoomWall; tile: Point } {
  const lastY = bounds.y + bounds.h - 1;
  let best: RoomDoorway | null = null;
  for (const doorway of roomDoorways(grid, bounds)) {
    if (best === null || doorway.tiles.length > best.tiles.length) best = doorway;
  }
  if (best !== null) return { wall: best.wall, tile: best.tile };
  return { wall: 'south', tile: { x: Math.floor(bounds.x + bounds.w / 2), y: lastY } };
}

/**
 * Margin a room's floor-connectivity test is padded by, so a corridor's
 * approach tile just outside the room's wall is part of what the test proves
 * stays connected — a corridor is one tile wide and its doorway can funnel
 * straight into a room's centre with no lateral spread, so testing the room's
 * interior alone would miss a solid tile that seals that sole approach.
 */
const ROOM_CONNECTIVITY_MARGIN = 2;

/**
 * Whether making every tile of `blocked` solid would disconnect walkable tiles
 * around `room` that are connected now — its own floor, plus a short reach past
 * each wall for the corridors that approach it — judged by 4-connectivity
 * inside that window. `blocked` is one connected footprint.
 *
 * Every walkable tile next to the footprint is in the same piece as it, so
 * blocking it splits something exactly when those neighbours can no longer
 * all reach one another without it. Asking that, rather than whether the
 * whole window is one piece, keeps a corridor that merely passes the room
 * inside the margin, joined to nothing in the window, from making every
 * tile of the room read as a split. A path that leaves the window is never
 * counted, so the test only ever errs towards refusing a tile.
 *
 * A room's doorways, and the corridor tiles just outside them, are ordinary
 * walkable tiles this test walks, so nothing placed through it can cost a room
 * whose only route in and out threads through it the doorway that route uses.
 */
export function blockingWouldSplitRoom(
  grid: TileContent[][],
  room: Rect,
  blocked: ReadonlyArray<Point>,
): boolean {
  const columns = grid[0]?.length ?? 0;
  const minX = Math.max(0, room.x - ROOM_CONNECTIVITY_MARGIN);
  const maxX = Math.min(columns - 1, room.x + room.w - 1 + ROOM_CONNECTIVITY_MARGIN);
  const minY = Math.max(0, room.y - ROOM_CONNECTIVITY_MARGIN);
  const maxY = Math.min(grid.length - 1, room.y + room.h - 1 + ROOM_CONNECTIVITY_MARGIN);
  const keyOf = (x: number, y: number): number => y * columns + x;
  const blockedKeys = new Set(blocked.map((tile) => keyOf(tile.x, tile.y)));
  const walkableInWindow = (x: number, y: number): boolean =>
    x >= minX &&
    x <= maxX &&
    y >= minY &&
    y <= maxY &&
    !blockedKeys.has(keyOf(x, y)) &&
    isOpenFloor(grid, x, y);

  const neighbourKeys = new Set<number>();
  const neighbours: Point[] = [];
  for (const tile of blocked) {
    for (const side of ROOM_WALL_OUTWARD) {
      const x = tile.x + side.dx;
      const y = tile.y + side.dy;
      if (!walkableInWindow(x, y) || neighbourKeys.has(keyOf(x, y))) continue;
      neighbourKeys.add(keyOf(x, y));
      neighbours.push({ x, y });
    }
  }
  if (neighbours.length <= 1) return false;
  const start = neighbours[0];

  const seen = new Set<number>([keyOf(start.x, start.y)]);
  const stack: Point[] = [start];
  let unreached = neighbours.length - 1;
  while (stack.length > 0 && unreached > 0) {
    const tile = stack.pop();
    if (tile === undefined) continue;
    for (const side of ROOM_WALL_OUTWARD) {
      const x = tile.x + side.dx;
      const y = tile.y + side.dy;
      const key = keyOf(x, y);
      if (seen.has(key) || !walkableInWindow(x, y)) continue;
      seen.add(key);
      if (neighbourKeys.has(key)) unreached--;
      stack.push({ x, y });
    }
  }
  return unreached > 0;
}

/**
 * The corridor leading out of a room through one of its doorways: every open
 * tile reachable from just outside the opening without stepping inside any of
 * `rooms`, so the walk stops at the next room's walls. Meant for a dead-end
 * room whose only corridor joins nothing else on its way to its host.
 */
export function corridorBeyondDoorway(
  grid: TileContent[][],
  doorway: Pick<RoomDoorway, 'tiles'>,
  rooms: ReadonlyArray<Rect>,
): Point[] {
  const isInsideAnyRoom = (x: number, y: number): boolean =>
    rooms.some((room) => x >= room.x && x < room.x + room.w && y >= room.y && y < room.y + room.h);
  const keyOf = (x: number, y: number): string => `${x},${y}`;
  const seen = new Set<string>();
  const corridor: Point[] = [];
  const frontier: Point[] = [];
  const visit = (x: number, y: number): void => {
    if (seen.has(keyOf(x, y))) return;
    if (!isOpenFloor(grid, x, y) || isInsideAnyRoom(x, y)) return;
    seen.add(keyOf(x, y));
    corridor.push({ x, y });
    frontier.push({ x, y });
  };
  for (const tile of doorway.tiles) {
    for (const side of ROOM_WALL_OUTWARD) visit(tile.x + side.dx, tile.y + side.dy);
  }
  for (let next = frontier.pop(); next !== undefined; next = frontier.pop()) {
    for (const side of ROOM_WALL_OUTWARD) visit(next.x + side.dx, next.y + side.dy);
  }
  return corridor;
}
