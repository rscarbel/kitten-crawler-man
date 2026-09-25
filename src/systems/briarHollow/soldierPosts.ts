/**
 * Where Briar Hollow's militia stand and walk: each soldier's post, their
 * battle post for the siege, Sedge's beat along the east wall, and the patrol
 * routes worked out when a crawler orders one.
 *
 * Pure geometry over the map and the site, so `SoldierSystem` and the gate
 * that checks it ask exactly the same questions. Every route is checked
 * walkable, leg by leg, with the same friendly A* a soldier walks it by, and
 * stored once built — a route the soldier could not actually take is never
 * handed to it.
 */

import type { GameMap } from '../../map/GameMap';
import type {
  AssaultLane,
  AssaultLaneId,
  BriarHollowSite,
} from '../../map/overworld/briarHollowSite';
import { rectCentre, rectContains } from '../../map/overworld/briarHollowSite';
import type { TilePoint, TileRect } from '../../map/town/townPlan';
import { findNearbyWalkableTile } from '../../map/findWalkableTile';
import { RATKIN_SOLDIER_IDS, type RatkinSoldierId } from '../../sprites/art/ratkin/cast';
import { normalize } from '../../utils';

/** Within this many tiles of the palisade, a patrol runs along the inside of the wall. */
export const PATROL_NEAR_WALL_TILES = 6;
/** How many ring tiles either side of the soldier a wall patrol reaches: 14 tiles of wall end to end. */
const PATROL_ARC_HALF_TILES = 7;
/** Sedge's beat at his post is a shorter stretch of the same wall walk. */
const BEAT_ARC_HALF_TILES = 4;
/** Ring tiles between one waypoint of a wall walk and the next. */
const ARC_WAYPOINT_SPACING = 3;
/** Away from the wall, a patrol is a loop through four points this far around where it was ordered. */
export const PATROL_LOOP_RADIUS_TILES = 5;
/** How far from each loop point to look for walkable ground when the point itself is not. */
const LOOP_POINT_SEARCH_TILES = 2;
/** How far to look for a free, walkable tile to stand a post on. */
const POST_SEARCH_TILES = 3;
/** Ring tiles between two soldiers sharing a battle post's stretch of wall. */
const BATTLE_POST_SPREAD_TILES = 3;
/** A route needs at least this many waypoints to be a walk rather than a stand. */
const MIN_ROUTE_WAYPOINTS = 2;
/** Path search reach for a route leg: generous, since a leg never leaves the village's surroundings. */
const ROUTE_LEG_BUDGET_TILES = 60;

/** Which side of the village each soldier defends when the siege comes. */
const BATTLE_LANES: Readonly<Record<RatkinSoldierId, AssaultLane['id']>> = {
  hobb: 'south',
  marta: 'south',
  sedge: 'east',
  pru: 'east',
};

/** Where one soldier stands, and which way they look while standing there. */
export interface SoldierStation {
  readonly tile: TilePoint;
  /** A unit vector pointing away from the village centre. */
  readonly outward: { readonly x: number; readonly y: number };
}

export interface SoldierPosts {
  readonly post: Readonly<Record<RatkinSoldierId, SoldierStation>>;
  readonly battlePost: Readonly<Record<RatkinSoldierId, SoldierStation>>;
  /**
   * Every soldier's battle post when the whole assault comes from one side:
   * the four of them spread along the inside of that wall, facing the lane.
   */
  readonly battlePostByLane: Readonly<
    Record<AssaultLaneId, Readonly<Record<RatkinSoldierId, SoldierStation>>>
  >;
  /** Sedge's walk along the east palisade while at his post. */
  readonly sedgeBeat: readonly TilePoint[];
}

/** Tile distance from a tile to the nearest tile of a rectangle; 0 inside it. */
export function tilesOutsideRect(rect: TileRect, tileX: number, tileY: number): number {
  const dx = Math.max(rect.x - tileX, 0, tileX - (rect.x + rect.w - 1));
  const dy = Math.max(rect.y - tileY, 0, tileY - (rect.y + rect.h - 1));
  return Math.hypot(dx, dy);
}

