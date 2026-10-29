/**
 * The rules for the tentacles that rise beside the flooded pump room's rafts,
 * the pumps' rafts among them: how far out one may rise, what its slam covers, the size a
 * platform must be for that slam to be dodgeable, and each raft tentacle's
 * life. Pure, so the layout, the runtime and the gate read the same rules.
 */

import { PLAYER_SPEED, TILE_SIZE } from '../../../core/constants';
import { MIN_STAT_VALUE } from '../../../core/party/crawlerFormulas';
import { HUMAN_ARM_REACH_TILES } from '../../../core/items/equipment/weapons';
import { ITEM_DEF } from '../../../core/items/defs/ItemDefs';
import { missileRangeTiles } from '../../../abilities/magicMissile';
import type { TilePoint, TileRect } from '../bossRoomLayout';
import { distanceToRect, rectContainsTile, type TileVec } from './platforms';

/** The level a cat who has only just learned Magic Missile casts it at. */
const FIRST_MISSILE_LEVEL = 1;

/** From a tile's corner to its centre. */
const HALF_TILE = 0.5;
const HALF = 0.5;

/**
 * The furthest the human crawler's swing reaches with any weapon in the game,
 * in tiles from his centre: his bare arm, or the longest reach in `ITEM_DEF`.
 */
const HUMAN_LONGEST_REACH_TILES = Object.values(ITEM_DEF).reduce(
  (longest, def) =>
    def.weapon?.delivery === 'melee' ? Math.max(longest, def.weapon.reachTiles) : longest,
  HUMAN_ARM_REACH_TILES,
);

/**
 * How far the weakest possible Magic Missile flies, in tiles from the cat's
 * centre: the first level of the spell at the lowest Magic a crawler can have.
 */
const FIRST_MISSILE_RANGE_TILES = missileRangeTiles(MIN_STAT_VALUE, FIRST_MISSILE_LEVEL);

/**
 * Whether a tentacle `distanceTiles` from the nearest point a crawler can
 * stand is out of every swing and inside the weakest missile's flight: the
 * tentacle only the cat's spell (or another ranged attack) can kill.
 *
 * Measured from where a crawler's centre can be, which runs right up to a
 * platform's edge, not from the middle of its edge tiles.
 */
function isRangedOnlyDistance(distanceTiles: number): boolean {
  return distanceTiles > HUMAN_LONGEST_REACH_TILES && distanceTiles <= FIRST_MISSILE_RANGE_TILES;
}

/**
 * How far out from a platform's edge row, in whole tiles, a ranged-only
 * tentacle's tile sits: the nearest whole step whose centre is past every
 * swing from the platform's edge. A crawler at the edge stands half a tile
 * nearer than the edge row's centres.
 */
export const RANGED_ONLY_TENTACLE_OFFSET_TILES =
  Math.floor(HUMAN_LONGEST_REACH_TILES + HALF_TILE) + 1;

/** Where a tentacle's centre is when it stands on `tile`. */
export function tentacleCentre(tile: TilePoint): TileVec {
  return { x: tile.x + HALF_TILE, y: tile.y + HALF_TILE };
}

/** Whether a tentacle on `tile` is ranged-only from every platform in `platforms`. */
export function isRangedOnlyFromAll(tile: TilePoint, platforms: readonly TileRect[]): boolean {
  const centre = tentacleCentre(tile);
  const nearest = Math.min(...platforms.map((rect) => distanceToRect(centre, rect)));
  return isRangedOnlyDistance(nearest);
}

// ── The slam ─────────────────────────────────────────────────────────────────

/**
 * The largest slam footprint a tentacle brings down, in tiles on a side: as
 * big as a telegraph's walk lets a crawler standing in its far corner get out.
 */
const SLAM_FOOTPRINT_MAX_TILES = 2;

/**
 * How long a raft or pump tentacle's red footprint shows before the slam
 * lands: comfortably over the locked-telegraph floor in
 * `docs/difficulty-fairness-rules.md`.
 */
export const RAFT_SLAM_TELEGRAPH_FRAMES = 36;

/**
 * How far a raft or pump tentacle's slam reaches, in tiles from its centre to
 * the nearest tile of its footprint: as far as the weakest missile flies, so a
 * tentacle that can hit a crawler is always one the cat can hit back.
 */
const RAFT_SLAM_REACH_TILES = FIRST_MISSILE_RANGE_TILES;

