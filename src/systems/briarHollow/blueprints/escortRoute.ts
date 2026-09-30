/**
 * The road Midge is led along, from Merrit's pasture gate to Garrison Green's
 * cart gate, and the waypoints the escort's guidance hands out one at a time.
 *
 * Pointed straight at Wendell's pasture, the tracker arrow cuts across forest,
 * ruins and the town wall. The route is instead a cheapest walk over the tiles
 * Midge can actually step on, where a road tile costs a fraction of open
 * ground, so it follows the village street, the road to town and the town's
 * lanes. It is cut into waypoints short enough, and at every bend, that each
 * one can be walked to in a straight line from the one before: an arrow aimed
 * at the next waypoint never points through anything the party cannot cross.
 *
 * Planned once per map and remembered with it: the road never moves, and a
 * door visit rebuilds the quest but hands back the same `GameMap`.
 */

import { TILE_SIZE } from '../../../core/constants';
import { MinHeap } from '../../../core/MinHeap';
import type { GameMap } from '../../../map/GameMap';
import type { BriarHollowSite } from '../../../map/overworld/briarHollowSite';
import { HOLLOW_GATE } from '../../../map/tileTypes';
import { isPavedTileType } from '../../../map/town/tileGrid';
import type { TilePoint } from '../../../map/town/townPlan';
import { doorwaySpan } from '../../BuildingSystem';
import { tileCoordKey } from '../../../map/tileIndex';
import { garrisonGreen } from './garrisonGreen';

const TILE_CENTRE = 0.5;

/** A step along a road, lane or bridge. */
const ROAD_STEP_COST = 1;
/**
 * A step over open ground: dear enough that the route rides a winding road
 * rather than shortcutting a bend across the grass, but not forbidden, since
 * Merrit's gate and the pasture's cart gate stand a few tiles off the road.
 */
const OFF_ROAD_STEP_COST = 8;
/** A step through river water: the road's bridges are always the better way over. */
const WADE_STEP_COST = 30;
/**
 * Added for a tile with a blocked neighbour, so the route keeps to the middle
 * of a road rather than its shoulder, where the straight line to the next
 * waypoint would graze a fence post or a wall corner.
 */
const HUG_STEP_PENALTY = 2;
/**
 * Added for a road tile beside open ground, so on a road several tiles wide
 * the route, and the trail drawn along it, runs down the middle.
 */
const ROAD_EDGE_STEP_PENALTY = 1;

/** The four steps a walk between tiles is made of: Midge only ever crosses a shared edge. */
const ROUTE_STEPS: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/**
 * The furthest apart two waypoints stand, in tiles: close enough that the
 * next one is on screen, and far enough apart that the marker is not
 * underfoot the whole walk.
 */
export const ESCORT_WAYPOINT_MAX_SPACING_TILES = 10;
/**
 * How far the road may bend away from the straight line between two
 * waypoints before a bend needs a waypoint of its own, in tiles.
 */
const WAYPOINT_MAX_DEVIATION_TILES = 1.5;

/** One point on the escort's road the guidance hands the party in turn. */
export interface EscortWaypoint {
  readonly tile: TilePoint;
  /** Its place in {@link EscortRoute.tiles}. */
  readonly routeIndex: number;
}

export interface EscortRoute {
  /** Every tile of the walk, start to finish, each one step from the last. */
  readonly tiles: readonly TilePoint[];
  /** In walking order; the last one is the pasture's cart gate. */
  readonly waypoints: readonly EscortWaypoint[];
}

/**
 * Merrit's pasture gate: the lane tile just outside it, where the escort
 * begins and where a Midge scared home, rewound or loaded stands waiting.
 */
export function merritGateTile(site: BriarHollowSite): TilePoint | null {
  const pasture = site.pasture;
  if (pasture.fenceGates.length === 0) return null;
  const gate = pasture.fenceGates[0];
  const rect = pasture.rect;
  const outward = {
    x: gate.x === rect.x ? -1 : gate.x === rect.x + rect.w - 1 ? 1 : 0,
    y: gate.y === rect.y ? -1 : gate.y === rect.y + rect.h - 1 ? 1 : 0,
  };
  return { x: gate.x + outward.x, y: gate.y + outward.y };
}

/** Whether (x, y) is a road surface: a street, a track, a bridge deck or the village gate. */
export function isEscortRoadTile(gameMap: GameMap, x: number, y: number): boolean {
  const size = gameMap.gridSize;
  if (x < 0 || y < 0 || x >= size || y >= size) return false;
  const type = gameMap.structure[y][x].type;
  return isPavedTileType(type) || type === HOLLOW_GATE;
}

