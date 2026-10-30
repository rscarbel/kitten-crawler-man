/**
 * Where a creature may be put down inside an interior room: open floor, no two
 * bodies on one tile, and in plain view of a party walking in from the door.
 */

import type { GameMap } from '../map/GameMap';
import { findNearbyWalkableTile } from '../map/findWalkableTile';
import { TOWN_INTERIOR_PROPS } from '../sprites/art/townInterior/townInteriorProps';

/**
 * Somewhere open to stand for each tile asked for, no two the same.
 *
 * The search nudges a request that lands in furniture, and two nudged the same
 * way would stack into one body with a doubled health bar. A request with
 * nowhere to go is dropped rather than doubled up, so the caller gets fewer
 * bodies rather than overlapping ones. `isAcceptable` narrows where a body
 * may go, for a caller with rules of its own about the room.
 */
export function distinctSpawnTiles(
  map: GameMap,
  wanted: ReadonlyArray<{ x: number; y: number }>,
  searchRadiusTiles: number,
  isAcceptable: (x: number, y: number) => boolean = () => true,
): Array<{ x: number; y: number }> {
  const claimed = new Set<string>();
  const placed: Array<{ x: number; y: number }> = [];
  for (const target of wanted) {
    const tile = findNearbyWalkableTile(
      map,
      target.x,
      target.y,
      searchRadiusTiles,
      (x, y) => !claimed.has(`${x},${y}`) && isAcceptable(x, y),
    );
    if (tile === null) continue;
    claimed.add(`${tile.x},${tile.y}`);
    placed.push(tile);
  }
  return placed;
}

/**
 * Rows and columns in from each wall that make up a room's far corners — the
 * edge of the camera, behind whatever stands along both walls.
 */
const FAR_CORNER_BAND_TILES = 2;

/**
 * How much of a tile a prop's art must cover to hide a small creature standing
 * on it. A rat's whole sprite fits in the lower half of its tile, so art
 * reaching past halfway up the tile has covered it.
 */
const HIDING_COVER_FRACTION = 0.5;

/**
 * Where a creature the party has been sent to hunt may be put: floor the
 * party can walk to from the door, in plain view, and not in a far corner.
 *
 * A prop is drawn over whatever stands in the rows its art rises into, so a
 * rat set down just north of a pew is behind the pew's back for as long as it
 * sits still — the room reads as empty with the count still short. And a
 * corner behind two walls of shelving is the last place a player looks.
 */
export function inPlainViewOnTheWayIn(map: GameMap): (x: number, y: number) => boolean {
  const reachable = reachableFromDoor(map);
  const hidden = new Set<string>();
  for (const placed of map.placedInteriorProps) {
    const def = TOWN_INTERIOR_PROPS[placed.propId];
    for (let rowsUp = 1; rowsUp - HIDING_COVER_FRACTION < def.artHeightTiles; rowsUp++) {
      for (let dx = 0; dx < def.footprint.w; dx++) {
        hidden.add(`${placed.tile.x + dx},${placed.tile.y - rowsUp}`);
      }
    }
  }
  const lastColumn = (map.structure[0]?.length ?? 0) - 1;
  const lastRow = map.structure.length - 1;
  const inFarCorner = (x: number, y: number): boolean => {
    const byWestOrEastWall = x <= FAR_CORNER_BAND_TILES || x >= lastColumn - FAR_CORNER_BAND_TILES;
    const byNorthOrSouthWall = y <= FAR_CORNER_BAND_TILES || y >= lastRow - FAR_CORNER_BAND_TILES;
    return byWestOrEastWall && byNorthOrSouthWall;
  };
  return (x, y) => {
    const key = `${x},${y}`;
    return reachable.has(key) && !hidden.has(key) && !inFarCorner(x, y);
  };
}

const CARDINAL_STEPS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

/** Every tile a walker can reach from the room's door, four-connected. */
function reachableFromDoor(map: GameMap): Set<string> {
  const door = map.startTile;
  const reached = new Set<string>();
  if (!map.isWalkable(door.x, door.y, 'walker')) return reached;
  reached.add(`${door.x},${door.y}`);
  const queue: Array<{ x: number; y: number }> = [{ x: door.x, y: door.y }];
  // The iterator re-reads `length`, so tiles pushed below are visited by this loop.
  for (const tile of queue) {
    for (const [dx, dy] of CARDINAL_STEPS) {
      const x = tile.x + dx;
      const y = tile.y + dy;
      const key = `${x},${y}`;
      if (reached.has(key) || !map.isWalkable(x, y, 'walker')) continue;
      reached.add(key);
      queue.push({ x, y });
    }
  }
  return reached;
}
