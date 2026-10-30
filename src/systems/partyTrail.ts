/**
 * The leader's breadcrumb trail for a follower that must stay on the route the
 * player chose: the follower stands exactly `spacing` pixels of walked distance
 * behind the leader, on a point the leader itself stood on.
 *
 * Every point on the trail is a position the leader occupied, so the follower
 * never cuts a corner and never stands anywhere the leader could not. It moves
 * only when the leader's walk stretches the trail past the spacing, so it
 * stops when the leader stops and never moves faster than the leader did.
 */

import type { Footing, MobilityClass } from '../map/mobility';
import { TILE_SIZE } from '../core/constants';
import type { GameMap } from '../map/GameMap';

/** A body the trail reads or places: top-left world position, the same frame of reference the crawlers use. */
export interface TrailBody {
  x: number;
  y: number;
  readonly mobility: MobilityClass;
}

/** A climber's hop or squeeze between footings, which carries her body itself once started. */
export interface TrailFooting {
  readonly isCrossing: boolean;
  crossInto(body: { x: number; y: number }, toTileX: number, toTileY: number): boolean;
}

/** A body the trail drives: placed, turned along the trail and marked as walking or not. */
export interface TrailFollowerBody extends TrailBody {
  isMoving: boolean;
  facingX: number;
  facingY: number;
  /** Her footing, for a climber; null for a body that keeps to the floor. */
  readonly climbing: TrailFooting | null;
}

export interface TrailPoint {
  readonly x: number;
  readonly y: number;
}

/** What the trail asks of the ground it is laid over. Points are top-left, as bodies are. */
export interface TrailGround {
  /**
   * The walkable stops between two bodies, for the trail starting again;
   * null when there is no way through for `from`'s class.
   */
  route(from: TrailBody, to: TrailBody): readonly TrailPoint[] | null;
  /** Whether a body of `mobility` may stand where a body at `at` stands. */
  canStand(at: TrailPoint, mobility: MobilityClass): boolean;
  /** What a climber stands on there. */
  footingAt(at: TrailPoint): Footing;
}

/** From a body's top-left to its tile's centre. */
const TILE_CENTRE = 0.5;
/** How far a restarted trail may route between the two bodies before the follower is stood on the leader instead. */
const TRAIL_ROUTE_MAX_TILES = 24;

function tileOf(at: TrailPoint): TrailPoint {
  return {
    x: Math.floor((at.x + TILE_SIZE * TILE_CENTRE) / TILE_SIZE),
    y: Math.floor((at.y + TILE_SIZE * TILE_CENTRE) / TILE_SIZE),
  };
}

/** The tile corners of a walkable path between two bodies on `map`, for a trail starting again. */
function routeTrailBetween(
  map: Pick<GameMap, 'findPath'>,
  from: TrailBody,
  to: TrailBody,
): readonly TrailPoint[] | null {
  const start = tileOf(from);
  const goal = tileOf(to);
  if (start.x === goal.x && start.y === goal.y) return [];
  const path = map.findPath(start.x, start.y, goal.x, goal.y, from.mobility, TRAIL_ROUTE_MAX_TILES);
  if (path.length === 0) return null;
  return path.map((tile) => ({ x: tile.x * TILE_SIZE, y: tile.y * TILE_SIZE }));
}

/** The ground of whichever map `map` names this tick; with no map, nowhere to route and nothing to stand on. */
export function trailGroundOn(map: () => GameMap | null): TrailGround {
  return {
    route: (from, to) => {
      const current = map();
      return current === null ? null : routeTrailBetween(current, from, to);
    },
    canStand: (at, mobility) => {
      const tile = tileOf(at);
      return map()?.isWalkable(tile.x, tile.y, mobility) ?? false;
    },
    footingAt: (at) => {
      const tile = tileOf(at);
      return map()?.footingAt(tile.x, tile.y) ?? 'floor';
    },
  };
}