function key(tile: TilePoint): string {
  return `${tile.x},${tile.y}`;
}

function outwardFrom(site: BriarHollowSite, tile: TilePoint): { x: number; y: number } {
  const dx = tile.x - site.centre.x;
  const dy = tile.y - site.centre.y;
  if (dx === 0 && dy === 0) return { x: 0, y: 1 };
  return normalize(dx, dy);
}

/** The ring index of the palisade tile nearest a point. */
function nearestRingIndex(site: BriarHollowSite, x: number, y: number): number {
  let best = 0;
  let bestDistance = Infinity;
  site.palisadePath.forEach((tile, index) => {
    const distance = Math.hypot(tile.x - x, tile.y - y);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = index;
    }
  });
  return best;
}

/** The distance from a tile to the nearest palisade tile. */
export function tilesFromPalisade(site: BriarHollowSite, tile: TilePoint): number {
  if (site.palisadePath.length === 0) return Infinity;
  const ring = site.palisadePath[nearestRingIndex(site, tile.x, tile.y)];
  return Math.hypot(ring.x - tile.x, ring.y - tile.y);
}

/**
 * The walkable tile just inside the palisade beside ring tile `ringIndex`:
 * of its eight neighbours, the one nearest the village centre that is inside
 * the village and walkable.
 */
function innerTileAt(gameMap: GameMap, site: BriarHollowSite, ringIndex: number): TilePoint | null {
  if (ringIndex < 0 || ringIndex >= site.palisadePath.length) return null;
  const ring = site.palisadePath[ringIndex];
  const neighbours: TilePoint[] = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      neighbours.push({ x: ring.x + dx, y: ring.y + dy });
    }
  }
  neighbours.sort(
    (a, b) =>
      Math.hypot(a.x - site.centre.x, a.y - site.centre.y) -
      Math.hypot(b.x - site.centre.x, b.y - site.centre.y),
  );
  return (
    neighbours.find(
      (tile) => rectContains(site.interior, tile.x, tile.y) && gameMap.isWalkable(tile.x, tile.y),
    ) ?? null
  );
}

/** Whether a soldier can walk from one tile to another, by the friendly A* it really walks by. */
export function canWalkBetween(gameMap: GameMap, from: TilePoint, to: TilePoint): boolean {
  if (from.x === to.x && from.y === to.y) return gameMap.isWalkable(to.x, to.y);
  return gameMap.findPath(from.x, from.y, to.x, to.y, ROUTE_LEG_BUDGET_TILES, false).length > 0;
}

/** Whether every leg of a looping route, including the last back to the first, can be walked. */
export function routeIsWalkable(gameMap: GameMap, route: readonly TilePoint[]): boolean {
  if (route.length < MIN_ROUTE_WAYPOINTS) return false;
  return route.every(
    (tile, index) =>
      gameMap.isWalkable(tile.x, tile.y) &&
      canWalkBetween(gameMap, tile, route[(index + 1) % route.length]),
  );
}

/**
 * Keeps only the waypoints a walker starting at `from` can reach in order,
 * and drops a repeat of the one before.
 */
function reachableInOrder(
  gameMap: GameMap,
  from: TilePoint,
  waypoints: readonly TilePoint[],
): TilePoint[] {
  const kept: TilePoint[] = [];
  let last = from;
  let previous: TilePoint | null = null;
  for (const tile of waypoints) {
    if (previous?.x === tile.x && previous.y === tile.y) continue;
    if (!canWalkBetween(gameMap, last, tile)) continue;
    kept.push(tile);
    last = tile;
    previous = tile;
  }
  return kept;
}

/**
 * A walk up and back along the inside of the palisade, centred on the ring
 * tile nearest `around`, reaching `halfTiles` along the wall each way. The
 * window slides rather than shrinks where it meets the gate, so the walk is
 * as long beside the gate as anywhere else.
 */
