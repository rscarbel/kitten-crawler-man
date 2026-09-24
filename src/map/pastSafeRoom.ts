import type { GameMap } from './GameMap';

/** A rectangle of tiles, `x`/`y` its top-left. */
export interface TileRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

const NEIGHBOUR_OFFSETS: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

function isInRect(tileX: number, tileY: number, rect: TileRect): boolean {
  return tileX >= rect.x && tileY >= rect.y && tileX < rect.x + rect.w && tileY < rect.y + rect.h;
}

/**
 * A test for whether a room lies past the safe room guarding `bossType`: no
 * tile of it can be walked to from the floor's start without crossing that
 * safe room. Null when the map has no such safe room.
 *
 * Answered by walking the built floor rather than by distance or by region,
 * because "past" is about the route: a room across a wall from the safe room
 * can still be one the party passes long before it.
 */
export function pastSafeRoomTest(
  map: GameMap,
  bossType: string,
): ((room: TileRect) => boolean) | null {
  const safeRoom = map.safeRoomGuarding(bossType);
  if (safeRoom === undefined) return null;
  const rows = map.structure.length;
  const columns = map.structure[0]?.length ?? rows;
  const reached = new Uint8Array(rows * columns);
  const start = map.startTile;
  const queue: { x: number; y: number }[] = [];
  if (map.isWalkable(start.x, start.y) && !isInRect(start.x, start.y, safeRoom.bounds)) {
    reached[start.y * columns + start.x] = 1;
    queue.push(start);
  }
  // The array iterator re-reads `length`, so tiles pushed below are visited by this same loop.
  for (const tile of queue) {
    for (const [dx, dy] of NEIGHBOUR_OFFSETS) {
      const x = tile.x + dx;
      const y = tile.y + dy;
      if (x < 0 || y < 0 || x >= columns || y >= rows) continue;
      const index = y * columns + x;
      if (reached[index] === 1) continue;
      if (!map.isWalkable(x, y) || isInRect(x, y, safeRoom.bounds)) continue;
      reached[index] = 1;
      queue.push({ x, y });
    }
  }
  return (room) => {
    for (let y = room.y; y < room.y + room.h; y++) {
      for (let x = room.x; x < room.x + room.w; x++) {
        if (x < 0 || y < 0 || x >= columns || y >= rows) continue;
        if (reached[y * columns + x] === 1) return false;
      }
    }
    return true;
  };
}