/**
 * How far behind the leader, along the leader's own trail, a follower walks
 * wherever the route the player chose has to decide every body's ground (the
 * prison's lights, the flooded pump room's shark). One tile keeps the
 * follower exactly where the leader stood one step ago.
 */
export const PARTY_TRAIL_SPACING_TILES = 1;

/** Below this the leader is taken to be standing still, and no breadcrumb is laid. */
const MOVE_EPSILON_PX = 0.01;

/**
 * Further than this in one tick, the leader or the follower was put somewhere
 * rather than walked there (a capture, a reset), and the trail starts again.
 */
export const TRAIL_TELEPORT_PX = 24;

/**
 * How much faster than the leader the follower may close a gap, in pixels per
 * tick. Only a restarted trail ever has a gap to close: on a stretched trail
 * the follower moves exactly as far as the leader did.
 */
const TRAIL_CATCH_UP_PX = 1.5;

function distance(a: TrailPoint, b: TrailPoint): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/**
 * Every follower keeps to ground its own class may stand on: where the leader
 * goes where the follower cannot (a cat up onto a shelf ahead of a walker),
 * the follower waits at the last point it could stand on and the trail beyond
 * is dropped, and once the leader is back on ground both share, the trail is
 * laid again along the follower's own route. A climber following across a
 * footing edge hops or squeezes across it rather than sliding.
 */
export class PartyTrail {
  /** Oldest first: `points[0]` is where the follower stands, the last point where the leader stands. */
  private points: TrailPoint[] = [];
  private leader: TrailBody | null = null;
  /** The follower is waiting where it stands for the leader to come back to ground it can share. */
  private waiting = false;

  constructor(
    private readonly spacingPx: number,
    private readonly ground: TrailGround,
  ) {}

  /** The trail as it stands, follower end first. */
  get trailPoints(): readonly TrailPoint[] {
    return this.points;
  }

  get spacing(): number {
    return this.spacingPx;
  }

  /** Forgets the trail; the next tick starts it again from wherever both bodies stand. */
  clear(): void {
    this.points = [];
    this.leader = null;
    this.waiting = false;
  }

  /**
   * Advances the follower along the leader's trail for one tick.
   *
   * A change of leader (the player switched crawlers) turns the trail round:
   * the new leader already stands on it and the old leader is at its far end,
   * so the new follower walks back along the same route.
   */
  tick(leader: TrailBody, follower: TrailFollowerBody): void {
    if (this.leader !== null && this.leader !== leader && this.leader === follower) {
      this.points.reverse();
    }
    this.leader = leader;
    if (follower.climbing?.isCrossing === true) {
      this.layLeaderPoint(leader);
      follower.isMoving = false;
      return;
    }
    if (this.waiting) {
      follower.isMoving = false;
      if (!this.ground.canStand(leader, follower.mobility)) return;
      this.waiting = false;
      this.restartFrom(leader, follower);
      return;
    }
    const started = this.points.length > 0;
    const head = started ? this.points[this.points.length - 1] : leader;
    const tail = started ? this.points[0] : follower;
    const restart =
      !started ||
      distance(head, leader) > TRAIL_TELEPORT_PX ||
      distance(tail, follower) > TRAIL_TELEPORT_PX;
    if (restart) {
      this.restartFrom(leader, follower);
      return;
    }
    const leaderStep = this.layLeaderPoint(leader);

    const stretched = this.advanceFollower(leaderStep + TRAIL_CATCH_UP_PX);
    if (stretched === null) {
      follower.isMoving = false;
      return;
    }
    if (!this.ground.canStand(stretched.at, follower.mobility)) {
      this.waitWhereStanding(follower);
      return;
    }
    if (this.crossesFooting(follower, stretched)) return;
    this.points = stretched.rest;
    follower.x = stretched.at.x;
    follower.y = stretched.at.y;
    follower.facingX = stretched.dirX;
    follower.facingY = stretched.dirY;
    follower.isMoving = true;
  }