/** How far a crawler walks on dry planks in the time a slam's footprint shows. */
const SLAM_DODGE_TILES = (RAFT_SLAM_TELEGRAPH_FRAMES * PLAYER_SPEED) / TILE_SIZE;

/**
 * A slam's footprint side on a platform: the largest there is, but always a
 * tile short of the platform's shorter side, so a strip of it is never hit.
 */
function slamFootprintSideTiles(standable: TileRect): number {
  return Math.min(SLAM_FOOTPRINT_MAX_TILES, Math.min(standable.w, standable.h) - 1);
}

/**
 * The footprint a tentacle at `tentacle` slams down on a crawler standing on
 * `target` of `standable`: the square of {@link slamFootprintSideTiles} round
 * them, pushed back inside the platform. Null when the crawler stands beyond
 * the slam's reach.
 */
export function chooseSlamFootprint(
  standable: TileRect,
  tentacle: TileVec,
  target: TilePoint,
): TileRect | null {
  const side = slamFootprintSideTiles(standable);
  const tilesBeforeTarget = Math.floor((side - 1) * HALF);
  const x = Math.min(
    standable.x + standable.w - side,
    Math.max(standable.x, target.x - tilesBeforeTarget),
  );
  const y = Math.min(
    standable.y + standable.h - side,
    Math.max(standable.y, target.y - tilesBeforeTarget),
  );
  const footprint = { x, y, w: side, h: side };
  return distanceToRect(tentacle, footprint) <= RAFT_SLAM_REACH_TILES ? footprint : null;
}

/** Steps between tiles counted the way a crawler walks them: diagonals cost the diagonal. */
function octileDistance(ax: number, ay: number, bx: number, by: number): number {
  const dx = Math.abs(ax - bx);
  const dy = Math.abs(ay - by);
  return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy);
}

/**
 * Why `standable` is too small for its tentacle's slam to be fair, or null
 * when it is big enough: the footprint never spans the shorter side, and
 * for every footprint the slam could choose, every tile a crawler can stand
 * on is within a telegraph's walk of a standable tile the footprint misses.
 *
 * `blocked` lists tiles inside the rectangle nobody stands on (a pump).
 */
export function slamSafetyViolation(
  standable: TileRect,
  blocked: readonly TilePoint[],
): string | null {
  const side = slamFootprintSideTiles(standable);
  if (side < 1) return 'too small for any footprint';
  if (side >= Math.min(standable.w, standable.h)) {
    return `a ${side}-tile footprint spans the shorter side`;
  }
  const isBlocked = (x: number, y: number): boolean => blocked.some((t) => t.x === x && t.y === y);
  const tiles: TilePoint[] = [];
  for (let y = standable.y; y < standable.y + standable.h; y++) {
    for (let x = standable.x; x < standable.x + standable.w; x++) {
      if (!isBlocked(x, y)) tiles.push({ x, y });
    }
  }
  for (let fy = standable.y; fy <= standable.y + standable.h - side; fy++) {
    for (let fx = standable.x; fx <= standable.x + standable.w - side; fx++) {
      const footprint = { x: fx, y: fy, w: side, h: side };
      const clear = tiles.filter((t) => !rectContainsTile(footprint, t.x, t.y));
      if (clear.length === 0) return `a footprint at ${fx},${fy} covers every tile`;
      for (const tile of tiles) {
        const escape = Math.min(...clear.map((c) => octileDistance(tile.x, tile.y, c.x, c.y)));
        if (escape > SLAM_DODGE_TILES) {
          return `${tile.x},${tile.y} cannot leave a footprint at ${fx},${fy} in time`;
        }
      }
    }
  }
  return null;
}

// ── A raft tentacle's life ───────────────────────────────────────────────────

/**
 * Every raft owns exactly one tentacle: under the water until the active
 * crawler first arrives on the raft, then up until it is killed, and never
 * again after that.
 */
export type RaftTentacleState = 'dormant' | 'risen' | 'killed';

type RaftTentacleEvent = 'crawler_arrived' | 'killed';

/** The one transition table for a raft's tentacle. */
export function nextRaftTentacleState(
  state: RaftTentacleState,
  event: RaftTentacleEvent,
): RaftTentacleState {
  switch (state) {
    case 'dormant':
      return event === 'crawler_arrived' ? 'risen' : 'dormant';
    case 'risen':
      return event === 'killed' ? 'killed' : 'risen';
    case 'killed':
      return 'killed';
    default: {
      const unhandled: never = state;
      throw new Error(`unhandled raft tentacle state ${String(unhandled)}`);
    }
  }
}
