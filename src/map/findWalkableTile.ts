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
  // Both axes read from the grid rather than one standing in for the other: a
  // building interior is 20x16 and a store 20x12, so a square bound taken from
  // the row count would call every column past it out of bounds — and the east
  // strip of every interior, where the stairs and the counters are, would look
  // walled off to the flood fill.
  const rows = map.structure.length;
  const columns = map.structure[0]?.length ?? rows;
  return hasOpenRegion((x, y) => map.isWalkable(x, y), columns, rows, tileX, tileY, minOpenTiles);
}

/**
 * {@link hasRoomToMove} over any walkability predicate and grid size, for callers
 * that hold a raw tile grid rather than a built map — the generator seats fixtures
 * before a `GameMap` exists, and must ask the same question the spawner will ask.
 */
export function hasOpenRegion(
  isWalkable: (x: number, y: number) => boolean,
  columns: number,
  rows: number,
  tileX: number,
  tileY: number,
  minOpenTiles = MIN_OPEN_TILES,
): boolean {
  if (!isWalkable(tileX, tileY)) return false;

  const seen = new Set<number>();
  // Keyed by arithmetic on the tile position rather than a string, because a
  // ring search calls this once per candidate tile. Only in-bounds tiles are
  // ever keyed, so the row stride cannot make two positions collide.
  const inBounds = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < columns && y < rows;

  const queue: Array<{ x: number; y: number }> = [{ x: tileX, y: tileY }];
  seen.add(tileY * columns + tileX);

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
      const key = y * columns + x;
      if (seen.has(key)) continue;
      seen.add(key);
      if (!isWalkable(x, y)) continue;
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
 * The second pass exists so a tight map yields a cramped tile rather than
 * nothing — a spawn suppressed because the map is tight is a missing boss,
 * which is worse than a cramped one.
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

/** How far from its landing an arriving party may be set down. */
const ARRIVAL_SEARCH_RADIUS_TILES = 4;

/**
 * How far from the leader, on either axis, the follower's walk to them is
 * traced. A whole building interior fits inside it from any tile, so indoors
 * the walk is never cut short; outdoors it keeps the trace to the
 * neighbourhood rather than flooding a whole floor.
 */
const FOLLOWER_WALK_BOUND_TILES = 16;

/** Where the two crawlers stand on arriving somewhere. */
export interface PartyArrivalTiles {
  /** The crawler being driven: the landing itself wherever it is open. */
  readonly leader: { x: number; y: number };
  /** The other crawler, beside the leader and able to walk to them. */
  readonly follower: { x: number; y: number };
}

/**
 * Where an arriving party is set down — walking into a room through its door
 * or off a stair, walking out of a building, or arriving on a floor: the
 * leader on the landing, the follower on the open tile nearest the one east
 * of it.
 *
 * Neither is taken on trust. A room's furniture is authored around its door,
 * and a candle stand or a pew one tile east of the landing is floor to the
 * layout but a prop to the player; outdoors the tile east of a doorstep can be
 * a wall, a tree or a fence. A crawler set down inside one cannot take a
 * single step, because each step is tested against the tile under the
 * crawler's centre after it, and for the first half-tile in every direction
 * that tile is still the obstacle.
 *
 * Both searches keep {@link findNearbyWalkableTile}'s two passes — room to move
 * first, bare floor second — and keep off stairwells, which would re-open the
 * climb the party just finished, and off building doors, which would walk the
 * party straight back in. The follower must also be able to walk to the
 * leader, or the nearest open tile could be the far side of a counter or a
 * wall.
 */
export function findPartyArrivalTiles(
  map: GameMap,
  landing: { readonly x: number; readonly y: number },
): PartyArrivalTiles {
  const doorKeys = new Set(
    map.buildingEntries.map((entry) => tileKeyIn(map, entry.doorTile.x, entry.doorTile.y)),
  );
  const isArrivalGround = (x: number, y: number): boolean =>
    !map.isStairwellTile(x, y) && !doorKeys.has(tileKeyIn(map, x, y));
  const leader =
    findNearbyWalkableTile(
      map,
      landing.x,
      landing.y,
      ARRIVAL_SEARCH_RADIUS_TILES,
      isArrivalGround,
    ) ?? landing;
  const withLeader = walkableRegionNear(map, leader, FOLLOWER_WALK_BOUND_TILES);
  const besideLeader = (x: number, y: number): boolean =>
    (x !== leader.x || y !== leader.y) &&
    isArrivalGround(x, y) &&
    withLeader.has(tileKeyIn(map, x, y));
  const follower =
    findNearbyWalkableTile(
      map,
      leader.x + 1,
      leader.y,
      ARRIVAL_SEARCH_RADIUS_TILES,
      besideLeader,
    ) ?? leader;
  return { leader: { x: leader.x, y: leader.y }, follower };
}

function tileKeyIn(map: GameMap, x: number, y: number): number {
  const columns = map.structure[0]?.length ?? map.structure.length;
  return y * columns + x;
}

/**
 * Every tile four-connected to `from` over walkable ground without straying
 * more than `boundTiles` from it on either axis.
 */
function walkableRegionNear(
  map: GameMap,
  from: { x: number; y: number },
  boundTiles: number,
): Set<number> {
  const region = new Set<number>();
  if (!map.isWalkable(from.x, from.y)) return region;
  const withinBound = (x: number, y: number): boolean =>
    Math.abs(x - from.x) <= boundTiles && Math.abs(y - from.y) <= boundTiles;
  region.add(tileKeyIn(map, from.x, from.y));
  const queue: Array<{ x: number; y: number }> = [{ x: from.x, y: from.y }];
  // The iterator re-reads `length`, so tiles pushed below are visited by this loop.
  for (const tile of queue) {
    for (const [dx, dy] of NEIGHBOUR_OFFSETS) {
      const x = tile.x + dx;
      const y = tile.y + dy;
      if (!withinBound(x, y) || !map.isWalkable(x, y)) continue;
      const key = tileKeyIn(map, x, y);
      if (region.has(key)) continue;
      region.add(key);
      queue.push({ x, y });
    }
  }
  return region;
}
