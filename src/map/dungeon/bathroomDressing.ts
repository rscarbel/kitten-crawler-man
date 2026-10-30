/**
 * Fits out one copy of the clogged bathroom on the grid: its two wall sinks,
 * and the plumber's mop bucket and plunger beside him.
 *
 * The stall row and the pipe panel are not grid dressing. They hang on the
 * north wall face, change with the plumbing, and are drawn live by the room's
 * system from `bathroomRoomSprites.ts`.
 */

import type { SinkSide } from '../../sprites/art/bathroomRoomArt';
import {
  bathroomBlockedTiles,
  bathroomImpassableTiles,
  type BathroomRoomData,
} from '../bathroomLayout';
import type { Point } from '../roomDoorways';
import {
  BATHROOM_PLUNGER,
  BATHROOM_SINK,
  FloorTypeValue,
  MOP_BUCKET,
  placeProp,
  type TileContent,
} from '../tileTypes';
import { isWalkableTileType } from '../walkability';

/** How far from the plumber his bucket and plunger may stand, Chebyshev. */
const KIT_REACH_TILES = 3;
/** Ranking weight of a step away from the plumber, against standing off a wall. */
const DISTANCE_WEIGHT = 10;
const OFF_WALL_PENALTY = 5;

const ORTHOGONAL: ReadonlyArray<Point> = [
  { x: 0, y: -1 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
];

/** Which side wall a sink tile hangs on: west when the wall stands to its west. */
export function bathroomSinkSide(grid: TileContent[][], x: number, y: number): SinkSide {
  return grid[y]?.[x - 1]?.type === FloorTypeValue.wall ? 'west' : 'east';
}

function keyOf(x: number, y: number): string {
  return `${x},${y}`;
}

function chebyshev(a: Point, b: Point): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

/**
 * Tiles reachable from the room's way in with the line standing in it, one
 * tile of corridor beyond the walls included so the doorway itself counts.
 */
function reachableFromEntrance(
  grid: TileContent[][],
  room: BathroomRoomData,
  solid: ReadonlySet<string>,
): Set<string> {
  const { bounds } = room;
  const inReach = (x: number, y: number): boolean =>
    x >= bounds.x - 1 && x <= bounds.x + bounds.w && y >= bounds.y - 1 && y <= bounds.y + bounds.h;
  const open = (x: number, y: number): boolean => {
    if (y < 0 || y >= grid.length || x < 0 || x >= grid[y].length) return false;
    return isWalkableTileType(grid[y][x], 'walker') && !solid.has(keyOf(x, y));
  };
  const start = room.entranceTile;
  const seen = new Set<string>();
  if (!open(start.x, start.y)) return seen;
  seen.add(keyOf(start.x, start.y));
  const queue: Point[] = [start];
  for (const at of queue) {
    for (const step of ORTHOGONAL) {
      const x = at.x + step.x;
      const y = at.y + step.y;
      const key = keyOf(x, y);
      if (seen.has(key) || !inReach(x, y) || !open(x, y)) continue;
      seen.add(key);
      queue.push({ x, y });
    }
  }
  return seen;
}

/** Tiles nothing may be set on: everyone's standing spots, the line, and a tile round each doorway. */
function keptClear(room: BathroomRoomData): Set<string> {
  const clear = new Set<string>();
  const standing = [
    room.entranceTile,
    room.pipeWallStandTile,
    room.plumberTile,
    ...room.stallDoorTiles,
    ...room.sinkTiles,
    ...room.loiterTiles,
    ...bathroomBlockedTiles(room),
  ];
  for (const tile of standing) clear.add(keyOf(tile.x, tile.y));
  for (const doorway of [room.entranceDoorway, ...room.blockedDoorways]) {
    for (const tile of doorway.tiles) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) clear.add(keyOf(tile.x + dx, tile.y + dy));
      }
    }
  }
  return clear;
}

/** Room floor tiles near the plumber, best first: close to him, and against a wall. */
function kitCandidates(grid: TileContent[][], room: BathroomRoomData, floor: number): Point[] {
  const { bounds, plumberTile } = room;
  const clear = keptClear(room);
  const candidates: Array<{ tile: Point; score: number }> = [];
  for (let y = bounds.y; y < bounds.y + bounds.h; y++) {
    for (let x = bounds.x; x < bounds.x + bounds.w; x++) {
      const tile = { x, y };
      const distance = chebyshev(tile, plumberTile);
      if (distance === 0 || distance > KIT_REACH_TILES) continue;
      if (grid[y]?.[x]?.type !== floor || clear.has(keyOf(x, y))) continue;
      const againstWall =
        x === bounds.x ||
        x === bounds.x + bounds.w - 1 ||
        y === bounds.y ||
        y === bounds.y + bounds.h - 1;
      candidates.push({
        tile,
        score: distance * DISTANCE_WEIGHT + (againstWall ? 0 : OFF_WALL_PENALTY),
      });
    }
  }
  candidates.sort((a, b) => a.score - b.score);
  return candidates.map((candidate) => candidate.tile);
}

/**
 * Sets the mop bucket on the best tile beside the plumber whose loss cuts
 * nothing else in the room off from its way in, with the line standing in
 * it. Returns where it went, or null when no tile near him can spare it.
 */
function placeMopBucket(
  grid: TileContent[][],
  room: BathroomRoomData,
  floor: number,
  plumberBlocks: boolean,
): Point | null {
  // The plumber is anchored where he stands, so a bucket beside him must not
  // close the gap he leaves.
  const inTheWay = plumberBlocks ? bathroomImpassableTiles(room) : bathroomBlockedTiles(room);
  const line = new Set(inTheWay.map((tile) => keyOf(tile.x, tile.y)));
  const before = reachableFromEntrance(grid, room, line);
  for (const tile of kitCandidates(grid, room, floor)) {
    const key = keyOf(tile.x, tile.y);
    if (!before.has(key)) continue;
    const after = reachableFromEntrance(grid, room, new Set([...line, key]));
    if (after.size !== before.size - 1) continue;
    placeProp(grid[tile.y][tile.x], MOP_BUCKET);
    return tile;
  }
  return null;
}

/**
 * Fits one bathroom out: a sink on each of its sink tiles, then the plumber's
 * mop bucket and his plunger stood beside it. Only tiles still laid in the
 * room's own floor are touched.
 */
export function dressBathroom(
  grid: TileContent[][],
  room: BathroomRoomData,
  floor: number,
  plumberBlocks: boolean,
): void {
  for (const sink of room.sinkTiles) {
    const tile = grid[sink.y][sink.x];
    if (tile.type === floor) placeProp(tile, BATHROOM_SINK);
  }
  const bucket = placeMopBucket(grid, room, floor, plumberBlocks);
  const plungerSpot =
    kitCandidates(grid, room, floor).find(
      (tile) => bucket === null || chebyshev(tile, bucket) === 1,
    ) ?? null;
  if (plungerSpot !== null) placeProp(grid[plungerSpot.y][plungerSpot.x], BATHROOM_PLUNGER);
}
