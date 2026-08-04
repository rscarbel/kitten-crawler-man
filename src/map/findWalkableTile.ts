import type { GameMap } from './GameMap';

/**
 * How many connected walkable tiles a creature needs around it to count as
 * standing somewhere it can actually operate.
 *
 * A disc of radius two is thirteen tiles, which is about the smallest pocket a
 * creature can path and fight inside. Anything tighter is a trap: it is walkable
 * ground, so every `isWalkable` test passes, but the occupant can only shuffle
 * on the spot. Forest is where this bites — `TREE` tiles are individually
 * non-walkable, so a dense stand leaves single-tile gaps between trunks that
 * read as perfectly good spawn ground.
 */
const MIN_OPEN_TILES = 13;

/**
 * Whether a tile belongs to a connected walkable region big enough to move in.
 *
 * Flood fill from the tile, stopping the moment the count is reached — the
 * answer is "at least this many", never the true size, so the cost is bounded
 * by {@link MIN_OPEN_TILES} however large the open region actually is.
 *
 * Four-connected rather than eight: a creature that can only leave a pocket by
 * cutting a diagonal between two trunks is still stuck for every practical
 * purpose, and collision resolution will not reliably let it through.
 */
export function hasRoomToMove(
  map: GameMap,
  tileX: number,
  tileY: number,
  minOpenTiles = MIN_OPEN_TILES,
): boolean {
  if (!map.isWalkable(tileX, tileY)) return false;

  const mapSize = map.structure.length;
  const seen = new Set<number>();
  // Keyed by arithmetic on the tile position rather than a string, because a
  // ring search calls this once per candidate tile. Only in-bounds tiles are
  // ever keyed, so the row stride cannot make two positions collide.
  const inBounds = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < mapSize && y < mapSize;

  const queue: Array<{ x: number; y: number }> = [{ x: tileX, y: tileY }];
  seen.add(tileY * mapSize + tileX);

  let reached = 0;
  // Iterating the queue rather than shifting off it — `shift` is O(n) per call.
  // The array iterator re-reads `length` each step, so tiles pushed below are
  // visited by this same loop; that is the flood fill.
  for (const tile of queue) {
    reached++;
    if (reached >= minOpenTiles) return true;

    for (const [dx, dy] of NEIGHBOUR_OFFSETS) {
      const x = tile.x + dx;
      const y = tile.y + dy;
      if (!inBounds(x, y)) continue;
      const key = y * mapSize + x;
      if (seen.has(key)) continue;
      seen.add(key);
      if (!map.isWalkable(x, y)) continue;
      queue.push({ x, y });
    }
  }
  return false;
}

const NEIGHBOUR_OFFSETS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

/**
 * Finds the walkable tile nearest to the requested tile, scanning outward in
 * square rings (Chebyshev distance) up to `maxRadiusTiles`. Returns null when
 * no walkable tile exists within range — callers should skip the spawn.
 *
 * Quest systems place mobs at fixed offsets from landmarks (e.g. the circus
 * centre); those offsets can land inside tent/building footprints depending on
 * procedural generation, so every scripted spawn must be validated through
 * this helper.
 *
 * Runs the ring search twice: once demanding somewhere the occupant can move
 * (see {@link hasRoomToMove}), then again accepting any walkable tile at all.
 * The second pass exists so this can only ever return a *better* tile than it
 * used to, never nothing — a spawn suppressed because the map is tight is a
 * missing boss, which is worse than a cramped one.
 *
 * `isAcceptable` narrows the search further for callers that own a region as
 * well as a point — an arena encounter must not nudge a blocked spawn out past
 * its own boundary and into the wilderness.
 */
export function findNearbyWalkableTile(
  map: GameMap,
  tileX: number,
  tileY: number,
  maxRadiusTiles: number,
  isAcceptable?: (x: number, y: number) => boolean,
): { x: number; y: number } | null {
  const isPermitted = (x: number, y: number): boolean =>
    map.isWalkable(x, y) && (isAcceptable === undefined || isAcceptable(x, y));

  const roomy = searchRings(tileX, tileY, maxRadiusTiles, (x, y) => {
    return isPermitted(x, y) && hasRoomToMove(map, x, y);
  });
  if (roomy !== null) return roomy;

  return searchRings(tileX, tileY, maxRadiusTiles, isPermitted);
}

function searchRings(
  tileX: number,
  tileY: number,
  maxRadiusTiles: number,
  isUsable: (x: number, y: number) => boolean,
): { x: number; y: number } | null {
  if (isUsable(tileX, tileY)) return { x: tileX, y: tileY };

  for (let radius = 1; radius <= maxRadiusTiles; radius++) {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const onRing = Math.max(Math.abs(dx), Math.abs(dy)) === radius;
        if (!onRing) continue;
        const x = tileX + dx;
        const y = tileY + dy;
        if (isUsable(x, y)) return { x, y };
      }
    }
  }
  return null;
}