/** Every tile of every building's doorway: stepping on one takes the party indoors. */
function doorwayKeys(gameMap: GameMap): ReadonlySet<number> {
  const keys = new Set<number>();
  for (const entry of gameMap.buildingEntries) {
    const { x0, width } = doorwaySpan(entry);
    for (let x = x0; x < x0 + width; x++) keys.add(tileCoordKey(x, entry.doorTile.y));
  }
  return keys;
}

/**
 * Whether Midge can stand on (x, y) on the road: the tile rule her own steps
 * use (`Mob.moveWithCollision`, as a creature that is not hostile, so the
 * village gate lets her through), and never a doorway, which would carry the
 * party indoors mid-walk.
 */
export function isEscortStep(
  gameMap: GameMap,
  x: number,
  y: number,
  doorways: ReadonlySet<number> = doorwayKeys(gameMap),
): boolean {
  if (!gameMap.isWalkable(x, y) || gameMap.isStairwellTile(x, y)) return false;
  return !doorways.has(tileCoordKey(x, y));
}

function hasBlockedNeighbour(gameMap: GameMap, x: number, y: number): boolean {
  return ROUTE_STEPS.some(([dx, dy]) => !gameMap.isWalkable(x + dx, y + dy));
}

function hasOffRoadNeighbour(gameMap: GameMap, x: number, y: number): boolean {
  return ROUTE_STEPS.some(([dx, dy]) => !isEscortRoadTile(gameMap, x + dx, y + dy));
}

/**
 * The cheapest walk from `start` to any of `goals` over tiles Midge can step
 * on, roads cheap and open ground dear; null when none of them can be reached.
 */
export function planEscortWalk(
  gameMap: GameMap,
  start: TilePoint,
  goals: readonly TilePoint[],
): TilePoint[] | null {
  const size = gameMap.gridSize;
  const doorways = doorwayKeys(gameMap);
  const goalKeys = new Set(goals.map((goal) => goal.y * size + goal.x));
  if (goalKeys.size === 0 || !isEscortStep(gameMap, start.x, start.y, doorways)) return null;

  const stepCost = (x: number, y: number): number | null => {
    if (!isEscortStep(gameMap, x, y, doorways)) return null;
    const onRoad = isEscortRoadTile(gameMap, x, y);
    const base = gameMap.isWadeable(x, y)
      ? WADE_STEP_COST
      : onRoad
        ? ROAD_STEP_COST
        : OFF_ROAD_STEP_COST;
    const edge = onRoad && hasOffRoadNeighbour(gameMap, x, y) ? ROAD_EDGE_STEP_PENALTY : 0;
    const hug = hasBlockedNeighbour(gameMap, x, y) ? HUG_STEP_PENALTY : 0;
    return base + edge + hug;
  };
  // Admissible: no step is ever cheaper than a road step.
  const estimate = (x: number, y: number): number => {
    let nearestGoalSteps = Infinity;
    for (const goal of goals) {
      nearestGoalSteps = Math.min(nearestGoalSteps, Math.abs(goal.x - x) + Math.abs(goal.y - y));
    }
    return ROAD_STEP_COST * nearestGoalSteps;
  };

  const best = new Float64Array(size * size).fill(Infinity);
  const cameFrom = new Int32Array(size * size).fill(-1);
  const closed = new Uint8Array(size * size);
  const heap = new MinHeap(size);
  const startKey = start.y * size + start.x;
  best[startKey] = 0;
  heap.push(startKey, estimate(start.x, start.y));
  let reachedKey = -1;
  while (heap.size > 0) {
    const key = heap.pop();
    if (closed[key] === 1) continue;
    closed[key] = 1;
    if (goalKeys.has(key)) {
      reachedKey = key;
      break;
    }
    const x = key % size;
    const y = Math.floor(key / size);
    for (const [dx, dy] of ROUTE_STEPS) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
      const cost = stepCost(nx, ny);
      if (cost === null) continue;
      const nextKey = ny * size + nx;
      const total = best[key] + cost;
      if (total >= best[nextKey]) continue;
      best[nextKey] = total;
      cameFrom[nextKey] = key;
      heap.push(nextKey, total + estimate(nx, ny));
    }
  }
  if (reachedKey < 0) return null;
  const walk: TilePoint[] = [];
  for (let key = reachedKey; key >= 0; key = cameFrom[key]) {
    walk.push({ x: key % size, y: Math.floor(key / size) });
  }
  return walk.reverse();
}

