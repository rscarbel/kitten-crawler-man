/**
 * The shared vocabulary of the movement tactics — what a creature tells its
 * tactics about one AI frame, what it gets back, and the small geometric
 * questions every movement tactic asks of the floor.
 */

import type { GameMap } from '../../map/GameMap';
import type { Player } from '../../Player';
import type { Mob } from '../Mob';
import { isMarkedGround, lineCrossesMarkedGround } from './markedGround';

/** A world position in the same top-left convention as `Player.x` / `Player.y`. */
export interface TacticalPoint {
  readonly x: number;
  readonly y: number;
}

/**
 * Where a ranged or melee kiter wants to end up, given where it, its quarry and
 * the friend it is falling back on stand. A melee brawler backs toward the
 * friend; a ranged one would instead aim to put the friend between itself and
 * the player. The planner clamps whatever this returns to the kite's distance
 * cap and checks it is walkable, so an aim function only expresses intent.
 */
export type KiteAim = (
  self: TacticalPoint,
  target: TacticalPoint,
  helper: TacticalPoint,
  tileSize: number,
) => TacticalPoint;

/** Everything a movement tactic needs to know about one AI frame. */
export interface TacticalFrame {
  readonly self: Mob;
  readonly map: GameMap | null;
  readonly tileSize: number;
  readonly target: Player;
  /**
   * Where the creature believes its target is — its last sighting, which is
   * the live position while it can see it. The approach tactics steer by
   * this, as the creature's own chase does, so a mob that has lost sight of
   * the player does not flank a position it has no way of knowing.
   */
  readonly targetPoint: TacticalPoint;
  /**
   * How close the player must be before a kite answers them. A melee creature
   * passes its reach; a ranged one passes the distance inside which it would
   * rather give ground than shoot, since trading at arm's length is what its
   * kite is an answer to.
   */
  readonly attackRangePx: number;
  /**
   * Whether the creature could walk away this frame without abandoning
   * something already committed — a swing in progress or a blow about to land.
   * A tactic never interrupts one: that is the creature's own timing.
   */
  readonly canBreakOff: boolean;
  /** How this creature kites; see {@link KiteAim}. */
  readonly kiteAim: KiteAim;
  /**
   * How far from the target, in tiles, this creature stages a flank. Omitted,
   * the brawler's default `FLANK_STAGING_TILES`; a thrower passes its own
   * stand-off, so fanning out never pulls it inside the range it fights from.
   * Must stay clear of `FLANK_RELEASE_TILES`, the distance a committed flanker
   * lets go at, or a flanker would commit and release on the same frame.
   */
  readonly flankStagingTiles?: number;
  /**
   * Where a wounded creature regroups to, given the friend it regroups on.
   * Omitted, it walks up to the friend itself — right for a brawler, whose
   * friend is where the fighting is. A shooter passes an aim instead, since
   * its friend is usually the one trading blows with the player, and walking
   * up to it would carry the shooter into the melee it exists to stay out of.
   */
  readonly regroupAim?: KiteAim;
}

/** The movement tactics a creature can be steered by. */
export type TacticalBehaviour = 'flank' | 'kite' | 'regroup';

/**
 * Where a tactic wants the creature to walk this frame. The creature walks
 * there with its own pathing, at its own speed, and keeps its own facing.
 */
export interface TacticalMove {
  readonly behaviour: TacticalBehaviour;
  readonly x: number;
  readonly y: number;
  /** Stop this far short of the point. */
  readonly stopPx: number;
  /**
   * True when the creature must not fight this frame: it is falling back, not
   * approaching. A flank still attacks anything that walks into its reach.
   */
  readonly breaksOff: boolean;
}

/** Spacing, in tiles, of the samples taken along a planned line for marked ground. */
const MARKED_GROUND_SAMPLE_TILES = 0.5;
/**
 * Room, in tiles, kept between a planned move's worst case and the leash. A
 * move is only checked against its cap once a frame, so it can overshoot by one
 * frame's worth of walking or shove before it is stopped.
 */
