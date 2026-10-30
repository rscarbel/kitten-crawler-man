/**
 * The spider lab's approach, read off the carved grid: the outer hallway from
 * the chain room the lab hangs off to its field station, the station, and the
 * inner hallway on to the lab's doorway.
 *
 * Read from the grid rather than from the planned corridors, because what a
 * crawler walks is what got carved: a planned corridor's tiles include the
 * stretches inside both rooms it joins, and its L can run along a wall.
 */

import type { TileContent } from './tileTypes';
import { isWalkableTileType } from './walkability';
import { tileCoordKey } from './tileIndex';
import {
  corridorBeyondDoorway,
  roomDoorways,
  ROOM_WALL_OUTWARD,
  type Point,
  type Rect,
  type RoomDoorway,
} from './roomDoorways';

/**
 * One floor tile of the lab's approach hallways, with how far it is walked from
 * the mouth. Recorded because the grid cannot say which corridor tiles belong
 * to the lab, and the walk from the mouth is what the hallways are dressed and
 * triggered along.
 */
export interface LabHallwayTile extends Point {
  /**
   * Fewest steps from the hallway mouth to this tile, walking only the two
   * hallways and the station. Zero across the mouth itself.
   */
  distanceFromMouth: number;
}

export interface LabApproachLayout {
  outerHallwayTiles: LabHallwayTile[];
  innerHallwayTiles: LabHallwayTile[];
  hallwayMouthTile: Point;
  hallwayPostTile: Point;
  hallwayPostFacing: Point;
  hostBounds: Rect;
  labDoorwayDistance: number;
}

/** How far into the host room from its doorway row Dr. Moult's post may sit, nearest first. */
const POST_DEPTHS: readonly number[] = [1, 2];
/** How far along the wall past the mouth's edge his post may sit, nearest first. */
const POST_MAX_SIDESTEP_TILES = 3;
/** A post this close (Chebyshev) to another of the host's doorways would stand in that door. */
const POST_DOORWAY_CLEARANCE_TILES = 1;

function chebyshev(a: Point, b: Point): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

/**
 * Where Dr. Moult waits for a crawler: inside the host room just beside the
 * hallway's mouth, facing into the room. Beside rather than in front, so he
 * never reads as plugging the opening, and clear of every other doorway the
 * host has, so he never stands in the spine's way either.
 */
function layOutHallwayPost(
  grid: TileContent[][],
  host: Rect,
  mouthTiles: ReadonlyArray<Point>,
): { tile: Point; facing: Point } | null {
  const mouthKeys = new Set(mouthTiles.map((tile) => keyOf(tile.x, tile.y)));
  const doorways = roomDoorways(grid, host);
  const mouthDoorway = doorways.find((doorway) =>
    doorway.tiles.some((tile) => touchesAny(tile, mouthKeys)),
  );
  if (mouthDoorway === undefined) return null;
  const outward = ROOM_WALL_OUTWARD.find((side) => side.wall === mouthDoorway.wall);
  if (outward === undefined) return null;
  const facing = { x: -outward.dx, y: -outward.dy };
  const along = { x: Math.abs(outward.dy), y: Math.abs(outward.dx) };
  const alongOf = (tile: Point): number => tile.x * along.x + tile.y * along.y;
  const alongs = mouthDoorway.tiles.map(alongOf);
  const edges = [
    { from: mouthDoorway.tiles[alongs.indexOf(Math.min(...alongs))], sign: -1 },
    { from: mouthDoorway.tiles[alongs.indexOf(Math.max(...alongs))], sign: 1 },
  ];
  const otherDoorTiles = doorways
    .filter((doorway) => doorway !== mouthDoorway)
    .flatMap((doorway) => doorway.tiles);
  for (const depth of POST_DEPTHS) {
    for (let sidestep = 1; sidestep <= POST_MAX_SIDESTEP_TILES; sidestep++) {
      for (const edge of edges) {
        const tile = {
          x: edge.from.x + facing.x * depth + along.x * edge.sign * sidestep,
          y: edge.from.y + facing.y * depth + along.y * edge.sign * sidestep,
        };
        if (!insideRect(host, tile.x, tile.y)) continue;
        if (!isWalkableTileType(grid[tile.y][tile.x], 'walker')) continue;
        const inAnotherDoor = otherDoorTiles.some(
          (door) => chebyshev(door, tile) <= POST_DOORWAY_CLEARANCE_TILES,
        );
        if (!inAnotherDoor) return { tile, facing };
      }
    }
  }
  const lastDepth = POST_DEPTHS[POST_DEPTHS.length - 1] ?? 1;
  const inFront = {
    x: mouthDoorway.tile.x + facing.x * lastDepth,
    y: mouthDoorway.tile.y + facing.y * lastDepth,
  };
  const inFrontStands =
    insideRect(host, inFront.x, inFront.y) &&
    isWalkableTileType(grid[inFront.y][inFront.x], 'walker');
  return inFrontStands ? { tile: inFront, facing } : null;
}