function tileCentrePx(tile: TilePoint): { readonly x: number; readonly y: number } {
  return { x: (tile.x + TILE_CENTRE) * TILE_SIZE, y: (tile.y + TILE_CENTRE) * TILE_SIZE };
}

/** Whether Midge could walk straight from `from` to `to`: `hasWalkableLine`, centre to centre. */
export function isStraightWalk(gameMap: GameMap, from: TilePoint, to: TilePoint): boolean {
  const a = tileCentrePx(from);
  const b = tileCentrePx(to);
  return gameMap.hasWalkableLine(a.x, a.y, b.x, b.y);
}

/** Distance in tiles from `point` to the segment `a`–`b`. */
function distanceToSegment(point: TilePoint, a: TilePoint, b: TilePoint): number {
  const abX = b.x - a.x;
  const abY = b.y - a.y;
  const lengthSq = abX * abX + abY * abY;
  const along =
    lengthSq === 0
      ? 0
      : Math.max(0, Math.min(1, ((point.x - a.x) * abX + (point.y - a.y) * abY) / lengthSq));
  return Math.hypot(point.x - (a.x + abX * along), point.y - (a.y + abY * along));
}

/**
 * Whether the straight line from `walk[from]` to `walk[to]` stands for the
 * walk between them: short enough, walkable end to end, and never more than
 * {@link WAYPOINT_MAX_DEVIATION_TILES} off the road it replaces.
 */
function lineFollowsWalk(
  gameMap: GameMap,
  walk: readonly TilePoint[],
  from: number,
  to: number,
): boolean {
  const a = walk[from];
  const b = walk[to];
  if (Math.hypot(b.x - a.x, b.y - a.y) > ESCORT_WAYPOINT_MAX_SPACING_TILES) return false;
  for (let index = from + 1; index < to; index++) {
    if (distanceToSegment(walk[index], a, b) > WAYPOINT_MAX_DEVIATION_TILES) return false;
  }
  return isStraightWalk(gameMap, a, b);
}

/**
 * Cuts `walk` into waypoints: from each one, the furthest tile further along
 * that the straight line still stands for the road; the walk's last tile is
 * always the last waypoint.
 */
export function escortWaypoints(
  gameMap: GameMap,
  walk: readonly TilePoint[],
): readonly EscortWaypoint[] {
  const waypoints: EscortWaypoint[] = [];
  const last = walk.length - 1;
  let anchor = 0;
  while (anchor < last) {
    let reach = anchor + 1;
    while (reach < last && lineFollowsWalk(gameMap, walk, anchor, reach + 1)) reach++;
    waypoints.push({ tile: walk[reach], routeIndex: reach });
    anchor = reach;
  }
  return waypoints;
}

const routesByMap = new WeakMap<GameMap, EscortRoute | null>();

/**
 * The escort's road on `gameMap`, planned the first time it is asked for;
 * null on a map with no Garrison Green, or where it cannot be reached.
 */
export function escortRouteFor(gameMap: GameMap, site: BriarHollowSite): EscortRoute | null {
  const known = routesByMap.get(gameMap);
  if (known !== undefined) return known;
  const route = planEscortRoute(gameMap, site);
  routesByMap.set(gameMap, route);
  return route;
}

function planEscortRoute(gameMap: GameMap, site: BriarHollowSite): EscortRoute | null {
  const start = merritGateTile(site);
  const green = garrisonGreen(gameMap);
  if (start === null || green === null) return null;
  const walk = planEscortWalk(gameMap, start, green.gateTiles);
  if (walk === null || walk.length < 2) return null;
  return { tiles: walk, waypoints: escortWaypoints(gameMap, walk) };
}

// ── Progress along it ──────────────────────────────────────────────────────

/** Further than this off the road, in tiles, Midge is placed afresh on the route rather than moved along it. */
const OFF_ROUTE_TILES = 5;
/**
 * How far back along the route, in steps, Midge may drift without the
 * waypoint stepping back with her: a shuffle round an ambusher, not a trip home.
 */
const BACKTRACK_TOLERANCE_STEPS = 12;
/**
 * How far along the route, in steps, the party may count as having got
 * ahead of Midge: about as far as she follows before she stops and waits.
 */
const LEADER_LEAD_STEPS = 20;
/** A waypoint counts as reached once the party is this close to it, in tiles. */
export const ESCORT_WAYPOINT_ARRIVAL_TILES = 3;
/** How many waypoints past the current one the guide shows faintly. */
const WAYPOINTS_SHOWN_AHEAD = 2;

