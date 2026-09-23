/**
 * `flank` — a pack closing on one target fans out around it instead of arriving
 * in single file, so a doorway stops being a place to fight them one at a time.
 *
 * Each flanker takes a slot: an angle around the target, spread either side of
 * the pack's average bearing, in the order the pack already stands so no two
 * flankers cross. It walks to a staging point a short way out on that angle,
 * then closes straight in. Only the approach changes — attack timing is the
 * creature's own, and the moment the target walks into reach the creature
 * fights it wherever it is.
 *
 * A slot that cannot be walked to in a straight line from where the mob is,
 * or that has no line to the target, or that would cost a long detour, is
 * dropped and the mob approaches directly. That is what keeps a corridor fight
 * a corridor fight: flanking never sends a mob the long way round.
 */

import type { Mob } from '../Mob';
import { collectPackmates } from '../packAlert';
import {
  distanceBetween,
  hasClearLine,
  isOpenWalk,
  type TacticalFrame,
  type TacticalMove,
  type TacticalPoint,
} from './tacticalFrame';

/** How far from itself a flanker looks for the rest of its pack, in tiles. */
export const FLANK_GROUP_RADIUS_TILES = 8;
/** Angle between neighbouring slots, in degrees. */
export const FLANK_SLOT_SPACING_DEGREES = 55;
/**
 * The widest the whole fan may open, in degrees. Kept under a half turn so a
 * big pack wraps the flanks rather than sending anyone round to the far side,
 * which is the detour flanking must never cost.
 */
export const FLANK_MAX_SPREAD_DEGREES = 160;
/** How far out from the target, in tiles, a flanker stages before closing in. */
export const FLANK_STAGING_TILES = 2.5;
/** Within this many tiles of its staging point, a flanker has staged. */
export const FLANK_STAGED_TILES = 0.6;
/**
 * Once committed to closing in, a flanker goes direct until the target gets
 * this far away, in tiles — a player who breaks off and runs is flanked afresh.
 */
export const FLANK_RELEASE_TILES = 5;
/**
 * The longest the approach through the staging point may be, as a multiple of
 * the straight-line distance to the target. Past this the slot is a detour.
 */
export const FLANK_MAX_DETOUR_RATIO = 1.4;
/** Frames a slot is kept before the pack's layout is read again. */
export const FLANK_REFRESH_FRAMES = 10;

const DEGREES_PER_HALF_TURN = 180;
const SLOT_SPACING_RAD = (FLANK_SLOT_SPACING_DEGREES * Math.PI) / DEGREES_PER_HALF_TURN;
const MAX_SPREAD_RAD = (FLANK_MAX_SPREAD_DEGREES * Math.PI) / DEGREES_PER_HALF_TURN;
const FULL_TURN = Math.PI * 2;
/** Centring a fan of N slots on the mean puts its middle at rank (N − 1) / 2. */
const MIDDLE_RANK_FRACTION = 0.5;

/** Scratch list reused across plans so reading the pack allocates nothing. */
const packScratch: Mob[] = [];
/** Scratch bearings and distances of the pack, the flanker itself first. */
const bearingScratch: number[] = [];
const distanceScratch: number[] = [];

/** An angle folded into (−π, π]. */
function wrapAngle(angle: number): number {
  let wrapped = angle % FULL_TURN;
  if (wrapped > Math.PI) wrapped -= FULL_TURN;
  if (wrapped <= -Math.PI) wrapped += FULL_TURN;
  return wrapped;
}

function bearingFrom(origin: TacticalPoint, point: TacticalPoint): number {
  return Math.atan2(point.y - origin.y, point.x - origin.x);
}

/**
 * The slot angle `self` should approach `target` from, or null when it is the
 * only body closing on that target and so has nothing to fan out from.
 *
 * Every mob of the pack after the same target counts toward the fan, flankers
 * or not: a pack mate walking the straight line is exactly the line a flanker
 * should step off.
 */
export function flankSlotAngle(frame: TacticalFrame): number | null {
  const { self, target, targetPoint, tileSize } = frame;
  collectPackmates(self, FLANK_GROUP_RADIUS_TILES * tileSize, packScratch);
  bearingScratch.length = 0;
  distanceScratch.length = 0;
  const ownBearing = bearingFrom(targetPoint, self);
  const ownDistance = distanceBetween(targetPoint, self);
  bearingScratch.push(ownBearing);
  distanceScratch.push(ownDistance);
  for (const ally of packScratch) {
    if (ally.currentTarget !== target) continue;
    bearingScratch.push(bearingFrom(targetPoint, ally));
    distanceScratch.push(distanceBetween(targetPoint, ally));
  }
  packScratch.length = 0;
  const bodies = bearingScratch.length;
  if (bodies < 2) return null;

  let sumX = 0;
  let sumY = 0;
  for (const bearing of bearingScratch) {
    sumX += Math.cos(bearing);
    sumY += Math.sin(bearing);
  }
  const meanBearing = Math.atan2(sumY, sumX);
  const ownOffset = wrapAngle(ownBearing - meanBearing);
  // Rank by where each body already stands around the mean, so slots are
  // handed out in the order the pack is standing and no two paths cross. A
  // pack queued in single file shares one bearing, which is the very line
  // flanking exists to break, so a tie goes to whoever is nearer.
  let rank = 0;
  for (let index = 1; index < bodies; index++) {
    const offset = wrapAngle(bearingScratch[index] - meanBearing);
    const isAhead =
      offset < ownOffset || (offset === ownOffset && distanceScratch[index] < ownDistance);
    if (isAhead) rank++;
  }
  bearingScratch.length = 0;
  distanceScratch.length = 0;
  const spacing = Math.min(SLOT_SPACING_RAD, MAX_SPREAD_RAD / (bodies - 1));
  const centredRank = rank - (bodies - 1) * MIDDLE_RANK_FRACTION;
  return meanBearing + centredRank * spacing;
}

/**
 * The staging point for `slotAngle`, or null when the slot is unreachable and
 * the mob should approach directly: the staging tile must be standable, open
 * in a straight line from the mob and to the target, and the dog-leg through
 * it no longer than {@link FLANK_MAX_DETOUR_RATIO} times the direct distance.
 */
export function flankStagingPoint(frame: TacticalFrame, slotAngle: number): TacticalPoint | null {
  const { self, targetPoint: target, tileSize, map } = frame;
  const stagingPx = flankStagingTilesOf(frame) * tileSize;
  const staging = {
    x: target.x + Math.cos(slotAngle) * stagingPx,
    y: target.y + Math.sin(slotAngle) * stagingPx,
  };
  const direct = distanceBetween(self, target);
  const dogLeg = distanceBetween(self, staging) + distanceBetween(staging, target);
  if (dogLeg > direct * FLANK_MAX_DETOUR_RATIO) return null;
  if (!hasClearLine(map, tileSize, staging, target)) return null;
  if (!isOpenWalk(map, tileSize, self, staging)) return null;
  return staging;
}

/** How far out `frame`'s creature stages a flank, in tiles. */
export function flankStagingTilesOf(frame: TacticalFrame): number {
  return frame.flankStagingTiles ?? FLANK_STAGING_TILES;
}

/** A flank step toward `staging`. */
export function flankMoveToward(staging: TacticalPoint): TacticalMove {
  return { behaviour: 'flank', x: staging.x, y: staging.y, stopPx: 0, breaksOff: false };
}