function sameRect(a: Rect, b: Rect): boolean {
  return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
}

function insideRect(rect: Rect, x: number, y: number): boolean {
  return x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h;
}

function keyOf(x: number, y: number): string {
  return `${x},${y}`;
}

function touchesAny(tile: Point, keys: ReadonlySet<string>): boolean {
  return ROOM_WALL_OUTWARD.some((side) => keys.has(keyOf(tile.x + side.dx, tile.y + side.dy)));
}

/**
 * Lays the approach out from the lab's doorway back to its host, or null when
 * the carved grid does not have the shape the spine planned: a station with
 * exactly one way on toward the host besides the way to the lab, and a host
 * room at the end of that hallway.
 */
export function layOutLabApproach(
  grid: TileContent[][],
  labDoorway: Pick<RoomDoorway, 'tiles'>,
  labBounds: Rect,
  station: Rect,
  rooms: ReadonlyArray<Rect>,
): LabApproachLayout | null {
  const inner = corridorBeyondDoorway(grid, labDoorway, rooms);
  const innerKeys = new Set(inner.map((tile) => keyOf(tile.x, tile.y)));
  const stationDoorways = roomDoorways(grid, station);
  const towardLab = stationDoorways.filter((doorway) =>
    doorway.tiles.some((tile) => touchesAny(tile, innerKeys)),
  );
  const towardHost = stationDoorways.filter((doorway) => !towardLab.includes(doorway));
  if (inner.length === 0 || towardLab.length !== 1 || towardHost.length !== 1) return null;

  const outer = corridorBeyondDoorway(grid, towardHost[0], rooms);
  const outerKeys = new Set(outer.map((tile) => keyOf(tile.x, tile.y)));
  const host = rooms.find(
    (room) =>
      !sameRect(room, station) &&
      !sameRect(room, labBounds) &&
      outer.some((tile) =>
        ROOM_WALL_OUTWARD.some((side) => insideRect(room, tile.x + side.dx, tile.y + side.dy)),
      ),
  );
  if (host === undefined) return null;

  const mouthTiles = outer.filter((tile) =>
    ROOM_WALL_OUTWARD.some((side) => insideRect(host, tile.x + side.dx, tile.y + side.dy)),
  );
  if (mouthTiles.length === 0) return null;
  const middleOfMouth = mouthTiles[Math.floor(mouthTiles.length / 2)];
  const post = layOutHallwayPost(grid, host, mouthTiles);
  if (post === null) return null;

  // Walked over the two hallways, the station's open floor and the lab's own
  // doorway, so a distance is the walk a crawler actually takes.
  const walkable = (x: number, y: number): boolean => {
    const key = keyOf(x, y);
    if (outerKeys.has(key) || innerKeys.has(key)) return true;
    if (labDoorway.tiles.some((tile) => tile.x === x && tile.y === y)) return true;
    return insideRect(station, x, y) && isWalkableTileType(grid[y][x], 'walker');
  };
  const distance = new Map<string, number>();
  const queue: Point[] = [];
  for (const tile of mouthTiles) {
    distance.set(keyOf(tile.x, tile.y), 0);
    queue.push(tile);
  }
  // Grows as it is walked: a for-of over an array visits what is pushed onto it.
  for (const tile of queue) {
    const here = distance.get(keyOf(tile.x, tile.y)) ?? 0;
    for (const side of ROOM_WALL_OUTWARD) {
      const x = tile.x + side.dx;
      const y = tile.y + side.dy;
      const key = keyOf(x, y);
      if (distance.has(key) || !walkable(x, y)) continue;
      distance.set(key, here + 1);
      queue.push({ x, y });
    }
  }

  const withDistance = (tiles: ReadonlyArray<Point>): LabHallwayTile[] | null => {
    const measured: LabHallwayTile[] = [];
    for (const tile of tiles) {
      const steps = distance.get(keyOf(tile.x, tile.y));
      if (steps === undefined) return null;
      measured.push({ x: tile.x, y: tile.y, distanceFromMouth: steps });
    }
    return measured;
  };
  const outerHallwayTiles = withDistance(outer);
  const innerHallwayTiles = withDistance(inner);
  const doorwayDistances = labDoorway.tiles
    .map((tile) => distance.get(keyOf(tile.x, tile.y)))
    .filter((steps): steps is number => steps !== undefined);
  if (outerHallwayTiles === null || innerHallwayTiles === null || doorwayDistances.length === 0) {
    return null;
  }

  return {
    outerHallwayTiles,
    innerHallwayTiles,
    hallwayMouthTile: { x: middleOfMouth.x, y: middleOfMouth.y },
    hallwayPostTile: post.tile,
    hallwayPostFacing: post.facing,
    hostBounds: host,
    labDoorwayDistance: Math.min(...doorwayDistances),
  };
}