const LEASH_SLACK_TILES = 1;

/**
 * Whether `mob` is in a fight with the party — it has drawn blood or been
 * wounded by one of the crawlers — and still has a target. Noticing is not
 * enough: `currentTarget` alone is set by proximity and by a packmate's shout.
 */
export function isEngagedInFight(mob: Mob): boolean {
  if (!mob.isAlive || mob.currentTarget === null) return false;
  return mob.hasStruckPlayer || mob.wasDamagedByParty;
}

/** Whether a straight line of sight runs between two bodies' centres. */
export function hasClearLine(
  map: GameMap | null,
  tileSize: number,
  from: TacticalPoint,
  to: TacticalPoint,
): boolean {
  if (map === null) return true;
  const half = tileSize / 2;
  return map.hasLineOfSight(from.x + half, from.y + half, to.x + half, to.y + half);
}

/**
 * Whether a straight walk between two bodies' centres crosses only walkable
 * tiles; `hasClearLine` sees over low props a body cannot pass.
 */
export function hasWalkableLine(
  map: GameMap | null,
  tileSize: number,
  from: TacticalPoint,
  to: TacticalPoint,
): boolean {
  if (map === null) return true;
  const half = tileSize / 2;
  return map.hasWalkableLine(from.x + half, from.y + half, to.x + half, to.y + half);
}

/**
 * Whether a mob could stand at `point`: walkable, not a stairwell (which
 * `isWalkable` admits but a mob's own collision refuses), and not marked ground.
 */
export function isStandable(map: GameMap | null, tileSize: number, point: TacticalPoint): boolean {
  if (isMarkedGround(point.x, point.y)) return false;
  if (map === null) return true;
  const tileX = Math.floor((point.x + tileSize / 2) / tileSize);
  const tileY = Math.floor((point.y + tileSize / 2) / tileSize);
  return map.isWalkable(tileX, tileY) && !map.isStairwellTile(tileX, tileY);
}

/**
 * Whether a straight walk from `from` to `to` is open: sight between them and
 * no marked ground along the way, so the mob's walk there is no longer than
 * the line and passes through nothing that hurts.
 */
export function isOpenWalk(
  map: GameMap | null,
  tileSize: number,
  from: TacticalPoint,
  to: TacticalPoint,
): boolean {
  if (!isStandable(map, tileSize, to)) return false;
  if (!hasWalkableLine(map, tileSize, from, to)) return false;
  return !lineCrossesMarkedGround(
    from.x,
    from.y,
    to.x,
    to.y,
    MARKED_GROUND_SAMPLE_TILES * tileSize,
  );
}

/**
 * Whether `mob` may walk up to `maxWalkPx` from where it stands without ever
 * leaving its leash, whatever route it takes.
 *
 * Measured by walked length, not by where the walk ends: however a route bends,
 * no point on it can be further from home than the start's distance plus the
 * length walked, so a walk capped at `maxWalkPx` that passes this test cannot
 * cross the leash. An unleashed mob always passes.
 */
export function walkStaysLeashed(mob: Mob, tileSize: number, maxWalkPx: number): boolean {
  const home = mob.homePoint;
  const radiusTiles = mob.leashRadiusTiles;
  if (home === undefined || radiusTiles === undefined) return true;
  const fromHome = Math.hypot(mob.x - home.x, mob.y - home.y);
  return fromHome + maxWalkPx + LEASH_SLACK_TILES * tileSize <= radiusTiles * tileSize;
}

/** Whether `mob` is currently outside its leash. Always false when unleashed. */
export function isOutsideLeash(mob: Mob, tileSize: number): boolean {
  const home = mob.homePoint;
  const radiusTiles = mob.leashRadiusTiles;
  if (home === undefined || radiusTiles === undefined) return false;
  return Math.hypot(mob.x - home.x, mob.y - home.y) > radiusTiles * tileSize;
}

export function distanceBetween(a: TacticalPoint, b: TacticalPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