  /** Lays the leader's spot on the trail when it has moved; returns how far it moved. */
  private layLeaderPoint(leader: TrailBody): number {
    const head = this.points.length > 0 ? this.points[this.points.length - 1] : leader;
    const leaderStep = distance(head, leader);
    if (leaderStep > MOVE_EPSILON_PX) this.points.push({ x: leader.x, y: leader.y });
    return leaderStep;
  }

  private waitWhereStanding(follower: TrailFollowerBody): void {
    follower.isMoving = false;
    this.points = [{ x: follower.x, y: follower.y }];
    this.waiting = true;
  }

  /**
   * Starts a climber's hop or squeeze when the trail's next point stands on
   * another footing from hers. Her footing then carries her to the next tile,
   * so the trail from there on starts at that tile. True when one started.
   */
  private crossesFooting(
    follower: TrailFollowerBody,
    stretched: { readonly at: TrailPoint; readonly rest: TrailPoint[] },
  ): boolean {
    const climbing = follower.climbing;
    if (climbing === null) return false;
    if (this.ground.footingAt(stretched.at) === this.ground.footingAt(follower)) return false;
    const to = tileOf(stretched.at);
    if (!climbing.crossInto(follower, to.x, to.y)) return false;
    const landing = { x: to.x * TILE_SIZE, y: to.y * TILE_SIZE };
    this.points = [landing, ...stretched.rest.slice(1)];
    follower.isMoving = false;
    return true;
  }

  /**
   * Starts the trail again after a body was put somewhere rather than walked
   * there. A straight line between them could cross a wall, so the trail is
   * laid along a walkable route instead; with no route the follower is stood
   * on the leader's own spot, the one place known to be open, unless that is
   * ground the follower cannot stand on, and it waits where it is instead.
   */
  private restartFrom(leader: TrailBody, follower: TrailFollowerBody): void {
    follower.isMoving = false;
    const route = this.ground.route(follower, leader);
    if (route === null) {
      if (!this.ground.canStand(leader, follower.mobility)) {
        this.waitWhereStanding(follower);
        return;
      }
      follower.x = leader.x;
      follower.y = leader.y;
      this.points = [{ x: leader.x, y: leader.y }];
      return;
    }
    this.points = [{ x: follower.x, y: follower.y }, ...route, { x: leader.x, y: leader.y }];
  }

  /**
   * Moves the follower forward along the trail by what the trail is longer
   * than the spacing, but never by more than `maxStep` in one tick: once the
   * trail is stretched that is exactly the leader's own step, and after a
   * restart it lets the follower walk the new route rather than leap along it.
   * Returns the trail as it would stand after the step (`rest`), for the
   * caller to keep once the follower may take it. Null while the trail is no
   * longer than the spacing.
   */
  private advanceFollower(
    maxStep: number,
  ): { at: TrailPoint; rest: TrailPoint[]; dirX: number; dirY: number } | null {
    let length = 0;
    for (let i = 1; i < this.points.length; i++) {
      length += distance(this.points[i - 1], this.points[i]);
    }
    const owed = length - this.spacingPx;
    if (owed <= MOVE_EPSILON_PX) return null;
    let remaining = Math.min(owed, maxStep);
    for (let i = 1; i < this.points.length; i++) {
      const behind = this.points[i - 1];
      const ahead = this.points[i];
      const segment = distance(behind, ahead);
      if (segment <= MOVE_EPSILON_PX) continue;
      if (segment < remaining) {
        remaining -= segment;
        continue;
      }
      const share = remaining / segment;
      const at = {
        x: behind.x + (ahead.x - behind.x) * share,
        y: behind.y + (ahead.y - behind.y) * share,
      };
      const rest = [at, ...this.points.slice(i)];
      return {
        at,
        rest,
        dirX: (ahead.x - behind.x) / segment,
        dirY: (ahead.y - behind.y) / segment,
      };
    }
    return null;
  }
}