function wallWalk(
  gameMap: GameMap,
  site: BriarHollowSite,
  around: TilePoint,
  halfTiles: number,
): TilePoint[] | null {
  const ringLength = site.palisadePath.length;
  if (ringLength === 0) return null;
  const centreIndex = nearestRingIndex(site, around.x, around.y);
  const span = Math.min(halfTiles * 2, ringLength - 1);
  const first = Math.max(0, Math.min(centreIndex - halfTiles, ringLength - 1 - span));
  const outbound: TilePoint[] = [];
  for (let step = 0; step <= span; step += ARC_WAYPOINT_SPACING) {
    const inner = innerTileAt(gameMap, site, first + step);
    if (inner !== null) outbound.push(inner);
  }
  const lastInner = innerTileAt(gameMap, site, first + span);
  const lastPicked = outbound.length > 0 ? outbound[outbound.length - 1] : null;
  if (lastInner !== null && (lastPicked === null || key(lastPicked) !== key(lastInner))) {
    outbound.push(lastInner);
  }
  if (outbound.length === 0) return null;
  const start = outbound[0];
  const reachable = reachableInOrder(gameMap, start, outbound);
  if (reachable.length < MIN_ROUTE_WAYPOINTS) return null;
  // Out along the wall and back again, without standing twice on either end.
  const back = reachable.slice(1, -1).reverse();
  return [...reachable, ...back];
}

/** A loop through four points around `centre`, each on walkable ground a walker there can reach. */
function loopAround(gameMap: GameMap, centre: TilePoint): TilePoint[] | null {
  const offsets: readonly TilePoint[] = [
    { x: 0, y: -PATROL_LOOP_RADIUS_TILES },
    { x: PATROL_LOOP_RADIUS_TILES, y: 0 },
    { x: 0, y: PATROL_LOOP_RADIUS_TILES },
    { x: -PATROL_LOOP_RADIUS_TILES, y: 0 },
  ];
  const points: TilePoint[] = [];
  for (const offset of offsets) {
    const spot = findNearbyWalkableTile(
      gameMap,
      centre.x + offset.x,
      centre.y + offset.y,
      LOOP_POINT_SEARCH_TILES,
    );
    if (spot !== null) points.push(spot);
  }
  const reachable = reachableInOrder(gameMap, centre, points);
  return reachable.length >= MIN_ROUTE_WAYPOINTS ? reachable : null;
}

/**
 * The patrol a soldier standing on `from` is given: a walk along the inside
 * of the palisade when they are in the village and near it, otherwise a loop
 * around where they stand. Null when neither can be walked end to end.
 */
export function buildPatrolRoute(
  gameMap: GameMap,
  site: BriarHollowSite,
  from: TilePoint,
): TilePoint[] | null {
  const insideVillage = rectContains(site.interior, from.x, from.y);
  const nearWall = tilesFromPalisade(site, from) <= PATROL_NEAR_WALL_TILES;
  const route =
    insideVillage && nearWall
      ? (wallWalk(gameMap, site, from, PATROL_ARC_HALF_TILES) ?? loopAround(gameMap, from))
      : loopAround(gameMap, from);
  return route !== null && routeIsWalkable(gameMap, route) ? route : null;
}

/** A free walkable tile at or near `wanted`, never one already taken. */
function claimSpot(gameMap: GameMap, wanted: TilePoint, taken: Set<string>): TilePoint {
  const spot =
    findNearbyWalkableTile(gameMap, wanted.x, wanted.y, POST_SEARCH_TILES, (x, y) => {
      return !taken.has(`${x},${y}`);
    }) ?? wanted;
  taken.add(key(spot));
  return spot;
}

/** The tile inside the wall nearest a point, for a post on the wall walk. */
function wallPost(
  gameMap: GameMap,
  site: BriarHollowSite,
  x: number,
  y: number,
  ringOffset = 0,
): TilePoint {
  const ringLength = site.palisadePath.length;
  const index = Math.max(0, Math.min(ringLength - 1, nearestRingIndex(site, x, y) + ringOffset));
  return innerTileAt(gameMap, site, index) ?? rectCentre(site.interior);
}