/** What the guide draws for the waypoint in hand. */
export interface EscortWaypointGuidance {
  readonly at: TilePoint;
  /** The next few waypoints after it, nearest first; empty at the last. */
  readonly ahead: readonly TilePoint[];
  /** The route's tiles from where the party has got to, through the waypoint after this one. */
  readonly trail: readonly TilePoint[];
}

interface NearestOnRoute {
  readonly index: number;
  readonly tiles: number;
}

/**
 * Which waypoint the escort is heading for. Moves forward as Midge and the
 * party get along the road and never back for a step or two of jostling;
 * when Midge is carried well back (scared home, or led back on purpose) or
 * led well off the road, it is picked afresh from where she now stands.
 */
export class EscortRouteProgress {
  /** The furthest route tile Midge has been counted at. */
  private midgeIndex = 0;
  /** The furthest route tile the party has been counted at, never far past Midge. */
  private leaderIndex = 0;
  private waypointIndex = 0;

  constructor(readonly route: EscortRoute) {}

  /** The route tile the escort has got to. */
  get progressIndex(): number {
    return Math.max(this.midgeIndex, this.leaderIndex);
  }

  /** Index into the route's waypoints of the one in hand; the waypoint count once the last is reached. */
  get currentWaypointIndex(): number {
    return this.waypointIndex;
  }

  get currentWaypoint(): EscortWaypoint | null {
    const waypoints = this.route.waypoints;
    return this.waypointIndex < waypoints.length ? waypoints[this.waypointIndex] : null;
  }

  /** Once per update: `midge` her tile, or null while she is not out; `leader` the steered crawler's. */
  update(midge: TilePoint | null, leader: TilePoint): void {
    const anchor = this.nearest(midge ?? leader);
    const drifted = this.midgeIndex - anchor.index;
    if (
      anchor.tiles > OFF_ROUTE_TILES ||
      anchor.index > this.midgeIndex ||
      drifted > BACKTRACK_TOLERANCE_STEPS
    ) {
      this.midgeIndex = anchor.index;
    }
    const led = this.nearest(leader);
    const leaderDrifted = this.leaderIndex - led.index;
    if (
      led.tiles <= OFF_ROUTE_TILES &&
      (led.index > this.leaderIndex || leaderDrifted > BACKTRACK_TOLERANCE_STEPS)
    ) {
      this.leaderIndex = led.index;
    }
    this.clampLeader();

    const waypoints = this.route.waypoints;
    let next = 0;
    while (next < waypoints.length && waypoints[next].routeIndex <= this.progressIndex) next++;
    while (next < waypoints.length && this.hasArrived(waypoints[next].tile, leader)) {
      this.leaderIndex = Math.max(this.leaderIndex, waypoints[next].routeIndex);
      next++;
    }
    this.clampLeader();
    this.waypointIndex = next;
  }

  /** The waypoint in hand, what lies past it, and the road to it; null once the last is reached. */
  guidance(): EscortWaypointGuidance | null {
    const waypoints = this.route.waypoints;
    if (this.waypointIndex >= waypoints.length) return null;
    const current = waypoints[this.waypointIndex];
    const ahead = waypoints
      .slice(this.waypointIndex + 1, this.waypointIndex + 1 + WAYPOINTS_SHOWN_AHEAD)
      .map((waypoint) => waypoint.tile);
    const nextIndex = this.waypointIndex + 1;
    const trailEnd =
      nextIndex < waypoints.length ? waypoints[nextIndex].routeIndex : current.routeIndex;
    const trail = this.route.tiles.slice(this.progressIndex, trailEnd + 1);
    return { at: current.tile, ahead, trail };
  }

  private clampLeader(): void {
    const furthest = this.midgeIndex + LEADER_LEAD_STEPS;
    this.leaderIndex = Math.max(this.midgeIndex, Math.min(this.leaderIndex, furthest));
  }

  private hasArrived(waypoint: TilePoint, leader: TilePoint): boolean {
    return (
      Math.hypot(waypoint.x - leader.x, waypoint.y - leader.y) <= ESCORT_WAYPOINT_ARRIVAL_TILES
    );
  }

  private nearest(tile: TilePoint): NearestOnRoute {
    const tiles = this.route.tiles;
    let index = 0;
    let bestSq = Infinity;
    for (let candidate = 0; candidate < tiles.length; candidate++) {
      const dx = tiles[candidate].x - tile.x;
      const dy = tiles[candidate].y - tile.y;
      const distSq = dx * dx + dy * dy;
      if (distSq < bestSq) {
        bestSq = distSq;
        index = candidate;
      }
    }
    return { index, tiles: Math.sqrt(bestSq) };
  }
}