/** Which part of the lab's approach a tile is on. */
export type LabApproachZone = 'outer_hallway' | 'station' | 'inner_hallway';

/** The fields of the lab's room data the zone lookup reads. */
export interface LabApproachTiles {
  outerHallwayTiles: ReadonlyArray<Point>;
  innerHallwayTiles: ReadonlyArray<Point>;
  stationBounds: Rect;
}

const zoneMaps = new WeakMap<LabApproachTiles, ReadonlyMap<number, LabApproachZone>>();

/**
 * Which part of the approach `(tileX, tileY)` is on, or null when it is on
 * none of it (the host room and the lab itself included). Built once per lab
 * and kept, so it is cheap enough to ask every frame.
 */
export function labApproachZoneAt(
  lab: LabApproachTiles,
  tileX: number,
  tileY: number,
): LabApproachZone | null {
  if (insideRect(lab.stationBounds, tileX, tileY)) return 'station';
  let zones = zoneMaps.get(lab);
  if (zones === undefined) {
    const built = new Map<number, LabApproachZone>();
    for (const tile of lab.outerHallwayTiles) {
      built.set(tileCoordKey(tile.x, tile.y), 'outer_hallway');
    }
    for (const tile of lab.innerHallwayTiles) {
      built.set(tileCoordKey(tile.x, tile.y), 'inner_hallway');
    }
    zoneMaps.set(lab, built);
    zones = built;
  }
  return zones.get(tileCoordKey(tileX, tileY)) ?? null;
}

/** The fields of the lab's room data the decay lookup reads. */
export interface LabHallwayWalk {
  outerHallwayTiles: ReadonlyArray<LabHallwayTile>;
  innerHallwayTiles: ReadonlyArray<LabHallwayTile>;
  labDoorwayDistance: number;
}

const decayMaps = new WeakMap<LabHallwayWalk, ReadonlyMap<number, number>>();

/**
 * How far gone the approach is at `(tileX, tileY)`: 0 across the mouth, 1 at
 * the lab's doorway, along the walk a crawler takes; null off both hallways
 * (the station included, which is held ground). Built once per lab and kept.
 */
export function labHallwayDecayAt(
  lab: LabHallwayWalk,
  tileX: number,
  tileY: number,
): number | null {
  let decays = decayMaps.get(lab);
  if (decays === undefined) {
    const built = new Map<number, number>();
    const span = Math.max(1, lab.labDoorwayDistance);
    for (const tile of [...lab.outerHallwayTiles, ...lab.innerHallwayTiles]) {
      built.set(tileCoordKey(tile.x, tile.y), Math.min(1, tile.distanceFromMouth / span));
    }
    decayMaps.set(lab, built);
    decays = built;
  }
  return decays.get(tileCoordKey(tileX, tileY)) ?? null;
}