/**
 * Every soldier's post and battle post, worked out from the site:
 *
 * - Hobb at the gate, inside;
 * - Sedge on the east wall walk, with a short beat along it;
 * - Marta in the square;
 * - Pru on the lumber yard's side of the wall;
 *
 * and, for the siege, a tile just inside the wall facing the lane each
 * soldier defends — and, per lane, all four spread along that lane's wall.
 */
export function computeSoldierPosts(gameMap: GameMap, site: BriarHollowSite): SoldierPosts {
  const taken = new Set<string>();
  const bounds = site.palisadeBounds;
  const eastWall = wallPost(gameMap, site, bounds.x + bounds.w - 1, site.centre.y);
  const lumberYard = rectCentre(site.lumberYard.rect);
  const lumberWall = wallPost(gameMap, site, bounds.x, lumberYard.y);
  const squareAnchor = site.villagerAnchors.square[0] ?? rectCentre(site.square.rect);
  const wanted: Readonly<Record<RatkinSoldierId, TilePoint>> = {
    hobb: site.gate.inside,
    sedge: eastWall,
    marta: squareAnchor,
    pru: lumberWall,
  };
  const station = (tile: TilePoint): SoldierStation => ({
    tile,
    outward: outwardFrom(site, tile),
  });
  const post = {
    hobb: station(claimSpot(gameMap, wanted.hobb, taken)),
    sedge: station(claimSpot(gameMap, wanted.sedge, taken)),
    marta: station(claimSpot(gameMap, wanted.marta, taken)),
    pru: station(claimSpot(gameMap, wanted.pru, taken)),
  };

  const battleTaken = new Set<string>();
  const perLaneCount = new Map<AssaultLane['id'], number>();
  const battleStation = (id: RatkinSoldierId): SoldierStation => {
    const laneId = BATTLE_LANES[id];
    const lane = site.assaultLanes.find((candidate) => candidate.id === laneId);
    if (lane === undefined) return post[id];
    const turn = perLaneCount.get(laneId) ?? 0;
    perLaneCount.set(laneId, turn + 1);
    const side = turn % 2 === 0 ? 1 : -1;
    const offset = side * Math.ceil(turn / 2) * BATTLE_POST_SPREAD_TILES;
    const tile = wallPost(gameMap, site, lane.approach.x, lane.approach.y, offset);
    return station(claimSpot(gameMap, tile, battleTaken));
  };
  const battlePost: Record<RatkinSoldierId, SoldierStation> = {
    hobb: post.hobb,
    sedge: post.sedge,
    marta: post.marta,
    pru: post.pru,
  };
  for (const id of RATKIN_SOLDIER_IDS) battlePost[id] = battleStation(id);

  const laneStations = (laneId: AssaultLaneId): Record<RatkinSoldierId, SoldierStation> => {
    const lane = site.assaultLanes.find((candidate) => candidate.id === laneId);
    const stations: Record<RatkinSoldierId, SoldierStation> = { ...battlePost };
    if (lane === undefined) return stations;
    const laneTaken = new Set<string>();
    RATKIN_SOLDIER_IDS.forEach((id, turn) => {
      const side = turn % 2 === 0 ? 1 : -1;
      const offset = side * Math.ceil(turn / 2) * BATTLE_POST_SPREAD_TILES;
      const tile = wallPost(gameMap, site, lane.approach.x, lane.approach.y, offset);
      stations[id] = station(claimSpot(gameMap, tile, laneTaken));
    });
    return stations;
  };
  const battlePostByLane: Record<AssaultLaneId, Record<RatkinSoldierId, SoldierStation>> = {
    north: laneStations('north'),
    south: laneStations('south'),
    east: laneStations('east'),
    west: laneStations('west'),
  };

  const sedgeBeat = wallWalk(gameMap, site, post.sedge.tile, BEAT_ARC_HALF_TILES) ?? [
    post.sedge.tile,
  ];
  return { post, battlePost, battlePostByLane, sedgeBeat };
}
