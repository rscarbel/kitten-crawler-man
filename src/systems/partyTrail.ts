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

/** A body the trail reads or places: top-left world position, the same frame of reference the crawlers use. */
export interface TrailBody {
  x: number;
  y: number;
}

/** A body the trail drives: placed, turned along the trail and marked as walking or not. */
export interface TrailFollowerBody extends TrailBody {
  isMoving: boolean;
  facingX: number;
  facingY: number;
}

export interface TrailPoint {
  readonly x: number;
  readonly y: number;
}

/**
 * The walkable stops between two bodies, in the same top-left frame, when the
 * trail has to start again; null when there is no way through.
 */
export type TrailRouter = (from: TrailBody, to: TrailBody) => readonly TrailPoint[] | null;

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

export class PartyTrail {
  /** Oldest first: `points[0]` is where the follower stands, the last point where the leader stands. */
  private points: TrailPoint[] = [];
  private leader: TrailBody | null = null;

  constructor(
    private readonly spacingPx: number,
    private readonly routeBetween: TrailRouter,
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
    const leaderStep = distance(head, leader);
    if (leaderStep > MOVE_EPSILON_PX) this.points.push({ x: leader.x, y: leader.y });

    const stretched = this.advanceFollower(leaderStep + TRAIL_CATCH_UP_PX);
    if (stretched === null) {
      follower.isMoving = false;
      return;
    }
    follower.x = stretched.at.x;
    follower.y = stretched.at.y;
    follower.facingX = stretched.dirX;
    follower.facingY = stretched.dirY;
    follower.isMoving = true;
  }

  /**
   * Starts the trail again after a body was put somewhere rather than walked
   * there. A straight line between them could cross a wall, so the trail is
   * laid along a walkable route instead; with no route the follower is stood
   * on the leader's own spot, the one place known to be open.
   */
  private restartFrom(leader: TrailBody, follower: TrailFollowerBody): void {
    follower.isMoving = false;
    const route = this.routeBetween(follower, leader);
    if (route === null) {
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
   * Drops every point it walks past. Null while the trail is no longer than
   * the spacing.
   */
  private advanceFollower(maxStep: number): { at: TrailPoint; dirX: number; dirY: number } | null {
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
      this.points = [at, ...this.points.slice(i)];
      return { at, dirX: (ahead.x - behind.x) / segment, dirY: (ahead.y - behind.y) / segment };
    }
    return null;
  }
}
